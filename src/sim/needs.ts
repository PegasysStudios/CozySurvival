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

  let damage = 0;
  let worst: DamageSource | null = null;
  let worstAmount = 0;
  const hurt = (amount: number, src: DamageSource) => {
    damage += amount;
    if (amount > worstAmount) {
      worstAmount = amount;
      worst = src;
    }
  };
  if (n.hunger <= 0) hurt(N.starvingDamagePerHour * h, 'starvation');
  if (n.thirst <= 0) hurt(N.dehydrationDamagePerHour * h, 'dehydration');
  if (n.warmth <= 0) hurt(N.freezingDamagePerHour * h, 'cold');

  if (damage > 0) {
    n.health = clamp(n.health - damage, 0, 100);
    if (n.health <= 0) return worst;
  } else if (n.hunger > N.regenMinHunger && n.thirst > N.regenMinThirst && n.warmth > N.regenMinWarmth) {
    n.health = clamp(n.health + N.healthRegenPerHour * h, 0, 100);
  }
  return null;
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

/** Sleeping through the night: full energy, some hunger/thirst cost (never lethal), shelter-dependent warmth and healing. */
export function applySleep(n: NeedsState, shelter: { warmthBonus: number; healthBonus: number }): void {
  const s = N.sleep;
  const wasFed = n.hunger > 25 && n.thirst > 25;
  n.hunger = Math.max(Math.min(n.hunger, s.floor), n.hunger - s.hungerCost);
  n.thirst = Math.max(Math.min(n.thirst, s.floor), n.thirst - s.thirstCost);
  n.energy = 100;
  n.exhausted = false;
  n.warmth = clamp(45 + shelter.warmthBonus, 0, 100);
  if (wasFed) n.health = clamp(n.health + s.healthGain + shelter.healthBonus, 0, 100);
}

export function applyDamage(n: NeedsState, amount: number): boolean {
  n.health = clamp(n.health - amount, 0, 100);
  return n.health <= 0;
}
