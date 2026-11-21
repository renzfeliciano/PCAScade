import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { type ImportKind, type ImportTarget, mappingProblems, participantTargets, prizeTargets } from "@/modules/imports/domain/mapping";
import { type PhotoRule, photoRuleSchema } from "@/modules/imports/domain/photos";
import { type PrizeDraft, normalizePrizeRow, planPrizeRows } from "@/modules/imports/domain/prize-rows";
import { issuesReportCsv } from "@/modules/imports/domain/report";
import { type ParticipantDraft, type RawRow, type RowIssue, normalizeRow, planRows } from "@/modules/imports/domain/rows";
import { validateImage } from "@/modules/media/server/photo-store";
import { listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { MAX_PRIZES_PER_EVENT } from "@/modules/prizes/domain/prizes";
import { renumberPrizes } from "@/modules/prizes/server/prizes";
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
  | "REVERT_CONFLICT"
  | "TOO_MANY_PRIZES";

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
  kind?: ImportKind;
  fileName: string;
  fileSha256: string;
  sheetName: string | null;
  mapping: (ImportTarget | null)[];
  duplicateMode: "SKIP" | "UPDATE" | "REJECT";
  photoRule: PhotoRule;
  photosProvided: boolean;
};

export async function createImportBatch(database: Db, eventId: string, input: CreateBatchInput) {
  const kind = input.kind ?? "PARTICIPANTS";
  const targets = kind === "PRIZES" ? prizeTargets() : participantTargets(toDefinitions(await listFieldDefinitions(database, eventId)));
  const problems = mappingProblems(input.mapping, targets);
  if (problems.length > 0) throw new ImportError("BAD_MAPPING", problems);
  if (!/^[0-9a-f]{64}$/.test(input.fileSha256)) throw new ImportError("BAD_MAPPING", ["The file fingerprint is malformed."]);
  await sweepStaleImports(database, eventId, new Date());
  return database.$transaction(async (tx) => {
    await assertRosterEditable(tx, eventId);
    const batch = await tx.importBatch.create({
      data: {
        eventId,
        kind,
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
      payload: { kind, fileName: batch.fileName, fileSha256: input.fileSha256, duplicateMode: input.duplicateMode, photosProvided: input.photosProvided },
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

type RowAction = "CREATE" | "UPDATE" | "SKIP" | "INVALID";

type GenericPlannedRow = {
  rowNumber: number;
  draft: ParticipantDraft | PrizeDraft | null;
  photoRef: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
  action: RowAction;
  targetId: string | null;
};

type Batch = Awaited<ReturnType<typeof loadBatch>>;

async function planByKind(client: Db | Tx, batch: Batch, stored: { rowNumber: number; raw: Prisma.JsonValue }[]): Promise<GenericPlannedRow[]> {
  const raw = (row: { rowNumber: number; raw: Prisma.JsonValue }): RawRow => ({ rowNumber: row.rowNumber, cells: (row.raw as RawRow["cells"]) ?? [] });
  if (batch.kind === "PRIZES") {
    const categories = await client.prizeCategory.findMany({ where: { eventId: batch.eventId }, select: { id: true, name: true, slug: true } });
    const existing = await client.prize.findMany({ where: { eventId: batch.eventId }, select: { id: true, code: true, name: true } });
    const normalized = stored.map((row) => normalizePrizeRow(raw(row), batch.mapping, categories));
    return planPrizeRows(normalized, existing, batch.duplicateMode).map(({ prizeId, ...row }) => ({ ...row, targetId: prizeId }));
  }
  const definitions = toDefinitions(await listFieldDefinitions(client, batch.eventId));
  const existing = await client.participant.findMany({ where: { eventId: batch.eventId }, select: { id: true, externalId: true, fullName: true } });
  const normalized = stored.map((row) => normalizeRow(raw(row), batch.mapping, definitions));
  return planRows(normalized, existing, batch.duplicateMode).map(({ participantId, ...row }) => ({ ...row, targetId: participantId }));
}

async function planBatch(client: Db | Tx, batch: Batch) {
  const stored = await client.importRow.findMany({
    where: { batchId: batch.id },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, raw: true, photoAssetId: true },
  });
  const planned = await planByKind(client, batch, stored);

  const assets = await client.mediaAsset.findMany({ where: { importBatchId: batch.id, status: "STAGED" }, select: { id: true, sha256: true } });
  const shaByAsset = new Map(assets.map((asset) => [asset.id, Buffer.from(asset.sha256).toString("hex")]));
  const photoByRow = new Map(stored.map((row) => [row.rowNumber, row.photoAssetId]));
  const shaUsage = new Map<string, number>();
  for (const row of planned) {
    const asset = photoByRow.get(row.rowNumber);
    const sha = asset ? shaByAsset.get(asset) : undefined;
    if (sha && row.action !== "INVALID") shaUsage.set(sha, (shaUsage.get(sha) ?? 0) + 1);
  }

  return planned.map((row): GenericPlannedRow & { photoAssetId: string | null } => {
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
    return { ...row, errors, warnings, action, targetId: action === "UPDATE" || action === "SKIP" ? row.targetId : null, photoAssetId: assetId };
  });
}

async function writePlan(tx: Tx, batch: Batch, planned: Awaited<ReturnType<typeof planBatch>>) {
  const prizes = batch.kind === "PRIZES";
  for (let start = 0; start < planned.length; start += WRITE_CHUNK) {
    const chunk = planned.slice(start, start + WRITE_CHUNK).map((row) => ({
      row_number: row.rowNumber,
      normalized: row.draft,
      errors: row.errors,
      warnings: row.warnings,
      action: row.action,
      participant_id: prizes ? null : row.targetId,
      prize_id: prizes ? row.targetId : null,
      photo_ref: row.photoRef,
    }));
    await tx.$executeRaw`
      UPDATE import_row AS r SET
        normalized = x.normalized, errors = x.errors, warnings = x.warnings,
        action = x.action::"ImportRowAction", participant_id = x.participant_id, prize_id = x.prize_id, photo_ref = x.photo_ref
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        AS x(row_number int, normalized jsonb, errors jsonb, warnings jsonb, action text, participant_id uuid, prize_id uuid, photo_ref text)
      WHERE r.batch_id = ${batch.id}::uuid AND r.row_number = x.row_number`;
  }
}

function countPlan(planned: readonly { action: RowAction; warnings: RowIssue[] }[]) {
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
    await writePlan(tx, batch, planned);
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
        kind: batch.kind === "PRIZES" ? "PRIZE_PHOTO" : "PARTICIPANT_PHOTO",
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

type CommittedRow = { row_number: number; target_id: string; before_image: Prisma.JsonValue | null };
type CommitPlan = (GenericPlannedRow & { photoAssetId: string | null })[];

async function commitParticipantRows(tx: Tx, batch: Batch, planned: CommitPlan, now: Date): Promise<CommittedRow[]> {
  const results: CommittedRow[] = [];
  const creates = planned.filter((row) => row.action === "CREATE" && row.draft);
  for (let start = 0; start < creates.length; start += WRITE_CHUNK) {
    const chunk = creates.slice(start, start + WRITE_CHUNK);
    const created = await tx.participant.createManyAndReturn({
      data: chunk.map((row) => ({
        eventId: batch.eventId,
        ...(row.draft as ParticipantDraft),
        photoId: row.photoAssetId,
        createdAt: now,
        updatedAt: now,
      })),
      select: { id: true, externalId: true },
    });
    const idByExternal = new Map(created.map((participant) => [participant.externalId.toLowerCase(), participant.id]));
    for (const row of chunk) {
      const id = idByExternal.get((row.draft as ParticipantDraft).externalId.toLowerCase());
      if (id) results.push({ row_number: row.rowNumber, target_id: id, before_image: null });
    }
  }

  const updates = planned.filter((row) => row.action === "UPDATE" && row.draft && row.targetId);
  for (let start = 0; start < updates.length; start += WRITE_CHUNK) {
    const chunk = updates.slice(start, start + WRITE_CHUNK);
    const before = await tx.participant.findMany({
      where: { id: { in: chunk.map((row) => row.targetId as string) } },
      select: { id: true, externalId: true, fullName: true, department: true, jobTitle: true, bio: true, email: true, eligible: true, customValues: true, photoId: true },
    });
    const beforeById = new Map(before.map((participant) => [participant.id, participant]));
    const payload = chunk.map((row) => ({
      id: row.targetId,
      ...(row.draft as ParticipantDraft),
      custom_values: (row.draft as ParticipantDraft).customValues ?? {},
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
      const previous = beforeById.get(row.targetId as string);
      results.push({ row_number: row.rowNumber, target_id: row.targetId as string, before_image: previous ? JSON.parse(JSON.stringify(previous)) : null });
    }
  }
  return results;
}

async function commitPrizeRows(tx: Tx, batch: Batch, planned: CommitPlan, now: Date): Promise<CommittedRow[]> {
  const results: CommittedRow[] = [];
  const creates = planned.filter((row) => row.action === "CREATE" && row.draft);
  const existingCount = await tx.prize.count({ where: { eventId: batch.eventId } });
  if (existingCount + creates.length > MAX_PRIZES_PER_EVENT) throw new ImportError("TOO_MANY_PRIZES", [`An event can have at most ${MAX_PRIZES_PER_EVENT} prizes.`]);
  const last = await tx.prize.aggregate({ where: { eventId: batch.eventId }, _max: { drawOrder: true } });
  let drawOrder = last._max.drawOrder ?? 0;
  for (const row of creates) {
    const draft = row.draft as PrizeDraft;
    drawOrder += 1;
    const prize = await tx.prize.create({
      data: {
        eventId: batch.eventId,
        code: draft.code,
        name: draft.name,
        description: draft.description,
        quantity: draft.quantity,
        categoryId: draft.categoryId,
        photoId: row.photoAssetId,
        drawOrder,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    results.push({ row_number: row.rowNumber, target_id: prize.id, before_image: null });
  }

  const updates = planned.filter((row) => row.action === "UPDATE" && row.draft && row.targetId);
  for (const row of updates) {
    const draft = row.draft as PrizeDraft;
    const id = row.targetId as string;
    const before = await tx.prize.findFirst({
      where: { id, eventId: batch.eventId },
      select: { id: true, code: true, name: true, description: true, quantity: true, categoryId: true, photoId: true },
    });
    if (!before) throw new ImportError("STALE_PREVIEW", [`Row ${row.rowNumber}`]);
    const mapped = new Set(draft.mapped);
    await tx.prize.update({
      where: { id },
      data: {
        code: draft.code,
        name: draft.name,
        ...(mapped.has("description") ? { description: draft.description } : {}),
        ...(mapped.has("quantity") ? { quantity: draft.quantity } : {}),
        ...(mapped.has("category") ? { categoryId: draft.categoryId } : {}),
        ...(row.photoAssetId ? { photoId: row.photoAssetId } : {}),
        updatedAt: now,
      },
    });
    results.push({ row_number: row.rowNumber, target_id: id, before_image: JSON.parse(JSON.stringify(before)) });
  }
  return results;
}

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
    const prizes = batch.kind === "PRIZES";
    const results = prizes ? await commitPrizeRows(tx, batch, planned, now) : await commitParticipantRows(tx, batch, planned, now);

    for (let start = 0; start < results.length; start += WRITE_CHUNK) {
      const chunk = results.slice(start, start + WRITE_CHUNK).map((row) => ({
        row_number: row.row_number,
        participant_id: prizes ? null : row.target_id,
        prize_id: prizes ? row.target_id : null,
        before_image: row.before_image,
      }));
      await tx.$executeRaw`
        UPDATE import_row AS r SET participant_id = x.participant_id, prize_id = x.prize_id, before_image = x.before_image
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(row_number int, participant_id uuid, prize_id uuid, before_image jsonb)
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
        kind: batch.kind,
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

    const prizes = initial.kind === "PRIZES";
    const rows = await tx.importRow.findMany({
      where: { batchId, action: { in: ["CREATE", "UPDATE"] }, ...(prizes ? { prizeId: { not: null } } : { participantId: { not: null } }) },
      select: { rowNumber: true, action: true, participantId: true, prizeId: true, beforeImage: true, photoAssetId: true },
    });
    const targets = rows.map((row) => ({ ...row, targetId: (prizes ? row.prizeId : row.participantId) as string }));
    const outcome = prizes
      ? await revertPrizeRows(tx, initial.eventId, targets, batch.committed_at)
      : await revertParticipantRows(tx, targets, batch.committed_at);

    const batchAssets = rows.map((row) => row.photoAssetId).filter((id): id is string => Boolean(id));
    const unused = await tx.mediaAsset.findMany({ where: { id: { in: batchAssets }, participants: { none: {} }, prizes: { none: {} } }, select: { id: true } });
    await tx.mediaAsset.deleteMany({ where: { id: { in: unused.map((asset) => asset.id) } } });

    await tx.importBatch.update({ where: { id: batchId }, data: { status: "REVERTED", revertedAt: new Date() } });
    await appendAudit(tx, {
      eventId: initial.eventId,
      actor: "admin",
      action: "import.reverted",
      entityType: "import_batch",
      entityId: batchId,
      payload: prizes
        ? { kind: initial.kind, removedPrizes: outcome.removed, restoredPrizes: outcome.restored, removedPhotos: unused.length }
        : { removedParticipants: outcome.removed, restoredParticipants: outcome.restored, removedPhotos: unused.length },
    });
    return { ...outcome, removedPhotoIds: unused.map((asset) => asset.id) };
  }, TX_OPTIONS);
}

type RevertRow = { rowNumber: number; action: string | null; targetId: string; beforeImage: Prisma.JsonValue };

async function revertParticipantRows(tx: Tx, rows: RevertRow[], committedAt: Date) {
  const current = await tx.participant.findMany({ where: { id: { in: rows.map((row) => row.targetId) } }, select: { id: true, updatedAt: true, _count: { select: { wins: true } } } });
  const byId = new Map(current.map((participant) => [participant.id, participant]));
  const conflicts: string[] = [];
  for (const row of rows) {
    const participant = byId.get(row.targetId);
    if (!participant) conflicts.push(`Row ${row.rowNumber}: the participant was deleted after the import.`);
    else if (participant._count.wins > 0) conflicts.push(`Row ${row.rowNumber}: the participant has already won a prize.`);
    else if (participant.updatedAt.getTime() > committedAt.getTime()) conflicts.push(`Row ${row.rowNumber}: the participant was edited after the import.`);
  }
  if (conflicts.length > 0) throw new ImportError("REVERT_CONFLICT", conflicts.slice(0, 50));

  const createdIds = rows.filter((row) => row.action === "CREATE").map((row) => row.targetId);
  await tx.participant.deleteMany({ where: { id: { in: createdIds } } });
  for (const row of rows.filter((candidate) => candidate.action === "UPDATE")) {
    const before = row.beforeImage as BeforeImage | null;
    if (!before) continue;
    await tx.participant.update({
      where: { id: row.targetId },
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
  return { removed: createdIds.length, restored: rows.length - createdIds.length };
}

type PrizeBeforeImage = { code: string; name: string; description: string | null; quantity: number; categoryId: string | null; photoId: string | null };

async function revertPrizeRows(tx: Tx, eventId: string, rows: RevertRow[], committedAt: Date) {
  const current = await tx.prize.findMany({ where: { id: { in: rows.map((row) => row.targetId) } }, select: { id: true, updatedAt: true, _count: { select: { draws: true } } } });
  const byId = new Map(current.map((prize) => [prize.id, prize]));
  const categoryIds = new Set((await tx.prizeCategory.findMany({ where: { eventId }, select: { id: true } })).map((category) => category.id));
  const conflicts: string[] = [];
  for (const row of rows) {
    const prize = byId.get(row.targetId);
    const before = row.beforeImage as PrizeBeforeImage | null;
    if (!prize) conflicts.push(`Row ${row.rowNumber}: the prize was deleted after the import.`);
    else if (prize._count.draws > 0) conflicts.push(`Row ${row.rowNumber}: the prize has already been drawn.`);
    else if (prize.updatedAt.getTime() > committedAt.getTime()) conflicts.push(`Row ${row.rowNumber}: the prize was edited after the import.`);
    else if (before?.categoryId && !categoryIds.has(before.categoryId)) conflicts.push(`Row ${row.rowNumber}: the prize's previous category was deleted.`);
  }
  if (conflicts.length > 0) throw new ImportError("REVERT_CONFLICT", conflicts.slice(0, 50));

  const createdIds = rows.filter((row) => row.action === "CREATE").map((row) => row.targetId);
  await tx.prize.deleteMany({ where: { id: { in: createdIds } } });
  for (const row of rows.filter((candidate) => candidate.action === "UPDATE")) {
    const before = row.beforeImage as PrizeBeforeImage | null;
    if (!before) continue;
    await tx.prize.update({
      where: { id: row.targetId },
      data: { code: before.code, name: before.name, description: before.description, quantity: before.quantity, categoryId: before.categoryId, photoId: before.photoId },
    });
  }
  await renumberPrizes(tx, eventId);
  return { removed: createdIds.length, restored: rows.length - createdIds.length };
}

export async function listImportBatches(database: Db, eventId: string) {
  return database.importBatch.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
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
  const batch = await database.importBatch.findFirst({ where: { id: batchId, eventId }, select: { id: true, kind: true } });
  if (!batch) return null;
  const rows = await database.importRow.findMany({
    where: { batchId, OR: [{ action: "INVALID" }, { NOT: { warnings: { equals: [] } } }] },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, action: true, normalized: true, errors: true, warnings: true },
  });
  const prizes = batch.kind === "PRIZES";
  return issuesReportCsv(
    rows.map((row) => {
      const draft = row.normalized as { externalId?: string; code?: string } | null;
      return {
        rowNumber: row.rowNumber,
        action: row.action,
        key: (prizes ? draft?.code : draft?.externalId) ?? null,
        errors: issues(row.errors),
        warnings: issues(row.warnings),
      };
    }),
    prizes ? "prize_code" : "employee_id",
  );
}
