import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { RECIPE_BY_ID, RECIPES } from '../src/data/recipes';
import { canCraft, checkUnlocks, craft, ruleMet } from '../src/sim/crafting';
import { addItem, countItem } from '../src/sim/inventory';
import { createNewState } from '../src/sim/simulation';
import type { GameState } from '../src/sim/state';
import { give, quietSim } from './helpers';

function fresh(): GameState {
  return createNewState(42);
}

function stock(s: GameState, items: Record<string, number>) {
  for (const [k, v] of Object.entries(items)) addItem(s.inventory, k as never, v);
}

const noFire = { nearFire: false };
const atFire = { nearFire: true };

describe('recipe data', () => {
  it('every recipe references known items and has a reachable unlock rule', () => {
    const ids = new Set(RECIPES.map((r) => r.id));
    expect(ids.size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(r.inputs.length).toBeGreaterThan(0);
      for (const c of [...(r.unlock.all ?? []), ...(r.unlock.any ?? [])]) {
        if ('crafted' in c) expect(ids.has(c.crafted)).toBe(true);
      }
    }
  });

  it('meals are multi-ingredient and need a fire', () => {
    for (const id of ['skewer', 'berryTea', 'stew', 'cedarTrout']) {
      const r = RECIPE_BY_ID[id];
      expect(r.station).toBe('fire');
      expect(new Set(r.inputs.map((i) => i.item)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('learn-by-doing unlocks', () => {
  it('starts knowing nothing', () => {
    const s = fresh();
    expect(checkUnlocks(s)).toEqual([]);
    expect(s.known).toEqual([]);
  });

  it('gathering sticks and stones teaches the stone axe', () => {
    const s = fresh();
    s.stats.gathered.stick = 2;
    s.stats.gathered.stone = 1;
    expect(checkUnlocks(s)).not.toContain('axe');
    s.stats.gathered.stone = 2;
    expect(checkUnlocks(s)).toContain('axe');
    expect(s.known).toContain('axe');
    // learned only once
    expect(checkUnlocks(s)).not.toContain('axe');
  });

  it('hitting the carry limit teaches the basket; bark teaches the canteen', () => {
    const s = fresh();
    s.stats.events.packFull = 1;
    s.stats.gathered.bark = 1;
    const learned = checkUnlocks(s);
    expect(learned).toEqual(expect.arrayContaining(['basket', 'canteen']));
  });

  it('spooking a deer (or crafting a spear) teaches the bow', () => {
    const s = fresh();
    expect(ruleMet(s.stats, RECIPE_BY_ID.bow.unlock)).toBe(false);
    s.stats.events.deerSpooked = 1;
    expect(ruleMet(s.stats, RECIPE_BY_ID.bow.unlock)).toBe(true);
  });

  it('progression chain unlocks in order: axe -> campfire & spear -> leanTo after logs', () => {
    const s = fresh();
    Object.assign(s.stats.gathered, { stick: 3, stone: 3, fiber: 3 });
    checkUnlocks(s);
    expect(s.known).toEqual(expect.arrayContaining(['axe', 'cordage']));
    expect(s.known).not.toContain('campfire');
    s.stats.crafted.axe = 1;
    checkUnlocks(s);
    expect(s.known).toEqual(expect.arrayContaining(['campfire', 'spear']));
    expect(s.known).not.toContain('leanTo');
    s.stats.gathered.log = 1;
    checkUnlocks(s);
    expect(s.known).toContain('leanTo');
  });
});

describe('crafting', () => {
  it('fails for unknown recipes and missing ingredients without side effects', () => {
    const s = fresh();
    stock(s, { stick: 2, stone: 2, fiber: 2 });
    expect(craft(s, 'axe', noFire)).toEqual({ ok: false, reason: 'unknown' });
    s.known.push('axe');
    s.inventory.slots.fill(null);
    stock(s, { stick: 2, stone: 1, fiber: 2 });
    expect(craft(s, 'axe', noFire).reason).toBe('missing');
    expect(countItem(s.inventory, 'stick')).toBe(2);
  });

  it('consumes exact inputs and grants a tool once', () => {
    const s = fresh();
    s.known.push('axe');
    stock(s, { stick: 5, stone: 2, fiber: 2 });
    expect(craft(s, 'axe', noFire).ok).toBe(true);
    expect(s.tools).toContain('axe');
    expect(countItem(s.inventory, 'stick')).toBe(3);
    expect(countItem(s.inventory, 'stone')).toBe(0);
    expect(s.stats.crafted.axe).toBe(1);
    stock(s, { stone: 2, fiber: 2 });
    expect(craft(s, 'axe', noFire).reason).toBe('owned');
  });

  it('cooking requires a lit fire nearby', () => {
    const s = fresh();
    s.known.push('skewer');
    stock(s, { mushroom: 2, onion: 1, stick: 1 });
    expect(canCraft(s, RECIPE_BY_ID.skewer, noFire).reason).toBe('station');
    expect(craft(s, 'skewer', atFire).ok).toBe(true);
    expect(countItem(s.inventory, 'skewer')).toBe(1);
    expect(countItem(s.inventory, 'mushroom')).toBe(0);
  });

  it('forest stew consumes all four ingredients', () => {
    const s = fresh();
    s.known.push('stew');
    s.gear.push('canteen');
    stock(s, { boiledWater: 1, rawMeat: 2, mushroom: 1, onion: 1 });
    expect(craft(s, 'stew', atFire).ok).toBe(true);
    expect(countItem(s.inventory, 'stew')).toBe(1);
    expect(countItem(s.inventory, 'boiledWater')).toBe(0);
    expect(countItem(s.inventory, 'rawMeat')).toBe(1);
  });

  it('refuses when the output would not fit, consuming nothing', () => {
    const s = fresh();
    s.known.push('cordage');
    const items = ['stone', 'berries', 'onion', 'mushroom', 'bark'] as const;
    for (const it of items) addItem(s.inventory, it, 1);
    addItem(s.inventory, 'fiber', 3);
    // 6/6 slots used; crafting cordage frees the fiber slot so it fits
    expect(craft(s, 'cordage', noFire).ok).toBe(true);
    // now fill every slot with full stacks and try again
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'stone' as const, count: 10 }));
    s.inventory.slots[0] = { item: 'fiber', count: 16 };
    expect(craft(s, 'cordage', noFire).reason).toBe('noRoom');
    expect(countItem(s.inventory, 'fiber')).toBe(16);
  });

  it('gear expands carry capacity', () => {
    const s = fresh();
    s.known.push('basket');
    stock(s, { fiber: 6, stick: 2 });
    expect(s.inventory.slots.length).toBe(BALANCE.carry.baseSlots);
    expect(craft(s, 'basket', noFire).ok).toBe(true);
    expect(s.inventory.slots.length).toBe(BALANCE.carry.baseSlots + BALANCE.carry.basketSlots);
  });

  it('placeable recipes do not consume ingredients when selected (only on placement)', () => {
    const sim = quietSim();
    sim.state.known.push('campfire');
    give(sim, { stone: 5, stick: 4, fiber: 1 });
    const res = sim.craft('campfire');
    expect(res.ok).toBe(true);
    expect(sim.placement?.prefab).toBe('campfire');
    expect(countItem(sim.state.inventory, 'stone')).toBe(5);
  });
});
