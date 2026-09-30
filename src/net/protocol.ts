import { TOOL_ORDER, type ToolId } from '../data/items';
import type { SpeciesId } from '../data/species';
import type { NetRequest } from '../sim/simulation';
import type { AnimalMode, AnimalState, DamageSource } from '../sim/state';
import type { Delta, WorldSnapshot } from './worldSync';

export type Avatar = 'm' | 'f';

export interface Profile {
  name: string;
  avatar: Avatar;
}

export const NAME_MAX = 16;
export const CHAT_MAX = 200;

/** Trimmed, single-line, printable, at most `max` characters (escaped again when rendered). */
export function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanName(s: unknown): string {
  return cleanText(s, NAME_MAX);
}

export function cleanAvatar(s: unknown): Avatar {
  return s === 'f' ? 'f' : 'm';
}

// ------------------------------------------------------------------ poses

export const F_SPRINT = 1;
export const F_SWIM = 2;
export const F_SIT = 4;
export const F_SLEEP = 8;
export const F_DEAD = 16;
export const F_AIR = 32;
export const F_WADE = 64;
/** Standing at a workbench mending a tool. */
export const F_WORK = 128;

/** A player's pose on the wire: positions and velocities in cm, yaw/pitch in centiradians. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  flags: number;
  tool: ToolId;
  /** Increments on every tool swing, so watchers can play the swing. */
  act: number;
}

export type PoseWire = number[];

export function encodePose(p: Pose): PoseWire {
  return [
    Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100),
    Math.round(p.yaw * 100), Math.round(p.pitch * 100),
    Math.round(p.vx * 100), Math.round(p.vz * 100),
    p.flags | 0, Math.max(0, TOOL_ORDER.indexOf(p.tool)), p.act & 255,
  ];
}

export function decodePose(w: unknown): Pose | null {
  if (!Array.isArray(w) || w.length < 10 || !w.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    x: w[0] / 100, y: w[1] / 100, z: w[2] / 100,
    yaw: w[3] / 100, pitch: w[4] / 100,
    vx: w[5] / 100, vz: w[6] / 100,
    flags: w[7] | 0, tool: TOOL_ORDER[w[8]] ?? 'hands', act: w[9] | 0,
  };
}

// ------------------------------------------------------------------ animals

const SPECIES_IDS: SpeciesId[] = [
  'rabbit', 'deer', 'fish', 'wolf', 'bear', 'jackrabbit', 'javelina', 'quail', 'roadrunner', 'lizard', 'snake', 'cougar', 'scorpion',
  'boar', 'goat', 'junglefowl', 'crab', 'viper', 'reefFish', 'jellyfish', 'shark',
];
const MODES: AnimalMode[] = ['idle', 'wander', 'alert', 'flee', 'stalk', 'chase', 'attack', 'reposition', 'warn', 'retreat'];

/** [id, species, x cm, z cm, heading crad, mode, speed cm/s, hurt ms] */
export type AnimalWire = number[];

export function encodeAnimal(a: AnimalState): AnimalWire {
  return [a.id, SPECIES_IDS.indexOf(a.species), Math.round(a.x * 100), Math.round(a.z * 100), Math.round(a.heading * 100), MODES.indexOf(a.mode), Math.round(a.speed * 100), Math.round(a.hurt * 1000)];
}

export interface AnimalPose {
  id: number;
  species: SpeciesId;
  x: number;
  z: number;
  heading: number;
  mode: AnimalMode;
  speed: number;
  hurt: number;
}

export function decodeAnimal(w: unknown): AnimalPose | null {
  if (!Array.isArray(w) || w.length < 8) return null;
  const species = SPECIES_IDS[w[1]];
  if (!species || typeof w[0] !== 'number') return null;
  return { id: w[0], species, x: w[2] / 100, z: w[3] / 100, heading: w[4] / 100, mode: MODES[w[5]] ?? 'idle', speed: w[6] / 100, hurt: w[7] / 1000 };
}

// ------------------------------------------------------------------ messages

export interface ChatLine {
  pid: string;
  name: string;
  t: string;
}

/** guest → host (uplink): ask to join, or for a fresh snapshot after a gap. */
export interface HelloMsg {
  pid: string;
  name: string;
  av: Avatar;
  v: number;
  resync?: boolean;
}

/** host → guest (uplink): the world as it is now. */
export interface WelcomeMsg {
  slot: number;
  rev: number;
  snap: WorldSnapshot;
  chat: ChatLine[];
}

/** host → guest (uplink): can't join. */
export interface RefuseMsg {
  reason: string;
}

/** guest → host (uplink): pose, local world changes (with the values they changed from), requests. */
export interface UpMsg {
  p?: PoseWire;
  d?: Delta[];
  r?: NetRequest[];
  /** Sequence number of the last world change batch in this message. */
  q?: number;
}

/** host → everyone (room), a few times a second. */
export interface TickMsg {
  rev: number;
  h: number;
  r: number;
  /** [pid, ...pose] for every player. */
  p: (string | number)[][];
  a: AnimalWire[];
  d: Delta[];
  /** Last world-change sequence applied, per guest. */
  ack: Record<string, number>;
  /** Kills credited to guests: [pid, species, index in TOOL_ORDER of the tool that made the kill, or -1]. */
  k: [string, SpeciesId, number?][];
  /** Predator hits on guests: [pid, amount, source, fromX, fromZ]. */
  hit: [string, number, DamageSource, number, number][];
  /** Players currently asleep. */
  zz: string[];
}

export interface DawnMsg {
  h: number;
  e: number;
}

export interface ChatMsg {
  pid: string;
  name: string;
  t: string;
}

export interface EmoteMsg {
  pid: string;
  k: 'wave';
}

export interface RoomMeta {
  pid: string;
  name: string;
  av: Avatar;
  role: 'host' | 'guest';
  v: number;
}
