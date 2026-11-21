"use client";

import { useEffect, useRef, useState } from "react";
import { accentStyle } from "@/components/brand/event-accent";
import { Button } from "@/components/ui/button";
import { EVENT_ACCENTS } from "@/modules/events/domain/event-rules";
import { sceneDurationMs } from "@/modules/presentation/domain/timeline";
import { SCENES } from "@/modules/prizes/domain/prizes";
import { SoundButton } from "@/scenes/audio/sound-button";
import { useRevealSound } from "@/scenes/audio/use-reveal-sound";
import { QUALITY_LEVELS, pinQuality, probeWebGl, readPinnedQuality, tierFromRenderer } from "@/scenes/quality";
import { RevealScene } from "@/scenes/registry";
import type { QualityChoice, SceneQuality } from "@/scenes/types";

const SAMPLE_WINNER = { name: "Sample Winner", department: "Department", jobTitle: "Job title", bio: null, photoUrl: null };
const PAUSE_AFTER_MS = 2500;

type Stats = { fps: number; low: number; frames: number };

export function ScenePreview() {
  const [sceneKey, setSceneKey] = useState<string>(SCENES[0]?.key ?? "brick-by-brick");
  const [quality, setQuality] = useState<QualityChoice>("auto");
  const [accent, setAccent] = useState("safety-amber");
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState<Stats>({ fps: 0, low: 0, frames: 0 });
  const [device, setDevice] = useState<{ renderer: string; detected: SceneQuality; pinned: SceneQuality | null } | null>(null);
  const [runId, setRunId] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [cycle, setCycle] = useState(0);
  const durationMs = sceneDurationMs(sceneKey);
  const frameTimes = useRef<number[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const probe = probeWebGl();
      setDevice({ renderer: probe.supported ? probe.renderer : "WebGL is not available", detected: tierFromRenderer(probe.renderer), pinned: readPinnedQuality() });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (scrub !== null) return;
    const started = performance.now();
    const timer = window.setInterval(() => {
      const total = performance.now() - started;
      const passed = total % (durationMs + PAUSE_AFTER_MS);
      setElapsed(Math.min(durationMs, passed));
      setCycle(Math.floor(total / (durationMs + PAUSE_AFTER_MS)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [durationMs, runId, scrub]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let lastReport = previous;
    frameTimes.current = [];
    const tick = (now: number) => {
      frameTimes.current.push(now - previous);
      if (frameTimes.current.length > 600) frameTimes.current.shift();
      previous = now;
      if (now - lastReport > 500) {
        lastReport = now;
        const times = [...frameTimes.current].sort((a, b) => a - b);
        const average = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
        const worst = times[Math.floor(times.length * 0.99)] ?? average;
        setStats({ fps: Math.round(1000 / Math.max(1, average)), low: Math.round(1000 / Math.max(1, worst)), frames: times.length });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sceneKey, quality, runId]);

  function restart() {
    setScrub(null);
    setElapsed(0);
    setCycle(0);
    setRunId((value) => value + 1);
  }

  const activeQuality: SceneQuality = quality === "auto" ? (device?.pinned ?? device?.detected ?? "standard") : quality;
  useRevealSound(scrub === null ? { key: `${sceneKey}:${runId}:${cycle}`, sceneKey, countdownMs: 0, elapsedMs: elapsed } : null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Scene</span>
          <select
            value={sceneKey}
            onChange={(event) => {
              setSceneKey(event.target.value);
              restart();
            }} className="h-9 rounded-md border border-border bg-background px-2">
            {SCENES.map((scene) => (
              <option key={scene.key} value={scene.key}>
                {scene.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Quality</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value as QualityChoice)} className="h-9 rounded-md border border-border bg-background px-2">
            <option value="auto">Automatic</option>
            {QUALITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Accent</span>
          <select value={accent} onChange={(event) => setAccent(event.target.value)} className="h-9 rounded-md border border-border bg-background px-2">
            {Object.entries(EVENT_ACCENTS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={restart}
        >
          {scrub === null ? "Restart" : "Play"}
        </Button>
        <SoundButton className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium" />
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          <span className="font-medium">Pause at {((scrub ?? elapsed) / 1000).toFixed(1)} s</span>
          <input
            type="range"
            aria-label="Pause at time"
            min={0}
            max={durationMs}
            step={100}
            value={scrub ?? elapsed}
            onChange={(event) => {
              const value = Number(event.target.value);
              setScrub(value);
              setElapsed(value);
            }}
          />
        </label>
      </div>

      <div style={accentStyle(accent)} className="dark relative flex aspect-video w-full overflow-hidden rounded-md border border-border bg-background text-foreground">
        <RevealScene
          key={`${sceneKey}-${quality}-${runId}`}
          sceneKey={sceneKey}
          winner={SAMPLE_WINNER}
          prize={{ name: "Sample prize", categoryName: null }}
          accent={accent}
          quality={quality}
          preloading={false}
          frozen={scrub !== null}
          elapsedMs={scrub ?? elapsed}
          durationMs={durationMs}
        />
        <p data-testid="fps-readout" className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">
          {stats.fps} fps · 1% low {stats.low} · {activeQuality}
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <p>
          <span className="font-medium">Graphics:</span> <span className="font-mono text-xs">{device?.renderer ?? "checking…"}</span>
        </p>
        <p>
          Detected quality <span className="font-semibold">{device?.detected ?? "…"}</span>
          {device?.pinned ? (
            <>
              , pinned on this PC to <span className="font-semibold">{device.pinned}</span>
            </>
          ) : null}
          . Aim for 60 fps on high or standard, and at least 30 fps on low.
        </p>
        <div className="flex flex-wrap gap-2">
          {QUALITY_LEVELS.map((level) => (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={device?.pinned === level ? "default" : "outline"}
              onClick={() => {
                pinQuality(level);
                setDevice((current) => (current ? { ...current, pinned: level } : current));
              }}
            >
              Pin {level} on this PC
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              pinQuality(null);
              setDevice((current) => (current ? { ...current, pinned: null } : current));
            }}
          >
            Use automatic
          </Button>
        </div>
      </div>
    </div>
  );
}
