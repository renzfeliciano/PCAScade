import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { type BeaconRound, QUICKNET, roundAt } from "@/modules/beacon/drand";
import { bytesEqual, rosterDigest, seedCommitment } from "@/modules/raffle/domain/roster";
import { candidateListDigest, deriveSelectionKey, selectIndex, sortCandidates } from "@/modules/raffle/domain/select";

export const BEACON_LEAD_ROUNDS = 2n;

export const raffleRulesSchema = z.object({
  repeatWinners: z.enum(["never", "allowed"]).default("never"),
});

export type RaffleRules = z.infer<typeof raffleRulesSchema>;

export type DrawErrorCode =
  | "PREPARATION_NOT_FOUND"
  | "PREPARATION_NOT_ACTIVE"
  | "PREPARATION_NOT_SEALED"
  | "PRIZE_NOT_FOUND"
  | "PRIZE_EXHAUSTED"
  | "NO_ELIGIBLE_PARTICIPANTS"
  | "ROSTER_CHANGED_SINCE_FREEZE"
  | "DRAW_IN_PROGRESS"
  | "IDEMPOTENCY_CONFLICT"
  | "DRAW_NOT_FOUND"
  | "DRAW_NOT_PENDING"
  | "BEACON_CHAIN_MISMATCH"
  | "BEACON_ROUND_MISMATCH"
  | "SEED_COMMITMENT_MISMATCH";

export class DrawError extends Error {
  constructor(readonly code: DrawErrorCode) {
    super(code);
  }
}

export type PendingDraw = {
  status: "PENDING_BEACON";
  drawId: string;
  preparationId: string;
  prizeId: string;
  slotNumber: number;
  sequence: number;
  targetRound: bigint;
  replayed: boolean;
};

export type CommittedDraw = {
  status: "COMMITTED";
  drawId: string;
  preparationId: string;
  prizeId: string;
  slotNumber: number;
  sequence: number;
  targetRound: bigint;
  participantId: string;
  candidateCount: number;
  selectedIndex: number;
  replayed: boolean;
};

export type DrawState = PendingDraw | CommittedDraw;

const drawWithWinner = { winner: true } satisfies Prisma.DrawInclude;
type DrawRow = Prisma.DrawGetPayload<{ include: typeof drawWithWinner }>;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 30_000, timeout: 30_000 };

function toState(draw: DrawRow, replayed: boolean): DrawState {
  if (draw.beaconRound === null) throw new Error(`draw ${draw.id} has no target round`);
  const base = {
    drawId: draw.id,
    preparationId: draw.preparationId,
    prizeId: draw.prizeId,
    slotNumber: draw.slotNumber,
    sequence: draw.sequence,
    targetRound: draw.beaconRound,
    replayed,
  };
  if (draw.status === "PENDING_BEACON") return { status: "PENDING_BEACON", ...base };
  if (draw.status === "COMMITTED" && draw.winner && draw.candidateCount !== null && draw.selectedIndex !== null) {
    return {
      status: "COMMITTED",
      ...base,
      participantId: draw.winner.participantId,
      candidateCount: draw.candidateCount,
      selectedIndex: draw.selectedIndex,
    };
  }
  throw new DrawError("DRAW_NOT_PENDING");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function lockPreparation(tx: Tx, preparationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${preparationId}, 0))`;
}

function assertSameRequest(draw: DrawRow, input: { preparationId: string; prizeId: string }): void {
  if (draw.preparationId !== input.preparationId || draw.prizeId !== input.prizeId) {
    throw new DrawError("IDEMPOTENCY_CONFLICT");
  }
}

async function loadActivePreparation(tx: Tx, preparationId: string) {
  const preparation = await tx.rafflePreparation.findUnique({ where: { id: preparationId } });
  if (!preparation) throw new DrawError("PREPARATION_NOT_FOUND");
  if (preparation.status !== "FROZEN" && preparation.status !== "DRAWING") throw new DrawError("PREPARATION_NOT_ACTIVE");
  const { participantsSha256, rulesSha256, seedCommitment: commitment } = preparation;
  if (!participantsSha256 || !rulesSha256 || !commitment) throw new DrawError("PREPARATION_NOT_SEALED");
  return { ...preparation, participantsSha256, rulesSha256, seedCommitment: commitment, rules: raffleRulesSchema.parse(preparation.rules) };
}

type ActivePreparation = Awaited<ReturnType<typeof loadActivePreparation>>;

async function eligibleCandidates(tx: Tx, preparation: ActivePreparation): Promise<string[]> {
  const pool = await tx.participant.findMany({
    where: { eventId: preparation.eventId, eligible: true, status: "ACTIVE" },
    select: { id: true },
  });
  const poolIds = pool.map((row) => row.id);
  if (!bytesEqual(rosterDigest(poolIds), preparation.participantsSha256)) {
    throw new DrawError("ROSTER_CHANGED_SINCE_FREEZE");
  }
  const excluded = new Set<string>();
  if (preparation.rules.repeatWinners === "never") {
    const priorWinners = await tx.winner.findMany({
      where: { preparationId: preparation.id, voidedAt: null },
      select: { participantId: true },
    });
    for (const winner of priorWinners) excluded.add(winner.participantId);
  }
  const candidates = sortCandidates(poolIds.filter((id) => !excluded.has(id)));
  if (candidates.length === 0) throw new DrawError("NO_ELIGIBLE_PARTICIPANTS");
  return candidates;
}

export type RequestDrawInput = {
  preparationId: string;
  prizeId: string;
  idempotencyKey: string;
  now?: number;
};

export async function requestDraw(database: Db, input: RequestDrawInput): Promise<DrawState> {
  const replayOrNull = async (client: Tx | Db) => {
    const existing = await client.draw.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: drawWithWinner });
    if (!existing) return null;
    assertSameRequest(existing, input);
    return toState(existing, true);
  };

  const early = await replayOrNull(database);
  if (early) return early;

  try {
    return await database.$transaction(async (tx) => {
      await lockPreparation(tx, input.preparationId);
      const replay = await replayOrNull(tx);
      if (replay) return replay;

      const preparation = await loadActivePreparation(tx, input.preparationId);
      const prize = await tx.prize.findFirst({ where: { id: input.prizeId, eventId: preparation.eventId } });
      if (!prize) throw new DrawError("PRIZE_NOT_FOUND");

      const pending = await tx.draw.findFirst({ where: { preparationId: preparation.id, status: "PENDING_BEACON" }, select: { id: true } });
      if (pending) throw new DrawError("DRAW_IN_PROGRESS");

      const activeSlots = await tx.draw.findMany({
        where: { preparationId: preparation.id, prizeId: prize.id, status: { not: "VOIDED" } },
        select: { slotNumber: true },
      });
      const taken = new Set(activeSlots.map((draw) => draw.slotNumber));
      let slotNumber = 0;
      for (let slot = 1; slot <= prize.quantity; slot++) {
        if (!taken.has(slot)) {
          slotNumber = slot;
          break;
        }
      }
      if (slotNumber === 0) throw new DrawError("PRIZE_EXHAUSTED");

      await eligibleCandidates(tx, preparation);

      const last = await tx.draw.aggregate({ where: { preparationId: preparation.id }, _max: { sequence: true } });
      const draw = await tx.draw.create({
        data: {
          preparationId: preparation.id,
          prizeId: prize.id,
          slotNumber,
          sequence: (last._max.sequence ?? 0) + 1,
          idempotencyKey: input.idempotencyKey,
          status: "PENDING_BEACON",
          beaconRound: roundAt(input.now ?? Date.now()) + BEACON_LEAD_ROUNDS,
        },
        include: drawWithWinner,
      });
      if (preparation.status === "FROZEN") {
        await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { status: "DRAWING" } });
      }
      return toState(draw, false);
    }, TX_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await replayOrNull(database);
      if (replay) return replay;
    }
    throw error;
  }
}

export type CompleteDrawInput = {
  drawId: string;
  beacon: BeaconRound;
  serverSeed: Uint8Array;
};

export async function completeDraw(database: Db, input: CompleteDrawInput): Promise<CommittedDraw> {
  const located = await database.draw.findUnique({ where: { id: input.drawId }, select: { preparationId: true } });
  if (!located) throw new DrawError("DRAW_NOT_FOUND");

  const state = await database.$transaction(async (tx) => {
    await lockPreparation(tx, located.preparationId);
    const draw = await tx.draw.findUniqueOrThrow({ where: { id: input.drawId }, include: drawWithWinner });
    if (draw.status === "COMMITTED") return toState(draw, true);
    if (draw.status !== "PENDING_BEACON" || draw.beaconRound === null) throw new DrawError("DRAW_NOT_PENDING");
    if (input.beacon.chainHash !== QUICKNET.chainHash) throw new DrawError("BEACON_CHAIN_MISMATCH");
    if (input.beacon.round !== draw.beaconRound) throw new DrawError("BEACON_ROUND_MISMATCH");

    const preparation = await loadActivePreparation(tx, draw.preparationId);
    if (!bytesEqual(seedCommitment(input.serverSeed), preparation.seedCommitment)) {
      throw new DrawError("SEED_COMMITMENT_MISMATCH");
    }

    const candidates = await eligibleCandidates(tx, preparation);
    const candidateListSha256 = candidateListDigest(candidates);
    const key = deriveSelectionKey({
      preparationId: preparation.id,
      participantsSha256: preparation.participantsSha256,
      rulesSha256: preparation.rulesSha256,
      drawSequence: draw.sequence,
      prizeId: draw.prizeId,
      slotNumber: draw.slotNumber,
      candidateListSha256,
      serverSeed: input.serverSeed,
      beaconRound: input.beacon.round,
      beaconRandomness: input.beacon.randomness,
    });
    const { index } = selectIndex(key, candidates.length);
    const participantId = candidates[index];
    if (participantId === undefined) throw new Error("selected index out of range");

    const committed = await tx.draw.updateMany({
      where: { id: draw.id, status: "PENDING_BEACON" },
      data: {
        status: "COMMITTED",
        beaconSignature: new Uint8Array(input.beacon.signature),
        candidateCount: candidates.length,
        candidateListSha256: new Uint8Array(candidateListSha256),
        selectedIndex: index,
        committedAt: new Date(),
      },
    });
    if (committed.count !== 1) throw new DrawError("DRAW_NOT_PENDING");

    await tx.winner.create({
      data: {
        drawId: draw.id,
        preparationId: preparation.id,
        participantId,
        exclusivityKey: preparation.rules.repeatWinners === "never" ? participantId : null,
      },
    });
    const stored = await tx.draw.findUniqueOrThrow({ where: { id: draw.id }, include: drawWithWinner });
    return toState(stored, false);
  }, TX_OPTIONS);

  if (state.status !== "COMMITTED") throw new DrawError("DRAW_NOT_PENDING");
  return state;
}
