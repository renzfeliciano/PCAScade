import { PlaceholderReveal } from "./placeholder-reveal";
import type { SceneProps } from "./types";

export function RevealScene({ sceneKey, ...props }: SceneProps & { sceneKey: string }) {
  switch (sceneKey) {
    case "build-it-up":
    case "big-lift":
    case "grand-finale":
    case "brick-by-brick":
    default:
      return <PlaceholderReveal {...props} />;
  }
}
