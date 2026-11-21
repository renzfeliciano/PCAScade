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
  Color,
  CylinderGeometry,
  DoubleSide,
  type DirectionalLight,
  type Group,
  type HemisphereLight,
  type InstancedMesh,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type PointLight,
  SRGBColorSpace,
  SphereGeometry,
  type SpotLight,
  type Sprite,
  Vector3,
} from "three";
import { clamp01, dustTexture, ease, seeded, usePbr, useSceneRuntime } from "./shared";

const BASE_SECONDS = 11;
const FLOOR_H = 3.6;
const FOOT = { x: 12, z: 9 };
const BUILD_START = 0.2;
const BUILD_SPAN = 5;
const BURST = 8.5;
const LIT_FLOORS = 3;
const CROWN_H = 18;
const MAST_SECTION = 3;
const MAST_HALF = 0.9;
const COLUMN_X = [-12, -6, 0, 6, 12];
const COLUMN_Z = [-9, -3, 3, 9];
const UP = new Vector3(0, 1, 0);
const NIGHT_SKY = new Color("#58607a");
const DAY_SKY = new Color("#ffffff");

type Member = { a: [number, number, number]; b: [number, number, number]; thick: number };
type Panel = { floor: number; x: number; z: number; sx: number; sz: number };
type Bay = Panel & { threshold: number };

function floorStart(floor: number, floors: number) {
  return BUILD_START + (floor / floors) * BUILD_SPAN;
}

function mastMembers(sections: number): Member[] {
  const members: Member[] = [];
  const m = MAST_HALF;
  const corners: [number, number][] = [
    [-m, -m],
    [m, -m],
    [m, m],
    [-m, m],
  ];
  for (let section = 0; section < sections; section++) {
    const y = section * MAST_SECTION;
    corners.forEach(([x, z], index) => {
      const [nx, nz] = corners[(index + 1) % 4] ?? [x, z];
      members.push({ a: [x, y, z], b: [x, y + MAST_SECTION, z], thick: 0.2 });
      members.push({ a: [x, y, z], b: [nx, y, nz], thick: 0.1 });
      members.push(section % 2 === 0 ? { a: [x, y, z], b: [nx, y + MAST_SECTION, nz], thick: 0.08 } : { a: [nx, y, nz], b: [x, y + MAST_SECTION, z], thick: 0.08 });
    });
  }
  return members;
}

const MEMBERS_PER_SECTION = 12;

function headMembers(): Member[] {
  const members: Member[] = [];
  const add = (a: [number, number, number], b: [number, number, number], thick: number) => members.push({ a, b, thick });
  const length = 28;
  const bay = 2.8;
  const base = 1;
  const top = 2.6;
  add([0, base, -0.8], [length, base, -0.8], 0.14);
  add([0, base, 0.8], [length, base, 0.8], 0.14);
  add([0, top, 0], [length - bay, top, 0], 0.14);
  for (let x = 0; x < length; x += bay) {
    add([x, base, -0.8], [x, base, 0.8], 0.08);
    add([x, base, -0.8], [x, top, 0], 0.07);
    add([x, base, 0.8], [x, top, 0], 0.07);
    if (x + bay < length) {
      add([x, top, 0], [x + bay, base, -0.8], 0.06);
      add([x, top, 0], [x + bay, base, 0.8], 0.06);
    }
  }
  add([0, base, -1], [-9, base, -1], 0.16);
  add([0, base, 1], [-9, base, 1], 0.16);
  add([-7.6, base - 1.2, 0], [-7.6, base + 0.4, 0], 2.2);
  add([0, 0, 0], [0, base, 0], 2.4);
  add([1.4, -0.6, 1.4], [1.4, 1.2, 1.4], 1.4);
  add([-0.9, base, -0.9], [0, base + 7, 0], 0.16);
  add([0.9, base, 0.9], [0, base + 7, 0], 0.16);
  add([0.9, base, -0.9], [0, base + 7, 0], 0.16);
  add([-0.9, base, 0.9], [0, base + 7, 0], 0.16);
  add([0, base + 7, 0], [length * 0.55, top, 0], 0.05);
  add([0, base + 7, 0], [length - 2, top, 0], 0.05);
  add([0, base + 7, 0], [-8.4, base + 0.4, 0], 0.05);
  return members;
}

function crownMembers(): Member[] {
  const members: Member[] = [];
  const add = (a: [number, number, number], b: [number, number, number], thick: number) => members.push({ a, b, thick });
  const ring = 8;
  const radius = 6;
  for (let index = 0; index < ring; index++) {
    const angle = (index / ring) * Math.PI * 2;
    const next = ((index + 1) / ring) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    add([x, 0, z], [x * 0.55, 9, z * 0.55], 0.35);
    add([x * 0.55, 9, z * 0.55], [0, CROWN_H, 0], 0.22);
    add([x, 0, z], [Math.cos(next) * radius, 0, Math.sin(next) * radius], 0.3);
    add([x * 0.55, 9, z * 0.55], [Math.cos(next) * radius * 0.55, 9, Math.sin(next) * radius * 0.55], 0.22);
    add([x * 0.78, 4.5, z * 0.78], [Math.cos(next) * radius * 0.78, 4.5, Math.sin(next) * radius * 0.78], 0.16);
  }
  add([0, 0, 0], [0, CROWN_H + 4, 0], 0.3);
  return members;
}

function skyGeometry() {
  const stops = [
    { at: -0.2, color: new Color("#3a3040") },
    { at: 0, color: new Color("#c97e57") },
    { at: 0.07, color: new Color("#a46d6a") },
    { at: 0.3, color: new Color("#3d4c78") },
    { at: 1, color: new Color("#0b1022") },
  ];
  const geometry = new SphereGeometry(320, 32, 16);
  const position = geometry.attributes.position as BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const color = new Color();
  for (let index = 0; index < position.count; index++) {
    const height = position.getY(index) / 320;
    color.copy(stops[0]?.color ?? color);
    stops.forEach((stop, stopIndex) => {
      const next = stops[stopIndex + 1];
      if (next && height >= stop.at) color.copy(stop.color).lerp(next.color, Math.min(1, (height - stop.at) / (next.at - stop.at)));
    });
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

function groundGeometry() {
  const geometry = new PlaneGeometry(600, 600);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as BufferAttribute;
  const uv = geometry.attributes.uv as BufferAttribute;
  for (let index = 0; index < position.count; index++) uv.setXY(index, position.getX(index) / 5, position.getZ(index) / 5);
  return geometry;
}

let beamFade: CanvasTexture | null = null;

function beamTexture(): CanvasTexture {
  if (beamFade) return beamFade;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.45, "rgba(80,80,80,1)");
    gradient.addColorStop(1, "rgba(255,255,255,1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  }
  beamFade = new CanvasTexture(canvas);
  beamFade.colorSpace = SRGBColorSpace;
  return beamFade;
}

function perimeter(floor: number, step: number, inset: number): Panel[] {
  const panels: Panel[] = [];
  for (let x = -FOOT.x + step / 2; x < FOOT.x; x += step) {
    panels.push({ floor, x, z: FOOT.z + inset, sx: step, sz: 0 });
    panels.push({ floor, x, z: -FOOT.z - inset, sx: step, sz: 0 });
  }
  for (let z = -FOOT.z + step / 2; z < FOOT.z; z += step) {
    panels.push({ floor, x: FOOT.x + inset, z, sx: 0, sz: step });
    panels.push({ floor, x: -FOOT.x - inset, z, sx: 0, sz: step });
  }
  return panels;
}

const CRANES: { position: [number, number, number]; heading: number; swing: number }[] = [
  { position: [-17, 0, 6], heading: -0.35, swing: 0.5 },
  { position: [17, 0, -6], heading: Math.PI - 0.35, swing: -0.4 },
];

const FLOODS: [number, number, number][] = [
  [-26, 0.5, 22],
  [26, 0.5, 22],
  [26, 0.5, -22],
  [-26, 0.5, -22],
];

const CONTEXT_COUNT = 26;

type Proxy = { angle: number; radius: number; camY: number; lookY: number; night: number; flood: number; facade: number; crown: number; burst: number };

type Particle = { kind: 0 | 1; velocity: readonly [number, number, number]; seed: number; brightness: number };

type FinaleMeshes = {
  columns: InstancedMesh | null;
  slabs: InstancedMesh | null;
  glass: InstancedMesh | null;
  litGlass: InstancedMesh | null;
  mullions: InstancedMesh | null;
  windows: InstancedMesh | null;
  masts: (InstancedMesh | null)[];
  heads: (Group | null)[];
};

type FinaleParts = FinaleMeshes & {
  crown: Mesh | null;
  crownMaterial: MeshStandardMaterial;
  litMaterial: MeshStandardMaterial;
  glow: Sprite | null;
  flareH: Sprite | null;
  flareV: Sprite | null;
  crownLight: PointLight | null;
  floods: (SpotLight | null)[];
  beams: (Mesh | null)[];
  sky: Mesh | null;
  hemisphere: HemisphereLight | null;
  sun: DirectionalLight | null;
};

class FinaleRig {
  readonly floors: number;
  readonly height: number;
  readonly proxy: Proxy;
  readonly timeline = gsap.timeline({ paused: true });
  readonly box = new BoxGeometry(1, 1, 1);
  readonly sky = skyGeometry();
  readonly ground = groundGeometry();
  readonly beamGeometry = new CylinderGeometry(5, 0.4, 1, 20, 1, true);
  readonly windowGeometry = new PlaneGeometry(1, 1);
  readonly glassPanels: Panel[] = [];
  readonly litPanels: Panel[] = [];
  readonly mullionPanels: Panel[];
  readonly bays: Bay[];
  readonly mast: Member[];
  readonly head = headMembers();
  readonly crown = crownMembers();
  readonly context: { x: number; z: number; w: number; d: number; h: number }[];
  readonly dust = new BufferGeometry();
  readonly particles: Particle[];
  private readonly dummy = new Object3D();
  private readonly direction = new Vector3();
  private lastT = -1;

  constructor(floors: number, particleCount: number) {
    this.floors = floors;
    this.height = floors * FLOOR_H;
    const h = this.height;
    const finalLook = h + 5;
    const finalRadius = h * 0.45 + 42;
    this.proxy = { angle: -0.85, radius: Math.max(75, h * 1.15), camY: 9, lookY: 14, night: 0, flood: 0, facade: 0, crown: 0, burst: 0 };
    const proxy = this.proxy;
    this.timeline
      .to(proxy, { angle: 0.55, radius: h * 0.85 + 28, camY: h * 0.72, lookY: h * 0.55, duration: 6, ease: "sine.inOut" }, 0)
      .to(proxy, { night: 1, duration: 6, ease: "sine.in" }, 0)
      .to(proxy, { angle: 1.15, radius: finalRadius, camY: h + 1, lookY: finalLook, duration: 2.5, ease: "power2.inOut" }, 6)
      .to(proxy, { flood: 1, duration: 0.6, ease: "steps(4)" }, 6)
      .to(proxy, { facade: 1, duration: 1.2, ease: "sine.inOut" }, 6.5)
      .to(proxy, { crown: 1, duration: 1.4, ease: "sine.in" }, 7)
      .to(proxy, { burst: 1, duration: 0.25, ease: "power3.out" }, BURST)
      .to(proxy, { burst: 0.55, duration: 1.6, ease: "sine.out" }, BURST + 0.25)
      .to(proxy, { angle: 1.28, radius: finalRadius * 0.92, duration: 2.5, ease: "sine.inOut" }, BURST);

    for (let floor = 0; floor < floors; floor++) {
      const target = floor >= floors - LIT_FLOORS ? this.litPanels : this.glassPanels;
      target.push(
        { floor, x: 0, z: FOOT.z + 0.15, sx: FOOT.x * 2, sz: 0 },
        { floor, x: 0, z: -FOOT.z - 0.15, sx: FOOT.x * 2, sz: 0 },
        { floor, x: FOOT.x + 0.15, z: 0, sx: 0, sz: FOOT.z * 2 },
        { floor, x: -FOOT.x - 0.15, z: 0, sx: 0, sz: FOOT.z * 2 },
      );
    }
    this.mullionPanels = [];
    for (let floor = 0; floor < floors; floor++) {
      for (const panel of perimeter(floor, 2, 0.25)) this.mullionPanels.push(panel);
    }
    const bayRandom = seeded(97);
    this.bays = [];
    for (let floor = 0; floor < floors - LIT_FLOORS; floor++) {
      for (const panel of perimeter(floor, 2, 0.21)) {
        if (bayRandom() < 0.32) this.bays.push({ ...panel, threshold: bayRandom() });
      }
    }
    this.mast = mastMembers(Math.ceil((h + 16) / MAST_SECTION));
    const contextRandom = seeded(5);
    this.context = Array.from({ length: CONTEXT_COUNT }, (_, index) => {
      const angle = (index / CONTEXT_COUNT) * Math.PI * 2 + contextRandom() * 0.2;
      const distance = 75 + contextRandom() * 90;
      return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, w: 14 + contextRandom() * 18, d: 14 + contextRandom() * 18, h: 8 + contextRandom() * contextRandom() * 38 };
    });

    const random = seeded(131);
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      if (index < particleCount * 0.7) {
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(1 - random() * 1.3);
        const speed = 8 + random() * 16;
        return {
          kind: 0,
          velocity: [Math.sin(phi) * Math.cos(theta) * speed, Math.cos(phi) * speed, Math.sin(phi) * Math.sin(theta) * speed] as const,
          seed: random() * 0.3,
          brightness: 0.5 + random() * 0.5,
        } satisfies Particle;
      }
      return { kind: 1, velocity: [random(), random(), random()] as const, seed: random() * 10, brightness: 0.6 + random() * 0.4 } satisfies Particle;
    });
    this.dust.setAttribute("position", new BufferAttribute(new Float32Array(particleCount * 3), 3));
    this.dust.setAttribute("color", new BufferAttribute(new Float32Array(particleCount * 3), 3));
  }

  layout(meshes: { masts: (InstancedMesh | null)[]; heads: (InstancedMesh | null)[]; crown: InstancedMesh | null; context: InstancedMesh | null }) {
    meshes.masts.forEach((mesh) => this.writeMembers(mesh, this.mast));
    meshes.heads.forEach((mesh) => this.writeMembers(mesh, this.head));
    this.writeMembers(meshes.crown, this.crown);
    const mesh = meshes.context;
    if (mesh) {
      this.context.forEach((block, index) => {
        this.dummy.position.set(block.x, block.h / 2, block.z);
        this.dummy.rotation.set(0, Math.atan2(block.x, block.z), 0);
        this.dummy.scale.set(block.w, block.h, block.d);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  aim(floods: (SpotLight | null)[], beams: (Mesh | null)[]) {
    const target = new Vector3(0, this.height * 0.75, 0);
    FLOODS.forEach((position, index) => {
      const light = floods[index];
      if (light) {
        light.target.position.copy(target);
        light.target.updateMatrixWorld();
      }
      const beam = beams[index];
      if (beam) {
        const from = new Vector3(...position);
        const along = target.clone().sub(from);
        const length = along.length() * 0.8;
        along.normalize();
        beam.position.copy(from).addScaledVector(along, length / 2);
        beam.quaternion.setFromUnitVectors(UP, along);
        beam.scale.set(1, length, 1);
      }
    });
  }

  update(t: number, camera: Camera, parts: FinaleParts, accent: Color) {
    const proxy = this.proxy;
    const time = Math.min(BASE_SECONDS, Math.max(0, t));
    this.timeline.time(time, true);
    const h = this.height;

    camera.position.set(Math.sin(proxy.angle) * proxy.radius, proxy.camY, Math.cos(proxy.angle) * proxy.radius);
    camera.lookAt(0, proxy.lookY, 0);

    if (Math.abs(time - this.lastT) > 0.0001) {
      this.lastT = time;
      this.updateStructure(time, parts);
    }

    const built = clamp01((time - BUILD_START) / BUILD_SPAN) * h;
    const craneTop = Math.max(18, built + 12);
    parts.masts.forEach((mesh) => {
      if (mesh) mesh.count = Math.min(this.mast.length, Math.ceil(craneTop / MAST_SECTION) * MEMBERS_PER_SECTION);
    });
    parts.heads.forEach((head, index) => {
      const crane = CRANES[index];
      if (!head || !crane) return;
      head.position.set(crane.position[0], craneTop, crane.position[2]);
      head.rotation.set(0, crane.heading + Math.sin(time * 0.35 + index) * crane.swing, 0);
    });

    const night = proxy.night;
    if (parts.sky) (parts.sky.material as MeshBasicMaterial).color.copy(DAY_SKY).lerp(NIGHT_SKY, night);
    if (parts.hemisphere) parts.hemisphere.intensity = 2.2 - night * 1.5;
    if (parts.sun) parts.sun.intensity = 2.4 * (1 - night * 0.9);

    const pulse = 0.9 + Math.sin(time * 7) * 0.06;
    parts.litMaterial.emissiveIntensity = proxy.facade * 1.6 * pulse + proxy.burst * 0.6;
    parts.crownMaterial.emissiveIntensity = proxy.crown * 1.8 + proxy.burst * 2.5;
    const crownTop = h + CROWN_H;
    if (parts.crown) parts.crown.position.set(0, h, 0);
    if (parts.glow) {
      parts.glow.position.set(0, crownTop, 0);
      const size = 6 + proxy.crown * 6 + proxy.burst * 40;
      parts.glow.scale.set(size, size, 1);
      (parts.glow.material as Material).opacity = Math.min(1, proxy.crown * 0.5 + proxy.burst * 0.8);
    }
    for (const [flare, wide] of [
      [parts.flareH, true],
      [parts.flareV, false],
    ] as const) {
      if (!flare) continue;
      flare.position.set(0, crownTop, 0);
      const long = 4 + proxy.burst * 110;
      flare.scale.set(wide ? long : 2 + proxy.burst * 3, wide ? 2 + proxy.burst * 3 : long * 0.7, 1);
      (flare.material as Material).opacity = proxy.burst * 0.75;
    }
    if (parts.crownLight) {
      parts.crownLight.position.set(0, crownTop - 4, 0);
      parts.crownLight.intensity = proxy.crown * 600 + proxy.burst * 2400;
    }
    parts.floods.forEach((flood) => {
      if (flood) flood.intensity = proxy.flood * 30000;
    });
    parts.beams.forEach((beam) => {
      if (beam) (beam.material as Material).opacity = proxy.flood * 0.07;
    });

    this.updateParticles(time, built, accent);
  }

  private updateStructure(t: number, meshes: FinaleMeshes) {
    const floors = this.floors;
    const dummy = this.dummy;
    const columns = meshes.columns;
    if (columns) {
      let index = 0;
      for (let floor = 0; floor < floors; floor++) {
        const grow = ease((t - floorStart(floor, floors)) / 0.35);
        const height = (FLOOR_H - 0.4) * grow;
        for (const x of COLUMN_X) {
          for (const z of COLUMN_Z) {
            dummy.position.set(x, floor * FLOOR_H + 0.2 + height / 2, z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(grow > 0 ? 0.7 : 0, Math.max(0.0001, height), grow > 0 ? 0.7 : 0);
            dummy.updateMatrix();
            columns.setMatrixAt(index++, dummy.matrix);
          }
        }
      }
      columns.instanceMatrix.needsUpdate = true;
    }
    const slabs = meshes.slabs;
    if (slabs) {
      for (let floor = 0; floor < floors; floor++) {
        const pour = ease((t - floorStart(floor, floors) - 0.28) / 0.22);
        dummy.position.set(0, (floor + 1) * FLOOR_H - 0.2, 0);
        dummy.rotation.set(0, 0, 0);
        const spread = 0.82 + pour * 0.18;
        dummy.scale.set(pour > 0 ? (FOOT.x * 2 + 0.9) * spread : 0, 0.4 * Math.max(0.0001, pour), (FOOT.z * 2 + 0.9) * spread);
        dummy.updateMatrix();
        slabs.setMatrixAt(floor, dummy.matrix);
      }
      slabs.instanceMatrix.needsUpdate = true;
    }
    const glaze = (floor: number) => ease((t - floorStart(floor, floors) - 0.8) / 0.3);
    const writePanels = (mesh: InstancedMesh | null, panels: Panel[], thickness: number, height: number) => {
      if (!mesh) return;
      panels.forEach((panel, index) => {
        const amount = glaze(panel.floor);
        const tall = (FLOOR_H - 0.4) * height * amount;
        dummy.position.set(panel.x, panel.floor * FLOOR_H + 0.2 + tall / 2, panel.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(amount > 0 ? panel.sx || thickness : 0, Math.max(0.0001, tall), amount > 0 ? panel.sz || thickness : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    writePanels(meshes.glass, this.glassPanels, 0.08, 1);
    writePanels(meshes.litGlass, this.litPanels, 0.08, 1);
    const mullions = meshes.mullions;
    if (mullions) {
      this.mullionPanels.forEach((panel, index) => {
        const amount = glaze(panel.floor);
        const tall = FLOOR_H * amount;
        const edgeX = panel.sx ? panel.x - panel.sx / 2 : panel.x;
        const edgeZ = panel.sz ? panel.z - panel.sz / 2 : panel.z;
        dummy.position.set(edgeX, panel.floor * FLOOR_H + tall / 2, edgeZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(amount > 0 ? 0.14 : 0, Math.max(0.0001, tall), amount > 0 ? 0.14 : 0);
        dummy.updateMatrix();
        mullions.setMatrixAt(index, dummy.matrix);
      });
      mullions.instanceMatrix.needsUpdate = true;
    }
    const windows = meshes.windows;
    if (windows) {
      this.bays.forEach((bay, index) => {
        const on = glaze(bay.floor) >= 1 && t > 2.2 + bay.threshold * 4.5;
        dummy.position.set(bay.x, bay.floor * FLOOR_H + FLOOR_H / 2, bay.z);
        dummy.rotation.set(0, bay.sx ? 0 : Math.PI / 2, 0);
        dummy.scale.set(on ? 1.7 : 0, on ? 2.4 : 0, 1);
        dummy.updateMatrix();
        windows.setMatrixAt(index, dummy.matrix);
      });
      windows.instanceMatrix.needsUpdate = true;
    }
  }

  private writeMembers(mesh: InstancedMesh | null, members: Member[]) {
    if (!mesh) return;
    const dummy = this.dummy;
    members.forEach((member, index) => {
      const a = new Vector3(...member.a);
      const b = new Vector3(...member.b);
      this.direction.copy(b).sub(a);
      const length = this.direction.length();
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(UP, this.direction.normalize());
      dummy.scale.set(member.thick, length, member.thick);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  private updateParticles(t: number, built: number, accent: Color) {
    const positions = this.dust.attributes.position as BufferAttribute;
    const colors = this.dust.attributes.color as BufferAttribute;
    const crownTop = this.height + CROWN_H;
    this.particles.forEach((particle, index) => {
      if (particle.kind === 0) {
        const age = t - BURST - particle.seed;
        if (age <= 0 || age > 2.6) {
          positions.setXYZ(index, 0, -200, 0);
          colors.setXYZ(index, 0, 0, 0);
          return;
        }
        const drag = (1 - Math.exp(-1.4 * age)) / 1.4;
        positions.setXYZ(index, particle.velocity[0] * drag, crownTop + particle.velocity[1] * drag - 3 * age * age, particle.velocity[2] * drag);
        const fade = Math.max(0, 1 - age / 2.6) * particle.brightness;
        const mix = Math.min(1, age * 0.8);
        colors.setXYZ(index, fade * (1 - mix + accent.r * mix), fade * (1 - mix + accent.g * mix), fade * (1 - mix + accent.b * mix));
        return;
      }
      const active = t > BUILD_START && t < BUILD_START + BUILD_SPAN + 0.6;
      const cycle = (t * 3 + particle.seed) % 1;
      const slot = Math.floor(t * 3 + particle.seed);
      const pick = seeded(Math.floor(particle.seed * 1000) + slot * 7919)();
      const side = Math.floor(pick * 4);
      const along = (particle.velocity[0] * 2 - 1) * (side < 2 ? FOOT.x : FOOT.z);
      const x = side < 2 ? along : side === 2 ? FOOT.x : -FOOT.x;
      const z = side < 2 ? (side === 0 ? FOOT.z : -FOOT.z) : along;
      const flash = active && cycle < 0.18 ? (1 - cycle / 0.18) * particle.brightness : 0;
      positions.setXYZ(index, x, Math.max(0.5, built - 0.4), z);
      colors.setXYZ(index, flash, flash * 0.9, flash * 0.7);
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }
}

export function GrandFinale() {
  const runtime = useSceneRuntime();
  const concretePbr = usePbr("concrete_slab_wall");
  const steelPbr = usePbr("metal_plate", [1, 1]);
  const groundPbr = usePbr("concrete_floor_worn_001");
  const [rig] = useState(() => new FinaleRig(runtime.tier.finaleFloors, runtime.tier.particles));
  const accent = useMemo(() => new Color(runtime.accent), [runtime.accent]);
  const concrete = useMemo(() => new MeshStandardMaterial({ map: concretePbr.map, normalMap: concretePbr.normalMap, color: "#cfc9bf", roughness: 0.95 }), [concretePbr]);
  const glass = useMemo(() => new MeshStandardMaterial({ color: "#3d5872", roughness: 0.08, metalness: 0.9, envMapIntensity: 1.4 }), []);
  const litMaterial = useMemo(() => new MeshStandardMaterial({ color: "#1a2430", roughness: 0.15, metalness: 0.6, emissive: accent, emissiveIntensity: 0 }), [accent]);
  const crownMaterial = useMemo(() => new MeshStandardMaterial({ color: "#6d737b", normalMap: steelPbr.normalMap, roughness: 0.35, metalness: 0.7, emissive: accent, emissiveIntensity: 0 }), [steelPbr, accent]);
  const paint = useMemo(() => new MeshStandardMaterial({ color: "#f2b200", normalMap: steelPbr.normalMap, roughnessMap: steelPbr.roughnessMap, roughness: 0.6, metalness: 0.35 }), [steelPbr]);
  const columns = useRef<InstancedMesh>(null);
  const slabs = useRef<InstancedMesh>(null);
  const glassMesh = useRef<InstancedMesh>(null);
  const litGlass = useRef<InstancedMesh>(null);
  const mullions = useRef<InstancedMesh>(null);
  const windows = useRef<InstancedMesh>(null);
  const masts = useRef<(InstancedMesh | null)[]>([]);
  const heads = useRef<(Group | null)[]>([]);
  const headMeshes = useRef<(InstancedMesh | null)[]>([]);
  const crown = useRef<InstancedMesh>(null);
  const context = useRef<InstancedMesh>(null);
  const glow = useRef<Sprite>(null);
  const flareH = useRef<Sprite>(null);
  const flareV = useRef<Sprite>(null);
  const crownLight = useRef<PointLight>(null);
  const floods = useRef<(SpotLight | null)[]>([]);
  const beams = useRef<(Mesh | null)[]>([]);
  const sky = useRef<Mesh>(null);
  const hemisphere = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);

  useLayoutEffect(() => {
    rig.layout({ masts: masts.current, heads: headMeshes.current, crown: crown.current, context: context.current });
    rig.aim(floods.current, beams.current);
  }, [rig]);

  useFrame((state) => {
    const t = (runtime.elapsedMs() / runtime.durationMs) * BASE_SECONDS;
    rig.update(
      t,
      state.camera,
      {
        columns: columns.current,
        slabs: slabs.current,
        glass: glassMesh.current,
        litGlass: litGlass.current,
        mullions: mullions.current,
        windows: windows.current,
        masts: masts.current,
        heads: heads.current,
        crown: crown.current,
        crownMaterial,
        litMaterial,
        glow: glow.current,
        flareH: flareH.current,
        flareV: flareV.current,
        crownLight: crownLight.current,
        floods: floods.current,
        beams: beams.current,
        sky: sky.current,
        hemisphere: hemisphere.current,
        sun: sun.current,
      },
      accent,
    );
  });

  const shadows = runtime.tier.shadows;
  const mapSize = runtime.tier.shadowMapSize;
  const h = rig.height;
  return (
    <group>
      <mesh ref={sky} geometry={rig.sky}>
        <meshBasicMaterial vertexColors side={1} fog={false} depthWrite={false} />
      </mesh>
      <fog attach="fog" args={["#4a3c48", 90, 300]} />
      <hemisphereLight ref={hemisphere} args={["#a9b8dc", "#6a5040", 2.2]} />
      <directionalLight
        ref={sun}
        position={[-90, 45, 70]}
        intensity={2.4}
        color="#ffae73"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={110}
        shadow-camera-bottom={-40}
        shadow-camera-far={300}
        shadow-bias={-0.0006}
      />
      <mesh geometry={rig.ground} receiveShadow={shadows}>
        <meshStandardMaterial {...groundPbr} color="#bdb6ad" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.1, 0]} receiveShadow={shadows}>
        <boxGeometry args={[34, 0.2, 28]} />
        <meshStandardMaterial {...groundPbr} color="#d8d2c8" roughness={1} />
      </mesh>
      <instancedMesh ref={context} args={[rig.box, undefined, CONTEXT_COUNT]} frustumCulled={false}>
        <meshStandardMaterial color="#262a33" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={columns} args={[rig.box, concrete, rig.floors * COLUMN_X.length * COLUMN_Z.length]} frustumCulled={false} castShadow={shadows} receiveShadow={shadows} />
      <instancedMesh ref={slabs} args={[rig.box, concrete, rig.floors]} frustumCulled={false} castShadow={shadows} receiveShadow={shadows} />
      <instancedMesh ref={glassMesh} args={[rig.box, glass, rig.glassPanels.length]} frustumCulled={false} />
      <instancedMesh ref={litGlass} args={[rig.box, litMaterial, rig.litPanels.length]} frustumCulled={false} />
      <instancedMesh ref={mullions} args={[rig.box, undefined, rig.mullionPanels.length]} frustumCulled={false}>
        <meshStandardMaterial color="#8d939b" roughness={0.4} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[rig.windowGeometry, undefined, Math.max(1, rig.bays.length)]} frustumCulled={false}>
        <meshBasicMaterial color="#ffd9a0" side={DoubleSide} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={crown} args={[rig.box, crownMaterial, rig.crown.length]} frustumCulled={false} castShadow={shadows} />
      {CRANES.map((crane, index) => (
        <group key={index}>
          <instancedMesh
            ref={(mesh) => {
              masts.current[index] = mesh;
            }}
            args={[rig.box, paint, rig.mast.length]}
            position={crane.position}
            frustumCulled={false}
            castShadow={shadows}
          />
          <group
            ref={(group) => {
              heads.current[index] = group;
            }}
          >
            <instancedMesh
              ref={(mesh) => {
                headMeshes.current[index] = mesh;
              }}
              args={[rig.box, paint, rig.head.length]}
              frustumCulled={false}
              castShadow={shadows}
            />
            <pointLight position={[27.5, 0.6, 0]} color="#ff3b2f" intensity={4} distance={8} />
          </group>
        </group>
      ))}
      <sprite ref={glow} position={[0, h + CROWN_H, 0]}>
        <spriteMaterial map={dustTexture()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <sprite ref={flareH} position={[0, h + CROWN_H, 0]}>
        <spriteMaterial map={dustTexture()} color="#fff4e0" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <sprite ref={flareV} position={[0, h + CROWN_H, 0]}>
        <spriteMaterial map={dustTexture()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <pointLight ref={crownLight} position={[0, h + CROWN_H - 4, 0]} color={accent} intensity={0} distance={70} decay={2} />
      {FLOODS.map((position, index) => (
        <group key={index}>
          <spotLight
            ref={(light) => {
              floods.current[index] = light;
            }}
            position={position}
            angle={0.32}
            penumbra={0.7}
            decay={2}
            intensity={0}
            color="#f4f1ff"
          />
          <mesh
            geometry={rig.beamGeometry}
            ref={(mesh) => {
              beams.current[index] = mesh;
            }}
          >
            <meshBasicMaterial map={beamTexture()} color="#f4f1ff" transparent opacity={0} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} fog={false} />
          </mesh>
        </group>
      ))}
      <points geometry={rig.dust} frustumCulled={false}>
        <pointsMaterial map={dustTexture()} size={0.9} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </points>
    </group>
  );
}
