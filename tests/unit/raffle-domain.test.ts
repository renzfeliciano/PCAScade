import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidatesFor, eligibleForPrize, exclusivityKey, type HistoryEntry } from "@/modules/raffle/domain/candidates";
import { seedCommitment } from "@/modules/raffle/domain/roster";
import {
  type SnapshotPrize,
  manifest,
  parseEligibilityRule,
  parseParticipantsSnapshot,
  participantsSnapshot,
  prizesSnapshot,
  rulesSnapshot,
  textDigest,
} from "@/modules/raffle/domain/snapshot";
import { BUNDLE_FORMAT, type VerificationBundle, verifyBundle } from "@/modules/raffle/domain/verify";
import { decryptSeed, encryptSeed } from "@/modules/raffle/server/seed-vault";

const people = [
  { id: "p3", department: "IT" },
  { id: "p1", department: "HR" },
  { id: "p2", department: null },
  { id: "p4", department: "it" },
];

function prize(id: string, overrides: Partial<SnapshotPrize> = {}): SnapshotPrize {
  return { id, code: id, name: id, quantity: 1, drawOrder: 1, categoryId: null, categoryName: null, sceneKey: "brick-by-brick", eligibility: { departments: [] }, ...overrides };
}

describe("snapshots", () => {
  it("produce the same bytes whatever the input order, and trim departments", () => {
    const a = participantsSnapshot("e1", people);
    const b = participantsSnapshot("e1", [...people].reverse());
    expect(a.text).toBe(b.text);
    expect(Buffer.from(a.sha256).equals(Buffer.from(textDigest(a.text)))).toBe(true);
    expect(parseParticipantsSnapshot(a.text).participants.map((row) => row.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(participantsSnapshot("e1", [{ id: "x", department: "  Ops " }]).text).toContain('"department":"Ops"');
    expect(participantsSnapshot("e1", [{ id: "x", department: "   " }]).text).toContain('"department":null');
  });

  it("hash differently when any frozen field changes", () => {
    const base = prizesSnapshot("e1", [{ id: "a", code: "A", name: "A", quantity: 1, drawOrder: 1, categoryId: null, categoryName: null, sceneKey: null, eligibilityRule: {} }]);
    const more = prizesSnapshot("e1", [{ id: "a", code: "A", name: "A", quantity: 2, drawOrder: 1, categoryId: null, categoryName: null, sceneKey: null, eligibilityRule: {} }]);
    expect(base.text).toContain('"sceneKey":"brick-by-brick"');
    expect(Buffer.from(base.sha256).equals(Buffer.from(more.sha256))).toBe(false);
    expect(rulesSnapshot({ repeatWinners: "never", voidedWinnerRedraw: "excluded" }).text).not.toBe(rulesSnapshot({ repeatWinners: "allowed", voidedWinnerRedraw: "excluded" }).text);
  });

  it("normalise eligibility rules and tolerate junk", () => {
    expect(parseEligibilityRule({ departments: ["IT", "hr", "it", " Ops "] })).toEqual({ departments: ["IT", "Ops", "hr"] });
    expect(parseEligibilityRule({ nonsense: true })).toEqual({ departments: [] });
    expect(parseEligibilityRule(null)).toEqual({ departments: [] });
  });
});

describe("candidates", () => {
  it("filters by department case-insensitively and leaves people without a department out of restricted prizes", () => {
    expect(eligibleForPrize(people, prize("a", { eligibility: { departments: ["IT"] } })).map((row) => row.id)).toEqual(["p3", "p4"]);
    expect(eligibleForPrize(people, prize("a")).length).toBe(4);
  });

  it("excludes active winners under once-per-raffle, but only within a category under once-per-category", () => {
    const prizes = [prize("a", { categoryId: "c1" }), prize("b", { categoryId: "c1" }), prize("c", { categoryId: "c2" })];
    const history: HistoryEntry[] = [{ sequence: 1, prizeId: "a", participantId: "p1", voidedAfterSequence: null }];
    const at = (rules: "never" | "per_category" | "allowed", target: SnapshotPrize) =>
      candidatesFor({ participants: people, prizes, rules: { repeatWinners: rules, voidedWinnerRedraw: "excluded" }, prize: target, sequence: 2, history });
    expect(at("never", prizes[2] as SnapshotPrize)).not.toContain("p1");
    expect(at("per_category", prizes[1] as SnapshotPrize)).not.toContain("p1");
    expect(at("per_category", prizes[2] as SnapshotPrize)).toContain("p1");
    expect(at("allowed", prizes[1] as SnapshotPrize)).toContain("p1");
  });

  it("treats a winner as active for draws made before the reset, and applies the voided-winner rule after it", () => {
    const prizes = [prize("a", { quantity: 2 }), prize("b")];
    const history: HistoryEntry[] = [
      { sequence: 1, prizeId: "a", participantId: "p1", voidedAfterSequence: 2 },
      { sequence: 2, prizeId: "a", participantId: "p2", voidedAfterSequence: null },
    ];
    const rules = { repeatWinners: "never" as const, voidedWinnerRedraw: "excluded" as const };
    expect(candidatesFor({ participants: people, prizes, rules, prize: prizes[0] as SnapshotPrize, sequence: 2, history })).toEqual(["p2", "p3", "p4"]);
    expect(candidatesFor({ participants: people, prizes, rules, prize: prizes[1] as SnapshotPrize, sequence: 2, history })).toEqual(["p2", "p3", "p4"]);
    expect(candidatesFor({ participants: people, prizes, rules, prize: prizes[0] as SnapshotPrize, sequence: 3, history })).toEqual(["p3", "p4"]);
    expect(candidatesFor({ participants: people, prizes, rules, prize: prizes[1] as SnapshotPrize, sequence: 3, history })).toEqual(["p1", "p3", "p4"]);
    expect(candidatesFor({ participants: people, prizes, rules: { ...rules, voidedWinnerRedraw: "allowed" }, prize: prizes[0] as SnapshotPrize, sequence: 3, history })).toEqual([
      "p1",
      "p3",
      "p4",
    ]);
  });

  it("compiles each rule to the exclusivity key the database enforces", () => {
    expect(exclusivityKey({ repeatWinners: "never", voidedWinnerRedraw: "excluded" }, "p1", { categoryId: "c1" })).toBe("p1");
    expect(exclusivityKey({ repeatWinners: "per_category", voidedWinnerRedraw: "excluded" }, "p1", { categoryId: null })).toBe("p1:uncategorized");
    expect(exclusivityKey({ repeatWinners: "allowed", voidedWinnerRedraw: "excluded" }, "p1", { categoryId: "c1" })).toBeNull();
  });
});

describe("verifyBundle", () => {
  function bundle(): VerificationBundle {
    const seed = new Uint8Array(randomBytes(32));
    const participants = participantsSnapshot("e1", people);
    const prizes = prizesSnapshot("e1", [{ id: "a", code: "A", name: "A", quantity: 1, drawOrder: 1, categoryId: null, categoryName: null, sceneKey: null, eligibilityRule: {} }]);
    const rules = rulesSnapshot({ repeatWinners: "never", voidedWinnerRedraw: "excluded" });
    const commitment = seedCommitment(seed);
    const sealed = manifest({
      preparationId: "prep",
      eventId: "e1",
      version: 1,
      participantsSha256: participants.sha256,
      prizesSha256: prizes.sha256,
      rulesSha256: rules.sha256,
      seedCommitment: commitment,
      participantCount: 4,
      prizeCount: 1,
      slotCount: 1,
    });
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
    return {
      format: BUNDLE_FORMAT,
      preparation: {
        id: "prep",
        eventId: "e1",
        version: 1,
        status: "COMPLETED",
        algorithmVersion: "pcascade-select-v1",
        frozenAt: null,
        participantsSha256: hex(participants.sha256),
        prizesSha256: hex(prizes.sha256),
        rulesSha256: hex(rules.sha256),
        manifestSha256: hex(sealed.sha256),
        seedCommitment: hex(commitment),
        revealedSeed: hex(seed),
        participantCount: 4,
        slotCount: 1,
        statusReason: null,
      },
      snapshots: { participants: participants.text, prizes: prizes.text, rules: rules.text },
      draws: [],
      corrections: [],
    };
  }

  it("passes an untouched bundle and fails each kind of tampering separately", () => {
    expect(verifyBundle(bundle())).toMatchObject({ ok: true, complete: true });

    const swappedSnapshot = bundle();
    swappedSnapshot.snapshots.participants = participantsSnapshot("e1", people.slice(1)).text;
    expect(verifyBundle(swappedSnapshot)).toMatchObject({ ok: false, snapshots: { ok: false } });

    const wrongSeed = bundle();
    wrongSeed.preparation.revealedSeed = Buffer.from(randomBytes(32)).toString("hex");
    expect(verifyBundle(wrongSeed)).toMatchObject({ ok: false, seed: { ok: false } });

    const wrongCount = bundle();
    wrongCount.preparation.participantCount = 3;
    expect(verifyBundle(wrongCount)).toMatchObject({ ok: false, manifest: { ok: false } });

    const hidden = bundle();
    hidden.preparation.revealedSeed = null;
    expect(verifyBundle(hidden)).toMatchObject({ ok: true, complete: false, seed: { ok: null } });
  });

  it("rejects a bundle in an unknown format", () => {
    expect(() => verifyBundle({ format: "something-else" })).toThrow();
  });
});

describe("seed vault", () => {
  it("round-trips, binds the ciphertext to its preparation and refuses the wrong key", () => {
    const key = new Uint8Array(randomBytes(32));
    const seed = new Uint8Array(randomBytes(32));
    const sealed = encryptSeed(key, "prep-1", seed);
    expect(Buffer.from(decryptSeed(key, "prep-1", sealed)).equals(Buffer.from(seed))).toBe(true);
    expect(Buffer.from(encryptSeed(key, "prep-1", seed)).equals(Buffer.from(sealed))).toBe(false);
    expect(() => decryptSeed(key, "prep-2", sealed)).toThrow(/could not be decrypted/);
    expect(() => decryptSeed(new Uint8Array(randomBytes(32)), "prep-1", sealed)).toThrow(/could not be decrypted/);
    const flipped = new Uint8Array(sealed);
    flipped[14] = (flipped[14] ?? 0) ^ 1;
    expect(() => decryptSeed(key, "prep-1", flipped)).toThrow(/could not be decrypted/);
    expect(() => encryptSeed(new Uint8Array(16), "prep-1", seed)).toThrow(/32 bytes/);
  });
});
