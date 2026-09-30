import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import type { ItemId } from '../src/data/items';
import type { PrefabId } from '../src/data/prefabs';
import { RECIPE_BY_ID } from '../src/data/recipes';
import { nextShelter, SHELTER_TIERS, SHELTER_UPGRADES } from '../src/data/upgrades';
import type { AnimalEnv } from '../src/sim/animals';
import type { Collider } from '../src/sim/colliders';
import type { SimEvent } from '../src/sim/events';
import type { MoveEnv } from '../src/sim/movement';
import { checkPlacement } from '../src/sim/placement';
import { IDLE_INPUT, Simulation, type SimInput } from '../src/sim/simulation';
import type { DamageSource, StructureState } from '../src/sim/state';
import { PLAY_HALF, type Terrain } from '../src/sim/terrain';

export const SEED = 42;

/** A new game with no animals so tests are not disturbed by wildlife. */
export function quietSim(seed = SEED): Simulation {
  const sim = Simulation.newGame(seed);
  sim.state.animals.length = 0;
  return sim;
}

export function input(partial: Partial<SimInput> = {}, sim?: Simulation): SimInput {
  return { ...IDLE_INPUT, yaw: sim?.state.player.yaw ?? 0, pitch: sim?.state.player.pitch ?? 0, ...partial };
}

export function run(sim: Simulation, seconds: number, inp: Partial<SimInput> = {}, dt = 1 / 60): SimEvent[] {
  const all: SimEvent[] = [];
  const buf: SimEvent[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    sim.step(dt, input(inp, sim));
    sim.takeEvents(buf);
    all.push(...buf);
  }
  return all;
}

export function drain(sim: Simulation): SimEvent[] {
  return sim.takeEvents([]);
}

export function give(sim: Simulation, items: Partial<Record<ItemId, number>>): void {
  for (const [item, n] of Object.entries(items)) sim.devGive(item as ItemId, n!);
  drain(sim);
}

/** Find a spot near the player where a prefab can be placed. */
export function findValidSpot(sim: Simulation, prefab: Parameters<typeof checkPlacement>[1], rot = sim.placement?.rot ?? 0): { x: number; z: number } {
  const p = sim.state.player;
  const env = sim.placementEnv();
  for (let r = 2; r < 7; r += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (checkPlacement(env, prefab, x, z, rot).valid) return { x, z };
    }
  }
  throw new Error('no valid spot found');
}

export function nearestResource(sim: Simulation, kind: string): number {
  const p = sim.state.player;
  let best = -1;
  let bd = Infinity;
  sim.gen.resources.forEach((r, i) => {
    if (r.kind !== kind) return;
    const d = Math.hypot(r.x - p.x, r.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Nearest standing tree (optionally of one species). */
export function nearestTree(sim: Simulation, species?: string): number {
  const p = sim.state.player;
  let best = -1;
  let bd = Infinity;
  sim.gen.trees.forEach((t, i) => {
    if ((species && t.species !== species) || sim.state.trees[i].felled) return;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** A recipe's ingredients as a `give` map. */
export function recipeInputs(recipe: string): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const i of RECIPE_BY_ID[recipe].inputs) out[i.item] = (out[i.item] ?? 0) + i.count;
  return out;
}

/** Give exactly what `recipe` needs. */
export function giveRecipe(sim: Simulation, recipe: string): void {
  give(sim, recipeInputs(recipe));
}

/**
 * Builds `recipe` from freshly given ingredients without draining events; whatever the pack held beforehand is set
 * aside and put back, since the bigger structures fill a starting pack on their own.
 */
export function buildFresh(sim: Simulation, recipe: 'campfire' | 'leanTo' | 'bench'): StructureState {
  if (!sim.state.known.includes(recipe)) sim.state.known.push(recipe);
  const inv = sim.state.inventory;
  const held = inv.slots.slice();
  inv.slots.fill(null);
  giveRecipe(sim, recipe);
  sim.beginPlacement(recipe);
  const spot = findValidSpot(sim, recipe);
  sim.setPlacementAt(spot.x, spot.z);
  if (!sim.confirmPlacement()) throw new Error(`could not place ${recipe}`);
  held.forEach((s, i) => (inv.slots[i] = s));
  return sim.state.structures[sim.state.structures.length - 1];
}

/** Like `buildFresh`, then drains the events. */
export function placeStructure(sim: Simulation, recipe: 'campfire' | 'leanTo' | 'bench'): StructureState {
  const s = buildFresh(sim, recipe);
  drain(sim);
  return s;
}

/**
 * A shelter of any tier: builds a lean-to where a hide tent (the biggest footprint) also fits, then upgrades it in
 * place with freshly given materials, setting the pack aside as `buildFresh` does. Drains the events.
 */
export function placeShelter(sim: Simulation, tier: PrefabId): StructureState {
  if (!sim.state.known.includes('leanTo')) sim.state.known.push('leanTo');
  const inv = sim.state.inventory;
  const held = inv.slots.slice();
  const gear = sim.state.gear.slice();
  if (!sim.state.gear.includes('basket')) sim.state.gear.push('basket');
  ensureSlots(sim);
  inv.slots.fill(null);
  giveRecipe(sim, 'leanTo');
  sim.beginPlacement('leanTo');
  const rot = sim.placement!.rot;
  const env = sim.placementEnv();
  const p = sim.state.player;
  let spot: { x: number; z: number } | null = null;
  for (let r = 3; r < 9 && !spot; r += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (SHELTER_TIERS.every((t) => checkPlacement(env, t, x, z, rot).valid)) {
        spot = { x, z };
        break;
      }
    }
  }
  if (!spot) throw new Error('no spot for a shelter of every tier');
  sim.setPlacementAt(spot.x, spot.z);
  if (!sim.confirmPlacement()) throw new Error('could not place leanTo');
  const st = sim.state.structures[sim.state.structures.length - 1];
  while (st.prefab !== tier) {
    const next = nextShelter(st.prefab);
    if (!next) throw new Error(`${tier} is not a shelter tier`);
    inv.slots.fill(null);
    give(sim, Object.fromEntries(SHELTER_UPGRADES[next]!.map((i) => [i.item, i.count])));
    const res = sim.upgradeShelter(st.id);
    if (!res.ok) throw new Error(`could not upgrade to ${next}: ${res.reason}`);
  }
  inv.slots.fill(null);
  sim.state.gear = gear;
  ensureSlots(sim);
  held.forEach((s, i) => (inv.slots[i] = s));
  drain(sim);
  return st;
}

/** Match the pack's slot count to the carried gear. */
function ensureSlots(sim: Simulation): void {
  const c = BALANCE.carry;
  const want = c.baseSlots + (sim.state.gear.includes('basket') ? c.basketSlots : 0) + (sim.state.gear.includes('backpack') ? c.backpackSlots : 0);
  const slots = sim.state.inventory.slots;
  while (slots.length < want) slots.push(null);
  if (slots.length > want) slots.length = want;
}

/** Aim the camera at a world point. */
export function aimAt(sim: Simulation, x: number, y: number, z: number): void {
  const p = sim.state.player;
  const dx = x - p.x;
  const dy = y - (p.y + BALANCE.player.eyeHeight);
  const dz = z - p.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

export function keepAlive(sim: Simulation): void {
  Object.assign(sim.state.needs, { hunger: 100, thirst: 100, warmth: 100, health: 100, energy: 100 });
}

/** Move the player (teleport) to a location on the ground. */
export function teleport(sim: Simulation, x: number, z: number): void {
  const p = sim.state.player;
  p.x = x;
  p.z = z;
  p.y = sim.terrain.heightAt(x, z);
  p.vx = p.vy = p.vz = 0;
  p.grounded = true;
}

/**
 * Minimal analytic terrain for deterministic physics/AI tests.
 * `height(x, z)` defines the ground; negative means water.
 */
export function fakeTerrain(height: (x: number, z: number) => number): Terrain {
  const t = {
    lakes: [{ x: 60, z: 0, r: 10, depth: 3, phase: 0 }],
    heightAt: height,
    waterDepth: (x: number, z: number) => Math.max(0, -height(x, z)),
    slopeAt: (x: number, z: number) => {
      const e = 0.5;
      const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      return Math.hypot(dx, dz);
    },
    inPlayBounds: (x: number, z: number, margin = 0) => Math.abs(x) <= PLAY_HALF - margin && Math.abs(z) <= PLAY_HALF - margin,
  };
  return t as unknown as Terrain;
}

export function colliderQuery(colliders: Collider[]): MoveEnv['query'] {
  return (_x, _z, _r, out) => {
    out.length = 0;
    out.push(...colliders);
    return out;
  };
}

export interface FakeAnimalEnv extends AnimalEnv {
  hurts: { amount: number; source: DamageSource }[];
}

export function animalEnv(terrain: Terrain, overrides: Partial<AnimalEnv> = {}): FakeAnimalEnv {
  const hurts: { amount: number; source: DamageSource }[] = [];
  const env: FakeAnimalEnv = {
    terrain,
    rng: new Rng(7),
    query: colliderQuery([]),
    playerX: 0,
    playerZ: 0,
    playerNoise: 1,
    playerDead: false,
    playerDeterrent: false,
    litFires: [],
    night: false,
    events: [],
    hurtPlayer(amount, source) {
      hurts.push({ amount, source });
    },
    hurts,
    ...overrides,
  };
  return env;
}
