import { afterAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { AuthError, attemptLogin, bootstrapAdmin, changePassword, clientKeyFor, isAdminProvisioned } from "@/modules/auth/server/admin";
import { SESSION_POLICY, revokeSessionByToken, validateSession } from "@/modules/auth/server/sessions";
import { testDb } from "./fixtures";

const database = testDb();
const PASSWORD = "Tower crane lifts 2026";
const NEW_PASSWORD = "Concrete pour at noon 7";
const HOUR = 60 * 60 * 1000;
let clock = Date.UTC(2030, 0, 1);

function nextHour(): Date {
  clock += 6 * HOUR;
  return new Date(clock);
}

afterAll(async () => {
  await database.$disconnect();
});

async function login(password: string, ip: string, now: Date) {
  return attemptLogin(database, { password, clientKey: clientKeyFor(ip), now });
}

describe("single administrator authentication", () => {
  it("bootstraps exactly one administrator and refuses a second one", async () => {
    expect(await isAdminProvisioned(database)).toBe(false);
    await expect(bootstrapAdmin(database, "short")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(await bootstrapAdmin(database, PASSWORD)).toBe("created");
    await expect(bootstrapAdmin(database, "Another strong password 1")).rejects.toMatchObject({ code: "ADMIN_EXISTS" });
    await expect(database.adminUser.create({ data: { id: 2, passwordHash: "x", passwordChangedAt: new Date() } })).rejects.toThrow();
    expect(await database.adminUser.count()).toBe(1);
  }, 60_000);

  it("issues a session for the right password and stores only a hash of the token", async () => {
    const now = nextHour();
    const result = await login(PASSWORD, "203.0.113.10", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await database.adminSession.findUniqueOrThrow({ where: { id: result.sessionId } });
    expect(Buffer.from(stored.tokenSha256).toString("base64url")).not.toBe(result.token);
    expect(await validateSession(database, result.token, now)).toMatchObject({ sessionId: result.sessionId, adminId: 1 });
    expect(await validateSession(database, `${result.token.slice(0, -1)}A`, now)).toBeNull();
    expect(await validateSession(database, "not-a-token", now)).toBeNull();
  }, 60_000);

  it("expires sessions after 8 idle hours and after 7 days regardless of activity", async () => {
    const start = nextHour();
    const result = await login(PASSWORD, "203.0.113.11", start);
    if (!result.ok) throw new Error("login failed");
    expect(await validateSession(database, result.token, new Date(start.getTime() + SESSION_POLICY.idleMs - 1000))).not.toBeNull();
    const idleStart = await login(PASSWORD, "203.0.113.11", new Date(start.getTime() + 1));
    if (!idleStart.ok) throw new Error("login failed");
    expect(await validateSession(database, idleStart.token, new Date(start.getTime() + SESSION_POLICY.idleMs + 1000))).toBeNull();

    let moment = start.getTime();
    for (let step = 0; step < 30 && moment < start.getTime() + SESSION_POLICY.absoluteMs - 7 * HOUR; step++) {
      moment += 7 * HOUR;
      expect(await validateSession(database, result.token, new Date(moment))).not.toBeNull();
    }
    expect(await validateSession(database, result.token, new Date(start.getTime() + SESSION_POLICY.absoluteMs + 1000))).toBeNull();
    clock = start.getTime() + SESSION_POLICY.absoluteMs + HOUR;
  }, 120_000);

  it("revokes a session on sign out", async () => {
    const now = nextHour();
    const result = await login(PASSWORD, "203.0.113.12", now);
    if (!result.ok) throw new Error("login failed");
    expect(await revokeSessionByToken(database, result.token, now)).toBe(result.sessionId);
    expect(await validateSession(database, result.token, now)).toBeNull();
    expect(await revokeSessionByToken(database, result.token, now)).toBeNull();
  }, 60_000);

  it("slows down repeated failures from one client without locking out others", async () => {
    const now = nextHour();
    const attacker = "198.51.100.66";
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await login("wrong password!!", attacker, new Date(now.getTime() + attempt));
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
    }
    const blocked = await login(PASSWORD, attacker, new Date(now.getTime() + 10));
    expect(blocked).toMatchObject({ ok: false, reason: "throttled" });
    expect(blocked.ok ? 0 : blocked.retryAfterMs).toBeGreaterThan(55_000);

    expect((await login(PASSWORD, "203.0.113.13", new Date(now.getTime() + 20))).ok).toBe(true);
    expect((await login(PASSWORD, attacker, new Date(now.getTime() + 61_000))).ok).toBe(true);
    expect((await login("wrong password!!", attacker, new Date(now.getTime() + 62_000))).ok).toBe(false);
    expect(await login(PASSWORD, attacker, new Date(now.getTime() + 63_000))).toMatchObject({ ok: true });
  }, 120_000);

  it("changes the password, keeps the current session and signs out the others", async () => {
    const now = nextHour();
    const current = await login(PASSWORD, "203.0.113.14", now);
    const other = await login(PASSWORD, "203.0.113.15", now);
    if (!current.ok || !other.ok) throw new Error("login failed");

    await expect(changePassword(database, { sessionId: current.sessionId, currentPassword: "nope nope nope", newPassword: NEW_PASSWORD, now })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(changePassword(database, { sessionId: current.sessionId, currentPassword: PASSWORD, newPassword: PASSWORD, now })).rejects.toMatchObject({ code: "SAME_PASSWORD" });
    await expect(changePassword(database, { sessionId: current.sessionId, currentPassword: PASSWORD, newPassword: "password1234", now })).rejects.toBeInstanceOf(AuthError);

    const result = await changePassword(database, { sessionId: current.sessionId, currentPassword: PASSWORD, newPassword: NEW_PASSWORD, now });
    expect(result.revokedSessions).toBeGreaterThanOrEqual(1);
    expect(await validateSession(database, current.token, now)).not.toBeNull();
    expect(await validateSession(database, other.token, now)).toBeNull();
    expect((await login(PASSWORD, "203.0.113.16", nextHour())).ok).toBe(false);
    expect((await login(NEW_PASSWORD, "203.0.113.17", nextHour())).ok).toBe(true);
  }, 120_000);

  it("resetting from the terminal signs out every session", async () => {
    const now = nextHour();
    const session = await login(NEW_PASSWORD, "203.0.113.18", now);
    if (!session.ok) throw new Error("login failed");
    expect(await bootstrapAdmin(database, PASSWORD, { reset: true, now })).toBe("reset");
    expect(await validateSession(database, session.token, now)).toBeNull();
    expect((await login(PASSWORD, "203.0.113.19", nextHour())).ok).toBe(true);
  }, 120_000);

  it("records every authentication event in an intact audit chain", async () => {
    const actions = await database.auditLog.findMany({ where: { action: { startsWith: "auth." } }, select: { action: true, payload: true } });
    const kinds = new Set(actions.map((entry) => entry.action));
    expect(kinds).toEqual(new Set(["auth.admin_bootstrapped", "auth.login_succeeded", "auth.login_failed", "auth.password_changed", "auth.admin_password_reset"]));
    expect(actions.some((entry) => entry.payload.includes("198.51.100.66"))).toBe(false);
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });
});
