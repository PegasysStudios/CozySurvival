import { BALANCE } from '../data/balance';
import { RECIPE_BY_ID, type Recipe } from '../data/recipes';
import { ITEMS } from '../data/items';
import { addItem, cloneInventory, countItem, hasAll, removeAll, roomFor, setCapacity, waterUnits } from './inventory';
import type { GameState } from './state';

export interface CraftContext {
  nearFire: boolean;
}

export type CraftFailure = 'unknown' | 'missing' | 'station' | 'noRoom' | 'owned' | 'noCanteen';

export interface CraftCheck {
  ok: boolean;
  reason: CraftFailure | null;
}

export const CRAFT_FAILURE_TEXT: Record<CraftFailure, string> = {
  unknown: 'There is no such recipe.',
  missing: 'Missing ingredients.',
  station: 'Needs a lit campfire nearby.',
  noRoom: 'No room in your pack.',
  owned: 'You already have one.',
  noCanteen: 'You need a canteen to carry water.',
};

export function slotsFor(state: GameState): number {
  const c = BALANCE.carry;
  let n = c.baseSlots;
  if (state.gear.includes('basket')) n += c.basketSlots;
  if (state.gear.includes('backpack')) n += c.backpackSlots;
  return n;
}

export function canCraft(state: GameState, recipe: Recipe, ctx: CraftContext): CraftCheck {
  const fail = (reason: CraftFailure): CraftCheck => ({ ok: false, reason });
  const out = recipe.output;
  if (out.kind === 'tool' && state.tools.includes(out.tool)) return fail('owned');
  if (out.kind === 'gear' && state.gear.includes(out.gear)) return fail('owned');
  if (!hasAll(state.inventory, recipe.inputs)) return fail('missing');
  if (recipe.station === 'fire' && !ctx.nearFire) return fail('station');
  if (out.kind === 'item') {
    const trial = cloneInventory(state.inventory);
    removeAll(trial, recipe.inputs);
    if (roomFor(trial, out.item) < out.count) return fail('noRoom');
    if (ITEMS[out.item].water && !state.gear.includes('canteen')) {
      const consumedWater = recipe.inputs.some((i) => ITEMS[i.item].water);
      if (!consumedWater) return fail('noCanteen');
    }
  }
  return { ok: true, reason: null };
}

/**
 * Crafts an item/tool/gear recipe, consuming inputs atomically.
 * Placeable recipes are only validated here; their inputs are consumed on successful placement.
 */
export function craft(state: GameState, recipeId: string, ctx: CraftContext): CraftCheck {
  const recipe = RECIPE_BY_ID[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown' };
  const check = canCraft(state, recipe, ctx);
  if (!check.ok) return check;
  const out = recipe.output;
  if (out.kind === 'place') return check;
  removeAll(state.inventory, recipe.inputs);
  if (out.kind === 'item') {
    addItem(state.inventory, out.item, out.count);
    state.stats.gathered[out.item] = (state.stats.gathered[out.item] ?? 0) + out.count;
  } else if (out.kind === 'tool') {
    state.tools.push(out.tool);
  } else if (out.kind === 'gear') {
    state.gear.push(out.gear);
    setCapacity(state.inventory, slotsFor(state));
  }
  state.stats.crafted[recipe.id] = (state.stats.crafted[recipe.id] ?? 0) + 1;
  return check;
}

export function canteenRoom(state: GameState): number {
  if (!state.gear.includes('canteen')) return 0;
  return Math.max(0, BALANCE.carry.canteenCapacity - waterUnits(state.inventory));
}

/** How many times the recipe could be made from current inventory. */
export function craftableCount(state: GameState, recipe: Recipe): number {
  let n = Infinity;
  for (const i of recipe.inputs) n = Math.min(n, Math.floor(countItem(state.inventory, i.item) / i.count));
  return n === Infinity ? 0 : n;
}
