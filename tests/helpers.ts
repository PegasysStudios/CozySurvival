import { Rng } from '../src/core/rng';
import type { ItemId } from '../src/data/items';
import type { AnimalEnv } from '../src/sim/animals';
import type { Collider } from '../src/sim/colliders';
import type { SimEvent } from '../src/sim/events';
import type { MoveEnv } from '../src/sim/movement';
import { checkPlacement } from '../src/sim/placement';
import { IDLE_INPUT, Simulation, type SimInput } from '../src/sim/simulation';
import type { DamageSource } from '../src/sim/state';
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
export function findValidSpot(sim: Simulation, prefab: Parameters<typeof checkPlacement>[1], rot = 0): { x: number; z: number } {
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
