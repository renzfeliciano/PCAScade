import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { type RaffleRules, type SealedText, participantsSnapshot, prizesSnapshot, rulesSnapshot } from "@/modules/raffle/domain/snapshot";

export type LiveSnapshots = {
  participants: SealedText;
  prizes: SealedText;
  rules: SealedText;
  participantCount: number;
  prizeCount: number;
  slotCount: number;
};

export async function liveParticipantsSnapshot(client: Db | Prisma.TransactionClient, eventId: string): Promise<{ sealed: SealedText; count: number }> {
  const rows = await client.participant.findMany({ where: { eventId, eligible: true, status: "ACTIVE" }, select: { id: true, department: true } });
  return { sealed: participantsSnapshot(eventId, rows), count: rows.length };
}

export async function liveSnapshots(client: Db | Prisma.TransactionClient, eventId: string, rules: RaffleRules): Promise<LiveSnapshots> {
  const participants = await liveParticipantsSnapshot(client, eventId);
  const prizes = await client.prize.findMany({
    where: { eventId, status: "AVAILABLE" },
    select: { id: true, code: true, name: true, quantity: true, drawOrder: true, categoryId: true, eligibilityRule: true, category: { select: { name: true, sceneKey: true } } },
  });
  return {
    participants: participants.sealed,
    prizes: prizesSnapshot(
      eventId,
      prizes.map((prize) => ({
        id: prize.id,
        code: prize.code,
        name: prize.name,
        quantity: prize.quantity,
        drawOrder: prize.drawOrder,
        categoryId: prize.categoryId,
        categoryName: prize.category?.name ?? null,
        sceneKey: prize.category?.sceneKey ?? null,
        eligibilityRule: prize.eligibilityRule,
      })),
    ),
    rules: rulesSnapshot(rules),
    participantCount: participants.count,
    prizeCount: prizes.length,
    slotCount: prizes.reduce((sum, prize) => sum + prize.quantity, 0),
  };
}
