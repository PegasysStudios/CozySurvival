import { haveItem } from '../sim/canteen';
import { countItem } from '../sim/inventory';
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
  done(s: GameState): boolean;
  /** Everything the step still asks for, top to bottom. */
  needs(s: GameState): ObjectiveNeed[];
}

const got = (s: GameState, item: keyof GameState['stats']['gathered']) => s.stats.gathered[item] ?? 0;
const made = (s: GameState, id: string) => s.stats.crafted[id] ?? 0;
const ev = (s: GameState, id: string) => s.stats.events[id] ?? 0;
const desert = (s: GameState) => s.biome === 'desert';
const SKEWERS = ['forageSkewer', 'skewer', 'desertSkewer'];
const FISH_DISHES = ['grilledTrout', 'cedarTrout', 'troutChowder', 'troutSkewer', 'smokedTrout', 'pinonTrout', 'pearTroutSkewer'];
const FORAGE_ITEMS: ItemId[] = ['berries', 'onion', 'mushroom', 'pricklyPear', 'chollaBuds', 'wolfberries'];
const FORAGE_FOOD = 3;
const foraged = (s: GameState) => FORAGE_ITEMS.reduce((n, i) => n + got(s, i), 0);
const hareKills = (s: GameState) => ev(s, killKey('spear', 'rabbit')) + ev(s, killKey('spear', 'jackrabbit'));
const FIREWOOD = 2;

const goal = (label: string, icon: IconId, have: number, need = 1): ObjectiveNeed => ({ label, icon, have: Math.min(have, need), need });

/** Pack counts against the summed ingredients of the step's recipes that haven't been made yet. */
function ingredients(s: GameState, recipes: string[]): ObjectiveNeed[] {
  const total = new Map<ItemId, number>();
  for (const id of recipes) {
    if (made(s, id) >= 1) continue;
    for (const i of RECIPE_BY_ID[id].inputs) total.set(i.item, (total.get(i.item) ?? 0) + i.count);
  }
  return [...total].map(([item, n]) => goal(itemName(item, n), item, haveItem(s, item), n));
}

/** `kill:<tool>` counts every kill made with that tool, `kill:<tool>:<species>` kills of one species. */
export const killKey = (tool: string, species?: string) => (species ? `kill:${tool}:${species}` : `kill:${tool}`);

/** Onboarding: water -> camp -> food -> first meal -> firewood -> axe -> fishing -> spear -> bow. */
export const OBJECTIVES: Objective[] = [
  {
    id: 'drink', title: 'Find water and drink from the lake',
    hint: 'The lake is a short walk away. Walk to the shore and left-click the water to drink.',
    desert: {
      title: 'Find water and drink from the spring',
      hint: 'A spring pool lies a short walk away where the cottonwoods grow. Left-click the water to drink. Pools ringed with white crust are alkali: too salty to drink.',
    },
    done: (s) => ev(s, 'drankByHand') >= 1 || got(s, 'lakeWater') >= 1,
    needs: (s) => [goal(desert(s) ? 'Drink from the spring' : 'Drink from the lake', 'lakeWater', ev(s, 'drankByHand') + got(s, 'lakeWater'))],
  },
  {
    id: 'camp', title: 'Set up camp: build a campfire',
    hint: 'Gather stones, sticks and fern fiber, then Crafting (C) > Build > Campfire and left-click flat ground.',
    desert: { hint: 'Gather stones, sticks and yucca fiber, then Crafting (C) > Build > Campfire and left-click flat ground. Desert nights get cold fast, so build before sundown.' },
    done: (s) => made(s, 'campfire') >= 1,
    needs: (s) => [...ingredients(s, ['campfire']), goal('Campfire built', 'campfire', made(s, 'campfire'))],
  },
  {
    id: 'forage', title: 'Food keeps you alive: forage',
    hint: 'Pick salmonberries, wild onions or chanterelles. Each new plant gets a page in your Foraging guide (Tab).',
    desert: { hint: 'Pick prickly pear fruit, cholla buds or wolfberries. Each new plant gets a page in your Foraging guide (Tab).' },
    done: (s) => foraged(s) >= FORAGE_FOOD,
    needs: (s) => [
      desert(s) ? goal('Prickly pear, cholla buds or wolfberries', 'pricklyPear', foraged(s), FORAGE_FOOD) : goal('Berries, onions or chanterelles', 'berries', foraged(s), FORAGE_FOOD),
    ],
  },
  {
    id: 'skewer', title: 'Cook your first meal at the campfire',
    hint: "Click your lit campfire and roast a Forager's Skewer (salmonberries + wild onion + a stick) or a Mushroom Skewer.",
    desert: { hint: 'Click your lit campfire and roast a Desert Skewer (2 prickly pear fruit + cholla buds + a stick).' },
    done: (s) => SKEWERS.some((m) => made(s, m) >= 1),
    needs: (s) => {
      const skewer = desert(s) ? 'desertSkewer' : 'forageSkewer';
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
    done: (s) => made(s, 'axe') >= 1 && got(s, 'log') >= 1,
    needs: (s) => [...ingredients(s, ['axe']), goal('Stone Axe crafted', 'axe', made(s, 'axe')), goal('Log chopped', 'log', got(s, 'log'))],
  },
  {
    id: 'fish', title: 'Other food: catch and cook a fish',
    hint: 'Twist fiber into cordage and craft a Fishing Pole. Hold left-click to cast, click when the float dips, then cook the trout at the fire.',
    desert: { hint: 'Twist fiber into cordage and craft a Fishing Pole. Gila trout live only in the spring pool: cast there, click when the float dips, then cook it at the fire.' },
    done: (s) => made(s, 'rod') >= 1 && got(s, 'rawFish') >= 1 && FISH_DISHES.some((m) => made(s, m) >= 1),
    needs: (s) => [
      ...ingredients(s, ['rod']),
      goal('Fishing Pole crafted', 'rod', made(s, 'rod')),
      goal('Trout caught', 'rawFish', got(s, 'rawFish')),
      goal('Trout cooked', 'grilledTrout', FISH_DISHES.some((m) => made(s, m) >= 1) ? 1 : 0),
    ],
  },
  {
    id: 'spear', title: 'Craft a spear and hunt a hare',
    hint: 'Spear hunting is hard: hares bolt when you get close. Creep up slowly, stay still when they look up, then strike.',
    desert: {
      title: 'Craft a spear and hunt a jackrabbit',
      hint: 'Spear hunting is hard: jackrabbits bolt when you get close. Creep up slowly, stay still when they look up, then strike. Give rattlesnakes a wide berth.',
    },
    done: (s) => made(s, 'spear') >= 1 && hareKills(s) >= 1,
    needs: (s) => [...ingredients(s, ['spear']), goal('Spear crafted', 'spear', made(s, 'spear')), goal(desert(s) ? 'Jackrabbit hunted with the spear' : 'Hare hunted with the spear', 'hide', hareKills(s))],
  },
  {
    id: 'bow', title: 'Craft a bow and arrows, then hunt with the bow',
    hint: 'Hold left-click to draw and release to shoot. Deer spook from far away, so a bow is the way to reach them.',
    desert: { hint: 'Hold left-click to draw and release to shoot. Javelina and roadrunners bolt early, so a bow is the way to reach them.' },
    done: (s) => made(s, 'bow') >= 1 && made(s, 'arrows') >= 1 && ev(s, killKey('bow')) >= 1,
    needs: (s) => [
      ...ingredients(s, ['bow', 'arrows']),
      goal('Bow crafted', 'bow', made(s, 'bow')),
      goal('Arrows made', 'arrow', made(s, 'arrows')),
      goal('Kill with the bow', 'rawMeat', ev(s, killKey('bow'))),
    ],
  },
];

/** How many steps the pre-round-5 onboarding track had (old saves store their position in it). */
export const LEGACY_OBJECTIVE_COUNT = 10;

export const FREEPLAY_OBJECTIVE = {
  title: 'Survive as many days as you can',
  hint: 'Keep fed, watered and warm, and upgrade your shelter and tools. Wolves and bears roam after the first days; fire and torches keep them away.',
  desert: { hint: 'Keep fed, watered and warm, and upgrade your shelter and tools. A mountain lion hunts at dusk and a black bear roams the high country; fire and torches keep them away.' },
};

/** A step's title and hint as worded for the map. */
export function objectiveText(o: Pick<Objective, 'title' | 'hint' | 'desert'>, biome: BiomeId | undefined): { title: string; hint: string } {
  const d = biome === 'desert' ? o.desert : undefined;
  return { title: d?.title ?? o.title, hint: d?.hint ?? o.hint };
}

/** Advance past every completed objective. Returns indices completed this call. */
export function advanceObjectives(s: GameState): number[] {
  const done: number[] = [];
  while (s.objective < OBJECTIVES.length && OBJECTIVES[s.objective].done(s)) {
    done.push(s.objective);
    s.objective++;
  }
  return done;
}
