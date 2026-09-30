import { clamp } from '../core/math';
import { BALANCE } from '../data/balance';
import { TOOL_ORDER } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { Cost } from '../data/upgrades';
import { hasAll } from './inventory';
import { toolWears, type WearingTool } from './durability';
import type { GameState } from './state';
import { toolLevel } from './upgrades';

const R = BALANCE.repair;

export type RepairFailure = 'notOwned' | 'full' | 'missing' | 'busy' | 'gone';

export interface RepairCheck {
  ok: boolean;
  reason: RepairFailure | null;
}

export const REPAIR_FAILURE_TEXT: Record<RepairFailure, string> = {
  notOwned: "You don't have that tool.",
  full: 'Already in perfect condition.',
  missing: 'Missing materials.',
  busy: 'You are already repairing something.',
  gone: 'That workbench is gone.',
};

/** Everything the crafting recipe for `tool` takes. */
export function toolCraftCost(tool: WearingTool): Cost {
  const r = RECIPES.find((x) => x.output.kind === 'tool' && x.output.tool === tool);
  return r ? r.inputs : [];
}

const levelIndex = (level: number) => clamp(Math.floor(level), 0, R.costFraction.length - 1);

/**
 * Materials to repair `tool` at upgrade `level`: `costFraction[level]` of its crafting cost, rounded up to whole
 * items (and always at least one short of the full cost), shared across the ingredients by largest remainder.
 */
export function repairCost(tool: WearingTool, level: number): Cost {
  const craft = toolCraftCost(tool);
  const total = craft.reduce((n, i) => n + i.count, 0);
  if (total === 0) return [];
  const want = Math.min(total - 1, Math.max(1, Math.ceil(total * R.costFraction[levelIndex(level)] - 1e-9)));
  const raw = craft.map((i) => (i.count * want) / total);
  const counts = raw.map(Math.floor);
  let left = want - counts.reduce((a, b) => a + b, 0);
  const order = raw.map((v, k) => ({ k, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || a.k - b.k);
  for (const o of order) {
    if (left <= 0) break;
    counts[o.k]++;
    left--;
  }
  return craft.map((i, k) => ({ item: i.item, count: counts[k] })).filter((c) => c.count > 0);
}

export function repairSeconds(level: number): number {
  return R.seconds[levelIndex(level)];
}

/** Carried tools and weapons that have durability, in tool-belt order. */
export function repairableTools(s: GameState): WearingTool[] {
  return TOOL_ORDER.filter((t): t is WearingTool => toolWears(t) && s.tools.includes(t));
}

export function canRepair(s: GameState, tool: WearingTool): RepairCheck {
  const fail = (reason: RepairFailure): RepairCheck => ({ ok: false, reason });
  if (s.repair) return fail('busy');
  if (!s.tools.includes(tool)) return fail('notOwned');
  const w = s.toolWear[tool];
  if (!w || w.dur >= w.max) return fail('full');
  if (!hasAll(s.inventory, repairCost(tool, toolLevel(s, tool)))) return fail('missing');
  return { ok: true, reason: null };
}
