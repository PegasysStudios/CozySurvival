import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { BIOMES, speciesName } from '../src/data/biomes';
import { TREES, type TreeSpecies } from '../src/data/resources';
import { SPECIES, type SpeciesId } from '../src/data/species';
import { createAnimal, findSpawnPoint, updateAnimal } from '../src/sim/animals';
import { countItem } from '../src/sim/inventory';
import { createNewState, Simulation } from '../src/sim/simulation';
import type { AnimalMode, AnimalState } from '../src/sim/state';
import { getTerrain, isDrinkable, type Lake } from '../src/sim/terrain';
import { ambientWarmth } from '../src/sim/time';
import { getWorldGen } from '../src/sim/worldgen';
import { animalEnv, drain, fakeTerrain, placeStructure, run, teleport } from './helpers';

const SEEDS = Array.from({ length: 40 }, (_, i) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);
const WORLD_SEEDS = SEEDS.slice(0, 8);
const area = (lakes: readonly Lake[]) => lakes.reduce((a, l) => a + Math.PI * l.r * l.r, 0);
/** Total hours for a clock hour on a given day (days start at 6 AM). */
const at = (day: number, hour: number) => (day - 1) * 24 + ((hour - BALANCE.time.dayStartHour + 24) % 24);

function quietDesert(seed = 42): Simulation {
  const sim = Simulation.newGame(seed, 'desert');
  sim.state.animals.length = 0;
  sim.state.spawnCheckAt = Infinity;
  return sim;
}

const lakeOf = (sim: Simulation, kind: Lake['kind']) => sim.terrain.lakes.find((l) => l.kind === kind)!;

function clickWater(sim: Simulation, l: Lake): void {
  sim.target = { kind: 'water', dist: 1, x: l.x, z: l.z };
  sim.actionCooldown = 0;
  sim.perform(sim.target);
}

describe('biome config', () => {
  it('the Pacific Northwest keeps its original numbers', () => {
    const p = BIOMES.pnw;
    expect(p.warmth).toMatchObject({ day: BALANCE.needs.warmth.day, night: BALANCE.needs.warmth.night, rate: BALANCE.needs.warmthRatePerHour, coolRate: BALANCE.needs.warmthRatePerHour });
    expect(p.prey.map((s) => [s.species, s.count])).toEqual([['rabbit', 18], ['deer', 8], ['fish', 14]]);
    expect(p.predators.map((s) => s.species)).toEqual(['wolf', 'bear']);
    expect(p.storageSuffix).toBe('');
  });

  it('the desert has 8 huntable land animals, including a stalking cougar and a black bear', () => {
    const d = BIOMES.desert;
    const land = [...d.prey.map((s) => s.species), ...d.predators.map((s) => s.species)].filter((s) => s !== 'fish');
    expect(new Set(land)).toEqual(new Set(['jackrabbit', 'quail', 'lizard', 'roadrunner', 'javelina', 'snake', 'cougar', 'bear']));
    expect(land.length).toBeGreaterThanOrEqual(6);
    expect(land.length).toBeLessThanOrEqual(8);
    for (const s of land) expect(SPECIES[s].drops.length, s).toBeGreaterThan(0);
    expect(speciesName('fish', 'desert')).toBe('Gila Trout');
    expect(speciesName('fish', 'pnw')).toBe(SPECIES.fish.name);
  });
});

describe('desert water', () => {
  it('a fraction of the Pacific Northwest water on every seed: at most 3 small pools and no big lakes', () => {
    for (const seed of SEEDS) {
      const d = getTerrain(seed, 'desert').lakes;
      const p = getTerrain(seed, 'pnw').lakes;
      expect(d.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      expect(Math.max(...d.map((l) => l.r)), `seed ${seed}`).toBeLessThan(7.5);
      expect(Math.max(...p.map((l) => l.r))).toBeGreaterThan(26);
      expect(area(d) / area(p), `seed ${seed}`).toBeLessThan(0.12);
    }
  });

  it('every world has a drinkable spring a short walk from the start, open and full of water', () => {
    for (const seed of SEEDS) {
      const t = getTerrain(seed, 'desert');
      expect(t.heightAt(t.spawn.x, t.spawn.z), `seed ${seed} spawn is dry`).toBeGreaterThan(0.3);
      const drinkable = t.lakes.filter(isDrinkable);
      expect(drinkable.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      const spring = t.lakes.find((l) => l.kind === 'spring')!;
      expect(isDrinkable(spring)).toBe(true);
      expect(Math.hypot(spring.x - t.spawn.x, spring.z - t.spawn.z), `seed ${seed}`).toBeLessThan(40);
      for (const l of drinkable) {
        expect(t.heightAt(l.x, l.z), `seed ${seed} ${l.kind} holds water`).toBeLessThan(-0.5);
        expect(t.landformAt(l.x, l.z).rock, `seed ${seed} ${l.kind} not under a mesa`).toBeLessThan(0.05);
      }
      expect(t.fishLakes.every((l) => l.kind === 'spring')).toBe(true);
    }
  });

  it('every world also has one undrinkable alkali pool', () => {
    for (const seed of SEEDS) {
      const alkali = getTerrain(seed, 'desert').lakes.filter((l) => l.kind === 'alkali');
      expect(alkali, `seed ${seed}`).toHaveLength(1);
      expect(isDrinkable(alkali[0])).toBe(false);
    }
  });

  it('the Pacific Northwest lakes stay drinkable and are not tagged', () => {
    for (const l of getTerrain(42, 'pnw').lakes) {
      expect(isDrinkable(l)).toBe(true);
      expect(l.kind).toBeUndefined();
    }
  });
});

describe('undrinkable water', () => {
  it('the first sip of alkali water costs thirst and teaches you; after that it is refused', () => {
    const sim = quietDesert();
    const alkali = lakeOf(sim, 'alkali');
    sim.target = { kind: 'water', dist: 1, x: alkali.x, z: alkali.z };
    expect(sim.describeTarget()?.name).toBe('Milky Pool');
    sim.state.needs.thirst = 60;
    clickWater(sim, alkali);
    expect(sim.state.needs.thirst).toBeCloseTo(60 - BALANCE.water.alkaliTasteThirst);
    expect(sim.knowsAlkali).toBe(true);
    expect(drain(sim).some((e) => e.type === 'message' && e.tone === 'warn' && /alkali/i.test(e.text))).toBe(true);
    expect(sim.describeTarget()?.name).toBe('Alkali Pool');

    clickWater(sim, alkali);
    expect(sim.state.needs.thirst).toBeCloseTo(60 - BALANCE.water.alkaliTasteThirst);
    expect(drain(sim).some((e) => e.type === 'message' && /too salty/.test(e.text))).toBe(true);
    expect(sim.state.stats.events.drankByHand ?? 0).toBe(0);
  });

  it('a canteen never fills from the alkali pool, but fills at the spring and the rock pool', () => {
    const sim = quietDesert();
    sim.state.gear.push('canteen');
    clickWater(sim, lakeOf(sim, 'alkali'));
    expect(countItem(sim.state.inventory, 'lakeWater')).toBe(0);
    clickWater(sim, lakeOf(sim, 'spring'));
    expect(countItem(sim.state.inventory, 'lakeWater')).toBe(BALANCE.carry.canteenCapacity);
  });

  it('spring and rock-pool water quench thirst', () => {
    for (const kind of ['spring', 'tinaja'] as const) {
      const sim = quietDesert();
      sim.state.needs.thirst = 50;
      clickWater(sim, lakeOf(sim, kind));
      expect(sim.state.needs.thirst, kind).toBeCloseTo(50 + BALANCE.needs.handDrink.thirst);
    }
  });
});

describe('hot days, cold nights', () => {
  it('the desert is warmer than the woods by day and colder from late afternoon', () => {
    const d = BIOMES.desert.warmth;
    const p = BIOMES.pnw.warmth;
    expect(ambientWarmth(12, d)).toBeGreaterThan(ambientWarmth(12, p));
    expect(ambientWarmth(15.5, d)).toBeGreaterThanOrEqual(90);
    expect(ambientWarmth(18, d)).toBeLessThan(ambientWarmth(18, p) - 25);
    expect(ambientWarmth(19.5, d)).toBe(0);
    expect(ambientWarmth(19.5, p)).toBeGreaterThan(20);
    expect(d.coolRate).toBeGreaterThan(p.coolRate * 1.5);
    // PNW's default curve is the one the original game used.
    expect(ambientWarmth(19.5)).toBe(ambientWarmth(19.5, p));
  });

  function evening(biome: 'pnw' | 'desert', fromHour: number, hours: number, fire = false): number {
    const sim = biome === 'desert' ? quietDesert() : Simulation.newGame(42);
    sim.state.animals.length = 0;
    sim.state.spawnCheckAt = Infinity;
    if (fire) placeStructure(sim, 'campfire');
    sim.state.totalHours = at(1, fromHour);
    Object.assign(sim.state.needs, { hunger: 100, thirst: 100, health: 100, energy: 100, warmth: 90 });
    sim.timeScale = 60;
    run(sim, hours, {}, 1 / 20);
    return sim.state.needs.warmth;
  }

  it('from 4 PM warmth drains much faster than in the woods without a fire', () => {
    const desert = evening('desert', 16, 3.5);
    const pnw = evening('pnw', 16, 3.5);
    expect(desert).toBeLessThan(pnw - 25);
    expect(pnw).toBeGreaterThan(30);
  });

  it('no warmth trouble in the heat of the day, and a fire holds off the desert night', () => {
    expect(evening('desert', 9, 6)).toBeGreaterThanOrEqual(90);
    expect(evening('desert', 18, 3, true)).toBeGreaterThanOrEqual(89);
  });
});

describe('desert wood', () => {
  it('small desert trees give far less wood; the high-country pines and junipers give full logs', () => {
    const pnwMin = Math.min(...(['fir', 'cedar', 'birch', 'maple'] as TreeSpecies[]).map((s) => TREES[s].logs));
    for (const s of ['joshua', 'mesquite'] as TreeSpecies[]) expect(TREES[s].logs, s).toBeLessThan(pnwMin);
    for (const s of ['juniper', 'pinyon', 'ponderosa'] as TreeSpecies[]) expect(TREES[s].logs, s).toBeGreaterThanOrEqual(pnwMin);
    expect(TREES.ponderosa.logs).toBe(TREES.fir.logs);
  });

  function logsFrom(sim: Simulation, species: TreeSpecies): number {
    const i = sim.gen.trees.findIndex((t) => t.species === species);
    expect(i, species).toBeGreaterThanOrEqual(0);
    const t = sim.gen.trees[i];
    teleport(sim, t.x + 2, t.z);
    sim.state.tools.push('axe');
    sim.selectTool('axe');
    sim.state.gear.push('basket', 'backpack');
    sim.state.inventory.slots.push(...Array(BALANCE.carry.basketSlots + BALANCE.carry.backpackSlots).fill(null));
    for (let k = 0; k < 400 && (!sim.state.trees[i].felled || sim.state.trees[i].logs > 0); k++) {
      sim.state.toolWear = {};
      sim.perform({ kind: 'tree', index: i, dist: 1 });
    }
    drain(sim);
    return countItem(sim.state.inventory, 'log');
  }

  it('chopping a Joshua tree gives 1 log and a ponderosa gives 3', () => {
    expect(logsFrom(quietDesert(), 'joshua')).toBe(1);
    expect(logsFrom(quietDesert(), 'ponderosa')).toBe(3);
  });

  it('big trees grow only in the high country; the low desert has Joshua trees, mesquite and spring cottonwoods', () => {
    for (const seed of WORLD_SEEDS) {
      const gen = getWorldGen(seed, 'desert');
      const t = getTerrain(seed, 'desert');
      const big = gen.trees.filter((x) => ['juniper', 'pinyon', 'ponderosa'].includes(x.species));
      expect(big.length, `seed ${seed}`).toBeGreaterThan(40);
      for (const b of big) expect(t.upland(b.x, b.z), `seed ${seed}`).toBeGreaterThan(0.2);
      const low = gen.trees.filter((x) => t.upland(x.x, x.z) < 0.1);
      expect(low.length).toBeGreaterThan(20);
      for (const x of low) expect(['joshua', 'mesquite', 'cottonwood']).toContain(x.species);
      expect(gen.trees.filter((x) => x.species === 'cottonwood').length).toBeGreaterThan(0);
      for (const x of gen.trees) expect(t.heightAt(x.x, x.z), `seed ${seed} tree on dry land`).toBeGreaterThan(0);
    }
  });

  it('the land is mostly scrub and cactus: forage and saguaros, no PNW plants', () => {
    for (const seed of WORLD_SEEDS) {
      const gen = getWorldGen(seed, 'desert');
      const kinds = new Set(gen.resources.map((r) => r.kind));
      for (const k of ['pricklyPear', 'yucca', 'cholla', 'agave']) expect(kinds.has(k as never), `seed ${seed} ${k}`).toBe(true);
      for (const k of ['fern', 'mushroom', 'onion', 'berryBush']) expect(kinds.has(k as never), `seed ${seed} ${k}`).toBe(false);
      expect(gen.cacti?.length ?? 0).toBeGreaterThan(8);
      expect(new Set(gen.trees.map((x) => x.species)).has('fir')).toBe(false);
    }
  });
});

describe('desert wildlife', () => {
  it('a new desert world holds only desert animals: prey, fish in the spring, one cougar and no bear on day 1', () => {
    for (const seed of WORLD_SEEDS) {
      const s = createNewState(seed, 'desert');
      const count = (sp: SpeciesId) => s.animals.filter((a) => a.species === sp).length;
      const allowed = new Set<SpeciesId>([...BIOMES.desert.prey.map((p) => p.species), 'cougar', 'bear']);
      for (const a of s.animals) expect(allowed.has(a.species), a.species).toBe(true);
      for (const p of BIOMES.desert.prey) expect(count(p.species), `seed ${seed} ${p.species}`).toBeGreaterThan(0);
      expect(count('cougar')).toBe(1);
      expect(count('bear')).toBe(0);
      const t = getTerrain(seed, 'desert');
      for (const f of s.animals.filter((a) => a.species === 'fish')) expect(t.lakeAt(f.x, f.z)?.kind).toBe('spring');
    }
  });

  it('predators grow slowly: at most two cougars, one black bear from day 3', () => {
    const tg = BIOMES.desert.predatorTargets;
    expect(tg(1)).toEqual({ cougar: 1, bear: 0 });
    expect(tg(3)).toEqual({ cougar: 1, bear: 1 });
    expect(tg(4).cougar).toBe(2);
    expect(tg(40)).toEqual({ cougar: 2, bear: 1 });
  });

  it('the black bear only lives in the high country', () => {
    const t = getTerrain(42, 'desert');
    const rng = new Rng(9);
    for (let i = 0; i < 30; i++) {
      const p = findSpawnPoint(t, rng, 'bear', []);
      expect(p).not.toBeNull();
      expect(t.upland(p!.x, p!.z)).toBeGreaterThanOrEqual(0.45);
    }
    const sim = quietDesert();
    sim.state.totalHours = at(3, 9);
    for (let i = 0; i < 4; i++) sim.maintainPopulation();
    const bears = sim.state.animals.filter((a) => a.species === 'bear');
    expect(bears).toHaveLength(1);
    expect(t.upland(bears[0].x, bears[0].z)).toBeGreaterThanOrEqual(0.45);
    expect(sim.state.animals.filter((a) => a.species === 'cougar').length).toBe(1);
  });

  const flat = fakeTerrain(() => 2);
  function tick(a: AnimalState, env: ReturnType<typeof animalEnv>, seconds: number, each?: () => void): AnimalMode[] {
    const modes: AnimalMode[] = [];
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      each?.();
      updateAnimal(a, env, 1 / 30);
      if (modes[modes.length - 1] !== a.mode) modes.push(a.mode);
    }
    return modes;
  }
  function animal(species: SpeciesId, x: number): AnimalState {
    const a = createAnimal(1, species, x, 0, new Rng(3), flat);
    a.temperament = 1;
    a.heading = 0;
    a.timer = 1e9;
    return a;
  }

  it('the cougar stalks like the wolf, then charges and bites', () => {
    const c = animal('cougar', 16);
    const env = animalEnv(flat, { playerX: 0, playerZ: 0 });
    const modes = tick(c, env, 20);
    expect(modes.slice(0, 3)).toEqual(['stalk', 'chase', 'attack']);
    expect(env.hurts[0].source).toBe('cougar');
    expect(env.events.some((e) => e.type === 'predatorAlert' && e.species === 'cougar')).toBe(true);
  });

  it('a torch keeps the cougar off', () => {
    const c = animal('cougar', 15);
    const env = animalEnv(flat, { playerX: 0, playerZ: 0, playerDeterrent: true });
    const modes = tick(c, env, 16);
    expect(modes).not.toContain('attack');
    expect(env.hurts).toHaveLength(0);
  });

  it('a rattlesnake coils and rattles instead of fleeing, and bites if you step in', () => {
    const s = animal('snake', 5);
    const env = animalEnv(flat, { playerX: 0, playerZ: 0 });
    tick(s, env, 0.5);
    expect(s.mode).toBe('alert');
    expect(env.events.filter((e) => e.type === 'rattle')).toHaveLength(1);
    expect(env.hurts).toHaveLength(0);
    env.playerX = 4;
    tick(s, env, 1);
    expect(s.mode).toBe('alert');
    expect(env.hurts[0]).toMatchObject({ source: 'snake', amount: SPECIES.snake.kind === 'prey' ? SPECIES.snake.strike!.damage : 0 });
    env.playerX = -20;
    tick(s, env, 2);
    expect(s.mode).not.toBe('flee');
    expect(s.mode).not.toBe('alert');
  });

  it('lizards, quail and jackrabbits bolt like the hare', () => {
    for (const sp of ['lizard', 'quail', 'jackrabbit', 'roadrunner', 'javelina'] as SpeciesId[]) {
      const a = animal(sp, 30);
      const env = animalEnv(flat, { playerX: 0, playerZ: 0 });
      const modes = tick(a, env, 12, () => (env.playerX += 0.1));
      expect(modes, sp).toContain('flee');
    }
  });
});
