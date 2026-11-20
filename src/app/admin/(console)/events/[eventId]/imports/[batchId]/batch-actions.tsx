"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type BatchActionState, cancelImportAction, commitImportAction, recheckImportAction, revertImportAction } from "../actions";

function Outcome({ state }: { state: BatchActionState }) {
  if (state.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{state.error}</AlertTitle>
        {state.details?.length ? (
          <AlertDescription>
            <ul className="list-disc pl-5">
              {state.details.slice(0, 10).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </AlertDescription>
        ) : null}
      </Alert>
    );
  if (state.message)
    return (
      <p role="status" className="text-sm font-medium text-emerald-700">
        {state.message}
      </p>
    );
  return null;
}

type Props = { eventId: string; batchId: string; status: string; createCount: number; updateCount: number; invalidCount: number };

export function BatchActions({ eventId, batchId, status, createCount, updateCount, invalidCount }: Props) {
  const [commitState, commit, committing] = useActionState(commitImportAction.bind(null, eventId, batchId), {});
  const [recheckState, recheck, rechecking] = useActionState(recheckImportAction.bind(null, eventId, batchId), {});
  const [cancelState, cancel, cancelling] = useActionState(cancelImportAction.bind(null, eventId, batchId), {});
  const [revertState, revert, reverting] = useActionState(revertImportAction.bind(null, eventId, batchId), {});
  const [confirmRevert, setConfirmRevert] = useState(false);

  if (status === "VALIDATED") {
    const nothing = createCount + updateCount === 0;
    return (
      <div className="grid gap-4">
        <Outcome state={commitState} />
        <Outcome state={recheckState} />
        <Outcome state={cancelState} />
        <form action={commit} className="grid gap-3 rounded-md border border-border bg-card p-4">
          <p className="text-sm">
            Importing adds <span className="font-semibold">{createCount}</span> new participants and updates <span className="font-semibold">{updateCount}</span>, in one
            step. If anything fails, nothing is saved.
          </p>
          {invalidCount > 0 ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="skipInvalid" className="mt-1 size-4" />
              <span>
                Leave out the <span className="font-semibold">{invalidCount}</span> rows with errors. They are recorded as not imported.
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={committing || nothing}>
              {committing ? "Importing…" : "Import participants"}
            </Button>
            <Button type="submit" formAction={recheck} variant="outline" disabled={rechecking}>
              {rechecking ? "Checking…" : "Check again"}
            </Button>
            <Button type="submit" formAction={cancel} variant="ghost" disabled={cancelling}>
              Cancel import
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (status === "COMMITTED") {
    return (
      <div className="grid gap-3">
        <Outcome state={revertState} />
        {confirmRevert ? (
          <form action={revert} className="grid gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm">
              <span className="font-semibold">Revert this import?</span> Participants it added are removed and participants it updated get their previous values back.
              This stops if any of them changed since, has won a prize, or if the raffle is frozen.
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={reverting}>
                {reverting ? "Reverting…" : "Revert import"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRevert(false)}>
                Keep it
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={() => setConfirmRevert(true)}>
              Revert this import…
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (status === "STAGED") {
    return (
      <form action={cancel} className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">This import was not finished. Start a new one, or cancel this one.</span>
        <Button type="submit" variant="outline" size="sm" disabled={cancelling}>
          Cancel import
        </Button>
      </form>
    );
  }
  return null;
}
