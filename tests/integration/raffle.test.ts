import { randomUUID } from "node:crypto";
import { bytesToHex } from "@noble/hashes/utils.js";
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { roundTime } from "@/modules/beacon/drand";
import { bytesEqual, seedCommitment } from "@/modules/raffle/domain/roster";
import { parseParticipantsSnapshot, textDigest } from "@/modules/raffle/domain/snapshot";
import { verifyBundle } from "@/modules/raffle/domain/verify";
import { completeDraw, requestDraw } from "@/modules/raffle/server/draw";
import {
  cancelPreparation,
  completePreparation,
  createPreparation,
  freezePreparation,
  freshStart,
  resetDraw,
  updateDraft,
} from "@/modules/raffle/server/preparations";
import { buildBundle, consoleState } from "@/modules/raffle/server/queries";
import { decryptSeed } from "@/modules/raffle/server/seed-vault";
import { createPrize } from "@/modules/prizes/server/prizes";
import { createRaffleFixture, databaseRefusal, fixtureBeacon, requestTimeForFixtureRound, testDb, testSeedKey } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

async function seedEvent(db: Db, participants: { department?: string; eligible?: boolean }[], prizes: { quantity: number; categoryId?: string; departments?: string[] }[]) {
  const suffix = randomUUID().slice(0, 8);
  const event = await db.event.create({ data: { slug: `raffle-${suffix}`, name: `Raffle ${suffix}`, status: "PUBLISHED" } });
  const participantIds: string[] = [];
  for (const [index, participant] of participants.entries()) {
    const row = await db.participant.create({
      data: { eventId: event.id, externalId: `R-${index + 1}`, fullName: `Person ${index + 1}`, department: participant.department ?? null, eligible: participant.eligible ?? true },
    });
    participantIds.push(row.id);
  }
  const prizeIds: string[] = [];
  for (const [index, prize] of prizes.entries()) {
    const row = await db.prize.create({
      data: {
        eventId: event.id,
        code: `P${index + 1}-${suffix}`,
        name: `Prize ${index + 1}`,
        quantity: prize.quantity,
        drawOrder: index + 1,
        categoryId: prize.categoryId ?? null,
        eligibilityRule: { departments: prize.departments ?? [] },
      },
    });
    prizeIds.push(row.id);
  }
  return { eventId: event.id, participantIds, prizeIds };
}

async function frozenFrom(eventId: string, rules: Parameters<typeof createPreparation>[1]["rules"] = { repeatWinners: "never", voidedWinnerRedraw: "excluded" }) {
  const draft = await createPreparation(database, { eventId, rules, seedKey: testSeedKey });
  const result = await freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: bytesToHex(new Uint8Array(draft.manifestSha256 ?? [])) });
  expect(result).toEqual({ frozen: true });
  const seed = decryptSeed(testSeedKey, draft.id, new Uint8Array(draft.seedCiphertext ?? []));
  return { preparationId: draft.id, seed };
}

async function draw(preparationId: string, prizeId: string, seed: Uint8Array) {
  const pending = await requestDraw(database, { preparationId, prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
  return completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: seed });
}

async function category(eventId: string, name: string) {
  const row = await database.prizeCategory.create({ data: { eventId, name, slug: name.toLowerCase(), sceneKey: "big-lift", sortOrder: 1 } });
  return row.id;
}

describe("prepare and freeze", () => {
  it("seals canonical snapshots, encrypts the seed and allows only one open preparation per event", async () => {
    const { eventId, participantIds } = await seedEvent(database, [{ department: " IT " }, { department: "HR" }, { eligible: false }], [{ quantity: 2 }]);
    const draft = await createPreparation(database, { eventId, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" }, seedKey: testSeedKey });
    expect(draft.status).toBe("DRAFT");
    expect(draft.participantCount).toBe(2);
    expect(draft.slotCount).toBe(2);
    expect(bytesEqual(textDigest(draft.participantsJson ?? ""), new Uint8Array(draft.participantsSha256 ?? []))).toBe(true);
    const snapshot = parseParticipantsSnapshot(draft.participantsJson ?? "");
    expect(snapshot.participants.map((row) => row.id)).toEqual([...participantIds.slice(0, 2)].sort());
    expect(snapshot.participants.find((row) => row.id === participantIds[0])?.department).toBe("IT");
    expect(draft.participantsJson).not.toContain("Person 1");

    const seed = decryptSeed(testSeedKey, draft.id, new Uint8Array(draft.seedCiphertext ?? []));
    expect(bytesEqual(seedCommitment(seed), new Uint8Array(draft.seedCommitment ?? []))).toBe(true);
    expect(Buffer.from(draft.seedCiphertext ?? []).includes(Buffer.from(seed))).toBe(false);
    expect(() => decryptSeed(new Uint8Array(32).fill(7), draft.id, new Uint8Array(draft.seedCiphertext ?? []))).toThrow(/could not be decrypted/);

    await expect(createPreparation(database, { eventId, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" }, seedKey: testSeedKey })).rejects.toMatchObject({
      code: "OPEN_PREPARATION_EXISTS",
    });
  });

  it("refreshes a stale draft instead of freezing it, and freezes only the manifest the admin reviewed", async () => {
    const { eventId } = await seedEvent(database, [{}, {}], [{ quantity: 1 }]);
    const draft = await createPreparation(database, { eventId, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" }, seedKey: testSeedKey });
    const reviewed = bytesToHex(new Uint8Array(draft.manifestSha256 ?? []));
    await database.participant.create({ data: { eventId, externalId: "LATE", fullName: "Late entry" } });

    expect(await freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: reviewed })).toEqual({ frozen: false, reason: "DATA_CHANGED" });
    const refreshed = await database.rafflePreparation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(refreshed.participantCount).toBe(3);
    expect(refreshed.status).toBe("DRAFT");
    expect(await freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: reviewed })).toEqual({ frozen: false, reason: "MANIFEST_CHANGED" });

    const current = bytesToHex(new Uint8Array(refreshed.manifestSha256 ?? []));
    expect(await freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: current })).toEqual({ frozen: true });
    await expect(
      createPrize(database, eventId, { code: "AFTER", name: "After freeze", description: null, quantity: 1, categoryId: null }),
    ).rejects.toMatchObject({ code: "ROSTER_LOCKED" });
  });

  it("refuses to freeze without eligible participants or prizes", async () => {
    const { eventId } = await seedEvent(database, [{ eligible: false }], [{ quantity: 1 }]);
    const draft = await createPreparation(database, { eventId, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" }, seedKey: testSeedKey });
    await expect(freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: bytesToHex(new Uint8Array(draft.manifestSha256 ?? [])) })).rejects.toMatchObject({
      code: "NO_PARTICIPANTS",
    });
  });

  it("changes rules only while the preparation is a draft", async () => {
    const { eventId } = await seedEvent(database, [{}, {}], [{ quantity: 1 }]);
    const draft = await createPreparation(database, { eventId, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" }, seedKey: testSeedKey });
    const updated = await updateDraft(database, { preparationId: draft.id, rules: { repeatWinners: "allowed", voidedWinnerRedraw: "allowed" } });
    expect(updated.rulesJson).toContain('"repeatWinners":"allowed"');
    expect(Buffer.from(updated.rulesSha256 ?? []).equals(Buffer.from(draft.rulesSha256 ?? []))).toBe(false);
    await freezePreparation(database, { preparationId: draft.id, expectedManifestSha256: bytesToHex(new Uint8Array(updated.manifestSha256 ?? [])) });
    await expect(updateDraft(database, { preparationId: draft.id, rules: { repeatWinners: "never", voidedWinnerRedraw: "excluded" } })).rejects.toMatchObject({ code: "WRONG_STATUS" });
  });
});

describe("selection rules", () => {
  it("limits winners to the departments a prize allows", async () => {
    const { eventId, prizeIds } = await seedEvent(database, [{ department: "IT" }, { department: "HR" }, { department: "hr" }, { department: "IT" }], [{ quantity: 1, departments: ["HR"] }]);
    const { preparationId, seed } = await frozenFrom(eventId);
    const result = await draw(preparationId, prizeIds[0] ?? "", seed);
    expect(result.candidateCount).toBe(2);
    const winner = await database.participant.findUniqueOrThrow({ where: { id: result.participantId } });
    expect(winner.department?.toLowerCase()).toBe("hr");
  });

  it("lets a participant win again only in a different category under the once-per-category rule", async () => {
    const { eventId } = await seedEvent(database, [], []);
    const other = await category(eventId, "Major");
    const seeded = await database.participant.create({ data: { eventId, externalId: "ONLY", fullName: "Only one" } });
    const a = await database.prize.create({ data: { eventId, code: "A", name: "A", quantity: 1, drawOrder: 1 } });
    const b = await database.prize.create({ data: { eventId, code: "B", name: "B", quantity: 1, drawOrder: 2 } });
    const c = await database.prize.create({ data: { eventId, code: "C", name: "C", quantity: 1, drawOrder: 3, categoryId: other } });
    const { preparationId, seed } = await frozenFrom(eventId, { repeatWinners: "per_category", voidedWinnerRedraw: "excluded" });
    expect((await draw(preparationId, a.id, seed)).participantId).toBe(seeded.id);
    await expect(requestDraw(database, { preparationId, prizeId: b.id, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound })).rejects.toMatchObject({
      code: "NO_ELIGIBLE_PARTICIPANTS",
    });
    expect((await draw(preparationId, c.id, seed)).participantId).toBe(seeded.id);
  });

  it("refuses a request whose expected slot is no longer the next open one", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 2 });
    await expect(
      requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), slotNumber: 2, now: requestTimeForFixtureRound }),
    ).rejects.toMatchObject({ code: "STALE_REQUEST" });
  });
});

describe("reset current raffle item", () => {
  it("voids the winner with a recorded reason, reopens the slot and excludes the voided winner by default", async () => {
    const { eventId, prizeIds, participantIds } = await seedEvent(database, [{}, {}], [{ quantity: 1 }]);
    const prizeId = prizeIds[0] ?? "";
    const { preparationId, seed } = await frozenFrom(eventId);
    const first = await draw(preparationId, prizeId, seed);

    const reset = await resetDraw(database, { drawId: first.drawId, category: "WINNER_ABSENT", reason: "Not in the hall when called" });
    expect(reset.replayed).toBe(false);
    expect(reset.correction.afterSequence).toBe(1);
    const again = await resetDraw(database, { drawId: first.drawId, category: "OTHER", reason: "Second click" });
    expect(again).toMatchObject({ replayed: true, correction: { id: reset.correction.id, reasonText: "Not in the hall when called" } });

    const voided = await database.draw.findUniqueOrThrow({ where: { id: first.drawId }, include: { winner: true } });
    expect(voided.status).toBe("VOIDED");
    expect(voided.winner?.voidedAt).not.toBeNull();

    const redraw = await draw(preparationId, prizeId, seed);
    expect(redraw.slotNumber).toBe(1);
    expect(redraw.sequence).toBe(2);
    expect(redraw.candidateCount).toBe(1);
    expect(redraw.participantId).toBe(participantIds.find((id) => id !== first.participantId));

    const state = await consoleState(database, preparationId);
    expect(state[0]?.slots[0]).toMatchObject({ generation: 1, active: { drawId: redraw.drawId }, voided: [{ drawId: first.drawId, correction: { category: "WINNER_ABSENT" } }] });

    const resets = await database.auditLog.findMany({ where: { entityId: first.drawId, action: "draw.reset" } });
    expect(resets).toHaveLength(1);
  });

  it("keeps the voided winner in the pool when the rules allow it", async () => {
    const { eventId, prizeIds } = await seedEvent(database, [{}, {}], [{ quantity: 1 }]);
    const { preparationId, seed } = await frozenFrom(eventId, { repeatWinners: "never", voidedWinnerRedraw: "allowed" });
    const first = await draw(preparationId, prizeIds[0] ?? "", seed);
    await resetDraw(database, { drawId: first.drawId, category: "DATA_ERROR", reason: "Wrong spelling on the screen" });
    const redraw = await draw(preparationId, prizeIds[0] ?? "", seed);
    expect(redraw.candidateCount).toBe(2);
  });

  it("resets a stuck pending draw only after its beacon round is well overdue", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const pending = await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    const due = roundTime(pending.targetRound);
    await expect(resetDraw(database, { drawId: pending.drawId, category: "TECHNICAL_ISSUE", reason: "Beacon outage", now: due + 1000 })).rejects.toMatchObject({
      code: "DRAW_NOT_RESETTABLE",
    });
    const reset = await resetDraw(database, { drawId: pending.drawId, category: "TECHNICAL_ISSUE", reason: "Beacon outage", now: due + 61_000 });
    expect(reset.correction.winnerId).toBeNull();
    expect((await database.draw.findUniqueOrThrow({ where: { id: pending.drawId } })).status).toBe("VOIDED");
  });

  it("records exactly one correction when 20 resets of one draw race", async () => {
    const fixture = await createRaffleFixture(database, { participants: 4, quantity: 1 });
    const pending = await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    await completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: fixture.serverSeed });
    const results = await Promise.all(Array.from({ length: 20 }, () => resetDraw(database, { drawId: pending.drawId, category: "OTHER", reason: "Race test" })));
    expect(new Set(results.map((result) => result.correction.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await database.winnerCorrection.count({ where: { drawId: pending.drawId } })).toBe(1);
  });

  it("requires a reason", async () => {
    const fixture = await createRaffleFixture(database, { participants: 2, quantity: 1 });
    await expect(resetDraw(database, { drawId: randomUUID(), category: "OTHER", reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(fixture.preparationId).toBeTruthy();
  });
});

describe("closing a raffle", () => {
  it("completes, reveals the seed and produces a bundle that the verifier fully reproduces, resets included", async () => {
    const { eventId, prizeIds } = await seedEvent(database, [{ department: "IT" }, { department: "HR" }, { department: "IT" }, { department: "Ops" }, {}], [{ quantity: 2 }, { quantity: 1, departments: ["IT"] }]);
    const { preparationId, seed } = await frozenFrom(eventId);
    const first = await draw(preparationId, prizeIds[0] ?? "", seed);
    await draw(preparationId, prizeIds[0] ?? "", seed);
    await resetDraw(database, { drawId: first.drawId, category: "INELIGIBLE", reason: "Works for the organiser" });
    await draw(preparationId, prizeIds[0] ?? "", seed);
    await draw(preparationId, prizeIds[1] ?? "", seed);

    const pending = await requestDraw(database, { preparationId, prizeId: prizeIds[1] ?? "", idempotencyKey: randomUUID(), now: requestTimeForFixtureRound }).catch((error: unknown) => error);
    expect(pending).toMatchObject({ code: "PRIZE_EXHAUSTED" });

    await completePreparation(database, { preparationId, seedKey: testSeedKey });
    const closed = await database.rafflePreparation.findUniqueOrThrow({ where: { id: preparationId } });
    expect(closed.status).toBe("COMPLETED");
    expect(Buffer.from(closed.revealedSeed ?? []).equals(Buffer.from(seed))).toBe(true);

    const bundle = await buildBundle(database, preparationId);
    const report = verifyBundle(bundle);
    expect(report.complete).toBe(true);
    expect(report.draws).toHaveLength(4);
    expect(report.draws.every((entry) => entry.result.ok === true)).toBe(true);
    expect(bundle?.corrections).toHaveLength(1);

    await expect(createPrize(database, eventId, { code: "NEXT", name: "Next raffle", description: null, quantity: 1, categoryId: null })).resolves.toBeTruthy();
  });

  it("refuses to complete while a draw waits for its beacon", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    await expect(completePreparation(database, { preparationId: fixture.preparationId, seedKey: testSeedKey })).rejects.toMatchObject({ code: "DRAW_IN_PROGRESS" });
  });

  it("supersedes a drawing raffle with Fresh Start, keeps its record verifiable and opens a new draft once", async () => {
    const { eventId, prizeIds } = await seedEvent(database, [{}, {}, {}], [{ quantity: 2 }]);
    const { preparationId, seed } = await frozenFrom(eventId);
    await draw(preparationId, prizeIds[0] ?? "", seed);

    const successor = await freshStart(database, { preparationId, reason: "Wrong prize list was loaded", seedKey: testSeedKey });
    const repeat = await freshStart(database, { preparationId, reason: "Clicked twice", seedKey: testSeedKey });
    expect(repeat.id).toBe(successor.id);
    expect(successor).toMatchObject({ status: "DRAFT", version: 2 });

    const old = await database.rafflePreparation.findUniqueOrThrow({ where: { id: preparationId } });
    expect(old).toMatchObject({ status: "SUPERSEDED", statusReason: "Wrong prize list was loaded", supersededById: successor.id });
    expect(verifyBundle(await buildBundle(database, preparationId)).complete).toBe(true);
    await expect(createPrize(database, eventId, { code: "FIX", name: "Fixed prize", description: null, quantity: 1, categoryId: null })).resolves.toBeTruthy();
  });

  it("cancels a frozen raffle only before its first draw", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 2 });
    const pending = await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    await completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: fixture.serverSeed });
    await expect(cancelPreparation(database, { preparationId: fixture.preparationId, reason: "Changed my mind", seedKey: testSeedKey })).rejects.toMatchObject({
      code: "WRONG_STATUS",
    });

    const { eventId } = await seedEvent(database, [{}], [{ quantity: 1 }]);
    const { preparationId } = await frozenFrom(eventId);
    await cancelPreparation(database, { preparationId, reason: "Roster needs another department", seedKey: testSeedKey });
    const cancelled = await database.rafflePreparation.findUniqueOrThrow({ where: { id: preparationId } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.revealedSeed).not.toBeNull();
  });
});

describe("database backstops for the raffle record", () => {
  it("blocks rewriting frozen snapshots, illegal status moves, deletes and silent voids", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const pending = await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    const committed = await completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: fixture.serverSeed });

    expect(await databaseRefusal(database.rafflePreparation.update({ where: { id: fixture.preparationId }, data: { participantsJson: "{}" } }))).toMatch(/snapshots of a frozen preparation/);
    expect(await databaseRefusal(database.rafflePreparation.update({ where: { id: fixture.preparationId }, data: { status: "DRAFT" } }))).toMatch(/cannot go from DRAWING to DRAFT/);
    expect(await databaseRefusal(database.draw.update({ where: { id: committed.drawId }, data: { selectedIndex: 0 } }))).toMatch(/can only be voided/);
    expect(await databaseRefusal(database.draw.update({ where: { id: committed.drawId }, data: { status: "VOIDED" } }))).toMatch(/needs a recorded correction/);
    expect(await databaseRefusal(database.winner.updateMany({ where: { drawId: committed.drawId }, data: { voidedAt: new Date() } }))).toMatch(/needs a recorded correction/);
    expect(await databaseRefusal(database.draw.delete({ where: { id: committed.drawId } }))).toMatch(/cannot be deleted/);
    expect(await databaseRefusal(database.rafflePreparation.delete({ where: { id: fixture.preparationId } }))).toMatch(/cannot be deleted/);

    const { correction } = await resetDraw(database, { drawId: committed.drawId, category: "OTHER", reason: "Backstop test" });
    expect(await databaseRefusal(database.winnerCorrection.update({ where: { id: correction.id }, data: { reasonText: "Rewritten" } }))).toMatch(/append-only/);
    expect(await databaseRefusal(database.draw.update({ where: { id: committed.drawId }, data: { status: "COMMITTED" } }))).toMatch(/voided draw cannot change/);
  });

  it("keeps the audit chain intact through the whole lifecycle", async () => {
    const result = await verifyAuditChain(database);
    expect(result.ok).toBe(true);
  });
});
