"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={formAction} className="grid max-w-sm gap-4">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {state.success}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required maxLength={1024} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} aria-describedby="newPassword-hint" />
        <p id="newPassword-hint" className="text-xs text-muted-foreground">
          At least 12 characters. Other signed-in sessions are signed out.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Repeat new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required maxLength={256} />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
