import { BALANCE } from '../data/balance';
import { PREFABS } from '../data/prefabs';
import { RESOURCES, TREES } from '../data/resources';
import { DEFAULT_BIOME, isBiomeId, type BiomeId } from '../data/biomes';
import { createNewState, type Simulation } from '../sim/simulation';
import type { CarcassState, DropState, GameState, ResourceDyn, StructureState, TreeDyn } from '../sim/state';
import { addToStore, cloneStore, ensureStore, removeFromStore, sameStore, storeTotals } from '../sim/storage';
import { freshTree } from '../sim/trunks';
import { getWorldGen } from '../sim/worldgen';

/**
 * One change to the shared world. Values are full state, so applying one twice is harmless.
 * Guests also send `p`, the value they changed it from, so the host can merge simultaneous changes
 * (two players chopping the same tree both count).
 */
export type Delta =
  | { k: 't'; i: number; v: TreeDyn; p?: TreeDyn }
  | { k: 'r'; i: number; v: ResourceDyn; p?: ResourceDyn }
  | { k: 's'; v: StructureState; p?: StructureState | null }
  | { k: 'd'; v: DropState; p?: DropState | null }
  | { k: 'c'; v: CarcassState; p?: CarcassState | null }
  | { k: 's-' | 'd-' | 'c-'; id: number };

export function deltaKey(d: Delta): string {
  switch (d.k) {
    case 't':
    case 'r':
      return `${d.k}:${d.i}`;
    case 's':
    case 'd':
    case 'c':
      return `${d.k}:${d.v.id}`;
    default:
      return `${d.k[0]}:${d.id}`;
  }
}

const cloneStructure = (s: StructureState): StructureState => ({ ...s, wear: s.wear ? { ...s.wear } : undefined, store: cloneStore(s.store) });
const cloneCarcass = (c: CarcassState): CarcassState => ({ ...c, remaining: c.remaining.map((r) => ({ ...r })) });

function sameTree(a: TreeDyn, b: TreeDyn): boolean {
  return a.hp === b.hp && a.felled === b.felled && a.bark === b.bark && a.barkAt === b.barkAt && a.logs === b.logs && a.cuts === b.cuts && a.fall === b.fall;
}

function sameCarcass(a: CarcassState, b: CarcassState): boolean {
  return a.expiresAt === b.expiresAt && a.remaining.length === b.remaining.length && a.remaining.every((r, i) => r.count === b.remaining[i].count);
}

const sameResource = (a: ResourceDyn, b: ResourceDyn) => a.charges === b.charges && a.respawnAt === b.respawnAt && !!a.scorpion === !!b.scorpion;

/**
 * Remembers the world as last shared, and reports what changed since. The host is `tolerant`: campfire fuel
 * burning down and slow weathering are only reported once they add up, so ticks stay small.
 */
export class WorldTracker {
  private trees: (TreeDyn | null)[] = [];
  private resources: (ResourceDyn | null)[] = [];
  private readonly structures = new Map<number, StructureState>();
  private readonly drops = new Map<number, DropState>();
  private readonly carcasses = new Map<number, CarcassState>();
  private readonly dirty = new Set<string>();
  private readonly tolerant: boolean;

  constructor(sim: Simulation, tolerant: boolean) {
    this.tolerant = tolerant;
    this.reset(sim);
  }

  reset(sim: Simulation): void {
    const s = sim.state;
    this.trees = s.trees.map((t) => ({ ...t }));
    this.resources = s.resources.map((r) => ({ ...r }));
    this.structures.clear();
    this.drops.clear();
    this.carcasses.clear();
    for (const st of s.structures) this.structures.set(st.id, cloneStructure(st));
    for (const d of s.drops) this.drops.set(d.id, { ...d });
    for (const c of s.carcasses) this.carcasses.set(c.id, cloneCarcass(c));
    this.dirty.clear();
  }

  /** Re-send this entity's current state (or its removal) in the next diff. */
  touch(key: string): void {
    this.dirty.add(key);
  }

  /** Changes since the last call. With `withPrev`, each carries the value it changed from. */
  diff(sim: Simulation, withPrev: boolean): Delta[] {
    const s = sim.state;
    const out: Delta[] = [];
    const seen = new Set<string>();
    const push = (d: Delta) => {
      out.push(d);
      seen.add(deltaKey(d));
    };
    for (let i = 0; i < s.trees.length; i++) {
      const cur = s.trees[i];
      const base = this.trees[i];
      if (base && sameTree(cur, base)) continue;
      push(withPrev && base ? { k: 't', i, v: { ...cur }, p: base } : { k: 't', i, v: { ...cur } });
      this.trees[i] = { ...cur };
    }
    for (let i = 0; i < s.resources.length; i++) {
      const cur = s.resources[i];
      const base = this.resources[i];
      if (base && sameResource(base, cur)) continue;
      push(withPrev && base ? { k: 'r', i, v: { ...cur }, p: base } : { k: 'r', i, v: { ...cur } });
      this.resources[i] = { ...cur };
    }
    const live = new Set<number>();
    for (const st of s.structures) {
      live.add(st.id);
      const base = this.structures.get(st.id);
      if (base && !this.structureChanged(base, st)) continue;
      push(withPrev ? { k: 's', v: cloneStructure(st), p: base ?? null } : { k: 's', v: cloneStructure(st) });
      this.structures.set(st.id, cloneStructure(st));
    }
    for (const id of [...this.structures.keys()]) {
      if (live.has(id)) continue;
      this.structures.delete(id);
      push({ k: 's-', id });
    }
    live.clear();
    for (const d of s.drops) {
      live.add(d.id);
      const base = this.drops.get(d.id);
      if (base && base.count === d.count) continue;
      push(withPrev ? { k: 'd', v: { ...d }, p: base ?? null } : { k: 'd', v: { ...d } });
      this.drops.set(d.id, { ...d });
    }
    for (const id of [...this.drops.keys()]) {
      if (live.has(id)) continue;
      this.drops.delete(id);
      push({ k: 'd-', id });
    }
    live.clear();
    for (const c of s.carcasses) {
      live.add(c.id);
      const base = this.carcasses.get(c.id);
      if (base && sameCarcass(base, c)) continue;
      push(withPrev ? { k: 'c', v: cloneCarcass(c), p: base ?? null } : { k: 'c', v: cloneCarcass(c) });
      this.carcasses.set(c.id, cloneCarcass(c));
    }
    for (const id of [...this.carcasses.keys()]) {
      if (live.has(id)) continue;
      this.carcasses.delete(id);
      push({ k: 'c-', id });
    }
    for (const key of this.dirty) {
      if (!seen.has(key)) {
        const d = currentState(sim, key);
        if (d) out.push(d);
      }
    }
    this.dirty.clear();
    return out;
  }

  private structureChanged(base: StructureState, cur: StructureState): boolean {
    if (base.prefab !== cur.prefab || !sameStore(base.store, cur.store)) return true;
    if (!this.tolerant) return base.fuel !== cur.fuel || base.wear?.dur !== cur.wear?.dur;
    if (base.fuel > 0 !== cur.fuel > 0 || Math.abs(base.fuel - cur.fuel) >= 0.05) return true;
    return Math.abs((base.wear?.dur ?? 0) - (cur.wear?.dur ?? 0)) >= 0.5;
  }

  /** Record remote state just applied locally, so it isn't reported back as a local change. */
  accept(d: Delta): void {
    switch (d.k) {
      case 't':
        this.trees[d.i] = { ...d.v };
        break;
      case 'r':
        this.resources[d.i] = { ...d.v };
        break;
      case 's':
        this.structures.set(d.v.id, cloneStructure(d.v));
        break;
      case 'd':
        this.drops.set(d.v.id, { ...d.v });
        break;
      case 'c':
        this.carcasses.set(d.v.id, cloneCarcass(d.v));
        break;
      case 's-':
        this.structures.delete(d.id);
        break;
      case 'd-':
        this.drops.delete(d.id);
        break;
      case 'c-':
        this.carcasses.delete(d.id);
        break;
    }
  }
}

/** The authoritative state of one entity as a delta (a removal when it no longer exists). */
function currentState(sim: Simulation, key: string): Delta | null {
  const [k, n] = key.split(':');
  const id = Number(n);
  const s = sim.state;
  switch (k) {
    case 't':
      return s.trees[id] ? { k: 't', i: id, v: { ...s.trees[id] } } : null;
    case 'r':
      return s.resources[id] ? { k: 'r', i: id, v: { ...s.resources[id] } } : null;
    case 's': {
      const st = s.structures.find((x) => x.id === id);
      return st ? { k: 's', v: cloneStructure(st) } : { k: 's-', id };
    }
    case 'd': {
      const d = s.drops.find((x) => x.id === id);
      return d ? { k: 'd', v: { ...d } } : { k: 'd-', id };
    }
    case 'c': {
      const c = s.carcasses.find((x) => x.id === id);
      return c ? { k: 'c', v: cloneCarcass(c) } : { k: 'c-', id };
    }
  }
  return null;
}

/** Overwrite local state with the host's (guests). */
export function applyState(sim: Simulation, d: Delta): void {
  switch (d.k) {
    case 't':
      return sim.setTree(d.i, d.v);
    case 'r':
      return sim.setResource(d.i, d.v);
    case 's':
      return sim.putStructure(d.v);
    case 'd':
      return sim.putDrop(d.v);
    case 'c':
      return sim.putCarcass(d.v);
    case 's-':
      return sim.deleteStructure(d.id);
    case 'd-':
      return sim.deleteDrop(d.id);
    case 'c-':
      return sim.deleteCarcass(d.id);
  }
}

/**
 * Host: apply a guest's change on top of whatever happened meanwhile. Counters (tree hits, trunk cuts, bark,
 * forage charges, pile sizes, fuel, wear) apply as the difference the guest made; new things are added;
 * removals remove. `from` is the guest's position (fall direction when their hit fells a tree).
 */
export function mergeRemote(sim: Simulation, d: Delta, from: { x: number; z: number }): void {
  const s = sim.state;
  switch (d.k) {
    case 't': {
      if (!d.p || !s.trees[d.i]) return applyState(sim, d);
      return sim.setTree(d.i, mergeTree(sim, d.i, d.v, d.p, from));
    }
    case 'r': {
      const h = s.resources[d.i];
      if (!h) return;
      if (!d.p) return sim.setResource(d.i, d.v);
      const max = RESOURCES[sim.gen.resources[d.i].kind].charges;
      const charges = Math.min(max, Math.max(0, h.charges + d.v.charges - d.p.charges));
      const respawnAt = d.v.respawnAt !== d.p.respawnAt ? d.v.respawnAt : h.respawnAt;
      return sim.setResource(d.i, { charges, respawnAt, ...(d.v.scorpion || h.scorpion ? { scorpion: true } : {}) });
    }
    case 's': {
      const h = s.structures.find((x) => x.id === d.v.id);
      if (!d.p) return h ? undefined : sim.putStructure(d.v);
      if (!h) return;
      const next = cloneStructure(h);
      // A shelter upgrade: the guest rebuilt it as the next tier, with fresh condition. If someone else already
      // upgraded it meanwhile, the host's tier stands.
      if (d.v.prefab !== d.p.prefab) {
        if (h.prefab !== d.p.prefab || !(d.v.prefab in PREFABS)) return;
        next.prefab = d.v.prefab;
        next.wear = d.v.wear ? { ...d.v.wear } : undefined;
        next.fuel = h.fuel;
        // Storage keeps whatever is in it now; the bigger tier just adds slots.
        if (PREFABS[next.prefab].storage) ensureStore(next);
        return sim.putStructure(next);
      }
      if (PREFABS[h.prefab].storage) mergeStore(sim, next, d.v.store, d.p.store);
      next.fuel = Math.min(BALANCE.fire.maxFuelHours, Math.max(0, h.fuel + d.v.fuel - d.p.fuel));
      if (next.wear && d.v.wear && d.p.wear) {
        next.wear.dur = Math.min(next.wear.max, next.wear.dur + d.v.wear.dur - d.p.wear.dur);
        if (next.wear.dur <= 0) return sim.deleteStructure(h.id);
      }
      return sim.putStructure(next);
    }
    case 'd': {
      const h = s.drops.find((x) => x.id === d.v.id);
      if (!d.p) return h ? undefined : sim.putDrop(d.v);
      if (!h) return;
      const count = h.count + d.v.count - d.p.count;
      return count > 0 ? sim.putDrop({ ...h, count }) : sim.deleteDrop(h.id);
    }
    case 'c': {
      const h = s.carcasses.find((x) => x.id === d.v.id);
      if (!d.p) return h ? undefined : sim.putCarcass(d.v);
      if (!h) return;
      const next = cloneCarcass(h);
      next.remaining.forEach((r, i) => {
        const was = d.p!.remaining[i]?.count ?? r.count;
        const now = d.v.remaining[i]?.count ?? was;
        r.count = Math.max(0, r.count + now - was);
      });
      return next.remaining.every((r) => r.count <= 0) ? sim.deleteCarcass(h.id) : sim.putCarcass(next);
    }
    default:
      return applyState(sim, d);
  }
}

/**
 * Storage: apply what the guest put in and took out, item by item, to the host's current contents. What no longer
 * fits (two players filling the last slots at once) is set down beside it as a pile.
 */
function mergeStore(sim: Simulation, st: StructureState, v: StructureState['store'], p: StructureState['store']): void {
  const store = ensureStore(st);
  const now = storeTotals(v);
  const was = storeTotals(p);
  for (const item of new Set([...now.keys(), ...was.keys()])) {
    const d = (now.get(item) ?? 0) - (was.get(item) ?? 0);
    if (d < 0) removeFromStore(store, item, -d);
    else if (d > 0) {
      const left = d - addToStore(store, item, d);
      if (left > 0) {
        const x = st.x + 0.9;
        sim.putDrop({ id: sim.state.nextId++, item, count: left, x, y: sim.terrain.heightAt(x, st.z), z: st.z });
      }
    }
  }
}

function mergeTree(sim: Simulation, i: number, v: TreeDyn, p: TreeDyn, from: { x: number; z: number }): TreeDyn {
  const h = sim.state.trees[i];
  const g = sim.gen.trees[i];
  const def = TREES[g.species];
  const cpl = BALANCE.trees.cutsPerLog;
  const out: TreeDyn = { ...h };
  out.bark = Math.max(0, h.bark + v.bark - p.bark);
  if (v.barkAt !== p.barkAt) out.barkAt = v.barkAt;
  if (!h.felled) {
    if (v.felled) return { ...v, bark: out.bark, barkAt: out.barkAt };
    out.hp = Math.max(0, h.hp + v.hp - p.hp);
    if (out.hp <= 0) {
      const dx = g.x - from.x;
      const dz = g.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      Object.assign(out, { felled: true, hp: 0, fall: Math.atan2(dx / d, dz / d), logs: def.logs, cuts: 0 });
    }
    return out;
  }
  // Work left on the fallen trunk, in axe hits.
  const work = (t: TreeDyn) => (t.felled ? t.logs * cpl - t.cuts : def.logs * cpl);
  const rem = Math.max(0, work(h) - (work(p) - work(v)));
  out.logs = Math.ceil(rem / cpl);
  out.cuts = out.logs * cpl - rem;
  return out;
}

// ------------------------------------------------------------------ late-join snapshot

/** The world as a sparse diff from the seed's fresh world: terrain and placement regenerate from the seed. */
export interface WorldSnapshot {
  seed: number;
  /** The map; absent for the Pacific Northwest. */
  b?: BiomeId;
  h: number;
  r: number;
  t: [number, TreeDyn][];
  rs: [number, ResourceDyn][];
  st: StructureState[];
  dr: DropState[];
  ca: CarcassState[];
}

export function takeSnapshot(sim: Simulation): WorldSnapshot {
  const s = sim.state;
  const gen = sim.gen;
  const t: [number, TreeDyn][] = [];
  s.trees.forEach((dyn, i) => {
    if (!sameTree(dyn, freshTree(gen.trees[i].species))) t.push([i, { ...dyn }]);
  });
  const rs: [number, ResourceDyn][] = [];
  s.resources.forEach((dyn, i) => {
    if (dyn.charges !== RESOURCES[gen.resources[i].kind].charges || dyn.respawnAt !== 0 || dyn.scorpion) rs.push([i, { ...dyn }]);
  });
  return {
    seed: s.seed,
    ...(sim.biome !== DEFAULT_BIOME ? { b: sim.biome } : {}),
    h: s.totalHours,
    r: sim.timeScale,
    t,
    rs,
    st: s.structures.map(cloneStructure),
    dr: s.drops.map((d) => ({ ...d })),
    ca: s.carcasses.map(cloneCarcass),
  };
}

/** A guest's starting state: the host's world, with a fresh character at the spawn and no animals (they stream in). */
export function stateFromSnapshot(snap: WorldSnapshot): GameState {
  const biome = isBiomeId(snap.b) ? snap.b : DEFAULT_BIOME;
  const state = createNewState(snap.seed, biome);
  const gen = getWorldGen(snap.seed, biome);
  for (const [i, dyn] of snap.t) if (i >= 0 && i < gen.trees.length) state.trees[i] = { ...dyn };
  for (const [i, dyn] of snap.rs) if (i >= 0 && i < gen.resources.length) state.resources[i] = { ...dyn };
  state.structures = snap.st.map(cloneStructure);
  state.drops = snap.dr.map((d) => ({ ...d }));
  state.carcasses = snap.ca.map(cloneCarcass);
  state.animals = [];
  state.totalHours = snap.h;
  state.spawnCheckAt = Infinity;
  return state;
}
