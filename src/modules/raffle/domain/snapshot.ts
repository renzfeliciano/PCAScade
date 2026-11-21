import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { canonicalJson } from "@/modules/audit/domain/chain";
import { QUICKNET } from "@/modules/beacon/drand";
import { SELECT_ALGORITHM_VERSION } from "@/modules/raffle/domain/select";

export const SNAPSHOT_VERSION = 1;
export const BEACON_LEAD_ROUNDS = 2;
export const DEFAULT_SCENE_KEY = "brick-by-brick";

export const REPEAT_WINNER_OPTIONS = [
  { key: "never", label: "Once per raffle", hint: "A participant can win at most one prize." },
  { key: "per_category", label: "Once per category", hint: "A participant can win again, but only in a different prize category." },
  { key: "allowed", label: "No limit", hint: "A participant can win any number of prizes." },
] as const;

export const VOIDED_WINNER_OPTIONS = [
  { key: "excluded", label: "Excluded from the redraw", hint: "A winner whose draw was reset cannot win the same prize again." },
  { key: "allowed", label: "Included in the redraw", hint: "A winner whose draw was reset stays in the pool for the same prize." },
] as const;

export const raffleRulesSchema = z
  .object({
    repeatWinners: z.enum(["never", "per_category", "allowed"]).default("never"),
    voidedWinnerRedraw: z.enum(["excluded", "allowed"]).default("excluded"),
  })
  .strict();

export type RaffleRules = z.infer<typeof raffleRulesSchema>;

export const eligibilityRuleSchema = z
  .object({
    departments: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  })
  .strict();

export type EligibilityRule = z.infer<typeof eligibilityRuleSchema>;

export function parseEligibilityRule(value: unknown): EligibilityRule {
  const parsed = eligibilityRuleSchema.safeParse(value ?? {});
  if (!parsed.success) return { departments: [] };
  const seen = new Set<string>();
  const departments: string[] = [];
  for (const department of parsed.data.departments) {
    const key = department.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    departments.push(department);
  }
  departments.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { departments };
}

const participantSchema = z.object({ id: z.string().min(1), department: z.string().nullable() }).strict();

const prizeSchema = z
  .object({
    id: z.string().min(1),
    code: z.string(),
    name: z.string(),
    quantity: z.number().int().min(1),
    drawOrder: z.number().int().min(1),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    sceneKey: z.string(),
    eligibility: eligibilityRuleSchema,
  })
  .strict();

const participantsSnapshotSchema = z
  .object({ kind: z.literal("participants"), version: z.literal(SNAPSHOT_VERSION), eventId: z.string(), participants: z.array(participantSchema) })
  .strict();

const prizesSnapshotSchema = z
  .object({ kind: z.literal("prizes"), version: z.literal(SNAPSHOT_VERSION), eventId: z.string(), prizes: z.array(prizeSchema) })
  .strict();

const rulesSnapshotSchema = z
  .object({
    kind: z.literal("rules"),
    version: z.literal(SNAPSHOT_VERSION),
    algorithm: z.literal(SELECT_ALGORITHM_VERSION),
    randomness: z.object({ source: z.literal("drand-quicknet"), chainHash: z.string(), leadRounds: z.number().int() }).strict(),
    rules: raffleRulesSchema,
  })
  .strict();

export type SnapshotParticipant = z.infer<typeof participantSchema>;
export type SnapshotPrize = z.infer<typeof prizeSchema>;
export type ParticipantsSnapshot = z.infer<typeof participantsSnapshotSchema>;
export type PrizesSnapshot = z.infer<typeof prizesSnapshotSchema>;
export type RulesSnapshot = z.infer<typeof rulesSnapshotSchema>;

export type SealedText = { text: string; sha256: Uint8Array };

export function textDigest(text: string): Uint8Array {
  return sha256(utf8ToBytes(text));
}

function seal(value: unknown): SealedText {
  const text = canonicalJson(value);
  return { text, sha256: textDigest(text) };
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function participantsSnapshot(eventId: string, participants: readonly { id: string; department: string | null }[]): SealedText {
  const rows = byId(participants.map((participant) => ({ id: participant.id, department: participant.department?.trim() || null })));
  return seal({ kind: "participants", version: SNAPSHOT_VERSION, eventId, participants: rows });
}

export type PrizeSnapshotInput = {
  id: string;
  code: string;
  name: string;
  quantity: number;
  drawOrder: number;
  categoryId: string | null;
  categoryName: string | null;
  sceneKey: string | null;
  eligibilityRule: unknown;
};

export function prizesSnapshot(eventId: string, prizes: readonly PrizeSnapshotInput[]): SealedText {
  const rows = [...prizes]
    .sort((a, b) => a.drawOrder - b.drawOrder || (a.id < b.id ? -1 : 1))
    .map((prize) => ({
      id: prize.id,
      code: prize.code,
      name: prize.name,
      quantity: prize.quantity,
      drawOrder: prize.drawOrder,
      categoryId: prize.categoryId,
      categoryName: prize.categoryName,
      sceneKey: prize.sceneKey ?? DEFAULT_SCENE_KEY,
      eligibility: parseEligibilityRule(prize.eligibilityRule),
    }));
  return seal({ kind: "prizes", version: SNAPSHOT_VERSION, eventId, prizes: rows });
}

export function rulesSnapshot(rules: RaffleRules): SealedText {
  return seal({
    kind: "rules",
    version: SNAPSHOT_VERSION,
    algorithm: SELECT_ALGORITHM_VERSION,
    randomness: { source: "drand-quicknet", chainHash: QUICKNET.chainHash, leadRounds: BEACON_LEAD_ROUNDS },
    rules: raffleRulesSchema.parse(rules),
  });
}

export function parseParticipantsSnapshot(text: string): ParticipantsSnapshot {
  return participantsSnapshotSchema.parse(JSON.parse(text));
}

export function parsePrizesSnapshot(text: string): PrizesSnapshot {
  return prizesSnapshotSchema.parse(JSON.parse(text));
}

export function parseRulesSnapshot(text: string): RulesSnapshot {
  return rulesSnapshotSchema.parse(JSON.parse(text));
}

export type ManifestInput = {
  preparationId: string;
  eventId: string;
  version: number;
  participantsSha256: Uint8Array;
  prizesSha256: Uint8Array;
  rulesSha256: Uint8Array;
  seedCommitment: Uint8Array;
  participantCount: number;
  prizeCount: number;
  slotCount: number;
};

export function manifest(input: ManifestInput): SealedText {
  return seal({
    kind: "pre-draw-manifest",
    version: SNAPSHOT_VERSION,
    algorithm: SELECT_ALGORITHM_VERSION,
    preparationId: input.preparationId,
    eventId: input.eventId,
    preparationVersion: input.version,
    participantsSha256: input.participantsSha256,
    prizesSha256: input.prizesSha256,
    rulesSha256: input.rulesSha256,
    seedCommitment: input.seedCommitment,
    participantCount: input.participantCount,
    prizeCount: input.prizeCount,
    slotCount: input.slotCount,
  });
}
