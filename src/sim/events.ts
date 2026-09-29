import type { ItemId, ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import type { SpeciesId } from '../data/species';
import type { ResourceKind } from '../data/resources';
import type { PlacementReason } from './placement';
import type { DamageSource, SkillId } from './state';

export type SimEvent =
  | { type: 'gathered'; item: ItemId; count: number; x: number; y: number; z: number; source: ResourceKind | 'tree' | 'drop' | 'carcass' | 'water' | 'craft' | 'bark' }
  | { type: 'packFull'; item: ItemId }
  | { type: 'swing'; tool: ToolId; hit: boolean }
  | { type: 'chop'; tree: number; x: number; y: number; z: number; trunk?: boolean }
  | { type: 'treeFell'; tree: number; dirX: number; dirZ: number }
  | { type: 'needTool'; message: string }
  | { type: 'learned'; recipe: string }
  | { type: 'crafted'; recipe: string; burnt?: boolean }
  | { type: 'skillUp'; skill: SkillId; level: number }
  | { type: 'wornLow'; name: string }
  | { type: 'broke'; name: string; tool?: ToolId; structure?: number }
  | { type: 'splash'; impact: number }
  | { type: 'placed'; structure: number; prefab: PrefabId }
  | { type: 'placeFailed'; reason: PlacementReason }
  | { type: 'objective'; index: number }
  | { type: 'ate'; item: ItemId }
  | { type: 'drank'; byHand: boolean }
  | { type: 'filled'; count: number }
  | { type: 'fuelAdded'; structure: number; item: ItemId }
  | { type: 'openCooking'; structure: number }
  | { type: 'sat' }
  | { type: 'hurt'; amount: number; source: DamageSource; fromX: number; fromZ: number }
  | { type: 'death'; cause: DamageSource }
  | { type: 'dayStart'; day: number }
  | { type: 'nightfall'; day: number }
  | { type: 'slept'; day: number; byFire: boolean }
  | { type: 'sleepDenied'; reason: string }
  /** Multiplayer: lay down to sleep and now waits for the other players. */
  | { type: 'sleepWait'; structure: number }
  | { type: 'animalHit'; id: number; species: SpeciesId; x: number; y: number; z: number; killed: boolean }
  | { type: 'animalFlee'; id: number; species: SpeciesId }
  | { type: 'predatorAlert'; id: number; species: SpeciesId; x: number; z: number }
  | { type: 'predatorAttack'; id: number; species: SpeciesId }
  | { type: 'arrowFired'; power: number }
  | { type: 'arrowHit'; x: number; y: number; z: number; target: 'ground' | 'tree' | 'water' | 'animal' }
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'message'; text: string; tone?: 'info' | 'warn' | 'good' };
