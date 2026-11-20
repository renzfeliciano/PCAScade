import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const SELECT_ALGORITHM_VERSION = "pcascade-select-v1";

const DOMAIN_TAG = utf8ToBytes("PCASCADE/select/v1");
const TWO_POW_64 = 1n << 64n;
const MAX_BLOCKS = 1024;

export type SelectionInputs = {
  preparationId: string;
  participantsSha256: Uint8Array;
  rulesSha256: Uint8Array;
  drawSequence: number;
  prizeId: string;
  slotNumber: number;
  candidateListSha256: Uint8Array;
  serverSeed: Uint8Array;
  beaconRound: bigint;
  beaconRandomness: Uint8Array;
};

function uint32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`value ${value} does not fit in uint32`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function uint64be(value: bigint): Uint8Array {
  if (value < 0n || value >= TWO_POW_64) {
    throw new RangeError(`value ${value} does not fit in uint64`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value);
  return out;
}

function field(bytes: Uint8Array): Uint8Array {
  return concatBytes(uint32be(bytes.length), bytes);
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function candidateListDigest(sortedCandidateIds: readonly string[]): Uint8Array {
  return sha256(concatBytes(...sortedCandidateIds.map((id) => field(utf8ToBytes(id)))));
}

export function sortCandidates(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function deriveSelectionKey(inputs: SelectionInputs): Uint8Array {
  return sha256(
    concatBytes(
      field(DOMAIN_TAG),
      field(utf8ToBytes(inputs.preparationId)),
      field(inputs.participantsSha256),
      field(inputs.rulesSha256),
      field(uint32be(inputs.drawSequence)),
      field(utf8ToBytes(inputs.prizeId)),
      field(uint32be(inputs.slotNumber)),
      field(inputs.candidateListSha256),
      field(inputs.serverSeed),
      field(uint64be(inputs.beaconRound)),
      field(inputs.beaconRandomness),
    ),
  );
}

export type IndexSelection = { index: number; attempts: number };

export function* selectionStream(key: Uint8Array): Generator<bigint, void, undefined> {
  for (let block = 0; block < MAX_BLOCKS; block++) {
    const bytes = hmac(sha256, key, uint32be(block));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.length; offset += 8) {
      yield view.getBigUint64(offset);
    }
  }
}

export function rejectionLimit(candidateCount: number): bigint {
  const n = BigInt(candidateCount);
  return (TWO_POW_64 / n) * n;
}

export function pickUnbiased(stream: Iterable<bigint>, candidateCount: number): IndexSelection {
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 0xffffffff) {
    throw new RangeError("candidateCount must be an integer between 1 and 2^32 - 1");
  }
  const n = BigInt(candidateCount);
  const limit = rejectionLimit(candidateCount);
  let attempts = 0;
  for (const value of stream) {
    attempts++;
    if (value < 0n || value >= TWO_POW_64) throw new RangeError("stream values must be uint64");
    if (value < limit) {
      return { index: Number(value % n), attempts };
    }
  }
  throw new Error("selection stream exhausted");
}

export function selectIndex(key: Uint8Array, candidateCount: number): IndexSelection {
  return pickUnbiased(selectionStream(key), candidateCount);
}
