import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { BIOMES, BIOME_IDS } from '../src/data/biomes';
import { ITEMS } from '../src/data/items';
import { OBJECTIVES, lockedToday } from '../src/data/objectives';
import { recipesFor } from '../src/data/recipes';
import { RESOURCES, TREES } from '../src/data/resources';
import { SPECIES, type SpeciesId } from '../src/data/species';
import { createAnimal, isHabitable, SHARK_HEARING } from '../src/sim/animals';
import { carcassStep } from '../src/sim/carcass';
import { SWIM_FLOAT_Y } from '../src/sim/movement';
import { applySleep, createNeeds } from '../src/sim/needs';
import { MemoryStorage, RunManager, STORAGE_KEYS, storageKeys } from '../src/sim/run';
import { deserializeState, serializeState } from '../src/sim/save';
import { nearestShore, Simulation } from '../src/sim/simulation';
import type { AnimalState } from '../src/sim/state';
import { getTerrain, TERRAIN_CELL, WATER_LEVEL, type Terrain } from '../src/sim/terrain';
import { ambientWarmth } from '../src/sim/time';
import { crownPosition } from '../src/sim/trunks';
import { getWorldGen } from '../src/sim/worldgen';
import { GuestSession } from '../src/net/guest';
import { HostSession } from '../src/net/host';
import { LobbyWatcher, type ServerInfo } from '../src/net/lobby';
import { LocalTransport, MemoryHub } from '../src/net/transport';
import { takeSnapshot } from '../src/net/worldSync';
import { dayOneLimit } from './setup';
import { aimAt, drain, give, input, keepAlive, run, teleport } from './helpers';

const SEEDS = [1, 7, 42, 777, 2024, 31337, 20260929, 99991];
/** The Pacific Northwest and desert play square, 296 m a side. */
const OTHER_PLAY_AREA = 296 * 296;

function island(seed = 42): Simulation {
  const sim = Simulation.newGame(seed, 'island');
  sim.state.animals.length = 0;
  keepAlive(sim);
  drain(sim);
  return sim;
}

/** Walks the grid around the island and adds up land and water inside the reef. */
function areas(t: Terrain): { land: number; lagoon: number } {
  const isl = t.island!;
  const cell = TERRAIN_CELL * TERRAIN_CELL;
  let land = 0;
  let lagoon = 0;
  for (let j = 0; j < t.verts; j++) {
    for (let i = 0; i < t.verts; i++) {
      const x = -t.half + i * TERRAIN_CELL;
      const z = -t.half + j * TERRAIN_CELL;
      if (t.heights[j * t.verts + i] > WATER_LEVEL) land += cell;
      else if (isl.pastReef(x, z) < 0) lagoon += cell;
    }
  }
  return { land, lagoon };
}

/** Put the player afloat at (x, z). */
function swimAt(sim: Simulation, x: number, z: number): void {
  const p = sim.state.player;
  p.x = x;
  p.z = z;
  p.y = SWIM_FLOAT_Y;
  p.vx = p.vy = p.vz = 0;
  p.swimming = true;
  p.wading = true;
  p.grounded = false;
}

/** The first point along bearing `a`, out from the coast, that is `out` metres past the reef crest (negative: inside it). */
function seaPoint(t: Terrain, a: number, out: number): { x: number; z: number } {
  const isl = t.island!;
  for (let r = isl.coastAt(a) - 20; r < t.half; r += 0.25) {
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (isl.pastReef(x, z) >= out) return { x, z };
  }
  throw new Error('no sea point');
}

/** A bearing whose coast is plain beach (no headland, cove, spit or islet in the way). */
function openBearing(t: Terrain): number {
  const isl = t.island!;
  for (let k = 0; k < 360; k++) {
    const a = (k / 360) * Math.PI * 2;
    const inner = seaPoint(t, a, -15);
    const deep = seaPoint(t, a, 8);
    if (isl.cliffAt(a) > 0.05 || Math.abs(isl.pastReef(deep.x, deep.z) - 8) > 1.5 || Math.abs(isl.pastReef(inner.x, inner.z) + 15) > 1.5) continue;
    if (t.waterDepth(deep.x, deep.z) < 6 || t.waterDepth(inner.x, inner.z) < 0.8) continue;
    return a;
  }
  throw new Error('no open bearing');
}

describe('the island map', () => {
  it('is the third map on the carousel, with its own save slot, name and place', () => {
    expect(BIOME_IDS).toEqual(['pnw', 'desert', 'island']);
    const b = BIOMES.island;
    expect(b.name).toBe('Tropical Island');
    expect(b.tagline).toMatch(/^Stranded on a tropical island/);
    expect(b.place).toBe('island');
    expect(storageKeys('island')).toEqual({ save: STORAGE_KEYS.save + '.island', snapshot: STORAGE_KEYS.snapshot + '.island' });
  });

  it('has about four times the area of the other maps to explore, on every seed', () => {
    const pnw = getTerrain(42);
    let pnwLand = 0;
    for (let z = -pnw.playHalf; z < pnw.playHalf; z += TERRAIN_CELL) {
      for (let x = -pnw.playHalf; x < pnw.playHalf; x += TERRAIN_CELL) if (pnw.heightAt(x, z) > WATER_LEVEL) pnwLand += TERRAIN_CELL * TERRAIN_CELL;
    }
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'island');
      const { land, lagoon } = areas(t);
      // Land alone is about 4x the other maps' play square, and 4x the forest map's dry land.
      expect(land / OTHER_PLAY_AREA, `seed ${seed}`).toBeGreaterThan(3.5);
      expect(land / OTHER_PLAY_AREA, `seed ${seed}`).toBeLessThan(4.5);
      expect(land / pnwLand, `seed ${seed}`).toBeGreaterThan(3.5);
      // With the swimmable lagoon inside the reef it is about 5x.
      expect((land + lagoon) / OTHER_PLAY_AREA, `seed ${seed}`).toBeGreaterThan(4.3);
      expect(t.size).toBe(960);
    }
  });

  it('has an irregular coast: headlands and bays, a long shoreline for its area, spits and a lagoon islet', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'island');
      const isl = t.island!;
      const radii = Array.from({ length: 720 }, (_, i) => isl.coastAt((i / 720) * Math.PI * 2));
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      expect((Math.max(...radii) - Math.min(...radii)) / mean, `seed ${seed}`).toBeGreaterThan(0.25);
      // Headlands: coast bearings standing out 15 m or more above the stretch of coast around them.
      let heads = 0;
      for (let i = 0; i < 720; i += 4) {
        const around = [-40, 40].map((d) => radii[(i + d + 720) % 720]);
        if (radii[i] > Math.max(...around) + 15 && radii[i] >= radii[(i + 4) % 720] && radii[i] >= radii[(i + 716) % 720]) heads++;
      }
      expect(heads, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      // Shoreline development: the grid shoreline is well over an equal-area circle's (a circle scores 1).
      let edges = 0;
      let land = 0;
      const n = t.verts;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = t.heights[j * n + i] > 0;
          if (a) land++;
          if (a !== t.heights[j * n + i + 1] > 0) edges++;
          if (a !== t.heights[(j + 1) * n + i] > 0) edges++;
        }
      }
      const r = Math.sqrt(land / Math.PI);
      expect(edges / (8 * r), `seed ${seed}`).toBeGreaterThan(1.3);
      expect(isl.spits.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(t.heightAt(isl.islet.x, isl.islet.z), `seed ${seed}`).toBeGreaterThan(0.5);
      // The islet is out in the lagoon, not joined to the island: halfway across the gap is swimmable water.
      const ia = Math.atan2(isl.islet.z, isl.islet.x);
      const gap = Math.hypot(isl.islet.x, isl.islet.z) - isl.islet.r - isl.coastAt(ia);
      expect(gap, `seed ${seed}`).toBeGreaterThan(10);
      const mid = isl.coastAt(ia) + gap / 2;
      expect(t.waterDepth(Math.cos(ia) * mid, Math.sin(ia) * mid), `seed ${seed}`).toBeGreaterThan(0.5);
      expect(isl.pastReef(isl.islet.x, isl.islet.z), `seed ${seed}`).toBeLessThan(-10);
    }
  });

  it('is surrounded by ocean: deep water rings the reef all the way round, inside the world', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'island');
      for (let k = 0; k < 90; k++) {
        const a = (k / 90) * Math.PI * 2;
        const deep = seaPoint(t, a, 12);
        expect(t.waterDepth(deep.x, deep.z), `seed ${seed} bearing ${k}`).toBeGreaterThan(5);
        expect(t.inPlayBounds(deep.x, deep.z, 20), `seed ${seed} bearing ${k}`).toBe(true);
        const edge = { x: Math.cos(a) * (t.half - 2), z: Math.sin(a) * (t.half - 2) };
        expect(t.waterDepth(edge.x, edge.z)).toBeGreaterThan(10);
      }
    }
  });
});

describe('island regions (every seed)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: beach, cove, grassland, jungle, waterfall, streams and pools, and caves`, () => {
      const t = getTerrain(seed, 'island');
      const isl = t.island!;
      const g = getWorldGen(seed, 'island');
      let beach = 0;
      let jungle = 0;
      let plains = 0;
      for (let z = -t.half; z < t.half; z += 4) {
        for (let x = -t.half; x < t.half; x += 4) {
          const h = t.heightAt(x, z);
          if (h <= 0) continue;
          if (h < 1.8 && isl.land(x, z) < 26) beach += 16;
          if (isl.jungle(x, z) > 0.6) jungle += 16;
          if (isl.plains(x, z) > 0.6) plains += 16;
        }
      }
      expect(beach).toBeGreaterThan(30_000);
      expect(jungle).toBeGreaterThan(60_000);
      expect(plains).toBeGreaterThan(30_000);
      // Dense jungle against open grassland with few trees.
      const perHa = (test: (x: number, z: number) => boolean, area: number) => (g.trees.filter((tr) => test(tr.x, tr.z)).length / area) * 10_000;
      const junglePerHa = perHa((x, z) => isl.jungle(x, z) > 0.6, jungle);
      const plainsPerHa = perHa((x, z) => isl.plains(x, z) > 0.6, plains);
      expect(junglePerHa).toBeGreaterThan(80);
      expect(plainsPerHa).toBeLessThan(16);
      expect(junglePerHa / plainsPerHa).toBeGreaterThan(6);

      // The cove: salt water held in by rock walls, open to the sea through a mouth narrower than the cove.
      const c = isl.cove;
      expect(t.lakeAt(c.x, c.z)?.kind).toBe('sea');
      expect(t.waterDepth(c.x, c.z)).toBeGreaterThan(0.8);
      expect(c.w * 2).toBeLessThan(c.r * 2 * 0.75);
      let walls = 0;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        if (dx * c.inX + dz * c.inZ > 0.2) continue;
        const peak = Math.max(...[3, 5, 7, 9].map((d) => t.heightAt(c.x + dx * (c.r + d), c.z + dz * (c.r + d))));
        if (peak > 4) walls++;
      }
      expect(walls).toBeGreaterThanOrEqual(6);
      const head = { x: c.x + c.inX * (c.r + 4), z: c.z + c.inZ * (c.r + 4) };
      expect(t.heightAt(head.x, head.z)).toBeGreaterThan(0);
      expect(t.heightAt(head.x, head.z)).toBeLessThan(3);

      // The waterfall drops at least 12 m from its lip into a fresh plunge pool, down a cliff too steep to climb.
      const w = isl.waterfall;
      expect(t.heightAt(w.x, w.z)).toBeGreaterThan(12);
      expect(w.pool.kind).toBe('plunge');
      expect(t.lakeAt(w.pool.x, w.pool.z)?.drinkable).toBe(true);
      expect(t.waterDepth(w.pool.x, w.pool.z)).toBeGreaterThan(1.5);
      let steepest = 0;
      for (let d = 0.5; d < 8; d += 0.5) steepest = Math.max(steepest, t.slopeAt(w.x + w.dirX * d, w.z + w.dirZ * d));
      expect(steepest).toBeGreaterThan(1.5);

      // Two or more streams of fresh water running to the sea, and three or more pools.
      expect(isl.streams.length).toBeGreaterThanOrEqual(2);
      for (const st of isl.streams) {
        expect(st.pts.length / 2 * 3).toBeGreaterThan(60);
        const k = Math.floor(st.pts.length / 8) * 2;
        expect(t.lakeAt(st.pts[k], st.pts[k + 1])?.drinkable).toBe(true);
        expect(t.waterDepth(st.pts[k], st.pts[k + 1])).toBeGreaterThan(0.5);
        const mouth = t.lakeAt(st.mouthX, st.mouthZ);
        expect(mouth?.kind === 'stream' || mouth?.kind === 'sea').toBe(true);
        const end = st.pts.length - 2;
        expect(t.lakeAt(st.pts[end], st.pts[end + 1])?.kind).toBe('sea');
      }
      expect(t.lakes.length).toBeGreaterThanOrEqual(3);
      for (const p of t.lakes) expect(t.lakeAt(p.x, p.z)?.drinkable, p.kind).toBe(true);

      // Caves: at least two, each with a flat floor, a mouth onto open ground, and loose stones inside.
      expect(isl.caves.length).toBeGreaterThanOrEqual(2);
      for (const cv of isl.caves) {
        expect(t.slopeAt(cv.x, cv.z)).toBeLessThan(0.35);
        expect(Math.abs(t.heightAt(cv.x, cv.z) - cv.floorY)).toBeLessThan(0.3);
        const mx = cv.x + Math.cos(cv.facing) * (cv.r + 2);
        const mz = cv.z + Math.sin(cv.facing) * (cv.r + 2);
        expect(t.heightAt(mx, mz)).toBeGreaterThan(0.2);
        const stones = g.resources.filter((r) => r.kind === 'stonePile' && Math.hypot(r.x - cv.x, r.z - cv.z) < cv.r);
        expect(stones.length).toBeGreaterThanOrEqual(3);
        expect(g.trees.some((tr) => Math.hypot(tr.x - cv.x, tr.z - cv.z) < cv.r)).toBe(false);
      }
    });
  }
});

describe('island water', () => {
  it('the sea is salt: no drinking it and no filling a canteen from it', () => {
    const sim = island();
    const t = sim.terrain;
    const a = openBearing(t);
    const p = seaPoint(t, a, -15);
    teleport(sim, Math.cos(a) * (t.island!.coastAt(a) - 3), Math.sin(a) * (t.island!.coastAt(a) - 3));
    sim.state.gear.push('canteen');
    sim.state.needs.thirst = 40;
    sim.target = { kind: 'water', dist: 1, x: p.x, z: p.z };
    expect(sim.describeTarget()).toMatchObject({ name: 'Lagoon', enabled: false });
    expect(sim.describeTarget()!.action).toMatch(/salt/i);
    sim.perform(sim.target);
    const ev = drain(sim);
    expect(sim.state.needs.thirst).toBe(40);
    expect(sim.state.canteen.lakeWater).toBe(0);
    expect(ev.some((e) => e.type === 'message' && /too salty/i.test(e.text))).toBe(true);
    expect(sim.state.stats.events.drankByHand ?? 0).toBe(0);
    const deep = seaPoint(t, a, 10);
    sim.target = { kind: 'water', dist: 1, x: deep.x, z: deep.z };
    expect(sim.describeTarget()?.name).toBe('Open Ocean');
    // The onboarding's first step waits for fresh water.
    expect(sim.state.objective).toBe(0);
  });

  it('streams and pools are fresh: you drink from them and fill the canteen', () => {
    const sim = island();
    const st = sim.terrain.island!.streams[0];
    const k = Math.floor(st.pts.length / 4) * 2;
    sim.state.needs.thirst = 40;
    sim.target = { kind: 'water', dist: 1, x: st.pts[k], z: st.pts[k + 1] };
    expect(sim.describeTarget()).toMatchObject({ name: 'Stream', action: 'Drink', enabled: true });
    sim.perform(sim.target);
    expect(sim.state.needs.thirst).toBeGreaterThan(40);
    expect(sim.state.objective).toBeGreaterThan(0);
    sim.state.gear.push('canteen');
    const pool = sim.terrain.lakes[0];
    sim.target = { kind: 'water', dist: 1, x: pool.x, z: pool.z };
    expect(sim.describeTarget()?.name).toBe('Waterfall Pool');
    sim.actionCooldown = 0;
    sim.perform(sim.target);
    expect(sim.state.canteen.lakeWater).toBe(BALANCE.carry.canteenCapacity);
  });

  it('a new player starts on a beach a short, walkable way from fresh water, facing it, on every seed', () => {
    for (const seed of SEEDS) {
      const sim = Simulation.newGame(seed, 'island');
      const t = sim.terrain;
      const p = sim.state.player;
      expect(t.heightAt(p.x, p.z), `seed ${seed}`).toBeGreaterThan(0.5);
      expect(t.island!.land(p.x, p.z), `seed ${seed}`).toBeLessThan(30);
      const shore = nearestShore(t, p.x, p.z, 120, true)!;
      expect(shore.dist, `seed ${seed}`).toBeLessThan(24);
      const facing = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
      expect(Math.abs(Math.atan2(Math.sin(facing - Math.atan2(shore.dz, shore.dx)), Math.cos(facing - Math.atan2(shore.dz, shore.dx)))), `seed ${seed}`).toBeLessThan(0.1);
      // Walk there on the grid without swimming or climbing anything too steep.
      const n = t.verts;
      const idx = (x: number, z: number) => Math.round((z + t.half) / TERRAIN_CELL) * n + Math.round((x + t.half) / TERRAIN_CELL);
      const start = idx(p.x, p.z);
      const seen = new Map<number, number>([[start, 0]]);
      const queue = [start];
      let found = -1;
      while (queue.length && found < 0) {
        const cur = queue.shift()!;
        const i = cur % n;
        const j = Math.floor(cur / n);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          const next = nj * n + ni;
          if (seen.has(next)) continue;
          const h0 = t.heights[cur];
          const h1 = t.heights[next];
          if (h1 < -1.1 || Math.abs(h1 - h0) / TERRAIN_CELL > BALANCE.player.maxSlope) continue;
          seen.set(next, seen.get(cur)! + TERRAIN_CELL);
          const x = -t.half + ni * TERRAIN_CELL;
          const z = -t.half + nj * TERRAIN_CELL;
          if (h1 < -0.2 && t.lakeAt(x, z)?.drinkable) {
            found = next;
            break;
          }
          if (seen.get(next)! < 120) queue.push(next);
        }
      }
      expect(found, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(seen.get(found)!, `seed ${seed}`).toBeLessThan(60);
    }
  });
});

describe('island climate (no weather this round)', () => {
  it('thirst drains 1.45x faster than on the other maps, asleep as well as awake', () => {
    const drop = (biome: 'pnw' | 'desert' | 'island') => {
      const sim = biome === 'island' ? island() : Simulation.newGame(42, biome);
      sim.state.animals.length = 0;
      keepAlive(sim);
      sim.timeScale = 60;
      run(sim, 1, {}, 1 / 30);
      return 100 - sim.state.needs.thirst;
    };
    const pnw = drop('pnw');
    expect(drop('desert')).toBeCloseTo(pnw, 3);
    expect(drop('island') / pnw).toBeCloseTo(1.45, 2);
    const a = createNeeds();
    const b = createNeeds();
    a.thirst = b.thirst = 80;
    applySleep(a, { warmthBonus: 0, healthBonus: 0 }, false, 10);
    applySleep(b, { warmthBonus: 0, healthBonus: 0 }, false, 10, true, { thirstMul: BIOMES.island.thirstMultiplier, coldWarmthCost: BIOMES.island.sleepWarmthCost });
    expect((80 - b.thirst) / (80 - a.thirst)).toBeCloseTo(1.45, 2);
  });

  it('nights are warm: the air never drops below 58 warmth, and a night out without a fire costs little', () => {
    for (const hour of [0, 2, 4, 21, 23]) {
      expect(ambientWarmth(hour, BIOMES.island.warmth)).toBeGreaterThanOrEqual(58);
      expect(ambientWarmth(hour, BIOMES.pnw.warmth)).toBeLessThan(20);
    }
    const sim = island();
    sim.devSetHour(21);
    sim.state.needs.warmth = 80;
    sim.timeScale = 60;
    for (let i = 0; i < 8; i++) {
      keepAlive(sim);
      sim.state.needs.warmth = Math.min(sim.state.needs.warmth, 100);
      run(sim, 1, {}, 1 / 30);
    }
    expect(sim.state.needs.warmth).toBeGreaterThanOrEqual(57);
    const n = createNeeds();
    n.warmth = 60;
    applySleep(n, { warmthBonus: 0, healthBonus: 0 }, false, 10, true, { coldWarmthCost: BIOMES.island.sleepWarmthCost });
    expect(n.warmth).toBe(52);
  });

  it('has no rain or storms: a campfire only burns down with its fuel', () => {
    const sim = island();
    sim.state.structures.push({ id: sim.state.nextId++, prefab: 'campfire', x: sim.state.player.x + 3, y: 1, z: sim.state.player.z, rot: 0, fuel: 8 });
    sim.timeScale = 60;
    run(sim, 4, {}, 1 / 30);
    expect(sim.state.structures[0].fuel).toBeCloseTo(4, 1);
  });
});

describe('coconuts', () => {
  /** A palm with nothing else within 9 m, and a clear spot 7 m from it to shoot from. */
  function palmToShoot(sim: Simulation): { i: number; x: number; z: number } {
    const g = sim.gen;
    const t = sim.terrain;
    for (let i = 0; i < g.trees.length; i++) {
      const tr = g.trees[i];
      if (tr.species !== 'palm' || g.trees.some((o, k) => k !== i && Math.hypot(o.x - tr.x, o.z - tr.z) < 9)) continue;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = tr.x + Math.cos(a) * 7;
        const z = tr.z + Math.sin(a) * 7;
        if (t.heightAt(x, z) > 0.4 && t.slopeAt(x, z) < 0.4) return { i, x, z };
      }
    }
    throw new Error('no clear palm');
  }

  function shoot(sim: Simulation): void {
    sim.step(1 / 60, input({ primary: true, primaryPressed: true }, sim));
    for (let k = 0; k < 60; k++) sim.step(1 / 60, input({ primary: true }, sim));
    sim.step(1 / 60, input({ primaryReleased: true }, sim));
    run(sim, 1.5);
  }

  it('an arrow through a palm\'s crown knocks a coconut down to the sand, one at a time', () => {
    const sim = island(7);
    const { i, x, z } = palmToShoot(sim);
    teleport(sim, x, z);
    sim.state.tools.push('bow');
    sim.selectTool('bow');
    give(sim, { arrow: 8 });
    const tree = sim.gen.trees[i];
    const cp = crownPosition(tree, sim.terrain.heightAt(tree.x, tree.z))!;
    expect(sim.state.trees[i].bark).toBe(3);
    for (let n = 1; n <= 3; n++) {
      aimAt(sim, cp.x, cp.y, cp.z);
      keepAlive(sim);
      shoot(sim);
      expect(sim.state.trees[i].bark).toBe(3 - n);
      const nuts = sim.state.drops.filter((d) => d.item === 'coconut');
      expect(nuts).toHaveLength(n);
      for (const d of nuts) {
        expect(Math.hypot(d.x - tree.x, d.z - tree.z)).toBeLessThan(3);
        expect(sim.terrain.heightAt(d.x, d.z)).toBeGreaterThan(0);
      }
    }
    expect(sim.state.stats.events.coconutsShot).toBe(3);
    expect(sim.state.forage).toContain('coconut');
    // Picked clean, it ripens a new crown of coconuts later.
    expect(sim.state.trees[i].barkAt).toBeGreaterThan(sim.state.totalHours);
    const nut = sim.state.drops.find((d) => d.item === 'coconut')!;
    sim.perform({ kind: 'drop', id: nut.id, dist: 1 });
    expect(sim.state.inventory.slots.some((s) => s?.item === 'coconut')).toBe(true);
  });

  it('hands can\'t reach them, and an arrow that misses the crown brings nothing down', () => {
    const sim = island(7);
    const { i, x, z } = palmToShoot(sim);
    teleport(sim, x, z);
    const tree = sim.gen.trees[i];
    sim.perform({ kind: 'tree', index: i, dist: 2 });
    expect(drain(sim).some((e) => e.type === 'needTool' && /bow/.test(e.message))).toBe(true);
    expect(sim.state.trees[i].bark).toBe(3);
    sim.state.tools.push('bow');
    sim.selectTool('bow');
    give(sim, { arrow: 2 });
    aimAt(sim, tree.x, sim.terrain.heightAt(tree.x, tree.z) + 22, tree.z);
    shoot(sim);
    expect(sim.state.trees[i].bark).toBe(3);
    expect(sim.state.drops.some((d) => d.item === 'coconut')).toBe(false);
  });

  it('now and then a coconut lies fallen under a palm, on every seed', () => {
    for (const seed of SEEDS) {
      const g = getWorldGen(seed, 'island');
      const palms = g.trees.filter((t) => t.species === 'palm');
      const fallen = g.resources.filter((r) => r.kind === 'coconut');
      expect(fallen.length, `seed ${seed}`).toBeGreaterThan(20);
      expect(fallen.length / palms.length, `seed ${seed}`).toBeLessThan(0.2);
      for (const c of fallen) expect(palms.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 3), `seed ${seed}`).toBe(true);
    }
  });

  it('a coconut is a drink and food in one, and goes into island dishes', () => {
    expect(ITEMS.coconut.food!.thirst).toBeGreaterThanOrEqual(15);
    expect(ITEMS.coconut.food!.hunger).toBeGreaterThanOrEqual(8);
    const sim = island();
    give(sim, { coconut: 1 });
    Object.assign(sim.state.needs, { thirst: 50, hunger: 50 });
    sim.useSlot(sim.state.inventory.slots.findIndex((s) => s?.item === 'coconut'));
    expect(sim.state.needs.thirst).toBe(50 + ITEMS.coconut.food!.thirst!);
    expect(sim.state.needs.hunger).toBe(50 + ITEMS.coconut.food!.hunger!);
    const uses = recipesFor('island').filter((r) => r.inputs.some((x) => x.item === 'coconut')).map((r) => r.id);
    expect(uses.sort()).toEqual(['coconutBananas', 'coconutFish']);
    const g = getWorldGen(42, 'island');
    const pickup = g.resources.findIndex((r) => r.kind === 'coconut');
    const s2 = island();
    s2.perform({ kind: 'resource', index: pickup, dist: 1 });
    expect(s2.state.inventory.slots.some((sl) => sl?.item === 'coconut')).toBe(true);
    expect(s2.state.resources[pickup].charges).toBe(0);
    expect(s2.state.resources[pickup].respawnAt).toBe(s2.state.totalHours + RESOURCES.coconut.respawnHours);
  });
});

describe('the reef current', () => {
  it('pushes swimmers back past the reef, so nobody gets more than about 12 m out', () => {
    for (const seed of [1, 42, 777]) {
      const sim = island(seed);
      const t = sim.terrain;
      const a = openBearing(t);
      const s0 = seaPoint(t, a, 1);
      swimAt(sim, s0.x, s0.z);
      sim.state.player.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
      let furthest = -Infinity;
      for (let i = 0; i < 40 * 30; i++) {
        keepAlive(sim);
        sim.step(1 / 30, input({ moveZ: 1 }, sim));
        furthest = Math.max(furthest, sim.pastReef);
      }
      expect(furthest, `seed ${seed}`).toBeGreaterThan(8);
      expect(furthest, `seed ${seed}`).toBeLessThan(13);
      expect(drain(sim).some((e) => e.type === 'message' && /current/i.test(e.text))).toBe(true);
    }
  });

  it('is gentle: nothing in the lagoon or the first couple of metres over the crest, and it carries you back inside when you stop', () => {
    const sim = island();
    const t = sim.terrain;
    const a = openBearing(t);
    const lagoon = seaPoint(t, a, -15);
    swimAt(sim, lagoon.x, lagoon.z);
    run(sim, 5);
    expect(Math.hypot(sim.state.player.x - lagoon.x, sim.state.player.z - lagoon.z)).toBeLessThan(0.2);
    const crest = seaPoint(t, a, 1.5);
    swimAt(sim, crest.x, crest.z);
    run(sim, 3);
    expect(Math.abs(sim.pastReef - 1.5)).toBeLessThan(0.3);
    const out = seaPoint(t, a, 10);
    swimAt(sim, out.x, out.z);
    keepAlive(sim);
    run(sim, 10);
    expect(sim.pastReef).toBeLessThan(3);
    // It pushes straight back toward the island.
    expect(Math.hypot(sim.state.player.x, sim.state.player.z)).toBeLessThan(Math.hypot(out.x, out.z));
  });
});

describe('island threats', () => {
  it('wild boars are aggressive like javelinas: a charge out of the jungle that hits hard, but never outruns a sprint', () => {
    const def = SPECIES.boar;
    expect(def.kind === 'prey' && def.territory).toBeTruthy();
    const terr = def.kind === 'prey' ? def.territory! : null!;
    const jav = SPECIES.javelina.kind === 'prey' ? SPECIES.javelina.territory! : null!;
    expect(terr.chargeSpeed).toBeLessThan(BALANCE.player.sprintSpeed);
    expect(def.runSpeed * 1.1).toBeLessThan(BALANCE.player.sprintSpeed);
    expect(terr.damage).toBeGreaterThan(jav.damage);
    expect(terr.radius).toBeGreaterThan(jav.radius);
    const sim = island();
    const p = sim.state.player;
    sim.state.animals.push(createAnimal(900, 'boar', p.x + 8, p.z, new Rng(3), sim.terrain));
    const ev = run(sim, 4);
    const hits = ev.filter((e) => e.type === 'hurt' && e.source === 'boar');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type === 'hurt' && hits[0].amount).toBe(terr.damage);
  });

  it('a fer-de-lance bite is venomous: health keeps draining for a while after the strike', () => {
    const sim = island();
    const p = sim.state.player;
    const d = SPECIES.viper;
    const venom = d.kind === 'prey' ? d.strike!.venom! : null!;
    const snake = createAnimal(901, 'viper', p.x + 1.4, p.z, new Rng(4), sim.terrain);
    sim.state.animals.push(snake);
    const ev = run(sim, 1.5);
    expect(ev.some((e) => e.type === 'hurt' && e.source === 'viper')).toBe(true);
    expect(sim.state.needs.venom?.seconds).toBeGreaterThan(venom.seconds - 2);
    sim.state.animals.length = 0;
    const before = sim.state.needs.health;
    run(sim, 10);
    expect(before - sim.state.needs.health).toBeGreaterThan(venom.perSecond * 8);
    run(sim, venom.seconds);
    expect(sim.state.needs.venom).toBeUndefined();
    const settled = sim.state.needs.health;
    run(sim, 5);
    expect(sim.state.needs.health).toBeGreaterThanOrEqual(settled);
    // Venom can finish you off: health reaching 0 is a death by viper.
    sim.state.needs.health = 2;
    sim.envenom(1, 10, 45);
    run(sim, 4);
    expect(sim.state.dead).toBe(true);
    expect(sim.state.deathCause).toBe('viper');
  });

  it('box jellyfish drift in the shallows and sting only someone in the water', () => {
    for (const seed of [42, 777]) {
      const sim = island(seed);
      const t = sim.terrain;
      const a = openBearing(t);
      const isl = t.island!;
      // Every day-1 jellyfish floats in the sunny shallows inside the reef.
      const world = Simulation.newGame(seed, 'island');
      for (const j of world.state.animals.filter((x) => x.species === 'jellyfish')) {
        expect(t.waterDepth(j.x, j.z)).toBeLessThan(2.4);
        expect(isl.pastReef(j.x, j.z)).toBeLessThan(-6);
      }
      // On dry sand, even with one right beside you: nothing.
      const sand = { x: Math.cos(a) * (isl.coastAt(a) - 6), z: Math.sin(a) * (isl.coastAt(a) - 6) };
      expect(t.heightAt(sand.x, sand.z)).toBeGreaterThan(0.2);
      teleport(sim, sand.x, sand.z);
      const jelly = createAnimal(902, 'jellyfish', sand.x + 0.6, sand.z, new Rng(5), t);
      sim.state.animals = [jelly];
      const onLand = run(sim, 0.5);
      expect(onLand.some((e) => e.type === 'hurt' && e.source === 'jellyfish'), `seed ${seed}`).toBe(false);
      // Wading or swimming in the shallows next to it: stung.
      const wade = seaPoint(t, a, -isl.reefAt(a) + 6);
      expect(isHabitable(t, 'jellyfish', wade.x, wade.z), `seed ${seed}`).toBe(true);
      teleport(sim, wade.x, wade.z);
      Object.assign(jelly, { x: wade.x + 0.4, z: wade.z, homeX: wade.x + 0.4, homeZ: wade.z, cooldown: 0 });
      const inWater = run(sim, 1);
      expect(sim.state.player.wading || sim.state.player.swimming, `seed ${seed}`).toBe(true);
      expect(inWater.some((e) => e.type === 'hurt' && e.source === 'jellyfish'), `seed ${seed}`).toBe(true);
    }
    const jf = SPECIES.jellyfish;
    expect(jf.kind === 'prey' && jf.drift && jf.fearRadius === 0).toBeTruthy();
    expect(jf.drops).toHaveLength(0);
  });

  it('tiger sharks stay in the deep water past the reef, bite a swimmer out there, and never reach the lagoon', () => {
    const sim = island(42);
    const t = sim.terrain;
    const a = openBearing(t);
    const out = seaPoint(t, a, 6);
    const lagoon = seaPoint(t, a, -12);
    const shark = createAnimal(903, 'shark', seaPoint(t, a + 0.08, 16).x, seaPoint(t, a + 0.08, 16).z, new Rng(6), t);
    sim.state.animals = [shark];
    // A swimmer inside the reef: the shark can't get to them.
    let deepest = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      swimAt(sim, lagoon.x, lagoon.z);
      keepAlive(sim);
      sim.step(1 / 30, input({}, sim));
      deepest = Math.min(deepest, t.island!.pastReef(shark.x, shark.z));
    }
    expect(drain(sim).some((e) => e.type === 'hurt' && e.source === 'shark')).toBe(false);
    expect(deepest).toBeGreaterThan(4);
    // Out past the reef it comes for you (the test holds the swimmer there against the current).
    let bitten = false;
    for (let i = 0; i < 60 * 30 && !bitten; i++) {
      swimAt(sim, out.x, out.z);
      keepAlive(sim);
      sim.step(1 / 30, input({}, sim));
      bitten = sim.peekEvents().some((e) => e.type === 'hurt' && e.source === 'shark');
      deepest = Math.min(deepest, t.island!.pastReef(shark.x, shark.z));
    }
    expect(bitten).toBe(true);
    expect(deepest).toBeGreaterThan(4);
    expect(SHARK_HEARING).toBeGreaterThan(100);
    expect(SPECIES.shark.runSpeed).toBeGreaterThan(BALANCE.player.swimSpeed);
  });

  it('every shark in a real world keeps to deep water over a long spell of play', () => {
    const sim = Simulation.newGame(777, 'island');
    const sharks = () => sim.state.animals.filter((x) => x.species === 'shark');
    expect(sharks().length).toBe(BIOMES.island.predatorTargets(1).shark);
    for (let i = 0; i < 90 * 20; i++) {
      keepAlive(sim);
      sim.step(1 / 20, input({}, sim));
      if (i % 20 === 0) for (const s of sharks()) expect(sim.terrain.island!.pastReef(s.x, s.z)).toBeGreaterThan(4);
    }
    expect(BIOMES.island.predatorTargets(3).shark).toBe(3);
  });

  it('day 1 holds the island\'s animals where they live: fish in fresh or reef water, goats on the grassland, boars and vipers in the jungle, crabs on the beach', () => {
    for (const seed of [1, 42]) {
      const sim = Simulation.newGame(seed, 'island');
      const isl = sim.terrain.island!;
      const count = (sp: SpeciesId) => sim.state.animals.filter((a) => a.species === sp).length;
      for (const p of BIOMES.island.prey) expect(count(p.species), `${seed} ${p.species}`).toBe(p.count);
      const where = (a: AnimalState) => ({ fresh: isl.waterAt(a.x, a.z).kind !== 'sea', past: isl.pastReef(a.x, a.z), jungle: isl.jungle(a.x, a.z), plains: isl.plains(a.x, a.z), land: isl.land(a.x, a.z) });
      for (const a of sim.state.animals) {
        const w = where(a);
        if (a.species === 'fish') expect(w.fresh).toBe(true);
        if (a.species === 'reefFish' || a.species === 'jellyfish') expect(!w.fresh && w.past < 0).toBe(true);
        if (a.species === 'shark') expect(w.past).toBeGreaterThan(4);
        if (a.species === 'goat') expect(w.plains).toBeGreaterThan(0.5);
        if (a.species === 'boar') expect(w.jungle).toBeGreaterThan(0.5);
        if (a.species === 'viper') expect(w.jungle).toBeGreaterThan(0.6);
        if (a.species === 'crab') expect(w.land).toBeLessThan(26);
      }
    }
  });
});

describe('island food, fishing and the round 10 systems', () => {
  it('fish are the main meat: they outnumber the land game, and every kind of island water can be fished', () => {
    const prey = BIOMES.island.prey;
    const fish = prey.filter((p) => SPECIES[p.species].habitat === 'water' && SPECIES[p.species].drops.some((d) => d.item === 'rawFish')).reduce((n, p) => n + p.count, 0);
    const game = prey.filter((p) => SPECIES[p.species].habitat === 'land' && SPECIES[p.species].drops.some((d) => d.item === 'rawMeat')).reduce((n, p) => n + p.count, 0);
    expect(fish).toBeGreaterThan(game);
    const sim = island();
    const isl = sim.terrain.island!;
    for (const [x, z] of [[isl.cove.x, isl.cove.z], [isl.streams[0].pts[20], isl.streams[0].pts[21]], [seaPoint(sim.terrain, openBearing(sim.terrain), -14).x, seaPoint(sim.terrain, openBearing(sim.terrain), -14).z]]) {
      expect(sim.fishableAt(x, z)).toBe(true);
    }
  });

  it('boars and goats are skinned then butchered with the knife; junglefowl, crabs and vipers go straight to butchering', () => {
    const sim = island();
    sim.state.tools.push('knife');
    sim.selectTool('knife');
    const p = sim.state.player;
    for (const species of ['boar', 'goat', 'junglefowl', 'crab', 'viper'] as SpeciesId[]) {
      const c = { id: sim.state.nextId++, species, x: p.x + 1, y: p.y, z: p.z, rot: 0, remaining: SPECIES[species].drops.map((d) => ({ ...d })), expiresAt: sim.state.totalHours + 24 };
      sim.state.carcasses.push(c);
      const hide = SPECIES[species].drops.some((d) => d.item === 'hide');
      expect(carcassStep(c)).toBe(hide ? 'skin' : 'butcher');
      sim.perform({ kind: 'carcass', id: c.id, dist: 1 });
      if (hide) {
        expect(sim.state.carcasses.find((x) => x.id === c.id)?.skinned).toBe(true);
        sim.actionCooldown = 0;
        sim.perform({ kind: 'carcass', id: c.id, dist: 1 });
      }
      expect(sim.state.carcasses.some((x) => x.id === c.id)).toBe(false);
      drain(sim);
    }
    const s2 = island();
    s2.state.carcasses.push({ id: 5000, species: 'boar', x: s2.state.player.x + 1, y: 1, z: s2.state.player.z, rot: 0, remaining: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }], expiresAt: 99 });
    s2.target = { kind: 'carcass', id: 5000, dist: 1 };
    expect(s2.describeTarget()).toMatchObject({ enabled: false, action: 'Needs a knife' });
  });

  it('follows the day-1 crafting limit: the Beach Skewer opens at the cooking step, the rest tomorrow', () => {
    dayOneLimit(true);
    const sim = island();
    expect(lockedToday(sim.state, 'axe')).toBe(true);
    expect(sim.canCraft('beachSkewer').reason).toBe('tomorrow');
    sim.state.objective = OBJECTIVES.findIndex((o) => o.id === 'skewer');
    expect(lockedToday(sim.state, 'beachSkewer')).toBe(false);
    expect(lockedToday(sim.state, 'coconutFish')).toBe(true);
    sim.devNextMorning();
    run(sim, 0.1);
    expect(lockedToday(sim.state, 'coconutFish')).toBe(false);
    dayOneLimit(false);
  });

  it('the onboarding is worded for the island and completes on island food and animals', () => {
    const sim = island();
    expect(sim.currentObjective()?.title).toMatch(/fresh water/);
    for (const o of OBJECTIVES) if (o.desert) expect(o.island, o.id).toBeDefined();
    sim.state.stats.gathered.lakeWater = 1;
    sim.state.stats.crafted.campfire = 1;
    sim.state.stats.gathered.seaGrapes = 2;
    sim.state.stats.gathered.coconut = 1;
    sim.state.stats.crafted.beachSkewer = 1;
    sim.state.stats.events.fuelAdded = 2;
    run(sim, 0.1);
    expect(OBJECTIVES[sim.state.objective].id).toBe('axe');
  });

  it('every island recipe uses island or shared ingredients, and the island trees give sensible wood', () => {
    const island = new Set(['seaGrapes', 'purslane', 'banana', 'breadfruit', 'taro', 'coconut', 'rawFish', 'rawMeat', 'boiledWater', 'stick']);
    for (const r of recipesFor('island').filter((x) => x.biome === 'island')) {
      for (const i of r.inputs) expect(island.has(i.item), `${r.id}: ${i.item}`).toBe(true);
    }
    expect(TREES.palm.logs).toBe(2);
    expect(TREES.kukui.logs).toBe(3);
    expect(TREES.treeFern.logs).toBe(1);
    expect(TREES.hau.bark).toBeGreaterThan(0);
  });
});

describe('island saves and multiplayer', () => {
  it('an island run saves in its own slot, and loading it rebuilds the same island', () => {
    const storage = new MemoryStorage();
    const rm = new RunManager(storage, () => 5150);
    rm.selectBiome('island');
    const sim = rm.newRun();
    sim.state.trees[3].bark = 1;
    sim.state.totalHours += 5;
    rm.save(sim);
    expect(storage.getItem(STORAGE_KEYS.save + '.island')).not.toBeNull();
    expect(storage.getItem(STORAGE_KEYS.save)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.save + '.desert')).toBeNull();
    const back = deserializeState(serializeState(sim.state))!;
    expect(back.biome).toBe('island');
    expect(back.trees[3].bark).toBe(1);
    expect(rm.loadCurrent('island')!.state.totalHours).toBeCloseTo(sim.state.totalHours, 6);
    expect(rm.hasContinue('island')).toBe(true);
    expect(rm.hasContinue('pnw')).toBe(false);
  });

  it('an island server is listed as the island, and a guest joins the host\'s island with its coconuts in sync', async () => {
    const sim = Simulation.newGame(4244, 'island');
    sim.state.animals.length = 0;
    const hub = new MemoryHub(true);
    const h = new HostSession(new LocalTransport(hub.bus()), sim, { name: 'Anna', avatar: 'f' }, "Anna's camp", 'camp1');
    await h.start();
    hub.flush();
    const lists: ServerInfo[][] = [];
    const watcher = new LobbyWatcher(new LocalTransport(hub.bus()), (l) => lists.push(l));
    await watcher.start();
    hub.flush();
    expect(lists.at(-1)?.[0]).toMatchObject({ sid: 'camp1', map: 'island' });
    expect(takeSnapshot(sim).b).toBe('island');
    const g = new GuestSession(new LocalTransport(hub.bus()), { name: 'Ben', avatar: 'm' }, 'camp1');
    await g.start();
    const pump = (n: number) => {
      for (let i = 0; i < n; i++) {
        hub.flush();
        h.update(0.05);
        g.update(0.05);
      }
      hub.flush();
    };
    pump(40);
    expect(g.joined).toBe(true);
    expect(g.sim!.biome).toBe('island');
    expect(g.sim!.state.seed).toBe(4244);
    expect(g.sim!.terrain.island!.caves.length).toBe(sim.terrain.island!.caves.length);
    // A coconut knocked down on the host shows up for the guest (the palm's crown and the fallen nut).
    const palm = sim.gen.trees.findIndex((t) => t.species === 'palm');
    sim.state.trees[palm].bark = 2;
    sim.devGive('stick', 1);
    sim.state.drops.push({ id: sim.state.nextId++, item: 'coconut', count: 1, x: sim.gen.trees[palm].x + 1, y: 1, z: sim.gen.trees[palm].z });
    sim.worldVersion++;
    pump(20);
    expect(g.sim!.state.trees[palm].bark).toBe(2);
    expect(g.sim!.state.drops.some((d) => d.item === 'coconut')).toBe(true);
    watcher.close();
  });
});
