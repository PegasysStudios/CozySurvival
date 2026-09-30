import type { GearId, ItemId, ToolId } from './items';
import type { PrefabId } from './prefabs';

export type RecipeCategory = 'tools' | 'gear' | 'materials' | 'cooking' | 'structures';

export type RecipeOutput =
  | { kind: 'item'; item: ItemId; count: number }
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'gear'; gear: GearId }
  | { kind: 'place'; prefab: PrefabId };

export type UnlockCond =
  | { gathered: ItemId; atLeast: number }
  | { crafted: string; atLeast: number }
  | { event: string; atLeast: number };

/** A recipe is learned when every `all` condition holds and (if present) at least one `any` condition holds. */
export interface UnlockRule {
  all?: UnlockCond[];
  any?: UnlockCond[];
}

export interface Recipe {
  id: string;
  name: string;
  category: RecipeCategory;
  inputs: { item: ItemId; count: number }[];
  output: RecipeOutput;
  station?: 'fire';
  unlock: UnlockRule;
  /** Shown when the recipe is learned. */
  learnHint: string;
  description: string;
}

const g = (item: ItemId, atLeast = 1): UnlockCond => ({ gathered: item, atLeast });
const c = (recipe: string, atLeast = 1): UnlockCond => ({ crafted: recipe, atLeast });
const e = (event: string, atLeast = 1): UnlockCond => ({ event, atLeast });

/**
 * Gear, tool, structure and material costs are 5x their original counts, except where that would break
 * progression: every recipe must fit the base 6-slot pack (gear upgrades are optional), the first tool must come
 * out of the starter patch, and cordage (an ingredient in many other recipes whose cordage counts already went 5x)
 * only goes up a little so those don't compound to 25x. Arrows, cooking and campfire fuel keep their costs.
 * The A-frame, bark hut and hide tent aren't recipes: they're built by upgrading a shelter in place (data/upgrades.ts).
 */
export const RECIPES: Recipe[] = [
  // ---- materials
  {
    id: 'cordage', name: 'Cordage', category: 'materials',
    inputs: [{ item: 'fiber', count: 4 }],
    output: { kind: 'item', item: 'cordage', count: 1 },
    unlock: { all: [g('fiber', 3)] },
    learnHint: 'Fern fiber twists into strong cordage.',
    description: 'Lashing for tools, packs, and shelters.',
  },
  {
    id: 'arrows', name: 'Arrows ×4', category: 'materials',
    inputs: [{ item: 'stick', count: 2 }, { item: 'stone', count: 1 }, { item: 'fiber', count: 1 }],
    output: { kind: 'item', item: 'arrow', count: 4 },
    unlock: { all: [c('bow')] },
    learnHint: 'A bow needs arrows: sticks, stone points, fiber fletching.',
    description: 'Four stone-tipped arrows.',
  },
  // ---- tools
  {
    id: 'axe', name: 'Stone Axe', category: 'tools',
    inputs: [{ item: 'stick', count: 6 }, { item: 'stone', count: 6 }, { item: 'fiber', count: 6 }],
    output: { kind: 'tool', tool: 'axe' },
    unlock: { all: [g('stick', 2), g('stone', 2)] },
    learnHint: 'A stick, a sharp stone, some fiber... an axe!',
    description: 'Chop trees for logs. Also a decent weapon.',
  },
  {
    id: 'spear', name: 'Spear', category: 'tools',
    inputs: [{ item: 'stick', count: 15 }, { item: 'stone', count: 5 }, { item: 'cordage', count: 5 }],
    output: { kind: 'tool', tool: 'spear' },
    unlock: { all: [c('axe')], any: [g('fiber', 3), c('cordage')] },
    learnHint: 'Lash a stone point to a long shaft for a spear.',
    description: 'Long reach. Spear fish in the shallows or fend off wolves.',
  },
  {
    id: 'bow', name: 'Bow', category: 'tools',
    inputs: [{ item: 'stick', count: 15 }, { item: 'cordage', count: 10 }],
    output: { kind: 'tool', tool: 'bow' },
    unlock: { any: [c('spear'), e('deerSpooked')] },
    learnHint: 'Deer bolt long before you get close. A bow would reach them.',
    description: 'Hold left-click to draw, release to shoot.',
  },
  {
    id: 'torch', name: 'Torch', category: 'tools',
    inputs: [{ item: 'stick', count: 5 }, { item: 'fiber', count: 10 }, { item: 'bark', count: 5 }],
    output: { kind: 'tool', tool: 'torch' },
    unlock: { any: [c('campfire'), e('nightfall')] },
    learnHint: 'Birch bark burns bright. Wrap it on a stick for a torch.',
    description: 'Carry light and a little warmth. Predators keep their distance.',
  },
  {
    id: 'rod', name: 'Fishing Pole', category: 'tools',
    inputs: [{ item: 'stick', count: 10 }, { item: 'stone', count: 5 }, { item: 'cordage', count: 5 }],
    output: { kind: 'tool', tool: 'rod' },
    unlock: { all: [c('cordage')], any: [e('drankByHand'), g('lakeWater', 1), g('rawFish', 1)] },
    learnHint: 'A long stick, a stone sinker and a cordage line: a fishing pole.',
    description: 'Hold left-click to wind up a cast, release to throw. Click the moment a fish bites.',
  },
  // ---- gear
  {
    id: 'basket', name: 'Grass Basket', category: 'gear',
    inputs: [{ item: 'fiber', count: 30 }, { item: 'stick', count: 10 }],
    output: { kind: 'gear', gear: 'basket' },
    unlock: { any: [e('packFull'), g('fiber', 8)] },
    learnHint: 'Your hands are full. Weave a basket to carry more.',
    description: '+4 pack slots.',
  },
  {
    id: 'canteen', name: 'Bark Canteen', category: 'gear',
    inputs: [{ item: 'bark', count: 15 }, { item: 'cordage', count: 5 }],
    output: { kind: 'gear', gear: 'canteen' },
    unlock: { any: [g('bark', 1)] },
    learnHint: 'Folded birch bark holds water. A canteen!',
    description: 'Fill at the lake to carry 4 servings of water.',
  },
  {
    id: 'backpack', name: 'Hide Backpack', category: 'gear',
    inputs: [{ item: 'hide', count: 10 }, { item: 'cordage', count: 10 }, { item: 'stick', count: 10 }],
    output: { kind: 'gear', gear: 'backpack' },
    unlock: { all: [g('hide', 1)] },
    learnHint: 'Hide and cordage would make a sturdy backpack.',
    description: '+6 pack slots.',
  },
  // ---- cooking (needs a lit campfire)
  {
    id: 'boilWater', name: 'Boiled Water', category: 'cooking', station: 'fire',
    inputs: [{ item: 'lakeWater', count: 1 }],
    output: { kind: 'item', item: 'boiledWater', count: 1 },
    unlock: { all: [g('lakeWater', 1)] },
    learnHint: 'Boil lake water over the fire to make it clean.',
    description: 'Clean water, and the base of teas and stews.',
  },
  {
    id: 'cookedMeat', name: 'Roast Meat', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawMeat', count: 1 }],
    output: { kind: 'item', item: 'cookedMeat', count: 1 },
    unlock: { all: [g('rawMeat', 1)] },
    learnHint: 'Raw meat roasts nicely over a fire.',
    description: 'Simple and filling.',
  },
  {
    id: 'grilledTrout', name: 'Grilled Trout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }],
    output: { kind: 'item', item: 'grilledTrout', count: 1 },
    unlock: { all: [g('rawFish', 1)] },
    learnHint: 'Fresh trout, grilled over the coals.',
    description: 'Flaky and smoky.',
  },
  {
    id: 'skewer', name: 'Mushroom Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'mushroom', count: 2 }, { item: 'onion', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'skewer', count: 1 },
    unlock: { all: [g('mushroom', 1), g('onion', 1)] },
    learnHint: 'Chanterelles and onion on a stick. A proper meal!',
    description: 'A hearty fire-roasted skewer.',
  },
  {
    id: 'forageSkewer', name: "Forager's Skewer", category: 'cooking', station: 'fire',
    inputs: [{ item: 'berries', count: 2 }, { item: 'onion', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'forageSkewer', count: 1 },
    unlock: { all: [g('berries', 1)] },
    learnHint: 'Thread salmonberries and a wild onion on a stick and roast them over the fire.',
    description: 'A simple forage-only meal.',
  },
  {
    id: 'berryTea', name: 'Salmonberry Tea', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'berries', count: 2 }],
    output: { kind: 'item', item: 'berryTea', count: 1 },
    unlock: { all: [c('boilWater'), g('berries', 1)] },
    learnHint: 'Steep berries in boiled water for a warming tea.',
    description: 'Warms you right through.',
  },
  {
    id: 'stew', name: 'Forest Stew', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawMeat', count: 1 }, { item: 'mushroom', count: 1 }, { item: 'onion', count: 1 }],
    output: { kind: 'item', item: 'stew', count: 1 },
    unlock: { all: [c('boilWater'), g('rawMeat', 1)] },
    learnHint: 'Meat, mushrooms, onion, boiled water: Forest Stew.',
    description: 'The coziest meal in the woods.',
  },
  {
    id: 'cedarTrout', name: 'Bark-Baked Trout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'onion', count: 1 }, { item: 'bark', count: 1 }],
    output: { kind: 'item', item: 'cedarTrout', count: 1 },
    unlock: { all: [g('rawFish', 1), g('onion', 1)] },
    learnHint: 'Wrap trout and onion in birch bark and bake it in the embers.',
    description: 'Tender, aromatic trout.',
  },
  {
    id: 'troutChowder', name: 'Trout Chowder', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawFish', count: 1 }, { item: 'onion', count: 1 }, { item: 'mushroom', count: 1 }],
    output: { kind: 'item', item: 'troutChowder', count: 1 },
    unlock: { all: [c('boilWater'), g('rawFish', 1)] },
    learnHint: 'Trout, onion and chanterelles simmered in boiled water: a lakeside chowder.',
    description: 'Creamy, warming and very filling.',
  },
  {
    id: 'troutSkewer', name: 'Trout & Berry Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'berries', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'troutSkewer', count: 1 },
    unlock: { all: [g('rawFish', 1), g('berries', 1)] },
    learnHint: 'Thread trout and salmonberries on a stick and roast them over the fire.',
    description: 'Smoky fish with a sweet, tart glaze.',
  },
  {
    id: 'smokedTrout', name: 'Smoked Trout ×2', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'smokedTrout', count: 2 },
    unlock: { all: [c('grilledTrout')] },
    learnHint: 'Hang two trout in the smoke on a stick. It keeps you going on long days.',
    description: 'Two strips of smoked trout for the trail.',
  },
  // ---- structures (placed in the world)
  {
    id: 'campfire', name: 'Campfire', category: 'structures',
    inputs: [{ item: 'stone', count: 25 }, { item: 'stick', count: 20 }, { item: 'fiber', count: 5 }],
    output: { kind: 'place', prefab: 'campfire' },
    unlock: { any: [c('axe'), g('stone', 6)] },
    learnHint: 'Ring some stones, stack sticks, add tinder: a campfire.',
    description: 'Warmth, light, cooking. Predators avoid it.',
  },
  {
    id: 'leanTo', name: 'Lean-to Shelter', category: 'structures',
    inputs: [{ item: 'log', count: 12 }, { item: 'stick', count: 12 }, { item: 'fiber', count: 16 }, { item: 'cordage', count: 5 }],
    output: { kind: 'place', prefab: 'leanTo' },
    unlock: { any: [g('log', 1), e('nightfall')] },
    learnHint: 'Logs and fern boughs make a lean-to. Sleep through the night!',
    description: 'Sleep from dusk until dawn. Keeps you a little warmer.',
  },
  {
    id: 'bench', name: 'Log Bench', category: 'structures',
    inputs: [{ item: 'log', count: 10 }],
    output: { kind: 'place', prefab: 'bench' },
    unlock: { all: [g('log', 2)] },
    learnHint: 'Split a log into a bench. Resting there restores energy faster.',
    description: 'Sit and rest to recover energy quickly.',
  },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  tools: 'Tools',
  gear: 'Gear',
  materials: 'Materials',
  cooking: 'Cooking',
  structures: 'Build',
};
