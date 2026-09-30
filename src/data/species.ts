import type { ItemId } from './items';

export type SpeciesId =
  | 'rabbit' | 'deer' | 'fish' | 'wolf' | 'bear'
  | 'jackrabbit' | 'javelina' | 'quail' | 'roadrunner' | 'lizard' | 'snake' | 'cougar';

interface BaseSpecies {
  id: SpeciesId;
  name: string;
  habitat: 'land' | 'water';
  maxHealth: number;
  /** Body radius for movement collision. */
  radius: number;
  /** Hit sphere (center height above ground/water, radius). */
  hitHeight: number;
  hitRadius: number;
  walkSpeed: number;
  runSpeed: number;
  turnRate: number;
  wanderRadius: number;
  drops: { item: ItemId; count: number }[];
}

export interface PreySpecies extends BaseSpecies {
  kind: 'prey';
  /** Starts watching you (stops, ears up) within this radius. */
  alertRadius: number;
  /** Bolts once you are closer than this. */
  fearRadius: number;
  /** Stops fleeing once farther than this. */
  calmRadius: number;
  /** Seconds spent watching before deciding to bolt if you keep approaching. */
  alertTime: [number, number];
  /**
   * Holds its ground instead of bolting (a rattlesnake): it rattles when you come within `alertRadius` and bites
   * anyone closer than `radius`, at most every `cooldown` seconds. It only slithers off once hurt.
   */
  strike?: { radius: number; damage: number; cooldown: number };
}

export interface PredatorSpecies extends BaseSpecies {
  kind: 'predator';
  detectRadius: number;
  nightDetectMul: number;
  /** Bears warn (rear up, roar) before charging. */
  warnRadius: number;
  warnTime: number;
  chargeRadius: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  /** Gives up and returns home past this distance from home. */
  leash: number;
  retreatHealthFrac: number;
  aggroCooldown: number;
}

export type SpeciesDef = PreySpecies | PredatorSpecies;

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  rabbit: {
    id: 'rabbit', name: 'Snowshoe Hare', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.25, hitHeight: 0.22, hitRadius: 0.32,
    walkSpeed: 1.1, runSpeed: 7.2, turnRate: 7, wanderRadius: 10,
    alertRadius: 11, fearRadius: 6, calmRadius: 16, alertTime: [0.8, 1.6],
    drops: [{ item: 'rawMeat', count: 1 }, { item: 'hide', count: 1 }],
  },
  deer: {
    id: 'deer', name: 'Black-tailed Deer', kind: 'prey', habitat: 'land',
    maxHealth: 3, radius: 0.55, hitHeight: 1.0, hitRadius: 0.75,
    walkSpeed: 1.3, runSpeed: 9.5, turnRate: 4, wanderRadius: 22,
    alertRadius: 34, fearRadius: 22, calmRadius: 48, alertTime: [1.2, 2.4],
    drops: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }],
  },
  fish: {
    id: 'fish', name: 'Cutthroat Trout', kind: 'prey', habitat: 'water',
    maxHealth: 1, radius: 0.2, hitHeight: -0.3, hitRadius: 0.38,
    walkSpeed: 0.7, runSpeed: 4.2, turnRate: 5, wanderRadius: 8,
    alertRadius: 6, fearRadius: 3.2, calmRadius: 8, alertTime: [0.5, 1.2],
    drops: [{ item: 'rawFish', count: 1 }],
  },
  // ---- desert (see data/biomes.ts for populations)
  jackrabbit: {
    id: 'jackrabbit', name: 'Black-tailed Jackrabbit', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.27, hitHeight: 0.26, hitRadius: 0.34,
    walkSpeed: 1.2, runSpeed: 8.4, turnRate: 7, wanderRadius: 12,
    alertRadius: 12, fearRadius: 6.5, calmRadius: 18, alertTime: [0.7, 1.5],
    drops: [{ item: 'rawMeat', count: 1 }, { item: 'hide', count: 1 }],
  },
  javelina: {
    id: 'javelina', name: 'Javelina', kind: 'prey', habitat: 'land',
    maxHealth: 3, radius: 0.42, hitHeight: 0.42, hitRadius: 0.55,
    walkSpeed: 1.0, runSpeed: 7.2, turnRate: 5, wanderRadius: 18,
    // Poor eyesight: they notice you late, then scatter.
    alertRadius: 20, fearRadius: 12, calmRadius: 30, alertTime: [1.4, 2.8],
    drops: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }],
  },
  quail: {
    id: 'quail', name: "Gambel's Quail", kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.14, hitHeight: 0.14, hitRadius: 0.24,
    walkSpeed: 0.9, runSpeed: 5.6, turnRate: 8, wanderRadius: 8,
    alertRadius: 9, fearRadius: 4.5, calmRadius: 14, alertTime: [0.5, 1.1],
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  roadrunner: {
    id: 'roadrunner', name: 'Greater Roadrunner', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.18, hitHeight: 0.26, hitRadius: 0.28,
    walkSpeed: 1.5, runSpeed: 8.0, turnRate: 7, wanderRadius: 16,
    alertRadius: 12, fearRadius: 6.5, calmRadius: 18, alertTime: [0.5, 1.2],
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  lizard: {
    id: 'lizard', name: 'Collared Lizard', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.12, hitHeight: 0.07, hitRadius: 0.22,
    walkSpeed: 0.6, runSpeed: 5.0, turnRate: 9, wanderRadius: 6,
    alertRadius: 5.5, fearRadius: 3, calmRadius: 9, alertTime: [0.4, 1],
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  snake: {
    id: 'snake', name: 'Western Diamondback', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.2, hitHeight: 0.08, hitRadius: 0.3,
    walkSpeed: 0.45, runSpeed: 1.6, turnRate: 3, wanderRadius: 6,
    alertRadius: 6.5, fearRadius: 0, calmRadius: 6, alertTime: [2.5, 4],
    strike: { radius: 1.8, damage: 9, cooldown: 2.2 },
    drops: [{ item: 'rawMeat', count: 1 }, { item: 'hide', count: 1 }],
  },
  wolf: {
    id: 'wolf', name: 'Grey Wolf', kind: 'predator', habitat: 'land',
    maxHealth: 4, radius: 0.45, hitHeight: 0.6, hitRadius: 0.6,
    walkSpeed: 1.8, runSpeed: 6.4, turnRate: 6, wanderRadius: 40,
    detectRadius: 22, nightDetectMul: 1.4, warnRadius: 0, warnTime: 0,
    chargeRadius: 11, attackRange: 1.7, attackDamage: 12, attackCooldown: 1.4,
    leash: 90, retreatHealthFrac: 0.35, aggroCooldown: 25,
    drops: [{ item: 'rawMeat', count: 2 }, { item: 'hide', count: 2 }],
  },
  bear: {
    id: 'bear', name: 'Black Bear', kind: 'predator', habitat: 'land',
    maxHealth: 8, radius: 0.8, hitHeight: 0.8, hitRadius: 0.95,
    walkSpeed: 1.4, runSpeed: 7.0, turnRate: 3.5, wanderRadius: 24,
    detectRadius: 12, nightDetectMul: 1.1, warnRadius: 16, warnTime: 2.5,
    chargeRadius: 9, attackRange: 2.0, attackDamage: 26, attackCooldown: 2.0,
    leash: 36, retreatHealthFrac: 0.3, aggroCooldown: 30,
    drops: [{ item: 'rawMeat', count: 4 }, { item: 'hide', count: 3 }],
  },
  cougar: {
    id: 'cougar', name: 'Mountain Lion', kind: 'predator', habitat: 'land',
    maxHealth: 5, radius: 0.5, hitHeight: 0.6, hitRadius: 0.62,
    walkSpeed: 1.7, runSpeed: 7.4, turnRate: 6.5, wanderRadius: 45,
    // Stalks like the wolf; hunts mostly at dusk and in the dark.
    detectRadius: 19, nightDetectMul: 1.6, warnRadius: 0, warnTime: 0,
    chargeRadius: 10, attackRange: 1.8, attackDamage: 16, attackCooldown: 1.6,
    leash: 95, retreatHealthFrac: 0.4, aggroCooldown: 30,
    drops: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }],
  },
};

/**
 * Predators are rare early: a single distant wolf on day 1, bears from day 2,
 * a few more as the days pass.
 */
export function predatorTargets(day: number): { wolf: number; bear: number } {
  const wolf = Math.min(4, 1 + Math.floor((day - 1) / 2));
  const bear = day >= 5 ? 2 : day >= 2 ? 1 : 0;
  return { wolf, bear };
}

export const PREDATOR_MIN_SPAWN_DIST = 75;
export const PREY_MIN_SPAWN_DIST = 45;
