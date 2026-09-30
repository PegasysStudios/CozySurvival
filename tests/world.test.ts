import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../src/data/resources';
import { Terrain, TERRAIN_CELL, TERRAIN_VERTS, WATER_LEVEL, WORLD_HALF, getTerrain } from '../src/sim/terrain';
import { generateWorld, getWorldGen, SPAWN_CLEAR_RADIUS } from '../src/sim/worldgen';

const SEEDS = [1, 42, 777, 20260929];

describe('terrain', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new Terrain(5);
    const b = new Terrain(5);
    const c = new Terrain(6);
    expect(a.heightAt(12.3, -40.1)).toBe(b.heightAt(12.3, -40.1));
    expect(a.heightAt(12.3, -40.1)).not.toBe(c.heightAt(12.3, -40.1));
  });

  it('heightAt reproduces grid vertices and is continuous across triangle seams', () => {
    const t = getTerrain(42);
    for (const [i, j] of [[10, 10], [80, 33], [120, 150]]) {
      const x = -WORLD_HALF + i * TERRAIN_CELL;
      const z = -WORLD_HALF + j * TERRAIN_CELL;
      expect(t.heightAt(x, z)).toBeCloseTo(t.heights[j * TERRAIN_VERTS + i], 5);
    }
    // continuity: tiny moves never jump
    let prev = t.heightAt(-50, -50);
    for (let k = 1; k < 2000; k++) {
      const h = t.heightAt(-50 + k * 0.05, -50 + k * 0.031);
      expect(Math.abs(h - prev)).toBeLessThan(0.2);
      prev = h;
    }
  });

  it.each(SEEDS)('seed %i: spawn is dry and gentle, and a deep lake is nearby', (seed) => {
    const t = getTerrain(seed);
    expect(t.heightAt(0, 0)).toBeGreaterThan(1.5);
    expect(t.slopeAt(0, 0)).toBeLessThan(0.15);
    const lake = t.lakes[0];
    expect(t.heightAt(lake.x, lake.z)).toBeLessThan(-2);
    expect(Math.hypot(lake.x, lake.z)).toBeLessThan(60);
  });

  it('raycast finds the water surface when looking down at the lake', () => {
    const t = getTerrain(42);
    const lake = t.lakes[0];
    const hit = { x: 0, y: 0, z: 0, water: false };
    const d = t.raycast(lake.x, 3, lake.z, 0, -1, 0, 10, hit);
    expect(d).toBeCloseTo(3, 1);
    expect(hit.water).toBe(true);
    expect(hit.y).toBeCloseTo(WATER_LEVEL, 1);
  });

  it('mountain rim rises steeply at the world edge', () => {
    const t = getTerrain(42);
    expect(t.heightAt(WORLD_HALF - 2, 0)).toBeGreaterThan(t.heightAt(WORLD_HALF - 60, 0) + 15);
  });
});

describe('worldgen', () => {
  it('is deterministic', () => {
    const a = generateWorld(1234);
    const b = generateWorld(1234);
    expect(a.trees.length).toBe(b.trees.length);
    expect(a.trees[10]).toEqual(b.trees[10]);
    expect(a.resources[20]).toEqual(b.resources[20]);
  });

  it.each(SEEDS)('seed %i: dense forest, nothing grows in water, spawn clearing is open', (seed) => {
    const t = getTerrain(seed);
    const g = getWorldGen(seed);
    expect(g.trees.length).toBeGreaterThan(700);
    expect(g.resources.length).toBeGreaterThan(200);
    for (const tree of g.trees) {
      expect(t.heightAt(tree.x, tree.z)).toBeGreaterThan(WATER_LEVEL);
      expect(t.inPlayBounds(tree.x, tree.z)).toBe(true);
    }
    for (const r of g.resources) expect(t.heightAt(r.x, r.z)).toBeGreaterThan(WATER_LEVEL);
    const nearSpawn = g.trees.filter((tr) => Math.hypot(tr.x, tr.z) < SPAWN_CLEAR_RADIUS - 1);
    expect(nearSpawn.filter((tr) => tr.species !== 'birch')).toHaveLength(0);
  });

  it.each(SEEDS)('seed %i: day-1 starter materials and birches are close to spawn', (seed) => {
    const g = getWorldGen(seed);
    const near = (r: number) => g.resources.filter((res) => Math.hypot(res.x, res.z) < r);
    const kinds = new Set(near(20).map((r) => r.kind));
    for (const k of ['stickPile', 'stonePile', 'fern', 'berryBush', 'onion'] as const) expect(kinds.has(k)).toBe(true);
    expect(near(27).some((r) => r.kind === 'mushroom')).toBe(true);
    expect(g.trees.filter((tr) => tr.species === 'birch' && Math.hypot(tr.x, tr.z) < 30).length).toBeGreaterThanOrEqual(3);
    // no two gatherables overlap
    for (let i = 0; i < 200; i++) {
      const a = g.resources[i];
      for (let j = i + 1; j < 200; j++) {
        const b = g.resources[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(RESOURCES[a.kind].blockRadius * 0.5);
      }
    }
  });
});

describe('fern spawn share (round 6)', () => {
  const withFernScatter = <T>(p: number, fn: () => T): T => {
    const was = RESOURCES.fern.scatter;
    RESOURCES.fern.scatter = p;
    try {
      return fn();
    } finally {
      RESOURCES.fern.scatter = was;
    }
  };
  const key = (r: { kind: string; x: number; z: number }) => `${r.kind}@${r.x.toFixed(3)},${r.z.toFixed(3)}`;

  it('grows ferns on 48% of their scatter spots, 1.2x the earlier 40%', () => {
    expect(RESOURCES.fern.scatter).toBeCloseTo(0.4 * 1.2, 10);
  });

  it('only adds ferns: every other spawn and every earlier fern stays exactly where it was', () => {
    let before = 0;
    let after = 0;
    for (const seed of SEEDS) {
      const old = withFernScatter(0.4, () => generateWorld(seed));
      const now = generateWorld(seed);
      expect(now.resourceSpots).toBe(old.resourceSpots);
      expect(now.trees).toEqual(old.trees);
      expect(now.rocks).toEqual(old.rocks);
      const others = (w: typeof now) => w.resources.filter((r) => r.kind !== 'fern').map(key);
      expect(others(now)).toEqual(others(old));
      const nowFerns = new Set(now.resources.filter((r) => r.kind === 'fern').map(key));
      const oldFerns = old.resources.filter((r) => r.kind === 'fern').map(key);
      for (const f of oldFerns) expect(nowFerns.has(f)).toBe(true);
      before += oldFerns.length - RESOURCES.fern.starter;
      after += nowFerns.size - RESOURCES.fern.starter;
    }
    // map-wide ferns rise by about a fifth (random rolls, so not exactly 1.2x)
    expect(after / before).toBeGreaterThan(1.1);
    expect(after / before).toBeLessThan(1.3);
  });
});
