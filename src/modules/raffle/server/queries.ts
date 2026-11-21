import { bytesToHex } from "@noble/hashes/utils.js";
import type { Db } from "@/lib/db";
import { BUNDLE_FORMAT, type VerificationBundle } from "@/modules/raffle/domain/verify";
import { parsePrizesSnapshot, parseRulesSnapshot, type SnapshotPrize } from "@/modules/raffle/domain/snapshot";

const hex = (value: Uint8Array | null | undefined): string => (value ? bytesToHex(new Uint8Array(value)) : "");

export async function listPreparations(database: Db, eventId: string) {
  const rows = await database.rafflePreparation.findMany({
    where: { eventId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      status: true,
      participantCount: true,
      slotCount: true,
      statusReason: true,
      createdAt: true,
      frozenAt: true,
      closedAt: true,
      _count: { select: { corrections: true } },
    },
  });
  const winners = await database.winner.groupBy({ by: ["preparationId"], where: { preparationId: { in: rows.map((row) => row.id) }, voidedAt: null }, _count: true });
  const filled = new Map(winners.map((row) => [row.preparationId, row._count]));
  return rows.map((row) => ({ ...row, filledSlots: filled.get(row.id) ?? 0, resets: row._count.corrections }));
}

export async function getPreparation(database: Db, preparationId: string) {
  const preparation = await database.rafflePreparation.findUnique({
    where: { id: preparationId },
    include: { event: { select: { id: true, name: true, status: true } }, supersedes: { select: { id: true, version: true } }, supersededBy: { select: { id: true, version: true } } },
  });
  if (!preparation) return null;
  const [committed, pending, resets] = await Promise.all([
    database.draw.count({ where: { preparationId, status: "COMMITTED" } }),
    database.draw.count({ where: { preparationId, status: "PENDING_BEACON" } }),
    database.winnerCorrection.count({ where: { preparationId } }),
  ]);
  const prizes = preparation.prizesJson ? parsePrizesSnapshot(preparation.prizesJson).prizes : [];
  const rules = preparation.rulesJson ? parseRulesSnapshot(preparation.rulesJson).rules : null;
  return {
    id: preparation.id,
    eventId: preparation.eventId,
    event: preparation.event,
    version: preparation.version,
    status: preparation.status,
    rules,
    prizes,
    participantCount: preparation.participantCount ?? 0,
    slotCount: preparation.slotCount ?? 0,
    statusReason: preparation.statusReason,
    createdAt: preparation.createdAt,
    frozenAt: preparation.frozenAt,
    closedAt: preparation.closedAt,
    supersedes: preparation.supersedes,
    supersededBy: preparation.supersededBy,
    manifestSha256: hex(preparation.manifestSha256),
    participantsSha256: hex(preparation.participantsSha256),
    prizesSha256: hex(preparation.prizesSha256),
    rulesSha256: hex(preparation.rulesSha256),
    seedCommitment: hex(preparation.seedCommitment),
    seedRevealed: preparation.revealedSeed !== null,
    committedDraws: committed,
    pendingDraws: pending,
    resets,
  };
}

export type SlotDraw = {
  drawId: string;
  sequence: number;
  status: "PENDING_BEACON" | "COMMITTED" | "VOIDED" | "FAILED";
  targetRound: string;
  participant: { id: string; fullName: string; externalId: string; department: string | null } | null;
  correction: { category: string; reason: string; createdAt: Date } | null;
};

export type ConsoleSlot = { slotNumber: number; generation: number; active: SlotDraw | null; voided: SlotDraw[] };
export type ConsolePrize = SnapshotPrize & { slots: ConsoleSlot[]; nextSlot: number | null };

export async function consoleState(database: Db, preparationId: string): Promise<ConsolePrize[]> {
  const preparation = await database.rafflePreparation.findUnique({ where: { id: preparationId }, select: { prizesJson: true } });
  if (!preparation?.prizesJson) return [];
  const prizes = parsePrizesSnapshot(preparation.prizesJson).prizes;
  const draws = await database.draw.findMany({
    where: { preparationId },
    orderBy: { sequence: "asc" },
    include: {
      winner: { include: { participant: { select: { id: true, fullName: true, externalId: true, department: true } } } },
      correction: true,
    },
  });
  return prizes.map((prize) => {
    const slots: ConsoleSlot[] = Array.from({ length: prize.quantity }, (_, index) => ({ slotNumber: index + 1, generation: 0, active: null, voided: [] }));
    for (const draw of draws) {
      if (draw.prizeId !== prize.id) continue;
      const slot = slots[draw.slotNumber - 1];
      if (!slot) continue;
      const entry: SlotDraw = {
        drawId: draw.id,
        sequence: draw.sequence,
        status: draw.status,
        targetRound: draw.beaconRound?.toString() ?? "",
        participant: draw.winner?.participant ?? null,
        correction: draw.correction ? { category: draw.correction.reasonCategory, reason: draw.correction.reasonText, createdAt: draw.correction.createdAt } : null,
      };
      if (draw.status === "VOIDED") {
        slot.voided.push(entry);
        slot.generation += 1;
      } else {
        slot.active = entry;
      }
    }
    const open = slots.find((slot) => slot.active === null);
    return { ...prize, slots, nextSlot: open?.slotNumber ?? null };
  });
}

export async function buildBundle(database: Db, preparationId: string): Promise<VerificationBundle | null> {
  const preparation = await database.rafflePreparation.findUnique({ where: { id: preparationId } });
  if (!preparation || !preparation.participantsJson || !preparation.prizesJson || !preparation.rulesJson) return null;
  const draws = await database.draw.findMany({ where: { preparationId }, orderBy: { sequence: "asc" }, include: { winner: true } });
  const corrections = await database.winnerCorrection.findMany({ where: { preparationId }, orderBy: { createdAt: "asc" } });
  return {
    format: BUNDLE_FORMAT,
    preparation: {
      id: preparation.id,
      eventId: preparation.eventId,
      version: preparation.version,
      status: preparation.status,
      algorithmVersion: preparation.algorithmVersion,
      frozenAt: preparation.frozenAt?.toISOString() ?? null,
      participantsSha256: hex(preparation.participantsSha256),
      prizesSha256: hex(preparation.prizesSha256),
      rulesSha256: hex(preparation.rulesSha256),
      manifestSha256: hex(preparation.manifestSha256),
      seedCommitment: hex(preparation.seedCommitment),
      revealedSeed: preparation.revealedSeed ? hex(preparation.revealedSeed) : null,
      participantCount: preparation.participantCount ?? 0,
      slotCount: preparation.slotCount ?? 0,
      statusReason: preparation.statusReason,
    },
    snapshots: { participants: preparation.participantsJson, prizes: preparation.prizesJson, rules: preparation.rulesJson },
    draws: draws.map((draw) => ({
      id: draw.id,
      sequence: draw.sequence,
      prizeId: draw.prizeId,
      slotNumber: draw.slotNumber,
      status: draw.status,
      beaconRound: (draw.beaconRound ?? 0n).toString(),
      beaconSignature: draw.beaconSignature ? hex(draw.beaconSignature) : null,
      candidateCount: draw.candidateCount,
      candidateListSha256: draw.candidateListSha256 ? hex(draw.candidateListSha256) : null,
      selectedIndex: draw.selectedIndex,
      participantId: draw.winner?.participantId ?? null,
      committedAt: draw.committedAt?.toISOString() ?? null,
    })),
    corrections: corrections.map((correction) => ({
      drawId: correction.drawId,
      afterSequence: correction.afterSequence,
      reasonCategory: correction.reasonCategory,
      reasonText: correction.reasonText,
      createdAt: correction.createdAt.toISOString(),
    })),
  };
}

export async function publicPreparation(database: Db, preparationId: string) {
  const preparation = await database.rafflePreparation.findUnique({
    where: { id: preparationId },
    select: { id: true, status: true, event: { select: { id: true, name: true, status: true, slug: true } } },
  });
  if (!preparation || preparation.status === "DRAFT" || preparation.event.status === "DRAFT") return null;
  return preparation;
}

export async function publicWinnerNames(database: Db, preparationId: string) {
  const winners = await database.winner.findMany({
    where: { preparationId },
    select: { participantId: true, participant: { select: { fullName: true } } },
  });
  return Object.fromEntries(winners.map((winner) => [winner.participantId, winner.participant.fullName]));
}
