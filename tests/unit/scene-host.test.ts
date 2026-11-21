import { describe, expect, it } from "vitest";
import { TIER_SETTINGS, isQuality, isSoftwareRenderer, tierFromRenderer } from "@/scenes/quality";
import { StageClock } from "@/scenes/stage-clock";

describe("stage clock", () => {
  function clockAt(start = 1000) {
    let now = start;
    const clock = new StageClock(() => now);
    return { clock, advance: (ms: number) => (now += ms) };
  }

  it("stays on the first frame while the countdown runs", () => {
    const { clock, advance } = clockAt();
    clock.sync(0, true);
    advance(3000);
    expect(clock.read(7000)).toBe(0);
  });

  it("projects smoothly between server updates and never steps backwards on small jitter", () => {
    const { clock, advance } = clockAt();
    clock.sync(1000, false);
    advance(50);
    expect(clock.read(7000)).toBe(1050);
    clock.sync(1020, false);
    expect(clock.read(7000)).toBe(1050);
    advance(100);
    expect(clock.read(7000)).toBe(1120);
  });

  it("jumps to a new position after a refresh-sized correction and stops at the end", () => {
    const { clock, advance } = clockAt();
    clock.sync(500, false);
    expect(clock.read(7000)).toBe(500);
    clock.sync(4200, false);
    expect(clock.read(7000)).toBe(4200);
    clock.sync(1000, false);
    expect(clock.read(7000)).toBe(1000);
    advance(60_000);
    expect(clock.read(7000)).toBe(7000);
  });

  it("holds a paused preview frame exactly", () => {
    const { clock, advance } = clockAt();
    clock.sync(3500, true);
    advance(10_000);
    expect(clock.read(7000)).toBe(3500);
  });
});

describe("quality tiers", () => {
  it("maps software, integrated and dedicated graphics to low, standard and high", () => {
    expect(tierFromRenderer("Google SwiftShader")).toBe("low");
    expect(tierFromRenderer("ANGLE (Microsoft Basic Render Driver)")).toBe("low");
    expect(tierFromRenderer("")).toBe("low");
    expect(tierFromRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("standard");
    expect(tierFromRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)")).toBe("high");
    expect(tierFromRenderer("ANGLE (AMD, AMD Radeon RX 6600 Direct3D11)")).toBe("high");
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)")).toBe(false);
  });

  it("keeps every tier inside the budget and orders them", () => {
    expect(TIER_SETTINGS.high.particles).toBeGreaterThan(TIER_SETTINGS.standard.particles);
    expect(TIER_SETTINGS.standard.particles).toBeGreaterThan(TIER_SETTINGS.low.particles);
    expect(TIER_SETTINGS.low.shadows).toBe(false);
    expect(TIER_SETTINGS.low.finaleFloors).toBeLessThan(TIER_SETTINGS.high.finaleFloors);
    expect(isQuality("standard")).toBe(true);
    expect(isQuality("ultra")).toBe(false);
  });
});
