import type { BiomeId } from '../data/biomes';
import { recipeNeeds, type ObjectiveNeed } from '../data/objectives';
import { RECIPE_BY_ID, recipeOnMap, type Recipe } from '../data/recipes';
import type { GameState } from './state';

/** How many recipes the checklist holds at once; pinning another drops the oldest. */
export const MAX_PINS = 3;

export const pinnedRecipes = (s: GameState): readonly string[] => s.pinned ?? [];

export const isPinned = (s: GameState, id: string) => pinnedRecipes(s).includes(id);

/** Tools, gear and buildings are made once, so they come off the checklist when made; items stay pinned for another batch. */
export const unpinsWhenMade = (r: Recipe) => r.output.kind !== 'item';

function setPins(s: GameState, pins: string[]): void {
  if (pins.length) s.pinned = pins;
  else delete s.pinned;
}

/** Pins a recipe, or unpins it if it is already pinned. `dropped` is the oldest pin that made room. */
export function togglePin(s: GameState, id: string): { pinned: boolean; dropped: string | null } {
  const pins = [...pinnedRecipes(s)];
  const at = pins.indexOf(id);
  if (at >= 0) {
    pins.splice(at, 1);
    setPins(s, pins);
    return { pinned: false, dropped: null };
  }
  pins.push(id);
  const dropped = pins.length > MAX_PINS ? pins.shift()! : null;
  setPins(s, pins);
  return { pinned: true, dropped };
}

export function unpin(s: GameState, id: string): boolean {
  if (!isPinned(s, id)) return false;
  setPins(s, pinnedRecipes(s).filter((p) => p !== id));
  return true;
}

/** Saved pins, keeping only known recipes offered on the map, without repeats, newest `MAX_PINS`. */
export function parsePins(v: unknown, biome: BiomeId): string[] {
  if (!Array.isArray(v)) return [];
  const ok = v.filter((id): id is string => typeof id === 'string' && id in RECIPE_BY_ID && recipeOnMap(RECIPE_BY_ID[id], biome));
  return [...new Set(ok)].slice(-MAX_PINS);
}

/**
 * The checklist rows: every pinned recipe's ingredients summed into one have/need row per item (the goals panel's
 * rule for a step with several recipes), plus a lit campfire nearby when a pinned recipe is cooked.
 */
export function checklistNeeds(s: GameState, nearFire: boolean): ObjectiveNeed[] {
  const pins = pinnedRecipes(s);
  const rows = recipeNeeds(s, pins);
  if (pins.some((id) => RECIPE_BY_ID[id].station === 'fire')) rows.push({ label: 'Lit campfire nearby', icon: 'campfire', have: nearFire ? 1 : 0, need: 1 });
  return rows;
}

export const checklistReady = (rows: readonly ObjectiveNeed[]) => rows.length > 0 && rows.every((n) => n.have >= n.need);
