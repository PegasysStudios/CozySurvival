import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { killKey, LEGACY_OBJECTIVE_COUNT, OBJECTIVES } from '../src/data/objectives';
import { RECIPE_BY_ID } from '../src/data/recipes';
import { TREES } from '../src/data/resources';
import { createAnimal } from '../src/sim/animals';
import type { SimEvent } from '../src/sim/events';
import { lookDir } from '../src/sim/movement';
import { deserializeState, serializeState } from '../src/sim/save';
import { createNewState, nearestShore, Simulation, SPAWN_SHORE_DIST } from '../src/sim/simulation';
import { getTerrain, WATER_LEVEL } from '../src/sim/terrain';
import { aimAt, buildFresh, drain, give, giveRecipe, keepAlive, nearestResource, nearestTree, quietSim, run, teleport } from './helpers';

const F = BALANCE.fishing;

function craftFresh(sim: Simulation, id: string): void {
  giveRecipe(sim, id);
  const res = sim.craft(id);
  if (!res.ok) throw new Error(`could not craft ${id}: ${res.reason}`);
}

/** Walk to the lake edge, cast and strike until a trout is landed. */
function catchFish(sim: Simulation): void {
  const lake = sim.terrain.lakes[0];
  let d = 0;
  while (sim.terrain.heightAt(lake.x + d, lake.z) < 0.3) d += 0.25;
  teleport(sim, lake.x + d, lake.z);
  sim.selectTool('rod');
  const p = sim.state.player;
  p.yaw = Math.atan2(d, 0);
  p.pitch = 0;
  drain(sim);
  for (let k = 0; k < 20; k++) {
    keepAlive(sim);
    run(sim, 1 / 60, { primary: true, primaryPressed: true });
    run(sim, F.fullCharge * 0.6, { primary: true });
    run(sim, 1 / 60, { primaryReleased: true });
    let bite = false;
    for (let t = 0; t < F.biteWait[1] + 4 && !bite; t += 1 / 60) bite = run(sim, 1 / 60).some((e) => e.type === 'fishBite');
    const ev: SimEvent[] = run(sim, 1 / 60, { primary: true, primaryPressed: true });
    if (ev.some((e) => e.type === 'fishDone' && e.result === 'caught')) return;
    run(sim, 0.5);
  }
  throw new Error('no fish landed in 20 casts');
}

/** Draw the bow fully and loose an arrow at a calm hare standing a few metres away. */
function bowHare(sim: Simulation): SimEvent[] {
  sim.selectTool('bow');
  const p = sim.state.player;
  run(sim, 1, { yaw: p.yaw, pitch: 0 });
  const d = lookDir(p.yaw, 0, { x: 0, y: 0, z: 0 });
  const hare = createAnimal(901, 'rabbit', p.x + d.x * 5, p.z + d.z * 5, new Rng(3), sim.terrain);
  hare.temperament = 0.1;
  sim.state.animals.push(hare);
  aimAt(sim, hare.x, hare.y + 0.25, hare.z);
  const aim = { yaw: p.yaw, pitch: p.pitch };
  run(sim, 1 / 60, { ...aim, primary: true, primaryPressed: true });
  run(sim, 1.0, { ...aim, primary: true });
  const ev = run(sim, 1 / 60, { ...aim, primaryReleased: true });
  ev.push(...run(sim, 1.5, aim));
  return ev;
}

describe('onboarding track', () => {
  it('has nine steps in the order Jon asked for', () => {
    expect(OBJECTIVES.map((o) => o.id)).toEqual(['drink', 'camp', 'forage', 'skewer', 'firewood', 'axe', 'fish', 'spear', 'bow']);
    expect(OBJECTIVES[7].hint).toMatch(/spear hunting is hard/i);
    expect(RECIPE_BY_ID.forageSkewer.inputs.map((i) => i.item).sort()).toEqual(['berries', 'onion', 'stick']);
    expect(RECIPE_BY_ID.forageSkewer.station).toBe('fire');
  });

  it('walks through all nine steps with real actions, in order', () => {
    const sim = quietSim();
    teleport(sim, sim.terrain.spawn.x, sim.terrain.spawn.z);
    sim.state.gear.push('basket', 'backpack');
    sim.state.inventory.slots.length = 0;
    sim.state.inventory.slots.push(...new Array(16).fill(null));
    const done: number[] = [];
    const collect = () => drain(sim).forEach((e) => e.type === 'objective' && done.push(e.index));
    const expectStep = (n: number) => {
      collect();
      expect(sim.state.objective).toBe(n);
    };

    // 1. drink from the lake
    expect(sim.currentObjective()!.title).toBe(OBJECTIVES[0].title);
    sim.state.needs.thirst = 50;
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    expectStep(1);

    // 2. campfire
    const fire = buildFresh(sim, 'campfire');
    expectStep(2);

    // 3. forage food: salmonberries pick two at a time
    for (let k = 0; k < 2; k++) {
      const i = nearestResource(sim, 'berryBush');
      sim.state.resources[i].charges = Math.max(1, sim.state.resources[i].charges);
      sim.perform({ kind: 'resource', index: i, dist: 1 });
    }
    expect(sim.state.forage).toContain('berryBush');
    expectStep(3);

    // 4. a skewer from foraged food, cooked at the fire
    give(sim, { onion: 1, stick: 1 });
    expect(sim.craft('forageSkewer').ok).toBe(true);
    expectStep(4);

    // 5. firewood
    give(sim, { stick: 2 });
    expect(sim.addFuel(fire.id, 'stick')).toBe(true);
    expectStep(4);
    expect(sim.addFuel(fire.id, 'stick')).toBe(true);
    expectStep(5);

    // 6. axe and a chopped tree
    craftFresh(sim, 'axe');
    expectStep(5);
    sim.selectTool('axe');
    const tree = nearestTree(sim, 'fir');
    for (let k = 0; k < TREES.fir.hp + TREES.fir.logs * BALANCE.trees.cutsPerLog && !sim.state.stats.gathered.log; k++) {
      keepAlive(sim);
      sim.perform({ kind: 'tree', index: tree, dist: 1 });
    }
    expectStep(6);

    // 7. rod, a fish, and cooking it
    craftFresh(sim, 'cordage');
    craftFresh(sim, 'rod');
    catchFish(sim);
    expectStep(6);
    teleport(sim, fire.x + 1.6, fire.z);
    fire.fuel = Math.max(fire.fuel, 4);
    expect(sim.craft('grilledTrout').ok).toBe(true);
    expectStep(7);

    // 8. spear and a hare
    craftFresh(sim, 'spear');
    sim.selectTool('spear');
    const p = sim.state.player;
    sim.state.animals.push(createAnimal(800, 'rabbit', p.x + 1, p.z, new Rng(2), sim.terrain));
    sim.perform({ kind: 'animal', id: 800, dist: 1 });
    expect(sim.state.stats.events[killKey('spear', 'rabbit')]).toBe(1);
    expectStep(8);

    // 9. bow, arrows and a bow kill
    craftFresh(sim, 'bow');
    craftFresh(sim, 'arrows');
    keepAlive(sim);
    sim.state.carcasses.length = 0;
    sim.state.player.yaw = Math.atan2(-(p.x - fire.x), -(p.z - fire.z));
    const ev = bowHare(sim);
    expect(ev.some((e) => e.type === 'animalHit' && e.species === 'rabbit' && e.killed)).toBe(true);
    expect(sim.state.stats.events[killKey('bow')]).toBe(1);
    ev.forEach((e) => e.type === 'objective' && done.push(e.index));
    collect();

    expect(done).toEqual(OBJECTIVES.map((_, i) => i));
    expect(sim.currentObjective()).toBeNull();
  });

  it('later steps done early only count once the earlier ones are finished', () => {
    const sim = quietSim();
    sim.state.stats.crafted.axe = 1;
    sim.state.stats.gathered.log = 3;
    sim.state.stats.events.fuelAdded = 2;
    sim.state.stats.gathered.berries = 4;
    drain(sim);
    buildFresh(sim, 'campfire');
    expect(sim.state.objective).toBe(0);
    sim.state.needs.thirst = 50;
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    const ev = drain(sim).filter((e) => e.type === 'objective').map((e) => (e as { index: number }).index);
    expect(ev).toEqual([0, 1, 2]);
    expect(sim.state.objective).toBe(3);
  });

  it('only spear kills of a hare count for the spear step', () => {
    const sim = quietSim();
    sim.state.objective = 7;
    sim.state.stats.crafted.spear = 1;
    sim.creditKill('rabbit', 'bow');
    expect(sim.state.objective).toBe(7);
    sim.creditKill('deer', 'spear');
    expect(sim.state.objective).toBe(7);
    sim.creditKill('rabbit', 'spear');
    expect(sim.state.objective).toBe(8);
  });
});

describe('lake-near spawn', () => {
  const seeds = [1, 2, 3, 7, 11, 42, 99, 123, 2024, 31337];

  it.each(seeds)('seed %i starts a short walk from the water, on dry gentle ground, facing it', (seed) => {
    const terrain = getTerrain(seed);
    const p = createNewState(seed).player;
    const shore = nearestShore(terrain, p.x, p.z)!;
    expect(shore).not.toBeNull();
    expect(shore.dist).toBeLessThanOrEqual(SPAWN_SHORE_DIST + 2);
    expect(terrain.heightAt(p.x, p.z)).toBeGreaterThan(WATER_LEVEL + 0.5);
    expect(terrain.slopeAt(p.x, p.z)).toBeLessThan(0.6);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    expect(fx * shore.dx + fz * shore.dz).toBeGreaterThan(0.95);
    // the starter patch around the world spawn is still close by
    expect(Math.hypot(p.x - terrain.spawn.x, p.z - terrain.spawn.z)).toBeLessThanOrEqual(12.01);
  });
});

describe('old saves and the new track', () => {
  function asVersion2(sim: Simulation, objective: number): string {
    const raw = JSON.parse(serializeState(sim.state));
    raw.version = 2;
    raw.objective = objective;
    delete raw.toolLevels;
    delete raw.forage;
    return JSON.stringify(raw);
  }

  it('a finished old track stays finished', () => {
    const sim = quietSim();
    const loaded = deserializeState(asVersion2(sim, LEGACY_OBJECTIVE_COUNT))!;
    expect(loaded.objective).toBe(OBJECTIVES.length);
  });

  it('a half-finished old track is replayed against the new steps', () => {
    const sim = quietSim();
    sim.state.stats.events.drankByHand = 1;
    sim.state.stats.crafted.campfire = 1;
    const loaded = deserializeState(asVersion2(sim, 4))!;
    expect(loaded.objective).toBe(2);
    expect(new Simulation(loaded).currentObjective()!.title).toBe(OBJECTIVES[2].title);
  });
});
