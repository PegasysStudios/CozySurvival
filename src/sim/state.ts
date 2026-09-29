import type { GearId, ItemId, ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import type { SpeciesId } from '../data/species';

export const STATE_VERSION = 1;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  sprinting: boolean;
  wading: boolean;
  sitting: boolean;
  /** Seconds since the last hit (brief invulnerability window). */
  hurtTimer: number;
}

export interface NeedsState {
  health: number;
  hunger: number;
  thirst: number;
  warmth: number;
  energy: number;
  /** Seconds of boosted energy regeneration left after eating/drinking. */
  regenBoost: number;
  /** Sprint lockout after running out of energy. */
  exhausted: boolean;
}

export interface Slot {
  item: ItemId;
  count: number;
}

export interface InventoryState {
  slots: (Slot | null)[];
}

export interface StatsState {
  gathered: Partial<Record<ItemId, number>>;
  crafted: Record<string, number>;
  events: Record<string, number>;
  kills: Partial<Record<SpeciesId, number>>;
}

export interface TreeDyn {
  hp: number;
  felled: boolean;
  bark: number;
  barkAt: number;
}

export interface ResourceDyn {
  charges: number;
  respawnAt: number;
}

export interface StructureState {
  id: number;
  prefab: PrefabId;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Campfire fuel remaining in game hours. */
  fuel: number;
}

export interface DropState {
  id: number;
  item: ItemId;
  count: number;
  x: number;
  y: number;
  z: number;
}

export interface CarcassState {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  z: number;
  rot: number;
  remaining: { item: ItemId; count: number }[];
  expiresAt: number;
}

export type AnimalMode =
  | 'idle'
  | 'wander'
  | 'alert'
  | 'flee'
  | 'stalk'
  | 'chase'
  | 'attack'
  | 'reposition'
  | 'warn'
  | 'retreat';

export interface AnimalState {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  z: number;
  heading: number;
  mode: AnimalMode;
  modeTime: number;
  timer: number;
  tx: number;
  tz: number;
  /** Distance to the player when the current alert started (prey). */
  alertDist: number;
  health: number;
  /** Per-individual fear multiplier: <1 bold, >1 skittish. */
  temperament: number;
  homeX: number;
  homeZ: number;
  speed: number;
  cooldown: number;
  aggroCooldown: number;
  hurt: number;
  /** Accumulated dt for low-frequency updates when far from the player. */
  lod: number;
}

export type DamageSource = 'starvation' | 'dehydration' | 'cold' | 'wolf' | 'bear' | 'dev';

export interface GameState {
  version: number;
  seed: number;
  runId: string;
  /** Game hours since day 1 at 06:00. */
  totalHours: number;
  player: PlayerState;
  needs: NeedsState;
  inventory: InventoryState;
  tools: ToolId[];
  activeTool: ToolId;
  gear: GearId[];
  known: string[];
  stats: StatsState;
  objective: number;
  trees: TreeDyn[];
  resources: ResourceDyn[];
  structures: StructureState[];
  drops: DropState[];
  carcasses: CarcassState[];
  animals: AnimalState[];
  nextId: number;
  rng: number;
  spawnCheckAt: number;
  dead: boolean;
  deathCause: DamageSource | null;
  lastDamage: DamageSource | null;
  /** Day index of the most recent start-of-day snapshot. */
  snapshotDay: number;
}
