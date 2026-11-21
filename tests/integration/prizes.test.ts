import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { suggestPrizeMapping } from "@/modules/imports/domain/mapping";
import type { RawRow } from "@/modules/imports/domain/rows";
import {
  ImportError,
  appendImportRows,
  attachImportPhoto,
  commitImportBatch,
  createImportBatch,
  importIssuesCsv,
  listImportRows,
  revertImportBatch,
  validateImportBatch,
} from "@/modules/imports/server/imports";
import { mediaCacheTag } from "@/modules/media/server/photo-store";
import { CategoryError, createCategory, deleteCategory, listCategories, moveCategory, updateCategory } from "@/modules/prizes/server/categories";
import { PrizeError, createPrize, deletePrize, listPrizes, movePrize, replacePrizePhoto, setPrizeStatus, updatePrize } from "@/modules/prizes/server/prizes";
import { pngHeader } from "../fixtures/images";
import { testDb } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

async function newEvent() {
  const event = await database.event.create({ data: { slug: `prizes-${randomUUID().slice(0, 8)}`, name: "Prize test" } });
  return event.id;
}

function recordingPurger() {
  const calls: string[][] = [];
  return { calls, purge: async (tags: string[]) => void calls.push(tags) };
}

const prize = (code: string, extra: Partial<{ name: string; quantity: unknown; categoryId: string | null; description: string }> = {}) => ({
  code,
  name: extra.name ?? `Prize ${code}`,
  description: extra.description ?? "",
  quantity: extra.quantity ?? "1",
  categoryId: extra.categoryId ?? null,
});

async function freeze(eventId: string) {
  await database.rafflePreparation.create({
    data: { eventId, version: 1, status: "FROZEN", algorithmVersion: "pcascade-select-v1", participantsSha256: new Uint8Array(randomBytes(32)), rulesSha256: new Uint8Array(randomBytes(32)), seedCommitment: new Uint8Array(randomBytes(32)) },
  });
}

describe("prize categories", () => {
  it("creates categories in order with unique slugs and case-insensitive unique names", async () => {
    const eventId = await newEvent();
    const minor = await createCategory(database, eventId, { name: "Minor Prizes", description: null, sceneKey: "brick-by-brick" });
    const grand = await createCategory(database, eventId, { name: "Grand Prize", description: "The big one", sceneKey: "grand-finale" });
    expect([minor.sortOrder, grand.sortOrder]).toEqual([1, 2]);
    expect(minor.slug).toBe("minor-prizes");
    await expect(createCategory(database, eventId, { name: "minor prizes", description: null, sceneKey: "big-lift" })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    const renamed = await updateCategory(database, eventId, grand.id, { name: "Minor-Prizes!", description: null, sceneKey: "grand-finale" });
    expect(renamed.slug).toBe("minor-prizes-2");
    await expect(updateCategory(database, eventId, grand.id, { name: "MINOR PRIZES", description: null, sceneKey: "grand-finale" })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "prize_category.updated", entityId: grand.id } });
    expect(JSON.parse(audit.payload).changes).toMatchObject({ name: { from: "Grand Prize", to: "Minor-Prizes!" }, description: { from: "The big one", to: null } });
  });

  it("reorders categories and refuses to delete one that still has prizes", async () => {
    const eventId = await newEvent();
    const first = await createCategory(database, eventId, { name: "First", description: null, sceneKey: "brick-by-brick" });
    const second = await createCategory(database, eventId, { name: "Second", description: null, sceneKey: "build-it-up" });
    expect(await moveCategory(database, eventId, second.id, "up")).toBe(true);
    expect(await moveCategory(database, eventId, second.id, "up")).toBe(false);
    expect((await listCategories(database, eventId)).map((category) => category.name)).toEqual(["Second", "First"]);

    await createPrize(database, eventId, prize("P-1", { categoryId: first.id }));
    await expect(deleteCategory(database, eventId, first.id)).rejects.toMatchObject({ code: "HAS_PRIZES" });
    await deleteCategory(database, eventId, second.id);
    expect((await listCategories(database, eventId)).map((category) => [category.name, category.sortOrder])).toEqual([["First", 1]]);
    await expect(deleteCategory(database, eventId, second.id)).rejects.toBeInstanceOf(CategoryError);
  });

  it("enforces the four scene keys in the database", async () => {
    const eventId = await newEvent();
    await expect(database.prizeCategory.create({ data: { eventId, name: "Bad", slug: "bad", sceneKey: "explosions", sortOrder: 1 } })).rejects.toThrow();
  });
});

describe("prizes", () => {
  it("appends prizes in draw order and refuses duplicate codes regardless of case", async () => {
    const eventId = await newEvent();
    const a = await createPrize(database, eventId, prize("TV-01", { quantity: 2 }));
    const b = await createPrize(database, eventId, prize("BIKE"));
    expect([a.drawOrder, b.drawOrder, a.quantity]).toEqual([1, 2, 2]);
    await expect(createPrize(database, eventId, prize("tv-01"))).rejects.toMatchObject({ code: "DUPLICATE_CODE" });
    await expect(updatePrize(database, eventId, b.id, prize("Tv-01"))).rejects.toMatchObject({ code: "DUPLICATE_CODE" });
    await expect(database.prize.create({ data: { eventId, code: "tv-01", name: "Bypass", quantity: 1, drawOrder: 9 } })).rejects.toThrow();
  });

  it("validates code, name, quantity and category", async () => {
    const eventId = await newEvent();
    const other = await newEvent();
    const foreign = await createCategory(database, other, { name: "Elsewhere", description: null, sceneKey: "big-lift" });
    const error = await createPrize(database, eventId, { code: "bad code!", name: "  ", description: "", quantity: "0", categoryId: foreign.id }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrizeError);
    expect(Object.keys((error as PrizeError).fieldErrors).sort()).toEqual(["categoryId", "code", "name", "quantity"]);
    await expect(createPrize(database, eventId, prize("Q", { quantity: "1001" }))).rejects.toMatchObject({ code: "INVALID" });
    await expect(createPrize(database, eventId, prize("Q", { quantity: "2.5" }))).rejects.toMatchObject({ code: "INVALID" });
    await expect(database.prize.create({ data: { eventId, code: "-bad", name: "x", quantity: 1, drawOrder: 1 } })).rejects.toThrow();
    await expect(database.prize.create({ data: { eventId, code: "OK", name: "x", quantity: 5000, drawOrder: 1 } })).rejects.toThrow();
  });

  it("records what changed, withdraws and restores, and reorders", async () => {
    const eventId = await newEvent();
    const category = await createCategory(database, eventId, { name: "Major", description: null, sceneKey: "big-lift" });
    const a = await createPrize(database, eventId, prize("A"));
    const b = await createPrize(database, eventId, prize("B"));
    const c = await createPrize(database, eventId, prize("C"));
    await updatePrize(database, eventId, a.id, prize("A", { name: "Laptop", quantity: "3", categoryId: category.id }));
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "prize.updated", entityId: a.id } });
    expect(JSON.parse(audit.payload).changes).toEqual({ name: { from: "Prize A", to: "Laptop" }, quantity: { from: 1, to: 3 }, categoryId: { from: null, to: category.id } });

    await setPrizeStatus(database, eventId, b.id, "WITHDRAWN");
    await setPrizeStatus(database, eventId, b.id, "WITHDRAWN");
    expect(await database.auditLog.count({ where: { action: "prize.status_changed", entityId: b.id } })).toBe(1);

    await movePrize(database, eventId, c.id, "up");
    await movePrize(database, eventId, c.id, "up");
    expect(await movePrize(database, eventId, c.id, "up")).toBe(false);
    expect((await listPrizes(database, eventId)).map((row) => [row.code, row.drawOrder])).toEqual([
      ["C", 1],
      ["A", 2],
      ["B", 3],
    ]);
  });

  it("deletes a prize with its photo, closes the gap in draw order, and refuses once drawn", async () => {
    const eventId = await newEvent();
    const a = await createPrize(database, eventId, prize("A"));
    const b = await createPrize(database, eventId, prize("B"));
    await createPrize(database, eventId, prize("C"));
    const purger = recordingPurger();
    const photo = await replacePrizePhoto(database, eventId, b.id, pngHeader(800, 600), purger.purge);
    const replacement = await replacePrizePhoto(database, eventId, b.id, pngHeader(900, 600), purger.purge);
    expect(purger.calls).toEqual([[mediaCacheTag(photo?.id ?? "")]]);
    expect(await database.mediaAsset.count({ where: { id: photo?.id } })).toBe(0);
    expect(await database.mediaAsset.findUniqueOrThrow({ where: { id: replacement?.id } })).toMatchObject({ kind: "PRIZE_PHOTO", width: 900 });

    await deletePrize(database, eventId, b.id, purger.purge);
    expect(purger.calls.at(-1)).toEqual([mediaCacheTag(replacement?.id ?? "")]);
    expect(await database.mediaAsset.count({ where: { id: replacement?.id } })).toBe(0);
    expect((await listPrizes(database, eventId)).map((row) => [row.code, row.drawOrder])).toEqual([
      ["A", 1],
      ["C", 2],
    ]);

    const preparation = await database.rafflePreparation.create({ data: { eventId, version: 1, status: "CANCELLED", algorithmVersion: "pcascade-select-v1" } });
    await database.draw.create({ data: { preparationId: preparation.id, prizeId: a.id, slotNumber: 1, sequence: 1, idempotencyKey: randomUUID(), status: "VOIDED" } });
    await expect(deletePrize(database, eventId, a.id, purger.purge)).rejects.toMatchObject({ code: "HAS_DRAWS" });
  });

  it("refuses every prize and category change once a raffle is frozen", async () => {
    const eventId = await newEvent();
    const category = await createCategory(database, eventId, { name: "Locked", description: null, sceneKey: "build-it-up" });
    const existing = await createPrize(database, eventId, prize("LOCK"));
    await freeze(eventId);
    const { purge } = recordingPurger();
    const attempts = [
      createCategory(database, eventId, { name: "Late", description: null, sceneKey: "big-lift" }),
      updateCategory(database, eventId, category.id, { name: "Renamed", description: null, sceneKey: "big-lift" }),
      moveCategory(database, eventId, category.id, "down"),
      deleteCategory(database, eventId, category.id),
      createPrize(database, eventId, prize("LATE")),
      updatePrize(database, eventId, existing.id, prize("LOCK", { name: "Changed" })),
      setPrizeStatus(database, eventId, existing.id, "WITHDRAWN"),
      movePrize(database, eventId, existing.id, "down"),
      deletePrize(database, eventId, existing.id, purge),
      replacePrizePhoto(database, eventId, existing.id, pngHeader(300, 300), purge),
    ];
    for (const outcome of await Promise.allSettled(attempts)) {
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" ? outcome.reason : null).toMatchObject({ code: "ROSTER_LOCKED" });
    }
    expect(await database.mediaAsset.count({ where: { eventId } })).toBe(0);
    expect(await database.prize.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ name: "Prize LOCK", status: "AVAILABLE" });
  });

  it("keeps draw order consistent when prizes are created concurrently", async () => {
    const eventId = await newEvent();
    await Promise.all(Array.from({ length: 8 }, (_, index) => createPrize(database, eventId, prize(`C-${index}`))));
    expect((await listPrizes(database, eventId)).map((row) => row.drawOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });
});

const PRIZE_HEADERS = ["Prize Code", "Prize", "Winners", "Category", "Photo"];

async function stagePrizes(eventId: string, headers: string[], body: (string | number | null)[][], options: { duplicateMode?: "SKIP" | "UPDATE" | "REJECT"; photosProvided?: boolean } = {}) {
  const batch = await createImportBatch(database, eventId, {
    kind: "PRIZES",
    fileName: "prizes.xlsx",
    fileSha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    sheetName: "Prizes",
    mapping: suggestPrizeMapping(headers),
    duplicateMode: options.duplicateMode ?? "REJECT",
    photoRule: { match: "COLUMN", required: false },
    photosProvided: options.photosProvided ?? false,
  });
  const rows: RawRow[] = body.map((cells, index) => ({ rowNumber: index + 2, cells }));
  await appendImportRows(database, batch.id, rows);
  return { batchId: batch.id, counts: await validateImportBatch(database, batch.id) };
}

describe("prize import pipeline", () => {
  it("imports prizes with categories and photos, appended after existing prizes", async () => {
    const eventId = await newEvent();
    await createCategory(database, eventId, { name: "Minor", description: null, sceneKey: "brick-by-brick" });
    const grand = await createCategory(database, eventId, { name: "Grand Prize", description: null, sceneKey: "grand-finale" });
    await createPrize(database, eventId, prize("EXISTING"));
    expect(suggestPrizeMapping(PRIZE_HEADERS)).toEqual(["code", "name", "quantity", "category", "photoFilename"]);

    const { batchId, counts } = await stagePrizes(
      eventId,
      PRIZE_HEADERS,
      [
        ["GC-01", "Gift card", 10, "minor", null],
        ["CAR", "Brand-new car", "1", "grand-prize", "car.png"],
        ["BAD", "Unknown tier", 1, "Platinum", null],
        ["ZERO", "No winners", 0, null, null],
      ],
      { photosProvided: true },
    );
    expect(counts).toMatchObject({ createCount: 2, invalidCount: 2 });
    const invalid = await listImportRows(database, batchId, { filter: "invalid", page: 1 });
    expect(invalid.rows.map((row) => row.errors.map((issue) => issue.code))).toEqual([["UNKNOWN_CATEGORY"], ["INVALID_VALUE"]]);
    expect(invalid.rows[0]?.errors[0]?.message).toContain("Minor, Grand Prize");

    await attachImportPhoto(database, batchId, 3, pngHeader(1200, 800), "car.png");
    await validateImportBatch(database, batchId);
    await commitImportBatch(database, batchId, { skipInvalidRows: true });

    const prizes = await database.prize.findMany({ where: { eventId }, orderBy: { drawOrder: "asc" }, include: { photo: true } });
    expect(prizes.map((row) => [row.code, row.drawOrder, row.quantity])).toEqual([
      ["EXISTING", 1, 1],
      ["GC-01", 2, 10],
      ["CAR", 3, 1],
    ]);
    expect(prizes[2]).toMatchObject({ categoryId: grand.id, photo: { kind: "PRIZE_PHOTO", status: "ACTIVE" } });
    const rows = await database.importRow.findMany({ where: { batchId, action: "CREATE" }, select: { prizeId: true, participantId: true } });
    expect(rows.every((row) => row.prizeId && !row.participantId)).toBe(true);
    expect((await importIssuesCsv(database, eventId, batchId))?.split("\r\n")[0]).toBe("﻿row,prize_code,outcome,severity,field,problem");
  });

  it("updates only the columns present in the file and reverts to the previous values", async () => {
    const eventId = await newEvent();
    const tier = await createCategory(database, eventId, { name: "Tier", description: null, sceneKey: "big-lift" });
    const original = await createPrize(database, eventId, { code: "TV", name: "Television", description: "55 inch", quantity: "2", categoryId: tier.id });

    const { batchId, counts } = await stagePrizes(eventId, ["code", "name"], [["tv", "Smart TV"], ["NEW", "Speaker"]], { duplicateMode: "UPDATE" });
    expect(counts).toMatchObject({ updateCount: 1, createCount: 1 });
    await commitImportBatch(database, batchId, { skipInvalidRows: false });
    expect(await database.prize.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ code: "tv", name: "Smart TV", description: "55 inch", quantity: 2, categoryId: tier.id });

    expect(await revertImportBatch(database, batchId)).toMatchObject({ removed: 1, restored: 1 });
    expect(await database.prize.findMany({ where: { eventId }, select: { code: true, name: true, drawOrder: true } })).toEqual([{ code: "TV", name: "Television", drawOrder: 1 }]);
  });

  it("refuses to revert a prize import after the prizes were edited or re-categorised", async () => {
    const eventId = await newEvent();
    const { batchId } = await stagePrizes(eventId, ["code", "name"], [["P1", "One"]]);
    await commitImportBatch(database, batchId, { skipInvalidRows: false });
    const created = await database.prize.findFirstOrThrow({ where: { eventId, code: "P1" } });
    await updatePrize(database, eventId, created.id, prize("P1", { name: "Edited" }));
    const conflict = await revertImportBatch(database, batchId).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ImportError);
    expect((conflict as ImportError).details[0]).toMatch(/prize was edited/);
  });

  it("flags repeated codes inside the file and refuses existing codes in reject mode", async () => {
    const eventId = await newEvent();
    await createPrize(database, eventId, prize("TAKEN"));
    const { counts } = await stagePrizes(eventId, ["code", "name"], [["DUP", "One"], ["dup", "Two"], ["taken", "Three"], ["FINE", "Four"]]);
    expect(counts).toMatchObject({ invalidCount: 3, createCount: 1 });
  });

  it("does not commit a prize import once the raffle is frozen", async () => {
    const eventId = await newEvent();
    const { batchId } = await stagePrizes(eventId, ["code", "name"], [["LATE", "Too late"]]);
    await freeze(eventId);
    await expect(commitImportBatch(database, batchId, { skipInvalidRows: false })).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
    expect(await database.prize.count({ where: { eventId } })).toBe(0);
  });
});
