"use server";

import { db } from "@/lib/db";
import { AuthError, changePassword } from "@/modules/auth/server/admin";
import { requireAdmin } from "@/modules/auth/server/request-context";

export type PasswordFormState = { error?: string; success?: string };

export async function changePasswordAction(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const session = await requireAdmin();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) return { error: "The new password and its confirmation do not match." };
  try {
    const { revokedSessions } = await changePassword(db(), { sessionId: session.sessionId, currentPassword, newPassword });
    return {
      success:
        revokedSessions > 0
          ? `Password changed. ${revokedSessions} other session${revokedSessions === 1 ? " was" : "s were"} signed out.`
          : "Password changed.",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "WRONG_PASSWORD") return { error: "The current password is not correct." };
      if (error.code === "SAME_PASSWORD") return { error: "Choose a password that is different from the current one." };
      if (error.code === "WEAK_PASSWORD") return { error: error.detail ?? "Choose a stronger password." };
    }
    throw error;
  }
}
