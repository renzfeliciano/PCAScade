import { describe, expect, it } from "vitest";
import { parseParticipantDisplay, parsePresentationSettings, publicPerson } from "@/modules/presentation/domain/display";
import { revealClock, sceneDurationMs } from "@/modules/presentation/domain/timeline";

describe("reveal clock", () => {
  it("moves from countdown to scene to revealed at exact boundaries, so a refreshed screen resumes at the same point", () => {
    expect(revealClock(-500, 3000, 6000)).toMatchObject({ stage: "countdown", countdownLeftMs: 3000 });
    expect(revealClock(2999, 3000, 6000)).toMatchObject({ stage: "countdown", countdownLeftMs: 1 });
    expect(revealClock(3000, 3000, 6000)).toMatchObject({ stage: "scene", sceneElapsedMs: 0, progress: 0 });
    expect(revealClock(6000, 3000, 6000)).toMatchObject({ stage: "scene", sceneElapsedMs: 3000, progress: 0.5 });
    expect(revealClock(8999, 3000, 6000).stage).toBe("scene");
    expect(revealClock(9000, 3000, 6000)).toMatchObject({ stage: "revealed", progress: 1 });
    expect(revealClock(0, 0, 0).stage).toBe("revealed");
  });

  it("gives every scene a duration and falls back to Brick by Brick", () => {
    expect(sceneDurationMs("grand-finale")).toBeGreaterThan(sceneDurationMs("brick-by-brick"));
    expect(sceneDurationMs("unknown")).toBe(sceneDurationMs("brick-by-brick"));
    expect(sceneDurationMs(null)).toBe(sceneDurationMs("brick-by-brick"));
  });
});

describe("participant display", () => {
  const person = { fullName: "Ana Cruz", department: "IT", jobTitle: "Engineer", bio: "Climbs", photoId: "a1" };

  it("defaults to name, department, job title and photo, and never the bio", () => {
    expect(publicPerson(person, parseParticipantDisplay(null))).toEqual({ name: "Ana Cruz", department: "IT", jobTitle: "Engineer", bio: null, photoUrl: "/api/media/a1" });
  });

  it("drops each field that is switched off and tolerates junk settings", () => {
    expect(publicPerson(person, parseParticipantDisplay({ department: false, jobTitle: false, photo: false, bio: true }))).toEqual({
      name: "Ana Cruz",
      department: null,
      jobTitle: null,
      bio: "Climbs",
      photoUrl: null,
    });
    expect(parseParticipantDisplay({ department: "yes", photo: 0 })).toEqual({ department: true, jobTitle: true, bio: false, photo: true });
  });

  it("clamps the countdown to the allowed range", () => {
    expect(parsePresentationSettings({ countdownSeconds: 10 })).toEqual({ countdownSeconds: 10 });
    expect(parsePresentationSettings({ countdownSeconds: 99 })).toEqual({ countdownSeconds: 5 });
    expect(parsePresentationSettings("nope")).toEqual({ countdownSeconds: 5 });
  });
});
