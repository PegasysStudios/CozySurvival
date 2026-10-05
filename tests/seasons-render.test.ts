import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rigParts } from '../src/render/creatures';
import { treeGeometry } from '../src/render/models';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { seasonColors } from '../src/render/seasons';
import { WaterView } from '../src/render/water';
import { Simulation } from '../src/sim/simulation';
import type { Season } from '../src/sim/seasons';

describe('seasonal rendering', () => {
  it('turns all fall tree foliage warm at both LODs, including orange-brown conifers', () => {
    for (const lod of [0, 1]) {
      for (const species of ['maple', 'birch', 'fir', 'cedar'] as const) {
        const g = treeGeometry(species, lod);
        const before = Array.from(g.getAttribute('color').array);
        seasonColors(g, 'fall', species === 'fir' || species === 'cedar' ? 'evergreen' : 'deciduous');
        const after = Array.from(g.getAttribute('color').array);
        expect(after).not.toEqual(before);
        expect(after.some((r, i) => i % 3 === 0 && r > after[i + 1] * 1.5 && r > 0.2)).toBe(true);
        expect(after.some((r, i) => i % 3 === 0 && after[i + 1] > r && after[i + 1] > after[i + 2])).toBe(false);
        expect(after.slice(0, 3)).toEqual(before.slice(0, 3)); // The trunk keeps its bark colour.
        g.dispose();
      }
    }
  });

  it('uses white winter rabbit geometry without changing the normal cached rabbit or its eyes', () => {
    const summer = rigParts('rabbit', 0);
    const before = Array.from(summer.body.getAttribute('color').array);
    const winter = rigParts('rabbit', 1);
    const avg = (g: THREE.BufferGeometry) => Array.from(g.getAttribute('color').array).reduce((a, b) => a + b, 0) / g.getAttribute('color').array.length;
    expect(avg(winter.body)).toBeGreaterThan(0.7);
    expect(avg(winter.body)).toBeGreaterThan(avg(summer.body) + 0.3);
    expect(Array.from(summer.body.getAttribute('color').array)).toEqual(before);
    expect(Array.from(winter.head.getAttribute('color').array).some((n) => n < 0.02)).toBe(true);
    expect(rigParts('rabbit', 1, true).body).not.toBe(winter.body);
  });

  it('grows more spring flowers and removes winter flowers', () => {
    const sim = Simulation.newGame(42);
    const mats = makeNatureMaterials();
    const flowerCounts: Partial<Record<Season, number>> = {};
    sim.state.trees[0].felled = true;
    for (const season of ['spring', 'summer', 'fall', 'winter'] as const) {
      const nature = new NatureView(sim.terrain, sim.gen, mats, season);
      nature.sync(sim.state, false);
      let count = 0;
      nature.group.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === 'flowers') count += o.count; });
      flowerCounts[season] = count;
      nature.dispose();
    }
    expect(flowerCounts.spring!).toBeGreaterThan(flowerCounts.summer! * 1.5);
    expect(flowerCounts.fall!).toBeLessThan(flowerCounts.summer!);
    expect(flowerCounts.winter).toBe(0);
    Object.values(mats).forEach((m) => m.dispose());
  });

  it('makes ice opaque and solid in the depth buffer, then restores transparent water on thaw', () => {
    const water = new WaterView(Simulation.newGame(42).terrain);
    water.setFrozen(true);
    expect(water.material.uniforms.uFrozen.value).toBe(1);
    expect(water.material.depthWrite).toBe(true);
    expect(water.material.transparent).toBe(false);
    water.setFrozen(false);
    expect(water.material.depthWrite).toBe(false);
    expect(water.material.transparent).toBe(true);
    water.dispose();
  });
});
