import { describe, expect, it } from 'vitest';
import { circle } from '../src/core/geom2d';
import { makeCollider } from '../src/sim/colliders';
import { countItem } from '../src/sim/inventory';
import { checkPlacement, type PlacementEnv } from '../src/sim/placement';
import { fakeTerrain, colliderQuery, findValidSpot, give, quietSim, teleport } from './helpers';

/** A dry point on the spawn-side shore and a water point ~3m out into the lake. */
function shoreline(sim: ReturnType<typeof quietSim>) {
  const lake = sim.terrain.lakes[0];
  const len = Math.hypot(lake.x, lake.z);
  const dx = lake.x / len;
  const dz = lake.z / len;
  for (let d = 0; d < len; d += 0.25) {
    if (sim.terrain.heightAt(dx * d, dz * d) < -0.2) {
      return { shore: { x: dx * (d - 3), z: dz * (d - 3) }, water: { x: dx * (d + 1.5), z: dz * (d + 1.5) } };
    }
  }
  throw new Error('no shoreline');
}

function flatEnv(colliders = [] as ReturnType<typeof makeCollider>[], height = (_x: number, _z: number) => 2): PlacementEnv {
  return { terrain: fakeTerrain(height), query: colliderQuery(colliders), playerX: 0, playerZ: -5 };
}

describe('placement validity (synthetic world)', () => {
  it('accepts flat, dry, empty ground', () => {
    expect(checkPlacement(flatEnv(), 'leanTo', 0, 0, 0)).toMatchObject({ valid: true, reason: null });
  });

  it('rejects footprints touching water', () => {
    const env = flatEnv([], (x) => (x > 1.2 ? -0.5 : 2));
    expect(checkPlacement(env, 'leanTo', 0, 0, 0).reason).toBe('water');
    expect(checkPlacement(env, 'campfire', -1, 0, 0).valid).toBe(true);
  });

  it('enforces the slope limit per prefab', () => {
    const ramp = (k: number) => (x: number) => 2 + x * k;
    expect(checkPlacement(flatEnv([], ramp(0.1)), 'leanTo', 0, 0, 0).valid).toBe(true);
    expect(checkPlacement(flatEnv([], ramp(0.35)), 'leanTo', 0, 0, 0).reason).toBe('slope');
    // campfire is small so the same ramp is fine for it
    expect(checkPlacement(flatEnv([], ramp(0.2)), 'campfire', 0, 0, 0).valid).toBe(true);
  });

  it('rejects overlap with trees, rocks, structures, and resources', () => {
    const tree = makeCollider('tree', 0, circle(1, 0, 0.4), circle(1, 0, 0.75));
    expect(checkPlacement(flatEnv([tree]), 'leanTo', 0, 0, 0).reason).toBe('tree');
    const rock = makeCollider('rock', 0, circle(0, 1, 0.8), circle(0, 1, 0.9));
    expect(checkPlacement(flatEnv([rock]), 'campfire', 0, 0, 0).reason).toBe('rock');
    const hut = makeCollider('structure', 9, circle(0, 0, 1), circle(0, 0, 1.7));
    expect(checkPlacement(flatEnv([hut]), 'campfire', 2, 0, 0).reason).toBe('structure');
    const bush = makeCollider('resource', 3, null, circle(0.5, 0.5, 0.6));
    expect(checkPlacement(flatEnv([bush]), 'campfire', 0, 0, 0).reason).toBe('resource');
  });

  it('rotation matters: a lean-to that clips two trees fits when turned 90 degrees', () => {
    const trees = [
      makeCollider('tree', 0, circle(-2.0, 0, 0.3), circle(-2.0, 0, 0.5)),
      makeCollider('tree', 1, circle(2.0, 0, 0.3), circle(2.0, 0, 0.5)),
    ];
    const env = flatEnv(trees);
    expect(checkPlacement(env, 'leanTo', 0, 0, 0).reason).toBe('tree');
    expect(checkPlacement(env, 'leanTo', 0, 0, Math.PI / 2).valid).toBe(true);
  });

  it('rejects building on top of the player or out of reach', () => {
    const env = { ...flatEnv(), playerX: 1, playerZ: 0.5 };
    expect(checkPlacement(env, 'leanTo', 0, 0, 0).reason).toBe('player');
    expect(checkPlacement({ ...flatEnv(), playerX: 0, playerZ: -20 }, 'campfire', 0, 0, 0).reason).toBe('distance');
  });
});

describe('placement in the real world', () => {
  it('blocks placement on a real tree trunk, boulder, and the lake', () => {
    const sim = quietSim();
    const env = sim.placementEnv();
    const flat = (x: number, z: number) => sim.terrain.slopeAt(x, z) < 0.08 && sim.terrain.heightAt(x, z) > 1 && sim.terrain.inPlayBounds(x, z, 10);
    const tree = sim.gen.trees.find((t) => flat(t.x, t.z))!;
    expect(checkPlacement({ ...env, playerX: tree.x + 4, playerZ: tree.z }, 'campfire', tree.x, tree.z, 0).reason).toBe('tree');
    const rock = sim.gen.rocks.find((r) => flat(r.x, r.z))!;
    expect(checkPlacement({ ...env, playerX: rock.x + rock.r + 3, playerZ: rock.z }, 'campfire', rock.x, rock.z, 0).reason).toBe('rock');
    const { shore, water } = shoreline(sim);
    expect(checkPlacement({ ...env, playerX: shore.x, playerZ: shore.z }, 'campfire', water.x, water.z, 0).reason).toBe('water');
  });

  it('consumes ingredients only when placement succeeds', () => {
    const sim = quietSim();
    sim.state.known.push('campfire');
    give(sim, { stone: 5, stick: 6, fiber: 1 });
    expect(sim.beginPlacement('campfire')).toBe(true);

    // invalid: in the lake
    const { shore, water } = shoreline(sim);
    teleport(sim, shore.x, shore.z);
    sim.setPlacementAt(water.x, water.z);
    expect(sim.placement!.valid).toBe(false);
    expect(sim.placement!.reason).toBe('water');
    expect(sim.confirmPlacement()).toBe(false);
    expect(countItem(sim.state.inventory, 'stone')).toBe(5);
    expect(sim.state.structures).toHaveLength(0);

    // valid spot near spawn
    teleport(sim, 0, 0);
    const spot = findValidSpot(sim, 'campfire');
    sim.setPlacementAt(spot.x, spot.z);
    expect(sim.placement!.valid).toBe(true);
    expect(sim.confirmPlacement()).toBe(true);
    expect(countItem(sim.state.inventory, 'stone')).toBe(0);
    expect(countItem(sim.state.inventory, 'stick')).toBe(2);
    expect(countItem(sim.state.inventory, 'fiber')).toBe(0);
    expect(sim.state.structures).toHaveLength(1);
    expect(sim.placement).toBeNull();

    // the new campfire now blocks a second one at the same spot
    give(sim, { stone: 5, stick: 4, fiber: 1 });
    sim.beginPlacement('campfire');
    sim.setPlacementAt(spot.x, spot.z);
    expect(sim.placement!.reason).toBe('structure');
  });

  it('cancelling placement keeps every ingredient', () => {
    const sim = quietSim();
    sim.state.known.push('campfire');
    give(sim, { stone: 5, stick: 4, fiber: 1 });
    sim.beginPlacement('campfire');
    sim.cancelPlacement();
    expect(sim.placement).toBeNull();
    expect(countItem(sim.state.inventory, 'stone')).toBe(5);
  });

  it('reports missing ingredients if they disappear mid-placement', () => {
    const sim = quietSim();
    sim.state.known.push('campfire');
    give(sim, { stone: 5, stick: 4, fiber: 1 });
    sim.beginPlacement('campfire');
    sim.state.inventory.slots.fill(null);
    const spot = findValidSpot(sim, 'campfire');
    sim.setPlacementAt(spot.x, spot.z);
    expect(sim.placement!.reason).toBe('missing');
    expect(sim.confirmPlacement()).toBe(false);
    expect(sim.state.structures).toHaveLength(0);
  });
});
