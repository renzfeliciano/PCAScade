import type { Metadata } from "next";
import { PrizesScreen } from "../screens";

export const metadata: Metadata = { title: "Prizes" };

export default function PresentationPrizesPage() {
  return <PrizesScreen />;
}
