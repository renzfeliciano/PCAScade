"use client";

import { useActionState, useState } from "react";
import { ActionFeedback as Feedback, PhotoPanel as SharedPhotoPanel } from "@/components/admin/photo-panel";
import { Button } from "@/components/ui/button";
import { STORED_PHOTO_MAX_SIDE } from "@/modules/imports/domain/photos";
import { deleteParticipantAction, setParticipantStatusAction, uploadParticipantPhotoAction } from "../actions";

export function PhotoPanel({ eventId, participantId, photoId }: { eventId: string; participantId: string; photoId: string | null }) {
  return <SharedPhotoPanel action={uploadParticipantPhotoAction.bind(null, eventId, participantId)} photoId={photoId} alt="Current participant photo" maxSide={STORED_PHOTO_MAX_SIDE} />;
}

export function StatusAndDelete({ eventId, participantId, active }: { eventId: string; participantId: string; active: boolean }) {
  const [statusState, statusAction, statusPending] = useActionState(setParticipantStatusAction.bind(null, eventId, participantId), {});
  const [deleteState, deleteAction, deletePending] = useActionState(deleteParticipantAction.bind(null, eventId, participantId), {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid gap-4">
      <form action={statusAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="status" value={active ? "INACTIVE" : "ACTIVE"} />
        <Button type="submit" variant="outline" size="sm" disabled={statusPending}>
          {active ? "Deactivate" : "Reactivate"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {active ? "Inactive participants stay on record but are left out of draws." : "This participant is left out of draws."}
        </span>
      </form>
      <Feedback state={statusState} />
      {confirming ? (
        <form action={deleteAction} className="grid gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm">
            <span className="font-semibold">Delete this participant?</span> Their record and photo are removed. This is recorded in the audit log and cannot be undone.
            Participants with a recorded win cannot be deleted.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={deletePending}>
              {deletePending ? "Deleting…" : "Delete participant"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete participant…
          </Button>
        </div>
      )}
      <Feedback state={deleteState} />
    </div>
  );
}
