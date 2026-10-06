import type { ItemId } from './items';

/** Shared by host movement, guest prediction and the climbing animation. Metres per second. */
export const SQUIRREL_CLIMB = { up: 3.3, down: 2.7 } as const;

export type SpeciesId =
  | 'squirrel'
  | 'rabbit' | 'deer' | 'fish' | 'wolf' | 'bear'
  | 'jackrabbit' | 'javelina' | 'quail' | 'roadrunner' | 'lizard' | 'snake' | 'cougar' | 'scorpion'
  | 'boar' | 'goat' | 'junglefowl' | 'crab' | 'viper' | 'reefFish' | 'jellyfish' | 'shark';

/**
 * Which island water a water animal keeps to: `fresh` streams and pools, the `lagoon` inside the reef, its sunny
 * `shallows` near the beaches, or the `deep` water past the reef. Only the island checks it.
 */
export type WaterZone = 'fresh' | 'lagoon' | 'shallows' | 'deep';

interface BaseSpecies {
  id: SpeciesId;
  name: string;
  habitat: 'land' | 'water';
  waters?: WaterZone;
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
   * anyone closer than `radius`, at most every `cooldown` seconds. It only slithers off once hurt. A `venom` bite
   * keeps hurting afterwards: `perSecond` health for `seconds` (another bite adds to the time, up to `maxSeconds`).
   */
  strike?: { radius: number; damage: number; cooldown: number; venom?: { perSecond: number; seconds: number; maxSeconds: number } };
  /**
   * Drifts with the water and stings anyone swimming or wading within `radius` (a box jellyfish), at most every
   * `cooldown` seconds. It never flees and never follows you.
   */
  drift?: { radius: number; damage: number; cooldown: number };
  /** Defends the ground around its home instead of bolting (javelinas); see `Territory`. */
  territory?: Territory;
}

/**
 * A territorial animal watches anyone (player or animal) who comes within `radius` of its home and within `sight` of
 * it, clacks its teeth for `warnTime`, then charges at `chargeSpeed` and butts players for `damage` (driving animals
 * off) at most every `cooldown` seconds. It gives up once the intruder is `leash` times `radius` from home, or after
 * `maxCharge` seconds, and walks back. Nearby herd-mates within `rally` join a charge at a player. Hit down to
 * `fleeFrac` of its health it bolts; before that, hitting it only makes it charge you.
 */
export interface Territory {
  radius: number;
  sight: number;
  warnTime: number;
  chargeSpeed: number;
  range: number;
  damage: number;
  cooldown: number;
  leash: number;
  maxCharge: number;
  rally: number;
  fleeFrac: number;
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

/**
 * Lives under desert stones (a scorpion) and only comes out when one is gathered: it rears up for `revealTime`, then
 * scuttles after the nearest player and stings anyone within `sting.range`. It loses interest and burrows (taking
 * `burrowTime`, then gone) once nobody has been within `giveUpDist` for `giveUpTime` seconds, or after `maxChase`.
 */
export interface PestSpecies extends BaseSpecies {
  kind: 'pest';
  sting: { range: number; damage: number; cooldown: number };
  revealTime: number;
  giveUpDist: number;
  giveUpTime: number;
  maxChase: number;
  burrowTime: number;
}

export type SpeciesDef = PreySpecies | PredatorSpecies | PestSpecies;

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  squirrel: {
    id: 'squirrel', name: "Douglas's Squirrel", kind: 'prey', habitat: 'land',
    maxHealth: 0.6, radius: 0.12, hitHeight: 0.12, hitRadius: 0.18,
    walkSpeed: 1.5, runSpeed: 7.8, turnRate: 10, wanderRadius: 9,
    alertRadius: 10, fearRadius: 5, calmRadius: 17, alertTime: [0.4, 1.1],
    drops: [{ item: 'rawMeat', count: 1 }, { item: 'hide', count: 1 }],
  },
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
    id: 'fish', name: 'Cutthroat Trout', kind: 'prey', habitat: 'water', waters: 'fresh',
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
    // Every javelina speed, even fleeing hurt (x1.1), stays under the player's sprint so you can always get away.
    walkSpeed: 1.0, runSpeed: 5.8, turnRate: 5, wanderRadius: 10,
    // Poor eyesight: they notice you late.
    alertRadius: 20, fearRadius: 12, calmRadius: 30, alertTime: [1.4, 2.8],
    territory: {
      radius: 14, sight: 12, warnTime: 0.9, chargeSpeed: 6.0, range: 1.25, damage: 8, cooldown: 1.5,
      leash: 1.6, maxCharge: 14, rally: 16, fleeFrac: 0.4,
    },
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
    // No hide worth keeping: like the birds and lizards, it goes straight to butchering.
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  scorpion: {
    id: 'scorpion', name: 'Desert Hairy Scorpion', kind: 'pest', habitat: 'land',
    // One axe, spear or arrow hit; two punches.
    maxHealth: 1, radius: 0.12, hitHeight: 0.08, hitRadius: 0.32,
    // Slower than a walk, so walking away always works.
    walkSpeed: 1.2, runSpeed: 3.4, turnRate: 6, wanderRadius: 2,
    sting: { range: 1.1, damage: 6, cooldown: 1.6 },
    revealTime: 0.8, giveUpDist: 7, giveUpTime: 3, maxChase: 45, burrowTime: 1.5,
    drops: [],
  },
  // ---- island (see data/biomes.ts for populations)
  boar: {
    id: 'boar', name: 'Wild Boar', kind: 'prey', habitat: 'land',
    maxHealth: 4, radius: 0.5, hitHeight: 0.5, hitRadius: 0.62,
    // Like the javelina, every speed (fleeing hurt is x1.1) stays under the player's 6.8 m/s sprint.
    walkSpeed: 1.1, runSpeed: 6.0, turnRate: 4.5, wanderRadius: 14,
    alertRadius: 24, fearRadius: 13, calmRadius: 32, alertTime: [1.0, 2.2],
    // Feral pigs are bolder than javelinas: a wider patch, a longer look, a harder hit, and slower to give up.
    territory: {
      radius: 18, sight: 15, warnTime: 0.7, chargeSpeed: 6.3, range: 1.35, damage: 12, cooldown: 1.4,
      leash: 1.7, maxCharge: 16, rally: 14, fleeFrac: 0.3,
    },
    drops: [{ item: 'rawMeat', count: 3 }, { item: 'hide', count: 2 }],
  },
  goat: {
    id: 'goat', name: 'Feral Goat', kind: 'prey', habitat: 'land',
    maxHealth: 2, radius: 0.4, hitHeight: 0.62, hitRadius: 0.55,
    walkSpeed: 1.2, runSpeed: 8.2, turnRate: 5, wanderRadius: 18,
    alertRadius: 26, fearRadius: 15, calmRadius: 36, alertTime: [1.0, 2.0],
    drops: [{ item: 'rawMeat', count: 2 }, { item: 'hide', count: 1 }],
  },
  junglefowl: {
    id: 'junglefowl', name: 'Red Junglefowl', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.16, hitHeight: 0.2, hitRadius: 0.26,
    walkSpeed: 1.0, runSpeed: 6.4, turnRate: 8, wanderRadius: 10,
    alertRadius: 10, fearRadius: 5, calmRadius: 15, alertTime: [0.5, 1.2],
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  crab: {
    id: 'crab', name: 'Land Crab', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.16, hitHeight: 0.1, hitRadius: 0.26,
    walkSpeed: 0.5, runSpeed: 3.2, turnRate: 7, wanderRadius: 6,
    alertRadius: 6, fearRadius: 3, calmRadius: 9, alertTime: [0.4, 1.0],
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  viper: {
    id: 'viper', name: 'Fer-de-Lance', kind: 'prey', habitat: 'land',
    maxHealth: 1, radius: 0.2, hitHeight: 0.08, hitRadius: 0.3,
    walkSpeed: 0.45, runSpeed: 1.8, turnRate: 3, wanderRadius: 6,
    // Well camouflaged in the leaf litter: it doesn't rattle, so you notice it later than a rattlesnake.
    alertRadius: 5, fearRadius: 0, calmRadius: 6, alertTime: [2.5, 4],
    strike: { radius: 1.9, damage: 6, cooldown: 2.4, venom: { perSecond: 0.6, seconds: 20, maxSeconds: 45 } },
    drops: [{ item: 'rawMeat', count: 1 }],
  },
  reefFish: {
    id: 'reefFish', name: 'Parrotfish', kind: 'prey', habitat: 'water', waters: 'lagoon',
    maxHealth: 1, radius: 0.22, hitHeight: -0.3, hitRadius: 0.4,
    walkSpeed: 0.8, runSpeed: 4.6, turnRate: 5, wanderRadius: 10,
    alertRadius: 6, fearRadius: 3.4, calmRadius: 9, alertTime: [0.5, 1.2],
    drops: [{ item: 'rawFish', count: 1 }],
  },
  jellyfish: {
    id: 'jellyfish', name: 'Box Jellyfish', kind: 'prey', habitat: 'water', waters: 'shallows',
    maxHealth: 1, radius: 0.2, hitHeight: -0.25, hitRadius: 0.36,
    walkSpeed: 0.22, runSpeed: 0.3, turnRate: 1.5, wanderRadius: 7,
    alertRadius: 0, fearRadius: 0, calmRadius: 0, alertTime: [1, 2],
    drift: { radius: 1.1, damage: 7, cooldown: 1.8 },
    drops: [],
  },
  shark: {
    id: 'shark', name: 'Tiger Shark', kind: 'predator', habitat: 'water', waters: 'deep',
    maxHealth: 6, radius: 0.7, hitHeight: -0.2, hitRadius: 0.8,
    // Faster than you can swim (2.6 m/s): the reef is the way out.
    walkSpeed: 1.6, runSpeed: 5.4, turnRate: 2.6, wanderRadius: 60,
    detectRadius: 45, nightDetectMul: 1.2, warnRadius: 0, warnTime: 0,
    chargeRadius: 14, attackRange: 1.9, attackDamage: 24, attackCooldown: 2.6,
    leash: 400, retreatHealthFrac: 0.5, aggroCooldown: 20,
    drops: [],
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

/** Animals whose carcass has a hide to skin off before it can be butchered (the rest go straight to butchering). */
export function hasHide(species: SpeciesId): boolean {
  return SPECIES[species].drops.some((d) => d.item === 'hide');
}

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
