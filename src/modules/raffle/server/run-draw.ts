import type { Db } from "@/lib/db";
import { BeaconUnavailableError, fetchRound, roundTime } from "@/modules/beacon/drand";
import { type CommittedDraw, type DrawState, DrawError, completeDraw, requestDraw } from "@/modules/raffle/server/draw";

type BeaconOptions = {
  serverSeed: Uint8Array;
  relays: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  publishGraceMs?: number;
  fetchAttempts?: number;
};

export type RunDrawInput = BeaconOptions & {
  preparationId: string;
  prizeId: string;
  idempotencyKey: string;
  slotNumber?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function awaitBeaconAndCommit(database: Db, state: DrawState, options: BeaconOptions): Promise<CommittedDraw> {
  if (state.status === "COMMITTED") return state;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const waitMs = roundTime(state.targetRound) + (options.publishGraceMs ?? 500) - now();
  if (waitMs > 0) await sleep(waitMs);

  const attempts = options.fetchAttempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const beacon = await fetchRound(state.targetRound, { relays: options.relays, fetchImpl: options.fetchImpl });
      return await completeDraw(database, { drawId: state.drawId, beacon, serverSeed: options.serverSeed });
    } catch (error) {
      if (!(error instanceof BeaconUnavailableError)) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(1000);
    }
  }
  throw lastError;
}

export async function runDraw(database: Db, input: RunDrawInput): Promise<CommittedDraw> {
  const now = input.now ?? Date.now;
  const state = await requestDraw(database, {
    preparationId: input.preparationId,
    prizeId: input.prizeId,
    idempotencyKey: input.idempotencyKey,
    slotNumber: input.slotNumber,
    now: now(),
  });
  return awaitBeaconAndCommit(database, state, input);
}

export async function finishPendingDraw(database: Db, drawId: string, options: BeaconOptions): Promise<CommittedDraw> {
  const draw = await database.draw.findUnique({ where: { id: drawId }, include: { winner: true } });
  if (!draw) throw new DrawError("DRAW_NOT_FOUND");
  if (draw.status !== "PENDING_BEACON" || draw.beaconRound === null) throw new DrawError("DRAW_NOT_PENDING");
  return awaitBeaconAndCommit(
    database,
    {
      status: "PENDING_BEACON",
      drawId: draw.id,
      preparationId: draw.preparationId,
      prizeId: draw.prizeId,
      slotNumber: draw.slotNumber,
      sequence: draw.sequence,
      targetRound: draw.beaconRound,
      replayed: true,
    },
    options,
  );
}
