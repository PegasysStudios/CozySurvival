import type { GameState } from '../sim/state';
import { RECIPE_BY_ID } from './recipes';

export interface Objective {
  id: string;
  title: string;
  hint: string;
  done(s: GameState): boolean;
  progress?(s: GameState): string;
}

const got = (s: GameState, item: keyof GameState['stats']['gathered']) => s.stats.gathered[item] ?? 0;
const made = (s: GameState, id: string) => s.stats.crafted[id] ?? 0;
const ev = (s: GameState, id: string) => s.stats.events[id] ?? 0;
const tick = (ok: boolean) => (ok ? '✓' : '·');
const SKEWERS = ['forageSkewer', 'skewer'];
const FISH_DISHES = ['grilledTrout', 'cedarTrout', 'troutChowder', 'troutSkewer', 'smokedTrout'];
const FORAGE_FOOD = 3;
const FIREWOOD = 2;
const CAMPFIRE = RECIPE_BY_ID.campfire.inputs;

/** `kill:<tool>` counts every kill made with that tool, `kill:<tool>:<species>` kills of one species. */
export const killKey = (tool: string, species?: string) => (species ? `kill:${tool}:${species}` : `kill:${tool}`);

/** Onboarding: water -> camp -> food -> first meal -> firewood -> axe -> fishing -> spear -> bow. */
export const OBJECTIVES: Objective[] = [
  {
    id: 'drink', title: 'Find water and drink from the lake',
    hint: 'The lake is a short walk away. Walk to the shore and left-click the water to drink.',
    done: (s) => ev(s, 'drankByHand') >= 1 || got(s, 'lakeWater') >= 1,
  },
  {
    id: 'camp', title: 'Set up camp: build a campfire',
    hint: 'Gather stones, sticks and fern fiber, then Crafting (C) > Build > Campfire and left-click flat ground.',
    done: (s) => made(s, 'campfire') >= 1,
    progress: (s) => CAMPFIRE.map((i) => `${i.item === 'fiber' ? 'Fiber' : i.item === 'stone' ? 'Stones' : 'Sticks'} ${Math.min(i.count, got(s, i.item))}/${i.count}`).join(' · '),
  },
  {
    id: 'forage', title: 'Food keeps you alive: forage',
    hint: 'Pick salmonberries, wild onions or chanterelles. Each new plant gets a page in your Foraging guide (Tab).',
    done: (s) => got(s, 'berries') + got(s, 'onion') + got(s, 'mushroom') >= FORAGE_FOOD,
    progress: (s) => `Food foraged ${Math.min(FORAGE_FOOD, got(s, 'berries') + got(s, 'onion') + got(s, 'mushroom'))}/${FORAGE_FOOD}`,
  },
  {
    id: 'skewer', title: 'Cook your first meal at the campfire',
    hint: "Click your lit campfire and roast a Forager's Skewer (salmonberries + wild onion + a stick) or a Mushroom Skewer.",
    done: (s) => SKEWERS.some((m) => made(s, m) >= 1),
  },
  {
    id: 'firewood', title: 'Keep the fire going',
    hint: 'Collect sticks (or logs), click the campfire and add them to the fire before it burns out.',
    done: (s) => ev(s, 'fuelAdded') >= FIREWOOD,
    progress: (s) => `Firewood added ${Math.min(FIREWOOD, ev(s, 'fuelAdded'))}/${FIREWOOD}`,
  },
  {
    id: 'axe', title: 'Craft an axe, then chop a tree',
    hint: 'Craft a Stone Axe, equip it (2) and hold left-click on a trunk to fell it, then keep chopping the fallen trunk for logs.',
    done: (s) => made(s, 'axe') >= 1 && got(s, 'log') >= 1,
    progress: (s) => `${tick(made(s, 'axe') >= 1)} Stone Axe · ${tick(got(s, 'log') >= 1)} Log`,
  },
  {
    id: 'fish', title: 'Other food: catch and cook a fish',
    hint: 'Twist fiber into cordage and craft a Fishing Pole. Hold left-click to cast, click when the float dips, then cook the trout at the fire.',
    done: (s) => made(s, 'rod') >= 1 && got(s, 'rawFish') >= 1 && FISH_DISHES.some((m) => made(s, m) >= 1),
    progress: (s) => `${tick(made(s, 'rod') >= 1)} Fishing Pole · ${tick(got(s, 'rawFish') >= 1)} Fish · ${tick(FISH_DISHES.some((m) => made(s, m) >= 1))} Cooked`,
  },
  {
    id: 'spear', title: 'Craft a spear and hunt a hare',
    hint: 'Spear hunting is hard: hares bolt when you get close. Creep up slowly, stay still when they look up, then strike.',
    done: (s) => made(s, 'spear') >= 1 && ev(s, killKey('spear', 'rabbit')) >= 1,
    progress: (s) => `${tick(made(s, 'spear') >= 1)} Spear · ${tick(ev(s, killKey('spear', 'rabbit')) >= 1)} Hare`,
  },
  {
    id: 'bow', title: 'Craft a bow and arrows, then hunt with the bow',
    hint: 'Hold left-click to draw and release to shoot. Deer spook from far away, so a bow is the way to reach them.',
    done: (s) => made(s, 'bow') >= 1 && made(s, 'arrows') >= 1 && ev(s, killKey('bow')) >= 1,
    progress: (s) => `${tick(made(s, 'bow') >= 1)} Bow · ${tick(made(s, 'arrows') >= 1)} Arrows · ${tick(ev(s, killKey('bow')) >= 1)} Bow kill`,
  },
];

/** How many steps the pre-round-5 onboarding track had (old saves store their position in it). */
export const LEGACY_OBJECTIVE_COUNT = 10;

export const FREEPLAY_OBJECTIVE = {
  title: 'Survive as many days as you can',
  hint: 'Keep fed, watered and warm, and upgrade your shelter and tools. Wolves and bears roam after the first days; fire and torches keep them away.',
};

/** Advance past every completed objective. Returns indices completed this call. */
export function advanceObjectives(s: GameState): number[] {
  const done: number[] = [];
  while (s.objective < OBJECTIVES.length && OBJECTIVES[s.objective].done(s)) {
    done.push(s.objective);
    s.objective++;
  }
  return done;
}
