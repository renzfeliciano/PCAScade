import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { type ActiveSession, SESSION_COOKIE, validateSession } from "@/modules/auth/server/sessions";

export const getAdminSession = cache(async (): Promise<ActiveSession | null> => {
  const store = await cookies();
  return validateSession(db(), store.get(SESSION_COOKIE)?.value, new Date());
});

export async function requireAdmin(): Promise<ActiveSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}
