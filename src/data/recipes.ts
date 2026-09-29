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

export const RECIPES: Recipe[] = [
  // ---- materials
  {
    id: 'cordage', name: 'Cordage', category: 'materials',
    inputs: [{ item: 'fiber', count: 3 }],
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
    inputs: [{ item: 'stick', count: 2 }, { item: 'stone', count: 2 }, { item: 'fiber', count: 2 }],
    output: { kind: 'tool', tool: 'axe' },
    unlock: { all: [g('stick', 2), g('stone', 2)] },
    learnHint: 'A stick, a sharp stone, some fiber... an axe!',
    description: 'Chop trees for logs. Also a decent weapon.',
  },
  {
    id: 'spear', name: 'Spear', category: 'tools',
    inputs: [{ item: 'stick', count: 3 }, { item: 'stone', count: 1 }, { item: 'cordage', count: 1 }],
    output: { kind: 'tool', tool: 'spear' },
    unlock: { all: [c('axe')], any: [g('fiber', 3), c('cordage')] },
    learnHint: 'Lash a stone point to a long shaft for a spear.',
    description: 'Long reach. Spear fish in the shallows or fend off wolves.',
  },
  {
    id: 'bow', name: 'Bow', category: 'tools',
    inputs: [{ item: 'stick', count: 3 }, { item: 'cordage', count: 2 }],
    output: { kind: 'tool', tool: 'bow' },
    unlock: { any: [c('spear'), e('deerSpooked')] },
    learnHint: 'Deer bolt long before you get close. A bow would reach them.',
    description: 'Hold left-click to draw, release to shoot.',
  },
  {
    id: 'torch', name: 'Torch', category: 'tools',
    inputs: [{ item: 'stick', count: 1 }, { item: 'fiber', count: 2 }, { item: 'bark', count: 1 }],
    output: { kind: 'tool', tool: 'torch' },
    unlock: { any: [c('campfire'), e('nightfall')] },
    learnHint: 'Birch bark burns bright. Wrap it on a stick for a torch.',
    description: 'Carry light and a little warmth. Predators keep their distance.',
  },
  // ---- gear
  {
    id: 'basket', name: 'Grass Basket', category: 'gear',
    inputs: [{ item: 'fiber', count: 6 }, { item: 'stick', count: 2 }],
    output: { kind: 'gear', gear: 'basket' },
    unlock: { any: [e('packFull'), g('fiber', 8)] },
    learnHint: 'Your hands are full. Weave a basket to carry more.',
    description: '+4 pack slots.',
  },
  {
    id: 'canteen', name: 'Bark Canteen', category: 'gear',
    inputs: [{ item: 'bark', count: 3 }, { item: 'cordage', count: 1 }],
    output: { kind: 'gear', gear: 'canteen' },
    unlock: { any: [g('bark', 1)] },
    learnHint: 'Folded birch bark holds water. A canteen!',
    description: 'Fill at the lake to carry 4 servings of water.',
  },
  {
    id: 'backpack', name: 'Hide Backpack', category: 'gear',
    inputs: [{ item: 'hide', count: 2 }, { item: 'cordage', count: 2 }, { item: 'stick', count: 2 }],
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
  // ---- structures (placed in the world)
  {
    id: 'campfire', name: 'Campfire', category: 'structures',
    inputs: [{ item: 'stone', count: 5 }, { item: 'stick', count: 4 }, { item: 'fiber', count: 1 }],
    output: { kind: 'place', prefab: 'campfire' },
    unlock: { any: [c('axe'), g('stone', 6)] },
    learnHint: 'Ring some stones, stack sticks, add tinder: a campfire.',
    description: 'Warmth, light, cooking. Predators avoid it.',
  },
  {
    id: 'leanTo', name: 'Lean-to Shelter', category: 'structures',
    inputs: [{ item: 'log', count: 3 }, { item: 'stick', count: 4 }, { item: 'fiber', count: 4 }, { item: 'cordage', count: 1 }],
    output: { kind: 'place', prefab: 'leanTo' },
    unlock: { any: [g('log', 1), e('nightfall')] },
    learnHint: 'Logs and fern boughs make a lean-to. Sleep through the night!',
    description: 'Sleep from dusk until dawn. Keeps you a little warmer.',
  },
  {
    id: 'bench', name: 'Log Bench', category: 'structures',
    inputs: [{ item: 'log', count: 2 }],
    output: { kind: 'place', prefab: 'bench' },
    unlock: { all: [g('log', 2)] },
    learnHint: 'Split a log into a bench. Resting there restores energy faster.',
    description: 'Sit and rest to recover energy quickly.',
  },
  {
    id: 'hideTent', name: 'Hide Tent', category: 'structures',
    inputs: [{ item: 'hide', count: 3 }, { item: 'log', count: 2 }, { item: 'cordage', count: 2 }],
    output: { kind: 'place', prefab: 'hideTent' },
    unlock: { all: [g('hide', 3)] },
    learnHint: 'Enough hides for a proper tent: warmer sleep, better rest.',
    description: 'A warm, snug shelter. Sleep heals more.',
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
