import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import { hashPassword, needsRehash, passwordPolicyProblem, verifyPassword } from "@/modules/auth/domain/password";
import { THROTTLE, loginRetryAfterMs } from "@/modules/auth/domain/throttle";
import { createSession, revokeSessions } from "@/modules/auth/server/sessions";

export const ADMIN_ID = 1;

export type AuthErrorCode = "ADMIN_EXISTS" | "WEAK_PASSWORD" | "WRONG_PASSWORD" | "SAME_PASSWORD" | "NOT_PROVISIONED";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly detail?: string,
  ) {
    super(detail ?? code);
  }
}

const DUMMY_HASH = "scrypt$v1$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function clientKeyFor(ip: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update("PCASCADE/client/v1\u0000").update(ip).digest());
}

export async function isAdminProvisioned(database: Db): Promise<boolean> {
  return (await database.adminUser.count()) > 0;
}

export async function bootstrapAdmin(database: Db, password: string, options: { reset?: boolean; now?: Date } = {}): Promise<"created" | "reset"> {
  const problem = passwordPolicyProblem(password);
  if (problem) throw new AuthError("WEAK_PASSWORD", problem);
  const now = options.now ?? new Date();
  const passwordHash = await hashPassword(password);
  return database.$transaction(async (tx) => {
    const existing = await tx.adminUser.findUnique({ where: { id: ADMIN_ID }, select: { id: true } });
    if (existing && !options.reset) throw new AuthError("ADMIN_EXISTS");
    if (existing) {
      await tx.adminUser.update({ where: { id: ADMIN_ID }, data: { passwordHash, passwordChangedAt: now } });
      const revoked = await revokeSessions(tx, now);
      await appendAudit(tx, { actor: "system", action: "auth.admin_password_reset", entityType: "admin", entityId: "1", payload: { revokedSessions: revoked }, at: now });
      return "reset";
    }
    await tx.adminUser.create({ data: { id: ADMIN_ID, passwordHash, passwordChangedAt: now } });
    await appendAudit(tx, { actor: "system", action: "auth.admin_bootstrapped", entityType: "admin", entityId: "1", at: now });
    return "created";
  });
}

export type LoginResult =
  | { ok: true; token: string; sessionId: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "throttled"; retryAfterMs: number };

type ClientKey = Uint8Array<ArrayBuffer>;

async function failureStats(database: Db, where: { clientKey?: ClientKey; createdAt: { gt?: Date; gte?: Date } }) {
  const filter = { ...where, succeeded: false };
  const [count, latest] = await Promise.all([
    database.loginAttempt.count({ where: filter }),
    database.loginAttempt.findFirst({ where: filter, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { count, lastAt: latest?.createdAt.getTime() ?? null };
}

async function throttleState(database: Db, clientKey: ClientKey, now: Date) {
  const windowStart = new Date(now.getTime() - THROTTLE.windowMs);
  const lastSuccess = await database.loginAttempt.findFirst({
    where: { clientKey, succeeded: true, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = lastSuccess && lastSuccess.createdAt > windowStart ? lastSuccess.createdAt : windowStart;
  const [client, global] = await Promise.all([
    failureStats(database, { clientKey, createdAt: { gt: since } }),
    failureStats(database, { createdAt: { gte: new Date(now.getTime() - THROTTLE.globalWindowMs) } }),
  ]);
  return loginRetryAfterMs({
    now: now.getTime(),
    clientFailuresInWindow: client.count,
    clientLastFailureAt: client.lastAt,
    globalFailuresInWindow: global.count,
    globalLastFailureAt: global.lastAt,
  });
}

export async function attemptLogin(database: Db, input: { password: string; clientKey: ClientKey; now?: Date }): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const retryAfterMs = await throttleState(database, input.clientKey, now);
  if (retryAfterMs > 0) return { ok: false, reason: "throttled", retryAfterMs };

  const admin = await database.adminUser.findUnique({ where: { id: ADMIN_ID } });
  const valid = await verifyPassword(input.password.slice(0, 1024), admin?.passwordHash ?? DUMMY_HASH);
  const clientTag = Buffer.from(input.clientKey).toString("hex").slice(0, 12);

  if (!admin || !valid) {
    await database.$transaction(async (tx) => {
      await tx.loginAttempt.create({ data: { clientKey: input.clientKey, succeeded: false, createdAt: now } });
      await appendAudit(tx, { actor: "anonymous", action: "auth.login_failed", entityType: "admin", entityId: "1", payload: { client: clientTag }, at: now });
    });
    return { ok: false, reason: "invalid", retryAfterMs: await throttleState(database, input.clientKey, now) };
  }

  const rehash = needsRehash(admin.passwordHash) ? await hashPassword(input.password) : null;
  return database.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { clientKey: input.clientKey, succeeded: true, createdAt: now } });
    await tx.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } });
    if (rehash) await tx.adminUser.update({ where: { id: ADMIN_ID }, data: { passwordHash: rehash } });
    const session = await createSession(tx, ADMIN_ID, now);
    await appendAudit(tx, { actor: "admin", action: "auth.login_succeeded", entityType: "admin_session", entityId: session.sessionId, payload: { client: clientTag }, at: now });
    return { ok: true as const, ...session };
  });
}

export async function changePassword(
  database: Db,
  input: { sessionId: string; currentPassword: string; newPassword: string; now?: Date },
): Promise<{ revokedSessions: number }> {
  const now = input.now ?? new Date();
  const admin = await database.adminUser.findUnique({ where: { id: ADMIN_ID } });
  if (!admin) throw new AuthError("NOT_PROVISIONED");
  if (!(await verifyPassword(input.currentPassword.slice(0, 1024), admin.passwordHash))) throw new AuthError("WRONG_PASSWORD");
  if (input.newPassword === input.currentPassword) throw new AuthError("SAME_PASSWORD");
  const problem = passwordPolicyProblem(input.newPassword);
  if (problem) throw new AuthError("WEAK_PASSWORD", problem);
  const passwordHash = await hashPassword(input.newPassword);
  return database.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: ADMIN_ID }, data: { passwordHash, passwordChangedAt: now } });
    const revokedSessions = await revokeSessions(tx, now, input.sessionId);
    await appendAudit(tx, { actor: "admin", action: "auth.password_changed", entityType: "admin", entityId: "1", payload: { revokedSessions }, at: now });
    return { revokedSessions };
  });
}
