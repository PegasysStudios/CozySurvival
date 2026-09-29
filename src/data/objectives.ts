import type { GameState } from '../sim/state';

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
const MEALS = ['skewer', 'stew', 'berryTea', 'cedarTrout'];

/** Onboarding chain: gather -> tools -> fire -> water -> meals -> hunting -> chopping -> shelter -> sleep. */
export const OBJECTIVES: Objective[] = [
  {
    id: 'gather', title: 'Gather sticks and stones',
    hint: 'Left-click fallen branches and loose stones on the forest floor.',
    done: (s) => got(s, 'stick') >= 3 && got(s, 'stone') >= 3,
    progress: (s) => `Sticks ${Math.min(3, got(s, 'stick'))}/3 · Stones ${Math.min(3, got(s, 'stone'))}/3`,
  },
  {
    id: 'fiber', title: 'Strip fiber from sword ferns',
    hint: 'Sword ferns grow in the shade. Fiber binds tools together.',
    done: (s) => got(s, 'fiber') >= 3,
    progress: (s) => `Fiber ${Math.min(3, got(s, 'fiber'))}/3`,
  },
  {
    id: 'axe', title: 'Craft a Stone Axe',
    hint: 'Press C to open crafting. New recipes appear as you gather.',
    done: (s) => made(s, 'axe') >= 1,
  },
  {
    id: 'campfire', title: 'Build a campfire',
    hint: 'Crafting > Build > Campfire, then left-click flat ground. R rotates, right-click cancels.',
    done: (s) => made(s, 'campfire') >= 1,
  },
  {
    id: 'drink', title: 'Drink from the lake',
    hint: 'Walk to the shore and left-click the water.',
    done: (s) => ev(s, 'drankByHand') >= 1 || got(s, 'lakeWater') >= 1,
  },
  {
    id: 'canteen', title: 'Make a Bark Canteen',
    hint: 'Peel bark from white paper birches by hand, twist fiber into cordage, then craft a canteen.',
    done: (s) => made(s, 'canteen') >= 1,
    progress: (s) => `Birch bark ${Math.min(3, got(s, 'bark'))}/3`,
  },
  {
    id: 'boil', title: 'Fill your canteen and boil water',
    hint: 'Left-click the lake to fill up, then cook Boiled Water at a lit campfire.',
    done: (s) => made(s, 'boilWater') >= 1,
  },
  {
    id: 'meal', title: 'Cook a hearty meal',
    hint: 'Combine ingredients at the fire: Mushroom Skewer (chanterelles + onion + stick) or Salmonberry Tea.',
    done: (s) => MEALS.some((m) => made(s, m) >= 1),
  },
  {
    id: 'hunt', title: 'Hunt for food',
    hint: 'Craft a spear or bow. Hares let you get close if you stand still; deer bolt from far away.',
    done: (s) => Object.values(s.stats.kills).some((n) => (n ?? 0) > 0),
  },
  {
    id: 'chop', title: 'Chop down a tree',
    hint: 'Equip the Stone Axe (2) and hold left-click on a trunk.',
    done: (s) => got(s, 'log') >= 1,
  },
  {
    id: 'shelter', title: 'Build a lean-to shelter',
    hint: 'Logs, sticks, fiber and cordage. Find a flat spot clear of trees.',
    done: (s) => made(s, 'leanTo') >= 1 || made(s, 'hideTent') >= 1,
  },
  {
    id: 'sleep', title: 'Sleep through the night',
    hint: 'After 7 PM, left-click your shelter to sleep until dawn.',
    done: (s) => ev(s, 'slept') >= 1,
  },
];

export const FREEPLAY_OBJECTIVE = {
  title: 'Survive as many days as you can',
  hint: 'Keep fed, watered and warm. Wolves and bears roam after the first days; fire and torches keep them away.',
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
