import { trainSkill, gatherOutcome, aimAt, input, placeStructure, quietSim, teleport } from './helpers';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/data/items';
import { RESOURCES } from '../src/data/resources';
import { takeSnapshot, stateFromSnapshot } from '../src/net/worldSync';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { snowAmount, snowScale, snowSurface } from '../src/sim/snow';
import { Simulation } from '../src/sim/simulation';
import { generateWorld } from '../src/sim/worldgen';

const nodes = (sim: Simulation) => sim.gen.resources.map((r, i) => ({ r, i })).filter(({ r }) => r.snow);
const winter = () => { const sim = quietSim();
    gatherOutcome(sim); sim.devSetSeason('winter'); return sim; };
function spring(sim: Simulation, day = 1) {
  sim.state.totalHours = (100 + day - 1) * 24;
  sim.followSeason({ id: 'spring', startDay: 101 });
}

describe('seeded PNW snow clumps', () => {
  it.each([1, 42, 777, 20260929])('seed %i: provides ground, log and boulder clumps and a reliable nearby winter water source', (seed) => {
    const sim = Simulation.newGame(seed);
    const snow = nodes(sim);
    expect(snow.length).toBeGreaterThan(150);
    for (const surface of ['ground', 'log', 'rock']) expect(snow.some(({ r }) => r.snow!.surface === surface)).toBe(true);
    expect(snow.filter(({ r }) => r.snow!.surface === 'ground' && Math.hypot(r.x - sim.terrain.spawn.x, r.z - sim.terrain.spawn.z) <= 19).length).toBeGreaterThanOrEqual(8);
    for (const { r } of snow) {
      expect(r.y).toBeCloseTo(snowSurface(sim.terrain, sim.gen, r), 6);
      expect(r.y).toBeGreaterThan(0);
      expect(sim.terrain.waterDepth(r.x, r.z)).toBe(0);
    }
  });

  it('is deterministic and appends snow after the existing forage indices', () => {
    const a = generateWorld(42), b = generateWorld(42);
    expect(a).toEqual(b);
    const firstSnow = a.resources.findIndex((r) => r.snow);
    expect(a.resources.slice(firstSnow).every((r) => r.kind === 'snowClump')).toBe(true);
    expect(new Set(a.resources.map((r) => r.spot)).size).toBe(a.resources.length);
  });

  it.each(['desert', 'island'] as const)('adds neither snow spawns nor the snow-water recipe to %s', (biome) => {
    const sim = Simulation.newGame(42, biome);
    expect(nodes(sim)).toEqual([]);
    sim.devGive('snowClump', 1);
    expect(sim.canCraft('meltSnow').reason).toBe('unknown');
    expect(sim.craft('meltSnow').reason).toBe('unknown');
  });
});

describe('spring snowmelt', () => {
  it('preserves melt progress and depleted remnants when reloading a spring save', () => {
    const sim = winter();
    spring(sim, 9);
    const remnant = nodes(sim).find(({ r, i }) => snowAmount(r, sim.state, i) > 0)!;
    sim.perform({ kind: 'resource', index: remnant.i, dist: 1 });
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(loaded.state.season).toEqual(sim.state.season);
    expect(loaded.state.totalHours).toBe(sim.state.totalHours);
    for (const { r, i } of nodes(sim)) expect(snowAmount(r, loaded.state, i)).toBe(snowAmount(r, sim.state, i));
    expect(loaded.state.resources[remnant.i].charges).toBe(2);
    spring(loaded, 25);
    expect(nodes(loaded).every(({ i }) => !loaded.resourcePresent(i))).toBe(true);
  });

  it('removes most winter clumps immediately, shrinks the remaining fixed patches, and leaves none on day 25', () => {
    const sim = winter();
    const snow = nodes(sim);
    const before = snow.map(({ r, i }) => snowAmount(r, sim.state, i));
    expect(before.every((n) => n === 1)).toBe(true);
    let previous = before;
    const counts: number[] = [];
    for (let day = 1; day <= 25; day++) {
      spring(sim, day);
      const amounts = snow.map(({ r, i }) => snowAmount(r, sim.state, i));
      amounts.forEach((n, i) => expect(n).toBeLessThanOrEqual(previous[i]));
      counts.push(amounts.filter((n) => n > 0).length);
      previous = amounts;
    }
    expect(counts[0]).toBeGreaterThan(snow.length * 0.15);
    expect(counts[0]).toBeLessThan(snow.length * 0.35);
    expect(counts[12]).toBeLessThan(counts[0]);
    expect(counts[24]).toBe(0);
    expect(snow.every(({ i }) => !sim.resourcePresent(i))).toBe(true);
    for (const season of ['summer', 'fall'] as const) {
      sim.devSetSeason(season);
      expect(snow.every(({ i }) => !sim.resourcePresent(i))).toBe(true);
    }
  });

  it('has different melt deadlines, handles fractional days and time skips, and never rerolls locations', () => {
    const sim = winter();
    const snow = nodes(sim);
    const positions = snow.map(({ r }) => [r.x, r.y, r.z]);
    spring(sim);
    const remnants = snow.filter(({ r }) => snowScale(sim.state.seed, r.spot, sim.state.season, sim.state.totalHours) > 0);
    const deadlines = remnants.map(({ r }) => {
      for (let day = 1; day <= 25; day++) if (!snowScale(sim.state.seed, r.spot, sim.state.season, (100 + day - 1) * 24)) return day;
      return 26;
    });
    expect(new Set(deadlines).size).toBeGreaterThan(10);
    const r = remnants[0].r;
    const start = snowScale(sim.state.seed, r.spot, sim.state.season, sim.state.totalHours);
    expect(snowScale(sim.state.seed, r.spot, sim.state.season, sim.state.totalHours + 12)).toBeLessThan(start);
    spring(sim, 25);
    expect(snow.map(({ r }) => [r.x, r.y, r.z])).toEqual(positions);
  });
});

describe('harvesting winter snow', () => {
  it('gathers by hand into the pack, shrinks with each harvest, depletes, and replenishes only in winter', () => {
    const sim = winter();
    const { r, i } = nodes(sim)[0];
    let previous = 1;
    for (let n = 0; n < RESOURCES.snowClump.charges; n++) {
      sim.perform({ kind: 'resource', index: i, dist: 1 });
      const amount = snowAmount(r, sim.state, i);
      expect(amount).toBeLessThan(previous);
      previous = amount;
    }
    expect(countItem(sim.state.inventory, 'snowClump')).toBeGreaterThanOrEqual(3);
    expect(sim.resourcePresent(i)).toBe(false);
    expect(sim.state.canteen).toEqual({ lakeWater: 0, boiledWater: 0 });
    sim.state.spawnCheckAt = Infinity;
    sim.state.totalHours = sim.state.resources[i].respawnAt;
    sim.step(1, input({}, sim));
    expect(sim.state.resources[i].charges).toBe(3);
    spring(sim);
    const remnant = nodes(sim).find(({ r }) => snowScale(sim.state.seed, r.spot, sim.state.season, sim.state.totalHours) > 0)!;
    Object.assign(sim.state.resources[remnant.i], { charges: 0, respawnAt: 0 });
    sim.step(1, input({}, sim));
    expect(sim.state.resources[remnant.i].charges).toBe(0);
    sim.devSetSeason('winter');
    expect(sim.state.resources[remnant.i].charges).toBe(3);
  });

  it('does not consume snow when the pack is full, and ignores melted patches', () => {
    const sim = winter();
    const { i } = nodes(sim)[0];
    sim.state.inventory.slots.fill({ item: 'stick', count: ITEMS.stick.stack });
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(sim.state.resources[i].charges).toBe(3);
    sim.state.inventory.slots.fill(null);
    spring(sim, 25);
    sim.target = { kind: 'resource', index: i, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ enabled: false });
    sim.perform(sim.target);
    expect(countItem(sim.state.inventory, 'snowClump')).toBe(0);
    expect(sim.state.resources[i].charges).toBe(3);
  });

  it('targets snow at its elevated boulder height and can harvest it', () => {
    const sim = winter();
    const { r, i } = nodes(sim).find(({ r }) => r.snow!.surface === 'rock' && sim.gen.rocks[r.snow!.ref].r < 1.1)!;
    teleport(sim, r.x - 2, r.z);
    aimAt(sim, r.x, r.y! + 0.18, r.z);
    sim.step(0.01, input({ yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }, sim));
    expect(sim.target).toMatchObject({ kind: 'resource', index: i });
    sim.perform(sim.target!);
    expect(sim.state.resources[i].charges).toBe(2);
  });

  it('persists gathered clumps and depletion through saves, old saves and multiplayer snapshots', () => {
    const sim = winter();
    const { r, i } = nodes(sim)[0];
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(sim)));
    for (const s of [loaded, guest]) {
      expect(s.state.resources[i].charges).toBe(2);
      expect(snowAmount(r, s.state, i)).toBe(snowAmount(r, sim.state, i));
    }
    expect(countItem(loaded.state.inventory, 'snowClump')).toBeGreaterThan(0);
    const old = JSON.parse(serializeState(sim.state));
    old.resources = old.resources.filter(([spot]: number[]) => spot < r.spot);
    const migrated = new Simulation(deserializeState(JSON.stringify(old))!);
    expect(migrated.state.resources[i].charges).toBe(3);
  });
});

describe('snow to drinking water', () => {
  it('melts and boils a harvested clump at a campfire, then lets you drink it or use it in recipes', () => {
    const sim = winter();
    const { i } = nodes(sim)[0];
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    placeStructure(sim, 'campfire');
    sim.state.gear.push('canteen');
    expect(sim.craft('meltSnow').ok).toBe(true);
    expect(sim.state.canteen.boiledWater).toBe(1);
    expect(countItem(sim.state.inventory, 'boiledWater')).toBe(0);
    sim.state.needs.thirst = 20;
    expect(sim.drinkCanteen()).toBe(true);
    expect(sim.state.needs.thirst).toBe(20 + ITEMS.boiledWater.food!.thirst!);
    sim.devGive('snowClump', 1);
    sim.craft('meltSnow');
    sim.devGive('berries', 2);
    trainSkill(sim, 'cooking', 2);
    expect(sim.craft('berryTea').ok).toBe(true);
    expect(sim.state.canteen.boiledWater).toBe(0);
  });

  it('requires a burning fire, a canteen and free water capacity without wasting snow on failure', () => {
    const sim = winter();
    sim.devGive('snowClump', 3);
    expect(sim.craft('meltSnow').reason).toBe('station');
    const fire = placeStructure(sim, 'campfire');
    expect(sim.craft('meltSnow').reason).toBe('noCanteen');
    sim.state.gear.push('canteen');
    sim.devGive('lakeWater', 4);
    expect(sim.craft('meltSnow').reason).toBe('canteenFull');
    expect(countItem(sim.state.inventory, 'snowClump')).toBe(3);
    sim.state.canteen.lakeWater = 0;
    fire.fuel = 0;
    expect(sim.craft('meltSnow').reason).toBe('station');
    expect(countItem(sim.state.inventory, 'snowClump')).toBe(3);
  });
});
