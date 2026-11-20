import { describe, expect, it } from "vitest";
import {
  type AuditRecord,
  GENESIS_HASH,
  type StoredAuditRecord,
  auditRecordHash,
  canonicalJson,
  verifyChainSegment,
} from "@/modules/audit/domain/chain";

function record(index: number): AuditRecord {
  return {
    eventId: null,
    actor: "admin",
    action: `test.action_${index}`,
    entityType: "event",
    entityId: `entity-${index}`,
    payload: canonicalJson({ index, note: "unit" }),
    createdAt: new Date(Date.UTC(2026, 10, 20, 0, 0, index)).toISOString(),
  };
}

function buildChain(length: number): StoredAuditRecord[] {
  const rows: StoredAuditRecord[] = [];
  let previous: Uint8Array = GENESIS_HASH;
  for (let index = 0; index < length; index++) {
    const base = record(index);
    const hash = auditRecordHash(previous, base);
    rows.push({ ...base, seq: BigInt(index + 1), prevHash: previous, hash });
    previous = hash;
  }
  return rows;
}

describe("canonicalJson", () => {
  it("is independent of key order and serializes bigint, Date and bytes deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ round: 34123389n, at: new Date("2026-11-20T00:00:00.000Z"), bytes: new Uint8Array([1, 255]) })).toBe(
      '{"at":"2026-11-20T00:00:00.000Z","bytes":"01ff","round":"34123389"}',
    );
    expect(canonicalJson({ keep: 1, drop: undefined })).toBe('{"keep":1}');
  });

  it("matches the RFC 8785 reference examples", () => {
    const numbers = [333333333.33333329, 1e30, 4.5, 2e-3, 0.000001, -0, 1e21];
    expect(canonicalJson(numbers)).toBe("[333333333.3333333,1e+30,4.5,0.002,0.000001,0,1e+21]");
    const sorting = { "€": "Euro Sign", "\r": "Carriage Return", "דּ": "Hebrew Letter Dalet With Dagesh", "1": "One", "😀": "Emoji: Grinning Face", "\u0080": "Control", "ö": "Latin Small Letter O With Diaeresis" };
    expect(canonicalJson(sorting)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
    expect(canonicalJson({ literals: [null, true, false], string: "€$\u000f\nA'B\"\\\\\"/" })).toBe(
      '{"literals":[null,true,false],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow(TypeError);
  });
});

describe("audit hash chain", () => {
  it("verifies an untouched chain and reports its head", () => {
    const rows = buildChain(5);
    const result = verifyChainSegment(rows);
    expect(result).toEqual({ ok: true, checked: 5, head: Buffer.from(rows[4]?.hash ?? []).toString("hex") });
  });

  it("detects an edited payload at the exact entry", () => {
    const rows = buildChain(5);
    const tampered = rows.map((row, index) => (index === 2 ? { ...row, payload: canonicalJson({ index: 2, note: "edited" }) } : row));
    expect(verifyChainSegment(tampered)).toMatchObject({ ok: false, brokenAtSeq: 3n, reason: "HASH_MISMATCH", checked: 2 });
  });

  it("detects a deleted entry", () => {
    const rows = buildChain(5);
    const withoutThird = rows.filter((_, index) => index !== 2);
    expect(verifyChainSegment(withoutThird)).toMatchObject({ ok: false, brokenAtSeq: 4n, reason: "PREV_HASH_MISMATCH" });
  });

  it("detects reordered entries and a rewritten timestamp", () => {
    const rows = buildChain(4);
    const swapped = [rows[0], rows[2], rows[1], rows[3]].filter((row): row is StoredAuditRecord => Boolean(row));
    expect(verifyChainSegment(swapped)).toMatchObject({ ok: false, reason: "PREV_HASH_MISMATCH" });
    const retimed = rows.map((row, index) => (index === 0 ? { ...row, createdAt: "2020-01-01T00:00:00.000Z" } : row));
    expect(verifyChainSegment(retimed)).toMatchObject({ ok: false, brokenAtSeq: 1n, reason: "HASH_MISMATCH" });
  });

  it("detects a forged chain that starts from a different genesis", () => {
    const rows = buildChain(3);
    expect(verifyChainSegment(rows.slice(1))).toMatchObject({ ok: false, brokenAtSeq: 2n, reason: "PREV_HASH_MISMATCH" });
    expect(verifyChainSegment(rows.slice(1), rows[0]?.hash)).toMatchObject({ ok: true, checked: 2 });
  });

  it("binds every field into the hash", () => {
    const base = record(0);
    const reference = Buffer.from(auditRecordHash(GENESIS_HASH, base)).toString("hex");
    const variants: Partial<AuditRecord>[] = [
      { eventId: "0193a1b2-0000-7000-8000-000000000001" },
      { actor: "system" },
      { action: "other" },
      { entityType: "draw" },
      { entityId: null },
      { payload: "{}" },
      { createdAt: "2026-11-21T00:00:00.000Z" },
    ];
    for (const variant of variants) {
      expect(Buffer.from(auditRecordHash(GENESIS_HASH, { ...base, ...variant })).toString("hex")).not.toBe(reference);
    }
    expect(() => auditRecordHash(new Uint8Array(31), base)).toThrow(RangeError);
  });
});
