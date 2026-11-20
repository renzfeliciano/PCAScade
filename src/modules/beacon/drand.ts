import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export const QUICKNET = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  schemeId: "bls-unchained-g1-rfc9380",
  genesisTime: 1692803367,
  period: 3,
  dst: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
} as const;

export type BeaconRound = {
  chainHash: string;
  round: bigint;
  signature: Uint8Array;
  randomness: Uint8Array;
};

export class BeaconVerificationError extends Error {
  readonly code = "BEACON_INVALID";
}

export class BeaconUnavailableError extends Error {
  readonly code = "BEACON_UNAVAILABLE";
  constructor(
    message: string,
    readonly failures: readonly string[],
  ) {
    super(message);
  }
}

function roundMessage(round: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, round);
  return sha256(bytes);
}

export function verifyQuicknetRound(round: bigint, signatureHex: string, randomnessHex?: string): BeaconRound {
  if (round < 1n) {
    throw new BeaconVerificationError("round must be positive");
  }
  if (!/^[0-9a-f]{96}$/.test(signatureHex)) {
    throw new BeaconVerificationError("signature must be 48 bytes of lowercase hex");
  }
  const signature = hexToBytes(signatureHex);
  let valid: boolean;
  try {
    const message = bls12_381.shortSignatures.hash(roundMessage(round), QUICKNET.dst);
    valid = bls12_381.shortSignatures.verify(signature, message, hexToBytes(QUICKNET.publicKey));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new BeaconVerificationError(`signature for round ${round} does not verify against the quicknet public key`);
  }
  const randomness = sha256(signature);
  if (randomnessHex !== undefined && bytesToHex(randomness) !== randomnessHex) {
    throw new BeaconVerificationError(`randomness for round ${round} is not sha256(signature)`);
  }
  return { chainHash: QUICKNET.chainHash, round, signature, randomness };
}

export function roundAt(unixMs: number): bigint {
  const elapsed = Math.floor(unixMs / 1000) - QUICKNET.genesisTime;
  if (elapsed < 0) return 0n;
  return BigInt(Math.floor(elapsed / QUICKNET.period) + 1);
}

export function roundTime(round: bigint): number {
  return (QUICKNET.genesisTime + Number(round - 1n) * QUICKNET.period) * 1000;
}

type RoundPayload = { round: number; randomness: string; signature: string };

function isRoundPayload(value: unknown): value is RoundPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.round === "number" &&
    typeof candidate.randomness === "string" &&
    typeof candidate.signature === "string"
  );
}

export type FetchRoundOptions = {
  relays: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  maxLagRounds?: bigint;
};

export async function fetchRound(round: bigint | "latest", options: FetchRoundOptions): Promise<BeaconRound> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;
  const path = round === "latest" ? "latest" : round.toString();
  const failures: string[] = [];
  for (const relay of options.relays) {
    const url = `${relay.replace(/\/+$/, "")}/${QUICKNET.chainHash}/public/${path}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!response.ok) {
        failures.push(`${relay}: HTTP ${response.status}`);
        continue;
      }
      const body: unknown = await response.json();
      if (!isRoundPayload(body)) {
        failures.push(`${relay}: malformed response`);
        continue;
      }
      const returnedRound = BigInt(body.round);
      if (round !== "latest" && returnedRound !== round) {
        failures.push(`${relay}: returned round ${returnedRound} instead of ${round}`);
        continue;
      }
      if (round === "latest") {
        const expected = roundAt((options.now ?? Date.now)());
        if (returnedRound < expected - (options.maxLagRounds ?? 2n)) {
          failures.push(`${relay}: stale latest round ${returnedRound}, expected about ${expected}`);
          continue;
        }
      }
      return verifyQuicknetRound(returnedRound, body.signature, body.randomness);
    } catch (error) {
      failures.push(`${relay}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new BeaconUnavailableError(`no relay returned a verified quicknet round ${path}`, failures);
}
