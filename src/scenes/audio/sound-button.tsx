"use client";

import { useEffect, useRef, useState } from "react";
import { soundEngine } from "./engine";
import { useSoundState } from "./use-reveal-sound";

export function SoundButton({ className, hideInFullscreen = false }: { className?: string; hideInFullscreen?: boolean }) {
  const state = useSoundState();
  const [fullscreen, setFullscreen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hideInFullscreen) return;
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [hideInFullscreen]);

  useEffect(() => {
    if (state !== "waiting") return;
    const wake = (event: Event) => {
      if (button.current && event.target instanceof Node && button.current.contains(event.target)) return;
      void soundEngine.enable();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [state]);

  if (hideInFullscreen && fullscreen && state === "on") return null;
  const label = state === "on" ? "Sound on" : state === "waiting" ? "Click to resume sound" : "Turn sound on";
  return (
    <button
      ref={button}
      type="button"
      data-testid="sound-toggle"
      data-state={state}
      aria-pressed={state === "on"}
      onClick={() => (state === "on" ? soundEngine.disable() : void soundEngine.enable())}
      className={
        className ??
        "rounded-md border border-border bg-background/70 px-4 py-2 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}
