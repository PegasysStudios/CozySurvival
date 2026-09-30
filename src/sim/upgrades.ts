import { clamp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { ToolId } from '../data/items';
import { isUpgradable, MAX_TOOL_LEVEL, TOOL_UPGRADES, type ToolUpgrade } from '../data/upgrades';
import { hasAll, removeAll } from './inventory';
import { catchBonus, chopPowerBonus, huntDamageBonus } from './skills';
import type { GameState } from './state';

const U = BALANCE.upgrades;

export type UpgradeFailure = 'notOwned' | 'fixed' | 'maxed' | 'missing' | 'gone' | 'blocked';

export interface UpgradeCheck {
  ok: boolean;
  reason: UpgradeFailure | null;
}

export const UPGRADE_FAILURE_TEXT: Record<UpgradeFailure, string> = {
  notOwned: "You don't have that tool.",
  fixed: "That can't be upgraded.",
  maxed: 'Already fully upgraded.',
  missing: 'Missing materials.',
  gone: 'That shelter is gone.',
  blocked: 'Not enough room around it to build bigger.',
};

export function toolLevel(s: GameState, tool: ToolId): number {
  return clamp(Math.floor(s.toolLevels?.[tool] ?? 0), 0, MAX_TOOL_LEVEL);
}

/** The bonus at `level` from a per-level table (level 0 gives nothing). */
export function levelBonus(table: readonly number[], level: number): number {
  return level > 0 ? table[Math.min(level, table.length) - 1] : 0;
}

/** The next upgrade for a tool, or null when it's maxed (or can't be upgraded). */
export function nextToolUpgrade(s: GameState, tool: ToolId): ToolUpgrade | null {
  if (!isUpgradable(tool)) return null;
  const lv = toolLevel(s, tool);
  return lv < MAX_TOOL_LEVEL ? TOOL_UPGRADES[tool][lv] : null;
}

export function canUpgradeTool(s: GameState, tool: ToolId): UpgradeCheck {
  const fail = (reason: UpgradeFailure): UpgradeCheck => ({ ok: false, reason });
  if (!isUpgradable(tool)) return fail('fixed');
  if (!s.tools.includes(tool)) return fail('notOwned');
  const up = nextToolUpgrade(s, tool);
  if (!up) return fail('maxed');
  if (!hasAll(s.inventory, up.inputs)) return fail('missing');
  return { ok: true, reason: null };
}

/** Consumes the next level's materials and raises the tool's level. */
export function upgradeTool(s: GameState, tool: ToolId): UpgradeCheck {
  const check = canUpgradeTool(s, tool);
  if (!check.ok) return check;
  removeAll(s.inventory, nextToolUpgrade(s, tool)!.inputs);
  s.toolLevels[tool] = toolLevel(s, tool) + 1;
  return check;
}

// ------------------------------------------------------------------ effective tool stats (skill + upgrade, additive)

/** Tree hits (and trunk cuts) per axe swing. */
export function chopPower(s: GameState, level = toolLevel(s, 'axe')): number {
  return round2(1 + chopPowerBonus(s.skills.gathering) + levelBonus(U.axe.chopPower, level));
}

/** Damage multiplier for a hit on an animal: the Hunting bonus, plus the spear's or bow's upgrade bonus. */
export function weaponDamageMultiplier(s: GameState, tool: ToolId, level = toolLevel(s, tool)): number {
  const up = tool === 'spear' ? levelBonus(U.spear.damage, level) : tool === 'bow' ? levelBonus(U.bow.damage, level) : 0;
  return round2(1 + huntDamageBonus(s.skills.hunting) + up);
}

/** Chance that a hooked fish is landed. */
export function landChance(s: GameState, level = toolLevel(s, 'rod')): number {
  const K = BALANCE.skills;
  return Math.min(K.maxCatchChance, round2(K.baseCatchChance + catchBonus(s.skills.fishing) + levelBonus(U.rod.catch, level)));
}

/** Arrow launch speed multiplier: faster, flatter arrows land closer to where you aim. */
export function arrowSpeedMultiplier(s: GameState, level = toolLevel(s, 'bow')): number {
  return 1 + levelBonus(U.bow.arrowSpeed, level);
}

export function torchBurnMultiplier(s: GameState, level = toolLevel(s, 'torch')): number {
  return 1 - levelBonus(U.torch.burnCut, level);
}

export function torchWarmth(s: GameState, level = toolLevel(s, 'torch')): number {
  return BALANCE.needs.warmth.torchBonus + levelBonus(U.torch.warmth, level);
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** What a tool does at `level` with the player's current skills, as UI lines. */
export function toolEffectLines(s: GameState, tool: ToolId, level = toolLevel(s, tool)): string[] {
  const b = BALANCE.combat;
  switch (tool) {
    case 'axe':
      return [`Chop power ${chopPower(s, level).toFixed(2)} per swing`];
    case 'spear':
      return [`Damage ${(b.spear.damage * weaponDamageMultiplier(s, 'spear', level)).toFixed(2)} per thrust`];
    case 'bow':
      return [
        `Damage ${(b.bow.minDamage * weaponDamageMultiplier(s, 'bow', level)).toFixed(2)}–${(b.bow.maxDamage * weaponDamageMultiplier(s, 'bow', level)).toFixed(2)} per arrow`,
        `Arrow speed ${pct(arrowSpeedMultiplier(s, level))} (flatter, more accurate shots)`,
      ];
    case 'rod':
      return [`${pct(landChance(s, level))} chance to land a hooked fish`];
    case 'torch':
      return [`Burns ${pct(torchBurnMultiplier(s, level))} as fast`, `+${torchWarmth(s, level)} warmth while held`];
    default:
      return [];
  }
}

/** How skill and upgrade add up for a tool's main stat, e.g. "1 base + 0.22 Gathering + 0.40 upgrade". */
export function toolBreakdown(s: GameState, tool: ToolId): string {
  const lv = toolLevel(s, tool);
  const n = (v: number) => v.toFixed(2);
  switch (tool) {
    case 'axe':
      return `1 base + ${n(chopPowerBonus(s.skills.gathering))} Gathering + ${n(levelBonus(U.axe.chopPower, lv))} upgrade`;
    case 'spear':
    case 'bow':
      return `×(1 base + ${n(huntDamageBonus(s.skills.hunting))} Hunting + ${n(levelBonus(U[tool].damage, lv))} upgrade)`;
    case 'rod':
      return `${pct(BALANCE.skills.baseCatchChance)} base + ${pct(catchBonus(s.skills.fishing))} Fishing + ${pct(levelBonus(U.rod.catch, lv))} upgrade`;
    case 'torch':
      return 'No skill: torch upgrades alone make it last longer and burn warmer.';
    default:
      return '';
  }
}
