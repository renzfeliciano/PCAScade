import type { CatalogPrize } from "@/modules/presentation/server/public-pages";

export function PrizeGrid({ prizes }: { prizes: CatalogPrize[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {prizes.map((prize) => (
        <li key={prize.id} className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          {prize.photoUrl ? (
            <img src={prize.photoUrl} alt="" width={480} height={320} loading="lazy" className="aspect-[3/2] w-full object-cover" />
          ) : (
            <div className="blueprint-grid aspect-[3/2] w-full" aria-hidden="true" />
          )}
          <div className="grid gap-1 p-4">
            {prize.categoryName ? <p className="text-xs font-semibold tracking-wide text-hazard uppercase">{prize.categoryName}</p> : null}
            <h3 className="font-bold">{prize.name}</h3>
            {prize.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{prize.description}</p> : null}
            <p className="text-xs text-muted-foreground">{prize.quantity === 1 ? "1 winner" : `${prize.quantity} winners`}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
