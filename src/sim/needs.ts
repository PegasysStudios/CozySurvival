import { clamp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { FoodEffect } from '../data/items';
import type { DamageSource, NeedsState } from './state';

const N = BALANCE.needs;
const E = N.energy;

export type Activity = 'idle' | 'walk' | 'sprint' | 'swim';

export interface NeedsContext {
  /** Game hours elapsed this step (already time-scaled). */
  gameHours: number;
  /** Real seconds elapsed this step. */
  realDt: number;
  activity: Activity;
  warmthTarget: number;
  warmthRatePerHour: number;
  sitting: boolean;
  /** False during the grace nights: freezing still hurts but stops at 1 health. Defaults to true. */
  coldLethal?: boolean;
}

export function createNeeds(): NeedsState {
  const s = N.start;
  return { health: s.health, hunger: s.hunger, thirst: s.thirst, warmth: s.warmth, energy: s.energy, regenBoost: 0, exhausted: false };
}

/**
 * Advances hunger, thirst, warmth, energy, and health.
 * Returns the damage source responsible if health reached zero this step, otherwise null.
 */
export function updateNeeds(n: NeedsState, ctx: NeedsContext): DamageSource | null {
  const h = ctx.gameHours;
  n.hunger = clamp(n.hunger - N.hungerPerHour * h, 0, 100);
  n.thirst = clamp(n.thirst - N.thirstPerHour * h, 0, 100);

  const step = ctx.warmthRatePerHour * h;
  const diff = ctx.warmthTarget - n.warmth;
  n.warmth = clamp(Math.abs(diff) <= step ? ctx.warmthTarget : n.warmth + Math.sign(diff) * step, 0, 100);

  updateEnergy(n, ctx.activity, ctx.realDt, ctx.sitting);

  const { hurt, cause } = drainHealth(n, { hunger: n.hunger <= 0 ? h : 0, thirst: n.thirst <= 0 ? h : 0, cold: n.warmth <= 0 ? h : 0 }, 1, ctx.coldLethal !== false);
  if (cause) return cause;
  if (!hurt && n.hunger > N.regenMinHunger && n.thirst > N.regenMinThirst && n.warmth > N.regenMinWarmth) {
    n.health = clamp(n.health + N.healthRegenPerHour * h, 0, 100);
  }
  return null;
}

/** Game hours each meter spent at 0. */
export interface EmptyHours {
  hunger: number;
  thirst: number;
  cold: number;
}

/**
 * The one way needs hurt: each empty meter costs health at its per-hour rate (times `share`) for as long as it sat at
 * 0, and the costs add up. An empty meter never kills by itself; only health reaching 0 does, and it is then blamed
 * on the meter that took the most. While cold isn't lethal (the grace nights) it stops a point short of the last of
 * your health, so only hunger or thirst can finish you then. `hurt` says whether any health was lost.
 */
function drainHealth(n: NeedsState, empty: EmptyHours, share: number, coldLethal: boolean): { hurt: boolean; cause: DamageSource | null; from: DamageSource[] } {
  let damage = 0;
  let worst: DamageSource | null = null;
  let worstAmount = 0;
  const from: [DamageSource, number][] = [];
  const hurt = (amount: number, src: DamageSource) => {
    damage += amount;
    from.push([src, amount]);
    if (amount > worstAmount) {
      worstAmount = amount;
      worst = src;
    }
  };
  if (empty.hunger > 0) hurt(N.starvingDamagePerHour * share * empty.hunger, 'starvation');
  if (empty.thirst > 0) hurt(N.dehydrationDamagePerHour * share * empty.thirst, 'dehydration');
  if (empty.cold > 0) {
    let cold = N.freezingDamagePerHour * share * empty.cold;
    if (!coldLethal) cold = Math.min(cold, Math.max(0, n.health - damage - 1));
    if (cold > 0) hurt(cold, 'cold');
  }
  if (damage <= 0) return { hurt: false, cause: null, from: [] };
  n.health = clamp(n.health - damage, 0, 100);
  return { hurt: true, cause: n.health <= 0 ? worst : null, from: from.sort((a, b) => b[1] - a[1]).map(([src]) => src) };
}

export function updateEnergy(n: NeedsState, activity: Activity, dt: number, sitting = false): void {
  if (activity === 'sprint') n.energy -= E.sprintDrainPerSec * dt;
  else if (activity === 'swim') n.energy -= E.swimDrainPerSec * dt;
  else if (activity === 'walk') n.energy -= E.walkDrainPerSec * dt;
  else {
    let rate = E.idleRegenPerSec;
    if (n.regenBoost > 0) rate *= E.boostMultiplier;
    if (sitting) rate *= E.sittingMultiplier;
    n.energy += rate * dt;
  }
  n.regenBoost = Math.max(0, n.regenBoost - dt);
  n.energy = clamp(n.energy, 0, 100);
  if (n.energy <= 0) n.exhausted = true;
  else if (n.exhausted && n.energy >= E.exhaustedRecoverAt) n.exhausted = false;
}

export function spendEnergy(n: NeedsState, amount: number): void {
  n.energy = clamp(n.energy - amount, 0, 100);
  if (n.energy <= 0) n.exhausted = true;
}

export function applyFood(n: NeedsState, f: FoodEffect): void {
  if (f.hunger) n.hunger = clamp(n.hunger + f.hunger, 0, 100);
  if (f.thirst) n.thirst = clamp(n.thirst + f.thirst, 0, 100);
  if (f.warmth) n.warmth = clamp(n.warmth + f.warmth, 0, 100);
  if (f.health) n.health = clamp(n.health + f.health, 1, 100);
  if (f.energy) n.energy = clamp(n.energy + f.energy, 0, 100);
  n.regenBoost = E.boostSeconds;
}

/** What a night's sleep did to health. */
export interface SleepResult {
  /** Health lost to meters that sat empty through the night. */
  lost: number;
  /** Set if that took health to 0. */
  cause: DamageSource | null;
  /** The empty meters that cost health, worst first. */
  from: DamageSource[];
}

/**
 * Sleeping through `hours` of night: full energy, some hunger/thirst cost (the cost itself never empties a meter) and
 * shelter-dependent healing if you went to bed fed. By a burning campfire you wake at least as warm as you lay down
 * (the shelter can warm you further); away from one the night costs `coldWarmthCost` warmth, spread evenly over it.
 * A meter that is empty (hunger or thirst at 0 at bedtime, warmth once the night's cost has run it out) drains health
 * all the while at `emptyDrainShare` of the awake rates, and the drains add up, like awake. Then there is no healing.
 * If that takes health to 0 you die in your sleep; cold can't do that during the grace nights (`coldLethal` false).
 */
export function applySleep(n: NeedsState, shelter: { warmthBonus: number; healthBonus: number }, byFire = false, hours = 0, coldLethal = true): SleepResult {
  const s = N.sleep;
  const wasFed = n.hunger > 25 && n.thirst > 25;
  const empty: EmptyHours = {
    hunger: n.hunger <= 0 ? hours : 0,
    thirst: n.thirst <= 0 ? hours : 0,
    cold: byFire ? 0 : hours * clamp(1 - n.warmth / s.coldWarmthCost, 0, 1),
  };
  n.hunger = Math.max(Math.min(n.hunger, s.floor), n.hunger - s.hungerCost);
  n.thirst = Math.max(Math.min(n.thirst, s.floor), n.thirst - s.thirstCost);
  n.energy = 100;
  n.exhausted = false;
  n.warmth = byFire ? Math.max(n.warmth, clamp(45 + shelter.warmthBonus, 0, 100)) : clamp(n.warmth - s.coldWarmthCost, 0, 100);
  const before = n.health;
  const { hurt, cause, from } = drainHealth(n, empty, s.emptyDrainShare, coldLethal);
  if (!hurt && wasFed) n.health = clamp(n.health + s.healthGain + shelter.healthBonus, 0, 100);
  return { lost: Math.max(0, before - n.health), cause, from };
}

/**
 * Multiplayer, lying in bed waiting for the others: time passes but the meters hold where they were, and any that
 * are already empty drain health at the sleeping rate (warmth only away from a fire). Returns the cause if that took
 * health to 0.
 */
export function restWhileWaiting(n: NeedsState, gameHours: number, byFire: boolean, coldLethal = true): DamageSource | null {
  const empty = { hunger: n.hunger <= 0 ? gameHours : 0, thirst: n.thirst <= 0 ? gameHours : 0, cold: !byFire && n.warmth <= 0 ? gameHours : 0 };
  return drainHealth(n, empty, N.sleep.emptyDrainShare, coldLethal).cause;
}

export function applyDamage(n: NeedsState, amount: number): boolean {
  n.health = clamp(n.health - amount, 0, 100);
  return n.health <= 0;
}
