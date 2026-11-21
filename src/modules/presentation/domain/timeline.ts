import { DEFAULT_SCENE_KEY } from "@/modules/raffle/domain/snapshot";

export const SCENE_DURATIONS_MS: Record<string, number> = {
  "brick-by-brick": 7000,
  "build-it-up": 8000,
  "big-lift": 9000,
  "grand-finale": 11000,
};

export function sceneDurationMs(sceneKey: string | null | undefined): number {
  return SCENE_DURATIONS_MS[sceneKey ?? DEFAULT_SCENE_KEY] ?? SCENE_DURATIONS_MS[DEFAULT_SCENE_KEY] ?? 7000;
}

export type RevealStage = "countdown" | "scene" | "revealed";

export type RevealClock = { stage: RevealStage; elapsedMs: number; countdownLeftMs: number; sceneElapsedMs: number; progress: number };

export function revealClock(elapsedMs: number, countdownMs: number, sceneMs: number): RevealClock {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < countdownMs) {
    return { stage: "countdown", elapsedMs: elapsed, countdownLeftMs: countdownMs - elapsed, sceneElapsedMs: 0, progress: 0 };
  }
  const sceneElapsed = elapsed - countdownMs;
  if (sceneElapsed < sceneMs) {
    return { stage: "scene", elapsedMs: elapsed, countdownLeftMs: 0, sceneElapsedMs: sceneElapsed, progress: sceneMs === 0 ? 1 : sceneElapsed / sceneMs };
  }
  return { stage: "revealed", elapsedMs: elapsed, countdownLeftMs: 0, sceneElapsedMs: sceneMs, progress: 1 };
}
