"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeImageProblem, ImagePreparationError, prepareWebpPhoto } from "@/lib/client/images";

export type PhotoActionState = { error?: string; message?: string };

type Props = {
  action: (state: PhotoActionState, formData: FormData) => Promise<PhotoActionState>;
  photoId: string | null;
  alt: string;
  maxSide: number;
};

export function ActionFeedback({ state }: { state: PhotoActionState }) {
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

export function PhotoPanel({ action, photoId, alt, maxSide }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setLocalError(null);
    setBusy(true);
    try {
      const webp = await prepareWebpPhoto(file, maxSide);
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
          <img src={`/api/admin/media/${photoId}`} alt={alt} width={96} height={96} className="size-24 shrink-0 rounded-md object-cover" />
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
          <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. Resized to {maxSide} pixels and stripped of location data before upload.</p>
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
        <ActionFeedback state={state} />
      )}
    </div>
  );
}
