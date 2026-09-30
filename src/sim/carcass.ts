import { hasHide } from '../data/species';
import type { CarcassState } from './state';

export type CarcassStep = 'skin' | 'butcher';

/**
 * What the next knife cut does: an animal with a hide is skinned first (the cut takes the hide or tears it, and the
 * carcass is skinned either way); a skinned carcass, or one with no hide (birds, lizards, snakes), is butchered.
 */
export function carcassStep(c: CarcassState): CarcassStep {
  return !c.skinned && hasHide(c.species) ? 'skin' : 'butcher';
}

/** Hides still on the carcass (what a clean skinning cut would take). */
export function hidesOn(c: CarcassState): number {
  return c.remaining.reduce((n, r) => (r.item === 'hide' ? n + r.count : n), 0);
}

/**
 * A carcass from a save or the network in today's form. Before round 10 butchering took meat and hide in one go and
 * a full pack could leave just part of a carcass, so one whose hide is already gone counts as skinned.
 */
export function normalizeCarcass(c: CarcassState): CarcassState {
  const out: CarcassState = { ...c, remaining: c.remaining.map((r) => ({ ...r })) };
  if (!hasHide(c.species)) delete out.skinned;
  else if (c.skinned === true || hidesOn(c) <= 0) out.skinned = true;
  else delete out.skinned;
  return out;
}
