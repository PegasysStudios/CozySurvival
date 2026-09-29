import type { ItemId } from './items';

export type ResourceKind = 'stickPile' | 'stonePile' | 'berryBush' | 'fern' | 'mushroom' | 'onion';

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
}

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  stickPile: { kind: 'stickPile', name: 'Fallen Branches', verb: 'Gather sticks', item: 'stick', yield: 2, charges: 3, respawnHours: 12, hitRadius: 0.6, hitHeight: 0.15, blockRadius: 0.5 },
  stonePile: { kind: 'stonePile', name: 'Loose Stones', verb: 'Pick up stones', item: 'stone', yield: 2, charges: 3, respawnHours: 30, hitRadius: 0.55, hitHeight: 0.15, blockRadius: 0.5 },
  berryBush: { kind: 'berryBush', name: 'Salmonberry Bush', verb: 'Pick berries', item: 'berries', yield: 2, charges: 3, respawnHours: 20, hitRadius: 0.8, hitHeight: 0.6, blockRadius: 0.7, persistent: true },
  fern: { kind: 'fern', name: 'Sword Fern', verb: 'Strip fiber', item: 'fiber', yield: 2, charges: 2, respawnHours: 16, hitRadius: 0.7, hitHeight: 0.35, blockRadius: 0.55, persistent: true },
  mushroom: { kind: 'mushroom', name: 'Chanterelles', verb: 'Pick mushrooms', item: 'mushroom', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.45, hitHeight: 0.1, blockRadius: 0.35 },
  onion: { kind: 'onion', name: 'Nodding Onion', verb: 'Pull onions', item: 'onion', yield: 1, charges: 2, respawnHours: 24, hitRadius: 0.45, hitHeight: 0.15, blockRadius: 0.35 },
};

export const RESOURCE_KINDS: ResourceKind[] = ['stickPile', 'stonePile', 'berryBush', 'fern', 'mushroom', 'onion'];

export type TreeSpecies = 'fir' | 'cedar' | 'birch' | 'maple';

export interface TreeDef {
  species: TreeSpecies;
  name: string;
  hp: number;
  logs: number;
  sticks: number;
  trunkRadius: number;
  /** Length of the fallen trunk at scale 1. */
  fallLength: number;
  /** Birch trees can be peeled by hand. */
  bark: number;
  barkRespawnHours: number;
}

export const TREES: Record<TreeSpecies, TreeDef> = {
  fir: { species: 'fir', name: 'Douglas Fir', hp: 6, logs: 3, sticks: 2, trunkRadius: 0.38, fallLength: 7.5, bark: 0, barkRespawnHours: 0 },
  cedar: { species: 'cedar', name: 'Western Red Cedar', hp: 7, logs: 3, sticks: 1, trunkRadius: 0.45, fallLength: 7.5, bark: 0, barkRespawnHours: 0 },
  birch: { species: 'birch', name: 'Paper Birch', hp: 4, logs: 2, sticks: 2, trunkRadius: 0.22, fallLength: 5, bark: 2, barkRespawnHours: 24 },
  maple: { species: 'maple', name: 'Bigleaf Maple', hp: 5, logs: 2, sticks: 3, trunkRadius: 0.3, fallLength: 5, bark: 0, barkRespawnHours: 0 },
};
