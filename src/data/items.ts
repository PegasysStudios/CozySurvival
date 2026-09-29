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
  | 'berryTea'
  | 'stew'
  | 'cedarTrout'
  | 'arrow';

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
  /** Counts toward canteen capacity. */
  water?: boolean;
  /** Used as campfire fuel, value in game hours. */
  fuelHours?: number;
  /** Cooked/crafted meals get a cozy highlight in the UI. */
  meal?: boolean;
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  stick: { id: 'stick', name: 'Stick', plural: 'Sticks', stack: 12, color: '#a0703e', description: 'Dry fir branch. Handles, kindling, and fuel.', fuelHours: 1.5 },
  stone: { id: 'stone', name: 'Stone', plural: 'Stones', stack: 10, color: '#9aa0a6', description: 'A fist-sized river stone.' },
  fiber: { id: 'fiber', name: 'Plant Fiber', plural: 'Plant Fiber', stack: 16, color: '#7fae5a', description: 'Stripped from sword ferns. Twist it into cordage.' },
  berries: { id: 'berries', name: 'Salmonberries', plural: 'Salmonberries', stack: 12, color: '#f08a3c', description: 'Sweet and a little tart.', food: { hunger: 5, thirst: 3, energy: 2 } },
  mushroom: { id: 'mushroom', name: 'Chanterelle', plural: 'Chanterelles', stack: 10, color: '#f2b441', description: 'Golden forest mushroom. Much better cooked.', food: { hunger: 4, health: -2 } },
  onion: { id: 'onion', name: 'Wild Onion', plural: 'Wild Onions', stack: 10, color: '#d9c2e6', description: 'Nodding onion from the meadow.', food: { hunger: 3, thirst: 1 } },
  bark: { id: 'bark', name: 'Birch Bark', plural: 'Birch Bark', stack: 10, color: '#efe7da', description: 'Papery bark peeled from a paper birch.' },
  log: { id: 'log', name: 'Log', plural: 'Logs', stack: 4, color: '#8a5a33', description: 'A heavy length of timber.', fuelHours: 4 },
  cordage: { id: 'cordage', name: 'Cordage', plural: 'Cordage', stack: 10, color: '#c9b27a', description: 'Twisted fern fiber. Strong enough to lash tools.' },
  rawMeat: { id: 'rawMeat', name: 'Raw Meat', plural: 'Raw Meat', stack: 6, color: '#c8574f', description: 'Should really be cooked.', food: { hunger: 6, health: -6 } },
  rawFish: { id: 'rawFish', name: 'Raw Trout', plural: 'Raw Trout', stack: 6, color: '#8fb3c9', description: 'A speckled lake trout.', food: { hunger: 5, thirst: 1, health: -4 } },
  hide: { id: 'hide', name: 'Hide', plural: 'Hides', stack: 6, color: '#b98a5a', description: 'Warm animal hide for packs and tents.' },
  lakeWater: { id: 'lakeWater', name: 'Lake Water', plural: 'Lake Water', stack: 4, color: '#6fb3d6', water: true, description: 'Cold and a little cloudy.', food: { thirst: 18, warmth: -3 } },
  boiledWater: { id: 'boiledWater', name: 'Boiled Water', plural: 'Boiled Water', stack: 4, color: '#a9dcef', water: true, description: 'Clean and warm. A base for teas and stews.', food: { thirst: 28, warmth: 6, energy: 3 } },
  cookedMeat: { id: 'cookedMeat', name: 'Roast Meat', plural: 'Roast Meat', stack: 6, color: '#9c5a36', meal: true, description: 'Charred over the fire.', food: { hunger: 24, warmth: 4, health: 4, energy: 6 } },
  grilledTrout: { id: 'grilledTrout', name: 'Grilled Trout', plural: 'Grilled Trout', stack: 6, color: '#d9a56b', meal: true, description: 'Flaky and smoky.', food: { hunger: 20, thirst: 2, warmth: 4, health: 4, energy: 6 } },
  skewer: { id: 'skewer', name: 'Mushroom Skewer', plural: 'Mushroom Skewers', stack: 6, color: '#d99a3c', meal: true, description: 'Chanterelles and wild onion, fire-roasted on a stick.', food: { hunger: 20, warmth: 5, health: 3, energy: 8 } },
  berryTea: { id: 'berryTea', name: 'Salmonberry Tea', plural: 'Salmonberry Tea', stack: 4, color: '#e0664d', water: true, meal: true, description: 'A warm mug that tastes like summer.', food: { hunger: 4, thirst: 30, warmth: 16, health: 2, energy: 12 } },
  stew: { id: 'stew', name: 'Forest Stew', plural: 'Forest Stew', stack: 4, color: '#a86d3b', meal: true, description: 'Meat, chanterelles, and onion simmered in boiled water. Deeply cozy.', food: { hunger: 42, thirst: 16, warmth: 20, health: 12, energy: 18 } },
  cedarTrout: { id: 'cedarTrout', name: 'Bark-Baked Trout', plural: 'Bark-Baked Trout', stack: 4, color: '#c98b52', meal: true, description: 'Trout and onion baked in a birch-bark parcel.', food: { hunger: 34, thirst: 4, warmth: 8, health: 8, energy: 12 } },
  arrow: { id: 'arrow', name: 'Arrow', plural: 'Arrows', stack: 16, color: '#b08a5a', description: 'Stone-tipped. Sometimes you can find them again.' },
};

export type ToolId = 'hands' | 'axe' | 'spear' | 'bow' | 'torch';

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
};

export const TOOL_ORDER: ToolId[] = ['hands', 'axe', 'spear', 'bow', 'torch'];

export type GearId = 'basket' | 'backpack' | 'canteen';

export const GEAR: Record<GearId, { id: GearId; name: string; description: string }> = {
  basket: { id: 'basket', name: 'Grass Basket', description: '+4 pack slots.' },
  backpack: { id: 'backpack', name: 'Hide Backpack', description: '+6 pack slots.' },
  canteen: { id: 'canteen', name: 'Bark Canteen', description: 'Carry up to 4 servings of water.' },
};

export function itemName(id: ItemId, count: number): string {
  return count === 1 ? ITEMS[id].name : ITEMS[id].plural;
}
