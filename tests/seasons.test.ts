import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { createAnimal } from '../src/sim/animals';
import { deserializeState, serializeState } from '../src/sim/save';
import { nextSeason, parseSeason, seasonAtDawn, seasonDeadline, SEASONS } from '../src/sim/seasons';
import { IDLE_INPUT, Simulation } from '../src/sim/simulation';
import { WATER_LEVEL } from '../src/sim/terrain';
import { takeSnapshot, stateFromSnapshot } from '../src/net/worldSync';
import { drain, input, keepAlive, placeStructure, quietSim, run } from './helpers';

const at = (day: number, hour: number) => (day - 1) * 24 + ((hour - 6 + 24) % 24);

describe('PNW season calendar', () => {
  it('starts in Spring and cycles through four full 25-day seasons by sleeping', () => {
    const sim = quietSim();
    const fire = placeStructure(sim, 'campfire');
    for (let day = 1; day <= 100; day++) {
      expect(sim.season).toBe(SEASONS[Math.floor((day - 1) / 25)]);
      expect(sim.seasonDay).toBe((day - 1) % 25 + 1);
      sim.state.totalHours = at(day, 21);
      keepAlive(sim);
      expect(sim.trySleep(fire.id)).toBe(true);
      expect(sim.hour).toBe(6);
      expect(sim.day).toBe(day + 1);
      expect(drain(sim).filter((e) => e.type === 'slept')).toHaveLength(1);
    }
    expect(sim.season).toBe('spring');
    expect(sim.seasonDay).toBe(1);
    expect(sim.state.season?.startDay).toBe(101);
  });

  it('warns once at 1 AM, then passes out at 2 AM in the same place and wakes in the new season', () => {
    const sim = quietSim();
    sim.state.spawnCheckAt = Infinity;
    sim.state.totalHours = at(25, 0.99);
    sim.timeScale = 60;
    keepAlive(sim);
    const p = sim.state.player;
    const x = p.x, z = p.z;
    const before = run(sim, 0.2);
    expect(before.filter((e) => e.type === 'message' && /getting tired/.test(e.text))).toHaveLength(1);
    expect(sim.season).toBe('spring');
    expect(sim.seasonDay).toBe(25);
    // Saving after the warning must neither repeat it nor lose the deadline.
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    loaded.state.spawnCheckAt = Infinity;
    loaded.timeScale = 60;
    const events = run(loaded, 1.1);
    expect(events.some((e) => e.type === 'message' && /getting tired/.test(e.text))).toBe(false);
    expect(events.filter((e) => e.type === 'slept')).toEqual([{ type: 'slept', day: 26, byFire: false, passedOut: true }]);
    expect(loaded.season).toBe('summer');
    expect(loaded.seasonDay).toBe(1);
    expect(loaded.day).toBe(26);
    expect(loaded.state.player.x).toBe(x);
    expect(loaded.state.player.z).toBe(z);
    expect(loaded.state.needs.energy).toBe(100);
  });

  it('permits ordinary all-nighters, and never changes seasons at midnight while awake', () => {
    const sim = quietSim();
    sim.state.spawnCheckAt = Infinity;
    sim.timeScale = 60;
    sim.state.totalHours = at(24, 1.95);
    expect(run(sim, 0.2).some((e) => e.type === 'slept')).toBe(false);
    sim.state.totalHours = at(25, 23.95);
    expect(run(sim, 0.2).some((e) => e.type === 'slept')).toBe(false);
    expect(sim.season).toBe('spring');
    expect(sim.hour).toBeLessThan(1);
  });

  it('passing out interrupts actions even with predators nearby', () => {
    const sim = quietSim();
    sim.state.totalHours = seasonDeadline(sim.state.season!) - 0.001;
    sim.devSpawn('wolf', 5);
    sim.bowDraw = 1;
    sim.fishing = { phase: 'waiting', t: 0, power: 1, fromX: 0, fromZ: 0, x: 0, z: 0, biteAt: 3 };
    sim.timeScale = 240;
    sim.step(0.1, IDLE_INPUT);
    expect(sim.bowDraw).toBe(-1);
    expect(sim.fishing).toBeNull();
    expect(sim.day).toBe(26);
    expect(sim.state.stats.events.slept).toBe(1);
  });

  it('keeps legacy saves and malformed calendars safe without resetting the world', () => {
    const sim = quietSim();
    sim.state.totalHours = at(73, 13);
    sim.state.trees[0].hp = 1;
    const raw = JSON.parse(serializeState(sim.state));
    delete raw.season;
    const migrated = deserializeState(JSON.stringify(raw))!;
    expect(migrated.season).toEqual({ id: 'spring', startDay: 73 });
    expect(migrated.totalHours).toBe(sim.state.totalHours);
    expect(migrated.trees[0].hp).toBe(1);
    for (const bad of [null, 42, 'winter', { id: 'oops', startDay: 1 }, { id: 'winter', startDay: 900 }, { id: 'winter', startDay: -1 }]) {
      expect(parseSeason(bad, 0)).toEqual({ id: 'spring', startDay: 1 });
    }
    expect(nextSeason('winter')).toBe('spring');
    expect(seasonAtDawn({ id: 'spring', startDay: 1 }, 24 * 25)).toEqual({ id: 'summer', startDay: 26 });
  });

  it('persists dev overrides and late-join snapshots, without advancing the clock', () => {
    const sim = quietSim();
    sim.state.totalHours = at(10, 15);
    const before = sim.state.totalHours;
    expect(sim.devSetSeason('winter')).toBe(true);
    expect(sim.state.totalHours).toBe(before);
    sim.state.totalHours += 3 * 24;
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(sim)));
    for (const s of [loaded, guest]) {
      expect(s.season).toBe('winter');
      expect(s.seasonDay).toBe(4);
      expect(s.frozen).toBe(true);
    }
    guest.authority = 'guest';
    expect(guest.devSetSeason('spring')).toBe(false);
    expect(guest.season).toBe('winter');
  });
});

describe('seasonal survival', () => {
  it('freezes lakes into walkable ground, thaws back into swimming and never changes shared terrain', () => {
    const sim = quietSim();
    const other = quietSim();
    expect(sim.terrain).toBe(other.terrain);
    const lake = sim.terrain.lakes[0];
    Object.assign(sim.state.player, { x: lake.x, z: lake.z, y: -1, swimming: true, grounded: false });
    sim.devSetSeason('winter');
    sim.step(0.1, input({ moveZ: 1 }, sim));
    expect(sim.state.player).toMatchObject({ y: WATER_LEVEL, swimming: false, wading: false, grounded: true });
    expect(sim.fishableAt(lake.x, lake.z)).toBe(false);
    expect(other.fishableAt(lake.x, lake.z)).toBe(true);
    expect(other.frozen).toBe(false);
    sim.step(0.1, input({ jumpPressed: true }, sim));
    expect(sim.state.player.y).toBeGreaterThan(WATER_LEVEL);
    sim.devSetSeason('spring');
    run(sim, 2);
    expect(sim.state.player.swimming).toBe(true);
  });

  it.each(['none', 'empty', 'partial', 'full'] as const)('blocks drinking and collecting lake water in winter with a %s canteen', (canteen) => {
    const sim = quietSim();
    if (canteen !== 'none') sim.state.gear.push('canteen');
    if (canteen === 'partial') sim.state.canteen.lakeWater = 1;
    if (canteen === 'full') sim.state.canteen.boiledWater = BALANCE.carry.canteenCapacity;
    sim.devSetSeason('winter');
    const lake = sim.terrain.lakes[0];
    sim.state.needs.thirst = 50;
    sim.target = { kind: 'water', x: lake.x, z: lake.z, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ name: 'Frozen Lake', enabled: false });
    const before = structuredClone({ needs: sim.state.needs, canteen: sim.state.canteen, stats: sim.state.stats });
    drain(sim);
    sim.perform(sim.target);
    expect({ needs: sim.state.needs, canteen: sim.state.canteen, stats: sim.state.stats }).toEqual(before);
    const events = drain(sim);
    expect(events.some((e) => e.type === 'drank' || e.type === 'filled' || e.type === 'gathered')).toBe(false);
    expect(events.some((e) => e.type === 'message' && /frozen/.test(e.text))).toBe(true);
    // Stored water remains usable; only the frozen lake is unavailable.
    if (canteen === 'partial' || canteen === 'full') {
      expect(sim.drinkCanteen()).toBe(true);
      expect(sim.state.needs.thirst).toBeGreaterThan(50);
    }
  });

  it.each([false, true])('restores lake drinking and collection after thaw (canteen: %s)', (canteen) => {
    const sim = quietSim();
    if (canteen) sim.state.gear.push('canteen');
    sim.devSetSeason('winter');
    const lake = sim.terrain.lakes[0];
    sim.state.needs.thirst = 50;
    sim.target = { kind: 'water', x: lake.x, z: lake.z, dist: 1 };
    sim.perform(sim.target);
    sim.devSetSeason('spring');
    expect(sim.describeTarget()?.enabled).toBe(true);
    sim.perform(sim.target);
    if (canteen) expect(sim.state.canteen.lakeWater).toBe(BALANCE.carry.canteenCapacity);
    else expect(sim.state.needs.thirst).toBeGreaterThan(50);
  });

  it('stops fishing through ice', () => {
    const sim = quietSim();
    sim.devSetSeason('winter');
    const lake = sim.terrain.lakes[0];
    sim.target = { kind: 'water', x: lake.x, z: lake.z, dist: 1 };
    sim.state.tools.push('rod');
    sim.selectTool('rod');
    expect(sim.describeTarget()?.enabled).toBe(false);
    sim.step(0.1, input({ primary: true, primaryPressed: true }, sim));
    expect(sim.fishing).toBeNull();
  });

  it('hibernates existing bears and blocks winter replenishment, then restores normal spring populations', () => {
    const sim = quietSim();
    sim.state.totalHours = at(76, 12);
    const p = sim.state.player;
    sim.state.animals.push(createAnimal(1000, 'bear', p.x + 90, p.z, new Rng(1), sim.terrain));
    sim.devSetSeason('winter');
    for (let i = 0; i < 5; i++) sim.maintainPopulation();
    expect(sim.state.animals.some((a) => a.species === 'bear')).toBe(false);
    expect(sim.devSpawn('bear')).toBeNull();
    sim.devSetSeason('spring');
    sim.maintainPopulation();
    expect(sim.state.animals.some((a) => a.species === 'bear')).toBe(true);
  });

  it('has abundant spring/fall forage, scarce winter forage, and preserves harvested charges', () => {
    const sim = quietSim();
    const edible = sim.gen.resources.map((r, i) => ['berryBush', 'onion', 'mushroom'].includes(r.kind) ? i : -1).filter((i) => i >= 0);
    const counts: number[] = [];
    const harvested = edible[0];
    sim.state.resources[harvested] = { charges: 0, respawnAt: 1234 };
    for (const id of SEASONS) {
      sim.devSetSeason(id);
      counts.push(edible.filter((i) => sim.forageAvailable(i)).length);
      expect(sim.state.resources[harvested]).toEqual({ charges: 0, respawnAt: 1234 });
    }
    expect(counts[0]).toBe(edible.length);
    expect(counts[2]).toBe(counts[0]);
    expect(counts[1]).toBeLessThan(counts[0]);
    expect(counts[3]).toBeGreaterThan(0);
    expect(counts[3]).toBeLessThan(counts[1] * 0.15);
    const hidden = edible.find((i) => !sim.forageAvailable(i))!;
    const charges = sim.state.resources[hidden].charges;
    sim.perform({ kind: 'resource', index: hidden, dist: 1 });
    expect(sim.state.resources[hidden].charges).toBe(charges);
    expect(sim.resourcePresent(hidden)).toBe(false);
  });

  it('makes winter much colder than spring/fall and keeps fire protection', () => {
    const sim = quietSim();
    sim.devSetHour(12);
    const temps = SEASONS.map((id) => { sim.devSetSeason(id); return sim.warmthTarget().target; });
    expect(temps[1]).toBeGreaterThan(temps[0]);
    expect(temps[0]).toBeGreaterThan(temps[3] + 40);
    expect(temps[2]).toBeGreaterThan(temps[3] + 30);
    const fire = placeStructure(sim, 'campfire');
    sim.state.player.x = fire.x + 1.6;
    sim.state.player.z = fire.z;
    sim.state.needs.warmth = 80;
    expect(sim.warmthTarget().target).toBeGreaterThanOrEqual(80);
  });

  it.each(['desert', 'island'] as const)('leaves %s without seasons, forced sleep or frozen water', (biome) => {
    const sim = Simulation.newGame(42, biome);
    sim.state.totalHours = at(25, 1.99);
    const warmth = sim.warmthTarget();
    expect(sim.devSetSeason('winter')).toBe(false);
    expect(sim.warmthTarget()).toEqual(warmth);
    expect(sim.state.season).toBeUndefined();
    sim.timeScale = 60;
    expect(run(sim, 0.2).some((e) => e.type === 'slept')).toBe(false);
    expect(sim.frozen).toBe(false);
    expect(takeSnapshot(sim).season).toBeUndefined();
  });
});
