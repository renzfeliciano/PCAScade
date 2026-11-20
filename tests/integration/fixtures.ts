import { randomBytes, randomUUID } from "node:crypto";
import { createDb, type Db } from "@/lib/db";
import { roundTime, verifyQuicknetRound } from "@/modules/beacon/drand";
import { rosterDigest, seedCommitment } from "@/modules/raffle/domain/roster";
import { BEACON_LEAD_ROUNDS } from "@/modules/raffle/server/draw";
import { DRAND_FIXTURE_ROUND } from "../fixtures/drand";

export function testDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is missing");
  return createDb(url);
}

export const fixtureBeacon = verifyQuicknetRound(
  DRAND_FIXTURE_ROUND.round,
  DRAND_FIXTURE_ROUND.signature,
  DRAND_FIXTURE_ROUND.randomness,
);

export const requestTimeForFixtureRound = roundTime(fixtureBeacon.round - BEACON_LEAD_ROUNDS);

export type RaffleFixture = {
  eventId: string;
  preparationId: string;
  prizeId: string;
  participantIds: string[];
  eligibleIds: string[];
  serverSeed: Uint8Array;
};

export async function createRaffleFixture(
  database: Db,
  options: {
    participants: number;
    quantity: number;
    ineligible?: number;
    repeatWinners?: "never" | "allowed";
    eventStatus?: "DRAFT" | "PUBLISHED";
  },
): Promise<RaffleFixture> {
  const suffix = randomUUID().slice(0, 8);
  const event = await database.event.create({
    data: { slug: `test-${suffix}`, name: `Test event ${suffix}`, status: options.eventStatus ?? "PUBLISHED" },
  });
  const participantIds: string[] = [];
  const eligibleIds: string[] = [];
  for (let index = 0; index < options.participants; index++) {
    const eligible = index >= (options.ineligible ?? 0);
    const participant = await database.participant.create({
      data: {
        eventId: event.id,
        externalId: `EMP-${String(index + 1).padStart(4, "0")}`,
        fullName: `Participant ${index + 1}`,
        eligible,
      },
    });
    participantIds.push(participant.id);
    if (eligible) eligibleIds.push(participant.id);
  }
  const prize = await database.prize.create({
    data: { eventId: event.id, code: `PRZ-${suffix}`, name: "Test prize", quantity: options.quantity, drawOrder: 1 },
  });
  const serverSeed = new Uint8Array(randomBytes(32));
  const preparation = await database.rafflePreparation.create({
    data: {
      eventId: event.id,
      version: 1,
      status: "FROZEN",
      rules: { repeatWinners: options.repeatWinners ?? "never" },
      participantsSha256: new Uint8Array(rosterDigest(eligibleIds)),
      prizesSha256: new Uint8Array(randomBytes(32)),
      rulesSha256: new Uint8Array(randomBytes(32)),
      seedCommitment: new Uint8Array(seedCommitment(serverSeed)),
      algorithmVersion: "pcascade-select-v1",
      frozenAt: new Date(),
    },
  });
  return { eventId: event.id, preparationId: preparation.id, prizeId: prize.id, participantIds, eligibleIds, serverSeed };
}

export async function addPrize(database: Db, eventId: string, quantity: number): Promise<string> {
  const prize = await database.prize.create({
    data: { eventId, code: `PRZ-${randomUUID().slice(0, 8)}`, name: "Extra prize", quantity, drawOrder: 2 },
  });
  return prize.id;
}
