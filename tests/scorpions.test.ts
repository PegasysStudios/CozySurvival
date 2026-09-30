import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { RESOURCES } from '../src/data/resources';
import { SPECIES, type PestSpecies } from '../src/data/species';
import { burrowed, createAnimal, damageAnimal, hostile, updateAnimal } from '../src/sim/animals';
import type { SimEvent } from '../src/sim/events';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import type { AnimalState } from '../src/sim/state';
import { aimAt, animalEnv, drain, fakeTerrain, keepAlive, placeShelter, run, teleport } from './helpers';
import { Rng } from '../src/core/rng';
import { rigParts } from '../src/render/creatures';

const DEF = SPECIES.scorpion as PestSpecies;
const P = BALANCE.player;

function quietDesert(seed = 42): Simulation {
  const sim = Simulation.newGame(seed, 'desert');
  sim.state.animals.length = 0;
  sim.state.spawnCheckAt = Infinity;
  return sim;
}

/** Stone piles within `range` of spawn, nearest first. */
function stonesNear(sim: Simulation, range = 60): number[] {
  const p = sim.state.player;
  return sim.gen.resources
    .map((r, i) => ({ i, d: r.kind === 'stonePile' ? Math.hypot(r.x - p.x, r.z - p.z) : Infinity }))
    .filter((e) => e.d < range)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.i);
}

/** Stand 1.6 m from stone pile `i` and gather it once, with an empty pack and a full charge. */
function gatherStone(sim: Simulation, i: number): SimEvent[] {
  const r = sim.gen.resources[i];
  teleport(sim, r.x + 1.6, r.z);
  aimAt(sim, r.x, sim.terrain.heightAt(r.x, r.z) + 0.2, r.z);
  sim.state.inventory.slots.fill(null);
  sim.state.resources[i].charges = RESOURCES.stonePile.charges;
  keepAlive(sim);
  sim.perform({ kind: 'resource', index: i, dist: 1.6 });
  return drain(sim);
}

const scorpions = (sim: Simulation) => sim.state.animals.filter((a) => a.species === 'scorpion');
const stings = (events: SimEvent[]) => events.filter((e) => e.type === 'hurt' && e.source === 'scorpion');

/** Gather stones until one turns up a scorpion; returns it. */
function uncover(sim: Simulation): AnimalState {
  for (const i of stonesNear(sim).slice(0, 40)) {
    for (let k = 0; k < 20; k++) {
      gatherStone(sim, i);
      const s = scorpions(sim)[0];
      if (s) return s;
    }
  }
  throw new Error('no scorpion');
}

describe('scorpions under desert stones (round 9)', () => {
  it('about one stone gather in six turns up a scorpion (15-20%)', () => {
    const sim = quietDesert();
    const piles = stonesNear(sim, 120);
    expect(piles.length).toBeGreaterThan(100);
    const n = 2400;
    let found = 0;
    let told = 0;
    for (let k = 0; k < n; k++) {
      const events = gatherStone(sim, piles[k % piles.length]);
      found += scorpions(sim).length;
      told += events.filter((e) => e.type === 'scorpion').length;
      sim.state.animals.length = 0;
    }
    expect(found / n).toBeGreaterThanOrEqual(0.15);
    expect(found / n).toBeLessThanOrEqual(0.2);
    expect(told).toBe(found);
    expect(sim.state.stats.events.scorpions).toBe(found);
  });

  it('comes out on your side of the stone, rears up, then chases and stings you', () => {
    const sim = quietDesert();
    const a = uncover(sim);
    const p = sim.state.player;
    const pile = sim.gen.resources.find((r) => r.kind === 'stonePile' && Math.hypot(r.x - a.x, r.z - a.z) < 0.6)!;
    expect(pile).toBeTruthy();
    expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeLessThan(Math.hypot(pile.x - p.x, pile.z - p.z));
    expect(a.mode).toBe('alert');
    expect(hostile(a)).toBe(true);
    const first = run(sim, DEF.revealTime * 0.8);
    expect(stings(first)).toHaveLength(0);
    const events = run(sim, 4);
    expect(a.mode).toBe('chase');
    const hits = stings(events);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(Math.ceil(4 / DEF.sting.cooldown) + 1);
    expect(hits[0]).toMatchObject({ amount: DEF.sting.damage });
    expect(sim.state.lastDamage).toBe('scorpion');
    expect(events.some((e) => e.type === 'predatorAttack' && e.species === 'scorpion')).toBe(true);
  });

  it('dies to one spear or axe hit and leaves nothing to butcher; bare hands take two', () => {
    for (const tool of ['spear', 'axe', 'hands'] as const) {
      const sim = quietDesert();
      if (tool !== 'hands') sim.state.tools.push(tool);
      sim.state.activeTool = tool;
      const a = uncover(sim);
      aimAt(sim, a.x, a.y + DEF.hitHeight, a.z);
      run(sim, 0.05);
      expect(sim.target, tool).toMatchObject({ kind: 'animal', id: a.id });
      sim.perform(sim.target!);
      let events = drain(sim);
      if (tool === 'hands') {
        expect(scorpions(sim)).toHaveLength(1);
        expect(a.mode).toBe('chase');
        run(sim, 0.5);
        aimAt(sim, a.x, a.y + DEF.hitHeight, a.z);
        run(sim, 0.02);
        sim.perform({ kind: 'animal', id: a.id, dist: 1 });
        events = drain(sim);
      }
      expect(scorpions(sim), tool).toHaveLength(0);
      expect(events.some((e) => e.type === 'animalHit' && e.killed)).toBe(true);
      expect(sim.state.carcasses).toHaveLength(0);
      expect(sim.state.stats.kills.scorpion).toBe(1);
    }
  });

  it('is slower than a walk, so walking away leaves it behind; it loses interest and burrows', () => {
    const t = fakeTerrain(() => 2);
    const env = animalEnv(t);
    const a = createAnimal(1, 'scorpion', 0, 0, new Rng(3), t);
    env.playerX = 0;
    env.playerZ = 1;
    const dt = 1 / 30;
    let gap = 1;
    let time = 0;
    while (!burrowed(a) && time < 30) {
      env.playerZ += P.walkSpeed * dt;
      updateAnimal(a, env, dt);
      const d = Math.hypot(env.playerX - a.x, env.playerZ - a.z);
      if (time > DEF.revealTime + 1) expect(d).toBeGreaterThanOrEqual(gap - 0.01);
      gap = d;
      time += dt;
      expect(a.speed).toBeLessThan(P.walkSpeed);
    }
    expect(burrowed(a)).toBe(true);
    const outrun = (DEF.giveUpDist - 1) / (P.walkSpeed - DEF.runSpeed);
    expect(time).toBeLessThan(DEF.revealTime + outrun + DEF.giveUpTime + DEF.burrowTime + 1);
    expect(env.hurts.length).toBeLessThanOrEqual(1);
  });

  it('keeps after you while you stay close, but gives up eventually', () => {
    const t = fakeTerrain(() => 2);
    const env = animalEnv(t);
    const a = createAnimal(1, 'scorpion', 0, 0, new Rng(3), t);
    env.playerX = 0.5;
    const dt = 1 / 30;
    for (let time = 0; time < DEF.maxChase - 1; time += dt) updateAnimal(a, env, dt);
    expect(a.mode).toBe('chase');
    expect(env.hurts.length).toBeGreaterThan(10);
    for (let time = 0; time < 2 + DEF.burrowTime && !burrowed(a); time += dt) updateAnimal(a, env, dt);
    expect(burrowed(a)).toBe(true);
  });

  it('in the game, walking away from one makes it vanish', () => {
    const sim = quietDesert();
    const a = uncover(sim);
    const p = sim.state.player;
    aimAt(sim, 2 * p.x - a.x, p.y + P.eyeHeight, 2 * p.z - a.z);
    const events: SimEvent[] = [];
    for (let s = 0; s < 20 && sim.state.animals.includes(a); s += 0.5) {
      keepAlive(sim);
      events.push(...run(sim, 0.5, { moveZ: 1 }));
    }
    expect(scorpions(sim)).toHaveLength(0);
    expect(stings(events).length).toBeLessThanOrEqual(1);
  });

  it('a hit that does not kill keeps it angry instead of scaring it off', () => {
    const t = fakeTerrain(() => 2);
    const env = animalEnv(t);
    const a = createAnimal(1, 'scorpion', 0, 0, new Rng(3), t);
    a.health = 2;
    expect(damageAnimal(a, 0.5, env)).toBe(false);
    expect(a.mode).toBe('chase');
  });

  it('never turns up on the Pacific Northwest map', () => {
    const sim = Simulation.newGame(42, 'pnw');
    sim.state.animals.length = 0;
    const piles = stonesNear(sim, 400);
    expect(piles.length).toBeGreaterThan(10);
    for (let k = 0; k < 600; k++) {
      const events = gatherStone(sim, piles[k % piles.length]);
      expect(events.some((e) => e.type === 'scorpion')).toBe(false);
    }
    expect(scorpions(sim)).toHaveLength(0);
    expect(sim.revealScorpion(sim.state.player.x, sim.state.player.z)).toBeNull();
  });

  it(`no more than ${BALANCE.scorpion.max} are out at once`, () => {
    const sim = quietDesert();
    const p = sim.state.player;
    for (let k = 0; k < 10; k++) sim.revealScorpion(p.x + k * 0.5, p.z + 2);
    expect(scorpions(sim)).toHaveLength(BALANCE.scorpion.max);
  });

  it('blocks sleep while one is after you, and sleeping clears them away', () => {
    const sim = quietDesert();
    const shelter = placeShelter(sim, 'leanTo');
    sim.devSetHour(21);
    const p = sim.state.player;
    sim.revealScorpion(p.x + 2, p.z);
    drain(sim);
    expect(sim.trySleep(shelter.id)).toBe(false);
    expect(drain(sim).some((e) => e.type === 'sleepDenied' && /scorpion after you/.test(e.reason))).toBe(true);
    const a = scorpions(sim)[0];
    a.mode = 'retreat';
    a.timer = 10;
    expect(sim.trySleep(shelter.id)).toBe(true);
    expect(scorpions(sim)).toHaveLength(0);
  });

  it('has its own low-slung model: eight legs on the ground, pincers and a tail curled up over its back', () => {
    const parts = rigParts('scorpion');
    expect(parts).not.toBe(rigParts('fish'));
    expect(parts.legs).toHaveLength(8);
    for (const l of parts.legs) {
      l.geo.computeBoundingBox();
      expect(l.hip[1] + l.geo.boundingBox!.min.y).toBeCloseTo(0, 1);
    }
    const tail = parts.tail!;
    tail.geo.computeBoundingBox();
    expect(tail.pivot[1] + tail.geo.boundingBox!.max.y).toBeGreaterThan(0.15);
    parts.head.computeBoundingBox();
    expect(parts.headPivot[2] + parts.head.boundingBox!.max.z).toBeGreaterThan(0.25);
  });

  it('a save with a scorpion out loads, and it carries on', () => {
    const sim = quietDesert();
    const a = uncover(sim);
    run(sim, 1);
    const loaded = new Simulation(deserializeState(serializeState(sim.state))!);
    const b = loaded.state.animals.find((x) => x.id === a.id)!;
    expect(b).toMatchObject({ species: 'scorpion', mode: 'chase' });
    keepAlive(loaded);
    expect(stings(run(loaded, 3)).length).toBeGreaterThan(0);
  });
});
