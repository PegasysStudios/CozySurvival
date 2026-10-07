import { describe, expect, it } from 'vitest';
import { circle, footprintSamples, overlaps } from '../src/core/geom2d';
import { ORUUN } from '../src/data/tribes';
import { ORUUN_QUESTLINE } from '../src/data/quests';
import { PREFABS } from '../src/data/prefabs';
import { footprintShape } from '../src/sim/placement';
import { activeQuest, casualTribeStory, MAX_REPUTATION_LEVEL, nextQuest, questNeeds, questPauseReason, reputationLevel, reputationProgress, reputationXpForLevel, tribeDialog } from '../src/sim/quests';
import { countItem } from '../src/sim/inventory';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { getWorldGen } from '../src/sim/worldgen';
import { getTerrain } from '../src/sim/terrain';
import { VillagerView } from '../src/render/villagers';
import { stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import { MemoryStorage, RunManager } from '../src/sim/run';
import { campfireMenu } from '../src/ui/campfire';
import { workbenchMenu } from '../src/ui/structure';
import { drain, give, giveRecipe, input, placeStructure, run } from './helpers';

function visit(sim: Simulation, member: string) {
  const npc = sim.state.settlements![0].members.find((m) => m.id === member)!;
  Object.assign(sim.state.player, { x: npc.x, z: npc.z + 2, y: sim.terrain.heightAt(npc.x, npc.z + 2), vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 });
  return npc;
}

function questSim() {
  const sim = Simulation.newGame(42);
  sim.state.totalHours = 24;
  return sim;
}

function completeFirst(sim: Simulation) {
  sim.state.totalHours = Math.max(24, sim.state.totalHours);
  visit(sim, 'aven'); sim.talkTo('oruun', 'aven'); sim.acceptQuest('oruun', 'aven'); give(sim, { stick: 12 });
  expect(sim.turnInQuest('oruun', 'aven')).toBe(true);
}

describe('Oruun placement and map isolation', () => {
  for (const seed of [1, 42, 777, 20260929, 3, 9, 17, 100, 2026, 9182]) it(`seed ${seed} places a dry camp opposite the spawn`, () => {
    const t = getTerrain(seed, 'pnw', 2), gen = getWorldGen(seed, 'pnw', 2);
    expect(gen.settlements).toHaveLength(1);
    const camp = gen.settlements![0];
    expect(Math.hypot(camp.x - t.spawn.x, camp.z - t.spawn.z)).toBeGreaterThan(t.playHalf * 1.1);
    expect(camp.x * t.spawn.x + camp.z * t.spawn.z).toBeLessThanOrEqual(0);
    expect(camp.structures.map((st) => st.prefab)).toEqual(['campfire', 'hideTent', 'hideTent', 'storageBin', 'workbench']);
    const samples: number[] = [];
    for (const st of camp.structures) {
      const shape = footprintShape(st.prefab, st.x, st.z, st.rot);
      footprintSamples(shape, samples);
      const heights = samples.filter((_, i) => i % 2 === 0).map((x, i) => t.heightAt(x, samples[i * 2 + 1]));
      expect(Math.min(...heights)).toBeGreaterThan(0.15);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(PREFABS[st.prefab].maxHeightDelta);
      expect(gen.trees.some((tr) => overlaps(shape, circle(tr.x, tr.z, tr.trunkR + 1.6)))).toBe(false);
    }
  });

  it('creates five members, keeps village property out of player progression, and is idempotent', () => {
    const sim = Simulation.newGame(42);
    expect(sim.state.settlements![0].members.map((n) => n.id)).toEqual(ORUUN.members.map((m) => m.id));
    expect(sim.state.structures).toEqual([]);
    expect(sim.state.stats.crafted).toEqual({});
    expect(sim.state.questLog).toBeUndefined();
    const next = sim.state.nextId;
    sim.initializeSettlements();
    expect(sim.state.nextId).toBe(next);
    expect(sim.structures).toHaveLength(5);
    expect(sim.canUpgradeStructure(sim.structures[1].id).reason).toBe('fixed');
  });

  it('adds the camp to activated legacy runs without changing scenery or RNG', () => {
    const sim = Simulation.newGame(42, 'pnw', 1);
    const before = { trees: structuredClone(sim.state.trees), resources: structuredClone(sim.state.resources), rng: sim.state.rng };
    sim.initializeSettlements();
    expect(sim.state.settlements).toHaveLength(1);
    expect(sim.state.trees).toEqual(before.trees);
    expect(sim.state.resources).toEqual(before.resources);
    expect(sim.state.rng).toBe(before.rng);
  });

  for (const biome of ['desert', 'island'] as const) it(`${biome} has no tribe, quest or reputation state`, () => {
    const sim = Simulation.newGame(42, biome);
    sim.initializeSettlements();
    expect(sim.state.settlements).toBeUndefined();
    expect(sim.talkTo('oruun', 'aven')).toBe(false);
    expect(nextQuest(sim.state, 'oruun')).toBeUndefined();
    expect(sim.state.questLog).toBeUndefined();
  });
});

describe('Sequential quests and reputation', () => {
  it('introduces all five people on day one and opens the first offer at the next dawn', () => {
    const sim = Simulation.newGame(42);
    for (const person of ORUUN.members) {
      visit(sim, person.id); sim.talkTo('oruun', person.id);
      const dialog = tribeDialog(sim.state, 'oruun', person.id)!;
      expect(dialog.mode).toBe('chat');
      expect(dialog.text).toBe(person.greeting);
      expect(dialog.quest).toBeUndefined();
      expect(sim.acceptQuest('oruun', person.id)).toBe(false);
    }
    expect(questPauseReason(sim.state)).toBe('firstDay');
    sim.state.totalHours = 23.99;
    expect(nextQuest(sim.state, 'oruun')).toBeUndefined();
    run(sim, 1);
    visit(sim, 'aven');
    expect(tribeDialog(sim.state, 'oruun', 'aven')!.mode).toBe('offer');
    expect(sim.acceptQuest('oruun', 'aven')).toBe(true);
  });

  it('persists the daily limit, shares only stories after handover, and reopens quests at dawn', () => {
    const sim = questSim(); completeFirst(sim);
    expect(sim.state.questLog!.lastCompletedDay).toBe(2);
    for (const person of ORUUN.members) {
      visit(sim, person.id);
      const dialog = tribeDialog(sim.state, 'oruun', person.id)!;
      expect(dialog.mode).toBe('chat');
      expect(person.stories).toContain(dialog.text);
      expect(dialog.quest).toBeUndefined();
      expect(sim.acceptQuest('oruun', person.id)).toBe(false);
    }
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(questPauseReason(loaded.state)).toBe('completedToday');
    expect(nextQuest(loaded.state, 'oruun')).toBeUndefined();
    loaded.state.totalHours = 47.99;
    expect(nextQuest(loaded.state, 'oruun')).toBeUndefined();
    run(loaded, 1);
    visit(loaded, 'sela');
    expect(loaded.acceptQuest('oruun', 'sela')).toBe(true);
  });

  it('allows a quest to span days and starts the limit on its actual handover day', () => {
    const sim = questSim();
    visit(sim, 'aven'); sim.talkTo('oruun', 'aven'); sim.acceptQuest('oruun', 'aven');
    sim.state.totalHours = 48; give(sim, { stick: 12 });
    expect(sim.turnInQuest('oruun', 'aven')).toBe(true);
    expect(sim.state.questLog!.lastCompletedDay).toBe(3);
    visit(sim, 'sela');
    expect(sim.acceptQuest('oruun', 'sela')).toBe(false);
    sim.state.totalHours = 72;
    expect(sim.acceptQuest('oruun', 'sela')).toBe(true);
  });

  it('holds a legacy day-one quest until day two without losing it or taking supplies', () => {
    const sim = questSim();
    visit(sim, 'aven'); sim.talkTo('oruun', 'aven'); sim.acceptQuest('oruun', 'aven');
    give(sim, { stick: 12 }); sim.state.totalHours = 1;
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(activeQuest(loaded.state)!.id).toBe('oruun-firewood');
    expect(loaded.turnInQuest('oruun', 'aven')).toBe(false);
    expect(countItem(loaded.state.inventory, 'stick')).toBe(12);
    loaded.state.totalHours = 24;
    expect(loaded.turnInQuest('oruun', 'aven')).toBe(true);
  });

  it('provides different brief stories without advancing simulation randomness or progression', () => {
    const sim = questSim(); completeFirst(sim);
    const log = structuredClone(sim.state.questLog), rng = sim.state.rng;
    for (const person of ORUUN.members) {
      expect(casualTribeStory(sim.state, 'oruun', person.id, 0)).not.toBe(casualTribeStory(sim.state, 'oruun', person.id, 1));
    }
    expect(sim.state.questLog).toEqual(log);
    expect(sim.state.rng).toBe(rng);
  });

  it('requires discovery, offers only through the correct giver, and permits exactly one active quest', () => {
    const sim = questSim();
    expect(sim.acceptQuest('oruun', 'aven')).toBe(false);
    visit(sim, 'lio'); sim.talkTo('oruun', 'lio');
    expect(tribeDialog(sim.state, 'oruun', 'lio')!.text).toContain('Aven');
    expect(sim.acceptQuest('oruun', 'lio')).toBe(false);
    expect(sim.state.questLog!.active).toBeUndefined(); // passing has no cost or progress
    visit(sim, 'aven');
    expect(sim.acceptQuest('oruun', 'aven')).toBe(true);
    expect(sim.acceptQuest('oruun', 'aven')).toBe(false);
    expect(activeQuest(sim.state)!.id).toBe('oruun-firewood');
    expect(sim.state.questLog!.tribes.oruun.reputation).toBe(0);
  });

  it('delivers atomically, rejects other members and remote delivery, and cannot repeat rewards', () => {
    const sim = questSim();
    visit(sim, 'aven'); sim.talkTo('oruun', 'aven'); sim.acceptQuest('oruun', 'aven');
    give(sim, { stick: 11 });
    expect(sim.turnInQuest('oruun', 'aven')).toBe(false);
    expect(countItem(sim.state.inventory, 'stick')).toBe(11);
    give(sim, { stick: 1 });
    expect(sim.turnInQuest('oruun', 'sela')).toBe(false);
    sim.state.player.x = 0; sim.state.player.z = 0;
    expect(sim.turnInQuest('oruun', 'aven')).toBe(false);
    visit(sim, 'aven');
    expect(sim.turnInQuest('oruun', 'aven')).toBe(true);
    expect(countItem(sim.state.inventory, 'stick')).toBe(0);
    expect(sim.state.questLog!.tribes.oruun).toEqual({ discovered: true, reputation: 3, completed: 1 });
    expect(sim.turnInQuest('oruun', 'aven')).toBe(false);
    expect(nextQuest(sim.state, 'oruun')).toBeUndefined();
    sim.state.totalHours = 48;
    expect(nextQuest(sim.state, 'oruun')!.id).toBe('oruun-campfire');
  });

  it('requires a real player-built campfire and credits a camp built before discovery', () => {
    const sim = questSim();
    placeStructure(sim, 'campfire');
    completeFirst(sim); sim.state.totalHours = 48;
    visit(sim, 'sela'); expect(sim.acceptQuest('oruun', 'sela')).toBe(true);
    give(sim, { log: 5 });
    expect(questNeeds(sim.state, activeQuest(sim.state)!).find((r) => r.label === 'Build your own campfire')!.have).toBe(1);
    expect(sim.turnInQuest('oruun', 'sela')).toBe(true);
    expect(sim.state.questLog!.tribes.oruun.reputation).toBe(8);
  });

  it('can complete all ten in order, keeps activity skill gates, and ends at 100 trust', () => {
    const sim = questSim();
    for (const [i, q] of ORUUN_QUESTLINE.quests.entries()) {
      sim.state.totalHours = (i + 1) * 24;
      visit(sim, q.giver); sim.talkTo('oruun', q.giver);
      expect(nextQuest(sim.state, 'oruun')!.id).toBe(q.id);
      expect(sim.acceptQuest('oruun', q.giver)).toBe(true);
      sim.state.inventory.slots.fill(null);
      give(sim, Object.fromEntries(q.deliveries.map((r) => [r.item, r.count])));
      if (q.milestones?.length) {
        expect(sim.turnInQuest('oruun', q.giver)).toBe(false);
        for (const m of q.milestones) {
          const stats = m.kind === 'crafted' ? sim.state.stats.crafted : sim.state.stats.events;
          stats[m.key] = (stats[m.key] ?? 0) + m.count;
        }
      }
      expect(sim.turnInQuest('oruun', q.giver)).toBe(true);
    }
    expect(sim.state.questLog!.tribes.oruun.completed).toBe(10);
    expect(sim.state.questLog!.tribes.oruun.reputation).toBe(100);
    expect(reputationLevel(sim.state.questLog!.tribes.oruun.reputation)).toBe(5);
    expect(nextQuest(sim.state, 'oruun')).toBeUndefined();
    expect(sim.acceptQuest('oruun', 'aven')).toBe(false);
    expect(sim.canCraft('workbench').reason).toBe('skill');
    expect(sim.state.skills.crafting).toBe(0);
    expect(tribeDialog(sim.state, 'oruun', 'aven')!.greeting).toContain('friend');
  });

  it('repairs performed before accepting do not complete the repair lesson', () => {
    const sim = questSim();
    visit(sim, 'tor'); sim.talkTo('oruun', 'tor');
    sim.state.questLog!.tribes.oruun.completed = 6;
    sim.state.stats.events.repairs = 2;
    sim.acceptQuest('oruun', 'tor');
    const q = activeQuest(sim.state)!;
    expect(questNeeds(sim.state, q).find((r) => r.label === 'Finish a tool repair')!.have).toBe(0);
    sim.state.stats.events.repairs++;
    expect(questNeeds(sim.state, q).find((r) => r.label === 'Finish a tool repair')!.have).toBe(1);
  });

  it('teaches real tool repair at the tribe bench without crediting it as a player build', () => {
    const sim = questSim();
    visit(sim, 'tor'); sim.talkTo('oruun', 'tor');
    sim.state.questLog!.tribes.oruun.completed = 6;
    sim.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(5);
    sim.acceptQuest('oruun', 'tor');
    const bench = sim.structures.find((st) => st.prefab === 'workbench')!;
    giveRecipe(sim, 'axe'); sim.craft('axe');
    sim.state.toolWear.axe!.dur /= 2;
    give(sim, { stick: 1, stone: 1, fiber: 1 });
    Object.assign(sim.state.player, { x: bench.x, z: bench.z + 1.5, y: sim.terrain.heightAt(bench.x, bench.z + 1.5) });
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    run(sim, 6);
    expect(sim.state.repair).toBeUndefined();
    const needs = questNeeds(sim.state, activeQuest(sim.state)!);
    expect(needs.find((n) => n.label === 'Finish a tool repair')!.have).toBe(1);
    expect(needs.find((n) => n.label === 'Build your own repair workbench')!.have).toBe(0);
  });
});

describe('Reputation levels and camp station access', () => {
  it('levels up on an increasing curve to level ten, with room after the current quests', () => {
    expect([0, 9, 10, 29, 30, 57, 58, 91, 92, 130, 131, 335, 336, 1000].map(reputationLevel))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 9, 10, 10]);
    expect(MAX_REPUTATION_LEVEL).toBe(10);
    expect(reputationXpForLevel(10)).toBe(336);
    expect(reputationProgress(0)).toBe(0);
    expect(reputationProgress(5)).toBe(0.5);
    expect(reputationProgress(10)).toBe(0);
    expect(reputationProgress(1000)).toBe(1);
  });

  it('blocks fire menus, fuel and crafting-menu cooking until reputation level two', () => {
    const sim = questSim(); visit(sim, 'aven'); sim.talkTo('oruun', 'aven');
    const fire = sim.structures.find((st) => st.prefab === 'campfire')!;
    Object.assign(sim.state.player, { x: fire.x, z: fire.z + 2, y: fire.y });
    giveRecipe(sim, 'cookedMeat'); give(sim, { stick: 1 }); drain(sim);
    const fuel = fire.fuel, pack = structuredClone(sim.state.inventory);
    sim.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(2) - 1;
    sim.target = { kind: 'structure', id: fire.id, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ enabled: false, action: 'Oruun Reputation Lv 2 required' });
    expect(campfireMenu(sim, fire.id)).toBeNull();
    sim.perform(sim.target!);
    expect(drain(sim).some((e) => e.type === 'openCooking')).toBe(false);
    expect(sim.addFuel(fire.id, 'stick')).toBe(false);
    expect(sim.craft('cookedMeat')).toMatchObject({ ok: false, reason: 'station' });
    expect(sim.state.inventory).toEqual(pack);
    expect(fire.fuel).toBe(fuel);
    sim.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(2);
    expect(sim.describeTarget()).toMatchObject({ enabled: true });
    expect(campfireMenu(sim, fire.id)).not.toBeNull();
    sim.perform(sim.target!);
    expect(drain(sim)).toContainEqual({ type: 'openCooking', structure: fire.id });
    expect(sim.addFuel(fire.id, 'stick')).toBe(true);
    expect(sim.craft('cookedMeat').ok).toBe(true);
  });

  it('blocks workbench menus and repair payment until reputation level five', () => {
    const sim = questSim(); visit(sim, 'aven'); sim.talkTo('oruun', 'aven');
    const bench = sim.structures.find((st) => st.prefab === 'workbench')!;
    giveRecipe(sim, 'axe'); sim.craft('axe'); sim.state.toolWear.axe!.dur /= 2;
    give(sim, { stick: 2, stone: 2, fiber: 2 }); drain(sim);
    const pack = structuredClone(sim.state.inventory);
    sim.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(5) - 1;
    sim.target = { kind: 'structure', id: bench.id, dist: 1 };
    expect(sim.describeTarget()).toMatchObject({ enabled: false, action: 'Oruun Reputation Lv 5 required' });
    expect(workbenchMenu(sim, bench.id)).toBeNull();
    sim.perform(sim.target!);
    expect(drain(sim).some((e) => e.type === 'openStructure')).toBe(false);
    expect(sim.startRepair('axe', bench.id)).toEqual({ ok: false, reason: 'reputation' });
    expect(sim.state.inventory).toEqual(pack);
    expect(sim.state.repair).toBeUndefined();
    sim.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(5);
    expect(workbenchMenu(sim, bench.id)).not.toBeNull();
    expect(sim.describeTarget()).toMatchObject({ enabled: true });
    sim.perform(sim.target!);
    expect(drain(sim)).toContainEqual({ type: 'openStructure', structure: bench.id });
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
  });

  it('keeps player-built fire and workbench use independent of tribe reputation', () => {
    const sim = questSim();
    const fire = placeStructure(sim, 'campfire'), bench = placeStructure(sim, 'workbench');
    Object.assign(sim.state.player, { x: fire.x, z: fire.z + 1.5, y: fire.y });
    giveRecipe(sim, 'cookedMeat');
    expect(sim.craft('cookedMeat').ok).toBe(true);
    expect(campfireMenu(sim, fire.id)).not.toBeNull();
    giveRecipe(sim, 'axe'); sim.craft('axe'); sim.state.toolWear.axe!.dur /= 2;
    give(sim, { stick: 2, stone: 2, fiber: 2 });
    expect(workbenchMenu(sim, bench.id)).not.toBeNull();
    expect(sim.startRepair('axe', bench.id).ok).toBe(true);
    expect(sim.state.questLog).toBeUndefined();
  });
});

describe('Village life, persistence and models', () => {
  it('moves villagers through real tasks, returns them at dusk and leaves player progression untouched', () => {
    const sim = Simulation.newGame(42);
    const camp = sim.state.settlements![0];
    const starts = camp.members.map((n) => ({ x: n.x, z: n.z }));
    const stats = structuredClone(sim.state.stats), skills = { ...sim.state.skills }, pack = structuredClone(sim.state.inventory);
    sim.state.animals = sim.state.animals.filter((a) => ['rabbit', 'squirrel'].includes(a.species));
    run(sim, 100);
    expect(camp.members.some((n, i) => Math.hypot(n.x - starts[i].x, n.z - starts[i].z) > 2)).toBe(true);
    expect(camp.members.some((n) => n.task !== 'rest')).toBe(true);
    expect(sim.state.stats).toEqual(stats);
    expect(sim.state.skills).toEqual(skills);
    expect(sim.state.inventory).toEqual(pack);
    sim.devSetHour(21);
    run(sim, 100);
    expect(camp.members.every((n) => n.task === 'rest')).toBe(true);
    expect(camp.members.every((n) => Math.hypot(n.x - camp.x, n.z - camp.z) < 5)).toBe(true);
  });

  it('targets and opens conversations with every held tool, including a rod during winter', () => {
    const sim = Simulation.newGame(42);
    const npc = visit(sim, 'aven');
    sim.devSetSeason('winter');
    for (const tool of ['hands', 'axe', 'bow', 'rod', 'knife'] as const) {
      if (!sim.state.tools.includes(tool)) sim.state.tools.push(tool);
      sim.selectTool(tool); sim.actionCooldown = 0;
      sim.step(0.02, { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, primary: true, primaryPressed: true, primaryReleased: false, sprint: false, jumpPressed: false });
      expect(sim.target?.kind).toBe('villager');
      expect(drain(sim).some((e) => e.type === 'openDialog')).toBe(true);
      expect(npc.speed).toBe(0);
    }
  });

  it('saves village property, routines, active quest, reputation and baselines without duplication', () => {
    const sim = Simulation.newGame(42);
    completeFirst(sim); sim.state.totalHours = 48; visit(sim, 'sela'); sim.acceptQuest('oruun', 'sela');
    sim.followWeather(sim.state.weather);
    const loaded = deserializeState(serializeState(sim.state))!;
    expect(loaded.questLog).toEqual(sim.state.questLog);
    expect(loaded.settlements).toEqual(sim.state.settlements);
    expect(serializeState(loaded)).toBe(serializeState(sim.state));
    const again = new Simulation(loaded);
    expect(again.structures).toHaveLength(5);
    const runManager = new RunManager(new MemoryStorage(), () => 42);
    runManager.save(sim);
    expect(runManager.loadCurrent()!.state.questLog).toEqual(sim.state.questLog);
  });

  it('hosts share the village while guest progress survives a snapshot separately', () => {
    const host = Simulation.newGame(42);
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host))); guest.authority = 'guest';
    completeFirst(guest);
    expect(host.state.questLog).toBeUndefined();
    const poses = structuredClone(guest.state.settlements);
    run(guest, 3);
    expect(guest.state.settlements).toEqual(poses);
    host.state.settlements![0].members[0].x += 1;
    guest.followSettlements(host.state.settlements);
    expect(guest.state.settlements).toEqual(host.state.settlements);
    expect(guest.state.questLog!.tribes.oruun.reputation).toBe(3);
    const version = guest.worldVersion, colliders = guest.colliders.size;
    guest.followSettlements(host.state.settlements);
    expect(guest.worldVersion).toBe(version);
    expect(guest.colliders.size).toBe(colliders);
  });

  it('synchronizes fuel donations from guests without changing the host character', () => {
    const host = Simulation.newGame(42);
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host))); guest.authority = 'guest';
    const fire = guest.structures.find((st) => st.prefab === 'campfire')!;
    Object.assign(guest.state.player, { x: fire.x, z: fire.z + 2 });
    const pack = structuredClone(host.state.inventory);
    guest.talkTo('oruun', 'aven');
    guest.state.questLog!.tribes.oruun.reputation = reputationXpForLevel(2);
    give(guest, { stick: 1 });
    expect(guest.addFuel(fire.id, 'stick')).toBe(true);
    const request = guest.netOut.find((r) => r.k === 'tribeFuel')!;
    expect(request).toEqual({ k: 'tribeFuel', tribe: 'oruun', fuel: 'stick' });
    host.receiveTribeFuel('oruun', 'stick', guest.state.player);
    guest.followSettlements(host.state.settlements);
    expect(guest.structures.find((st) => st.id === fire.id)!.fuel).toBe(fire.fuel);
    expect(countItem(guest.state.inventory, 'stick')).toBe(0);
    expect(host.state.inventory).toEqual(pack);
  });

  it('keeps family shelters and supplies inert while sharing passive warmth', () => {
    const sim = Simulation.newGame(42);
    const camp = sim.state.settlements![0], bin = camp.structures.find((st) => st.store)!;
    const tent = camp.structures.find((st) => st.prefab === 'hideTent')!;
    give(sim, { stone: 1 });
    expect(sim.storeItem(bin.id, 0)).toBe(0);
    expect(sim.takeItem(bin.id, 0)).toBe(0);
    sim.devSetHour(21);
    expect(sim.trySleep(tent.id)).toBe(false);
    drain(sim);
    for (const st of [bin, tent]) {
      sim.perform({ kind: 'structure', id: st.id, dist: 1 });
      expect(drain(sim).some((e) => e.type.startsWith('open'))).toBe(false);
      sim.target = { kind: 'structure', id: st.id, dist: 1 };
      expect(sim.describeTarget()).toBeNull();
      Object.assign(sim.state.player, { x: st.x, z: st.z + 3, y: sim.terrain.heightAt(st.x, st.z + 3) });
      sim.step(0.02, input({ resolveAim: (eye, out) => {
        out.x = st.x - eye.x; out.y = st.y + PREFABS[st.prefab].interactHeight - eye.y; out.z = st.z - eye.z;
        const length = Math.hypot(out.x, out.y, out.z);
        out.x /= length; out.y /= length; out.z /= length;
      } }, sim));
      expect(sim.target?.kind === 'structure' && sim.target.id === st.id).toBe(false);
    }
    Object.assign(sim.state.player, { x: camp.x, z: camp.z + 2 });
    expect(sim.isNearLitFire()).toBe(true);
  });

  it('builds all five distinct articulated rigs with finite geometry and disposes their resources', () => {
    const sim = Simulation.newGame(42), view = new VillagerView(), camp = sim.state.settlements![0];
    view.update(sim.state, 0.016, 5, camp.x, camp.z);
    expect(view.group.children).toHaveLength(5);
    expect(new Set(view.group.children.map((m) => m.name)).size).toBe(5);
    view.group.traverse((node) => {
      if ('geometry' in node) {
        const geometry = (node as import('three').Mesh).geometry;
        const coords = geometry.getAttribute('position');
        expect([...coords.array].every(Number.isFinite)).toBe(true);
      }
    });
    expect(view.group.children[4].scale.x).toBe(0.73);
    view.dispose(); expect(view.group.children).toHaveLength(0);
  });
});
