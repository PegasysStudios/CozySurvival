import { damp } from '../core/math';
import { TOOL_ORDER } from '../data/items';
import { SPECIES } from '../data/species';
import { Simulation } from '../sim/simulation';
import type { AnimalState } from '../sim/state';
import { WATER_LEVEL } from '../sim/terrain';
import { PROTOCOL_VERSION, randomId, roomChannel, uplinkChannel } from './config';
import { applyPose, peerAsleep } from './peers';
import { cleanAvatar, cleanName, decodeAnimal, decodePose, encodePose, type AnimalPose, type DawnMsg, type HelloMsg, type Pose, type Profile, type RefuseMsg, type RoomMeta, type TickMsg, type UpMsg, type WelcomeMsg } from './protocol';
import { ID_BLOCK, localPose, Session } from './session';
import type { NetChannel, Transport } from './transport';
import { applyState, deltaKey, stateFromSnapshot, WorldTracker } from './worldSync';

const HELLO_RETRY = 2.5;
const JOIN_TIMEOUT = 15;
const HOST_AWAY_AFTER = 2.5;
const POSE_HZ = 4;
const IDLE_POSE_EVERY = 5;

type RoomMsg = { ev: 'tick'; m: TickMsg } | { ev: 'dawn'; m: DawnMsg };

/**
 * A joining player's side. It plays its own character locally (movement, needs, pack, skills) and follows the
 * host for the world, animals and clock. Local world changes go up with the value they changed from; the
 * host's state wins once it has seen them.
 */
export class GuestSession extends Session {
  readonly role = 'guest';
  protected readonly room: NetChannel;
  private readonly uplink: NetChannel;
  private tracker: WorldTracker | null = null;
  private rev = -1;
  private welcomed = false;
  private readonly inbox: RoomMsg[] = [];
  private q = 0;
  /** World entities changed locally that the host hasn't confirmed yet (key → batch sequence). */
  private readonly pending = new Map<string, number>();
  private helloT = 0;
  private sinceTick = 0;
  private away = false;
  private poseAcc = 0;
  private idleAcc = 0;
  private lastPose: Pose | null = null;
  private hostSeen = false;
  private readonly animalTargets = new Map<number, AnimalPose>();

  constructor(transport: Transport, profile: Profile, sid: string, pid = `g-${randomId(8)}`) {
    super(transport, profile, sid, pid);
    this.room = transport.channel(roomChannel(sid), pid);
    this.uplink = transport.channel(uplinkChannel(sid, pid), pid);
    this.listenSocial(this.room);
    this.room.on('tick', (m) => this.inbox.push({ ev: 'tick', m: m as TickMsg }));
    this.room.on('dawn', (m) => this.inbox.push({ ev: 'dawn', m: m as DawnMsg }));
    this.room.on('end', () => this.end('The host closed the server.'));
    this.room.onPresence((entries) => this.onRoster(entries.map((e) => e.meta as unknown as RoomMeta)));
    this.uplink.on('welcome', (m) => this.onWelcome(m as WelcomeMsg));
    this.uplink.on('listening', () => {
      if (!this.welcomed) this.hello(false);
    });
    this.uplink.on('refuse', (m) => this.fail((m as RefuseMsg)?.reason ?? "Couldn't join the server."));
  }

  async start(): Promise<void> {
    await Promise.all([this.room.subscribe(), this.uplink.subscribe()]);
    const meta: RoomMeta = { pid: this.pid, name: this.profile.name, av: this.profile.avatar, role: 'guest', v: PROTOCOL_VERSION };
    await this.room.track(meta as unknown as Record<string, unknown>);
    this.hello(false);
  }

  get joined(): boolean {
    return this.welcomed;
  }

  private hello(resync: boolean): void {
    this.helloT = 0;
    const m: HelloMsg = { pid: this.pid, name: this.profile.name, av: this.profile.avatar, v: PROTOCOL_VERSION, resync: resync || undefined };
    this.uplink.send('hello', m);
  }

  private onRoster(metas: RoomMeta[]): void {
    const present = new Set<string>();
    let host = false;
    for (const m of metas) {
      if (!m || typeof m.pid !== 'string' || m.pid === this.pid) continue;
      present.add(m.pid);
      if (m.role === 'host') host = true;
      const known = this.peers.has(m.pid);
      const peer = this.ensurePeer(m.pid, cleanName(m.name) || 'Traveller', cleanAvatar(m.av), m.role === 'host');
      if (!known && this.welcomed && !peer.host) this.system(`${peer.name} joined.`);
    }
    for (const [pid, peer] of this.peers) {
      if (present.has(pid)) continue;
      this.peers.delete(pid);
      if (!peer.host && this.welcomed) this.system(`${peer.name} left.`);
    }
    if (host) this.hostSeen = true;
    else if (this.hostSeen) this.end('The host left, so the server closed.');
  }

  private onWelcome(w: WelcomeMsg): void {
    if (this.ended || !w || !w.snap) return;
    const resync = !!this.sim;
    const state = stateFromSnapshot(w.snap);
    const old = this.sim?.state;
    if (old) {
      // Keep this player's own character across a resync; only the world is replaced.
      for (const k of ['player', 'needs', 'inventory', 'canteen', 'tools', 'activeTool', 'toolWear', 'toolLevels', 'gear', 'skills', 'forage', 'stats', 'objective', 'dead', 'deathCause', 'lastDamage', 'repair', 'pinned', 'nextId', 'runId'] as const) {
        (state as unknown as Record<string, unknown>)[k] = old[k];
      }
      state.animals = old.animals;
    } else {
      state.nextId = w.slot * ID_BLOCK + 1;
    }
    const sim = new Simulation(state);
    sim.authority = 'guest';
    sim.timeScale = w.snap.r;
    if (this.sim) sim.sleepingIn = this.sim.sleepingIn;
    this.sim = sim;
    this.tracker = new WorldTracker(sim, false);
    this.pending.clear();
    this.rev = w.rev;
    if (!this.welcomed) {
      this.welcomed = true;
      for (const line of w.chat ?? []) this.chatLog.push(line);
    }
    this.sinceTick = 0;
    this.events.push({ type: 'ready', resync });
  }

  private fail(reason: string): void {
    if (this.welcomed || this.ended) return;
    this.events.push({ type: 'failed', reason });
    this.close();
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.events.push({ type: 'ended', reason });
    this.close();
  }

  update(dt: number): void {
    if (this.ended) return;
    this.clock += dt;
    this.updatePeers(dt);
    if (!this.welcomed) {
      this.helloT += dt;
      if (this.clock > JOIN_TIMEOUT) return this.fail("Couldn't reach the host. The server may have just closed.");
      if (this.helloT >= HELLO_RETRY) this.hello(false);
      return;
    }
    this.checkDeath();
    // Local changes go up before host state is applied, so none are overwritten unseen.
    this.sendUp(dt);
    for (const msg of this.inbox.splice(0)) {
      if (msg.ev === 'tick') this.applyTick(msg.m);
      else this.applyDawn(msg.m);
    }
    this.smoothAnimals(dt);
    this.sinceTick += dt;
    const away = this.sinceTick > HOST_AWAY_AFTER;
    if (away !== this.away) {
      this.away = away;
      this.events.push({ type: 'hostAway', away });
    }
  }

  private sendUp(dt: number): void {
    const sim = this.sim!;
    const d = this.tracker!.diff(sim, true);
    const r = sim.netOut.splice(0);
    const up: UpMsg = {};
    if (d.length) {
      this.q++;
      for (const x of d) this.pending.set(deltaKey(x), this.q);
      up.d = d;
      up.q = this.q;
    }
    if (r.length) up.r = r;
    this.poseAcc += dt;
    this.idleAcc += dt;
    const pose = localPose(sim, this.act);
    const last = this.lastPose;
    const changed = !last || last.flags !== pose.flags || last.tool !== pose.tool || last.act !== pose.act || Math.hypot(last.x - pose.x, last.y - pose.y, last.z - pose.z) > 0.3;
    const due = changed ? this.poseAcc >= 1 / POSE_HZ : this.idleAcc >= IDLE_POSE_EVERY;
    if (!due && !up.d && !up.r) return;
    this.poseAcc = 0;
    this.idleAcc = 0;
    this.lastPose = pose;
    up.p = encodePose(pose);
    this.uplink.send('up', up);
  }

  private applyTick(t: TickMsg): void {
    const sim = this.sim!;
    if (!t || typeof t.rev !== 'number' || t.rev <= this.rev) return;
    if (t.rev > this.rev + 1) this.hello(true);
    this.rev = t.rev;
    this.sinceTick = 0;
    const acked = t.ack?.[this.pid] ?? 0;
    for (const [key, q] of this.pending) if (q <= acked) this.pending.delete(key);
    for (const d of t.d ?? []) {
      if (this.pending.has(deltaKey(d))) continue;
      applyState(sim, d);
      this.tracker!.accept(d);
    }
    sim.followClock(t.h, t.r);
    sim.followSeason(t.season);
    sim.followWeather(t.weather);
    for (const row of t.p ?? []) {
      const pid = row[0];
      if (pid === this.pid || typeof pid !== 'string') continue;
      const peer = this.peers.get(pid);
      const wire = row.slice(1) as number[];
      const pose = decodePose(wire);
      if (peer && pose) applyPose(peer, pose, wire);
    }
    this.sleeping.clear();
    for (const pid of t.zz ?? []) this.sleeping.add(pid);
    for (const peer of this.peers.values()) if (peerAsleep(peer)) this.sleeping.add(peer.pid);
    this.syncAnimals(t.a ?? []);
    for (const [pid, species, tool] of t.k ?? []) if (pid === this.pid && SPECIES[species]) sim.creditKill(species, TOOL_ORDER[tool ?? -1] ?? null);
    for (const [pid, amount, source, fx, fz] of t.hit ?? []) if (pid === this.pid) sim.hurtPlayer(amount, source, fx, fz);
  }

  private applyDawn(m: DawnMsg): void {
    const sim = this.sim!;
    if (!m || typeof m.h !== 'number') return;
    if (m.forced) sim.passOut();
    sim.state.totalHours = m.h;
    sim.followSeason(m.season);
    sim.followWeather(m.weather);
    sim.wakeUp(Math.max(0, m.e || 0));
    this.sleeping.clear();
    this.events.push({ type: 'dawn', elapsed: m.e || 0 });
  }

  private syncAnimals(wires: unknown[]): void {
    const sim = this.sim!;
    const s = sim.state;
    this.animalTargets.clear();
    for (const w of wires) {
      const a = decodeAnimal(w);
      if (a) this.animalTargets.set(a.id, a);
    }
    s.animals = s.animals.filter((a) => this.animalTargets.has(a.id));
    const have = new Set(s.animals.map((a) => a.id));
    for (const t of this.animalTargets.values()) {
      if (have.has(t.id)) continue;
      s.animals.push(animalFromPose(t, SPECIES[t.species].habitat === 'water' ? WATER_LEVEL : sim.terrain.heightAt(t.x, t.z)));
    }
  }

  /** Animals glide toward the host's latest positions, dead-reckoned along their heading. */
  private smoothAnimals(dt: number): void {
    const sim = this.sim!;
    for (const a of sim.state.animals) {
      const t = this.animalTargets.get(a.id);
      if (!t) continue;
      t.x += Math.sin(t.heading) * t.speed * dt;
      t.z += Math.cos(t.heading) * t.speed * dt;
      if (Math.hypot(t.x - a.x, t.z - a.z) > 6) {
        a.x = t.x;
        a.z = t.z;
      } else {
        a.x = damp(a.x, t.x, 9, dt);
        a.z = damp(a.z, t.z, 9, dt);
      }
      let dh = t.heading - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, dt * 10);
      a.speed = t.speed;
      a.mode = t.mode;
      a.hurt = Math.max(0, Math.max(a.hurt - dt, t.hurt));
      t.hurt = 0;
      a.y = SPECIES[a.species].habitat === 'water' ? WATER_LEVEL : sim.terrain.heightAt(a.x, a.z);
    }
  }

  private close(): void {
    this.ended = true;
    this.room.close();
    this.uplink.close();
  }

  leave(): void {
    if (this.ended) return;
    this.room.send('bye', { pid: this.pid });
    this.close();
  }
}

function animalFromPose(t: AnimalPose, y: number): AnimalState {
  return {
    id: t.id, species: t.species, x: t.x, y, z: t.z, heading: t.heading, mode: t.mode, modeTime: 0, timer: 0,
    tx: t.x, tz: t.z, alertDist: 0, health: SPECIES[t.species].maxHealth, temperament: 1, homeX: t.x, homeZ: t.z,
    speed: t.speed, cooldown: 0, aggroCooldown: 0, hurt: t.hurt, lod: 0,
  };
}
