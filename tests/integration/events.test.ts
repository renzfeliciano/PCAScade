import { afterAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/modules/audit/server/audit-log";
import { eventInputSchema } from "@/modules/events/domain/event-rules";
import {
  EventError,
  changeEventStatus,
  createEvent,
  getPresentableEvent,
  getPublicEventBySlug,
  listPublicEvents,
  updateEvent,
} from "@/modules/events/server/events";
import { eventMediaCacheTag } from "@/modules/media/server/photo-store";
import { testDb } from "./fixtures";

const database = testDb();

afterAll(async () => {
  await database.$disconnect();
});

function input(name: string, extra: Partial<Record<string, string>> = {}) {
  return eventInputSchema.parse({ name, description: "", venue: "", welcomeMessage: "", accent: "safety-amber", startsAt: "", ...extra });
}

function recordingPurger() {
  const calls: string[][] = [];
  return { calls, purge: async (tags: string[]) => void calls.push(tags) };
}

describe("event management", () => {
  it("creates draft events with unique slugs and audits them", async () => {
    const first = await createEvent(database, input("Gala Night 2026"));
    const second = await createEvent(database, input("Gala Night 2026"));
    expect(first.status).toBe("DRAFT");
    expect(first.slug).toBe("gala-night-2026");
    expect(second.slug).toBe("gala-night-2026-2");
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "event.created", entityId: first.id } });
    expect(audit.eventId).toBe(first.id);
    expect(JSON.parse(audit.payload)).toMatchObject({ name: "Gala Night 2026", slug: "gala-night-2026" });
  });

  it("records exactly what changed on update", async () => {
    const event = await createEvent(database, input("Site Opening", { venue: "Pasig" }));
    await updateEvent(database, event.id, input("Site Opening", { venue: "Taguig", startsAt: "2026-12-19T18:00" }));
    const audit = await database.auditLog.findFirstOrThrow({ where: { action: "event.updated", entityId: event.id } });
    const changes = JSON.parse(audit.payload).changes as Record<string, unknown>;
    expect(Object.keys(changes).sort()).toEqual(["startsAt", "venue"]);
    expect(changes.venue).toEqual({ from: "Pasig", to: "Taguig" });
    await expect(updateEvent(database, "0193a1b2-0000-7000-8000-00000000dead", input("Missing"))).rejects.toBeInstanceOf(EventError);
  });

  it("only shows published, live and closed events publicly", async () => {
    const draft = await createEvent(database, input("Hidden Draft"));
    const published = await createEvent(database, input("Visible Event"));
    const { purge } = recordingPurger();
    await changeEventStatus(database, published.id, "PUBLISHED", purge);

    const slugs = (await listPublicEvents(database)).map((event) => event.slug);
    expect(slugs).toContain(published.slug);
    expect(slugs).not.toContain(draft.slug);
    expect(await getPublicEventBySlug(database, draft.slug)).toBeNull();
    expect(await getPresentableEvent(database, published.slug)).not.toBeNull();
    expect(await getPresentableEvent(database, draft.id)).toBeNull();
  });

  it("enforces the status machine", async () => {
    const event = await createEvent(database, input("Transitions"));
    const { purge } = recordingPurger();
    await expect(changeEventStatus(database, event.id, "LIVE", purge)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await changeEventStatus(database, event.id, "PUBLISHED", purge);
    await changeEventStatus(database, event.id, "LIVE", purge);
    await expect(changeEventStatus(database, event.id, "DRAFT", purge)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await changeEventStatus(database, event.id, "CLOSED", purge);
    const statuses = await database.auditLog.findMany({ where: { action: "event.status_changed", entityId: event.id }, orderBy: { seq: "asc" } });
    expect(statuses.map((entry) => JSON.parse(entry.payload).to)).toEqual(["PUBLISHED", "LIVE", "CLOSED"]);
  });

  it("purges the event's cached photos only when it stops being public", async () => {
    const event = await createEvent(database, input("Cache Purge"));
    const purger = recordingPurger();
    await changeEventStatus(database, event.id, "PUBLISHED", purger.purge);
    await changeEventStatus(database, event.id, "LIVE", purger.purge);
    await changeEventStatus(database, event.id, "CLOSED", purger.purge);
    expect(purger.calls).toEqual([]);
    await changeEventStatus(database, event.id, "ARCHIVED", purger.purge);
    expect(purger.calls).toEqual([[eventMediaCacheTag(event.id)]]);
  });

  it("lets only one of two conflicting status changes win", async () => {
    const event = await createEvent(database, input("Race"));
    const { purge } = recordingPurger();
    await changeEventStatus(database, event.id, "PUBLISHED", purge);
    const outcomes = await Promise.allSettled([
      changeEventStatus(database, event.id, "LIVE", purge),
      changeEventStatus(database, event.id, "DRAFT", purge),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await verifyAuditChain(database)).toMatchObject({ ok: true });
  });
});
