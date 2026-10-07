import type { BiomeId } from './biomes';
import type { PrefabId } from './prefabs';

export type VillagerRole = 'elder' | 'scout' | 'guardian' | 'gatherer' | 'young';
export type VillagerTask = 'rest' | 'gather' | 'hunt' | 'explore' | 'craft' | 'chop';

export interface TribeMember {
  id: string;
  name: string;
  role: VillagerRole;
  title: string;
  tasks: readonly VillagerTask[];
  greeting: string;
  stories: readonly string[];
}

export interface TribeDefinition {
  id: string;
  name: string;
  biome: BiomeId;
  members: readonly TribeMember[];
  /** Unlisted camp structures are private and cannot be interacted with. */
  stationReputation: Partial<Record<PrefabId, number>>;
  lessons: Record<VillagerRole, { title: string; text: string }[]>;
  storageGreeting: string;
  shelterGreeting: string;
}

/** Knowledge is freely shared, even before the player has earned trust or accepted a quest. */
export const ORUUN_LESSONS: Record<VillagerRole, { title: string; text: string }[]> = {
  elder: [
    { title: 'Begin with warmth and water', text: 'Drink at the lake and gather sticks and stones. Build your first fire through Crafting → Build. Add sticks or logs when its fuel runs low. Warmth, meals and rest matter as much as a good tool.' },
    { title: 'Grow your shelter patiently', text: 'Start with a Lean-to. Upgrade it into an A-Frame at Crafting 8, a Bark Hut at 16, and a Hide Tent at 28. A Grass Basket and then a Hide Backpack let you carry the larger material costs. Our tents show what you can work toward.' },
  ],
  scout: [
    { title: 'Use the whole animal', text: 'A Stone Knife skins a carcass on the first cut and butchers it on the second. Rabbits and squirrels are good first hunts. Save whole hides for packs and shelters. Deer and predators require more Hunting and Skinning practice.' },
    { title: 'Read the water', text: 'Make a Fishing Pole at Crafting 2. Hold to wind up, release to cast into unfrozen water, and click when the float dips. Trout live in freshwater; Bass and Salmon need more Fishing practice and the main lake. Grill your catch over a lit fire.' },
  ],
  guardian: [
    { title: 'Keep tools working', text: 'At Crafting 6, make a Repair Workbench. Click it, select a worn tool, gather the listed materials and finish the repair. At Oruun Reputation 5, you may use our workbench with your own materials. Repair before a tool breaks; upgrading also restores its condition.' },
    { title: 'Make a weatherproof home', text: 'A Lean-to starts your shelter. Use its menu or Crafting → Upgrades to raise the next tier in place. Leave space around it. Crafting 8 opens the A-Frame, 16 the Bark Hut and 28 the Hide Tent. Sleep after 7 PM, away from predators.' },
  ],
  gatherer: [
    { title: 'Weave a place for supplies', text: 'Four plant fiber makes one cordage. At Crafting 4, a Woven Storage Bin takes 24 sticks, 20 fiber and 3 cordage. Build it at your camp and click it to move supplies. Later, upgrade it into a Log Storage Crate and a Hide-Lined Chest.' },
    { title: 'Cook what the forest provides', text: 'At Oruun Reputation 2, our fire is yours to cook at. A Forager’s Skewer uses 2 berries, 1 onion and 1 stick. Roast raw meat or grill trout. Make a Bark Canteen at Crafting 3, fill it with lake water, then boil the water over a lit fire for teas and stews. Forest Stew opens at Cooking 8.' },
  ],
  young: [
    { title: 'My first meal', text: 'Sela taught me to gather salmonberries and wild onions, then put 2 berries, 1 onion and 1 stick together at a lit fire for a Forager’s Skewer. Charred meals still teach Cooking, but keep an unburnt meal when someone asks for one.' },
    { title: 'Give the forest time', text: 'Picked patches need time to regrow. Explore for more instead of waiting beside one plant. In winter, gather snow, then melt and boil it at a lit campfire into your canteen. Keep food, fuel and a shelter ready before the cold arrives.' },
  ],
};

export const ORUUN: TribeDefinition = {
  id: 'oruun', name: 'Oruun', biome: 'pnw', lessons: ORUUN_LESSONS,
  stationReputation: { campfire: 2, workbench: 5 },
  storageGreeting: 'These are our shared provisions. Bring quest supplies to the person who asked for them. Sela can teach you to weave a bin for your own camp.',
  shelterGreeting: 'Our families rest in these tents. Aven can guide you from your first lean-to to a hide shelter of your own.',
  members: [
    { id: 'aven', name: 'Aven', role: 'elder', title: 'Elder', tasks: ['rest', 'rest', 'explore', 'craft'], greeting: 'You have traveled far. Warm your hands, traveler. We are the Oruun. We welcome a quiet guest, though trust takes time.', stories: [
      'My grandmother brought me to this lake when I was small. She said every shore has a story, if you sit quietly long enough to hear it.',
      'We once sheltered beneath a fallen cedar through three days of rain. Tor kept the embers alive, and Sela kept us laughing. A camp is more than its walls.',
      'At dusk we tell the young ones where we walked that day. A good path should outlive the person who first found it.',
    ] },
    { id: 'neri', name: 'Neri', role: 'scout', title: 'Hunter & scout', tasks: ['rest', 'hunt', 'explore', 'gather'], greeting: 'I saw your tracks before I saw you. Walk gently through these woods, and we should get along.', stories: [
      'A squirrel followed me halfway home this morning, scolding from every branch. I suspect I walked too close to its winter stores.',
      'The first deer I tracked led me in a circle and back to my own footprints. Aven still asks whether I ever caught myself.',
      'There is a bend in the stream where the mist lingers after sunrise. I go there when I need the woods to be quiet for a while.',
    ] },
    { id: 'tor', name: 'Tor', role: 'guardian', title: 'Guardian', tasks: ['rest', 'chop', 'explore', 'craft'], greeting: 'You may approach our fire. Keep your weapons low; there are families here. A pair of willing hands is always welcome.', stories: [
      'This spear belonged to my older brother. I have replaced the shaft twice, but the knot beneath the point is still tied the way he taught me.',
      'Last winter a storm took the roof from our old shelter. We spent the next morning mending it together. Even Lio insisted on carrying a pole.',
      'Neri says I chop wood too loudly. I tell her the trees deserve fair warning. That usually earns me a smile.',
    ] },
    { id: 'sela', name: 'Sela', role: 'gatherer', title: 'Gatherer & crafter', tasks: ['rest', 'gather', 'craft', 'chop'], greeting: 'There is enough here if we are patient. I gather, weave and mend for the camp. Perhaps we can help one another.', stories: [
      'My first basket left a trail of berries all the way home. My mother followed the trail and found me trying to mend the bottom with grass.',
      'The onions near the lake were late this spring. We waited, and the next patch grew twice as thick. The land rarely hurries for us.',
      'I learned this weave beside my aunt’s fire. When I work, I still hear her reminding me to leave room for the fiber to bend.',
    ] },
    { id: 'lio', name: 'Lio', role: 'young', title: 'Young villager', tasks: ['rest', 'gather', 'explore', 'craft'], greeting: 'You came from beyond the lake? I’m Lio. Aven says we should learn your name before we share all our stories.', stories: [
      'I found a stone shaped like a fish yesterday. Neri said it was the only fish I had caught without getting my feet wet.',
      'Tor let me help mend a tent. My stitches were crooked, but he said the rain would not notice. I keep checking after every shower.',
      'Aven knows which bird is singing without even looking up. I am learning three of them. The fourth always sounds like it is laughing at me.',
    ] },
  ],
};

/** Other maps can register their own people and stories here without changing the simulation or dialog UI. */
export const TRIBES: readonly TribeDefinition[] = [ORUUN];
export const tribeFor = (id: string, biome: BiomeId) => TRIBES.find((t) => t.id === id && t.biome === biome);

export const TASK_LABELS: Record<VillagerTask, string> = {
  rest: 'Resting', gather: 'Gathering food', hunt: 'Hunting', explore: 'Exploring', craft: 'Crafting', chop: 'Chopping wood',
};
