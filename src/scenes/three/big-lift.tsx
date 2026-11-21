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
  Euler,
  type Group,
  type InstancedMesh,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type PointLight,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  type SpotLight,
  TorusGeometry,
  Vector3,
} from "three";
import { dustTexture, seeded, usePbr, useSceneRuntime } from "./shared";

const BASE_SECONDS = 9;
const MAST = { half: 0.8, height: 30, section: 2 };
const JIB = { bottom: 31, top: 32.6, half: 0.8, length: 40, bay: 2 };
const COUNTER = { length: 12, half: 1 };
const APEX = 38;
const PIVOT_Y = JIB.bottom - 0.4;
const LOAD = { width: 3, height: 2.2, depth: 2.2, x: 18 };
const SLING = 2.4;
const HOOK_DROP = 0.2;
const GROUND_LENGTH = PIVOT_Y - (LOAD.height + SLING + HOOK_DROP);
const LIFTED_LENGTH = 6;
const LIFT = 2.2;
const PANEL_GAP = 0.05;
const UP = new Vector3(0, 1, 0);

type Member = { a: [number, number, number]; b: [number, number, number]; thick: number };

function craneMembers(): Member[] {
  const members: Member[] = [];
  const add = (a: [number, number, number], b: [number, number, number], thick = 0.14) => members.push({ a, b, thick });
  const m = MAST.half;
  const corners: [number, number][] = [
    [-m, -m],
    [m, -m],
    [m, m],
    [-m, m],
  ];
  corners.forEach(([x, z]) => add([x, 0, z], [x, MAST.height, z], 0.18));
  for (let y = 0; y < MAST.height; y += MAST.section) {
    corners.forEach(([x, z], index) => {
      const [nx, nz] = corners[(index + 1) % 4] ?? [x, z];
      add([x, y, z], [nx, y, nz], 0.1);
      if ((y / MAST.section) % 2 === 0) add([x, y, z], [nx, y + MAST.section, nz], 0.08);
      else add([nx, y, nz], [x, y + MAST.section, z], 0.08);
    });
  }

  const j = JIB;
  add([0, j.bottom, -j.half], [j.length, j.bottom, -j.half], 0.14);
  add([0, j.bottom, j.half], [j.length, j.bottom, j.half], 0.14);
  add([0, j.top, 0], [j.length - j.bay, j.top, 0], 0.14);
  for (let x = 0; x < j.length; x += j.bay) {
    const end = Math.min(j.length, x + j.bay);
    add([x, j.bottom, -j.half], [x, j.bottom, j.half], 0.08);
    add([x, j.bottom, -j.half], [x, j.top, 0], 0.07);
    add([x, j.bottom, j.half], [x, j.top, 0], 0.07);
    if (end < j.length) {
      add([x, j.top, 0], [end, j.bottom, -j.half], 0.06);
      add([x, j.top, 0], [end, j.bottom, j.half], 0.06);
    }
  }
  add([j.length - j.bay, j.top, 0], [j.length, j.bottom, -j.half], 0.07);
  add([j.length - j.bay, j.top, 0], [j.length, j.bottom, j.half], 0.07);
  add([j.length, j.bottom, -j.half], [j.length, j.bottom, j.half], 0.08);

  const c = COUNTER;
  add([0, j.bottom, -c.half], [-c.length, j.bottom, -c.half], 0.16);
  add([0, j.bottom, c.half], [-c.length, j.bottom, c.half], 0.16);
  for (let x = 0; x >= -c.length; x -= 2) {
    add([x, j.bottom, -c.half], [x, j.bottom, c.half], 0.1);
    if (x > -c.length) add([x, j.bottom, -c.half], [x - 2, j.bottom, c.half], 0.07);
  }

  corners.forEach(([x, z]) => add([x, j.bottom + 0.6, z], [0, APEX, 0], 0.16));
  add([0, APEX, 0], [j.length * 0.5, j.top, 0], 0.05);
  add([0, APEX, 0], [j.length - 3, j.top, 0], 0.05);
  add([0, APEX, 0], [-c.length + 1, j.bottom + 0.4, -c.half], 0.05);
  add([0, APEX, 0], [-c.length + 1, j.bottom + 0.4, c.half], 0.05);
  return members;
}

function frameMembers(): Member[] {
  const w = LOAD.width / 2;
  const d = LOAD.depth / 2;
  const top = 0;
  const bottom = -LOAD.height;
  const members: Member[] = [];
  const add = (a: [number, number, number], b: [number, number, number], thick = 0.12) => members.push({ a, b, thick });
  const ring: [number, number][] = [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ];
  ring.forEach(([x, z], index) => {
    const [nx, nz] = ring[(index + 1) % 4] ?? [x, z];
    add([x, top, z], [nx, top, nz]);
    add([x, bottom, z], [nx, bottom, nz]);
    add([x, top, z], [x, bottom, z]);
  });
  for (let i = 1; i < 6; i++) {
    const x = -w + (i * LOAD.width) / 6;
    add([x, top, d], [x, bottom, d], 0.05);
    add([x, top, -d], [x, bottom, -d], 0.05);
  }
  for (let i = 1; i < 4; i++) {
    const z = -d + (i * LOAD.depth) / 4;
    add([w, top, z], [w, bottom, z], 0.05);
    add([-w, top, z], [-w, bottom, z], 0.05);
  }
  ring.forEach(([x, z]) => add([0, SLING, 0], [x * 0.92, top, z * 0.92], 0.035));
  return members;
}

function groundGeometry() {
  const geometry = new PlaneGeometry(400, 400);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as BufferAttribute;
  const uv = geometry.attributes.uv as BufferAttribute;
  for (let index = 0; index < position.count; index++) uv.setXY(index, position.getX(index) / 4, position.getZ(index) / 4);
  return geometry;
}

const SKY_STOPS: [number, string][] = [
  [-0.2, "#6e5a52"],
  [0, "#d08c5c"],
  [0.08, "#b9806a"],
  [0.3, "#4f6188"],
  [1, "#121a30"],
];

function skyGeometry() {
  const geometry = new SphereGeometry(300, 32, 16);
  const position = geometry.attributes.position as BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const stops = SKY_STOPS.map(([at, hex]) => ({ at, color: new Color(hex) }));
  const color = new Color();
  for (let index = 0; index < position.count; index++) {
    const height = position.getY(index) / 300;
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
    gradient.addColorStop(0.35, "rgba(70,70,70,1)");
    gradient.addColorStop(1, "rgba(255,255,255,1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  }
  beamFade = new CanvasTexture(canvas);
  beamFade.colorSpace = SRGBColorSpace;
  return beamFade;
}

type PanelSpec = { position: [number, number, number]; size: [number, number, number]; normal: [number, number, number]; axis: "x" | "z"; spin: number; delay: number };

const PANELS: PanelSpec[] = [
  { position: [0, -LOAD.height / 2, LOAD.depth / 2 + 0.04], size: [LOAD.width - PANEL_GAP, LOAD.height - PANEL_GAP, 0.05], normal: [0, 0, 1], axis: "x", spin: 1.6, delay: 6.25 },
  { position: [-LOAD.width / 2 - 0.04, -LOAD.height / 2, 0], size: [0.05, LOAD.height - PANEL_GAP, LOAD.depth - PANEL_GAP], normal: [-1, 0, 0], axis: "z", spin: 1.5, delay: 6.35 },
  { position: [LOAD.width / 2 + 0.04, -LOAD.height / 2, 0], size: [0.05, LOAD.height - PANEL_GAP, LOAD.depth - PANEL_GAP], normal: [1, 0, 0], axis: "z", spin: -1.5, delay: 6.4 },
  { position: [0, 0.04, 0], size: [LOAD.width - PANEL_GAP, 0.05, LOAD.depth - PANEL_GAP], normal: [0, 0.4, -1], axis: "x", spin: -1.2, delay: 6.5 },
  { position: [0, -LOAD.height / 2, -LOAD.depth / 2 - 0.04], size: [LOAD.width - PANEL_GAP, LOAD.height - PANEL_GAP, 0.05], normal: [0, 0, -1], axis: "x", spin: -1.4, delay: 6.55 },
];

const FLOODS: { position: [number, number, number] }[] = [{ position: [11, 0.6, 13] }, { position: [26, 0.6, 11] }];

type Proxy = {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  follow: number;
  trolley: number;
  cable: number;
  yaw: number;
  core: number;
  flood: number;
};

type Particle = { kind: 0 | 1; origin: readonly [number, number, number]; velocity: readonly [number, number, number]; phase: number; brightness: number };

type LiftParts = {
  trolley: Group | null;
  cable: Mesh | null;
  hook: Group | null;
  load: Group | null;
  panels: (Mesh | null)[];
  core: Mesh | null;
  coreLight: PointLight | null;
  floods: (SpotLight | null)[];
  beams: (Mesh | null)[];
};

class LiftRig {
  readonly proxy: Proxy = { camX: -7, camY: 1.5, camZ: 8, lookX: 3, lookY: 26, lookZ: 0, follow: 0, trolley: 34, cable: 4, yaw: 0.9, core: 0, flood: 0 };
  readonly timeline = gsap.timeline({ paused: true });
  readonly crane = craneMembers();
  readonly frame = frameMembers();
  readonly member = new BoxGeometry(1, 1, 1);
  readonly ground = groundGeometry();
  readonly sky = skyGeometry();
  readonly cableGeometry = new CylinderGeometry(0.03, 0.03, 1, 6);
  readonly hookGeometry = new TorusGeometry(0.28, 0.07, 8, 20, Math.PI * 1.45);
  readonly beamGeometry = new CylinderGeometry(3.2, 0.25, 1, 24, 1, true);
  readonly dust = new BufferGeometry();
  readonly particles: Particle[];
  private readonly dummy = new Object3D();
  private readonly pivot = new Vector3();
  private readonly hookAt = new Vector3();
  private readonly loadAt = new Vector3();
  private readonly swing = new Quaternion();
  private readonly yawTurn = new Quaternion();
  private readonly euler = new Euler();
  private readonly direction = new Vector3();
  private readonly target = new Vector3();

  constructor(particleCount: number) {
    const proxy = this.proxy;
    this.timeline
      .to(proxy, { trolley: LOAD.x, duration: LIFT, ease: "power2.out" }, 0)
      .to(proxy, { cable: GROUND_LENGTH, duration: LIFT, ease: "power1.inOut" }, 0)
      .to(proxy, { camX: -2, camY: 2, camZ: 12, lookX: 10, lookY: 19, duration: LIFT, ease: "sine.inOut" }, 0)
      .to(proxy, { cable: LIFTED_LENGTH, duration: 2.8, ease: "power2.inOut" }, LIFT)
      .to(proxy, { follow: 1, duration: 0.9, ease: "sine.inOut" }, LIFT)
      .to(proxy, { camX: 9, camY: 2.4, camZ: 15, duration: 2.8, ease: "sine.inOut" }, LIFT)
      .to(proxy, { camX: LOAD.x, camY: 20.6, camZ: 13.5, duration: 2, ease: "power2.inOut" }, 5)
      .to(proxy, { yaw: 0, duration: 1.2, ease: "back.out(1.4)" }, 5)
      .to(proxy, { core: 0.25, duration: 0.6, ease: "sine.in" }, 5.6)
      .to(proxy, { core: 1, duration: 0.4, ease: "power2.out" }, 6.25)
      .to(proxy, { flood: 1, duration: 0.5, ease: "steps(4)" }, 7)
      .to(proxy, { camX: LOAD.x + 0.6, camZ: 12.4, duration: 2, ease: "sine.inOut" }, 7);

    const random = seeded(83);
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      if (index < particleCount * 0.45) {
        const angle = random() * Math.PI * 2;
        const radius = 1.4 + random() * 0.6;
        return {
          kind: 0,
          origin: [LOAD.x + Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius] as const,
          velocity: [Math.cos(angle) * (1.5 + random() * 3), 0.3 + random() * 1.2, Math.sin(angle) * (1.5 + random() * 3)] as const,
          phase: random() * 0.4,
          brightness: 0.4 + random() * 0.6,
        } satisfies Particle;
      }
      return {
        kind: 1,
        origin: [(random() - 0.5) * 9, (random() - 0.5) * 6, (random() - 0.2) * 7] as const,
        velocity: [(random() - 0.5) * 0.3, (random() - 0.5) * 0.15, (random() - 0.5) * 0.2] as const,
        phase: random() * Math.PI * 2,
        brightness: 0.3 + random() * 0.7,
      } satisfies Particle;
    });
    this.dust.setAttribute("position", new BufferAttribute(new Float32Array(particleCount * 3), 3));
    this.dust.setAttribute("color", new BufferAttribute(new Float32Array(particleCount * 3), 3));
  }

  build(meshes: { crane: InstancedMesh | null; frame: InstancedMesh | null }) {
    this.writeMembers(meshes.crane, this.crane);
    this.writeMembers(meshes.frame, this.frame);
  }

  aim(floods: (SpotLight | null)[], beams: (Mesh | null)[]) {
    const final = new Vector3(LOAD.x, PIVOT_Y - LIFTED_LENGTH - HOOK_DROP - SLING - LOAD.height / 2, 0);
    FLOODS.forEach((flood, index) => {
      const light = floods[index];
      if (light) {
        light.target.position.copy(final);
        light.target.updateMatrixWorld();
      }
      const beam = beams[index];
      if (beam) {
        const from = new Vector3(...flood.position);
        const along = final.clone().sub(from);
        const length = along.length() * 0.85;
        along.normalize();
        beam.position.copy(from).addScaledVector(along, length / 2);
        beam.quaternion.setFromUnitVectors(UP, along);
        beam.scale.set(1, length, 1);
      }
    });
  }

  update(t: number, camera: Camera, parts: LiftParts, accent: Color, reducedMotion: boolean) {
    const proxy = this.proxy;
    this.timeline.time(Math.min(BASE_SECONDS, Math.max(0, t)), true);

    const sinceLift = Math.max(0, t - LIFT);
    const sway = reducedMotion ? 0.4 : 1;
    const swingZ = t > LIFT ? 0.06 * sway * Math.exp(-0.75 * sinceLift) * Math.sin(1.7 * sinceLift) : 0;
    const swingX = t > LIFT ? 0.025 * sway * Math.exp(-0.9 * sinceLift) * Math.sin(1.3 * sinceLift + 0.6) : 0;
    this.pivot.set(proxy.trolley, PIVOT_Y, 0);
    this.swing.setFromEuler(this.euler.set(swingX, 0, swingZ));
    this.hookAt.set(0, -proxy.cable, 0).applyQuaternion(this.swing).add(this.pivot);

    if (parts.trolley) parts.trolley.position.set(proxy.trolley, JIB.bottom, 0);
    if (parts.cable) {
      parts.cable.position.copy(this.pivot).add(this.hookAt).multiplyScalar(0.5);
      parts.cable.quaternion.copy(this.swing);
      parts.cable.scale.set(1, proxy.cable, 1);
    }
    if (parts.hook) {
      parts.hook.position.copy(this.hookAt);
      parts.hook.quaternion.copy(this.swing);
    }

    this.yawTurn.setFromAxisAngle(UP, proxy.yaw);
    if (t < LIFT) {
      this.loadAt.set(LOAD.x, LOAD.height, 0);
      if (parts.load) {
        parts.load.position.copy(this.loadAt);
        parts.load.quaternion.copy(this.yawTurn);
      }
    } else {
      this.loadAt.set(0, -(HOOK_DROP + SLING), 0).applyQuaternion(this.swing).add(this.hookAt);
      if (parts.load) {
        parts.load.position.copy(this.loadAt);
        parts.load.quaternion.copy(this.swing).multiply(this.yawTurn);
      }
    }

    const center = this.target.copy(this.loadAt);
    center.y -= LOAD.height / 2;
    const lookX = proxy.lookX + (center.x - proxy.lookX) * proxy.follow;
    const lookY = proxy.lookY + (center.y - proxy.lookY) * proxy.follow;
    const lookZ = proxy.lookZ + (center.z - proxy.lookZ) * proxy.follow;
    camera.position.set(proxy.camX, proxy.camY, proxy.camZ);
    camera.lookAt(lookX, lookY, lookZ);

    parts.panels.forEach((panel, index) => {
      const spec = PANELS[index];
      if (!panel || !spec) return;
      const age = Math.max(0, t - spec.delay);
      panel.visible = age < 2.4;
      panel.position.set(spec.position[0] + spec.normal[0] * 1.2 * age, spec.position[1] + spec.normal[1] * 1.2 * age - 4.9 * age * age, spec.position[2] + spec.normal[2] * 1.2 * age);
      const angle = spec.spin * age * age * 1.4;
      panel.rotation.set(spec.axis === "x" ? angle : 0, 0, spec.axis === "z" ? angle : 0);
    });

    const pulse = 0.92 + Math.sin(t * 9) * 0.05;
    if (parts.core) (parts.core.material as MeshStandardMaterial).emissiveIntensity = proxy.core * 2.2 * pulse;
    if (parts.coreLight) parts.coreLight.intensity = proxy.core * 30;
    parts.floods.forEach((flood) => {
      if (flood) flood.intensity = proxy.flood * 2600;
    });
    parts.beams.forEach((beam) => {
      if (beam) (beam.material as Material).opacity = proxy.flood * 0.16;
    });

    this.updateDust(t, accent);
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

  private updateDust(t: number, accent: Color) {
    const positions = this.dust.attributes.position as BufferAttribute;
    const colors = this.dust.attributes.color as BufferAttribute;
    const flood = this.proxy.flood;
    const core = this.proxy.core;
    const center = this.target;
    this.particles.forEach((particle, index) => {
      if (particle.kind === 0) {
        const age = t - LIFT - particle.phase;
        if (age <= 0 || age > 3) {
          positions.setXYZ(index, 0, -50, 0);
          colors.setXYZ(index, 0, 0, 0);
          return;
        }
        const drag = (1 - Math.exp(-1.8 * age)) / 1.8;
        positions.setXYZ(index, particle.origin[0] + particle.velocity[0] * drag, particle.origin[1] + particle.velocity[1] * drag, particle.origin[2] + particle.velocity[2] * drag);
        const light = Math.min(1, age * 4) * Math.max(0, 1 - age / 3) * particle.brightness * 0.35;
        colors.setXYZ(index, light, light * 0.95, light * 0.88);
        return;
      }
      const x = center.x + particle.origin[0] + particle.velocity[0] * t + Math.sin(t * 0.4 + particle.phase) * 0.2;
      const y = center.y + particle.origin[1] + particle.velocity[1] * t + Math.cos(t * 0.3 + particle.phase) * 0.15;
      const z = center.z + particle.origin[2] + particle.velocity[2] * t;
      positions.setXYZ(index, x, y, z);
      const glow = (flood * 0.5 + core * 0.15) * particle.brightness;
      const mix = core * 0.5;
      colors.setXYZ(index, glow * (1 - mix + accent.r * mix), glow * (1 - mix + accent.g * mix), glow * (1 - mix + accent.b * mix));
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }
}

export function BigLift() {
  const runtime = useSceneRuntime();
  const steelPbr = usePbr("metal_plate", [1, 1]);
  const groundPbr = usePbr("concrete_floor_worn_001");
  const [rig] = useState(() => new LiftRig(Math.round(runtime.tier.particles * 0.8)));
  const accent = useMemo(() => new Color(runtime.accent), [runtime.accent]);
  const paint = useMemo(
    () => new MeshStandardMaterial({ color: "#f2b200", normalMap: steelPbr.normalMap, roughnessMap: steelPbr.roughnessMap, roughness: 0.6, metalness: 0.35 }),
    [steelPbr],
  );
  const steel = useMemo(() => new MeshStandardMaterial({ color: "#4a5058", normalMap: steelPbr.normalMap, roughnessMap: steelPbr.roughnessMap, roughness: 0.5, metalness: 0.4 }), [steelPbr]);
  const cover = useMemo(() => new MeshStandardMaterial({ normalMap: steelPbr.normalMap, roughnessMap: steelPbr.roughnessMap, color: "#86a6c6", roughness: 0.65, metalness: 0.15 }), [steelPbr]);
  const crane = useRef<InstancedMesh>(null);
  const frame = useRef<InstancedMesh>(null);
  const trolley = useRef<Group>(null);
  const cable = useRef<Mesh>(null);
  const hook = useRef<Group>(null);
  const load = useRef<Group>(null);
  const panels = useRef<(Mesh | null)[]>([]);
  const core = useRef<Mesh>(null);
  const coreLight = useRef<PointLight>(null);
  const floods = useRef<(SpotLight | null)[]>([]);
  const beams = useRef<(Mesh | null)[]>([]);

  useLayoutEffect(() => {
    rig.build({ crane: crane.current, frame: frame.current });
    rig.aim(floods.current, beams.current);
  }, [rig]);

  useFrame((state) => {
    const t = (runtime.elapsedMs() / runtime.durationMs) * BASE_SECONDS;
    rig.update(
      t,
      state.camera,
      {
        trolley: trolley.current,
        cable: cable.current,
        hook: hook.current,
        load: load.current,
        panels: panels.current,
        core: core.current,
        coreLight: coreLight.current,
        floods: floods.current,
        beams: beams.current,
      },
      accent,
      runtime.reducedMotion,
    );
  });

  const shadows = runtime.tier.shadows;
  const mapSize = runtime.tier.shadowMapSize;
  return (
    <group>
      <mesh geometry={rig.sky}>
        <meshBasicMaterial vertexColors side={1} fog={false} depthWrite={false} />
      </mesh>
      <fog attach="fog" args={["#b9806a", 40, 170]} />
      <hemisphereLight args={["#9fb2d6", "#7a5c48", 2.4]} />
      <directionalLight
        position={[-45, 28, 35]}
        intensity={2.2}
        color="#ffb27a"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={160}
        shadow-bias={-0.0006}
      />
      <mesh geometry={rig.ground} receiveShadow={shadows}>
        <meshStandardMaterial {...groundPbr} color="#c9c4bc" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.5, 0]} receiveShadow={shadows} castShadow={shadows}>
        <boxGeometry args={[6, 1, 6]} />
        <meshStandardMaterial {...groundPbr} color="#a9a59e" roughness={1} />
      </mesh>
      <instancedMesh ref={crane} args={[rig.member, paint, rig.crane.length]} frustumCulled={false} castShadow={shadows} />
      <mesh position={[0, MAST.height + 0.5, 0]} material={paint} castShadow={shadows}>
        <boxGeometry args={[2.6, 1, 2.6]} />
      </mesh>
      <mesh position={[1.6, MAST.height + 0.2, 1.5]} castShadow={shadows}>
        <boxGeometry args={[1.8, 2, 1.6]} />
        <meshStandardMaterial color="#e9e4da" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[2.52, MAST.height + 0.5, 1.5]}>
        <planeGeometry args={[1.4, 1.1]} />
        <meshStandardMaterial color="#1c2630" roughness={0.1} metalness={0.9} side={DoubleSide} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[-COUNTER.length + 1.2 + index * 1.25, JIB.bottom - 0.9, 0]} castShadow={shadows}>
          <boxGeometry args={[1.15, 2.2, 2.2]} />
          <meshStandardMaterial {...groundPbr} color="#b8b2a8" roughness={1} />
        </mesh>
      ))}
      <group ref={trolley}>
        <mesh position={[0, -0.2, 0]} material={paint} castShadow={shadows}>
          <boxGeometry args={[1.4, 0.4, 1.9]} />
        </mesh>
      </group>
      <mesh ref={cable} geometry={rig.cableGeometry}>
        <meshStandardMaterial color="#1d1f22" roughness={0.6} metalness={0.8} />
      </mesh>
      <group ref={hook}>
        <mesh position={[0, -0.05, 0]} material={paint} castShadow={shadows}>
          <boxGeometry args={[0.7, 0.8, 0.35]} />
        </mesh>
        <mesh position={[0, -0.6, 0]} rotation={[0, 0, Math.PI * 0.8]} geometry={rig.hookGeometry} material={steel} />
      </group>
      <group ref={load}>
        <instancedMesh ref={frame} args={[rig.member, steel, rig.frame.length]} frustumCulled={false} castShadow={shadows} />
        <mesh position={[0, -LOAD.height - 0.02, 0]} material={cover} castShadow={shadows}>
          <boxGeometry args={[LOAD.width + 0.1, 0.1, LOAD.depth + 0.1]} />
        </mesh>
        <mesh ref={core} position={[0, -LOAD.height / 2, 0]}>
          <boxGeometry args={[LOAD.width - 0.3, LOAD.height - 0.3, LOAD.depth - 0.3]} />
          <meshStandardMaterial color="#0d0c0b" emissive={accent} emissiveIntensity={0} roughness={0.4} />
        </mesh>
        <pointLight ref={coreLight} position={[0, -LOAD.height / 2, LOAD.depth]} color={accent} intensity={0} distance={9} decay={2} />
        {PANELS.map((panel, index) => (
          <mesh
            key={index}
            material={cover}
            castShadow={shadows}
            ref={(mesh) => {
              panels.current[index] = mesh;
            }}
          >
            <boxGeometry args={panel.size} />
          </mesh>
        ))}
      </group>
      {FLOODS.map((flood, index) => (
        <group key={index}>
          <spotLight
            ref={(light) => {
              floods.current[index] = light;
            }}
            position={flood.position}
            angle={0.14}
            penumbra={0.6}
            decay={2}
            intensity={0}
            color="#fff1dc"
          />
          <mesh position={flood.position}>
            <boxGeometry args={[0.8, 0.6, 0.5]} />
            <meshStandardMaterial color="#2a2c2f" emissive="#fff1dc" emissiveIntensity={0.2} />
          </mesh>
          <mesh
            geometry={rig.beamGeometry}
            ref={(mesh) => {
              beams.current[index] = mesh;
            }}
          >
            <meshBasicMaterial map={beamTexture()} color="#fff1dc" transparent opacity={0} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
        </group>
      ))}
      <points geometry={rig.dust} frustumCulled={false}>
        <pointsMaterial map={dustTexture()} size={0.12} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} />
      </points>
    </group>
  );
}
