import { useTexture } from "@react-three/drei";
import { createContext, useContext, useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { TierSettings } from "../quality";

export type SceneRuntime = { elapsedMs: () => number; durationMs: number; accent: string; tier: TierSettings; reducedMotion: boolean };

export const SceneRuntimeContext = createContext<SceneRuntime | null>(null);

export function useSceneRuntime(): SceneRuntime {
  const runtime = useContext(SceneRuntimeContext);
  if (!runtime) throw new Error("useSceneRuntime must be used inside the scene stage");
  return runtime;
}

export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function ease(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function window01(t: number, start: number, end: number) {
  return clamp01((t - start) / (end - start));
}

export function shake(t: number, amount: number, seed = 1) {
  if (amount <= 0) return [0, 0] as const;
  return [
    (Math.sin(t * 47.3 + seed) * 0.6 + Math.sin(t * 91.7 + seed * 2.1) * 0.4) * amount,
    (Math.sin(t * 53.9 + seed * 1.3) * 0.6 + Math.sin(t * 77.1 + seed * 0.7) * 0.4) * amount,
  ] as const;
}

const TEXTURE_ROOT = "/scenes/textures";

export type PbrSet = { map: Texture; normalMap: Texture; roughnessMap: Texture };

function configure(textures: Texture[], repeat: [number, number]) {
  textures.forEach((texture, index) => {
    if (texture.userData.pcascadeConfigured) return;
    texture.userData.pcascadeConfigured = true;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = 4;
    if (index === 0) texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
  });
}

export function usePbr(name: string, repeat: [number, number] = [1, 1]): PbrSet {
  const paths = [`${TEXTURE_ROOT}/${name}/diff.jpg`, `${TEXTURE_ROOT}/${name}/nor.jpg`, `${TEXTURE_ROOT}/${name}/rough.jpg`];
  const [map, normalMap, roughnessMap] = useTexture(paths, (loaded) => configure(Array.isArray(loaded) ? loaded : [loaded], repeat)) as [Texture, Texture, Texture];
  return useMemo(() => ({ map, normalMap, roughnessMap }), [map, normalMap, roughnessMap]);
}

let dustSprite: CanvasTexture | null = null;

export function dustTexture(): CanvasTexture {
  if (dustSprite) return dustSprite;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  dustSprite = new CanvasTexture(canvas);
  dustSprite.colorSpace = SRGBColorSpace;
  return dustSprite;
}

export const HDRI_PATH = "/scenes/hdri/construction_yard_1k.hdr";
