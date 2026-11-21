import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createDb } from "@/lib/db";
import { updatePublicDisplay } from "@/modules/events/server/events";
import { beginDraw, drawCommitted, drawWithdrawn, showScreen, startReveal } from "@/modules/presentation/server/cursor";
import { completeDraw, requestDraw } from "@/modules/raffle/server/draw";
import { resetDraw } from "@/modules/raffle/server/preparations";
import { fixtureBeacon, requestTimeForFixtureRound, sealFrozenPreparation } from "../integration/fixtures";

config({ path: ".env.test", quiet: true });

const url = process.env.TEST_DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("The director helper only runs against a localhost TEST_DATABASE_URL.");

const database = createDb(url);
const [command = "", raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw) as Record<string, string | number>;
const text = (key: string) => String(input[key] ?? "");

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const event = await database.event.create({ data: { slug: `e2e-reveal-${suffix}`, name: `Reveal Night ${suffix}`, status: "PUBLISHED" } });
  for (let index = 0; index < 5; index++) {
    await database.participant.create({ data: { eventId: event.id, externalId: `E2E-${index}`, fullName: `Builder ${suffix} ${index}`, department: "Site" } });
  }
  const prize = await database.prize.create({ data: { eventId: event.id, code: `E2E-${suffix}`, name: "Cordless drill set", quantity: 1, drawOrder: 1 } });
  await updatePublicDisplay(database, event.id, { department: true, jobTitle: true, bio: false, photo: true }, { countdownSeconds: Number(input.countdownSeconds ?? 4) }, async () => {});
  const { preparationId, serverSeed } = await sealFrozenPreparation(database, event.id);
  const pending = await requestDraw(database, { preparationId, prizeId: prize.id, idempotencyKey: randomUUID(), now: requestTimeForFixtureRound });
  const committed = await completeDraw(database, { drawId: pending.drawId, beacon: fixtureBeacon, serverSeed });
  const winner = await database.participant.findUniqueOrThrow({ where: { id: committed.participantId }, select: { fullName: true } });
  return { eventId: event.id, slug: event.slug, preparationId, prizeId: prize.id, drawId: committed.drawId, winnerName: winner.fullName };
}

async function run() {
  switch (command) {
    case "seed":
      return seed();
    case "screen":
      return showScreen(database, {
        eventId: text("eventId"),
        preparationId: text("preparationId"),
        screen: text("screen") as "LOBBY" | "PRIZES" | "DRAW" | "WINNER_WALL" | "RECAP",
        prizeId: input.prizeId ? text("prizeId") : null,
      });
    case "begin":
      return beginDraw(database, { eventId: text("eventId"), preparationId: text("preparationId"), prizeId: text("prizeId") });
    case "committed":
      return drawCommitted(database, { eventId: text("eventId"), prizeId: text("prizeId"), drawId: text("drawId") });
    case "reveal":
      return startReveal(database, { eventId: text("eventId"), drawId: text("drawId") });
    case "reset":
      await resetDraw(database, { drawId: text("drawId"), category: "WINNER_ABSENT", reason: "Not in the hall at the call" });
      return drawWithdrawn(database, text("drawId"));
    default:
      throw new Error(`Unknown command ${command}`);
  }
}

try {
  process.stdout.write(`${JSON.stringify(await run())}\n`);
} finally {
  await database.$disconnect();
}
