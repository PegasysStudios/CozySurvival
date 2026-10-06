import type { ItemId } from './items';

/** Rod catches are separate from swimming wildlife: existing trout and other-map fish keep their ids. */
export type FishingCatch = 'trout' | 'bass' | 'salmon' | 'parrotfish' | 'goby';
export const FISHING_CATCHES: Record<FishingCatch, { item: ItemId; word: string }> = {
  trout: { item: 'rawFish', word: 'trout' },
  bass: { item: 'rawBass', word: 'bass' },
  salmon: { item: 'rawSalmon', word: 'salmon' },
  parrotfish: { item: 'rawFish', word: 'parrotfish' },
  goby: { item: 'rawFish', word: 'stream goby' },
};
