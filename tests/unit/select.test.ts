import { createHash, createHmac } from "node:crypto";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import {
  candidateListDigest,
  deriveSelectionKey,
  pickUnbiased,
  rejectionLimit,
  selectIndex,
  sortCandidates,
  type SelectionInputs,
} from "@/modules/raffle/domain/select";

function keyFor(counter: number): Uint8Array {
  return new Uint8Array(createHash("sha256").update(`key-${counter}`).digest());
}

const baseInputs: SelectionInputs = {
  preparationId: "0193a1b2-0000-7000-8000-000000000001",
  participantsSha256: new Uint8Array(32).fill(1),
  rulesSha256: new Uint8Array(32).fill(2),
  drawSequence: 1,
  prizeId: "0193a1b2-0000-7000-8000-000000000002",
  slotNumber: 1,
  candidateListSha256: new Uint8Array(32).fill(3),
  serverSeed: new Uint8Array(32).fill(4),
  beaconRound: 34123389n,
  beaconRandomness: new Uint8Array(32).fill(5),
};

describe("selectIndex", () => {
  it("is deterministic for the same key", () => {
    const key = keyFor(1);
    expect(selectIndex(key, 97)).toEqual(selectIndex(key, 97));
  });

  it("returns the first accepted uint64 of HMAC block 0 reduced mod n", () => {
    const key = keyFor(2);
    const n = 1000;
    const block = hmac(sha256, key, new Uint8Array([0, 0, 0, 0]));
    const first = new DataView(block.buffer, block.byteOffset).getBigUint64(0);
    const limit = ((1n << 64n) / BigInt(n)) * BigInt(n);
    expect(first < limit).toBe(true);
    expect(selectIndex(key, n)).toEqual({ index: Number(first % BigInt(n)), attempts: 1 });
  });

  it("always returns 0 when there is a single candidate", () => {
    for (let counter = 0; counter < 50; counter++) {
      expect(selectIndex(keyFor(counter), 1).index).toBe(0);
    }
  });

  it("stays within range for awkward candidate counts", () => {
    for (const n of [2, 3, 7, 1000, 65537, 0xffffffff]) {
      for (let counter = 0; counter < 200; counter++) {
        const { index } = selectIndex(keyFor(counter), n);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(n);
      }
    }
  });

  it("discards stream values at or above the rejection limit instead of reducing them mod n", () => {
    const n = 3;
    const limit = rejectionLimit(n);
    expect(limit).toBe(18446744073709551615n);
    const biasedIfReduced = (1n << 64n) - 1n;
    expect(biasedIfReduced >= limit).toBe(true);
    expect(pickUnbiased([biasedIfReduced, biasedIfReduced, 7n], n)).toEqual({ index: 1, attempts: 3 });
    expect(pickUnbiased([limit - 1n], n)).toEqual({ index: Number((limit - 1n) % 3n), attempts: 1 });
  });

  it("fails loudly instead of returning a biased index when the stream runs out", () => {
    const limit = rejectionLimit(3);
    expect(() => pickUnbiased([limit, limit], 3)).toThrow(/exhausted/);
  });

  it("rejects invalid candidate counts", () => {
    expect(() => selectIndex(keyFor(0), 0)).toThrow(RangeError);
    expect(() => selectIndex(keyFor(0), 1.5)).toThrow(RangeError);
    expect(() => selectIndex(keyFor(0), 2 ** 32)).toThrow(RangeError);
  });

  it("is statistically uniform (chi-square, 7 buckets, 70,000 deterministic keys)", () => {
    const n = 7;
    const samples = 70_000;
    const counts = new Array<number>(n).fill(0);
    for (let counter = 0; counter < samples; counter++) {
      const { index } = selectIndex(keyFor(counter), n);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    const expected = samples / n;
    const chiSquare = counts.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(22.458);
  });
});

describe("deriveSelectionKey", () => {
  it("changes when any single input changes", () => {
    const reference = Buffer.from(deriveSelectionKey(baseInputs)).toString("hex");
    const variants: Partial<SelectionInputs>[] = [
      { preparationId: "0193a1b2-0000-7000-8000-000000000009" },
      { participantsSha256: new Uint8Array(32).fill(9) },
      { rulesSha256: new Uint8Array(32).fill(9) },
      { drawSequence: 2 },
      { prizeId: "0193a1b2-0000-7000-8000-000000000009" },
      { slotNumber: 2 },
      { candidateListSha256: new Uint8Array(32).fill(9) },
      { serverSeed: new Uint8Array(32).fill(9) },
      { beaconRound: 34123390n },
      { beaconRandomness: new Uint8Array(32).fill(9) },
    ];
    for (const variant of variants) {
      const changed = Buffer.from(deriveSelectionKey({ ...baseInputs, ...variant })).toString("hex");
      expect(changed).not.toBe(reference);
    }
  });

  it("length-prefixes fields so concatenation boundaries cannot collide", () => {
    const a = deriveSelectionKey({ ...baseInputs, preparationId: "ab", prizeId: "c" });
    const b = deriveSelectionKey({ ...baseInputs, preparationId: "a", prizeId: "bc" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("pcascade-select-v1 known-answer vector", () => {
  function lengthPrefixed(bytes: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  }

  function u32(value: number): Buffer {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    return out;
  }

  function u64(value: bigint): Buffer {
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(value);
    return out;
  }

  function referenceKey(): Buffer {
    const candidateList = createHash("sha256")
      .update(Buffer.concat(["a", "b", "c"].map((id) => lengthPrefixed(Buffer.from(id, "utf8")))))
      .digest();
    const fields = [
      Buffer.from("PCASCADE/select/v1", "utf8"),
      Buffer.from("0193a1b2-0000-7000-8000-000000000001", "utf8"),
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
      u32(1),
      Buffer.from("0193a1b2-0000-7000-8000-000000000002", "utf8"),
      u32(1),
      candidateList,
      Buffer.alloc(32, 4),
      u64(34123389n),
      Buffer.alloc(32, 5),
    ];
    return createHash("sha256").update(Buffer.concat(fields.map(lengthPrefixed))).digest();
  }

  function referenceIndex(key: Buffer, n: number): number {
    const limit = ((1n << 64n) / BigInt(n)) * BigInt(n);
    for (let block = 0; ; block++) {
      const stream = createHmac("sha256", key).update(u32(block)).digest();
      for (let offset = 0; offset < 32; offset += 8) {
        const value = stream.readBigUInt64BE(offset);
        if (value < limit) return Number(value % BigInt(n));
      }
    }
  }

  const pinnedKey = "bed6b8294daaa7ddc71f520e913e5dd8a4d417d1b35d4066dc944b1349395843";
  const productionKey = deriveSelectionKey({
    ...baseInputs,
    candidateListSha256: candidateListDigest(["a", "b", "c"]),
  });

  it("matches an independent reference implementation of the written spec", () => {
    expect(referenceKey().toString("hex")).toBe(pinnedKey);
    expect(Buffer.from(candidateListDigest(["a", "b", "c"])).toString("hex")).toBe(
      "db0a8b920d42f074b0a75e382383d31fe730dd7d49e915a452f71b020e8417dc",
    );
    for (const n of [3, 1000, 4294967295]) {
      expect(selectIndex(productionKey, n).index).toBe(referenceIndex(referenceKey(), n));
    }
  });

  it("produces the pinned outputs so recorded draws stay verifiable", () => {
    expect(Buffer.from(productionKey).toString("hex")).toBe(pinnedKey);
    expect(selectIndex(productionKey, 3).index).toBe(1);
    expect(selectIndex(productionKey, 1000).index).toBe(954);
    expect(selectIndex(productionKey, 4294967295).index).toBe(3240196024);
  });
});

describe("candidate list", () => {
  it("sorts ids bytewise regardless of input order", () => {
    expect(sortCandidates(["c", "a", "b"])).toEqual(["a", "b", "c"]);
    expect(sortCandidates(["B", "a"])).toEqual(["B", "a"]);
  });

  it("digest depends on order and membership", () => {
    const base = Buffer.from(candidateListDigest(["a", "b"])).toString("hex");
    expect(Buffer.from(candidateListDigest(["b", "a"])).toString("hex")).not.toBe(base);
    expect(Buffer.from(candidateListDigest(["a", "b", "c"])).toString("hex")).not.toBe(base);
    expect(Buffer.from(candidateListDigest(["ab"])).toString("hex")).not.toBe(Buffer.from(candidateListDigest(["a", "b"])).toString("hex"));
  });
});
