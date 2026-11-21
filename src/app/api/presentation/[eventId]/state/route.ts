import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { presentationState } from "@/modules/presentation/server/state";

export const dynamic = "force-dynamic";

const SLUG_OR_ID = /^[a-z0-9-]{1,80}$/;

function baseHeaders(now: number) {
  return { "Cache-Control": "private, no-cache", "X-Server-Now": String(now), "X-Content-Type-Options": "nosniff" };
}

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const now = Date.now();
  if (!SLUG_OR_ID.test(eventId)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const state = await presentationState(db(), eventId, new Date(now));
  if (!state) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = JSON.stringify(state);
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ...baseHeaders(now), ETag: etag } });
  }
  return new Response(body, { status: 200, headers: { ...baseHeaders(now), ETag: etag, "Content-Type": "application/json; charset=utf-8" } });
}
