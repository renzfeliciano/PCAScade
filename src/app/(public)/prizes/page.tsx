import type { Metadata } from "next";
import Link from "next/link";
import { PrizeGrid } from "@/components/public/prize-grid";
import { db } from "@/lib/db";
import { publicPrizeCatalog } from "@/modules/presentation/server/public-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prizes" };

export default async function PrizesPage() {
  const catalog = await publicPrizeCatalog(db());
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold">Prizes</h1>
        <p className="text-muted-foreground">What can be won at each published event.</p>
      </header>
      {catalog.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">No prizes are published yet.</p>
      ) : (
        catalog.map(({ event, prizes }) => (
          <section key={event.id} className="grid gap-4">
            <h2 className="text-xl font-bold">
              <Link href={`/events/${event.slug}`} className="hover:underline">
                {event.name}
              </Link>
            </h2>
            <PrizeGrid prizes={prizes} />
          </section>
        ))
      )}
    </div>
  );
}
