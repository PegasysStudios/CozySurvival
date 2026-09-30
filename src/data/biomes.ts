import { BALANCE } from './balance';
import { predatorTargets, SPECIES, type SpeciesId } from './species';

/** A playable map. Everything biome-specific hangs off `BIOMES[id]`; `pnw` reproduces the original game exactly. */
export type BiomeId = 'pnw' | 'desert';

export const BIOME_IDS: readonly BiomeId[] = ['pnw', 'desert'];
export const DEFAULT_BIOME: BiomeId = 'pnw';

export function isBiomeId(v: unknown): v is BiomeId {
  return typeof v === 'string' && (BIOME_IDS as readonly string[]).includes(v);
}

export interface BiomeWarmth {
  /** Ambient warmth target in full day and at night (0..100). */
  day: number;
  night: number;
  /** Clock hours over which the morning warms up and the evening cools down (smoothstep ranges). */
  warmUp: readonly [number, number];
  coolDown: readonly [number, number];
  /** Warmth points per game hour gained toward a warmer target. */
  rate: number;
  /** Warmth points per game hour lost toward a colder target (dry desert air sheds heat fast after sundown). */
  coolRate: number;
}

export interface WildlifeSpawn {
  species: SpeciesId;
  /** Prey: population kept topped up. */
  count: number;
  /** Minimum distance from the spawn point at world creation. */
  minDist: number;
}

export interface BiomeDef {
  id: BiomeId;
  /** Map name on the title screen and server list. */
  name: string;
  /** Title-screen line under the logo. */
  tagline: string;
  /** "Day 1 in this same forest". */
  place: string;
  warmth: BiomeWarmth;
  /** Prey in population order (the order also fixes world-creation RNG use). */
  prey: readonly WildlifeSpawn[];
  /** Predator species in spawn order with their first-spawn distance. */
  predators: readonly { species: SpeciesId; minDist: number }[];
  /** How many of each predator roam on a given day. */
  predatorTargets(day: number): Partial<Record<SpeciesId, number>>;
  /** Species that only live in the high country (desert uplands). */
  uplandOnly: readonly SpeciesId[];
  /** localStorage key suffix; empty for the original map so old saves stay where they are. */
  storageSuffix: string;
  /** Species shared between maps but called something else here. */
  speciesNames: Partial<Record<SpeciesId, string>>;
}

/**
 * Cougars hold territories of tens to hundreds of km², so a map this size gets one, rarely two. A black bear roams
 * the pinyon-juniper uplands from day 3.
 */
function desertPredators(day: number): Partial<Record<SpeciesId, number>> {
  const cougar = Math.min(2, 1 + Math.floor((day - 1) / 3));
  const bear = day >= 3 ? 1 : 0;
  return { cougar, bear };
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  pnw: {
    id: 'pnw',
    name: 'Pacific Northwest',
    tagline: 'Stranded in the Pacific Northwest woods. Keep warm, keep fed, and see how many days you can last.',
    place: 'forest',
    warmth: {
      day: BALANCE.needs.warmth.day, night: BALANCE.needs.warmth.night, warmUp: [5, 9], coolDown: [17, 21.5],
      rate: BALANCE.needs.warmthRatePerHour, coolRate: BALANCE.needs.warmthRatePerHour,
    },
    prey: [
      { species: 'rabbit', count: 18, minDist: 22 },
      { species: 'deer', count: 8, minDist: 45 },
      { species: 'fish', count: 14, minDist: 0 },
    ],
    predators: [
      { species: 'wolf', minDist: 100 },
      { species: 'bear', minDist: 110 },
    ],
    predatorTargets,
    uplandOnly: [],
    storageSuffix: '',
    speciesNames: {},
  },
  desert: {
    id: 'desert',
    name: 'Arizona Desert',
    tagline: 'Stranded in the Arizona desert. Water is scarce and the nights turn cold fast. Find a spring, keep a fire, and last.',
    place: 'desert',
    // Hot days; after about 4 PM the dry air sheds heat fast and the night drops to the same cold as the woods.
    warmth: { day: 95, night: 0, warmUp: [5.5, 9], coolDown: [16, 19.5], rate: BALANCE.needs.warmthRatePerHour, coolRate: 36 },
    prey: [
      { species: 'jackrabbit', count: 14, minDist: 22 },
      { species: 'quail', count: 12, minDist: 18 },
      { species: 'lizard', count: 10, minDist: 14 },
      { species: 'roadrunner', count: 6, minDist: 30 },
      { species: 'javelina', count: 7, minDist: 45 },
      { species: 'snake', count: 5, minDist: 30 },
      { species: 'fish', count: 5, minDist: 0 },
    ],
    predators: [
      { species: 'cougar', minDist: 100 },
      { species: 'bear', minDist: 110 },
    ],
    predatorTargets: desertPredators,
    uplandOnly: ['bear'],
    storageSuffix: '.desert',
    speciesNames: { fish: 'Gila Trout' },
  },
};

export function biomeDef(id: BiomeId | undefined): BiomeDef {
  return BIOMES[id ?? DEFAULT_BIOME];
}

export function speciesName(species: SpeciesId, biome: BiomeId | undefined): string {
  return biomeDef(biome).speciesNames[species] ?? SPECIES[species].name;
}
