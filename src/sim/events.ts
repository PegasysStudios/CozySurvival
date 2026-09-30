import type { ForageId } from '../data/forage';
import type { ItemId, ToolId } from '../data/items';
import type { PrefabId } from '../data/prefabs';
import type { SpeciesId } from '../data/species';
import type { ResourceKind } from '../data/resources';
import type { PlacementReason } from './placement';
import type { DamageSource, SkillId } from './state';

export type SimEvent =
  | { type: 'gathered'; item: ItemId; count: number; x: number; y: number; z: number; source: ResourceKind | 'tree' | 'drop' | 'carcass' | 'water' | 'craft' | 'bark' | 'fishing' }
  | { type: 'packFull'; item: ItemId }
  | { type: 'swing'; tool: ToolId; hit: boolean }
  | { type: 'chop'; tree: number; x: number; y: number; z: number; trunk?: boolean }
  | { type: 'treeFell'; tree: number; dirX: number; dirZ: number }
  | { type: 'needTool'; message: string }
  | { type: 'crafted'; recipe: string; burnt?: boolean }
  /** A pinned tool, piece of gear or building was made, so it came off the crafting checklist. */
  | { type: 'checklistDone'; recipe: string }
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
  /** A shelter was clicked: open its structure menu (sleep, upgrade). */
  | { type: 'openStructure'; structure: number }
  /** A tool reached upgrade `level`, or a shelter was rebuilt as its next tier. */
  | { type: 'upgraded'; tool: ToolId; level: number }
  | { type: 'upgraded'; structure: number; from: PrefabId; prefab: PrefabId }
  | { type: 'forageUnlocked'; id: ForageId }
  /** Started mending a tool at a workbench; movement is locked for `duration` seconds. */
  | { type: 'repairStarted'; tool: ToolId; duration: number }
  | { type: 'repaired'; tool: ToolId }
  | { type: 'repairCancelled'; tool: ToolId }
  /** Sat down on a bench, now facing `yaw`. */
  | { type: 'sat'; yaw: number }
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
  /** A rattlesnake coiled and rattled at the player. */
  | { type: 'rattle'; id: number; x: number; z: number }
  | { type: 'arrowFired'; power: number }
  | { type: 'arrowHit'; x: number; y: number; z: number; target: 'ground' | 'tree' | 'water' | 'animal' }
  | { type: 'cast'; power: number }
  | { type: 'lureLanded'; x: number; z: number; water: boolean }
  | { type: 'fishBite'; x: number; z: number }
  /** The line came back in: `caught` a fish, it `slipped` the hook, it `escaped` before the strike, or `reeled` in empty. */
  | { type: 'fishDone'; result: 'caught' | 'slipped' | 'escaped' | 'reeled'; x: number; z: number }
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'message'; text: string; tone?: 'info' | 'warn' | 'good' };
