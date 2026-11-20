"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType } from "@/modules/participants/domain/fields";
import { type FieldFormState, createFieldAction, deleteFieldAction, updateFieldAction } from "./actions";

export type FieldRow = { id: string; key: string; label: string; type: FieldType; required: boolean; isPublic: boolean; options: string[] };

function Errors({ messages }: { messages?: string[] }) {
  return messages?.length ? <p className="text-sm text-destructive">{messages.join(" ")}</p> : null;
}

function FieldFormBody({ state, field, pending, submitLabel }: { state: FieldFormState; field?: FieldRow; pending: boolean; submitLabel: string }) {
  const [type, setType] = useState<FieldType>(field?.type ?? "TEXT");
  const errors = state.fieldErrors ?? {};
  const prefix = field?.id ?? "new";
  const choice = type === "SINGLE_SELECT" || type === "MULTI_SELECT";
  return (
    <>
      {state.formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-label`}>Label</Label>
          <Input id={`${prefix}-label`} name="label" defaultValue={field?.label} maxLength={80} required />
          <Errors messages={errors.label} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-key`}>Spreadsheet key</Label>
          <Input id={`${prefix}-key`} name="key" defaultValue={field?.key} maxLength={40} readOnly={Boolean(field)} className="font-mono" placeholder="shirt_size" />
          <Errors messages={errors.key} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-type`}>Type</Label>
          <select
            id={`${prefix}-type`}
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as FieldType)}
            disabled={Boolean(field)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-70"
          >
            {FIELD_TYPES.map((option) => (
              <option key={option} value={option}>
                {FIELD_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
          {field ? <input type="hidden" name="type" value={field.type} /> : null}
        </div>
      </div>
      {choice ? (
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-options`}>Options, one per line</Label>
          <Textarea id={`${prefix}-options`} name="options" rows={4} defaultValue={field?.options.join("\n")} />
          <Errors messages={errors.options} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="required" defaultChecked={field?.required} className="size-4" />
          Required
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPublic" defaultChecked={field?.isPublic} className="size-4" />
          May appear on public pages
        </label>
      </div>
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

export function NewFieldForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(createFieldAction.bind(null, eventId), {});
  return (
    <form action={action} className="grid gap-4 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Add a field</h2>
      <FieldFormBody state={state} pending={pending} submitLabel="Add field" />
    </form>
  );
}

export function ExistingField({ eventId, field }: { eventId: string; field: FieldRow }) {
  const [state, action, pending] = useActionState(updateFieldAction.bind(null, eventId, field.id), {});
  const [deleteState, deleteAction, deleting] = useActionState(deleteFieldAction.bind(null, eventId, field.id), {});
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <form action={action} className="grid gap-4">
        <FieldFormBody state={state} field={field} pending={pending} submitLabel="Save field" />
      </form>
      {deleteState.formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{deleteState.formError}</AlertDescription>
        </Alert>
      ) : null}
      {confirming ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3 text-sm">
          <span>Delete this field and clear its values from every participant?</span>
          <Button type="submit" size="sm" variant="destructive" disabled={deleting}>
            Delete field
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete field…
          </Button>
        </div>
      )}
    </div>
  );
}
