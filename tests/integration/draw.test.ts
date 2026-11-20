import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BeaconUnavailableError, QUICKNET, roundTime } from "@/modules/beacon/drand";
import { rosterDigest } from "@/modules/raffle/domain/roster";
import { candidateListDigest, deriveSelectionKey, selectIndex, sortCandidates } from "@/modules/raffle/domain/select";
import { type CommittedDraw, DrawError, completeDraw, requestDraw } from "@/modules/raffle/server/draw";
import { runDraw } from "@/modules/raffle/server/run-draw";
import { DRAND_FIXTURE_ROUND } from "../fixtures/drand";
import { addPrize, createRaffleFixture, fixtureBeacon, requestTimeForFixtureRound, testDb, type RaffleFixture } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

function request(fixture: RaffleFixture, idempotencyKey = randomUUID(), prizeId = fixture.prizeId) {
  return requestDraw(database, { preparationId: fixture.preparationId, prizeId, idempotencyKey, now: requestTimeForFixtureRound });
}

function complete(fixture: RaffleFixture, drawId: string) {
  return completeDraw(database, { drawId, beacon: fixtureBeacon, serverSeed: fixture.serverSeed });
}

async function drawOnce(fixture: RaffleFixture, prizeId = fixture.prizeId): Promise<CommittedDraw> {
  const pending = await request(fixture, randomUUID(), prizeId);
  return complete(fixture, pending.drawId);
}

function codeOf(reason: unknown): string {
  return reason instanceof DrawError ? reason.code : `not a DrawError: ${String(reason)}`;
}

describe("requestDraw", () => {
  it("commits to a beacon round that is still in the future at request time", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const pending = await request(fixture);
    expect(pending.status).toBe("PENDING_BEACON");
    expect(pending.targetRound).toBe(fixtureBeacon.round);
    const stored = await database.draw.findUniqueOrThrow({ where: { id: pending.drawId }, include: { winner: true } });
    expect(stored.winner).toBeNull();
    expect(stored.beaconSignature).toBeNull();
  });

  it("lets exactly one of 50 racing requests reserve a draw; the rest are told a draw is in progress", async () => {
    const fixture = await createRaffleFixture(database, { participants: 100, quantity: 1 });
    const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => request(fixture)));
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const codes = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [codeOf(outcome.reason)] : []));
    expect(fulfilled).toHaveLength(1);
    expect(codes).toEqual(Array.from({ length: 49 }, () => "DRAW_IN_PROGRESS"));
    expect(await database.draw.count({ where: { preparationId: fixture.preparationId } })).toBe(1);

    const first = fulfilled[0];
    if (first?.status !== "fulfilled") throw new Error("unreachable");
    await complete(fixture, first.value.drawId);
    await expect(request(fixture)).rejects.toMatchObject({ code: "PRIZE_EXHAUSTED" });
    expect(await database.winner.count({ where: { preparationId: fixture.preparationId } })).toBe(1);
  });

  it("returns the same draw to 50 concurrent retries of one idempotency key", async () => {
    const fixture = await createRaffleFixture(database, { participants: 10, quantity: 3 });
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 50 }, () => request(fixture, key)));
    expect(new Set(results.map((result) => result.drawId)).size).toBe(1);
    expect(results.filter((result) => !result.replayed).length).toBeLessThanOrEqual(1);
    expect(await database.draw.count({ where: { preparationId: fixture.preparationId } })).toBe(1);
  });

  it("refuses to reuse an idempotency key for a different prize", async () => {
    const fixture = await createRaffleFixture(database, { participants: 10, quantity: 3 });
    const otherPrize = await addPrize(database, fixture.eventId, 1);
    const key = randomUUID();
    await request(fixture, key);
    await expect(request(fixture, key, otherPrize)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("refuses a roster that changed after the freeze", async () => {
    const fixture = await createRaffleFixture(database, { participants: 4, quantity: 1 });
    await database.participant.create({ data: { eventId: fixture.eventId, externalId: "LATE-1", fullName: "Late addition" } });
    await expect(request(fixture)).rejects.toMatchObject({ code: "ROSTER_CHANGED_SINCE_FREEZE" });
  });

  it("refuses preparations that are not frozen and prizes from other events", async () => {
    const cancelled = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    await database.rafflePreparation.update({ where: { id: cancelled.preparationId }, data: { status: "CANCELLED" } });
    await expect(request(cancelled)).rejects.toMatchObject({ code: "PREPARATION_NOT_ACTIVE" });

    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const other = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    await expect(request(fixture, randomUUID(), other.prizeId)).rejects.toMatchObject({ code: "PRIZE_NOT_FOUND" });
  });
});

describe("completeDraw", () => {
  it("accepts only the committed beacon round", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const pending = await requestDraw(database, {
      preparationId: fixture.preparationId,
      prizeId: fixture.prizeId,
      idempotencyKey: randomUUID(),
      now: requestTimeForFixtureRound + 3000,
    });
    expect(pending.targetRound).toBe(fixtureBeacon.round + 1n);
    await expect(complete(fixture, pending.drawId)).rejects.toMatchObject({ code: "BEACON_ROUND_MISMATCH" });
    expect((await database.draw.findUniqueOrThrow({ where: { id: pending.drawId } })).status).toBe("PENDING_BEACON");
  });

  it("rejects a beacon from another drand chain", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const pending = await request(fixture);
    await expect(
      completeDraw(database, { drawId: pending.drawId, beacon: { ...fixtureBeacon, chainHash: "00".repeat(32) }, serverSeed: fixture.serverSeed }),
    ).rejects.toMatchObject({ code: "BEACON_CHAIN_MISMATCH" });
    expect(QUICKNET.chainHash).toBe(fixtureBeacon.chainHash);
  });

  it("rejects a server seed that does not match the commitment made at freeze", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const pending = await request(fixture);
    await expect(
      completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed: new Uint8Array(randomBytes(32)) }),
    ).rejects.toMatchObject({ code: "SEED_COMMITMENT_MISMATCH" });
  });

  it("rejects completion if the roster changed between request and completion", async () => {
    const fixture = await createRaffleFixture(database, { participants: 5, quantity: 1 });
    const pending = await request(fixture);
    await database.participant.update({ where: { id: fixture.eligibleIds[0] }, data: { eligible: false } });
    await expect(complete(fixture, pending.drawId)).rejects.toMatchObject({ code: "ROSTER_CHANGED_SINCE_FREEZE" });
    expect(await database.winner.count({ where: { preparationId: fixture.preparationId } })).toBe(0);
  });

  it("commits exactly one winner when 50 completions race on the same pending draw", async () => {
    const fixture = await createRaffleFixture(database, { participants: 50, quantity: 1 });
    const pending = await request(fixture);
    const results = await Promise.all(Array.from({ length: 50 }, () => complete(fixture, pending.drawId)));
    expect(new Set(results.map((result) => result.participantId)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await database.winner.count({ where: { preparationId: fixture.preparationId } })).toBe(1);
  });

  it("only draws from participants that were eligible at freeze", async () => {
    const fixture = await createRaffleFixture(database, { participants: 4, quantity: 1, ineligible: 3 });
    const result = await drawOnce(fixture);
    expect(result.candidateCount).toBe(1);
    expect(result.participantId).toBe(fixture.eligibleIds[0]);
  });

  it("records the request and the committed result in the audit chain", async () => {
    const fixture = await createRaffleFixture(database, { participants: 6, quantity: 1 });
    const result = await drawOnce(fixture);
    const entries = await database.auditLog.findMany({ where: { entityType: "draw", entityId: result.drawId }, orderBy: { seq: "asc" } });
    expect(entries.map((entry) => entry.action)).toEqual(["draw.requested", "draw.committed"]);
    const committed = JSON.parse(entries[1]?.payload ?? "{}") as Record<string, unknown>;
    expect(committed).toMatchObject({ participantId: result.participantId, beaconRound: fixtureBeacon.round.toString(), selectedIndex: result.selectedIndex });
    expect(JSON.stringify(committed)).not.toContain(Buffer.from(fixture.serverSeed).toString("hex"));
  });

  it("fills every slot once without repeating a winner, then reports exhaustion and an empty pool", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 3, repeatWinners: "never" });
    const results: CommittedDraw[] = [];
    for (let index = 0; index < 3; index++) results.push(await drawOnce(fixture));
    expect(results.map((result) => result.slotNumber)).toEqual([1, 2, 3]);
    expect(results.map((result) => result.sequence)).toEqual([1, 2, 3]);
    expect(new Set(results.map((result) => result.participantId)).size).toBe(3);
    await expect(request(fixture)).rejects.toMatchObject({ code: "PRIZE_EXHAUSTED" });

    const secondPrize = await addPrize(database, fixture.eventId, 1);
    await expect(request(fixture, randomUUID(), secondPrize)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PARTICIPANTS" });
  });

  it("can be reproduced from the stored record plus the revealed seed", async () => {
    const fixture = await createRaffleFixture(database, { participants: 25, quantity: 2, ineligible: 5 });
    await drawOnce(fixture);
    const second = await drawOnce(fixture);

    const preparation = await database.rafflePreparation.findUniqueOrThrow({ where: { id: fixture.preparationId } });
    const draw = await database.draw.findUniqueOrThrow({ where: { id: second.drawId }, include: { winner: true } });
    const priorWinners = await database.winner.findMany({
      where: { preparationId: fixture.preparationId, draw: { sequence: { lt: draw.sequence } } },
      select: { participantId: true },
    });
    const excluded = new Set(priorWinners.map((winner) => winner.participantId));
    const candidates = sortCandidates(fixture.eligibleIds.filter((id) => !excluded.has(id)));

    expect(Buffer.from(rosterDigest(fixture.eligibleIds)).equals(Buffer.from(preparation.participantsSha256 ?? []))).toBe(true);
    expect(Buffer.from(candidateListDigest(candidates)).equals(Buffer.from(draw.candidateListSha256 ?? []))).toBe(true);

    const key = deriveSelectionKey({
      preparationId: preparation.id,
      participantsSha256: preparation.participantsSha256 ?? new Uint8Array(),
      rulesSha256: preparation.rulesSha256 ?? new Uint8Array(),
      drawSequence: draw.sequence,
      prizeId: draw.prizeId,
      slotNumber: draw.slotNumber,
      candidateListSha256: candidateListDigest(candidates),
      serverSeed: fixture.serverSeed,
      beaconRound: draw.beaconRound ?? 0n,
      beaconRandomness: fixtureBeacon.randomness,
    });
    const { index } = selectIndex(key, candidates.length);
    expect(index).toBe(draw.selectedIndex);
    expect(candidates[index]).toBe(draw.winner?.participantId);
  });

  it("rolls back completely when the commit fails mid-transaction", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const pending = await request(fixture);
    await database.$executeRaw`CREATE OR REPLACE FUNCTION pcascade_test_fail_winner() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`;
    await database.$executeRaw`CREATE TRIGGER pcascade_test_fail_winner BEFORE INSERT ON winner FOR EACH ROW EXECUTE FUNCTION pcascade_test_fail_winner()`;
    try {
      await expect(complete(fixture, pending.drawId)).rejects.toThrow(/injected failure/);
    } finally {
      await database.$executeRaw`DROP TRIGGER IF EXISTS pcascade_test_fail_winner ON winner`;
      await database.$executeRaw`DROP FUNCTION IF EXISTS pcascade_test_fail_winner()`;
    }
    const stored = await database.draw.findUniqueOrThrow({ where: { id: pending.drawId } });
    expect(stored.status).toBe("PENDING_BEACON");
    expect(stored.selectedIndex).toBeNull();
    expect(await database.winner.count({ where: { preparationId: fixture.preparationId } })).toBe(0);

    const recovered = await complete(fixture, pending.drawId);
    expect(recovered.status).toBe("COMMITTED");
  });
});

describe("runDraw", () => {
  const payload = { round: Number(fixtureBeacon.round), randomness: DRAND_FIXTURE_ROUND.randomness, signature: DRAND_FIXTURE_ROUND.signature };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("waits until the committed round is due, retries while it is not yet published, then commits", async () => {
    const fixture = await createRaffleFixture(database, { participants: 8, quantity: 1 });
    let clock = requestTimeForFixtureRound;
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "too early" }, 425))
      .mockResolvedValue(json(payload));

    const result = await runDraw(database, {
      preparationId: fixture.preparationId,
      prizeId: fixture.prizeId,
      idempotencyKey: randomUUID(),
      serverSeed: fixture.serverSeed,
      relays: ["https://relay.test"],
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    expect(result.status).toBe("COMMITTED");
    expect(result.targetRound).toBe(fixtureBeacon.round);
    expect(sleeps[0]).toBe(roundTime(fixtureBeacon.round) + 500 - requestTimeForFixtureRound);
    expect(sleeps).toHaveLength(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/public/${fixtureBeacon.round}`);
  });

  it("leaves the draw pending during a beacon outage and finishes it on retry with the same key", async () => {
    const fixture = await createRaffleFixture(database, { participants: 8, quantity: 1 });
    const key = randomUUID();
    const base = {
      preparationId: fixture.preparationId,
      prizeId: fixture.prizeId,
      idempotencyKey: key,
      serverSeed: fixture.serverSeed,
      relays: ["https://relay.test"],
      now: () => requestTimeForFixtureRound,
      sleep: async () => {},
      fetchAttempts: 2,
    };

    await expect(runDraw(database, { ...base, fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")) })).rejects.toBeInstanceOf(
      BeaconUnavailableError,
    );
    const stuck = await database.draw.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(stuck.status).toBe("PENDING_BEACON");
    expect(await database.winner.count({ where: { preparationId: fixture.preparationId } })).toBe(0);

    const resumed = await runDraw(database, { ...base, now: () => requestTimeForFixtureRound + 60_000, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json(payload)) });
    expect(resumed.drawId).toBe(stuck.id);
    expect(resumed.targetRound).toBe(fixtureBeacon.round);
    expect(await database.draw.count({ where: { preparationId: fixture.preparationId } })).toBe(1);
  });
});

describe("database backstops", () => {
  it("rejects a second pending draw for the same preparation", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 2 });
    await request(fixture);
    await expect(
      database.draw.create({
        data: { preparationId: fixture.preparationId, prizeId: fixture.prizeId, slotNumber: 2, sequence: 2, idempotencyKey: randomUUID(), status: "PENDING_BEACON", beaconRound: 1n },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a second active draw for the same slot", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 1 });
    const first = await drawOnce(fixture);
    await expect(
      database.draw.create({
        data: { preparationId: fixture.preparationId, prizeId: fixture.prizeId, slotNumber: first.slotNumber, sequence: 99, idempotencyKey: randomUUID(), status: "COMMITTED" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a second active win for the same participant", async () => {
    const fixture = await createRaffleFixture(database, { participants: 3, quantity: 2, repeatWinners: "never" });
    const first = await drawOnce(fixture);
    const spare = await database.draw.create({
      data: { preparationId: fixture.preparationId, prizeId: fixture.prizeId, slotNumber: 2, sequence: 50, idempotencyKey: randomUUID(), status: "COMMITTED" },
    });
    await expect(
      database.winner.create({
        data: { drawId: spare.id, preparationId: fixture.preparationId, participantId: first.participantId, exclusivityKey: first.participantId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
