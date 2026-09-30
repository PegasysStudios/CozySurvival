import { ITEMS, type ItemId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { addItem, countItem } from './inventory';
import type { Slot, StructureState } from './state';

export function storeSlots(prefab: PrefabId): number {
  return PREFABS[prefab].storage?.slots ?? 0;
}

/** A storage structure's slots, created or grown to its tier's size (never shrunk, so nothing is lost). */
export function ensureStore(st: StructureState): (Slot | null)[] {
  const n = storeSlots(st.prefab);
  if (!st.store) st.store = [];
  while (st.store.length < n) st.store.push(null);
  return st.store;
}

/** Adds up to `count` of `item`, filling existing stacks first; returns how many fit. */
export function addToStore(store: (Slot | null)[], item: ItemId, count: number): number {
  return addItem({ slots: store }, item, count);
}

/** Removes up to `count` of `item` (last stacks first); returns how many were there to take. */
export function removeFromStore(store: (Slot | null)[], item: ItemId, count: number): number {
  let left = Math.min(count, countItem({ slots: store }, item));
  const taken = left;
  for (let i = store.length - 1; i >= 0 && left > 0; i--) {
    const s = store[i];
    if (!s || s.item !== item) continue;
    const n = Math.min(s.count, left);
    s.count -= n;
    left -= n;
    if (s.count === 0) store[i] = null;
  }
  return taken;
}

/** Total of each item in a store. */
export function storeTotals(store: readonly (Slot | null)[] | undefined): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  for (const s of store ?? []) if (s) out.set(s.item, (out.get(s.item) ?? 0) + s.count);
  return out;
}

export function sameStore(a: readonly (Slot | null)[] | undefined, b: readonly (Slot | null)[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (p === null || q === null ? p !== q : p.item !== q.item || p.count !== q.count) return false;
  }
  return true;
}

export function cloneStore(store: readonly (Slot | null)[] | undefined): (Slot | null)[] | undefined {
  return store ? store.map((s) => (s ? { item: s.item, count: s.count } : null)) : undefined;
}

/** A store read from a save or the network: known pack items only, padded or trimmed to the tier's size. */
export function parseStore(v: unknown, prefab: PrefabId): (Slot | null)[] {
  const n = storeSlots(prefab);
  const src = Array.isArray(v) ? v : [];
  const out: (Slot | null)[] = [];
  for (let i = 0; i < n; i++) {
    const s = src[i] as { item?: unknown; count?: unknown } | null | undefined;
    const item = s && typeof s.item === 'string' && s.item in ITEMS ? (s.item as ItemId) : null;
    const count = s && typeof s.count === 'number' && Number.isFinite(s.count) ? Math.floor(s.count) : 0;
    out.push(item && count > 0 && !ITEMS[item].canteen ? { item, count: Math.min(count, ITEMS[item].stack) } : null);
  }
  return out;
}
