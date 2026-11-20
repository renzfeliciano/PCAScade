import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { isSameOriginPost } from "@/lib/http";
import { recordAudit } from "@/modules/audit/server/audit-log";
import { SESSION_COOKIE, revokeSessionByToken } from "@/modules/auth/server/sessions";

export async function POST(request: Request) {
  if (!isSameOriginPost(request, serverEnv().APP_URL)) return new NextResponse(null, { status: 403 });
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const database = db();
  const sessionId = await revokeSessionByToken(database, token, new Date());
  if (sessionId) {
    await recordAudit(database, { actor: "admin", action: "auth.logout", entityType: "admin_session", entityId: sessionId });
  }
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
