import { box, circle, overlaps, raySphere, rayCylinder } from '../core/geom2d';
import { clamp, damp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { BALANCE } from '../data/balance';
import { ITEMS, TOOLS, TOOL_ORDER, itemName, type ItemId, type ToolId } from '../data/items';
import { OBJECTIVES, advanceObjectives } from '../data/objectives';
import { PLACE_MAX_DIST, PREFABS, type PrefabId } from '../data/prefabs';
import { RECIPE_BY_ID } from '../data/recipes';
import { RESOURCES, TREES } from '../data/resources';
import { PREDATOR_MIN_SPAWN_DIST, PREY_MIN_SPAWN_DIST, SPECIES, predatorTargets, type SpeciesId } from '../data/species';
import { createAnimal, damageAnimal, findSpawnPoint, updateAnimal, type AnimalEnv, type AvoidPoint } from './animals';
import { ColliderIndex, makeCollider, type Collider } from './colliders';
import { canCraft, canteenRoom, checkUnlocks, craft as craftRecipe, slotsFor, type CraftCheck } from './crafting';
import { applyWear, newStructureWear, newToolWear, prefabWears, toolWear, toolWears, wearFraction, type WearResult } from './durability';
import type { SimEvent } from './events';
import { addItem, countItem, createInventory, removeAll, removeFromSlot, removeItem, roomFor } from './inventory';
import { createPlayer, horizontalSpeed, lookDir, stepPlayer, type MoveEnv } from './movement';
import { applyDamage, applyFood, applySleep, createNeeds, spendEnergy, updateNeeds, type Activity } from './needs';
import { checkPlacement, colliderShape, footprintShape, type PlacementEnv, type PlacementReason } from './placement';
import { addSkillXp, burnChance, butcherBonusChance, createSkills, gatherBonusChance, huntDamageMultiplier, SKILL_INFO } from './skills';
import { STATE_VERSION, type AnimalState, type DamageSource, type GameState, type SkillId, type StructureState, type Wear } from './state';
import { getTerrain, WATER_LEVEL, type Terrain } from './terrain';
import { advanceHours, ambientWarmth, canSleepAt, dayOf, hourOf, isNight, nextDayStart } from './time';
import { freshTree, rockTop, TRUNK_AXIS_LIFT, trunkBox, trunkSpan, trunkTop, type TrunkSpan } from './trunks';
import { getWorldGen, type WorldGen } from './worldgen';

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
}

export const IDLE_INPUT: Readonly<SimInput> = {
  moveX: 0, moveZ: 0, jumpPressed: false, sprint: false, yaw: 0, pitch: 0,
  primary: false, primaryPressed: false, primaryReleased: false,
};

export type Target =
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
}

export const COOK_RADIUS = 4;
const ARROW_GRAVITY = 9.8;
const START_HOURS = BALANCE.time.startHour - BALANCE.time.dayStartHour;

let runCounter = 0;

/** Unique per run (not derived from the seed) so restarts in the same world are distinguishable. */
function makeRunId(): string {
  runCounter = (runCounter + 1) % 1296;
  return Date.now().toString(36) + Math.floor(Math.random() * 0xffffff).toString(36) + runCounter.toString(36);
}

export function createNewState(seed: number): GameState {
  const terrain = getTerrain(seed);
  const gen = getWorldGen(seed);
  const rng = new Rng(seed ^ 0x3c6ef372);
  const lake = terrain.lakes[0];
  const sx = terrain.spawn.x;
  const sz = terrain.spawn.z;
  const yaw = Math.atan2(-(lake.x - sx), -(lake.z - sz));
  const state: GameState = {
    version: STATE_VERSION,
    seed,
    runId: makeRunId(),
    totalHours: START_HOURS,
    player: createPlayer(sx, terrain.heightAt(sx, sz), sz, yaw),
    needs: createNeeds(),
    inventory: createInventory(BALANCE.carry.baseSlots),
    tools: ['hands'],
    activeTool: 'hands',
    toolWear: {},
    gear: [],
    known: [],
    skills: createSkills(),
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
  const populate = (species: SpeciesId, count: number, minDist: number) => {
    spawnAvoid[0].minDist = minDist;
    for (let i = 0; i < count; i++) {
      const p = findSpawnPoint(terrain, rng, species, spawnAvoid);
      if (p) state.animals.push(createAnimal(state.nextId++, species, p.x, p.z, rng, terrain));
    }
  };
  populate('rabbit', SPECIES.rabbit.kind === 'prey' ? SPECIES.rabbit.population : 0, 22);
  populate('deer', SPECIES.deer.kind === 'prey' ? SPECIES.deer.population : 0, 45);
  populate('fish', SPECIES.fish.kind === 'prey' ? SPECIES.fish.population : 0, 0);
  const targets = predatorTargets(1);
  populate('wolf', targets.wolf, 100);
  populate('bear', targets.bear, 110);
  state.rng = rng.s;
  return state;
}

export class Simulation {
  readonly state: GameState;
  readonly terrain: Terrain;
  readonly gen: WorldGen;
  readonly colliders = new ColliderIndex();
  timeScale = 1;
  target: Target | null = null;
  placement: PlacementPreview | null = null;
  readonly projectiles: Projectile[] = [];
  /** Seconds the bow has been drawn, or -1 when not drawing. */
  bowDraw = -1;
  actionCooldown = 0;
  /** Increments whenever trees/resources/structures/drops/carcasses change, so views can resync. */
  worldVersion = 0;
  /** Smoothed movement noise used by animal perception. */
  noise = 0.5;
  activity: Activity = 'idle';
  lastLanding = 0;
  distanceWalked = 0;

  private readonly events: SimEvent[] = [];
  private readonly rng: Rng;
  private readonly treeColliders: Collider[] = [];
  private readonly trunkColliders = new Map<number, Collider>();
  private readonly structureColliders = new Map<number, Collider>();
  private wasNight: boolean;
  private respawnTimer = 0;
  private readonly litFires: { x: number; z: number }[] = [];
  private readonly tmpColliders: Collider[] = [];
  private readonly look = { x: 0, y: 0, z: 1 };
  private readonly hit = { x: 0, y: 0, z: 0, water: false };
  private readonly moveEnv: MoveEnv;
  private readonly animalEnv: AnimalEnv;

  constructor(state: GameState) {
    this.state = state;
    this.terrain = getTerrain(state.seed);
    this.gen = getWorldGen(state.seed);
    this.rng = new Rng(state.rng);
    this.wasNight = isNight(this.hour);
    this.buildColliders();
    const query = (x: number, z: number, r: number, out: Collider[]) => this.colliders.query(x, z, r, out);
    this.moveEnv = { terrain: this.terrain, query };
    const self = this;
    this.animalEnv = {
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
      events: this.events,
      hurtPlayer(amount, source, fromX, fromZ) {
        self.hurtPlayer(amount, source, fromX, fromZ);
      },
    };
    this.refreshLitFires();
  }

  static newGame(seed: number): Simulation {
    return new Simulation(createNewState(seed));
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
      this.colliders.add(makeCollider('log', i, box(l.x, l.z, l.length / 2, l.r, l.rot), box(l.x, l.z, l.length / 2 + 0.1, l.r + 0.1, l.rot)));
    });
    gen.resources.forEach((r, i) => {
      this.colliders.add(makeCollider('resource', i, null, circle(r.x, r.z, RESOURCES[r.kind].blockRadius)));
    });
    for (const s of state.structures) this.addStructureCollider(s);
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
    if (s.dead) return;
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    const p = s.player;

    // time
    const prevDay = this.day;
    const prevHours = s.totalHours;
    s.totalHours = advanceHours(s.totalHours, dt, this.timeScale);
    const gameHours = s.totalHours - prevHours;
    if (this.day !== prevDay) this.emit({ type: 'dayStart', day: this.day });
    const night = this.night;
    if (night && !this.wasNight && this.hour > 12) {
      s.stats.events.nightfall = (s.stats.events.nightfall ?? 0) + 1;
      this.emit({ type: 'nightfall', day: this.day });
    }
    this.wasNight = night;

    // movement
    p.yaw = input.yaw;
    p.pitch = clamp(input.pitch, -1.55, 1.55);
    p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    const move = stepPlayer(p, input, this.moveEnv, dt, { canSprint: s.needs.energy > 0, exhausted: s.needs.exhausted });
    if (move.jumped) {
      spendEnergy(s.needs, BALANCE.needs.energy.jumpCost);
      this.emit({ type: 'jump' });
    }
    if (move.landed > 5) this.emit({ type: 'land', impact: move.landed });
    if (move.splash > 0) this.emit({ type: 'splash', impact: move.splash });
    this.lastLanding = move.landed;
    this.distanceWalked += move.distance;
    const speed = horizontalSpeed(p);
    this.activity = p.swimming ? 'swim' : speed < 0.5 ? 'idle' : p.sprinting ? 'sprint' : 'walk';
    const targetNoise = this.activity === 'idle' ? 0.5 : this.activity === 'sprint' ? 1.6 : 0.6 + 0.4 * Math.min(1, speed / BALANCE.player.walkSpeed);
    this.noise = damp(this.noise, targetNoise, 4, dt);

    // interaction
    this.updateTarget();
    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    if (this.placement) {
      this.updatePlacementPreview();
      if (input.primaryPressed) this.confirmPlacement();
    } else {
      this.handlePrimary(input, dt);
    }

    this.updateProjectiles(dt);
    this.updateAnimals(dt);
    this.updateFires(gameHours);
    this.updateWear(gameHours, true);
    this.updateRespawns(dt);

    // needs
    const warm = this.warmthTarget();
    const cause = updateNeeds(s.needs, {
      gameHours,
      realDt: dt,
      activity: this.activity,
      warmthTarget: warm.target,
      warmthRatePerHour: warm.rate,
      sitting: p.sitting,
    });
    if (cause) this.die(cause);

    this.progress();
    if (s.totalHours >= s.spawnCheckAt) {
      s.spawnCheckAt = s.totalHours + 1;
      this.maintainPopulation();
    }
    s.rng = this.rng.s;
  }

  private progress(): void {
    for (const id of checkUnlocks(this.state)) this.emit({ type: 'learned', recipe: id });
    for (const i of advanceObjectives(this.state)) this.emit({ type: 'objective', index: i });
  }

  private die(cause: DamageSource): void {
    const s = this.state;
    if (s.dead) return;
    s.dead = true;
    s.deathCause = cause;
    s.needs.health = 0;
    this.placement = null;
    this.bowDraw = -1;
    this.emit({ type: 'death', cause });
  }

  hurtPlayer(amount: number, source: DamageSource, fromX: number, fromZ: number): void {
    const s = this.state;
    if (s.dead) return;
    const p = s.player;
    if (p.hurtTimer > 0) return;
    p.hurtTimer = BALANCE.combat.playerHurtInvuln;
    p.sitting = false;
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

  // ------------------------------------------------------------------ warmth & fire helpers

  private refreshLitFires(): void {
    this.litFires.length = 0;
    for (const st of this.state.structures) if (PREFABS[st.prefab].fire && st.fuel > 0) this.litFires.push({ x: st.x, z: st.z });
  }

  nearestStructure(prefabFilter: (id: PrefabId) => boolean, radius: number, litOnly = false): StructureState | null {
    const p = this.state.player;
    let best: StructureState | null = null;
    let bestD = radius;
    for (const st of this.state.structures) {
      if (!prefabFilter(st.prefab)) continue;
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

  warmthTarget(): { target: number; rate: number } {
    const w = BALANCE.needs.warmth;
    const N = BALANCE.needs;
    let target = ambientWarmth(this.hour);
    let rate: number = N.warmthRatePerHour;
    const p = this.state.player;
    const fire = this.nearestStructure((id) => !!PREFABS[id].fire, N.fireWarmRadius, true);
    if (fire) {
      const d = Math.hypot(fire.x - p.x, fire.z - p.z);
      const k = 1 - clamp((d - 1.5) / (N.fireWarmRadius - 1.5), 0, 1);
      target = Math.max(target, lerp(target, w.fire, k));
      rate = N.warmthFireRatePerHour;
    }
    const shelter = this.nearestStructure((id) => !!PREFABS[id].shelter, N.shelterWarmRadius);
    if (shelter) target += PREFABS[shelter.prefab].shelter!.warmthBonus;
    if (this.state.activeTool === 'torch') target += w.torchBonus;
    if (p.wading) {
      target -= w.wadingPenalty;
      rate *= 2;
    }
    return { target: clamp(target, 0, 100), rate };
  }

  // ------------------------------------------------------------------ targeting

  private updateTarget(): void {
    const s = this.state;
    const p = s.player;
    const ex = p.x;
    const ey = p.y + BALANCE.player.eyeHeight;
    const ez = p.z;
    const d = lookDir(p.yaw, p.pitch, this.look);
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
        const gy = this.terrain.heightAt(r.x, r.z);
        const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, r.x, gy + def.hitHeight * r.scale, r.z, def.hitRadius * r.scale);
        if (hitT >= 0 && hitT < bestT) {
          bestT = hitT;
          best = { kind: 'resource', index: c.ref, dist: hitT };
        }
      } else if (c.kind === 'structure') {
        const st = s.structures.find((x) => x.id === c.ref);
        if (!st) continue;
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
      const hitT = raySphere(ex, ey, ez, d.x, d.y, d.z, cc.x, cc.y + 0.3, cc.z, cc.species === 'bear' ? 1.1 : cc.species === 'deer' ? 0.9 : 0.6);
      if (hitT >= 0 && hitT < bestT) {
        bestT = hitT;
        best = { kind: 'carcass', id: cc.id, dist: hitT };
      }
    }
    for (const a of s.animals) {
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
      case 'tree': {
        const g = this.gen.trees[t.index];
        const def = TREES[g.species];
        const dyn = s.trees[t.index];
        if (dyn.felled) {
          const name = `Fallen ${def.name}`;
          if (s.activeTool === 'axe') return { name, action: `Chop up (${dyn.logs} ${dyn.logs === 1 ? 'log' : 'logs'} left)`, enabled: true };
          return { name, action: s.tools.includes('axe') ? 'Equip axe [2] to chop up' : 'Needs an axe', enabled: false };
        }
        if (s.activeTool === 'axe') return { name: def.name, action: 'Chop down', enabled: true };
        if (def.bark > 0 && s.activeTool === 'hands') {
          return dyn.bark > 0 ? { name: def.name, action: 'Peel bark', enabled: true } : { name: def.name, action: 'Bark regrowing', enabled: false };
        }
        return { name: def.name, action: s.tools.includes('axe') ? 'Equip axe [2] to chop' : 'Needs an axe', enabled: false };
      }
      case 'resource': {
        const g = this.gen.resources[t.index];
        const def = RESOURCES[g.kind];
        const dyn = s.resources[t.index];
        if (dyn.charges <= 0) return { name: def.name, action: 'Regrowing', enabled: false };
        return { name: def.name, action: def.verb, enabled: true };
      }
      case 'drop': {
        const dr = s.drops.find((d) => d.id === t.id);
        return dr ? { name: `${dr.count} ${itemName(dr.item, dr.count)}`, action: 'Pick up', enabled: true } : null;
      }
      case 'carcass': {
        const c = s.carcasses.find((d) => d.id === t.id);
        return c ? { name: SPECIES[c.species].name, action: 'Butcher', enabled: true } : null;
      }
      case 'structure': {
        const st = s.structures.find((d) => d.id === t.id);
        if (!st) return null;
        const def = PREFABS[st.prefab];
        if (def.fire) return st.fuel > 0 ? { name: 'Campfire', action: 'Cook & add fuel', enabled: true } : { name: 'Campfire (out)', action: 'Add fuel to relight', enabled: true };
        const name = st.wear ? `${def.name} · ${conditionText(st.wear)}` : def.name;
        if (def.shelter) {
          const ok = canSleepAt(this.hour);
          return { name, action: ok ? 'Sleep until dawn' : 'Sleep (after 7 PM)', enabled: ok };
        }
        if (def.seat) return { name, action: 'Sit and rest', enabled: true };
        return { name: def.name, action: '', enabled: false };
      }
      case 'animal': {
        const a = s.animals.find((d) => d.id === t.id);
        if (!a) return null;
        const armed = s.activeTool !== 'hands' && s.activeTool !== 'bow';
        return { name: SPECIES[a.species].name, action: armed ? 'Attack' : s.activeTool === 'bow' ? 'Shoot' : 'Punch', enabled: true };
      }
      case 'water': {
        if (this.canteenFillAmount() > 0) return { name: 'Lake', action: 'Fill canteen', enabled: true };
        return { name: 'Lake', action: 'Drink', enabled: s.needs.thirst < 99.5 };
      }
    }
  }

  // ------------------------------------------------------------------ actions

  private handlePrimary(input: SimInput, dt: number): void {
    const s = this.state;
    const tool = s.activeTool;
    const t = this.target;
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
    if (!input.primary || this.actionCooldown > 0) return;
    if (!t) {
      if (input.primaryPressed) {
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
      default:
        return c.hand.cooldown;
    }
  }

  /** Execute the primary action on a target (exposed for tests and UI). */
  perform(t: Target): void {
    switch (t.kind) {
      case 'tree':
        return this.actOnTree(t.index);
      case 'resource':
        return this.gatherResource(t.index);
      case 'drop':
        return this.pickUpDrop(t.id);
      case 'carcass':
        return this.butcher(t.id);
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
    const added = addItem(s.inventory, item, count);
    if (added > 0) {
      s.stats.gathered[item] = (s.stats.gathered[item] ?? 0) + added;
      this.emit({ type: 'gathered', item, count: added, x, y, z, source });
    }
    if (added < count) {
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
      this.actionCooldown = BALANCE.combat.axe.cooldown;
      spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
      dyn.hp -= 1;
      this.emit({ type: 'swing', tool: 'axe', hit: true });
      this.emit({ type: 'chop', tree: index, x: g.x, y: gy + 1.2, z: g.z });
      if (dyn.hp <= 0) this.fellTree(index);
      this.wearTool('axe', 1);
      return;
    }
    if (def.bark > 0 && s.activeTool === 'hands') {
      this.actionCooldown = BALANCE.gather.cooldown;
      if (dyn.bark <= 0) return;
      const added = this.give('bark', 1, g.x, gy + 1.1, g.z, 'bark');
      if (added > 0) {
        dyn.bark -= 1;
        if (dyn.bark <= 0) dyn.barkAt = s.totalHours + def.barkRespawnHours;
        spendEnergy(s.needs, BALANCE.needs.energy.gatherCost);
        this.emit({ type: 'swing', tool: 'hands', hit: true });
        this.gainXp('gathering', BALANCE.skills.xp.gather);
        this.worldVersion++;
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
    this.gainXp('gathering', BALANCE.skills.xp.fell);
    this.worldVersion++;
  }

  /** One axe hit on a fallen trunk. Every `cutsPerLog` hits frees a log; the last log also yields the branches as sticks. */
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
    this.actionCooldown = BALANCE.combat.axe.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
    const p = s.player;
    const along = clamp((p.x - span.x0) * span.dx + (p.z - span.z0) * span.dz, 0, span.len);
    const hx = span.x0 + span.dx * along;
    const hz = span.z0 + span.dz * along;
    const hy = this.terrain.heightAt(hx, hz) + span.r * 1.4;
    this.emit({ type: 'swing', tool: 'axe', hit: true });
    this.emit({ type: 'chop', tree: index, x: hx, y: hy, z: hz, trunk: true });
    dyn.cuts += 1;
    if (dyn.cuts >= BALANCE.trees.cutsPerLog) {
      dyn.cuts = 0;
      dyn.logs -= 1;
      const cx = span.x0 + span.dx * Math.min(0.6, span.len / 2);
      const cz = span.z0 + span.dz * Math.min(0.6, span.len / 2);
      const cy = this.terrain.heightAt(cx, cz) + span.r;
      this.dropAt('log', 1 - this.give('log', 1, cx, cy, cz, 'tree'), cx, cz);
      if (dyn.logs <= 0) {
        this.dropAt('stick', def.sticks - this.give('stick', def.sticks, span.x1, cy, span.z1, 'tree'), span.x1, span.z1);
        this.message(`The ${def.name.toLowerCase()} is all cut up.`, 'good');
      }
      this.gainXp('gathering', BALANCE.skills.xp.log);
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
    if (dyn.charges <= 0) return;
    const gy = this.terrain.heightAt(g.x, g.z);
    const added = this.give(def.item, def.yield, g.x, gy + def.hitHeight, g.z, g.kind);
    if (added === 0) {
      this.message('Your pack is full.', 'warn');
      return;
    }
    dyn.charges -= 1;
    if (dyn.charges <= 0) dyn.respawnAt = s.totalHours + def.respawnHours;
    if (added < def.yield) this.dropAt(def.item, def.yield - added, g.x + 0.4, g.z + 0.4);
    else if (this.roll(gatherBonusChance(s.skills.gathering)) && roomFor(s.inventory, def.item) > 0) {
      this.give(def.item, 1, g.x, gy + def.hitHeight, g.z, g.kind);
    }
    spendEnergy(s.needs, BALANCE.needs.energy.gatherCost);
    this.emit({ type: 'swing', tool: 'hands', hit: true });
    this.gainXp('gathering', BALANCE.skills.xp.gather);
    this.worldVersion++;
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
    if (s.player.sitting && PREFABS[st.prefab].seat) s.player.sitting = false;
    this.worldVersion++;
  }

  /** Slow decay over `hours`: every owned tool, the lit torch (only while held and awake), and shelters and benches. */
  private updateWear(hours: number, awake: boolean): void {
    if (hours <= 0) return;
    const s = this.state;
    const D = BALANCE.durability;
    for (const tool of [...s.tools]) {
      if (!toolWears(tool)) continue;
      let amount = D.tools[tool].perHour * hours;
      if (tool === 'torch' && awake && s.activeTool === 'torch') amount += D.tools.torch.burnPerHour * hours;
      this.wearTool(tool, amount);
    }
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
    let count = dr.count;
    if (ITEMS[dr.item].water) {
      if (!s.gear.includes('canteen')) {
        this.message('You need a canteen to carry water.', 'warn');
        return;
      }
      count = Math.min(count, canteenRoom(s));
      if (count <= 0) {
        this.message('Your canteen is full.', 'warn');
        return;
      }
    }
    const added = this.give(dr.item, count, dr.x, dr.y + 0.2, dr.z, 'drop');
    if (added === 0) {
      this.message('Your pack is full.', 'warn');
      return;
    }
    dr.count -= added;
    if (dr.count <= 0) s.drops.splice(i, 1);
    this.worldVersion++;
  }

  private butcher(id: number): void {
    const s = this.state;
    const i = s.carcasses.findIndex((c) => c.id === id);
    if (i < 0) return;
    const c = s.carcasses[i];
    this.actionCooldown = BALANCE.gather.cooldown;
    let any = false;
    for (const r of c.remaining) {
      if (r.count <= 0) continue;
      const added = this.give(r.item, r.count, c.x, c.y + 0.4, c.z, 'carcass');
      r.count -= added;
      if (added > 0) any = true;
    }
    if (!any) this.message('Your pack is full.', 'warn');
    else this.gainXp('hunting', BALANCE.skills.xp.butcher);
    if (c.remaining.every((r) => r.count <= 0)) s.carcasses.splice(i, 1);
    this.emit({ type: 'swing', tool: this.state.activeTool, hit: true });
    this.worldVersion++;
  }

  private useStructure(id: number): void {
    const st = this.state.structures.find((x) => x.id === id);
    if (!st) return;
    const def = PREFABS[st.prefab];
    this.actionCooldown = 0.3;
    if (def.fire) {
      if (st.fuel <= 0) this.addFuel(id);
      else this.emit({ type: 'openCooking', structure: id });
    } else if (def.shelter) {
      this.trySleep(id);
    } else if (def.seat) {
      this.state.player.sitting = true;
      this.state.player.vx = 0;
      this.state.player.vz = 0;
      this.emit({ type: 'sat' });
      if (prefabWears(st.prefab)) this.wearStructure(st, BALANCE.durability.structures[st.prefab].useCost);
    }
  }

  /** Servings a lake click would put in the canteen (limited by canteen and pack space). */
  private canteenFillAmount(): number {
    return Math.min(canteenRoom(this.state), roomFor(this.state.inventory, 'lakeWater'));
  }

  private useWater(): void {
    const s = this.state;
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
      if (canteenRoom(s) > 0) this.message('No room in your pack for water.', 'warn');
      else this.message("You're not thirsty.");
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
    const c = BALANCE.combat;
    const stats = s.activeTool === 'axe' ? c.axe : s.activeTool === 'spear' ? c.spear : s.activeTool === 'torch' ? c.torch : c.hand;
    this.actionCooldown = stats.cooldown;
    spendEnergy(s.needs, BALANCE.needs.energy.swingCost);
    if (dist > stats.reach) {
      this.emit({ type: 'swing', tool: s.activeTool, hit: false });
      return;
    }
    this.emit({ type: 'swing', tool: s.activeTool, hit: true });
    const tool = s.activeTool;
    this.hitAnimal(a, stats.damage);
    this.wearTool(tool, 1);
  }

  /** The player's hit on an animal; the hunting skill adds damage. */
  hitAnimal(a: AnimalState, damage: number): void {
    const killed = damageAnimal(a, damage * huntDamageMultiplier(this.state.skills.hunting), this.animalEnv);
    const def = SPECIES[a.species];
    this.emit({ type: 'animalHit', id: a.id, species: a.species, x: a.x, y: a.y + def.hitHeight, z: a.z, killed });
    this.gainXp('hunting', BALANCE.skills.xp.hit);
    if (killed) this.killAnimal(a);
  }

  private killAnimal(a: AnimalState): void {
    const s = this.state;
    const i = s.animals.indexOf(a);
    if (i >= 0) s.animals.splice(i, 1);
    s.stats.kills[a.species] = (s.stats.kills[a.species] ?? 0) + 1;
    this.gainXp('hunting', BALANCE.skills.xp.kill);
    const def = SPECIES[a.species];
    const remaining = def.drops.map((d) => ({ item: d.item, count: d.count }));
    const meat = remaining.find((r) => r.item === 'rawMeat');
    if (meat && this.roll(butcherBonusChance(s.skills.hunting))) meat.count += 1;
    if (a.species === 'fish') {
      const added = this.give('rawFish', 1, a.x, WATER_LEVEL + 0.2, a.z, 'carcass');
      if (added > 0) {
        this.message('Caught a trout!', 'good');
        this.progress();
        return;
      }
    }
    s.carcasses.push({ id: s.nextId++, species: a.species, x: a.x, y: a.y, z: a.z, rot: a.heading, remaining, expiresAt: s.totalHours + 24 });
    this.worldVersion++;
    this.progress();
  }

  private fireArrow(power: number): void {
    const s = this.state;
    if (!removeItem(s.inventory, 'arrow', 1)) return;
    const b = BALANCE.combat.bow;
    const p = s.player;
    const d = lookDir(p.yaw, p.pitch, this.look);
    const speed = lerp(b.minSpeed, b.maxSpeed, power);
    const ey = p.y + BALANCE.player.eyeHeight - 0.08;
    this.projectiles.push({
      x: p.x + d.x * 0.4, y: ey + d.y * 0.4, z: p.z + d.z * 0.4,
      vx: d.x * speed, vy: d.y * speed, vz: d.z * speed,
      damage: lerp(b.minDamage, b.maxDamage, power), life: 5,
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
          if (Math.abs(a.x - pr.x) > len + 2 || Math.abs(a.z - pr.z) > len + 2) continue;
          const def = SPECIES[a.species];
          const t = raySphere(pr.x, pr.y, pr.z, dx, dy, dz, a.x, a.y + def.hitHeight, a.z, def.hitRadius);
          if (t >= 0 && t <= len) {
            this.emit({ type: 'arrowHit', x: pr.x + dx * t, y: pr.y + dy * t, z: pr.z + dz * t, target: 'animal' });
            this.hitAnimal(a, pr.damage);
            done = true;
            break;
          }
        }
        if (done) break;
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
          const water = ground < WATER_LEVEL;
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

  // ------------------------------------------------------------------ world systems

  private updateAnimals(dt: number): void {
    const s = this.state;
    const env = this.animalEnv;
    env.playerX = s.player.x;
    env.playerZ = s.player.z;
    env.playerNoise = this.noise;
    env.playerDead = s.dead;
    env.playerDeterrent = s.activeTool === 'torch';
    env.night = this.night;
    for (let i = 0; i < s.animals.length; i++) {
      const a = s.animals[i];
      const prevMode = a.mode;
      updateAnimal(a, env, dt);
      if (a.mode === 'flee' && prevMode !== 'flee' && a.species === 'deer') {
        s.stats.events.deerSpooked = (s.stats.events.deerSpooked ?? 0) + 1;
      }
    }
  }

  private updateFires(gameHours: number): void {
    let changed = false;
    for (const st of this.state.structures) {
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
    const counts: Record<SpeciesId, number> = { rabbit: 0, deer: 0, fish: 0, wolf: 0, bear: 0 };
    for (const a of s.animals) counts[a.species]++;
    const p = s.player;
    const avoidPrey: AvoidPoint[] = [{ x: p.x, z: p.z, minDist: PREY_MIN_SPAWN_DIST }];
    const avoidPred: AvoidPoint[] = [{ x: p.x, z: p.z, minDist: PREDATOR_MIN_SPAWN_DIST }];
    for (const st of s.structures) avoidPred.push({ x: st.x, z: st.z, minDist: 35 });
    for (const id of ['rabbit', 'deer', 'fish'] as const) {
      const def = SPECIES[id];
      if (def.kind === 'prey' && counts[id] < def.population) {
        const pt = findSpawnPoint(this.terrain, this.rng, id, id === 'fish' ? [] : avoidPrey);
        if (pt) s.animals.push(createAnimal(s.nextId++, id, pt.x, pt.z, this.rng, this.terrain));
      }
    }
    const targets = predatorTargets(this.day);
    for (const id of ['wolf', 'bear'] as const) {
      if (counts[id] < targets[id]) {
        const pt = findSpawnPoint(this.terrain, this.rng, id, avoidPred);
        if (pt) s.animals.push(createAnimal(s.nextId++, id, pt.x, pt.z, this.rng, this.terrain));
      }
    }
  }

  // ------------------------------------------------------------------ commands (UI)

  selectTool(tool: ToolId): boolean {
    if (!this.state.tools.includes(tool)) return false;
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
    if (!r) return { ok: false, reason: 'unknown' };
    return canCraft(this.state, r, { nearFire: this.isNearLitFire() });
  }

  craft(recipeId: string): CraftCheck {
    const recipe = RECIPE_BY_ID[recipeId];
    if (!recipe) return { ok: false, reason: 'unknown' };
    if (recipe.output.kind === 'place') {
      const check = this.canCraft(recipeId);
      if (check.ok) this.beginPlacement(recipeId);
      return check;
    }
    const s = this.state;
    const cooking = recipe.station === 'fire';
    const firstTime = (s.stats.crafted[recipeId] ?? 0) === 0;
    const res = craftRecipe(s, recipeId, { nearFire: this.isNearLitFire() });
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
      if (out.kind === 'tool') this.selectTool(out.tool);
      if (item) this.emit({ type: 'gathered', item, count, x: s.player.x, y: s.player.y + 1.2, z: s.player.z, source: 'craft' });
      this.gainXp(cooking ? 'cooking' : 'crafting', cooking ? BALANCE.skills.xp.cook : BALANCE.skills.xp.craft);
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
    return this.state.resources[index].charges > 0 || !!RESOURCES[this.gen.resources[index].kind].persistent;
  }

  private resourceCovered(index: number): boolean {
    const g = this.gen.resources[index];
    const spot = circle(g.x, g.z, RESOURCES[g.kind].blockRadius);
    this.colliders.query(g.x, g.z, spot.r + 3, this.tmpColliders);
    return this.tmpColliders.some((c) => c.kind === 'structure' && !!c.footprint && overlaps(spot, c.footprint));
  }

  /** Aim the ghost where the camera ray meets the ground (clamped to build reach). */
  updatePlacementPreview(): void {
    const pl = this.placement;
    if (!pl) return;
    const p = this.state.player;
    const ey = p.y + BALANCE.player.eyeHeight;
    const d = lookDir(p.yaw, p.pitch, this.look);
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
    const res = checkPlacement(this.placementEnv(), pl.prefab, pl.x, pl.z, pl.rot);
    if (!res.valid) {
      this.emit({ type: 'placeFailed', reason: res.reason! });
      return false;
    }
    if (!removeAll(this.state.inventory, recipe.inputs)) {
      this.message('Missing ingredients.', 'warn');
      this.placement = null;
      return false;
    }
    const s = this.state;
    const def = PREFABS[pl.prefab];
    const st: StructureState = { id: s.nextId++, prefab: pl.prefab, x: pl.x, y: res.y, z: pl.z, rot: pl.rot, fuel: def.fire ? BALANCE.fire.initialFuelHours : 0 };
    if (prefabWears(st.prefab)) st.wear = newStructureWear(st.prefab, s.skills.crafting);
    s.structures.push(st);
    this.addStructureCollider(st);
    s.stats.crafted[recipe.id] = (s.stats.crafted[recipe.id] ?? 0) + 1;
    this.placement = null;
    this.actionCooldown = 0.4;
    spendEnergy(s.needs, BALANCE.needs.energy.buildCost);
    this.refreshLitFires();
    this.worldVersion++;
    this.emit({ type: 'placed', structure: st.id, prefab: st.prefab });
    this.gainXp('crafting', BALANCE.skills.xp.build);
    this.progress();
    return true;
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
    let best = -1;
    let bestScore = 0;
    s.inventory.slots.forEach((slot, i) => {
      if (!slot) return;
      const f = ITEMS[slot.item].food;
      if (!f) return;
      const score =
        (100 - n.hunger) * (f.hunger ?? 0) +
        (100 - n.thirst) * (f.thirst ?? 0) * 1.2 +
        (100 - n.warmth) * (f.warmth ?? 0) * 0.3 +
        (f.health ?? 0) * 40;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) {
      this.message('Nothing useful to eat or drink.', 'warn');
      return false;
    }
    return this.useSlot(best);
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
    const st = s.structures.find((x) => x.id === structureId);
    if (!st || !PREFABS[st.prefab].fire) return false;
    const f = BALANCE.fire;
    if (st.fuel >= f.maxFuelHours - 0.5) {
      this.message('The fire is roaring already.');
      return false;
    }
    const item: ItemId | null = fuel
      ? (countItem(s.inventory, fuel) > 0 ? fuel : null)
      : countItem(s.inventory, 'log') > 0 ? 'log' : countItem(s.inventory, 'stick') > 0 ? 'stick' : null;
    if (!item) {
      this.message(fuel ? `You have no ${fuel === 'log' ? 'logs' : 'sticks'} to add.` : 'You need sticks or logs to fuel the fire.', 'warn');
      return false;
    }
    removeItem(s.inventory, item, 1);
    const wasOut = st.fuel <= 0;
    st.fuel = Math.min(f.maxFuelHours, st.fuel + (item === 'log' ? f.logFuelHours : f.stickFuelHours));
    if (wasOut) this.refreshLitFires();
    this.worldVersion++;
    this.emit({ type: 'fuelAdded', structure: st.id, item });
    return true;
  }

  /** Sleep in a shelter: skips to the next dawn, fully restores energy. */
  trySleep(structureId: number): boolean {
    const s = this.state;
    const st = s.structures.find((x) => x.id === structureId);
    if (!st || !PREFABS[st.prefab].shelter) return false;
    if (!canSleepAt(this.hour)) {
      this.emit({ type: 'sleepDenied', reason: 'You can only sleep after 7 PM.' });
      return false;
    }
    const p = s.player;
    const threat = s.animals.some((a) => SPECIES[a.species].kind === 'predator' && ['stalk', 'chase', 'attack', 'warn', 'reposition'].includes(a.mode) && Math.hypot(a.x - p.x, a.z - p.z) < 35);
    if (threat) {
      this.emit({ type: 'sleepDenied', reason: "You can't sleep with a predator nearby!" });
      return false;
    }
    const before = s.totalHours;
    s.totalHours = nextDayStart(s.totalHours);
    const elapsed = s.totalHours - before;
    for (const f of s.structures) if (PREFABS[f.prefab].fire && f.fuel > 0) f.fuel = Math.max(0, f.fuel - elapsed);
    this.refreshLitFires();
    applySleep(s.needs, PREFABS[st.prefab].shelter!);
    this.updateWear(elapsed, false);
    if (prefabWears(st.prefab) && s.structures.includes(st)) this.wearStructure(st, BALANCE.durability.structures[st.prefab].useCost);
    p.sitting = false;
    p.vx = 0;
    p.vz = 0;
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
    this.emit({ type: 'slept', day: this.day });
    this.emit({ type: 'dayStart', day: this.day });
    this.progress();
    return true;
  }

  currentObjective(): { title: string; hint: string; progress: string | null } | null {
    const o = OBJECTIVES[this.state.objective];
    if (!o) return null;
    return { title: o.title, hint: o.hint, progress: o.progress ? o.progress(this.state) : null };
  }

  capacity(): number {
    return slotsFor(this.state);
  }

  // ------------------------------------------------------------------ dev helpers

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

  devSpawn(species: SpeciesId, distance = 22): AnimalState | null {
    const p = this.state.player;
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

function conditionText(w: Wear): string {
  return `${Math.max(1, Math.round(wearFraction(w) * 100))}% condition`;
}

/** Hearty campfire dishes can char; drinks (boiled water, tea) can't. */
function canBurn(item: ItemId): boolean {
  const def = ITEMS[item];
  return !!def.meal && !def.water;
}

function removeAllDryRun(state: GameState, inputs: readonly { item: ItemId; count: number }[]): boolean {
  for (const i of inputs) if (countItem(state.inventory, i.item) < i.count) return false;
  return true;
}
