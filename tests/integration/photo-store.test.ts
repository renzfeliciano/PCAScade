import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { deleteImage, eventMediaCacheTag, mediaCacheTag, readPublicImage, storeImage } from "@/modules/media/server/photo-store";
import { pngHeader } from "../fixtures/images";
import { createRaffleFixture, testDb } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

describe("photo storage in PostgreSQL", () => {
  it("stores bytes with server-derived metadata and reads them back unchanged", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1, eventStatus: "PUBLISHED" });
    const bytes = pngHeader(320, 240);
    const stored = await storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes });

    expect(stored).toMatchObject({ mimeType: "image/png", width: 320, height: 240, byteSize: bytes.length });
    expect(stored.sha256Hex).toBe(createHash("sha256").update(bytes).digest("hex"));

    const read = await readPublicImage(database, stored.id);
    expect(read?.mimeType).toBe("image/png");
    expect(read?.etag).toBe(stored.sha256Hex);
    expect(Buffer.from(read?.data ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  it("does not serve photos of draft events", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1, eventStatus: "DRAFT" });
    const stored = await storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes: pngHeader(10, 10) });
    expect(await readPublicImage(database, stored.id)).toBeNull();
  });

  it("tags public responses with the photo and its event so the CDN copy can be purged", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1, eventStatus: "PUBLISHED" });
    const stored = await storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes: pngHeader(10, 10) });
    const read = await readPublicImage(database, stored.id);
    expect(read?.cacheTags).toEqual([mediaCacheTag(stored.id), eventMediaCacheTag(fixture.eventId)]);
  });

  it("deletes the photo, unlinks it from participants, and purges its CDN tag", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1, eventStatus: "PUBLISHED" });
    const stored = await storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes: pngHeader(10, 10) });
    const participantId = fixture.participantIds[0] ?? "";
    await database.participant.update({ where: { id: participantId }, data: { photoId: stored.id } });

    const purged: string[][] = [];
    const removed = await deleteImage(database, stored.id, async (tags) => {
      purged.push(tags);
    });

    expect(removed).toBe(true);
    expect(purged).toEqual([[mediaCacheTag(stored.id)]]);
    expect(await readPublicImage(database, stored.id)).toBeNull();
    expect(await database.mediaBlob.count({ where: { assetId: stored.id } })).toBe(0);
    expect((await database.participant.findUniqueOrThrow({ where: { id: participantId } })).photoId).toBeNull();
  });

  it("still purges the CDN tag when the photo row is already gone", async () => {
    const purged: string[][] = [];
    const missing = "01a1f8e1-0000-7000-8000-000000000000";
    const removed = await deleteImage(database, missing, async (tags) => {
      purged.push(tags);
    });
    expect(removed).toBe(false);
    expect(purged).toEqual([[mediaCacheTag(missing)]]);
  });

  it("refuses non-image content before touching the database", async () => {
    const fixture = await createRaffleFixture(database, { participants: 1, quantity: 1 });
    const before = await database.mediaAsset.count();
    await expect(
      storeImage(database, { eventId: fixture.eventId, kind: "PARTICIPANT_PHOTO", bytes: new TextEncoder().encode("not an image") }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
    expect(await database.mediaAsset.count()).toBe(before);
  });
});
