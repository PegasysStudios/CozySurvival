import { trainSkill, give, giveRecipe, placeStructure, quietSim, run } from './helpers';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { countItem } from '../src/sim/inventory';
import { checkPlacement } from '../src/sim/placement';
import { deserializeState, serializeState, SAVE_FORMAT } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { STATE_VERSION } from '../src/sim/state';

function playedSim(): Simulation {
  const sim = Simulation.newGame(42);
  trainSkill(sim, 'gathering', 8);
  run(sim, 2, { moveZ: 1 });
  giveRecipe(sim, 'axe');
  give(sim, { berries: 4 });
  sim.craft('axe');
  // chop the nearest tree down
  const p = sim.state.player;
  let nearest = 0;
  let best = Infinity;
  sim.gen.trees.forEach((t, i) => {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < best) {
      best = d;
      nearest = i;
    }
  });
  for (let i = 0; i < 10; i++) sim.perform({ kind: 'tree', index: nearest, dist: 1 });
  // gather from a resource
  sim.state.resources[3].charges = 1;
  sim.state.resources[3].respawnAt = 40;
  placeStructure(sim, 'campfire');
  sim.takeEvents([]);
  return sim;
}

describe('save / load', () => {
  it('round-trips the full game state', () => {
    const sim = playedSim();
    const json = serializeState(sim.state);
    const loaded = deserializeState(json)!;
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(sim.state);
    expect(serializeState(loaded)).toBe(json);
  });

  it('stores world changes sparsely', () => {
    const fresh = JSON.parse(serializeState(quietSim().state));
    expect(fresh.trees).toEqual([]);
    expect(fresh.resources).toEqual([]);
    expect(fresh.format).toBe(SAVE_FORMAT);
    const played = JSON.parse(serializeState(playedSim().state));
    expect(played.trees.length).toBe(1);
    expect(played.resources.length).toBe(1);
  });

  it('a loaded world rebuilds colliders for placed structures and stumps', () => {
    const sim = playedSim();
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    const fire = loaded.state.structures[0];
    const env = { ...loaded.placementEnv(), playerX: fire.x + 3, playerZ: fire.z };
    expect(checkPlacement(env, 'campfire', fire.x, fire.z, 0).reason).toBe('structure');
    const felled = loaded.state.trees.findIndex((t) => t.felled);
    const tree = loaded.gen.trees[felled];
    expect(checkPlacement({ ...env, playerX: tree.x + 3, playerZ: tree.z }, 'campfire', tree.x, tree.z, 0).reason).not.toBe('tree');
    expect(countItem(loaded.state.inventory, 'log')).toBeGreaterThan(0);
    expect(loaded.state.tools).toContain('axe');
  });

  it('continues deterministically after loading (rng state is saved)', () => {
    const a = Simulation.newGame(7);
    run(a, 3);
    const b = new Simulation(deserializeState(serializeState(a.state))!);
    run(a, 5);
    run(b, 5);
    expect(b.state.animals.map((x) => [x.x, x.z])).toEqual(a.state.animals.map((x) => [x.x, x.z]));
  });

  it('keeps skills, tool durability, structure condition and swimming', () => {
    const sim = playedSim();
    sim.state.skills.cooking = 33;
    sim.state.toolWear.axe!.dur = 12.5;
    placeStructure(sim, 'leanTo').wear!.dur = 40;
    sim.state.player.swimming = true;
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.version).toBe(STATE_VERSION);
    expect(loaded.skills.cooking).toBe(33);
    expect(loaded.toolWear.axe).toEqual({ dur: 12.5, max: BALANCE.durability.tools.axe.uses });
    expect(loaded.structures.find((s) => s.prefab === 'leanTo')!.wear).toEqual({ dur: 40, max: BALANCE.durability.structures.leanTo.max });
    expect(loaded.player.swimming).toBe(true);
  });

  it('sanitizes bad durability and skill values', () => {
    const obj = JSON.parse(serializeState(playedSim().state));
    obj.toolWear = { axe: { dur: 999, max: 40 }, spear: { max: 0 }, bow: 'broken' };
    obj.skills = { gathering: -5, hunting: 'lots', cooking: 12 };
    const loaded = deserializeState(JSON.stringify(obj))!;
    expect(loaded.toolWear).toEqual({ axe: { dur: 40, max: 40 } });
    expect(loaded.skills).toEqual({ gathering: 0, hunting: 0, cooking: 12, crafting: 0, fishing: 0, skinning: 0 });
  });

  it('migrates version-1 saves from before skills, durability, trunks and swimming', () => {
    const sim = playedSim();
    placeStructure(sim, 'leanTo');
    const felled = sim.state.trees.findIndex((t) => t.felled);
    const v1 = JSON.parse(serializeState(sim.state));
    v1.version = 1;
    delete v1.skills;
    delete v1.toolWear;
    delete v1.player.swimming;
    v1.structures = v1.structures.map(({ wear: _wear, ...rest }: { wear?: unknown }) => rest);
    v1.trees = v1.trees.map((e: number[]) => e.slice(0, 5));

    const state = deserializeState(JSON.stringify(v1))!;
    expect(state).not.toBeNull();
    expect(state.version).toBe(STATE_VERSION);
    expect(state.skills).toEqual({ gathering: 0, hunting: 0, cooking: 0, crafting: 0, fishing: 0, skinning: 0 });
    expect(state.toolWear).toEqual({});
    expect(state.player.swimming).toBe(false);
    expect(state.structures.find((s) => s.prefab === 'campfire')!.wear).toBeUndefined();
    expect(state.structures.find((s) => s.prefab === 'leanTo')!.wear).toEqual({ dur: BALANCE.durability.structures.leanTo.max, max: BALANCE.durability.structures.leanTo.max });
    // a tree felled back then already paid out its logs, so it leaves just a stump
    expect(state.trees[felled]).toMatchObject({ felled: true, logs: 0, cuts: 0 });

    const loaded = new Simulation(state);
    expect(loaded.trunk(felled)).toBeNull();
    expect(countItem(loaded.state.inventory, 'log')).toBe(countItem(sim.state.inventory, 'log'));
    loaded.selectTool('axe');
    let standing = -1;
    loaded.state.trees.forEach((t, i) => {
      if (standing < 0 && !t.felled) standing = i;
    });
    loaded.perform({ kind: 'tree', index: standing, dist: 1 });
    expect(loaded.state.toolWear.axe).toEqual({ dur: BALANCE.durability.tools.axe.uses - 1, max: BALANCE.durability.tools.axe.uses });
    // and it saves forward as version 2
    expect(JSON.parse(serializeState(loaded.state)).version).toBe(STATE_VERSION);
  });

  it('loads saves from before round 6 that still list learned recipes, and every recipe stays craftable', () => {
    const sim = quietSim();
    const raw = JSON.parse(serializeState(sim.state));
    raw.known = ['cordage'];
    const loaded = deserializeState(JSON.stringify(raw))!;
    expect(loaded).not.toBeNull();
    expect('known' in loaded).toBe(false);
    const again = new Simulation(loaded);
    giveRecipe(again, 'rod');
    expect(again.canCraft('rod').ok).toBe(true);
    expect(JSON.parse(serializeState(loaded)).known).toBeUndefined();
  });

  it('rejects corrupt or incompatible saves', () => {
    const json = serializeState(quietSim().state);
    expect(deserializeState(null)).toBeNull();
    expect(deserializeState('')).toBeNull();
    expect(deserializeState('{not json')).toBeNull();
    expect(deserializeState('[]')).toBeNull();
    const obj = JSON.parse(json);
    expect(deserializeState(JSON.stringify({ ...obj, version: 999 }))).toBeNull();
    expect(deserializeState(JSON.stringify({ ...obj, format: 'other' }))).toBeNull();
    const noPlayer = { ...obj };
    delete noPlayer.player;
    expect(deserializeState(JSON.stringify(noPlayer))).toBeNull();
    expect(deserializeState(JSON.stringify({ ...obj, trees: [[999999, 1, 0, 0, 0]] }))).toBeNull();
    expect(deserializeState(JSON.stringify({ ...obj, inventory: { slots: 'nope' } }))).toBeNull();
  });
});
