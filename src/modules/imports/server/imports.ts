import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { type ImportTarget, mappingProblems, participantTargets } from "@/modules/imports/domain/mapping";
import { type PhotoRule, photoRuleSchema } from "@/modules/imports/domain/photos";
import { issuesReportCsv } from "@/modules/imports/domain/report";
import { type PlannedRow, type RawRow, type RowIssue, normalizeRow, planRows } from "@/modules/imports/domain/rows";
import { validateImage } from "@/modules/media/server/photo-store";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { assertRosterEditable } from "@/modules/raffle/server/roster-lock";

export const MAX_IMPORT_ROWS = 10_000;
export const STALE_IMPORT_MS = 24 * 60 * 60 * 1000;
const WRITE_CHUNK = 1000;
const TX_OPTIONS = { maxWait: 30_000, timeout: 180_000 };

export type ImportErrorCode =
  | "NOT_FOUND"
  | "WRONG_STATE"
  | "BAD_MAPPING"
  | "TOO_MANY_ROWS"
  | "DUPLICATE_ROW_NUMBER"
  | "ROW_NOT_FOUND"
  | "ROW_NOT_IMPORTABLE"
  | "INVALID_ROWS_PRESENT"
  | "STALE_PREVIEW"
  | "REVERT_CONFLICT";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly details: string[] = [],
  ) {
    super(code);
  }
}

type Tx = Prisma.TransactionClient;

const storedPhotoRuleSchema = photoRuleSchema.extend({ provided: z.boolean().default(false) });

function safeFileName(name: string): string {
  const base = name.split(/[\\/]+/).at(-1) ?? "upload";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "upload";
}

function issues(value: Prisma.JsonValue): RowIssue[] {
  return Array.isArray(value) ? (value as unknown as RowIssue[]) : [];
}

async function loadBatch(client: Db | Tx, batchId: string) {
  const batch = await client.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError("NOT_FOUND");
  return { ...batch, mapping: batch.columnMapping as (ImportTarget | null)[], rule: storedPhotoRuleSchema.parse(batch.photoRule) };
}

export type CreateBatchInput = {
  fileName: string;
  fileSha256: string;
  sheetName: string | null;
  mapping: (ImportTarget | null)[];
  duplicateMode: "SKIP" | "UPDATE" | "REJECT";
  photoRule: PhotoRule;
  photosProvided: boolean;
};

export async function createImportBatch(database: Db, eventId: string, input: CreateBatchInput) {
  const targets = participantTargets(toDefinitions(await listFieldDefinitions(database, eventId)));
  const problems = mappingProblems(input.mapping, targets);
  if (problems.length > 0) throw new ImportError("BAD_MAPPING", problems);
  if (!/^[0-9a-f]{64}$/.test(input.fileSha256)) throw new ImportError("BAD_MAPPING", ["The file fingerprint is malformed."]);
  await sweepStaleImports(database, eventId, new Date());
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const batch = await tx.importBatch.create({
      data: {
        eventId,
        kind: "PARTICIPANTS",
        duplicateMode: input.duplicateMode,
        fileName: safeFileName(input.fileName),
        fileSha256: new Uint8Array(Buffer.from(input.fileSha256, "hex")),
        sheetName: input.sheetName?.slice(0, 100) ?? null,
        columnMapping: input.mapping,
        photoRule: { ...input.photoRule, provided: input.photosProvided },
      },
    });
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "import.started",
      entityType: "import_batch",
      entityId: batch.id,
      payload: { fileName: batch.fileName, fileSha256: input.fileSha256, duplicateMode: input.duplicateMode, photosProvided: input.photosProvided },
    });
    return batch;
  });
}

export async function appendImportRows(database: Db, batchId: string, rows: RawRow[]) {
  const batch = await loadBatch(database, batchId);
  if (batch.status !== "STAGED") throw new ImportError("WRONG_STATE");
  if (batch.rowCount + rows.length > MAX_IMPORT_ROWS) throw new ImportError("TOO_MANY_ROWS", [`Imports are limited to ${MAX_IMPORT_ROWS} rows.`]);
  const numbers = new Set(rows.map((row) => row.rowNumber));
  if (numbers.size !== rows.length) throw new ImportError("DUPLICATE_ROW_NUMBER");
  try {
    await database.$transaction(async (tx) => {
      await tx.importRow.createMany({ data: rows.map((row) => ({ batchId, rowNumber: row.rowNumber, raw: row.cells })) });
      await tx.importBatch.update({ where: { id: batchId }, data: { rowCount: { increment: rows.length } } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ImportError("DUPLICATE_ROW_NUMBER");
    throw error;
  }
}

async function planBatch(client: Db | Tx, batch: Awaited<ReturnType<typeof loadBatch>>) {
  const definitions = toDefinitions(await listFieldDefinitions(client, batch.eventId));
  const stored = await client.importRow.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, raw: true, photoAssetId: true },
  });
  const existing = await client.participant.findMany({ where: { eventId: batch.eventId }, select: { id: true, externalId: true, fullName: true } });
  const normalized = stored.map((row) => normalizeRow({ rowNumber: row.rowNumber, cells: (row.raw as RawRow["cells"]) ?? [] }, batch.mapping, definitions));
  const planned = planRows(normalized, existing, batch.duplicateMode);

  const assets = await client.mediaAsset.findMany({ where: { importBatchId: batch.id, status: "STAGED" }, select: { id: true, sha256: true } });
  const shaByAsset = new Map(assets.map((asset) => [asset.id, Buffer.from(asset.sha256).toString("hex")]));
  const photoByRow = new Map(stored.map((row) => [row.rowNumber, row.photoAssetId]));
  const shaUsage = new Map<string, number>();
  for (const row of planned) {
    const asset = photoByRow.get(row.rowNumber);
    const sha = asset ? shaByAsset.get(asset) : undefined;
    if (sha && row.action !== "INVALID") shaUsage.set(sha, (shaUsage.get(sha) ?? 0) + 1);
  }

  return planned.map((row): PlannedRow & { photoAssetId: string | null } => {
    const errors = [...row.errors];
    const warnings = [...row.warnings];
    const assetId = photoByRow.get(row.rowNumber) ?? null;
    const wantsPhoto = row.action === "CREATE" || row.action === "UPDATE";
    if (wantsPhoto) {
      const sha = assetId ? shaByAsset.get(assetId) : undefined;
      const missing = batch.rule.provided ? !assetId : Boolean(row.photoRef);
      if (missing) {
        const message = batch.rule.provided ? "No usable photo was matched for this row." : "A photo file is listed but no ZIP file was uploaded.";
        (batch.rule.required ? errors : warnings).push({ field: "photo", code: "MISSING_PHOTO", message });
      } else if (!batch.rule.provided && batch.rule.required) {
        errors.push({ field: "photo", code: "MISSING_PHOTO", message: "A photo is required, but no ZIP file was uploaded." });
      }
      if (sha && (shaUsage.get(sha) ?? 0) > 1) warnings.push({ field: "photo", code: "DUPLICATE_PHOTO", message: "The same photo is attached to more than one row." });
    }
    const action = errors.length > 0 ? "INVALID" : row.action;
    return { ...row, errors, warnings, action, participantId: action === "UPDATE" || action === "SKIP" ? row.participantId : null, photoAssetId: assetId };
  });
}

async function writePlan(tx: Tx, batchId: string, planned: Awaited<ReturnType<typeof planBatch>>) {
  for (let start = 0; start < planned.length; start += WRITE_CHUNK) {
    const chunk = planned.slice(start, start + WRITE_CHUNK).map((row) => ({
      row_number: row.rowNumber,
      normalized: row.draft,
      errors: row.errors,
      warnings: row.warnings,
      action: row.action,
      participant_id: row.participantId,
      photo_ref: row.photoRef,
    }));
    await tx.$executeRaw`
      UPDATE import_row AS r SET
        normalized = x.normalized, errors = x.errors, warnings = x.warnings,
        action = x.action::"ImportRowAction", participant_id = x.participant_id, photo_ref = x.photo_ref
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        AS x(row_number int, normalized jsonb, errors jsonb, warnings jsonb, action text, participant_id uuid, photo_ref text)
      WHERE r.batch_id = ${batchId}::uuid AND r.row_number = x.row_number`;
  }
}

function countPlan(planned: readonly PlannedRow[]) {
  return {
    createCount: planned.filter((row) => row.action === "CREATE").length,
    updateCount: planned.filter((row) => row.action === "UPDATE").length,
    skipCount: planned.filter((row) => row.action === "SKIP").length,
    invalidCount: planned.filter((row) => row.action === "INVALID").length,
    warningCount: planned.filter((row) => row.warnings.length > 0).length,
  };
}

export async function validateImportBatch(database: Db, batchId: string) {
  const batch = await loadBatch(database, batchId);
  if (batch.status !== "STAGED" && batch.status !== "VALIDATED") throw new ImportError("WRONG_STATE");
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, batch.eventId);
    const planned = await planBatch(tx, batch);
    await writePlan(tx, batchId, planned);
    const counts = countPlan(planned);
    await tx.importBatch.update({ where: { id: batchId }, data: { ...counts, status: "VALIDATED", validatedAt: new Date() } });
    return counts;
  }, TX_OPTIONS);
}

export async function attachImportPhoto(database: Db, batchId: string, rowNumber: number, bytes: Uint8Array, originalName: string) {
  const batch = await loadBatch(database, batchId);
  if (batch.status !== "STAGED" && batch.status !== "VALIDATED") throw new ImportError("WRONG_STATE");
  const row = await database.importRow.findUnique({ where: { batchId_rowNumber: { batchId, rowNumber } }, select: { id: true, photoAssetId: true, action: true } });
  if (!row) throw new ImportError("ROW_NOT_FOUND");
  if (row.action === "INVALID" || row.action === "SKIP") throw new ImportError("ROW_NOT_IMPORTABLE");
  const info = validateImage(bytes);
  const digest = createHash("sha256").update(bytes).digest();
  return database.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.create({
      data: {
        eventId: batch.eventId,
        kind: "PARTICIPANT_PHOTO",
        status: "STAGED",
        importBatchId: batchId,
        originalName: safeFileName(originalName).slice(0, 120),
        mimeType: info.mimeType,
        byteSize: bytes.length,
        width: info.width,
        height: info.height,
        sha256: new Uint8Array(digest),
        blob: { create: { data: new Uint8Array(bytes) } },
      },
      select: { id: true },
    });
    await tx.importRow.update({ where: { id: row.id }, data: { photoAssetId: asset.id } });
    if (row.photoAssetId) await tx.mediaAsset.deleteMany({ where: { id: row.photoAssetId, status: "STAGED" } });
    return { assetId: asset.id, width: info.width, height: info.height };
  });
}

type CommittedRow = { row_number: number; participant_id: string; before_image: Prisma.JsonValue | null };

export async function commitImportBatch(database: Db, batchId: string, options: { skipInvalidRows: boolean }) {
  const initial = await loadBatch(database, batchId);
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, initial.eventId);
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM import_batch WHERE id = ${batchId}::uuid FOR UPDATE`;
    if (locked[0]?.status !== "VALIDATED") throw new ImportError("WRONG_STATE");
    const batch = await loadBatch(tx, batchId);

    const planned = await planBatch(tx, batch);
    const stored = await tx.importRow.findMany({ where: { batchId }, select: { rowNumber: true, action: true } });
    const storedAction = new Map(stored.map((row) => [row.rowNumber, row.action]));
    const drift = planned.filter((row) => storedAction.get(row.rowNumber) !== row.action).map((row) => `Row ${row.rowNumber}`);
    if (drift.length > 0) throw new ImportError("STALE_PREVIEW", drift.slice(0, 20));
    const counts = countPlan(planned);
    if (counts.invalidCount > 0 && !options.skipInvalidRows) throw new ImportError("INVALID_ROWS_PRESENT");

    const clock = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    const now = clock[0]?.now ?? new Date();
    const results: CommittedRow[] = [];

    const creates = planned.filter((row) => row.action === "CREATE" && row.draft);
    for (let start = 0; start < creates.length; start += WRITE_CHUNK) {
      const chunk = creates.slice(start, start + WRITE_CHUNK);
      const created = await tx.participant.createManyAndReturn({
        data: chunk.map((row) => ({
          eventId: batch.eventId,
          ...(row.draft as NonNullable<PlannedRow["draft"]>),
          photoId: row.photoAssetId,
          createdAt: now,
          updatedAt: now,
        })),
        select: { id: true, externalId: true },
      });
      const idByExternal = new Map(created.map((participant) => [participant.externalId.toLowerCase(), participant.id]));
      for (const row of chunk) {
        const id = idByExternal.get(row.draft?.externalId.toLowerCase() ?? "");
        if (id) results.push({ row_number: row.rowNumber, participant_id: id, before_image: null });
      }
    }

    const updates = planned.filter((row) => row.action === "UPDATE" && row.draft && row.participantId);
    for (let start = 0; start < updates.length; start += WRITE_CHUNK) {
      const chunk = updates.slice(start, start + WRITE_CHUNK);
      const before = await tx.participant.findMany({
        where: { id: { in: chunk.map((row) => row.participantId as string) } },
        select: { id: true, externalId: true, fullName: true, department: true, jobTitle: true, bio: true, email: true, eligible: true, customValues: true, photoId: true },
      });
      const beforeById = new Map(before.map((participant) => [participant.id, participant]));
      const payload = chunk.map((row) => ({
        id: row.participantId,
        ...(row.draft as NonNullable<PlannedRow["draft"]>),
        custom_values: row.draft?.customValues ?? {},
        photo_id: row.photoAssetId,
      }));
      await tx.$executeRaw`
        UPDATE participant AS p SET
          external_id = x."externalId", full_name = x."fullName", department = x.department, job_title = x."jobTitle",
          bio = x.bio, email = x.email, eligible = x.eligible, custom_values = x.custom_values,
          photo_id = COALESCE(x.photo_id, p.photo_id), updated_at = ${now}
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          AS x(id uuid, "externalId" text, "fullName" text, department text, "jobTitle" text, bio text, email text, eligible boolean, custom_values jsonb, photo_id uuid)
        WHERE p.id = x.id AND p.event_id = ${batch.eventId}::uuid`;
      for (const row of chunk) {
        const previous = beforeById.get(row.participantId as string);
        results.push({ row_number: row.rowNumber, participant_id: row.participantId as string, before_image: previous ? JSON.parse(JSON.stringify(previous)) : null });
      }
    }

    for (let start = 0; start < results.length; start += WRITE_CHUNK) {
      const chunk = results.slice(start, start + WRITE_CHUNK);
      await tx.$executeRaw`
        UPDATE import_row AS r SET participant_id = x.participant_id, before_image = x.before_image
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(row_number int, participant_id uuid, before_image jsonb)
        WHERE r.batch_id = ${batchId}::uuid AND r.row_number = x.row_number`;
    }

    const keptAssets = planned.filter((row) => (row.action === "CREATE" || row.action === "UPDATE") && row.photoAssetId).map((row) => row.photoAssetId as string);
    await tx.mediaAsset.updateMany({ where: { id: { in: keptAssets } }, data: { status: "ACTIVE" } });
    const discarded = await tx.mediaAsset.deleteMany({ where: { importBatchId: batchId, status: "STAGED" } });

    await tx.importBatch.update({ where: { id: batchId }, data: { ...counts, status: "COMMITTED", committedAt: now } });
    await appendAudit(tx, {
      eventId: batch.eventId,
      actor: "admin",
      action: "import.committed",
      entityType: "import_batch",
      entityId: batchId,
      payload: {
        fileSha256: Buffer.from(batch.fileSha256).toString("hex"),
        duplicateMode: batch.duplicateMode,
        ...counts,
        photosAttached: keptAssets.length,
        photosDiscarded: discarded.count,
        skippedInvalidRows: counts.invalidCount > 0,
      },
    });
    return { ...counts, photosAttached: keptAssets.length };
  }, TX_OPTIONS);
}

export async function cancelImportBatch(database: Db, batchId: string, reason: "admin" | "stale" = "admin") {
  return database.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; event_id: string }[]>`SELECT status::text, event_id::text FROM import_batch WHERE id = ${batchId}::uuid FOR UPDATE`;
    const current = locked[0];
    if (!current) throw new ImportError("NOT_FOUND");
    if (current.status !== "STAGED" && current.status !== "VALIDATED") throw new ImportError("WRONG_STATE");
    const removed = await tx.mediaAsset.deleteMany({ where: { importBatchId: batchId, status: "STAGED" } });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await appendAudit(tx, {
      eventId: current.event_id,
      actor: reason === "admin" ? "admin" : "system",
      action: "import.cancelled",
      entityType: "import_batch",
      entityId: batchId,
      payload: { reason, stagedPhotosRemoved: removed.count },
    });
  });
}

export async function sweepStaleImports(database: Db, eventId: string, now: Date) {
  const stale = await database.importBatch.findMany({
    where: { eventId, status: { in: ["STAGED", "VALIDATED"] }, createdAt: { lt: new Date(now.getTime() - STALE_IMPORT_MS) } },
    select: { id: true },
  });
  for (const batch of stale) {
    await cancelImportBatch(database, batch.id, "stale").catch((error: unknown) => {
      if (!(error instanceof ImportError)) throw error;
    });
  }
  return stale.length;
}

type BeforeImage = {
  externalId: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
  eligible: boolean;
  customValues: Prisma.InputJsonValue;
  photoId: string | null;
};

export async function revertImportBatch(database: Db, batchId: string) {
  const initial = await loadBatch(database, batchId);
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, initial.eventId);
    const locked = await tx.$queryRaw<{ status: string; committed_at: Date | null }[]>`SELECT status::text, committed_at FROM import_batch WHERE id = ${batchId}::uuid FOR UPDATE`;
    const batch = locked[0];
    if (batch?.status !== "COMMITTED" || !batch.committed_at) throw new ImportError("WRONG_STATE");

    const rows = await tx.importRow.findMany({
      where: { batchId, action: { in: ["CREATE", "UPDATE"] }, participantId: { not: null } },
      select: { rowNumber: true, action: true, participantId: true, beforeImage: true, photoAssetId: true },
    });
    const ids = rows.map((row) => row.participantId as string);
    const current = await tx.participant.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, _count: { select: { wins: true } } } });
    const byId = new Map(current.map((participant) => [participant.id, participant]));
    const conflicts: string[] = [];
    for (const row of rows) {
      const participant = byId.get(row.participantId as string);
      if (!participant) conflicts.push(`Row ${row.rowNumber}: the participant was deleted after the import.`);
      else if (participant._count.wins > 0) conflicts.push(`Row ${row.rowNumber}: the participant has already won a prize.`);
      else if (participant.updatedAt.getTime() > batch.committed_at.getTime()) conflicts.push(`Row ${row.rowNumber}: the participant was edited after the import.`);
    }
    if (conflicts.length > 0) throw new ImportError("REVERT_CONFLICT", conflicts.slice(0, 50));

    const createdIds = rows.filter((row) => row.action === "CREATE").map((row) => row.participantId as string);
    await tx.participant.deleteMany({ where: { id: { in: createdIds } } });
    for (const row of rows.filter((candidate) => candidate.action === "UPDATE")) {
      const before = row.beforeImage as BeforeImage | null;
      if (!before) continue;
      await tx.participant.update({
        where: { id: row.participantId as string },
        data: {
          externalId: before.externalId,
          fullName: before.fullName,
          department: before.department,
          jobTitle: before.jobTitle,
          bio: before.bio,
          email: before.email,
          eligible: before.eligible,
          customValues: before.customValues,
          photoId: before.photoId,
        },
      });
    }
    const batchAssets = rows.map((row) => row.photoAssetId).filter((id): id is string => Boolean(id));
    const unused = await tx.mediaAsset.findMany({ where: { id: { in: batchAssets }, participants: { none: {} } }, select: { id: true } });
    await tx.mediaAsset.deleteMany({ where: { id: { in: unused.map((asset) => asset.id) } } });

    await tx.importBatch.update({ where: { id: batchId }, data: { status: "REVERTED", revertedAt: new Date() } });
    await appendAudit(tx, {
      eventId: initial.eventId,
      actor: "admin",
      action: "import.reverted",
      entityType: "import_batch",
      entityId: batchId,
      payload: { removedParticipants: createdIds.length, restoredParticipants: rows.length - createdIds.length, removedPhotos: unused.length },
    });
    return { removed: createdIds.length, restored: rows.length - createdIds.length, removedPhotoIds: unused.map((asset) => asset.id) };
  }, TX_OPTIONS);
}

export async function listImportBatches(database: Db, eventId: string) {
  return database.importBatch.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      fileName: true,
      duplicateMode: true,
      rowCount: true,
      createCount: true,
      updateCount: true,
      skipCount: true,
      invalidCount: true,
      warningCount: true,
      createdAt: true,
      committedAt: true,
      revertedAt: true,
      cancelledAt: true,
    },
  });
}

export async function getImportBatch(database: Db, eventId: string, batchId: string) {
  const batch = await database.importBatch.findFirst({ where: { id: batchId, eventId } });
  return batch ? { ...batch, fileSha256Hex: Buffer.from(batch.fileSha256).toString("hex") } : null;
}

export async function listImportRows(
  database: Db,
  batchId: string,
  options: { filter: "all" | "problems" | "invalid"; page: number; pageSize?: number },
) {
  const pageSize = Math.min(options.pageSize ?? 50, 200);
  const where: Prisma.ImportRowWhereInput = {
    batchId,
    ...(options.filter === "invalid" ? { action: "INVALID" } : {}),
    ...(options.filter === "problems" ? { OR: [{ action: "INVALID" }, { NOT: { warnings: { equals: [] } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    database.importRow.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: (Math.max(options.page, 1) - 1) * pageSize,
      take: pageSize,
      select: { rowNumber: true, normalized: true, errors: true, warnings: true, action: true, photoRef: true, photoAssetId: true },
    }),
    database.importRow.count({ where }),
  ]);
  return {
    total,
    pageSize,
    rows: rows.map((row) => ({ ...row, errors: issues(row.errors), warnings: issues(row.warnings) })),
  };
}

export async function importIssuesCsv(database: Db, eventId: string, batchId: string): Promise<string | null> {
  const batch = await database.importBatch.findFirst({ where: { id: batchId, eventId }, select: { id: true } });
  if (!batch) return null;
  const rows = await database.importRow.findMany({
    where: { batchId, OR: [{ action: "INVALID" }, { NOT: { warnings: { equals: [] } } }] },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, action: true, normalized: true, errors: true, warnings: true },
  });
  return issuesReportCsv(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      externalId: (row.normalized as { externalId?: string } | null)?.externalId ?? null,
      errors: issues(row.errors),
      warnings: issues(row.warnings),
    })),
  );
}
