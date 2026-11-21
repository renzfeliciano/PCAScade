import type { PublicPerson } from "@/modules/presentation/domain/display";

export function WinnerCard({ winner, prizeName, showBio = true }: { winner: PublicPerson; prizeName: string; showBio?: boolean }) {
  const role = [winner.jobTitle, winner.department].filter(Boolean).join(" · ");
  return (
    <div data-testid="winner-card" className="flex flex-col items-center gap-[2.5vh] text-center">
      {winner.photoUrl ? (
        <img
          src={winner.photoUrl}
          alt=""
          width={320}
          height={320}
          className="size-[min(28vh,28vw)] rounded-md border-4 border-event-accent object-cover shadow-2xl"
        />
      ) : null}
      <p className="text-[clamp(1rem,1.6vw,1.75rem)] font-semibold tracking-[0.25em] text-event-accent-ink uppercase">{prizeName}</p>
      <p data-testid="winner-name" className="max-w-[20ch] text-[clamp(2.5rem,6.5vw,8rem)] leading-[0.95] font-extrabold [font-stretch:112%]">
        {winner.name}
      </p>
      {role ? <p className="text-[clamp(1.25rem,2.2vw,2.5rem)] text-foreground/85">{role}</p> : null}
      {showBio && winner.bio ? <p className="max-w-[50ch] text-[clamp(1rem,1.5vw,1.75rem)] text-muted-foreground">{winner.bio}</p> : null}
    </div>
  );
}
