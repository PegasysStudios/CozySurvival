import type { BiomeId } from '../data/biomes';
import type { ForageId } from '../data/forage';
import type { GearId, ItemId, ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import type { SpeciesId } from '../data/species';
import type { WearingTool } from './durability';
import type { SeasonState } from './seasons';
import type { WeatherState } from './weather';
import type { PnwGeneration } from './pnw';
import type { VillagerTask } from '../data/tribes';

export const STATE_VERSION = 7;

export type SkillId = 'gathering' | 'hunting' | 'cooking' | 'crafting' | 'fishing' | 'skinning';

export interface Wear {
  dur: number;
  max: number;
}

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
  swimming: boolean;
  sitting: boolean;
  /** While sitting: the bench and the way you face on it (outward, toward the side you sat down from). */
  seat?: { id: number; yaw: number };
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
  /** A fer-de-lance bite still working: seconds left and health lost per second (absent when clean). */
  venom?: { seconds: number; perSecond: number };
}

export interface Slot {
  item: ItemId;
  count: number;
}

export interface InventoryState {
  slots: (Slot | null)[];
}

/** Servings of water in the canteen, by kind. */
export interface CanteenState {
  lakeWater: number;
  boiledWater: number;
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
  /** Logs still to cut from the fallen trunk (0 once chopped up, or while standing). */
  logs: number;
  /** Axe hits into the current log. */
  cuts: number;
  /** Fall direction as an angle: the trunk lies along (sin, cos). */
  fall: number;
}

export interface ResourceDyn {
  charges: number;
  respawnAt: number;
  /** Desert stone piles: this pile has already turned up its one scorpion, so it never hides another. */
  scorpion?: boolean;
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
  /** Shelters and benches only: they weather over time and wear with use. */
  wear?: Wear;
  /** Storage bins only: shared slots anyone can put things in or take them out of. */
  store?: (Slot | null)[];
  /** Village property: never counts as a player-built structure or an upgrade target. */
  settlement?: string;
}

export interface VillagerState {
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  task: VillagerTask;
  phase: 'idle' | 'travel' | 'work' | 'return';
  timer: number;
  tx: number;
  tz: number;
  speed: number;
  target?: { kind: 'resource' | 'tree' | 'animal'; ref: number };
}

export interface SettlementState {
  tribe: string;
  x: number;
  z: number;
  structures: StructureState[];
  members: VillagerState[];
  /** Independent AI randomness never changes the player's harvest/cooking/wildlife rolls. */
  rng: number;
}

export interface ActiveQuest {
  tribe: string;
  id: string;
  baseline: Record<string, number>;
}

export interface QuestLogState {
  active?: ActiveQuest;
  tribes: Record<string, { discovered: boolean; reputation: number; completed: number }>;
}

/** A tool being mended at a workbench. Its materials are paid up front and refunded if the repair is interrupted. */
export interface RepairState {
  tool: WearingTool;
  structure: number;
  elapsed: number;
  duration: number;
  paid: { item: ItemId; count: number }[];
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
  /**
   * The hide is off (whether or not the skinning worked): it shows the skinned model and the next knife cut butchers
   * it. Animals without a hide never get this; they go straight to butchering.
   */
  skinned?: boolean;
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
  | 'retreat'
  | 'climb'
  | 'hide'
  | 'descend';

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
  /** Id of the animal this one is charging (a javelina) or running from; unset means the player. */
  foe?: number;
  /** Squirrel refuge: standing worldgen tree index and height above its base. */
  tree?: number;
  climbHeight?: number;
  /** Last unreachable refuge; avoid immediately choosing the same obstructed tree again. */
  failedTree?: number;
}

export type DamageSource =
  | 'starvation' | 'dehydration' | 'cold' | 'wolf' | 'bear' | 'cougar' | 'snake' | 'spines' | 'scorpion' | 'javelina'
  | 'boar' | 'viper' | 'jellyfish' | 'shark' | 'dev';

export interface GameState {
  version: number;
  seed: number;
  /** The map; absent means the Pacific Northwest (every save from before the desert). */
  biome?: BiomeId;
  /** Forest generation pinned to this run. Missing means the original 320 m terrain. */
  pnwGen?: PnwGeneration;
  /** PNW squirrel population initialized. Prevents restocking hunted animals on Continue. */
  pnwWildlife?: 1;
  runId: string;
  /** Game hours since day 1 at 06:00. */
  totalHours: number;
  /** Present only on the Pacific Northwest map. */
  season?: SeasonState;
  /** Daily atmosphere, present only on the Pacific Northwest map. */
  weather?: WeatherState;
  player: PlayerState;
  needs: NeedsState;
  inventory: InventoryState;
  /** Water lives here, not in the pack; it only holds anything while `gear` includes the canteen. */
  canteen: CanteenState;
  tools: ToolId[];
  activeTool: ToolId;
  /** Durability of each owned tool (hands never wear). */
  toolWear: Partial<Record<ToolId, Wear>>;
  /** Upgrade level 0..3 per tool (missing means 0). Kept when a tool breaks, so its replacement has the same fittings. */
  toolLevels: Partial<Record<ToolId, number>>;
  gear: GearId[];
  /** Experience per skill; levels derive from it. */
  skills: Record<SkillId, number>;
  /** Foraging guide entries unlocked by harvesting each plant at least once. */
  forage: ForageId[];
  stats: StatsState;
  objective: number;
  trees: TreeDyn[];
  resources: ResourceDyn[];
  structures: StructureState[];
  /** Shared village life and property; separate from player-built camps. PNW only for now. */
  settlements?: SettlementState[];
  /** Personal quest progress and reputation, independent of the six activity skills. */
  questLog?: QuestLogState;
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
  /** Set while standing at a workbench mending a tool: you can look around but not move. */
  repair?: RepairState;
  /** Recipe ids pinned to the HUD's crafting checklist, oldest first (absent means none). */
  pinned?: string[];
}
