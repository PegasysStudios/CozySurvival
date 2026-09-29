import { RESOURCES, TREES } from '../data/resources';
import { STATE_VERSION, type GameState, type ResourceDyn, type TreeDyn } from './state';
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
    if (t.felled || t.hp !== def.hp || t.bark !== def.bark) trees.push([i, t.hp, t.felled ? 1 : 0, t.bark, t.barkAt]);
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

/** Parses a save. Returns null for corrupt JSON, wrong format/version, or missing fields. */
export function deserializeState(json: string | null): GameState | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.format !== SAVE_FORMAT || raw.version !== STATE_VERSION) return null;
  if (typeof raw.seed !== 'number' || typeof raw.totalHours !== 'number') return null;
  for (const k of REQUIRED_OBJECTS) if (!isObj(raw[k])) return null;
  for (const k of REQUIRED_ARRAYS) if (!Array.isArray(raw[k])) return null;
  const inv = raw.inventory as Record<string, unknown>;
  if (!Array.isArray(inv.slots)) return null;

  const gen = getWorldGen(raw.seed);
  const trees: TreeDyn[] = gen.trees.map((t) => ({ hp: TREES[t.species].hp, felled: false, bark: TREES[t.species].bark, barkAt: 0 }));
  for (const e of raw.trees as unknown[]) {
    if (!Array.isArray(e) || e.length < 5) return null;
    const [i, hp, felled, bark, barkAt] = e as number[];
    if (!trees[i]) return null;
    trees[i] = { hp, felled: felled === 1, bark, barkAt };
  }
  const resources: ResourceDyn[] = gen.resources.map((r) => ({ charges: RESOURCES[r.kind].charges, respawnAt: 0 }));
  for (const e of raw.resources as unknown[]) {
    if (!Array.isArray(e) || e.length < 3) return null;
    const [i, charges, respawnAt] = e as number[];
    if (!resources[i]) return null;
    resources[i] = { charges, respawnAt };
  }
  const state = { ...raw, trees, resources } as unknown as GameState & { format?: string };
  delete state.format;
  return state;
}
