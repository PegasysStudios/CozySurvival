import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { createPlayer, stepPlayer, type MoveEnv } from '../src/sim/movement';
import { seatHeight } from '../src/sim/placement';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { STATE_VERSION } from '../src/sim/state';
import { getTerrain, POOL_SHAPE, WATER_LEVEL, type Lake, type Terrain } from '../src/sim/terrain';
import { getWorldGen } from '../src/sim/worldgen';
import { run } from './helpers';

const SEEDS = Array.from({ length: 40 }, (_, i) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);
const WALK_SEEDS = SEEDS.slice(0, 8);
const RAYS = 24;
const P = BALANCE.player;

/** Distance from the pool's centre to its waterline along one bearing. */
function shoreAlong(t: Terrain, l: Lake, a: number): number {
  for (let d = 0; d < l.r * 3; d += 0.1) if (t.heightAt(l.x + Math.cos(a) * d, l.z + Math.sin(a) * d) > WATER_LEVEL) return d;
  return Infinity;
}

/** The steepest rise, walking outward, between `from` and `to` metres from the pool's centre. */
function steepest(t: Terrain, l: Lake, a: number, from: number, to: number): number {
  let worst = 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let d = from; d < to; d += 0.25) worst = Math.max(worst, (t.heightAt(l.x + c * (d + 0.25), l.z + s * (d + 0.25)) - t.heightAt(l.x + c * d, l.z + s * d)) / 0.25);
  return worst;
}

/** Square metres under water within reach of the pool, sampled every half metre. */
function waterArea(t: Terrain, l: Lake): number {
  let n = 0;
  const reach = l.r * 1.8;
  for (let x = -reach; x <= reach; x += 0.5) for (let z = -reach; z <= reach; z += 0.5) if (t.heightAt(l.x + x, l.z + z) < WATER_LEVEL) n++;
  return n * 0.25;
}

const bare = (t: Terrain): MoveEnv => ({ terrain: t, query: (_x, _z, _r, out) => ((out.length = 0), out) });

describe('shallow desert pools (round 9)', () => {
  it('every pool is a shallow basin: the water fills it to about its radius and the bank sits just above the water', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'desert');
      for (const l of t.lakes) {
        const banks: number[] = [];
        for (let k = 0; k < RAYS; k++) {
          const a = (k / RAYS) * Math.PI * 2;
          const shore = shoreAlong(t, l, a);
          const tag = `seed ${seed} ${l.kind} bearing ${k}`;
          expect(shore / l.r, tag).toBeGreaterThan(0.75);
          expect(shore / l.r, tag).toBeLessThan(1.25);
          const bank = t.heightAt(l.x + Math.cos(a) * (shore + 3), l.z + Math.sin(a) * (shore + 3));
          expect(bank, `${tag}: 3 m up the bank`).toBeLessThan(1.7);
          banks.push(bank);
        }
        expect(banks.reduce((a, b) => a + b, 0) / RAYS, `seed ${seed} ${l.kind}`).toBeLessThan(1.35);
      }
    }
  });

  it('no crater walls: from 4 m out in the water to 8 m up the bank, the ground never rises steeper than you can walk', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'desert');
      for (const l of t.lakes) {
        for (let k = 0; k < RAYS; k++) {
          const a = (k / RAYS) * Math.PI * 2;
          const shore = shoreAlong(t, l, a);
          expect(steepest(t, l, a, Math.max(0, shore - 4), shore + 8), `seed ${seed} ${l.kind} bearing ${k}`).toBeLessThan(P.maxSlope * 0.9);
        }
      }
    }
  });

  it('the banks are as gentle as the Pacific Northwest lakeshores', () => {
    const bankAt = (t: Terrain, l: Lake) => {
      let sum = 0;
      for (let k = 0; k < RAYS; k++) {
        const a = (k / RAYS) * Math.PI * 2;
        const d = shoreAlong(t, l, a) + 3;
        sum += t.heightAt(l.x + Math.cos(a) * d, l.z + Math.sin(a) * d);
      }
      return sum / RAYS;
    };
    for (const seed of SEEDS.slice(0, 10)) {
      const pnw = getTerrain(seed, 'pnw');
      const woods = Math.max(...pnw.lakes.map((l) => bankAt(pnw, l)));
      const desert = getTerrain(seed, 'desert');
      for (const l of desert.lakes) expect(bankAt(desert, l), `seed ${seed} ${l.kind}`).toBeLessThanOrEqual(woods + 0.1);
    }
  });

  it('you can walk straight from the plain into every pool and back out, from any side', () => {
    const opts = { canSprint: true, exhausted: false };
    for (const seed of WALK_SEEDS) {
      const t = getTerrain(seed, 'desert');
      for (const l of t.lakes) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const start = l.r * 1.1 + 12;
          const x = l.x + Math.cos(a) * start;
          const z = l.z + Math.sin(a) * start;
          const p = createPlayer(x, t.heightAt(x, z), z, 0);
          const inward = Math.atan2(Math.cos(a), Math.sin(a));
          const dist = () => Math.hypot(p.x - l.x, p.z - l.z);
          const walk = (yaw: number, done: () => boolean) => {
            for (let i = 0; i < 60 * 20 && !done(); i++) stepPlayer(p, { moveX: 0, moveZ: 1, jumpPressed: false, sprint: false, yaw }, bare(t), 1 / 60, opts);
            return done();
          };
          const tag = `seed ${seed} ${l.kind} from bearing ${k}`;
          expect(walk(inward, () => dist() < l.r * 0.4), `${tag}: reaches the middle`).toBe(true);
          expect(walk(inward + Math.PI, () => dist() > start), `${tag}: walks back out`).toBe(true);
          expect(p.swimming || p.wading, tag).toBe(false);
        }
      }
    }
  });

  it('the spring keeps deep enough water for its trout, and the drinkable pools hold water at their centre', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'desert');
      const spring = t.lakes.find((l) => l.kind === 'spring')!;
      let fishWater = 0;
      for (let x = -spring.r; x <= spring.r; x += 0.5) for (let z = -spring.r; z <= spring.r; z += 0.5) if (t.waterDepth(spring.x + x, spring.z + z) > 0.6) fishWater++;
      expect(fishWater * 0.25, `seed ${seed}`).toBeGreaterThan(40);
      for (const l of t.lakes.filter((w) => w.kind !== 'alkali')) expect(t.heightAt(l.x, l.z), `seed ${seed} ${l.kind}`).toBeLessThan(-0.8);
      const alkali = t.lakes.find((l) => l.kind === 'alkali')!;
      expect(t.heightAt(alkali.x, alkali.z), `seed ${seed} alkali is a shallow pan`).toBeGreaterThan(-POOL_SHAPE.alkali.depth - 0.35);
    }
  });

  it('each pool holds less water than the smallest Pacific Northwest lake, and all of them together a small fraction', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const d = getTerrain(seed, 'desert');
      const p = getTerrain(seed, 'pnw');
      const woods = p.lakes.map((l) => waterArea(p, l));
      const pools = d.lakes.map((l) => waterArea(d, l));
      expect(Math.max(...pools), `seed ${seed}`).toBeLessThan(Math.min(...woods) * 0.6);
      expect(pools.reduce((a, b) => a + b, 0) / woods.reduce((a, b) => a + b, 0), `seed ${seed}`).toBeLessThan(0.16);
    }
  });

  it('the Pacific Northwest lakes keep their old shape', () => {
    const t = getTerrain(42, 'pnw');
    for (const l of t.lakes) {
      expect(l.kind).toBeUndefined();
      expect(t.heightAt(l.x, l.z)).toBeLessThan(-2);
    }
  });
});

describe('saves from before the round 9 desert', () => {
  function versionFour(sim: Simulation, mutate: (raw: Record<string, unknown> & { trees: number[][]; resources: number[][] }) => void = () => {}): string {
    const raw = JSON.parse(serializeState(sim.state)) as Record<string, unknown> & { trees: number[][]; resources: number[][] };
    raw.version = 4;
    mutate(raw);
    return JSON.stringify(raw);
  }

  it('an old desert save loads with fresh trees and plants, even if it names a tree the new desert lacks', () => {
    const sim = Simulation.newGame(42, 'desert');
    sim.state.trees[0] = { ...sim.state.trees[0], felled: true, hp: 0 };
    sim.state.resources[0] = { ...sim.state.resources[0], charges: 0, respawnAt: 99 };
    const json = versionFour(sim, (raw) => raw.trees.push([sim.state.trees.length + 500, 0, 1, 0, 0, 0, 0, 0]));
    const loaded = deserializeState(json)!;
    expect(loaded).not.toBeNull();
    expect(loaded.version).toBe(STATE_VERSION);
    const fresh = Simulation.newGame(42, 'desert').state;
    expect(loaded.trees).toEqual(fresh.trees);
    expect(loaded.resources).toEqual(fresh.resources);
    expect(loaded.trees).toHaveLength(getWorldGen(42, 'desert').trees.length);
    expect(() => run(new Simulation(loaded), 1)).not.toThrow();
  });

  it('structures, drops and carcasses settle onto the new desert ground', () => {
    const sim = Simulation.newGame(42, 'desert');
    const t = sim.terrain;
    const spring = t.lakes.find((l) => l.kind === 'spring')!;
    const bx = spring.x + spring.r * 1.6;
    const bz = spring.z;
    sim.state.structures.push({ id: 900, prefab: 'campfire', x: bx, y: 3.2, z: bz, rot: 0.4, fuel: 0 });
    sim.state.drops.push({ id: 901, item: 'stone', count: 2, x: bx + 2, y: 4, z: bz });
    sim.state.carcasses.push({ id: 902, species: 'jackrabbit', x: bx - 1, y: 5, z: bz + 2, rot: 0, remaining: [], expiresAt: 999 });
    const loaded = deserializeState(versionFour(sim))!;
    const fire = loaded.structures.find((s) => s.id === 900)!;
    expect(fire.y).toBeCloseTo(seatHeight(t, 'campfire', bx, bz, 0.4), 5);
    expect(fire.y).toBeLessThan(2);
    expect(loaded.drops.find((d) => d.id === 901)!.y).toBeCloseTo(t.heightAt(bx + 2, bz), 5);
    expect(loaded.carcasses.find((c) => c.id === 902)!.y).toBeCloseTo(t.heightAt(bx - 1, bz + 2), 5);
  });

  it('a Pacific Northwest save from round 8 loads unchanged, felled trees and picked plants included', () => {
    const sim = Simulation.newGame(42, 'pnw');
    sim.state.trees[3] = { ...sim.state.trees[3], felled: true, hp: 0 };
    sim.state.resources[5] = { ...sim.state.resources[5], charges: 0, respawnAt: 77 };
    sim.state.structures.push({ id: 900, prefab: 'campfire', x: 5, y: 7.5, z: 5, rot: 0, fuel: 0 });
    const loaded = deserializeState(versionFour(sim))!;
    expect(loaded.trees[3].felled).toBe(true);
    expect(loaded.resources[5]).toEqual({ charges: 0, respawnAt: 77 });
    expect(loaded.structures.find((s) => s.id === 900)!.y).toBe(7.5);
  });

  it('a round 9 desert save keeps its felled trees', () => {
    const sim = Simulation.newGame(42, 'desert');
    sim.state.trees[0] = { ...sim.state.trees[0], felled: true, hp: 0 };
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.trees[0].felled).toBe(true);
  });
});
