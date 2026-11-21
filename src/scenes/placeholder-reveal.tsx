import type { SceneProps } from "./types";
import { WinnerCard } from "./winner-card";

const COLUMNS = 12;
const ROWS = 7;
const BUILD_SHARE = 0.7;

export function PlaceholderReveal({ winner, prize, elapsedMs, durationMs }: SceneProps) {
  const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs));
  const built = Math.min(1, progress / BUILD_SHARE);
  const laid = Math.floor(built * COLUMNS * ROWS);
  const open = Math.max(0, (progress - BUILD_SHARE) / (1 - BUILD_SHARE));

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div
        aria-hidden="true"
        className="grid w-[min(80vw,140vh)] gap-[0.5vh]"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, opacity: 1 - open * 0.85 }}
      >
        {Array.from({ length: COLUMNS * ROWS }, (_, index) => {
          const fromBottom = (ROWS - 1 - Math.floor(index / COLUMNS)) * COLUMNS + (index % COLUMNS);
          const placed = fromBottom < laid;
          return (
            <span
              key={index}
              className="aspect-[2.2/1] rounded-[2px] bg-event-accent"
              style={{ opacity: placed ? 0.35 + ((fromBottom * 37) % 50) / 100 : 0.04, transform: placed ? "none" : "translateY(-2vh)" }}
            />
          );
        })}
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-[6vw]" style={{ opacity: open, transform: `scale(${0.92 + open * 0.08})` }}>
        {open > 0 ? <WinnerCard winner={winner} prizeName={prize.name} /> : null}
      </div>
    </div>
  );
}
