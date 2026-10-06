import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../src/data/resources';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { STONE_VARIANTS, stoneLook } from '../src/render/models';
import { countItem } from '../src/sim/inventory';
import { Simulation } from '../src/sim/simulation';
import { getTerrain } from '../src/sim/terrain';
import { getWorldGen, MIN_DESERT_BOULDER, type WorldGen } from '../src/sim/worldgen';
import { drain, teleport } from './helpers';

const SEEDS = Array.from({ length: 8 }, (_, i) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);
const stonesOf = (g: WorldGen) => g.resources.filter((r) => r.kind === 'stonePile');

/** Instanced meshes in a world's nature view, by name. */
function meshNames(seed: number, biome: 'pnw' | 'desert'): Map<string, THREE.InstancedMesh[]> {
  const view = new NatureView(getTerrain(seed, biome), getWorldGen(seed, biome), makeNatureMaterials());
  const out = new Map<string, THREE.InstancedMesh[]>();
  view.group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    const list = out.get(o.name) ?? [];
    list.push(o);
    out.set(o.name, list);
  });
  view.dispose();
  return out;
}

describe('desert stones are gatherable (round 9)', () => {
  it('the small decorative stones are gone: no grey bursage mounds, and every rock left is a boulder', () => {
    const names = meshNames(42, 'desert');
    expect([...names.keys()].some((n) => /bursage/.test(n))).toBe(false);
    expect(names.has('creosote')).toBe(true);
    for (const seed of SEEDS) {
      const g = getWorldGen(seed, 'desert');
      expect(g.rocks.length, `seed ${seed}`).toBeGreaterThan(15);
      for (const r of g.rocks) expect(r.r, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_DESERT_BOULDER);
    }
  });

  it('stones are plentiful: about as many piles as there were decorative mounds (about 1,600 a world)', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'desert');
      const stones = stonesOf(getWorldGen(seed, 'desert'));
      expect(stones.length, `seed ${seed}`).toBeGreaterThan(1300);
      expect(stones.length, `seed ${seed}`).toBeLessThan(1900);
      const near = stones.filter((r) => Math.hypot(r.x - t.spawn.x, r.z - t.spawn.z) < 30).length;
      expect(near, `seed ${seed}: stones within 30 m of the start`).toBeGreaterThan(40);
    }
  });

  it('every stone pile sits on open, dry ground and can be picked up', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const t = getTerrain(seed, 'desert');
      for (const r of stonesOf(getWorldGen(seed, 'desert'))) {
        expect(t.heightAt(r.x, r.z), `seed ${seed} stone ${r.spot}`).toBeGreaterThan(0.5);
        expect(t.landformAt(r.x, r.z).rock, `seed ${seed} stone ${r.spot}`).toBeLessThan(0.2);
      }
    }
    const sim = Simulation.newGame(42, 'desert');
    sim.state.animals.length = 0;
    const g = sim.gen;
    const far = g.resources.findIndex((r) => r.kind === 'stonePile' && Math.hypot(r.x - sim.terrain.spawn.x, r.z - sim.terrain.spawn.z) > 60);
    teleport(sim, g.resources[far].x + 1, g.resources[far].z);
    for (let k = 0; k < RESOURCES.stonePile.charges; k++) {
      sim.actionCooldown = 0;
      sim.perform({ kind: 'resource', index: far, dist: 1 });
    }
    drain(sim);
    expect(countItem(sim.state.inventory, 'stone')).toBe(RESOURCES.stonePile.charges * RESOURCES.stonePile.yield);
    expect(sim.state.resources[far].charges).toBe(0);
  });

  it('legacy Pacific Northwest worlds keep their original stone piles', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const stones = stonesOf(getWorldGen(seed, 'pnw', 1));
      expect(stones.length, `seed ${seed}`).toBeGreaterThan(20);
      expect(stones.length, `seed ${seed}`).toBeLessThan(80);
    }
  });
});

describe('stone piles vary in look on every map', () => {
  for (const biome of ['pnw', 'desert'] as const) {
    it(`${biome}: a few shapes, sizes, turns and colour shifts, spread across the world`, () => {
      const seed = 42;
      const stones = stonesOf(getWorldGen(seed, biome));
      const looks = stones.map((r) => stoneLook(seed, r.spot));
      const variants = new Set(looks.map((l) => l.variant));
      expect(variants.size).toBe(STONE_VARIANTS);
      for (let v = 0; v < STONE_VARIANTS; v++) expect(looks.filter((l) => l.variant === v).length / looks.length).toBeGreaterThan(0.15);
      const sizes = looks.map((l) => l.size * 1);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.3);
      expect(Math.max(...sizes)).toBeLessThan(1.3);
      const tints = looks.map((l) => l.tint);
      expect(Math.max(...tints) - Math.min(...tints)).toBeGreaterThan(0.15);
      const turns = new Array(4).fill(0);
      for (const r of stones) turns[Math.floor((r.rot / (Math.PI * 2)) * 4) % 4]++;
      for (const n of turns) expect(n / stones.length).toBeGreaterThan(0.1);

      const names = meshNames(seed, biome);
      let drawn = 0;
      for (let v = 0; v < STONE_VARIANTS; v++) {
        const meshes = names.get(`res-stonePile-${v}`) ?? [];
        expect(meshes.length, `shape ${v}`).toBeGreaterThan(0);
        for (const m of meshes) {
          expect(m.instanceColor, `shape ${v} has per-pile colour`).not.toBeNull();
          drawn += m.count;
        }
      }
      expect(drawn).toBe(stones.length);
      expect(names.has('res-stonePile')).toBe(false);
    });
  }

  it("each world's stones look the same every time, and different from another world's", () => {
    const spots = stonesOf(getWorldGen(42, 'desert')).map((r) => r.spot);
    expect(spots.map((s) => stoneLook(42, s))).toEqual(spots.map((s) => stoneLook(42, s)));
    const differ = spots.filter((s) => {
      const a = stoneLook(42, s);
      const b = stoneLook(43, s);
      return a.variant !== b.variant || Math.abs(a.size - b.size) > 0.01;
    }).length;
    expect(differ / spots.length).toBeGreaterThan(0.6);
  });
});
