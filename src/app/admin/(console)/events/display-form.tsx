"use client";

import { useActionState } from "react";
import { ActionFeedback } from "@/components/admin/photo-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNTDOWN_LIMITS, DISPLAY_FIELDS, type ParticipantDisplay } from "@/modules/presentation/domain/display";
import { type DisplayFormState, updateDisplayAction } from "./actions";

export function DisplayForm({ eventId, display, countdownSeconds }: { eventId: string; display: ParticipantDisplay; countdownSeconds: number }) {
  const [state, action, pending] = useActionState<DisplayFormState, FormData>(updateDisplayAction.bind(null, eventId), {});
  return (
    <form action={action} className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Besides the name, what may be shown about a winner?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DISPLAY_FIELDS.map((field) => (
            <label key={field.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="checkbox" name={field.key} defaultChecked={display[field.key]} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-semibold">{field.label}</span>
                <span className="text-xs text-muted-foreground">{field.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Employee numbers and email addresses are never shown publicly. Only winners appear, and only after their reveal.</p>
      </fieldset>
      <div className="grid max-w-xs gap-2">
        <Label htmlFor="countdownSeconds">Countdown before each reveal (seconds)</Label>
        <Input id="countdownSeconds" name="countdownSeconds" type="number" min={COUNTDOWN_LIMITS.min} max={COUNTDOWN_LIMITS.max} step={1} defaultValue={countdownSeconds} required />
      </div>
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save display settings"}
        </Button>
      </div>
    </form>
  );
}
