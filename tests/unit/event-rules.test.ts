import { describe, expect, it } from "vitest";
import {
  EVENT_STATUS_TRANSITIONS,
  canTransition,
  eventInputSchema,
  isPublicStatus,
  slugify,
  toManilaInputValue,
} from "@/modules/events/domain/event-rules";

const valid = { name: "Year-End Party 2026", description: "", venue: "", welcomeMessage: "", accent: "blueprint-blue", startsAt: "" };

describe("event status rules", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(true);
    expect(canTransition("DRAFT", "LIVE")).toBe(false);
    expect(canTransition("LIVE", "DRAFT")).toBe(false);
    expect(canTransition("ARCHIVED", "PUBLISHED")).toBe(false);
    for (const [from, targets] of Object.entries(EVENT_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it("treats published, live and closed events as public", () => {
    expect(["DRAFT", "PUBLISHED", "LIVE", "CLOSED", "ARCHIVED"].filter((status) => isPublicStatus(status as never))).toEqual(["PUBLISHED", "LIVE", "CLOSED"]);
  });
});

describe("slugify", () => {
  it("produces url-safe slugs from any name", () => {
    expect(slugify("Year-End Party 2026!")).toBe("year-end-party-2026");
    expect(slugify("  Pista ng Bayan — Ñino  ")).toBe("pista-ng-bayan-nino");
    expect(slugify("!!!")).toBe("event");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("eventInputSchema", () => {
  it("accepts a minimal event and turns blanks into null", () => {
    const parsed = eventInputSchema.parse(valid);
    expect(parsed).toMatchObject({ name: "Year-End Party 2026", description: null, venue: null, startsAt: null, accent: "blueprint-blue" });
  });

  it("reads datetime-local input as Manila time regardless of the server time zone", () => {
    const parsed = eventInputSchema.parse({ ...valid, startsAt: "2026-12-19T18:30" });
    expect(parsed.startsAt?.toISOString()).toBe("2026-12-19T10:30:00.000Z");
    expect(toManilaInputValue(parsed.startsAt ?? null)).toBe("2026-12-19T18:30");
  });

  it("rejects names that are too short, unknown accents and invalid dates", () => {
    const result = eventInputSchema.safeParse({ ...valid, name: "ab", accent: "neon-pink", startsAt: "not a date" });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["name", "accent", "startsAt"]));
  });
});
