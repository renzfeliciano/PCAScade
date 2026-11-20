import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@ep-example-pooler.neon.tech/db?sslmode=require",
  DIRECT_URL: "postgresql://user:pass@ep-example.neon.tech/db?sslmode=require",
  RAFFLE_SEED_ENCRYPTION_KEY: Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 37 + 11) % 256)).toString("base64"),
  APP_URL: "https://pcascade.example",
  DRAND_RELAYS: "",
};

describe("parseServerEnv", () => {
  it("accepts a complete environment and defaults the drand relays", () => {
    const env = parseServerEnv(valid);
    expect(env.DRAND_RELAYS).toEqual(["https://api.drand.sh", "https://api2.drand.sh", "https://drand.cloudflare.com"]);
  });

  it("treats an empty DIRECT_URL as unset", () => {
    expect(parseServerEnv({ ...valid, DIRECT_URL: "" }).DIRECT_URL).toBeUndefined();
  });

  it("names every missing or invalid variable without echoing values", () => {
    const attempt = () => parseServerEnv({ DATABASE_URL: "mysql://nope", RAFFLE_SEED_ENCRYPTION_KEY: "c2hvcnQ=" });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/RAFFLE_SEED_ENCRYPTION_KEY/);
    expect(attempt).toThrow(/APP_URL/);
    expect(attempt).not.toThrow(/c2hvcnQ=/);
  });

  it("rejects non-https drand relays and relays carrying credentials or query strings", () => {
    expect(() => parseServerEnv({ ...valid, DRAND_RELAYS: "http://api.drand.sh" })).toThrow(/DRAND_RELAYS/);
    expect(() => parseServerEnv({ ...valid, DRAND_RELAYS: "https://user:token@api.drand.sh" })).toThrow(/DRAND_RELAYS/);
    expect(() => parseServerEnv({ ...valid, DRAND_RELAYS: "https://api.drand.sh?key=1" })).toThrow(/DRAND_RELAYS/);
  });

  it("rejects encryption keys that are not 32 random base64 bytes", () => {
    const zeroKey = Buffer.alloc(32).toString("base64");
    expect(() => parseServerEnv({ ...valid, RAFFLE_SEED_ENCRYPTION_KEY: zeroKey })).toThrow(/RAFFLE_SEED_ENCRYPTION_KEY/);
    expect(() => parseServerEnv({ ...valid, RAFFLE_SEED_ENCRYPTION_KEY: `${"A".repeat(42)}!=` })).toThrow(/RAFFLE_SEED_ENCRYPTION_KEY/);
    expect(() => parseServerEnv({ ...valid, RAFFLE_SEED_ENCRYPTION_KEY: Buffer.alloc(31, 9).toString("base64") })).toThrow(/RAFFLE_SEED_ENCRYPTION_KEY/);
  });
});
