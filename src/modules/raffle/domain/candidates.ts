import type { RaffleRules, SnapshotParticipant, SnapshotPrize } from "@/modules/raffle/domain/snapshot";
import { sortCandidates } from "@/modules/raffle/domain/select";

export type HistoryEntry = {
  sequence: number;
  prizeId: string;
  participantId: string | null;
  voidedAfterSequence: number | null;
};

function categoryGroup(prize: Pick<SnapshotPrize, "categoryId">): string {
  return prize.categoryId ?? "uncategorized";
}

export function exclusivityKey(rules: RaffleRules, participantId: string, prize: Pick<SnapshotPrize, "categoryId">): string | null {
  if (rules.repeatWinners === "never") return participantId;
  if (rules.repeatWinners === "per_category") return `${participantId}:${categoryGroup(prize)}`;
  return null;
}

export function eligibleForPrize(participants: readonly SnapshotParticipant[], prize: Pick<SnapshotPrize, "eligibility">): SnapshotParticipant[] {
  if (prize.eligibility.departments.length === 0) return [...participants];
  const allowed = new Set(prize.eligibility.departments.map((department) => department.toLowerCase()));
  return participants.filter((participant) => participant.department !== null && allowed.has(participant.department.toLowerCase()));
}

export type CandidateInput = {
  participants: readonly SnapshotParticipant[];
  prizes: readonly SnapshotPrize[];
  rules: RaffleRules;
  prize: SnapshotPrize;
  sequence: number;
  history: readonly HistoryEntry[];
};

export function candidatesFor(input: CandidateInput): string[] {
  const prizesById = new Map(input.prizes.map((prize) => [prize.id, prize]));
  const excluded = new Set<string>();
  const group = categoryGroup(input.prize);
  for (const entry of input.history) {
    if (entry.sequence >= input.sequence || entry.participantId === null) continue;
    const voidedBefore = entry.voidedAfterSequence !== null && entry.voidedAfterSequence < input.sequence;
    if (voidedBefore) {
      if (input.rules.voidedWinnerRedraw === "excluded" && entry.prizeId === input.prize.id) excluded.add(entry.participantId);
      continue;
    }
    if (input.rules.repeatWinners === "never") excluded.add(entry.participantId);
    if (input.rules.repeatWinners === "per_category") {
      const won = prizesById.get(entry.prizeId);
      if (won && categoryGroup(won) === group) excluded.add(entry.participantId);
    }
  }
  return sortCandidates(eligibleForPrize(input.participants, input.prize).map((participant) => participant.id).filter((id) => !excluded.has(id)));
}
