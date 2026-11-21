export const SEEK_THRESHOLD_MS = 400;

export class StageClock {
  private elapsed = 0;
  private at = 0;
  private last = 0;
  private frozen = true;

  constructor(private readonly now: () => number = () => performance.now()) {}

  sync(elapsed: number, frozen: boolean) {
    this.elapsed = elapsed;
    this.at = this.now();
    this.frozen = frozen;
    if (frozen) this.last = elapsed;
  }

  read(durationMs: number) {
    const projected = this.frozen ? this.elapsed : this.elapsed + (this.now() - this.at);
    const next = Math.abs(projected - this.last) > SEEK_THRESHOLD_MS ? projected : Math.max(this.last, projected);
    this.last = Math.min(durationMs, Math.max(0, next));
    return this.last;
  }
}
