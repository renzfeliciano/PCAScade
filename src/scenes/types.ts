import type { PublicPerson } from "@/modules/presentation/domain/display";

export type SceneQuality = "high" | "standard" | "low";

export type SceneProps = {
  winner: PublicPerson;
  prize: { name: string; categoryName: string | null };
  accent: string;
  quality: SceneQuality;
  elapsedMs: number;
  durationMs: number;
};
