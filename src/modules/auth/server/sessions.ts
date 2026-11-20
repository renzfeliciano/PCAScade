import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";

export const SESSION_POLICY = {
  idleMs: 8 * 60 * 60 * 1000,
  absoluteMs: 7 * 24 * 60 * 60 * 1000,
  touchEveryMs: 5 * 60 * 1000,
} as const;

export const SESSION_COOKIE = "__Host-pcascade-session";

type Client = Db | Prisma.TransactionClient;

export type ActiveSession = { sessionId: string; adminId: number; expiresAt: Date };

function tokenDigest(token: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== 32) return null;
  return new Uint8Array(createHash("sha256").update(raw).digest());
}

export async function createSession(client: Client, adminId: number, now: Date): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const raw = randomBytes(32);
  const token = raw.toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_POLICY.absoluteMs);
  const session = await client.adminSession.create({
    data: {
      adminId,
      tokenSha256: new Uint8Array(createHash("sha256").update(raw).digest()),
      lastSeenAt: now,
      expiresAt,
      createdAt: now,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id, expiresAt };
}

export async function validateSession(database: Db, token: string | undefined, now: Date): Promise<ActiveSession | null> {
  if (!token) return null;
  const digest = tokenDigest(token);
  if (!digest) return null;
  const session = await database.adminSession.findUnique({ where: { tokenSha256: digest } });
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.lastSeenAt.getTime() + SESSION_POLICY.idleMs <= now.getTime()) return null;
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_POLICY.touchEveryMs) {
    await database.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return { sessionId: session.id, adminId: session.adminId, expiresAt: session.expiresAt };
}

export async function revokeSessionByToken(database: Db, token: string | undefined, now: Date): Promise<string | null> {
  if (!token) return null;
  const digest = tokenDigest(token);
  if (!digest) return null;
  const session = await database.adminSession.findUnique({ where: { tokenSha256: digest }, select: { id: true, revokedAt: true } });
  if (!session || session.revokedAt) return null;
  await database.adminSession.update({ where: { id: session.id }, data: { revokedAt: now } });
  return session.id;
}

export async function revokeSessions(client: Client, now: Date, exceptSessionId?: string): Promise<number> {
  const result = await client.adminSession.updateMany({
    where: { revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: now },
  });
  return result.count;
}
