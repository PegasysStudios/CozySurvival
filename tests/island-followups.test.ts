import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BIOMES, BIOME_IDS } from '../src/data/biomes';
import { RESOURCES, type ResourceKind } from '../src/data/resources';
import { GROUND_CLEAR, planIslandGround } from '../src/render/islandGround';
import { islandResourceGeometry } from '../src/render/islandModels';
import { IslandWaterView } from '../src/render/islandWater';
import { WaterView } from '../src/render/water';
import { PROTOCOL_VERSION } from '../src/net/config';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { getTerrain, type Terrain } from '../src/sim/terrain';
import { getWorldGen, WORLD_REVISION, type WorldGen } from '../src/sim/worldgen';

const SEEDS = [1, 7, 42, 777, 2024, 31337, 20260929, 99991];
/** What may lie on bare sand: driftwood, stones and fallen coconuts. Every other resource is a plant. */
const SAND_OK = new Set<ResourceKind>(['stickPile', 'stonePile', 'coconut']);

function world(seed: number): { t: Terrain; g: WorldGen } {
  return { t: getTerrain(seed, 'island'), g: getWorldGen(seed, 'island') };
}

const onSand = (t: Terrain, x: number, z: number) => t.island!.onSand(x, z, t.heightAt(x, z));

/** Sample points on the beach sand, walking in from the coast along many bearings. */
function sandPoints(t: Terrain): { x: number; z: number }[] {
  const isl = t.island!;
  const out: { x: number; z: number }[] = [];
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * Math.PI * 2;
    for (let r = isl.coastAt(a) + 6; r > isl.coastAt(a) - 40; r -= 1) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (t.heightAt(x, z) > 0.1 && onSand(t, x, z)) out.push({ x, z });
    }
  }
  return out;
}

describe('purslane', () => {
  it('is generated on every island, several hundred plants and three right by the spawn', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      const purslane = g.resources.filter((r) => r.kind === 'purslane');
      expect(purslane.length, `seed ${seed}`).toBeGreaterThanOrEqual(300);
      const near = purslane.filter((r) => Math.hypot(r.x - t.spawn.x, r.z - t.spawn.z) < 35);
      expect(near.length, `seed ${seed} near spawn`).toBeGreaterThanOrEqual(3);
    }
    expect(RESOURCES.purslane.starter).toBeGreaterThanOrEqual(3);
  });

  it('grows on dry ground off the sand, in the coastal strip or the open, never deep in the jungle or in a cave', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      const isl = t.island!;
      for (const r of g.resources.filter((p) => p.kind === 'purslane')) {
        const where = `seed ${seed} at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}`;
        expect(t.heightAt(r.x, r.z), where).toBeGreaterThan(0.4);
        expect(t.inPlayBounds(r.x, r.z, 2), where).toBe(true);
        expect(onSand(t, r.x, r.z), where).toBe(false);
        // The coastal strip runs about 46 m in from the sea; the starter patch reaches a little past it.
        expect(isl.land(r.x, r.z) < 50 || isl.jungle(r.x, r.z) < 0.6, where).toBe(true);
        expect(isl.caves.some((c) => Math.hypot(r.x - c.x, r.z - c.z) < c.r + 1), where).toBe(false);
      }
    }
  });

  it('is spread right round the island, in the littoral strip and the grassland', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      const isl = t.island!;
      const purslane = g.resources.filter((r) => r.kind === 'purslane');
      const octants = new Set(purslane.map((r) => Math.floor(((Math.atan2(r.z, r.x) + Math.PI) / (Math.PI * 2)) * 8) % 8));
      expect(octants.size, `seed ${seed}`).toBe(8);
      const littoral = purslane.filter((r) => isl.land(r.x, r.z) < 46).length;
      expect(littoral, `seed ${seed} littoral`).toBeGreaterThan(80);
      expect(purslane.length - littoral, `seed ${seed} inland`).toBeGreaterThan(120);
    }
  });

  it('is kept clear of grass and shrubs, so it shows from a distance', () => {
    const clearR = GROUND_CLEAR.purslane!;
    expect(clearR).toBeGreaterThanOrEqual(1.2);
    for (const seed of SEEDS.slice(0, 4)) {
      const { t, g } = world(seed);
      const purslane = g.resources.filter((r) => r.kind === 'purslane');
      const plan = planIslandGround(t, g);
      expect(plan.length, `seed ${seed}`).toBeGreaterThan(10000);
      const cell = new Map<string, { x: number; z: number }[]>();
      for (const p of purslane) {
        const k = `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`;
        (cell.get(k) ?? cell.set(k, []).get(k)!).push(p);
      }
      let crowded = 0;
      for (const q of plan) {
        const cx = Math.floor(q.x / 4);
        const cz = Math.floor(q.z / 4);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          for (const p of cell.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(q.x - p.x, q.z - p.z) < clearR) crowded++;
        }
      }
      expect(crowded, `seed ${seed}`).toBe(0);
    }
  });

  it('is a bright, knee-wide mat with yellow flowers rather than a few specks', () => {
    const geo = islandResourceGeometry('purslane').main;
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    expect(Math.min(size.x, size.z)).toBeGreaterThan(0.7);
    expect(size.y).toBeGreaterThan(0.15);
    const colors = geo.getAttribute('color');
    const c = new THREE.Color();
    let yellow = 0;
    let red = 0;
    for (let i = 0; i < colors.count; i++) {
      c.fromBufferAttribute(colors as THREE.BufferAttribute, i);
      if (c.r > 0.8 && c.g > 0.6 && c.b < 0.4) yellow++;
      else if (c.r > 0.35 && c.r > c.g * 1.8) red++;
    }
    expect(yellow, 'flower vertices').toBeGreaterThan(100);
    expect(red, 'stem vertices').toBeGreaterThan(50);
  });
});

describe('bare beach sand', () => {
  it('leaves wide strands of sand on every island', () => {
    for (const seed of SEEDS) {
      const { t } = world(seed);
      expect(sandPoints(t).length, `seed ${seed}`).toBeGreaterThan(4000);
    }
  });

  it('has no trees on it: palms and beach hibiscus stand above the sand', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      for (const tr of g.trees) expect(onSand(t, tr.x, tr.z), `seed ${seed} ${tr.species} at ${tr.x.toFixed(1)}, ${tr.z.toFixed(1)}`).toBe(false);
      const palms = g.trees.filter((tr) => tr.species === 'palm');
      expect(palms.length, `seed ${seed} palms`).toBeGreaterThan(300);
      // They still line the top of the beach.
      const edge = palms.filter((p) => t.island!.land(p.x, p.z) < 40).length;
      expect(edge, `seed ${seed} beach-top palms`).toBeGreaterThan(palms.length * 0.4);
    }
  });

  it('has no plants on it: only driftwood, stones and fallen coconuts', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      const onBeach = g.resources.filter((r) => onSand(t, r.x, r.z));
      for (const r of onBeach) expect(SAND_OK.has(r.kind), `seed ${seed} ${r.kind} at ${r.x.toFixed(1)}, ${r.z.toFixed(1)}`).toBe(true);
      // The beach isn't empty of things to pick up.
      expect(onBeach.length, `seed ${seed}`).toBeGreaterThan(40);
      expect(g.logs.filter((l) => onSand(t, l.x, l.z)).length, `seed ${seed} driftwood`).toBeGreaterThan(0);
    }
  });

  it('has no ground cover on it: no naupaka, sedge, grass, ferns or flowers', () => {
    for (const seed of SEEDS) {
      const { t, g } = world(seed);
      const plan = planIslandGround(t, g);
      const bad = plan.filter((p) => onSand(t, p.x, p.z));
      expect(bad.length, `seed ${seed}: ${bad.slice(0, 3).map((p) => `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).join('; ')}`).toBe(0);
      // Naupaka and sedge still grow along the coast, just behind the sand.
      const littoral = plan.filter((p) => (p.kind === 'naupaka' || p.kind === 'sedge') && t.island!.land(p.x, p.z) < 46);
      expect(littoral.length, `seed ${seed}`).toBeGreaterThan(1500);
    }
  });

  it('is the same sand the terrain is painted with', () => {
    const { t } = world(42);
    const isl = t.island!;
    for (const p of sandPoints(t).filter((_, i) => i % 50 === 0)) {
      const h = t.heightAt(p.x, p.z);
      expect(isl.sandAt(p.x, p.z, h)).toBeGreaterThan(0.02);
    }
    // Well inland and up on the grass there is none.
    expect(isl.sandAt(t.spawn.x, t.spawn.z, 3)).toBe(0);
    expect(isl.sandAt(0, 0, t.heightAt(0, 0))).toBe(0);
  });
});

describe('island saves across the follow-ups', () => {
  /** An island save as the PR #11 build wrote it: no world revision, and tree and plant states indexed by its layout. */
  function oldIslandSave(): { json: string; sim: Simulation } {
    const sim = Simulation.newGame(42, 'island');
    const p = sim.state.player;
    sim.state.structures.push({ id: sim.state.nextId++, prefab: 'campfire', x: p.x + 3, y: 5, z: p.z, rot: 0, fuel: 8 });
    const raw = JSON.parse(serializeState(sim.state)) as Record<string, unknown>;
    delete raw.worldRev;
    const g = getWorldGen(42, 'island');
    // Felled trees and picked plants at indices past the new layout's end, and one inside it.
    raw.trees = [[g.trees.length + 400, 0, 1, 0, 0, 2, 0, 1], [5, 0, 1, 0, 0, 1, 0, 1]];
    raw.resources = [[g.resourceSpots + 120, 0, 30], [g.resources[0].spot, 0, 30]];
    return { json: JSON.stringify(raw), sim };
  }

  it('loads an island save from before them, with its trees and plants fresh and its camp reseated on the ground', () => {
    const { json, sim } = oldIslandSave();
    const s = deserializeState(json);
    expect(s).not.toBeNull();
    const g = getWorldGen(42, 'island');
    expect(s!.biome).toBe('island');
    expect(s!.trees).toHaveLength(g.trees.length);
    expect(s!.trees.every((t) => !t.felled)).toBe(true);
    expect(s!.resources).toHaveLength(g.resources.length);
    expect(s!.resources.every((r, i) => r.charges === RESOURCES[g.resources[i].kind].charges)).toBe(true);
    expect(s!.structures).toHaveLength(1);
    const fire = s!.structures[0];
    expect(fire.y).toBeCloseTo(getTerrain(42, 'island').heightAt(fire.x, fire.z), 0);
    expect(s!.inventory).toEqual(sim.state.inventory);
    expect((s as unknown as Record<string, unknown>).worldRev).toBeUndefined();
    // Saved again, it's a current save.
    expect(JSON.parse(serializeState(s!)).worldRev).toBe(WORLD_REVISION.island);
  });

  it('keeps felled trees and picked plants in a current island save', () => {
    const sim = Simulation.newGame(42, 'island');
    sim.state.trees[5].felled = true;
    sim.state.trees[5].hp = 0;
    sim.state.resources[0].charges = 0;
    const json = serializeState(sim.state);
    expect(JSON.parse(json).worldRev).toBe(2);
    const s = deserializeState(json)!;
    expect(s.trees[5].felled).toBe(true);
    expect(s.resources[0].charges).toBe(0);
  });

  it('writes nothing new into forest and desert saves', () => {
    expect(WORLD_REVISION.pnw).toBeUndefined();
    expect(WORLD_REVISION.desert).toBeUndefined();
    for (const biome of ['pnw', 'desert'] as const) {
      const sim = Simulation.newGame(42, biome);
      sim.state.trees[3].felled = true;
      const raw = JSON.parse(serializeState(sim.state));
      expect(raw.worldRev, biome).toBeUndefined();
      expect(deserializeState(JSON.stringify(raw))!.trees[3].felled, biome).toBe(true);
    }
  });

  it('keeps players on the old island layout out of new servers', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(9);
  });
});

describe('island water opacity', () => {
  it('is set for the island only', () => {
    const o = BIOMES.island.waterOpacity!;
    expect(o).toBeDefined();
    for (const id of BIOME_IDS) if (id !== 'island') expect(BIOMES[id].waterOpacity, id).toBeUndefined();
    for (const v of [o.shallow, o.deep, o.fresh]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Much less see-through than before (the shore was 42% opaque, deep water 93%, streams 72%).
    expect(o.shallow).toBeGreaterThanOrEqual(0.7);
    expect(o.deep).toBeGreaterThan(0.93);
    expect(o.fresh).toBeGreaterThan(0.72);
    expect(o.deep).toBeGreaterThan(o.shallow);
  });

  it('drives the island water shader', () => {
    const o = BIOMES.island.waterOpacity!;
    const view = new IslandWaterView(getTerrain(42, 'island'));
    const u = view.material.uniforms;
    expect(u.uAlphaShallow.value).toBe(o.shallow);
    expect(u.uAlphaDeep.value).toBe(o.deep);
    expect(u.uAlphaFresh.value).toBe(o.fresh);
    expect(view.material.fragmentShader).toContain('mix(uAlphaShallow, uAlphaDeep');
    expect(view.material.fragmentShader).not.toContain('0.42');
    const custom = new IslandWaterView(getTerrain(42, 'island'), { shallow: 0.5, deep: 0.6, fresh: 0.7 });
    expect(custom.material.uniforms.uAlphaShallow.value).toBe(0.5);
    view.dispose();
    custom.dispose();
  });

  it('leaves the PNW and desert lakes exactly as they were', () => {
    for (const biome of ['pnw', 'desert'] as const) {
      const view = new WaterView(getTerrain(42, biome));
      expect(view.material.uniforms.uAlphaShallow, biome).toBeUndefined();
      expect(view.material.fragmentShader, biome).toContain('float alpha = mix(0.55, 0.9, shallow) + fres * 0.08;');
      view.dispose();
    }
  });
});
