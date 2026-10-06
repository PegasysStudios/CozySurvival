import { DEFAULT_BIOME, isBiomeId, type BiomeId } from '../data/biomes';
import { forageGuideFor, type ForageId } from '../data/forage';
import { ITEMS, type ItemId, type ToolId } from '../data/items';
import { advanceObjectives, LEGACY_OBJECTIVE_COUNT, NIGHT_FROM, NIGHT_STEP, OBJECTIVES } from '../data/objectives';
import { PREFABS } from '../data/prefabs';
import { RESOURCES, TREES } from '../data/resources';
import { SPECIES } from '../data/species';
import { isUpgradable, MAX_TOOL_LEVEL } from '../data/upgrades';
import { BALANCE } from '../data/balance';
import { canteenServings, emptyCanteen, migratePackWater } from './canteen';
import { normalizeCarcass } from './carcass';
import { parsePins } from './checklist';
import { newStructureWear, prefabWears, toolWears } from './durability';
import { addItem } from './inventory';
import { seatHeight } from './placement';
import { parseStore } from './storage';
import { createSkills, migrateSkillXp, SKILL_IDS, xpForLevel, MAX_SKILL_LEVEL } from './skills';
import { STATE_VERSION, type CarcassState, type GameState, type RepairState, type ResourceDyn, type StructureState, type TreeDyn, type Wear } from './state';
import { freshTree } from './trunks';
import { getTerrain } from './terrain';
import { dayOf } from './time';
import { parseSeason } from './seasons';
import { parseWeather } from './weather';
import { getWorldGen, WORLD_REVISION } from './worldgen';

export const SAVE_FORMAT = 'cozysurvival-save';

/**
 * Serializes a run. Trees and resources are stored sparsely (only entries that differ from worldgen
 * defaults) so saves stay small even with ~1000 trees. Resources are keyed by their worldgen spot, which is
 * the same number older saves used as the resource index, so thinning forage never shifts saved state.
 */
export function serializeState(s: GameState): string {
  const gen = getWorldGen(s.seed, s.biome, s.pnwGen ?? 1);
  const trees: number[][] = [];
  s.trees.forEach((t, i) => {
    const def = TREES[gen.trees[i].species];
    if (t.felled || t.hp !== def.hp || t.bark !== def.bark) trees.push([i, t.hp, t.felled ? 1 : 0, t.bark, t.barkAt, t.logs, t.cuts, t.fall]);
  });
  const resources: number[][] = [];
  s.resources.forEach((r, i) => {
    const def = RESOURCES[gen.resources[i].kind];
    // A fourth entry of 1 marks a stone pile that has already turned up its scorpion.
    if (r.scorpion) resources.push([gen.resources[i].spot, r.charges, r.respawnAt, 1]);
    else if (r.charges !== def.charges) resources.push([gen.resources[i].spot, r.charges, r.respawnAt]);
  });
  const out: Record<string, unknown> = { ...s, format: SAVE_FORMAT };
  out.trees = trees;
  out.resources = resources;
  const rev = WORLD_REVISION[s.biome ?? DEFAULT_BIOME];
  if (rev) out.worldRev = rev;
  return JSON.stringify(out);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const REQUIRED_OBJECTS = ['player', 'needs', 'inventory', 'stats'] as const;
const REQUIRED_ARRAYS = ['tools', 'gear', 'structures', 'drops', 'carcasses', 'animals', 'trees', 'resources'] as const;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseWear(v: unknown): Wear | null {
  if (!isObj(v)) return null;
  const max = num(v.max, 0);
  if (max <= 0) return null;
  return { dur: Math.min(max, Math.max(0, num(v.dur, max))), max };
}

/**
 * Parses a save. Returns null for corrupt JSON, wrong format, unknown version, or missing fields.
 * Version 1 saves (before skills, durability, two-step trees and swimming) are migrated: skills start at 0,
 * owned tools get fresh durability on first use, existing shelters and benches start at full condition,
 * and trees felled back then (whose wood was already collected) leave no trunk behind.
 * Version 2 saves (before round 5) are migrated too: tools start at upgrade level 0, lean-tos and hide tents are
 * simply the first and last shelter tiers, the Foraging guide unlocks every plant already harvested, and the
 * onboarding position is replayed against the new track (a finished old track stays finished).
 * Version 3 saves (before round 8) carried water in pack slots: it is poured into the canteen, up to its capacity.
 * Version 4 desert saves (before round 9) were made on the old desert: its trees and plants start fresh, and
 * structures, drops and carcasses settle onto the new ground. Pacific Northwest saves load unchanged.
 * Version 5 saves (before round 10) come forward too: their onboarding position moves past the new "Survive the
 * night" step (a finished track lands on the new knife step), a save already past day 1 counts its night as survived,
 * and carcasses whose hide was already taken count as skinned.
 * Versions 1..6 retain their earned skill levels/progress on the slower level-50 curve.
 */
export function deserializeState(json: string | null): GameState | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.format !== SAVE_FORMAT) return null;
  const version = raw.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== STATE_VERSION) return null;
  if (typeof raw.seed !== 'number' || typeof raw.totalHours !== 'number') return null;
  for (const k of REQUIRED_OBJECTS) if (!isObj(raw[k])) return null;
  for (const k of REQUIRED_ARRAYS) if (!Array.isArray(raw[k])) return null;
  const inv = raw.inventory as Record<string, unknown>;
  if (!Array.isArray(inv.slots)) return null;
  // Saves without a map are from the Pacific Northwest (everything before the desert).
  if (raw.biome !== undefined && !isBiomeId(raw.biome)) return null;
  const biome: BiomeId = isBiomeId(raw.biome) ? raw.biome : DEFAULT_BIOME;

  // A missing marker pins old forests to their original terrain, RNG draws and saved indices.
  if (biome === 'pnw' && raw.pnwGen !== undefined && raw.pnwGen !== 1 && raw.pnwGen !== 2) return null;
  const pnwGen = biome === 'pnw' && raw.pnwGen === 2 ? 2 : 1;
  const gen = getWorldGen(raw.seed, biome, pnwGen);
  // Round 9 reshaped the desert around its pools and scattered stones in place of the pebbles, and a map whose
  // WORLD_REVISION has moved on since the save was written has regrown too, so an older save's trees and plants no
  // longer line up with the world: they start fresh.
  const rev = WORLD_REVISION[biome];
  const regrown = (biome === 'desert' && version < 5) || (rev !== undefined && num(raw.worldRev, 1) < rev);
  const trees: TreeDyn[] = gen.trees.map((t) => freshTree(t.species));
  if (!regrown) for (const e of raw.trees as unknown[]) {
    if (!Array.isArray(e) || e.length < 5) return null;
    const [i, hp, felled, bark, barkAt, logs, cuts, fall] = e as number[];
    if (!trees[i]) return null;
    const isFelled = felled === 1;
    trees[i] = {
      hp, felled: isFelled, bark, barkAt,
      logs: isFelled ? Math.max(0, Math.min(TREES[gen.trees[i].species].logs, Math.floor(num(logs, 0)))) : 0,
      cuts: isFelled ? Math.max(0, num(cuts, 0)) : 0,
      fall: num(fall, 0),
    };
  }
  const resources: ResourceDyn[] = gen.resources.map((r) => ({ charges: RESOURCES[r.kind].charges, respawnAt: 0 }));
  const bySpot = new Map(gen.resources.map((r, i) => [r.spot, i]));
  if (!regrown) for (const e of raw.resources as unknown[]) {
    if (!Array.isArray(e) || e.length < 3) return null;
    const [spot, charges, respawnAt, scorpion] = e as number[];
    if (!Number.isInteger(spot) || spot < 0 || spot >= gen.resourceSpots) return null;
    const i = bySpot.get(spot);
    // Saves from before forage was thinned can mention spots where nothing grows any more.
    if (i === undefined) continue;
    resources[i] = scorpion === 1 && gen.resources[i].kind === 'stonePile' ? { charges, respawnAt, scorpion: true } : { charges, respawnAt };
  }
  const skills = createSkills();
  if (isObj(raw.skills)) for (const id of SKILL_IDS) {
    const xp = Math.max(0, num(raw.skills[id], 0));
    skills[id] = Math.min(xpForLevel(MAX_SKILL_LEVEL), version < 7 ? migrateSkillXp(xp) : xp);
  }
  const toolWear: GameState['toolWear'] = {};
  if (isObj(raw.toolWear)) {
    for (const [tool, w] of Object.entries(raw.toolWear)) {
      const parsed = parseWear(w);
      if (parsed) toolWear[tool as ToolId] = parsed;
    }
  }
  const toolLevels: GameState['toolLevels'] = {};
  if (isObj(raw.toolLevels)) {
    for (const [tool, lv] of Object.entries(raw.toolLevels)) {
      const n = Math.floor(num(lv, 0));
      if (isUpgradable(tool as ToolId) && n > 0) toolLevels[tool as ToolId] = Math.min(MAX_TOOL_LEVEL, n);
    }
  }
  const stats = raw.stats as unknown as GameState['stats'];
  const guide = forageGuideFor(biome);
  const forageIds = new Set<string>(guide.map((f) => f.id));
  const forage: ForageId[] = Array.isArray(raw.forage)
    ? (raw.forage as unknown[]).filter((f): f is ForageId => typeof f === 'string' && forageIds.has(f))
    : guide.filter((f) => (isObj(stats.gathered) ? num(stats.gathered[f.item], 0) : 0) > 0).map((f) => f.id);
  const structures = (raw.structures as StructureState[]).filter((st) => isObj(st) && st.prefab in PREFABS).map((st) => {
    if (PREFABS[st.prefab].storage) return { ...st, store: parseStore(st.store, st.prefab) };
    if (!prefabWears(st.prefab)) return st;
    const wear = version === 1 ? newStructureWear(st.prefab, 0) : parseWear(st.wear);
    return wear ? { ...st, wear } : st;
  });
  const rawPlayer = raw.player as Record<string, unknown>;
  const player = { ...rawPlayer, swimming: rawPlayer.swimming === true };
  const seat = parseSeat(rawPlayer.seat, structures);
  // Before round 8 sitting only lowered the camera where you stood; stand those players up.
  if (seat) Object.assign(player, { sitting: true, seat });
  else Object.assign(player, { sitting: false, seat: undefined });
  const rawCanteen = isObj(raw.canteen) ? raw.canteen : {};
  const canteen = { lakeWater: servings(rawCanteen.lakeWater), boiledWater: servings(rawCanteen.boiledWater) };

  const carcasses = (raw.carcasses as CarcassState[]).filter((c) => isObj(c) && c.species in SPECIES && Array.isArray(c.remaining)).map(normalizeCarcass);
  const state = { ...raw, version: STATE_VERSION, player, canteen, skills, toolWear, toolLevels, forage, structures, trees, resources, carcasses } as unknown as GameState & { format?: string; known?: unknown };
  delete state.format;
  delete (state as { worldRev?: unknown }).worldRev;
  // Saves from before round 6 list learned recipes; every recipe is available now.
  delete state.known;
  if (biome !== 'pnw') { delete state.pnwGen; delete state.pnwWildlife; }
  if (biome === 'pnw') {
    state.season = parseSeason(raw.season, state.totalHours);
    state.weather = parseWeather(raw.weather, state.seed, state.totalHours, state.season);
  } else {
    delete state.season;
    delete state.weather;
  }
  // Round 10: a save already past day 1 has survived its night, so the new night step never holds it back.
  if (version < 6 && dayOf(state.totalHours) > 1 && !num(state.stats.events?.[NIGHT_FROM], 0)) {
    state.stats.events = { ...(state.stats.events ?? {}), [NIGHT_FROM]: 1 };
  }
  if (version < 3) {
    const wasDone = num(raw.objective, 0) >= LEGACY_OBJECTIVE_COUNT;
    state.objective = wasDone ? OBJECTIVES.length : 0;
    if (!wasDone) advanceObjectives(state);
  } else if (version < 6) {
    // Round 10 put "Survive the night" in the middle of the track and the knife step at its end.
    const old = Math.max(0, Math.floor(num(raw.objective, 0)));
    state.objective = Math.min(OBJECTIVES.length - 1, old >= NIGHT_STEP ? old + 1 : old);
    advanceObjectives(state);
  }
  // Water used to ride in pack slots; it lives in the canteen now.
  if (!state.gear.includes('canteen')) state.canteen = emptyCanteen();
  const extra = canteenServings(state) - BALANCE.carry.canteenCapacity;
  if (extra > 0) state.canteen.lakeWater = Math.max(0, state.canteen.lakeWater - extra);
  migratePackWater(state);
  const repair = parseRepair(raw.repair, state);
  if (repair) state.repair = repair;
  else delete state.repair;
  const pinned = parsePins(raw.pinned, biome);
  if (pinned.length) state.pinned = pinned;
  else delete state.pinned;
  if (regrown) settleOnNewGround(state);
  return state;
}

/** Seats structures, drops and carcasses on the reshaped ground; people and animals find it themselves as they move. */
function settleOnNewGround(s: GameState): void {
  const t = getTerrain(s.seed, s.biome, s.pnwGen ?? 1);
  for (const st of s.structures) st.y = seatHeight(t, st.prefab, st.x, st.z, st.rot);
  for (const d of s.drops) d.y = t.heightAt(d.x, d.z);
  for (const c of s.carcasses) c.y = t.heightAt(c.x, c.z);
}

/** A repair saved part-way through resumes if its tool and workbench are still there; otherwise its materials come back. */
function parseRepair(v: unknown, s: GameState): RepairState | null {
  if (!isObj(v)) return null;
  const paid = Array.isArray(v.paid)
    ? (v.paid as unknown[]).filter((c): c is { item: ItemId; count: number } => isObj(c) && typeof c.item === 'string' && c.item in ITEMS && typeof c.count === 'number' && c.count > 0)
    : [];
  const tool = v.tool as ToolId;
  const ok = typeof tool === 'string' && toolWears(tool) && s.tools.includes(tool) && s.structures.some((st) => st.id === v.structure && PREFABS[st.prefab].workbench);
  if (!ok) {
    for (const c of paid) addItem(s.inventory, c.item, Math.floor(c.count));
    return null;
  }
  const duration = Math.max(0.1, num(v.duration, 1));
  return { tool, structure: v.structure as number, elapsed: Math.min(duration, Math.max(0, num(v.elapsed, 0))), duration, paid: paid.map((c) => ({ item: c.item, count: Math.floor(c.count) })) };
}

const servings = (v: unknown) => Math.max(0, Math.floor(num(v, 0)));

function parseSeat(v: unknown, structures: StructureState[]): { id: number; yaw: number } | null {
  if (!isObj(v) || typeof v.id !== 'number') return null;
  const st = structures.find((s) => s.id === v.id);
  if (!st || !PREFABS[st.prefab].seat) return null;
  return { id: v.id, yaw: num(v.yaw, st.rot) };
}
