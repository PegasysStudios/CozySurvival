import { BALANCE } from '../data/balance';
import { ITEMS, itemName, type ItemId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { nextShelter, SHELTER_TIERS, SHELTER_UPGRADE_TEXT, SHELTER_UPGRADES, shelterTier } from '../data/upgrades';
import { wearFraction } from '../sim/durability';
import { countItem } from '../sim/inventory';
import { PLACEMENT_REASON_TEXT } from '../sim/placement';
import type { Simulation } from '../sim/simulation';
import type { GameState } from '../sim/state';
import { canSleepAt } from '../sim/time';
import { UPGRADE_FAILURE_TEXT, type UpgradeCheck } from '../sim/upgrades';

export interface Ingredient {
  item: ItemId;
  name: string;
  need: number;
  have: number;
}

export interface ShelterMenu {
  id: number;
  prefab: PrefabId;
  name: string;
  /** 1-based tier in the survival sequence, and how many tiers there are. */
  tier: number;
  tiers: number;
  condition: number | null;
  canSleep: boolean;
  sleepLabel: string;
  rest: string;
  next: {
    prefab: PrefabId;
    name: string;
    text: string;
    rest: string;
    inputs: Ingredient[];
    check: UpgradeCheck;
    /** Why it can't be upgraded right now, or null. */
    reason: string | null;
    /** Set when the materials can't all fit in the pack as it is. */
    room: string | null;
  } | null;
}

export function ingredients(sim: Simulation, inputs: readonly { item: ItemId; count: number }[]): Ingredient[] {
  return inputs.map((i) => ({ item: i.item, name: itemName(i.item, i.count), need: i.count, have: countItem(sim.state.inventory, i.item) }));
}

/** Pack slots it takes to carry `inputs` all at once. */
export function slotsNeeded(inputs: readonly { item: ItemId; count: number }[]): number {
  return inputs.reduce((n, i) => n + Math.ceil(i.count / ITEMS[i.item].stack), 0);
}

/** When the pack is too small to ever hold `inputs` at once: how many slots it takes and which gear makes room. */
export function packRoomNote(s: GameState, inputs: readonly { item: ItemId; count: number }[]): string | null {
  const need = slotsNeeded(inputs);
  const have = s.inventory.slots.length;
  if (need <= have) return null;
  const c = BALANCE.carry;
  const needsBackpack = need > c.baseSlots + c.basketSlots;
  const gear = [
    !s.gear.includes('basket') ? 'a Grass Basket' : '',
    needsBackpack && !s.gear.includes('backpack') ? 'a Hide Backpack' : '',
  ].filter(Boolean);
  return `Needs ${need} pack slots at once and you have ${have}${gear.length ? `: make room with ${gear.join(' and ')}` : ''}.`;
}

function restText(prefab: PrefabId): string {
  const sh = PREFABS[prefab].shelter!;
  return `+${sh.warmthBonus} warmth nearby${sh.healthBonus ? ` · +${sh.healthBonus} health when you wake` : ''}`;
}

/** Everything a shelter's structure menu shows (sleep, then the next tier), kept free of DOM so it can be tested. */
export function shelterMenu(sim: Simulation, id: number): ShelterMenu | null {
  const st = sim.state.structures.find((x) => x.id === id);
  if (!st || !PREFABS[st.prefab].shelter) return null;
  const canSleep = canSleepAt(sim.hour);
  const nextId = nextShelter(st.prefab);
  let next: ShelterMenu['next'] = null;
  if (nextId) {
    const check = sim.canUpgradeShelter(id);
    const blocker = check.reason === 'blocked' ? sim.upgradeBlocker(id) : null;
    next = {
      prefab: nextId,
      name: PREFABS[nextId].name,
      text: SHELTER_UPGRADE_TEXT[nextId] ?? '',
      rest: restText(nextId),
      inputs: ingredients(sim, SHELTER_UPGRADES[nextId]!),
      check,
      reason: check.ok ? null : blocker ? `${PLACEMENT_REASON_TEXT[blocker]}. It needs a little more room to grow.` : UPGRADE_FAILURE_TEXT[check.reason!],
      room: packRoomNote(sim.state, SHELTER_UPGRADES[nextId]!),
    };
  }
  return {
    id,
    prefab: st.prefab,
    name: PREFABS[st.prefab].name,
    tier: shelterTier(st.prefab) + 1,
    tiers: SHELTER_TIERS.length,
    condition: st.wear ? Math.max(1, Math.round(wearFraction(st.wear) * 100)) : null,
    canSleep,
    sleepLabel: canSleep ? 'Sleep until dawn' : 'Sleep (after 7 PM)',
    rest: restText(st.prefab),
    next,
  };
}
