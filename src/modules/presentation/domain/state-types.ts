import type { PublicPerson } from "./display";

export type PresentationScreenKey = "LOBBY" | "PRIZES" | "DRAW" | "WINNER_WALL" | "RECAP";
export type RevealPhaseKey = "IDLE" | "DRAWING" | "READY" | "REVEALING";

export type PublicWinner = { drawId: string; slotNumber: number; person: PublicPerson };

export type PresentationPrize = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  quantity: number;
  drawOrder: number;
  categoryName: string | null;
  sceneKey: string;
  photoUrl: string | null;
  winners: PublicWinner[];
};

export type CurrentReveal = {
  prizeId: string;
  phase: RevealPhaseKey;
  phaseStartedAt: number;
  countdownMs: number;
  sceneMs: number;
  drawId: string | null;
  slotNumber: number | null;
  winner: PublicPerson | null;
};

export type PresentationState = {
  event: { id: string; slug: string; name: string; status: string; accent: string; venue: string | null; welcomeMessage: string | null; startsAt: string | null };
  screen: PresentationScreenKey;
  revision: number;
  current: CurrentReveal | null;
  prizes: PresentationPrize[];
  raffle: { id: string; status: string; version: number; slotCount: number; winnersShown: number; resets: number; manifestSha256: string } | null;
};
