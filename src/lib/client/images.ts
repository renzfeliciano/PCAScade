import { SOURCE_IMAGE_LIMITS, STORED_PHOTO_MAX_SIDE } from "@/modules/imports/domain/photos";

export class ImagePreparationError extends Error {
  constructor(readonly reason: "UNREADABLE" | "TOO_LARGE" | "TOO_SMALL") {
    super(reason);
  }
}

export async function prepareWebpPhoto(source: Blob, maxSide = STORED_PHOTO_MAX_SIDE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new ImagePreparationError("UNREADABLE");
  }
  try {
    const { width, height } = bitmap;
    if (width < SOURCE_IMAGE_LIMITS.minSide || height < SOURCE_IMAGE_LIMITS.minSide) throw new ImagePreparationError("TOO_SMALL");
    if (width > SOURCE_IMAGE_LIMITS.maxSide || height > SOURCE_IMAGE_LIMITS.maxSide || width * height > SOURCE_IMAGE_LIMITS.maxPixels) {
      throw new ImagePreparationError("TOO_LARGE");
    }
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImagePreparationError("UNREADABLE");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new ImagePreparationError("UNREADABLE");
    return blob;
  } finally {
    bitmap.close();
  }
}

export function describeImageProblem(reason: ImagePreparationError["reason"]): string {
  if (reason === "TOO_LARGE") return "The image is larger than 12,000 pixels on a side.";
  if (reason === "TOO_SMALL") return "The image is smaller than 64 pixels on a side.";
  return "The file could not be read as a JPEG, PNG or WebP image.";
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
