import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createDb, type Db } from "@/lib/db";
import { parseServerEnv } from "@/lib/env";
import { fetchRound } from "@/modules/beacon/drand";
import { rosterDigest, seedCommitment } from "@/modules/raffle/domain/roster";
import { DrawError, requestDraw } from "@/modules/raffle/server/draw";
import { runDraw } from "@/modules/raffle/server/run-draw";

config({ path: ".env.local", quiet: true });

type Check = { name: string; ok: boolean; detail: string };

async function createScratchRaffle(database: Db, tag: string, participants: number, quantity: number) {
  const event = await database.event.create({ data: { slug: `verify-${tag}-${randomUUID().slice(0, 6)}`, name: `Database verification ${tag}` } });
  await database.participant.createMany({
    data: Array.from({ length: participants }, (_, index) => ({
      eventId: event.id,
      externalId: `VERIFY-${index + 1}`,
      fullName: `Verification participant ${index + 1}`,
    })),
  });
  const roster = await database.participant.findMany({ where: { eventId: event.id }, select: { id: true } });
  const prize = await database.prize.create({ data: { eventId: event.id, code: `VERIFY-${tag}`, name: "Verification prize", quantity, drawOrder: 1 } });
  const serverSeed = new Uint8Array(randomBytes(32));
  const preparation = await database.rafflePreparation.create({
    data: {
      eventId: event.id,
      version: 1,
      status: "FROZEN",
      rules: { repeatWinners: "never" },
      participantsSha256: new Uint8Array(rosterDigest(roster.map((row) => row.id))),
      prizesSha256: new Uint8Array(randomBytes(32)),
      rulesSha256: new Uint8Array(randomBytes(32)),
      seedCommitment: new Uint8Array(seedCommitment(serverSeed)),
      algorithmVersion: "pcascade-select-v1",
      frozenAt: new Date(),
    },
  });
  return { eventId: event.id, prizeId: prize.id, preparationId: preparation.id, serverSeed };
}

async function removeScratchEvent(database: Db, eventId: string) {
  await database.winner.deleteMany({ where: { preparation: { eventId } } });
  await database.draw.deleteMany({ where: { preparation: { eventId } } });
  await database.rafflePreparation.deleteMany({ where: { eventId } });
  await database.prize.deleteMany({ where: { eventId } });
  await database.participant.deleteMany({ where: { eventId } });
  await database.event.delete({ where: { id: eventId } });
}

async function main() {
  const env = parseServerEnv(process.env);
  const database = createDb(env.DATABASE_URL);
  const checks: Check[] = [];
  const created: string[] = [];

  try {
    const started = Date.now();
    await database.$queryRaw`SELECT 1`;
    checks.push({ name: "connect via pooled URL", ok: true, detail: `${Date.now() - started} ms (includes cold start if compute was suspended)` });

    const warm = Date.now();
    await database.$queryRaw`SELECT 1`;
    checks.push({ name: "warm round trip", ok: true, detail: `${Date.now() - warm} ms` });

    const latest = await fetchRound("latest", { relays: env.DRAND_RELAYS });
    checks.push({ name: "live drand round fetched, fresh and BLS-verified", ok: true, detail: `round ${latest.round}` });

    const race = await createScratchRaffle(database, "race", 100, 1);
    created.push(race.eventId);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 50 }, () => requestDraw(database, { preparationId: race.preparationId, prizeId: race.prizeId, idempotencyKey: randomUUID() })),
    );
    const reserved = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    const inProgress = outcomes.filter((o) => o.status === "rejected" && o.reason instanceof DrawError && o.reason.code === "DRAW_IN_PROGRESS").length;
    checks.push({
      name: "50 racing draw requests, 1 slot",
      ok: reserved === 1 && inProgress === 49,
      detail: `reserved=${reserved}, in-progress=${inProgress}, rows=${await database.draw.count({ where: { preparationId: race.preparationId } })}`,
    });

    const live = await createScratchRaffle(database, "live", 20, 2);
    created.push(live.eventId);
    const key = randomUUID();
    const liveStarted = Date.now();
    const runs = await Promise.all(
      Array.from({ length: 10 }, () =>
        runDraw(database, { preparationId: live.preparationId, prizeId: live.prizeId, idempotencyKey: key, serverSeed: live.serverSeed, relays: env.DRAND_RELAYS }),
      ),
    );
    const winners = await database.winner.count({ where: { preparationId: live.preparationId } });
    checks.push({
      name: "10 concurrent runDraw calls, same key, real future drand round",
      ok: new Set(runs.map((r) => r.drawId)).size === 1 && winners === 1,
      detail: `round ${runs[0]?.targetRound}, winners=${winners}, ${Date.now() - liveStarted} ms including the wait for the round`,
    });
  } catch (error) {
    checks.push({ name: "unexpected failure", ok: false, detail: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const eventId of created) {
      await removeScratchEvent(database, eventId).catch((error: unknown) => {
        checks.push({ name: `cleanup ${eventId}`, ok: false, detail: String(error) });
      });
    }
    const leftovers = await database.event.count({ where: { slug: { startsWith: "verify-" } } });
    checks.push({ name: "verification data removed", ok: leftovers === 0, detail: `leftover verification events=${leftovers}` });
    await database.$disconnect();
  }

  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}  (${check.detail})`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

void main();
