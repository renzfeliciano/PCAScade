import { randomBytes, randomUUID } from "node:crypto";
import { createDb, type Db } from "@/lib/db";
import { roundTime, verifyQuicknetRound } from "@/modules/beacon/drand";
import { seedCommitment } from "@/modules/raffle/domain/roster";
import { SELECT_ALGORITHM_VERSION } from "@/modules/raffle/domain/select";
import { type RaffleRules, manifest, raffleRulesSchema } from "@/modules/raffle/domain/snapshot";
import { BEACON_LEAD_ROUNDS } from "@/modules/raffle/server/draw";
import { liveSnapshots } from "@/modules/raffle/server/live-snapshot";
import { encryptSeed } from "@/modules/raffle/server/seed-vault";
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

export const testSeedKey = new Uint8Array(randomBytes(32));

export type RaffleFixture = {
  eventId: string;
  preparationId: string;
  prizeId: string;
  participantIds: string[];
  eligibleIds: string[];
  serverSeed: Uint8Array;
};

export async function sealFrozenPreparation(database: Db, eventId: string, rules: Partial<RaffleRules> = {}, version = 1) {
  const parsedRules = raffleRulesSchema.parse(rules);
  const serverSeed = new Uint8Array(randomBytes(32));
  const commitment = seedCommitment(serverSeed);
  const live = await liveSnapshots(database, eventId, parsedRules);
  const id = randomUUID();
  const sealed = manifest({
    preparationId: id,
    eventId,
    version,
    participantsSha256: live.participants.sha256,
    prizesSha256: live.prizes.sha256,
    rulesSha256: live.rules.sha256,
    seedCommitment: commitment,
    participantCount: live.participantCount,
    prizeCount: live.prizeCount,
    slotCount: live.slotCount,
  });
  await database.rafflePreparation.create({
    data: {
      id,
      eventId,
      version,
      status: "FROZEN",
      rules: parsedRules,
      participantsJson: live.participants.text,
      prizesJson: live.prizes.text,
      rulesJson: live.rules.text,
      participantsSha256: new Uint8Array(live.participants.sha256),
      prizesSha256: new Uint8Array(live.prizes.sha256),
      rulesSha256: new Uint8Array(live.rules.sha256),
      manifestSha256: new Uint8Array(sealed.sha256),
      participantCount: live.participantCount,
      slotCount: live.slotCount,
      seedCommitment: new Uint8Array(commitment),
      seedCiphertext: encryptSeed(testSeedKey, id, serverSeed),
      algorithmVersion: SELECT_ALGORITHM_VERSION,
      frozenAt: new Date(),
    },
  });
  return { preparationId: id, serverSeed };
}

export async function createRaffleFixture(
  database: Db,
  options: {
    participants: number;
    quantity: number;
    ineligible?: number;
    repeatWinners?: RaffleRules["repeatWinners"];
    voidedWinnerRedraw?: RaffleRules["voidedWinnerRedraw"];
    eventStatus?: "DRAFT" | "PUBLISHED";
    extraPrizes?: { quantity: number; categoryId?: string | null; departments?: string[] }[];
    departments?: string[];
  },
): Promise<RaffleFixture & { extraPrizeIds: string[] }> {
  const suffix = randomUUID().slice(0, 8);
  const event = await database.event.create({
    data: { slug: `test-${suffix}`, name: `Test event ${suffix}`, status: options.eventStatus ?? "PUBLISHED" },
  });
  const participantIds: string[] = [];
  const eligibleIds: string[] = [];
  for (let index = 0; index < options.participants; index++) {
    const eligible = index >= (options.ineligible ?? 0);
    const departments = options.departments ?? [];
    const participant = await database.participant.create({
      data: {
        eventId: event.id,
        externalId: `EMP-${String(index + 1).padStart(4, "0")}`,
        fullName: `Participant ${index + 1}`,
        department: departments.length > 0 ? (departments[index % departments.length] ?? null) : null,
        eligible,
      },
    });
    participantIds.push(participant.id);
    if (eligible) eligibleIds.push(participant.id);
  }
  const prize = await database.prize.create({
    data: { eventId: event.id, code: `PRZ-${suffix}`, name: "Test prize", quantity: options.quantity, drawOrder: 1 },
  });
  const extraPrizeIds: string[] = [];
  for (const [index, extra] of (options.extraPrizes ?? []).entries()) {
    const created = await database.prize.create({
      data: {
        eventId: event.id,
        code: `X${index}-${suffix}`,
        name: `Extra prize ${index + 1}`,
        quantity: extra.quantity,
        drawOrder: index + 2,
        categoryId: extra.categoryId ?? null,
        eligibilityRule: { departments: extra.departments ?? [] },
      },
    });
    extraPrizeIds.push(created.id);
  }
  const { preparationId, serverSeed } = await sealFrozenPreparation(database, event.id, {
    repeatWinners: options.repeatWinners ?? "never",
    voidedWinnerRedraw: options.voidedWinnerRedraw ?? "excluded",
  });
  return { eventId: event.id, preparationId, prizeId: prize.id, participantIds, eligibleIds, serverSeed, extraPrizeIds };
}
