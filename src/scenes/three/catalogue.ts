import type { ComponentType } from "react";
import { BrickByBrick } from "./brick-by-brick";
import { BigLift } from "./big-lift";
import { BuildItUp } from "./build-it-up";
import { GrandFinale } from "./grand-finale";

export type ThreeSceneEntry = { Component: ComponentType; overlayAt: number; environmentIntensity: number };

export const THREE_SCENES: Record<string, ThreeSceneEntry> = {
  "brick-by-brick": { Component: BrickByBrick, overlayAt: 0.8, environmentIntensity: 0.18 },
  "build-it-up": { Component: BuildItUp, overlayAt: 0.75, environmentIntensity: 0.06 },
  "big-lift": { Component: BigLift, overlayAt: 0.8, environmentIntensity: 0.35 },
  "grand-finale": { Component: GrandFinale, overlayAt: 0.79, environmentIntensity: 0.3 },
};
