"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { revealCues } from "./cues";
import { type SoundState, soundEngine } from "./engine";

const subscribe = (listener: () => void) => soundEngine.subscribe(listener);
const snapshot = () => soundEngine.state();
const serverSnapshot = (): SoundState => "off";

export function useSoundState(): SoundState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export type SoundRun = { key: string; sceneKey: string; countdownMs: number; elapsedMs: number };

export function useRevealSound(run: SoundRun | null) {
  const state = useSoundState();
  const elapsed = useRef(0);
  const key = run?.key ?? null;
  const sceneKey = run?.sceneKey ?? "";
  const countdownMs = run?.countdownMs ?? 0;

  useEffect(() => {
    elapsed.current = run?.elapsedMs ?? 0;
  });

  useEffect(() => {
    if (!key || state !== "on") return;
    soundEngine.play(revealCues(sceneKey, countdownMs), elapsed.current / 1000);
    return () => soundEngine.stopAll();
  }, [key, sceneKey, countdownMs, state]);
}
