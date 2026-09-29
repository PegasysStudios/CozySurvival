import { BALANCE } from '../data/balance';
import type { ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import { durabilityMultiplier } from './skills';
import type { GameState, Wear } from './state';

const D = BALANCE.durability;

export type WearingTool = keyof typeof D.tools;
export type WearingPrefab = keyof typeof D.structures;

export function toolWears(tool: ToolId): tool is WearingTool {
  return tool in D.tools;
}

export function prefabWears(prefab: PrefabId): prefab is WearingPrefab {
  return prefab in D.structures;
}

/** Fresh durability for a tool crafted with the given crafting XP. */
export function newToolWear(tool: WearingTool, craftingXp: number): Wear {
  const max = Math.round(D.tools[tool].uses * durabilityMultiplier(craftingXp));
  return { dur: max, max };
}

export function newStructureWear(prefab: WearingPrefab, craftingXp: number): Wear {
  const max = Math.round(D.structures[prefab].max * durabilityMultiplier(craftingXp));
  return { dur: max, max };
}

/** The tool's durability record, creating a fresh level-1 one if it is missing (e.g. a tool granted by the dev panel). */
export function toolWear(state: GameState, tool: ToolId): Wear | null {
  if (!toolWears(tool) || !state.tools.includes(tool)) return null;
  let w = state.toolWear[tool];
  if (!w) state.toolWear[tool] = w = newToolWear(tool, 0);
  return w;
}

export type WearResult = 'ok' | 'low' | 'broken';

/** Subtracts wear. Reports 'low' once when the item first drops below the warning fraction, 'broken' at zero. */
export function applyWear(w: Wear, amount: number): WearResult {
  if (amount <= 0) return 'ok';
  const wasLow = w.dur <= w.max * D.lowFraction;
  w.dur = Math.max(0, w.dur - amount);
  if (w.dur <= 0) return 'broken';
  if (!wasLow && w.dur <= w.max * D.lowFraction) return 'low';
  return 'ok';
}

export function wearFraction(w: Wear | null | undefined): number {
  return w && w.max > 0 ? w.dur / w.max : 1;
}
