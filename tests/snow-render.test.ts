import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { SnowView } from '../src/render/snow';
import { fallenLogGeometry, rockGeometry } from '../src/render/models';
import { tf } from '../src/render/geo';
import { TRUNK_AXIS_LIFT } from '../src/sim/trunks';
import { snowScale, snowSurface } from '../src/sim/snow';
import { Simulation } from '../src/sim/simulation';
import type { ResourceGen } from '../src/sim/worldgen';

function fixture() {
  const sim = Simulation.newGame(42);
  sim.devSetSeason('winter');
  return sim;
}

function vertices(view: SnowView): THREE.BufferAttribute {
  return (view.group.children[0] as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
}

describe('snow clump mesh data', () => {
  it.each(['log', 0, 1, 2] as const)('seats clumps on actual scenery triangles (%s) throughout melting', (kind) => {
    const surface = kind === 'log' ? 'log' : 'rock';
    const sim = fixture();
    const r = sim.gen.resources.find((r) => r.snow?.surface === surface && (kind === 'log' || sim.gen.rocks[r.snow!.ref].variant === kind)
      && snowScale(sim.state.seed, r.spot, { id: 'spring', startDay: 1 }, 2 * 24) > 0)!;
    const support = surface === 'log' ? sim.gen.logs[r.snow!.ref] : sim.gen.rocks[r.snow!.ref];
    const geometry = surface === 'log' ? fallenLogGeometry() : rockGeometry(sim.gen.rocks[r.snow!.ref].variant);
    const scenery = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ground = sim.terrain.heightAt(support.x, support.z);
    const matrix = surface === 'log'
      ? tf(support.x, ground + support.r * TRUNK_AXIS_LIFT, support.z, 0, support.rot, 0, sim.gen.logs[r.snow!.ref].length, support.r, support.r)
      : tf(support.x, ground - support.r * 0.12, support.z, 0, support.rot, 0, support.r, support.r * sim.gen.rocks[r.snow!.ref].scaleY, support.r);
    scenery.applyMatrix4(matrix);
    scenery.updateMatrixWorld(true);
    const state = { ...sim.state, structures: [], resources: [{ charges: 3, respawnAt: 0 }] };
    const view = new SnowView(sim.terrain, { ...sim.gen, resources: [r] });
    const ray = new THREE.Raycaster();
    for (const [season, hours] of [['winter', 0], ['spring', 0], ['spring', 2 * 24]] as const) {
      state.season = { id: season, startDay: 1 };
      state.totalHours = hours;
      view.update(state, true);
      const pos = vertices(view);
      for (let i = 0; i < pos.count; i++) {
        ray.set(new THREE.Vector3(pos.getX(i), ground + 10, pos.getZ(i)), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(scenery)[0];
        expect(hit).toBeDefined();
        const gap = pos.getY(i) - hit.point.y;
        expect(gap).toBeGreaterThan(-0.021);
        expect(gap).toBeLessThanOrEqual(r.snow!.depth + 0.001);
      }
    }
    view.dispose();
    geometry.dispose();
    scenery.material.dispose();
  });

  it.each(['ground', 'log', 'rock'] as const)('conforms %s clumps to their support throughout shrinking and melting', (surface) => {
    const sim = fixture();
    const r = sim.gen.resources.find((r) => r.snow?.surface === surface && snowScale(sim.state.seed, r.spot, { id: 'spring', startDay: 1 }, 24 * 12) > 0)!;
    expect(r).toBeDefined();
    const state = { ...sim.state, structures: [], resources: [{ charges: 3, respawnAt: 0 }] };
    const gen = { ...sim.gen, resources: [r] };
    const view = new SnowView(sim.terrain, gen);
    const radius = () => {
      const pos = vertices(view);
      let max = 0, minGap = Infinity, maxGap = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        expect(Number.isFinite(x + y + z)).toBe(true);
        max = Math.max(max, Math.hypot(x - r.x, z - r.z));
        const gap = y - snowSurface(sim.terrain, gen, r, x, z);
        minGap = Math.min(minGap, gap);
        maxGap = Math.max(maxGap, gap);
      }
      // Ground uses the terrain directly; elevated supports are checked against their real mesh above.
      if (surface === 'ground') {
        expect(minGap).toBeGreaterThan(-0.021);
        expect(maxGap).toBeLessThanOrEqual(r.snow!.depth + 0.001);
      }
      return max;
    };
    view.update(state, true);
    expect(view.activeClumps).toBe(1);
    const full = radius();
    state.season = { id: 'spring', startDay: 1 };
    view.update(state, true);
    const early = radius();
    expect(early).toBeLessThan(full);
    state.totalHours = 24 * 12;
    view.update(state);
    expect(radius()).toBeLessThan(early);
    expect(view.activeClumps).toBe(1);
    state.totalHours = 24 * 24;
    view.update(state);
    expect(view.activeClumps).toBe(0);
    expect(view.group.visible).toBe(false);
    view.dispose();
  });

  it('reduces clumps after harvesting, hides them under structures, and disposes its geometry and material', () => {
    const sim = fixture();
    const r = sim.gen.resources.find((r) => r.snow?.surface === 'ground') as ResourceGen;
    const state = { ...sim.state, resources: [{ charges: 3, respawnAt: 0 }] };
    const view = new SnowView(sim.terrain, { ...sim.gen, resources: [r] });
    view.update(state, true);
    const before = Array.from(vertices(view).array);
    state.resources[0].charges = 1;
    view.update(state, true);
    expect(Array.from(vertices(view).array)).not.toEqual(before);
    state.structures = [{ id: 1, prefab: 'leanTo', x: r.x, z: r.z, y: r.y!, rot: 0, fuel: 0 }];
    view.update(state, true);
    expect(view.activeClumps).toBe(0);
    state.structures = [];
    state.resources[0].charges = 0;
    view.update(state, true);
    expect(view.group.visible).toBe(false);
    const mesh = view.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    const disposed = vi.fn();
    mesh.geometry.addEventListener('dispose', disposed);
    mesh.material.addEventListener('dispose', disposed);
    view.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('is connected to the normal nature update and follows spring time without a world rebuild', () => {
    const sim = fixture();
    const mats = makeNatureMaterials();
    const nature = new NatureView(sim.terrain, sim.gen, mats, sim.season);
    nature.sync(sim.state, false);
    const snow = nature.group.getObjectByName('snow-clumps')!;
    expect(snow.visible).toBe(true);
    sim.devSetSeason('spring');
    sim.state.totalHours = 24 * 24;
    nature.update(0.1, 0, 0, 100, sim.state);
    expect(snow.visible).toBe(false);
    nature.dispose();
    Object.values(mats).forEach((m) => m.dispose());
  });

  it.each(['desert', 'island'] as const)('creates no snow mesh data for %s', (biome) => {
    const sim = Simulation.newGame(42, biome);
    const view = new SnowView(sim.terrain, sim.gen);
    view.update(sim.state, true);
    expect(view.group.children).toHaveLength(0);
    expect(view.group.visible).toBe(false);
    view.dispose();
  });
});
