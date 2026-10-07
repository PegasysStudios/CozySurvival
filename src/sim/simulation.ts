import { box, circle, overlaps, raySphere, rayCylinder } from '../core/geom2d';
import { clamp, damp, lerp, headingTo } from '../core/math';
import { Rng } from '../core/rng';
import { BALANCE } from '../data/balance';
import { FISHING_CATCHES, type FishingCatch } from '../data/fishing';
import { biomeDef, DEFAULT_BIOME, speciesName, type BiomeDef, type BiomeId } from '../data/biomes';
import { ITEMS, TOOLS, TOOL_ORDER, itemName, setDisplayBiome, type ItemId, type ToolId } from '../data/items';
import { forageForResource, forageForTree, FORAGE_BY_ID, type ForageId } from '../data/forage';
import { OBJECTIVES, advanceObjectives, killKey, objectiveText, type ObjectiveNeed } from '../data/objectives';
import { PLACE_MAX_DIST, PREFABS, type PrefabId } from '../data/prefabs';
import { RECIPE_BY_ID, recipeOnMap } from '../data/recipes';
import { RESOURCES, TREES } from '../data/resources';
import { ANIMAL_LEVELS, FISH_LEVELS, RESOURCE_LEVELS, STRUCTURE_LEVELS, TREE_LEVELS } from '../data/progression';
import { LEVEL_NUMERALS, nextTier, tierCost, tierLine, TOOL_UPGRADES, isUpgradable } from '../data/upgrades';
import { PREDATOR_MIN_SPAWN_DIST, PREY_MIN_SPAWN_DIST, SPECIES, type PestSpecies, type SpeciesId } from '../data/species';
import { animalHidden, burrowed, createAnimal, damageAnimal, findSpawnPoint, hostile, isHabitable, updateAnimal, type AnimalEnv, type AvoidPoint } from './animals';
import { ColliderIndex, makeCollider, type Collider } from './colliders';
import { canCraft, craft as craftRecipe, recipeRequirementText, slotsFor, type CraftCheck } from './crafting';
import { canteenCapacity, canteenRoom, emptyCanteen, fillCanteen, hasItems, inCanteen, nextServing, takeItems } from './canteen';
import { togglePin, unpin, unpinsWhenMade } from './checklist';
import { applyWear, newStructureWear, newToolWear, prefabWears, toolWear, toolWears, wearFraction, type WearingTool, type WearResult } from './durability';
import type { SimEvent } from './events';
import { addItem, countItem, createInventory, hasAll, removeAll, removeFromSlot, removeItem, roomFor, usedSlots } from './inventory';
import { createPlayer, horizontalSpeed, lookDir, stepPlayer, surfaceAt, type MoveEnv, type MoveInput } from './movement';
import { canRepair, repairCost, repairSeconds, type RepairCheck } from './repair';
import { addToStore, cloneStore, ensureStore } from './storage';
import { applyDamage, applyFood, applySleep, createNeeds, restWhileWaiting, spendEnergy, updateNeeds, type Activity, type SleepClimate, type SleepResult } from './needs';
import { checkPlacement, checkUpgradeRoom, colliderShape, footprintShape, type PlacementEnv, type PlacementReason } from './placement';
import { addSkillXp, burnChance, butcherBonusChance, createSkills, gatherBonusChance, gatherSuccessChance, meetsSkill, practiceXp, skillRequirementText, SKILL_INFO } from './skills';
import { arrowSpeedMultiplier, canUpgradeTool, chopPower, landChance, skinChance, toolLevel, torchBurnMultiplier, torchWarmth, upgradeTool as applyToolUpgrade, weaponDamageMultiplier, type UpgradeCheck } from './upgrades';
import { carcassStep, hidesOn } from './carcass';
import { PNW_GENERATION, type PnwGeneration } from './pnw';
import { STATE_VERSION, type AnimalState, type CarcassState, type DamageSource, type DropState, type GameState, type PlayerState, type ResourceDyn, type SkillId, type StructureState, type TreeDyn, type Wear } from './state';
import { getTerrain, isDrinkable, WATER_LEVEL, type Lake, type Terrain } from './terrain';
import { chooseFishingCatch, fishingPoolAt } from './fishing';
import { advanceHours, ambientWarmth, canSleepAt, dayOf, hourOf, isNight, nextDayStart } from './time';
import { crownPosition, freshTree, logTop, rockTop, TRUNK_AXIS_LIFT, trunkBox, trunkSpan, trunkTop, type TrunkSpan } from './trunks';
import { getWorldGen, type WorldGen } from './worldgen';
import { parseSeason, seasonAtDawn, seasonDay, seasonDeadline, seasonalForage, SEASON_NAMES, SEASON_SLEEP_COLD, SEASON_WARMTH, type Season, type SeasonState } from './seasons';
import { parseWeather, weatherForSeason, WEATHER_NAMES, type Weather, type WeatherState } from './weather';
import { snowAmount, snowCovered, snowScale } from './snow';
import { TRIBES, tribeFor } from '../data/tribes';
import { createSettlement, planSettlement, settlementStructures } from './settlements';
import { acceptQuest as acceptTribeQuest, canUseTribeStructure, completeQuest, discoverTribe, privateTribeStructure, tribeDialog, tribeStationRequirementText } from './quests';
import { updateVillagers } from './villagers';
import type { SettlementState, VillagerState } from './state';
import { removeFromStore } from './storage';
import { questlineFor } from '../data/quests';

export interface SimInput {
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
  primary: boolean;
  primaryPressed: boolean;
  primaryReleased: boolean;
  /** Optional presentation-camera aim, resolved after movement; absent keeps the original first-person ray. */
  resolveAim?: (eye: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }) => void;
}

export const IDLE_INPUT: Readonly<SimInput> = {
  moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: 0, pitch: 0,
  primary: false, primaryPressed: false, primaryReleased: false,
};

export type Target =
  | { kind: 'villager'; tribe: string; member: string; dist: number }
  | { kind: 'tree'; index: number; dist: number }
  | { kind: 'resource'; index: number; dist: number }
  | { kind: 'drop'; id: number; dist: number }
  | { kind: 'carcass'; id: number; dist: number }
  | { kind: 'structure'; id: number; dist: number }
  | { kind: 'animal'; id: number; dist: number }
  | { kind: 'water'; dist: number; x: number; z: number };

export interface TargetInfo {
  name: string;
  action: string;
  enabled: boolean;
}

export interface PlacementPreview {
  recipeId: string;
  prefab: PrefabId;
  x: number;
  y: number;
  z: number;
  rot: number;
  valid: boolean;
  reason: PlacementReason | 'missing' | null;
}

export interface Projectile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  life: number;
  tool: ToolId;
}

export type FishingPhase = 'charging' | 'flying' | 'waiting' | 'bite';

/** A fishing cast in progress. It isn't saved: loading a save simply finds the line reeled in. */
export interface FishingLine {
  phase: FishingPhase;
  /** Seconds spent in the current phase. */
  t: number;
  /** Cast strength 0..1, growing while charging. */
  power: number;
  /** Where the cast was thrown from and where the lure lands. */
  fromX: number;
  fromZ: number;
  x: number;
  z: number;
  /** Seconds after the lure settles until a fish bites. */
  biteAt: number;
  /** Chosen from the lure's habitat when the fish bites; kept through the strike. */
  catch?: FishingCatch;
}

/** `solo` is single-player. In multiplayer the host's simulation owns the world and guests follow it. */
export type Authority = 'solo' | 'host' | 'guest';

/** Another player as the host's animal AI sees them. */
export interface RemotePlayer {
  pid: string;
  x: number;
  z: number;
  noise: number;
  dead: boolean;
  sleeping: boolean;
  deterrent: boolean;
}

/** Requests a guest's simulation leaves for its network session. */
export type NetRequest =
  | { k: 'questDelivery'; tribe: string; quest: string }
  | { k: 'tribeFuel'; tribe: string; fuel: 'stick' | 'log' }
  | { k: 'hit'; id: number; dmg: number; t?: number }
  | { k: 'sleep'; structure: number }
  | { k: 'wake' }
  /** Gathering stone pile `i` turned up its scorpion at (x, z); the host spawns it. */
  | { k: 'scorpion'; i: number; x: number; z: number };

export const COOK_RADIUS = 4;
const ARROW_GRAVITY = 9.8;
const START_HOURS = BALANCE.time.startHour - BALANCE.time.dayStartHour;
const CARCASS_HIT_RADIUS: Partial<Record<SpeciesId, number>> = { bear: 1.1, deer: 0.9, cougar: 0.85, javelina: 0.8, boar: 0.85, goat: 0.8 };

let runCounter = 0;

/** Unique per run (not derived from the seed) so restarts in the same world are distinguishable. */
function makeRunId(): string {
  runCounter = (runCounter + 1) % 1296;
  return Date.now().toString(36) + Math.floor(Math.random() * 0xffffff).toString(36) + runCounter.toString(36);
}

/** New players start at most this far from the nearest shore. */
export const SPAWN_SHORE_DIST = 14;
const SPAWN_MAX_NUDGE = 12;

/**
 * The nearest lake or pond shore seen from (x, z): distance and direction, found by marching rays outward.
 * `drinkableOnly` skips water you can't drink (the desert's alkali pool).
 */
export function nearestShore(terrain: Terrain, x: number, z: number, maxDist = 120, drinkableOnly = false): { dist: number; dx: number; dz: number } | null {
  let best: { dist: number; dx: number; dz: number } | null = null;
  for (let a = 0; a < 180; a++) {
    const ang = (a / 180) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const limit = best ? best.dist : maxDist;
    for (let r = 0.5; r < limit; r += 0.5) {
      const wx = x + dx * r;
      const wz = z + dz * r;
      if (terrain.heightAt(wx, wz) < WATER_LEVEL && (!drinkableOnly || drinkableWater(terrain, wx, wz))) {
        best = { dist: r, dx, dz };
        break;
      }
    }
  }
  return best;
}

/** What the water under the crosshair is called; an alkali pool only earns its name once you've tasted one. */
function waterName(lake: Lake | null, knowsAlkali: boolean, terrain: Terrain, x: number, z: number): string {
  switch (lake?.kind) {
    case 'spring':
      return 'Spring Pool';
    case 'tinaja':
      return 'Rock Pool';
    case 'alkali':
      return knowsAlkali ? 'Alkali Pool' : 'Milky Pool';
    case 'stream':
      return 'Stream';
    case 'pool':
      return 'Freshwater Pool';
    case 'plunge':
      return 'Waterfall Pool';
    case 'sea': {
      const isl = terrain.island!;
      if (Math.hypot(x - isl.cove.x, z - isl.cove.z) < isl.cove.r + 6) return 'Cove';
      return isl.pastReef(x, z) > 0 ? 'Open Ocean' : 'Lagoon';
    }
    default:
      return 'Lake';
  }
}

/** Swimming fish retain the existing trout/reef/stream identities; rod catches use their own habitat pool. */
function fishWord(terrain: Terrain, x: number, z: number): string {
  if (!terrain.island) return 'trout';
  return terrain.island.waterAt(x, z).kind === 'sea' ? 'parrotfish' : 'stream goby';
}

function drinkableWater(terrain: Terrain, x: number, z: number): boolean {
  const lake = terrain.lakeAt(x, z);
  return !lake || isDrinkable(lake);
}

/**
 * A new player near the world spawn, facing the water. If the nearest shore is more than a short walk away, the
 * start point slides toward it (never more than `SPAWN_MAX_NUDGE`, so the starter patch stays close).
 */
export function spawnPlayer(terrain: Terrain): PlayerState {
  let sx = terrain.spawn.x;
  let sz = terrain.spawn.z;
  const shore = nearestShore(terrain, sx, sz, 120, terrain.biome !== 'pnw');
  if (!shore) {
    const lake = terrain.lakes[0];
    return createPlayer(sx, terrain.heightAt(sx, sz), sz, Math.atan2(-(lake.x - sx), -(lake.z - sz)));
  }
  const nudge = clamp(shore.dist - SPAWN_SHORE_DIST, 0, SPAWN_MAX_NUDGE);
  for (let d = nudge; d > 0; d -= 1) {
    const x = sx + shore.dx * d;
    const z = sz + shore.dz * d;
    if (terrain.heightAt(x, z) > WATER_LEVEL + 0.8 && terrain.slopeAt(x, z) < 0.5) {
      sx = x;
      sz = z;
      break;
    }
  }
  return createPlayer(sx, terrain.heightAt(sx, sz), sz, Math.atan2(-shore.dx, -shore.dz));
}

export function createNewState(seed: number, biome: BiomeId = DEFAULT_BIOME, pnwGen: PnwGeneration = PNW_GENERATION): GameState {
  const terrain = getTerrain(seed, biome, pnwGen);
  const gen = getWorldGen(seed, biome, pnwGen);
  const rng = new Rng(seed ^ 0x3c6ef372);
  const sx = terrain.spawn.x;
  const sz = terrain.spawn.z;
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    ...(biome === DEFAULT_BIOME ? {} : { biome }),
    ...(biome === 'pnw' && pnwGen === 2 ? { pnwGen } : {}),
    runId: makeRunId(),
    totalHours: START_HOURS,
    ...(biome === 'pnw' ? { season: parseSeason(null, START_HOURS) } : {}),
    player: spawnPlayer(terrain),
    needs: createNeeds(),
    inventory: createInventory(BALANCE.carry.baseSlots),
    canteen: emptyCanteen(),
    tools: ['hands'],
    activeTool: 'hands',
    toolWear: {},
    toolLevels: {},
    gear: [],
    skills: createSkills(),
    forage: [],
    stats: { gathered: {}, crafted: {}, events: {}, kills: {} },
    objective: 0,
    trees: gen.trees.map((t) => freshTree(t.species)),
    resources: gen.resources.map((r) => ({ charges: RESOURCES[r.kind].charges, respawnAt: 0 })),
    structures: [],
    drops: [],
    carcasses: [],
    animals: [],
    nextId: 1,
    rng: 0,
    spawnCheckAt: START_HOURS + 1,
    dead: false,
    deathCause: null,
    lastDamage: null,
    snapshotDay: 0,
  };
  const spawnAvoid: AvoidPoint[] = [{ x: sx, z: sz, minDist: 0 }];
  if (state.season) state.weather = parseWeather(undefined, seed, state.totalHours, state.season);
  const populate = (species: SpeciesId, count: number, minDist: number) => {
    spawnAvoid[0].minDist = minDist;
    for (let i = 0; i < count; i++) {
      const p = findSpawnPoint(terrain, rng, species, spawnAvoid);
      if (p) state.animals.push(createAnimal(state.nextId++, species, p.x, p.z, rng, terrain));
    }
  };
  const b = biomeDef(biome);
  for (const p of b.prey) {
    // Squirrels are seeded beside standing, unobstructed trees after the collider index is built.
    // Legacy saved forests keep their original wildlife population and RNG sequence.
    if (p.species === 'squirrel') continue;
    populate(p.species, p.count, p.minDist);
  }
  const targets = b.predatorTargets(1);
  for (const p of b.predators) populate(p.species, targets[p.species] ?? 0, p.minDist);
  state.rng = rng.s;
  return state;
}

export class Simulation {
  readonly state: GameState;
  readonly biome: BiomeId;
  readonly biomeDef: BiomeDef;
  readonly terrain: Terrain;
  readonly gen: WorldGen;
  readonly colliders = new ColliderIndex();
  timeScale = 1;
  target: Target | null = null;
  placement: PlacementPreview | null = null;
  readonly projectiles: Projectile[] = [];
  /** Seconds the bow has been drawn, or -1 when not drawing. */
  bowDraw = -1;
  fishing: FishingLine | null = null;
  actionCooldown = 0;
  /** Increments whenever trees/resources/structures/drops/carcasses change, so views can resync. */
  worldVersion = 0;
  /** Smoothed movement noise used by animal perception. */
  noise = 0.5;
  activity: Activity = 'idle';
  lastLanding = 0;
  distanceWalked = 0;

  authority: Authority = 'solo';
  /** Host only: the other players, so animals notice and attack whoever is nearest. */
  readonly remotePlayers: RemotePlayer[] = [];
  /** Host only: predator hits on remote players, for the session to forward. */
  readonly remoteHits: { pid: string; amount: number; source: DamageSource; fromX: number; fromZ: number }[] = [];
  /** Host only: animals a remote player's hit killed, so the session can credit them. */
  readonly remoteKills: { pid: string; species: SpeciesId; tool: ToolId | null }[] = [];
  /** Guest only: requests for the host. */
  readonly netOut: NetRequest[] = [];
  /** Multiplayer: the shelter this player sleeps in while waiting for everyone else. */
  sleepingIn: number | null = null;
  private sleepByFire = false;
  private aiTarget: RemotePlayer | null = null;

  private readonly events: SimEvent[] = [];
  private readonly rng: Rng;
  private readonly treeColliders: Collider[] = [];
  private readonly trunkColliders = new Map<number, Collider>();
  private readonly structureColliders = new Map<number, Collider>();
  private wasNight: boolean;
  private respawnTimer = 0;
  private readonly litFires: { x: number; z: number }[] = [];
  private readonly tmpColliders: Collider[] = [];
  private readonly spineColliders: Collider[] = [];
  private readonly crownColliders: Collider[] = [];
  private spineCooldown = 0;
  private warnedCurrent = false;
  private warnedCoconut = false;
  /** Spiny plants that have already pricked this player this session, so the warning shows once each. */
  private readonly prickedBy = new Set<string>();
  private readonly look = { x: 0, y: 0, z: 1 };
  private readonly cameraAim = { x: 0, y: 0, z: -1 };
  private readonly aimEye = { x: 0, y: 0, z: 0 };
  private hasCameraAim = false;
  private readonly hit = { x: 0, y: 0, z: 0, water: false };
  private readonly moveEnv: MoveEnv;
  private readonly locked: MoveInput = { moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: 0 };
  private readonly animalEnv: AnimalEnv;

  constructor(state: GameState) {
    this.state = state;
    this.biome = state.biome ?? DEFAULT_BIOME;
    this.biomeDef = biomeDef(this.biome);
    if (this.biome === 'pnw') {
      state.season = parseSeason(state.season, state.totalHours);
      state.weather = parseWeather(state.weather, state.seed, state.totalHours, state.season);
    } else {
      delete state.season;
      delete state.weather;
    }
    setDisplayBiome(this.biome);
    this.terrain = getTerrain(state.seed, this.biome, state.pnwGen ?? 1);
    this.gen = getWorldGen(state.seed, this.biome, state.pnwGen ?? 1);
    this.rng = new Rng(state.rng);
    this.wasNight = isNight(this.hour);
    this.buildColliders();
    if (this.biome !== 'pnw' || this.terrain.pnw) this.initializeSettlements();
    const query = (x: number, z: number, r: number, out: Collider[]) => this.colliders.query(x, z, r, out);
    const self = this;
    this.moveEnv = { terrain: this.terrain, query, get frozen() { return self.frozen; } };
    this.animalEnv = {
      tree(ref) {
        const tr = self.gen.trees[ref];
        if (!tr || self.state.trees[ref]?.felled) return null;
        return { x: tr.x, z: tr.z, radius: tr.trunkR, height: TREES[tr.species].height * tr.scale };
      },
      terrain: this.terrain,
      rng: this.rng,
      query,
      playerX: 0,
      playerZ: 0,
      playerNoise: 1,
      playerDead: false,
      playerDeterrent: false,
      litFires: this.litFires,
      night: false,
      get animals() {
        return self.state.animals;
      },
      events: this.events,
      hurtPlayer(amount, source, fromX, fromZ) {
        if (self.aiTarget) self.remoteHits.push({ pid: self.aiTarget.pid, amount, source, fromX, fromZ });
        else self.hurtPlayer(amount, source, fromX, fromZ);
      },
      poison(perSecond, seconds, maxSeconds, source, fromX, fromZ) {
        if (!self.aiTarget) {
          self.envenom(perSecond, seconds, maxSeconds);
          return;
        }
        // Another player's venom arrives with the bite that carried it, all at once.
        const pid = self.aiTarget.pid;
        const bite = self.remoteHits.findLast((h) => h.pid === pid && h.source === source);
        if (bite) bite.amount += perSecond * seconds;
        else self.remoteHits.push({ pid, amount: perSecond * seconds, source, fromX, fromZ });
      },
    };
    this.refreshLitFires();
    this.applySeasonEnvironment();
    // Historical legacy templates stay reproducible; RunManager activates wildlife when those runs are opened.
    if (this.terrain.pnw) this.initializePnwWildlife();
  }

  /** Run activation also gives legacy PNW saves their requested wildlife without regenerating the map. */
  initializePnwWildlife(): void {
    if (this.biome === 'pnw' && this.state.pnwWildlife !== 1) this.seedPnwSquirrels();
  }

  /** Village property is separate from player builds, but uses the same stations, colliders and render models. */
  get structures(): StructureState[] { return settlementStructures(this.state); }

  initializeSettlements(): void {
    if (!TRIBES.some((def) => def.biome === this.biome) || this.state.settlements?.length) return;
    const plans = this.gen.settlements ?? [];
    this.state.settlements = [];
    for (const seedPlan of plans) {
      const def = tribeFor(seedPlan.tribe, this.biome)!;
      const plan = this.state.structures.length ? planSettlement(this.terrain, this.gen, def, this.state.structures) : seedPlan;
      if (!plan) continue;
      const camp = createSettlement(plan, this.terrain, () => this.state.nextId++);
      this.state.settlements.push(camp);
      for (const st of camp.structures) this.addStructureCollider(st);
      const store = camp.structures.find((st) => st.store)?.store;
      if (store) { addToStore(store, 'stick', 12); addToStore(store, 'fiber', 6); addToStore(store, 'rawMeat', 2); }
    }
    this.refreshLitFires();
    this.worldVersion++;
  }

  /** Shared NPC state follows the host while every player keeps their own quests and reputation. */
  followSettlements(camps: SettlementState[] | undefined): void {
    if (!camps) return;
    camps = camps.filter((camp) => tribeFor(camp.tribe, this.biome));
    const previous = (this.state.settlements ?? []).flatMap((camp) => camp.structures);
    const incoming = camps.flatMap((camp) => camp.structures);
    const changed = previous.length !== incoming.length || previous.some((st, i) => {
      const next = incoming[i];
      return st.id !== next.id || st.prefab !== next.prefab || st.x !== next.x || st.z !== next.z || st.rot !== next.rot;
    });
    const flamesChanged = changed || previous.some((st, i) => (st.fuel > 0) !== (incoming[i].fuel > 0));
    if (changed) for (const st of previous) {
      const collider = this.structureColliders.get(st.id);
      if (collider) this.colliders.remove(collider);
      this.structureColliders.delete(st.id);
    }
    this.state.settlements = structuredClone(camps);
    if (changed) for (const st of incoming) this.addStructureCollider(st);
    if (flamesChanged) { this.refreshLitFires(); this.worldVersion++; }
  }

  private nearVillager(tribe: string, member: string): VillagerState | undefined {
    if (this.state.dead) return;
    const npc = this.state.settlements?.find((v) => v.tribe === tribe)?.members.find((m) => m.id === member);
    return npc && Math.hypot(npc.x - this.state.player.x, npc.z - this.state.player.z) <= 4.5 ? npc : undefined;
  }

  talkTo(tribe: string, member: string): boolean {
    if (!this.nearVillager(tribe, member)) return false;
    this.cancelFishing();
    this.bowDraw = -1;
    if (discoverTribe(this.state, tribe)) this.message(`You discovered the ${tribeFor(tribe, this.biome)!.name}. Speak with them to learn how to live off the land.`, 'good');
    this.actionCooldown = 0.4;
    this.emit({ type: 'openDialog', tribe, member });
    return true;
  }

  acceptQuest(tribe: string, member: string): boolean {
    if (!this.nearVillager(tribe, member) || !acceptTribeQuest(this.state, tribe, member)) return false;
    this.emit({ type: 'questChanged' });
    this.message(`Quest accepted: ${tribeDialog(this.state, tribe, member)?.quest?.title}.`, 'good');
    return true;
  }

  turnInQuest(tribe: string, member: string): boolean {
    if (!this.nearVillager(tribe, member)) return false;
    const q = completeQuest(this.state, tribe, member);
    if (!q) { this.message('Bring all the requested supplies and finish the lesson before handing them over.', 'warn'); return false; }
    if (this.authority === 'guest') this.netOut.push({ k: 'questDelivery', tribe, quest: q.id });
    else this.receiveTribeDelivery(tribe, q.id, this.state.player);
    this.emit({ type: 'questChanged' });
    this.message(`Quest complete: ${q.title} · +${q.reputation} ${tribeFor(tribe, this.biome)!.name} reputation.`, 'good');
    return true;
  }

  receiveTribeDelivery(tribe: string, quest: string, from: { x: number; z: number }): void {
    const camp = this.state.settlements?.find((v) => v.tribe === tribe);
    const q = questlineFor(tribe, this.biome)?.quests.find((v) => v.id === quest);
    const giver = q && camp?.members.find((n) => n.id === q.giver);
    if (!camp || !q || !giver || Math.hypot(giver.x - from.x, giver.z - from.z) > 10) return;
    const bin = camp.structures.find((st) => st.store);
    if (bin?.store) for (const r of q.deliveries) addToStore(bin.store, r.item, r.count);
  }

  receiveTribeFuel(tribe: string, fuel: 'stick' | 'log', from: { x: number; z: number }): void {
    const fire = this.state.settlements?.find((v) => v.tribe === tribe)?.structures.find((st) => PREFABS[st.prefab].fire);
    if (!fire || !['stick', 'log'].includes(fuel) || Math.hypot(fire.x - from.x, fire.z - from.z) > 10) return;
    fire.fuel = Math.min(BALANCE.fire.maxFuelHours, fire.fuel + (fuel === 'log' ? BALANCE.fire.logFuelHours : BALANCE.fire.stickFuelHours));
    this.refreshLitFires(); this.worldVersion++;
  }

  private updateVillageLife(dt: number): void {
    if (this.authority === 'guest' || !this.state.settlements?.length) return;
    const visitors = [...(this.state.dead ? [] : [this.state.player]), ...this.remotePlayers.filter((p) => !p.dead)];
    for (const camp of this.state.settlements) {
      updateVillagers(camp, { terrain: this.terrain, gen: this.gen, state: this.state, night: this.night,
        query: (x, z, r, out) => this.queryColliders(x, z, r, out), forageAvailable: (i) => this.forageAvailable(i), visitors,
        work: (v, n) => this.villagerWork(v, n) }, dt);
      const fire = camp.structures.find((st) => st.prefab === 'campfire');
      const store = camp.structures.find((st) => st.store)?.store;
      if (fire && store && fire.fuel < 2) {
        const logs = removeFromStore(store, 'log', 1);
        const sticks = logs ? 0 : removeFromStore(store, 'stick', 1);
        if (logs || sticks) { fire.fuel = Math.min(BALANCE.fire.maxFuelHours, fire.fuel + (logs ? BALANCE.fire.logFuelHours : BALANCE.fire.stickFuelHours)); this.refreshLitFires(); this.worldVersion++; }
      }
    }
  }

  private villagerWork(camp: SettlementState, n: VillagerState): boolean {
    const store = camp.structures.find((st) => st.store)?.store;
    if (!store) return false;
    const target = n.target;
    if (n.task === 'gather' && target?.kind === 'resource') {
      const g = this.gen.resources[target.ref], dyn = this.state.resources[target.ref];
      if (!g || !dyn || dyn.charges <= 0 || !this.forageAvailable(target.ref) || Math.hypot(g.x - n.x, g.z - n.z) > 2) return false;
      if (!addToStore(store, RESOURCES[g.kind].item, 1)) return false;
      dyn.charges--; if (!dyn.charges) dyn.respawnAt = this.state.totalHours + RESOURCES[g.kind].respawnHours;
      this.worldVersion++; return true;
    }
    if (n.task === 'chop' && target?.kind === 'tree') {
      const g = this.gen.trees[target.ref], dyn = this.state.trees[target.ref];
      if (!g || !dyn || dyn.felled || Math.hypot(g.x - n.x, g.z - n.z) > g.trunkR + 2) return false;
      const fall = headingTo(n.x, n.z, g.x, g.z);
      this.setTree(target.ref, { ...dyn, hp: 0, felled: true, fall, logs: 0, cuts: 0 });
      this.emit({ type: 'treeFell', tree: target.ref, dirX: Math.sin(fall), dirZ: Math.cos(fall) });
      addToStore(store, 'log', TREES[g.species].logs); addToStore(store, 'stick', TREES[g.species].sticks);
      return true;
    }
    if (n.task === 'hunt' && target?.kind === 'animal') {
      const animal = this.state.animals.find((a) => a.id === target.ref);
      if (!animal || Math.hypot(animal.x - n.x, animal.z - n.z) > 9 || animalHidden(animal) || animal.y > this.terrain.heightAt(animal.x, animal.z) + 1) return false;
      if (!['rabbit', 'squirrel'].includes(animal.species)) return false;
      this.state.animals.splice(this.state.animals.indexOf(animal), 1);
      for (const drop of SPECIES[animal.species].drops) addToStore(store, drop.item, drop.count);
      this.worldVersion++; return true;
    }
    if (n.task === 'craft') {
      const inv = { slots: store };
      const fire = camp.structures.find((st) => st.prefab === 'campfire');
      if (fire && fire.fuel > 0 && countItem(inv, 'rawMeat') > 0 && roomFor(inv, 'cookedMeat') > 0) {
        removeItem(inv, 'rawMeat', 1); addToStore(store, 'cookedMeat', 1); return true;
      }
      if (countItem(inv, 'fiber') >= 4 && roomFor(inv, 'cordage') > 0) { removeItem(inv, 'fiber', 4); addToStore(store, 'cordage', 1); return true; }
    }
    return false;
  }

  /** One-time density correction, independent of the saved map generation. */
  private seedPnwSquirrels(): void {
    const s = this.state, t = this.terrain, p = s.player;
    const count = this.biomeDef.prey.find((o) => o.species === 'squirrel')!.count;
    const target = t.pnw ? count : count / 4;
    const squirrels = s.animals.filter((a) => a.species === 'squirrel');
    // Migration must not move existing animals or consume the saved gameplay RNG stream.
    const rng = new Rng(s.seed ^ 0x7371726c);
    const trees = this.gen.trees.filter((tr, i) => !s.trees[i].felled && TREES[tr.species].height * tr.scale >= 5
      && t.inPlayBounds(tr.x, tr.z, 10) && t.heightAt(tr.x, tr.z) > 0.2);
    const cells = new Map<string, number>();
    const key = (x: number, z: number) => Math.floor(x / 48) + ',' + Math.floor(z / 48);
    for (const a of squirrels) cells.set(key(a.x, a.z), (cells.get(key(a.x, a.z)) ?? 0) + 1);
    const add = (tr: WorldGen['trees'][number], local: boolean): boolean => {
      const angle = rng.range(0, Math.PI * 2), radius = tr.trunkR + rng.range(1.5, 3.5);
      const x = tr.x + Math.sin(angle) * radius, z = tr.z + Math.cos(angle) * radius;
      const distance = Math.hypot(x - p.x, z - p.z);
      if (distance < 8 || (local ? distance > 20 : distance < 20)
        || !t.inPlayBounds(x, z, 10) || t.slopeAt(x, z) > 0.5 || !isHabitable(t, 'squirrel', x, z)) return false;
      if (squirrels.some((a) => Math.hypot(x - a.x, z - a.z) < 4)) return false;
      const body = circle(x, z, SPECIES.squirrel.radius + 0.1);
      this.colliders.query(x, z, body.r, this.tmpColliders);
      if (this.tmpColliders.some((c) => c.body && overlaps(body, c.body))) return false;
      const a = createAnimal(s.nextId++, 'squirrel', x, z, rng, t);
      s.animals.push(a); squirrels.push(a);
      cells.set(key(x, z), (cells.get(key(x, z)) ?? 0) + 1);
      return true;
    };
    // A small starting encounter exists beside nearby forest trees, outside the squirrel's fear radius.
    const close = trees.filter((tr) => Math.hypot(tr.x - p.x, tr.z - p.z) <= 22);
    let local = squirrels.filter((a) => Math.hypot(a.x - p.x, a.z - p.z) <= 20).length;
    for (let i = 0; i < 240 && close.length && local < 3 && squirrels.length < target; i++) {
      if (add(rng.pick(close), true)) local++;
    }
    // Balance the rest across forest cells rather than clustering uniform random samples in a few regions.
    for (let i = 0; i < target * 40 && trees.length && squirrels.length < target; i++) {
      const a = rng.pick(trees), b = rng.pick(trees);
      add((cells.get(key(a.x, a.z)) ?? 0) <= (cells.get(key(b.x, b.z)) ?? 0) ? a : b, false);
    }
    s.pnwWildlife = 1;
  }

  static newGame(seed: number, biome: BiomeId = DEFAULT_BIOME, pnwGen: PnwGeneration = PNW_GENERATION): Simulation {
    return new Simulation(createNewState(seed, biome, pnwGen));
  }

  // ------------------------------------------------------------------ accessors

  get hour(): number {
    return hourOf(this.state.totalHours);
  }

  get day(): number {
    return dayOf(this.state.totalHours);
  }

  get night(): boolean {
    return isNight(this.hour);
  }

  get season(): Season | null { return this.state.season?.id ?? null; }
  get weather(): Weather | null { return this.state.weather?.id ?? null; }
  get seasonDay(): number { return this.state.season ? seasonDay(this.state.season, this.state.totalHours) : 0; }
  get frozen(): boolean { return this.season === 'winter'; }
  get seasonSleepDue(): boolean {
    return !!this.state.season && this.state.totalHours >= seasonDeadline(this.state.season);
  }

  forageAvailable(index: number): boolean {
    const g = this.gen.resources[index];
    if (g.kind === 'snowClump') return snowScale(this.state.seed, g.spot, this.state.season, this.state.totalHours) > 0;
    return seasonalForage(this.season, this.state.seed, g.spot, g.kind);
  }

  /** Keep seasonal effects local to this world, including loading a winter save while standing on ice. */
  private applySeasonEnvironment(): void {
    if (!this.frozen) return;
    this.state.animals = this.state.animals.filter((a) => a.species !== 'bear');
    this.endFishing('reeled');
    const p = this.state.player;
    if (this.terrain.heightAt(p.x, p.z) < WATER_LEVEL) {
      p.y = Math.max(p.y, WATER_LEVEL);
      p.swimming = p.wading = false;
      p.vy = 0;
      p.grounded = p.y === WATER_LEVEL;
    }
  }

  /** Host state is shared on ticks, dawn messages and late-join snapshots. */
  followSeason(value: SeasonState | undefined): void {
    if (this.biome !== 'pnw') return;
    const next = parseSeason(value, this.state.totalHours);
    const wasWinter = this.frozen;
    const changed = next.id !== this.season || next.startDay !== this.state.season?.startDay;
    if (!changed && this.state.season?.warned) next.warned = true;
    this.state.season = next;
    if (changed) {
      // Guests receive resource deltas before the calendar tick; only the host/solo run replenishes patches.
      if (next.id === 'winter' && !wasWinter && this.authority !== 'guest') {
        this.gen.resources.forEach((r, i) => {
          if (r.kind === 'snowClump') Object.assign(this.state.resources[i], { charges: RESOURCES.snowClump.charges, respawnAt: 0 });
        });
      }
      this.applySeasonEnvironment();
      this.worldVersion++;
    }
  }

  /** Guests receive the host's choice; they never draw weather from their predicted clock. */
  followWeather(value: WeatherState | undefined): void {
    if (this.state.season) this.state.weather = parseWeather(value, this.state.seed, this.state.totalHours, this.state.season);
  }

  private advanceCalendarAtDawn(): void {
    if (this.state.season) this.followSeason(seasonAtDawn(this.state.season, this.state.totalHours));
    this.followWeather(this.state.weather);
  }

  /** The host calls this for an awake player when the season's 2 AM deadline arrives. */
  passOut(): void {
    if (this.state.dead || this.sleepingIn !== null) return;
    this.cancelRepair();
    this.placement = null;
    this.bowDraw = -1;
    this.endFishing('reeled');
    // Keep the same position, including a bench or a lake; seasonal ice may lift feet to its surface.
    delete this.state.player.seat;
    this.state.player.sitting = false;
    this.state.player.vx = this.state.player.vy = this.state.player.vz = 0;
    this.sleepByFire = this.warmingFire() !== null;
    this.sleepingIn = -1;
  }

  /** Move pending events into `out` (cleared first) and reset the queue. */
  takeEvents(out: SimEvent[]): SimEvent[] {
    out.length = 0;
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }

  peekEvents(): readonly SimEvent[] {
    return this.events;
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  private message(text: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
    this.emit({ type: 'message', text, tone });
  }

  // ------------------------------------------------------------------ colliders

  private buildColliders(): void {
    const { gen, state } = this;
    gen.trees.forEach((t, i) => {
      this.treeColliders[i] = this.colliders.add(this.makeTreeCollider(i, state.trees[i].felled));
      this.syncTrunkCollider(i);
      void t;
    });
    gen.rocks.forEach((r, i) => {
      const top = rockTop(r, this.terrain.heightAt(r.x, r.z));
      this.colliders.add(makeCollider('rock', i, circle(r.x, r.z, r.r * 0.85), circle(r.x, r.z, r.r * 0.9), top));
    });
    gen.logs.forEach((l, i) => {
      const top = logTop(l, this.terrain.heightAt(l.x, l.z));
      this.colliders.add(makeCollider('log', i, box(l.x, l.z, l.length / 2, l.r, l.rot), box(l.x, l.z, l.length / 2 + 0.1, l.r + 0.1, l.rot), top));
    });
    gen.cacti.forEach((c, i) => {
      this.colliders.add(makeCollider('cactus', i, circle(c.x, c.z, c.r), circle(c.x, c.z, c.r + 0.5)));
    });
    gen.resources.forEach((r, i) => {
      this.colliders.add(makeCollider('resource', i, null, circle(r.x, r.z, RESOURCES[r.kind].blockRadius)));
    });
    this.terrain.island?.caves.forEach((c, i) => {
      // The rock shell is a ring of posts with a gap for the mouth.
      const n = 22;
      const wall = c.r - 0.3;
      for (let k = 0; k < n; k++) {
        const a = c.facing + (k / n) * Math.PI * 2;
        if (Math.abs(Math.atan2(Math.sin(a - c.facing), Math.cos(a - c.facing))) < CAVE_MOUTH) continue;
        const x = c.x + Math.cos(a) * wall;
        const z = c.z + Math.sin(a) * wall;
        this.colliders.add(makeCollider('cave', i, circle(x, z, 0.78), circle(x, z, 0.9)));
      }
    });
    for (const s of this.structures) this.addStructureCollider(s);
  }

  private makeTreeCollider(i: number, felled: boolean): Collider {
    const t = this.gen.trees[i];
    if (felled) return makeCollider('stump', i, circle(t.x, t.z, t.trunkR * 1.15), circle(t.x, t.z, t.trunkR + 0.2));
    return makeCollider('tree', i, circle(t.x, t.z, t.trunkR), circle(t.x, t.z, t.trunkR + 0.35));
  }

  /** The uncut part of tree `i`'s fallen trunk, or null. */
  trunk(i: number): TrunkSpan | null {
    return trunkSpan(this.gen.trees[i], this.state.trees[i]);
  }

  /** Rebuild the collider for a fallen trunk after it falls or a log is cut off (removed once fully cut). */
  private syncTrunkCollider(i: number): void {
    const old = this.trunkColliders.get(i);
    if (old) {
      this.colliders.remove(old);
      this.trunkColliders.delete(i);
    }
    const span = this.trunk(i);
    if (!span) return;
    const c = makeCollider('trunk', i, trunkBox(span), trunkBox(span, 0.1), trunkTop(span));
    this.trunkColliders.set(i, this.colliders.add(c));
  }

  private addStructureCollider(s: StructureState): void {
    const c = makeCollider('structure', s.id, colliderShape(s.prefab, s.x, s.z, s.rot), footprintShape(s.prefab, s.x, s.z, s.rot));
    this.structureColliders.set(s.id, this.colliders.add(c));
  }

  queryColliders(x: number, z: number, r: number, out: Collider[]): Collider[] {
    return this.colliders.query(x, z, r, out);
  }

  // ------------------------------------------------------------------ main step

  step(dtIn: number, input: SimInput): void {
    const s = this.state;
    if (s.dead && this.authority === 'solo') return;
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    const p = s.player;

    // time
    const prevDay = this.day;
    const prevHours = s.totalHours;
    s.totalHours = advanceHours(s.totalHours, dt, this.timeScale);
    const gameHours = s.totalHours - prevHours;
    if (this.day !== prevDay) {
      if (this.authority !== 'guest') this.advanceCalendarAtDawn();
      this.emit({ type: 'dayStart', day: this.day });
    }
    const night = this.night;
    if (night && !this.wasNight && this.hour > 12) {
      s.stats.events.nightfall = (s.stats.events.nightfall ?? 0) + 1;
      this.emit({ type: 'nightfall', day: this.day });
    }
    this.wasNight = night;
    const world = this.authority !== 'guest';

    const season = s.season;
    if (season && !season.warned && !s.dead && this.sleepingIn === null && s.totalHours >= seasonDeadline(season) - 1) {
      season.warned = true;
      this.message('You are getting tired and need to sleep soon. Find a place to rest before 2 AM; a new season arrives at dawn.', 'warn');
    }
    if (this.authority === 'solo' && !s.dead && this.seasonSleepDue) {
      this.passOut();
      const elapsed = this.skipNight([p]);
      this.wakeUp(elapsed);
      return;
    }

    // Multiplayer only: the world keeps running while this player is dead or asleep.
    if (s.dead || this.sleepingIn !== null) {
      if (!s.dead) {
        const cause = restWhileWaiting(s.needs, gameHours, this.sleepByFire, this.coldLethal);
        if (cause) {
          this.getUp();
          this.die(cause);
        }
      }
      this.updateProjectiles(dt);
      this.updateAnimals(dt);
      this.updateVillageLife(dt);
      if (world) {
        this.updateFires(gameHours);
        this.updateWear(gameHours, false, true, false);
        this.updateRespawns(dt);
        this.checkPopulation();
      }
      s.rng = this.rng.s;
      return;
    }

    // movement
    p.yaw = input.yaw;
    p.pitch = clamp(input.pitch, -1.55, 1.55);
    p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    const moveIn = s.repair ? this.lockedInput(input) : input;
    if (p.seat && (Math.hypot(moveIn.moveX, moveIn.moveZ) > 0.05 || moveIn.jumpPressed)) this.standUp();
    const move = p.seat ? STILL : stepPlayer(p, moveIn, this.moveEnv, dt, { canSprint: s.needs.energy > 0, exhausted: s.needs.exhausted });
    if (move.jumped) {
      spendEnergy(s.needs, BALANCE.needs.energy.jumpCost);
      this.emit({ type: 'jump' });
    }
    if (move.landed > 5) this.emit({ type: 'land', impact: move.landed });
    if (move.splash > 0) this.emit({ type: 'splash', impact: move.splash });
    this.lastLanding = move.landed;
    this.distanceWalked += move.distance;
    this.applyCurrent(dt);
    this.checkSpines(dt);
    this.updateVenom(dt);
    const speed = horizontalSpeed(p);
    this.activity = p.swimming ? 'swim' : speed < 0.5 ? 'idle' : p.sprinting ? 'sprint' : 'walk';
    const targetNoise = this.activity === 'idle' ? 0.5 : this.activity === 'sprint' ? 1.6 : 0.6 + 0.4 * Math.min(1, speed / BALANCE.player.walkSpeed);
    this.noise = damp(this.noise, targetNoise, 4, dt);

    // interaction
    this.hasCameraAim = !!input.resolveAim;
    if (input.resolveAim) {
      this.aimEye.x = p.x;
      this.aimEye.y = p.y + (p.sitting ? BALANCE.player.seatedEyeHeight : BALANCE.player.eyeHeight);
      this.aimEye.z = p.z;
      input.resolveAim(this.aimEye, this.cameraAim);
    }
    this.updateTarget();
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    if (s.repair) {
      this.updateRepair(dt);
    } else if (this.placement) {
      this.updatePlacementPreview();
      if (input.primaryPressed) this.confirmPlacement();
    } else {
      this.handlePrimary(input, dt);
    }
    this.updateFishing(dt);

    this.updateProjectiles(dt);
    this.updateAnimals(dt);
    this.updateVillageLife(dt);
    if (world) this.updateFires(gameHours);
    this.updateWear(gameHours, true, world);
    if (world) this.updateRespawns(dt);

    // needs
    const warm = this.warmthTarget();
    const cause = updateNeeds(s.needs, {
      gameHours,
      realDt: dt,
      activity: this.activity,
      warmthTarget: warm.target,
      warmthRatePerHour: warm.rate,
      sitting: p.sitting,
      coldLethal: this.coldLethal,
      thirstMul: this.biomeDef.thirstMultiplier,
    });
    if (cause) this.die(cause);

    this.progress();
    if (world) this.checkPopulation();
    s.rng = this.rng.s;
  }

  /** Movement input with everything but looking zeroed, for standing at a workbench. */
  private lockedInput(input: SimInput): MoveInput {
    this.locked.yaw = input.yaw;
    return this.locked;
  }

  private checkPopulation(): void {
    const s = this.state;
    if (s.totalHours >= s.spawnCheckAt) {
      s.spawnCheckAt = s.totalHours + 1;
      this.maintainPopulation();
    }
  }

  private progress(): void {
    for (const i of advanceObjectives(this.state)) this.emit({ type: 'objective', index: i });
  }

  private die(cause: DamageSource): void {
    const s = this.state;
    if (s.dead) return;
    s.dead = true;
    s.deathCause = cause;
    s.needs.health = 0;
    this.standUp();
    this.cancelRepair();
    this.placement = null;
    this.bowDraw = -1;
    this.endFishing('reeled');
    this.emit({ type: 'death', cause });
  }

  hurtPlayer(amount: number, source: DamageSource, fromX: number, fromZ: number): void {
    const s = this.state;
    if (s.dead) return;
    const p = s.player;
    if (p.hurtTimer > 0) return;
    p.hurtTimer = BALANCE.combat.playerHurtInvuln;
    this.standUp();
    this.cancelRepair('You were hurt and dropped your work.');
    s.lastDamage = source;
    // small knockback away from the attacker
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.vx += (dx / d) * 4;
    p.vz += (dz / d) * 4;
    const dead = applyDamage(s.needs, amount);
    this.emit({ type: 'hurt', amount, source, fromX, fromZ });
    if (dead) this.die(source);
  }

  /**
   * The spiny plant this player is pressing into, if any: within half a body width of a prickly pear's, cholla's or
   * agave's core or a yucca that's ready to harvest (a picked yucca is a harmless stub, a cut agave is gone), or right
   * up against a saguaro. Picking them from arm's length is safe.
   */
  spinyPlantTouching(): { name: string; damage: number; x: number; z: number } | null {
    const p = this.state.player;
    const S = BALANCE.spines;
    const body = BALANCE.player.radius;
    for (const c of this.colliders.query(p.x, p.z, 1.5, this.spineColliders)) {
      if (c.kind === 'cactus') {
        const k = this.gen.cacti[c.ref];
        if (Math.hypot(p.x - k.x, p.z - k.z) < k.r + body + S.saguaroGap) return { name: 'Saguaro', damage: S.saguaro, x: k.x, z: k.z };
      } else if (c.kind === 'resource') {
        const r = this.gen.resources[c.ref];
        const def = RESOURCES[r.kind];
        if (!def.spines) continue;
        if (this.state.resources[c.ref].charges <= 0 && (def.spines.ripeOnly || !def.persistent)) continue;
        if (Math.hypot(p.x - r.x, p.z - r.z) < def.spines.radius * r.scale + body * S.touch) return { name: def.name, damage: def.spines.damage, x: r.x, z: r.z };
      }
    }
    return null;
  }

  /**
   * Past the island's reef a current sets back toward land: nothing for the first couple of metres over the crest,
   * then it builds until it outpaces your swimming, so the deep water only lets you out a short way.
   */
  private applyCurrent(dt: number): void {
    const isl = this.terrain.island;
    const p = this.state.player;
    if (!isl || (!p.swimming && !p.wading)) return;
    const C = BALANCE.island.current;
    const past = isl.pastReef(p.x, p.z);
    if (past <= C.start) return;
    const k = clamp((past - C.start) / (C.full - C.start), 0, 1);
    const r = Math.hypot(p.x, p.z) || 1;
    p.x -= (p.x / r) * C.speed * k * dt;
    p.z -= (p.z / r) * C.speed * k * dt;
    this.emit({ type: 'current', strength: k });
    if (!this.warnedCurrent) {
      this.warnedCurrent = true;
      this.message('A strong current pushes you back toward the reef. The water out here is deep, and tiger sharks hunt it.', 'warn');
    }
  }

  /** Metres past the reef crest the player is (negative inside the reef or off the island map). */
  get pastReef(): number {
    const isl = this.terrain.island;
    return isl ? isl.pastReef(this.state.player.x, this.state.player.z) : -Infinity;
  }

  /** A fer-de-lance bite: the venom keeps taking health for a while; another bite adds to the time. */
  envenom(perSecond: number, seconds: number, maxSeconds: number): void {
    const n = this.state.needs;
    const first = !n.venom;
    n.venom = { perSecond: Math.max(perSecond, n.venom?.perSecond ?? 0), seconds: Math.min(maxSeconds, (n.venom?.seconds ?? 0) + seconds) };
    if (first) this.message('Envenomed! A fer-de-lance bite keeps hurting for a while. Get away from the snake and eat to keep your health up.', 'warn');
  }

  private updateVenom(dt: number): void {
    const s = this.state;
    const v = s.needs.venom;
    if (!v || s.dead) return;
    const spent = Math.min(dt, v.seconds);
    v.seconds -= dt;
    if (v.seconds <= 0) delete s.needs.venom;
    s.lastDamage = 'viper';
    if (applyDamage(s.needs, v.perSecond * spent)) this.die('viper');
  }

  private checkSpines(dt: number): void {
    this.spineCooldown = Math.max(0, this.spineCooldown - dt);
    if (this.spineCooldown > 0 || this.state.player.swimming) return;
    const hit = this.spinyPlantTouching();
    if (!hit) return;
    this.spineCooldown = BALANCE.spines.cooldown;
    const s = this.state;
    s.stats.events.pricked = (s.stats.events.pricked ?? 0) + 1;
    this.hurtPlayer(hit.damage, 'spines', hit.x, hit.z);
    if (this.prickedBy.has(hit.name)) return;
    this.prickedBy.add(hit.name);
    this.emit({ type: 'message', text: `${hit.name} spines! Pick it from arm's length and don't walk into it.`, tone: 'warn' });
  }

  // ------------------------------------------------------------------ warmth & fire helpers

  private refreshLitFires(): void {
    this.litFires.length = 0;
    for (const st of this.structures) if (PREFABS[st.prefab].fire && st.fuel > 0) this.litFires.push({ x: st.x, z: st.z });
  }

  nearestStructure(prefabFilter: (id: PrefabId) => boolean, radius: number, litOnly = false, playerOwned = false, usableOnly = false): StructureState | null {
    const p = this.state.player;
    let best: StructureState | null = null;
    let bestD = radius;
    for (const st of playerOwned ? this.state.structures : this.structures) {
      if (!prefabFilter(st.prefab)) continue;
      if (usableOnly && !canUseTribeStructure(this.state, st)) continue;
      if (litOnly && st.fuel <= 0) continue;
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = st;
      }
    }
    return best;
  }

  isNearLitFire(radius = COOK_RADIUS): boolean {
    return this.nearestStructure((id) => !!PREFABS[id].fire, radius, true) !== null;
  }

  /** Cooking respects camp permissions; passive warmth still comes from any lit fire. */
  isNearCookingFire(): boolean {
    return this.nearestStructure((id) => !!PREFABS[id].fire, COOK_RADIUS, true, false, true) !== null;
  }

  /** How this map's climate changes a night's sleep (the island's thirst and warm nights). */
  private get sleepClimate(): SleepClimate {
    return { thirstMul: this.biomeDef.thirstMultiplier, coldWarmthCost: this.season ? SEASON_SLEEP_COLD[this.season] : this.biomeDef.sleepWarmthCost };
  }

  /** Cold can kill only after the first `coldGraceNights` nights (each night belongs to the day it starts on). */
  get coldLethal(): boolean {
    return this.day > BALANCE.needs.coldGraceNights;
  }

  /** A burning campfire close enough to feel its warmth. */
  private warmingFire(): StructureState | null {
    return this.nearestStructure((id) => !!PREFABS[id].fire, BALANCE.needs.fireWarmRadius, true);
  }

  warmthTarget(): { target: number; rate: number } {
    const w = BALANCE.needs.warmth;
    const N = BALANCE.needs;
    const bw = this.season ? SEASON_WARMTH[this.season] : this.biomeDef.warmth;
    let target = ambientWarmth(this.hour, bw);
    let rate: number = target < this.state.needs.warmth ? bw.coolRate : bw.rate;
    const p = this.state.player;
    const fire = this.warmingFire();
    if (fire) {
      const d = Math.hypot(fire.x - p.x, fire.z - p.z);
      const k = 1 - clamp((d - 1.5) / (N.fireWarmRadius - 1.5), 0, 1);
      target = Math.max(target, lerp(target, w.fire, k));
      rate = N.warmthFireRatePerHour;
    }
    const shelter = this.nearestStructure((id) => !!PREFABS[id].shelter, N.shelterWarmRadius);
    if (shelter) target += PREFABS[shelter.prefab].shelter!.warmthBonus;
    if (this.state.activeTool === 'torch') target += torchWarmth(this.state);
    if (p.wading) {
      target -= w.wadingPenalty;
      rate *= 2;
    }
    // Within a burning campfire's range the cold never takes warmth away.
    if (fire) target = Math.max(target, this.state.needs.warmth);
    return { target: clamp(target, 0, 100), rate };
  }

  // ------------------------------------------------------------------ targeting

  private aimDirection(): { x: number; y: number; z: number } {
    const p = this.state.player;
    return this.hasCameraAim ? this.cameraAim : lookDir(p.yaw, p.pitch, this.look);
  }

  private updateTarget(): void {
    const s = this.state;
    const p = s.player;
    const ex = p.x;
    const ey = p.y + (p.sitting ? BALANCE.player.seatedEyeHeight : BALANCE.player.eyeHeight);
    const ez = p.z;
    const d = this.aimDirection();
    const reach = Math.max(BALANCE.player.reach, this.toolReach());
    let best: Target | null = null;
    let bestT = reach;

    this.colliders.query(ex, ez, reach + 1.5, this.tmpColliders);
    for (const c of this.tmpColliders) {
      if (c.kind === 'tree') {
        const t = this.gen.trees[c.ref];
        const gy = this.terrain.heightAt(t.x, t.z);
        const hitT = rayCylinder(ex, ey, ez, d.x, d.y, d.z, t.x, t.z, t.trunkR + 0.18, gy - 0.2, gy + 7);
        if (hitT >= 0 && hitT < bestT) {
          bestT = hitT;
          best = { kind: 'tree', index: c.ref, dist: hitT };
        }
      } else if (c.kind === 'trunk') {
        const span = this.trunk(c.ref);
        if (!span) continue;
        const n = Math.max(1, Math.ceil(span.len / Math.max(0.3, span.r * 1.5)));
        for (let k = 0; k <= n; k++) {
          const f = k / n;
          const x = lerp(span.x0, span.x1, f);
          const z = lerp(span.z0, span.z1, f);
          const y = this.terrain.heightAt(x, z) + span.r * TRUNK_AXIS_LIFT;
          const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, x, y, z, span.r + 0.2);
          if (hitT >= 0 && hitT < bestT) {
            bestT = hitT;
            best = { kind: 'tree', index: c.ref, dist: hitT };
          }
        }
      } else if (c.kind === 'resource') {
        if (!this.resourcePresent(c.ref)) continue;
        const r = this.gen.resources[c.ref];
        const def = RESOURCES[r.kind];
        const gy = r.y ?? this.terrain.heightAt(r.x, r.z);
        const scale = r.snow ? snowAmount(r, s, c.ref) : r.scale;
        const radius = r.snow ? Math.max(r.snow.ax, r.snow.az, def.hitRadius) : def.hitRadius;
        const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, r.x, gy + def.hitHeight * scale, r.z, radius * scale);
        if (hitT >= 0 && hitT < bestT) {
          bestT = hitT;
          best = { kind: 'resource', index: c.ref, dist: hitT };
        }
      } else if (c.kind === 'structure') {
        const st = this.structures.find((x) => x.id === c.ref);
        if (!st || privateTribeStructure(s, st)) continue;
        const def = PREFABS[st.prefab];
        const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, st.x, st.y + def.interactHeight, st.z, def.interactRadius);
        if (hitT >= 0 && hitT < bestT) {
          bestT = hitT;
          best = { kind: 'structure', id: st.id, dist: hitT };
        }
      }
    }
    for (const dr of s.drops) {
      const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, dr.x, dr.y + 0.15, dr.z, 0.45);
      if (hitT >= 0 && hitT < bestT) {
        bestT = hitT;
        best = { kind: 'drop', id: dr.id, dist: hitT };
      }
    }
    for (const cc of s.carcasses) {
      const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, cc.x, cc.y + 0.3, cc.z, CARCASS_HIT_RADIUS[cc.species] ?? 0.6);
      if (hitT >= 0 && hitT < bestT) {
        bestT = hitT;
        best = { kind: 'carcass', id: cc.id, dist: hitT };
      }
    }
    for (const camp of s.settlements ?? []) {
      const tribe = tribeFor(camp.tribe, this.biome);
      for (const n of camp.members) {
        const young = tribe?.members.find((m) => m.id === n.id)?.role === 'young';
        const hitT = rayCylinder(ex, ey, ez, d.x, d.y, d.z, n.x, n.z, 0.48, n.y, n.y + (young ? 1.48 : 2.1));
        if (hitT >= 0 && hitT < bestT) { bestT = hitT; best = { kind: 'villager', tribe: camp.tribe, member: n.id, dist: hitT }; }
      }
    }
    for (const a of s.animals) {
      if (animalHidden(a)) continue;
      if (this.frozen && a.species === 'fish') continue;
      if (Math.abs(a.x - ex) > reach + 2 || Math.abs(a.z - ez) > reach + 2) continue;
      const def = SPECIES[a.species];
      const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, a.x, a.y + def.hitHeight, a.z, def.hitRadius);
      if (hitT >= 0 && hitT < bestT) {
        bestT = hitT;
        best = { kind: 'animal', id: a.id, dist: hitT };
      }
    }
    const groundT = this.terrain.raycast(ex, ey, ez, d.x, d.y, d.z, BALANCE.player.reach + 0.4, this.hit);
    if (groundT >= 0) {
      if (this.hit.water && groundT < bestT && groundT <= BALANCE.player.reach + 0.4) {
        best = { kind: 'water', dist: groundT, x: this.hit.x, z: this.hit.z };
      } else if (!this.hit.water && groundT < bestT - 0.25 && best && best.kind !== 'animal') {
        best = null;
      }
    }
    this.target = best;
  }

  private toolReach(): number {
    const c = BALANCE.combat;
    switch (this.state.activeTool) {
      case 'spear':
        return c.spear.reach;
      default:
        return BALANCE.player.reach;
    }
  }

  describeTarget(): TargetInfo | null {
    const t = this.target;
    const s = this.state;
    if (!t) return null;
    switch (t.kind) {
      case 'villager': {
        const tribe = tribeFor(t.tribe, this.biome), person = tribe?.members.find((m) => m.id === t.member);
        return person ? { name: `${person.name} · ${tribe!.name} ${person.title}`, action: 'Talk & learn', enabled: true } : null;
      }
      case 'tree': {
        const g = this.gen.trees[t.index];
        const def = TREES[g.species];
        const dyn = s.trees[t.index];
        if (dyn.felled) {
          const name = `Fallen ${def.name}`;
          const lock = this.skillLock('gathering', TREE_LEVELS[g.species].fell);
          if (s.activeTool === 'axe' && lock) return { name, action: lock, enabled: false };
          if (s.activeTool === 'axe') return { name, action: `Chop up (${dyn.logs} ${dyn.logs === 1 ? 'log' : 'logs'} left)`, enabled: true };
          return { name, action: s.tools.includes('axe') ? 'Equip axe [2] to chop up' : 'Needs an axe', enabled: false };
        }
        if (s.activeTool === 'axe') {
          const lock = this.skillLock('gathering', TREE_LEVELS[g.species].fell);
          return { name: def.name, action: lock ?? 'Chop down', enabled: !lock };
        }
        if (def.crown) {
          const lock = this.skillLock('gathering', TREE_LEVELS[g.species].harvest);
          if (lock) return { name: def.name, action: lock, enabled: false };
          if (dyn.bark <= 0) return { name: def.name, action: def.peelRegrowing ?? 'Nothing up there', enabled: false };
          const n = `${dyn.bark} coconut${dyn.bark === 1 ? '' : 's'} up top`;
          if (s.activeTool === 'bow') return { name: def.name, action: `${n}: aim at the crown and shoot`, enabled: true };
          return { name: def.name, action: s.tools.includes('bow') ? `${n}: equip the bow [${TOOLS.bow.slot}] to shoot them down` : `${n}: too high to reach, knock them down with a bow`, enabled: false };
        }
        if (def.bark > 0 && s.activeTool === 'hands') {
          const lock = this.skillLock('gathering', TREE_LEVELS[g.species].harvest);
          if (lock) return { name: def.name, action: lock, enabled: false };
          return dyn.bark > 0
            ? { name: def.name, action: def.peelVerb ?? 'Peel bark', enabled: true }
            : { name: def.name, action: def.peelRegrowing ?? 'Bark regrowing', enabled: false };
        }
        return { name: def.name, action: s.tools.includes('axe') ? 'Equip axe [2] to chop' : 'Needs an axe', enabled: false };
      }
      case 'resource': {
        const g = this.gen.resources[t.index];
        const def = RESOURCES[g.kind];
        const dyn = s.resources[t.index];
        if (g.snow && (!this.forageAvailable(t.index) || snowCovered(g, s))) return { name: def.name, action: 'Snow has melted', enabled: false };
        if (dyn.charges <= 0) return { name: def.name, action: 'Regrowing', enabled: false };
        const lock = this.skillLock('gathering', RESOURCE_LEVELS[g.kind]);
        return { name: def.name, action: lock ?? def.verb, enabled: !lock };
      }
      case 'drop': {
        const dr = s.drops.find((d) => d.id === t.id);
        return dr ? { name: `${dr.count} ${itemName(dr.item, dr.count)}`, action: 'Pick up', enabled: true } : null;
      }
      case 'carcass': {
        const c = s.carcasses.find((d) => d.id === t.id);
        if (!c) return null;
        const name = `${speciesName(c.species, this.biome)}${c.skinned ? ' · skinned' : ''}`;
        const step = carcassStep(c);
        const lock = step === 'skin' ? this.skillLock('skinning', ANIMAL_LEVELS[c.species].skin) : this.skillLock('hunting', ANIMAL_LEVELS[c.species].hunt);
        if (lock) return { name, action: lock, enabled: false };
        if (s.activeTool === 'knife') return { name, action: step === 'skin' ? 'Skin' : 'Butcher', enabled: true };
        return { name, action: s.tools.includes('knife') ? `Equip knife [${TOOLS.knife.slot}] to ${step}` : 'Needs a knife', enabled: false };
      }
      case 'structure': {
        const st = this.structures.find((d) => d.id === t.id);
        if (!st || privateTribeStructure(s, st)) return null;
        const def = PREFABS[st.prefab];
        if (!canUseTribeStructure(s, st)) return { name: def.name, action: tribeStationRequirementText(s, st), enabled: false };
        if (def.fire) return st.fuel > 0 ? { name: 'Campfire', action: 'Cook & add fuel', enabled: true } : { name: 'Campfire (out)', action: 'Add fuel to relight', enabled: true };
        const name = st.wear ? `${def.name} · ${conditionText(st.wear)}` : def.name;
        if (def.shelter) return { name, action: canSleepAt(this.hour) ? 'Sleep or upgrade' : 'Upgrade (sleep after 7 PM)', enabled: true };
        if (def.seat) return { name, action: s.player.seat?.id === st.id ? 'Stand up' : 'Sit and rest', enabled: true };
        if (def.workbench) return { name, action: s.repair ? 'Repairing…' : 'Repair tools', enabled: !s.repair };
        if (def.storage) return { name: `${def.name} · ${usedSlots({ slots: st.store ?? [] })}/${def.storage.slots}`, action: 'Open storage', enabled: true };
        return { name: def.name, action: '', enabled: false };
      }
      case 'animal': {
        const a = s.animals.find((d) => d.id === t.id);
        if (!a) return null;
        const name = speciesName(a.species, this.biome);
        if (s.activeTool === 'rod') return { name, action: '', enabled: false };
        const lock = this.skillLock('hunting', ANIMAL_LEVELS[a.species].hunt);
        if (lock) {
          const defend = this.canDefend(a.species);
          const reward = SPECIES[a.species].drops.length ? 'harvesting' : 'Hunting XP';
          return { name, action: defend ? `Defend · ${skillRequirementText('hunting', ANIMAL_LEVELS[a.species].hunt)} for ${reward}` : lock, enabled: defend };
        }
        const armed = s.activeTool !== 'hands' && s.activeTool !== 'bow';
        return { name, action: armed ? 'Attack' : s.activeTool === 'bow' ? 'Shoot' : 'Punch', enabled: true };
      }
      case 'water': {
        if (this.frozen) return { name: 'Frozen Lake', action: s.activeTool === 'rod' ? 'The lake is frozen over' : 'Water is sealed beneath the ice', enabled: false };
        const lake = this.terrain.lakeAt(t.x, t.z);
        const name = waterName(lake, this.knowsAlkali, this.terrain, t.x, t.z);
        if (lake?.kind === 'sea') {
          if (s.activeTool === 'rod') return { name, action: 'Hold to wind up a cast', enabled: true };
          return { name, action: 'Salt water: too salty to drink', enabled: false };
        }
        if (lake && !isDrinkable(lake)) {
          if (s.activeTool === 'rod') return { name, action: 'Nothing lives in it', enabled: false };
          return this.knowsAlkali ? { name, action: 'Too salty to drink', enabled: false } : { name, action: 'Taste the water', enabled: true };
        }
        if (s.activeTool === 'rod') return { name, action: 'Hold to wind up a cast', enabled: true };
        if (this.canteenFillAmount() > 0) return { name, action: 'Fill canteen', enabled: true };
        return { name, action: 'Drink', enabled: s.needs.thirst < 99.5 };
      }
    }
  }

  /** A skill lock is checked before any item, energy, wear or XP mutation. */
  private skillLock(skill: SkillId, level: number): string | null {
    return meetsSkill(this.state, skill, level) ? null : `Requires ${skillRequirementText(skill, level)}.`;
  }

  private denySkill(skill: SkillId, level: number): boolean {
    const reason = this.skillLock(skill, level);
    if (!reason) return false;
    this.actionCooldown = BALANCE.gather.cooldown;
    this.message(reason, 'warn');
    return true;
  }

  /** One charge is one attempt, including misses. Limited charges prevent retrying until every find succeeds. */
  private gatherAttempt(level: number): boolean {
    spendEnergy(this.state.needs, BALANCE.needs.energy.gatherCost);
    this.emit({ type: 'swing', tool: 'hands', hit: true });
    const success = this.roll(gatherSuccessChance(this.state.skills.gathering));
    this.gainXp('gathering', practiceXp(success ? BALANCE.skills.xp.gather : BALANCE.skills.xp.gatherFail, level));
    if (!success) this.message('Nothing usable found.');
    return success;
  }

  private canHunt(species: SpeciesId): boolean {
    return meetsSkill(this.state, 'hunting', ANIMAL_LEVELS[species].hunt);
  }

  /** Dangerous wildlife can always be fought off; its harvest and full XP still require training. */
  private canDefend(species: SpeciesId): boolean {
    const def = SPECIES[species];
    return def.kind !== 'prey' || !!def.strike || !!def.territory || !!def.drift;
  }

  // ------------------------------------------------------------------ actions

  private handlePrimary(input: SimInput, dt: number): void {
    const s = this.state;
    const tool = s.activeTool;
    const t = this.target;
    if (t?.kind === 'villager') {
      if (input.primaryPressed && this.actionCooldown <= 0) this.perform(t);
      return;
    }
    if (tool === 'bow') {
      const interactable = t && t.kind !== 'animal' && t.kind !== 'tree';
      if (input.primaryPressed && interactable) {
        this.perform(t);
        return;
      }
      if (input.primaryPressed && this.bowDraw < 0 && this.actionCooldown <= 0) {
        if (countItem(s.inventory, 'arrow') > 0) this.bowDraw = 0;
        else this.message('No arrows. Craft some from sticks, stone and fiber.', 'warn');
      } else if (input.primary && this.bowDraw >= 0) {
        this.bowDraw += dt;
      }
      if ((input.primaryReleased || !input.primary) && this.bowDraw >= 0) {
        if (this.bowDraw >= BALANCE.combat.bow.minDraw) this.fireArrow(clamp(this.bowDraw / BALANCE.combat.bow.fullDraw, 0, 1));
        this.bowDraw = -1;
      }
      return;
    }
    if (tool === 'rod') {
      this.handleRod(input, dt, t);
      return;
    }
    if (!input.primary || this.actionCooldown > 0) return;
    if (!t) {
      if (input.primaryPressed) {
        if (tool !== 'hands') spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
        this.emit({ type: 'swing', tool, hit: false });
        this.actionCooldown = this.toolCooldown();
      }
      return;
    }
    const repeatable = t.kind === 'tree' || t.kind === 'resource' || t.kind === 'animal' || t.kind === 'water';
    if (!repeatable && !input.primaryPressed) return;
    this.perform(t);
  }

  private toolCooldown(): number {
    const c = BALANCE.combat;
    switch (this.state.activeTool) {
      case 'axe':
        return c.axe.cooldown;
      case 'spear':
        return c.spear.cooldown;
      case 'torch':
        return c.torch.cooldown;
      case 'knife':
        return c.knife.cooldown;
      default:
        return c.hand.cooldown;
    }
  }

  // ------------------------------------------------------------------ fishing

  /** Hold to wind up, release to cast; with a line out, a click strikes a biting fish or reels in. */
  private handleRod(input: SimInput, dt: number, t: Target | null): void {
    if (this.frozen) {
      if (input.primaryPressed) this.message('The lakes are frozen over. Fishing returns when the ice thaws.', 'warn');
      return;
    }
    const s = this.state;
    const F = BALANCE.fishing;
    const f = this.fishing;
    if (!f) {
      if (!input.primaryPressed || this.actionCooldown > 0) return;
      if (t && t.kind !== 'animal' && t.kind !== 'tree' && t.kind !== 'water') {
        this.perform(t);
        return;
      }
      if (s.player.swimming) {
        this.actionCooldown = 0.6;
        this.message('Find your footing before you cast.', 'warn');
        return;
      }
      const p = s.player;
      this.fishing = { phase: 'charging', t: 0, power: 0, fromX: p.x, fromZ: p.z, x: p.x, z: p.z, biteAt: 0 };
      return;
    }
    if (f.phase === 'charging') {
      if (input.primary) {
        f.t += dt;
        f.power = clamp(f.t / F.fullCharge, 0, 1);
      }
      if (input.primaryReleased || !input.primary) {
        if (f.t >= F.minCharge) this.castLine(f);
        else this.fishing = null;
      }
      return;
    }
    if (!input.primaryPressed) return;
    if (f.phase === 'bite') this.strike(f);
    else this.endFishing('reeled');
  }

  private castLine(f: FishingLine): void {
    const s = this.state;
    const p = s.player;
    const F = BALANCE.fishing;
    const d = this.hasCameraAim ? this.cameraAim : lookDir(p.yaw, 0, this.look);
    const len = Math.hypot(d.x, d.z) || 1;
    const dist = lerp(F.minCast, F.maxCast, f.power);
    f.phase = 'flying';
    f.t = 0;
    f.fromX = p.x;
    f.fromZ = p.z;
    f.x = p.x + (d.x / len) * dist;
    f.z = p.z + (d.z / len) * dist;
    this.actionCooldown = 0.3;
    spendEnergy(s.needs, BALANCE.needs.energy.castCost);
    this.emit({ type: 'swing', tool: 'rod', hit: true });
    this.emit({ type: 'cast', power: f.power });
    this.wearTool('rod', 1);
  }

  /** Lakes and ponds deep enough under the lure to hold fish (desert rock pools and alkali water have none). */
  fishableAt(x: number, z: number): boolean {
    if (this.frozen) return false;
    if (!this.terrain.inPlayBounds(x, z) || this.terrain.heightAt(x, z) >= WATER_LEVEL - BALANCE.fishing.minDepth) return false;
    return fishingPoolAt(this.terrain, x, z).length > 0;
  }

  private unlockedFishingPool(x: number, z: number): readonly FishingCatch[] {
    return fishingPoolAt(this.terrain, x, z).filter((fish) => meetsSkill(this.state, 'fishing', FISH_LEVELS[fish]));
  }

  private updateFishing(dt: number): void {
    const f = this.fishing;
    if (!f || f.phase === 'charging') return;
    const s = this.state;
    const p = s.player;
    const F = BALANCE.fishing;
    if (s.activeTool !== 'rod' || p.swimming || Math.hypot(f.x - p.x, f.z - p.z) > F.maxCast + F.leashSlack) {
      this.endFishing('reeled');
      return;
    }
    f.t += dt;
    if (f.phase === 'flying') {
      if (f.t < F.flightSeconds) return;
      const water = this.fishableAt(f.x, f.z);
      this.emit({ type: 'lureLanded', x: f.x, z: f.z, water });
      if (!water) {
        const wet = this.terrain.heightAt(f.x, f.z) < WATER_LEVEL;
        const text = !wet ? 'The lure landed on dry ground. Cast out over open water.'
          : this.biome === 'pnw' ? 'This water is too small or shallow to fish. Try a larger lake or deeper water.'
          : 'No fish live in this pool. Trout only live in the spring.';
        this.message(text, 'warn');
        this.fishing = null;
        return;
      }
      f.phase = 'waiting';
      f.t = 0;
      f.biteAt = this.rng.range(F.biteWait[0], F.biteWait[1]);
    } else if (f.phase === 'waiting') {
      if (f.t < f.biteAt) return;
      f.phase = 'bite';
      f.t = 0;
      f.catch = chooseFishingCatch(this.unlockedFishingPool(f.x, f.z), this.rng) ?? undefined;
      this.emit({ type: 'fishBite', x: f.x, z: f.z });
    } else if (f.t > F.biteWindow) {
      this.gainXp('fishing', BALANCE.skills.xp.missedBite);
      this.message('It got away. You gained a little Fishing XP; click as soon as the float dips.');
      this.endFishing('escaped');
    }
  }

  /** Strike a biting fish: the fishing skill decides whether it's landed or slips the hook. */
  private strike(f: FishingLine): void {
    const pool = this.unlockedFishingPool(f.x, f.z);
    if (!this.fishableAt(f.x, f.z) || (f.catch && !pool.includes(f.catch))) {
      this.endFishing('reeled');
      return;
    }
    const caught = f.catch ?? chooseFishingCatch(pool, this.rng);
    if (!caught) { this.endFishing('reeled'); return; }
    const fish = FISHING_CATCHES[caught];
    const s = this.state;
    const xp = BALANCE.skills.xp;
    spendEnergy(s.needs, BALANCE.needs.energy.hookCost);
    this.emit({ type: 'swing', tool: 'rod', hit: true });
    if (this.rng.chance(landChance(s))) {
      s.stats.events.fishCaught = (s.stats.events.fishCaught ?? 0) + 1;
      const added = this.give(fish.item, 1, f.x, WATER_LEVEL + 0.2, f.z, 'fishing');
      if (added === 0) this.dropAt(fish.item, 1, s.player.x, s.player.z);
      this.message(added ? `You landed a ${fish.word}!` : `You landed a ${fish.word}! No room in your pack, so it is at your feet.`, 'good');
      this.gainXp('fishing', practiceXp(xp.catch, FISH_LEVELS[caught]));
      this.endFishing('caught');
    } else {
      this.message(`The ${fish.word} slipped the hook. Your fishing is improving.`);
      this.gainXp('fishing', practiceXp(xp.slip, FISH_LEVELS[caught]));
      this.endFishing('slipped');
    }
  }

  private endFishing(result: Extract<SimEvent, { type: 'fishDone' }>['result']): void {
    const f = this.fishing;
    if (!f) return;
    this.fishing = null;
    if (f.phase !== 'charging') this.emit({ type: 'fishDone', result, x: f.x, z: f.z });
  }

  /** Reel the line in (menus, pausing, switching away). */
  cancelFishing(): void {
    this.endFishing('reeled');
  }

  /** HUD prompt while a cast is in progress. */
  describeFishing(): TargetInfo | null {
    const f = this.fishing;
    if (!f) return null;
    switch (f.phase) {
      case 'charging':
        return { name: 'Fishing Pole', action: 'Release to cast', enabled: true };
      case 'flying':
      case 'waiting':
        return { name: 'Waiting for a bite', action: 'Click to reel in', enabled: true };
      case 'bite':
        return { name: 'A fish is biting!', action: 'Click now to strike', enabled: true };
    }
  }

  /** Execute the primary action on a target (exposed for tests and UI). */
  perform(t: Target): void {
    switch (t.kind) {
      case 'villager':
        this.talkTo(t.tribe, t.member);
        return;
      case 'tree':
        return this.actOnTree(t.index);
      case 'resource':
        return this.gatherResource(t.index);
      case 'drop':
        return this.pickUpDrop(t.id);
      case 'carcass':
        return this.cutCarcass(t.id);
      case 'structure':
        return this.useStructure(t.id);
      case 'animal':
        return this.meleeAnimal(t.id, t.dist);
      case 'water':
        return this.useWater();
    }
  }

  /** Adds items with stats + feedback. Returns the amount that fit. */
  give(item: ItemId, count: number, x: number, y: number, z: number, source: Extract<SimEvent, { type: 'gathered' }>['source']): number {
    const s = this.state;
    const water = inCanteen(item);
    const added = water ? fillCanteen(s, item, count) : addItem(s.inventory, item, count);
    if (added > 0) {
      s.stats.gathered[item] = (s.stats.gathered[item] ?? 0) + added;
      this.emit({ type: 'gathered', item, count: added, x, y, z, source });
    }
    if (added < count && water) {
      this.message(canteenCapacity(s) === 0 ? 'You need a canteen to carry water.' : 'Your canteen is full.', 'warn');
    } else if (added < count) {
      s.stats.events.packFull = (s.stats.events.packFull ?? 0) + 1;
      this.emit({ type: 'packFull', item });
    }
    this.progress();
    return added;
  }

  private dropAt(item: ItemId, count: number, x: number, z: number): void {
    if (count <= 0) return;
    const y = Math.max(this.terrain.heightAt(x, z), WATER_LEVEL);
    this.state.drops.push({ id: this.state.nextId++, item, count, x, y, z });
    this.worldVersion++;
  }

  private actOnTree(index: number): void {
    const s = this.state;
    const g = this.gen.trees[index];
    const def = TREES[g.species];
    const dyn = s.trees[index];
    if (dyn.felled) {
      if (dyn.logs > 0) this.chopTrunk(index);
      return;
    }
    const gy = this.terrain.heightAt(g.x, g.z);
    if (s.activeTool === 'axe') {
      if (this.denySkill('gathering', TREE_LEVELS[g.species].fell)) return;
      this.actionCooldown = BALANCE.combat.axe.cooldown;
      spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
      dyn.hp = Math.max(0, round3(dyn.hp - chopPower(s)));
      this.emit({ type: 'swing', tool: 'axe', hit: true });
      this.emit({ type: 'chop', tree: index, x: g.x, y: gy + 1.2, z: g.z });
      if (dyn.hp <= 0) this.fellTree(index);
      this.wearTool('axe', 1);
      return;
    }
    if (def.crown) {
      this.actionCooldown = 0.6;
      this.emit({ type: 'needTool', message: dyn.bark > 0 ? 'The coconuts are far out of reach. Shoot them down with a bow, or look for one fallen under a palm.' : 'This palm has no coconuts left. New ones will ripen.' });
      return;
    }
    if (def.bark > 0 && s.activeTool === 'hands') {
      this.actionCooldown = BALANCE.gather.cooldown;
      if (dyn.bark <= 0) return;
      const level = TREE_LEVELS[g.species].harvest;
      if (this.denySkill('gathering', level)) return;
      const item = def.peelItem ?? 'bark';
      if (roomFor(s.inventory, item) <= 0) { this.message('Your pack is full.', 'warn'); return; }
      dyn.bark -= 1;
      if (dyn.bark <= 0) dyn.barkAt = s.totalHours + def.barkRespawnHours;
      this.worldVersion++;
      if (!this.gatherAttempt(level)) return;
      const added = this.give(item, 1, g.x, gy + 1.1, g.z, 'bark');
      if (added > 0) {
        const entry = forageForTree(g.species);
        if (entry) this.discoverForage(entry);
      }
      return;
    }
    this.actionCooldown = 0.6;
    this.emit({ type: 'needTool', message: s.tools.includes('axe') ? 'Equip your Stone Axe [2] to chop trees.' : 'You need an axe to chop trees.' });
  }

  /** The tree comes down as a whole trunk; its wood comes from chopping the trunk up afterwards. */
  private fellTree(index: number): void {
    const s = this.state;
    const g = this.gen.trees[index];
    const def = TREES[g.species];
    const dyn = s.trees[index];
    dyn.felled = true;
    dyn.hp = 0;
    this.colliders.remove(this.treeColliders[index]);
    this.treeColliders[index] = this.colliders.add(this.makeTreeCollider(index, true));
    const p = s.player;
    const dx = g.x - p.x;
    const dz = g.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dyn.fall = Math.atan2(dx / d, dz / d);
    dyn.logs = def.logs;
    dyn.cuts = 0;
    this.syncTrunkCollider(index);
    this.emit({ type: 'treeFell', tree: index, dirX: dx / d, dirZ: dz / d });
    this.gainXp('gathering', practiceXp(BALANCE.skills.xp.fell, TREE_LEVELS[g.species].fell));
    this.worldVersion++;
  }

  /**
   * One axe swing on a fallen trunk adds the axe's chop power in cuts. Every `cutsPerLog` cuts frees a log (a strong
   * swing can free more than one); the last log also yields the branches as sticks.
   */
  private chopTrunk(index: number): void {
    const s = this.state;
    const g = this.gen.trees[index];
    const def = TREES[g.species];
    const dyn = s.trees[index];
    const span = this.trunk(index);
    if (!span) return;
    if (s.activeTool !== 'axe') {
      this.actionCooldown = 0.6;
      this.emit({ type: 'needTool', message: s.tools.includes('axe') ? 'Equip your Stone Axe [2] to cut up the trunk.' : 'You need an axe to cut up the trunk.' });
      return;
    }
    if (this.denySkill('gathering', TREE_LEVELS[g.species].fell)) return;
    this.actionCooldown = BALANCE.combat.axe.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
    const p = s.player;
    const along = clamp((p.x - span.x0) * span.dx + (p.z - span.z0) * span.dz, 0, span.len);
    const hx = span.x0 + span.dx * along;
    const hz = span.z0 + span.dz * along;
    const hy = this.terrain.heightAt(hx, hz) + span.r * 1.4;
    this.emit({ type: 'swing', tool: 'axe', hit: true });
    this.emit({ type: 'chop', tree: index, x: hx, y: hy, z: hz, trunk: true });
    dyn.cuts = round3(dyn.cuts + chopPower(s));
    const cpl = BALANCE.trees.cutsPerLog;
    while (dyn.cuts >= cpl && dyn.logs > 0) {
      dyn.cuts = round3(dyn.cuts - cpl);
      dyn.logs -= 1;
      const cx = span.x0 + span.dx * Math.min(0.6, span.len / 2);
      const cz = span.z0 + span.dz * Math.min(0.6, span.len / 2);
      const cy = this.terrain.heightAt(cx, cz) + span.r;
      this.dropAt('log', 1 - this.give('log', 1, cx, cy, cz, 'tree'), cx, cz);
      if (dyn.logs <= 0) {
        dyn.cuts = 0;
        this.dropAt('stick', def.sticks - this.give('stick', def.sticks, span.x1, cy, span.z1, 'tree'), span.x1, span.z1);
        this.message(`The ${def.name.toLowerCase()} is all cut up.`, 'good');
      }
      this.gainXp('gathering', practiceXp(BALANCE.skills.xp.log, TREE_LEVELS[g.species].fell));
      this.syncTrunkCollider(index);
      this.worldVersion++;
    }
    this.wearTool('axe', 1);
  }

  private gatherResource(index: number): void {
    const s = this.state;
    const g = this.gen.resources[index];
    const def = RESOURCES[g.kind];
    const dyn = s.resources[index];
    this.actionCooldown = BALANCE.gather.cooldown;
    if (dyn.charges <= 0 || !this.forageAvailable(index) || (g.snow && snowCovered(g, s))) return;
    const level = RESOURCE_LEVELS[g.kind];
    if (this.denySkill('gathering', level)) return;
    if (roomFor(s.inventory, def.item) <= 0) {
      s.stats.events.packFull = (s.stats.events.packFull ?? 0) + 1;
      this.emit({ type: 'packFull', item: def.item });
      this.message('Your pack is full.', 'warn');
      return;
    }
    const gy = g.y ?? this.terrain.heightAt(g.x, g.z);
    const bonusChance = gatherBonusChance(s.skills.gathering);
    dyn.charges -= 1;
    if (dyn.charges <= 0) dyn.respawnAt = s.totalHours + def.respawnHours;
    const success = this.gatherAttempt(level);
    if (success) {
      this.give(def.item, def.yield, g.x, gy + def.hitHeight, g.z, g.kind);
      const plant = forageForResource(g.kind);
      if (plant) this.discoverForage(plant);
      if (this.roll(bonusChance) && roomFor(s.inventory, def.item) > 0) {
        this.give(def.item, 1, g.x, gy + def.hitHeight, g.z, g.kind);
      }
      if (def.bonus && this.roll(def.bonus.chance)) {
        const { item, count } = def.bonus;
        const got = this.give(item, count, g.x, gy + def.hitHeight, g.z, g.kind);
        if (got < count) this.dropAt(item, count - got, g.x + 0.4, g.z - 0.4);
      }
    }
    if (g.kind === 'stonePile' && this.biome === 'desert' && !dyn.scorpion && this.roll(BALANCE.scorpion.chance)) {
      dyn.scorpion = true;
      this.uncoverScorpion(index, g.x, g.z);
    }
    this.worldVersion++;
  }

  /** A scorpion was under stone pile `index`, just gathered at (x, z). It comes out on the player's side of the pile. */
  private uncoverScorpion(index: number, x: number, z: number): void {
    const s = this.state;
    const p = s.player;
    const d = Math.hypot(p.x - x, p.z - z) || 1;
    const k = Math.min(0.5, d * 0.5) / d;
    const sx = x + (p.x - x) * k;
    const sz = z + (p.z - z) * k;
    if (this.authority === 'guest') this.netOut.push({ k: 'scorpion', i: index, x: sx, z: sz });
    else this.revealScorpion(sx, sz);
    s.stats.events.scorpions = (s.stats.events.scorpions ?? 0) + 1;
    this.emit({ type: 'scorpion', x: sx, z: sz });
  }

  /** Host or solo: a scorpion crawls out at (x, z) and goes for the nearest player. */
  revealScorpion(x: number, z: number): AnimalState | null {
    const s = this.state;
    if (this.biome !== 'desert' || !this.terrain.inPlayBounds(x, z)) return null;
    if (s.animals.filter((a) => a.species === 'scorpion').length >= BALANCE.scorpion.max) return null;
    const a = createAnimal(s.nextId++, 'scorpion', x, z, this.rng, this.terrain);
    a.mode = 'alert';
    a.timer = (SPECIES.scorpion as PestSpecies).revealTime;
    s.animals.push(a);
    return a;
  }

  /** Unlock a plant's Foraging guide entry the first time it's harvested. */
  private discoverForage(id: ForageId): void {
    const s = this.state;
    if (s.forage.includes(id)) return;
    s.forage.push(id);
    this.emit({ type: 'forageUnlocked', id });
    this.message(`New Foraging guide entry: ${FORAGE_BY_ID[id].name}. Open Crafting (C) and select Foraging.`, 'good');
  }

  /** Chance roll that leaves the RNG untouched when the chance is zero, so level-1 play stays on the same random sequence. */
  private roll(chance: number): boolean {
    return chance > 0 && this.rng.chance(chance);
  }

  private gainXp(skill: SkillId, amount: number): void {
    const level = addSkillXp(this.state, skill, amount);
    if (level !== null) {
      this.emit({ type: 'skillUp', skill, level });
      this.message(`${SKILL_INFO[skill].name} is now level ${level}.`, 'good');
    }
  }

  /** Wears an owned tool; at zero it breaks and is removed. */
  wearTool(tool: ToolId, amount: number): WearResult {
    const w = toolWear(this.state, tool);
    if (!w) return 'ok';
    const res = applyWear(w, amount);
    if (res === 'low') {
      this.emit({ type: 'wornLow', name: TOOLS[tool].name });
      this.message(`Your ${TOOLS[tool].name} is wearing out.`, 'warn');
    } else if (res === 'broken') {
      this.breakTool(tool);
    }
    return res;
  }

  private breakTool(tool: ToolId): void {
    const s = this.state;
    s.tools = s.tools.filter((t) => t !== tool);
    delete s.toolWear[tool];
    if (s.activeTool === tool) {
      s.activeTool = 'hands';
      this.bowDraw = -1;
      this.endFishing('reeled');
    }
    this.emit({ type: 'broke', name: TOOLS[tool].name, tool });
    this.message(`Your ${TOOLS[tool].name} broke. You can craft a new one.`, 'warn');
  }

  private wearStructure(st: StructureState, amount: number): WearResult {
    if (!st.wear) return 'ok';
    const res = applyWear(st.wear, amount);
    const name = PREFABS[st.prefab].name;
    if (res === 'low') {
      this.emit({ type: 'wornLow', name });
      this.message(`Your ${name} is getting rickety.`, 'warn');
    } else if (res === 'broken') {
      this.removeStructure(st);
      this.emit({ type: 'broke', name, structure: st.id });
      this.message(`Your ${name} fell apart. You can build a new one.`, 'warn');
    }
    return res;
  }

  private removeStructure(st: StructureState): void {
    const s = this.state;
    const i = s.structures.indexOf(st);
    if (i >= 0) s.structures.splice(i, 1);
    const c = this.structureColliders.get(st.id);
    if (c) this.colliders.remove(c);
    this.structureColliders.delete(st.id);
    if (s.player.seat?.id === st.id) this.standUp();
    this.worldVersion++;
  }

  /** Slow decay over `hours`: every owned tool, the lit torch (only while held and awake), and shelters and benches. */
  private updateWear(hours: number, awake: boolean, structures = true, tools = true): void {
    if (hours <= 0) return;
    const s = this.state;
    const D = BALANCE.durability;
    if (tools) {
      for (const tool of [...s.tools]) {
        if (!toolWears(tool)) continue;
        let amount = D.tools[tool].perHour * hours;
        if (tool === 'torch' && awake && s.activeTool === 'torch') amount += D.tools.torch.burnPerHour * torchBurnMultiplier(s) * hours;
        this.wearTool(tool, amount);
      }
    }
    if (!structures) return;
    for (const st of [...s.structures]) {
      if (st.wear && prefabWears(st.prefab)) this.wearStructure(st, D.structures[st.prefab].perHour * hours);
    }
  }

  private pickUpDrop(id: number): void {
    const s = this.state;
    const i = s.drops.findIndex((d) => d.id === id);
    if (i < 0) return;
    const dr = s.drops[i];
    this.actionCooldown = BALANCE.gather.cooldown;
    const water = inCanteen(dr.item);
    if (water && canteenRoom(s) === 0) {
      this.message(canteenCapacity(s) === 0 ? 'You need a canteen to carry water.' : 'Your canteen is full.', 'warn');
      return;
    }
    const added = this.give(dr.item, dr.count, dr.x, dr.y + 0.2, dr.z, 'drop');
    if (added === 0) {
      if (!water) this.message('Your pack is full.', 'warn');
      return;
    }
    dr.count -= added;
    if (dr.count <= 0) s.drops.splice(i, 1);
    this.worldVersion++;
  }

  /** A knife cut on a carcass: the first skins it (if it has a hide), the next butchers it. No knife, no cut. */
  private cutCarcass(id: number): void {
    const s = this.state;
    const i = s.carcasses.findIndex((c) => c.id === id);
    if (i < 0) return;
    const c = s.carcasses[i];
    if (s.activeTool !== 'knife') {
      this.actionCooldown = 0.6;
      const owned = s.tools.includes('knife');
      this.emit({ type: 'needTool', message: owned ? `Equip your Stone Knife [${TOOLS.knife.slot}] to skin and butcher.` : 'Needs a knife. Craft a Stone Knife (Crafting > Tools) to skin and butcher your kill.' });
      return;
    }
    const step = carcassStep(c);
    if (step === 'skin' ? this.denySkill('skinning', ANIMAL_LEVELS[c.species].skin) : this.denySkill('hunting', ANIMAL_LEVELS[c.species].hunt)) return;
    this.actionCooldown = BALANCE.gather.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.gatherCost);
    this.emit({ type: 'swing', tool: 'knife', hit: true });
    if (carcassStep(c) === 'skin') this.skin(c);
    else this.butcher(i);
    this.wearTool('knife', 1);
    this.worldVersion++;
    this.progress();
  }

  /** Skinning: the Skinning skill (and the knife's upgrades) decide whether the hide comes off whole or tears. */
  private skin(c: CarcassState): void {
    const s = this.state;
    const xp = BALANCE.skills.xp;
    const hides = hidesOn(c);
    const whole = this.rng.chance(skinChance(s));
    for (const r of c.remaining) if (r.item === 'hide') r.count = 0;
    c.skinned = true;
    const name = speciesName(c.species, this.biome).toLowerCase();
    let got = 0;
    if (whole && hides > 0) {
      got = this.give('hide', hides, c.x, c.y + 0.4, c.z, 'carcass');
      this.dropAt('hide', hides - got, c.x + 0.5, c.z + 0.5);
    }
    s.stats.events.skinned = (s.stats.events.skinned ?? 0) + 1;
    if (whole) s.stats.events.hidesWhole = (s.stats.events.hidesWhole ?? 0) + 1;
    this.gainXp('skinning', practiceXp(whole ? xp.skin : xp.skinFail, ANIMAL_LEVELS[c.species].skin));
    this.emit({ type: 'skinned', id: c.id, species: c.species, hides: whole ? hides : 0, x: c.x, y: c.y, z: c.z });
    if (!whole) this.message(`The hide tore. The ${name} is skinned, but there's no hide to keep. Cut again to butcher it.`, 'warn');
    else if (got < hides) this.message(`You skinned the ${name}. No room in your pack, so the hide is on the ground.`, 'good');
    else this.message(`You skinned the ${name}. Cut again to butcher it.`, 'good');
  }

  /** Butchering: everything left on the carcass (what doesn't fit is set down beside it), then it's gone. */
  private butcher(i: number): void {
    const s = this.state;
    const c = s.carcasses[i];
    let spilled = false;
    for (const r of c.remaining) {
      if (r.count <= 0) continue;
      const added = this.give(r.item, r.count, c.x, c.y + 0.4, c.z, 'carcass');
      if (added < r.count) spilled = true;
      this.dropAt(r.item, r.count - added, c.x + 0.4, c.z + 0.4);
      r.count = 0;
    }
    s.carcasses.splice(i, 1);
    s.stats.events.butchered = (s.stats.events.butchered ?? 0) + 1;
    this.gainXp('hunting', practiceXp(BALANCE.skills.xp.butcher, ANIMAL_LEVELS[c.species].hunt));
    this.emit({ type: 'butchered', id: c.id, species: c.species, x: c.x, y: c.y, z: c.z });
    if (spilled) this.message('Your pack is full, so the rest of the meat is on the ground.', 'warn');
  }

  private useStructure(id: number): void {
    const st = this.structures.find((x) => x.id === id);
    if (!st || privateTribeStructure(this.state, st)) return;
    const def = PREFABS[st.prefab];
    if (!canUseTribeStructure(this.state, st)) {
      this.actionCooldown = 0.3;
      this.message(tribeStationRequirementText(this.state, st), 'warn');
      return;
    }
    this.actionCooldown = 0.3;
    if (def.fire) {
      if (st.fuel <= 0) this.addFuel(id);
      else this.emit({ type: 'openCooking', structure: id });
    } else if (def.shelter || def.storage || def.workbench) {
      this.emit({ type: 'openStructure', structure: id });
    } else if (def.seat) {
      if (this.state.player.seat?.id === st.id) {
        this.standUp();
        return;
      }
      const seat = seatFor(st, this.state.player);
      this.sitOn(st, seat);
      if (prefabWears(st.prefab)) this.wearStructure(st, BALANCE.durability.structures[st.prefab].useCost);
    }
  }

  /** Move onto the bench's seat, facing out over the side you came from. */
  private sitOn(st: StructureState, seat: Seat): void {
    const p = this.state.player;
    this.placement = null;
    this.bowDraw = -1;
    this.endFishing('reeled');
    p.x = seat.x;
    p.z = seat.z;
    p.y = st.y;
    p.vx = p.vy = p.vz = 0;
    p.grounded = true;
    p.sprinting = false;
    p.yaw = seat.yaw;
    p.sitting = true;
    p.seat = { id: st.id, yaw: seat.yaw };
    this.emit({ type: 'sat', yaw: seat.yaw });
  }

  /** Get off the bench: step forward off the seat, the way you were facing. */
  standUp(): void {
    const p = this.state.player;
    const seat = p.seat;
    p.sitting = false;
    p.seat = undefined;
    if (!seat) return;
    const d = BENCH_STAND_OFF;
    p.x -= Math.sin(seat.yaw) * d;
    p.z -= Math.cos(seat.yaw) * d;
    p.y = Math.max(p.y, surfaceAt(this.moveEnv, p.x, p.z));
    p.vx = p.vy = p.vz = 0;
  }

  /** Servings a lake click would put in the canteen. */
  private canteenFillAmount(): number {
    return canteenRoom(this.state);
  }

  /** Whether this player has tasted alkali water and now recognises it. */
  get knowsAlkali(): boolean {
    return (this.state.stats.events.alkaliTasted ?? 0) > 0;
  }

  private useWater(): void {
    if (this.frozen) {
      this.actionCooldown = BALANCE.needs.handDrink.cooldown;
      this.message('The lake is frozen over. Water is sealed beneath the ice.', 'warn');
      return;
    }
    const s = this.state;
    const t0 = this.target;
    const lake = t0 && t0.kind === 'water' ? this.terrain.lakeAt(t0.x, t0.z) : null;
    if (lake?.kind === 'sea') {
      this.actionCooldown = BALANCE.needs.handDrink.cooldown;
      s.stats.events.saltRefused = (s.stats.events.saltRefused ?? 0) + 1;
      this.message('Seawater is far too salty to drink, and it won\'t go in the canteen. Follow a stream inland for fresh water.', 'warn');
      return;
    }
    if (lake && !isDrinkable(lake)) {
      this.actionCooldown = BALANCE.needs.handDrink.cooldown;
      if (this.knowsAlkali) {
        this.message('Alkali water: too salty to drink. Find a spring or a rock pool.', 'warn');
        return;
      }
      applyFood(s.needs, { thirst: -BALANCE.water.alkaliTasteThirst });
      s.stats.events.alkaliTasted = 1;
      this.emit({ type: 'drank', byHand: true });
      this.message('Bitter and salty: alkali water. Drinking it would only make you thirstier. A white crust around a pool gives it away; clear water waits in springs where cottonwoods grow and in rock pools on the slickrock.', 'warn');
      return;
    }
    const n = this.canteenFillAmount();
    if (n > 0) {
      this.actionCooldown = 0.5;
      const t = this.target;
      const added = this.give('lakeWater', n, t && t.kind === 'water' ? t.x : s.player.x, WATER_LEVEL, t && t.kind === 'water' ? t.z : s.player.z, 'water');
      if (added > 0) this.emit({ type: 'filled', count: added });
      return;
    }
    this.actionCooldown = BALANCE.needs.handDrink.cooldown;
    if (s.needs.thirst >= 99.5) {
      this.message("You're not thirsty.");
      return;
    }
    applyFood(s.needs, { thirst: BALANCE.needs.handDrink.thirst, warmth: BALANCE.needs.handDrink.warmth });
    s.stats.events.drankByHand = (s.stats.events.drankByHand ?? 0) + 1;
    this.emit({ type: 'drank', byHand: true });
    this.progress();
  }

  private meleeAnimal(id: number, dist: number): void {
    const s = this.state;
    const a = s.animals.find((x) => x.id === id);
    if (!a) return;
    if (!this.canHunt(a.species) && !this.canDefend(a.species)) { this.denySkill('hunting', ANIMAL_LEVELS[a.species].hunt); return; }
    const c = BALANCE.combat;
    const stats = s.activeTool === 'axe' ? c.axe : s.activeTool === 'spear' ? c.spear : s.activeTool === 'torch' ? c.torch : s.activeTool === 'knife' ? c.knife : c.hand;
    this.actionCooldown = stats.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
    if (dist > stats.reach) {
      this.emit({ type: 'swing', tool: s.activeTool, hit: false });
      return;
    }
    this.emit({ type: 'swing', tool: s.activeTool, hit: true });
    const tool = s.activeTool;
    this.hitAnimal(a, stats.damage, tool);
    this.wearTool(tool, 1);
  }

  /** The player's hit on an animal with `tool`: the hunting skill and the weapon's upgrades add damage. */
  hitAnimal(a: AnimalState, damage: number, tool: ToolId = this.state.activeTool): void {
    if (animalHidden(a)) return;
    const trained = this.canHunt(a.species);
    if (!trained && !this.canDefend(a.species)) { this.denySkill('hunting', ANIMAL_LEVELS[a.species].hunt); return; }
    const dmg = damage * weaponDamageMultiplier(this.state, tool);
    if (this.authority === 'guest') {
      // The host owns the animals: it applies the hit and reports any kill back.
      a.hurt = 0.35;
      this.netOut.push({ k: 'hit', id: a.id, dmg, t: TOOL_ORDER.indexOf(tool) });
      this.emit({ type: 'animalHit', id: a.id, species: a.species, x: a.x, y: a.y + SPECIES[a.species].hitHeight, z: a.z, killed: false });
      if (trained) this.gainXp('hunting', practiceXp(BALANCE.skills.xp.hit, ANIMAL_LEVELS[a.species].hunt));
      return;
    }
    const killed = damageAnimal(a, dmg, this.animalEnv);
    const def = SPECIES[a.species];
    this.emit({ type: 'animalHit', id: a.id, species: a.species, x: a.x, y: a.y + def.hitHeight, z: a.z, killed });
    if (trained) this.gainXp('hunting', practiceXp(BALANCE.skills.xp.hit, ANIMAL_LEVELS[a.species].hunt));
    if (killed) this.killAnimal(a, null, tool);
  }

  /** Count a kill made with `tool` (the spear and bow onboarding steps look for these). */
  private recordKill(species: SpeciesId, tool: ToolId | null): void {
    const s = this.state;
    s.stats.kills[species] = (s.stats.kills[species] ?? 0) + 1;
    if (tool) {
      for (const k of [killKey(tool), killKey(tool, species)]) s.stats.events[k] = (s.stats.events[k] ?? 0) + 1;
    }
  }

  /** `by` is the remote player whose hit killed it (host only); they get the credit and any fish. */
  private killAnimal(a: AnimalState, by: string | null = null, tool: ToolId | null = null): void {
    const s = this.state;
    const i = s.animals.indexOf(a);
    if (i >= 0) s.animals.splice(i, 1);
    if (by === null) {
      this.recordKill(a.species, tool);
      if (this.canHunt(a.species)) this.gainXp('hunting', practiceXp(BALANCE.skills.xp.kill, ANIMAL_LEVELS[a.species].hunt));
    } else {
      this.remoteKills.push({ pid: by, species: a.species, tool });
    }
    const def = SPECIES[a.species];
    if (def.drops.length === 0) {
      this.progress();
      return;
    }
    const remaining = def.drops.map((d) => ({ item: d.item, count: d.count }));
    const meat = remaining.find((r) => r.item === 'rawMeat');
    if (meat && by === null && this.roll(butcherBonusChance(s.skills.hunting))) meat.count += 1;
    if (def.habitat === 'water') {
      // A speared fish needs no knife: it goes in the pack, or onto the ground when the pack is full.
      if (by !== null) return;
      const added = this.give('rawFish', 1, a.x, WATER_LEVEL + 0.2, a.z, 'carcass');
      this.dropAt('rawFish', 1 - added, a.x, a.z);
      const fish = a.species === 'fish' ? fishWord(this.terrain, a.x, a.z) : speciesName(a.species, this.biome).toLowerCase();
      this.message(added > 0 ? `Caught a ${fish}!` : `Caught a ${fish}! No room in your pack, so it is on the ground.`, 'good');
      this.worldVersion++;
      this.progress();
      return;
    }
    let x = a.x, z = a.z;
    if (a.species === 'squirrel' && a.tree !== undefined) {
      const tr = this.gen.trees[a.tree];
      if (tr) {
        const heading = Math.atan2(x - tr.x, z - tr.z);
        x = tr.x + Math.sin(heading) * (tr.trunkR + 0.4);
        z = tr.z + Math.cos(heading) * (tr.trunkR + 0.4);
      }
    }
    s.carcasses.push({ id: s.nextId++, species: a.species, x, y: a.species === 'squirrel' ? this.terrain.heightAt(x, z) : a.y, z, rot: a.heading, remaining, expiresAt: s.totalHours + 24 });
    this.worldVersion++;
    this.progress();
  }

  private fireArrow(power: number): void {
    const s = this.state;
    if (!removeItem(s.inventory, 'arrow', 1)) return;
    const b = BALANCE.combat.bow;
    const p = s.player;
    const d = this.aimDirection();
    const speed = lerp(b.minSpeed, b.maxSpeed, power) * arrowSpeedMultiplier(s);
    const ey = (this.hasCameraAim ? this.aimEye.y : p.y + BALANCE.player.eyeHeight) - 0.08;
    this.projectiles.push({
      x: p.x + d.x * 0.4, y: ey + d.y * 0.4, z: p.z + d.z * 0.4,
      vx: d.x * speed, vy: d.y * speed, vz: d.z * speed,
      damage: lerp(b.minDamage, b.maxDamage, power), life: 5, tool: 'bow',
    });
    this.actionCooldown = b.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
    this.emit({ type: 'arrowFired', power });
    this.wearTool('bow', 1);
  }

  private updateProjectiles(dt: number): void {
    const h = 1 / 120;
    const steps = Math.max(1, Math.ceil(dt / h));
    const sub = dt / steps;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      let done = false;
      for (let k = 0; k < steps && !done; k++) {
        pr.vy -= ARROW_GRAVITY * sub;
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        const len = sp * sub;
        const dx = pr.vx / sp;
        const dy = pr.vy / sp;
        const dz = pr.vz / sp;
        for (const a of this.state.animals) {
          if (animalHidden(a)) continue;
          if (this.frozen && a.species === 'fish') continue;
          if (Math.abs(a.x - pr.x) > len + 2 || Math.abs(a.z - pr.z) > len + 2) continue;
          const def = SPECIES[a.species];
          const t = raySphere(pr.x, pr.y, pr.z, dx, dy, dz, a.x, a.y + def.hitHeight, a.z, def.hitRadius);
          if (t >= 0 && t <= len) {
            this.emit({ type: 'arrowHit', x: pr.x + dx * t, y: pr.y + dy * t, z: pr.z + dz * t, target: 'animal' });
            this.hitAnimal(a, pr.damage, pr.tool);
            done = true;
            break;
          }
        }
        if (done) break;
        if (this.terrain.island && pr.y > 3 && this.shootCoconut(pr, dx, dy, dz, len)) {
          done = true;
          break;
        }
        this.colliders.query(pr.x, pr.z, len + 1, this.tmpColliders);
        for (const c of this.tmpColliders) {
          if (c.kind !== 'tree') continue;
          const g = this.gen.trees[c.ref];
          const gy = this.terrain.heightAt(g.x, g.z);
          const t = rayCylinder(pr.x, pr.y, pr.z, dx, dy, dz, g.x, g.z, g.trunkR, gy - 1, gy + 10);
          if (t >= 0 && t <= len) {
            const hx = pr.x + dx * t;
            const hz = pr.z + dz * t;
            this.emit({ type: 'arrowHit', x: hx, y: pr.y + dy * t, z: hz, target: 'tree' });
            if (this.rng.chance(BALANCE.combat.arrowRecoverChance)) this.dropAt('arrow', 1, hx - dx * 0.4, hz - dz * 0.4);
            done = true;
            break;
          }
        }
        if (done) break;
        pr.x += pr.vx * sub;
        pr.y += pr.vy * sub;
        pr.z += pr.vz * sub;
        pr.life -= sub;
        const ground = this.terrain.heightAt(pr.x, pr.z);
        if (pr.y <= Math.max(ground, WATER_LEVEL)) {
          const water = ground < WATER_LEVEL && !this.frozen;
          this.emit({ type: 'arrowHit', x: pr.x, y: Math.max(ground, WATER_LEVEL), z: pr.z, target: water ? 'water' : 'ground' });
          if (!water && this.rng.chance(BALANCE.combat.arrowRecoverChance)) this.dropAt('arrow', 1, pr.x, pr.z);
          done = true;
        } else if (pr.life <= 0 || !this.terrain.inPlayBounds(pr.x, pr.z)) {
          done = true;
        }
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  /**
   * An arrow through a palm's crown knocks one coconut loose: it drops to the sand beside the trunk (a pickup), and
   * the arrow usually falls with it. Returns whether the arrow hit a crown.
   */
  private shootCoconut(pr: Projectile, dx: number, dy: number, dz: number, len: number): boolean {
    const s = this.state;
    this.colliders.query(pr.x, pr.z, len + 4, this.crownColliders);
    for (const c of this.crownColliders) {
      if (c.kind !== 'tree') continue;
      const g = this.gen.trees[c.ref];
      const def = TREES[g.species];
      const dyn = s.trees[c.ref];
      if (!def.crown || dyn.felled || dyn.bark <= 0) continue;
      const cp = crownPosition(g, this.terrain.heightAt(g.x, g.z))!;
      const t = raySphere(pr.x, pr.y, pr.z, dx, dy, dz, cp.x, cp.y, cp.z, cp.r);
      if (t < 0 || t > len) continue;
      if (this.denySkill('gathering', TREE_LEVELS[g.species].harvest)) return true;
      this.gainXp('gathering', practiceXp(BALANCE.skills.xp.gather, TREE_LEVELS[g.species].harvest));
      dyn.bark -= 1;
      if (dyn.bark <= 0) dyn.barkAt = s.totalHours + def.barkRespawnHours;
      // It lands on the sand between the trunk and the crown, never in the water.
      let gx = g.x + (cp.x - g.x) * 0.7 + this.rng.range(-0.6, 0.6);
      let gz = g.z + (cp.z - g.z) * 0.7 + this.rng.range(-0.6, 0.6);
      if (this.terrain.heightAt(gx, gz) < WATER_LEVEL + 0.1) {
        gx = g.x + 0.6;
        gz = g.z + 0.6;
      }
      this.dropAt('coconut', 1, gx, gz);
      if (this.rng.chance(BALANCE.island.coconutArrowRecover)) this.dropAt('arrow', 1, g.x - (cp.x - g.x) * 0.4 + 0.5, g.z - (cp.z - g.z) * 0.4);
      s.stats.events.coconutsShot = (s.stats.events.coconutsShot ?? 0) + 1;
      const entry = forageForTree(g.species);
      if (entry) this.discoverForage(entry);
      this.emit({ type: 'arrowHit', x: pr.x + dx * t, y: pr.y + dy * t, z: pr.z + dz * t, target: 'tree' });
      this.emit({ type: 'coconutDown', tree: c.ref, x: cp.x, y: cp.y, z: cp.z, gx, gz });
      if (!this.warnedCoconut) {
        this.warnedCoconut = true;
        this.message('A coconut thuds down onto the sand. Pick it up: it is a drink and a meal in one.', 'good');
      }
      this.worldVersion++;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ world systems

  private updateAnimals(dt: number): void {
    if (this.authority === 'guest') return;
    const s = this.state;
    const env = this.animalEnv;
    env.playerX = s.player.x;
    env.playerZ = s.player.z;
    env.playerNoise = this.noise;
    env.playerDead = s.dead || this.sleepingIn !== null;
    env.playerDeterrent = s.activeTool === 'torch';
    env.night = this.night;
    this.setWaterFlags(s.player.x, s.player.z);
    const remote = this.remotePlayers.length > 0;
    for (let i = 0; i < s.animals.length; i++) {
      const a = s.animals[i];
      const prevMode = a.mode;
      if (remote) this.aimAi(a);
      updateAnimal(a, env, dt);
      if (a.mode === 'flee' && prevMode !== 'flee' && a.species === 'deer') {
        s.stats.events.deerSpooked = (s.stats.events.deerSpooked ?? 0) + 1;
      }
      if (burrowed(a)) s.animals.splice(i--, 1);
    }
    this.aiTarget = null;
  }

  /** Point the animal AI at the nearest awake, living player (local or remote). */
  private aimAi(a: AnimalState): void {
    const s = this.state;
    const env = this.animalEnv;
    const localOk = !s.dead && this.sleepingIn === null;
    let best: RemotePlayer | null = null;
    let bestD = localOk ? Math.hypot(s.player.x - a.x, s.player.z - a.z) : Infinity;
    for (const r of this.remotePlayers) {
      if (r.dead || r.sleeping) continue;
      const d = Math.hypot(r.x - a.x, r.z - a.z);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    this.aiTarget = best;
    if (best) {
      env.playerX = best.x;
      env.playerZ = best.z;
      env.playerNoise = best.noise;
      env.playerDead = false;
      env.playerDeterrent = best.deterrent;
    } else {
      env.playerX = s.player.x;
      env.playerZ = s.player.z;
      env.playerNoise = this.noise;
      env.playerDead = !localOk;
      env.playerDeterrent = s.activeTool === 'torch';
    }
    this.setWaterFlags(env.playerX, env.playerZ);
  }

  /** Whether the animals' target stands in the water, and out past the reef (read from the ground under them). */
  private setWaterFlags(x: number, z: number): void {
    const env = this.animalEnv;
    const isl = this.terrain.island;
    if (!isl) {
      env.playerInWater = false;
      env.playerDeep = false;
      return;
    }
    const depth = this.terrain.waterDepth(x, z);
    env.playerInWater = depth > BALANCE.player.wadeDepth;
    env.playerDeep = depth > 1.2 && isl.pastReef(x, z) > 2;
  }

  private updateFires(gameHours: number): void {
    let changed = false;
    for (const st of this.structures) {
      if (!PREFABS[st.prefab].fire || st.fuel <= 0) continue;
      st.fuel -= gameHours;
      if (st.fuel <= 0) {
        st.fuel = 0;
        changed = true;
        this.message('A campfire burned out. Add sticks or logs to relight it.', 'warn');
      }
    }
    if (changed) {
      this.refreshLitFires();
      this.worldVersion++;
    }
  }

  private updateRespawns(dt: number): void {
    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return;
    this.respawnTimer = 1;
    const s = this.state;
    const now = s.totalHours;
    let changed = false;
    s.resources.forEach((r, i) => {
      if (this.gen.resources[i].kind === 'snowClump' && !this.frozen) return;
      if (r.charges <= 0 && now >= r.respawnAt) {
        const def = RESOURCES[this.gen.resources[i].kind];
        if (this.resourceCovered(i)) {
          r.respawnAt = now + def.respawnHours;
          return;
        }
        r.charges = def.charges;
        changed = true;
      }
    });
    s.trees.forEach((t, i) => {
      const def = TREES[this.gen.trees[i].species];
      if (!t.felled && def.bark > 0 && t.bark <= 0 && now >= t.barkAt) {
        t.bark = def.bark;
        changed = true;
      }
    });
    const before = s.carcasses.length;
    s.carcasses = s.carcasses.filter((c) => c.expiresAt > now);
    if (s.carcasses.length !== before) changed = true;
    if (changed) this.worldVersion++;
  }

  maintainPopulation(): void {
    const s = this.state;
    const counts: Partial<Record<SpeciesId, number>> = {};
    for (const a of s.animals) counts[a.species] = (counts[a.species] ?? 0) + 1;
    const p = s.player;
    const avoidPrey: AvoidPoint[] = [{ x: p.x, z: p.z, minDist: PREY_MIN_SPAWN_DIST }];
    const avoidPred: AvoidPoint[] = [{ x: p.x, z: p.z, minDist: PREDATOR_MIN_SPAWN_DIST }];
    for (const r of this.remotePlayers) {
      avoidPrey.push({ x: r.x, z: r.z, minDist: PREY_MIN_SPAWN_DIST });
      avoidPred.push({ x: r.x, z: r.z, minDist: PREDATOR_MIN_SPAWN_DIST });
    }
    for (const st of this.structures) avoidPred.push({ x: st.x, z: st.z, minDist: 35 });
    for (const { species: id, count } of this.biomeDef.prey) {
      if (id === 'squirrel' && !this.terrain.pnw && s.pnwWildlife !== 1) continue;
      const target = id === 'squirrel' && !this.terrain.pnw ? count / 4 : count;
      if ((counts[id] ?? 0) < target) {
        const pt = findSpawnPoint(this.terrain, this.rng, id, SPECIES[id].habitat === 'water' ? [] : avoidPrey);
        if (pt) s.animals.push(createAnimal(s.nextId++, id, pt.x, pt.z, this.rng, this.terrain));
      }
    }
    const targets = this.biomeDef.predatorTargets(this.day);
    for (const { species: id } of this.biomeDef.predators) {
      if (id === 'bear' && this.frozen) continue;
      if ((counts[id] ?? 0) < (targets[id] ?? 0)) {
        const pt = findSpawnPoint(this.terrain, this.rng, id, avoidPred);
        if (pt) s.animals.push(createAnimal(s.nextId++, id, pt.x, pt.z, this.rng, this.terrain));
      }
    }
  }

  // ------------------------------------------------------------------ commands (UI)

  selectTool(tool: ToolId): boolean {
    if (!this.state.tools.includes(tool)) return false;
    if (tool !== this.state.activeTool) this.endFishing('reeled');
    this.state.activeTool = tool;
    this.bowDraw = -1;
    return true;
  }

  cycleTool(dir: number): void {
    const owned = TOOL_ORDER.filter((t) => this.state.tools.includes(t));
    const i = owned.indexOf(this.state.activeTool);
    const next = owned[(i + dir + owned.length) % owned.length];
    this.selectTool(next);
  }

  toolForSlot(slot: number): ToolId | null {
    const t = TOOL_ORDER.find((id) => TOOLS[id].slot === slot);
    return t ?? null;
  }

  canCraft(recipeId: string): CraftCheck {
    const r = RECIPE_BY_ID[recipeId];
    if (!r || !recipeOnMap(r, this.biome)) return { ok: false, reason: 'unknown' };
    return canCraft(this.state, r, { nearFire: this.isNearCookingFire() });
  }

  craft(recipeId: string): CraftCheck {
    const recipe = RECIPE_BY_ID[recipeId];
    if (!recipe || !recipeOnMap(recipe, this.biome)) return { ok: false, reason: 'unknown' };
    if (recipe.output.kind === 'place') {
      const check = this.canCraft(recipeId);
      if (check.ok) this.beginPlacement(recipeId);
      return check;
    }
    const s = this.state;
    const cooking = recipe.station === 'fire';
    const firstTime = (s.stats.crafted[recipeId] ?? 0) === 0;
    const res = craftRecipe(s, recipeId, { nearFire: this.isNearCookingFire() });
    if (res.ok) {
      const out = recipe.output;
      let item = out.kind === 'item' ? out.item : null;
      const count = out.kind === 'item' ? out.count : 0;
      // Beginner's luck: the first time you cook a dish it always comes out right.
      if (item && cooking && canBurn(item) && !firstTime && this.roll(burnChance(s.skills.cooking))) {
        item = this.charMeal(item, count);
      }
      spendEnergy(s.needs, BALANCE.needs.energy.craftCost);
      if (out.kind === 'tool' && toolWears(out.tool)) s.toolWear[out.tool] = newToolWear(out.tool, s.skills.crafting);
      this.emit({ type: 'crafted', recipe: recipeId, burnt: item === 'charredMeal' || undefined });
      this.checkOff(recipeId);
      if (out.kind === 'tool') this.selectTool(out.tool);
      if (item) this.emit({ type: 'gathered', item, count, x: s.player.x, y: s.player.y + 1.2, z: s.player.z, source: 'craft' });
      const xp = cooking ? item === 'charredMeal' ? BALANCE.skills.xp.cookFail : BALANCE.skills.xp.cook
        : out.kind === 'item' ? BALANCE.skills.xp.craft : BALANCE.skills.xp.equipment;
      this.gainXp(cooking ? 'cooking' : 'crafting', practiceXp(xp, recipe.requiredLevel));
      this.progress();
    }
    return res;
  }

  /** Swap a freshly cooked dish for a charred meal (dropped at your feet if it doesn't fit). */
  private charMeal(item: ItemId, count: number): ItemId {
    const s = this.state;
    removeItem(s.inventory, item, count);
    s.stats.gathered[item] = Math.max(0, (s.stats.gathered[item] ?? 0) - count);
    const added = addItem(s.inventory, 'charredMeal', count);
    s.stats.gathered.charredMeal = (s.stats.gathered.charredMeal ?? 0) + count;
    const p = s.player;
    const d = lookDir(p.yaw, 0, this.look);
    this.dropAt('charredMeal', count - added, p.x + d.x * 0.8, p.z + d.z * 0.8);
    return 'charredMeal';
  }

  beginPlacement(recipeId: string): boolean {
    const r = RECIPE_BY_ID[recipeId];
    if (!r || r.output.kind !== 'place') return false;
    if (!this.canCraft(recipeId).ok) return false;
    const p = this.state.player;
    this.placement = {
      recipeId, prefab: r.output.prefab, x: p.x, y: p.y, z: p.z,
      rot: p.yaw, valid: false, reason: null,
    };
    this.bowDraw = -1;
    this.endFishing('reeled');
    this.updatePlacementPreview();
    return true;
  }

  rotatePlacement(delta: number): void {
    if (!this.placement) return;
    this.placement.rot += delta;
    this.updatePlacementPreview();
  }

  cancelPlacement(): void {
    this.placement = null;
  }

  placementEnv(): PlacementEnv {
    return {
      terrain: this.terrain,
      query: (x, z, r, out) => this.colliders.query(x, z, r, out),
      playerX: this.state.player.x,
      playerZ: this.state.player.z,
      ignore: (c) => c.kind === 'resource' && !this.resourcePresent(c.ref),
    };
  }

  /** Whether a gatherable is physically in the world (not gathered out and hidden while it regrows). */
  resourcePresent(index: number): boolean {
    const g = this.gen.resources[index];
    if (g.snow) return snowAmount(g, this.state, index) > 0;
    return this.forageAvailable(index) && (this.state.resources[index].charges > 0 || !!RESOURCES[this.gen.resources[index].kind].persistent);
  }

  private resourceCovered(index: number): boolean {
    const g = this.gen.resources[index];
    if (g.snow) return snowCovered(g, this.state);
    const spot = circle(g.x, g.z, RESOURCES[g.kind].blockRadius);
    this.colliders.query(g.x, g.z, spot.r + 3, this.tmpColliders);
    return this.tmpColliders.some((c) => c.kind === 'structure' && !!c.footprint && overlaps(spot, c.footprint));
  }

  /** Aim the ghost where the camera ray meets the ground (clamped to build reach). */
  updatePlacementPreview(): void {
    const pl = this.placement;
    if (!pl) return;
    const p = this.state.player;
    const ey = this.hasCameraAim ? this.aimEye.y : p.y + BALANCE.player.eyeHeight;
    const d = this.aimDirection();
    const t = this.terrain.raycast(p.x, ey, p.z, d.x, d.y, d.z, PLACE_MAX_DIST + 3, this.hit);
    let x: number;
    let z: number;
    if (t >= 0) {
      x = this.hit.x;
      z = this.hit.z;
    } else {
      const fl = Math.hypot(d.x, d.z) || 1;
      x = p.x + (d.x / fl) * PLACE_MAX_DIST;
      z = p.z + (d.z / fl) * PLACE_MAX_DIST;
    }
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist > PLACE_MAX_DIST) {
      x = p.x + ((x - p.x) / dist) * PLACE_MAX_DIST;
      z = p.z + ((z - p.z) / dist) * PLACE_MAX_DIST;
    }
    this.setPlacementAt(x, z);
  }

  /** Position the ghost explicitly (used by tests and by updatePlacementPreview). */
  setPlacementAt(x: number, z: number): void {
    const pl = this.placement;
    if (!pl) return;
    const res = checkPlacement(this.placementEnv(), pl.prefab, x, z, pl.rot);
    pl.x = x;
    pl.z = z;
    pl.y = res.y;
    pl.valid = res.valid;
    pl.reason = res.reason;
    const recipe = RECIPE_BY_ID[pl.recipeId];
    if (pl.valid && !removeAllDryRun(this.state, recipe.inputs)) {
      pl.valid = false;
      pl.reason = 'missing';
    }
  }

  /** Places the ghost if valid. Ingredients are consumed only on success. */
  confirmPlacement(): boolean {
    const pl = this.placement;
    if (!pl) return false;
    const recipe = RECIPE_BY_ID[pl.recipeId];
    const check = this.canCraft(pl.recipeId);
    if (!check.ok) {
      this.message(check.reason === 'skill' ? `Requires ${recipeRequirementText(recipe)}.` : 'Cannot build this yet.', 'warn');
      this.placement = null;
      return false;
    }
    const res = checkPlacement(this.placementEnv(), pl.prefab, pl.x, pl.z, pl.rot);
    if (!res.valid) {
      this.emit({ type: 'placeFailed', reason: res.reason! });
      return false;
    }
    if (!takeItems(this.state, recipe.inputs)) {
      this.message('Missing ingredients.', 'warn');
      this.placement = null;
      return false;
    }
    const s = this.state;
    const def = PREFABS[pl.prefab];
    const st: StructureState = { id: s.nextId++, prefab: pl.prefab, x: pl.x, y: res.y, z: pl.z, rot: pl.rot, fuel: def.fire ? BALANCE.fire.initialFuelHours : 0 };
    if (prefabWears(st.prefab)) st.wear = newStructureWear(st.prefab, s.skills.crafting);
    if (def.storage) ensureStore(st);
    s.structures.push(st);
    this.addStructureCollider(st);
    s.stats.crafted[recipe.id] = (s.stats.crafted[recipe.id] ?? 0) + 1;
    this.placement = null;
    this.actionCooldown = 0.4;
    spendEnergy(s.needs, BALANCE.needs.energy.buildCost);
    this.refreshLitFires();
    this.worldVersion++;
    this.emit({ type: 'placed', structure: st.id, prefab: st.prefab });
    this.checkOff(recipe.id);
    this.gainXp('crafting', practiceXp(BALANCE.skills.xp.build, STRUCTURE_LEVELS[st.prefab]));
    this.progress();
    return true;
  }

  /** Shift-click in the crafting menu: pin a recipe to the HUD checklist, or unpin it. Null for a recipe not on this map. */
  togglePin(recipeId: string): { pinned: boolean; dropped: string | null } | null {
    const recipe = RECIPE_BY_ID[recipeId];
    if (!recipe || !recipeOnMap(recipe, this.biome)) return null;
    return togglePin(this.state, recipeId);
  }

  private checkOff(recipeId: string): void {
    if (unpinsWhenMade(RECIPE_BY_ID[recipeId]) && unpin(this.state, recipeId)) this.emit({ type: 'checklistDone', recipe: recipeId });
  }

  useSlot(index: number): boolean {
    const s = this.state;
    const slot = s.inventory.slots[index];
    if (!slot) return false;
    const def = ITEMS[slot.item];
    if (!def.food) return false;
    removeFromSlot(s.inventory, index, 1);
    applyFood(s.needs, def.food);
    if (def.water && (def.food.hunger ?? 0) < 5) this.emit({ type: 'drank', byHand: false });
    else this.emit({ type: 'ate', item: slot.item });
    if ((def.food.health ?? 0) < 0) this.message(`${def.name} doesn't sit well raw. Cook it next time.`, 'warn');
    return true;
  }

  /** Eat/drink whatever best fixes the most pressing need. */
  quickConsume(): boolean {
    const s = this.state;
    const n = s.needs;
    const scoreOf = (item: ItemId): number => {
      const f = ITEMS[item].food;
      if (!f) return 0;
      return (
        (100 - n.hunger) * (f.hunger ?? 0) +
        (100 - n.thirst) * (f.thirst ?? 0) * 1.2 +
        (100 - n.warmth) * (f.warmth ?? 0) * 0.3 +
        (f.health ?? 0) * 40
      );
    };
    let best = -1;
    let bestScore = 0;
    s.inventory.slots.forEach((slot, i) => {
      if (!slot) return;
      const score = scoreOf(slot.item);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const serving = nextServing(s);
    if (serving && scoreOf(serving) > bestScore) return this.drinkCanteen();
    if (best < 0) {
      this.message('Nothing useful to eat or drink.', 'warn');
      return false;
    }
    return this.useSlot(best);
  }

  /** Drink one serving from the canteen: raw water first, then boiled. */
  drinkCanteen(): boolean {
    const s = this.state;
    const item = nextServing(s);
    if (!item || s.dead) return false;
    s.canteen[item]--;
    applyFood(s.needs, ITEMS[item].food!);
    s.stats.events.canteenDrinks = (s.stats.events.canteenDrinks ?? 0) + 1;
    this.emit({ type: 'drank', byHand: false });
    return true;
  }

  dropSlot(index: number): boolean {
    const s = this.state;
    const taken = removeFromSlot(s.inventory, index, Infinity);
    if (!taken) return false;
    const p = s.player;
    const d = lookDir(p.yaw, 0, this.look);
    this.dropAt(taken.item, taken.count, p.x + d.x * 1.2, p.z + d.z * 1.2);
    return true;
  }

  /** Feed a fire one log or stick: the chosen `fuel`, or a log when there is one. */
  addFuel(structureId: number, fuel?: 'stick' | 'log'): boolean {
    const s = this.state;
    const st = this.structures.find((x) => x.id === structureId);
    if (!st || !PREFABS[st.prefab].fire) return false;
    if (!canUseTribeStructure(s, st)) { this.message(tribeStationRequirementText(s, st), 'warn'); return false; }
    const f = BALANCE.fire;
    if (st.fuel >= f.maxFuelHours - 0.5) {
      this.message('The fire is roaring already.');
      return false;
    }
    const item: 'stick' | 'log' | null = fuel
      ? (countItem(s.inventory, fuel) > 0 ? fuel : null)
      : countItem(s.inventory, 'log') > 0 ? 'log' : countItem(s.inventory, 'stick') > 0 ? 'stick' : null;
    if (!item) {
      this.message(fuel ? `You have no ${fuel === 'log' ? 'logs' : 'sticks'} to add.` : 'You need sticks or logs to fuel the fire.', 'warn');
      return false;
    }
    removeItem(s.inventory, item, 1);
    if (st.settlement && this.authority === 'guest') this.netOut.push({ k: 'tribeFuel', tribe: st.settlement, fuel: item });
    const wasOut = st.fuel <= 0;
    st.fuel = Math.min(f.maxFuelHours, st.fuel + (item === 'log' ? f.logFuelHours : f.stickFuelHours));
    if (wasOut) this.refreshLitFires();
    s.stats.events.fuelAdded = (s.stats.events.fuelAdded ?? 0) + 1;
    this.worldVersion++;
    this.emit({ type: 'fuelAdded', structure: st.id, item });
    this.progress();
    return true;
  }

  /**
   * Sleep in a shelter or beside a campfire: skips to the next dawn, fully restores energy. A campfire gives no
   * shelter bonus, and the usual cold rules decide your warmth (a burning fire in range means no loss).
   */
  trySleep(structureId: number): boolean {
    const s = this.state;
    const st = this.structures.find((x) => x.id === structureId);
    const rest = st ? restBonus(st.prefab) : null;
    if (!st || !rest || st.settlement) return false;
    if (s.repair) {
      this.emit({ type: 'sleepDenied', reason: 'Finish your repair first.' });
      return false;
    }
    if (!canSleepAt(this.hour)) {
      this.emit({ type: 'sleepDenied', reason: 'You can only sleep after 7 PM.' });
      return false;
    }
    const p = s.player;
    const threat = s.animals.find((a) => hostile(a) && Math.hypot(a.x - p.x, a.z - p.z) < 35);
    if (threat) {
      const what = SPECIES[threat.species].kind === 'predator' ? 'a predator nearby' : `a ${threat.species} after you`;
      this.emit({ type: 'sleepDenied', reason: `You can't sleep with ${what}!` });
      return false;
    }
    const byFire = this.warmingFire() !== null;
    if (this.authority !== 'solo') {
      // Multiplayer: lie down and wait until everyone is asleep; the host then skips the night.
      this.sleepingIn = st.id;
      this.sleepByFire = byFire;
      this.placement = null;
      this.bowDraw = -1;
      this.endFishing('reeled');
      this.standUp();
      p.vx = 0;
      p.vz = 0;
      this.netOut.push({ k: 'sleep', structure: st.id });
      this.emit({ type: 'sleepWait', structure: st.id });
      return true;
    }
    this.endFishing('reeled');
    const coldLethal = this.coldLethal;
    const before = s.totalHours;
    s.totalHours = nextDayStart(s.totalHours);
    this.advanceCalendarAtDawn();
    const elapsed = s.totalHours - before;
    for (const f of this.structures) if (PREFABS[f.prefab].fire && f.fuel > 0) f.fuel = Math.max(0, f.fuel - elapsed);
    this.refreshLitFires();
    const night = applySleep(s.needs, rest, byFire, elapsed, coldLethal, this.sleepClimate);
    this.updateWear(elapsed, false);
    if (prefabWears(st.prefab) && s.structures.includes(st)) this.wearStructure(st, BALANCE.durability.structures[st.prefab].useCost);
    this.standUp();
    p.vx = 0;
    p.vz = 0;
    s.animals = s.animals.filter((a) => SPECIES[a.species].kind !== 'pest');
    for (const a of s.animals) {
      if (SPECIES[a.species].kind === 'predator') {
        a.mode = 'wander';
        a.timer = 5;
        a.aggroCooldown = 10;
        if (Math.hypot(a.x - p.x, a.z - p.z) < 60) {
          a.x = a.homeX;
          a.z = a.homeZ;
          a.y = this.terrain.heightAt(a.x, a.z);
        }
      }
    }
    this.wasNight = this.night;
    s.stats.events.slept = (s.stats.events.slept ?? 0) + 1;
    this.worldVersion++;
    this.emit({ type: 'slept', day: this.day, byFire });
    this.emit({ type: 'dayStart', day: this.day });
    this.afterNight(night);
    this.progress();
    return true;
  }

  /** Dying in your sleep, or waking weaker, when a meter sat empty through the night. */
  private afterNight(night: SleepResult): void {
    if (night.cause) {
      this.die(night.cause);
      return;
    }
    if (night.lost < 0.5) return;
    const why = night.from.map((f) => SLEPT_EMPTY[f] ?? f);
    const list = why.length > 1 ? `${why.slice(0, -1).join(', ')} and ${why[why.length - 1]}` : why[0];
    this.message(`You slept ${list} and woke up weaker (-${Math.round(night.lost)} health).`, 'warn');
  }

  // ------------------------------------------------------------------ storage

  /** Move up to `count` from pack slot `index` into storage `id`. Returns how many moved. */
  storeItem(id: number, index: number, count = Infinity): number {
    const s = this.state;
    const st = this.structures.find((x) => x.id === id);
    const slot = s.inventory.slots[index];
    if (!st || st.settlement || !PREFABS[st.prefab].storage || !slot) return 0;
    const moved = addToStore(ensureStore(st), slot.item, Math.min(count, slot.count));
    if (moved === 0) {
      this.message(`The ${PREFABS[st.prefab].name.toLowerCase()} is full.`, 'warn');
      return 0;
    }
    removeFromSlot(s.inventory, index, moved);
    this.worldVersion++;
    return moved;
  }

  /** Move up to `count` from slot `index` of storage `id` into the pack. Returns how many moved. */
  takeItem(id: number, index: number, count = Infinity): number {
    const s = this.state;
    const st = this.structures.find((x) => x.id === id);
    const slot = st?.store?.[index];
    if (!st || st.settlement || !slot) return 0;
    const moved = addItem(s.inventory, slot.item, Math.min(count, slot.count));
    if (moved === 0) {
      s.stats.events.packFull = (s.stats.events.packFull ?? 0) + 1;
      this.emit({ type: 'packFull', item: slot.item });
      return 0;
    }
    slot.count -= moved;
    if (slot.count <= 0) st.store![index] = null;
    this.worldVersion++;
    return moved;
  }

  // ------------------------------------------------------------------ repairs

  canRepair(tool: WearingTool, structureId: number): RepairCheck {
    const st = this.structures.find((x) => x.id === structureId);
    if (!st || !PREFABS[st.prefab].workbench) return { ok: false, reason: 'gone' };
    if (!canUseTribeStructure(this.state, st)) return { ok: false, reason: 'reputation' };
    return canRepair(this.state, tool);
  }

  /** Pay for and start mending `tool` at workbench `structureId`. You can look around but not move until it's done. */
  startRepair(tool: WearingTool, structureId: number): RepairCheck {
    const check = this.canRepair(tool, structureId);
    if (!check.ok) return check;
    const s = this.state;
    const level = toolLevel(s, tool);
    const paid = repairCost(tool, level);
    removeAll(s.inventory, paid);
    s.repair = { tool, structure: structureId, elapsed: 0, duration: repairSeconds(level), paid: paid.map((c) => ({ ...c })) };
    this.standUp();
    this.placement = null;
    this.bowDraw = -1;
    this.endFishing('reeled');
    const p = s.player;
    p.vx = 0;
    p.vz = 0;
    this.emit({ type: 'repairStarted', tool, duration: s.repair.duration });
    return check;
  }

  /** 0..1 progress of the repair under way, or null. */
  get repairProgress(): number | null {
    const r = this.state.repair;
    return r ? Math.min(1, r.elapsed / r.duration) : null;
  }

  private updateRepair(dt: number): void {
    const s = this.state;
    const r = s.repair;
    if (!r) return;
    if (!s.tools.includes(r.tool)) return this.cancelRepair('Your tool is gone.');
    if (!this.structures.some((x) => x.id === r.structure && PREFABS[x.prefab].workbench)) return this.cancelRepair('The workbench is gone.');
    r.elapsed += dt;
    if (r.elapsed < r.duration) return;
    s.repair = undefined;
    const w = s.toolWear[r.tool];
    if (w) w.dur = w.max;
    s.stats.events.repairs = (s.stats.events.repairs ?? 0) + 1;
    spendEnergy(s.needs, BALANCE.needs.energy.craftCost);
    this.gainXp('crafting', BALANCE.skills.xp.craft);
    this.emit({ type: 'repaired', tool: r.tool });
    this.message(`${TOOLS[r.tool].name} repaired to full condition.`, 'good');
  }

  /** Stop a repair part-way and get its materials back (whatever doesn't fit the pack drops at your feet). */
  cancelRepair(reason = 'Repair interrupted.'): void {
    const s = this.state;
    const r = s.repair;
    if (!r) return;
    s.repair = undefined;
    const p = s.player;
    for (const c of r.paid) {
      const left = c.count - addItem(s.inventory, c.item, c.count);
      this.dropAt(c.item, left, p.x, p.z);
    }
    this.emit({ type: 'repairCancelled', tool: r.tool });
    this.message(`${reason} Your materials are back in your pack.`, 'warn');
  }

  // ------------------------------------------------------------------ upgrades

  canUpgradeTool(tool: ToolId): UpgradeCheck {
    return canUpgradeTool(this.state, tool);
  }

  /** Upgrade a tool on your belt with materials from your pack. Upgrades are personal, like the pack. */
  upgradeTool(tool: ToolId): UpgradeCheck {
    const s = this.state;
    const res = applyToolUpgrade(s, tool);
    if (!res.ok || !isUpgradable(tool)) return res;
    const level = s.toolLevels[tool]!;
    spendEnergy(s.needs, BALANCE.needs.energy.craftCost);
    s.stats.events.toolUpgrades = (s.stats.events.toolUpgrades ?? 0) + 1;
    this.emit({ type: 'upgraded', tool, level });
    this.message(`${TOOLS[tool].name} upgraded to ${LEVEL_NUMERALS[level]}: ${TOOL_UPGRADES[tool][level - 1].name}.`, 'good');
    this.gainXp('crafting', practiceXp(BALANCE.skills.xp.equipment, TOOL_UPGRADES[tool][level - 1].requiredLevel));
    this.progress();
    return res;
  }

  /** Whether shelter or storage `id` can be upgraded in place into its next tier right now. */
  canUpgradeStructure(id: number): UpgradeCheck {
    const fail = (reason: UpgradeCheck['reason']): UpgradeCheck => ({ ok: false, reason });
    const st = this.structures.find((x) => x.id === id);
    if (!st) return fail('gone');
    if (st.settlement) return fail('fixed');
    if (!tierLine(st.prefab)) return fail('fixed');
    const next = nextTier(st.prefab);
    if (!next) return fail('maxed');
    if (!meetsSkill(this.state, 'crafting', STRUCTURE_LEVELS[next])) return fail('skill');
    if (!hasAll(this.state.inventory, tierCost(next)!)) return fail('missing');
    if (checkUpgradeRoom(this.placementEnv(), next, st.x, st.z, st.rot, st.id)) return fail('blocked');
    return { ok: true, reason: null };
  }

  /** Why an upgrade into the next tier has no room (null when it fits), for the structure menu. */
  upgradeBlocker(id: number): PlacementReason | null {
    const st = this.structures.find((x) => x.id === id);
    const next = st ? nextTier(st.prefab) : null;
    return st && next ? checkUpgradeRoom(this.placementEnv(), next, st.x, st.z, st.rot, st.id) : null;
  }

  /**
   * Rebuild shelter or storage `id` in place as its next tier: a new shape, fresh condition and better sleep for a
   * shelter, more slots (with everything still inside) for storage.
   */
  upgradeStructure(id: number): UpgradeCheck {
    const check = this.canUpgradeStructure(id);
    if (!check.ok) return check;
    const s = this.state;
    const st = this.structures.find((x) => x.id === id)!;
    const from = st.prefab;
    const next = nextTier(from)!;
    removeAll(s.inventory, tierCost(next)!);
    st.prefab = next;
    if (prefabWears(next)) st.wear = newStructureWear(next, s.skills.crafting);
    if (PREFABS[next].storage) ensureStore(st);
    this.reshapeStructure(st);
    s.stats.crafted[next] = (s.stats.crafted[next] ?? 0) + 1;
    if (PREFABS[next].shelter) s.stats.events.shelterUpgrades = (s.stats.events.shelterUpgrades ?? 0) + 1;
    else s.stats.events.storageUpgrades = (s.stats.events.storageUpgrades ?? 0) + 1;
    spendEnergy(s.needs, BALANCE.needs.energy.buildCost);
    this.emit({ type: 'upgraded', structure: st.id, from, prefab: next });
    this.gainXp('crafting', practiceXp(BALANCE.skills.xp.build, STRUCTURE_LEVELS[st.prefab]));
    this.progress();
    return check;
  }

  /** A structure changed prefab (an upgrade, here or from the network): swap its collider. */
  private reshapeStructure(st: StructureState): void {
    const c = this.structureColliders.get(st.id);
    if (c) this.colliders.remove(c);
    this.addStructureCollider(st);
    this.worldVersion++;
  }

  // ------------------------------------------------------------------ multiplayer

  /** Get up without waiting for the others. */
  getUp(): void {
    if (this.sleepingIn === null) return;
    this.sleepingIn = null;
    this.netOut.push({ k: 'wake' });
  }

  /** Host, once everyone is asleep: the world half of a night's sleep. Returns the game hours skipped. */
  skipNight(sleepers: readonly { x: number; z: number }[]): number {
    const s = this.state;
    const before = s.totalHours;
    s.totalHours = nextDayStart(s.totalHours);
    this.advanceCalendarAtDawn();
    const elapsed = s.totalHours - before;
    for (const f of this.structures) if (PREFABS[f.prefab].fire && f.fuel > 0) f.fuel = Math.max(0, f.fuel - elapsed);
    this.refreshLitFires();
    this.updateWear(elapsed, false, true, false);
    s.animals = s.animals.filter((a) => SPECIES[a.species].kind !== 'pest');
    for (const a of s.animals) {
      if (SPECIES[a.species].kind !== 'predator') continue;
      a.mode = 'wander';
      a.timer = 5;
      a.aggroCooldown = 10;
      if (sleepers.some((q) => Math.hypot(a.x - q.x, a.z - q.z) < 60)) {
        a.x = a.homeX;
        a.z = a.homeZ;
        a.y = this.terrain.heightAt(a.x, a.z);
      }
    }
    this.wasNight = this.night;
    this.worldVersion++;
    return elapsed;
  }

  /** Every client, at the shared dawn: the personal half of a night's sleep. */
  wakeUp(elapsed: number): void {
    const id = this.sleepingIn;
    if (id === null) return;
    this.sleepingIn = null;
    const s = this.state;
    const st = this.structures.find((x) => x.id === id);
    const rest = st ? restBonus(st.prefab) : id === -1 ? { warmthBonus: 0, healthBonus: 0 } : null;
    const coldLethal = dayOf(Math.max(0, s.totalHours - elapsed)) > BALANCE.needs.coldGraceNights;
    const night = rest ? applySleep(s.needs, rest, this.sleepByFire, elapsed, coldLethal, this.sleepClimate) : null;
    this.updateWear(elapsed, false, false);
    if (st && prefabWears(st.prefab)) this.wearStructure(st, BALANCE.durability.structures[st.prefab].useCost);
    this.wasNight = this.night;
    s.stats.events.slept = (s.stats.events.slept ?? 0) + 1;
    this.worldVersion++;
    this.emit({ type: 'slept', day: this.day, byFire: this.sleepByFire, passedOut: id === -1 });
    this.emit({ type: 'dayStart', day: this.day });
    if (night) this.afterNight(night);
    this.progress();
  }

  /** Guest: follow the host's clock, snapping on large drift and easing out small drift. */
  followClock(hours: number, timeScale: number): void {
    const s = this.state;
    this.timeScale = timeScale;
    const prevDay = this.day;
    const d = hours - s.totalHours;
    // A dawn correction must snap even a tiny drift, so guests apply the host's daily weather to the same day.
    s.totalHours = Math.abs(d) > 0.05 || dayOf(hours) !== prevDay ? hours : s.totalHours + d * 0.3;
    if (this.day !== prevDay) this.emit({ type: 'dayStart', day: this.day });
  }

  /** Multiplayer death: the pack spills onto the ground as a pile anyone can loot. */
  dropPack(): void {
    const s = this.state;
    const p = s.player;
    s.inventory.slots.forEach((slot, i) => {
      if (!slot) return;
      const a = i * 2.4;
      const r = 0.3 + 0.14 * i;
      this.dropAt(slot.item, slot.count, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      s.inventory.slots[i] = null;
    });
  }

  /** Multiplayer respawn: a fresh character at the world spawn in the same, still-running world. */
  respawn(): void {
    const s = this.state;
    s.player = spawnPlayer(this.terrain);
    s.needs = createNeeds();
    s.inventory = createInventory(BALANCE.carry.baseSlots);
    s.canteen = emptyCanteen();
    s.tools = ['hands'];
    s.activeTool = 'hands';
    s.toolWear = {};
    s.toolLevels = {};
    s.gear = [];
    s.skills = createSkills();
    s.forage = [];
    s.stats = { gathered: {}, crafted: {}, events: {}, kills: {} };
    s.objective = 0;
    s.dead = false;
    s.deathCause = null;
    s.lastDamage = null;
    s.repair = undefined;
    this.sleepingIn = null;
    this.placement = null;
    this.bowDraw = -1;
    this.fishing = null;
    this.projectiles.length = 0;
  }

  /** Guest: the host reports that this player's hit (with `tool`, when known) killed an animal. */
  creditKill(species: SpeciesId, tool: ToolId | null = null): void {
    const s = this.state;
    this.recordKill(species, tool);
    if (this.canHunt(species)) this.gainXp('hunting', practiceXp(BALANCE.skills.xp.kill, ANIMAL_LEVELS[species].hunt));
    const def = SPECIES[species];
    if (def.habitat === 'water' && def.drops.length > 0 && this.give('rawFish', 1, s.player.x, s.player.y + 1, s.player.z, 'carcass') > 0) {
      this.message(`Caught a ${species === 'fish' ? fishWord(this.terrain, s.player.x, s.player.z) : speciesName(species, this.biome).toLowerCase()}!`, 'good');
    }
    this.progress();
  }

  /** Host: a remote player's hit on an animal (damage already includes their hunting skill). */
  applyRemoteHit(pid: string, id: number, damage: number, fromX: number, fromZ: number, tool: ToolId | null = null): void {
    const a = this.state.animals.find((x) => x.id === id);
    if (!a || animalHidden(a)) return;
    this.animalEnv.playerX = fromX;
    this.animalEnv.playerZ = fromZ;
    if (damageAnimal(a, damage, this.animalEnv)) this.killAnimal(a, pid, tool);
  }

  /** Remote world state: replace tree `i`, keeping colliders in step. */
  setTree(i: number, v: TreeDyn): void {
    const dyn = this.state.trees[i];
    if (!dyn) return;
    const wasFelled = dyn.felled;
    Object.assign(dyn, v);
    if (wasFelled !== dyn.felled) {
      this.colliders.remove(this.treeColliders[i]);
      this.treeColliders[i] = this.colliders.add(this.makeTreeCollider(i, dyn.felled));
    }
    this.syncTrunkCollider(i);
    this.worldVersion++;
  }

  setResource(i: number, v: ResourceDyn): void {
    const dyn = this.state.resources[i];
    if (!dyn) return;
    // A stone pile's scorpion, once out, stays out: no update can put another one back under it.
    const scorpion = dyn.scorpion || v.scorpion;
    Object.assign(dyn, v);
    if (scorpion) dyn.scorpion = true;
    this.worldVersion++;
  }

  putStructure(v: StructureState): void {
    const s = this.state;
    const st = s.structures.find((x) => x.id === v.id);
    if (st) {
      const reshaped = st.prefab !== v.prefab;
      Object.assign(st, v, { store: cloneStore(v.store) });
      if (reshaped) this.reshapeStructure(st);
    } else {
      const copy = { ...v, store: cloneStore(v.store) };
      s.structures.push(copy);
      this.addStructureCollider(copy);
    }
    this.refreshLitFires();
    this.worldVersion++;
  }

  deleteStructure(id: number): void {
    const st = this.structures.find((x) => x.id === id);
    if (!st || st.settlement) return;
    this.removeStructure(st);
    this.refreshLitFires();
  }

  putDrop(v: DropState): void {
    const s = this.state;
    const d = s.drops.find((x) => x.id === v.id);
    if (d) Object.assign(d, v);
    else s.drops.push({ ...v });
    this.worldVersion++;
  }

  deleteDrop(id: number): void {
    const s = this.state;
    const i = s.drops.findIndex((x) => x.id === id);
    if (i < 0) return;
    s.drops.splice(i, 1);
    this.worldVersion++;
  }

  putCarcass(v: CarcassState): void {
    const s = this.state;
    const i = s.carcasses.findIndex((x) => x.id === v.id);
    const copy = { ...v, remaining: v.remaining.map((r) => ({ ...r })) };
    if (i >= 0) s.carcasses[i] = copy;
    else s.carcasses.push(copy);
    this.worldVersion++;
  }

  deleteCarcass(id: number): void {
    const s = this.state;
    const i = s.carcasses.findIndex((x) => x.id === id);
    if (i < 0) return;
    s.carcasses.splice(i, 1);
    this.worldVersion++;
  }

  currentObjective(): { title: string; hint: string; needs: ObjectiveNeed[] } | null {
    const o = OBJECTIVES[this.state.objective];
    if (!o) return null;
    return { ...objectiveText(o, this.biome), needs: o.needs(this.state) };
  }

  capacity(): number {
    return slotsFor(this.state);
  }

  // ------------------------------------------------------------------ dev helpers

  devSetSeason(id: Season): boolean {
    if (this.biome !== 'pnw' || this.authority === 'guest') return false;
    this.followSeason({ id, startDay: this.day });
    this.followWeather(this.state.weather);
    this.message(`Dev: ${SEASON_NAMES[id]}, day 1 of 25.`, 'good');
    return true;
  }

  devSetWeather(id: Weather): boolean {
    if (!this.state.season || this.authority === 'guest') return false;
    this.followWeather(this.state.weather);
    this.state.weather!.id = weatherForSeason(id, this.state.season.id);
    this.message(`Dev: ${WEATHER_NAMES[this.state.weather!.id]} until next dawn.`, 'good');
    return true;
  }

  devResetWeather(): boolean {
    if (!this.state.weather || this.authority === 'guest') return false;
    this.followWeather(this.state.weather);
    const w = this.state.weather!;
    w.id = w.pattern[clamp(this.day - w.startDay, 0, w.pattern.length - 1)];
    return true;
  }

  devGive(item: ItemId, count: number): number {
    return this.give(item, count, this.state.player.x, this.state.player.y + 1, this.state.player.z, 'craft');
  }

  devSetHour(hour: number): void {
    const s = this.state;
    const dayBase = Math.floor(s.totalHours / 24) * 24;
    let h = hour - BALANCE.time.dayStartHour;
    if (h < 0) h += 24;
    s.totalHours = dayBase + h;
    this.wasNight = this.night;
  }

  /** Jumps to just before the next dawn, so the next step starts the new day as usual (and lifts the day-1 limit). */
  devNextMorning(): void {
    const s = this.state;
    s.totalHours = (Math.floor(s.totalHours / 24) + 1) * 24 - 0.001;
    this.wasNight = this.night;
  }

  devSpawn(species: SpeciesId, distance = 22): AnimalState | null {
    if (species === 'bear' && this.frozen) return null;
    const p = this.state.player;
    if (SPECIES[species].habitat === 'water') {
      // Swimmers go in the nearest water they live in.
      for (let r = 4; r < 160; r += 4) {
        for (let k = 0; k < 24; k++) {
          const x = p.x + Math.cos((k / 24) * Math.PI * 2) * r;
          const z = p.z + Math.sin((k / 24) * Math.PI * 2) * r;
          if (!isHabitable(this.terrain, species, x, z)) continue;
          const a = createAnimal(this.state.nextId++, species, x, z, this.rng, this.terrain);
          this.state.animals.push(a);
          return a;
        }
      }
      return null;
    }
    for (let i = 0; i < 24; i++) {
      const ang = p.yaw + Math.PI + (i * Math.PI * 2) / 24;
      const x = p.x - Math.sin(ang) * distance;
      const z = p.z - Math.cos(ang) * distance;
      const d = lookDir(p.yaw, 0, this.look);
      const fx = p.x + d.x * distance;
      const fz = p.z + d.z * distance;
      const tx = i === 0 ? fx : x;
      const tz = i === 0 ? fz : z;
      if (SPECIES[species].habitat === 'land' && this.terrain.heightAt(tx, tz) > 0.3 && this.terrain.slopeAt(tx, tz) < 0.8) {
        const a = createAnimal(this.state.nextId++, species, tx, tz, this.rng, this.terrain);
        this.state.animals.push(a);
        return a;
      }
    }
    return null;
  }

  devDamage(amount: number): void {
    const s = this.state;
    s.player.hurtTimer = 0;
    this.hurtPlayer(amount, 'dev', s.player.x + 1, s.player.z);
  }
}

const NO_SHELTER = { warmthBonus: 0, healthBonus: 0 };
/** Half-angle of a cave's open mouth, in radians. */
const CAVE_MOUTH = 0.5;
/** How a night spent with an empty meter reads in the wake-up message. */
const SLEPT_EMPTY: Partial<Record<DamageSource, string>> = { starvation: 'hungry', dehydration: 'thirsty', cold: 'cold' };

const STILL = { jumped: false, landed: 0, distance: 0, splash: 0 };

/** Where you sit on a bench and which way you face. */
export interface Seat {
  x: number;
  z: number;
  yaw: number;
}

/** How far along the bench you can sit from its middle, so you stay clear of the ends. */
const BENCH_SEAT_REACH = 0.7;
/** Hips sit this far in front of the bench's centre line, toward the side you face. */
const BENCH_SEAT_FORWARD = 0.04;
/** Standing up puts you clear of the bench's collider. */
const BENCH_STAND_OFF = 0.3 + BALANCE.player.radius + 0.1;

/**
 * The seat a player at (p.x, p.z) takes on bench `st`: on the seat's centre line, level with where they stand along
 * its length, facing out over the long side they walked up to (a bench runs along its local x axis).
 */
export function seatFor(st: StructureState, p: { x: number; z: number }): Seat {
  const c = Math.cos(st.rot);
  const sn = Math.sin(st.rot);
  const dx = p.x - st.x;
  const dz = p.z - st.z;
  const lx = clamp(dx * c - dz * sn, -BENCH_SEAT_REACH, BENCH_SEAT_REACH);
  const side = dx * sn + dz * c >= 0 ? 1 : -1;
  const lz = side * BENCH_SEAT_FORWARD;
  // Facing local +z (or -z) in world space is (sin rot, cos rot) times the side.
  const yaw = Math.atan2(-side * sn, -side * c);
  return { x: st.x + lx * c + lz * sn, z: st.z - lx * sn + lz * c, yaw };
}

/** What sleeping at a structure gives: a shelter's bonuses, nothing extra by a campfire, null where you can't sleep. */
function restBonus(prefab: PrefabId): { warmthBonus: number; healthBonus: number } | null {
  const def = PREFABS[prefab];
  return def.shelter ?? (def.fire ? NO_SHELTER : null);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function conditionText(w: Wear): string {
  return `${Math.max(1, Math.round(wearFraction(w) * 100))}% condition`;
}

/** Hearty campfire dishes can char; drinks (boiled water, tea) can't. */
function canBurn(item: ItemId): boolean {
  const def = ITEMS[item];
  return !!def.meal && !def.water;
}

function removeAllDryRun(state: GameState, inputs: readonly { item: ItemId; count: number }[]): boolean {
  return hasItems(state, inputs);
}
