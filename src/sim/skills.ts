import { lerp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { GameState, SkillId } from './state';

const K = BALANCE.skills;

export const SKILL_IDS: SkillId[] = ['gathering', 'hunting', 'cooking', 'crafting', 'fishing'];
export const MAX_SKILL_LEVEL = K.thresholds.length + 1;

export const SKILL_INFO: Record<SkillId, { name: string; how: string }> = {
  gathering: { name: 'Gathering', how: 'Forage plants, sticks and stones, peel bark and cut up logs.' },
  hunting: { name: 'Hunting', how: 'Hit and bring down animals, then butcher them.' },
  cooking: { name: 'Cooking', how: 'Cook at a campfire.' },
  crafting: { name: 'Crafting', how: 'Craft tools, gear and materials, and build structures.' },
  fishing: { name: 'Fishing', how: 'Cast a fishing pole into lakes and ponds and strike when a fish bites.' },
};

export function createSkills(): Record<SkillId, number> {
  return { gathering: 0, hunting: 0, cooking: 0, crafting: 0, fishing: 0 };
}

export function skillLevel(xp: number): number {
  let level = 1;
  for (const t of K.thresholds) if (xp >= t) level++;
  return level;
}

/** Progress toward the next level in [0, 1] (1 at max level). */
export function skillProgress(xp: number): number {
  const level = skillLevel(xp);
  if (level >= MAX_SKILL_LEVEL) return 1;
  const lo = level === 1 ? 0 : K.thresholds[level - 2];
  const hi = K.thresholds[level - 1];
  return (xp - lo) / (hi - lo);
}

/** 0 at level 1, 1 at max level. */
export function skillFactor(xp: number): number {
  return (skillLevel(xp) - 1) / (MAX_SKILL_LEVEL - 1);
}

const curve = (range: readonly number[], xp: number) => lerp(range[0], range[1], skillFactor(xp));

export const gatherBonusChance = (xp: number) => curve(K.gatherBonusChance, xp);
export const huntDamageMultiplier = (xp: number) => 1 + curve(K.huntDamageBonus, xp);
export const butcherBonusChance = (xp: number) => curve(K.butcherBonusChance, xp);
export const burnChance = (xp: number) => curve(K.burnChance, xp);
export const durabilityMultiplier = (xp: number) => curve(K.durabilityMultiplier, xp);
export const catchChance = (xp: number) => curve(K.catchChance, xp);

/** One-line description of what the current level does, for the UI. */
export function skillEffect(id: SkillId, xp: number): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (id) {
    case 'gathering':
      return `${pct(gatherBonusChance(xp))} chance of a bonus find`;
    case 'hunting':
      return `+${pct(huntDamageMultiplier(xp) - 1)} damage to animals · ${pct(butcherBonusChance(xp))} chance of extra meat`;
    case 'cooking':
      return `${pct(burnChance(xp))} chance to char a meal`;
    case 'crafting':
      return `Crafted tools and shelters last ×${durabilityMultiplier(xp).toFixed(1)}`;
    case 'fishing':
      return `${pct(catchChance(xp))} chance to land a hooked fish`;
  }
}

/** Adds XP and returns the new level if it went up, otherwise null. */
export function addSkillXp(state: GameState, id: SkillId, amount: number): number | null {
  const before = skillLevel(state.skills[id]);
  state.skills[id] += amount;
  const after = skillLevel(state.skills[id]);
  return after > before ? after : null;
}
