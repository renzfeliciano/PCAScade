import type { Metadata } from "next";
import { WinnerWallScreen } from "../screens";

export const metadata: Metadata = { title: "Winners" };

export default function PresentationWinnerWallPage() {
  return <WinnerWallScreen />;
}
