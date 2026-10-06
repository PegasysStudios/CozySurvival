import { haveItem } from '../sim/canteen';
import { countItem } from '../sim/inventory';
import { skillLevel, skillRequirementText } from '../sim/skills';
import { dayOf } from '../sim/time';
import { BALANCE } from './balance';
import type { BiomeId } from './biomes';
import type { GameState } from '../sim/state';
import type { IconId } from './icons';
import { itemName, type ItemId } from './items';
import { RECIPE_BY_ID } from './recipes';

/** One row of the quest tracker: an ingredient or a goal, with have/need counts (`have` never exceeds `need`). */
export interface ObjectiveNeed {
  label: string;
  have: number;
  need: number;
  icon: IconId;
}

export interface Objective {
  id: string;
  title: string;
  hint: string;
  /** Same step on the desert map, worded for its water, plants and animals. */
  desert?: { title?: string; hint?: string };
  /** Same step on the island. */
  island?: { title?: string; hint?: string };
  /** Recipes this step opens up on day 1 (see `lockedToday`): what it asks you to make, and what it needs. */
  unlocks?: string[];
  /** Runs every time the step is checked while it's the current one (it must be safe to repeat). */
  start?(s: GameState): void;
  done(s: GameState): boolean;
  /** Everything the step still asks for, top to bottom. */
  needs(s: GameState): ObjectiveNeed[];
}

const got = (s: GameState, item: keyof GameState['stats']['gathered']) => s.stats.gathered[item] ?? 0;
const made = (s: GameState, id: string) => s.stats.crafted[id] ?? 0;
const ev = (s: GameState, id: string) => s.stats.events[id] ?? 0;
const desert = (s: GameState) => s.biome === 'desert';
const island = (s: GameState) => s.biome === 'island';
/** One wording per map: the Pacific Northwest's, the desert's and the island's. */
const pick = (s: GameState, pnw: string, dry: string, isle: string) => (island(s) ? isle : desert(s) ? dry : pnw);
const SKEWERS = ['forageSkewer', 'skewer', 'desertSkewer', 'beachSkewer'];
const FISH_DISHES = ['grilledTrout', 'cedarTrout', 'troutChowder', 'troutSkewer', 'smokedTrout', 'pinonTrout', 'pearTroutSkewer', 'coconutFish', 'fishLaulau', 'fishSkewer'];
const pnw = (s: GameState) => !s.biome || s.biome === 'pnw';
const caughtFish = (s: GameState) => got(s, 'rawFish') + (pnw(s) ? got(s, 'rawBass') + got(s, 'rawSalmon') : 0);
const cookedFish = (s: GameState) => FISH_DISHES.some((m) => made(s, m) >= 1)
  || (pnw(s) && (made(s, 'grilledBass') >= 1 || made(s, 'grilledSalmon') >= 1));
const FORAGE_ITEMS: ItemId[] = ['berries', 'onion', 'mushroom', 'pricklyPear', 'chollaBuds', 'wolfberries', 'seaGrapes', 'purslane', 'banana', 'coconut'];
const FORAGE_FOOD = 3;
const foraged = (s: GameState) => FORAGE_ITEMS.reduce((n, i) => n + got(s, i), 0);
const hareKills = (s: GameState) => ev(s, killKey('spear', 'rabbit')) + ev(s, killKey('spear', 'jackrabbit')) + ev(s, killKey('spear', 'junglefowl'));
const FIREWOOD = 2;
/** `stats.events` key: the day the "Survive the night" step began (it holds until the next morning). */
export const NIGHT_FROM = 'nightFrom';
const nightFrom = (s: GameState) => ev(s, NIGHT_FROM);
const survivedNight = (s: GameState) => nightFrom(s) > 0 && dayOf(s.totalHours) > nightFrom(s);

const goal = (label: string, icon: IconId, have: number, need = 1): ObjectiveNeed => ({ label, icon, have: Math.min(have, need), need });

/** Pack (and canteen) counts against the summed ingredients of `recipes`: one row per item, so shared materials count once. */
export function recipeNeeds(s: GameState, recipes: readonly string[]): ObjectiveNeed[] {
  const total = new Map<ItemId, number>();
  for (const id of recipes) for (const i of RECIPE_BY_ID[id].inputs) total.set(i.item, (total.get(i.item) ?? 0) + i.count);
  const rows = [...total].map(([item, n]) => goal(itemName(item, n), item, haveItem(s, item), n));
  for (const skill of ['crafting', 'cooking'] as const) {
    const level = Math.max(1, ...recipes.map((id) => RECIPE_BY_ID[id]).filter((r) => (r.category === 'cooking' ? 'cooking' : 'crafting') === skill).map((r) => r.requiredLevel));
    if (level > 1) rows.push(goal(skillRequirementText(skill, level), skill === 'cooking' ? 'cookedMeat' : 'cordage', skillLevel(s.skills[skill]), level));
  }
  return rows;
}

/** The step's recipes that haven't been made yet. */
const ingredients = (s: GameState, recipes: string[]) => recipeNeeds(s, recipes.filter((id) => made(s, id) < 1));

/** `kill:<tool>` counts every kill made with that tool, `kill:<tool>:<species>` kills of one species. */
export const killKey = (tool: string, species?: string) => (species ? `kill:${tool}:${species}` : `kill:${tool}`);

/**
 * Onboarding: water -> camp -> food -> first meal -> firewood -> axe -> survive the night -> fishing -> spear -> bow ->
 * knife. The night step holds everything after it until the next morning.
 */
export const OBJECTIVES: Objective[] = [
  {
    id: 'drink', title: 'Find water and drink from the lake',
    hint: 'The lake is a short walk away. Walk to the shore and left-click the water to drink.',
    desert: {
      title: 'Find water and drink from the spring',
      hint: 'A spring pool lies a short walk away where the cottonwoods grow. Left-click the water to drink. Pools ringed with white crust are alkali: too salty to drink.',
    },
    island: {
      title: 'Find fresh water and drink from a stream',
      hint: "The sea is salt and you can't drink it. A stream runs into the sea a short walk along the beach: follow it a little way inland and left-click the water to drink.",
    },
    done: (s) => ev(s, 'drankByHand') >= 1 || got(s, 'lakeWater') >= 1,
    needs: (s) => [goal(pick(s, 'Drink from the lake', 'Drink from the spring', 'Drink from a stream or pool'), 'lakeWater', ev(s, 'drankByHand') + got(s, 'lakeWater'))],
  },
  {
    id: 'camp', title: 'Set up camp: build a campfire',
    hint: 'Gather stones, sticks and fern fiber, then Crafting (C) > Build > Campfire and left-click flat ground.',
    desert: { hint: 'Gather stones, sticks and yucca fiber, then Crafting (C) > Build > Campfire and left-click flat ground. Desert nights get cold fast, so build before sundown.' },
    island: { hint: 'Gather stones, sticks (driftwood counts) and pandanus fiber, then Crafting (C) > Build > Campfire and left-click flat sand or ground.' },
    unlocks: ['campfire'],
    done: (s) => made(s, 'campfire') >= 1,
    needs: (s) => [...ingredients(s, ['campfire']), goal('Campfire built', 'campfire', made(s, 'campfire'))],
  },
  {
    id: 'forage', title: 'Food keeps you alive: forage',
    hint: 'Pick salmonberries, wild onions or chanterelles. Find each new plant in Crafting (C) → Foraging.',
    desert: { hint: 'Pick prickly pear fruit, cholla buds or wolfberries. Find each new plant in Crafting (C) → Foraging.' },
    island: { hint: 'Pick sea grapes and purslane on the beach, or find a coconut fallen under a palm. Find each new plant in Crafting (C) → Foraging.' },
    done: (s) => foraged(s) >= FORAGE_FOOD,
    needs: (s) => [
      island(s)
        ? goal('Sea grapes, purslane or coconuts', 'seaGrapes', foraged(s), FORAGE_FOOD)
        : desert(s) ? goal('Prickly pear, cholla buds or wolfberries', 'pricklyPear', foraged(s), FORAGE_FOOD) : goal('Berries, onions or chanterelles', 'berries', foraged(s), FORAGE_FOOD),
    ],
  },
  {
    id: 'skewer', title: 'Cook your first meal at the campfire',
    hint: "Click your lit campfire and roast a Forager's Skewer (salmonberries + wild onion + a stick) or a Mushroom Skewer.",
    desert: { hint: 'Click your lit campfire and roast a Desert Skewer (2 prickly pear fruit + cholla buds + a stick).' },
    island: { hint: 'Click your lit campfire and roast a Beach Skewer (2 sea grapes + purslane + a stick).' },
    unlocks: SKEWERS,
    done: (s) => SKEWERS.some((m) => made(s, m) >= 1),
    needs: (s) => {
      const skewer = pick(s, 'forageSkewer', 'desertSkewer', 'beachSkewer') as ItemId;
      return [...ingredients(s, [skewer]), goal('Skewer cooked', skewer, SKEWERS.some((m) => made(s, m) >= 1) ? 1 : 0)];
    },
  },
  {
    id: 'firewood', title: 'Keep the fire going',
    hint: 'Collect sticks (or logs), click the campfire and add them to the fire before it burns out.',
    done: (s) => ev(s, 'fuelAdded') >= FIREWOOD,
    needs: (s) => [
      goal('Sticks or logs in your pack', 'stick', countItem(s.inventory, 'stick') + countItem(s.inventory, 'log'), Math.max(1, FIREWOOD - ev(s, 'fuelAdded'))),
      goal('Added to the fire', 'campfire', ev(s, 'fuelAdded'), FIREWOOD),
    ],
  },
  {
    id: 'axe', title: 'Craft an axe, then chop a tree',
    hint: 'Craft a Stone Axe, equip it (2) and hold left-click on a trunk to fell it, then keep chopping the fallen trunk for logs.',
    desert: { hint: 'Craft a Stone Axe, equip it (2) and hold left-click on a trunk to fell it. Joshua trees and mesquite give one log; junipers and pines in the high country give more.' },
    island: { hint: 'Craft a Stone Axe, equip it (2) and hold left-click on a trunk to fell it, then keep chopping the fallen trunk for logs. Palms give two logs; the big kukui and breadfruit trees in the jungle give three.' },
    unlocks: ['axe'],
    done: (s) => made(s, 'axe') >= 1 && got(s, 'log') >= 1,
    needs: (s) => [...ingredients(s, ['axe']), goal('Stone Axe crafted', 'axe', made(s, 'axe')), goal('Log chopped', 'log', got(s, 'log'))],
  },
  {
    id: 'night', title: 'Survive the night',
    hint: 'Night is coming. Keep the fire fed, eat, drink and stay warm, then sleep in a lean-to or wait it out by the fire. More crafting opens tomorrow as your skills grow.',
    desert: { hint: 'Desert nights turn cold fast. Keep the fire fed, eat, drink and stay warm, then sleep in a lean-to or wait it out by the fire. More crafting opens tomorrow as your skills grow.' },
    island: { hint: 'The night is warm, but the heat makes you thirsty. Keep the fire fed, eat and drink, then sleep in a lean-to or by the fire. More crafting opens tomorrow as your skills grow.' },
    unlocks: ['cordage', 'leanTo', 'torch'],
    start: (s) => {
      if (nightFrom(s) <= 0) s.stats.events[NIGHT_FROM] = dayOf(s.totalHours);
    },
    done: survivedNight,
    needs: (s) => [goal(`See the morning of day ${Math.max(1, nightFrom(s)) + 1}`, 'leanTo', survivedNight(s) ? 1 : 0)],
  },
  {
    id: 'fish', title: 'Other food: catch and cook a fish',
    hint: 'Twist fiber into cordage and craft a Fishing Pole. The large lake has trout, bass and salmon; smaller fishable lakes have trout. Cast, click when the float dips, then grill your catch at the fire.',
    desert: { hint: 'Twist fiber into cordage and craft a Fishing Pole. Gila trout live only in the spring pool: cast there, click when the float dips, then cook it at the fire.' },
    island: { hint: 'Fish are the island\'s main meat. Twist fiber into cordage and craft a Fishing Pole, cast into the lagoon, the cove or a stream, click when the float dips, then cook your catch at the fire.' },
    unlocks: ['rod', 'grilledTrout', 'grilledBass', 'grilledSalmon'],
    done: (s) => made(s, 'rod') >= 1 && caughtFish(s) >= 1 && cookedFish(s),
    needs: (s) => [
      ...ingredients(s, ['rod']),
      goal('Fishing Pole crafted', 'rod', made(s, 'rod')),
      goal(desert(s) ? 'Trout caught' : 'Fish caught', 'rawFish', caughtFish(s)),
      goal(desert(s) ? 'Trout cooked' : 'Fish cooked', 'grilledTrout', cookedFish(s) ? 1 : 0),
    ],
  },
  {
    id: 'spear', title: 'Craft a spear and hunt a hare',
    hint: 'Spear hunting is hard: hares bolt when you get close. Creep up slowly, stay still when they look up, then strike.',
    desert: {
      title: 'Craft a spear and hunt a jackrabbit',
      hint: 'Spear hunting is hard: jackrabbits bolt when you get close. Creep up slowly, stay still when they look up, then strike. Give rattlesnakes a wide berth.',
    },
    island: {
      title: 'Craft a spear and hunt a junglefowl',
      hint: 'Spear hunting is hard: junglefowl scurry off when you get close. Creep up slowly at the jungle edge, stay still when they look up, then strike. Watch the leaf litter for the fer-de-lance.',
    },
    unlocks: ['spear'],
    done: (s) => made(s, 'spear') >= 1 && hareKills(s) >= 1,
    needs: (s) => [...ingredients(s, ['spear']), goal('Spear crafted', 'spear', made(s, 'spear')), goal(pick(s, 'Hare hunted with the spear', 'Jackrabbit hunted with the spear', 'Junglefowl hunted with the spear'), 'hide', hareKills(s))],
  },
  {
    id: 'bow', title: 'Craft a bow and arrows, then hunt with the bow',
    hint: 'Hold left-click to draw and release to shoot. Deer spook from far away; Hunting and Skinning Lv 5 are needed to harvest them. Practice on hares or squirrels first.',
    desert: { hint: 'Hold left-click to draw and release to shoot. Practice on jackrabbits and quail first. Javelina need Hunting and Skinning Lv 5 to harvest.' },
    island: { hint: 'Hold left-click to draw and release to shoot. Goats are your first hide source. Boars need Hunting and Skinning Lv 8 to harvest. Shoot at a palm\'s crown to knock down a coconut.' },
    unlocks: ['bow', 'arrows', 'cookedMeat'],
    done: (s) => made(s, 'bow') >= 1 && made(s, 'arrows') >= 1 && ev(s, killKey('bow')) >= 1,
    needs: (s) => [
      ...ingredients(s, ['bow', 'arrows']),
      goal('Bow crafted', 'bow', made(s, 'bow')),
      goal('Arrows made', 'arrow', made(s, 'arrows')),
      goal('Kill with the bow', 'rawMeat', ev(s, killKey('bow'))),
    ],
  },
  {
    id: 'knife', title: 'Craft a knife, then skin and butcher your kill',
    hint: 'A carcass needs a knife. Craft a Stone Knife, equip it (7) and click the kill: the first cut skins it for the hide, the second butchers it for the meat.',
    desert: { hint: 'A carcass needs a knife. Craft a Stone Knife, equip it (7) and click the kill: the first cut skins it for the hide, the second butchers it for the meat. Quail, roadrunners, lizards and snakes have no hide, so they go straight to butchering.' },
    island: { hint: 'A carcass needs a knife. Craft a Stone Knife, equip it (7) and click the kill: the first cut skins a goat or boar for its hide, the second butchers it for the meat. Junglefowl, crabs and snakes have no hide, so they go straight to butchering.' },
    unlocks: ['knife'],
    done: (s) => made(s, 'knife') >= 1 && ev(s, 'skinned') >= 1 && ev(s, 'butchered') >= 1,
    needs: (s) => [
      ...ingredients(s, ['knife']),
      goal('Stone Knife crafted', 'knife', made(s, 'knife')),
      goal('Kill skinned', 'hide', ev(s, 'skinned')),
      goal('Kill butchered', 'rawMeat', ev(s, 'butchered')),
    ],
  },
];

/** How many steps the pre-round-5 onboarding track had (old saves store their position in it). */
export const LEGACY_OBJECTIVE_COUNT = 10;

/** Round 10 added "Survive the night" at this index and the knife step at the end; saves from before shift past it. */
export const NIGHT_STEP = OBJECTIVES.findIndex((o) => o.id === 'night');

/**
 * Day 1 crafting limit: on the first day (the host's day in multiplayer) only recipes that the onboarding steps up to
 * and including the current one unlock can be made; everything else waits for tomorrow. From day 2 on, or once past
 * the night step (which only ends on a later morning, so that means an older save that was already further along),
 * nothing is locked.
 */
export function lockedToday(s: GameState, recipeId: string): boolean {
  if (!BALANCE.onboarding.dayOneLimit || dayOf(s.totalHours) > 1 || s.objective > NIGHT_STEP) return false;
  for (let i = 0; i <= s.objective; i++) if (OBJECTIVES[i].unlocks?.includes(recipeId)) return false;
  return true;
}

export const FREEPLAY_OBJECTIVE = {
  title: 'Survive as many days as you can',
  hint: 'Keep fed, watered and warm, and upgrade your shelter and tools. Wolves and bears roam after the first days; fire and torches keep them away.',
  desert: { hint: 'Keep fed, watered and warm, and upgrade your shelter and tools. A mountain lion hunts at dusk and a black bear roams the high country; fire and torches keep them away.' },
  island: { hint: 'Keep fed and watered (the heat makes you thirsty), and upgrade your shelter and tools. Wild boars guard the jungle, and tiger sharks hunt past the reef.' },
};

/** A step's title and hint as worded for the map. */
export function objectiveText(o: Pick<Objective, 'title' | 'hint' | 'desert' | 'island'>, biome: BiomeId | undefined): { title: string; hint: string } {
  const d = biome === 'desert' ? o.desert : biome === 'island' ? o.island : undefined;
  return { title: d?.title ?? o.title, hint: d?.hint ?? o.hint };
}

/** Advance past every completed objective. Returns indices completed this call. */
export function advanceObjectives(s: GameState): number[] {
  const done: number[] = [];
  while (s.objective < OBJECTIVES.length) {
    const o = OBJECTIVES[s.objective];
    o.start?.(s);
    if (!o.done(s)) break;
    done.push(s.objective);
    s.objective++;
  }
  return done;
}
