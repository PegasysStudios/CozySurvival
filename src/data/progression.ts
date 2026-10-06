import type { FishingCatch } from './fishing';
import type { PrefabId } from './prefabs';
import type { ResourceKind, TreeSpecies } from './resources';
import type { SpeciesId } from './species';

/** Basics and the ingredients for each map's first meal remain accessible without training. */
export const RESOURCE_LEVELS: Record<ResourceKind, number> = {
  stickPile: 1, stonePile: 1, berryBush: 1, fern: 1, onion: 1, mushroom: 3, snowClump: 1,
  yucca: 1, pricklyPear: 1, cholla: 1, wolfberry: 2, chia: 3, agave: 8,
  seaGrape: 1, pandanus: 1, purslane: 1, coconut: 1, taro: 3, banana: 3,
};

/** Peeling/fruit picking and felling are separate Gathering milestones. */
export const TREE_LEVELS: Record<TreeSpecies, { harvest: number; fell: number }> = {
  birch: { harvest: 1, fell: 1 }, maple: { harvest: 1, fell: 3 },
  fir: { harvest: 1, fell: 5 }, cedar: { harvest: 1, fell: 8 },
  joshua: { harvest: 1, fell: 1 }, mesquite: { harvest: 2, fell: 1 },
  cottonwood: { harvest: 1, fell: 5 }, juniper: { harvest: 1, fell: 3 },
  pinyon: { harvest: 8, fell: 3 }, ponderosa: { harvest: 1, fell: 8 },
  palm: { harvest: 1, fell: 1 }, hau: { harvest: 1, fell: 1 }, treeFern: { harvest: 1, fell: 1 },
  breadfruit: { harvest: 6, fell: 5 }, kukui: { harvest: 1, fell: 8 },
};

/** Goats are the island's introductory hide source; its larger boars come later. */
export const ANIMAL_LEVELS: Record<SpeciesId, { hunt: number; skin: number }> = {
  squirrel: { hunt: 1, skin: 1 }, rabbit: { hunt: 1, skin: 1 }, jackrabbit: { hunt: 1, skin: 1 },
  quail: { hunt: 1, skin: 1 }, junglefowl: { hunt: 1, skin: 1 }, crab: { hunt: 1, skin: 1 },
  lizard: { hunt: 1, skin: 1 }, roadrunner: { hunt: 3, skin: 1 }, goat: { hunt: 1, skin: 1 },
  deer: { hunt: 5, skin: 5 }, javelina: { hunt: 5, skin: 5 }, boar: { hunt: 8, skin: 8 },
  snake: { hunt: 4, skin: 1 }, viper: { hunt: 8, skin: 1 }, scorpion: { hunt: 1, skin: 1 },
  wolf: { hunt: 12, skin: 12 }, cougar: { hunt: 18, skin: 18 }, bear: { hunt: 25, skin: 25 },
  fish: { hunt: 1, skin: 1 }, reefFish: { hunt: 1, skin: 1 },
  jellyfish: { hunt: 1, skin: 1 }, shark: { hunt: 30, skin: 1 },
};

export const FISH_LEVELS: Record<FishingCatch, number> = { trout: 1, goby: 1, parrotfish: 1, bass: 5, salmon: 10 };

export const STRUCTURE_LEVELS: Record<PrefabId, number> = {
  campfire: 1, leanTo: 1, bench: 2, storageBin: 4, workbench: 6,
  aFrame: 8, barkHut: 16, hideTent: 28, storageCrate: 10, storageChest: 20,
};
