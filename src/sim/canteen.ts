import { BALANCE } from '../data/balance';
import { ITEMS, type ItemId } from '../data/items';
import { countItem, removeItem } from './inventory';
import type { CanteenState, GameState } from './state';

export type CanteenItem = keyof CanteenState;

/** Drinking order: raw water first, so boiled water is saved for teas and stews. */
export const CANTEEN_ITEMS: readonly CanteenItem[] = ['lakeWater', 'boiledWater'];

export function inCanteen(item: ItemId): item is CanteenItem {
  return !!ITEMS[item].canteen;
}

export function emptyCanteen(): CanteenState {
  return { lakeWater: 0, boiledWater: 0 };
}

export function canteenServings(s: GameState): number {
  return s.canteen.lakeWater + s.canteen.boiledWater;
}

export function canteenCapacity(s: GameState): number {
  return s.gear.includes('canteen') ? BALANCE.carry.canteenCapacity : 0;
}

export function canteenRoom(s: GameState): number {
  return Math.max(0, canteenCapacity(s) - canteenServings(s));
}

/** 0..1, for the fill bar on the canteen tile. */
export function canteenFill(s: GameState): number {
  const cap = BALANCE.carry.canteenCapacity;
  return cap > 0 ? Math.min(1, canteenServings(s) / cap) : 0;
}

/** Pours up to `count` servings in; returns how many fit. */
export function fillCanteen(s: GameState, item: CanteenItem, count: number): number {
  const n = Math.max(0, Math.min(count, canteenRoom(s)));
  s.canteen[item] += n;
  return n;
}

/** What the next Drink pours, or null when the canteen is empty. */
export function nextServing(s: GameState): CanteenItem | null {
  return CANTEEN_ITEMS.find((i) => s.canteen[i] > 0) ?? null;
}

/** How many of `item` you carry: water from the canteen, everything else from the pack. */
export function haveItem(s: GameState, item: ItemId): number {
  return inCanteen(item) ? s.canteen[item] : countItem(s.inventory, item);
}

export function hasItems(s: GameState, reqs: readonly { item: ItemId; count: number }[]): boolean {
  const need = new Map<ItemId, number>();
  for (const r of reqs) need.set(r.item, (need.get(r.item) ?? 0) + r.count);
  for (const [item, n] of need) if (haveItem(s, item) < n) return false;
  return true;
}

/** Atomic: removes every requirement (water from the canteen) or nothing. */
export function takeItems(s: GameState, reqs: readonly { item: ItemId; count: number }[]): boolean {
  if (!hasItems(s, reqs)) return false;
  for (const r of reqs) {
    if (inCanteen(r.item)) s.canteen[r.item] -= r.count;
    else removeItem(s.inventory, r.item, r.count);
  }
  return true;
}

/** Servings `reqs` would take out of the canteen. */
export function canteenUse(reqs: readonly { item: ItemId; count: number }[]): number {
  let n = 0;
  for (const r of reqs) if (inCanteen(r.item)) n += r.count;
  return n;
}

/**
 * Old saves carried water as pack items. Pour it into the canteen (up to its capacity) and free the slots;
 * water with no canteen to hold it, or past capacity, is poured out.
 */
export function migratePackWater(s: GameState): void {
  const slots = s.inventory.slots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot || !inCanteen(slot.item)) continue;
    fillCanteen(s, slot.item, slot.count);
    slots[i] = null;
  }
}
