"use client";

import { useActionState } from "react";
import { ActionFeedback } from "@/components/admin/photo-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REPEAT_WINNER_OPTIONS, VOIDED_WINNER_OPTIONS, type RaffleRules } from "@/modules/raffle/domain/snapshot";
import {
  type RaffleActionState,
  cancelAction,
  completeAction,
  drawAction,
  finishDrawAction,
  freezeAction,
  freshStartAction,
  prepareRaffleAction,
  resetDrawAction,
  revealAction,
  showScreenAction,
  updateRulesAction,
} from "./actions";

const REASONS = [
  { key: "WINNER_ABSENT", label: "Winner absent" },
  { key: "INELIGIBLE", label: "Winner not eligible" },
  { key: "DATA_ERROR", label: "Data error" },
  { key: "TECHNICAL_ISSUE", label: "Technical issue" },
  { key: "OTHER", label: "Other" },
];

function RuleChoices({ rules }: { rules: RaffleRules }) {
  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">How many prizes can one person win?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {REPEAT_WINNER_OPTIONS.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="radio" name="repeatWinners" value={option.key} defaultChecked={rules.repeatWinners === option.key} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-semibold">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">After a draw is reset, can the same person win that prize again?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {VOIDED_WINNER_OPTIONS.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="radio" name="voidedWinnerRedraw" value={option.key} defaultChecked={rules.voidedWinnerRedraw === option.key} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-semibold">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function PrepareForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(prepareRaffleAction.bind(null, eventId), {});
  return (
    <form action={action} className="grid gap-4 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Prepare a raffle</h2>
      <p className="text-sm text-muted-foreground">
        This takes a snapshot of every eligible, active participant and every available prize, and commits to a secret seed. Nothing is locked until you freeze it.
      </p>
      <RuleChoices rules={{ repeatWinners: "never", voidedWinnerRedraw: "excluded" }} />
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Preparing…" : "Prepare raffle"}
        </Button>
      </div>
    </form>
  );
}

export function RulesForm({ eventId, preparationId, rules }: { eventId: string; preparationId: string; rules: RaffleRules }) {
  const [state, action, pending] = useActionState(updateRulesAction.bind(null, eventId, preparationId), {});
  return (
    <form action={action} className="grid gap-4 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Winner rules</h2>
      <RuleChoices rules={rules} />
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Refreshing…" : "Save rules and refresh snapshots"}
        </Button>
      </div>
    </form>
  );
}

export function FreezeForm({ eventId, preparationId, manifest }: { eventId: string; preparationId: string; manifest: string }) {
  const [state, action, pending] = useActionState(freezeAction.bind(null, eventId, preparationId), {});
  return (
    <form action={action} className="grid gap-3 rounded-md border-2 border-primary bg-card p-4">
      <h2 className="font-semibold">Freeze</h2>
      <p className="text-sm text-muted-foreground">
        Freezing locks participants, prizes and rules for this event. Share the manifest hash with your witnesses before the first draw so they can check the record later.
      </p>
      <input type="hidden" name="manifest" value={manifest} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
        <span>
          I have recorded the manifest hash <code className="font-mono text-xs break-all">{manifest}</code>
        </span>
      </label>
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Freezing…" : "Freeze raffle"}
        </Button>
      </div>
    </form>
  );
}

function ReasonForm({ title, description, submit, action }: { title: string; description: string; submit: string; action: (state: RaffleActionState, formData: FormData) => Promise<RaffleActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="grid gap-2">
        <Label htmlFor={`${submit}-reason`}>Reason (shown publicly)</Label>
        <Textarea id={`${submit}-reason`} name="reason" rows={2} minLength={3} maxLength={500} required />
      </div>
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Working…" : submit}
        </Button>
      </div>
    </form>
  );
}

export function CancelForm({ eventId, preparationId, frozen }: { eventId: string; preparationId: string; frozen: boolean }) {
  return (
    <ReasonForm
      title={frozen ? "Cancel this frozen raffle" : "Discard this draft"}
      description={
        frozen
          ? "Only possible before the first draw. Participants and prizes unlock, and the seed is revealed so the cancelled manifest can still be checked."
          : "The draft and its snapshots are kept in the history as cancelled."
      }
      submit={frozen ? "Cancel raffle" : "Discard draft"}
      action={cancelAction.bind(null, eventId, preparationId)}
    />
  );
}

export function FreshStartForm({ eventId, preparationId }: { eventId: string; preparationId: string }) {
  return (
    <ReasonForm
      title="Fresh Start"
      description="Ends this raffle as superseded and opens a new draft. Every draw so far stays on the public record, and this raffle's seed is revealed so it can still be verified."
      submit="Fresh Start"
      action={freshStartAction.bind(null, eventId, preparationId)}
    />
  );
}

export function CompleteForm({ eventId, preparationId, openSlots }: { eventId: string; preparationId: string; openSlots: number }) {
  const [state, action, pending] = useActionState(completeAction.bind(null, eventId, preparationId), {});
  return (
    <form action={action} className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Complete the raffle</h2>
      <p className="text-sm text-muted-foreground">
        Ends drawing and reveals the server seed so anyone can reproduce every draw.
        {openSlots > 0 ? ` ${openSlots} ${openSlots === 1 ? "slot is" : "slots are"} still undrawn and will stay empty.` : ""}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1" />
        <span>The raffle is over.</span>
      </label>
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Completing…" : "Complete raffle"}
        </Button>
      </div>
    </form>
  );
}

export function DrawForm({ eventId, preparationId, prizeId, slot, generation, label }: { eventId: string; preparationId: string; prizeId: string; slot: number; generation: number; label: string }) {
  const [state, action, pending] = useActionState(drawAction.bind(null, eventId, preparationId), {});
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="prizeId" value={prizeId} />
      <input type="hidden" name="slot" value={slot} />
      <input type="hidden" name="generation" value={generation} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Waiting for the beacon…" : label}
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

export function FinishDrawForm({ eventId, preparationId, drawId }: { eventId: string; preparationId: string; drawId: string }) {
  const [state, action, pending] = useActionState(finishDrawAction.bind(null, eventId, preparationId, drawId), {});
  return (
    <form action={action} className="grid gap-2">
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Fetching beacon…" : "Retry beacon"}
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

export function ResetForm({ eventId, preparationId, drawId, label }: { eventId: string; preparationId: string; drawId: string; label: string }) {
  const [state, action, pending] = useActionState(resetDrawAction.bind(null, eventId, preparationId, drawId), {});
  return (
    <details className="rounded-md border border-border p-2 text-sm">
      <summary className="cursor-pointer font-medium">{label}</summary>
      <form action={action} className="mt-3 grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`category-${drawId}`}>Reason category</Label>
          <select id={`category-${drawId}`} name="category" required defaultValue="" className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="" disabled>
              Choose…
            </option>
            {REASONS.map((reason) => (
              <option key={reason.key} value={reason.key}>
                {reason.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`reason-${drawId}`}>What happened (shown publicly)</Label>
          <Textarea id={`reason-${drawId}`} name="reason" rows={2} minLength={3} maxLength={500} required />
        </div>
        <ActionFeedback state={state} />
        <div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {pending ? "Recording…" : "Reset this draw"}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function RevealForm({ eventId, preparationId, drawId, revealed }: { eventId: string; preparationId: string; drawId: string; revealed: boolean }) {
  const [state, action, pending] = useActionState(revealAction.bind(null, eventId, preparationId, drawId), {});
  return (
    <form action={action} className="grid gap-2">
      <div>
        <Button type="submit" size="sm" variant={revealed ? "outline" : "default"} disabled={pending}>
          {pending ? "Starting…" : revealed ? "Replay reveal" : "Reveal on screen"}
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

export function ScreenForm({ eventId, preparationId, screen, prizeId, label, active }: { eventId: string; preparationId: string; screen: string; prizeId?: string; label: string; active: boolean }) {
  const [state, action, pending] = useActionState(showScreenAction.bind(null, eventId, preparationId), {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="screen" value={screen} />
      {prizeId ? <input type="hidden" name="prizeId" value={prizeId} /> : null}
      <Button type="submit" size="sm" variant={active ? "default" : "outline"} disabled={pending} aria-pressed={active}>
        {label}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
