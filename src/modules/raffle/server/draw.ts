import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { type BeaconRound, QUICKNET, roundAt } from "@/modules/beacon/drand";
import { type HistoryEntry, candidatesFor, exclusivityKey } from "@/modules/raffle/domain/candidates";
import { bytesEqual, seedCommitment } from "@/modules/raffle/domain/roster";
import { candidateListDigest, deriveSelectionKey, selectIndex } from "@/modules/raffle/domain/select";
import {
  BEACON_LEAD_ROUNDS as LEAD_ROUNDS,
  type SnapshotPrize,
  parseParticipantsSnapshot,
  parsePrizesSnapshot,
  parseRulesSnapshot,
  textDigest,
} from "@/modules/raffle/domain/snapshot";
import { liveParticipantsSnapshot } from "@/modules/raffle/server/live-snapshot";

export const BEACON_LEAD_ROUNDS = BigInt(LEAD_ROUNDS);

export type DrawErrorCode =
  | "PREPARATION_NOT_FOUND"
  | "PREPARATION_NOT_ACTIVE"
  | "PREPARATION_NOT_SEALED"
  | "SNAPSHOT_CORRUPT"
  | "PRIZE_NOT_FOUND"
  | "PRIZE_EXHAUSTED"
  | "STALE_REQUEST"
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

export const RAFFLE_TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 30_000, timeout: 30_000 };

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

export async function lockPreparation(tx: Tx, preparationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${preparationId}, 0))`;
}

function assertSameRequest(draw: DrawRow, input: { preparationId: string; prizeId: string }): void {
  if (draw.preparationId !== input.preparationId || draw.prizeId !== input.prizeId) {
    throw new DrawError("IDEMPOTENCY_CONFLICT");
  }
}

export async function loadSealedPreparation(client: Tx | Db, preparationId: string) {
  const preparation = await client.rafflePreparation.findUnique({ where: { id: preparationId } });
  if (!preparation) throw new DrawError("PREPARATION_NOT_FOUND");
  const { participantsSha256, prizesSha256, rulesSha256, seedCommitment: commitment, participantsJson, prizesJson, rulesJson } = preparation;
  if (!participantsSha256 || !prizesSha256 || !rulesSha256 || !commitment || participantsJson === null || prizesJson === null || rulesJson === null) {
    throw new DrawError("PREPARATION_NOT_SEALED");
  }
  if (
    !bytesEqual(textDigest(participantsJson), participantsSha256) ||
    !bytesEqual(textDigest(prizesJson), prizesSha256) ||
    !bytesEqual(textDigest(rulesJson), rulesSha256)
  ) {
    throw new DrawError("SNAPSHOT_CORRUPT");
  }
  return {
    ...preparation,
    participantsSha256: new Uint8Array(participantsSha256),
    rulesSha256: new Uint8Array(rulesSha256),
    seedCommitment: new Uint8Array(commitment),
    participants: parseParticipantsSnapshot(participantsJson).participants,
    prizes: parsePrizesSnapshot(prizesJson).prizes,
    rules: parseRulesSnapshot(rulesJson).rules,
  };
}

async function loadActivePreparation(tx: Tx, preparationId: string) {
  const preparation = await loadSealedPreparation(tx, preparationId);
  if (preparation.status !== "FROZEN" && preparation.status !== "DRAWING") throw new DrawError("PREPARATION_NOT_ACTIVE");
  return preparation;
}

type ActivePreparation = Awaited<ReturnType<typeof loadActivePreparation>>;

async function assertRosterUnchanged(tx: Tx, preparation: ActivePreparation): Promise<void> {
  const live = await liveParticipantsSnapshot(tx, preparation.eventId);
  if (!bytesEqual(live.sealed.sha256, preparation.participantsSha256)) throw new DrawError("ROSTER_CHANGED_SINCE_FREEZE");
}

export async function drawHistory(client: Tx | Db, preparationId: string): Promise<HistoryEntry[]> {
  const draws = await client.draw.findMany({
    where: { preparationId },
    select: { sequence: true, prizeId: true, winner: { select: { participantId: true } }, correction: { select: { afterSequence: true } } },
    orderBy: { sequence: "asc" },
  });
  return draws.map((draw) => ({
    sequence: draw.sequence,
    prizeId: draw.prizeId,
    participantId: draw.winner?.participantId ?? null,
    voidedAfterSequence: draw.correction?.afterSequence ?? null,
  }));
}

async function candidatesAt(tx: Tx, preparation: ActivePreparation, prize: SnapshotPrize, sequence: number): Promise<string[]> {
  await assertRosterUnchanged(tx, preparation);
  const history = await drawHistory(tx, preparation.id);
  const candidates = candidatesFor({ participants: preparation.participants, prizes: preparation.prizes, rules: preparation.rules, prize, sequence, history });
  if (candidates.length === 0) throw new DrawError("NO_ELIGIBLE_PARTICIPANTS");
  return candidates;
}

function snapshotPrize(preparation: ActivePreparation, prizeId: string): SnapshotPrize {
  const prize = preparation.prizes.find((entry) => entry.id === prizeId);
  if (!prize) throw new DrawError("PRIZE_NOT_FOUND");
  return prize;
}

export type RequestDrawInput = {
  preparationId: string;
  prizeId: string;
  idempotencyKey: string;
  slotNumber?: number;
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
      const prize = snapshotPrize(preparation, input.prizeId);

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
      if (input.slotNumber !== undefined && input.slotNumber !== slotNumber) throw new DrawError("STALE_REQUEST");

      const last = await tx.draw.aggregate({ where: { preparationId: preparation.id }, _max: { sequence: true } });
      const sequence = (last._max.sequence ?? 0) + 1;
      await candidatesAt(tx, preparation, prize, sequence);

      const draw = await tx.draw.create({
        data: {
          preparationId: preparation.id,
          prizeId: prize.id,
          slotNumber,
          sequence,
          idempotencyKey: input.idempotencyKey,
          status: "PENDING_BEACON",
          beaconRound: roundAt(input.now ?? Date.now()) + BEACON_LEAD_ROUNDS,
        },
        include: drawWithWinner,
      });
      if (preparation.status === "FROZEN") {
        await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { status: "DRAWING" } });
      }
      await appendAudit(tx, {
        eventId: preparation.eventId,
        actor: "admin",
        action: "draw.requested",
        entityType: "draw",
        entityId: draw.id,
        payload: {
          preparationId: preparation.id,
          prizeId: prize.id,
          slotNumber: draw.slotNumber,
          sequence: draw.sequence,
          targetRound: draw.beaconRound,
        },
      });
      return toState(draw, false);
    }, RAFFLE_TX_OPTIONS);
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
    const prize = snapshotPrize(preparation, draw.prizeId);
    const candidates = await candidatesAt(tx, preparation, prize, draw.sequence);
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
        exclusivityKey: exclusivityKey(preparation.rules, participantId, prize),
      },
    });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "draw.committed",
      entityType: "draw",
      entityId: draw.id,
      payload: {
        preparationId: preparation.id,
        prizeId: draw.prizeId,
        slotNumber: draw.slotNumber,
        sequence: draw.sequence,
        beaconRound: input.beacon.round,
        candidateCount: candidates.length,
        candidateListSha256: candidateListSha256,
        selectedIndex: index,
        participantId,
      },
    });
    const stored = await tx.draw.findUniqueOrThrow({ where: { id: draw.id }, include: drawWithWinner });
    return toState(stored, false);
  }, RAFFLE_TX_OPTIONS);

  if (state.status !== "COMMITTED") throw new DrawError("DRAW_NOT_PENDING");
  return state;
}
