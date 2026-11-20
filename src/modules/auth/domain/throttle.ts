export const THROTTLE = {
  windowMs: 60 * 60 * 1000,
  freeFailures: 5,
  baseDelayMs: 60 * 1000,
  maxDelayMs: 60 * 60 * 1000,
  globalWindowMs: 15 * 60 * 1000,
  globalFailureLimit: 50,
  globalDelayMs: 60 * 1000,
} as const;

export type ThrottleInput = {
  now: number;
  clientFailuresInWindow: number;
  clientLastFailureAt: number | null;
  globalFailuresInWindow: number;
  globalLastFailureAt: number | null;
};

export function loginRetryAfterMs(input: ThrottleInput): number {
  let wait = 0;
  if (input.clientFailuresInWindow >= THROTTLE.freeFailures && input.clientLastFailureAt !== null) {
    const exponent = input.clientFailuresInWindow - THROTTLE.freeFailures;
    const delay = Math.min(THROTTLE.baseDelayMs * 2 ** Math.min(exponent, 20), THROTTLE.maxDelayMs);
    wait = Math.max(wait, input.clientLastFailureAt + delay - input.now);
  }
  if (input.globalFailuresInWindow >= THROTTLE.globalFailureLimit && input.globalLastFailureAt !== null) {
    wait = Math.max(wait, input.globalLastFailureAt + THROTTLE.globalDelayMs - input.now);
  }
  return Math.max(0, Math.ceil(wait));
}
