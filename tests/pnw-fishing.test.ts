import { trainSkill, buildFresh, drain, give, keepAlive, run, teleport } from './helpers';
import { RECIPE_BY_ID, recipesFor } from '../src/data/recipes';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { FISHING_CATCHES, type FishingCatch } from '../src/data/fishing';
import { ITEMS, type ItemId } from '../src/data/items';
import { OBJECTIVES } from '../src/data/objectives';
import { WorldTracker, applyState, stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import { chooseFishingCatch, fishingPoolAt } from '../src/sim/fishing';
import { countItem } from '../src/sim/inventory';
import { MemoryStorage, RunManager } from '../src/sim/run';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { PNW_MIN_FISHABLE_LAKE_RADIUS, pnwLakeHoldsFish, Terrain } from '../src/sim/terrain';
import { itemIcon } from '../src/ui/icons';

const F = BALANCE.fishing;
const SEEDS = [0, 1, 2, 3, 7, 11, 42, 99, 777, 2024, 31337, 20260929, 0x7fffffff, 0xffffffff];
const RAW_FISH: ItemId[] = ['rawFish', 'rawBass', 'rawSalmon'];

function atLake(generation: 1 | 2 = 2, lakeIndex = 0) {
  const sim = Simulation.newGame(42, 'pnw', generation);
  sim.state.animals = []; sim.state.spawnCheckAt = Infinity;
  sim.state.tools.push('rod'); sim.selectTool('rod');
  sim.state.skills.fishing = BALANCE.skills.thresholds.at(-1)!;
  sim.state.toolLevels.rod = 3;
  const lake = sim.terrain.lakes[lakeIndex];
  let radius = 0;
  while (sim.terrain.heightAt(lake.x + radius, lake.z) < 0.3) radius += 0.25;
  teleport(sim, lake.x + radius, lake.z);
  sim.state.player.yaw = Math.PI / 2; sim.state.player.pitch = 0;
  keepAlive(sim); drain(sim);
  return sim;
}

function castToBite(sim: Simulation) {
  run(sim, 1 / 60, { primary: true, primaryPressed: true });
  run(sim, F.fullCharge, { primary: true });
  run(sim, 1 / 60, { primaryReleased: true });
  for (let t = 0; t < F.flightSeconds + F.biteWait[1] + 1 && sim.fishing?.phase !== 'bite'; t += 1 / 60) run(sim, 1 / 60);
  expect(sim.fishing?.phase).toBe('bite');
}

function strike(sim: Simulation) {
  const events = run(sim, 1 / 60, { primary: true, primaryPressed: true });
  keepAlive(sim); run(sim, 0.5);
  return events;
}

describe('PNW fishable lakes and catch habitats', () => {
  for (const generation of [1, 2] as const) {
    it.each(SEEDS)('generation ' + generation + ', seed %i: at least two fishing bodies, with all three species only in the main lake', (seed) => {
      const sim = Simulation.newGame(seed, 'pnw', generation), t = sim.terrain;
      expect(t.fishLakes.length).toBeGreaterThanOrEqual(2);
      for (const [i, lake] of t.lakes.entries()) {
        expect(lake.r).toBeGreaterThanOrEqual(PNW_MIN_FISHABLE_LAKE_RADIUS);
        expect(sim.fishableAt(lake.x, lake.z)).toBe(true);
        expect(fishingPoolAt(t, lake.x, lake.z)).toEqual(i === 0 ? ['trout', 'bass', 'salmon'] : ['trout']);
        // Cast-range water exists from a dry shore on each body, not only at an inaccessible centre.
        let radius = 0;
        while (t.heightAt(lake.x + radius, lake.z) < 0.3) radius += 0.25;
        const x = lake.x + radius - F.maxCast;
        expect(t.inPlayBounds(lake.x + radius, lake.z)).toBe(true);
        expect(sim.fishableAt(x, lake.z)).toBe(true);
        expect(fishingPoolAt(t, x, lake.z)).toEqual(i === 0 ? ['trout', 'bass', 'salmon'] : ['trout']);
      }
    });
  }

  it('keeps trout in the connected stream, including the main-lake shoreline tolerance, without leaking bass or salmon', () => {
    const t = new Terrain(42), layout = t.pnw!, main = t.lakes[0];
    let streamPoints = 0, mouthPoints = 0;
    const pts = layout.stream.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) for (let f = 0; f <= 1; f += 0.02) {
      const x = pts[i] + (pts[i + 2] - pts[i]) * f, z = pts[i + 1] + (pts[i + 3] - pts[i + 1]) * f;
      const distance = Math.hypot(x - main.x, z - main.z), shore = layout.shoreRadius(main, Math.atan2(z - main.z, x - main.x));
      if (distance <= shore || t.lakeAt(x, z) === t.lakes[1] || t.waterDepth(x, z) <= F.minDepth) continue;
      expect(fishingPoolAt(t, x, z)).toEqual(['trout']); streamPoints++;
      if (t.lakeAt(x, z) === main) mouthPoints++;
    }
    expect(streamPoints).toBeGreaterThan(30); expect(mouthPoints).toBeGreaterThan(0);
  });

  it('rejects a pond below the minimum size even when its centre is deep, and excludes it from trout spawns', () => {
    const t = new Terrain(42), pond = t.lakes[1];
    expect(t.waterDepth(pond.x, pond.z)).toBeGreaterThan(F.minDepth);
    pond.r = PNW_MIN_FISHABLE_LAKE_RADIUS - 0.01;
    expect(pnwLakeHoldsFish(pond)).toBe(false);
    expect(fishingPoolAt(t, pond.x, pond.z)).toEqual([]);
    pond.r = PNW_MIN_FISHABLE_LAKE_RADIUS;
    expect(pnwLakeHoldsFish(pond)).toBe(true);
    expect(fishingPoolAt(t, pond.x, pond.z)).toEqual(['trout']);
    pond.fish = false;
    expect(fishingPoolAt(t, pond.x, pond.z)).toEqual([]);
    pond.fish = true; pond.drinkable = false;
    expect(fishingPoolAt(t, pond.x, pond.z)).toEqual([]);
  });

  it('keeps the existing minimum depth, dry-land and winter restrictions', () => {
    const sim = atLake(), lake = sim.terrain.lakes[0], t = sim.terrain;
    const shore = t.pnw!.shoreRadius(lake, 0);
    expect(t.waterDepth(lake.x + shore - 0.25, lake.z)).toBeLessThan(F.minDepth);
    expect(sim.fishableAt(lake.x + shore - 0.25, lake.z)).toBe(false);
    expect(sim.fishableAt(sim.state.player.x, sim.state.player.z)).toBe(false);
    sim.devSetSeason('winter');
    expect(sim.fishableAt(lake.x, lake.z)).toBe(false);
    sim.devSetSeason('spring');
    expect(sim.fishableAt(lake.x, lake.z)).toBe(true);
  });

  it('preserves desert and island fishing pools and their single-species RNG sequence', () => {
    const desert = new Terrain(42, 'desert');
    for (const lake of desert.lakes) expect(fishingPoolAt(desert, lake.x, lake.z)).toEqual(lake.fish === false ? [] : ['trout']);
    const island = new Terrain(42, 'island');
    for (const lake of [...island.lakes, island.island!.cove, { x: island.playHalf - 1, z: 0 }]) {
      expect(fishingPoolAt(island, lake.x, lake.z)).toEqual(island.lakeAt(lake.x, lake.z)?.kind === 'sea' ? ['parrotfish'] : ['goby']);
    }
    const rng = new Rng(99), before = rng.s;
    expect(chooseFishingCatch(['trout'], rng)).toBe('trout'); expect(rng.s).toBe(before);
    expect(chooseFishingCatch([], rng)).toBeNull(); expect(rng.s).toBe(before);
  });
});

describe('PNW rod catches, rewards and cooking', () => {
  it.each([1, 2] as const)('generation %i: real casts produce all three named catches in the large lake', (generation) => {
    const sim = atLake(generation), catches = new Set<FishingCatch>();
    // Stay within a normal pole's 30-use lifespan, including its existing slow time decay.
    for (let i = 0; i < 24; i++) {
      castToBite(sim);
      const species = sim.fishing!.catch!;
      expect(fishingPoolAt(sim.terrain, sim.fishing!.x, sim.fishing!.z)).toContain(species);
      const events = strike(sim);
      if (events.some((e) => e.type === 'fishDone' && e.result === 'caught')) {
        catches.add(species);
        const fish = FISHING_CATCHES[species];
        expect(events.some((e) => e.type === 'gathered' && e.item === fish.item && e.source === 'fishing')).toBe(true);
        expect(events.some((e) => e.type === 'message' && e.text.includes(`a ${fish.word}!`))).toBe(true);
      }
      sim.state.inventory.slots.fill(null);
    }
    expect([...catches].sort()).toEqual(['bass', 'salmon', 'trout']);
  });

  it('secondary-lake casts always hook trout, independent of the nearby player or main lake', () => {
    const sim = atLake(2, 1);
    for (let i = 0; i < 8; i++) {
      castToBite(sim); expect(sim.fishing!.catch).toBe('trout');
      const events = strike(sim);
      expect(events.every((e) => e.type !== 'gathered' || (e.item !== 'rawBass' && e.item !== 'rawSalmon'))).toBe(true);
    }
  });

  it.each(['bass', 'salmon'] as const)('does not allow a %s bite outside the main lake', (species) => {
    const sim = atLake(2, 1);
    castToBite(sim); sim.fishing!.catch = species;
    const events = strike(sim);
    expect(events.some((e) => e.type === 'fishDone' && e.result === 'reeled')).toBe(true);
    expect(sim.state.stats.events.fishCaught ?? 0).toBe(0);
    expect(countItem(sim.state.inventory, FISHING_CATCHES[species].item)).toBe(0);
  });

  it.each(['bass', 'salmon'] as const)('a full pack drops the caught %s at the player feet with the correct item', (species) => {
    const sim = atLake();
    sim.state.inventory.slots.fill({ item: 'stone', count: ITEMS.stone.stack });
    for (let i = 0; i < 40 && !sim.state.drops.length; i++) {
      castToBite(sim); sim.fishing!.catch = species; strike(sim);
    }
    expect(sim.state.drops).toHaveLength(1);
    const drop = sim.state.drops[0];
    expect(drop.item).toBe(FISHING_CATCHES[species].item);
    expect([drop.x, drop.z]).toEqual([sim.state.player.x, sim.state.player.z]);
    sim.state.inventory.slots[0] = null;
    sim.perform({ kind: 'drop', id: drop.id, dist: 1 });
    expect(countItem(sim.state.inventory, drop.item)).toBe(1);
  });

  it.each([['rawBass', 'grilledBass'], ['rawSalmon', 'grilledSalmon']] as const)('grills %s into %s at a lit campfire and supports the existing fish objective', (raw, grilled) => {
    const sim = Simulation.newGame(42);
    give(sim, { [raw]: 1 });
    sim.state.stats.crafted.rod = 1;
    trainSkill(sim, 'cooking', RECIPE_BY_ID[grilled].requiredLevel);
    expect(sim.canCraft(grilled)).toEqual({ ok: false, reason: 'station' });
    buildFresh(sim, 'campfire');
    expect(sim.craft(grilled).ok).toBe(true);
    expect(countItem(sim.state.inventory, raw)).toBe(0);
    expect(countItem(sim.state.inventory, grilled)).toBe(1);
    const objective = OBJECTIVES.find((o) => o.id === 'fish')!;
    expect(objective.done(sim.state)).toBe(true);
    expect(objective.needs(sim.state).slice(-2).map((n) => n.have)).toEqual([1, 1]);
    sim.state.needs.hunger = 40;
    expect(sim.useSlot(sim.state.inventory.slots.findIndex((s) => s?.item === grilled))).toBe(true);
    expect(sim.state.needs.hunger).toBe(60);
  });

  it('offers the two grilling recipes only on PNW and uses the existing bass/salmon artwork', () => {
    for (const biome of ['desert', 'island'] as const) {
      expect(recipesFor(biome).some((r) => r.id === 'grilledBass' || r.id === 'grilledSalmon')).toBe(false);
      expect(Simulation.newGame(42, biome).canCraft('grilledBass').reason).toBe('unknown');
    }
    expect(itemIcon('rawBass')).toContain('/icons/additional-icons/fish-bass.png');
    expect(itemIcon('rawSalmon')).toContain('/icons/additional-icons/fish-salmon.png');
  });

  it.each([1, 2] as const)('generation %i: species items, meals and eligible lakes survive Continue/Retry/Restart without changing geometry', (generation) => {
    const rm = new RunManager(new MemoryStorage(), () => 42), sim = rm.newRun(42, generation);
    give(sim, { rawFish: 1, rawBass: 2, rawSalmon: 3, grilledBass: 1, grilledSalmon: 1 });
    sim.state.trees[0].hp = 1; rm.save(sim); rm.writeSnapshot(sim);
    for (const loaded of [rm.loadCurrent()!, rm.retryDay(), new Simulation(deserializeState(serializeState(sim.state))!)]) {
      expect(loaded.terrain).toBe(sim.terrain); expect(loaded.gen).toBe(sim.gen);
      expect(loaded.state.inventory).toEqual(sim.state.inventory);
      expect(loaded.state.trees[0].hp).toBe(1);
      expect(fishingPoolAt(loaded.terrain, loaded.terrain.lakes[0].x, loaded.terrain.lakes[0].z)).toEqual(['trout', 'bass', 'salmon']);
      expect(fishingPoolAt(loaded.terrain, loaded.terrain.lakes[1].x, loaded.terrain.lakes[1].z)).toEqual(['trout']);
    }
    expect(rm.restartFromDay1().terrain).toBe(sim.terrain);
    expect(RAW_FISH.map((id) => countItem(sim.state.inventory, id))).toEqual([1, 2, 3]);
  });

  it('shares new species drops through real host/guest world deltas and late-join snapshots', () => {
    const host = atLake(), tracker = new WorldTracker(host, true);
    host.state.drops.push({ id: host.state.nextId++, item: 'rawSalmon', count: 1, x: host.state.player.x, y: host.state.player.y, z: host.state.player.z });
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host)));
    expect(guest.state.drops[0].item).toBe('rawSalmon');
    host.state.drops.push({ ...host.state.drops[0], id: host.state.nextId++, item: 'rawBass' });
    for (const delta of tracker.diff(host, false)) applyState(guest, delta);
    expect(guest.state.drops.map((d) => d.item)).toEqual(['rawSalmon', 'rawBass']);
  });
});
