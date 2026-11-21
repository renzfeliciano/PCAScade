"use client";

import { formatEventDate } from "@/components/brand/event-accent";
import { revealClock } from "@/modules/presentation/domain/timeline";
import type { PresentationPrize, PublicWinner } from "@/modules/presentation/domain/state-types";
import { RevealScene } from "@/scenes/registry";
import { WinnerCard } from "@/scenes/winner-card";
import { useServerNow, useStage } from "./stage-provider";

const eyebrow = "text-[clamp(1rem,1.6vw,1.75rem)] font-semibold tracking-[0.25em] text-event-accent-ink uppercase";
const headline = "text-[clamp(3rem,7vw,9rem)] leading-[0.95] font-extrabold [font-stretch:112%]";

function Frame({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <main data-testid={testId} className="flex flex-1 flex-col justify-center gap-[3vh] px-[6vw] pb-[8vh]">
      {children}
    </main>
  );
}

export function LobbyScreen() {
  const { state } = useStage();
  const { event } = state;
  const when = formatEventDate(event.startsAt ? new Date(event.startsAt) : null);
  return (
    <Frame testId="screen-lobby">
      <p className={eyebrow}>{event.status === "LIVE" ? "Live now" : "Starting soon"}</p>
      <h1 className={`max-w-[18ch] ${headline}`}>{event.name}</h1>
      {event.welcomeMessage ? <p className="max-w-[40ch] text-[clamp(1.25rem,2.4vw,2.75rem)] text-foreground/85">{event.welcomeMessage}</p> : null}
      <div className="flex flex-wrap gap-x-[4vw] gap-y-2 text-[clamp(1rem,1.5vw,1.75rem)] text-muted-foreground">
        {when ? <span>{when}</span> : null}
        {event.venue ? <span>{event.venue}</span> : null}
      </div>
    </Frame>
  );
}

function PrizeTile({ prize }: { prize: PresentationPrize }) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card/70">
      {prize.photoUrl ? (
        <img src={prize.photoUrl} alt="" width={480} height={320} className="aspect-[3/2] w-full object-cover" />
      ) : (
        <div className="blueprint-grid aspect-[3/2] w-full" aria-hidden="true" />
      )}
      <div className="grid gap-1 p-[1.5vh_1.2vw]">
        <p className="text-[clamp(0.75rem,1vw,1.1rem)] font-semibold tracking-[0.2em] text-event-accent-ink uppercase">{prize.categoryName ?? `Prize ${prize.drawOrder}`}</p>
        <p className="text-[clamp(1.1rem,1.8vw,2.2rem)] leading-tight font-bold">{prize.name}</p>
        <p className="text-[clamp(0.9rem,1.1vw,1.3rem)] text-muted-foreground">{prize.quantity === 1 ? "1 winner" : `${prize.quantity} winners`}</p>
      </div>
    </li>
  );
}

export function PrizesScreen() {
  const { state } = useStage();
  return (
    <Frame testId="screen-prizes">
      <p className={eyebrow}>Tonight&apos;s prizes</p>
      {state.prizes.length === 0 ? (
        <p className="text-[clamp(1.25rem,2.4vw,2.75rem)] text-muted-foreground">The prize list is being finalised.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(22vw,100%),1fr))] gap-[2vw]">
          {state.prizes.map((prize) => (
            <PrizeTile key={prize.id} prize={prize} />
          ))}
        </ul>
      )}
    </Frame>
  );
}

function WinnerChips({ winners }: { winners: PublicWinner[] }) {
  if (winners.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-[1vw]">
      {winners.map((winner) => (
        <li key={winner.drawId} className="rounded-md border border-border bg-card/70 px-[1.2vw] py-[0.8vh] text-[clamp(1rem,1.4vw,1.6rem)]">
          <span className="mr-2 font-mono text-muted-foreground">#{winner.slotNumber}</span>
          {winner.person.name}
        </li>
      ))}
    </ul>
  );
}

function PrizeIntro({ prize, note }: { prize: PresentationPrize; note: string }) {
  return (
    <div className="flex flex-col items-center gap-[3vh] text-center">
      {prize.photoUrl ? <img src={prize.photoUrl} alt="" width={640} height={420} className="max-h-[38vh] w-auto rounded-md object-contain shadow-2xl" /> : null}
      <p className={eyebrow}>{prize.categoryName ?? `Prize ${prize.drawOrder}`}</p>
      <h1 className={`max-w-[18ch] ${headline}`}>{prize.name}</h1>
      <p data-testid="draw-status" className="text-[clamp(1.25rem,2.2vw,2.5rem)] text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

export function DrawScreen({ prizeId }: { prizeId: string }) {
  const { state } = useStage();
  const now = useServerNow();
  const prize = state.prizes.find((entry) => entry.id === prizeId);
  if (!prize) {
    return (
      <Frame testId="screen-draw-missing">
        <p className="text-[clamp(1.25rem,2.4vw,2.75rem)] text-muted-foreground">This prize is not part of the event.</p>
      </Frame>
    );
  }
  const current = state.current?.prizeId === prize.id ? state.current : null;
  const clock = current?.phase === "REVEALING" && now !== null ? revealClock(now - current.phaseStartedAt, current.countdownMs, current.sceneMs) : null;
  const shownWinners = prize.winners.filter((winner) => !(clock && clock.stage !== "revealed" && winner.drawId === current?.drawId));
  const drawn = shownWinners.length;
  const progressNote = `${drawn} of ${prize.quantity} ${prize.quantity === 1 ? "winner" : "winners"} revealed`;

  let body: React.ReactNode;
  if (current?.phase === "DRAWING") {
    body = <PrizeIntro prize={prize} note="Drawing on the server, locked to a public drand round…" />;
  } else if (current?.phase === "READY") {
    body = <PrizeIntro prize={prize} note="The winner is locked in. Get ready." />;
  } else if (current?.phase === "REVEALING" && current.winner) {
    if (!clock) {
      body = <PrizeIntro prize={prize} note="The winner is locked in. Get ready." />;
    } else if (clock.stage === "countdown") {
      body = (
        <div className="flex flex-col items-center gap-[2vh] text-center" data-testid="reveal-countdown">
          <p className={eyebrow}>{prize.name}</p>
          <p className="text-[clamp(8rem,28vw,30rem)] leading-none font-extrabold text-event-accent-ink tabular-nums">{Math.ceil(clock.countdownLeftMs / 1000)}</p>
        </div>
      );
    } else if (clock.stage === "scene") {
      body = (
        <RevealScene
          sceneKey={prize.sceneKey}
          winner={current.winner}
          prize={{ name: prize.name, categoryName: prize.categoryName }}
          accent={state.event.accent}
          quality="standard"
          elapsedMs={clock.sceneElapsedMs}
          durationMs={current.sceneMs}
        />
      );
    } else {
      body = (
        <div data-testid="reveal-final" className="flex flex-col items-center">
          <WinnerCard winner={current.winner} prizeName={prize.name} />
        </div>
      );
    }
  } else {
    body = <PrizeIntro prize={prize} note={drawn >= prize.quantity ? "All winners revealed" : progressNote} />;
  }

  return (
    <main data-testid="screen-draw" data-phase={current?.phase ?? "IDLE"} data-stage={clock?.stage ?? ""} className="flex flex-1 flex-col items-center justify-center gap-[4vh] px-[6vw] pb-[6vh]">
      {body}
      {clock?.stage === "revealed" || !clock ? <WinnerChips winners={shownWinners} /> : null}
    </main>
  );
}

export function WinnerWallScreen() {
  const { state } = useStage();
  const withWinners = state.prizes.filter((prize) => prize.winners.length > 0);
  return (
    <Frame testId="screen-winner-wall">
      <p className={eyebrow}>Winners</p>
      {withWinners.length === 0 ? (
        <p className="text-[clamp(1.25rem,2.4vw,2.75rem)] text-muted-foreground">Winners appear here as they are revealed.</p>
      ) : (
        <div className="grid gap-[3vh]">
          {withWinners.map((prize) => (
            <section key={prize.id} className="grid gap-[1.2vh]">
              <h2 className="text-[clamp(1.25rem,2vw,2.4rem)] font-bold">{prize.name}</h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(18vw,100%),1fr))] gap-[1.2vw]">
                {prize.winners.map((winner) => (
                  <li key={winner.drawId} className="flex min-w-0 items-center gap-[1vw] rounded-md border border-border bg-card/70 p-[1vh_1vw]">
                    {winner.person.photoUrl ? (
                      <img src={winner.person.photoUrl} alt="" width={96} height={96} className="size-[6vh] shrink-0 rounded-sm object-cover" />
                    ) : null}
                    <span className="min-w-0">
                      <span className="block truncate text-[clamp(1rem,1.5vw,1.8rem)] font-semibold">{winner.person.name}</span>
                      {winner.person.department ? <span className="block truncate text-[clamp(0.85rem,1vw,1.2rem)] text-muted-foreground">{winner.person.department}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Frame>
  );
}

export function RecapScreen() {
  const { state } = useStage();
  const { raffle } = state;
  const prizeCount = state.prizes.length;
  return (
    <Frame testId="screen-recap">
      <p className={eyebrow}>Thank you</p>
      <h1 className={`max-w-[18ch] ${headline}`}>{state.event.name}</h1>
      <dl className="grid grid-cols-2 gap-[3vw] sm:grid-cols-4">
        {[
          { label: "Prizes", value: prizeCount },
          { label: "Winners revealed", value: raffle?.winnersShown ?? 0 },
          { label: "Winner slots", value: raffle?.slotCount ?? 0 },
          { label: "Resets", value: raffle?.resets ?? 0 },
        ].map((item) => (
          <div key={item.label} className="grid gap-1 border-t-4 border-event-accent pt-[1.5vh]">
            <dt className="text-[clamp(0.9rem,1.2vw,1.4rem)] text-muted-foreground">{item.label}</dt>
            <dd className="text-[clamp(2.5rem,5vw,6rem)] leading-none font-extrabold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {raffle ? (
        <p className="max-w-[60ch] text-[clamp(1rem,1.5vw,1.75rem)] text-muted-foreground">
          Every draw can be checked independently at <span className="font-mono text-foreground">/verify/{raffle.id}</span>. Manifest{" "}
          <span className="font-mono text-foreground">{raffle.manifestSha256.slice(0, 16)}…</span>
        </p>
      ) : null}
    </Frame>
  );
}
