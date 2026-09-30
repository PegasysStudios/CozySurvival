import type { ItemId, ToolId } from './items';
import type { PrefabId } from './prefabs';

export type Cost = { item: ItemId; count: number }[];

export interface ToolUpgrade {
  name: string;
  inputs: Cost;
}

export type UpgradableTool = Exclude<ToolId, 'hands'>;

export const UPGRADABLE_TOOLS: UpgradableTool[] = ['axe', 'spear', 'bow', 'torch', 'rod'];
export const MAX_TOOL_LEVEL = 3;
export const LEVEL_NUMERALS = ['', 'I', 'II', 'III'];

/**
 * Three upgrade levels per tool, each roughly twice the gathering effort of the one before (level III always needs
 * hides from hunting). Level I fits the base 6-slot pack; II and III need a Grass Basket (10 slots).
 */
export const TOOL_UPGRADES: Record<UpgradableTool, ToolUpgrade[]> = {
  axe: [
    { name: 'Honed Edge', inputs: [{ item: 'stone', count: 8 }, { item: 'stick', count: 8 }, { item: 'cordage', count: 2 }] },
    { name: 'Bound Haft', inputs: [{ item: 'stone', count: 20 }, { item: 'log', count: 8 }, { item: 'cordage', count: 6 }, { item: 'bark', count: 8 }] },
    { name: 'Heavy Bit', inputs: [{ item: 'stone', count: 30 }, { item: 'log', count: 8 }, { item: 'cordage', count: 12 }, { item: 'hide', count: 3 }] },
  ],
  spear: [
    { name: 'Fire-Hardened Shaft', inputs: [{ item: 'stick', count: 10 }, { item: 'stone', count: 6 }, { item: 'cordage', count: 2 }] },
    { name: 'Barbed Point', inputs: [{ item: 'stick', count: 16 }, { item: 'stone', count: 14 }, { item: 'cordage', count: 6 }, { item: 'bark', count: 4 }] },
    { name: 'Balanced Spear', inputs: [{ item: 'stick', count: 12 }, { item: 'stone', count: 24 }, { item: 'cordage', count: 12 }, { item: 'hide', count: 3 }] },
  ],
  bow: [
    { name: 'Waxed String', inputs: [{ item: 'stick', count: 12 }, { item: 'cordage', count: 3 }, { item: 'bark', count: 4 }] },
    { name: 'Recurved Limbs', inputs: [{ item: 'stick', count: 18 }, { item: 'cordage', count: 6 }, { item: 'bark', count: 8 }, { item: 'stone', count: 6 }] },
    { name: "Hunter's Bow", inputs: [{ item: 'stick', count: 12 }, { item: 'log', count: 6 }, { item: 'cordage', count: 16 }, { item: 'bark', count: 10 }, { item: 'hide', count: 3 }] },
  ],
  torch: [
    { name: 'Bark Wrap', inputs: [{ item: 'bark', count: 10 }, { item: 'fiber', count: 12 }, { item: 'stick', count: 4 }] },
    { name: 'Pitch Soak', inputs: [{ item: 'bark', count: 16 }, { item: 'cordage', count: 5 }, { item: 'stick', count: 8 }, { item: 'stone', count: 8 }, { item: 'log', count: 2 }] },
    { name: 'Everburning Torch', inputs: [{ item: 'bark', count: 24 }, { item: 'cordage', count: 10 }, { item: 'stone', count: 16 }, { item: 'log', count: 4 }, { item: 'hide', count: 2 }] },
  ],
  rod: [
    { name: 'Bark Float', inputs: [{ item: 'stick', count: 10 }, { item: 'stone', count: 4 }, { item: 'cordage', count: 3 }] },
    { name: 'Weighted Line', inputs: [{ item: 'stick', count: 14 }, { item: 'stone', count: 8 }, { item: 'cordage', count: 6 }, { item: 'bark', count: 8 }] },
    { name: "Angler's Pole", inputs: [{ item: 'stick', count: 12 }, { item: 'stone', count: 16 }, { item: 'cordage', count: 14 }, { item: 'bark', count: 8 }, { item: 'hide', count: 2 }] },
  ],
};

export function isUpgradable(tool: ToolId): tool is UpgradableTool {
  return tool !== 'hands';
}

// ------------------------------------------------------------------ shelters

/** The survival sequence: the lean-to is built from the crafting menu, every later tier only by upgrading in place. */
export const SHELTER_TIERS: PrefabId[] = ['leanTo', 'aFrame', 'barkHut', 'hideTent'];

/**
 * Materials to upgrade into each tier (keyed by the tier being built). Each tier takes roughly 1.5-1.75x the
 * gathering of the one before (the lean-to itself fills the 6-slot base pack): the A-frame needs a Grass Basket's
 * room (9 slots), the bark hut and hide tent a Hide Backpack's (14 slots), since everything is carried at once.
 */
export const SHELTER_UPGRADES: Partial<Record<PrefabId, Cost>> = {
  aFrame: [{ item: 'log', count: 16 }, { item: 'stick', count: 24 }, { item: 'cordage', count: 12 }, { item: 'bark', count: 10 }],
  barkHut: [{ item: 'log', count: 24 }, { item: 'bark', count: 40 }, { item: 'cordage', count: 20 }, { item: 'stone', count: 20 }],
  hideTent: [{ item: 'hide', count: 18 }, { item: 'log', count: 24 }, { item: 'cordage', count: 30 }, { item: 'bark', count: 20 }],
};

export const SHELTER_UPGRADE_TEXT: Partial<Record<PrefabId, string>> = {
  aFrame: 'Lash a ridge pole over the lean-to and thatch both sides with fir boughs.',
  barkHut: 'Raise low log walls and shingle the roof with sheets of birch bark.',
  hideTent: 'Stretch hides over a tall frame: the warmest, snuggest shelter in the woods.',
};

export function shelterTier(prefab: PrefabId): number {
  return SHELTER_TIERS.indexOf(prefab);
}

/** The tier a shelter upgrades into, or null at the top tier (or for non-shelters). */
export function nextShelter(prefab: PrefabId): PrefabId | null {
  const i = SHELTER_TIERS.indexOf(prefab);
  return i >= 0 && i < SHELTER_TIERS.length - 1 ? SHELTER_TIERS[i + 1] : null;
}

// ------------------------------------------------------------------ storage

/** Storage tiers: the woven bin is crafted, the crate and chest only come from upgrading it in place. */
export const BIN_TIERS: PrefabId[] = ['storageBin', 'storageCrate', 'storageChest'];

export const BIN_UPGRADES: Partial<Record<PrefabId, Cost>> = {
  storageCrate: [{ item: 'log', count: 8 }, { item: 'stick', count: 16 }, { item: 'cordage', count: 6 }],
  storageChest: [{ item: 'log', count: 12 }, { item: 'cordage', count: 8 }, { item: 'hide', count: 6 }, { item: 'bark', count: 10 }],
};

export const BIN_UPGRADE_TEXT: Partial<Record<PrefabId, string>> = {
  storageCrate: 'Box the bin in split logs: five more slots, and it keeps the rain off.',
  storageChest: 'Line it with hides and fit a bark lid: twenty slots, the roomiest store in camp.',
};

/** The upgrade ladder a structure belongs to (shelters or storage), or null if it has none. */
export function tierLine(prefab: PrefabId): PrefabId[] | null {
  if (SHELTER_TIERS.includes(prefab)) return SHELTER_TIERS;
  if (BIN_TIERS.includes(prefab)) return BIN_TIERS;
  return null;
}

/** The tier a structure upgrades into, or null at the top (or for structures without tiers). */
export function nextTier(prefab: PrefabId): PrefabId | null {
  const line = tierLine(prefab);
  const i = line ? line.indexOf(prefab) : -1;
  return line && i < line.length - 1 ? line[i + 1] : null;
}

/** Materials to upgrade into tier `prefab`. */
export function tierCost(prefab: PrefabId): Cost | undefined {
  return SHELTER_UPGRADES[prefab] ?? BIN_UPGRADES[prefab];
}

export function tierText(prefab: PrefabId): string {
  return SHELTER_UPGRADE_TEXT[prefab] ?? BIN_UPGRADE_TEXT[prefab] ?? '';
}
