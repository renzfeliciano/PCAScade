import type { ComponentType } from "react";
import { BrickByBrick } from "./brick-by-brick";
import { BuildItUp } from "./build-it-up";

export type ThreeSceneEntry = { Component: ComponentType; overlayAt: number; environmentIntensity: number };

export const THREE_SCENES: Record<string, ThreeSceneEntry> = {
  "brick-by-brick": { Component: BrickByBrick, overlayAt: 0.8, environmentIntensity: 0.18 },
  "build-it-up": { Component: BuildItUp, overlayAt: 0.75, environmentIntensity: 0.06 },
};
