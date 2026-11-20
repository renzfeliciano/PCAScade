import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const AUDIT_CHAIN_VERSION = 1;
export const GENESIS_HASH = new Uint8Array(32);

const TAG = utf8ToBytes("PCASCADE/audit/v1");

export type AuditActor = "admin" | "system" | "anonymous";

export type AuditRecord = {
  eventId: string | null;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: string;
  createdAt: string;
};

export type StoredAuditRecord = AuditRecord & { seq: bigint; prevHash: Uint8Array; hash: Uint8Array };

function field(bytes: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length);
  return concatBytes(length, bytes);
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonSafe(entry)]),
    );
  }
  return value;
}

function serializeCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot represent NaN or Infinity");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${serializeCanonical(entry)}`).join(",")}}`;
  }
  throw new TypeError(`canonical JSON cannot represent a value of type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(toJsonSafe(value));
}

export function auditRecordHash(prevHash: Uint8Array, record: AuditRecord): Uint8Array {
  if (prevHash.length !== 32) throw new RangeError("prevHash must be 32 bytes");
  const body = canonicalJson({
    v: AUDIT_CHAIN_VERSION,
    eventId: record.eventId,
    actor: record.actor,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    payload: record.payload,
    createdAt: record.createdAt,
  });
  return sha256(concatBytes(field(TAG), field(prevHash), field(utf8ToBytes(body))));
}

export type ChainVerification =
  | { ok: true; checked: number; head: string }
  | { ok: false; checked: number; brokenAtSeq: bigint; reason: "PREV_HASH_MISMATCH" | "HASH_MISMATCH" };

export function verifyChainSegment(
  rows: readonly StoredAuditRecord[],
  expectedPrevHash: Uint8Array = GENESIS_HASH,
): ChainVerification {
  let previous = expectedPrevHash;
  let checked = 0;
  for (const row of rows) {
    if (bytesToHex(row.prevHash) !== bytesToHex(previous)) {
      return { ok: false, checked, brokenAtSeq: row.seq, reason: "PREV_HASH_MISMATCH" };
    }
    if (bytesToHex(auditRecordHash(row.prevHash, row)) !== bytesToHex(row.hash)) {
      return { ok: false, checked, brokenAtSeq: row.seq, reason: "HASH_MISMATCH" };
    }
    previous = row.hash;
    checked++;
  }
  return { ok: true, checked, head: bytesToHex(previous) };
}
