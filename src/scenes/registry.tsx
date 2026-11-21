"use client";

import { Suspense, lazy } from "react";
import { PlaceholderReveal } from "./placeholder-reveal";
import type { StageProps } from "./three/scene-stage";

const loadStage = () => import("./three/scene-stage");
const SceneStage = lazy(loadStage);

export function preloadRevealScenes() {
  void loadStage();
}

function LoadingStage(props: StageProps) {
  const progress = props.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, props.elapsedMs / props.durationMs));
  return (
    <div data-testid={props.preloading ? "reveal-preload" : "reveal-scene"} data-progress={progress.toFixed(2)} data-renderer="loading" className="relative flex flex-1 self-stretch">
      <PlaceholderReveal {...props} quality="low" elapsedMs={props.preloading ? 0 : props.elapsedMs} />
    </div>
  );
}

export function RevealScene(props: StageProps) {
  return (
    <Suspense fallback={<LoadingStage {...props} />}>
      <SceneStage {...props} />
    </Suspense>
  );
}
