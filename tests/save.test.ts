import { describe, expect, it } from 'vitest';
import { countItem } from '../src/sim/inventory';
import { checkPlacement } from '../src/sim/placement';
import { deserializeState, serializeState, SAVE_FORMAT } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { findValidSpot, give, quietSim, run } from './helpers';

function playedSim(): Simulation {
  const sim = Simulation.newGame(42);
  run(sim, 2, { moveZ: 1 });
  sim.state.known.push('axe', 'campfire');
  give(sim, { stick: 8, stone: 7, fiber: 3, berries: 4 });
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
  // place a campfire
  sim.beginPlacement('campfire');
  const spot = findValidSpot(sim, 'campfire');
  sim.setPlacementAt(spot.x, spot.z);
  sim.confirmPlacement();
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
