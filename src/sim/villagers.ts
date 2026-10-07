import { circle, overlaps } from '../core/geom2d';
import { headingTo, turnToward } from '../core/math';
import { Rng } from '../core/rng';
import { RESOURCES } from '../data/resources';
import { tribeFor, type TribeMember } from '../data/tribes';
import type { Collider } from './colliders';
import type { GameState, SettlementState, VillagerState } from './state';
import type { Terrain } from './terrain';
import type { WorldGen } from './worldgen';

export interface VillagerEnv {
  terrain: Terrain;
  gen: WorldGen;
  state: GameState;
  night: boolean;
  query(x: number, z: number, r: number, out: Collider[]): Collider[];
  forageAvailable(index: number): boolean;
  /** Complete one real action, independently of player stats, inventory and skills. */
  work(camp: SettlementState, npc: VillagerState): boolean;
  visitors: readonly { x: number; z: number; dead?: boolean }[];
}

const colliders: Collider[] = [];
const OFFSETS = [0, 0.4, -0.4, 0.85, -0.85, 1.5, -1.5, 2.3, -2.3, Math.PI];

function canStand(env: VillagerEnv, x: number, z: number): boolean {
  if (!env.terrain.inPlayBounds(x, z, 5) || env.terrain.heightAt(x, z) < 0.25 || env.terrain.slopeAt(x, z) > 0.65) return false;
  const body = circle(x, z, 0.32);
  return !env.query(x, z, 3, colliders).some((c) => c.body && overlaps(body, c.body));
}

function go(n: VillagerState, env: VillagerEnv, dt: number): boolean {
  const dx = n.tx - n.x, dz = n.tz - n.z, dist = Math.hypot(dx, dz);
  if (dist < 0.5) { n.speed = 0; return true; }
  const desired = headingTo(n.x, n.z, n.tx, n.tz);
  const speed = n.task === 'hunt' ? 2.1 : n.task === 'rest' ? 1 : 1.35;
  const step = Math.min(dist, speed * dt);
  for (const off of OFFSETS) {
    const heading = desired + off;
    if (!canStand(env, n.x + Math.sin(heading) * 0.9, n.z + Math.cos(heading) * 0.9)) continue;
    const nx = n.x + Math.sin(heading) * step, nz = n.z + Math.cos(heading) * step;
    if (!canStand(env, nx, nz)) continue;
    n.heading = turnToward(n.heading, heading, 4 * dt);
    n.x = nx; n.z = nz; n.y = env.terrain.heightAt(nx, nz); n.speed = speed;
    return false;
  }
  n.speed = 0;
  return false;
}

function returnHome(n: VillagerState, camp: SettlementState, env: VillagerEnv, rng: Rng): void {
  delete n.target;
  n.phase = 'return'; n.timer = 90;
  const index = camp.members.indexOf(n);
  for (let i = 0; i < 12; i++) {
    const a = index / camp.members.length * Math.PI * 2 + rng.range(-0.35, 0.35);
    const r = rng.range(2.4, 3.5);
    const x = camp.x + Math.sin(a) * r, z = camp.z + Math.cos(a) * r;
    if (canStand(env, x, z)) { n.tx = x; n.tz = z; return; }
  }
  n.tx = n.x; n.tz = n.z;
}

function chooseTask(n: VillagerState, member: TribeMember, camp: SettlementState, env: VillagerEnv, rng: Rng): void {
  n.task = member.tasks[rng.int(0, member.tasks.length - 1)];
  n.speed = 0;
  n.timer = rng.range(25, 55);
  delete n.target;
  if (n.task === 'rest') { n.phase = 'idle'; return; }
  let x = camp.x, z = camp.z, best = Infinity;
  if (n.task === 'gather') env.gen.resources.forEach((r, i) => {
    if (!['berries', 'onion', 'mushroom', 'fiber', 'stick'].includes(RESOURCES[r.kind].item)
      || env.state.resources[i].charges <= 0 || !env.forageAvailable(i)) return;
    const d = Math.hypot(r.x - camp.x, r.z - camp.z);
    if (d > 35 || d >= best || camp.members.some((m) => m !== n && m.target?.kind === 'resource' && m.target.ref === i)) return;
    best = d; x = r.x; z = r.z; n.target = { kind: 'resource', ref: i };
  });
  if (n.task === 'chop') env.gen.trees.forEach((tr, i) => {
    const d = Math.hypot(tr.x - camp.x, tr.z - camp.z);
    if (env.state.trees[i].felled || d < 12 || d > 38 || d >= best || camp.members.some((m) => m !== n && m.target?.kind === 'tree' && m.target.ref === i)) return;
    best = d; n.target = { kind: 'tree', ref: i };
    const a = headingTo(tr.x, tr.z, camp.x, camp.z);
    x = tr.x + Math.sin(a) * (tr.trunkR + 0.9); z = tr.z + Math.cos(a) * (tr.trunkR + 0.9);
  });
  if (n.task === 'hunt') for (const a of env.state.animals) {
    const d = Math.hypot(a.x - camp.x, a.z - camp.z);
    if (!['rabbit', 'squirrel'].includes(a.species) || a.mode === 'hide' || a.mode === 'climb' || a.mode === 'descend' || d > 42 || d >= best) continue;
    best = d; x = a.x; z = a.z; n.target = { kind: 'animal', ref: a.id };
  }
  if (n.task === 'craft') {
    if (camp.members.some((other) => other !== n && other.task === 'craft' && (other.phase === 'travel' || other.phase === 'work'))) {
      n.task = 'rest'; n.phase = 'idle'; return;
    }
    const bench = camp.structures.find((st) => st.prefab === 'workbench');
    if (bench) { x = bench.x + Math.sin(bench.rot) * 1.1; z = bench.z + Math.cos(bench.rot) * 1.1; }
    best = 0;
  }
  if (n.task === 'explore') {
    for (let i = 0; i < 15; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(8, member.role === 'elder' || member.role === 'young' ? 16 : 32);
      x = camp.x + Math.sin(a) * r; z = camp.z + Math.cos(a) * r;
      if (canStand(env, x, z)) { best = 0; break; }
    }
  }
  if (best === Infinity || !canStand(env, x, z)) { n.task = 'rest'; n.phase = 'idle'; return; }
  n.tx = x; n.tz = z; n.phase = 'travel'; n.timer = 70;
}

/** Each villager runs a bounded task, returns to camp, and rests. Dusk interrupts work; guests follow host poses. */
export function updateVillagers(camp: SettlementState, env: VillagerEnv, dt: number): void {
  const def = tribeFor(camp.tribe, env.terrain.biome);
  if (!def) return;
  const rng = new Rng(camp.rng);
  for (const n of camp.members) {
    const member = def.members.find((m) => m.id === n.id);
    if (!member) continue;
    // Stop and acknowledge a nearby player so talking never requires chasing a moving target.
    const visitor = env.visitors.find((p) => !p.dead && Math.hypot(p.x - n.x, p.z - n.z) < 3.5);
    if (visitor) { n.speed = 0; n.heading = turnToward(n.heading, headingTo(n.x, n.z, visitor.x, visitor.z), dt * 3); continue; }
    n.timer -= dt;
    if (env.night && n.task !== 'rest') { n.task = 'rest'; returnHome(n, camp, env, rng); }
    if (n.phase === 'idle') {
      n.speed = 0;
      if (!env.night && n.timer <= 0) chooseTask(n, member, camp, env, rng);
    } else if (n.phase === 'return') {
      if (go(n, env, dt) || n.timer <= 0) { n.phase = 'idle'; n.task = 'rest'; n.timer = rng.range(15, 45); n.speed = 0; }
    } else if (n.phase === 'travel') {
      if (n.target?.kind === 'animal') {
        const prey = env.state.animals.find((a) => a.id === n.target!.ref);
        if (!prey || Math.hypot(prey.x - camp.x, prey.z - camp.z) > 45 || prey.mode === 'hide' || prey.y > env.terrain.heightAt(prey.x, prey.z) + 1) { returnHome(n, camp, env, rng); continue; }
        n.tx = prey.x; n.tz = prey.z;
        if (Math.hypot(prey.x - n.x, prey.z - n.z) < 7) { n.phase = 'work'; n.timer = 2.5; n.speed = 0; continue; }
      }
      if (n.timer <= 0) returnHome(n, camp, env, rng);
      else if (go(n, env, dt)) {
        n.phase = 'work'; n.timer = n.task === 'chop' ? rng.range(12, 20) : rng.range(4, 9);
        if (n.task === 'craft') {
          const bench = camp.structures.find((st) => st.prefab === 'workbench');
          if (bench) n.heading = headingTo(n.x, n.z, bench.x, bench.z);
        }
      }
    } else {
      n.speed = 0;
      if (n.timer <= 0) { env.work(camp, n); returnHome(n, camp, env, rng); }
    }
  }
  camp.rng = rng.s;
}
