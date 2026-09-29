import type { ToolId } from '../data/items';
import { RESOURCES, TREES } from '../data/resources';
import { newStructureWear, prefabWears } from './durability';
import { createSkills, SKILL_IDS } from './skills';
import { STATE_VERSION, type GameState, type ResourceDyn, type StructureState, type TreeDyn, type Wear } from './state';
import { freshTree } from './trunks';
import { getWorldGen } from './worldgen';

export const SAVE_FORMAT = 'cozysurvival-save';

/**
 * Serializes a run. Trees and resources are stored sparsely (only entries that differ from worldgen
 * defaults) so saves stay small even with ~1000 trees.
 */
export function serializeState(s: GameState): string {
  const gen = getWorldGen(s.seed);
  const trees: number[][] = [];
  s.trees.forEach((t, i) => {
    const def = TREES[gen.trees[i].species];
    if (t.felled || t.hp !== def.hp || t.bark !== def.bark) trees.push([i, t.hp, t.felled ? 1 : 0, t.bark, t.barkAt, t.logs, t.cuts, t.fall]);
  });
  const resources: number[][] = [];
  s.resources.forEach((r, i) => {
    const def = RESOURCES[gen.resources[i].kind];
    if (r.charges !== def.charges) resources.push([i, r.charges, r.respawnAt]);
  });
  const out: Record<string, unknown> = { ...s, format: SAVE_FORMAT };
  out.trees = trees;
  out.resources = resources;
  return JSON.stringify(out);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const REQUIRED_OBJECTS = ['player', 'needs', 'inventory', 'stats'] as const;
const REQUIRED_ARRAYS = ['tools', 'gear', 'known', 'structures', 'drops', 'carcasses', 'animals', 'trees', 'resources'] as const;

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
  if (version !== 1 && version !== STATE_VERSION) return null;
  if (typeof raw.seed !== 'number' || typeof raw.totalHours !== 'number') return null;
  for (const k of REQUIRED_OBJECTS) if (!isObj(raw[k])) return null;
  for (const k of REQUIRED_ARRAYS) if (!Array.isArray(raw[k])) return null;
  const inv = raw.inventory as Record<string, unknown>;
  if (!Array.isArray(inv.slots)) return null;

  const gen = getWorldGen(raw.seed);
  const trees: TreeDyn[] = gen.trees.map((t) => freshTree(t.species));
  for (const e of raw.trees as unknown[]) {
    if (!Array.isArray(e) || e.length < 5) return null;
    const [i, hp, felled, bark, barkAt, logs, cuts, fall] = e as number[];
    if (!trees[i]) return null;
    const isFelled = felled === 1;
    trees[i] = {
      hp, felled: isFelled, bark, barkAt,
      logs: isFelled ? Math.max(0, Math.min(TREES[gen.trees[i].species].logs, Math.floor(num(logs, 0)))) : 0,
      cuts: isFelled ? Math.max(0, Math.floor(num(cuts, 0))) : 0,
      fall: num(fall, 0),
    };
  }
  const resources: ResourceDyn[] = gen.resources.map((r) => ({ charges: RESOURCES[r.kind].charges, respawnAt: 0 }));
  for (const e of raw.resources as unknown[]) {
    if (!Array.isArray(e) || e.length < 3) return null;
    const [i, charges, respawnAt] = e as number[];
    if (!resources[i]) return null;
    resources[i] = { charges, respawnAt };
  }
  const skills = createSkills();
  if (isObj(raw.skills)) for (const id of SKILL_IDS) skills[id] = Math.max(0, num(raw.skills[id], 0));
  const toolWear: GameState['toolWear'] = {};
  if (isObj(raw.toolWear)) {
    for (const [tool, w] of Object.entries(raw.toolWear)) {
      const parsed = parseWear(w);
      if (parsed) toolWear[tool as ToolId] = parsed;
    }
  }
  const structures = (raw.structures as StructureState[]).map((st) => {
    if (!prefabWears(st.prefab)) return st;
    const wear = version === 1 ? newStructureWear(st.prefab, 0) : parseWear(st.wear);
    return wear ? { ...st, wear } : st;
  });
  const player = { ...(raw.player as Record<string, unknown>), swimming: (raw.player as Record<string, unknown>).swimming === true };

  const state = { ...raw, version: STATE_VERSION, player, skills, toolWear, structures, trees, resources } as unknown as GameState & { format?: string };
  delete state.format;
  return state;
}
