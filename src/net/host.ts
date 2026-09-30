import { TOOL_ORDER } from '../data/items';
import { canSleepAt } from '../sim/time';
import type { Simulation, RemotePlayer } from '../sim/simulation';
import { MAX_PLAYERS, PROTOCOL_VERSION, randomId, roomChannel, uplinkChannel } from './config';
import { LobbyAdvert } from './lobby';
import { cleanAvatar, cleanName, decodePose, encodeAnimal, encodePose, type DawnMsg, type HelloMsg, type Profile, type RefuseMsg, type RoomMeta, type TickMsg, type UpMsg, type WelcomeMsg } from './protocol';
import { applyPose, peerDead, peerNoise } from './peers';
import { localPose, Session, TICK_HZ } from './session';
import type { NetChannel, Transport } from './transport';
import { deltaKey, mergeRemote, takeSnapshot, WorldTracker, type Delta } from './worldSync';

/** Guests only get animals within this range of some guest. */
const ANIMAL_RANGE = 130;
const MAX_HIT = 400;
/** A guest's uncovered scorpion must be within gathering reach of where the host last saw them, plus some lag. */
const SCORPION_REACH = 10;
const DELTA_KINDS = new Set(['t', 'r', 's', 'd', 'c', 's-', 'd-', 'c-']);

interface GuestLink {
  pid: string;
  slot: number;
  /** Last world-change batch applied. */
  q: number;
  uplink: NetChannel;
  welcomed: boolean;
  ai: RemotePlayer;
}

function validDelta(d: unknown): d is Delta {
  if (!d || typeof d !== 'object') return false;
  const x = d as { k?: unknown; i?: unknown; id?: unknown; v?: { id?: unknown } };
  if (typeof x.k !== 'string' || !DELTA_KINDS.has(x.k)) return false;
  if (x.k === 't' || x.k === 'r') return Number.isInteger(x.i) && !!x.v && typeof x.v === 'object';
  if (x.k.endsWith('-')) return Number.isInteger(x.id);
  return !!x.v && Number.isInteger(x.v.id);
}

/**
 * The server creator's side. Its simulation is the world: it runs animals, the clock and the sleep vote,
 * merges guests' changes into the world and sends everyone one combined update a few times a second.
 */
export class HostSession extends Session {
  readonly role = 'host';
  readonly serverName: string;
  protected readonly room: NetChannel;
  private readonly advert: LobbyAdvert;
  private readonly guests = new Map<string, GuestLink>();
  private readonly tracker: WorldTracker;
  private rev = 0;
  private tickAcc = 0;
  private nextSlot = 1;
  declare sim: Simulation;

  constructor(transport: Transport, sim: Simulation, profile: Profile, serverName: string, sid = randomId()) {
    super(transport, profile, sid, `h-${randomId(8)}`);
    this.sim = sim;
    sim.authority = 'host';
    this.serverName = serverName;
    this.tracker = new WorldTracker(sim, true);
    this.room = transport.channel(roomChannel(sid), this.pid);
    this.listenSocial(this.room);
    this.room.on('bye', (raw) => {
      const pid = (raw as { pid?: string })?.pid;
      if (typeof pid === 'string') this.dropGuest(pid);
    });
    this.room.onPresence((entries) => this.onRoster(entries.map((e) => e.meta as unknown as RoomMeta)));
    this.advert = new LobbyAdvert(transport, { sid, name: serverName, host: profile.name, n: 1, max: MAX_PLAYERS, day: sim.day, v: PROTOCOL_VERSION, map: sim.biome });
  }

  async start(): Promise<void> {
    await this.room.subscribe();
    const meta: RoomMeta = { pid: this.pid, name: this.profile.name, av: this.profile.avatar, role: 'host', v: PROTOCOL_VERSION };
    await this.room.track(meta as unknown as Record<string, unknown>);
    await this.advert.start();
    this.system(`Server "${this.serverName}" is open. Friends can join from the main menu.`);
  }

  get playerCount(): number {
    return 1 + [...this.guests.values()].filter((g) => g.welcomed).length;
  }

  private onRoster(metas: RoomMeta[]): void {
    const present = new Set<string>();
    for (const m of metas) {
      if (!m || typeof m.pid !== 'string' || m.pid === this.pid || m.role !== 'guest') continue;
      present.add(m.pid);
      this.ensurePeer(m.pid, cleanName(m.name) || 'Traveller', cleanAvatar(m.av), false);
      if (!this.guests.has(m.pid)) this.openUplink(m.pid);
    }
    for (const pid of [...this.guests.keys()]) if (!present.has(pid)) this.dropGuest(pid);
  }

  private openUplink(pid: string): void {
    const uplink = this.transport.channel(uplinkChannel(this.sid, pid), this.pid);
    const link: GuestLink = { pid, slot: 0, q: 0, uplink, welcomed: false, ai: { pid, x: 0, z: 0, noise: 0.5, dead: false, sleeping: false, deterrent: false } };
    this.guests.set(pid, link);
    uplink.on('hello', (raw) => this.onHello(link, raw as HelloMsg));
    uplink.on('up', (raw) => this.onUp(link, raw as UpMsg));
    void uplink.subscribe().then(() => uplink.send('listening', {}));
  }

  private onHello(link: GuestLink, m: HelloMsg): void {
    if (!m || m.pid !== link.pid) return;
    const refuse = (reason: string) => link.uplink.send('refuse', { reason } satisfies RefuseMsg);
    if (m.v !== PROTOCOL_VERSION) return refuse('This server runs a different version of the game.');
    if (!link.welcomed && this.playerCount >= MAX_PLAYERS) return refuse(`The server is full (${MAX_PLAYERS} players).`);
    const name = cleanName(m.name) || 'Traveller';
    const peer = this.ensurePeer(link.pid, name, cleanAvatar(m.av), false);
    if (!link.welcomed) {
      link.welcomed = true;
      link.slot = this.nextSlot++;
      this.system(`${peer.name} joined.`);
      this.advert.update({ n: this.playerCount });
    }
    const welcome: WelcomeMsg = { slot: link.slot, rev: this.rev, snap: takeSnapshot(this.sim), chat: this.chatLog.slice(-20) };
    link.uplink.send('welcome', welcome);
  }

  private onUp(link: GuestLink, m: UpMsg): void {
    if (!link.welcomed || !m) return;
    const peer = this.peers.get(link.pid);
    const pose = decodePose(m.p);
    if (peer && pose && m.p) {
      const wasDead = peerDead(peer);
      applyPose(peer, pose, m.p);
      if (!wasDead && peerDead(peer)) this.system(`${peer.name} died. Their pack lies where they fell.`);
      if (wasDead !== peerDead(peer)) this.checkSleep();
    }
    if (Array.isArray(m.d)) {
      const from = peer ? { x: peer.x, z: peer.z } : { x: 0, z: 0 };
      for (const d of m.d) {
        if (!validDelta(d)) continue;
        mergeRemote(this.sim, d, from);
        this.tracker.touch(deltaKey(d));
      }
    }
    if (Number.isInteger(m.q)) link.q = Math.max(link.q, m.q!);
    for (const r of Array.isArray(m.r) ? m.r : []) {
      if (r.k === 'hit' && Number.isFinite(r.dmg) && Number.isFinite(r.id)) {
        const tool = Number.isInteger(r.t) ? (TOOL_ORDER[r.t!] ?? null) : null;
        this.sim.applyRemoteHit(link.pid, r.id, Math.min(MAX_HIT, Math.max(0, r.dmg)), peer?.x ?? 0, peer?.z ?? 0, tool);
      } else if (r.k === 'sleep') {
        this.sleeping.add(link.pid);
        this.checkSleep();
      } else if (r.k === 'wake') {
        this.sleeping.delete(link.pid);
      } else if (r.k === 'scorpion' && peer && Number.isFinite(r.x) && Number.isFinite(r.z) && Math.hypot(r.x - peer.x, r.z - peer.z) < SCORPION_REACH) {
        this.sim.revealScorpion(r.x, r.z);
      }
    }
  }

  private dropGuest(pid: string): void {
    const link = this.guests.get(pid);
    if (!link) return;
    this.guests.delete(pid);
    link.uplink.close();
    const peer = this.peers.get(pid);
    this.peers.delete(pid);
    this.sleeping.delete(pid);
    if (link.welcomed && peer) this.system(`${peer.name} left.`);
    this.advert.update({ n: this.playerCount });
    this.checkSleep();
  }

  update(dt: number): void {
    if (this.ended) return;
    this.clock += dt;
    this.updatePeers(dt);
    this.checkDeath();
    const sim = this.sim;
    for (const r of sim.netOut.splice(0)) {
      if (r.k === 'sleep') this.sleeping.add(this.pid);
      else if (r.k === 'wake') this.sleeping.delete(this.pid);
    }
    if (sim.sleepingIn === null) this.sleeping.delete(this.pid);
    this.checkSleep();

    const ai = sim.remotePlayers;
    ai.length = 0;
    for (const link of this.guests.values()) {
      const peer = this.peers.get(link.pid);
      if (!link.welcomed || !peer || !peer.target) continue;
      Object.assign(link.ai, { x: peer.x, z: peer.z, noise: peerNoise(peer), dead: peerDead(peer), sleeping: this.sleeping.has(link.pid), deterrent: peer.tool === 'torch' });
      ai.push(link.ai);
    }

    this.tickAcc += dt;
    if (this.tickAcc >= 1 / TICK_HZ) {
      this.tickAcc = 0;
      this.sendTick();
    }
    this.advert.update({ day: sim.day });
  }

  private sendTick(): void {
    const sim = this.sim;
    const d = this.tracker.diff(sim, false);
    const kills = sim.remoteKills.splice(0);
    const hits = sim.remoteHits.splice(0);
    const welcomed = [...this.guests.values()].filter((g) => g.welcomed);
    if (!welcomed.length) return;
    this.rev++;
    const p: (string | number)[][] = [[this.pid, ...encodePose(localPose(sim, this.act))]];
    const near: { x: number; z: number }[] = [];
    const ack: Record<string, number> = {};
    for (const g of welcomed) {
      ack[g.pid] = g.q;
      const peer = this.peers.get(g.pid);
      if (peer?.wire) {
        p.push([g.pid, ...peer.wire]);
        near.push(peer);
      }
    }
    const a = sim.state.animals.filter((an) => near.some((q) => Math.abs(q.x - an.x) < ANIMAL_RANGE && Math.abs(q.z - an.z) < ANIMAL_RANGE)).map(encodeAnimal);
    const tick: TickMsg = {
      rev: this.rev,
      h: sim.state.totalHours,
      r: sim.timeScale,
      p,
      a,
      d,
      ack,
      k: kills.map((k) => [k.pid, k.species, k.tool ? TOOL_ORDER.indexOf(k.tool) : -1]),
      hit: hits.map((h) => [h.pid, h.amount, h.source, Math.round(h.fromX * 100) / 100, Math.round(h.fromZ * 100) / 100]),
      zz: [...this.sleeping],
    };
    this.room.send('tick', tick);
  }

  /** Everyone alive and in the world is asleep: skip to dawn for all. Also wakes sleepers if morning comes first. */
  private checkSleep(): void {
    if (!this.sleeping.size) return;
    const sim = this.sim;
    const eligible: string[] = [];
    if (!sim.state.dead) eligible.push(this.pid);
    for (const g of this.guests.values()) {
      const peer = this.peers.get(g.pid);
      if (g.welcomed && peer && !peerDead(peer)) eligible.push(g.pid);
    }
    const all = eligible.length > 0 && eligible.every((pid) => this.sleeping.has(pid));
    const morning = !canSleepAt(sim.hour);
    if (!all && !morning) return;
    const sleepers: { x: number; z: number }[] = [sim.state.player];
    for (const peer of this.peers.values()) sleepers.push(peer);
    const elapsed = all ? sim.skipNight(sleepers) : 0;
    this.sleeping.clear();
    const msg: DawnMsg = { h: sim.state.totalHours, e: elapsed };
    this.room.send('dawn', msg);
    sim.wakeUp(elapsed);
    this.events.push({ type: 'dawn', elapsed });
    if (all) this.system('Everyone is asleep. The night passes…');
    this.advert.update({ day: sim.day });
  }

  leave(): void {
    if (this.ended) return;
    this.ended = true;
    this.room.send('end', {});
    for (const g of this.guests.values()) g.uplink.close();
    this.guests.clear();
    this.advert.close();
    this.room.close();
    this.sim.authority = 'solo';
    this.sim.remotePlayers.length = 0;
  }
}
