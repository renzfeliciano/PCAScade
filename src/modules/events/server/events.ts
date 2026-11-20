import type { EventStatus } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { appendAudit } from "@/modules/audit/server/audit-log";
import {
  type EventInput,
  PUBLIC_EVENT_STATUSES,
  canTransition,
  isPublicStatus,
  slugify,
} from "@/modules/events/domain/event-rules";
import { type CachePurger, eventMediaCacheTag } from "@/modules/media/server/photo-store";

export type EventErrorCode = "EVENT_NOT_FOUND" | "INVALID_TRANSITION";

export class EventError extends Error {
  constructor(readonly code: EventErrorCode) {
    super(code);
  }
}

async function uniqueSlug(database: Db, name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await database.event.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createEvent(database: Db, input: EventInput) {
  const slug = await uniqueSlug(database, input.name);
  return database.$transaction(async (tx) => {
    const event = await tx.event.create({ data: { ...input, slug } });
    await appendAudit(tx, {
      eventId: event.id,
      actor: "admin",
      action: "event.created",
      entityType: "event",
      entityId: event.id,
      payload: { ...input, slug },
    });
    return event;
  });
}

export async function updateEvent(database: Db, eventId: string, input: EventInput) {
  const existing = await database.event.findUnique({ where: { id: eventId } });
  if (!existing) throw new EventError("EVENT_NOT_FOUND");
  const slug = existing.name === input.name ? existing.slug : await uniqueSlug(database, input.name, eventId);
  return database.$transaction(async (tx) => {
    const event = await tx.event.update({ where: { id: eventId }, data: { ...input, slug } });
    const changes = Object.fromEntries(
      (["name", "description", "venue", "welcomeMessage", "accent", "startsAt"] as const)
        .filter((key) => String(existing[key] ?? "") !== String(event[key] ?? ""))
        .map((key) => [key, { from: existing[key], to: event[key] }]),
    );
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "event.updated",
      entityType: "event",
      entityId: eventId,
      payload: { changes, slug },
    });
    return event;
  });
}

export async function changeEventStatus(database: Db, eventId: string, to: EventStatus, purge: CachePurger) {
  const updated = await database.$transaction(async (tx) => {
    const existing = await tx.event.findUnique({ where: { id: eventId }, select: { status: true } });
    if (!existing) throw new EventError("EVENT_NOT_FOUND");
    if (!canTransition(existing.status, to)) throw new EventError("INVALID_TRANSITION");
    const changed = await tx.event.updateMany({ where: { id: eventId, status: existing.status }, data: { status: to } });
    if (changed.count !== 1) throw new EventError("INVALID_TRANSITION");
    await appendAudit(tx, {
      eventId,
      actor: "admin",
      action: "event.status_changed",
      entityType: "event",
      entityId: eventId,
      payload: { from: existing.status, to },
    });
    return { from: existing.status, to };
  });
  if (isPublicStatus(updated.from) && !isPublicStatus(updated.to)) {
    await purge([eventMediaCacheTag(eventId)]);
  }
  return updated;
}

export async function listEventsForAdmin(database: Db) {
  return database.event.findMany({
    orderBy: [{ startsAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, slug: true, name: true, status: true, startsAt: true, venue: true, accent: true, updatedAt: true },
  });
}

export async function getEventForAdmin(database: Db, eventId: string) {
  return database.event.findUnique({ where: { id: eventId } });
}

const publicSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  description: true,
  venue: true,
  welcomeMessage: true,
  accent: true,
  startsAt: true,
} as const;

export async function listPublicEvents(database: Db) {
  return database.event.findMany({
    where: { status: { in: [...PUBLIC_EVENT_STATUSES] } },
    orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    select: publicSelect,
  });
}

export async function getPublicEventBySlug(database: Db, slug: string) {
  return database.event.findFirst({ where: { slug, status: { in: [...PUBLIC_EVENT_STATUSES] } }, select: publicSelect });
}

export async function getPresentableEvent(database: Db, eventId: string) {
  return database.event.findFirst({
    where: { OR: [{ slug: eventId }, ...(/^[0-9a-f-]{36}$/.test(eventId) ? [{ id: eventId }] : [])], status: { in: ["PUBLISHED", "LIVE"] } },
    select: publicSelect,
  });
}
