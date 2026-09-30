import { FORAGE_GUIDE, type ForageEntry } from '../data/forage';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { RESOURCES, TREES } from '../data/resources';
import { SHELTER_UPGRADES, TOOL_UPGRADES } from '../data/upgrades';
import type { GameState } from '../sim/state';

export interface ForagePage {
  entry: ForageEntry;
  unlocked: boolean;
  /** Food effects as short labels ("+5 hunger"), empty when it isn't food. */
  effects: string[];
  /** Known recipes that use it, and how many recipes using it are still undiscovered. */
  recipes: string[];
  undiscovered: number;
  /** How many tool and shelter upgrades use it. */
  upgrades: number;
  regrowHours: number;
}

const EFFECT_LABELS = { hunger: 'hunger', thirst: 'thirst', warmth: 'warmth', health: 'health', energy: 'energy' } as const;

export function foragePage(s: GameState, entry: ForageEntry): ForagePage {
  const item = entry.item;
  const food = ITEMS[item].food;
  const effects = food ? (Object.keys(EFFECT_LABELS) as (keyof typeof EFFECT_LABELS)[]).filter((k) => food[k]).map((k) => `${food[k]! > 0 ? '+' : ''}${food[k]} ${EFFECT_LABELS[k]}`) : [];
  const using = RECIPES.filter((r) => r.inputs.some((i) => i.item === item));
  const known = using.filter((r) => s.known.includes(r.id));
  const ups = [...Object.values(TOOL_UPGRADES).flat().map((u) => u.inputs), ...Object.values(SHELTER_UPGRADES)];
  return {
    entry,
    unlocked: s.forage.includes(entry.id),
    effects,
    recipes: known.map((r) => r.name),
    undiscovered: using.length - known.length,
    upgrades: ups.filter((inputs) => inputs!.some((i) => i.item === item)).length,
    regrowHours: entry.id === 'birch' ? TREES.birch.barkRespawnHours : RESOURCES[entry.id].respawnHours,
  };
}

/** The whole guide in display order, with how many entries are unlocked. */
export function forageGuide(s: GameState): { pages: ForagePage[]; unlocked: number; total: number } {
  const pages = FORAGE_GUIDE.map((e) => foragePage(s, e));
  return { pages, unlocked: pages.filter((p) => p.unlocked).length, total: pages.length };
}
