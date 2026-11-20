import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import {
  type AuditActor,
  type ChainVerification,
  GENESIS_HASH,
  auditRecordHash,
  canonicalJson,
  verifyChainSegment,
} from "@/modules/audit/domain/chain";

export type AuditEntry = {
  eventId?: string | null;
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  at?: Date;
};

type Tx = Prisma.TransactionClient;

export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<{ seq: bigint }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('pcascade:audit-chain', 0))`;
  const last = await tx.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
  const prevHash = last ? new Uint8Array(last.hash) : GENESIS_HASH;
  const createdAt = entry.at ?? new Date();
  const record = {
    eventId: entry.eventId ?? null,
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    payload: canonicalJson(entry.payload ?? {}),
    createdAt: createdAt.toISOString(),
  };
  const hash = auditRecordHash(prevHash, record);
  const row = await tx.auditLog.create({
    data: { ...record, createdAt, prevHash: new Uint8Array(prevHash), hash: new Uint8Array(hash) },
    select: { seq: true },
  });
  return row;
}

export async function recordAudit(database: Db, entry: AuditEntry): Promise<{ seq: bigint }> {
  return database.$transaction((tx) => appendAudit(tx, entry));
}

const PAGE = 500;

export async function verifyAuditChain(database: Db | Tx): Promise<ChainVerification> {
  let previous: Uint8Array = GENESIS_HASH;
  let checked = 0;
  let cursor = 0n;
  for (;;) {
    const rows = await database.auditLog.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take: PAGE });
    if (rows.length === 0) break;
    const segment = verifyChainSegment(
      rows.map((row) => ({
        seq: row.seq,
        eventId: row.eventId,
        actor: row.actor as AuditActor,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
        prevHash: new Uint8Array(row.prevHash),
        hash: new Uint8Array(row.hash),
      })),
      previous,
    );
    if (!segment.ok) return { ...segment, checked: checked + segment.checked };
    checked += segment.checked;
    const tail = rows[rows.length - 1];
    if (!tail) break;
    previous = new Uint8Array(tail.hash);
    cursor = tail.seq;
  }
  return { ok: true, checked, head: Buffer.from(previous).toString("hex") };
}

export async function listAudit(database: Db, options: { eventId?: string; beforeSeq?: bigint; take?: number }) {
  return database.auditLog.findMany({
    where: {
      ...(options.eventId ? { eventId: options.eventId } : {}),
      ...(options.beforeSeq ? { seq: { lt: options.beforeSeq } } : {}),
    },
    orderBy: { seq: "desc" },
    take: Math.min(options.take ?? 50, 200),
    select: { seq: true, eventId: true, actor: true, action: true, entityType: true, entityId: true, payload: true, createdAt: true, hash: true },
  });
}
