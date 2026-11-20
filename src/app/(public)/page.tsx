import Link from "next/link";
import { BRAND_TAGLINE } from "@/components/brand/brand-mark";
import { EventCard } from "@/components/events/event-card";
import { db } from "@/lib/db";
import { listPublicEvents } from "@/modules/events/server/events";

export const dynamic = "force-dynamic";

const REVEAL_STEPS = [
  { title: "Prepare and freeze", body: "Participants, prizes and rules are locked and fingerprinted with SHA-256 before the first draw." },
  { title: "Commit to the future", body: "Each draw commits to a public drand randomness round that has not been published yet." },
  { title: "Draw on the server", body: "The winner is chosen and recorded on the server, never in the browser or the animation." },
  { title: "Reveal on site", body: "The construction scene reveals a winner that is already committed and can be verified later." },
];

export default async function HomePage() {
  const events = (await listPublicEvents(db())).slice(0, 3);
  return (
    <>
      <section className="blueprint-grid border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold tracking-[0.2em] text-hazard uppercase">PCAS raffle and winner reveal platform</p>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight [font-stretch:110%] sm:text-6xl">{BRAND_TAGLINE}</h1>
          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
            PCASCADE runs corporate raffles as cinematic construction reveals. Winners are drawn on the server with public,
            verifiable randomness, and the build on screen shows a result that is already locked in.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/events" className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              View events
            </Link>
            <Link href="/about" className="inline-flex h-10 items-center rounded-md border border-border px-5 text-sm font-semibold hover:bg-secondary">
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold">Events</h2>
          {events.length > 0 ? (
            <Link href="/events" className="text-sm font-semibold text-hazard hover:underline">
              All events
            </Link>
          ) : null}
        </div>
        {events.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
            No events are published yet. Published events appear here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.slug} event={event} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold">How a reveal is built</h2>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {REVEAL_STEPS.map((step, index) => (
              <li key={step.title} className="flex min-w-0 flex-col gap-2 border-t-2 border-hazard pt-4">
                <span className="font-mono text-xs text-hazard">Stage {index + 1}</span>
                <h3 className="text-base font-bold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
