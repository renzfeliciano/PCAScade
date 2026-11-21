import type { Metadata } from "next";
import { RecapScreen } from "../screens";

export const metadata: Metadata = { title: "Recap" };

export default function PresentationRecapPage() {
  return <RecapScreen />;
}
