"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_ACCENTS } from "@/modules/events/domain/event-rules";
import type { EventFormState, EventFormValues } from "./actions";

type Props = {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  initial: EventFormValues;
  submitLabel: string;
};

function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {messages.join(" ")}
    </p>
  );
}

export function EventForm({ action, initial, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? initial;

  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={formAction} className="grid max-w-2xl gap-5" noValidate>
      {state.formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}
      {state.saved ? (
        <p role="status" className="text-sm font-medium text-emerald-700">
          Saved.
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="name">Event name</Label>
        <Input id="name" name="name" defaultValue={values.name} required maxLength={120} aria-invalid={Boolean(errors.name)} aria-describedby="name-error" />
        <FieldError id="name-error" messages={errors.name} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="startsAt">Date and time (Manila)</Label>
          <Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={values.startsAt} aria-invalid={Boolean(errors.startsAt)} aria-describedby="startsAt-error" />
          <FieldError id="startsAt-error" messages={errors.startsAt} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="venue">Venue</Label>
          <Input id="venue" name="venue" defaultValue={values.venue} maxLength={160} aria-invalid={Boolean(errors.venue)} aria-describedby="venue-error" />
          <FieldError id="venue-error" messages={errors.venue} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="welcomeMessage">Welcome message</Label>
        <Input id="welcomeMessage" name="welcomeMessage" defaultValue={values.welcomeMessage} maxLength={280} aria-describedby="welcomeMessage-error" />
        <FieldError id="welcomeMessage-error" messages={errors.welcomeMessage} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={values.description} rows={5} maxLength={2000} aria-describedby="description-error" />
        <FieldError id="description-error" messages={errors.description} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Event accent</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EVENT_ACCENTS).map(([key, accent]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-foreground has-[:checked]:ring-2 has-[:checked]:ring-ring">
              <input type="radio" name="accent" value={key} defaultChecked={values.accent === key} className="sr-only" />
              <span className="size-4 rounded-sm" style={{ backgroundColor: accent.hex }} aria-hidden="true" />
              {accent.label}
            </label>
          ))}
        </div>
        <FieldError id="accent-error" messages={errors.accent} />
      </fieldset>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
