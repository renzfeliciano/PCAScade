import type { Metadata } from "next";
import { DrawScreen } from "../../screens";

export const metadata: Metadata = { title: "Draw" };

export default async function PresentationDrawPage({ params }: PageProps<"/presentation/[eventId]/draw/[prizeId]">) {
  const { prizeId } = await params;
  return <DrawScreen prizeId={prizeId} />;
}
