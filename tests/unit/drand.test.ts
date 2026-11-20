import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it, vi } from "vitest";
import {
  BeaconUnavailableError,
  BeaconVerificationError,
  QUICKNET,
  fetchRound,
  roundAt,
  roundTime,
  verifyQuicknetRound,
} from "@/modules/beacon/drand";
import { DRAND_FIXTURE_ROUND } from "../fixtures/drand";

const { round, signature, randomness } = DRAND_FIXTURE_ROUND;

function flipLastHexDigit(hex: string): string {
  const last = hex.at(-1) === "0" ? "1" : "0";
  return hex.slice(0, -1) + last;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("verifyQuicknetRound", () => {
  it("accepts a real quicknet round and derives randomness as sha256(signature)", () => {
    const verified = verifyQuicknetRound(round, signature, randomness);
    expect(verified.round).toBe(round);
    expect(bytesToHex(verified.randomness)).toBe(randomness);
  });

  it("rejects a tampered signature", () => {
    expect(() => verifyQuicknetRound(round, flipLastHexDigit(signature))).toThrow(BeaconVerificationError);
  });

  it("rejects a valid signature presented for a different round", () => {
    expect(() => verifyQuicknetRound(round + 1n, signature)).toThrow(BeaconVerificationError);
  });

  it("rejects randomness that does not match the signature", () => {
    expect(() => verifyQuicknetRound(round, signature, flipLastHexDigit(randomness))).toThrow(BeaconVerificationError);
  });

  it("rejects malformed signatures", () => {
    expect(() => verifyQuicknetRound(round, "zz")).toThrow(BeaconVerificationError);
    expect(() => verifyQuicknetRound(round, signature.toUpperCase())).toThrow(BeaconVerificationError);
  });
});

describe("round timing", () => {
  it("maps round start times back to the same round", () => {
    expect(roundAt(roundTime(round))).toBe(round);
    expect(roundAt(roundTime(round) + 2999)).toBe(round);
    expect(roundAt(roundTime(round) + 3000)).toBe(round + 1n);
  });
});

describe("fetchRound", () => {
  const payload = { round: Number(round), randomness, signature };

  it("falls through failing relays to a healthy one and verifies the result", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse(payload));
    const result = await fetchRound(round, { relays: ["https://a.test", "https://b.test", "https://c.test"], fetchImpl });
    expect(result.round).toBe(round);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(`https://c.test/${QUICKNET.chainHash}/public/${round}`);
  });

  it("refuses a stale round offered as the latest one", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(payload));
    const muchLater = roundTime(round + 100n);
    await expect(fetchRound("latest", { relays: ["https://a.test"], fetchImpl, now: () => muchLater })).rejects.toBeInstanceOf(
      BeaconUnavailableError,
    );
    const result = await fetchRound("latest", { relays: ["https://a.test"], fetchImpl, now: () => roundTime(round) + 1000 });
    expect(result.round).toBe(round);
  });

  it("refuses a relay that returns a different round than requested", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    await expect(fetchRound(round + 5n, { relays: ["https://a.test"], fetchImpl })).rejects.toBeInstanceOf(BeaconUnavailableError);
  });

  it("refuses a forged signature from every relay and reports a controlled failure", async () => {
    const forged = { ...payload, signature: flipLastHexDigit(signature) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(forged));
    const failure = await fetchRound(round, { relays: ["https://a.test", "https://b.test"], fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BeaconUnavailableError);
    expect((failure as BeaconUnavailableError).failures).toHaveLength(2);
  });
});
