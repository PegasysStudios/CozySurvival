import { DEFAULT_BIOME } from '../data/biomes';
import { forageGuideFor, type ForageEntry } from '../data/forage';
import { ITEMS } from '../data/items';
import { recipesFor } from '../data/recipes';
import { RESOURCES, TREES, type ResourceKind, type TreeSpecies } from '../data/resources';
import { SHELTER_UPGRADES, TOOL_UPGRADES } from '../data/upgrades';
import type { GameState } from '../sim/state';

export interface ForagePage {
  entry: ForageEntry;
  unlocked: boolean;
  /** Food effects as short labels ("+5 hunger"), empty when it isn't food. */
  effects: string[];
  /** Every recipe that uses it. */
  recipes: string[];
  /** How many tool and shelter upgrades use it. */
  upgrades: number;
  regrowHours: number;
}

const EFFECT_LABELS = { hunger: 'hunger', thirst: 'thirst', warmth: 'warmth', health: 'health', energy: 'energy' } as const;

function regrowHours(entry: ForageEntry): number {
  if (entry.id in TREES) return TREES[entry.id as TreeSpecies].barkRespawnHours;
  return RESOURCES[entry.id as ResourceKind]?.respawnHours ?? 0;
}

export function foragePage(s: GameState, entry: ForageEntry): ForagePage {
  const item = entry.item;
  const food = ITEMS[item].food;
  const effects = food ? (Object.keys(EFFECT_LABELS) as (keyof typeof EFFECT_LABELS)[]).filter((k) => food[k]).map((k) => `${food[k]! > 0 ? '+' : ''}${food[k]} ${EFFECT_LABELS[k]}`) : [];
  const using = recipesFor(s.biome ?? DEFAULT_BIOME).filter((r) => r.inputs.some((i) => i.item === item));
  const ups = [...Object.values(TOOL_UPGRADES).flat().map((u) => u.inputs), ...Object.values(SHELTER_UPGRADES)];
  return {
    entry,
    unlocked: s.forage.includes(entry.id),
    effects,
    recipes: using.map((r) => r.name),
    upgrades: ups.filter((inputs) => inputs!.some((i) => i.item === item)).length,
    regrowHours: regrowHours(entry),
  };
}

/** The current map's guide in display order, with how many entries are unlocked. */
export function forageGuide(s: GameState): { pages: ForagePage[]; unlocked: number; total: number } {
  const pages = forageGuideFor(s.biome ?? DEFAULT_BIOME).map((e) => foragePage(s, e));
  return { pages, unlocked: pages.filter((p) => p.unlocked).length, total: pages.length };
}
