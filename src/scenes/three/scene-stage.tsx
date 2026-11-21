"use client";

import { Environment } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Component, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { accentHex } from "@/components/brand/event-accent";
import { PlaceholderReveal } from "../placeholder-reveal";
import { TIER_SETTINGS, chooseQuality, isSoftwareRenderer, probeWebGl } from "../quality";
import type { QualityChoice, SceneProps, SceneQuality } from "../types";
import { StageClock } from "../stage-clock";
import { WinnerCard } from "../winner-card";
import { THREE_SCENES } from "./catalogue";
import { HDRI_PATH, type SceneRuntime, SceneRuntimeContext } from "./shared";

class StageBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export type StageProps = Omit<SceneProps, "quality"> & { quality: QualityChoice; sceneKey: string; preloading: boolean; frozen?: boolean };

const CAMERA = { fov: 35, near: 0.05, far: 400, position: [0, 0, 4] as [number, number, number] };
const GL_HIGH = { antialias: true, powerPreference: "high-performance" as const };
const GL_LOW = { antialias: false, powerPreference: "high-performance" as const };


export default function SceneStage(props: StageProps) {
  const entry = THREE_SCENES[props.sceneKey];
  const [mode, setMode] = useState<{ quality: SceneQuality; webgl: boolean } | null>(null);
  const [lost, setLost] = useState(false);
  const [clock] = useState(() => new StageClock());

  useEffect(() => {
    const probe = probeWebGl();
    const quality = props.quality === "auto" ? chooseQuality() : props.quality;
    const usable = probe.supported && !(props.quality === "auto" && isSoftwareRenderer(probe.renderer));
    const timer = window.setTimeout(() => setMode({ quality, webgl: usable }), 0);
    return () => window.clearTimeout(timer);
  }, [props.quality]);

  useEffect(() => {
    clock.sync(props.preloading ? 0 : props.elapsedMs, props.preloading || Boolean(props.frozen));
  }, [clock, props.elapsedMs, props.preloading, props.frozen]);

  const runtime = useMemo<SceneRuntime | null>(() => {
    if (!mode) return null;
    const reducedMotion = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    return {
      durationMs: props.durationMs,
      accent: accentHex(props.accent),
      tier: TIER_SETTINGS[mode.quality],
      reducedMotion,
      elapsedMs: () => clock.read(props.durationMs),
    };
  }, [mode, clock, props.durationMs, props.accent]);

  const progress = props.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, props.elapsedMs / props.durationMs));
  const overlayAt = (entry?.overlayAt ?? 1) * props.durationMs;
  const overlay = props.preloading ? 0 : Math.min(1, Math.max(0, (props.elapsedMs - overlayAt) / 700));
  const fallback = <PlaceholderReveal {...props} quality="low" elapsedMs={props.preloading ? 0 : props.elapsedMs} />;
  const wrapper = { "data-testid": props.preloading ? "reveal-preload" : "reveal-scene", "data-progress": progress.toFixed(2) };

  if (!entry || (mode && (!mode.webgl || lost))) {
    return (
      <div {...wrapper} data-renderer="placeholder" className="relative flex flex-1 self-stretch">
        {fallback}
      </div>
    );
  }

  return (
    <div {...wrapper} data-renderer="webgl" className="relative flex flex-1 self-stretch">
      <div className="absolute inset-0">
        {runtime && mode ? (
          <StageBoundary fallback={fallback}>
            <Canvas
              dpr={runtime.tier.dpr}
              shadows={runtime.tier.shadows}
              gl={runtime.tier.antialias ? GL_HIGH : GL_LOW}
              camera={CAMERA}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener("webglcontextlost", () => setLost(true), { once: true });
              }}
            >
              <SceneRuntimeContext.Provider value={runtime}>
                <Suspense fallback={null}>
                  <Environment files={HDRI_PATH} environmentIntensity={entry.environmentIntensity} />
                  <entry.Component />
                </Suspense>
              </SceneRuntimeContext.Provider>
            </Canvas>
          </StageBoundary>
        ) : null}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
      {overlay > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.45)_45%,rgba(0,0,0,0.1)_80%)] transition-opacity duration-300"
          style={{ opacity: overlay }}
        />
      ) : null}
      {overlay > 0 ? (
        <div
          data-testid="reveal-overlay"
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-[6vw] transition-opacity duration-300"
          style={{ opacity: overlay, transform: `translateY(${(1 - overlay) * 3}vh)` }}
        >
          <WinnerCard winner={props.winner} prizeName={props.prize.name} />
        </div>
      ) : null}
    </div>
  );
}
