import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { box, circle } from '../src/core/geom2d';
import { BALANCE } from '../src/data/balance';
import { stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import { ChunkedTerrain } from '../src/render/chunkedTerrain';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { buildDepthTexture } from '../src/render/terrainMesh';
import { WaterView } from '../src/render/water';
import { PNW_GENERATION, PNW_LAKE_SHARE, PNW_WORLD_SIZE } from '../src/sim/pnw';
import { MemoryStorage, RunManager, STORAGE_KEYS } from '../src/sim/run';
import { deserializeState, serializeState } from '../src/sim/save';
import { IDLE_INPUT, nearestShore, Simulation } from '../src/sim/simulation';
import { Terrain, getTerrain } from '../src/sim/terrain';
import { dryFootprint, generateWorld, getWorldGen } from '../src/sim/worldgen';
import { placeStructure } from './helpers';

const SEEDS = [0, 1, 2, 3, 7, 11, 42, 99, 777, 2024, 31337, 20260929, 0x7fffffff, 0xffffffff,
  ...Array.from({ length: 10 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)];

/** Flood the terrain at 4 m spacing using the movement slope and wading limits, with no browser or images. */
function reachable(t: Terrain) {
  const step = 4, n = t.playHalf * 2 / step;
  const coords = (i: number) => -t.playHalf + step / 2 + i * step;
  const walkable = new Uint8Array(n * n), seen = new Uint8Array(n * n);
  let total = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = coords(i), z = coords(j);
    if (t.waterDepth(x, z) <= 0.65 && t.slopeAt(x, z) < BALANCE.player.maxSlope * 0.9) {
      walkable[j * n + i] = 1;
      total++;
    }
  }
  const index = (x: number, z: number) => Math.floor((z + t.playHalf) / step) * n + Math.floor((x + t.playHalf) / step);
  const start = index(t.spawn.x, t.spawn.z);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head], i = k % n, j = Math.floor(k / n);
    for (const next of [i > 0 ? k - 1 : -1, i + 1 < n ? k + 1 : -1, j > 0 ? k - n : -1, j + 1 < n ? k + n : -1]) {
      if (next >= 0 && walkable[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
    }
  }
  return { fraction: queue.length / total, contains: (x: number, z: number) => !!seen[index(x, z)] };
}

describe('expanded PNW layout', () => {
  it.each(SEEDS)('seed %i: exactly 4x bounds, 18–20%% lake, ponds, stream and a reachable meadow', (seed) => {
    const t = getTerrain(seed), old = getTerrain(seed, 'pnw', 1), layout = t.pnw!;
    expect(t.size).toBe(PNW_WORLD_SIZE);
    expect((t.playHalf / old.playHalf) ** 2).toBe(4);
    expect(t.lakes.length).toBeGreaterThanOrEqual(2);
    expect(t.lakes.length).toBeLessThanOrEqual(3);
    let mainWater = 0, wet = 0;
    for (let z = -t.playHalf + 2; z < t.playHalf; z += 4) for (let x = -t.playHalf + 2; x < t.playHalf; x += 4) {
      if (t.heightAt(x, z) >= 0) continue;
      wet += 16;
      if (t.lakeAt(x, z) === t.lakes[0]) mainWater += 16;
    }
    const share = mainWater / (t.playHalf * 2) ** 2;
    expect(share).toBeGreaterThanOrEqual(0.18);
    expect(share).toBeLessThanOrEqual(0.2);
    expect(Math.abs(share - PNW_LAKE_SHARE)).toBeLessThan(0.004);
    expect(wet).toBeGreaterThan(mainWater);
    for (const lake of t.lakes) {
      expect(t.heightAt(lake.x, lake.z)).toBeLessThan(-1);
      for (let a = 0; a < 32; a++) {
        const angle = a * Math.PI / 16;
        const radius = layout.shoreRadius(lake, angle) + 12;
        expect(t.inPlayBounds(lake.x + Math.cos(angle) * radius, lake.z + Math.sin(angle) * radius)).toBe(true);
      }
    }
    const pts = layout.stream.pts;
    for (let k = 0; k < pts.length - 2; k += 2) {
      for (const f of [0, 0.25, 0.5, 0.75]) {
        const x = pts[k] + (pts[k + 2] - pts[k]) * f, z = pts[k + 1] + (pts[k + 3] - pts[k + 1]) * f;
        expect(t.waterDepth(x, z)).toBeGreaterThan(0.05);
        expect(t.lakeAt(x, z)).not.toBeNull();
      }
    }
    const { meadow: m } = layout;
    expect(t.heightAt(m.x, m.z)).toBeGreaterThan(1);
    expect(t.slopeAt(m.x, m.z)).toBeLessThan(0.15);
    const flood = reachable(t);
    expect(flood.fraction).toBeGreaterThan(0.97);
    expect(flood.contains(m.x, m.z)).toBe(true);
    expect(flood.contains(layout.stream.ford.x, layout.stream.ford.z)).toBe(true);
  });

  it.each(SEEDS.slice(0, 10))('seed %i: forest and supplies fill the new bounds, with an open meadow and safe scenery', (seed) => {
    const sim = Simulation.newGame(seed), t = sim.terrain, g = sim.gen;
    expect(g.trees.length).toBeGreaterThan(3500);
    expect(g.resources.filter((r) => !r.snow).length).toBeGreaterThan(600);
    const { x: sx, z: sz } = t.spawn;
    const starter = g.resources.filter((r) => Math.hypot(r.x - sx, r.z - sz) < 27);
    for (const kind of ['stickPile', 'stonePile', 'fern', 'berryBush', 'mushroom', 'onion']) expect(starter.some((r) => r.kind === kind)).toBe(true);
    expect(g.trees.filter((tr) => tr.species === 'birch' && Math.hypot(tr.x - sx, tr.z - sz) < 30).length).toBeGreaterThanOrEqual(3);
    expect(nearestShore(t, sim.state.player.x, sim.state.player.z)!.dist).toBeLessThanOrEqual(16);
    expect(g.trees.every((tr) => t.heightAt(tr.x, tr.z) > 0 && t.pnw!.meadowAt(tr.x, tr.z) <= 0.65)).toBe(true);
    expect(g.rocks.every((r) => dryFootprint(t, circle(r.x, r.z, r.r * 1.6)))).toBe(true);
    expect(g.logs.every((l) => dryFootprint(t, box(l.x, l.z, l.length / 2 + 0.2, l.r + 0.1, l.rot)))).toBe(true);
    for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
      expect(g.trees.some((tr) => tr[axis] * side > 200)).toBe(true);
      expect(g.resources.some((r) => !r.snow && r[axis] * side > 200)).toBe(true);
      expect(g.resources.some((r) => r.snow && r[axis] * side > 200)).toBe(true);
    }
    const shore = nearestShore(t, sim.state.player.x, sim.state.player.z)!;
    sim.state.animals = [];
    const p = sim.state.player;
    const yaw = Math.atan2(-shore.dx, -shore.dz);
    for (let i = 0; i < 300; i++) sim.step(1 / 60, { ...IDLE_INPUT, moveZ: 1, yaw });
    expect(t.waterDepth(p.x, p.z)).toBeGreaterThan(0);
  });

  it('regenerates every height, landmark, forage spot and snow patch deterministically', () => {
    const a = new Terrain(123), b = new Terrain(123);
    expect(a.heights).toEqual(b.heights);
    expect(a.pnw!.lakes).toEqual(b.pnw!.lakes);
    expect(a.pnw!.stream).toEqual(b.pnw!.stream);
    expect(generateWorld(123)).toEqual(generateWorld(123));
    expect(getWorldGen(123, 'pnw', 1)).not.toBe(getWorldGen(123));
  });
});

describe('PNW persistence and multiplayer generation', () => {
  it.each([1, 2] as const)('generation %i preserves player, camp, inventory, harvested trees and forage on reload and retry', (generation) => {
    const storage = new MemoryStorage(), rm = new RunManager(storage, () => 42);
    const sim = rm.newRun(42, generation);
    sim.state.animals = [];
    const fire = placeStructure(sim, 'campfire');
    sim.state.trees[0].hp = 1;
    sim.state.trees[1] = { ...sim.state.trees[1], hp: 0, felled: true, logs: 2, cuts: 1, fall: 0.7 };
    sim.state.resources[0] = { charges: 0, respawnAt: 54 };
    sim.state.inventory.slots[0] = { item: 'berries', count: 3 };
    rm.save(sim);
    rm.writeSnapshot(sim);
    const saved = storage.getItem(STORAGE_KEYS.save)!;
    for (const next of [rm.loadCurrent()!, rm.retryDay()]) {
      expect(next.state).toEqual(sim.state);
      expect(next.terrain).toBe(sim.terrain);
      expect(next.gen).toBe(sim.gen);
      expect(next.state.structures[0]).toEqual(fire);
      expect(serializeState(next.state)).toBe(saved);
    }
    const restarted = rm.restartFromDay1();
    expect(restarted.terrain).toBe(sim.terrain);
    expect(restarted.gen).toBe(sim.gen);
    expect(restarted.state.trees[0].hp).toBeGreaterThan(1);
    if (generation === 1) expect(JSON.parse(saved).pnwGen).toBeUndefined();
    else expect(JSON.parse(saved).pnwGen).toBe(PNW_GENERATION);
    expect(rm.startFromScratch().terrain.pnw).not.toBeNull();
  });

  it.each([1, 2] as const)('generation %i reaches guests and late joiners with the same indices', (generation) => {
    const host = Simulation.newGame(42, 'pnw', generation);
    host.state.trees[0].hp = 1;
    host.state.resources[0].charges = 0;
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host)));
    expect(guest.terrain).toBe(host.terrain);
    expect(guest.gen).toBe(host.gen);
    expect(guest.state.trees).toEqual(host.state.trees);
    expect(guest.state.resources).toEqual(host.state.resources);
  });

  it('rejects unknown generation markers instead of applying saved indices to a different map', () => {
    const raw = JSON.parse(serializeState(Simulation.newGame(42).state));
    for (const invalid of [0, 3, '2', null]) expect(deserializeState(JSON.stringify({ ...raw, pnwGen: invalid }))).toBeNull();
  });

  it('keeps the desert and island dimensions and omits the PNW marker from their saves and snapshots', () => {
    for (const biome of ['desert', 'island'] as const) {
      const sim = Simulation.newGame(42, biome);
      expect(sim.terrain.size).toBe(biome === 'desert' ? 320 : 960);
      expect(JSON.parse(serializeState(sim.state)).pnwGen).toBeUndefined();
      expect(takeSnapshot(sim).pnwGen).toBeUndefined();
      expect(new Simulation(deserializeState(serializeState(sim.state))!).gen).toBe(sim.gen);
    }
  });
});

describe('expanded forest rendering data (no visual checks)', () => {
  it('covers the whole height grid in fog-culled chunks whose vertices match collision heights', () => {
    const t = getTerrain(42), view = new ChunkedTerrain(t, 'spring');
    expect(view.triangles).toBe(t.cells ** 2 * 2);
    expect(view.group.children.length).toBeGreaterThan(30);
    let vertices = 0;
    for (const object of view.group.children) {
      const p = (object as THREE.Mesh).geometry.getAttribute('position');
      vertices += p.count;
      for (let i = 0; i < p.count; i += 61) expect(p.getY(i)).toBeCloseTo(t.heightAt(p.getX(i), p.getZ(i)), 5);
    }
    expect(vertices).toBe(view.triangles * 3);
    view.cull(t.spawn.x, t.spawn.z, 100);
    expect(view.group.children.filter((c) => c.visible).length).toBeLessThan(view.group.children.length / 2);
    view.dispose();
  });

  it('maps water and ice to the expanded depth grid and covers the connecting stream', () => {
    const t = getTerrain(42), texture = buildDepthTexture(t), water = new WaterView(t);
    expect(texture.image.width).toBe(t.verts);
    expect(texture.image.height).toBe(t.verts);
    expect(water.material.uniforms.uHalf.value).toBe(t.half);
    expect(water.material.uniforms.uGrid.value.x).toBe(t.verts);
    expect(water.group.children).toHaveLength(1);
    const geometry = (water.group.children[0] as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBe(-t.half);
    expect(geometry.boundingBox!.max.z).toBe(t.half);
    water.setFrozen(true);
    expect(water.material.uniforms.uFrozen.value).toBe(1);
    expect(water.material.depthWrite).toBe(true);
    texture.dispose();
    water.dispose();
  });

  it('seeds abundant meadow flowers in spring and summer, fewer in fall, and none in winter', () => {
    const sim = Simulation.newGame(42), mats = makeNatureMaterials();
    const counts: number[] = [];
    for (const season of ['spring', 'summer', 'fall', 'winter'] as const) {
      const view = new NatureView(sim.terrain, sim.gen, mats, season), matrix = new THREE.Matrix4();
      let count = 0;
      view.group.traverse((o) => {
        if (!(o instanceof THREE.InstancedMesh) || o.name !== 'flowers') return;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, matrix);
          if (sim.terrain.pnw!.meadowAt(matrix.elements[12], matrix.elements[14]) > 0.65) count++;
        }
      });
      counts.push(count);
      view.dispose();
    }
    expect(counts[0]).toBeGreaterThan(500);
    expect(counts[1]).toBeGreaterThan(200);
    expect(counts[0]).toBeGreaterThan(counts[1] * 1.5);
    expect(counts[2]).toBeGreaterThan(0);
    expect(counts[2]).toBeLessThan(counts[1]);
    expect(counts[3]).toBe(0);
    Object.values(mats).forEach((m) => m.dispose());
  });
});
