import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { suggestMapping } from "@/modules/imports/domain/mapping";
import type { PhotoRule } from "@/modules/imports/domain/photos";
import type { RawRow } from "@/modules/imports/domain/rows";
import {
  ImportError,
  appendImportRows,
  attachImportPhoto,
  cancelImportBatch,
  commitImportBatch,
  createImportBatch,
  importIssuesCsv,
  listImportRows,
  revertImportBatch,
  validateImportBatch,
} from "@/modules/imports/server/imports";
import { createFieldDefinition, listFieldDefinitions, toDefinitions } from "@/modules/participants/server/fields";
import { createParticipant, updateParticipant } from "@/modules/participants/server/participants";
import { pngHeader } from "../fixtures/images";
import { testDb } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

async function newEvent(withShirtField = true) {
  const event = await database.event.create({ data: { slug: `import-${randomUUID().slice(0, 8)}`, name: "Import test" } });
  if (withShirtField) {
    await createFieldDefinition(database, event.id, { key: "shirt_size", label: "Shirt size", type: "SINGLE_SELECT", required: true, isPublic: false, options: ["S", "M", "L"] });
  }
  return event.id;
}

type ImportOptions = { duplicateMode?: "SKIP" | "UPDATE" | "REJECT"; photoRule?: PhotoRule; photosProvided?: boolean; chunk?: number };

async function stage(eventId: string, headers: string[], body: (string | number | boolean | null)[][], options: ImportOptions = {}) {
  const definitions = toDefinitions(await listFieldDefinitions(database, eventId));
  const mapping = suggestMapping(headers, definitions);
  const batch = await createImportBatch(database, eventId, {
    fileName: "participants.xlsx",
    fileSha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    sheetName: "Sheet1",
    mapping,
    duplicateMode: options.duplicateMode ?? "REJECT",
    photoRule: options.photoRule ?? { match: "COLUMN", required: false },
    photosProvided: options.photosProvided ?? false,
  });
  const rows: RawRow[] = body.map((cells, index) => ({ rowNumber: index + 2, cells }));
  const chunk = options.chunk ?? 500;
  for (let start = 0; start < rows.length; start += chunk) await appendImportRows(database, batch.id, rows.slice(start, start + chunk));
  const counts = await validateImportBatch(database, batch.id);
  return { batchId: batch.id, counts };
}

const HEADERS = ["Employee ID", "Full Name", "Department", "Shirt Size", "Photo"];

describe("participant import pipeline", () => {
  it("imports a valid sheet regardless of column order and header wording, atomically and audited", async () => {
    const eventId = await newEvent();
    const headers = ["shirt size", "DEPT", "Name", "EMP NO"];
    const { batchId, counts } = await stage(eventId, headers, [
      ["m", "IT", "Juan Dela Cruz", "EMP-001"],
      ["L", "HR", "Maria Santos", "EMP-002"],
    ]);
    expect(counts).toMatchObject({ createCount: 2, invalidCount: 0 });
    expect(await database.participant.count({ where: { eventId } })).toBe(0);

    const result = await commitImportBatch(database, batchId, { skipInvalidRows: false });
    expect(result.createCount).toBe(2);
    const juan = await database.participant.findFirstOrThrow({ where: { eventId, externalId: "EMP-001" } });
    expect(juan).toMatchObject({ fullName: "Juan Dela Cruz", department: "IT", eligible: true, customValues: { shirt_size: "M" } });
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "import.committed", entityId: batchId } });
    expect(JSON.parse(audit.payload)).toMatchObject({ createCount: 2, duplicateMode: "REJECT" });
    await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("refuses a mapping that misses required fields", async () => {
    const eventId = await newEvent();
    await expect(
      createImportBatch(database, eventId, {
        fileName: "x.csv",
        fileSha256: "a".repeat(64),
        sheetName: null,
        mapping: ["fullName", null],
        duplicateMode: "REJECT",
        photoRule: { match: "COLUMN", required: false },
        photosProvided: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_MAPPING" });
  });

  it("never commits invalid rows unless the administrator explicitly skips them", async () => {
    const eventId = await newEvent();
    const { batchId, counts } = await stage(eventId, HEADERS, [
      ["EMP-1", "Valid Person", "IT", "S", null],
      ["", "No Identifier", "IT", "S", null],
      ["EMP-3", "", "IT", "XXL", null],
      [null, null, null, null, null],
    ]);
    expect(counts).toMatchObject({ createCount: 1, invalidCount: 3 });
    const invalid = await listImportRows(database, batchId, { filter: "invalid", page: 1 });
    expect(invalid.rows.find((row) => row.rowNumber === 4)?.errors.map((issue) => issue.field).sort()).toEqual(["custom:shirt_size", "fullName"]);

    await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "INVALID_ROWS_PRESENT" });
    expect(await database.participant.count({ where: { eventId } })).toBe(0);
    await commitImportBatch(database, batchId, { skipInvalidRows: true });
    expect(await database.participant.findMany({ where: { eventId }, select: { externalId: true } })).toEqual([{ externalId: "EMP-1" }]);

    const csv = (await importIssuesCsv(database, eventId, batchId)) ?? "";
    expect(csv.split("\r\n").filter((line) => line.includes(",error,")).length).toBeGreaterThanOrEqual(4);
  });

  it("flags employee IDs repeated inside the file", async () => {
    const eventId = await newEvent();
    const { counts } = await stage(eventId, HEADERS, [
      ["EMP-7", "First Copy", "IT", "S", null],
      ["emp-7", "Second Copy", "IT", "S", null],
    ]);
    expect(counts).toMatchObject({ createCount: 0, invalidCount: 2 });
  });

  it("handles re-imports according to the chosen duplicate mode", async () => {
    const eventId = await newEvent();
    const first = await stage(eventId, HEADERS, [["EMP-1", "Ana Reyes", "IT", "S", null]]);
    await commitImportBatch(database, first.batchId, { skipInvalidRows: false });
    const sheet = [
      ["EMP-1", "Ana Reyes-Lim", "Finance", "M", null],
      ["EMP-2", "Ben Cruz", "IT", "L", null],
    ];

    const rejected = await stage(eventId, HEADERS, sheet, { duplicateMode: "REJECT" });
    expect(rejected.counts).toMatchObject({ invalidCount: 1, createCount: 1 });
    await cancelImportBatch(database, rejected.batchId);

    const skipped = await stage(eventId, HEADERS, sheet, { duplicateMode: "SKIP" });
    expect(skipped.counts).toMatchObject({ skipCount: 1, createCount: 1 });
    await commitImportBatch(database, skipped.batchId, { skipInvalidRows: false });
    expect((await database.participant.findFirstOrThrow({ where: { eventId, externalId: "EMP-1" } })).fullName).toBe("Ana Reyes");

    const updated = await stage(eventId, HEADERS, sheet, { duplicateMode: "UPDATE" });
    expect(updated.counts).toMatchObject({ updateCount: 2 });
    await commitImportBatch(database, updated.batchId, { skipInvalidRows: false });
    expect(await database.participant.findFirstOrThrow({ where: { eventId, externalId: "EMP-1" } })).toMatchObject({ fullName: "Ana Reyes-Lim", department: "Finance", customValues: { shirt_size: "M" } });
    const row = await database.importRow.findFirstOrThrow({ where: { batchId: updated.batchId, rowNumber: 2 } });
    expect(row.beforeImage).toMatchObject({ fullName: "Ana Reyes", department: "IT" });
  });

  it("attaches photos, reports missing and shared ones, and discards photos it will not use", async () => {
    const eventId = await newEvent();
    const { batchId } = await stage(
      eventId,
      HEADERS,
      [
        ["EMP-1", "With Photo", "IT", "S", "EMP-1.jpg"],
        ["EMP-2", "Shares Photo", "IT", "S", "same.jpg"],
        ["EMP-3", "Shares Photo Too", "IT", "S", "same.jpg"],
        ["EMP-4", "No Photo", "IT", "S", "EMP-4.jpg"],
        ["", "Invalid Row", "IT", "S", "EMP-5.jpg"],
      ],
      { photosProvided: true },
    );
    await attachImportPhoto(database, batchId, 2, pngHeader(200, 200), "EMP-1.jpg");
    const shared = pngHeader(300, 300);
    await attachImportPhoto(database, batchId, 3, shared, "same.jpg");
    await attachImportPhoto(database, batchId, 4, shared, "same.jpg");
    await expect(attachImportPhoto(database, batchId, 6, pngHeader(10, 10), "EMP-5.jpg")).rejects.toMatchObject({ code: "ROW_NOT_IMPORTABLE" });
    await expect(attachImportPhoto(database, batchId, 5, new TextEncoder().encode("<svg onload=alert(1)>"), "EMP-4.jpg")).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
    await attachImportPhoto(database, batchId, 2, pngHeader(220, 220), "EMP-1-retake.jpg");

    const counts = await validateImportBatch(database, batchId);
    expect(counts).toMatchObject({ createCount: 4, invalidCount: 1 });
    const problems = await listImportRows(database, batchId, { filter: "problems", page: 1 });
    const codes = Object.fromEntries(problems.rows.map((row) => [row.rowNumber, row.warnings.map((issue) => issue.code)]));
    expect(codes[3]).toContain("DUPLICATE_PHOTO");
    expect(codes[4]).toContain("DUPLICATE_PHOTO");
    expect(codes[5]).toContain("MISSING_PHOTO");
    expect(await database.mediaAsset.count({ where: { importBatchId: batchId, status: "STAGED" } })).toBe(3);

    await commitImportBatch(database, batchId, { skipInvalidRows: true });
    const withPhoto = await database.participant.findFirstOrThrow({ where: { eventId, externalId: "EMP-1" }, include: { photo: true } });
    expect(withPhoto.photo).toMatchObject({ status: "ACTIVE", width: 220 });
    expect(await database.mediaAsset.count({ where: { importBatchId: batchId, status: "STAGED" } })).toBe(0);
  });

  it("treats a missing required photo as an error", async () => {
    const eventId = await newEvent();
    const { counts } = await stage(eventId, HEADERS, [["EMP-1", "Needs Photo", "IT", "S", "EMP-1.jpg"]], {
      photoRule: { match: "COLUMN", required: true },
      photosProvided: true,
    });
    expect(counts).toMatchObject({ invalidCount: 1 });
  });

  it("removes staged photos when an import is cancelled", async () => {
    const eventId = await newEvent();
    const { batchId } = await stage(eventId, HEADERS, [["EMP-1", "Cancelled", "IT", "S", "EMP-1.jpg"]], { photosProvided: true });
    await attachImportPhoto(database, batchId, 2, pngHeader(100, 100), "EMP-1.jpg");
    await cancelImportBatch(database, batchId);
    expect(await database.mediaAsset.count({ where: { importBatchId: batchId } })).toBe(0);
    await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("refuses to commit a preview that no longer matches the database", async () => {
    const eventId = await newEvent();
    const { batchId } = await stage(eventId, HEADERS, [["EMP-1", "Raced", "IT", "S", null]]);
    await createParticipant(database, eventId, { builtin: { externalId: "EMP-1", fullName: "Registered Meanwhile" }, custom: { shirt_size: "S" } });
    await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "STALE_PREVIEW" });
    expect(await database.participant.count({ where: { eventId } })).toBe(1);
  });

  it("rolls back everything when the database fails mid-commit", async () => {
    const eventId = await newEvent();
    const { batchId } = await stage(eventId, HEADERS, [["EMP-1", "Fails", "IT", "S", "EMP-1.jpg"]], { photosProvided: true });
    await attachImportPhoto(database, batchId, 2, pngHeader(100, 100), "EMP-1.jpg");
    await validateImportBatch(database, batchId);
    await database.$executeRaw`CREATE OR REPLACE FUNCTION pcascade_test_fail_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'import.committed' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`;
    await database.$executeRaw`CREATE TRIGGER pcascade_test_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pcascade_test_fail_audit()`;
    try {
      await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toThrow(/injected failure/);
    } finally {
      await database.$executeRaw`DROP TRIGGER IF EXISTS pcascade_test_fail_audit ON audit_log`;
      await database.$executeRaw`DROP FUNCTION IF EXISTS pcascade_test_fail_audit()`;
    }
    expect(await database.participant.count({ where: { eventId } })).toBe(0);
    expect((await database.importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("VALIDATED");
    expect(await database.mediaAsset.count({ where: { importBatchId: batchId, status: "STAGED" } })).toBe(1);
    await commitImportBatch(database, batchId, { skipInvalidRows: false });
    expect(await database.participant.count({ where: { eventId } })).toBe(1);
  });

  it("reverts a committed import, and refuses when records changed afterwards", async () => {
    const eventId = await newEvent();
    const base = await stage(eventId, HEADERS, [["EMP-1", "Original Name", "IT", "S", null]]);
    await commitImportBatch(database, base.batchId, { skipInvalidRows: false });
    const second = await stage(
      eventId,
      HEADERS,
      [
        ["EMP-1", "Renamed", "Ops", "L", null],
        ["EMP-2", "Brand New", "Ops", "L", null],
      ],
      { duplicateMode: "UPDATE" },
    );
    await commitImportBatch(database, second.batchId, { skipInvalidRows: false });
    const reverted = await revertImportBatch(database, second.batchId);
    expect(reverted).toMatchObject({ removed: 1, restored: 1 });
    expect(await database.participant.findMany({ where: { eventId }, select: { externalId: true, fullName: true } })).toEqual([{ externalId: "EMP-1", fullName: "Original Name" }]);
    await expect(revertImportBatch(database, second.batchId)).rejects.toMatchObject({ code: "WRONG_STATE" });

    const third = await stage(eventId, HEADERS, [["EMP-3", "Edited Later", "Ops", "S", null]]);
    await commitImportBatch(database, third.batchId, { skipInvalidRows: false });
    const later = await database.participant.findFirstOrThrow({ where: { eventId, externalId: "EMP-3" } });
    await updateParticipant(database, eventId, later.id, { builtin: { externalId: "EMP-3", fullName: "Edited By Hand" }, custom: { shirt_size: "S" } });
    const conflict = await revertImportBatch(database, third.batchId).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ImportError);
    expect((conflict as ImportError).details[0]).toMatch(/edited after the import/);
  });

  it("blocks every import stage and roster edit once a raffle is frozen", async () => {
    const eventId = await newEvent();
    const before = await stage(eventId, HEADERS, [["EMP-1", "Staged Before Freeze", "IT", "S", null]]);
    await database.rafflePreparation.create({
      data: { eventId, version: 1, status: "FROZEN", algorithmVersion: "pcascade-select-v1", participantsSha256: new Uint8Array(randomBytes(32)), rulesSha256: new Uint8Array(randomBytes(32)), seedCommitment: new Uint8Array(randomBytes(32)) },
    });
    await expect(
      createImportBatch(database, eventId, {
        fileName: "late.csv",
        fileSha256: "b".repeat(64),
        sheetName: null,
        mapping: suggestMapping(HEADERS, toDefinitions(await listFieldDefinitions(database, eventId))),
        duplicateMode: "REJECT",
        photoRule: { match: "COLUMN", required: false },
        photosProvided: false,
      }),
    ).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
    await expect(validateImportBatch(database, before.batchId)).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
    await expect(commitImportBatch(database, before.batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
    await expect(createParticipant(database, eventId, { builtin: { externalId: "EMP-9", fullName: "Too Late" }, custom: { shirt_size: "S" } })).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
    expect(await database.participant.count({ where: { eventId } })).toBe(0);
  });

  it("imports 5,000 rows in reasonable time", async () => {
    const eventId = await newEvent(false);
    const body = Array.from({ length: 5000 }, (_, index) => [`E${String(index).padStart(5, "0")}`, `Person ${index}`, index % 2 ? "IT" : "HR"]);
    const started = Date.now();
    const { batchId, counts } = await stage(eventId, ["employee_id", "full_name", "department"], body);
    expect(counts.createCount).toBe(5000);
    await commitImportBatch(database, batchId, { skipInvalidRows: false });
    const elapsed = Date.now() - started;
    expect(await database.participant.count({ where: { eventId } })).toBe(5000);
    expect(elapsed).toBeLessThan(60_000);
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  }, 120_000);
});
