export type PrefabId = 'campfire' | 'leanTo' | 'hideTent' | 'bench';

export interface PrefabDef {
  id: PrefabId;
  name: string;
  /** Placement footprint (local, unrotated). */
  footprint: { type: 'circle'; r: number } | { type: 'box'; hw: number; hd: number };
  /** Movement collider (may be smaller than the footprint so you can stand close). */
  collider: { type: 'circle'; r: number } | { type: 'box'; hw: number; hd: number };
  /** Max terrain height difference across the footprint. */
  maxHeightDelta: number;
  interactRadius: number;
  interactHeight: number;
  shelter?: { warmthBonus: number; healthBonus: number };
  fire?: boolean;
  seat?: boolean;
}

export const PREFABS: Record<PrefabId, PrefabDef> = {
  campfire: {
    id: 'campfire',
    name: 'Campfire',
    footprint: { type: 'circle', r: 0.9 },
    collider: { type: 'circle', r: 0.65 },
    maxHeightDelta: 0.45,
    interactRadius: 0.9,
    interactHeight: 0.35,
    fire: true,
  },
  leanTo: {
    id: 'leanTo',
    name: 'Lean-to Shelter',
    footprint: { type: 'box', hw: 1.6, hd: 1.3 },
    collider: { type: 'box', hw: 1.5, hd: 0.5 },
    maxHeightDelta: 0.7,
    interactRadius: 1.5,
    interactHeight: 0.8,
    shelter: { warmthBonus: 35, healthBonus: 0 },
  },
  hideTent: {
    id: 'hideTent',
    name: 'Hide Tent',
    footprint: { type: 'circle', r: 1.7 },
    collider: { type: 'circle', r: 1.35 },
    maxHeightDelta: 0.6,
    interactRadius: 1.6,
    interactHeight: 1.2,
    shelter: { warmthBonus: 50, healthBonus: 10 },
  },
  bench: {
    id: 'bench',
    name: 'Log Bench',
    footprint: { type: 'box', hw: 1.1, hd: 0.4 },
    collider: { type: 'box', hw: 1.0, hd: 0.3 },
    maxHeightDelta: 0.35,
    interactRadius: 0.8,
    interactHeight: 0.4,
    seat: true,
  },
};

/** Slow rotation step for mouse wheel, large step for the R key. */
export const PLACE_ROTATE_STEP = Math.PI / 12;
export const PLACE_ROTATE_BIG_STEP = Math.PI / 4;
export const PLACE_MIN_DIST = 1.2;
export const PLACE_MAX_DIST = 7;
