import type { Prisma } from "@/generated/prisma/client";

export class RosterLockedError extends Error {
  readonly code = "ROSTER_LOCKED";
  constructor() {
    super("The participant roster and prize list are frozen for an active raffle. Cancel the raffle, or use Fresh Start once drawing has begun, to make changes.");
  }
}

export async function lockEventRoster(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pcascade:event-roster:${eventId}`}, 0))`;
}

export async function assertRosterEditable(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await lockEventRoster(tx, eventId);
  const active = await tx.rafflePreparation.findFirst({ where: { eventId, status: { in: ["FROZEN", "DRAWING"] } }, select: { id: true } });
  if (active) throw new RosterLockedError();
}
