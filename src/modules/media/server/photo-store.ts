import { createHash } from "node:crypto";
import type { MediaKind } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { readImageInfo, type ImageMime } from "@/modules/media/domain/image-info";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;

export type MediaErrorCode = "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_IMAGE" | "DIMENSIONS_OUT_OF_RANGE";

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode) {
    super(code);
  }
}

export type StoredImage = {
  id: string;
  mimeType: ImageMime;
  width: number;
  height: number;
  byteSize: number;
  sha256Hex: string;
};

export function validateImage(bytes: Uint8Array) {
  if (bytes.length === 0) throw new MediaError("EMPTY_FILE");
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaError("FILE_TOO_LARGE");
  const info = readImageInfo(bytes);
  if (!info) throw new MediaError("UNSUPPORTED_IMAGE");
  if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) {
    throw new MediaError("DIMENSIONS_OUT_OF_RANGE");
  }
  return info;
}

export async function storeImage(database: Db, input: { eventId: string; kind: MediaKind; bytes: Uint8Array }): Promise<StoredImage> {
  const info = validateImage(input.bytes);
  const digest = createHash("sha256").update(input.bytes).digest();
  const asset = await database.mediaAsset.create({
    data: {
      eventId: input.eventId,
      kind: input.kind,
      mimeType: info.mimeType,
      byteSize: input.bytes.length,
      width: info.width,
      height: info.height,
      sha256: new Uint8Array(digest),
      blob: { create: { data: new Uint8Array(input.bytes) } },
    },
  });
  return {
    id: asset.id,
    mimeType: info.mimeType,
    width: info.width,
    height: info.height,
    byteSize: asset.byteSize,
    sha256Hex: digest.toString("hex"),
  };
}

const PUBLIC_EVENT_STATUSES = ["PUBLISHED", "LIVE", "CLOSED"] as const;

export function mediaCacheTag(assetId: string): string {
  return `media-${assetId}`;
}

export function eventMediaCacheTag(eventId: string): string {
  return `event-media-${eventId}`;
}

export type PublicImageMeta = { mimeType: string; etag: string; cacheTags: string[] };

function publicAssetWhere(assetId: string) {
  return {
    id: assetId,
    event: { status: { in: [...PUBLIC_EVENT_STATUSES] } },
    OR: [{ kind: { not: "PARTICIPANT_PHOTO" as const } }, { event: { participantDisplay: { path: ["photo"], not: false } } }],
  };
}

export async function readPublicImageMeta(database: Db, assetId: string): Promise<PublicImageMeta | null> {
  const asset = await database.mediaAsset.findFirst({
    where: publicAssetWhere(assetId),
    select: { eventId: true, mimeType: true, sha256: true },
  });
  if (!asset) return null;
  return {
    mimeType: asset.mimeType,
    etag: Buffer.from(asset.sha256).toString("hex"),
    cacheTags: [mediaCacheTag(assetId), eventMediaCacheTag(asset.eventId)],
  };
}

export async function readPublicImage(database: Db, assetId: string) {
  const asset = await database.mediaAsset.findFirst({
    where: publicAssetWhere(assetId),
    select: { eventId: true, mimeType: true, sha256: true, blob: { select: { data: true } } },
  });
  if (!asset?.blob) return null;
  return {
    mimeType: asset.mimeType,
    etag: Buffer.from(asset.sha256).toString("hex"),
    cacheTags: [mediaCacheTag(assetId), eventMediaCacheTag(asset.eventId)],
    data: asset.blob.data,
  };
}

export type CachePurger = (tags: string[]) => Promise<void>;

export async function deleteImage(database: Db, assetId: string, purge: CachePurger): Promise<boolean> {
  const deleted = await database.mediaAsset.deleteMany({ where: { id: assetId } });
  await purge([mediaCacheTag(assetId)]);
  return deleted.count > 0;
}
