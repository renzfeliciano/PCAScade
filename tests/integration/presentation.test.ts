import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { updatePublicDisplay } from "@/modules/events/server/events";
import { readPublicImageMeta, storeImage } from "@/modules/media/server/photo-store";
import { sceneDurationMs } from "@/modules/presentation/domain/timeline";
import { beginDraw, drawCommitted, drawWithdrawn, showScreen, startReveal } from "@/modules/presentation/server/cursor";
import { publicEventExtras, publicWinnerGallery } from "@/modules/presentation/server/public-pages";
import { presentationState } from "@/modules/presentation/server/state";
import { completeDraw, requestDraw } from "@/modules/raffle/server/draw";
import { freshStart, resetDraw } from "@/modules/raffle/server/preparations";
import { pngHeader } from "../fixtures/images";
import { createRaffleFixture, databaseRefusal, fixtureBeacon, requestTimeForFixtureRound, testDb, testSeedKey } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

async function drawOne(preparationId: string, prizeId: string, seed: Uint8Array) {
  const pending = await requestDraw(database, { preparationId, prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
  return completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: seed });
}

async function winnerName(participantId: string) {
  return (await database.participant.findUniqueOrThrow({ where: { id: participantId }, select: { fullName: true } })).fullName;
}

const REVEAL_MS = 5000 + sceneDurationMs("brick-by-brick");

describe("reveal gating", () => {
  it("keeps the winner out of every public payload until the reveal starts, then holds the public lists until the scene ends", async () => {
    const fixture = await createRaffleFixture(database, { participants: 6, quantity: 2 });
    const event = await database.event.findUniqueOrThrow({ where: { id: fixture.eventId } });

    const lobby = await presentationState(database, event.slug);
    expect(lobby?.screen).toBe("LOBBY");
    expect(lobby?.current).toBeNull();

    await beginDraw(database, { eventId: fixture.eventId, preparationId: fixture.preparationId, prizeId: fixture.prizeId });
    expect((await presentationState(database, event.slug))?.current).toMatchObject({ phase: "DRAWING", winner: null });

    const committed = await drawOne(fixture.preparationId, fixture.prizeId, fixture.serverSeed);
    const name = await winnerName(committed.participantId);
    expect(await drawCommitted(database, { eventId: fixture.eventId, prizeId: fixture.prizeId, drawId: committed.drawId })).toBe(true);

    const ready = await presentationState(database, event.slug);
    expect(ready?.current).toMatchObject({ phase: "READY", drawId: committed.drawId, slotNumber: 1, winner: null });
    expect(JSON.stringify(ready)).not.toContain(name);
    expect(JSON.stringify(await publicWinnerGallery(database))).not.toContain(name);

    const t0 = new Date();
    const first = await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: t0 });
    expect(first).toMatchObject({ replayed: false, firstReveal: true });
    expect(first.visibleAt.getTime()).toBe(t0.getTime() + REVEAL_MS);

    const revealing = await presentationState(database, event.slug, t0);
    expect(revealing?.current).toMatchObject({ phase: "REVEALING", countdownMs: 5000, sceneMs: sceneDurationMs("brick-by-brick"), phaseStartedAt: t0.getTime() });
    expect(revealing?.current?.winner?.name).toBe(name);
    expect(revealing?.prizes[0]?.winners).toEqual([]);
    expect(JSON.stringify(await publicWinnerGallery(database, t0))).not.toContain(name);

    const after = new Date(t0.getTime() + REVEAL_MS);
    const settled = await presentationState(database, event.slug, after);
    expect(settled?.prizes[0]?.winners.map((winner) => winner.person.name)).toEqual([name]);
    const gallery = await publicWinnerGallery(database, after);
    expect(gallery.find((entry) => entry.event.id === fixture.eventId)?.prizes[0]?.winners[0]?.person.name).toBe(name);

    const again = await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: new Date(t0.getTime() + 1000) });
    expect(again.replayed).toBe(true);
    expect(await database.drawReveal.count({ where: { drawId: committed.drawId } })).toBe(1);
    expect(await database.auditLog.count({ where: { action: "draw.revealed", entityId: committed.drawId } })).toBe(1);
    expect((await database.presentationCursor.findUniqueOrThrow({ where: { eventId: fixture.eventId } })).phaseStartedAt.getTime()).toBe(t0.getTime());

    await showScreen(database, { eventId: fixture.eventId, preparationId: fixture.preparationId, screen: "WINNER_WALL" });
    const replay = await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: new Date(t0.getTime() + 60_000) });
    expect(replay).toMatchObject({ replayed: false, firstReveal: false });
    expect(replay.visibleAt.getTime()).toBe(first.visibleAt.getTime());
    expect(await database.drawReveal.count({ where: { drawId: committed.drawId } })).toBe(1);
    expect((await verifyAuditChain(database)).ok).toBe(true);
  });

  it("withdraws a reset winner from the screen and every public list, and refuses to reveal it", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const event = await database.event.findUniqueOrThrow({ where: { id: fixture.eventId } });
    const committed = await drawOne(fixture.preparationId, fixture.prizeId, fixture.serverSeed);
    const name = await winnerName(committed.participantId);
    const t0 = new Date();
    await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: t0 });

    await resetDraw(database, { drawId: committed.drawId, category: "WINNER_ABSENT", reason: "Not in the hall" });
    const later = new Date(t0.getTime() + REVEAL_MS + 1000);
    const unguarded = await presentationState(database, event.slug, later);
    expect(unguarded?.current).toMatchObject({ phase: "IDLE", winner: null });
    expect(JSON.stringify(unguarded)).not.toContain(name);

    expect(await drawWithdrawn(database, committed.drawId)).toBe(true);
    const cursor = await database.presentationCursor.findUniqueOrThrow({ where: { eventId: fixture.eventId } });
    expect(cursor).toMatchObject({ phase: "IDLE", drawId: null, screen: "DRAW", prizeId: fixture.prizeId });
    expect(JSON.stringify(await publicWinnerGallery(database, later))).not.toContain(name);
    await expect(startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId })).rejects.toMatchObject({ code: "NOT_REVEALABLE" });
  });

  it("refuses reveals and screens that belong to another event", async () => {
    const one = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const two = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const committed = await drawOne(one.preparationId, one.prizeId, one.serverSeed);
    await expect(startReveal(database, { eventId: two.eventId, drawId: committed.drawId })).rejects.toMatchObject({ code: "WRONG_EVENT" });
    await expect(showScreen(database, { eventId: two.eventId, screen: "DRAW", prizeId: one.prizeId })).rejects.toMatchObject({ code: "WRONG_EVENT" });
    await expect(showScreen(database, { eventId: two.eventId, screen: "DRAW" })).rejects.toMatchObject({ code: "PRIZE_REQUIRED" });
    expect(await database.drawReveal.count({ where: { drawId: committed.drawId } })).toBe(0);
  });

  it("returns nothing for a draft event", async () => {
    const fixture = await createRaffleFixture(database, { participants: 2, quantity: 1, eventStatus: "DRAFT" });
    const event = await database.event.findUniqueOrThrow({ where: { id: fixture.eventId } });
    expect(await presentationState(database, event.slug)).toBeNull();
    expect(await presentationState(database, fixture.eventId)).toBeNull();
  });
});

describe("database backstops", () => {
  it("accepts reveals of committed draws only and keeps them append-only", async () => {
    const fixture = await createRaffleFixture(database, { participants: 4, quantity: 2 });
    const pending = await requestDraw(database, { preparationId: fixture.preparationId, prizeId: fixture.prizeId, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
    const at = { revealedAt: new Date("2026-01-01T00:00:00Z"), visibleAt: new Date("2026-01-01T00:00:10Z") };
    const refused = /only a committed draw of this preparation can be revealed/;
    expect(await databaseRefusal(database.drawReveal.create({ data: { drawId: pending.drawId, preparationId: fixture.preparationId, ...at } }))).toMatch(refused);
    const committed = await completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: fixture.serverSeed });
    const other = await createRaffleFixture(database, { participants: 2, quantity: 1 });
    expect(await databaseRefusal(database.drawReveal.create({ data: { drawId: committed.drawId, preparationId: other.preparationId, ...at } }))).toMatch(refused);
    expect(
      await databaseRefusal(database.drawReveal.create({ data: { drawId: committed.drawId, preparationId: fixture.preparationId, revealedAt: at.visibleAt, visibleAt: at.revealedAt } })),
    ).toMatch(/draw_reveal_visible_after_reveal/);
    await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId });
    expect(await databaseRefusal(database.drawReveal.update({ where: { drawId: committed.drawId }, data: { visibleAt: new Date("2030-01-01T00:00:00Z") } }))).toMatch(/draw_reveal rows are append-only/);
    expect(await databaseRefusal(database.drawReveal.delete({ where: { drawId: committed.drawId } }))).toMatch(/draw_reveal rows are append-only/);
    expect(await databaseRefusal(database.presentationCursor.update({ where: { eventId: fixture.eventId }, data: { screen: "LOBBY" } }))).toMatch(
      /presentation_cursor_phase_needs_draw_screen/,
    );
  });
});

describe("what the public sees", () => {
  it("applies the event's display settings and hides participant photos when photos are off", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1, departments: ["Finance"] });
    const event = await database.event.findUniqueOrThrow({ where: { id: fixture.eventId } });
    const photo = await storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes: pngHeader(10, 10) });
    const participantId = fixture.participantIds[0] ?? "";
    await database.participant.update({ where: { id: participantId }, data: { photoId: photo.id, jobTitle: "Site engineer", bio: "Builds bridges", email: "private@example.com" } });
    const committed = await drawOne(fixture.preparationId, fixture.prizeId, fixture.serverSeed);
    const t0 = new Date();
    await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: t0 });

    const shown = await presentationState(database, event.slug, t0);
    expect(shown?.current?.winner).toEqual({ name: "Participant 1", department: "Finance", jobTitle: "Site engineer", bio: null, photoUrl: `/api/media/${photo.id}` });
    expect(JSON.stringify(shown)).not.toContain("EMP-0001");
    expect(JSON.stringify(shown)).not.toContain("private@example.com");
    expect(await readPublicImageMeta(database, photo.id)).not.toBeNull();

    const purged: string[][] = [];
    await updatePublicDisplay(database, fixture.eventId, { department: false, jobTitle: false, bio: true, photo: false }, { countdownSeconds: 3 }, async (tags) => {
      purged.push(tags);
    });
    expect(purged).toHaveLength(1);
    const hidden = await presentationState(database, event.slug, t0);
    expect(hidden?.current?.winner).toEqual({ name: "Participant 1", department: null, jobTitle: null, bio: "Builds bridges", photoUrl: null });
    expect(await readPublicImageMeta(database, photo.id)).toBeNull();
    const extras = await publicEventExtras(database, fixture.eventId, new Date(t0.getTime() + REVEAL_MS));
    expect(extras?.winners.prizes[0]?.winners[0]?.person).toEqual({ name: "Participant 1", department: null, jobTitle: null, bio: null, photoUrl: null });
    expect(await database.auditLog.count({ where: { action: "event.display_changed", entityId: fixture.eventId } })).toBe(1);
  });

  it("uses the event countdown setting for new reveals", async () => {
    const fixture = await createRaffleFixture(database, { participants: 2, quantity: 1 });
    await updatePublicDisplay(database, fixture.eventId, { department: true, jobTitle: true, bio: false, photo: true }, { countdownSeconds: 0 }, async () => {});
    const committed = await drawOne(fixture.preparationId, fixture.prizeId, fixture.serverSeed);
    const t0 = new Date();
    const result = await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: t0 });
    expect(result.visibleAt.getTime()).toBe(t0.getTime() + sceneDurationMs("brick-by-brick"));
    expect(await database.presentationCursor.findUniqueOrThrow({ where: { eventId: fixture.eventId } })).toMatchObject({ countdownMs: 0 });
  });

  it("shows only the active raffle's winners after a Fresh Start", async () => {
    const fixture = await createRaffleFixture(database, { participants: 4, quantity: 2 });
    const event = await database.event.findUniqueOrThrow({ where: { id: fixture.eventId } });
    const committed = await drawOne(fixture.preparationId, fixture.prizeId, fixture.serverSeed);
    const name = await winnerName(committed.participantId);
    const t0 = new Date(Date.now() - REVEAL_MS - 1000);
    await startReveal(database, { eventId: fixture.eventId, drawId: committed.drawId, now: t0 });
    expect(JSON.stringify(await publicWinnerGallery(database))).toContain(name);

    await freshStart(database, { preparationId: fixture.preparationId, reason: "Wrong prize list loaded", seedKey: testSeedKey });
    const state = await presentationState(database, event.slug);
    expect(state?.raffle).toBeNull();
    expect(state?.current).toMatchObject({ phase: "IDLE", winner: null });
    expect(JSON.stringify(state)).not.toContain(name);
    expect(JSON.stringify(await publicWinnerGallery(database))).not.toContain(name);
  });
});
