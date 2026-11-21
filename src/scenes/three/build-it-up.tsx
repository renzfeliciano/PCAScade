"use client";

import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  type Group,
  type InstancedMesh,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type PointLight,
  SRGBColorSpace,
  type SpotLight,
  type Sprite,
  Vector2,
} from "three";
import { dustTexture, seeded, shake, usePbr, useSceneRuntime } from "./shared";

const BASE_SECONDS = 8;
const WALL = { left: -12, right: 12, height: 4.8, depth: 0.3 };
const OPENING = { half: 1.2, height: 2.4 };
const PANEL = 1.2;
const TILE = 2.4;
const CRACK = 3.6;
const OPEN = 4.1;
const SLIDE_START = 4.0;

type Box = { size: [number, number, number]; center: [number, number, number] };

const WALL_PIECES: Box[] = [
  { size: [WALL.right - OPENING.half, WALL.height, WALL.depth], center: [(WALL.left - OPENING.half) / 2, WALL.height / 2, -WALL.depth / 2] },
  { size: [WALL.right - OPENING.half, WALL.height, WALL.depth], center: [(WALL.right + OPENING.half) / 2, WALL.height / 2, -WALL.depth / 2] },
  { size: [OPENING.half * 2, WALL.height - OPENING.height, WALL.depth], center: [0, (WALL.height + OPENING.height) / 2, -WALL.depth / 2] },
];

const HALVES: Box[] = [
  { size: [OPENING.half, OPENING.height, WALL.depth], center: [-OPENING.half / 2, OPENING.height / 2, -WALL.depth / 2] },
  { size: [OPENING.half, OPENING.height, WALL.depth], center: [OPENING.half / 2, OPENING.height / 2, -WALL.depth / 2] },
];

function worldUvBox(box: Box) {
  const geometry = new BoxGeometry(...box.size);
  const position = geometry.attributes.position as BufferAttribute;
  const uv = geometry.attributes.uv as BufferAttribute;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index) + box.center[0];
    const y = position.getY(index) + box.center[1];
    const z = position.getZ(index) + box.center[2];
    const face = Math.floor(index / 4);
    if (face < 2) uv.setXY(index, z / TILE, y / TILE);
    else if (face < 4) uv.setXY(index, x / TILE, z / TILE);
    else uv.setXY(index, x / TILE, y / TILE);
  }
  geometry.translate(...box.center);
  return geometry;
}

function groundGeometry() {
  const geometry = new PlaneGeometry(60, 30);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, 9);
  const position = geometry.attributes.position as BufferAttribute;
  const uv = geometry.attributes.uv as BufferAttribute;
  for (let index = 0; index < position.count; index++) uv.setXY(index, position.getX(index) / 3, position.getZ(index) / 3);
  return geometry;
}

function quadGeometry(corners: [number, number, number][][]) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  corners.forEach((quad, index) => {
    quad.forEach((corner) => positions.push(...corner));
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    const base = index * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

const SHAFT_LENGTH = 6;
const SHAFT_FAR = { half: 3.2, height: 3.8 };

function shaftVolume() {
  const near = OPENING;
  const z = SHAFT_LENGTH;
  return quadGeometry([
    [
      [-near.half, 0, 0],
      [-SHAFT_FAR.half, 0, z],
      [-SHAFT_FAR.half, SHAFT_FAR.height, z],
      [-near.half, near.height, 0],
    ],
    [
      [near.half, 0, 0],
      [SHAFT_FAR.half, 0, z],
      [SHAFT_FAR.half, SHAFT_FAR.height, z],
      [near.half, near.height, 0],
    ],
    [
      [-near.half, near.height, 0],
      [-SHAFT_FAR.half, SHAFT_FAR.height, z],
      [SHAFT_FAR.half, SHAFT_FAR.height, z],
      [near.half, near.height, 0],
    ],
  ]);
}

function shaftFloor() {
  return quadGeometry([
    [
      [-OPENING.half, 0.004, 0],
      [-SHAFT_FAR.half, 0.004, SHAFT_LENGTH],
      [SHAFT_FAR.half, 0.004, SHAFT_LENGTH],
      [OPENING.half, 0.004, 0],
    ],
  ]);
}

let fadeTexture: CanvasTexture | null = null;
let haloTexture: CanvasTexture | null = null;

function fadeAlong(): CanvasTexture {
  if (fadeTexture) return fadeTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.55, "rgba(90,90,90,1)");
    gradient.addColorStop(1, "rgba(255,255,255,1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  }
  fadeTexture = new CanvasTexture(canvas);
  fadeTexture.colorSpace = SRGBColorSpace;
  return fadeTexture;
}

function haloAcross(): CanvasTexture {
  if (haloTexture) return haloTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.5, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(0,0,0,1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 64);
  }
  haloTexture = new CanvasTexture(canvas);
  haloTexture.colorSpace = SRGBColorSpace;
  return haloTexture;
}

type Segment = { start: [number, number]; angle: number; length: number; from: number; to: number };

const TRACE_LENGTH = OPENING.height + OPENING.half;

const SEGMENTS: Segment[] = [
  { start: [-OPENING.half, 0], angle: Math.PI / 2, length: OPENING.height, from: 0, to: OPENING.height / TRACE_LENGTH },
  { start: [-OPENING.half, OPENING.height], angle: 0, length: OPENING.half, from: OPENING.height / TRACE_LENGTH, to: 1 },
  { start: [OPENING.half, 0], angle: Math.PI / 2, length: OPENING.height, from: 0, to: OPENING.height / TRACE_LENGTH },
  { start: [OPENING.half, OPENING.height], angle: Math.PI, length: OPENING.half, from: OPENING.height / TRACE_LENGTH, to: 1 },
];

const SEAM: Segment = { start: [0, OPENING.height], angle: -Math.PI / 2, length: OPENING.height, from: 0, to: 1 };

function strip() {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0.5, 0, 0);
  return geometry;
}

function halo() {
  const geometry = new PlaneGeometry(1, 1);
  geometry.translate(0.5, 0, 0);
  return geometry;
}

type Proxy = {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  trace: number;
  seam: number;
  outline: number;
  crack: number;
  recess: number;
  slide: number;
  pour: number;
  bloom: number;
};

type Particle = {
  kind: 0 | 1 | 2;
  origin: readonly [number, number, number];
  velocity: readonly [number, number, number];
  phase: number;
  speed: number;
  brightness: number;
};

type Chunk = { origin: [number, number, number]; velocity: [number, number, number]; spin: [number, number, number]; delay: number; size: number };

type BuildParts = {
  halves: (Group | null)[];
  strips: (Mesh | null)[];
  halos: (Mesh | null)[];
  seamStrip: Mesh | null;
  seamHalo: Mesh | null;
  chunks: InstancedMesh | null;
  backWall: Mesh | null;
  core: Sprite | null;
  hot: Sprite | null;
  chamberLight: PointLight | null;
  pourLight: SpotLight | null;
  floods: (SpotLight | null)[];
  shaft: Mesh | null;
  shaftFloor: Mesh | null;
};

const FLOODS: { position: [number, number, number]; target: [number, number, number]; intensity: number }[] = [
  { position: [-7.5, 5, 6.5], target: [-2.6, 0.6, 0], intensity: 120 },
  { position: [8.5, 5, 7.5], target: [3.4, 0.9, 0], intensity: 85 },
];

class BuildRig {
  readonly proxy: Proxy = { camX: -8.2, camY: 0.5, camZ: 3.8, lookX: -4.2, lookY: 1.5, lookZ: 0, trace: 0, seam: 0, outline: 0, crack: 0, recess: 0, slide: 0, pour: 0, bloom: 0 };
  readonly timeline = gsap.timeline({ paused: true });
  readonly wallGeometries = WALL_PIECES.map(worldUvBox);
  readonly halfGeometries = HALVES.map(worldUvBox);
  readonly ground = groundGeometry();
  readonly shaftVolume = shaftVolume();
  readonly shaftFloor = shaftFloor();
  readonly strip = strip();
  readonly halo = halo();
  readonly tieGeometry = new CircleGeometry(0.016, 10);
  readonly barGeometry = new CylinderGeometry(0.009, 0.009, 0.55, 6);
  readonly chunkGeometry = new DodecahedronGeometry(1, 0);
  readonly jointGeometry = new BoxGeometry(0.012, 1, 0.004);
  readonly dust = new BufferGeometry();
  readonly particles: Particle[];
  readonly chunks: Chunk[];
  readonly ties: [number, number][];
  readonly halfTies: [number, number][][];
  readonly joints: { x: number; y: number; height: number }[];
  readonly bars: [number, number][];
  private readonly dummy = new Object3D();
  private readonly tint = new Color();

  constructor(particleCount: number) {
    const proxy = this.proxy;
    this.timeline
      .to(proxy, { camX: -4, camY: 0.75, camZ: 4.2, lookX: -0.9, duration: 2, ease: "power1.in" }, 0)
      .to(proxy, { camX: 0, camY: 1.3, camZ: 6.2, lookX: 0, lookY: 1.45, duration: 1.6, ease: "sine.out" }, 2)
      .to(proxy, { outline: 1, duration: 0.4, ease: "sine.out" }, 2)
      .to(proxy, { trace: 1, duration: 1.15, ease: "power1.inOut" }, 2)
      .to(proxy, { seam: 1, duration: 0.45, ease: "power2.in" }, 3.12)
      .to(proxy, { crack: 1, duration: 0.06, ease: "none" }, CRACK)
      .to(proxy, { crack: 0, duration: 0.6, ease: "power2.out" }, CRACK + 0.06)
      .to(proxy, { pour: 0.15, duration: 0.3, ease: "sine.out" }, CRACK)
      .to(proxy, { recess: 0.035, duration: 0.15, ease: "power2.out" }, CRACK + 0.25)
      .to(proxy, { slide: OPENING.half + 0.04, duration: 1.4, ease: "power2.inOut" }, SLIDE_START)
      .to(proxy, { pour: 1, duration: 1.6, ease: "sine.inOut" }, SLIDE_START)
      .to(proxy, { outline: 0.35, duration: 1.2, ease: "sine.inOut" }, SLIDE_START)
      .to(proxy, { camZ: 4.8, duration: 2, ease: "power1.inOut" }, CRACK)
      .to(proxy, { camZ: 4.3, camY: 1.2, lookZ: -1, lookY: 1.3, duration: 1.9, ease: "power2.inOut" }, 5.6)
      .to(proxy, { bloom: 1, duration: 1.6, ease: "sine.inOut" }, 6);

    const random = seeded(41);
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      const haze = index < particleCount * 0.35;
      if (haze) {
        return {
          kind: 0,
          origin: [(random() - 0.5) * 12, random() * 4, 0.2 + random() * 6.5] as const,
          velocity: [(random() - 0.5) * 0.08, (random() - 0.5) * 0.03, (random() - 0.5) * 0.05] as const,
          phase: random() * Math.PI * 2,
          speed: 0.2 + random() * 0.4,
          brightness: 0.4 + random() * 0.6,
        } satisfies Particle;
      }
      const atCrack = random() < 0.4;
      if (atCrack) {
        const y = random() * OPENING.height;
        return {
          kind: 1,
          origin: [(random() - 0.5) * 0.04, y, 0.02] as const,
          velocity: [(random() - 0.5) * 1.6, (random() - 0.4) * 0.6, 0.6 + random() * 1.8] as const,
          phase: 0,
          speed: 0,
          brightness: 0.4 + random() * 0.6,
        } satisfies Particle;
      }
      const edge = random();
      const onTop = edge < 0.4;
      const side = random() < 0.5 ? -1 : 1;
      return {
        kind: 2,
        origin: onTop ? ([(random() - 0.5) * OPENING.half * 2, OPENING.height - 0.02, 0.02] as const) : ([side * OPENING.half * (0.85 + random() * 0.2), random() * OPENING.height, 0.02] as const),
        velocity: [(onTop ? (random() - 0.5) * 1.2 : side * (0.2 + random() * 0.9)), onTop ? -0.2 - random() * 0.5 : (random() - 0.3) * 0.5, 0.5 + random() * 2.2] as const,
        phase: random() * 0.5,
        speed: 0,
        brightness: 0.35 + random() * 0.65,
      } satisfies Particle;
    });
    this.dust.setAttribute("position", new BufferAttribute(new Float32Array(particleCount * 3), 3));
    this.dust.setAttribute("color", new BufferAttribute(new Float32Array(particleCount * 3), 3));

    const chunkRandom = seeded(67);
    this.chunks = Array.from({ length: 36 }, () => ({
      origin: [(chunkRandom() - 0.5) * OPENING.half * 2, OPENING.height - 0.03 - chunkRandom() * 0.05, -chunkRandom() * 0.12],
      velocity: [(chunkRandom() - 0.5) * 0.8, chunkRandom() * 0.4, 0.3 + chunkRandom() * 1.1],
      spin: [chunkRandom() * 9, chunkRandom() * 9, chunkRandom() * 9],
      delay: CRACK + 0.1 + chunkRandom() * 1.3,
      size: 0.008 + chunkRandom() * chunkRandom() * 0.028,
    }));

    this.ties = [];
    this.halfTies = [[], []];
    for (let panel = WALL.left; panel < WALL.right; panel += PANEL) {
      for (const offset of [0.3, 0.9]) {
        for (const y of [0.3, 0.9, 1.5, 2.1, 2.7, 3.3, 3.9, 4.5]) {
          const x = panel + offset;
          const insideOpening = Math.abs(x) < OPENING.half && y < OPENING.height;
          if (!insideOpening) this.ties.push([x, y]);
          else this.halfTies[x < 0 ? 0 : 1]?.push([x, y]);
        }
      }
    }
    this.joints = [];
    for (let x = WALL.left + PANEL; x < WALL.right; x += PANEL) {
      const rounded = Math.round(x * 100) / 100;
      if (Math.abs(rounded) <= OPENING.half + 0.01) this.joints.push({ x: rounded, y: (WALL.height + OPENING.height) / 2, height: WALL.height - OPENING.height });
      else this.joints.push({ x: rounded, y: WALL.height / 2, height: WALL.height });
    }
    this.bars = [];
    for (let x = WALL.left + 0.15; x < WALL.right; x += 0.3) {
      this.bars.push([x, -0.07], [x, -0.23]);
    }
  }

  frame(t: number, camera: Camera, parts: BuildParts, accent: Color, reducedMotion: boolean) {
    const proxy = this.proxy;
    this.timeline.time(Math.min(BASE_SECONDS, Math.max(0, t)), true);

    const rumble = t > SLIDE_START && t < SLIDE_START + 1.4 ? 0.006 : 0;
    const hit = t >= CRACK ? Math.max(0, 1 - (t - CRACK) * 3) * 0.03 : 0;
    const [sx, sy] = shake(t, reducedMotion ? 0 : hit + rumble, 5);
    camera.position.set(proxy.camX + sx, proxy.camY + sy, proxy.camZ);
    camera.lookAt(proxy.lookX, proxy.lookY, proxy.lookZ);

    parts.halves.forEach((half, index) => {
      if (half) half.position.set((index === 0 ? -1 : 1) * proxy.slide, 0, -proxy.recess);
    });

    const flicker = 0.88 + Math.sin(t * 29) * 0.07 + Math.sin(t * 11.3) * 0.05;
    const glow = proxy.outline * flicker + proxy.crack * 1.5;
    SEGMENTS.forEach((segment, index) => {
      const fill = Math.min(1, Math.max(0, (proxy.trace - segment.from) / (segment.to - segment.from)));
      this.place(parts.strips[index] ?? null, segment, fill, 0.022, 0.003, glow * 3.2);
      this.place(parts.halos[index] ?? null, segment, fill, 0.22, 0.006, glow * 0.55);
    });
    const seamFill = proxy.seam;
    const seamGlow = (proxy.outline * flicker + proxy.crack * 2.5) * Math.max(0, 1 - proxy.slide * 4);
    this.place(parts.seamStrip, SEAM, seamFill, 0.018, 0.003, seamGlow * 3.4);
    this.place(parts.seamHalo, SEAM, seamFill, 0.26, 0.006, seamGlow * 0.6);

    const pour = proxy.pour;
    if (parts.backWall) (parts.backWall.material as MeshStandardMaterial).emissiveIntensity = 0.01 + pour * 0.02;
    if (parts.core) {
      const size = 1.6 + pour * 2.6 + proxy.bloom * 1.8;
      parts.core.scale.set(size * 1.25, size, 1);
      (parts.core.material as Material).opacity = Math.min(1, pour * 0.85 + proxy.bloom * 0.15);
    }
    if (parts.hot) {
      const size = 0.5 + pour * 1.1 + proxy.bloom * 0.8;
      parts.hot.scale.set(size, size, 1);
      (parts.hot.material as Material).opacity = Math.min(1, pour * 0.7 + proxy.bloom * 0.3);
    }
    if (parts.chamberLight) parts.chamberLight.intensity = pour * 7 + proxy.bloom * 4;
    if (parts.pourLight) parts.pourLight.intensity = pour * 90 * (1 - proxy.bloom * 0.4);
    parts.floods.forEach((flood, index) => {
      if (flood) flood.intensity = (FLOODS[index]?.intensity ?? 100) * (1 - proxy.bloom * 0.55);
    });
    if (parts.shaft) (parts.shaft.material as Material).opacity = pour * 0.16 * (1 - proxy.bloom * 0.3);
    if (parts.shaftFloor) (parts.shaftFloor.material as Material).opacity = pour * 0.42;

    this.updateDust(t, accent);
    this.updateChunks(t, parts.chunks);
  }

  layout(meshes: { ties: InstancedMesh | null; halfTies: (InstancedMesh | null)[]; joints: InstancedMesh | null; bars: InstancedMesh | null }) {
    const dummy = this.dummy;
    const random = seeded(19);
    const write = (mesh: InstancedMesh | null, items: number, set: (index: number) => void) => {
      if (!mesh) return;
      for (let index = 0; index < items; index++) {
        set(index);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    write(meshes.ties, this.ties.length, (index) => {
      const [x, y] = this.ties[index] ?? [0, 0];
      dummy.position.set(x, y, 0.002);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.85 + random() * 0.3);
    });
    meshes.halfTies.forEach((mesh, half) => {
      const ties = this.halfTies[half] ?? [];
      write(mesh, ties.length, (index) => {
        const [x, y] = ties[index] ?? [0, 0];
        dummy.position.set(x, y, 0.002);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.85 + random() * 0.3);
      });
    });
    write(meshes.joints, this.joints.length, (index) => {
      const joint = this.joints[index] ?? { x: 0, y: 0, height: 1 };
      dummy.position.set(joint.x, joint.y, 0.001);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, joint.height, 1);
    });
    write(meshes.bars, this.bars.length, (index) => {
      const [x, z] = this.bars[index] ?? [0, 0];
      dummy.position.set(x + (random() - 0.5) * 0.02, WALL.height + 0.27, z);
      dummy.rotation.set((random() - 0.5) * 0.08, 0, (random() - 0.5) * 0.08);
      dummy.scale.set(1, 0.8 + random() * 0.4, 1);
    });
  }

  aim(lights: { floods: (SpotLight | null)[]; pour: SpotLight | null }) {
    lights.floods.forEach((light, index) => {
      const target = FLOODS[index]?.target;
      if (!light || !target) return;
      light.target.position.set(...target);
      light.target.updateMatrixWorld();
    });
    if (lights.pour) {
      lights.pour.target.position.set(0, 0, 4);
      lights.pour.target.updateMatrixWorld();
    }
  }

  private place(mesh: Mesh | null, segment: Segment, fill: number, width: number, z: number, intensity: number) {
    if (!mesh) return;
    mesh.visible = fill > 0.001 && intensity > 0.001;
    mesh.position.set(segment.start[0], segment.start[1], z);
    mesh.rotation.set(0, 0, segment.angle);
    mesh.scale.set(Math.max(0.0001, segment.length * fill), width, 0.006);
    const material = mesh.material as MeshStandardMaterial;
    if ("emissiveIntensity" in material) material.emissiveIntensity = intensity;
    else (material as Material).opacity = Math.min(1, intensity);
  }

  private updateDust(t: number, accent: Color) {
    const positions = this.dust.attributes.position as BufferAttribute;
    const colors = this.dust.attributes.color as BufferAttribute;
    const pour = this.proxy.pour;
    const tint = this.tint;
    this.particles.forEach((particle, index) => {
      let x: number;
      let y: number;
      let z: number;
      let light: number;
      if (particle.kind === 0) {
        x = particle.origin[0] + particle.velocity[0] * t + Math.sin(t * particle.speed + particle.phase) * 0.15;
        y = particle.origin[1] + Math.cos(t * particle.speed * 0.7 + particle.phase) * 0.1;
        z = particle.origin[2] + particle.velocity[2] * t;
        light = particle.brightness * 0.1;
      } else {
        const start = particle.kind === 1 ? CRACK : OPEN + particle.phase;
        const age = t - start;
        if (age <= 0 || age > 3.4) {
          positions.setXYZ(index, 0, -50, 0);
          colors.setXYZ(index, 0, 0, 0);
          return;
        }
        const drag = (1 - Math.exp(-1.6 * age)) / 1.6;
        x = particle.origin[0] + particle.velocity[0] * drag;
        y = Math.max(0.02, particle.origin[1] + particle.velocity[1] * drag - 0.06 * age * age);
        z = particle.origin[2] + particle.velocity[2] * drag;
        light = Math.min(1, age * 5) * Math.max(0, 1 - age / 3.4) * particle.brightness * 0.5;
      }
      const spread = OPENING.half + z * ((SHAFT_FAR.half - OPENING.half) / SHAFT_LENGTH);
      const inBeam = z > 0 && Math.abs(x) < spread && y < OPENING.height + z * 0.25 ? Math.max(0, 1 - z / (SHAFT_LENGTH + 1)) : 0;
      const beam = inBeam * pour;
      tint.setRGB(0.9, 0.88, 0.85).lerp(accent, beam * 0.8);
      const value = light + beam * 0.35 * particle.brightness;
      positions.setXYZ(index, x, y, z);
      colors.setXYZ(index, tint.r * value, tint.g * value, tint.b * value);
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  private updateChunks(t: number, mesh: InstancedMesh | null) {
    if (!mesh) return;
    const dummy = this.dummy;
    this.chunks.forEach((chunk, index) => {
      const age = t - chunk.delay;
      if (age <= 0) {
        dummy.scale.setScalar(0);
      } else {
        const groundAt = chunk.size * 0.6;
        const vy = chunk.velocity[1];
        const fall = chunk.origin[1] - groundAt;
        const landing = (vy + Math.sqrt(vy * vy + 2 * 9.8 * fall)) / 9.8;
        const flight = Math.min(age, landing);
        dummy.scale.setScalar(chunk.size);
        dummy.position.set(chunk.origin[0] + chunk.velocity[0] * flight, chunk.origin[1] + vy * flight - 4.9 * flight * flight, chunk.origin[2] + chunk.velocity[2] * flight);
        dummy.rotation.set(chunk.spin[0] * flight, chunk.spin[1] * flight, chunk.spin[2] * flight);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function BuildItUp() {
  const runtime = useSceneRuntime();
  const wallPbr = usePbr("concrete_slab_wall");
  const groundPbr = usePbr("concrete_floor_worn_001");
  const [rig] = useState(() => new BuildRig(runtime.tier.particles));
  const accent = useMemo(() => new Color(runtime.accent), [runtime.accent]);
  const wallMaterial = useMemo(() => new MeshStandardMaterial({ ...wallPbr, color: "#b8b3aa", roughness: 1, metalness: 0, normalScale: new Vector2(1.2, 1.2) }), [wallPbr]);
  const halves = useRef<(Group | null)[]>([]);
  const strips = useRef<(Mesh | null)[]>([]);
  const halos = useRef<(Mesh | null)[]>([]);
  const seamStrip = useRef<Mesh>(null);
  const seamHalo = useRef<Mesh>(null);
  const chunks = useRef<InstancedMesh>(null);
  const backWall = useRef<Mesh>(null);
  const core = useRef<Sprite>(null);
  const hot = useRef<Sprite>(null);
  const chamberLight = useRef<PointLight>(null);
  const pourLight = useRef<SpotLight>(null);
  const floods = useRef<(SpotLight | null)[]>([]);
  const shaft = useRef<Mesh>(null);
  const floorShaft = useRef<Mesh>(null);
  const ties = useRef<InstancedMesh>(null);
  const halfTies = useRef<(InstancedMesh | null)[]>([]);
  const joints = useRef<InstancedMesh>(null);
  const bars = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    rig.layout({ ties: ties.current, halfTies: halfTies.current, joints: joints.current, bars: bars.current });
    rig.aim({ floods: floods.current, pour: pourLight.current });
  }, [rig]);

  useFrame((state) => {
    const t = (runtime.elapsedMs() / runtime.durationMs) * BASE_SECONDS;
    rig.frame(
      t,
      state.camera,
      {
        halves: halves.current,
        strips: strips.current,
        halos: halos.current,
        seamStrip: seamStrip.current,
        seamHalo: seamHalo.current,
        chunks: chunks.current,
        backWall: backWall.current,
        core: core.current,
        hot: hot.current,
        chamberLight: chamberLight.current,
        pourLight: pourLight.current,
        floods: floods.current,
        shaft: shaft.current,
        shaftFloor: floorShaft.current,
      },
      accent,
      runtime.reducedMotion,
    );
  });

  const shadows = runtime.tier.shadows;
  const mapSize = runtime.tier.shadowMapSize;
  return (
    <group>
      <color attach="background" args={["#05070b"]} />
      <fog attach="fog" args={["#090c11", 7, 26]} />
      <ambientLight intensity={0.05} color="#9fb4d0" />
      {FLOODS.map((flood, index) => (
        <spotLight
          key={index}
          ref={(light) => {
            floods.current[index] = light;
          }}
          position={flood.position}
          angle={0.55}
          penumbra={0.75}
          decay={2}
          intensity={flood.intensity}
          color="#dfe8ff"
          castShadow={shadows && index === 0}
          shadow-mapSize-width={mapSize}
          shadow-mapSize-height={mapSize}
          shadow-bias={-0.0005}
        />
      ))}
      <mesh geometry={rig.ground} receiveShadow={shadows}>
        <meshStandardMaterial {...groundPbr} color="#ffffff" roughness={0.9} />
      </mesh>
      {rig.wallGeometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} material={wallMaterial} castShadow={shadows} receiveShadow={shadows} />
      ))}
      <instancedMesh ref={ties} args={[rig.tieGeometry, undefined, rig.ties.length]} frustumCulled={false}>
        <meshStandardMaterial color="#1a1916" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={joints} args={[rig.jointGeometry, undefined, rig.joints.length]} frustumCulled={false}>
        <meshStandardMaterial color="#2a2824" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={bars} args={[rig.barGeometry, undefined, rig.bars.length]} frustumCulled={false} castShadow={shadows}>
        <meshStandardMaterial color="#4a2e20" roughness={0.8} metalness={0.4} />
      </instancedMesh>
      {rig.halfGeometries.map((geometry, index) => (
        <group
          key={index}
          ref={(group) => {
            halves.current[index] = group;
          }}
        >
          <mesh geometry={geometry} material={wallMaterial} castShadow={shadows} receiveShadow={shadows} />
          <instancedMesh
            ref={(mesh) => {
              halfTies.current[index] = mesh;
            }}
            args={[rig.tieGeometry, undefined, rig.halfTies[index]?.length ?? 0]}
            frustumCulled={false}
          >
            <meshStandardMaterial color="#1a1916" roughness={1} />
          </instancedMesh>
        </group>
      ))}
      {SEGMENTS.map((_, index) => (
        <group key={index}>
          <mesh
            geometry={rig.strip}
            visible={false}
            ref={(mesh) => {
              strips.current[index] = mesh;
            }}
          >
            <meshStandardMaterial color="#0d0b09" emissive={accent} emissiveIntensity={0} roughness={1} />
          </mesh>
          <mesh
            geometry={rig.halo}
            visible={false}
            ref={(mesh) => {
              halos.current[index] = mesh;
            }}
          >
            <meshBasicMaterial map={haloAcross()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={seamStrip} geometry={rig.strip} visible={false}>
        <meshStandardMaterial color="#0d0b09" emissive={accent} emissiveIntensity={0} roughness={1} />
      </mesh>
      <mesh ref={seamHalo} geometry={rig.halo} visible={false}>
        <meshBasicMaterial map={haloAcross()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh position={[0, 1.6, -2.8]}>
        <boxGeometry args={[3.4, 3.2, 5]} />
        <meshStandardMaterial {...wallPbr} color="#3a342c" emissive={accent} emissiveIntensity={0.02} side={1} roughness={0.95} />
      </mesh>
      <mesh ref={backWall} position={[0, 1.6, -5.25]}>
        <planeGeometry args={[3.4, 3.2]} />
        <meshStandardMaterial color="#050403" emissive={accent} emissiveIntensity={0.01} roughness={1} fog={false} />
      </mesh>
      <sprite ref={core} position={[0, 1.3, -2.2]}>
        <spriteMaterial map={dustTexture()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <sprite ref={hot} position={[0, 1.3, -2.1]}>
        <spriteMaterial map={dustTexture()} color="#fff4dc" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <pointLight ref={chamberLight} position={[0, 1.6, -0.9]} color={accent} intensity={0} distance={4} decay={2} />
      <spotLight ref={pourLight} position={[0, 2.1, -2.6]} angle={0.7} penumbra={0.8} decay={1.6} distance={16} intensity={0} color={accent} />
      <mesh ref={shaft} geometry={rig.shaftVolume}>
        <meshBasicMaterial map={fadeAlong()} color={accent} transparent opacity={0} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh ref={floorShaft} geometry={rig.shaftFloor}>
        <meshBasicMaterial map={fadeAlong()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <points geometry={rig.dust} frustumCulled={false}>
        <pointsMaterial map={dustTexture()} size={0.05} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </points>
      <instancedMesh ref={chunks} args={[rig.chunkGeometry, undefined, rig.chunks.length]} frustumCulled={false} castShadow={shadows}>
        <meshStandardMaterial color="#8f8a82" roughness={1} />
      </instancedMesh>
    </group>
  );
}
