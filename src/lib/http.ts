export function isSameOriginPost(request: Request, appUrl: string | undefined): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (appUrl) allowed.add(new URL(appUrl).origin);
  return allowed.has(origin);
}

export function clientIpFrom(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
