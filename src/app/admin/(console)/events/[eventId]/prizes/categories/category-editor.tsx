"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SCENES } from "@/modules/prizes/domain/prizes";
import { type CategoryFormState, createCategoryAction, deleteCategoryAction, updateCategoryAction } from "../actions";

export type CategoryRow = { id: string; name: string; description: string | null; sceneKey: string; prizeCount: number };

function Errors({ messages }: { messages?: string[] }) {
  return messages?.length ? <p className="text-sm text-destructive">{messages.join(" ")}</p> : null;
}

function formKey(state: CategoryFormState) {
  return state.values ? JSON.stringify(state.values) : "initial";
}

function CategoryFields({ state, category, pending, submitLabel }: { state: CategoryFormState; category?: CategoryRow; pending: boolean; submitLabel: string }) {
  const errors = state.fieldErrors ?? {};
  const prefix = category?.id ?? "new";
  const values = state.values ?? { name: category?.name ?? "", description: category?.description ?? "", sceneKey: category?.sceneKey ?? "brick-by-brick" };
  return (
    <>
      {state.formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-name`}>Name</Label>
        <Input id={`${prefix}-name`} name="name" defaultValue={values.name} maxLength={60} required placeholder="Grand Prize" />
        <Errors messages={errors.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-description`}>Description</Label>
        <Textarea id={`${prefix}-description`} name="description" rows={2} maxLength={300} defaultValue={values.description} />
        <Errors messages={errors.description} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Reveal scene</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCENES.map((scene) => (
            <label key={scene.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="radio" name="sceneKey" value={scene.key} defaultChecked={values.sceneKey === scene.key} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-semibold">{scene.label}</span>
                <span className="text-xs text-muted-foreground">{scene.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Errors messages={errors.sceneKey} />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {state.saved ? (
          <span role="status" className="text-sm font-medium text-emerald-700">
            Saved.
          </span>
        ) : null}
      </div>
    </>
  );
}

export function NewCategoryForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(createCategoryAction.bind(null, eventId), {});
  return (
    <form key={formKey(state)} action={action} className="grid gap-4 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Add a category</h2>
      <CategoryFields state={state} pending={pending} submitLabel="Add category" />
    </form>
  );
}

export function ExistingCategory({ eventId, category }: { eventId: string; category: CategoryRow }) {
  const [state, action, pending] = useActionState(updateCategoryAction.bind(null, eventId, category.id), {});
  const [deleteState, deleteAction, deleting] = useActionState(deleteCategoryAction.bind(null, eventId, category.id), {});
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-4">
      <form key={formKey(state)} action={action} className="grid gap-4">
        <CategoryFields state={state} category={category} pending={pending} submitLabel="Save category" />
      </form>
      {deleteState.formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{deleteState.formError}</AlertDescription>
        </Alert>
      ) : null}
      {category.prizeCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {category.prizeCount} {category.prizeCount === 1 ? "prize uses" : "prizes use"} this category, so it cannot be deleted.
        </p>
      ) : confirming ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3 text-sm">
          <span>Delete this category?</span>
          <Button type="submit" size="sm" variant="destructive" disabled={deleting}>
            Delete category
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete category…
          </Button>
        </div>
      )}
    </div>
  );
}
