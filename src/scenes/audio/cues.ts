import type { Cue, Kit } from "./engine";

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const thump = (at: number, frequency = 70, gain = 0.5): Cue => ({
  at,
  play: (kit, when) => {
    kit.tone(when, 0.5, { frequency: frequency * 1.8, glideTo: frequency * 0.6, gain, attack: 0.004, release: 0.42 });
    kit.noise(when, 0.18, { filter: "lowpass", frequency: 900, sweepTo: 200, gain: gain * 0.5, attack: 0.002 });
  },
});

const grind = (at: number, duration: number, gain = 0.22): Cue => ({
  at,
  play: (kit, when) => {
    kit.noise(when, duration, { filter: "bandpass", frequency: 520, sweepTo: 380, q: 1.4, gain, attack: 0.02 });
    kit.tone(when, duration, { frequency: 46, type: "sawtooth", gain: gain * 0.35, lowpass: 220, attack: 0.02 });
  },
});

const clank = (at: number, base = 340, gain = 0.2): Cue => ({
  at,
  play: (kit, when) => {
    for (const [ratio, level, length] of [
      [1, 1, 0.9],
      [2.76, 0.6, 0.6],
      [5.4, 0.35, 0.35],
      [8.93, 0.2, 0.2],
    ] as const) {
      kit.tone(when, length, { frequency: base * ratio, type: "triangle", gain: gain * level, attack: 0.002, release: length * 0.9 });
    }
    kit.noise(when, 0.05, { filter: "highpass", frequency: 2500, gain: gain * 0.6, attack: 0.001 });
  },
});

const clicks = (start: number, end: number, count: number, seed: number, gain = 0.12): Cue[] => {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const at = start + random() * (end - start);
    const pitch = 1800 + random() * 3000;
    return { at, play: (kit: Kit, when: number) => kit.noise(when, 0.03 + random() * 0.03, { filter: "bandpass", frequency: pitch, q: 3, gain: gain * (0.5 + random() * 0.5), attack: 0.001 }) };
  });
};

const bed = (at: number, duration: number, options: { frequency: number; gain: number; filter?: BiquadFilterType; q?: number }): Cue => ({
  at,
  duration,
  play: (kit, when, into, length) => kit.noise(when, length, { filter: options.filter ?? "lowpass", frequency: options.frequency, q: options.q ?? 0.7, gain: options.gain, attack: into > 0 ? 0.3 : 0.8, release: 0.8 }),
});

const hum = (at: number, duration: number, frequency: number, gain: number): Cue => ({
  at,
  duration,
  play: (kit, when, into, length) => {
    kit.tone(when, length, { frequency, gain, attack: into > 0 ? 0.2 : 0.6, release: 0.6 });
    kit.tone(when, length, { frequency: frequency * 2, gain: gain * 0.4, attack: into > 0 ? 0.2 : 0.6, release: 0.6 });
  },
});

const motor = (at: number, duration: number, from: number, to: number, gain: number): Cue => ({
  at,
  duration,
  play: (kit, when, into, length) => {
    const start = from + (to - from) * (into / duration);
    kit.tone(when, length, { frequency: start, glideTo: to, type: "sawtooth", gain, lowpass: 600, attack: 0.15, release: 0.3 });
    kit.tone(when, length, { frequency: start * 1.5, glideTo: to * 1.5, type: "square", gain: gain * 0.25, lowpass: 900, attack: 0.15, release: 0.3 });
  },
});

const swell = (at: number, duration: number, from: number, to: number, gain: number): Cue => ({
  at,
  duration,
  play: (kit, when, into, length) => {
    const start = from * Math.pow(to / from, into / duration);
    kit.tone(when, length, { frequency: start, glideTo: to, type: "triangle", gain, attack: Math.min(0.8, length * 0.6), release: 0.3 });
    kit.tone(when, length, { frequency: start * 1.503, glideTo: to * 1.503, gain: gain * 0.5, attack: Math.min(0.8, length * 0.6), release: 0.3 });
  },
});

const switchOn = (at: number, gain = 0.3): Cue => ({
  at,
  play: (kit, when) => {
    kit.noise(when, 0.06, { filter: "bandpass", frequency: 1400, q: 2, gain, attack: 0.001 });
    kit.tone(when, 0.25, { frequency: 120, glideTo: 60, gain: gain * 0.6, attack: 0.002 });
  },
});

const sparkles = (start: number, end: number, count: number, seed: number, gain = 0.06): Cue[] => {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const at = start + random() * (end - start);
    const pitch = 1600 + random() * 2600;
    return { at, play: (kit: Kit, when: number) => kit.tone(when, 0.35, { frequency: pitch, gain: gain * (0.4 + random() * 0.6), attack: 0.003, release: 0.32 }) };
  });
};

const CHORD = [261.63, 329.63, 392, 523.25];

const sting = (at: number, grand = false): Cue => ({
  at,
  duration: grand ? 3.5 : 2.8,
  play: (kit, when, into, length) => {
    const level = grand ? 0.085 : 0.07;
    const notes = grand ? [...CHORD, 659.25, 783.99, 130.81] : CHORD;
    for (const note of notes) {
      kit.tone(when, length, { frequency: note, type: "triangle", gain: level, attack: into > 0 ? 0.05 : 0.06, release: Math.min(2, length * 0.7) });
      kit.tone(when, length, { frequency: note * 1.004, gain: level * 0.6, attack: 0.08, release: Math.min(2, length * 0.7) });
    }
    if (into === 0) kit.noise(when, 1.2, { filter: "highpass", frequency: 5000, gain: 0.05, attack: 0.01, release: 1.1 });
  },
});

const brickByBrick: Cue[] = [
  bed(0, 7, { frequency: 260, gain: 0.05 }),
  swell(1.2, 1.6, 180, 260, 0.04),
  grind(2.8, 0.16),
  thump(2.8, 90, 0.25),
  grind(3.4, 0.16),
  thump(3.4, 90, 0.28),
  grind(4.0, 0.18),
  thump(4.0, 85, 0.3),
  grind(4.4, 0.42, 0.26),
  ...clicks(4.42, 4.9, 12, 3),
  thump(4.95, 60, 0.45),
  swell(5.2, 1.6, 220, 330, 0.035),
  sting(5.6),
];

const buildItUp: Cue[] = [
  bed(0, 8, { frequency: 180, gain: 0.05 }),
  hum(0, 8, 60, 0.025),
  motor(2, 1.2, 90, 180, 0.018),
  swell(3.12, 0.48, 200, 420, 0.035),
  thump(3.6, 50, 0.6),
  { at: 3.6, play: (kit, when) => kit.noise(when, 0.35, { filter: "highpass", frequency: 1200, sweepTo: 400, gain: 0.3, attack: 0.002 }) },
  grind(4.0, 1.4, 0.2),
  ...clicks(3.7, 5.2, 14, 7),
  swell(4.2, 1.6, 160, 240, 0.035),
  thump(5.35, 55, 0.3),
  sting(6.0),
];

const bigLift: Cue[] = [
  bed(0, 9, { frequency: 700, gain: 0.04, filter: "bandpass", q: 0.4 }),
  motor(0, 2.2, 120, 70, 0.02),
  thump(2.2, 65, 0.3),
  motor(2.2, 2.8, 65, 120, 0.022),
  clank(5.0, 180, 0.12),
  swell(5.6, 0.65, 200, 300, 0.03),
  clank(6.25, 320, 0.18),
  clank(6.35, 290, 0.14),
  clank(6.4, 350, 0.14),
  clank(6.5, 270, 0.12),
  clank(6.55, 310, 0.12),
  switchOn(7.0),
  switchOn(7.25, 0.24),
  hum(7.0, 2, 100, 0.012),
  sting(7.2),
];

const grandFinale: Cue[] = [
  bed(0, 11, { frequency: 400, gain: 0.04 }),
  swell(0, 6, 55, 110, 0.04),
  ...Array.from({ length: 22 }, (_, index) => ({
    at: 0.25 + index * 0.25,
    play: (kit: Kit, when: number) => kit.noise(when, 0.04, { filter: "bandpass", frequency: 2200 + (index % 3) * 500, q: 4, gain: 0.08, attack: 0.001 }),
  })),
  ...clicks(0.5, 5.6, 18, 11, 0.06),
  switchOn(6.0),
  switchOn(6.15, 0.26),
  switchOn(6.3, 0.26),
  switchOn(6.45, 0.28),
  swell(6.5, 2, 130, 196, 0.04),
  swell(7.0, 1.5, 300, 600, 0.03),
  thump(8.5, 42, 0.8),
  { at: 8.5, play: (kit, when) => kit.noise(when, 1.6, { filter: "lowpass", frequency: 3000, sweepTo: 150, gain: 0.32, attack: 0.003, release: 1.4 }) },
  ...sparkles(8.5, 10.5, 24, 13),
  sting(8.7, true),
];

export const SCENE_CUES: Record<string, Cue[]> = {
  "brick-by-brick": brickByBrick,
  "build-it-up": buildItUp,
  "big-lift": bigLift,
  "grand-finale": grandFinale,
};

function countdownCues(countdownSeconds: number): Cue[] {
  const ticks: Cue[] = [];
  for (let left = Math.ceil(countdownSeconds); left >= 1; left--) {
    const at = countdownSeconds - left;
    if (at < 0) continue;
    const last = left === 1;
    ticks.push({ at, late: 0.9, play: (kit, when) => kit.tone(when, last ? 0.35 : 0.18, { frequency: last ? 1320 : 880, type: "triangle", gain: 0.12, attack: 0.003 }) });
  }
  return ticks;
}

export function revealCues(sceneKey: string, countdownMs: number): Cue[] {
  const countdown = Math.max(0, countdownMs) / 1000;
  const scene = SCENE_CUES[sceneKey] ?? brickByBrick;
  return [...countdownCues(countdown), ...scene.map((cue) => ({ ...cue, at: cue.at + countdown }))];
}
