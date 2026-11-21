import type { PresentationScreen, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { parsePresentationSettings } from "@/modules/presentation/domain/display";
import { sceneDurationMs } from "@/modules/presentation/domain/timeline";
import { parsePrizesSnapshot } from "@/modules/raffle/domain/snapshot";
import { RAFFLE_TX_OPTIONS, lockPreparation } from "@/modules/raffle/server/draw";

export type PresentationErrorCode = "NOT_FOUND" | "WRONG_EVENT" | "NOT_REVEALABLE" | "PRIZE_REQUIRED";

export class PresentationError extends Error {
  constructor(
    readonly code: PresentationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;
type CursorData = Omit<Prisma.PresentationCursorUncheckedCreateInput, "eventId" | "revision" | "updatedAt">;

async function writeCursor(client: Tx | Db, eventId: string, data: CursorData) {
  return client.presentationCursor.upsert({
    where: { eventId },
    create: { eventId, ...data },
    update: { ...data, revision: { increment: 1 } },
  });
}

export async function getCursor(database: Db, eventId: string) {
  return database.presentationCursor.findUnique({ where: { eventId } });
}

export type ShowScreenInput = { eventId: string; screen: PresentationScreen; prizeId?: string | null; preparationId?: string | null; now?: Date };

export async function showScreen(database: Db, input: ShowScreenInput) {
  const prizeId = input.screen === "DRAW" ? (input.prizeId ?? null) : null;
  if (input.screen === "DRAW") {
    if (!prizeId) throw new PresentationError("PRIZE_REQUIRED", "Choose which prize to show.");
    const prize = await database.prize.findFirst({ where: { id: prizeId, eventId: input.eventId }, select: { id: true } });
    if (!prize) throw new PresentationError("WRONG_EVENT", "That prize is not part of this event.");
  }
  return writeCursor(database, input.eventId, {
    preparationId: input.preparationId ?? null,
    screen: input.screen,
    prizeId,
    drawId: null,
    phase: "IDLE",
    phaseStartedAt: input.now ?? new Date(),
    countdownMs: 0,
    sceneMs: 0,
  });
}

export async function beginDraw(database: Db, input: { eventId: string; preparationId: string; prizeId: string; now?: Date }) {
  return writeCursor(database, input.eventId, {
    preparationId: input.preparationId,
    screen: "DRAW",
    prizeId: input.prizeId,
    drawId: null,
    phase: "DRAWING",
    phaseStartedAt: input.now ?? new Date(),
    countdownMs: 0,
    sceneMs: 0,
  });
}

export async function drawCommitted(database: Db, input: { eventId: string; prizeId: string; drawId: string; now?: Date }) {
  const moved = await database.presentationCursor.updateMany({
    where: { eventId: input.eventId, screen: "DRAW", prizeId: input.prizeId, phase: "DRAWING" },
    data: { phase: "READY", drawId: input.drawId, phaseStartedAt: input.now ?? new Date(), revision: { increment: 1 } },
  });
  return moved.count > 0;
}

export async function drawAbandoned(database: Db, input: { eventId: string; prizeId: string; now?: Date }) {
  const moved = await database.presentationCursor.updateMany({
    where: { eventId: input.eventId, screen: "DRAW", prizeId: input.prizeId, phase: "DRAWING" },
    data: { phase: "IDLE", drawId: null, phaseStartedAt: input.now ?? new Date(), revision: { increment: 1 } },
  });
  return moved.count > 0;
}

export async function drawWithdrawn(database: Db, drawId: string, now: Date = new Date()) {
  const moved = await database.presentationCursor.updateMany({
    where: { drawId },
    data: { phase: "IDLE", drawId: null, phaseStartedAt: now, countdownMs: 0, sceneMs: 0, revision: { increment: 1 } },
  });
  return moved.count > 0;
}

export type StartRevealResult = { replayed: boolean; firstReveal: boolean; visibleAt: Date };

export async function startReveal(database: Db, input: { eventId: string; drawId: string; now?: Date }): Promise<StartRevealResult> {
  const located = await database.draw.findUnique({ where: { id: input.drawId }, select: { preparationId: true } });
  if (!located) throw new PresentationError("NOT_FOUND", "That draw does not exist.");
  return database.$transaction(async (tx) => {
    await lockPreparation(tx, located.preparationId);
    const draw = await tx.draw.findUniqueOrThrow({
      where: { id: input.drawId },
      select: { id: true, status: true, prizeId: true, slotNumber: true, sequence: true, preparationId: true },
    });
    const preparation = await tx.rafflePreparation.findUniqueOrThrow({ where: { id: draw.preparationId }, select: { id: true, eventId: true, status: true, prizesJson: true } });
    if (preparation.eventId !== input.eventId) throw new PresentationError("WRONG_EVENT", "That draw is not part of this event.");
    const winner = await tx.winner.findUnique({ where: { drawId: draw.id }, select: { participantId: true, voidedAt: true } });
    if (draw.status !== "COMMITTED" || !winner || winner.voidedAt) throw new PresentationError("NOT_REVEALABLE", "Only a committed draw can be revealed.");
    if (preparation.status !== "DRAWING" && preparation.status !== "COMPLETED") {
      throw new PresentationError("NOT_REVEALABLE", "Draws of a cancelled or superseded raffle are not revealed.");
    }
    const existing = await tx.drawReveal.findUnique({ where: { drawId: draw.id } });
    const cursor = await tx.presentationCursor.findUnique({ where: { eventId: input.eventId } });
    if (cursor?.phase === "REVEALING" && cursor.drawId === draw.id && existing) {
      return { replayed: true, firstReveal: false, visibleAt: existing.visibleAt };
    }
    const event = await tx.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { presentation: true } });
    const now = input.now ?? new Date();
    const prize = preparation.prizesJson ? parsePrizesSnapshot(preparation.prizesJson).prizes.find((entry) => entry.id === draw.prizeId) : undefined;
    const countdownMs = parsePresentationSettings(event.presentation).countdownSeconds * 1000;
    const sceneMs = sceneDurationMs(prize?.sceneKey);
    let visibleAt = existing?.visibleAt;
    if (!existing) {
      visibleAt = new Date(now.getTime() + countdownMs + sceneMs);
      await tx.drawReveal.create({ data: { drawId: draw.id, preparationId: preparation.id, revealedAt: now, visibleAt } });
      await appendAudit(tx, {
        eventId: input.eventId,
        actor: "admin",
        action: "draw.revealed",
        entityType: "draw",
        entityId: draw.id,
        payload: { preparationId: preparation.id, prizeId: draw.prizeId, slotNumber: draw.slotNumber, sequence: draw.sequence, participantId: winner.participantId },
        at: now,
      });
    }
    await writeCursor(tx, input.eventId, {
      preparationId: preparation.id,
      screen: "DRAW",
      prizeId: draw.prizeId,
      drawId: draw.id,
      phase: "REVEALING",
      phaseStartedAt: now,
      countdownMs,
      sceneMs,
    });
    return { replayed: false, firstReveal: !existing, visibleAt: visibleAt ?? now };
  }, RAFFLE_TX_OPTIONS);
}
