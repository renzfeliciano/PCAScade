"use client";

import { useActionState, useState } from "react";
import { ActionFeedback, PhotoPanel } from "@/components/admin/photo-panel";
import { Button } from "@/components/ui/button";
import { PRIZE_PHOTO_MAX_SIDE } from "@/modules/prizes/domain/prizes";
import { deletePrizeAction, setPrizeEligibilityAction, setPrizeStatusAction, uploadPrizePhotoAction } from "../actions";

export function PrizePhoto({ eventId, prizeId, photoId }: { eventId: string; prizeId: string; photoId: string | null }) {
  return <PhotoPanel action={uploadPrizePhotoAction.bind(null, eventId, prizeId)} photoId={photoId} alt="Current prize photo" maxSide={PRIZE_PHOTO_MAX_SIDE} />;
}

export function PrizeStatusAndDelete({ eventId, prizeId, available, drawn }: { eventId: string; prizeId: string; available: boolean; drawn: boolean }) {
  const [statusState, statusAction, statusPending] = useActionState(setPrizeStatusAction.bind(null, eventId, prizeId), {});
  const [deleteState, deleteAction, deletePending] = useActionState(deletePrizeAction.bind(null, eventId, prizeId), {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid gap-4">
      <form action={statusAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="status" value={available ? "WITHDRAWN" : "AVAILABLE"} />
        <Button type="submit" variant="outline" size="sm" disabled={statusPending}>
          {available ? "Withdraw" : "Make available"}
        </Button>
        <span className="text-sm text-muted-foreground">{available ? "Withdrawn prizes stay on record but are not drawn." : "This prize is not drawn."}</span>
      </form>
      <ActionFeedback state={statusState} />
      {drawn ? (
        <p className="text-sm text-muted-foreground">This prize has draws on record, so it cannot be deleted.</p>
      ) : confirming ? (
        <form action={deleteAction} className="grid gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm">
            <span className="font-semibold">Delete this prize?</span> Its record and photo are removed and the prizes after it move up. This is recorded in the audit log.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={deletePending}>
              {deletePending ? "Deleting…" : "Delete prize"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete prize…
          </Button>
        </div>
      )}
      <ActionFeedback state={deleteState} />
    </div>
  );
}

export function PrizeEligibility({ eventId, prizeId, departments, selected }: { eventId: string; prizeId: string; departments: string[]; selected: string[] }) {
  const [state, action, pending] = useActionState(setPrizeEligibilityAction.bind(null, eventId, prizeId), {});
  const chosen = new Set(selected.map((department) => department.toLowerCase()));
  if (departments.length === 0) return <p className="text-sm text-muted-foreground">Add departments to participants to limit this prize to some of them. Everyone can win it now.</p>;
  return (
    <form action={action} className="grid gap-3">
      <p className="text-sm text-muted-foreground">Leave all unticked to let everyone win. Tick departments to limit the prize to them.</p>
      <fieldset className="grid max-h-56 gap-1 overflow-y-auto">
        <legend className="sr-only">Departments that can win</legend>
        {departments.map((department) => (
          <label key={department} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="departments" value={department} defaultChecked={chosen.has(department.toLowerCase())} />
            {department}
          </label>
        ))}
      </fieldset>
      <ActionFeedback state={state} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save who can win"}
        </Button>
      </div>
    </form>
  );
}
