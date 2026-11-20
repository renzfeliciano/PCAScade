import type { Db } from "@/lib/db";
import { BeaconUnavailableError, fetchRound, roundTime } from "@/modules/beacon/drand";
import { type CommittedDraw, completeDraw, requestDraw } from "@/modules/raffle/server/draw";

export type RunDrawInput = {
  preparationId: string;
  prizeId: string;
  idempotencyKey: string;
  serverSeed: Uint8Array;
  relays: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  publishGraceMs?: number;
  fetchAttempts?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runDraw(database: Db, input: RunDrawInput): Promise<CommittedDraw> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const state = await requestDraw(database, {
    preparationId: input.preparationId,
    prizeId: input.prizeId,
    idempotencyKey: input.idempotencyKey,
    now: now(),
  });
  if (state.status === "COMMITTED") return state;

  const waitMs = roundTime(state.targetRound) + (input.publishGraceMs ?? 500) - now();
  if (waitMs > 0) await sleep(waitMs);

  const attempts = input.fetchAttempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const beacon = await fetchRound(state.targetRound, { relays: input.relays, fetchImpl: input.fetchImpl });
      return await completeDraw(database, { drawId: state.drawId, beacon, serverSeed: input.serverSeed });
    } catch (error) {
      if (!(error instanceof BeaconUnavailableError)) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(1000);
    }
  }
  throw lastError;
}
