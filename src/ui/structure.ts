import { BALANCE } from '../data/balance';
import { STRUCTURE_LEVELS } from '../data/progression';
import { skillRequirementText } from '../sim/skills';
import { ITEMS, itemName, type ItemId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { TOOLS } from '../data/items';
import { LEVEL_NUMERALS, nextTier, SHELTER_TIERS, shelterTier, tierCost, tierLine, tierText } from '../data/upgrades';
import { wearFraction, type WearingTool } from '../sim/durability';
import { usedSlots } from '../sim/inventory';
import { REPAIR_FAILURE_TEXT, repairableTools, repairCost, repairSeconds, type RepairCheck } from '../sim/repair';
import { toolLevel } from '../sim/upgrades';
import { haveItem, inCanteen } from '../sim/canteen';
import { PLACEMENT_REASON_TEXT } from '../sim/placement';
import type { Simulation } from '../sim/simulation';
import type { GameState } from '../sim/state';
import { canSleepAt } from '../sim/time';
import { canUseTribeStructure } from '../sim/quests';
import { UPGRADE_FAILURE_TEXT, type UpgradeCheck } from '../sim/upgrades';
import type { Tile } from './catalog';
import { toolIcon } from './icons';

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
    requirement: string;
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
  return inputs.map((i) => ({ item: i.item, name: itemName(i.item, i.count), need: i.count, have: haveItem(sim.state, i.item) }));
}

/** Pack slots it takes to carry `inputs` all at once. */
export function slotsNeeded(inputs: readonly { item: ItemId; count: number }[]): number {
  return inputs.reduce((n, i) => n + (inCanteen(i.item) ? 0 : Math.ceil(i.count / ITEMS[i.item].stack)), 0);
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

export function restText(prefab: PrefabId): string {
  const sh = PREFABS[prefab].shelter!;
  return `+${sh.warmthBonus} warmth nearby${sh.healthBonus ? ` · +${sh.healthBonus} health when you wake` : ''}`;
}

/** Everything a shelter's structure menu shows (sleep, then the next tier), kept free of DOM so it can be tested. */
export function shelterMenu(sim: Simulation, id: number): ShelterMenu | null {
  const st = sim.structures.find((x) => x.id === id);
  if (!st || !PREFABS[st.prefab].shelter) return null;
  const canSleep = canSleepAt(sim.hour);
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
    next: nextTierInfo(sim, id, st.prefab),
  };
}

/** The next tier of an upgradable structure, as its menu (and the Upgrades tab) shows it. */
export function nextTierInfo(sim: Simulation, id: number, prefab: PrefabId): ShelterMenu['next'] {
  const nextId = nextTier(prefab);
  if (!nextId) return null;
  const cost = tierCost(nextId)!;
  const check = sim.canUpgradeStructure(id);
  const blocker = check.reason === 'blocked' ? sim.upgradeBlocker(id) : null;
  const def = PREFABS[nextId];
  return {
    prefab: nextId,
    name: def.name,
    text: tierText(nextId),
    requirement: skillRequirementText('crafting', STRUCTURE_LEVELS[nextId]),
    rest: def.shelter ? restText(nextId) : def.storage ? `${def.storage.slots} slots` : '',
    inputs: ingredients(sim, cost),
    check,
    reason: check.ok ? null : check.reason === 'skill' ? `Requires ${skillRequirementText('crafting', STRUCTURE_LEVELS[nextId])}.` : blocker ? `${PLACEMENT_REASON_TEXT[blocker]}. It needs a little more room to grow.` : UPGRADE_FAILURE_TEXT[check.reason!],
    room: packRoomNote(sim.state, cost),
  };
}

export interface StorageMenu {
  id: number;
  prefab: PrefabId;
  name: string;
  tier: number;
  tiers: number;
  line: PrefabId[];
  slots: number;
  used: number;
  next: ShelterMenu['next'];
}

/** A storage bin's menu: its shared slots and the next, roomier tier. */
export function storageMenu(sim: Simulation, id: number): StorageMenu | null {
  const st = sim.structures.find((x) => x.id === id);
  const def = st ? PREFABS[st.prefab] : null;
  if (!st || !def?.storage) return null;
  const line = tierLine(st.prefab) ?? [st.prefab];
  return {
    id,
    prefab: st.prefab,
    name: def.name,
    tier: line.indexOf(st.prefab) + 1,
    tiers: line.length,
    line,
    slots: def.storage.slots,
    used: usedSlots({ slots: st.store ?? [] }),
    next: nextTierInfo(sim, id, st.prefab),
  };
}

export interface RepairRow {
  tool: WearingTool;
  name: string;
  level: number;
  /** Condition in percent. */
  condition: number;
  /** Uses left out of the most it holds; null for a tool not used yet (it gets its durability on first use). */
  uses: { left: number; max: number } | null;
  cost: Ingredient[];
  /** The pack lacks some of the repair materials. */
  missing: boolean;
  seconds: number;
  check: RepairCheck;
  reason: string | null;
}

export interface WorkbenchMenu {
  id: number;
  rows: RepairRow[];
  /** The tool being repaired right now, with progress 0..1. */
  busy: { tool: WearingTool; progress: number } | null;
}

/** Every carried tool or weapon that wears, with what mending it costs and how long it takes. */
export function workbenchMenu(sim: Simulation, id: number): WorkbenchMenu | null {
  const s = sim.state;
  const st = sim.structures.find((x) => x.id === id);
  if (!st || !PREFABS[st.prefab].workbench || !canUseTribeStructure(s, st)) return null;
  const rows = repairableTools(s).map((tool): RepairRow => {
    const level = toolLevel(s, tool);
    const w = s.toolWear[tool];
    const check = sim.canRepair(tool, id);
    const cost = ingredients(sim, repairCost(tool, level));
    return {
      tool,
      name: `${TOOLS[tool].name}${level ? ' ' + LEVEL_NUMERALS[level] : ''}`,
      level,
      condition: w ? Math.max(1, Math.round(wearFraction(w) * 100)) : 100,
      uses: w ? { left: Math.ceil(w.dur - 1e-9), max: w.max } : null,
      cost,
      missing: cost.some((c) => c.have < c.need),
      seconds: repairSeconds(level),
      check,
      reason: check.ok ? null : REPAIR_FAILURE_TEXT[check.reason!],
    };
  });
  const r = s.repair;
  return { id, rows, busy: r ? { tool: r.tool, progress: Math.min(1, r.elapsed / r.duration) } : null };
}

/** A workbench grid tile: greyed without the repair materials, ready when it can be mended now, ticked at full condition. */
export function repairTile(r: RepairRow): Tile {
  return {
    key: `w:${r.tool}`,
    kind: 'repair',
    id: r.tool,
    name: `${r.name} · ${r.condition}%`,
    icon: toolIcon(r.tool, r.level),
    greyed: r.missing,
    ready: r.check.ok,
    badge: r.condition >= 100 ? 'full' : null,
    level: null,
    condition: r.condition,
  };
}
