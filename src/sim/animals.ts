import { pushCircleOut } from '../core/geom2d';
import { damp, headingTo, turnToward } from '../core/math';
import type { Rng } from '../core/rng';
import { BALANCE } from '../data/balance';
import { biomeDef } from '../data/biomes';
import { SPECIES, type PestSpecies, type PredatorSpecies, type PreySpecies, type SpeciesId, type Territory } from '../data/species';
import type { Collider } from './colliders';
import type { SimEvent } from './events';
import type { AnimalMode, AnimalState, DamageSource } from './state';
import { PLAY_HALF, WATER_LEVEL, type Terrain } from './terrain';

export interface AnimalEnv {
  terrain: Terrain;
  rng: Rng;
  query(x: number, z: number, r: number, out: Collider[]): Collider[];
  playerX: number;
  playerZ: number;
  /** 0.5 standing still, 1 walking, ~1.6 sprinting. Scales how far animals notice you. */
  playerNoise: number;
  playerDead: boolean;
  /** Holding a torch keeps predators at bay. */
  playerDeterrent: boolean;
  litFires: readonly { x: number; z: number }[];
  night: boolean;
  /** Every animal in the world, so territorial ones can see who wanders in. */
  readonly animals: readonly AnimalState[];
  events: SimEvent[];
  hurtPlayer(amount: number, source: DamageSource, fromX: number, fromZ: number): void;
}

/** Predators never walk closer than this to a lit fire. */
export const FIRE_AVOID_RADIUS = 6;
export const STALK_KEEP_DIST = 7.5;
export const FAR_LOD_DIST = 110;

export function isHabitable(t: Terrain, species: SpeciesId, x: number, z: number): boolean {
  if (Math.abs(x) > PLAY_HALF - 4 || Math.abs(z) > PLAY_HALF - 4) return false;
  if (SPECIES[species].habitat === 'water') return t.waterDepth(x, z) > 0.6;
  if (t.heightAt(x, z) < WATER_LEVEL + 0.15) return false;
  return t.slopeAt(x, z) < 0.9;
}

export function createAnimal(id: number, species: SpeciesId, x: number, z: number, rng: Rng, t: Terrain): AnimalState {
  const def = SPECIES[species];
  return {
    id, species, x, z,
    y: def.habitat === 'water' ? WATER_LEVEL : t.heightAt(x, z),
    heading: rng.range(-Math.PI, Math.PI),
    mode: 'idle', modeTime: 0, timer: rng.range(0.5, 4), tx: x, tz: z, alertDist: 0,
    health: def.maxHealth,
    temperament: rng.range(0.78, 1.28),
    homeX: x, homeZ: z, speed: 0, cooldown: 0, aggroCooldown: 0, hurt: 0, lod: 0,
  };
}

function setMode(a: AnimalState, mode: AnimalMode, timer: number): void {
  a.mode = mode;
  a.modeTime = 0;
  a.timer = timer;
}

function nearFire(env: AnimalEnv, x: number, z: number, r: number): boolean {
  for (const f of env.litFires) {
    const dx = f.x - x;
    const dz = f.z - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

export function playerDeterred(env: AnimalEnv): boolean {
  return env.playerDeterrent || nearFire(env, env.playerX, env.playerZ, BALANCE.fire.predatorSafeRadius);
}

const STEER_OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3, Math.PI];
const tmpColliders: Collider[] = [];
const push = [0, 0];

function canStand(a: AnimalState, env: AnimalEnv, x: number, z: number): boolean {
  if (!isHabitable(env.terrain, a.species, x, z)) return false;
  if (SPECIES[a.species].kind === 'predator' && nearFire(env, x, z, FIRE_AVOID_RADIUS)) return false;
  return true;
}

/** Steers toward a heading with simple feeler-based avoidance of water, cliffs, bounds and fires. */
function steer(a: AnimalState, env: AnimalEnv, desired: number, speed: number, dt: number): void {
  const def = SPECIES[a.species];
  a.speed = damp(a.speed, speed, 5, dt);
  if (speed <= 0.001 && a.speed < 0.05) {
    a.speed = 0;
    return;
  }
  const look = Math.max(1.2, a.speed * 0.45);
  let chosen = NaN;
  for (const off of STEER_OFFSETS) {
    const h = desired + off;
    if (canStand(a, env, a.x + Math.sin(h) * look, a.z + Math.cos(h) * look)) {
      chosen = h;
      break;
    }
  }
  if (Number.isNaN(chosen)) {
    a.speed *= 0.5;
    return;
  }
  a.heading = turnToward(a.heading, chosen, def.turnRate * dt);
  const nx = a.x + Math.sin(a.heading) * a.speed * dt;
  const nz = a.z + Math.cos(a.heading) * a.speed * dt;
  if (!canStand(a, env, nx, nz)) {
    a.speed *= 0.6;
    return;
  }
  a.x = nx;
  a.z = nz;
  if (def.habitat === 'land') {
    env.query(a.x, a.z, def.radius + 2, tmpColliders);
    for (const c of tmpColliders) {
      if (c.body && pushCircleOut(a.x, a.z, def.radius, c.body, push)) {
        a.x += push[0];
        a.z += push[1];
      }
    }
    a.y = env.terrain.heightAt(a.x, a.z);
  } else {
    a.y = WATER_LEVEL;
  }
}

function pickTarget(a: AnimalState, env: AnimalEnv, cx: number, cz: number, radius: number): void {
  for (let i = 0; i < 10; i++) {
    const ang = env.rng.range(0, Math.PI * 2);
    const r = env.rng.range(radius * 0.25, radius);
    const x = cx + Math.cos(ang) * r;
    const z = cz + Math.sin(ang) * r;
    if (canStand(a, env, x, z)) {
      a.tx = x;
      a.tz = z;
      return;
    }
  }
  a.tx = a.x;
  a.tz = a.z;
}

/** Effective radii after temperament and how much noise the player is making. */
export function preyRadii(a: AnimalState, env: Pick<AnimalEnv, 'playerNoise' | 'night'>): { alert: number; fear: number } {
  const def = SPECIES[a.species] as PreySpecies;
  const k = a.temperament * env.playerNoise * (env.night ? 0.85 : 1);
  return { alert: def.alertRadius * k, fear: def.fearRadius * k };
}

function startFlee(a: AnimalState, env: AnimalEnv, spooked: boolean): void {
  setMode(a, 'flee', env.rng.range(2.5, 4));
  if (spooked) env.events.push({ type: 'animalFlee', id: a.id, species: a.species });
}

/**
 * A rattlesnake coils and rattles instead of bolting, and bites whoever steps too close. It relaxes once you back
 * off and only flees (slowly) when hurt.
 */
function updateCoiled(a: AnimalState, def: PreySpecies, env: AnimalEnv, dt: number, d: number): void {
  const strike = def.strike!;
  a.speed = damp(a.speed, 0, 8, dt);
  a.heading = turnToward(a.heading, headingTo(a.x, a.z, env.playerX, env.playerZ), def.turnRate * dt);
  if (env.playerDead) {
    setMode(a, 'idle', env.rng.range(1, 3));
    return;
  }
  if (d < strike.radius && a.cooldown <= 0) {
    a.cooldown = strike.cooldown;
    env.hurtPlayer(strike.damage, a.species as DamageSource, a.x, a.z);
    env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
  } else if (d > def.alertRadius * 1.3) {
    setMode(a, 'idle', env.rng.range(2, 4));
  }
}

/** Idle and wander: stand a while, then amble to a new spot around home. */
function roam(a: AnimalState, def: PreySpecies, env: AnimalEnv, dt: number): void {
  if (a.mode === 'idle') {
    steer(a, env, a.heading, 0, dt);
    if (a.timer <= 0) {
      pickTarget(a, env, a.homeX, a.homeZ, def.wanderRadius);
      setMode(a, 'wander', env.rng.range(6, 12));
    }
  } else {
    const td = Math.hypot(a.tx - a.x, a.tz - a.z);
    steer(a, env, headingTo(a.x, a.z, a.tx, a.tz), def.walkSpeed, dt);
    if (td < 0.8 || a.timer <= 0) setMode(a, 'idle', env.rng.range(2, 6));
  }
}

/** Runs from the player, or from the animal in `foe` (a charging javelina) while there is one. */
function flee(a: AnimalState, def: PreySpecies, env: AnimalEnv, dt: number, d: number): void {
  const from = a.foe === undefined ? null : (env.animals.find((o) => o.id === a.foe) ?? null);
  if (a.foe !== undefined && !from) a.foe = undefined;
  const away = from ? headingTo(from.x, from.z, a.x, a.z) : headingTo(env.playerX, env.playerZ, a.x, a.z);
  const wobble = Math.sin(a.modeTime * 2.3 + a.id) * 0.35;
  steer(a, env, away + wobble, def.runSpeed * (a.hurt > 0 ? 1.1 : 1), dt);
  const fd = from ? Math.hypot(from.x - a.x, from.z - a.z) : d;
  if (a.timer <= 0 && fd > def.calmRadius * a.temperament) {
    a.homeX = a.x;
    a.homeZ = a.z;
    a.foe = undefined;
    setMode(a, 'idle', env.rng.range(2, 5));
  }
}

function updatePrey(a: AnimalState, def: PreySpecies, env: AnimalEnv, dt: number, d: number): void {
  if (def.territory) {
    updateTerritorial(a, def, def.territory, env, dt, d);
    return;
  }
  const { alert, fear } = env.playerDead ? { alert: 0, fear: 0 } : preyRadii(a, env);
  if (def.strike && a.mode === 'alert') {
    updateCoiled(a, def, env, dt, d);
    return;
  }
  switch (a.mode) {
    case 'idle':
    case 'wander': {
      if (d < fear) {
        startFlee(a, env, true);
        break;
      }
      if (d < alert) {
        setMode(a, 'alert', env.rng.range(def.alertTime[0], def.alertTime[1]));
        a.alertDist = d;
        if (def.strike) env.events.push({ type: 'rattle', id: a.id, x: a.x, z: a.z });
        break;
      }
      roam(a, def, env, dt);
      break;
    }
    case 'alert': {
      a.speed = damp(a.speed, 0, 8, dt);
      a.heading = turnToward(a.heading, headingTo(a.x, a.z, env.playerX, env.playerZ), def.turnRate * dt);
      if (d < fear) startFlee(a, env, true);
      else if (d > alert * 1.2) setMode(a, 'idle', env.rng.range(1, 3));
      else if (a.timer <= 0) {
        // Bolt if the player has crept closer since the alert began; otherwise keep watching.
        if (d < a.alertDist - 0.75) startFlee(a, env, true);
        else a.timer = env.rng.range(def.alertTime[0], def.alertTime[1]);
      }
      break;
    }
    case 'flee':
      flee(a, def, env, dt, d);
      break;
    default:
      setMode(a, 'idle', 1);
  }
}

const PLAYER = -1;
const NOBODY = -2;

/** Other land animals a territorial one drives off: not its own kind, and not scorpions. */
function trespasser(o: AnimalState): boolean {
  const def = SPECIES[o.species];
  return def.habitat === 'land' && def.kind !== 'pest' && !(def.kind === 'prey' && def.territory);
}

/** Who is inside the territory and close enough to see: the player first, then any other animal. */
function intruder(a: AnimalState, t: Territory, env: AnimalEnv, d: number): number {
  if (!env.playerDead && d < t.sight && Math.hypot(env.playerX - a.homeX, env.playerZ - a.homeZ) < t.radius) return PLAYER;
  for (const o of env.animals) {
    if (o === a || Math.abs(o.x - a.x) > t.sight || Math.abs(o.z - a.z) > t.sight || !trespasser(o)) continue;
    if (Math.hypot(o.x - a.x, o.z - a.z) < t.sight && Math.hypot(o.x - a.homeX, o.z - a.homeZ) < t.radius) return o.id;
  }
  return NOBODY;
}

/** Where the current foe is (the player unless `foe` names an animal), or null once it is gone or dead. */
function foeAt(a: AnimalState, env: AnimalEnv): { x: number; z: number } | null {
  if (a.foe === undefined) return env.playerDead ? null : { x: env.playerX, z: env.playerZ };
  return env.animals.find((o) => o.id === a.foe) ?? null;
}

/** Clack a warning at `foe`. Prey it targets bolts at once; herd-mates nearby join in against a player. */
function warn(a: AnimalState, t: Territory, env: AnimalEnv, foe: number, rally: boolean): void {
  a.foe = foe === PLAYER ? undefined : foe;
  setMode(a, 'warn', t.warnTime);
  if (foe === PLAYER) {
    env.events.push({ type: 'predatorAlert', id: a.id, species: a.species, x: a.x, z: a.z });
    if (!rally) return;
    for (const o of env.animals) {
      if (o === a || o.species !== a.species || o.aggroCooldown > 0 || Math.hypot(o.x - a.x, o.z - a.z) > t.rally) continue;
      if (o.mode === 'idle' || o.mode === 'wander' || o.mode === 'alert') warn(o, t, env, PLAYER, false);
    }
    return;
  }
  const o = env.animals.find((x) => x.id === foe);
  if (o && SPECIES[o.species].kind === 'prey') {
    o.foe = a.id;
    setMode(o, 'flee', env.rng.range(2.5, 4));
  }
}

/** A charge connected with an animal: prey runs from this one, a predator slinks off home. */
function butt(a: AnimalState, o: AnimalState, env: AnimalEnv): void {
  const def = SPECIES[o.species];
  o.hurt = 0.35;
  if (def.kind === 'predator') {
    setMode(o, 'retreat', 20);
    o.aggroCooldown = Math.max(o.aggroCooldown, def.aggroCooldown);
  } else if (def.kind === 'prey') {
    o.foe = a.id;
    setMode(o, 'flee', env.rng.range(2.5, 4));
  }
}

/** Gives up the charge and walks home, ignoring intruders for a few seconds. */
function standDown(a: AnimalState): void {
  a.foe = undefined;
  setMode(a, 'retreat', 12);
  a.aggroCooldown = 4;
}

/**
 * Javelinas hold ground around home (see `Territory`): `warn` while clacking at an intruder, `chase` while charging
 * it, `reposition` while backing off after a hit, `retreat` while walking home. Outside the territory they only
 * watch you (`alert`); badly hurt they `flee`.
 */
function updateTerritorial(a: AnimalState, def: PreySpecies, t: Territory, env: AnimalEnv, dt: number, d: number): void {
  switch (a.mode) {
    case 'idle':
    case 'wander':
    case 'alert': {
      if (a.aggroCooldown <= 0) {
        const foe = intruder(a, t, env, d);
        if (foe !== NOBODY) {
          warn(a, t, env, foe, true);
          break;
        }
      }
      const alert = env.playerDead ? 0 : preyRadii(a, env).alert;
      if (a.mode === 'alert') {
        a.speed = damp(a.speed, 0, 8, dt);
        a.heading = turnToward(a.heading, headingTo(a.x, a.z, env.playerX, env.playerZ), def.turnRate * dt);
        if (d > alert * 1.2) setMode(a, 'idle', env.rng.range(1, 3));
      } else if (d < alert) {
        setMode(a, 'alert', env.rng.range(def.alertTime[0], def.alertTime[1]));
      } else {
        roam(a, def, env, dt);
      }
      break;
    }
    case 'warn': {
      const f = foeAt(a, env);
      if (!f) {
        standDown(a);
        break;
      }
      a.speed = damp(a.speed, 0, 8, dt);
      a.heading = turnToward(a.heading, headingTo(a.x, a.z, f.x, f.z), def.turnRate * 1.5 * dt);
      if (a.timer <= 0) {
        setMode(a, 'chase', 0);
        if (a.foe === undefined) env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
      }
      break;
    }
    case 'chase': {
      const f = foeAt(a, env);
      if (!f || a.modeTime > t.maxCharge || Math.hypot(f.x - a.homeX, f.z - a.homeZ) > t.radius * t.leash) {
        standDown(a);
        break;
      }
      steer(a, env, headingTo(a.x, a.z, f.x, f.z), t.chargeSpeed, dt);
      if (Math.hypot(f.x - a.x, f.z - a.z) <= t.range && a.cooldown <= 0) {
        a.cooldown = t.cooldown;
        if (a.foe === undefined) env.hurtPlayer(t.damage, a.species as DamageSource, a.x, a.z);
        else butt(a, f as AnimalState, env);
        setMode(a, 'reposition', 0.8);
      }
      break;
    }
    case 'reposition': {
      const f = foeAt(a, env);
      if (!f) {
        standDown(a);
        break;
      }
      steer(a, env, headingTo(f.x, f.z, a.x, a.z), def.walkSpeed * 2.5, dt);
      if (a.timer <= 0) setMode(a, 'chase', 0);
      break;
    }
    case 'retreat': {
      steer(a, env, headingTo(a.x, a.z, a.homeX, a.homeZ), def.walkSpeed * 2, dt);
      if (Math.hypot(a.homeX - a.x, a.homeZ - a.z) < 3 || a.timer <= 0) setMode(a, 'idle', env.rng.range(2, 5));
      else if (a.aggroCooldown <= 0 && intruder(a, t, env, d) !== NOBODY) setMode(a, 'idle', 0);
      break;
    }
    case 'flee':
      flee(a, def, env, dt, d);
      break;
    default:
      setMode(a, 'idle', 1);
  }
}

function checkAggro(a: AnimalState, def: PredatorSpecies, env: AnimalEnv, d: number, detectR: number): void {
  if (env.playerDead || a.aggroCooldown > 0) return;
  if (def.warnRadius > 0) {
    if (d < def.warnRadius) {
      setMode(a, 'warn', def.warnTime);
      env.events.push({ type: 'predatorAlert', id: a.id, species: a.species, x: a.x, z: a.z });
    }
  } else if (d < detectR) {
    setMode(a, 'stalk', 10);
    env.events.push({ type: 'predatorAlert', id: a.id, species: a.species, x: a.x, z: a.z });
  }
}

/** Drops back to a relaxed wander around home with a fresh destination. */
function calmDown(a: AnimalState, def: PredatorSpecies, env: AnimalEnv, timer: number): void {
  pickTarget(a, env, a.homeX, a.homeZ, def.wanderRadius);
  setMode(a, 'wander', timer);
}

function updatePredator(a: AnimalState, def: PredatorSpecies, env: AnimalEnv, dt: number, d: number): void {
  const deterred = playerDeterred(env);
  const homeD = Math.hypot(a.x - a.homeX, a.z - a.homeZ);
  const detectR = def.detectRadius * (env.night ? def.nightDetectMul : 1) * (0.75 + 0.25 * env.playerNoise);
  const toPlayer = headingTo(a.x, a.z, env.playerX, env.playerZ);
  const canAggro = !env.playerDead && a.aggroCooldown <= 0;
  const isBear = def.warnRadius > 0;
  const retreat = () => {
    setMode(a, 'retreat', 25);
    a.aggroCooldown = def.aggroCooldown;
  };

  switch (a.mode) {
    case 'idle': {
      steer(a, env, a.heading, 0, dt);
      if (a.timer <= 0) {
        if (!isBear && env.night && d < 70 && !env.playerDead) {
          pickTarget(a, env, env.playerX, env.playerZ, 14);
        } else {
          pickTarget(a, env, a.homeX, a.homeZ, def.wanderRadius);
        }
        setMode(a, 'wander', env.rng.range(8, 16));
      }
      checkAggro(a, def, env, d, detectR);
      break;
    }
    case 'wander': {
      const td = Math.hypot(a.tx - a.x, a.tz - a.z);
      steer(a, env, headingTo(a.x, a.z, a.tx, a.tz), def.walkSpeed, dt);
      if (td < 1 || a.timer <= 0) setMode(a, 'idle', env.rng.range(2, 5));
      checkAggro(a, def, env, d, detectR);
      break;
    }
    case 'warn': {
      steer(a, env, toPlayer, 0, dt);
      a.heading = turnToward(a.heading, toPlayer, def.turnRate * dt);
      if (!canAggro) calmDown(a, def, env, 5);
      else if (deterred) retreat();
      else if (d < def.chargeRadius || (a.timer <= 0 && d < def.warnRadius)) {
        setMode(a, 'chase', 0);
        env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
      } else if (d > def.warnRadius * 1.3) calmDown(a, def, env, 5);
      break;
    }
    case 'stalk': {
      if (!canAggro) {
        calmDown(a, def, env, 5);
        break;
      }
      if (deterred) {
        const keep = d < STALK_KEEP_DIST ? toPlayer + Math.PI : toPlayer + Math.PI / 2;
        steer(a, env, keep, def.walkSpeed * 1.4, dt);
        if (a.timer <= 0) retreat();
      } else {
        steer(a, env, toPlayer, def.walkSpeed * 1.7, dt);
        if (d < def.chargeRadius) {
          setMode(a, 'chase', 0);
          env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
        }
      }
      if (d > detectR * 1.8) calmDown(a, def, env, 5);
      break;
    }
    case 'chase': {
      if (!canAggro) calmDown(a, def, env, 5);
      else if (deterred) {
        if (isBear) retreat();
        else setMode(a, 'stalk', 10);
      } else if (homeD > def.leash) retreat();
      else {
        steer(a, env, toPlayer, def.runSpeed, dt);
        if (d <= def.attackRange) setMode(a, 'attack', 0);
      }
      break;
    }
    case 'attack': {
      a.speed = damp(a.speed, 0, 10, dt);
      a.heading = turnToward(a.heading, toPlayer, def.turnRate * 2 * dt);
      if (!canAggro) calmDown(a, def, env, 5);
      else if (deterred) {
        if (isBear) retreat();
        else setMode(a, 'stalk', 10);
      } else if (d > def.attackRange * 1.5) setMode(a, 'chase', 0);
      else if (a.cooldown <= 0) {
        a.cooldown = def.attackCooldown;
        env.hurtPlayer(def.attackDamage, a.species as DamageSource, a.x, a.z);
        env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
        if (!isBear) setMode(a, 'reposition', 0.7);
      }
      break;
    }
    case 'reposition': {
      steer(a, env, toPlayer + Math.PI, def.walkSpeed * 2.2, dt);
      if (a.timer <= 0) setMode(a, 'chase', 0);
      break;
    }
    case 'retreat': {
      steer(a, env, headingTo(a.x, a.z, a.homeX, a.homeZ), def.runSpeed * 0.85, dt);
      if (homeD < 5 || a.timer <= 0) calmDown(a, def, env, 4);
      break;
    }
    default:
      setMode(a, 'idle', 1);
  }
}

/**
 * A scorpion out from under its stone: `alert` while it rears up, `chase` while it goes after the nearest player,
 * `retreat` while it burrows back in (the simulation removes it once `burrowed`).
 */
function updatePest(a: AnimalState, def: PestSpecies, env: AnimalEnv, dt: number, d: number): void {
  const toPlayer = headingTo(a.x, a.z, env.playerX, env.playerZ);
  switch (a.mode) {
    case 'retreat':
      a.speed = damp(a.speed, 0, 10, dt);
      break;
    case 'alert':
      a.speed = damp(a.speed, 0, 10, dt);
      a.heading = turnToward(a.heading, toPlayer, def.turnRate * dt);
      if (a.timer <= 0) setMode(a, 'chase', def.giveUpTime);
      break;
    case 'chase': {
      if (d < def.giveUpDist && !env.playerDead) a.timer = def.giveUpTime;
      if (a.timer <= 0 || a.modeTime > def.maxChase) {
        setMode(a, 'retreat', def.burrowTime);
        break;
      }
      steer(a, env, toPlayer, d > def.sting.range * 0.6 ? def.runSpeed : 0, dt);
      if (d < 1.5) a.heading = turnToward(a.heading, toPlayer, def.turnRate * dt);
      if (d <= def.sting.range && a.cooldown <= 0 && !env.playerDead) {
        a.cooldown = def.sting.cooldown;
        env.hurtPlayer(def.sting.damage, a.species as DamageSource, a.x, a.z);
        env.events.push({ type: 'predatorAttack', id: a.id, species: a.species });
      }
      break;
    }
    default:
      setMode(a, 'alert', def.revealTime);
  }
}

const PREDATOR_ACTIVE: readonly AnimalMode[] = ['stalk', 'chase', 'attack', 'warn', 'reposition'];

/** Hunting, charging or stinging someone right now: nobody can sleep with one of these close by. */
export function hostile(a: AnimalState): boolean {
  const def = SPECIES[a.species];
  if (def.kind === 'predator') return PREDATOR_ACTIVE.includes(a.mode);
  if (def.kind === 'pest') return a.mode === 'alert' || a.mode === 'chase';
  return !!def.territory && a.foe === undefined && (a.mode === 'warn' || a.mode === 'chase' || a.mode === 'reposition');
}

/** A scorpion that has finished digging back in; the simulation drops it. */
export function burrowed(a: AnimalState): boolean {
  return SPECIES[a.species].kind === 'pest' && a.mode === 'retreat' && a.timer <= 0;
}

export function updateAnimal(a: AnimalState, env: AnimalEnv, dt: number): void {
  const def = SPECIES[a.species];
  const d = Math.hypot(env.playerX - a.x, env.playerZ - a.z);
  if (d > FAR_LOD_DIST && a.mode !== 'retreat' && a.mode !== 'flee') {
    a.lod += dt;
    if (a.lod < 0.25) return;
    dt = a.lod;
  }
  a.lod = 0;
  a.modeTime += dt;
  a.timer -= dt;
  a.cooldown -= dt;
  a.aggroCooldown -= dt;
  a.hurt = Math.max(0, a.hurt - dt);
  if (def.kind === 'prey') updatePrey(a, def, env, dt, d);
  else if (def.kind === 'pest') updatePest(a, def, env, dt, d);
  else updatePredator(a, def, env, dt, d);
}

/** Applies damage. Returns true when the animal is killed. */
export function damageAnimal(a: AnimalState, amount: number, env: AnimalEnv): boolean {
  const def = SPECIES[a.species];
  a.health -= amount;
  a.hurt = 0.35;
  if (a.health <= 0) return true;
  if (def.kind === 'prey' && def.territory) {
    // Stands its ground and charges whoever hit it, unless badly hurt or shot from well outside its range.
    const t = def.territory;
    const near = Math.hypot(env.playerX - a.homeX, env.playerZ - a.homeZ) < t.radius * t.leash;
    if (a.health / def.maxHealth > t.fleeFrac && near) {
      a.foe = undefined;
      a.aggroCooldown = 0;
      if (a.mode !== 'chase' && a.mode !== 'reposition') setMode(a, 'chase', 0);
    } else {
      a.foe = undefined;
      startFlee(a, env, false);
    }
  } else if (def.kind === 'prey') startFlee(a, env, false);
  else if (def.kind === 'pest') {
    if (a.mode !== 'retreat') setMode(a, 'chase', def.giveUpTime);
  } else if (a.health / def.maxHealth <= def.retreatHealthFrac) {
    setMode(a, 'retreat', 30);
    a.aggroCooldown = def.aggroCooldown * 2;
  } else {
    a.aggroCooldown = 0;
    setMode(a, 'chase', 0);
  }
  return false;
}

export interface AvoidPoint {
  x: number;
  z: number;
  minDist: number;
}

export function findSpawnPoint(t: Terrain, rng: Rng, species: SpeciesId, avoid: readonly AvoidPoint[], tries = 60): { x: number; z: number } | null {
  const water = SPECIES[species].habitat === 'water';
  if (water && t.fishLakes.length === 0) return null;
  const upland = biomeDef(t.biome).uplandOnly.includes(species);
  for (let i = 0; i < tries; i++) {
    let x: number;
    let z: number;
    if (water) {
      const lake = rng.pick(t.fishLakes);
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(0, lake.r * 0.75);
      x = lake.x + Math.cos(ang) * r;
      z = lake.z + Math.sin(ang) * r;
    } else {
      x = rng.range(-PLAY_HALF + 10, PLAY_HALF - 10);
      z = rng.range(-PLAY_HALF + 10, PLAY_HALF - 10);
      if (t.slopeAt(x, z) > 0.5) continue;
      if (t.landforms.length > 0 && t.landformAt(x, z).rock > 0.3) continue;
      if (upland && t.upland(x, z) < 0.45) continue;
    }
    if (!isHabitable(t, species, x, z)) continue;
    let ok = true;
    for (const p of avoid) {
      if (Math.hypot(p.x - x, p.z - z) < p.minDist) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, z };
  }
  return null;
}
