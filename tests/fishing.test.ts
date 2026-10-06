import { describe, expect, it } from 'vitest';
import { lerp } from '../src/core/math';
import { BALANCE } from '../src/data/balance';
import { TOOL_ORDER, TOOLS } from '../src/data/items';
import { RECIPE_BY_ID } from '../src/data/recipes';
import type { SimEvent } from '../src/sim/events';
import { countItem } from '../src/sim/inventory';
import type { Simulation } from '../src/sim/simulation';
import { catchChance, skillLevel } from '../src/sim/skills';
import { buildFresh, drain, give, keepAlive, quietSim, run, teleport } from './helpers';

const F = BALANCE.fishing;
const E = BALANCE.needs.energy;
const K = BALANCE.skills;
const MAX_XP = K.thresholds[K.thresholds.length - 1];

/** A sim at the trout-only secondary lake, facing its centre, pole in hand. */
function atTheLake(): { sim: Simulation; reach: number } {
  const sim = quietSim();
  keepAlive(sim);
  sim.state.tools.push('rod');
  expect(sim.selectTool('rod')).toBe(true);
  const lake = sim.terrain.lakes[1];
  let d = 0;
  while (sim.terrain.heightAt(lake.x + d, lake.z) < 0.3) d += 0.25;
  teleport(sim, lake.x + d, lake.z);
  sim.state.player.yaw = Math.atan2(d, 0); // looking back toward the lake centre (-x)
  sim.state.player.pitch = 0;
  drain(sim);
  return { sim, reach: d };
}

/** Hold the button for `hold` seconds, then let go. Returns the events of the whole gesture. */
function cast(sim: Simulation, hold: number): SimEvent[] {
  const ev = run(sim, 1 / 60, { primary: true, primaryPressed: true });
  ev.push(...run(sim, hold, { primary: true }));
  ev.push(...run(sim, 1 / 60, { primaryReleased: true }));
  return ev;
}

function click(sim: Simulation): SimEvent[] {
  return run(sim, 1 / 60, { primary: true, primaryPressed: true });
}

/** Run until `type` fires (or `limit` seconds pass). */
function until(sim: Simulation, type: SimEvent['type'], limit = 12): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < limit; t += 1 / 60) {
    const ev = run(sim, 1 / 60);
    all.push(...ev);
    if (ev.some((e) => e.type === type)) break;
  }
  return all;
}

describe('fishing pole', () => {
  it('is a tool on key 6, added after the others so multiplayer tool indices stay put', () => {
    expect(TOOLS.rod.slot).toBe(6);
    expect(TOOL_ORDER.slice(0, 6)).toEqual(['hands', 'axe', 'spear', 'bow', 'torch', 'rod']);
  });

  it('is available from the start and crafts from sticks, stone and cordage', () => {
    const sim = quietSim();
    expect(sim.canCraft('rod').reason).toBe('missing');
    give(sim, { stick: 10, stone: 5, cordage: 5 });
    expect(sim.craft('rod').ok).toBe(true);
    expect(sim.state.tools).toContain('rod');
    expect(sim.state.inventory.slots.every((s) => s === null)).toBe(true);
  });
});

describe('casting', () => {
  it('hold to wind up, release to cast: a longer hold throws further and every cast costs energy', () => {
    const { sim } = atTheLake();
    const p = sim.state.player;
    run(sim, 1 / 60, { primary: true, primaryPressed: true });
    run(sim, F.fullCharge * 0.3, { primary: true });
    sim.state.needs.energy = 50;
    const ev = run(sim, 1 / 60, { primaryReleased: true });
    expect(ev.some((e) => e.type === 'cast')).toBe(true);
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.castCost, 1);
    const short = Math.hypot(sim.fishing!.x - p.x, sim.fishing!.z - p.z);
    expect(short).toBeCloseTo(lerp(F.minCast, F.maxCast, sim.fishing!.power), 1);
    sim.cancelFishing();
    run(sim, 0.5);
    cast(sim, F.fullCharge * 1.5);
    expect(sim.fishing!.power).toBe(1);
    expect(Math.hypot(sim.fishing!.x - p.x, sim.fishing!.z - p.z)).toBeCloseTo(F.maxCast, 1);
    expect(short).toBeLessThan(F.maxCast - 3);
  });

  it('shows the wind-up while charging; a quick tap does not cast', () => {
    const { sim } = atTheLake();
    run(sim, 1 / 60, { primary: true, primaryPressed: true });
    run(sim, 0.3, { primary: true });
    expect(sim.fishing?.phase).toBe('charging');
    expect(sim.fishing!.power).toBeGreaterThan(0.2);
    expect(sim.describeFishing()).toMatchObject({ action: 'Release to cast' });
    run(sim, 1 / 60, { primaryReleased: true });
    sim.cancelFishing();
    sim.state.needs.energy = 50;
    const ev = cast(sim, 0);
    expect(ev.some((e) => e.type === 'cast')).toBe(false);
    expect(sim.fishing).toBeNull();
    expect(sim.state.needs.energy).toBeGreaterThanOrEqual(50);
  });

  it('a lure that lands on dry ground comes straight back with a hint', () => {
    const { sim } = atTheLake();
    sim.state.player.yaw += Math.PI; // face away from the lake
    cast(sim, F.fullCharge);
    const ev = until(sim, 'lureLanded');
    expect(ev.find((e) => e.type === 'lureLanded')).toMatchObject({ water: false });
    expect(ev.some((e) => e.type === 'message' && /dry ground/.test(e.text))).toBe(true);
    expect(sim.fishing).toBeNull();
  });

  it('cannot cast while swimming', () => {
    const { sim } = atTheLake();
    const lake = sim.terrain.lakes[1];
    teleport(sim, lake.x, lake.z);
    run(sim, 1);
    expect(sim.state.player.swimming).toBe(true);
    const ev = cast(sim, F.fullCharge);
    expect(ev.some((e) => e.type === 'cast')).toBe(false);
    expect(sim.fishing).toBeNull();
  });

  it('switching tools or walking off reels the line in', () => {
    const { sim } = atTheLake();
    cast(sim, F.fullCharge);
    until(sim, 'lureLanded');
    expect(sim.fishing?.phase).toBe('waiting');
    sim.selectTool('hands');
    expect(sim.fishing).toBeNull();
    sim.selectTool('rod');
    cast(sim, F.fullCharge);
    until(sim, 'lureLanded');
    const p = sim.state.player;
    teleport(sim, p.x + F.maxCast + F.leashSlack + 5, p.z);
    const ev = run(sim, 0.1);
    expect(ev.find((e) => e.type === 'fishDone')).toMatchObject({ result: 'reeled' });
    expect(sim.fishing).toBeNull();
  });
});

describe('bites and strikes', () => {
  function toBite(sim: Simulation): SimEvent[] {
    cast(sim, F.fullCharge * 0.6);
    const landed = until(sim, 'lureLanded');
    expect(landed.find((e) => e.type === 'lureLanded')).toMatchObject({ water: true });
    expect(sim.describeFishing()).toMatchObject({ name: 'Waiting for a bite' });
    const ev = until(sim, 'fishBite', F.biteWait[1] + 1);
    expect(ev.some((e) => e.type === 'fishBite')).toBe(true);
    expect(sim.fishing?.phase).toBe('bite');
    expect(sim.describeFishing()).toMatchObject({ name: 'A fish is biting!', action: 'Click now to strike' });
    return ev;
  }

  it('a fish bites after a short wait; miss the window and it gets away', () => {
    const { sim } = atTheLake();
    toBite(sim);
    const ev = run(sim, F.biteWindow + 0.1);
    expect(ev.find((e) => e.type === 'fishDone')).toMatchObject({ result: 'escaped' });
    expect(countItem(sim.state.inventory, 'rawFish')).toBe(0);
    expect(sim.state.skills.fishing).toBe(0);
  });

  it('clicking before a bite just reels in', () => {
    const { sim } = atTheLake();
    cast(sim, F.fullCharge * 0.6);
    until(sim, 'lureLanded');
    const ev = click(sim);
    expect(ev.find((e) => e.type === 'fishDone')).toMatchObject({ result: 'reeled' });
    expect(countItem(sim.state.inventory, 'rawFish')).toBe(0);
  });

  it('striking in time lands a trout or loses it, and both teach fishing', () => {
    const { sim } = atTheLake();
    let caught = 0;
    let slipped = 0;
    for (let k = 0; k < 12 && (caught === 0 || slipped === 0); k++) {
      toBite(sim);
      const before = sim.state.skills.fishing;
      const e0 = sim.state.needs.energy;
      const ev = click(sim);
      expect(sim.state.needs.energy).toBeCloseTo(e0 - E.hookCost, 1);
      const done = ev.find((e) => e.type === 'fishDone');
      if (done?.type !== 'fishDone') throw new Error('strike did not finish the cast');
      if (done.result === 'caught') {
        caught++;
        expect(sim.state.skills.fishing).toBeCloseTo(before + K.xp.catch);
        expect(ev.some((e) => e.type === 'gathered' && e.item === 'rawFish' && e.source === 'fishing')).toBe(true);
      } else {
        expect(done.result).toBe('slipped');
        slipped++;
        expect(sim.state.skills.fishing).toBeCloseTo(before + K.xp.slip);
      }
      keepAlive(sim);
      run(sim, 0.5);
    }
    expect(caught).toBeGreaterThan(0);
    expect(slipped).toBeGreaterThan(0);
    expect(countItem(sim.state.inventory, 'rawFish')).toBe(caught);
    expect(sim.state.stats.events.fishCaught).toBe(caught);
  });
});

describe('fishing skill', () => {
  /** Strike `n` bites straight away and count the catches. */
  function strikeRate(xp: number, n: number, rodLevel = 0): number {
    const { sim } = atTheLake();
    sim.state.gear.push('basket', 'backpack');
    if (rodLevel) sim.state.toolLevels.rod = rodLevel;
    let caught = 0;
    for (let k = 0; k < n; k++) {
      sim.state.skills.fishing = xp;
      const p = sim.state.player;
      sim.fishing = { phase: 'bite', t: 0, power: 1, fromX: p.x, fromZ: p.z, x: p.x - F.maxCast, z: p.z, biteAt: 0 };
      const ev = click(sim);
      if (ev.some((e) => e.type === 'fishDone' && e.result === 'caught')) caught++;
      sim.state.inventory.slots.fill(null);
      keepAlive(sim);
    }
    return caught / n;
  }

  it('catch chance climbs from about one in three to seven in ten with skill alone', () => {
    expect(catchChance(0)).toBeCloseTo(0.35);
    expect(catchChance(MAX_XP)).toBeCloseTo(0.7);
    for (let i = 1; i < K.thresholds.length; i++) expect(catchChance(K.thresholds[i])).toBeGreaterThan(catchChance(K.thresholds[i - 1]));
  });

  it('a beginner lands roughly one bite in three; a master with a fully upgraded pole lands nearly all', () => {
    const novice = strikeRate(0, 300);
    const master = strikeRate(MAX_XP, 300);
    const angler = strikeRate(MAX_XP, 300, 3);
    expect(novice).toBeGreaterThan(0.25);
    expect(novice).toBeLessThan(0.45);
    expect(master).toBeGreaterThan(0.6);
    expect(master).toBeLessThan(0.8);
    expect(angler).toBeGreaterThan(0.84);
    expect(angler).toBeLessThan(0.97);
  });

  it('a few dozen bites are enough to see the skill improve', () => {
    const { sim } = atTheLake();
    for (let k = 0; k < 30; k++) {
      const p = sim.state.player;
      sim.fishing = { phase: 'bite', t: 0, power: 1, fromX: p.x, fromZ: p.z, x: p.x - F.maxCast, z: p.z, biteAt: 0 };
      click(sim);
      sim.state.inventory.slots.fill(null);
      keepAlive(sim);
    }
    expect(skillLevel(sim.state.skills.fishing)).toBeGreaterThan(1);
    expect(catchChance(sim.state.skills.fishing)).toBeGreaterThan(catchChance(0));
  });
});

describe('fish recipes', () => {
  it('cook at a fire into grilled trout and three new fish meals', () => {
    const sim = quietSim();
    buildFresh(sim, 'campfire');
    sim.state.gear.push('basket', 'backpack', 'canteen');
    sim.state.skills.cooking = MAX_XP;
    give(sim, { rawFish: 4, boiledWater: 1, onion: 1, mushroom: 1, berries: 2, stick: 2 });
    for (const id of ['troutChowder', 'troutSkewer', 'smokedTrout']) {
      expect(RECIPE_BY_ID[id].station).toBe('fire');
      expect(sim.craft(id).ok).toBe(true);
    }
    expect(countItem(sim.state.inventory, 'troutChowder')).toBe(1);
    expect(countItem(sim.state.inventory, 'troutSkewer')).toBe(1);
    expect(countItem(sim.state.inventory, 'smokedTrout')).toBe(2);
    expect(countItem(sim.state.inventory, 'rawFish')).toBe(0);
  });

});
