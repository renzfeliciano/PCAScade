import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { clientIpFrom, isSameOriginPost } from "@/lib/http";
import { attemptLogin, clientKeyFor } from "@/modules/auth/server/admin";
import { SESSION_COOKIE } from "@/modules/auth/server/sessions";

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export async function POST(request: Request) {
  const json = wantsJson(request);
  if (!isSameOriginPost(request, serverEnv().APP_URL)) {
    return json ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : new NextResponse(null, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const loginUrl = new URL("/admin/login", request.url);
  if (typeof password !== "string" || password.length === 0) {
    loginUrl.searchParams.set("error", "missing");
    return json ? NextResponse.json({ error: "missing" }, { status: 400 }) : NextResponse.redirect(loginUrl, 303);
  }

  const result = await attemptLogin(db(), { password, clientKey: clientKeyFor(clientIpFrom(request.headers)) });
  if (!result.ok) {
    const retryAfter = Math.ceil(result.retryAfterMs / 1000);
    if (json) {
      return NextResponse.json(
        { error: result.reason, retryAfterSeconds: retryAfter },
        { status: result.reason === "throttled" ? 429 : 401, headers: retryAfter > 0 ? { "Retry-After": String(retryAfter) } : {} },
      );
    }
    loginUrl.searchParams.set("error", result.reason);
    if (retryAfter > 0) loginUrl.searchParams.set("retry", String(retryAfter));
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = json ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
