import { PREFABS } from '../data/prefabs';
import type { Simulation } from '../sim/simulation';
import { CHAT_MAX, cleanName, cleanText, F_AIR, F_DEAD, F_SIT, F_SLEEP, F_SPRINT, F_SWIM, F_WADE, F_WORK, type ChatLine, type ChatMsg, type EmoteMsg, type Pose, type Profile } from './protocol';
import { newPeer, peerDead, updatePeer, type Peer } from './peers';
import type { NetChannel, Transport } from './transport';

export const TICK_HZ = 4;
/** Structures, drops and carcasses a guest creates get ids from its own block so they never collide. */
export const ID_BLOCK = 10_000_000;
export const CHAT_KEEP = 50;
const CHAT_MIN_GAP = 1;

export type SessionEvent =
  | { type: 'chat'; pid: string; name: string; text: string }
  | { type: 'system'; text: string }
  | { type: 'emote'; pid: string; name: string }
  /** Guest: the world arrived (again, after a resync) and `sim` is ready to play. */
  | { type: 'ready'; resync: boolean }
  | { type: 'failed'; reason: string }
  | { type: 'ended'; reason: string }
  | { type: 'dawn'; elapsed: number }
  | { type: 'hostAway'; away: boolean };

export interface RosterEntry {
  pid: string;
  name: string;
  host: boolean;
  me: boolean;
  asleep: boolean;
  dead: boolean;
}

export function localPose(sim: Simulation, act: number): Pose {
  const s = sim.state;
  const p = s.player;
  let flags = 0;
  if (p.sprinting) flags |= F_SPRINT;
  if (p.swimming) flags |= F_SWIM;
  if (p.sitting) flags |= F_SIT;
  if (s.dead) flags |= F_DEAD;
  if (!p.grounded && !p.swimming) flags |= F_AIR;
  if (p.wading) flags |= F_WADE;
  if (s.repair) flags |= F_WORK;
  let x = p.x;
  let y = p.y;
  let z = p.z;
  // On a bench the body faces out from the seat while the head looks around.
  let yaw = p.seat ? p.seat.yaw : p.yaw;
  if (sim.sleepingIn !== null) {
    flags |= F_SLEEP;
    const st = s.structures.find((q) => q.id === sim.sleepingIn);
    if (st && PREFABS[st.prefab].shelter) {
      x = st.x;
      y = st.y;
      z = st.z;
      yaw = st.rot;
    }
  }
  return { x, y, z, yaw, pitch: p.pitch, vx: p.vx, vz: p.vz, flags, tool: s.activeTool, act };
}

/** What host and guest sessions share: identity, the other players, chat and emotes. */
export abstract class Session {
  abstract readonly role: 'host' | 'guest';
  readonly peers = new Map<string, Peer>();
  readonly sleeping = new Set<string>();
  readonly chatLog: ChatLine[] = [];
  sim: Simulation | null = null;
  ended = false;
  protected readonly events: SessionEvent[] = [];
  protected act = 0;
  protected clock = 0;
  private lastChat = -Infinity;
  protected abstract readonly room: NetChannel;

  readonly transport: Transport;
  readonly profile: Profile;
  readonly sid: string;
  readonly pid: string;

  constructor(transport: Transport, profile: Profile, sid: string, pid: string) {
    this.transport = transport;
    this.profile = profile;
    this.sid = sid;
    this.pid = pid;
  }

  takeEvents(): SessionEvent[] {
    return this.events.splice(0);
  }

  /** The local player swung a tool (drives the swing animation others see). */
  noteSwing(): void {
    this.act = (this.act + 1) & 255;
  }

  sendChat(text: string): 'sent' | 'empty' | 'slow' {
    const t = cleanText(text, CHAT_MAX);
    if (!t) return 'empty';
    if (this.clock - this.lastChat < CHAT_MIN_GAP) return 'slow';
    this.lastChat = this.clock;
    const msg: ChatMsg = { pid: this.pid, name: this.profile.name, t };
    this.room.send('chat', msg);
    this.addChat(msg);
    return 'sent';
  }

  wave(): void {
    const msg: EmoteMsg = { pid: this.pid, k: 'wave' };
    this.room.send('emote', msg);
  }

  roster(): RosterEntry[] {
    const me: RosterEntry = {
      pid: this.pid, name: this.profile.name, host: this.role === 'host', me: true,
      asleep: this.sim?.sleepingIn != null, dead: !!this.sim?.state.dead,
    };
    const others = [...this.peers.values()].map((p) => ({ pid: p.pid, name: p.name, host: p.host, me: false, asleep: this.sleeping.has(p.pid), dead: peerDead(p) }));
    return [me, ...others].sort((a, b) => Number(b.host) - Number(a.host));
  }

  protected listenSocial(ch: NetChannel): void {
    ch.on('chat', (raw) => {
      const m = raw as ChatMsg;
      if (!m || typeof m.pid !== 'string' || m.pid === this.pid) return;
      const t = cleanText(m.t, CHAT_MAX);
      if (t) this.addChat({ pid: m.pid, name: cleanName(m.name) || 'Someone', t });
    });
    ch.on('emote', (raw) => {
      const m = raw as EmoteMsg;
      const peer = m && this.peers.get(m.pid);
      if (!peer) return;
      peer.waveT = 0;
      this.events.push({ type: 'emote', pid: peer.pid, name: peer.name });
    });
  }

  protected addChat(line: ChatLine): void {
    this.chatLog.push(line);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    const peer = this.peers.get(line.pid);
    if (peer) {
      peer.chat = line.t;
      peer.chatT = 0;
    }
    this.events.push({ type: 'chat', pid: line.pid, name: line.name, text: line.t });
  }

  protected system(text: string): void {
    this.events.push({ type: 'system', text });
  }

  protected ensurePeer(pid: string, name: string, avatar: 'm' | 'f', host: boolean): Peer {
    let p = this.peers.get(pid);
    if (!p) {
      p = newPeer(pid, name, avatar, host);
      this.peers.set(pid, p);
    } else {
      p.name = name;
      p.avatar = avatar;
      p.host = host;
    }
    return p;
  }

  protected updatePeers(dt: number): void {
    for (const p of this.peers.values()) updatePeer(p, dt);
  }

  private packDropped = false;

  /** On death the pack spills where the player fell, once. */
  protected checkDeath(): void {
    const sim = this.sim;
    if (!sim) return;
    if (sim.state.dead && !this.packDropped) {
      this.packDropped = true;
      sim.dropPack();
    } else if (!sim.state.dead) {
      this.packDropped = false;
    }
  }

  /** Back in the same world as a fresh character. */
  respawn(): void {
    const sim = this.sim;
    if (!sim || !sim.state.dead) return;
    sim.respawn();
    this.packDropped = false;
    this.system('You wake up at the old camp spot with nothing but your hands.');
  }

  abstract update(dt: number): void;
  abstract leave(): void;
}
