import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { MAX_PLAYERS } from '../src/net/config';
import { GuestSession } from '../src/net/guest';
import { HostSession } from '../src/net/host';
import { LobbyWatcher, type ServerInfo } from '../src/net/lobby';
import type { Profile } from '../src/net/protocol';
import { ID_BLOCK, type SessionEvent } from '../src/net/session';
import { LocalTransport, MemoryHub } from '../src/net/transport';
import { IDLE_INPUT, Simulation, spawnPlayer } from '../src/sim/simulation';
import { hourOf } from '../src/sim/time';
import { countItem } from '../src/sim/inventory';
import { give, keepAlive, nearestResource, nearestTree, placeShelter, placeStructure, quietSim, teleport } from './helpers';
import type { ItemId } from '../src/data/items';
import { killKey } from '../src/data/objectives';
import { SHELTER_UPGRADES, TOOL_UPGRADES } from '../src/data/upgrades';
import type { Collider } from '../src/sim/colliders';

const DT = 1 / 20;

class World {
  readonly hub = new MemoryHub(true);
  readonly host: HostSession;
  readonly guests: GuestSession[] = [];
  readonly events = new Map<string, SessionEvent[]>();

  constructor(sim: Simulation = quietSim()) {
    this.host = new HostSession(this.transport(), sim, { name: 'Anna', avatar: 'f' }, "Anna's camp", 'camp1');
  }

  transport(): LocalTransport {
    return new LocalTransport(this.hub.bus());
  }

  async open(): Promise<this> {
    await this.host.start();
    this.hub.flush();
    return this;
  }

  async join(name: string, avatar: Profile['avatar'] = 'm', seconds = 1): Promise<GuestSession> {
    const g = new GuestSession(this.transport(), { name, avatar }, 'camp1');
    this.guests.push(g);
    await g.start();
    this.hub.flush();
    this.pump(seconds);
    return g;
  }

  /** Run every client for `seconds` of game frames, delivering messages each frame. */
  pump(seconds: number): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const all = [this.host, ...this.guests];
      for (const s of all) {
        if (s.sim) {
          if (!s.sim.state.dead) keepAliveIfWanted(s.sim);
          s.sim.step(DT, { ...IDLE_INPUT, yaw: s.sim.state.player.yaw, pitch: s.sim.state.player.pitch });
          s.sim.takeEvents([]);
        }
        s.update(DT);
        const list = this.events.get(s.pid) ?? [];
        list.push(...s.takeEvents());
        this.events.set(s.pid, list);
      }
      this.hub.flush();
    }
  }

  of(s: { pid: string }): SessionEvent[] {
    return this.events.get(s.pid) ?? [];
  }
}

const mortal = new WeakSet<Simulation>();
function keepAliveIfWanted(sim: Simulation): void {
  if (!mortal.has(sim)) keepAlive(sim);
}

function guestSim(g: GuestSession): Simulation {
  expect(g.sim).toBeTruthy();
  return g.sim!;
}

function chopDown(sim: Simulation, index: number): void {
  if (!sim.state.tools.includes('axe')) sim.state.tools.push('axe');
  sim.state.activeTool = 'axe';
  for (let k = 0; k < 20 && !sim.state.trees[index].felled; k++) sim.perform({ kind: 'tree', index, dist: 1 });
  sim.takeEvents([]);
}

describe('multiplayer: joining', () => {
  it('lists the server in the lobby, then guests join and see each other move', async () => {
    const w = await new World().open();
    const servers: ServerInfo[][] = [];
    const watcher = new LobbyWatcher(w.transport(), (list) => servers.push(list));
    await watcher.start();
    w.hub.flush();
    const listed = servers.at(-1) ?? [];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ sid: 'camp1', name: "Anna's camp", host: 'Anna', max: MAX_PLAYERS });

    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo', 'f');
    expect(ben.joined && cleo.joined).toBe(true);
    expect(w.host.playerCount).toBe(3);
    expect(w.of(ben).some((e) => e.type === 'ready')).toBe(true);
    expect(w.of(w.host).filter((e) => e.type === 'system' && /joined/.test(e.text))).toHaveLength(2);

    // Everyone lands in the same world with a fresh character at the spawn.
    const host = w.host.sim;
    expect(guestSim(ben).state.seed).toBe(host.state.seed);
    expect(guestSim(ben).state.inventory.slots.every((s) => s === null)).toBe(true);

    // Ben walks off; the host and Cleo both see it.
    const b = guestSim(ben);
    teleport(b, b.state.player.x + 12, b.state.player.z + 5);
    b.state.player.vx = 0.5;
    w.pump(1);
    const seenByHost = w.host.peers.get(ben.pid)!;
    const seenByCleo = cleo.peers.get(ben.pid)!;
    expect(Math.hypot(seenByHost.x - b.state.player.x, seenByHost.z - b.state.player.z)).toBeLessThan(0.8);
    expect(Math.hypot(seenByCleo.x - b.state.player.x, seenByCleo.z - b.state.player.z)).toBeLessThan(0.8);
    expect(cleo.peers.get(w.host.pid)?.host).toBe(true);
    expect(ben.roster().map((r) => r.name)).toEqual(['Anna', 'Ben', 'Cleo']);
    watcher.close();
  });

  it('caps a server at four players', async () => {
    const w = await new World().open();
    for (const n of ['Ben', 'Cleo', 'Dev']) await w.join(n);
    expect(w.host.playerCount).toBe(MAX_PLAYERS);
    const extra = await w.join('Eli');
    expect(extra.joined).toBe(false);
    expect(w.of(extra).find((e) => e.type === 'failed')).toMatchObject({ reason: expect.stringMatching(/full/) });
    expect(w.host.playerCount).toBe(MAX_PLAYERS);
  });
});

describe('multiplayer: late join', () => {
  it('a player joining mid-game gets the world as it is now', async () => {
    const w = await new World().open();
    const host = w.host.sim;
    const tree = nearestTree(host);
    chopDown(host, tree);
    const bush = nearestResource(host, 'berryBush');
    host.perform({ kind: 'resource', index: bush, dist: 1 });
    const fire = placeStructure(host, 'campfire');
    host.devSetHour(15);
    w.pump(0.5);

    const ben = await w.join('Ben');
    const b = guestSim(ben);
    expect(b.state.trees[tree]).toEqual(host.state.trees[tree]);
    expect(b.state.resources[bush]).toEqual(host.state.resources[bush]);
    expect(b.state.structures.map((s) => s.id)).toEqual([fire.id]);
    expect(b.state.structures[0].fuel).toBeCloseTo(host.state.structures[0].fuel, 1);
    expect(Math.abs(b.state.totalHours - host.state.totalHours)).toBeLessThan(0.05);
    // The felled tree's stump and the campfire block movement on the guest too.
    const around = b.queryColliders(host.gen.trees[tree].x, host.gen.trees[tree].z, 1, []);
    expect(around.some((c) => c.kind === 'stump')).toBe(true);
    expect(b.queryColliders(fire.x, fire.z, 1, []).some((c) => c.kind === 'structure' && c.ref === fire.id)).toBe(true);
  });
});

describe('multiplayer: shared world', () => {
  it('gathering, chopping and building by a guest reach the host and the other guests', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo');
    const host = w.host.sim;
    const b = guestSim(ben);
    const c = guestSim(cleo);

    const bush = nearestResource(b, 'berryBush');
    const before = host.state.resources[bush].charges;
    b.perform({ kind: 'resource', index: bush, dist: 1 });
    expect(countItem(b.state.inventory, 'berries')).toBeGreaterThan(0);
    w.pump(0.6);
    expect(host.state.resources[bush].charges).toBe(before - 1);
    expect(c.state.resources[bush].charges).toBe(before - 1);

    const tree = nearestTree(b);
    chopDown(b, tree);
    w.pump(0.6);
    expect(host.state.trees[tree].felled).toBe(true);
    expect(c.state.trees[tree].felled).toBe(true);
    expect(c.state.trees[tree].fall).toBeCloseTo(b.state.trees[tree].fall);

    const bench = placeStructure(b, 'bench');
    expect(bench.id).toBeGreaterThan(ID_BLOCK);
    w.pump(0.6);
    expect(host.state.structures.find((s) => s.id === bench.id)).toMatchObject({ prefab: 'bench', x: bench.x, z: bench.z });
    expect(c.state.structures.find((s) => s.id === bench.id)).toBeTruthy();
  });

  it('two players chopping the same tree at once both count', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    const tree = nearestTree(host, 'fir');
    for (const sim of [host, b]) {
      sim.state.tools.push('axe');
      sim.state.activeTool = 'axe';
    }
    const hp = host.state.trees[tree].hp;
    host.perform({ kind: 'tree', index: tree, dist: 1 });
    b.perform({ kind: 'tree', index: tree, dist: 1 });
    w.pump(0.6);
    expect(host.state.trees[tree].hp).toBe(hp - 2);
    expect(b.state.trees[tree].hp).toBe(hp - 2);
  });

  it('never takes more from a patch than it holds, even when players grab at the same moment', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    const pile = nearestResource(host, 'stonePile');
    const charges = host.state.resources[pile].charges;
    for (let k = 0; k < charges; k++) {
      host.perform({ kind: 'resource', index: pile, dist: 1 });
      b.perform({ kind: 'resource', index: pile, dist: 1 });
    }
    w.pump(0.6);
    expect(host.state.resources[pile].charges).toBe(0);
    expect(b.state.resources[pile].charges).toBe(0);
  });

  it("guests hunt the host's animals and get credit for the kill", async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    const rabbit = host.devSpawn('rabbit', 6)!;
    w.pump(0.5);
    const seen = b.state.animals.find((a) => a.id === rabbit.id);
    expect(seen).toBeTruthy();
    b.hitAnimal(seen!, 999);
    w.pump(0.6);
    expect(host.state.animals.some((a) => a.id === rabbit.id)).toBe(false);
    expect(host.state.carcasses).toHaveLength(1);
    expect(b.state.carcasses).toHaveLength(1);
    expect(b.state.stats.kills.rabbit).toBe(1);
    expect(host.state.stats.kills.rabbit).toBeUndefined();
  });
});

describe('multiplayer: chat and emotes', () => {
  it('delivers chat to everyone, escapes nothing it should not, and rate-limits spam', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo');
    expect(ben.sendChat('  hello <b>camp</b>  ')).toBe('sent');
    expect(ben.sendChat('again')).toBe('slow');
    expect(ben.sendChat('   ')).toBe('empty');
    w.hub.flush();
    w.pump(0.1);
    for (const s of [w.host, cleo, ben]) {
      expect(w.of(s).filter((e) => e.type === 'chat')).toEqual([{ type: 'chat', pid: ben.pid, name: 'Ben', text: 'hello <b>camp</b>' }]);
    }
    expect(cleo.peers.get(ben.pid)?.chat).toBe('hello <b>camp</b>');
    cleo.wave();
    w.pump(0.1);
    expect(w.of(ben).some((e) => e.type === 'emote' && e.name === 'Cleo')).toBe(true);
    expect(ben.peers.get(cleo.pid)!.waveT).toBeLessThan(0.5);
    // A late joiner gets recent chat history.
    const dev = await w.join('Dev');
    expect(dev.chatLog.map((l) => l.t)).toContain('hello <b>camp</b>');
  });
});

describe('multiplayer: sleep', () => {
  it('sleepers wait until everyone is asleep, then the night passes for all', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    host.devSetHour(21);
    w.pump(0.5);
    expect(hourOf(b.state.totalHours)).toBeCloseTo(21, 0);
    const dayBefore = host.day;
    const hostTent = placeStructure(host, 'leanTo');
    const benTent = placeStructure(b, 'leanTo');
    host.state.needs.energy = 20;
    b.state.needs.energy = 20;

    expect(host.trySleep(hostTent.id)).toBe(true);
    w.pump(1);
    expect(host.sleepingIn).toBe(hostTent.id);
    expect(host.day).toBe(dayBefore);
    expect(ben.sleeping.has(w.host.pid)).toBe(true);

    expect(b.trySleep(benTent.id)).toBe(true);
    w.pump(0.5);
    for (const sim of [host, b]) {
      expect(sim.sleepingIn).toBeNull();
      expect(sim.day).toBe(dayBefore + 1);
      expect(hourOf(sim.state.totalHours)).toBeCloseTo(BALANCE.time.dayStartHour, 1);
      expect(sim.state.needs.energy).toBeGreaterThan(90);
    }
    expect(w.of(ben).some((e) => e.type === 'dawn' && e.elapsed > 5)).toBe(true);
  });

  it('someone awake blocks the skip, and getting up leaves the vote', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    host.devSetHour(22);
    w.pump(0.5);
    const tent = placeStructure(b, 'leanTo');
    expect(b.trySleep(tent.id)).toBe(true);
    w.pump(1);
    expect(w.host.sleeping.has(ben.pid)).toBe(true);
    expect(b.sleepingIn).toBe(tent.id);
    b.getUp();
    w.pump(0.5);
    expect(w.host.sleeping.has(ben.pid)).toBe(false);
    expect(host.day).toBe(1);
  });
});

describe('multiplayer: death', () => {
  it("a dead player's pack drops as a pile others can loot, and they respawn fresh", async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo');
    const host = w.host.sim;
    const b = guestSim(ben);
    const c = guestSim(cleo);
    give(b, { stone: 3, stick: 2 });
    b.state.skills.gathering = 500;
    mortal.add(b);
    b.devDamage(1000);
    expect(b.state.dead).toBe(true);
    w.pump(0.6);
    expect(b.state.inventory.slots.every((s) => s === null)).toBe(true);
    const pile = host.state.drops.filter((d) => d.item === 'stone' || d.item === 'stick');
    expect(pile.map((d) => [d.item, d.count]).sort()).toEqual([['stick', 2], ['stone', 3]]);
    expect(c.state.drops).toHaveLength(2);
    expect(w.of(w.host).some((e) => e.type === 'system' && /Ben died/.test(e.text))).toBe(true);

    // The world keeps running for the dead player (the clock still moves).
    const t0 = b.state.totalHours;
    w.pump(0.5);
    expect(b.state.totalHours).toBeGreaterThan(t0);

    const stones = c.state.drops.find((d) => d.item === 'stone')!;
    c.perform({ kind: 'drop', id: stones.id, dist: 1 });
    expect(countItem(c.state.inventory, 'stone')).toBe(3);
    w.pump(0.6);
    expect(host.state.drops.some((d) => d.id === stones.id)).toBe(false);
    expect(b.state.drops.some((d) => d.id === stones.id)).toBe(false);

    ben.respawn();
    mortal.delete(b);
    expect(b.state.dead).toBe(false);
    expect(b.state.needs.health).toBe(100);
    expect(b.state.skills.gathering).toBe(0);
    const start = spawnPlayer(b.terrain);
    expect(Math.hypot(b.state.player.x - start.x, b.state.player.z - start.z)).toBeLessThan(0.01);
    w.pump(0.5);
    expect(w.host.roster().find((r) => r.name === 'Ben')?.dead).toBe(false);
  });
});

describe('multiplayer: leaving', () => {
  it('a guest leaving is announced; the host leaving closes the server for everyone', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo');
    ben.leave();
    w.guests.splice(w.guests.indexOf(ben), 1);
    w.pump(0.3);
    expect(w.host.playerCount).toBe(2);
    expect(w.of(w.host).some((e) => e.type === 'system' && e.text === 'Ben left.')).toBe(true);
    expect(cleo.peers.has(ben.pid)).toBe(false);

    const servers: ServerInfo[][] = [];
    const watcher = new LobbyWatcher(w.transport(), (list) => servers.push(list));
    await watcher.start();
    w.hub.flush();
    expect(servers.at(-1)).toHaveLength(1);

    w.host.leave();
    w.pump(0.2);
    expect(cleo.ended).toBe(true);
    expect(w.of(cleo).find((e) => e.type === 'ended')).toMatchObject({ reason: expect.stringMatching(/closed/) });
    expect(servers.at(-1)).toHaveLength(0);
    watcher.close();
  });
});

describe('multiplayer: round 5', () => {
  const asGive = (cost: { item: ItemId; count: number }[]) => Object.fromEntries(cost.map((i) => [i.item, i.count]));
  function roomy(sim: Simulation): void {
    for (const g of ['basket', 'backpack'] as const) if (!sim.state.gear.includes(g)) sim.state.gear.push(g);
    while (sim.state.inventory.slots.length < 16) sim.state.inventory.slots.push(null);
  }
  function bodyOf(sim: Simulation, id: number) {
    const st = sim.state.structures.find((s) => s.id === id)!;
    const out: Collider[] = [];
    sim.queryColliders(st.x, st.z, 4, out);
    return out.find((c) => c.kind === 'structure' && c.ref === id)?.body;
  }

  it("a guest's shelter upgrade reaches the host and the other guests, collider and all", async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const cleo = await w.join('Cleo');
    const host = w.host.sim;
    const b = guestSim(ben);
    const c = guestSim(cleo);
    const hut = placeShelter(b, 'leanTo');
    w.pump(0.6);
    expect(host.state.structures.find((s) => s.id === hut.id)?.prefab).toBe('leanTo');
    roomy(b);
    give(b, asGive(SHELTER_UPGRADES.aFrame!));
    expect(b.upgradeShelter(hut.id).ok).toBe(true);
    w.pump(0.6);
    for (const sim of [host, c]) {
      const st = sim.state.structures.find((s) => s.id === hut.id)!;
      expect(st.prefab).toBe('aFrame');
      expect(st.wear!.max).toBe(hut.wear!.max);
      expect(bodyOf(sim, hut.id)).toMatchObject({ type: 'box', hd: 1.0 });
    }
  });

  it("the host's shelter upgrade reaches the guests", async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    const hut = placeShelter(host, 'barkHut');
    w.pump(0.6);
    expect(b.state.structures.find((s) => s.id === hut.id)?.prefab).toBe('barkHut');
    roomy(host);
    give(host, asGive(SHELTER_UPGRADES.hideTent!));
    expect(host.upgradeShelter(hut.id).ok).toBe(true);
    w.pump(0.6);
    expect(b.state.structures.find((s) => s.id === hut.id)?.prefab).toBe('hideTent');
    expect(bodyOf(b, hut.id)).toMatchObject({ type: 'circle', r: 1.35 });
  });

  it('two players upgrading the same shelter at once settle on a single tier', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    const hut = placeShelter(host, 'leanTo');
    w.pump(0.6);
    for (const sim of [host, b]) {
      roomy(sim);
      give(sim, asGive(SHELTER_UPGRADES.aFrame!));
      expect(sim.upgradeShelter(hut.id).ok).toBe(true);
    }
    w.pump(1);
    expect(host.state.structures.find((s) => s.id === hut.id)?.prefab).toBe('aFrame');
    expect(b.state.structures.find((s) => s.id === hut.id)?.prefab).toBe('aFrame');
  });

  it('tool upgrades and the Foraging guide stay personal', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    b.state.tools.push('axe');
    give(b, asGive(TOOL_UPGRADES.axe[0].inputs));
    expect(b.upgradeTool('axe').ok).toBe(true);
    const bush = nearestResource(b, 'berryBush');
    b.perform({ kind: 'resource', index: bush, dist: 1 });
    w.pump(1);
    expect(b.state.toolLevels.axe).toBe(1);
    expect(b.state.forage).toContain('berryBush');
    expect(host.state.toolLevels).toEqual({});
    expect(host.state.forage).toEqual([]);
  });

  it('sleeping by a campfire joins the sleep vote', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    host.devSetHour(21);
    w.pump(0.5);
    const dayBefore = host.day;
    const fire = placeStructure(host, 'campfire');
    teleport(host, fire.x + 1.6, fire.z);
    const tent = placeStructure(b, 'leanTo');
    w.pump(0.6);
    host.state.needs.warmth = 70;
    expect(host.trySleep(fire.id)).toBe(true);
    w.pump(1);
    expect(host.sleepingIn).toBe(fire.id);
    expect(host.day).toBe(dayBefore);
    expect(b.trySleep(tent.id)).toBe(true);
    w.pump(0.5);
    for (const sim of [host, b]) {
      expect(sim.sleepingIn).toBeNull();
      expect(sim.day).toBe(dayBefore + 1);
    }
    expect(host.state.needs.warmth).toBeGreaterThanOrEqual(70);
  });

  it('a guest can sleep beside the host\'s campfire', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    host.devSetHour(22);
    const fire = placeStructure(host, 'campfire');
    w.pump(0.6);
    teleport(b, fire.x - 1.6, fire.z);
    expect(b.trySleep(fire.id)).toBe(true);
    w.pump(1);
    expect(w.host.sleeping.has(ben.pid)).toBe(true);
  });

  it('a guest spear kill counts toward the spear onboarding step', async () => {
    const w = await new World().open();
    const ben = await w.join('Ben');
    const host = w.host.sim;
    const b = guestSim(ben);
    b.state.objective = 7;
    b.state.stats.crafted.spear = 1;
    b.state.tools.push('spear');
    b.selectTool('spear');
    const rabbit = host.devSpawn('rabbit', 6)!;
    w.pump(0.5);
    b.hitAnimal(b.state.animals.find((a) => a.id === rabbit.id)!, 999);
    w.pump(0.6);
    expect(b.state.stats.events[killKey('spear', 'rabbit')]).toBe(1);
    expect(b.state.objective).toBe(8);
  });
});
