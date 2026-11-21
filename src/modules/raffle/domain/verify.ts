import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { BeaconVerificationError, verifyQuicknetRound } from "@/modules/beacon/drand";
import { type HistoryEntry, candidatesFor } from "@/modules/raffle/domain/candidates";
import { bytesEqual, seedCommitment } from "@/modules/raffle/domain/roster";
import { SELECT_ALGORITHM_VERSION, candidateListDigest, deriveSelectionKey, selectIndex } from "@/modules/raffle/domain/select";
import { manifest, parseParticipantsSnapshot, parsePrizesSnapshot, parseRulesSnapshot, textDigest } from "@/modules/raffle/domain/snapshot";

export const BUNDLE_FORMAT = "pcascade-verification-bundle/v1";

const hex = z.string().regex(/^([0-9a-f]{2})*$/);

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  preparation: z.object({
    id: z.string(),
    eventId: z.string(),
    version: z.number().int(),
    status: z.string(),
    algorithmVersion: z.string(),
    frozenAt: z.string().nullable(),
    participantsSha256: hex,
    prizesSha256: hex,
    rulesSha256: hex,
    manifestSha256: hex,
    seedCommitment: hex,
    revealedSeed: hex.nullable(),
    participantCount: z.number().int(),
    slotCount: z.number().int(),
    statusReason: z.string().nullable(),
  }),
  snapshots: z.object({ participants: z.string(), prizes: z.string(), rules: z.string() }),
  draws: z.array(
    z.object({
      id: z.string(),
      sequence: z.number().int(),
      prizeId: z.string(),
      slotNumber: z.number().int(),
      status: z.enum(["PENDING_BEACON", "COMMITTED", "FAILED", "VOIDED"]),
      beaconRound: z.string().regex(/^\d+$/),
      beaconSignature: hex.nullable(),
      candidateCount: z.number().int().nullable(),
      candidateListSha256: hex.nullable(),
      selectedIndex: z.number().int().nullable(),
      participantId: z.string().nullable(),
      committedAt: z.string().nullable(),
    }),
  ),
  corrections: z.array(
    z.object({
      drawId: z.string(),
      afterSequence: z.number().int(),
      reasonCategory: z.string(),
      reasonText: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export type VerificationBundle = z.infer<typeof bundleSchema>;

export type CheckResult = { ok: true } | { ok: false; reason: string } | { ok: null; reason: string };

export type DrawCheck = {
  sequence: number;
  drawId: string;
  prizeId: string;
  slotNumber: number;
  status: string;
  beacon: CheckResult;
  candidates: CheckResult;
  result: CheckResult;
};

export type BundleReport = {
  snapshots: CheckResult;
  manifest: CheckResult;
  seed: CheckResult;
  draws: DrawCheck[];
  ok: boolean;
  complete: boolean;
};

const pass: CheckResult = { ok: true };
const fail = (reason: string): CheckResult => ({ ok: false, reason });
const skipped = (reason: string): CheckResult => ({ ok: null, reason });

function same(a: string, b: Uint8Array): boolean {
  return a === bytesToHex(b);
}

export function verifyBundle(input: unknown): BundleReport {
  const bundle = bundleSchema.parse(input);
  const prep = bundle.preparation;

  const snapshotProblems: string[] = [];
  if (prep.algorithmVersion !== SELECT_ALGORITHM_VERSION) snapshotProblems.push(`unsupported algorithm ${prep.algorithmVersion}`);
  if (!same(prep.participantsSha256, textDigest(bundle.snapshots.participants))) snapshotProblems.push("participant snapshot does not match its hash");
  if (!same(prep.prizesSha256, textDigest(bundle.snapshots.prizes))) snapshotProblems.push("prize snapshot does not match its hash");
  if (!same(prep.rulesSha256, textDigest(bundle.snapshots.rules))) snapshotProblems.push("rules snapshot does not match its hash");

  let participants: ReturnType<typeof parseParticipantsSnapshot>["participants"] = [];
  let prizes: ReturnType<typeof parsePrizesSnapshot>["prizes"] = [];
  let rules: ReturnType<typeof parseRulesSnapshot>["rules"] | null = null;
  try {
    const parsedParticipants = parseParticipantsSnapshot(bundle.snapshots.participants);
    const parsedPrizes = parsePrizesSnapshot(bundle.snapshots.prizes);
    const parsedRules = parseRulesSnapshot(bundle.snapshots.rules);
    if (parsedParticipants.eventId !== prep.eventId || parsedPrizes.eventId !== prep.eventId) snapshotProblems.push("a snapshot belongs to another event");
    participants = parsedParticipants.participants;
    prizes = parsedPrizes.prizes;
    rules = parsedRules.rules;
  } catch {
    snapshotProblems.push("a snapshot is not in the expected format");
  }
  const snapshots = snapshotProblems.length === 0 ? pass : fail(snapshotProblems.join("; "));

  const sealed = manifest({
    preparationId: prep.id,
    eventId: prep.eventId,
    version: prep.version,
    participantsSha256: hexToBytes(prep.participantsSha256),
    prizesSha256: hexToBytes(prep.prizesSha256),
    rulesSha256: hexToBytes(prep.rulesSha256),
    seedCommitment: hexToBytes(prep.seedCommitment),
    participantCount: participants.length,
    prizeCount: prizes.length,
    slotCount: prizes.reduce((sum, prize) => sum + prize.quantity, 0),
  });
  const manifestCheck =
    same(prep.manifestSha256, sealed.sha256) && participants.length === prep.participantCount ? pass : fail("the pre-draw manifest hash does not match the snapshots");

  let seed: Uint8Array | null = null;
  let seedCheck: CheckResult = skipped("The server seed is revealed when the raffle is completed, cancelled or replaced.");
  if (prep.revealedSeed !== null) {
    const candidate = hexToBytes(prep.revealedSeed);
    if (bytesEqual(seedCommitment(candidate), hexToBytes(prep.seedCommitment))) {
      seed = candidate;
      seedCheck = pass;
    } else {
      seedCheck = fail("the revealed seed does not match the commitment published at freeze");
    }
  }

  const voidedAfter = new Map(bundle.corrections.map((correction) => [correction.drawId, correction.afterSequence]));
  const ordered = [...bundle.draws].sort((a, b) => a.sequence - b.sequence);
  const history: HistoryEntry[] = ordered.map((draw) => ({
    sequence: draw.sequence,
    prizeId: draw.prizeId,
    participantId: draw.participantId,
    voidedAfterSequence: voidedAfter.get(draw.id) ?? null,
  }));
  const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));

  const draws: DrawCheck[] = ordered.map((draw) => {
    const base = { sequence: draw.sequence, drawId: draw.id, prizeId: draw.prizeId, slotNumber: draw.slotNumber, status: draw.status };
    if (draw.participantId === null || draw.beaconSignature === null || draw.candidateListSha256 === null || draw.selectedIndex === null) {
      const reason = draw.status === "PENDING_BEACON" ? "Waiting for the beacon round." : "This draw was voided before a winner was chosen.";
      return { ...base, beacon: skipped(reason), candidates: skipped(reason), result: skipped(reason) };
    }
    let beacon: CheckResult = pass;
    let randomness: Uint8Array | null = null;
    try {
      randomness = verifyQuicknetRound(BigInt(draw.beaconRound), draw.beaconSignature).randomness;
    } catch (error) {
      beacon = fail(error instanceof BeaconVerificationError ? error.message : "the beacon signature could not be checked");
    }
    const prize = prizeById.get(draw.prizeId);
    if (!prize || rules === null) return { ...base, beacon, candidates: fail("the prize is not in the frozen prize snapshot"), result: fail("cannot recompute") };
    if (draw.slotNumber < 1 || draw.slotNumber > prize.quantity) return { ...base, beacon, candidates: fail("slot number is outside the prize quantity"), result: fail("cannot recompute") };

    const candidates = candidatesFor({ participants, prizes, rules, prize, sequence: draw.sequence, history });
    const listSha = candidateListDigest(candidates);
    const candidatesCheck =
      same(draw.candidateListSha256, listSha) && draw.candidateCount === candidates.length
        ? pass
        : fail(`expected ${candidates.length} candidates with a different list hash than the one recorded`);

    let result: CheckResult;
    if (seed === null) result = skipped("Needs the revealed server seed.");
    else if (randomness === null) result = fail("cannot recompute without a valid beacon");
    else if (candidatesCheck.ok !== true) result = fail("cannot recompute with a different candidate list");
    else {
      const key = deriveSelectionKey({
        preparationId: prep.id,
        participantsSha256: hexToBytes(prep.participantsSha256),
        rulesSha256: hexToBytes(prep.rulesSha256),
        drawSequence: draw.sequence,
        prizeId: draw.prizeId,
        slotNumber: draw.slotNumber,
        candidateListSha256: listSha,
        serverSeed: seed,
        beaconRound: BigInt(draw.beaconRound),
        beaconRandomness: randomness,
      });
      const { index } = selectIndex(key, candidates.length);
      result =
        index === draw.selectedIndex && candidates[index] === draw.participantId
          ? pass
          : fail(`recomputed index ${index} (${candidates[index] ?? "none"}) differs from the recorded index ${draw.selectedIndex}`);
    }
    return { ...base, beacon, candidates: candidatesCheck, result };
  });

  const all = [snapshots, manifestCheck, seedCheck, ...draws.flatMap((draw) => [draw.beacon, draw.candidates, draw.result])];
  const ok = all.every((check) => check.ok !== false);
  return { snapshots, manifest: manifestCheck, seed: seedCheck, draws, ok, complete: ok && seedCheck.ok === true };
}
