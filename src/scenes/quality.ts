import type { SceneQuality } from "./types";

export const QUALITY_LEVELS: SceneQuality[] = ["high", "standard", "low"];
export const PINNED_QUALITY_KEY = "pcascade.sceneQuality";

export type TierSettings = { dpr: [number, number]; shadows: boolean; shadowMapSize: number; particles: number; antialias: boolean; finaleFloors: number };

export const TIER_SETTINGS: Record<SceneQuality, TierSettings> = {
  high: { dpr: [1, 2], shadows: true, shadowMapSize: 2048, particles: 600, antialias: true, finaleFloors: 24 },
  standard: { dpr: [1, 1.5], shadows: true, shadowMapSize: 1024, particles: 300, antialias: true, finaleFloors: 18 },
  low: { dpr: [1, 1], shadows: false, shadowMapSize: 512, particles: 100, antialias: false, finaleFloors: 10 },
};

export function isQuality(value: unknown): value is SceneQuality {
  return value === "high" || value === "standard" || value === "low";
}

export function isSoftwareRenderer(renderer: string): boolean {
  return !renderer || /swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer);
}

export function tierFromRenderer(renderer: string): SceneQuality {
  const name = renderer.toLowerCase();
  if (isSoftwareRenderer(name)) return "low";
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|apple m[1-9] (pro|max|ultra)|arc a\d/.test(name)) return "high";
  return "standard";
}

export type WebGlProbe = { supported: boolean; renderer: string };

let cachedProbe: WebGlProbe | null = null;

export function probeWebGl(): WebGlProbe {
  if (cachedProbe) return cachedProbe;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      cachedProbe = { supported: false, renderer: "" };
      return cachedProbe;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cachedProbe = { supported: true, renderer };
  } catch {
    cachedProbe = { supported: false, renderer: "" };
  }
  return cachedProbe;
}

export function readPinnedQuality(): SceneQuality | null {
  try {
    const stored = window.localStorage.getItem(PINNED_QUALITY_KEY);
    return isQuality(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function pinQuality(quality: SceneQuality | null) {
  try {
    if (quality) window.localStorage.setItem(PINNED_QUALITY_KEY, quality);
    else window.localStorage.removeItem(PINNED_QUALITY_KEY);
  } catch {
    return;
  }
}

export function chooseQuality(): SceneQuality {
  const fromUrl = new URLSearchParams(window.location.search).get("quality");
  if (isQuality(fromUrl)) return fromUrl;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "low";
  return readPinnedQuality() ?? tierFromRenderer(probeWebGl().renderer);
}
