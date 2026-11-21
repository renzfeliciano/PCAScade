import type { ComponentType } from "react";
import { BrickByBrick } from "./brick-by-brick";

export type ThreeSceneEntry = { Component: ComponentType; overlayAt: number; environmentIntensity: number };

export const THREE_SCENES: Record<string, ThreeSceneEntry> = {
  "brick-by-brick": { Component: BrickByBrick, overlayAt: 0.8, environmentIntensity: 0.18 },
};
