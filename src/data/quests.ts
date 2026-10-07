import type { BiomeId } from './biomes';
import type { ItemId } from './items';
import type { IconId } from './icons';
import type { PrefabId } from './prefabs';
import type { SkillId } from '../sim/state';

export interface QuestMilestone {
  kind: 'crafted' | 'event';
  key: string;
  count: number;
  label: string;
  hint: string;
  icon: IconId;
  /** Repairs should be practiced during the quest; established player buildings already count. */
  sinceAccept?: boolean;
}

export interface QuestDefinition {
  id: string;
  title: string;
  giver: string;
  offer: string;
  thanks: string;
  lesson: string;
  deliveries: { item: ItemId; count: number }[];
  milestones?: QuestMilestone[];
  reputation: number;
  requirements?: { skill: SkillId; level: number }[];
}

export interface Questline {
  tribe: string;
  biome: BiomeId;
  quests: readonly QuestDefinition[];
}

const building = (key: PrefabId, label: string, hint: string): QuestMilestone => ({ kind: 'crafted', key, count: 1, label, hint, icon: key });

/** One continuous apprenticeship: the existing crafting/upgrade gates still apply. Rewards total 100 trust. */
export const ORUUN_QUESTLINE: Questline = {
  tribe: 'oruun', biome: 'pnw', quests: [
    {
      id: 'oruun-firewood', title: 'An ember of trust', giver: 'aven',
      offer: 'We are having trouble gathering wood for our fire. Could you bring us twelve sticks?',
      thanks: 'You kept your word. These sticks will keep our embers alive tonight.',
      lesson: 'Pick up fallen sticks by hand. Quest supplies must be in your pack when you return to the person who asked.',
      deliveries: [{ item: 'stick', count: 12 }], reputation: 3,
    },
    {
      id: 'oruun-campfire', title: 'A fire of your own', giver: 'sela',
      offer: 'A traveler needs a hearth of their own. Could you build a campfire for yourself, then bring us five logs for ours?',
      thanks: 'Now you have a place to warm your hands and cook. Keep a few sticks for your own fire, too.',
      lesson: 'Crafting (C) → Build → Campfire: 25 stones, 20 sticks and 5 fiber. Place it on clear, level ground. Fell birches with an axe, then cut their trunks into logs.',
      deliveries: [{ item: 'log', count: 5 }], reputation: 5,
      milestones: [building('campfire', 'Build your own campfire', 'Crafting → Build → Campfire; an existing player-built fire counts.')],
      requirements: [{ skill: 'crafting', level: 1 }],
    },
    {
      id: 'oruun-forage', title: 'Food from the forest', giver: 'lio',
      offer: 'Sela is teaching me to cook what the forest gives us. Could you bring six salmonberries, three onions and two Forager’s Skewers for our next meal?',
      thanks: 'We can share these while Sela tells me which plants to look for. Thank you!',
      lesson: 'Gather salmonberries and wild onions by hand. At a lit fire, combine 2 berries, 1 onion and 1 stick into a Forager’s Skewer. Keep the finished meals for the delivery.',
      deliveries: [{ item: 'berries', count: 6 }, { item: 'onion', count: 3 }, { item: 'forageSkewer', count: 2 }], reputation: 6,
      requirements: [{ skill: 'cooking', level: 1 }],
    },
    {
      id: 'oruun-hunt', title: 'Take only what we need', giver: 'neri',
      offer: 'Our hunters have come back empty-handed. Could you bring four fresh cuts of meat and one whole hide? Rabbits and squirrels will do; nothing needs to be wasted.',
      thanks: 'Meat for the pot, hide for mending. You have learned to use what the land offers.',
      lesson: 'Craft a Stone Knife. Hunt small wildlife, skin it with the knife, then cut again to butcher the carcass. A torn hide still teaches Skinning. Larger animals have higher skill requirements.',
      deliveries: [{ item: 'rawMeat', count: 4 }, { item: 'hide', count: 1 }], reputation: 8,
      requirements: [{ skill: 'crafting', level: 1 }, { skill: 'hunting', level: 1 }, { skill: 'skinning', level: 1 }],
    },
    {
      id: 'oruun-fish', title: 'Gifts of the lake', giver: 'neri',
      offer: 'The lake can feed us when the forest is quiet. Could you bring three fresh trout and two grilled trout for the camp?',
      thanks: 'You found the rhythm of the water. There is room beside our fire whenever you need to cook.',
      lesson: 'At Crafting 2, make a Fishing Pole. Hold to wind up, release to cast, and click as the float dips. Cook trout at a lit fire. Winter ice must thaw before you can fish.',
      deliveries: [{ item: 'rawFish', count: 3 }, { item: 'grilledTrout', count: 2 }], reputation: 9,
      requirements: [{ skill: 'crafting', level: 2 }, { skill: 'fishing', level: 1 }, { skill: 'cooking', level: 1 }],
    },
    {
      id: 'oruun-storage', title: 'A place for provisions', giver: 'sela',
      offer: 'Keeping supplies dry takes patient weaving. Could you build a storage bin at your camp, then bring sixteen fiber and four cordage to mend ours?',
      thanks: 'Your provisions have a home now, and our weave will last another season.',
      lesson: 'At Crafting 4, build a Woven Storage Bin with 24 sticks, 20 fiber and 3 cordage. Four fiber makes one cordage. Click your bin to deposit supplies or take them out.',
      deliveries: [{ item: 'fiber', count: 16 }, { item: 'cordage', count: 4 }], reputation: 10,
      milestones: [building('storageBin', 'Build your own storage bin', 'Crafting 4 → Build → Woven Storage Bin.')],
      requirements: [{ skill: 'crafting', level: 4 }],
    },
    {
      id: 'oruun-workbench', title: 'Mend before replacing', giver: 'tor',
      offer: 'Good tools deserve another season. Could you build a repair workbench, mend a worn tool, and bring ten stones and six bark for our work?',
      thanks: 'A mended tool is a promise to use less of the forest. You are learning our ways.',
      lesson: 'At Crafting 6, build a Repair Workbench with 8 logs, 12 sticks, 10 stones and 4 cordage. Click a bench, select a worn tool and pay its repair materials. Finish one repair while this quest is active.',
      deliveries: [{ item: 'stone', count: 10 }, { item: 'bark', count: 6 }], reputation: 12,
      milestones: [building('workbench', 'Build your own repair workbench', 'Crafting 6 → Build → Repair Workbench.'),
        { kind: 'event', key: 'repairs', count: 1, label: 'Finish a tool repair', hint: 'Repair any worn tool after accepting this quest.', icon: 'workbench', sinceAccept: true }],
      requirements: [{ skill: 'crafting', level: 6 }],
    },
    {
      id: 'oruun-shelter', title: 'A roof for rainy nights', giver: 'tor',
      offer: 'Rain tests a shelter as surely as winter. Could you raise your lean-to into an A-Frame and bring four roast meats and four grilled trout for our returning scouts?',
      thanks: 'You have a stronger roof, and our scouts will return to a warm meal.',
      lesson: 'Build a Lean-to, then at Crafting 8 upgrade it into an A-Frame through its menu or Crafting → Upgrades. A Grass Basket helps carry the upgrade supplies. Keep working toward Crafting 16 for bark walls.',
      deliveries: [{ item: 'cookedMeat', count: 4 }, { item: 'grilledTrout', count: 4 }], reputation: 14,
      milestones: [building('aFrame', 'Upgrade your shelter to an A-Frame', 'Lean-to → A-Frame at Crafting 8.')],
      requirements: [{ skill: 'crafting', level: 8 }, { skill: 'cooking', level: 1 }],
    },
    {
      id: 'oruun-bark', title: 'Walls that remember', giver: 'sela',
      offer: 'The winds are growing colder. Could you turn your A-Frame into a Bark Hut, then bring eight cordage and four hides to help us patch our tents?',
      thanks: 'Your walls will turn the wind aside. These patches will do the same for our families.',
      lesson: 'At Crafting 16, upgrade your A-Frame into a Bark Hut. Birch bark can be peeled by hand. Make a Hide Backpack at Crafting 10 to carry the larger shelter costs.',
      deliveries: [{ item: 'cordage', count: 8 }, { item: 'hide', count: 4 }], reputation: 15,
      milestones: [building('barkHut', 'Upgrade your shelter to a Bark Hut', 'A-Frame → Bark Hut at Crafting 16; carry a Hide Backpack.')],
      requirements: [{ skill: 'crafting', level: 16 }],
    },
    {
      id: 'oruun-belonging', title: 'A place among the Oruun', giver: 'aven',
      offer: 'You have walked beside us through hardship. Could you finish your shelter as a Hide Tent, then bring four Forest Stews, four Bark-Baked Trout and six roast meats for a gathering of our people?',
      thanks: 'You arrived as a stranger and became someone we trust. Our fire will always have a place for you.',
      lesson: 'At Crafting 28, upgrade your Bark Hut into a Hide Tent. Forest Stew needs Cooking 8 and boiled canteen water; Bark-Baked Trout needs Cooking 4. Cook at a lit fire and bring the finished dishes.',
      deliveries: [{ item: 'stew', count: 4 }, { item: 'cedarTrout', count: 4 }, { item: 'cookedMeat', count: 6 }], reputation: 18,
      milestones: [building('hideTent', 'Upgrade your shelter to a Hide Tent', 'Lean-to → A-Frame → Bark Hut → Hide Tent at Crafting 28.')],
      requirements: [{ skill: 'crafting', level: 28 }, { skill: 'cooking', level: 8 }],
    },
  ],
};

export const QUESTLINES: readonly Questline[] = [ORUUN_QUESTLINE];
export const questlineFor = (tribe: string, biome: BiomeId) => QUESTLINES.find((q) => q.tribe === tribe && q.biome === biome);
