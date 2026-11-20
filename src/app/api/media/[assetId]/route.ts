import { db } from "@/lib/db";
import { readPublicImage, readPublicImageMeta } from "@/modules/media/server/photo-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_BROWSER_CACHE = "public, max-age=300";
const MEDIA_CDN_CACHE = "max-age=31536000";

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function cacheHeaders(etag: string, cacheTags: string[]) {
  return {
    "Cache-Control": MEDIA_BROWSER_CACHE,
    "Vercel-CDN-Cache-Control": MEDIA_CDN_CACHE,
    "Vercel-Cache-Tag": cacheTags.join(","),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) return notFound();

  const database = db();
  const meta = await readPublicImageMeta(database, assetId);
  if (!meta) return notFound();

  const etag = `"${meta.etag}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders(etag, meta.cacheTags) });
  }

  const image = await readPublicImage(database, assetId);
  if (!image) return notFound();
  return new Response(new Uint8Array(image.data), {
    status: 200,
    headers: {
      ...cacheHeaders(`"${image.etag}"`, image.cacheTags),
      "Content-Type": image.mimeType,
      "Content-Length": String(image.data.length),
    },
  });
}
