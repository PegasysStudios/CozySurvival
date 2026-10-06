import * as THREE from 'three';
import { damp } from '../core/math';
import type { ItemId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { SPECIES, SQUIRREL_CLIMB, type SpeciesId } from '../data/species';
import type { Simulation } from '../sim/simulation';
import type { AnimalState, GameState } from '../sim/state';
import { WATER_LEVEL, type Terrain } from '../sim/terrain';
import { buildRig, type Rig } from './creatures';
import { arrowGeometry, dropGeometry, flameGeometry, structureGeometry } from './props';

interface AnimalView {
  rig: Rig;
  species: SpeciesId;
  phase: number;
  headPitch: number;
  rear: number;
  crouch: number;
  stamp: number;
}

interface StructureView {
  id: number;
  prefab: PrefabId;
  group: THREE.Group;
  flames: THREE.Mesh | null;
  x: number;
  y: number;
  z: number;
}

const STRIDE: Record<SpeciesId, number> = {
  squirrel: 7,
  rabbit: 3.4, deer: 2.3, fish: 0, wolf: 2.7, bear: 2.1,
  jackrabbit: 3.0, javelina: 3.6, quail: 7.5, roadrunner: 5.2, lizard: 9, snake: 3.2, cougar: 2.5, scorpion: 10,
  boar: 3.2, goat: 2.8, junglefowl: 7, crab: 11, viper: 3, reefFish: 0, jellyfish: 0, shark: 0,
};
const PIVOT_Y: Record<SpeciesId, number> = {
  squirrel: 0.08,
  rabbit: 0.15, deer: 0.95, fish: 0, wolf: 0.6, bear: 0.62,
  jackrabbit: 0.2, javelina: 0.3, quail: 0.07, roadrunner: 0.2, lizard: 0.05, snake: 0.045, cougar: 0.58, scorpion: 0.05,
  boar: 0.36, goat: 0.56, junglefowl: 0.12, crab: 0.08, viper: 0.048, reefFish: 0, jellyfish: 0, shark: 0,
};
/** How far below the surface each swimmer rides (the shark's fin breaks the water). */
const SWIM_DEPTH: Partial<Record<SpeciesId, number>> = { fish: 0.32, reefFish: 0.4, jellyfish: 0.34, shark: 0.62 };
/** How far a burrowing scorpion sinks, below its own height. */
const BURROW_DEPTH = 0.14;
const HOPPERS = new Set<SpeciesId>(['rabbit', 'jackrabbit']);
/** Chained, legless bodies posed by `poseSnake`; the rattlesnake's tail buzzes, the fer-de-lance's doesn't. */
const RATTLES = new Set<SpeciesId>(['snake']);
const VIEW_DIST = 110;
const FISH_VIEW = 45;
const FIRE_LIGHTS = 2;

export class EntityView {
  readonly group = new THREE.Group();
  readonly fireLights: THREE.PointLight[] = [];
  private readonly terrain: Terrain;
  private readonly frozen: boolean;
  private readonly animalMat: THREE.MeshLambertMaterial;
  private readonly propMat: THREE.MeshLambertMaterial;
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly animals = new Map<number, AnimalView>();
  private readonly structures = new Map<number, StructureView>();
  private readonly drops = new Map<number, THREE.Mesh>();
  private readonly carcasses = new Map<number, { root: THREE.Group; skinned: boolean }>();
  private readonly structureGeos = new Map<PrefabId, THREE.BufferGeometry>();
  private readonly dropGeos = new Map<ItemId, THREE.BufferGeometry>();
  private readonly flameGeo = flameGeometry();
  private readonly arrowGeo = arrowGeometry();
  private readonly arrows: THREE.Mesh[] = [];
  private readonly litFires: StructureView[] = [];
  private stamp = 0;
  private readonly look = new THREE.Vector3();
  private readonly seen = new Set<number>();

  constructor(terrain: Terrain, frozen = false) {
    this.terrain = terrain;
    this.frozen = terrain.biome === 'pnw' && frozen;
    this.animalMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = new THREE.PointLight('#ff9a4d', 0, 18, 1.6);
      l.position.set(0, -100, 0);
      this.fireLights.push(l);
      this.group.add(l);
    }
  }

  private structureGeo(prefab: PrefabId): THREE.BufferGeometry {
    let g = this.structureGeos.get(prefab);
    if (!g) this.structureGeos.set(prefab, (g = structureGeometry(prefab)));
    return g;
  }

  private dropGeo(item: ItemId): THREE.BufferGeometry {
    let g = this.dropGeos.get(item);
    if (!g) this.dropGeos.set(item, (g = dropGeometry(item)));
    return g;
  }

  /** Add/remove views for structures, drops and carcasses (called when the world version changes). */
  sync(state: GameState): void {
    this.seen.clear();
    for (const st of state.structures) {
      this.seen.add(st.id);
      let v = this.structures.get(st.id);
      if (!v) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(this.structureGeo(st.prefab), this.propMat);
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData.cameraObstacle = true;
        group.add(body);
        let flames: THREE.Mesh | null = null;
        if (PREFABS[st.prefab].fire) {
          flames = new THREE.Mesh(this.flameGeo, this.flameMat);
          flames.position.y = 0.08;
          group.add(flames);
        }
        group.position.set(st.x, st.y, st.z);
        group.rotation.y = st.rot;
        this.group.add(group);
        v = { id: st.id, prefab: st.prefab, group, flames, x: st.x, y: st.y, z: st.z };
        this.structures.set(st.id, v);
      } else if (v.prefab !== st.prefab) {
        (v.group.children[0] as THREE.Mesh).geometry = this.structureGeo(st.prefab);
        v.prefab = st.prefab;
      }
      if (v.flames) v.flames.visible = st.fuel > 0;
    }
    for (const [id, v] of this.structures) {
      if (!this.seen.has(id)) {
        this.group.remove(v.group);
        this.structures.delete(id);
      }
    }
    this.litFires.length = 0;
    for (const v of this.structures.values()) if (v.flames?.visible) this.litFires.push(v);

    this.seen.clear();
    for (const d of state.drops) {
      this.seen.add(d.id);
      if (this.drops.has(d.id)) continue;
      const m = new THREE.Mesh(this.dropGeo(d.item), this.propMat);
      m.castShadow = true;
      m.position.set(d.x, d.y, d.z);
      m.rotation.y = d.id * 1.7;
      m.userData.baseY = d.y;
      this.drops.set(d.id, m);
      this.group.add(m);
    }
    for (const [id, m] of this.drops) {
      if (!this.seen.has(id)) {
        this.group.remove(m);
        this.drops.delete(id);
      }
    }

    this.seen.clear();
    for (const c of state.carcasses) {
      this.seen.add(c.id);
      const skinned = !!c.skinned;
      const old = this.carcasses.get(c.id);
      if (old?.skinned === skinned) continue;
      // Skinning swaps the dead animal for its skinned model where it lies.
      if (old) this.group.remove(old.root);
      const rig = buildRig(c.species, c.species === 'rabbit' && this.frozen ? 1 : 0, this.animalMat, skinned);
      const def = SPECIES[c.species];
      rig.pivot.rotation.z = Math.PI / 2 - 0.08;
      rig.pivot.position.y = def.radius * (skinned ? 0.68 : 0.8);
      for (const l of rig.legs) l.mesh.rotation.x = 0.25;
      rig.head.rotation.x = 0.3;
      rig.root.position.set(c.x, this.terrain.heightAt(c.x, c.z), c.z);
      rig.root.rotation.y = c.rot;
      this.carcasses.set(c.id, { root: rig.root, skinned });
      this.group.add(rig.root);
    }
    for (const [id, v] of this.carcasses) {
      if (!this.seen.has(id)) {
        this.group.remove(v.root);
        this.carcasses.delete(id);
      }
    }
  }

  structureView(id: number): StructureView | undefined {
    return this.structures.get(id);
  }

  /** Lit campfires, for effects and audio. */
  get fires(): readonly { x: number; y: number; z: number }[] {
    return this.litFires;
  }

  update(sim: Simulation, dt: number, time: number, camX: number, camZ: number): void {
    this.stamp++;
    const state = sim.state;
    for (let i = 0; i < state.animals.length; i++) this.updateAnimal(state.animals[i], dt, time, camX, camZ);
    for (const [id, v] of this.animals) {
      if (v.stamp !== this.stamp) {
        this.group.remove(v.rig.root);
        this.animals.delete(id);
      }
    }
    for (const m of this.drops.values()) {
      m.position.y = m.userData.baseY + 0.06 + Math.sin(time * 2.2 + m.rotation.y) * 0.04;
      m.rotation.y += dt * 0.6;
    }
    // flames + nearest fire lights
    for (const v of this.litFires) {
      if (!v.flames) continue;
      const f = Math.sin(time * 11 + v.id) * 0.08 + Math.sin(time * 17.3 + v.id * 3) * 0.06;
      v.flames.scale.set(1 + f * 0.5, 0.9 + f + Math.sin(time * 5 + v.id) * 0.08, 1 + f * 0.5);
      v.flames.rotation.y = time * 0.7;
    }
    for (let li = 0; li < FIRE_LIGHTS; li++) {
      let best: StructureView | null = null;
      let bestD = Infinity;
      for (const v of this.litFires) {
        const d = (v.x - camX) * (v.x - camX) + (v.z - camZ) * (v.z - camZ);
        if (d < bestD && (li === 0 || v !== this.fireLights[0].userData.src)) {
          bestD = d;
          best = v;
        }
      }
      const l = this.fireLights[li];
      l.userData.src = best;
      if (best && bestD < 70 * 70) {
        l.position.set(best.x, best.y + 0.9, best.z);
        l.intensity = 14 + Math.sin(time * 13 + li) * 2.2 + Math.sin(time * 7.1) * 1.6;
      } else {
        l.intensity = 0;
      }
    }
    // arrows in flight
    const pr = sim.projectiles;
    while (this.arrows.length < pr.length) {
      const m = new THREE.Mesh(this.arrowGeo, this.propMat);
      m.userData.cameraIgnore = true;
      this.arrows.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < this.arrows.length; i++) {
      const m = this.arrows[i];
      if (i >= pr.length) {
        m.visible = false;
        continue;
      }
      const p = pr[i];
      m.visible = true;
      m.position.set(p.x, p.y, p.z);
      this.look.set(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      m.lookAt(this.look);
    }
  }

  private updateAnimal(a: AnimalState, dt: number, time: number, camX: number, camZ: number): void {
    let v = this.animals.get(a.id);
    if (!v) {
      const rig = buildRig(a.species, a.species === 'deer' ? a.id % 2 : a.species === 'rabbit' && this.frozen ? 1 : 0, this.animalMat);
      v = { rig, species: a.species, phase: a.id, headPitch: 0, rear: 0, crouch: 0, stamp: 0 };
      this.animals.set(a.id, v);
      this.group.add(rig.root);
    }
    v.stamp = this.stamp;
    const dx = a.x - camX;
    const dz = a.z - camZ;
    const d2 = dx * dx + dz * dz;
    const def = SPECIES[a.species];
    const swims = def.habitat === 'water';
    const lim = swims && a.species !== 'shark' ? FISH_VIEW : VIEW_DIST;
    const root = v.rig.root;
    root.visible = d2 < lim * lim && !(a.species === 'squirrel' && a.mode === 'hide');
    if (!root.visible) return;
    root.position.set(a.x, swims ? WATER_LEVEL - (SWIM_DEPTH[a.species] ?? 0.32) : a.y, a.z);
    const climbing = a.species === 'squirrel' && (a.mode === 'climb' || a.mode === 'descend');
    root.rotation.set(climbing ? (a.mode === 'descend' ? Math.PI / 2 : -Math.PI / 2) : 0, a.heading + (climbing && a.mode === 'descend' ? Math.PI : 0), 0, 'YXZ');
    const speed = climbing ? (a.mode === 'descend' ? SQUIRREL_CLIMB.down : SQUIRREL_CLIMB.up) : a.speed;

    if (a.species === 'jellyfish') {
      // The bell pulses and the whole jelly bobs gently.
      v.phase += dt * 2.2;
      const pulse = Math.sin(v.phase * 2);
      v.rig.pivot.scale.set(1 + pulse * 0.08, 1 - pulse * 0.1, 1 + pulse * 0.08);
      root.position.y += Math.sin(v.phase * 0.7 + a.id) * 0.05;
      if (v.rig.tail) v.rig.tail.rotation.x = Math.sin(v.phase * 1.3) * 0.12;
      return;
    }
    if (swims) {
      const slow = a.species === 'shark' ? 0.45 : 1;
      v.phase += dt * (4 + speed * 6) * slow;
      if (v.rig.tail) v.rig.tail.rotation.y = Math.sin(v.phase * 2.2) * (0.35 + speed * 0.15) * (a.species === 'shark' ? 0.6 : 1);
      v.rig.pivot.rotation.y = Math.sin(v.phase * 2.2 + 1) * 0.08;
      return;
    }

    v.phase += dt * speed * STRIDE[a.species];
    const moveK = Math.min(1, speed / Math.max(0.5, def.walkSpeed));
    const amp = Math.min(0.75, 0.25 + speed * 0.08) * moveK;
    if (v.rig.chain) {
      this.poseSnake(v, a, dt, time);
      return;
    }
    if (a.species === 'squirrel') {
      const bound = climbing ? 0 : Math.max(0, Math.sin(v.phase)) * Math.min(0.075, speed * 0.014);
      v.rig.pivot.position.y = PIVOT_Y.squirrel + bound;
      for (const l of v.rig.legs) l.mesh.rotation.x = Math.cos(v.phase + l.phase) * amp;
    } else if (HOPPERS.has(a.species)) {
      const hop = Math.max(0, Math.sin(v.phase)) * Math.min(1, speed / 1.5);
      v.rig.pivot.position.y = PIVOT_Y[a.species] + hop * (speed > 3 ? 0.22 : 0.08);
      for (let i = 0; i < v.rig.legs.length; i++) v.rig.legs[i].mesh.rotation.x = (i < 2 ? -1 : 1) * Math.cos(v.phase) * 0.7 * moveK;
    } else {
      for (const l of v.rig.legs) l.mesh.rotation.x = Math.sin(v.phase + l.phase) * amp;
    }
    let headTarget = 0;
    let rearTarget = 0;
    let crouchTarget = 0;
    if (a.mode === 'alert' || a.mode === 'warn') headTarget = -0.3;
    else if (a.mode === 'stalk') {
      headTarget = 0.3;
      crouchTarget = 1;
    } else if ((a.mode === 'idle') && def.kind === 'prey' && Math.sin(time * 0.35 + a.id * 1.3) > 0.1) headTarget = 0.85;
    if (a.species === 'bear' && a.mode === 'warn') rearTarget = 1;
    if (a.mode === 'attack') rearTarget = a.species === 'bear' ? 0.5 : 0.25;
    const pest = def.kind === 'pest';
    if (pest && a.mode === 'retreat') crouchTarget = BURROW_DEPTH / 0.1;
    if (a.species === 'javelina' && a.mode === 'chase') headTarget = 0.35;
    v.headPitch = damp(v.headPitch, headTarget, 5, dt);
    v.rear = damp(v.rear, rearTarget, 6, dt);
    v.crouch = damp(v.crouch, crouchTarget, 4, dt);
    v.rig.head.rotation.x = v.headPitch;
    const rearAngle = a.species === 'bear' ? -0.95 : -0.35;
    v.rig.pivot.rotation.x = v.rear * rearAngle;
    if (!HOPPERS.has(a.species) && a.species !== 'squirrel') v.rig.pivot.position.y = PIVOT_Y[a.species] - v.crouch * 0.1;
    if (v.rig.tail) v.rig.tail.rotation.x = 0.3 + Math.sin(time * (pest && a.mode !== 'retreat' ? 11 : 3) + a.id) * 0.08 + (a.mode === 'flee' ? -0.8 : 0);
    const hurt = a.hurt > 0 ? Math.sin((0.35 - a.hurt) * 30) * a.hurt * 0.4 : 0;
    root.scale.set(1 + hurt, 1 - hurt, 1 + hurt);
  }

  /**
   * A snake's segments are chained head to tail: travelling S-waves while it moves, a tight coil with the head raised
   * and the rattle buzzing while it is alert.
   */
  private poseSnake(v: AnimalView, a: AnimalState, dt: number, time: number): void {
    const rig = v.rig;
    const coiled = a.mode === 'alert' ? 1 : 0;
    v.crouch = damp(v.crouch, coiled, 4, dt);
    v.phase += dt * (1.2 + a.speed * 5);
    const wave = 0.18 + Math.min(1, a.speed) * 0.32;
    let x = 0;
    let z = 0;
    let heading = 0;
    for (let i = 0; i < rig.legs.length; i++) {
      const seg = rig.legs[i];
      const slither = Math.sin(v.phase - seg.phase) * wave;
      const turn = i === 0 ? slither : slither - Math.sin(v.phase - rig.legs[i - 1].phase) * wave;
      heading += turn * (1 - v.crouch) + (i === 0 ? 0.6 : 0.95) * v.crouch;
      seg.mesh.position.set(x, 0, z);
      seg.mesh.rotation.set(0, heading, i === rig.legs.length - 1 && RATTLES.has(a.species) ? Math.sin(time * 60) * 0.35 * v.crouch : 0);
      x -= Math.sin(heading) * rig.chain;
      z -= Math.cos(heading) * rig.chain;
    }
    rig.pivot.position.y = PIVOT_Y[a.species];
    rig.head.position.y = 0.005 + v.crouch * 0.16;
    rig.head.rotation.x = -v.crouch * 0.3;
    rig.head.rotation.y = Math.sin(v.phase) * 0.2 * (1 - v.crouch);
    const hurt = a.hurt > 0 ? Math.sin((0.35 - a.hurt) * 30) * a.hurt * 0.4 : 0;
    rig.root.scale.set(1 + hurt, 1 - hurt, 1 + hurt);
  }

  dispose(): void {
    for (const g of this.structureGeos.values()) g.dispose();
    for (const g of this.dropGeos.values()) g.dispose();
    this.flameGeo.dispose();
    this.arrowGeo.dispose();
    this.animalMat.dispose();
    this.propMat.dispose();
    this.flameMat.dispose();
  }
}
