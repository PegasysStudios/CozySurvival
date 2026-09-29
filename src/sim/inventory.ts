import { ITEMS, type ItemId } from '../data/items';
import type { InventoryState, Slot } from './state';

export function createInventory(capacity: number): InventoryState {
  return { slots: new Array<Slot | null>(capacity).fill(null) };
}

export function capacity(inv: InventoryState): number {
  return inv.slots.length;
}

export function countItem(inv: InventoryState, item: ItemId): number {
  let n = 0;
  for (const s of inv.slots) if (s && s.item === item) n += s.count;
  return n;
}

export function usedSlots(inv: InventoryState): number {
  let n = 0;
  for (const s of inv.slots) if (s) n++;
  return n;
}

/** How many of `item` could be added right now. */
export function roomFor(inv: InventoryState, item: ItemId): number {
  const stack = ITEMS[item].stack;
  let room = 0;
  for (const s of inv.slots) {
    if (!s) room += stack;
    else if (s.item === item) room += stack - s.count;
  }
  return room;
}

/** Adds up to `count`, filling existing stacks first. Returns the amount actually added. */
export function addItem(inv: InventoryState, item: ItemId, count: number): number {
  if (count <= 0) return 0;
  const stack = ITEMS[item].stack;
  let left = count;
  for (const s of inv.slots) {
    if (left <= 0) break;
    if (s && s.item === item && s.count < stack) {
      const n = Math.min(stack - s.count, left);
      s.count += n;
      left -= n;
    }
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (!inv.slots[i]) {
      const n = Math.min(stack, left);
      inv.slots[i] = { item, count: n };
      left -= n;
    }
  }
  return count - left;
}

/** Removes exactly `count` or nothing. Takes from the last stacks first. */
export function removeItem(inv: InventoryState, item: ItemId, count: number): boolean {
  if (count <= 0) return true;
  if (countItem(inv, item) < count) return false;
  let left = count;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i];
    if (s && s.item === item) {
      const n = Math.min(s.count, left);
      s.count -= n;
      left -= n;
      if (s.count === 0) inv.slots[i] = null;
    }
  }
  return true;
}

export function removeFromSlot(inv: InventoryState, index: number, count: number): Slot | null {
  const s = inv.slots[index];
  if (!s) return null;
  const n = Math.min(count, s.count);
  s.count -= n;
  const taken: Slot = { item: s.item, count: n };
  if (s.count <= 0) inv.slots[index] = null;
  return taken;
}

export function hasAll(inv: InventoryState, reqs: readonly { item: ItemId; count: number }[]): boolean {
  for (const r of reqs) if (countItem(inv, r.item) < r.count) return false;
  return true;
}

/** Atomic multi-remove: either every requirement is removed or nothing changes. */
export function removeAll(inv: InventoryState, reqs: readonly { item: ItemId; count: number }[]): boolean {
  if (!hasAll(inv, reqs)) return false;
  for (const r of reqs) removeItem(inv, r.item, r.count);
  return true;
}

export function cloneInventory(inv: InventoryState): InventoryState {
  return { slots: inv.slots.map((s) => (s ? { item: s.item, count: s.count } : null)) };
}

/** Grow capacity (never shrinks). */
export function setCapacity(inv: InventoryState, n: number): void {
  while (inv.slots.length < n) inv.slots.push(null);
}

export function waterUnits(inv: InventoryState): number {
  let n = 0;
  for (const s of inv.slots) if (s && ITEMS[s.item].water) n += s.count;
  return n;
}
