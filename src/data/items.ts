import type { BiomeId } from './biomes';

export type ItemId =
  | 'stick'
  | 'stone'
  | 'fiber'
  | 'berries'
  | 'mushroom'
  | 'onion'
  | 'bark'
  | 'log'
  | 'cordage'
  | 'rawMeat'
  | 'rawFish'
  | 'hide'
  | 'lakeWater'
  | 'boiledWater'
  | 'cookedMeat'
  | 'grilledTrout'
  | 'skewer'
  | 'forageSkewer'
  | 'berryTea'
  | 'stew'
  | 'cedarTrout'
  | 'troutChowder'
  | 'troutSkewer'
  | 'smokedTrout'
  | 'charredMeal'
  | 'arrow'
  // desert forage and meals
  | 'pricklyPear'
  | 'chollaBuds'
  | 'agaveHeart'
  | 'chiaSeeds'
  | 'wolfberries'
  | 'mesquitePods'
  | 'pinonNuts'
  | 'desertSkewer'
  | 'roastAgave'
  | 'mesquiteCakes'
  | 'chiaFresca'
  | 'wolfberryTea'
  | 'roastPinon'
  | 'desertStew'
  | 'pinonTrout'
  | 'pearTroutSkewer';

export interface FoodEffect {
  hunger?: number;
  thirst?: number;
  warmth?: number;
  health?: number;
  energy?: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  plural: string;
  stack: number;
  description: string;
  food?: FoodEffect;
  /** A drink: using it counts as drinking, and it never chars over the fire. */
  water?: boolean;
  /** Carried only in the canteen, one serving per unit, never in a pack slot. */
  canteen?: boolean;
  /** Used as campfire fuel, value in game hours. */
  fuelHours?: number;
  /** Cooked/crafted meals get a cozy highlight in the UI. */
  meal?: boolean;
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  stick: { id: 'stick', name: 'Stick', plural: 'Sticks', stack: 12, color: '#a0703e', description: 'Dry fir branch. Handles, kindling, and fuel.', fuelHours: 1.5 },
  stone: { id: 'stone', name: 'Stone', plural: 'Stones', stack: 10, color: '#9aa0a6', description: 'A fist-sized river stone.' },
  fiber: { id: 'fiber', name: 'Plant Fiber', plural: 'Plant Fiber', stack: 30, color: '#7fae5a', description: 'Stripped from sword ferns. Twist it into cordage.' },
  berries: { id: 'berries', name: 'Salmonberries', plural: 'Salmonberries', stack: 12, color: '#f08a3c', description: 'Sweet and a little tart.', food: { hunger: 5, thirst: 3, energy: 2 } },
  mushroom: { id: 'mushroom', name: 'Chanterelle', plural: 'Chanterelles', stack: 10, color: '#f2b441', description: 'Golden forest mushroom. Much better cooked.', food: { hunger: 4, health: -2 } },
  onion: { id: 'onion', name: 'Wild Onion', plural: 'Wild Onions', stack: 10, color: '#d9c2e6', description: 'Nodding onion from the meadow.', food: { hunger: 3, thirst: 1 } },
  bark: { id: 'bark', name: 'Birch Bark', plural: 'Birch Bark', stack: 10, color: '#efe7da', description: 'Papery bark peeled from a paper birch.' },
  log: { id: 'log', name: 'Log', plural: 'Logs', stack: 4, color: '#8a5a33', description: 'A heavy length of timber.', fuelHours: 4 },
  cordage: { id: 'cordage', name: 'Cordage', plural: 'Cordage', stack: 10, color: '#c9b27a', description: 'Twisted fern fiber. Strong enough to lash tools.' },
  rawMeat: { id: 'rawMeat', name: 'Raw Meat', plural: 'Raw Meat', stack: 6, color: '#c8574f', description: 'Should really be cooked.', food: { hunger: 6, health: -6 } },
  rawFish: { id: 'rawFish', name: 'Raw Trout', plural: 'Raw Trout', stack: 6, color: '#8fb3c9', description: 'A speckled lake trout.', food: { hunger: 5, thirst: 1, health: -4 } },
  hide: { id: 'hide', name: 'Hide', plural: 'Hides', stack: 6, color: '#b98a5a', description: 'Warm animal hide for packs and tents.' },
  lakeWater: { id: 'lakeWater', name: 'Lake Water', plural: 'Lake Water', stack: 4, color: '#6fb3d6', water: true, canteen: true, description: 'Cold and a little cloudy.', food: { thirst: 18, warmth: -3 } },
  boiledWater: { id: 'boiledWater', name: 'Boiled Water', plural: 'Boiled Water', stack: 4, color: '#a9dcef', water: true, canteen: true, description: 'Clean and warm. A base for teas and stews.', food: { thirst: 28, warmth: 6, energy: 3 } },
  cookedMeat: { id: 'cookedMeat', name: 'Roast Meat', plural: 'Roast Meat', stack: 6, color: '#9c5a36', meal: true, description: 'Charred over the fire.', food: { hunger: 24, warmth: 4, health: 4, energy: 6 } },
  grilledTrout: { id: 'grilledTrout', name: 'Grilled Trout', plural: 'Grilled Trout', stack: 6, color: '#d9a56b', meal: true, description: 'Flaky and smoky.', food: { hunger: 20, thirst: 2, warmth: 4, health: 4, energy: 6 } },
  skewer: { id: 'skewer', name: 'Mushroom Skewer', plural: 'Mushroom Skewers', stack: 6, color: '#d99a3c', meal: true, description: 'Chanterelles and wild onion, fire-roasted on a stick.', food: { hunger: 20, warmth: 5, health: 3, energy: 8 } },
  forageSkewer: { id: 'forageSkewer', name: "Forager's Skewer", plural: "Forager's Skewers", stack: 6, color: '#e07a4a', meal: true, description: 'Salmonberries and wild onion roasted on a stick. Nothing but what the forest gives.', food: { hunger: 16, thirst: 4, warmth: 4, health: 2, energy: 6 } },
  berryTea: { id: 'berryTea', name: 'Salmonberry Tea', plural: 'Salmonberry Tea', stack: 4, color: '#e0664d', water: true, meal: true, description: 'A warm mug that tastes like summer.', food: { hunger: 4, thirst: 30, warmth: 16, health: 2, energy: 12 } },
  stew: { id: 'stew', name: 'Forest Stew', plural: 'Forest Stew', stack: 4, color: '#a86d3b', meal: true, description: 'Meat, chanterelles, and onion simmered in boiled water. Deeply cozy.', food: { hunger: 42, thirst: 16, warmth: 20, health: 12, energy: 18 } },
  cedarTrout: { id: 'cedarTrout', name: 'Bark-Baked Trout', plural: 'Bark-Baked Trout', stack: 4, color: '#c98b52', meal: true, description: 'Trout and onion baked in a birch-bark parcel.', food: { hunger: 34, thirst: 4, warmth: 8, health: 8, energy: 12 } },
  troutChowder: { id: 'troutChowder', name: 'Trout Chowder', plural: 'Trout Chowder', stack: 4, color: '#e3c9a0', meal: true, description: 'Trout, onion and chanterelles simmered in boiled water.', food: { hunger: 38, thirst: 18, warmth: 18, health: 10, energy: 16 } },
  troutSkewer: { id: 'troutSkewer', name: 'Trout & Berry Skewer', plural: 'Trout & Berry Skewers', stack: 6, color: '#d9785a', meal: true, description: 'Roast trout glazed with salmonberries.', food: { hunger: 24, thirst: 5, warmth: 5, health: 5, energy: 10 } },
  smokedTrout: { id: 'smokedTrout', name: 'Smoked Trout', plural: 'Smoked Trout', stack: 8, color: '#b0643c', meal: true, description: 'A strip of smoky trout. Light, and good for a long day.', food: { hunger: 16, warmth: 3, health: 3, energy: 10 } },
  charredMeal: { id: 'charredMeal', name: 'Charred Meal', plural: 'Charred Meals', stack: 6, color: '#5a4032', description: 'A little burnt around the edges, but still filling. Practice makes perfect.', food: { hunger: 8, warmth: 2 } },
  arrow: { id: 'arrow', name: 'Arrow', plural: 'Arrows', stack: 16, color: '#b08a5a', description: 'Stone-tipped. Sometimes you can find them again.' },
  pricklyPear: { id: 'pricklyPear', name: 'Prickly Pear Fruit', plural: 'Prickly Pear Fruit', stack: 12, color: '#c2285f', description: 'A magenta tuna, rolled in sand to knock off the glochids. Sweet and juicy.', food: { hunger: 5, thirst: 4, energy: 2 } },
  chollaBuds: { id: 'chollaBuds', name: 'Cholla Buds', plural: 'Cholla Buds', stack: 10, color: '#9bb04a', description: 'Spiny flower buds. Rough raw; roasted they taste like artichoke.', food: { hunger: 3, health: -2 } },
  agaveHeart: { id: 'agaveHeart', name: 'Agave Heart', plural: 'Agave Hearts', stack: 4, color: '#c9b06a', description: 'The heavy core of an agave. Harsh raw; a long roast turns it sweet.', food: { hunger: 4, health: -3 } },
  chiaSeeds: { id: 'chiaSeeds', name: 'Chia Seeds', plural: 'Chia Seeds', stack: 12, color: '#7a6f86', description: 'Tiny seeds shaken from desert chia. A spoonful keeps you going.', food: { hunger: 3, energy: 4 } },
  wolfberries: { id: 'wolfberries', name: 'Wolfberries', plural: 'Wolfberries', stack: 12, color: '#e0412b', description: 'Small red desert-thorn berries, a little bitter.', food: { hunger: 4, thirst: 2, energy: 2 } },
  mesquitePods: { id: 'mesquitePods', name: 'Mesquite Pods', plural: 'Mesquite Pods', stack: 12, color: '#d8b56a', description: 'Sweet, chewy bean pods. Ground and baked they make a filling cake.', food: { hunger: 4, energy: 3 } },
  pinonNuts: { id: 'pinonNuts', name: 'Piñon Nuts', plural: 'Piñon Nuts', stack: 12, color: '#8a5a3a', description: 'Rich little pine nuts shaken from pinyon cones.', food: { hunger: 5, energy: 3 } },
  desertSkewer: { id: 'desertSkewer', name: 'Desert Skewer', plural: 'Desert Skewers', stack: 6, color: '#c8506a', meal: true, description: 'Prickly pear fruit and cholla buds roasted on a stick.', food: { hunger: 16, thirst: 5, warmth: 4, health: 2, energy: 6 } },
  roastAgave: { id: 'roastAgave', name: 'Roast Agave', plural: 'Roast Agave', stack: 4, color: '#b98640', meal: true, description: 'Agave heart roasted in the coals until sweet and sticky.', food: { hunger: 30, warmth: 6, health: 6, energy: 14 } },
  mesquiteCakes: { id: 'mesquiteCakes', name: 'Mesquite Cake', plural: 'Mesquite Cakes', stack: 8, color: '#c79a52', meal: true, description: 'Ground mesquite pods mixed with water and baked on a stone.', food: { hunger: 14, warmth: 3, health: 2, energy: 10 } },
  chiaFresca: { id: 'chiaFresca', name: 'Chia Fresca', plural: 'Chia Fresca', stack: 4, color: '#d7728f', water: true, meal: true, description: 'Chia seeds and prickly pear stirred into warm water. Very thirst-quenching.', food: { hunger: 5, thirst: 34, warmth: 6, health: 2, energy: 14 } },
  wolfberryTea: { id: 'wolfberryTea', name: 'Wolfberry Tea', plural: 'Wolfberry Tea', stack: 4, color: '#d9543b', water: true, meal: true, description: 'A warm, tart mug for a cold desert night.', food: { hunger: 4, thirst: 30, warmth: 16, health: 2, energy: 12 } },
  roastPinon: { id: 'roastPinon', name: 'Roasted Piñon Nuts', plural: 'Roasted Piñon Nuts', stack: 8, color: '#7a4a2c', meal: true, description: 'Toasted in the shell over the fire. Rich and warming.', food: { hunger: 16, warmth: 3, health: 3, energy: 10 } },
  desertStew: { id: 'desertStew', name: 'Desert Stew', plural: 'Desert Stew', stack: 4, color: '#a0663a', meal: true, description: 'Meat, cholla buds and mesquite pods simmered in boiled water.', food: { hunger: 42, thirst: 16, warmth: 20, health: 12, energy: 18 } },
  pinonTrout: { id: 'pinonTrout', name: 'Piñon-Crusted Trout', plural: 'Piñon-Crusted Trout', stack: 4, color: '#b98356', meal: true, description: 'Trout rolled in crushed piñon nuts and grilled.', food: { hunger: 34, thirst: 4, warmth: 8, health: 8, energy: 12 } },
  pearTroutSkewer: { id: 'pearTroutSkewer', name: 'Trout & Prickly Pear Skewer', plural: 'Trout & Prickly Pear Skewers', stack: 6, color: '#c9607a', meal: true, description: 'Roast trout glazed with prickly pear.', food: { hunger: 24, thirst: 5, warmth: 5, health: 5, energy: 10 } },
};

/**
 * Items that exist on both maps but read differently in the desert. Names are resolved through the map on screen
 * (`setDisplayBiome`), so shared recipes, saves and the network keep using the same ids.
 */
const DESERT_TEXT: Partial<Record<ItemId, Partial<Pick<ItemDef, 'name' | 'plural' | 'description'>>>> = {
  stick: { description: 'A dry mesquite or creosote branch. Handles, kindling, and fuel.' },
  stone: { description: 'A fist-sized chunk of sandstone.' },
  fiber: { name: 'Yucca Fiber', plural: 'Yucca Fiber', description: 'Stripped from yucca leaves. Twist it into cordage.' },
  bark: { name: 'Shredded Bark', plural: 'Shredded Bark', description: 'Stringy bark pulled from junipers and cottonwoods.' },
  cordage: { description: 'Twisted yucca fiber. Strong enough to lash tools.' },
  rawFish: { description: 'A golden Gila trout from the spring.' },
  lakeWater: { name: 'Spring Water', plural: 'Spring Water', description: 'Clear, cold water from a spring or rock pool.' },
};

let displayBiome: BiomeId = 'pnw';

/** Which map's names the UI and messages use. Set whenever a world is shown or simulated. */
export function setDisplayBiome(b: BiomeId): void {
  displayBiome = b;
}

export function getDisplayBiome(): BiomeId {
  return displayBiome;
}

/** An item's definition with the displayed map's names applied. */
export function itemDef(id: ItemId): ItemDef {
  const o = displayBiome === 'desert' ? DESERT_TEXT[id] : undefined;
  return o ? { ...ITEMS[id], ...o } : ITEMS[id];
}

export type ToolId = 'hands' | 'axe' | 'spear' | 'bow' | 'torch' | 'rod';

export interface ToolDef {
  id: ToolId;
  name: string;
  slot: number;
  description: string;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  hands: { id: 'hands', name: 'Hands', slot: 1, description: 'Gather, pick up, drink, and interact.' },
  axe: { id: 'axe', name: 'Stone Axe', slot: 2, description: 'Chops trees for logs. Hold left-click on a trunk.' },
  spear: { id: 'spear', name: 'Spear', slot: 3, description: 'Long reach. Good for fish and for keeping wolves at bay.' },
  bow: { id: 'bow', name: 'Bow', slot: 4, description: 'Hold left-click to draw, release to shoot. Needs arrows.' },
  torch: { id: 'torch', name: 'Torch', slot: 5, description: 'Light and warmth. Predators keep their distance.' },
  rod: { id: 'rod', name: 'Fishing Pole', slot: 6, description: 'Hold left-click to wind up a cast, release to throw. Click when a fish bites.' },
};

/** Multiplayer sends the held tool as its index here, so new tools go at the end. */
export const TOOL_ORDER: ToolId[] = ['hands', 'axe', 'spear', 'bow', 'torch', 'rod'];

export type GearId = 'basket' | 'backpack' | 'canteen';

export const GEAR: Record<GearId, { id: GearId; name: string; description: string }> = {
  basket: { id: 'basket', name: 'Grass Basket', description: '+4 pack slots.' },
  backpack: { id: 'backpack', name: 'Hide Backpack', description: '+6 pack slots.' },
  canteen: { id: 'canteen', name: 'Bark Canteen', description: 'Carry up to 4 servings of water.' },
};

export function itemName(id: ItemId, count: number): string {
  const d = itemDef(id);
  return count === 1 ? d.name : d.plural;
}
