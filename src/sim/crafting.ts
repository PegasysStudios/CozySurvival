import { BALANCE } from '../data/balance';
import { lockedToday } from '../data/objectives';
import { RECIPE_BY_ID, type Recipe } from '../data/recipes';
import { addItem, cloneInventory, removeItem, roomFor, setCapacity } from './inventory';
import { canteenCapacity, canteenRoom, canteenUse, fillCanteen, hasItems, haveItem, inCanteen, takeItems } from './canteen';
import type { GameState } from './state';

export interface CraftContext {
  nearFire: boolean;
}

export type CraftFailure = 'unknown' | 'missing' | 'station' | 'noRoom' | 'owned' | 'noCanteen' | 'canteenFull' | 'tomorrow';

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
  canteenFull: 'Your canteen is full.',
  tomorrow: 'Unlocks tomorrow.',
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
  if (lockedToday(state, recipe.id)) return fail('tomorrow');
  if (!hasItems(state, recipe.inputs)) return fail('missing');
  if (recipe.station === 'fire' && !ctx.nearFire) return fail('station');
  if (out.kind === 'item') {
    if (inCanteen(out.item)) {
      if (canteenCapacity(state) === 0) return fail('noCanteen');
      if (canteenRoom(state) + canteenUse(recipe.inputs) < out.count) return fail('canteenFull');
    } else {
      const trial = cloneInventory(state.inventory);
      for (const i of recipe.inputs) if (!inCanteen(i.item)) removeItem(trial, i.item, i.count);
      if (roomFor(trial, out.item) < out.count) return fail('noRoom');
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
  takeItems(state, recipe.inputs);
  if (out.kind === 'item') {
    if (inCanteen(out.item)) fillCanteen(state, out.item, out.count);
    else addItem(state.inventory, out.item, out.count);
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

/** How many times the recipe could be made from what you carry. */
export function craftableCount(state: GameState, recipe: Recipe): number {
  let n = Infinity;
  for (const i of recipe.inputs) n = Math.min(n, Math.floor(haveItem(state, i.item) / i.count));
  return n === Infinity ? 0 : n;
}
