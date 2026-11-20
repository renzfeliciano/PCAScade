"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { EventStatus } from "@/generated/prisma/enums";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TRANSITIONS, isPublicStatus } from "@/modules/events/domain/event-rules";
import { changeEventStatusAction } from "./actions";

const ACTION_LABELS: Record<EventStatus, string> = {
  DRAFT: "Move back to draft",
  PUBLISHED: "Publish",
  LIVE: "Go live",
  CLOSED: "Close event",
  ARCHIVED: "Archive",
};

function consequence(from: EventStatus, to: EventStatus): string {
  if (!isPublicStatus(from) && isPublicStatus(to)) return "The event and its approved details become visible on the public site.";
  if (isPublicStatus(from) && !isPublicStatus(to)) return "The event disappears from the public site and its cached photos are cleared.";
  if (to === "LIVE") return "The event is marked live on the public site.";
  if (to === "CLOSED") return "The event stays visible as a closed event.";
  return "The status change is recorded in the audit log.";
}

export function StatusControls({ eventId, status }: { eventId: string; status: EventStatus }) {
  const [state, formAction, pending] = useActionState(changeEventStatusAction, {});
  const [confirming, setConfirming] = useState<EventStatus | null>(null);
  const options = EVENT_STATUS_TRANSITIONS[status];

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Current status: <span className="font-semibold">{EVENT_STATUS_LABELS[status]}</span>
      </p>
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {confirming ? (
        <form action={formAction} className="grid gap-3 rounded-md border border-border bg-muted/50 p-4">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="to" value={confirming} />
          <p className="text-sm">
            <span className="font-semibold">{ACTION_LABELS[confirming]}?</span> {consequence(status, confirming)}
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Applying…" : `Confirm: ${ACTION_LABELS[confirming]}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((to) => (
            <Button key={to} type="button" size="sm" variant={to === "PUBLISHED" || to === "LIVE" ? "default" : "outline"} onClick={() => setConfirming(to)}>
              {ACTION_LABELS[to]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
