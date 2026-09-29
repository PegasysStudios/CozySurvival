import { describe, expect, it } from 'vitest';
import { RESOURCES, RESOURCE_KINDS, type ResourceKind } from '../src/data/resources';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { generateWorld, type WorldGen } from '../src/sim/worldgen';
import { nearestResource, quietSim } from './helpers';

const SEEDS = [1, 42, 777, 20260929];
const OLD = {
  yield: { stickPile: 2, stonePile: 2 },
  starter: { stickPile: 5, stonePile: 5, fern: 4, berryBush: 3, mushroom: 2, onion: 2 } as Record<ResourceKind, number>,
};

/** The world as generated before forage was thinned: every candidate spot grows. */
function legacyWorld(seed: number): WorldGen {
  const saved = RESOURCE_KINDS.map((k) => ({ k, starter: RESOURCES[k].starter, scatter: RESOURCES[k].scatter }));
  try {
    for (const k of RESOURCE_KINDS) Object.assign(RESOURCES[k], { starter: OLD.starter[k], scatter: 1 });
    return generateWorld(seed);
  } finally {
    for (const s of saved) Object.assign(RESOURCES[s.k], { starter: s.starter, scatter: s.scatter });
  }
}

const count = (g: WorldGen, kind: ResourceKind) => g.resources.filter((r) => r.kind === kind).length;

describe('lower stick and stone yields', () => {
  it('stick and stone piles give one per harvest (was two); charges and other forage are unchanged', () => {
    expect(RESOURCES.stickPile.yield).toBe(1);
    expect(RESOURCES.stonePile.yield).toBe(1);
    expect(RESOURCES.stickPile.yield).toBeLessThan(OLD.yield.stickPile);
    expect(RESOURCES.stonePile.yield).toBeLessThan(OLD.yield.stonePile);
    expect(RESOURCES.stickPile.charges).toBe(3);
    expect(RESOURCES.stonePile.charges).toBe(3);
    expect(RESOURCES.fern.yield).toBe(2);
    expect(RESOURCES.berryBush.yield).toBe(2);
  });

  it('a stick pile or stone pile now holds three in total', () => {
    for (const [kind, item] of [['stickPile', 'stick'], ['stonePile', 'stone']] as const) {
      const sim = quietSim();
      const i = nearestResource(sim, kind);
      for (let k = 0; k < 5; k++) sim.perform({ kind: 'resource', index: i, dist: 1 });
      expect(countItem(sim.state.inventory, item)).toBe(3);
      expect(sim.state.resources[i].charges).toBe(0);
    }
  });
});

describe('lower forage spawn rates', () => {
  it.each(SEEDS)('seed %i: forage grows on a share of the old spots, and trees, rocks and logs are identical', (seed) => {
    const now = generateWorld(seed);
    const old = legacyWorld(seed);
    expect(now.trees).toEqual(old.trees);
    expect(now.rocks).toEqual(old.rocks);
    expect(now.logs).toEqual(old.logs);
    expect(now.resourceSpots).toBe(old.resources.length);
    // a strict subset of the old layout: same places, same kinds, nothing new
    for (const r of now.resources) expect(old.resources[r.spot]).toEqual(r);
    expect(now.resources.length).toBeLessThan(old.resources.length * 0.6);
    expect(now.resources.length).toBeGreaterThan(old.resources.length * 0.35);
  });

  it('each kind is thinned roughly by its scatter share, and the starter patch keeps a few of each', () => {
    let nowTotal = 0;
    for (const kind of RESOURCE_KINDS) {
      let now = 0;
      let old = 0;
      for (const seed of SEEDS) {
        now += count(generateWorld(seed), kind) - RESOURCES[kind].starter;
        old += count(legacyWorld(seed), kind) - OLD.starter[kind];
      }
      nowTotal += now;
      expect(now / old).toBeGreaterThan(RESOURCES[kind].scatter - 0.12);
      expect(now / old).toBeLessThan(RESOURCES[kind].scatter + 0.12);
      expect(RESOURCES[kind].starter).toBeGreaterThanOrEqual(1);
      expect(RESOURCES[kind].starter).toBeLessThan(OLD.starter[kind]);
      expect(RESOURCES[kind].scatter).toBeLessThanOrEqual(0.5);
    }
    expect(nowTotal).toBeGreaterThan(0);
  });

  const supply = (g: WorldGen, r: number, kind: ResourceKind, perHarvest: number) =>
    g.resources.filter((x) => x.kind === kind && Math.hypot(x.x, x.z) < r).length * RESOURCES[kind].charges * perHarvest;

  it.each(SEEDS)('seed %i: at most a third of the sticks and stones near spawn, but the first steps are still at hand', (seed) => {
    const now = generateWorld(seed);
    const old = legacyWorld(seed);
    const sticks = supply(now, 25, 'stickPile', RESOURCES.stickPile.yield);
    const stones = supply(now, 25, 'stonePile', RESOURCES.stonePile.yield);
    expect(sticks).toBeLessThanOrEqual(supply(old, 25, 'stickPile', OLD.yield.stickPile) / 3);
    expect(stones).toBeLessThanOrEqual(supply(old, 25, 'stonePile', OLD.yield.stonePile) / 3);
    // gathering, fiber and the stone axe (2 sticks, 2 stones, 2 fiber) come from the starter patch
    expect(sticks).toBeGreaterThanOrEqual(3);
    expect(stones).toBeGreaterThanOrEqual(3);
    expect(supply(now, 20, 'fern', RESOURCES.fern.yield)).toBeGreaterThanOrEqual(3);
  });

  it('on average the day-1 surroundings no longer hold a whole goal track of sticks, stones and fiber', () => {
    // axe, campfire, canteen, spear and lean-to need about 14 sticks, 8 stones and 16 fiber, before firewood
    const avg = (g: (seed: number) => WorldGen, kind: ResourceKind, perHarvest: number) =>
      SEEDS.reduce((a, seed) => a + supply(g(seed), 25, kind, perHarvest), 0) / SEEDS.length;
    expect(avg(generateWorld, 'stickPile', RESOURCES.stickPile.yield)).toBeLessThan(14);
    expect(avg(generateWorld, 'stonePile', RESOURCES.stonePile.yield)).toBeLessThan(8 * 1.5);
    expect(avg(generateWorld, 'fern', RESOURCES.fern.yield)).toBeLessThan(16);
    expect(avg(legacyWorld, 'stickPile', OLD.yield.stickPile)).toBeGreaterThan(14 * 2);
    expect(avg(legacyWorld, 'stonePile', OLD.yield.stonePile)).toBeGreaterThan(8 * 2);
    expect(avg(legacyWorld, 'fern', RESOURCES.fern.yield)).toBeGreaterThan(16);
  });

  it('saves from before the thinning load: surviving spots keep their state, vanished ones are skipped', () => {
    const sim = quietSim();
    const gen = sim.gen;
    const kept = gen.resources[5];
    const gone = gen.resources.findIndex((r, i) => i > 0 && r.spot !== gen.resources[i - 1].spot + 1);
    const missingSpot = gen.resources[gone].spot - 1;
    const json = JSON.parse(serializeState(sim.state));
    json.resources = [[kept.spot, 0, 40], [missingSpot, 1, 12]];
    const loaded = deserializeState(JSON.stringify(json))!;
    expect(loaded).not.toBeNull();
    expect(loaded.resources[5]).toEqual({ charges: 0, respawnAt: 40 });
    expect(loaded.resources.filter((r, i) => r.charges !== RESOURCES[gen.resources[i].kind].charges)).toHaveLength(1);
    // spots that never existed still mark the save as corrupt
    json.resources = [[gen.resourceSpots, 1, 0]];
    expect(deserializeState(JSON.stringify(json))).toBeNull();
    json.resources = [[-1, 1, 0]];
    expect(deserializeState(JSON.stringify(json))).toBeNull();
  });

  it('new saves key resources by spot and round-trip', () => {
    const sim = quietSim();
    const i = 9;
    sim.state.resources[i] = { charges: 1, respawnAt: 30 };
    const json = serializeState(sim.state);
    expect(JSON.parse(json).resources).toEqual([[sim.gen.resources[i].spot, 1, 30]]);
    expect(deserializeState(json)!.resources[i]).toEqual({ charges: 1, respawnAt: 30 });
  });
});
