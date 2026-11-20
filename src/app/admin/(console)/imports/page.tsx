import type { Metadata } from "next";
import { EventPicker } from "@/components/admin/event-picker";
import { requireAdmin } from "@/modules/auth/server/request-context";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsIndexPage() {
  await requireAdmin();
  return <EventPicker title="Imports" description="Imports add participants to one event. Choose the event to import into." suffix="/imports" />;
}
