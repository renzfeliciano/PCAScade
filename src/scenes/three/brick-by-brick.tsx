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
  Color,
  type Group,
  type InstancedMesh,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Object3D,
  type PointLight,
  Shape,
  ShapeGeometry,
  type SpotLight,
  type Sprite,
  Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { dustTexture, seeded, shake, usePbr, useSceneRuntime } from "./shared";

const BRICK = { length: 0.215, height: 0.065, depth: 0.1025 };
const JOINT = 0.01;
const COURSE = BRICK.height + JOINT;
const UNIT = BRICK.length + JOINT;
const COLUMNS = 9;
const ROWS = 13;
const BASE_SECONDS = 7;
const JOLTS = [2.8, 3.4, 4.0];
const BREAKOUT = 4.4;
const EVENT_TIMES = [...JOLTS, BREAKOUT];
const BRICK_TONES = ["#e2c9bb", "#cfb2a2", "#bf9f8f", "#ead6c6", "#b89484", "#d4baa8", "#a88676", "#c7a796"];

type Slot = { x: number; y: number; tone: string };

function shiftInstanceUv(material: MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec2 instanceShift = fract(vec2(float(gl_InstanceID) * 0.6180339, float(gl_InstanceID) * 0.3819660));
        #ifdef USE_MAP
          vMapUv += instanceShift;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv += instanceShift;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv += instanceShift;
        #endif
      #endif`,
    );
  };
}

function wallLayout(): Slot[] {
  const random = seeded(7);
  const slots: Slot[] = [];
  for (let row = -ROWS; row <= ROWS; row++) {
    const offset = Math.abs(row) % 2 === 1 ? UNIT / 2 : 0;
    for (let column = -COLUMNS; column <= COLUMNS; column++) {
      if (row === 0 && column === 0) continue;
      slots.push({ x: column * UNIT + offset, y: row * COURSE, tone: BRICK_TONES[Math.floor(random() * BRICK_TONES.length)] ?? "#cfb2a2" });
    }
  }
  return slots;
}

function mortarGeometry() {
  const width = (COLUMNS * 2 + 3) * UNIT;
  const height = (ROWS * 2 + 3) * COURSE;
  const shape = new Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.lineTo(-width / 2, -height / 2);
  const hole = new Shape();
  const hw = BRICK.length / 2 + JOINT * 0.4;
  const hh = BRICK.height / 2 + JOINT * 0.4;
  hole.moveTo(-hw, -hh);
  hole.lineTo(-hw, hh);
  hole.lineTo(hw, hh);
  hole.lineTo(hw, -hh);
  hole.lineTo(-hw, -hh);
  shape.holes.push(hole);
  const geometry = new ShapeGeometry(shape);
  const uv = geometry.attributes.uv;
  if (uv) {
    for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * 0.6, uv.getY(index) * 0.6);
  }
  return geometry;
}

type Proxy = { camX: number; camY: number; camZ: number; glow: number; out: number; tip: number; drop: number; light: number; bloom: number };

type Particle = {
  mote: boolean;
  event: number;
  origin: readonly [number, number, number];
  velocity: readonly [number, number, number];
  drift: readonly [number, number, number];
  phase: number;
  speed: number;
  brightness: number;
};

type Chip = { origin: [number, number, number]; velocity: [number, number, number]; spin: [number, number, number]; delay: number };

type BrickParts = {
  special: Group | null;
  seams: Mesh[];
  glow: Sprite | null;
  cavityLight: PointLight | null;
  workLight: SpotLight | null;
  chips: InstancedMesh | null;
};

class BrickRig {
  readonly proxy: Proxy = { camX: -0.32, camY: 0.06, camZ: 0.95, glow: 0, out: 0, tip: 0, drop: 0, light: 0, bloom: 0 };
  readonly timeline = gsap.timeline({ paused: true });
  readonly particles: Particle[];
  readonly chips: Chip[];
  readonly dust = new BufferGeometry();
  readonly slots = wallLayout();
  readonly mortar = mortarGeometry();
  readonly brickGeometry = new RoundedBoxGeometry(BRICK.length, BRICK.height, BRICK.depth, 2, 0.0045);
  readonly chipGeometry = new BoxGeometry(0.008, 0.005, 0.006);
  private readonly dummy = new Object3D();

  constructor(particleCount: number) {
    const proxy = this.proxy;
    this.timeline
      .to(proxy, { camX: 0, camY: 0.015, camZ: 0.78, duration: 2.6, ease: "power1.inOut" }, 0)
      .to(proxy, { glow: 1, duration: 1.4, ease: "sine.inOut" }, 1.2)
      .to(proxy, { camZ: 0.46, duration: 2.8, ease: "power2.inOut" }, 2.6)
      .to(proxy, { out: 0.018, duration: 0.14, ease: "power3.out" }, JOLTS[0])
      .to(proxy, { out: 0.038, duration: 0.14, ease: "power3.out" }, JOLTS[1])
      .to(proxy, { out: 0.06, duration: 0.14, ease: "power3.out" }, JOLTS[2])
      .to(proxy, { out: 0.15, duration: 0.45, ease: "power2.in" }, BREAKOUT)
      .to(proxy, { tip: -2.6, drop: -1.1, duration: 0.5, ease: "power1.in" }, BREAKOUT + 0.05)
      .to(proxy, { glow: 1.4, light: 1, duration: 0.3, ease: "sine.out" }, BREAKOUT)
      .to(proxy, { glow: 0.25, duration: 1.2, ease: "sine.inOut" }, BREAKOUT + 0.4)
      .to(proxy, { bloom: 1, camZ: 0.13, camY: 0, duration: 1.6, ease: "power2.inOut" }, 5.4);

    const random = seeded(31);
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      const mote = index < particleCount * 0.3;
      const edge = random();
      const side = Math.floor(random() * 4);
      const along = (random() - 0.5) * 2;
      const ox = side < 2 ? along * (BRICK.length / 2) : (side === 2 ? -1 : 1) * (BRICK.length / 2 + 0.004);
      const oy = side < 2 ? (side === 0 ? -1 : 1) * (BRICK.height / 2 + 0.004) : along * (BRICK.height / 2);
      return {
        mote,
        event: mote ? -1 : random() < 0.55 ? 3 : Math.floor(random() * 3),
        origin: [ox, oy, BRICK.depth / 2] as const,
        velocity: [(ox / BRICK.length) * 0.5 + (random() - 0.5) * 0.12, (oy / BRICK.height) * 0.12 + (random() - 0.2) * 0.08, 0.04 + random() * 0.22 + edge * 0.04] as const,
        drift: [(random() - 0.5) * 1.6, (random() - 0.5) * 0.9, 0.1 + random() * 0.9] as const,
        phase: random() * Math.PI * 2,
        speed: 0.15 + random() * 0.35,
        brightness: 0.35 + random() * 0.65,
      };
    });
    this.dust.setAttribute("position", new BufferAttribute(new Float32Array(particleCount * 3), 3));
    this.dust.setAttribute("color", new BufferAttribute(new Float32Array(particleCount * 3), 3));

    const chipRandom = seeded(53);
    this.chips = Array.from({ length: 40 }, () => ({
      origin: [(chipRandom() - 0.5) * BRICK.length, (chipRandom() - 0.5) * BRICK.height, BRICK.depth / 2],
      velocity: [(chipRandom() - 0.5) * 0.9, 0.2 + chipRandom() * 0.8, 0.3 + chipRandom() * 0.7],
      spin: [chipRandom() * 14, chipRandom() * 14, chipRandom() * 14],
      delay: chipRandom() * 0.35,
    }));
  }

  frame(t: number, camera: Camera, parts: BrickParts, reducedMotion: boolean) {
    const proxy = this.proxy;
    this.timeline.time(Math.min(BASE_SECONDS, Math.max(0, t)), true);

    const joltShake = reducedMotion ? 0 : EVENT_TIMES.reduce((sum, at) => (t >= at ? sum + Math.max(0, 1 - (t - at) * 5) * 0.004 : sum), 0);
    const [sx, sy] = shake(t, joltShake, 3);
    camera.position.set(proxy.camX + sx, proxy.camY + sy, proxy.camZ);
    camera.lookAt(proxy.camX * 0.35, proxy.camY * 0.5, -0.05);

    if (parts.special) {
      parts.special.position.set(0, proxy.drop, proxy.out);
      parts.special.rotation.set(proxy.tip, proxy.tip * 0.15, 0);
    }
    const flicker = 0.85 + Math.sin(t * 31) * 0.08 + Math.sin(t * 13.7) * 0.07;
    for (const seam of parts.seams) (seam.material as MeshStandardMaterial).emissiveIntensity = proxy.glow * 1.4 * flicker;
    if (parts.cavityLight) parts.cavityLight.intensity = proxy.light * 0.45 * (1 - proxy.bloom * 0.75);
    if (parts.glow) {
      const scale = 0.06 + proxy.light * 0.18 + proxy.bloom * 0.35;
      parts.glow.scale.set(scale * 2.2, scale, 1);
      (parts.glow.material as Material).opacity = Math.min(0.7, proxy.light * 0.45 * (1 - proxy.bloom * 0.5));
    }
    if (parts.workLight) parts.workLight.intensity = 16 * (1 - proxy.bloom * 0.6);
    this.updateDust(t);
    this.updateChips(t, parts.chips);
  }

  layWall(mesh: InstancedMesh) {
    const dummy = this.dummy;
    const random = seeded(11);
    this.slots.forEach((slot, index) => {
      dummy.position.set(slot.x + (random() - 0.5) * 0.003, slot.y + (random() - 0.5) * 0.002, (random() - 0.5) * 0.006);
      dummy.rotation.set((random() - 0.5) * 0.01, (random() - 0.5) * 0.012, (random() - 0.5) * 0.008);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new Color(slot.tone));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }

  aim(light: SpotLight) {
    light.target.position.set(0.05, -0.02, 0);
    light.target.updateMatrixWorld();
  }

  private updateDust(t: number) {
    const positions = this.dust.attributes.position as BufferAttribute;
    const colors = this.dust.attributes.color as BufferAttribute;
    const out = this.proxy.out;
    this.particles.forEach((particle, index) => {
      if (particle.mote) {
        const x = particle.drift[0] * 0.5 + Math.sin(t * particle.speed + particle.phase) * 0.06;
        const y = particle.drift[1] * 0.5 + Math.cos(t * particle.speed * 0.8 + particle.phase) * 0.04 - ((t * 0.01) % 0.3);
        positions.setXYZ(index, x, y, particle.drift[2] * 0.5);
        const light = particle.brightness * 0.18;
        colors.setXYZ(index, light, light * 0.95, light * 0.9);
        return;
      }
      const age = t - (EVENT_TIMES[particle.event] ?? BREAKOUT);
      if (age <= 0 || age > 2.6) {
        positions.setXYZ(index, 0, -50, 0);
        colors.setXYZ(index, 0, 0, 0);
        return;
      }
      const strength = particle.event === 3 ? 1.6 : 0.7;
      const drag = (1 - Math.exp(-2.2 * age)) / 2.2;
      positions.setXYZ(
        index,
        particle.origin[0] + particle.velocity[0] * strength * drag,
        particle.origin[1] + particle.velocity[1] * strength * drag - 0.05 * age * age,
        particle.origin[2] + out + particle.velocity[2] * strength * drag,
      );
      const fade = Math.min(1, age * 6) * Math.max(0, 1 - age / 2.6) * particle.brightness * 0.55;
      colors.setXYZ(index, fade, fade * 0.92, fade * 0.84);
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  private updateChips(t: number, mesh: InstancedMesh | null) {
    if (!mesh) return;
    const dummy = this.dummy;
    this.chips.forEach((chip, index) => {
      const age = t - BREAKOUT - chip.delay;
      if (age <= 0) {
        dummy.scale.setScalar(0);
      } else {
        dummy.scale.setScalar(1);
        dummy.position.set(chip.origin[0] + chip.velocity[0] * age, chip.origin[1] + chip.velocity[1] * age - 4.9 * age * age, chip.origin[2] + chip.velocity[2] * age * 0.6);
        dummy.rotation.set(chip.spin[0] * age, chip.spin[1] * age, chip.spin[2] * age);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
}

const SEAM_PIECES: { position: [number, number, number]; size: [number, number, number] }[] = [
  { position: [0, BRICK.height / 2 + JOINT / 2, 0.041], size: [BRICK.length + JOINT * 2, JOINT * 0.6, 0.004] },
  { position: [0, -BRICK.height / 2 - JOINT / 2, 0.041], size: [BRICK.length + JOINT * 2, JOINT * 0.6, 0.004] },
  { position: [BRICK.length / 2 + JOINT / 2, 0, 0.041], size: [JOINT * 0.6, BRICK.height, 0.004] },
  { position: [-BRICK.length / 2 - JOINT / 2, 0, 0.041], size: [JOINT * 0.6, BRICK.height, 0.004] },
];

export function BrickByBrick() {
  const runtime = useSceneRuntime();
  const brickPbr = usePbr("red_plaster_weathered", [0.14, 0.14]);
  const mortarPbr = usePbr("concrete_wall_008", [1, 1]);
  const [rig] = useState(() => new BrickRig(runtime.tier.particles));
  const wall = useRef<InstancedMesh>(null);
  const special = useRef<Group>(null);
  const seams = useRef<Mesh[]>([]);
  const glowSprite = useRef<Sprite>(null);
  const cavityLight = useRef<PointLight>(null);
  const workLight = useRef<SpotLight>(null);
  const chips = useRef<InstancedMesh>(null);
  const accent = useMemo(() => new Color(runtime.accent), [runtime.accent]);
  const brickMaterial = useMemo(() => {
    const material = new MeshStandardMaterial({ ...brickPbr, roughness: 0.95, metalness: 0, normalScale: new Vector2(1.8, 1.8) });
    shiftInstanceUv(material);
    return material;
  }, [brickPbr]);

  useLayoutEffect(() => {
    if (wall.current) rig.layWall(wall.current);
    if (workLight.current) rig.aim(workLight.current);
  }, [rig]);

  useFrame((state) => {
    const t = (runtime.elapsedMs() / runtime.durationMs) * BASE_SECONDS;
    rig.frame(
      t,
      state.camera,
      { special: special.current, seams: seams.current, glow: glowSprite.current, cavityLight: cavityLight.current, workLight: workLight.current, chips: chips.current },
      runtime.reducedMotion,
    );
  });

  const shadows = runtime.tier.shadows;
  return (
    <group>
      <color attach="background" args={["#06080b"]} />
      <ambientLight intensity={0.04} />
      <spotLight
        ref={workLight}
        position={[-1.35, 0.5, 0.7]}
        angle={0.62}
        penumbra={0.9}
        decay={2}
        intensity={16}
        color="#ffd9b0"
        castShadow={shadows}
        shadow-mapSize-width={runtime.tier.shadowMapSize}
        shadow-mapSize-height={runtime.tier.shadowMapSize}
        shadow-bias={-0.0004}
      />
      <instancedMesh ref={wall} args={[rig.brickGeometry, brickMaterial, rig.slots.length]} frustumCulled={false} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={rig.mortar} position={[0, 0, 0.04]} receiveShadow={shadows}>
        <meshStandardMaterial {...mortarPbr} color="#c9c2b6" roughness={1} />
      </mesh>
      {SEAM_PIECES.map((piece, index) => (
        <mesh
          key={index}
          position={piece.position}
          ref={(mesh) => {
            if (mesh) seams.current[index] = mesh;
          }}
        >
          <boxGeometry args={piece.size} />
          <meshStandardMaterial color="#120e0b" emissive={accent} emissiveIntensity={0} roughness={1} />
        </mesh>
      ))}
      <group ref={special}>
        <mesh geometry={rig.brickGeometry} castShadow={shadows} receiveShadow={shadows}>
          <meshStandardMaterial {...brickPbr} color="#d6bba9" roughness={0.95} normalScale={[1.8, 1.8]} />
        </mesh>
      </group>
      <mesh position={[0, 0, -0.17]}>
        <boxGeometry args={[BRICK.length + 0.004, BRICK.height + 0.004, 0.33]} />
        <meshStandardMaterial color="#17110d" emissive={accent} emissiveIntensity={0.03} side={1} roughness={0.95} />
      </mesh>
      <pointLight ref={cavityLight} position={[0, 0, -0.08]} color={accent} intensity={0} distance={1.4} decay={2} />
      <sprite ref={glowSprite} position={[0, 0, -0.02]}>
        <spriteMaterial map={dustTexture()} color={accent} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} />
      </sprite>
      <points geometry={rig.dust} frustumCulled={false}>
        <pointsMaterial map={dustTexture()} size={0.012} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} />
      </points>
      <instancedMesh ref={chips} args={[rig.chipGeometry, undefined, rig.chips.length]} frustumCulled={false} castShadow={shadows}>
        <meshStandardMaterial color="#8a5a44" roughness={1} />
      </instancedMesh>
    </group>
  );
}
