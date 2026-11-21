export const SOUND_PREFERENCE_KEY = "pcascade.sound";
const CATCH_UP_SECONDS = 0.06;

export type Voice = { start: number; stop: number };

export type Kit = {
  noise: (when: number, duration: number, options: { filter?: BiquadFilterType; frequency?: number; sweepTo?: number; q?: number; gain: number; attack?: number; release?: number }) => void;
  tone: (when: number, duration: number, options: { frequency: number; glideTo?: number; type?: OscillatorType; gain: number; attack?: number; release?: number; lowpass?: number }) => void;
};

export type Cue = { at: number; duration?: number; late?: number; play: (kit: Kit, when: number, into: number, length: number) => void };

export type PlannedCue = { cue: Cue; delay: number; into: number };

export function planCues(cues: Cue[], offsetSeconds: number): PlannedCue[] {
  const planned: PlannedCue[] = [];
  for (const cue of cues) {
    const delay = cue.at - offsetSeconds;
    if (delay >= -(cue.late ?? CATCH_UP_SECONDS)) {
      planned.push({ cue, delay: Math.max(0, delay), into: 0 });
      continue;
    }
    const length = cue.duration ?? 0;
    const into = offsetSeconds - cue.at;
    if (length > 0 && into < length - 0.25) planned.push({ cue, delay: 0, into });
  }
  return planned;
}

export type SoundState = "off" | "waiting" | "on";

class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly live = new Set<AudioScheduledSourceNode>();
  private readonly listeners = new Set<() => void>();
  private preferred: boolean | null = null;

  wanted(): boolean {
    if (this.preferred === null) {
      try {
        this.preferred = window.localStorage.getItem(SOUND_PREFERENCE_KEY) === "on";
      } catch {
        this.preferred = false;
      }
    }
    return this.preferred;
  }

  state(): SoundState {
    if (typeof window === "undefined" || !this.wanted()) return "off";
    return this.context?.state === "running" ? "on" : "waiting";
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async enable() {
    this.remember(true);
    const context = this.ensure();
    if (context && context.state !== "running") {
      try {
        await context.resume();
      } catch {
        return this.notify();
      }
    }
    this.notify();
  }

  disable() {
    this.remember(false);
    this.stopAll();
    void this.context?.suspend().catch(() => undefined);
    this.notify();
  }

  play(cues: Cue[], offsetSeconds: number) {
    const context = this.context;
    if (!context || context.state !== "running" || !this.master) return;
    const kit = this.kit(context, this.master);
    const now = context.currentTime + 0.03;
    for (const { cue, delay, into } of planCues(cues, offsetSeconds)) {
      const length = Math.max(0.05, (cue.duration ?? 0) - into);
      cue.play(kit, now + delay, into, length);
    }
  }

  stopAll() {
    for (const source of this.live) {
      try {
        source.stop();
      } catch {
        continue;
      }
    }
    this.live.clear();
  }

  private remember(on: boolean) {
    this.preferred = on;
    try {
      window.localStorage.setItem(SOUND_PREFERENCE_KEY, on ? "on" : "off");
    } catch {
      return;
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    try {
      const context = new AudioContext({ latencyHint: "playback" });
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      const master = context.createGain();
      master.gain.value = 0.8;
      master.connect(compressor).connect(context.destination);
      context.addEventListener("statechange", () => this.notify());
      this.context = context;
      this.master = master;
      return context;
    } catch {
      return null;
    }
  }

  private noise(context: AudioContext) {
    if (this.noiseBuffer) return this.noiseBuffer;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private track(source: AudioScheduledSourceNode) {
    this.live.add(source);
    source.addEventListener("ended", () => this.live.delete(source));
  }

  private envelope(context: AudioContext, when: number, duration: number, gain: number, attack: number, release: number) {
    const node = context.createGain();
    const peak = Math.max(0.0001, gain);
    const end = when + duration;
    node.gain.setValueAtTime(0.0001, when);
    node.gain.exponentialRampToValueAtTime(peak, when + Math.max(0.005, attack));
    node.gain.setValueAtTime(peak, Math.max(when + attack, end - release));
    node.gain.exponentialRampToValueAtTime(0.0001, end);
    return node;
  }

  private kit(context: AudioContext, master: GainNode): Kit {
    return {
      noise: (when, duration, options) => {
        const source = context.createBufferSource();
        source.buffer = this.noise(context);
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = options.filter ?? "lowpass";
        filter.frequency.setValueAtTime(options.frequency ?? 1000, when);
        if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, when + duration);
        filter.Q.value = options.q ?? 0.8;
        const envelope = this.envelope(context, when, duration, options.gain, options.attack ?? 0.01, options.release ?? Math.min(0.3, duration * 0.6));
        source.connect(filter).connect(envelope).connect(master);
        source.start(when, Math.random() * 1.5);
        source.stop(when + duration + 0.05);
        this.track(source);
      },
      tone: (when, duration, options) => {
        const oscillator = context.createOscillator();
        oscillator.type = options.type ?? "sine";
        oscillator.frequency.setValueAtTime(options.frequency, when);
        if (options.glideTo) oscillator.frequency.exponentialRampToValueAtTime(options.glideTo, when + duration);
        const envelope = this.envelope(context, when, duration, options.gain, options.attack ?? 0.01, options.release ?? Math.min(0.4, duration * 0.6));
        if (options.lowpass) {
          const filter = context.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = options.lowpass;
          oscillator.connect(filter).connect(envelope).connect(master);
        } else {
          oscillator.connect(envelope).connect(master);
        }
        oscillator.start(when);
        oscillator.stop(when + duration + 0.05);
        this.track(oscillator);
      },
    };
  }
}

export const soundEngine = new SoundEngine();
