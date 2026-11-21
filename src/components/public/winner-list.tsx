import type { GalleryPrize } from "@/modules/presentation/server/public-pages";

export function WinnerList({ prizes }: { prizes: GalleryPrize[] }) {
  return (
    <div className="grid gap-6">
      {prizes.map((prize) => (
        <section key={prize.id} className="grid gap-3">
          <h3 className="flex flex-wrap items-baseline gap-x-3 text-lg font-bold">
            {prize.name}
            {prize.categoryName ? <span className="text-xs font-semibold tracking-wide text-hazard uppercase">{prize.categoryName}</span> : null}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {prize.winners.map((winner) => (
              <li key={winner.drawId} className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3">
                {winner.person.photoUrl ? (
                  <img src={winner.person.photoUrl} alt="" width={56} height={56} loading="lazy" className="size-14 shrink-0 rounded-sm object-cover" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{winner.person.name}</span>
                  {winner.person.jobTitle || winner.person.department ? (
                    <span className="block truncate text-sm text-muted-foreground">{[winner.person.jobTitle, winner.person.department].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
