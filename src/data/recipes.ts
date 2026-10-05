import type { BiomeId } from './biomes';
import { getDisplayBiome, type GearId, type ItemId, type ToolId } from './items';
import type { PrefabId } from './prefabs';

export type RecipeCategory = 'tools' | 'gear' | 'materials' | 'cooking' | 'structures';

export type RecipeOutput =
  | { kind: 'item'; item: ItemId; count: number }
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'gear'; gear: GearId }
  | { kind: 'place'; prefab: PrefabId };

export interface Recipe {
  id: string;
  name: string;
  category: RecipeCategory;
  inputs: { item: ItemId; count: number }[];
  output: RecipeOutput;
  station?: 'fire';
  description: string;
  /** Only offered on this map (its ingredients only grow there); shared when absent. */
  biome?: BiomeId;
}

const PNW = 'pnw' as const;
const DESERT = 'desert' as const;
const ISLAND = 'island' as const;

/** A shared recipe's wording, with the island's version where trout and lakes don't fit. */
const onIsland = (island: string, other: string) => () => (getDisplayBiome() === 'island' ? island : other);

function worded(r: Omit<Recipe, 'name' | 'description'>, name: () => string, description: () => string): Recipe {
  return Object.defineProperties(r, {
    name: { get: name, enumerable: true },
    description: { get: description, enumerable: true },
  }) as Recipe;
}

/**
 * Gear, tool, structure and material costs are 5x their original counts, except where that would break
 * progression: every recipe must fit the base 6-slot pack (gear upgrades are optional), the first tool must come
 * out of the starter patch, and cordage (an ingredient in many other recipes whose cordage counts already went 5x)
 * only goes up a little so those don't compound to 25x. Arrows, cooking and campfire fuel keep their costs.
 * The A-frame, bark hut and hide tent aren't recipes: they're built by upgrading a shelter in place (data/upgrades.ts).
 * Every recipe is available from the start; the menus grey out the ones the pack lacks materials for.
 */
export const RECIPES: Recipe[] = [
  // ---- materials
  {
    id: 'cordage', name: 'Cordage', category: 'materials',
    inputs: [{ item: 'fiber', count: 4 }],
    output: { kind: 'item', item: 'cordage', count: 1 },
    description: 'Lashing for tools, packs, and shelters.',
  },
  {
    id: 'arrows', name: 'Arrows ×4', category: 'materials',
    inputs: [{ item: 'stick', count: 2 }, { item: 'stone', count: 1 }, { item: 'fiber', count: 1 }],
    output: { kind: 'item', item: 'arrow', count: 4 },
    description: 'Four stone-tipped arrows.',
  },
  // ---- tools
  {
    id: 'axe', name: 'Stone Axe', category: 'tools',
    inputs: [{ item: 'stick', count: 6 }, { item: 'stone', count: 6 }, { item: 'fiber', count: 6 }],
    output: { kind: 'tool', tool: 'axe' },
    description: 'Chop trees for logs. Also a decent weapon.',
  },
  {
    id: 'spear', name: 'Spear', category: 'tools',
    inputs: [{ item: 'stick', count: 15 }, { item: 'stone', count: 5 }, { item: 'cordage', count: 5 }],
    output: { kind: 'tool', tool: 'spear' },
    description: 'Long reach. Spear fish in the shallows or fend off wolves.',
  },
  {
    id: 'bow', name: 'Bow', category: 'tools',
    inputs: [{ item: 'stick', count: 15 }, { item: 'cordage', count: 10 }],
    output: { kind: 'tool', tool: 'bow' },
    description: 'Hold left-click to draw, release to shoot.',
  },
  {
    id: 'torch', name: 'Torch', category: 'tools',
    inputs: [{ item: 'stick', count: 5 }, { item: 'fiber', count: 10 }, { item: 'bark', count: 5 }],
    output: { kind: 'tool', tool: 'torch' },
    description: 'Carry light and a little warmth. Predators keep their distance.',
  },
  {
    id: 'rod', name: 'Fishing Pole', category: 'tools',
    inputs: [{ item: 'stick', count: 10 }, { item: 'stone', count: 5 }, { item: 'cordage', count: 5 }],
    output: { kind: 'tool', tool: 'rod' },
    description: 'Hold left-click to wind up a cast, release to throw. Click the moment a fish bites.',
  },
  {
    id: 'knife', name: 'Stone Knife', category: 'tools',
    inputs: [{ item: 'stone', count: 10 }, { item: 'stick', count: 5 }, { item: 'cordage', count: 3 }],
    output: { kind: 'tool', tool: 'knife' },
    description: 'Skin and butcher your kills. A weak weapon in a pinch.',
  },
  // ---- gear
  {
    id: 'basket', name: 'Grass Basket', category: 'gear',
    inputs: [{ item: 'fiber', count: 30 }, { item: 'stick', count: 10 }],
    output: { kind: 'gear', gear: 'basket' },
    description: '+4 pack slots.',
  },
  worded({
    id: 'canteen', category: 'gear',
    inputs: [{ item: 'bark', count: 15 }, { item: 'cordage', count: 5 }],
    output: { kind: 'gear', gear: 'canteen' },
  }, () => 'Bark Canteen', onIsland('Fill at a stream or pool to carry 4 servings of fresh water.', 'Fill at the lake to carry 4 servings of water.')),
  {
    id: 'backpack', name: 'Hide Backpack', category: 'gear',
    inputs: [{ item: 'hide', count: 10 }, { item: 'cordage', count: 10 }, { item: 'stick', count: 10 }],
    output: { kind: 'gear', gear: 'backpack' },
    description: '+6 pack slots.',
  },
  // ---- cooking (needs a lit campfire)
  {
    id: 'meltSnow', biome: PNW, name: 'Melt & Boil Snow', category: 'cooking', station: 'fire',
    inputs: [{ item: 'snowClump', count: 1 }],
    output: { kind: 'item', item: 'boiledWater', count: 1 },
    description: 'Melt and boil one snow clump into clean drinking water. Needs room in your canteen; also works in teas and stews.',
  },
  {
    id: 'boilWater', name: 'Boiled Water', category: 'cooking', station: 'fire',
    inputs: [{ item: 'lakeWater', count: 1 }],
    output: { kind: 'item', item: 'boiledWater', count: 1 },
    description: 'Clean water, and the base of teas and stews.',
  },
  {
    id: 'cookedMeat', name: 'Roast Meat', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawMeat', count: 1 }],
    output: { kind: 'item', item: 'cookedMeat', count: 1 },
    description: 'Simple and filling.',
  },
  worded({
    id: 'grilledTrout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }],
    output: { kind: 'item', item: 'grilledTrout', count: 1 },
  }, onIsland('Grilled Fish', 'Grilled Trout'), () => 'Flaky and smoky.'),
  {
    id: 'skewer', biome: PNW, name: 'Mushroom Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'mushroom', count: 2 }, { item: 'onion', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'skewer', count: 1 },
    description: 'A hearty fire-roasted skewer.',
  },
  {
    id: 'forageSkewer', biome: PNW, name: "Forager's Skewer", category: 'cooking', station: 'fire',
    inputs: [{ item: 'berries', count: 2 }, { item: 'onion', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'forageSkewer', count: 1 },
    description: 'A simple forage-only meal.',
  },
  {
    id: 'berryTea', biome: PNW, name: 'Salmonberry Tea', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'berries', count: 2 }],
    output: { kind: 'item', item: 'berryTea', count: 1 },
    description: 'Warms you right through.',
  },
  {
    id: 'stew', biome: PNW, name: 'Forest Stew', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawMeat', count: 1 }, { item: 'mushroom', count: 1 }, { item: 'onion', count: 1 }],
    output: { kind: 'item', item: 'stew', count: 1 },
    description: 'The coziest meal in the woods.',
  },
  {
    id: 'cedarTrout', biome: PNW, name: 'Bark-Baked Trout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'onion', count: 1 }, { item: 'bark', count: 1 }],
    output: { kind: 'item', item: 'cedarTrout', count: 1 },
    description: 'Tender, aromatic trout.',
  },
  {
    id: 'troutChowder', biome: PNW, name: 'Trout Chowder', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawFish', count: 1 }, { item: 'onion', count: 1 }, { item: 'mushroom', count: 1 }],
    output: { kind: 'item', item: 'troutChowder', count: 1 },
    description: 'Creamy, warming and very filling.',
  },
  {
    id: 'troutSkewer', biome: PNW, name: 'Trout & Berry Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'berries', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'troutSkewer', count: 1 },
    description: 'Smoky fish with a sweet, tart glaze.',
  },
  worded({
    id: 'smokedTrout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'smokedTrout', count: 2 },
  }, onIsland('Smoked Fish ×2', 'Smoked Trout ×2'), onIsland('Two strips of smoked fish for the trail.', 'Two strips of smoked trout for the trail.')),
  // ---- desert cooking, from Sonoran and Colorado Plateau foodways
  {
    id: 'desertSkewer', biome: DESERT, name: 'Desert Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'pricklyPear', count: 2 }, { item: 'chollaBuds', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'desertSkewer', count: 1 },
    description: 'A simple forage-only meal.',
  },
  {
    id: 'roastAgave', biome: DESERT, name: 'Roast Agave', category: 'cooking', station: 'fire',
    inputs: [{ item: 'agaveHeart', count: 1 }, { item: 'stick', count: 2 }],
    output: { kind: 'item', item: 'roastAgave', count: 1 },
    description: 'Bury the heart in the coals and let it turn sweet.',
  },
  {
    id: 'mesquiteCakes', biome: DESERT, name: 'Mesquite Cakes ×2', category: 'cooking', station: 'fire',
    inputs: [{ item: 'mesquitePods', count: 3 }, { item: 'boiledWater', count: 1 }],
    output: { kind: 'item', item: 'mesquiteCakes', count: 2 },
    description: 'Pound the pods to flour, mix with water, bake on a hot stone.',
  },
  {
    id: 'chiaFresca', biome: DESERT, name: 'Chia Fresca', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'chiaSeeds', count: 1 }, { item: 'pricklyPear', count: 1 }],
    output: { kind: 'item', item: 'chiaFresca', count: 1 },
    description: 'The most thirst-quenching drink in the desert.',
  },
  {
    id: 'wolfberryTea', biome: DESERT, name: 'Wolfberry Tea', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'wolfberries', count: 2 }],
    output: { kind: 'item', item: 'wolfberryTea', count: 1 },
    description: 'Warms you right through on a cold desert night.',
  },
  {
    id: 'roastPinon', biome: DESERT, name: 'Roasted Piñon Nuts', category: 'cooking', station: 'fire',
    inputs: [{ item: 'pinonNuts', count: 3 }],
    output: { kind: 'item', item: 'roastPinon', count: 1 },
    description: 'Toast the nuts in their shells.',
  },
  {
    id: 'desertStew', biome: DESERT, name: 'Desert Stew', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawMeat', count: 1 }, { item: 'chollaBuds', count: 1 }, { item: 'mesquitePods', count: 1 }],
    output: { kind: 'item', item: 'desertStew', count: 1 },
    description: 'The coziest meal under the stars.',
  },
  {
    id: 'pinonTrout', biome: DESERT, name: 'Piñon-Crusted Trout', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'pinonNuts', count: 2 }],
    output: { kind: 'item', item: 'pinonTrout', count: 1 },
    description: 'Crisp, nutty, and filling.',
  },
  {
    id: 'pearTroutSkewer', biome: DESERT, name: 'Trout & Prickly Pear Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'pricklyPear', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'pearTroutSkewer', count: 1 },
    description: 'Smoky fish with a sweet, bright glaze.',
  },
  // ---- island cooking, from Pacific and Caribbean island foodways
  {
    id: 'beachSkewer', biome: ISLAND, name: 'Beach Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'seaGrapes', count: 2 }, { item: 'purslane', count: 1 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'beachSkewer', count: 1 },
    description: 'A simple forage-only meal.',
  },
  {
    id: 'roastBreadfruit', biome: ISLAND, name: 'Roast Breadfruit', category: 'cooking', station: 'fire',
    inputs: [{ item: 'breadfruit', count: 1 }, { item: 'stick', count: 2 }],
    output: { kind: 'item', item: 'roastBreadfruit', count: 1 },
    description: 'Roast it whole in the coals until the skin blackens and the flesh turns soft.',
  },
  {
    id: 'poi', biome: ISLAND, name: 'Poi', category: 'cooking', station: 'fire',
    inputs: [{ item: 'taro', count: 2 }, { item: 'boiledWater', count: 1 }],
    output: { kind: 'item', item: 'poi', count: 1 },
    description: 'Cook the taro through, then pound it smooth with water.',
  },
  {
    id: 'coconutFish', biome: ISLAND, name: 'Coconut Fish', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'coconut', count: 1 }],
    output: { kind: 'item', item: 'coconutFish', count: 1 },
    description: 'Simmer the fish in the milk of a grated coconut.',
  },
  {
    id: 'fishLaulau', biome: ISLAND, name: 'Fish Laulau', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'taro', count: 1 }],
    output: { kind: 'item', item: 'fishLaulau', count: 1 },
    description: 'Wrap fish and taro in taro leaves and steam the bundle in the coals.',
  },
  {
    id: 'islandStew', biome: ISLAND, name: 'Island Stew', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'rawMeat', count: 1 }, { item: 'taro', count: 1 }, { item: 'breadfruit', count: 1 }],
    output: { kind: 'item', item: 'islandStew', count: 1 },
    description: 'The heartiest pot on the island.',
  },
  {
    id: 'coconutBananas', biome: ISLAND, name: 'Coconut Bananas', category: 'cooking', station: 'fire',
    inputs: [{ item: 'banana', count: 2 }, { item: 'coconut', count: 1 }],
    output: { kind: 'item', item: 'coconutBananas', count: 1 },
    description: 'Bake the bananas in their skins and top them with grated coconut.',
  },
  {
    id: 'seaGrapeTea', biome: ISLAND, name: 'Sea Grape Tea', category: 'cooking', station: 'fire',
    inputs: [{ item: 'boiledWater', count: 1 }, { item: 'seaGrapes', count: 2 }],
    output: { kind: 'item', item: 'seaGrapeTea', count: 1 },
    description: 'A tart, thirst-quenching brew.',
  },
  {
    id: 'fishSkewer', biome: ISLAND, name: 'Fish & Sea Grape Skewer', category: 'cooking', station: 'fire',
    inputs: [{ item: 'rawFish', count: 1 }, { item: 'seaGrapes', count: 2 }, { item: 'stick', count: 1 }],
    output: { kind: 'item', item: 'fishSkewer', count: 1 },
    description: 'Smoky fish with a tart, fruity glaze.',
  },
  // ---- structures (placed in the world)
  {
    id: 'campfire', name: 'Campfire', category: 'structures',
    inputs: [{ item: 'stone', count: 25 }, { item: 'stick', count: 20 }, { item: 'fiber', count: 5 }],
    output: { kind: 'place', prefab: 'campfire' },
    description: 'Warmth, light, cooking. Predators avoid it.',
  },
  {
    id: 'leanTo', name: 'Lean-to Shelter', category: 'structures',
    inputs: [{ item: 'log', count: 12 }, { item: 'stick', count: 12 }, { item: 'fiber', count: 16 }, { item: 'cordage', count: 5 }],
    output: { kind: 'place', prefab: 'leanTo' },
    description: 'Sleep from dusk until dawn. Keeps you a little warmer.',
  },
  {
    id: 'bench', name: 'Log Bench', category: 'structures',
    inputs: [{ item: 'log', count: 10 }],
    output: { kind: 'place', prefab: 'bench' },
    description: 'Sit and rest to recover energy quickly.',
  },
  {
    id: 'workbench', name: 'Repair Workbench', category: 'structures',
    inputs: [{ item: 'log', count: 8 }, { item: 'stick', count: 12 }, { item: 'stone', count: 10 }, { item: 'cordage', count: 4 }],
    output: { kind: 'place', prefab: 'workbench' },
    description: 'Mend worn tools and weapons for a fraction of what they cost to make.',
  },
  {
    id: 'storageBin', name: 'Woven Storage Bin', category: 'structures',
    inputs: [{ item: 'stick', count: 24 }, { item: 'fiber', count: 20 }, { item: 'cordage', count: 3 }],
    output: { kind: 'place', prefab: 'storageBin' },
    description: 'Ten slots of storage anyone in camp can use. Upgrade it into a bigger crate and chest.',
  },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

export function recipeOnMap(r: Recipe, biome: BiomeId): boolean {
  return !r.biome || r.biome === biome;
}

/** Recipes offered on a map, in menu order. */
export function recipesFor(biome: BiomeId): Recipe[] {
  return RECIPES.filter((r) => recipeOnMap(r, biome));
}

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  tools: 'Tools',
  gear: 'Gear',
  materials: 'Materials',
  cooking: 'Cooking',
  structures: 'Build',
};
