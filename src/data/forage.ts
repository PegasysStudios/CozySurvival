import type { BiomeId } from './biomes';
import type { ItemId } from './items';
import type { ResourceKind, TreeSpecies } from './resources';

export type ForageId =
  | 'berryBush' | 'fern' | 'mushroom' | 'onion' | 'birch'
  | 'pricklyPear' | 'cholla' | 'yucca' | 'agave' | 'chia' | 'wolfberry' | 'mesquite' | 'pinyon' | 'juniper'
  | 'coconut' | 'seaGrape' | 'pandanus' | 'taro' | 'banana' | 'purslane' | 'breadfruit' | 'hau';

export interface ForageEntry {
  id: ForageId;
  /** The map it grows on. */
  biome: BiomeId;
  name: string;
  latin: string;
  /** What harvesting it gives you. */
  item: ItemId;
  /** What it does for you, in a sentence. */
  use: string;
  habitat: string;
  notes: string;
}

/** The Foraging guide, in display order. Every harvestable plant unlocks its entry the first time you harvest it. */
export const FORAGE_GUIDE: ForageEntry[] = [
  {
    id: 'berryBush', biome: 'pnw', name: 'Salmonberry', latin: 'Rubus spectabilis', item: 'berries',
    use: 'A quick snack that takes the edge off hunger and thirst and gives a little energy. Better still in tea or on a skewer.',
    habitat: 'Shorelines, meadows and forest edges.',
    notes: 'Bushes stay put when picked clean and fruit again after a while. The first berries of the season were a feast for coastal peoples.',
  },
  {
    id: 'fern', biome: 'pnw', name: 'Sword Fern', latin: 'Polystichum munitum', item: 'fiber',
    use: 'Not food. Its fronds strip into fiber, and four fiber twist into cordage, the lashing behind most tools and shelters.',
    habitat: 'Shady, damp forest floor under firs and cedars.',
    notes: 'Evergreen all year. Ferns keep growing back after you strip them, so a fern patch near camp is worth remembering.',
  },
  {
    id: 'mushroom', biome: 'pnw', name: 'Pacific Golden Chanterelle', latin: 'Cantharellus formosus', item: 'mushroom',
    use: 'Filling, but it upsets your stomach raw and costs a little health. Cook it and it becomes one of the best meals in the woods.',
    habitat: 'Mossy ground in older forest, often near Douglas firs.',
    notes: 'Rare and slow to come back. Picked patches vanish and return about a day later.',
  },
  {
    id: 'onion', biome: 'pnw', name: 'Nodding Onion', latin: 'Allium cernuum', item: 'onion',
    use: 'A small bite of food and water on its own; the flavour that makes skewers, stews and chowders work.',
    habitat: 'Open meadows and sunny clearings.',
    notes: 'Look for the drooping pink flower heads. Pulled patches regrow in about a day.',
  },
  {
    id: 'birch', biome: 'pnw', name: 'Paper Birch', latin: 'Betula papyrifera', item: 'bark',
    use: 'Not food. Peel the papery bark by hand for canteens, torches, bark-baked trout and the bark hut.',
    habitat: 'Scattered through the forest; a few always grow near camp.',
    notes: 'Each tree gives two sheets, then shows bare wood until the bark regrows about a day later. Never needs an axe.',
  },
  {
    id: 'pricklyPear', biome: 'desert', name: 'Engelmann Prickly Pear', latin: 'Opuntia engelmannii', item: 'pricklyPear',
    use: 'Juicy fruit ("tunas") that ease hunger and thirst. Roast them on a skewer, stir them into chia fresca, or glaze a trout.',
    habitat: 'Everywhere in the low desert, often in the shade of creosote and mesquite.',
    notes: 'Tiny hair-like glochids cover the fruit; people rolled them in sand or singed them off. Pads fruit again about a day after picking.',
  },
  {
    id: 'cholla', biome: 'desert', name: 'Buckhorn Cholla', latin: 'Cylindropuntia acanthocarpa', item: 'chollaBuds',
    use: 'Spiny flower buds that hurt raw. Roasted on a skewer or simmered in stew they are a real meal.',
    habitat: 'Rocky flats and bajadas.',
    notes: 'The Tohono O\'odham pit-roast cholla buds each spring. Buds come back about a day after picking.',
  },
  {
    id: 'yucca', biome: 'desert', name: 'Banana Yucca', latin: 'Yucca baccata', item: 'fiber',
    use: 'Not food here. Its stiff leaves strip into fiber, and four fiber twist into cordage for tools, packs and shelters.',
    habitat: 'Sandy flats and rocky slopes, low desert to the pinyon hills.',
    notes: 'Yucca fiber made sandals, baskets and rope across the Southwest for thousands of years. Stripped plants regrow within a day.',
  },
  {
    id: 'agave', biome: 'desert', name: "Parry's Agave", latin: 'Agave parryi', item: 'agaveHeart',
    use: 'The heart is harsh raw but roasts into one of the most filling foods in the desert.',
    habitat: 'Rocky slopes, often below mesas and in the uplands.',
    notes: 'Cutting the heart ends the plant; a new one takes about three days to take its place. Roasting pits for agave are found all over Arizona.',
  },
  {
    id: 'chia', biome: 'desert', name: 'Desert Chia', latin: 'Salvia columbariae', item: 'chiaSeeds',
    use: 'A pinch of seeds is a little food and energy; stirred into warm water with prickly pear it makes a very thirst-quenching drink.',
    habitat: 'Open sandy ground and grassy plains.',
    notes: 'A small annual sage with blue pom-pom flowers. Shaken plants vanish and come back about a day later.',
  },
  {
    id: 'wolfberry', biome: 'desert', name: 'Anderson Wolfberry', latin: 'Lycium andersonii', item: 'wolfberries',
    use: 'Small, slightly bitter berries: a snack, or brewed into a warming tea for cold nights.',
    habitat: 'Washes and flats among creosote bushes.',
    notes: 'A thorny shrub related to goji. Picked bushes fruit again in about a day.',
  },
  {
    id: 'mesquite', biome: 'desert', name: 'Velvet Mesquite', latin: 'Prosopis velutina', item: 'mesquitePods',
    use: 'Pick the sweet pods by hand. Ground and baked with water they make mesquite cakes; they also thicken desert stew.',
    habitat: 'Washes and grassy flats of the low desert.',
    notes: 'Mesquite flour was a staple across the Sonoran Desert. A small tree: chopping it only yields one log.',
  },
  {
    id: 'pinyon', biome: 'desert', name: 'Pinyon Pine', latin: 'Pinus edulis', item: 'pinonNuts',
    use: 'Shake nuts from the cones by hand. Roast them, or crust a trout with them.',
    habitat: 'The high country, above the junipers and below the ponderosas.',
    notes: 'Piñon harvests were a major autumn gathering for the peoples of the Colorado Plateau. Picked trees have nuts again after a day and a half.',
  },
  {
    id: 'juniper', biome: 'desert', name: 'Utah Juniper', latin: 'Juniperus osteosperma', item: 'bark',
    use: 'Not food. Pull the stringy bark by hand for torches, canteens and bark shelters. Fremont cottonwoods by the spring peel the same way.',
    habitat: 'The lower edge of the high country, on dry rocky ground.',
    notes: 'Shredded juniper bark was tinder, bedding and diaper padding for desert peoples. Each tree gives two handfuls, then regrows in about a day.',
  },
  {
    id: 'coconut', biome: 'island', name: 'Coconut Palm', latin: 'Cocos nucifera', item: 'coconut',
    use: 'A drink and a meal in one: the water eases thirst, the white meat takes the edge off hunger. Cook it with fish or bananas for a real meal.',
    habitat: 'Beaches and the palm-fringed islet in the lagoon.',
    notes: "The \"tree of life\" of the Pacific: on some atolls people lived on five or six nuts a day. The nuts hang far out of reach, so shoot them down with a bow; now and then one lies fallen under its palm. A palm ripens new nuts about a day and a quarter after it is picked clean.",
  },
  {
    id: 'seaGrape', biome: 'island', name: 'Sea Grape', latin: 'Coccoloba uvifera', item: 'seaGrapes',
    use: 'Tart purple grapes that ease hunger and thirst. Roast them on a skewer, steep them into tea, or glaze a fish.',
    habitat: 'The sandy strand just above the beach.',
    notes: 'A salt-tolerant shrub that holds the dunes together. The fruit is mostly pit, and people have long made jelly and wine from it. Bushes fruit again about a day after picking.',
  },
  {
    id: 'pandanus', biome: 'island', name: 'Pandanus', latin: 'Pandanus tectorius', item: 'fiber',
    use: 'Not food here. Its long strap leaves strip into fiber, and four fiber twist into cordage for tools, packs and shelters.',
    habitat: 'Beaches, the littoral forest and grassy slopes, standing on its stilt roots.',
    notes: 'Pacific islanders wove mats, sails, baskets and thatch from pandanus leaves. Stripped plants grow new leaves within a day.',
  },
  {
    id: 'taro', biome: 'island', name: 'Wild Taro', latin: 'Colocasia esculenta', item: 'taro',
    use: 'A starchy root full of stinging crystals raw: eating it hurts. Cooked into poi, laulau or island stew it is one of the best foods on the island.',
    habitat: 'Wet ground by the streams and pools.',
    notes: 'Taro was the staple of Hawaii and much of Polynesia, grown in flooded terraces. The crystals break down with heat. Pulled plants come back about a day later.',
  },
  {
    id: 'banana', biome: 'island', name: 'Wild Banana', latin: 'Musa spp.', item: 'banana',
    use: 'Sweet, quick energy and a little food. Bake them with coconut for a proper meal.',
    habitat: 'Damp clearings in the jungle and along the streams.',
    notes: 'Bananas travelled across the Pacific in voyaging canoes and now grow wild on many islands. A cut bunch takes about a day and a half to grow back.',
  },
  {
    id: 'purslane', biome: 'island', name: 'Beach Purslane', latin: 'Portulaca lutea', item: 'purslane',
    use: 'A small bite of salty, juicy leaves: a little food and a little water. It rounds out a beach skewer.',
    habitat: 'Sand, rocks and open grassland in full sun.',
    notes: "One of the Pacific's emergency foods, eaten raw or cooked. Picked patches regrow in about a day.",
  },
  {
    id: 'breadfruit', biome: 'island', name: 'Breadfruit', latin: 'Artocarpus altilis', item: 'breadfruit',
    use: 'Pick the big fruit by hand. Hard and bland raw, it roasts into one of the most filling foods on the island and thickens island stew.',
    habitat: 'Scattered through the jungle and the lowland forest.',
    notes: "A staple across Polynesia and the reason for the voyage of HMS Bounty. Each tree carries two ripe fruit at a time and ripens more in about a day and a half.",
  },
  {
    id: 'hau', biome: 'island', name: 'Hau (Beach Hibiscus)', latin: 'Hibiscus tiliaceus', item: 'bark',
    use: 'Not food. Peel the tough inner bark by hand for canteens, torches and bark shelters.',
    habitat: 'Along the shore behind the beach, and by the streams.',
    notes: 'Polynesians twisted hau bark into rope and beat it into cloth. Its yellow flowers turn red and drop within a day. Each tree gives two strips, then regrows in about a day.',
  },
];

export const FORAGE_BY_ID: Record<ForageId, ForageEntry> = Object.fromEntries(FORAGE_GUIDE.map((f) => [f.id, f])) as Record<ForageId, ForageEntry>;

/** Guide entries for one map, in display order. */
export function forageGuideFor(biome: BiomeId): ForageEntry[] {
  return FORAGE_GUIDE.filter((f) => f.biome === biome);
}

const RESOURCE_FORAGE: Partial<Record<ResourceKind, ForageId>> = {
  berryBush: 'berryBush', fern: 'fern', mushroom: 'mushroom', onion: 'onion',
  pricklyPear: 'pricklyPear', cholla: 'cholla', yucca: 'yucca', agave: 'agave', chia: 'chia', wolfberry: 'wolfberry',
  seaGrape: 'seaGrape', pandanus: 'pandanus', taro: 'taro', banana: 'banana', purslane: 'purslane', coconut: 'coconut',
};

/** The guide entry a forage patch belongs to (sticks and stones aren't plants). */
export function forageForResource(kind: ResourceKind): ForageId | null {
  return RESOURCE_FORAGE[kind] ?? null;
}

const TREE_FORAGE: Partial<Record<TreeSpecies, ForageId>> = {
  birch: 'birch', mesquite: 'mesquite', pinyon: 'pinyon', juniper: 'juniper', cottonwood: 'juniper', breadfruit: 'breadfruit', hau: 'hau', palm: 'coconut',
};

/** The guide entry a hand-harvestable tree unlocks. */
export function forageForTree(species: TreeSpecies): ForageId | null {
  return TREE_FORAGE[species] ?? null;
}
