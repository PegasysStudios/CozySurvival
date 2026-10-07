import { box, circle, footprintSamples, overlaps, type Shape2D } from '../core/geom2d';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { BALANCE } from '../data/balance';
import { PREFABS, type PrefabId } from '../data/prefabs';
import { TRIBES, tribeFor, TASK_LABELS, type TribeDefinition } from '../data/tribes';
import { footprintShape, seatHeight } from './placement';
import { parseStore } from './storage';
import type { SettlementState, StructureState } from './state';
import { WATER_LEVEL, type Terrain } from './terrain';
import type { WorldGen } from './worldgen';

export interface SettlementGen {
  tribe: string;
  x: number;
  z: number;
  structures: { prefab: PrefabId; x: number; z: number; rot: number; y: number }[];
}

const CAMP_PLAN: readonly [PrefabId, number, number][] = [
  ['campfire', 0, 0], ['hideTent', -5.2, -4.6], ['hideTent', 5.2, -4.6], ['storageBin', -4.3, 3.8], ['workbench', 4.3, 3.8],
];
export const CAMP_RADIUS = 11;

/** Find a small, dry camp in the far side of the forest without renumbering any saved scenery or consuming its RNG. */
export function planSettlement(t: Terrain, gen: WorldGen, tribe: TribeDefinition, built: readonly StructureState[] = []): SettlementGen | null {
  if (tribe.biome !== t.biome) return null;
  const obstacles = new SpatialGrid<Shape2D>(10);
  const add = (shape: Shape2D, r: number) => obstacles.insert(shape, shape.x, shape.z, r);
  for (const tr of gen.trees) add(circle(tr.x, tr.z, tr.trunkR + 1.6), tr.trunkR + 1.6);
  for (const r of gen.rocks) add(circle(r.x, r.z, r.r * 1.6), r.r * 1.6);
  for (const l of gen.logs) add(box(l.x, l.z, l.length / 2 + 0.3, l.r + 0.4, l.rot), l.length / 2 + 1);
  for (const st of built) add(footprintShape(st.prefab, st.x, st.z, st.rot), 3);
  const nearby: Shape2D[] = [];
  const clear = (shape: Shape2D, r: number) => !obstacles.query(shape.x, shape.z, r + 4, nearby).some((other) => overlaps(shape, other));
  const samples: number[] = [];
  const groundOK = (prefab: PrefabId, x: number, z: number, rot: number) => {
    const shape = footprintShape(prefab, x, z, rot);
    footprintSamples(shape, samples);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < samples.length; i += 2) {
      const h = t.heightAt(samples[i], samples[i + 1]);
      if (h < WATER_LEVEL + 0.25) return false;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo <= PREFABS[prefab].maxHeightDelta && clear(shape, 3);
  };
  const span = Math.hypot(t.spawn.x, t.spawn.z);
  const oppositeX = span > 5 ? -t.spawn.x / span * t.playHalf * 0.85 : t.playHalf * 0.78;
  const oppositeZ = span > 5 ? -t.spawn.z / span * t.playHalf * 0.85 : t.playHalf * 0.78;
  const candidates: { x: number; z: number; score: number }[] = [];
  for (let x = -t.playHalf + 18; x < t.playHalf - 18; x += 8) for (let z = -t.playHalf + 18; z < t.playHalf - 18; z += 8) {
    const dist = Math.hypot(x - t.spawn.x, z - t.spawn.z);
    if (dist < t.playHalf * 1.1 || t.heightAt(x, z) < 0.6 || t.slopeAt(x, z) > 0.25) continue;
    if (span > 5 && x * t.spawn.x + z * t.spawn.z > 0) continue;
    candidates.push({ x, z, score: Math.hypot(x - oppositeX, z - oppositeZ) - dist * 0.35 });
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const center of candidates) {
    // Open center and paths make this feel like a home, not props wedged between tree trunks.
    if (!clear(circle(center.x, center.z, 3.5), 3.5)) continue;
    for (let k = 0; k < 8; k++) {
      const rot = k * Math.PI / 4;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const structures = CAMP_PLAN.map(([prefab, dx, dz]) => {
        const x = center.x + dx * c + dz * sn, z = center.z - dx * sn + dz * c;
        const facing = prefab === 'hideTent' ? Math.atan2(center.x - x, center.z - z) : rot;
        return { prefab, x, z, rot: facing, y: seatHeight(t, prefab, x, z, facing) };
      });
      if (!structures.every((st) => groundOK(st.prefab, st.x, st.z, st.rot))) continue;
      // Reserve walkable space between each station and the common fire.
      let paths = true;
      for (const st of structures.slice(1)) for (let step = 1; step <= 4; step++) {
        const f = step / 5, x = center.x + (st.x - center.x) * f, z = center.z + (st.z - center.z) * f;
        if (t.heightAt(x, z) < 0.25 || t.slopeAt(x, z) > 0.5 || !clear(circle(x, z, 0.65), 0.65)) paths = false;
      }
      if (paths) return { tribe: tribe.id, x: center.x, z: center.z, structures };
    }
  }
  // Older, hillier forests sometimes need a less symmetric arrangement. Fit each station into an open pocket
  // around the same common fire, retaining the dry footprints, paths, far-side rule and small camp radius.
  for (const center of candidates) {
    if (!clear(circle(center.x, center.z, 3.5), 3.5) || !groundOK('campfire', center.x, center.z, 0)) continue;
    const structures: SettlementGen['structures'] = [{ prefab: 'campfire', x: center.x, z: center.z, rot: 0, y: seatHeight(t, 'campfire', center.x, center.z, 0) }];
    for (const [prefab] of CAMP_PLAN.slice(1)) {
      let placed = false;
      for (let radius = 4.5; radius <= 9 && !placed; radius += 0.75) for (let k = 0; k < 32 && !placed; k++) {
        const a = k / 32 * Math.PI * 2;
        const x = center.x + Math.sin(a) * radius, z = center.z + Math.cos(a) * radius;
        const rot = Math.atan2(center.x - x, center.z - z);
        const shape = footprintShape(prefab, x, z, rot);
        if (!groundOK(prefab, x, z, rot) || structures.some((st) => overlaps(circle(st.x, st.z, PREFABS[st.prefab].footprint.type === 'circle' ? (PREFABS[st.prefab].footprint as { r: number }).r + 0.7 : 2), shape))) continue;
        let path = true;
        for (let step = 1; step < 5; step++) {
          const px = center.x + (x - center.x) * step / 5, pz = center.z + (z - center.z) * step / 5;
          if (!clear(circle(px, pz, 0.6), 0.6) || t.heightAt(px, pz) < 0.25 || t.slopeAt(px, pz) > 0.6) path = false;
        }
        if (!path) continue;
        structures.push({ prefab, x, z, rot, y: seatHeight(t, prefab, x, z, rot) }); placed = true;
      }
      if (!placed) break;
    }
    if (structures.length === CAMP_PLAN.length) return { tribe: tribe.id, x: center.x, z: center.z, structures };
  }
  return null;
}

export function generateSettlements(t: Terrain, gen: WorldGen): SettlementGen[] {
  return TRIBES.filter((def) => def.biome === t.biome).flatMap((def) => {
    const plan = planSettlement(t, gen, def);
    return plan ? [plan] : [];
  });
}

export function createSettlement(plan: SettlementGen, t: Terrain, nextId: () => number): SettlementState {
  const def = tribeFor(plan.tribe, t.biome)!;
  const rng = new Rng(t.seed ^ 0x6f727575);
  const structures: StructureState[] = plan.structures.map((st) => ({ id: nextId(), prefab: st.prefab, x: st.x, z: st.z, rot: st.rot, y: st.y,
    fuel: st.prefab === 'campfire' ? BALANCE.fire.initialFuelHours : 0, settlement: def.id,
    ...(PREFABS[st.prefab].storage ? { store: parseStore(undefined, st.prefab) } : {}) }));
  const members = def.members.map((m, i) => {
    const a = (i / def.members.length) * Math.PI * 2;
    const x = plan.x + Math.sin(a) * 2.6, z = plan.z + Math.cos(a) * 2.6;
    return { id: m.id, x, z, y: t.heightAt(x, z), heading: a + Math.PI, task: 'rest' as const, phase: 'idle' as const,
      timer: rng.range(5, 25), tx: x, tz: z, speed: 0 };
  });
  return { tribe: def.id, x: plan.x, z: plan.z, structures, members, rng: rng.s };
}

export const settlementStructures = (state: { structures: StructureState[]; settlements?: SettlementState[] }): StructureState[] => [
  ...state.structures, ...(state.settlements ?? []).flatMap((v) => v.structures),
];

export function parseSettlements(raw: unknown, t: Terrain, usedIds: ReadonlySet<number>): SettlementState[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SettlementState[] = [];
  const ids = new Set(usedIds);
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const v = value as SettlementState;
    const def = tribeFor(v.tribe, t.biome);
    if (!def || out.some((c) => c.tribe === def.id) || !finite(v.x) || !finite(v.z) || !t.inPlayBounds(v.x, v.z, 10)
      || !Array.isArray(v.structures) || v.structures.length !== CAMP_PLAN.length || !Array.isArray(v.members)) continue;
    const ownIds = new Set<number>();
    const structures: StructureState[] = [];
    for (let i = 0; i < CAMP_PLAN.length; i++) {
      const st = v.structures[i];
      if (!st || st.prefab !== CAMP_PLAN[i][0] || !Number.isInteger(st.id) || st.id <= 0 || ids.has(st.id) || ownIds.has(st.id)
        || !finite(st.x) || !finite(st.z) || !finite(st.rot) || Math.hypot(st.x - v.x, st.z - v.z) > CAMP_RADIUS) break;
      ownIds.add(st.id);
      structures.push({ id: st.id, prefab: st.prefab, x: st.x, z: st.z, rot: st.rot, y: seatHeight(t, st.prefab, st.x, st.z, st.rot),
        fuel: finite(st.fuel) ? Math.max(0, Math.min(BALANCE.fire.maxFuelHours, st.fuel)) : 0, settlement: def.id,
        ...(PREFABS[st.prefab].storage ? { store: parseStore(st.store, st.prefab) } : {}) });
    }
    if (structures.length !== CAMP_PLAN.length) continue;
    const members = def.members.map((member, i) => {
      const n = v.members.find((npc) => npc?.id === member.id);
      const valid = n && finite(n.x) && finite(n.z) && t.inPlayBounds(n.x, n.z, 4) && Math.hypot(n.x - v.x, n.z - v.z) <= 55;
      const x = valid ? n.x : v.x + Math.sin(i * 1.3) * 2.6, z = valid ? n.z : v.z + Math.cos(i * 1.3) * 2.6;
      return { id: member.id, x, z, y: t.heightAt(x, z), heading: n && finite(n.heading) ? n.heading : 0,
        task: n && Object.hasOwn(TASK_LABELS, n.task) ? n.task : 'rest' as const,
        phase: n && ['idle', 'travel', 'work', 'return'].includes(n.phase) ? n.phase : 'idle' as const,
        timer: n && finite(n.timer) ? Math.max(0, Math.min(90, n.timer)) : 5,
        tx: n && finite(n.tx) && Math.abs(n.tx - v.x) <= 50 ? n.tx : x,
        tz: n && finite(n.tz) && Math.abs(n.tz - v.z) <= 50 ? n.tz : z,
        speed: n && finite(n.speed) ? Math.max(0, Math.min(2.1, n.speed)) : 0,
        ...(n?.target && ['resource', 'tree', 'animal'].includes(n.target.kind) && Number.isInteger(n.target.ref) ? { target: { ...n.target } } : {}) };
    });
    for (const id of ownIds) ids.add(id);
    out.push({ tribe: def.id, x: v.x, z: v.z, structures, members, rng: finite(v.rng) ? v.rng >>> 0 : t.seed ^ 0x6f727575 });
  }
  return out.length ? out : undefined;
}
