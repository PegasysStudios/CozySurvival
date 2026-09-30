import type { ItemId } from './items';
import type { ResourceKind } from './resources';

export type ForageId = 'berryBush' | 'fern' | 'mushroom' | 'onion' | 'birch';

export interface ForageEntry {
  id: ForageId;
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
    id: 'berryBush', name: 'Salmonberry', latin: 'Rubus spectabilis', item: 'berries',
    use: 'A quick snack that takes the edge off hunger and thirst and gives a little energy. Better still in tea or on a skewer.',
    habitat: 'Shorelines, meadows and forest edges.',
    notes: 'Bushes stay put when picked clean and fruit again after a while. The first berries of the season were a feast for coastal peoples.',
  },
  {
    id: 'fern', name: 'Sword Fern', latin: 'Polystichum munitum', item: 'fiber',
    use: 'Not food. Its fronds strip into fiber, and four fiber twist into cordage, the lashing behind most tools and shelters.',
    habitat: 'Shady, damp forest floor under firs and cedars.',
    notes: 'Evergreen all year. Ferns keep growing back after you strip them, so a fern patch near camp is worth remembering.',
  },
  {
    id: 'mushroom', name: 'Pacific Golden Chanterelle', latin: 'Cantharellus formosus', item: 'mushroom',
    use: 'Filling, but it upsets your stomach raw and costs a little health. Cook it and it becomes one of the best meals in the woods.',
    habitat: 'Mossy ground in older forest, often near Douglas firs.',
    notes: 'Rare and slow to come back. Picked patches vanish and return about a day later.',
  },
  {
    id: 'onion', name: 'Nodding Onion', latin: 'Allium cernuum', item: 'onion',
    use: 'A small bite of food and water on its own; the flavour that makes skewers, stews and chowders work.',
    habitat: 'Open meadows and sunny clearings.',
    notes: 'Look for the drooping pink flower heads. Pulled patches regrow in about a day.',
  },
  {
    id: 'birch', name: 'Paper Birch', latin: 'Betula papyrifera', item: 'bark',
    use: 'Not food. Peel the papery bark by hand for canteens, torches, bark-baked trout and the bark hut.',
    habitat: 'Scattered through the forest; a few always grow near camp.',
    notes: 'Each tree gives two sheets, then shows bare wood until the bark regrows about a day later. Never needs an axe.',
  },
];

export const FORAGE_BY_ID: Record<ForageId, ForageEntry> = Object.fromEntries(FORAGE_GUIDE.map((f) => [f.id, f])) as Record<ForageId, ForageEntry>;

/** The guide entry a forage patch belongs to (sticks and stones aren't plants). */
export function forageForResource(kind: ResourceKind): ForageId | null {
  return kind === 'berryBush' || kind === 'fern' || kind === 'mushroom' || kind === 'onion' ? kind : null;
}
