import { lerp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { GameState, SkillId } from './state';

const K = BALANCE.skills;

export const SKILL_IDS: SkillId[] = ['gathering', 'hunting', 'cooking', 'crafting', 'fishing', 'skinning'];
export const MAX_SKILL_LEVEL = K.thresholds.length + 1;

export const SKILL_INFO: Record<SkillId, { name: string; how: string }> = {
  gathering: { name: 'Gathering', how: 'Forage plants, sticks and stones, peel bark, fell trees and cut up logs.' },
  hunting: { name: 'Hunting', how: 'Hit and bring down animals, then butcher them.' },
  cooking: { name: 'Cooking', how: 'Cook at a campfire.' },
  crafting: { name: 'Crafting', how: 'Craft tools, gear and materials, and build structures.' },
  fishing: { name: 'Fishing', how: 'Cast a fishing pole into lakes and ponds and strike when a fish bites.' },
  skinning: { name: 'Skinning', how: 'Skin your kills with a knife. Every try teaches you something, torn hides included.' },
};

export function createSkills(): Record<SkillId, number> {
  return { gathering: 0, hunting: 0, cooking: 0, crafting: 0, fishing: 0, skinning: 0 };
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
  return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
}

export const xpForLevel = (level: number): number => level <= 1 ? 0 : K.thresholds[Math.min(MAX_SKILL_LEVEL, Math.floor(level)) - 2];
export const skillRequirementText = (id: SkillId, level: number): string => `${SKILL_INFO[id].name} Lv ${level}`;
export const meetsSkill = (s: GameState, id: SkillId, level: number): boolean => skillLevel(s.skills[id]) >= level;
/** Harder unlocked work teaches more, without rewarding locked actions or empty clicks. */
export const practiceXp = (base: number, requiredLevel: number): number => base * (1 + Math.floor(requiredLevel / 5));

/** Preserve levels and fractional progress from the previous level-10 curve, once on load. */
export function migrateSkillXp(xp: number): number {
  const old = [0, 10, 25, 45, 70, 100, 140, 190, 250, 320];
  let i = 0;
  while (i < old.length - 1 && xp >= old[i + 1]) i++;
  const lo = xpForLevel(i + 1);
  if (i === old.length - 1) return lo;
  return lo + (xp - old[i]) / (old[i + 1] - old[i]) * (xpForLevel(i + 2) - lo);
}

/** 0 at level 1, 1 at max level. */
export function skillFactor(xp: number): number {
  return (skillLevel(xp) - 1) / (MAX_SKILL_LEVEL - 1);
}

const curve = (range: readonly number[], xp: number) => lerp(range[0], range[1], skillFactor(xp));

export const gatherBonusChance = (xp: number) => curve(K.gatherBonusChance, xp);
export const gatherSuccessChance = (xp: number) => curve(K.gatherSuccessChance, xp);
/** Added to the axe's chop power (base 1), alongside the axe upgrade bonus. */
export const chopPowerBonus = (xp: number) => curve(K.chopPowerBonus, xp);
/** Added to weapon damage (base ×1), alongside the spear or bow upgrade bonus. */
export const huntDamageBonus = (xp: number) => curve(K.huntDamageBonus, xp);
export const huntDamageMultiplier = (xp: number) => 1 + huntDamageBonus(xp);
export const butcherBonusChance = (xp: number) => curve(K.butcherBonusChance, xp);
export const burnChance = (xp: number) => curve(K.burnChance, xp);
export const durabilityMultiplier = (xp: number) => curve(K.durabilityMultiplier, xp);
/** Added to the base catch chance, alongside the fishing pole upgrade bonus. */
export const catchBonus = (xp: number) => curve(K.catchBonus, xp);
/** Chance to land a hooked fish with an unupgraded pole. */
export const catchChance = (xp: number) => Math.min(K.maxCatchChance, K.baseCatchChance + catchBonus(xp));
/** Added to the base skinning chance, alongside the knife upgrade bonus. */
export const skinBonus = (xp: number) => curve(K.skinBonus, xp);
/** Chance to take a hide whole with an unupgraded knife. */
export const skinChance = (xp: number) => Math.min(K.maxSkinChance, K.baseSkinChance + skinBonus(xp));

/** One-line description of what the current level does, for the UI. */
export function skillEffect(id: SkillId, xp: number): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (id) {
    case 'gathering':
      return `${pct(gatherSuccessChance(xp))} gather success · ${pct(gatherBonusChance(xp))} chance of a bonus find · +${pct(chopPowerBonus(xp))} chop power`;
    case 'hunting':
      return `+${pct(huntDamageBonus(xp))} weapon damage · ${pct(butcherBonusChance(xp))} chance of extra meat`;
    case 'cooking':
      return `${pct(burnChance(xp))} chance to char a meal`;
    case 'crafting':
      return `Crafted tools and shelters last ×${durabilityMultiplier(xp).toFixed(1)}`;
    case 'fishing':
      return `+${pct(catchBonus(xp))} catch chance (${pct(catchChance(xp))} with a plain pole)`;
    case 'skinning':
      return `+${pct(skinBonus(xp))} skinning chance (${pct(skinChance(xp))} with a plain knife)`;
  }
}

/** Adds XP and returns the new level if it went up, otherwise null. */
export function addSkillXp(state: GameState, id: SkillId, amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const before = skillLevel(state.skills[id]);
  state.skills[id] = Math.min(xpForLevel(MAX_SKILL_LEVEL), Math.round((state.skills[id] + amount) * 1000) / 1000);
  const after = skillLevel(state.skills[id]);
  return after > before ? after : null;
}
