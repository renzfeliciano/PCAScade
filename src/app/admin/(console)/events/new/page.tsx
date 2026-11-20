import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { createEventAction } from "../actions";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage() {
  await requireAdmin();
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/events" className="text-sm text-muted-foreground hover:underline">
          ← Events
        </Link>
        <h1 className="mt-2 text-2xl font-bold">New event</h1>
        <p className="text-sm text-muted-foreground">New events start as drafts and stay hidden until you publish them.</p>
      </div>
      <EventForm
        action={createEventAction}
        submitLabel="Create event"
        initial={{ name: "", description: "", venue: "", welcomeMessage: "", accent: "safety-amber", startsAt: "" }}
      />
    </div>
  );
}
