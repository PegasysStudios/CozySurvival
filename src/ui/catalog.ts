import { GEAR, TOOLS, type GearId, type ToolId } from '../data/items';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { RECIPES, recipesFor, type Recipe, type RecipeCategory } from '../data/recipes';
import { LEVEL_NUMERALS, SHELTER_TIERS, SHELTER_UPGRADES, UPGRADABLE_TOOLS } from '../data/upgrades';
import { hasItems } from '../sim/canteen';
import type { Simulation } from '../sim/simulation';
import { nextToolUpgrade, toolLevel } from '../sim/upgrades';
import { gearIcon, itemIcon, prefabIcon, toolIcon } from './icons';

export type TileKind = 'recipe' | 'tool' | 'shelter' | 'repair';

/** One square tile in a grid menu, kept free of DOM so what each menu shows can be tested. */
export interface Tile {
  /** Unique within a menu: `r:<recipe>`, `t:<tool>`, `s:<prefab>` or `w:<tool>` (at the workbench). */
  key: string;
  kind: TileKind;
  id: string;
  /** The hover tooltip, e.g. "Stone Axe" or "Stone Axe II". */
  name: string;
  icon: string;
  /** Greyed out: the pack lacks the materials (or, for an upgrade, the tool isn't made yet). */
  greyed: boolean;
  /** It can be crafted, cooked or upgraded right now. */
  ready: boolean;
  badge: 'owned' | 'fire' | 'upgrade' | 'max' | 'full' | null;
  /** Upgrade level, for tools that have one. */
  level: number | null;
  /** Condition in percent, drawn as a durability bar (workbench tiles). */
  condition?: number;
}

/** Shelter tiers above the lean-to: never crafted, only reached by upgrading the tier below in place. */
export const UPGRADE_ONLY_SHELTERS = SHELTER_TIERS.slice(1);

export const recipeFor = {
  tool: (t: ToolId): Recipe | undefined => RECIPES.find((r) => r.output.kind === 'tool' && r.output.tool === t),
  gear: (g: GearId): Recipe | undefined => RECIPES.find((r) => r.output.kind === 'gear' && r.output.gear === g),
};

export function toolLabel(s: Simulation['state'], t: ToolId): string {
  const lv = s.tools.includes(t) ? toolLevel(s, t) : 0;
  return `${TOOLS[t].name}${lv ? ' ' + LEVEL_NUMERALS[lv] : ''}`;
}

export function recipeIcon(r: Recipe, s?: Simulation['state']): string {
  const o = r.output;
  if (o.kind === 'item') return itemIcon(o.item);
  if (o.kind === 'tool') return toolIcon(o.tool, s ? toolLevel(s, o.tool) : 0);
  if (o.kind === 'gear') return gearIcon(o.gear);
  return prefabIcon(o.prefab);
}

export function recipeTile(sim: Simulation, r: Recipe): Tile {
  const s = sim.state;
  const check = sim.canCraft(r.id);
  const o = r.output;
  const owned = (o.kind === 'tool' && s.tools.includes(o.tool)) || (o.kind === 'gear' && s.gear.includes(o.gear));
  const missing = !hasItems(s, r.inputs);
  return {
    key: `r:${r.id}`,
    kind: 'recipe',
    id: r.id,
    name: o.kind === 'gear' ? GEAR[o.gear].name : r.name,
    icon: recipeIcon(r, s),
    greyed: missing,
    ready: check.ok,
    badge: owned ? 'owned' : !missing && check.reason === 'station' ? 'fire' : null,
    level: null,
  };
}

export function toolTile(sim: Simulation, t: ToolId): Tile {
  const s = sim.state;
  const owned = s.tools.includes(t);
  const lv = owned ? toolLevel(s, t) : 0;
  const next = nextToolUpgrade(s, t);
  const upgradable = t !== 'hands';
  return {
    key: `t:${t}`,
    kind: 'tool',
    id: t,
    name: toolLabel(s, t),
    icon: toolIcon(t, lv),
    greyed: !owned || (upgradable && !!next && !hasItems(s, next.inputs)),
    ready: owned && upgradable && sim.canUpgradeTool(t).ok,
    badge: owned && upgradable && !next ? 'max' : null,
    level: upgradable ? lv : null,
  };
}

export function shelterTile(sim: Simulation, p: PrefabId): Tile {
  return {
    key: `s:${p}`,
    kind: 'shelter',
    id: p,
    name: PREFABS[p].name,
    icon: prefabIcon(p),
    greyed: !hasItems(sim.state, SHELTER_UPGRADES[p] ?? []),
    ready: false,
    badge: 'upgrade',
    level: null,
  };
}

/** A crafting tab's tiles: every recipe in it, with the upgrade-only shelter tiers right after the lean-to. */
export function craftTiles(sim: Simulation, tab: 'all' | RecipeCategory): Tile[] {
  const tiles: Tile[] = [];
  for (const r of recipesFor(sim.biome)) {
    if (tab !== 'all' && r.category !== tab) continue;
    tiles.push(recipeTile(sim, r));
    if (r.id === 'leanTo') tiles.push(...UPGRADE_ONLY_SHELTERS.map((p) => shelterTile(sim, p)));
  }
  return tiles;
}

/** The Upgrades tab: every tool and weapon (made or not), then every shelter tier reached by upgrading. */
export function upgradeTiles(sim: Simulation): Tile[] {
  return [...UPGRADABLE_TOOLS.map((t) => toolTile(sim, t)), ...UPGRADE_ONLY_SHELTERS.map((p) => shelterTile(sim, p))];
}

export function campfireTiles(sim: Simulation, recipes: Recipe[]): Tile[] {
  return recipes.map((r) => recipeTile(sim, r));
}
