"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRIZE_QUANTITY, sceneLabel } from "@/modules/prizes/domain/prizes";
import type { PrizeFormState } from "./actions";

type Props = {
  action: (state: PrizeFormState, formData: FormData) => Promise<PrizeFormState>;
  categories: { id: string; name: string; sceneKey: string }[];
  initial: Record<string, string>;
  submitLabel: string;
};

function Problem({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export function PrizeForm({ action, categories, initial, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initial;
  const errors = state.fieldErrors ?? {};

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
      <div className="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label htmlFor="code">
            Prize code<span className="text-destructive"> *</span>
          </Label>
          <Input
            id="code"
            name="code"
            defaultValue={values.code}
            maxLength={40}
            required
            className="font-mono"
            placeholder="TV-01"
            aria-invalid={Boolean(errors.code)}
            aria-describedby="code-error code-hint"
          />
          <p id="code-hint" className="text-xs text-muted-foreground">
            Letters, digits, dots, dashes, underscores.
          </p>
          <Problem id="code-error" message={errors.code} />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="name">
            Prize name<span className="text-destructive"> *</span>
          </Label>
          <Input id="name" name="name" defaultValue={values.name} maxLength={120} required aria-invalid={Boolean(errors.name)} aria-describedby="name-error" />
          <Problem id="name-error" message={errors.name} />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <Label htmlFor="quantity">Number of winners</Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            max={MAX_PRIZE_QUANTITY}
            step={1}
            defaultValue={values.quantity || "1"}
            aria-invalid={Boolean(errors.quantity)}
            aria-describedby="quantity-error"
          />
          <Problem id="quantity-error" message={errors.quantity} />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="categoryId">Category</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={values.categoryId ?? ""}
            aria-invalid={Boolean(errors.categoryId)}
            aria-describedby="categoryId-error"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({sceneLabel(category.sceneKey)})
              </option>
            ))}
          </select>
          <Problem id="categoryId-error" message={errors.categoryId} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} maxLength={1000} defaultValue={values.description} aria-describedby="description-error" />
        <Problem id="description-error" message={errors.description} />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
