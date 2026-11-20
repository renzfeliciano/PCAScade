"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeImageProblem, ImagePreparationError, prepareWebpPhoto } from "@/lib/client/images";
import { type SimpleState, deleteParticipantAction, setParticipantStatusAction, uploadParticipantPhotoAction } from "../actions";

function Feedback({ state }: { state: SimpleState }) {
  if (state.error)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{state.error}</AlertDescription>
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

export function PhotoPanel({ eventId, participantId, photoId }: { eventId: string; participantId: string; photoId: string | null }) {
  const [state, formAction, pending] = useActionState(uploadParticipantPhotoAction.bind(null, eventId, participantId), {});
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setLocalError(null);
    setBusy(true);
    try {
      const webp = await prepareWebpPhoto(file);
      const data = new FormData();
      data.set("photo", new File([webp], "photo.webp", { type: "image/webp" }));
      startTransition(() => formAction(data));
    } catch (error) {
      setLocalError(error instanceof ImagePreparationError ? describeImageProblem(error.reason) : "The photo could not be prepared.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start gap-4">
        {photoId ? (
          <img src={`/api/admin/media/${photoId}`} alt="Current participant photo" width={96} height={96} className="size-24 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">No photo</div>
        )}
        <div className="grid min-w-0 flex-1 basis-40 gap-2">
          <label className="text-sm font-medium" htmlFor="photo-file">
            {photoId ? "Replace photo" : "Add photo"}
          </label>
          <input
            ref={input}
            id="photo-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            className="w-full min-w-0 text-sm"
          />
          <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. Resized to 640 pixels and stripped of location data before upload.</p>
          {photoId ? (
            <form action={formAction}>
              <input type="hidden" name="remove" value="1" />
              <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                Remove photo
              </Button>
            </form>
          ) : null}
        </div>
      </div>
      {localError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{localError}</AlertDescription>
        </Alert>
      ) : (
        <Feedback state={state} />
      )}
    </div>
  );
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
