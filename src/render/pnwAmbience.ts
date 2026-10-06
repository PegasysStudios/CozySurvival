import * as THREE from 'three';
import { circle, overlaps } from '../core/geom2d';
import { hash2, Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import type { GameState } from '../sim/state';
import type { Collider, ColliderIndex } from '../sim/colliders';
import type { Terrain } from '../sim/terrain';
import type { WorldGen } from '../sim/worldgen';
import type { Season } from '../sim/seasons';
import type { Weather } from '../sim/weather';
import { TRUNK_AXIS_LIFT } from '../sim/trunks';
import { hourOf } from '../sim/time';
import { GeoBuilder, tf, windUniforms } from './geo';
import type { NatureView } from './nature';
import { fallenLogGeometry, rockGeometry } from './models';

export type InsectKind = 'butterfly' | 'dragonfly';
export type InsectMode = 'flutter' | 'feed' | 'rest' | 'patrol' | 'hover' | 'dart';
export interface Perch {
  x: number; y: number; z: number;
  flower: boolean;
  water: boolean;
  /** Open flight habitat has no physical surface to land on. */
  flightOnly?: boolean;
  bloom?: NatureView['flowerPerches'][number];
}
export interface AmbientInsect {
  kind: InsectKind;
  mode: InsectMode;
  position: THREE.Vector3;
  from: THREE.Vector3;
  target: THREE.Vector3;
  home: Perch;
  landing: Perch | null;
  elapsed: number;
  duration: number;
  phase: number;
  heading: number;
  bank: number;
}

/** Actual sunlight only: no nocturnal, rainy, foggy, snowy or winter adults. */
export function insectsSunlit(hour: number, season: Season | null, weather: Weather | null): boolean {
  return hour >= 7 && hour < 18 && season !== 'winter' && weather === 'sunny';
}

/** Keep landed visitors attached to the same wind-displaced flower tip as the plant shader. */
export function perchPosition(p: Perch, time: number, wind: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(p.x, p.y + 0.006, p.z);
  const b = p.bloom;
  if (!b) return out;
  const phase = b.rootX * 0.21 + b.rootZ * 0.17;
  const dx = (Math.sin(time * 1.35 + phase) * 0.6 + Math.sin(time * 2.7 + phase * 1.7) * 0.25) * 0.07 * wind * b.scale;
  const dz = Math.cos(time * 1.1 + phase * 1.3) * 0.45 * 0.07 * wind * b.scale;
  out.x += Math.cos(b.rot) * dx + Math.sin(b.rot) * dz;
  out.z += -Math.sin(b.rot) * dx + Math.cos(b.rot) * dz;
  return out;
}

export function createInsect(kind: InsectKind, home: Perch, rng: Rng): AmbientInsect {
  const position = new THREE.Vector3(home.x, home.y + (kind === 'butterfly' ? 0.7 : 1), home.z);
  return { kind, mode: kind === 'butterfly' ? 'flutter' : 'patrol', position, from: position.clone(),
    target: position.clone(), home, landing: null, elapsed: 0, duration: 0, phase: rng.range(0, 100),
    heading: rng.range(0, Math.PI * 2), bank: 0 };
}

function flight(a: AmbientInsect, target: THREE.Vector3, mode: InsectMode, rng: Rng): void {
  a.from.copy(a.position);
  a.target.copy(target);
  a.mode = mode;
  a.elapsed = 0;
  const speed = a.kind === 'butterfly' ? rng.range(0.7, 1.25) : mode === 'dart' ? rng.range(3, 5) : rng.range(1.2, 2.2);
  a.duration = Math.max(0.6, a.from.distanceTo(target) / speed);
  a.heading = Math.atan2(target.x - a.from.x, target.z - a.from.z);
}

const aim = new THREE.Vector3();
/** Visual behavior uses its own seeded RNG, never simulation RNG or damage targets. */
export function advanceInsect(a: AmbientInsect, dt: number, time: number, wind: number, rng: Rng,
  nearby: readonly Perch[], terrain: Pick<Terrain, 'heightAt' | 'inPlayBounds'>): void {
  a.elapsed += dt;
  if (a.mode === 'feed' || a.mode === 'rest') {
    if (a.landing) perchPosition(a.landing, time, wind, a.position);
    if (a.elapsed < a.duration) return;
    a.landing = null;
  } else if (a.mode === 'hover') {
    a.position.copy(a.target);
    a.position.y += Math.sin(time * 7 + a.phase) * 0.014;
    if (a.elapsed < a.duration) return;
  } else if (a.duration > 0 && a.elapsed <= a.duration) {
    if (a.landing) perchPosition(a.landing, time, wind, a.target);
    const u = Math.min(1, a.elapsed / a.duration);
    // Ease into a landing; flight excursions vanish at both ends of the segment.
    const progress = a.landing ? u * u * (3 - 2 * u) : u;
    a.position.lerpVectors(a.from, a.target, progress);
    const envelope = Math.sin(Math.PI * u);
    if (a.kind === 'butterfly') {
      a.position.x += Math.sin(time * 4.3 + a.phase) * 0.12 * envelope;
      a.position.z += Math.cos(time * 3.7 + a.phase) * 0.09 * envelope;
      a.position.y += (0.2 + Math.sin(time * 5.4 + a.phase) * 0.12) * envelope;
      a.bank = Math.sin(time * 4.3 + a.phase) * 0.22 * envelope;
    } else a.bank = Math.sin(Math.PI * u) * (a.mode === 'dart' ? 0.25 : 0.1);
    // Wings never clip through the ground while travelling.
    if (!a.landing) a.position.y = Math.max(a.position.y, terrain.heightAt(a.position.x, a.position.z) + 0.15);
    return;
  }
  if (a.landing) {
    perchPosition(a.landing, time, wind, a.position);
    a.mode = a.kind === 'butterfly' && a.landing.flower ? 'feed' : 'rest';
    a.elapsed = 0;
    a.duration = a.kind === 'butterfly' ? rng.range(4, 10) : rng.range(2, 5);
    a.bank = 0;
    return;
  }
  if (a.kind === 'dragonfly' && a.mode !== 'hover' && rng.chance(0.45)) {
    a.mode = 'hover'; a.elapsed = 0; a.duration = rng.range(0.6, 1.8); a.target.copy(a.position); a.bank = 0;
    return;
  }
  if (rng.chance(a.kind === 'butterfly' ? 0.72 : 0.22)) {
    const wantFlower = a.kind === 'butterfly' && rng.chance(0.72);
    const choices = nearby.filter((p) => Math.hypot(p.x - a.home.x, p.z - a.home.z) < 9
      && !p.flightOnly
      && (a.kind !== 'dragonfly' || p.water) && (a.kind !== 'butterfly' || p.flower === wantFlower));
    if (choices.length) {
      a.landing = rng.pick(choices);
      perchPosition(a.landing, time, wind, aim);
      flight(a, aim, a.kind === 'butterfly' ? 'flutter' : 'patrol', rng);
      return;
    }
  }
  const angle = rng.range(0, Math.PI * 2), radius = rng.range(1, a.kind === 'butterfly' ? 4 : 7);
  aim.set(a.home.x + Math.cos(angle) * radius, 0, a.home.z + Math.sin(angle) * radius);
  if (!terrain.inPlayBounds(aim.x, aim.z, 3)) { aim.x = a.home.x; aim.z = a.home.z; }
  aim.y = Math.max(0, terrain.heightAt(aim.x, aim.z)) + rng.range(0.5, a.kind === 'butterfly' ? 1.4 : 2);
  flight(a, aim, a.kind === 'butterfly' ? 'flutter' : rng.chance(0.45) ? 'dart' : 'patrol', rng);
}

interface InsectRig { root: THREE.Group; wings: THREE.Group[] }

/** Dimensions in metres: butterfly 8.5 cm wingspan, dragonfly 7 cm body / 9 cm span. */
export function insectRig(kind: InsectKind, bodyMat: THREE.Material, wingMat: THREE.Material): InsectRig {
  const root = new THREE.Group(), wings: THREE.Group[] = [];
  const body = new GeoBuilder(81);
  body.add(new THREE.IcosahedronGeometry(kind === 'butterfly' ? 0.006 : 0.005, 0),
    { matrix: tf(0, 0, 0, 0, 0, 0, 0.6, 0.8, kind === 'butterfly' ? 2.5 : 5.4), color: kind === 'butterfly' ? '#3b3124' : '#438c8e' });
  body.add(new THREE.IcosahedronGeometry(0.006, 0), { matrix: tf(0, 0, kind === 'butterfly' ? 0.012 : 0.031), color: '#2a3938' });
  for (const side of [-1, 1]) for (const z of [-0.004, 0.002, 0.008]) {
    body.add(new THREE.CylinderGeometry(0.0005, 0.0005, 0.007, 3),
      { matrix: tf(side * 0.003, -0.003, z, 0, 0, side * 0.7), color: '#30332b', vary: 0 });
  }
  if (kind === 'butterfly') {
    for (const side of [-1, 1]) body.add(new THREE.CylinderGeometry(0.0005, 0.0005, 0.01, 3),
      { matrix: tf(side * 0.003, 0.003, 0.019, Math.PI / 3, 0, side * 0.3), color: '#343029', vary: 0 });
    body.add(new THREE.CylinderGeometry(0.0004, 0.0004, 0.006, 3),
      { matrix: tf(0, -0.003, 0.013), color: '#343029', vary: 0 });
  }
  root.add(new THREE.Mesh(body.build(), bodyMat));
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    const b = new GeoBuilder(82);
    if (kind === 'butterfly') {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(0.019, 0.022); shape.lineTo(0.0425, 0.012);
      shape.lineTo(0.033, -0.009); shape.lineTo(0.024, -0.028); shape.lineTo(0.019, -0.016); shape.lineTo(0, -0.014);
      b.add(new THREE.ShapeGeometry(shape), { matrix: tf(0, 0, 0, Math.PI / 2, 0, 0), color: '#e4cf75', vary: 0.04 });
      for (const x of [0.011, 0.021, 0.031]) b.add(new THREE.BoxGeometry(0.003, 0.0004, 0.022),
        { matrix: tf(x, 0.0002, 0.002, 0, -0.25, 0), color: '#3a3527' });
    } else {
      for (const z of [-0.01, 0.01]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, z); shape.lineTo(0.014, z + 0.008); shape.lineTo(0.045, z + 0.007);
        shape.lineTo(0.035, z - 0.003); shape.lineTo(0, z - 0.002);
        b.add(new THREE.ShapeGeometry(shape), { matrix: tf(0, 0, 0, Math.PI / 2, 0, 0), color: '#ceddd7', vary: 0 });
      }
    }
    hinge.add(new THREE.Mesh(b.build(), kind === 'butterfly' ? bodyMat : wingMat));
    if (kind === 'dragonfly') hinge.position.z = 0.012;
    hinge.scale.x = side;
    root.add(hinge); wings.push(hinge);
  }
  root.traverse((o) => { o.userData.ambient = true; });
  return { root, wings };
}

interface Slot {
  rig: InsectRig; insect: AmbientInsect | null; opacity: number;
  unseen: number;
  bodyMat: THREE.MeshLambertMaterial; wingMat: THREE.MeshLambertMaterial;
}
interface Wisp { sprite: THREE.Sprite; home: Perch | null; phase: number; opacity: number; unseen: number }
export const AMBIENT_CAPS = { butterflies: 10, dragonflies: 6, wisps: 2 } as const;
// A 9 cm insect at 30 m occupies about two pixels. Keep encounters close without enlarging the animals.
export const AMBIENT_RANGE = { habitat: 16, insectHome: 10, insectRetire: 18, wispHome: 12, wispRetire: 18 } as const;

/** Small camera-local pools: the expanded world never multiplies per-frame effects or combat entities. */
export class PnwAmbience {
  readonly group = new THREE.Group();
  readonly insects: Slot[] = [];
  readonly wisps: Wisp[] = [];
  private readonly rng: Rng;
  private readonly grid = new SpatialGrid<Perch>(16);
  private readonly nearby: Perch[] = [];
  private readonly bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private readonly wingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.48, depthWrite: false });
  private readonly glow: THREE.DataTexture;
  private readonly terrain: Terrain;
  private refresh = 0;
  private facing = 0;
  private camX = Infinity;
  private camZ = Infinity;
  private readonly obstacles: Collider[] = [];
  private readonly colliders?: Pick<ColliderIndex, 'query'>;
  constructor(terrain: Terrain, gen: WorldGen, flowers: NatureView['flowerPerches'], colliders?: Pick<ColliderIndex, 'query'>) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.rng = new Rng(gen.seed ^ 0x62756773);
    const cells = new Set<string>();
    const add = (p: Perch) => {
      if (!terrain.inPlayBounds(p.x, p.z, 4)) return;
      p.water = this.nearWater(p.x, p.z);
      this.grid.insert(p, p.x, p.z, 0);
    };
    for (const bloom of flowers) {
      const key = Math.floor(bloom.x / 3) + ',' + Math.floor(bloom.z / 3);
      if (cells.has(key)) continue;
      cells.add(key);
      add({ ...bloom, bloom, flower: true, water: false });
    }
    const rockGeos = [0, 1, 2].map((v) => rockGeometry(v, 'pnw'));
    for (const r of gen.rocks) {
      const g = rockGeos[r.variant], pos = g.getAttribute('position');
      let peak = 0;
      for (let i = 1; i < pos.count; i++) if (pos.getY(i) > pos.getY(peak)) peak = i;
      const v = new THREE.Vector3().fromBufferAttribute(pos, peak).applyMatrix4(tf(r.x, terrain.heightAt(r.x, r.z) - r.r * 0.12, r.z, 0, r.rot, 0, r.r, r.r * r.scaleY, r.r));
      add({ x: v.x, y: v.y, z: v.z, flower: false, water: false });
    }
    rockGeos.forEach((g) => g.dispose());
    // Logs provide dry resting surfaces as well as flowers' nectar.
    const logGeo = fallenLogGeometry(), pos = logGeo.getAttribute('position');
    let peak = 0;
    for (let i = 1; i < pos.count; i++) if (pos.getY(i) > pos.getY(peak)) peak = i;
    for (const l of gen.logs) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, peak).applyMatrix4(tf(l.x, terrain.heightAt(l.x, l.z) + l.r * TRUNK_AXIS_LIFT, l.z, 0, l.rot, 0, l.length, l.r, l.r));
      add({ x: v.x, y: v.y, z: v.z, flower: false, water: false });
    }
    logGeo.dispose();
    // Dry forest stations let insects and wisps occur between the meadows too.
    for (let i = 0; i < gen.trees.length; i += 13) {
      const tr = gen.trees[i], x = tr.x + tr.trunkR + 0.6, z = tr.z;
      if (terrain.heightAt(x, z) < 0.3) continue;
      add({ x, y: terrain.heightAt(x, z), z, flower: false, water: false, flightOnly: true });
    }
    for (const kind of ['butterfly', 'dragonfly'] as const) {
      const count = kind === 'butterfly' ? AMBIENT_CAPS.butterflies : AMBIENT_CAPS.dragonflies;
      for (let i = 0; i < count; i++) {
        const bodyMat = this.bodyMat.clone(), wingMat = this.wingMat.clone();
        bodyMat.transparent = true; bodyMat.depthWrite = false; bodyMat.opacity = 0;
        wingMat.opacity = 0;
        const rig = insectRig(kind, bodyMat, wingMat);
        rig.root.userData.kind = kind;
        rig.root.visible = false;
        this.insects.push({ rig, insect: null, opacity: 0, unseen: 0, bodyMat, wingMat });
        this.group.add(rig.root);
      }
    }
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5), i = (y * 32 + x) * 4;
      pixels.set([170, 216, 218, Math.round(255 * Math.max(0, 1 - r) ** 3)], i);
    }
    this.glow = new THREE.DataTexture(pixels, 32, 32);
    this.glow.needsUpdate = true;
    this.glow.magFilter = THREE.LinearFilter;
    for (let i = 0; i < AMBIENT_CAPS.wisps; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#b0ded8', transparent: true,
        opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.scale.set(0.38, 0.38, 0.38); sprite.visible = false;
      this.group.add(sprite); this.wisps.push({ sprite, home: null, phase: this.rng.range(0, 100), opacity: 0, unseen: 0 });
    }
  }

  private nearWater(x: number, z: number): boolean {
    if (this.terrain.waterDepth(x, z) > 0.05) return true;
    for (let j = 0; j < 8; j++) {
      const angle = j * Math.PI / 4;
      for (const radius of [4, 9, 16]) if (this.terrain.waterDepth(x + Math.sin(angle) * radius, z + Math.cos(angle) * radius) > 0.05) return true;
    }
    return false;
  }

  private ahead(x: number, z: number, camX: number, camZ: number, yaw: number): boolean {
    const dx = x - camX, dz = z - camZ;
    return -Math.sin(yaw) * dx - Math.cos(yaw) * dz > Math.hypot(dx, dz) * 0.72;
  }

  private clear(x: number, z: number, radius: number): boolean {
    if (!this.colliders) return true;
    this.colliders.query(x, z, radius, this.obstacles);
    const body = circle(x, z, radius);
    return !this.obstacles.some((c) => c.body && overlaps(body, c.body));
  }

  /** Prefer a few nearby habitats ahead of the player; retain seeded variation within that shortlist. */
  private choose(choices: Perch[], camX: number, camZ: number, yaw: number, occupied: readonly Perch[]): Perch | null {
    const score = (p: Perch) => Math.hypot(p.x - camX, p.z - camZ)
      + (this.ahead(p.x, p.z, camX, camZ, yaw) ? 0 : 20)
      + (p.flower ? -2 : 0) + (occupied.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 2) ? 8 : 0);
    choices.sort((a, b) => score(a) - score(b));
    if (!choices.length) return null;
    const best = score(choices[0]);
    return this.rng.pick(choices.filter((p) => score(p) <= best + 2));
  }

  update(dt: number, time: number, camX: number, camZ: number, state: GameState, camYaw = 0): void {
    const active = insectsSunlit(hourOf(state.totalHours), state.season?.id ?? null, state.weather?.id ?? null);
    this.refresh -= dt;
    if (this.refresh <= 0 || Math.cos(camYaw - this.facing) < 0.8 || Math.hypot(camX - this.camX, camZ - this.camZ) > 2) {
      this.refresh = 0.7;
      this.facing = camYaw;
      this.camX = camX; this.camZ = camZ;
      this.grid.query(camX, camZ, AMBIENT_RANGE.habitat, this.nearby);
      for (let i = this.nearby.length - 1; i >= 0; i--) if (Math.hypot(this.nearby[i].x - camX, this.nearby[i].z - camZ) > AMBIENT_RANGE.habitat) this.nearby.splice(i, 1);
      // Flying adults need habitat, not a flower at their initial position. Coordinate-seeded stations fill
      // gaps in the decorative flower/rock/log distribution without adding geometry or changing worldgen.
      const cell = 4, radius = AMBIENT_RANGE.wispHome;
      for (let ix = Math.floor((camX - radius) / cell); ix <= Math.floor((camX + radius) / cell); ix++) {
        for (let iz = Math.floor((camZ - radius) / cell); iz <= Math.floor((camZ + radius) / cell); iz++) {
          const x = (ix + 0.2 + hash2(ix, iz, state.seed) * 0.6) * cell;
          const z = (iz + 0.2 + hash2(iz, ix, state.seed ^ 0x6831) * 0.6) * cell;
          const distance = Math.hypot(x - camX, z - camZ), y = this.terrain.heightAt(x, z);
          if (distance < 3 || distance > radius || y < 0.2 || !this.terrain.inPlayBounds(x, z, 4) || this.terrain.slopeAt(x, z) > 0.5 || !this.clear(x, z, 0.2)) continue;
          this.nearby.push({ x, y, z, flower: false, water: this.nearWater(x, z), flightOnly: true });
        }
      }
    }
    const occupied: Perch[] = this.insects.flatMap((s) => s.insect ? [s.insect.home] : []);
    for (const slot of this.insects) {
      if (!active) { slot.rig.root.visible = false; slot.insect = null; slot.opacity = 0; slot.unseen = 0; continue; }
      const kind = slot.rig.root.userData.kind as InsectKind;
      if (slot.insect) {
        const a = slot.insect;
        const distant = Math.hypot(a.position.x - camX, a.position.z - camZ) > AMBIENT_RANGE.insectRetire;
        slot.unseen = !this.ahead(a.home.x, a.home.z, camX, camZ, camYaw) ? slot.unseen + dt : 0;
        if (distant) { slot.insect = null; slot.opacity = 0; slot.unseen = 0; }
        else if (slot.unseen > 2) {
          slot.opacity = Math.max(0, slot.opacity - dt);
          if (slot.opacity === 0) { slot.insect = null; slot.unseen = 0; }
        }
      }
      if (!slot.insect) {
        const choices = this.nearby.filter((p) => Math.hypot(p.x - camX, p.z - camZ) <= AMBIENT_RANGE.insectHome
          && Math.hypot(p.x - camX, p.z - camZ) >= 2 && (kind !== 'dragonfly' || p.water));
        const home = this.choose(choices, camX, camZ, camYaw, occupied);
        if (!home) { slot.rig.root.visible = false; continue; }
        occupied.push(home);
        slot.insect = createInsect(kind, home, this.rng);
      }
      const a = slot.insect;
      advanceInsect(a, Math.min(dt, 0.05), time, windUniforms.uWind.value, this.rng, this.nearby, this.terrain);
      if (slot.unseen <= 2) slot.opacity = Math.min(1, slot.opacity + dt * 0.7);
      const root = slot.rig.root;
      root.visible = true; root.position.copy(a.position); root.rotation.set(0, a.heading, a.bank);
      // Fade opacity while keeping the real insect dimensions constant.
      slot.bodyMat.opacity = slot.opacity;
      slot.wingMat.opacity = slot.opacity * 0.48;
      const landed = a.mode === 'feed' || a.mode === 'rest';
      const wing = kind === 'butterfly'
        ? (landed ? 0.9 + Math.sin(time * 0.8 + a.phase) * 0.15 : 0.35 + Math.sin(time * 38 + a.phase) * 0.85)
        : (landed ? 0.03 : Math.sin(time * 145 + a.phase) * 0.16);
      slot.rig.wings[0].rotation.z = -wing; slot.rig.wings[1].rotation.z = wing;
    }
    for (const w of this.wisps) {
      if (w.home) {
        const distant = Math.hypot(w.home.x - camX, w.home.z - camZ) > AMBIENT_RANGE.wispRetire;
        w.unseen = !this.ahead(w.home.x, w.home.z, camX, camZ, camYaw) ? w.unseen + dt : 0;
        if (distant) { w.home = null; w.opacity = 0; w.unseen = 0; }
        else if (w.unseen > 2) {
          w.opacity = Math.max(0, w.opacity - dt);
          if (w.opacity === 0) { w.home = null; w.unseen = 0; }
        }
      }
      if (!w.home) {
        const choices = this.nearby.filter((p) => !p.flower && p.flightOnly && this.clear(p.x, p.z, 1.5) && this.terrain.waterDepth(p.x, p.z) <= 0
          && this.terrain.field(p.x, p.z, 1) > 0.25 && Math.hypot(p.x - camX, p.z - camZ) > 5
          && Math.hypot(p.x - camX, p.z - camZ) <= AMBIENT_RANGE.wispHome);
        w.home = this.choose(choices, camX, camZ, camYaw, this.wisps.flatMap((o) => o.home ? [o.home] : []));
      }
      w.sprite.visible = !!w.home;
      if (!w.home) continue;
      if (w.unseen <= 2) w.opacity = Math.min(1, w.opacity + dt * 0.7);
      const x = w.home.x + Math.sin(time * 0.18 + w.phase) * 1.3, z = w.home.z + Math.cos(time * 0.14 + w.phase) * 1.1;
      w.sprite.position.set(x, Math.max(w.home.y, this.terrain.heightAt(x, z)) + 1.2 + Math.sin(time * 0.7 + w.phase) * 0.22, z);
      const distance = Math.hypot(x - camX, z - camZ);
      w.sprite.material.opacity = w.opacity * (0.25 + Math.sin(time * 0.9 + w.phase) * 0.045) * Math.min(1, Math.max(0, (18 - distance) / 4));
    }
  }

  dispose(): void {
    for (const slot of this.insects) {
      slot.rig.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      slot.bodyMat.dispose(); slot.wingMat.dispose();
    }
    for (const w of this.wisps) w.sprite.material.dispose();
    this.glow.dispose(); this.bodyMat.dispose(); this.wingMat.dispose(); this.grid.clear(); this.group.clear();
  }
}
