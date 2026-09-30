import type { ItemId } from './items';

export type ResourceKind =
  | 'stickPile' | 'stonePile' | 'berryBush' | 'fern' | 'mushroom' | 'onion'
  | 'yucca' | 'pricklyPear' | 'cholla' | 'agave' | 'chia' | 'wolfberry';

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  verb: string;
  item: ItemId;
  yield: number;
  charges: number;
  respawnHours: number;
  /** Interaction sphere radius and center height. */
  hitRadius: number;
  hitHeight: number;
  /** Footprint that blocks placement. */
  blockRadius: number;
  /** Stays in the world (and keeps blocking placement) while depleted; others vanish until they regrow. */
  persistent?: boolean;
  /**
   * Spiny plants prick you for `damage` if you push into their core (`radius` metres at full size), which sits well
   * inside the reach you pick them from.
   */
  spines?: { radius: number; damage: number };
  /** How many grow in the starter patch around the spawn (out of the patch's candidate spots). */
  starter: number;
  /** Share of this kind's map-wide scatter spots that actually grow. */
  scatter: number;
}

/**
 * Forage is deliberately sparse so the goal track spans several days: the starter patch covers the first steps
 * (gathering, fiber, stone axe and most of a campfire), and the rest needs roaming further out and waiting on regrowth.
 * Ferns grow on 48% of their scatter spots (1.2x the earlier 40%), since fiber feeds cordage and most recipes.
 * Desert plants mirror the PNW roles: yucca is the fiber plant, prickly pear the berry bush, cholla buds the
 * cook-me-first mushroom; agave hearts are big meals that take days to regrow.
 */
export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  stickPile: { kind: 'stickPile', name: 'Fallen Branches', verb: 'Gather sticks', item: 'stick', yield: 1, charges: 3, respawnHours: 12, hitRadius: 0.6, hitHeight: 0.15, blockRadius: 0.5, starter: 2, scatter: 0.4 },
  stonePile: { kind: 'stonePile', name: 'Loose Stones', verb: 'Pick up stones', item: 'stone', yield: 1, charges: 3, respawnHours: 30, hitRadius: 0.55, hitHeight: 0.15, blockRadius: 0.5, starter: 2, scatter: 0.4 },
  berryBush: { kind: 'berryBush', name: 'Salmonberry Bush', verb: 'Pick berries', item: 'berries', yield: 2, charges: 3, respawnHours: 20, hitRadius: 0.8, hitHeight: 0.6, blockRadius: 0.7, persistent: true, starter: 2, scatter: 0.5 },
  fern: { kind: 'fern', name: 'Sword Fern', verb: 'Strip fiber', item: 'fiber', yield: 2, charges: 2, respawnHours: 16, hitRadius: 0.7, hitHeight: 0.35, blockRadius: 0.55, persistent: true, starter: 2, scatter: 0.48 },
  mushroom: { kind: 'mushroom', name: 'Chanterelles', verb: 'Pick mushrooms', item: 'mushroom', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.45, hitHeight: 0.1, blockRadius: 0.35, starter: 1, scatter: 0.5 },
  onion: { kind: 'onion', name: 'Nodding Onion', verb: 'Pull onions', item: 'onion', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.45, hitHeight: 0.15, blockRadius: 0.35, starter: 1, scatter: 0.5 },
  yucca: { kind: 'yucca', name: 'Banana Yucca', verb: 'Strip fiber', item: 'fiber', yield: 2, charges: 2, respawnHours: 16, hitRadius: 0.7, hitHeight: 0.4, blockRadius: 0.6, persistent: true, spines: { radius: 0.3, damage: 2 }, starter: 2, scatter: 0.5 },
  pricklyPear: { kind: 'pricklyPear', name: 'Prickly Pear', verb: 'Pick fruit', item: 'pricklyPear', yield: 2, charges: 3, respawnHours: 20, hitRadius: 0.8, hitHeight: 0.55, blockRadius: 0.75, persistent: true, spines: { radius: 0.45, damage: 3 }, starter: 2, scatter: 0.5 },
  cholla: { kind: 'cholla', name: 'Buckhorn Cholla', verb: 'Pick buds', item: 'chollaBuds', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.6, hitHeight: 0.8, blockRadius: 0.6, persistent: true, spines: { radius: 0.4, damage: 5 }, starter: 1, scatter: 0.45 },
  agave: { kind: 'agave', name: "Parry's Agave", verb: 'Cut the heart', item: 'agaveHeart', yield: 1, charges: 1, respawnHours: 72, hitRadius: 0.75, hitHeight: 0.35, blockRadius: 0.7, starter: 0, scatter: 0.4 },
  chia: { kind: 'chia', name: 'Desert Chia', verb: 'Shake seeds', item: 'chiaSeeds', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.45, hitHeight: 0.18, blockRadius: 0.35, starter: 0, scatter: 0.5 },
  wolfberry: { kind: 'wolfberry', name: 'Wolfberry', verb: 'Pick berries', item: 'wolfberries', yield: 2, charges: 3, respawnHours: 20, hitRadius: 0.8, hitHeight: 0.55, blockRadius: 0.7, persistent: true, starter: 1, scatter: 0.5 },
};

export const RESOURCE_KINDS: ResourceKind[] = ['stickPile', 'stonePile', 'berryBush', 'fern', 'mushroom', 'onion', 'yucca', 'pricklyPear', 'cholla', 'agave', 'chia', 'wolfberry'];

export type TreeSpecies =
  | 'fir' | 'cedar' | 'birch' | 'maple'
  | 'joshua' | 'mesquite' | 'cottonwood' | 'juniper' | 'pinyon' | 'ponderosa';

export interface TreeDef {
  species: TreeSpecies;
  name: string;
  hp: number;
  logs: number;
  sticks: number;
  trunkRadius: number;
  /** Length of the fallen trunk at scale 1. */
  fallLength: number;
  /** Standing height at scale 1 (the felling animation swings this through the fall). */
  height: number;
  /** Harvests by hand before it has to regrow (birch and juniper bark, mesquite pods, piñon nuts); 0 for none. */
  bark: number;
  barkRespawnHours: number;
  /** What a hand harvest gives; bark unless noted. */
  peelItem?: ItemId;
  peelVerb?: string;
  peelRegrowing?: string;
}

export const TREES: Record<TreeSpecies, TreeDef> = {
  fir: { species: 'fir', name: 'Douglas Fir', hp: 6, logs: 3, sticks: 2, trunkRadius: 0.38, fallLength: 7.5, height: 11, bark: 0, barkRespawnHours: 0 },
  cedar: { species: 'cedar', name: 'Western Red Cedar', hp: 7, logs: 3, sticks: 1, trunkRadius: 0.45, fallLength: 7.5, height: 11, bark: 0, barkRespawnHours: 0 },
  birch: { species: 'birch', name: 'Paper Birch', hp: 4, logs: 2, sticks: 2, trunkRadius: 0.22, fallLength: 5, height: 7.5, bark: 2, barkRespawnHours: 24 },
  maple: { species: 'maple', name: 'Bigleaf Maple', hp: 5, logs: 2, sticks: 3, trunkRadius: 0.3, fallLength: 5, height: 7.5, bark: 0, barkRespawnHours: 0 },
  // Small desert trees: quick to fell, one log.
  joshua: { species: 'joshua', name: 'Joshua Tree', hp: 3, logs: 1, sticks: 1, trunkRadius: 0.2, fallLength: 3.4, height: 4.5, bark: 0, barkRespawnHours: 0 },
  mesquite: {
    species: 'mesquite', name: 'Velvet Mesquite', hp: 3, logs: 1, sticks: 3, trunkRadius: 0.15, fallLength: 3.2, height: 3.6, bark: 3, barkRespawnHours: 30,
    peelItem: 'mesquitePods', peelVerb: 'Pick pods', peelRegrowing: 'Pods regrowing',
  },
  // Full-size trees: the spring's cottonwoods and the high country's pinyon-juniper and ponderosa.
  cottonwood: { species: 'cottonwood', name: 'Fremont Cottonwood', hp: 6, logs: 2, sticks: 3, trunkRadius: 0.36, fallLength: 6.5, height: 10, bark: 2, barkRespawnHours: 24 },
  juniper: { species: 'juniper', name: 'Utah Juniper', hp: 5, logs: 2, sticks: 2, trunkRadius: 0.26, fallLength: 4.4, height: 6, bark: 2, barkRespawnHours: 24 },
  pinyon: {
    species: 'pinyon', name: 'Pinyon Pine', hp: 5, logs: 2, sticks: 3, trunkRadius: 0.27, fallLength: 5, height: 7, bark: 3, barkRespawnHours: 36,
    peelItem: 'pinonNuts', peelVerb: 'Gather piñon nuts', peelRegrowing: 'Cones picked over',
  },
  ponderosa: { species: 'ponderosa', name: 'Ponderosa Pine', hp: 7, logs: 3, sticks: 2, trunkRadius: 0.42, fallLength: 8, height: 12, bark: 0, barkRespawnHours: 0 },
};

/** Trees that give a single log (the desert's Joshua trees and mesquite). */
export function isSmallTree(species: TreeSpecies): boolean {
  return TREES[species].logs <= 1;
}
