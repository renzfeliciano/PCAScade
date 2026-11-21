import { bytesToHex } from "@noble/hashes/utils.js";
import type { CorrectionReason, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { roundTime } from "@/modules/beacon/drand";
import { bytesEqual, seedCommitment } from "@/modules/raffle/domain/roster";
import { SELECT_ALGORITHM_VERSION } from "@/modules/raffle/domain/select";
import { type RaffleRules, manifest, raffleRulesSchema } from "@/modules/raffle/domain/snapshot";
import { RAFFLE_TX_OPTIONS, lockPreparation } from "@/modules/raffle/server/draw";
import { type LiveSnapshots, liveSnapshots } from "@/modules/raffle/server/live-snapshot";
import { lockEventRoster } from "@/modules/raffle/server/roster-lock";
import { decryptSeed, encryptSeed, newServerSeed } from "@/modules/raffle/server/seed-vault";

export const STUCK_DRAW_GRACE_MS = 60_000;

export const CORRECTION_REASONS: { key: CorrectionReason; label: string }[] = [
  { key: "WINNER_ABSENT", label: "Winner absent" },
  { key: "INELIGIBLE", label: "Winner not eligible" },
  { key: "DATA_ERROR", label: "Data error" },
  { key: "TECHNICAL_ISSUE", label: "Technical issue" },
  { key: "OTHER", label: "Other" },
];

export type RaffleErrorCode =
  | "NOT_FOUND"
  | "OPEN_PREPARATION_EXISTS"
  | "WRONG_STATUS"
  | "NO_PARTICIPANTS"
  | "NO_PRIZES"
  | "HAS_DRAWS"
  | "DRAW_IN_PROGRESS"
  | "DRAW_NOT_RESETTABLE"
  | "REASON_REQUIRED";

export class RaffleError extends Error {
  constructor(
    readonly code: RaffleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

function reasonOrThrow(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw new RaffleError("REASON_REQUIRED", "Give a reason between 3 and 500 characters.");
  return trimmed;
}

function sealedColumns(preparationId: string, eventId: string, version: number, live: LiveSnapshots, commitment: Uint8Array) {
  const sealed = manifest({
    preparationId,
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
  return {
    participantsJson: live.participants.text,
    prizesJson: live.prizes.text,
    rulesJson: live.rules.text,
    participantsSha256: new Uint8Array(live.participants.sha256),
    prizesSha256: new Uint8Array(live.prizes.sha256),
    rulesSha256: new Uint8Array(live.rules.sha256),
    manifestSha256: new Uint8Array(sealed.sha256),
    participantCount: live.participantCount,
    slotCount: live.slotCount,
  };
}

async function lockedPreparation(tx: Tx, preparationId: string) {
  const located = await tx.rafflePreparation.findUnique({ where: { id: preparationId }, select: { eventId: true } });
  if (!located) throw new RaffleError("NOT_FOUND", "That raffle preparation does not exist.");
  await lockEventRoster(tx, located.eventId);
  await lockPreparation(tx, preparationId);
  return tx.rafflePreparation.findUniqueOrThrow({ where: { id: preparationId } });
}

function revealSeed(seedKey: Uint8Array, preparation: { id: string; seedCiphertext: Uint8Array | null; seedCommitment: Uint8Array | null }): Uint8Array<ArrayBuffer> | null {
  if (!preparation.seedCiphertext || !preparation.seedCommitment) return null;
  const seed = decryptSeed(seedKey, preparation.id, new Uint8Array(preparation.seedCiphertext));
  if (!bytesEqual(seedCommitment(seed), new Uint8Array(preparation.seedCommitment))) throw new Error("stored seed does not match its commitment");
  return seed;
}

async function assertNoPendingDraw(tx: Tx, preparationId: string): Promise<void> {
  const pending = await tx.draw.findFirst({ where: { preparationId, status: "PENDING_BEACON" }, select: { id: true } });
  if (pending) throw new RaffleError("DRAW_IN_PROGRESS", "A draw is waiting for its beacon round. Finish or reset it first.");
}

async function insertDraft(tx: Tx, eventId: string, rules: RaffleRules, seedKey: Uint8Array, version: number) {
  const seed = newServerSeed();
  const commitment = seedCommitment(seed);
  const draft = await tx.rafflePreparation.create({
    data: { eventId, version, status: "DRAFT", algorithmVersion: SELECT_ALGORITHM_VERSION, rules, seedCommitment: new Uint8Array(commitment) },
  });
  const live = await liveSnapshots(tx, eventId, rules);
  return tx.rafflePreparation.update({
    where: { id: draft.id },
    data: { ...sealedColumns(draft.id, eventId, version, live, commitment), seedCiphertext: encryptSeed(seedKey, draft.id, seed) },
  });
}

export type CreatePreparationInput = { eventId: string; rules: RaffleRules; seedKey: Uint8Array };

export async function createPreparation(database: Db, input: CreatePreparationInput) {
  const rules = raffleRulesSchema.parse(input.rules);
  return database.$transaction(async (tx) => {
    await lockEventRoster(tx, input.eventId);
    const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
    if (!event) throw new RaffleError("NOT_FOUND", "That event does not exist.");
    const open = await tx.rafflePreparation.findFirst({ where: { eventId: input.eventId, status: { in: ["DRAFT", "FROZEN", "DRAWING"] } }, select: { id: true } });
    if (open) throw new RaffleError("OPEN_PREPARATION_EXISTS", "This event already has an open raffle preparation.");
    const last = await tx.rafflePreparation.aggregate({ where: { eventId: input.eventId }, _max: { version: true } });
    const draft = await insertDraft(tx, input.eventId, rules, input.seedKey, (last._max.version ?? 0) + 1);
    await appendAudit(tx, {
      eventId: input.eventId,
      actor: "admin",
      action: "raffle.prepared",
      entityType: "raffle_preparation",
      entityId: draft.id,
      payload: { version: draft.version, rules, manifestSha256: draft.manifestSha256, participantCount: draft.participantCount, slotCount: draft.slotCount },
    });
    return draft;
  }, RAFFLE_TX_OPTIONS);
}

export async function updateDraft(database: Db, input: { preparationId: string; rules?: RaffleRules }) {
  return database.$transaction(async (tx) => {
    const preparation = await lockedPreparation(tx, input.preparationId);
    if (preparation.status !== "DRAFT") throw new RaffleError("WRONG_STATUS", "Only a draft can be changed.");
    const rules = raffleRulesSchema.parse(input.rules ?? preparation.rules);
    const live = await liveSnapshots(tx, preparation.eventId, rules);
    const updated = await tx.rafflePreparation.update({
      where: { id: preparation.id },
      data: { rules, ...sealedColumns(preparation.id, preparation.eventId, preparation.version, live, new Uint8Array(preparation.seedCommitment ?? new Uint8Array())) },
    });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "raffle.draft_refreshed",
      entityType: "raffle_preparation",
      entityId: preparation.id,
      payload: { rules, manifestSha256: updated.manifestSha256, participantCount: updated.participantCount, slotCount: updated.slotCount },
    });
    return updated;
  }, RAFFLE_TX_OPTIONS);
}

export type FreezeResult = { frozen: true } | { frozen: false; reason: "DATA_CHANGED" | "MANIFEST_CHANGED" };

export async function freezePreparation(database: Db, input: { preparationId: string; expectedManifestSha256: string }): Promise<FreezeResult> {
  return database.$transaction(async (tx) => {
    const preparation = await lockedPreparation(tx, input.preparationId);
    if (preparation.status !== "DRAFT") throw new RaffleError("WRONG_STATUS", "Only a draft can be frozen.");
    const rules = raffleRulesSchema.parse(preparation.rules);
    const live = await liveSnapshots(tx, preparation.eventId, rules);
    const commitment = new Uint8Array(preparation.seedCommitment ?? new Uint8Array());
    const columns = sealedColumns(preparation.id, preparation.eventId, preparation.version, live, commitment);
    if (!preparation.manifestSha256 || !bytesEqual(columns.manifestSha256, new Uint8Array(preparation.manifestSha256))) {
      await tx.rafflePreparation.update({ where: { id: preparation.id }, data: columns });
      await appendAudit(tx, {
        eventId: preparation.eventId,
        actor: "admin",
        action: "raffle.draft_refreshed",
        entityType: "raffle_preparation",
        entityId: preparation.id,
        payload: { reason: "data changed before freeze", manifestSha256: columns.manifestSha256 },
      });
      return { frozen: false, reason: "DATA_CHANGED" } as const;
    }
    if (bytesToHex(columns.manifestSha256) !== input.expectedManifestSha256) return { frozen: false, reason: "MANIFEST_CHANGED" } as const;
    if (live.participantCount === 0) throw new RaffleError("NO_PARTICIPANTS", "There are no eligible, active participants to draw from.");
    if (live.prizeCount === 0) throw new RaffleError("NO_PRIZES", "There are no available prizes to draw.");
    const frozenAt = new Date();
    await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { status: "FROZEN", frozenAt } });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "raffle.frozen",
      entityType: "raffle_preparation",
      entityId: preparation.id,
      payload: {
        version: preparation.version,
        manifestSha256: columns.manifestSha256,
        participantsSha256: columns.participantsSha256,
        prizesSha256: columns.prizesSha256,
        rulesSha256: columns.rulesSha256,
        seedCommitment: commitment,
        participantCount: live.participantCount,
        prizeCount: live.prizeCount,
        slotCount: live.slotCount,
      },
    });
    return { frozen: true } as const;
  }, RAFFLE_TX_OPTIONS);
}

export async function cancelPreparation(database: Db, input: { preparationId: string; reason: string; seedKey: Uint8Array }) {
  const reason = reasonOrThrow(input.reason);
  return database.$transaction(async (tx) => {
    const preparation = await lockedPreparation(tx, input.preparationId);
    if (preparation.status !== "DRAFT" && preparation.status !== "FROZEN") {
      throw new RaffleError("WRONG_STATUS", "Only a draft or a frozen raffle with no draws can be cancelled. Use Fresh Start once drawing has begun.");
    }
    const draws = await tx.draw.count({ where: { preparationId: preparation.id } });
    if (draws > 0) throw new RaffleError("HAS_DRAWS", "This raffle already has draws. Use Fresh Start instead.");
    const wasFrozen = preparation.status === "FROZEN";
    const seed = wasFrozen ? revealSeed(input.seedKey, preparation) : null;
    await tx.rafflePreparation.update({
      where: { id: preparation.id },
      data: { status: "CANCELLED", statusReason: reason, closedAt: new Date(), ...(seed ? { revealedSeed: seed } : {}) },
    });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "raffle.cancelled",
      entityType: "raffle_preparation",
      entityId: preparation.id,
      payload: { reason, wasFrozen, seedRevealed: seed !== null },
    });
  }, RAFFLE_TX_OPTIONS);
}

export async function completePreparation(database: Db, input: { preparationId: string; seedKey: Uint8Array }) {
  return database.$transaction(async (tx) => {
    const preparation = await lockedPreparation(tx, input.preparationId);
    if (preparation.status !== "DRAWING") throw new RaffleError("WRONG_STATUS", "Only a raffle that has started drawing can be completed.");
    await assertNoPendingDraw(tx, preparation.id);
    const seed = revealSeed(input.seedKey, preparation);
    const filled = await tx.draw.count({ where: { preparationId: preparation.id, status: "COMMITTED" } });
    const resets = await tx.winnerCorrection.count({ where: { preparationId: preparation.id } });
    await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { status: "COMPLETED", closedAt: new Date(), ...(seed ? { revealedSeed: seed } : {}) } });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "raffle.completed",
      entityType: "raffle_preparation",
      entityId: preparation.id,
      payload: { filledSlots: filled, totalSlots: preparation.slotCount, resets, seedRevealed: seed !== null },
    });
  }, RAFFLE_TX_OPTIONS);
}

export async function freshStart(database: Db, input: { preparationId: string; reason: string; seedKey: Uint8Array }) {
  const reason = reasonOrThrow(input.reason);
  return database.$transaction(async (tx) => {
    const preparation = await lockedPreparation(tx, input.preparationId);
    if (preparation.status === "SUPERSEDED" && preparation.supersededById) {
      return tx.rafflePreparation.findUniqueOrThrow({ where: { id: preparation.supersededById } });
    }
    if (preparation.status !== "FROZEN" && preparation.status !== "DRAWING") {
      throw new RaffleError("WRONG_STATUS", "Fresh Start is only available for a frozen raffle or one that is drawing.");
    }
    await assertNoPendingDraw(tx, preparation.id);
    const seed = revealSeed(input.seedKey, preparation);
    const last = await tx.rafflePreparation.aggregate({ where: { eventId: preparation.eventId }, _max: { version: true } });
    await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { status: "SUPERSEDED", statusReason: reason, closedAt: new Date(), ...(seed ? { revealedSeed: seed } : {}) } });
    const successor = await insertDraft(tx, preparation.eventId, raffleRulesSchema.parse(preparation.rules), input.seedKey, (last._max.version ?? 0) + 1);
    await tx.rafflePreparation.update({ where: { id: preparation.id }, data: { supersededById: successor.id } });
    await appendAudit(tx, {
      eventId: preparation.eventId,
      actor: "admin",
      action: "raffle.superseded",
      entityType: "raffle_preparation",
      entityId: preparation.id,
      payload: { reason, successorId: successor.id, successorVersion: successor.version, seedRevealed: seed !== null },
    });
    return successor;
  }, RAFFLE_TX_OPTIONS);
}

export type ResetDrawInput = { drawId: string; category: CorrectionReason; reason: string; now?: number };

export async function resetDraw(database: Db, input: ResetDrawInput) {
  const reason = reasonOrThrow(input.reason);
  const located = await database.draw.findUnique({ where: { id: input.drawId }, select: { preparationId: true } });
  if (!located) throw new RaffleError("NOT_FOUND", "That draw does not exist.");
  return database.$transaction(async (tx) => {
    await lockPreparation(tx, located.preparationId);
    const existing = await tx.winnerCorrection.findUnique({ where: { drawId: input.drawId } });
    if (existing) return { correction: existing, replayed: true };
    const draw = await tx.draw.findUniqueOrThrow({ where: { id: input.drawId }, include: { winner: true, preparation: true } });
    if (draw.preparation.status !== "DRAWING") throw new RaffleError("WRONG_STATUS", "Draws can only be reset while the raffle is drawing.");
    if (draw.status === "PENDING_BEACON") {
      const due = roundTime(draw.beaconRound ?? 0n) + STUCK_DRAW_GRACE_MS;
      if ((input.now ?? Date.now()) < due) throw new RaffleError("DRAW_NOT_RESETTABLE", "This draw is still waiting for its beacon round. Wait a minute before resetting it.");
    } else if (draw.status !== "COMMITTED") {
      throw new RaffleError("DRAW_NOT_RESETTABLE", "This draw has already been reset.");
    }
    const otherPending = await tx.draw.findFirst({ where: { preparationId: draw.preparationId, status: "PENDING_BEACON", id: { not: draw.id } }, select: { id: true } });
    if (otherPending) throw new RaffleError("DRAW_IN_PROGRESS", "Another draw is waiting for its beacon round.");
    const last = await tx.draw.aggregate({ where: { preparationId: draw.preparationId }, _max: { sequence: true } });
    const afterSequence = last._max.sequence ?? draw.sequence;
    const correction = await tx.winnerCorrection.create({
      data: { preparationId: draw.preparationId, drawId: draw.id, winnerId: draw.winner?.id ?? null, afterSequence, reasonCategory: input.category, reasonText: reason },
    });
    if (draw.winner) await tx.winner.update({ where: { id: draw.winner.id }, data: { voidedAt: correction.createdAt } });
    await tx.draw.update({ where: { id: draw.id }, data: { status: "VOIDED" } });
    await appendAudit(tx, {
      eventId: draw.preparation.eventId,
      actor: "admin",
      action: "draw.reset",
      entityType: "draw",
      entityId: draw.id,
      payload: {
        preparationId: draw.preparationId,
        prizeId: draw.prizeId,
        slotNumber: draw.slotNumber,
        sequence: draw.sequence,
        previousStatus: draw.status,
        participantId: draw.winner?.participantId ?? null,
        category: input.category,
        reason,
        afterSequence,
      },
    });
    return { correction, replayed: false };
  }, RAFFLE_TX_OPTIONS);
}
