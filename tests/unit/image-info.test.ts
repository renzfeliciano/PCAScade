import { describe, expect, it } from "vitest";
import { readImageInfo } from "@/modules/media/domain/image-info";
import { MAX_IMAGE_BYTES, MediaError, validateImage } from "@/modules/media/server/photo-store";
import { jpegHeader, pngHeader, webpVp8xHeader } from "../fixtures/images";

describe("readImageInfo", () => {
  it("reads PNG dimensions from IHDR", () => {
    expect(readImageInfo(pngHeader(640, 480))).toEqual({ mimeType: "image/png", width: 640, height: 480 });
  });

  it("reads JPEG dimensions from the SOF segment after other segments", () => {
    expect(readImageInfo(jpegHeader(800, 600))).toEqual({ mimeType: "image/jpeg", width: 800, height: 600 });
  });

  it("reads WebP (VP8X) canvas dimensions", () => {
    expect(readImageInfo(webpVp8xHeader(1024, 768))).toEqual({ mimeType: "image/webp", width: 1024, height: 768 });
  });

  it("ignores the file name and rejects non-images disguised as images", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(readImageInfo(html)).toBeNull();
    const gif = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
    expect(readImageInfo(gif)).toBeNull();
  });

  it("rejects truncated headers", () => {
    expect(readImageInfo(pngHeader(10, 10).slice(0, 20))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("rejects segments and chunks whose declared length does not fit", () => {
    const shortSof = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03]);
    expect(readImageInfo(shortSof)).toBeNull();
    const overlongSegment = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0x00]);
    expect(readImageInfo(overlongSegment)).toBeNull();

    const zeroedWebp = new Uint8Array(30);
    zeroedWebp.set([0x52, 0x49, 0x46, 0x46], 0);
    zeroedWebp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
    expect(readImageInfo(zeroedWebp)).toBeNull();

    const lyingRiff = webpVp8xHeader(10, 10);
    lyingRiff[4] = 0xff;
    expect(readImageInfo(lyingRiff)).toBeNull();

    const badIhdr = pngHeader(10, 10);
    badIhdr[11] = 12;
    expect(readImageInfo(badIhdr)).toBeNull();
  });
});

describe("validateImage", () => {
  it("rejects empty, oversized and over-dimension files", () => {
    expect(() => validateImage(new Uint8Array())).toThrow(MediaError);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(pngHeader(10, 10));
    expect(() => validateImage(big)).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
    expect(() => validateImage(pngHeader(5000, 10))).toThrow(expect.objectContaining({ code: "DIMENSIONS_OUT_OF_RANGE" }));
  });
});
