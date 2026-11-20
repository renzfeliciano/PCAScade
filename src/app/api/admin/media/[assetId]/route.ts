import { db } from "@/lib/db";
import { getAdminSession } from "@/modules/auth/server/request-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  if (!(await getAdminSession())) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) return new Response(null, { status: 404 });
  const asset = await db().mediaAsset.findUnique({ where: { id: assetId }, select: { mimeType: true, blob: { select: { data: true } } } });
  if (!asset?.blob) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(asset.blob.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
