import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { ITEMS, type ItemId } from '../src/data/items';
import { OBJECTIVES } from '../src/data/objectives';
import { RECIPE_BY_ID, RECIPES } from '../src/data/recipes';
import { fillCanteen, inCanteen } from '../src/sim/canteen';
import { canCraft, craft } from '../src/sim/crafting';
import { addItem, countItem } from '../src/sim/inventory';
import { createNewState } from '../src/sim/simulation';
import type { GameState } from '../src/sim/state';
import { giveRecipe, quietSim } from './helpers';

function fresh(): GameState {
  return createNewState(42);
}

function stock(s: GameState, items: Partial<Record<ItemId, number>>) {
  for (const [k, v] of Object.entries(items) as [ItemId, number][]) {
    if (inCanteen(k)) fillCanteen(s, k, v);
    else addItem(s.inventory, k, v);
  }
}

const noFire = { nearFire: false };
const atFire = { nearFire: true };

describe('recipe data', () => {
  it('every recipe has a unique id and at least one known ingredient', () => {
    const ids = new Set(RECIPES.map((r) => r.id));
    expect(ids.size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(r.inputs.length).toBeGreaterThan(0);
      for (const i of r.inputs) expect(ITEMS[i.item]).toBeDefined();
    }
  });

  it('meals are multi-ingredient and need a fire', () => {
    for (const id of ['skewer', 'berryTea', 'stew', 'cedarTrout', 'troutChowder', 'troutSkewer', 'smokedTrout']) {
      const r = RECIPE_BY_ID[id];
      expect(r.station).toBe('fire');
      expect(new Set(r.inputs.map((i) => i.item)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('every recipe is available from the start (round 6)', () => {
  it('a brand-new character can make anything it has the materials for', () => {
    for (const r of RECIPES) {
      const s = fresh();
      s.gear.push('basket', 'backpack', 'canteen');
      stock(s, Object.fromEntries(r.inputs.map((i) => [i.item, i.count])));
      const check = canCraft(s, r, atFire);
      expect(check.reason === null || check.reason === 'owned', `${r.id}: ${check.reason}`).toBe(true);
    }
  });

  it('without materials, every recipe reports missing ingredients rather than being hidden', () => {
    const s = fresh();
    for (const r of RECIPES) expect(canCraft(s, r, atFire).reason, r.id).toBe('missing');
  });
});

describe('crafting', () => {
  it('fails for unknown recipes and missing ingredients without side effects', () => {
    const s = fresh();
    stock(s, { stick: 2, stone: 2, fiber: 2 });
    expect(craft(s, 'noSuchThing', noFire)).toEqual({ ok: false, reason: 'unknown' });
    s.inventory.slots.fill(null);
    stock(s, { stick: 2, stone: 1, fiber: 2 });
    expect(craft(s, 'axe', noFire).reason).toBe('missing');
    expect(countItem(s.inventory, 'stick')).toBe(2);
  });

  it('consumes exact inputs and grants a tool once', () => {
    const s = fresh();
    stock(s, { stick: 9, stone: 6, fiber: 6 });
    expect(craft(s, 'axe', noFire).ok).toBe(true);
    expect(s.tools).toContain('axe');
    expect(countItem(s.inventory, 'stick')).toBe(3);
    expect(countItem(s.inventory, 'stone')).toBe(0);
    expect(s.stats.crafted.axe).toBe(1);
    stock(s, { stick: 3, stone: 6, fiber: 6 });
    expect(craft(s, 'axe', noFire).reason).toBe('owned');
  });

  it('cooking requires a lit fire nearby', () => {
    const s = fresh();
    stock(s, { mushroom: 2, onion: 1, stick: 1 });
    expect(canCraft(s, RECIPE_BY_ID.skewer, noFire).reason).toBe('station');
    expect(craft(s, 'skewer', atFire).ok).toBe(true);
    expect(countItem(s.inventory, 'skewer')).toBe(1);
    expect(countItem(s.inventory, 'mushroom')).toBe(0);
  });

  it('forest stew consumes all four ingredients', () => {
    const s = fresh();
    s.gear.push('canteen');
    stock(s, { boiledWater: 1, rawMeat: 2, mushroom: 1, onion: 1 });
    expect(craft(s, 'stew', atFire).ok).toBe(true);
    expect(countItem(s.inventory, 'stew')).toBe(1);
    expect(s.canteen.boiledWater).toBe(0);
    expect(countItem(s.inventory, 'rawMeat')).toBe(1);
  });

  it('refuses when the output would not fit, consuming nothing', () => {
    const s = fresh();
    const items = ['stone', 'berries', 'onion', 'mushroom', 'bark'] as const;
    for (const it of items) addItem(s.inventory, it, 1);
    addItem(s.inventory, 'fiber', 4);
    // 6/6 slots used; crafting cordage frees the fiber slot so it fits
    expect(craft(s, 'cordage', noFire).ok).toBe(true);
    // now fill every slot with full stacks and try again
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'stone' as const, count: 10 }));
    s.inventory.slots[0] = { item: 'fiber', count: ITEMS.fiber.stack };
    expect(craft(s, 'cordage', noFire).reason).toBe('noRoom');
    expect(countItem(s.inventory, 'fiber')).toBe(ITEMS.fiber.stack);
  });

  it('gear expands carry capacity', () => {
    const s = fresh();
    stock(s, { fiber: 30, stick: 10 });
    expect(s.inventory.slots.length).toBe(BALANCE.carry.baseSlots);
    expect(craft(s, 'basket', noFire).ok).toBe(true);
    expect(s.inventory.slots.length).toBe(BALANCE.carry.baseSlots + BALANCE.carry.basketSlots);
  });

  it('placeable recipes do not consume ingredients when selected (only on placement)', () => {
    const sim = quietSim();
    giveRecipe(sim, 'campfire');
    const res = sim.craft('campfire');
    expect(res.ok).toBe(true);
    expect(sim.placement?.prefab).toBe('campfire');
    expect(countItem(sim.state.inventory, 'stone')).toBe(25);
  });
});

/** How many pack slots a recipe's ingredients take up. */
function slotsNeeded(id: string): number {
  return RECIPE_BY_ID[id].inputs.reduce((n, i) => n + Math.ceil(i.count / ITEMS[i.item].stack), 0);
}

/** Costs before round 4, keyed by recipe id. */
const ROUND3_COSTS: Record<string, Record<string, number>> = {
  cordage: { fiber: 3 },
  axe: { stick: 2, stone: 2, fiber: 2 },
  spear: { stick: 3, stone: 1, cordage: 1 },
  bow: { stick: 3, cordage: 2 },
  torch: { stick: 1, fiber: 2, bark: 1 },
  basket: { fiber: 6, stick: 2 },
  canteen: { bark: 3, cordage: 1 },
  backpack: { hide: 2, cordage: 2, stick: 2 },
  campfire: { stone: 5, stick: 4, fiber: 1 },
  leanTo: { log: 3, stick: 4, fiber: 4, cordage: 1 },
  bench: { log: 2 },
};

describe('round 4 crafting costs', () => {
  const cost = (id: string) => Object.fromEntries(RECIPE_BY_ID[id].inputs.map((i) => [i.item, i.count]));

  it("the log bench goes from 2 logs to 10 (Jon's example)", () => {
    expect(cost('bench')).toEqual({ log: 10 });
  });

  it('every gear, tool, structure and material recipe costs more, 5x unless it is a listed exception', () => {
    const exceptions = new Set(['cordage', 'axe', 'leanTo']);
    for (const [id, before] of Object.entries(ROUND3_COSTS)) {
      const after = cost(id);
      expect(Object.keys(after).sort(), id).toEqual(Object.keys(before).sort());
      for (const [item, n] of Object.entries(before)) {
        expect(after[item], `${id} ${item}`).toBeGreaterThan(n);
        if (!exceptions.has(id)) expect(after[item], `${id} ${item}`).toBe(n * 5);
      }
      if (exceptions.has(id)) expect(Object.entries(before).some(([item, n]) => after[item] < n * 5), id).toBe(true);
    }
  });

  it('arrows, cooking and campfire fuel keep their costs', () => {
    expect(cost('arrows')).toEqual({ stick: 2, stone: 1, fiber: 1 });
    expect(RECIPE_BY_ID.arrows.output).toEqual({ kind: 'item', item: 'arrow', count: 4 });
    expect(cost('boilWater')).toEqual({ lakeWater: 1 });
    expect(cost('cookedMeat')).toEqual({ rawMeat: 1 });
    expect(cost('grilledTrout')).toEqual({ rawFish: 1 });
    expect(cost('skewer')).toEqual({ mushroom: 2, onion: 1, stick: 1 });
    expect(cost('berryTea')).toEqual({ boiledWater: 1, berries: 2 });
    expect(cost('stew')).toEqual({ boiledWater: 1, rawMeat: 1, mushroom: 1, onion: 1 });
    expect(cost('cedarTrout')).toEqual({ rawFish: 1, onion: 1, bark: 1 });
    expect(BALANCE.fire.stickFuelHours).toBe(1.5);
    expect(BALANCE.fire.logFuelHours).toBe(4);
  });

  it('nothing needs more than the base 6-slot pack, so no recipe depends on a basket or backpack', () => {
    for (const r of RECIPES) expect(slotsNeeded(r.id), r.id).toBeLessThanOrEqual(BALANCE.carry.baseSlots);
  });

  it('the fishing pole is sticks, stone and cordage at 5x a small base cost', () => {
    expect(cost('rod')).toEqual({ stick: 10, stone: 5, cordage: 5 });
    expect(RECIPE_BY_ID.rod.output).toEqual({ kind: 'tool', tool: 'rod' });
  });

  it('the campfire objective counts the pack against the 5x campfire cost', () => {
    const s = fresh();
    s.gear.push('basket', 'backpack');
    stock(s, { stone: 9, stick: 30 });
    const camp = OBJECTIVES.find((o) => o.id === 'camp')!;
    expect(camp.needs(s).map((n) => `${n.label} ${n.have}/${n.need}`)).toEqual(['Stones 9/25', 'Sticks 20/20', 'Plant Fiber 0/5', 'Campfire built 0/1']);
  });

  it('the hide tent is no longer a recipe: it is only reached by upgrading a shelter', () => {
    expect(RECIPE_BY_ID.hideTent).toBeUndefined();
  });
});
