import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordPolicyProblem, verifyPassword } from "@/modules/auth/domain/password";
import { THROTTLE, loginRetryAfterMs } from "@/modules/auth/domain/throttle";

describe("password hashing", () => {
  it("verifies the right password, rejects wrong ones and salts every hash", async () => {
    const password = "Steel beams at dawn 2026";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^scrypt\$v1\$131072\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password} `, first)).toBe(false);
    expect(await verifyPassword("steel beams at dawn 2026", first)).toBe(false);
    expect(needsRehash(first)).toBe(false);
  }, 30_000);

  it("rejects malformed or downgraded stored hashes instead of throwing", async () => {
    const stored = await hashPassword("Rebar and concrete 99");
    const parts = stored.split("$");
    expect(await verifyPassword("Rebar and concrete 99", "plain-text")).toBe(false);
    expect(await verifyPassword("Rebar and concrete 99", ["bcrypt", ...parts.slice(1)].join("$"))).toBe(false);
    expect(await verifyPassword("Rebar and concrete 99", [...parts.slice(0, 2), String(2 ** 22), ...parts.slice(3)].join("$"))).toBe(false);
    expect(await verifyPassword("Rebar and concrete 99", [...parts.slice(0, 5), "c2hvcnQ=", parts[6]].join("$"))).toBe(false);
    expect(needsRehash([...parts.slice(0, 2), "16384", ...parts.slice(3)].join("$"))).toBe(true);
  }, 30_000);

  it("enforces the password policy", () => {
    expect(passwordPolicyProblem("short")).toMatch(/12 characters/);
    expect(passwordPolicyProblem("Password1234")).toMatch(/too common/);
    expect(passwordPolicyProblem("aaaaaaaaaaaaab")).toMatch(/variety/);
    expect(passwordPolicyProblem("x".repeat(257))).toMatch(/at most/);
    expect(passwordPolicyProblem("Crane hook 42 lifts!")).toBeNull();
  });
});

describe("login throttle", () => {
  const now = 10_000_000;
  const base = { now, clientFailuresInWindow: 0, clientLastFailureAt: null, globalFailuresInWindow: 0, globalLastFailureAt: null };

  it("allows the first few failures without delay", () => {
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: THROTTLE.freeFailures - 1, clientLastFailureAt: now })).toBe(0);
  });

  it("doubles the delay for each failure past the free allowance, capped at one hour", () => {
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: 5, clientLastFailureAt: now })).toBe(60_000);
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: 6, clientLastFailureAt: now })).toBe(120_000);
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: 7, clientLastFailureAt: now - 30_000 })).toBe(210_000);
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: 40, clientLastFailureAt: now })).toBe(THROTTLE.maxDelayMs);
    expect(loginRetryAfterMs({ ...base, clientFailuresInWindow: 5, clientLastFailureAt: now - 61_000 })).toBe(0);
  });

  it("applies a global brake when many clients fail at once", () => {
    expect(loginRetryAfterMs({ ...base, globalFailuresInWindow: THROTTLE.globalFailureLimit, globalLastFailureAt: now - 1_000 })).toBe(59_000);
    expect(loginRetryAfterMs({ ...base, globalFailuresInWindow: THROTTLE.globalFailureLimit - 1, globalLastFailureAt: now })).toBe(0);
  });
});
