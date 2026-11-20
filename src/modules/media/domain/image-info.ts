export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export type ImageInfo = { mimeType: ImageMime; width: number; height: number };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) >>> 0) + (((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0));
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000;
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12) || bytes.length < 33 || u32be(bytes, 8) !== 13) return null;
  return { mimeType: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) return null;
      return { mimeType: "image/jpeg", height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) || !startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return null;
  if (bytes.length < 30) return null;
  const riffSize = u32le(bytes, 4);
  const chunkSize = u32le(bytes, 16);
  if (riffSize + 8 > bytes.length || riffSize < 4 + 8 + chunkSize || 20 + chunkSize > bytes.length) return null;
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x20], 12)) {
    if (chunkSize < 10) return null;
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return { mimeType: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x4c], 12)) {
    if (chunkSize < 5 || bytes[20] !== 0x2f) return null;
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    return {
      mimeType: "image/webp",
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (startsWith(bytes, [0x56, 0x50, 0x38, 0x58], 12)) {
    if (chunkSize < 10) return null;
    return { mimeType: "image/webp", width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  }
  return null;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const info = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
  if (!info || info.width < 1 || info.height < 1) return null;
  return info;
}
