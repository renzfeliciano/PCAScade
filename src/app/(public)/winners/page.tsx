import type { Metadata } from "next";
import Link from "next/link";
import { WinnerList } from "@/components/public/winner-list";
import { db } from "@/lib/db";
import { publicWinnerGallery } from "@/modules/presentation/server/public-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Winners" };

export default async function WinnersPage() {
  const galleries = await publicWinnerGallery(db());
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold">Winners</h1>
        <p className="max-w-[65ch] text-muted-foreground">
          Winners appear here once they are revealed on the event screen. If a draw is reset, that winner is removed here and the reset is listed on the
          raffle&apos;s verification page.
        </p>
      </header>
      {galleries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">No winners have been revealed yet.</p>
      ) : (
        galleries.map((gallery) => (
          <section key={gallery.event.id} className="grid gap-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2">
              <h2 className="text-xl font-bold">
                <Link href={`/events/${gallery.event.slug}`} className="hover:underline">
                  {gallery.event.name}
                </Link>
              </h2>
              {gallery.preparationId ? (
                <Link href={`/verify/${gallery.preparationId}`} className="text-sm font-semibold text-hazard hover:underline">
                  Verify these draws
                </Link>
              ) : null}
            </div>
            <WinnerList prizes={gallery.prizes} />
          </section>
        ))
      )}
    </div>
  );
}
