"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition } from "@/modules/participants/domain/fields";
import type { ParticipantFormState } from "./actions";

type Values = Record<string, string | string[]>;

type Props = {
  action: (state: ParticipantFormState, formData: FormData) => Promise<ParticipantFormState>;
  definitions: CustomFieldDefinition[];
  initial: Values;
  submitLabel: string;
};

function Problem({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function ParticipantForm({ action, definitions, initial, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initial;
  const errors = state.fieldErrors ?? {};

  const text = (key: string, label: string, options: { required?: boolean; maxLength: number; type?: string }) => (
    <div className="grid gap-2">
      <Label htmlFor={key}>
        {label}
        {options.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={key}
        name={key}
        type={options.type ?? "text"}
        defaultValue={single(values[key])}
        maxLength={options.maxLength}
        required={options.required}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={`${key}-error`}
      />
      <Problem id={`${key}-error`} message={errors[key]} />
    </div>
  );

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
      <div className="grid gap-5 sm:grid-cols-2">
        {text("externalId", "Employee ID", { required: true, maxLength: 64 })}
        {text("fullName", "Full name", { required: true, maxLength: 160 })}
        {text("department", "Department", { maxLength: 120 })}
        {text("jobTitle", "Position", { maxLength: 120 })}
        {text("email", "Email", { maxLength: 254, type: "email" })}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio">Description</Label>
        <Textarea id="bio" name="bio" rows={3} maxLength={1000} defaultValue={single(values.bio)} aria-describedby="bio-error" />
        <Problem id="bio-error" message={errors.bio} />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="eligible" defaultChecked={single(values.eligible) !== "no"} className="size-4" />
        Eligible to win
      </label>

      {definitions.length > 0 ? (
        <fieldset className="grid gap-5 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Custom fields</legend>
          {definitions.map((definition) => {
            const name = `custom:${definition.key}`;
            const current = values[name];
            const error = errors[name];
            const label = (
              <>
                {definition.label}
                {definition.required ? <span className="text-destructive"> *</span> : null}
              </>
            );
            if (definition.type === "MULTI_SELECT") {
              const chosen = Array.isArray(current) ? current : current ? [current] : [];
              return (
                <fieldset key={definition.key} className="grid gap-2">
                  <legend className="text-sm font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {definition.options.map((option) => (
                      <label key={option} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name={name} value={option} defaultChecked={chosen.includes(option)} className="size-4" />
                        {option}
                      </label>
                    ))}
                  </div>
                  <Problem id={`${name}-error`} message={error} />
                </fieldset>
              );
            }
            if (definition.type === "SINGLE_SELECT" || definition.type === "BOOLEAN") {
              const options = definition.type === "BOOLEAN" ? ["yes", "no"] : definition.options;
              return (
                <div key={definition.key} className="grid gap-2">
                  <Label htmlFor={name}>{label}</Label>
                  <select
                    id={name}
                    name={name}
                    defaultValue={single(current)}
                    aria-invalid={Boolean(error)}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">Not set</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {definition.type === "BOOLEAN" ? (option === "yes" ? "Yes" : "No") : option}
                      </option>
                    ))}
                  </select>
                  <Problem id={`${name}-error`} message={error} />
                </div>
              );
            }
            return (
              <div key={definition.key} className="grid gap-2">
                <Label htmlFor={name}>{label}</Label>
                <Input
                  id={name}
                  name={name}
                  type={definition.type === "NUMBER" ? "number" : definition.type === "DATE" ? "date" : "text"}
                  step={definition.type === "NUMBER" ? "any" : undefined}
                  defaultValue={single(current)}
                  aria-invalid={Boolean(error)}
                />
                <Problem id={`${name}-error`} message={error} />
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
