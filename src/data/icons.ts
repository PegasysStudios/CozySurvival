import type { GearId, ItemId, ToolId } from './items';
import type { PrefabId } from './prefabs';

/** Anything with a menu icon. Item, tool, gear and prefab ids don't overlap, so one flat key works. */
export type IconId = ItemId | ToolId | GearId | PrefabId;

/** Where Jon's hand-made 64×64 icons are served from (files in public/icons/jon). */
export const ICON_DIR = 'icons/jon/';

/**
 * Jon's icons by id, then tier. A trailing number in a filename is the tier, and a tool's icon without one is tier 1,
 * the freshly crafted tool (upgrade level 0), so tool tier = upgrade level + 1. The first upload lost its filenames,
 * so the 01–20.png entries are a best visual guess; when named files arrive, their names replace these.
 * knife.png was painted to match them (knapped stone, leather wrap, pale rim) until Jon draws his own.
 */
export const ICON_FILES: Partial<Record<IconId, Partial<Record<number, string>>>> = {
  arrow: { 1: '03.png' },
  knife: { 1: 'knife.png' },
  axe: { 1: '04.png', 2: '05.png', 3: '06.png' },
  backpack: { 1: '07.png' },
  bow: { 1: '08.png' },
  canteen: { 1: '09.png' },
  charredMeal: { 1: '11.png' },
  rod: { 1: '13.png' },
  hide: { 1: '15.png' },
  spear: { 1: '18.png' },
  log: { 1: '19.png' },
  onion: { 1: '20.png' },
};

export const toolTier = (level: number): number => level + 1;

/**
 * The icon file for `id` at `tier`: that tier's own icon, else the nearest lower tier's (a level III axe with only
 * three axe icons keeps the tier 3 one), else null, meaning keep the built-in icon.
 */
export function iconFile(id: IconId, tier = 1): string | null {
  const tiers = ICON_FILES[id];
  if (!tiers) return null;
  for (let t = Math.floor(tier); t >= 1; t--) {
    const f = tiers[t];
    if (f) return f;
  }
  return null;
}
