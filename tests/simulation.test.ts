import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BALANCE } from '../src/data/balance';
import { ITEMS } from '../src/data/items';
import { RESOURCES, TREES } from '../src/data/resources';
import { createAnimal } from '../src/sim/animals';
import { countItem } from '../src/sim/inventory';
import { lookDir } from '../src/sim/movement';
import type { Simulation } from '../src/sim/simulation';
import { buildFresh, drain, give, giveRecipe, quietSim, run, teleport } from './helpers';

function nearestResource(sim: Simulation, kind: keyof typeof RESOURCES): number {
  const p = sim.state.player;
  let best = -1;
  let bd = Infinity;
  sim.gen.resources.forEach((r, i) => {
    if (r.kind !== kind) return;
    const d = Math.hypot(r.x - p.x, r.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function nearestTree(sim: Simulation, species?: string): number {
  const p = sim.state.player;
  let best = -1;
  let bd = Infinity;
  sim.gen.trees.forEach((t, i) => {
    if (species && t.species !== species) return;
    if (sim.state.trees[i].felled) return;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function placeCampfire(sim: Simulation) {
  return buildFresh(sim, 'campfire');
}

/** Aim the camera at a world point. */
function aimAt(sim: Simulation, x: number, y: number, z: number) {
  const p = sim.state.player;
  const ex = p.x;
  const ey = p.y + BALANCE.player.eyeHeight;
  const ez = p.z;
  const dx = x - ex;
  const dy = y - ey;
  const dz = z - ez;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe('gathering by hand', () => {
  it('gathers a resource, depletes it, and it regrows later', () => {
    const sim = quietSim();
    const i = nearestResource(sim, 'stickPile');
    const def = RESOURCES.stickPile;
    for (let k = 0; k < def.charges; k++) sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'stick')).toBe(def.yield * def.charges);
    expect(sim.state.resources[i].charges).toBe(0);
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'stick')).toBe(def.yield * def.charges);
    sim.state.totalHours += def.respawnHours + 0.1;
    run(sim, 1.1);
    expect(sim.state.resources[i].charges).toBe(def.charges);
  });

  it('aiming with the crosshair targets what you look at', () => {
    const sim = quietSim();
    const i = nearestResource(sim, 'stonePile');
    const r = sim.gen.resources[i];
    const def = RESOURCES.stonePile;
    // stand 2m away and look at it
    const a = Math.atan2(sim.state.player.z - r.z, sim.state.player.x - r.x);
    teleport(sim, r.x + Math.cos(a) * 2, r.z + Math.sin(a) * 2);
    aimAt(sim, r.x, sim.terrain.heightAt(r.x, r.z) + def.hitHeight, r.z);
    const p = sim.state.player;
    run(sim, 0.05, { yaw: p.yaw, pitch: p.pitch });
    expect(sim.target?.kind).toBe('resource');
    expect(sim.describeTarget()?.action).toBe(def.verb);
    run(sim, 0.05, { yaw: p.yaw, pitch: p.pitch, primary: true, primaryPressed: true });
    expect(countItem(sim.state.inventory, 'stone')).toBe(def.yield);
  });

  it('a full pack blocks gathering without wasting the resource', () => {
    const sim = quietSim();
    const fill = ['stone', 'berries', 'onion', 'mushroom', 'bark', 'cordage'] as const;
    for (const it of fill) sim.state.inventory.slots[fill.indexOf(it)] = { item: it, count: 1 };
    const i = nearestResource(sim, 'fern');
    const events = (sim.perform({ kind: 'resource', index: i, dist: 1 }), drain(sim));
    expect(events.some((e) => e.type === 'packFull')).toBe(true);
    expect(sim.state.resources[i].charges).toBe(RESOURCES.fern.charges);
  });

  it('partial fits drop the overflow on the ground to pick up later', () => {
    const sim = quietSim();
    for (let k = 0; k < 6; k++) sim.state.inventory.slots[k] = { item: 'stone', count: 10 };
    // stick and stone piles give one per harvest, so use a fern (two fiber) to get a partial fit
    sim.state.inventory.slots[5] = { item: 'fiber', count: ITEMS.fiber.stack - 1 };
    const i = nearestResource(sim, 'fern');
    sim.perform({ kind: 'resource', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'fiber')).toBe(ITEMS.fiber.stack);
    expect(sim.state.drops).toHaveLength(1);
    expect(sim.state.drops[0]).toMatchObject({ item: 'fiber', count: 1 });
    sim.state.inventory.slots[0] = null;
    sim.perform({ kind: 'drop', id: sim.state.drops[0].id, dist: 1 });
    expect(sim.state.drops).toHaveLength(0);
  });
});

describe('trees', () => {
  it('cannot be chopped by hand; birch bark can be peeled', () => {
    const sim = quietSim();
    const fir = nearestTree(sim, 'fir');
    sim.perform({ kind: 'tree', index: fir, dist: 1 });
    expect(drain(sim).some((e) => e.type === 'needTool')).toBe(true);
    expect(sim.state.trees[fir].hp).toBe(TREES.fir.hp);
    const birch = nearestTree(sim, 'birch');
    sim.perform({ kind: 'tree', index: birch, dist: 1 });
    expect(countItem(sim.state.inventory, 'bark')).toBe(1);
  });

  it('with an axe, several swings fell the tree, then chopping up the trunk gives logs and leaves a stump', () => {
    const sim = quietSim();
    sim.state.tools.push('axe');
    sim.selectTool('axe');
    const i = nearestTree(sim, 'fir');
    const events = [];
    for (let k = 0; k < TREES.fir.hp; k++) {
      sim.perform({ kind: 'tree', index: i, dist: 1 });
      events.push(...drain(sim));
    }
    expect(events.filter((e) => e.type === 'chop')).toHaveLength(TREES.fir.hp);
    expect(events.some((e) => e.type === 'treeFell')).toBe(true);
    expect(sim.state.trees[i].felled).toBe(true);
    expect(countItem(sim.state.inventory, 'log')).toBe(0);
    expect(sim.state.trees[i].logs).toBe(TREES.fir.logs);
    for (let k = 0; k < TREES.fir.logs * BALANCE.trees.cutsPerLog; k++) sim.perform({ kind: 'tree', index: i, dist: 1 });
    expect(countItem(sim.state.inventory, 'log')).toBe(TREES.fir.logs);
    expect(countItem(sim.state.inventory, 'stick')).toBe(TREES.fir.sticks);
    expect(sim.state.trees[i].logs).toBe(0);
    const t = sim.gen.trees[i];
    teleport(sim, t.x + 3, t.z);
    const env = sim.placementEnv();
    const near: import('../src/sim/colliders').Collider[] = [];
    env.query(t.x, t.z, 1, near);
    expect(near.some((c) => c.kind === 'stump' && c.ref === i)).toBe(true);
    expect(near.some((c) => c.kind === 'tree' && c.ref === i)).toBe(false);
  });

  it('chopping costs energy', () => {
    const sim = quietSim();
    sim.state.tools.push('axe');
    sim.selectTool('axe');
    const e0 = sim.state.needs.energy;
    sim.perform({ kind: 'tree', index: nearestTree(sim), dist: 1 });
    expect(sim.state.needs.energy).toBeLessThan(e0);
  });
});

describe('task energy', () => {
  const E = BALANCE.needs.energy;

  it('chopping, gathering, crafting and building each cost their share of energy', () => {
    const sim = quietSim();
    sim.state.needs.energy = 50;
    sim.state.tools.push('axe');
    sim.selectTool('axe');
    sim.perform({ kind: 'tree', index: nearestTree(sim), dist: 1 });
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.swingCost);
    sim.state.needs.energy = 50;
    sim.perform({ kind: 'resource', index: nearestResource(sim, 'stonePile'), dist: 1 });
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.gatherCost);
    sim.state.needs.energy = 50;
    giveRecipe(sim, 'cordage');
    expect(sim.craft('cordage').ok).toBe(true);
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.craftCost);
    sim.state.needs.energy = 50;
    placeCampfire(sim);
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.buildCost);
  });

  it('every tool action costs energy: swinging the axe, spear or torch at nothing, and loosing an arrow', () => {
    const sim = quietSim();
    sim.state.tools.push('axe', 'spear', 'torch', 'bow');
    const sky = { pitch: 1.3 };
    for (const tool of ['axe', 'spear', 'torch'] as const) {
      sim.selectTool(tool);
      run(sim, 1);
      sim.state.needs.energy = 50;
      const ev = run(sim, 1 / 60, { ...sky, primary: true, primaryPressed: true });
      expect(ev.some((e) => e.type === 'swing' && e.tool === tool)).toBe(true);
      expect(sim.state.needs.energy).toBeCloseTo(50 - E.swingCost, 1);
    }
    sim.selectTool('hands');
    run(sim, 1);
    sim.state.needs.energy = 50;
    run(sim, 1 / 60, { ...sky, primary: true, primaryPressed: true });
    expect(sim.state.needs.energy).toBeGreaterThanOrEqual(50);
    sim.selectTool('bow');
    give(sim, { arrow: 2 });
    run(sim, 1);
    run(sim, 1 / 60, { ...sky, primary: true, primaryPressed: true });
    run(sim, 1, { ...sky, primary: true });
    sim.state.needs.energy = 50;
    const shot = run(sim, 1 / 60, { ...sky, primaryReleased: true });
    expect(shot.some((e) => e.type === 'arrowFired')).toBe(true);
    expect(sim.state.needs.energy).toBeCloseTo(50 - E.swingCost, 1);
  });

  it('a failed craft or placement costs nothing, and energy never goes negative', () => {
    const sim = quietSim();
    sim.state.needs.energy = 50;
    expect(sim.craft('cordage').ok).toBe(false);
    expect(sim.state.needs.energy).toBe(50);
    sim.state.needs.energy = 0.5;
    giveRecipe(sim, 'cordage');
    expect(sim.craft('cordage').ok).toBe(true);
    expect(sim.state.needs.energy).toBe(0);
  });
});

describe('water', () => {
  it('drinking by hand quenches thirst; a canteen fills to capacity', () => {
    const sim = quietSim();
    sim.state.needs.thirst = 50;
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    expect(sim.state.needs.thirst).toBeCloseTo(50 + BALANCE.needs.handDrink.thirst);
    expect(sim.state.stats.events.drankByHand).toBe(1);
    sim.state.gear.push('canteen');
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    expect(sim.state.canteen.lakeWater).toBe(BALANCE.carry.canteenCapacity);
    expect(countItem(sim.state.inventory, 'lakeWater')).toBe(0);
    expect(sim.describeTarget()).toBeNull();
    // full canteen: clicking the lake drinks instead
    sim.state.needs.thirst = 50;
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    expect(sim.state.needs.thirst).toBeGreaterThan(50);
  });

  it('a full pack does not stop the canteen filling, since water takes no pack slot', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    for (let k = 0; k < sim.state.inventory.slots.length; k++) sim.state.inventory.slots[k] = { item: 'stone', count: 10 };
    sim.target = { kind: 'water', dist: 1, x: 0, z: 0 };
    expect(sim.describeTarget()).toMatchObject({ action: 'Fill canteen', enabled: true });
    sim.perform(sim.target);
    expect(sim.state.canteen.lakeWater).toBe(BALANCE.carry.canteenCapacity);
    expect(sim.state.inventory.slots.every((s) => s?.item === 'stone')).toBe(true);
  });

  it('picking dropped water back up never overfills the canteen', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    const cap = BALANCE.carry.canteenCapacity;
    sim.perform({ kind: 'water', dist: 1, x: 0, z: 0 });
    // Water spilled by an old save or an older client lies on the ground as a drop.
    const p = sim.state.player;
    sim.state.drops.push({ id: 999, item: 'lakeWater', count: cap, x: p.x, y: p.y, z: p.z });
    const drop = sim.state.drops[0];
    sim.perform({ kind: 'drop', id: drop.id, dist: 1 });
    expect(sim.state.canteen.lakeWater).toBe(cap);
    expect(drop.count).toBe(cap);
    expect(drain(sim).some((e) => e.type === 'message' && /canteen is full/.test(e.text))).toBe(true);
    // drink one serving, then only one fits back in
    expect(sim.drinkCanteen()).toBe(true);
    sim.perform({ kind: 'drop', id: drop.id, dist: 1 });
    expect(sim.state.canteen.lakeWater).toBe(cap);
    expect(drop.count).toBe(cap - 1);
  });

  it('drinking from the canteen and boiling water at a fire', () => {
    const sim = quietSim();
    sim.state.gear.push('canteen');
    give(sim, { lakeWater: 2 });
    expect(sim.craft('boilWater').reason).toBe('station');
    placeCampfire(sim);
    expect(sim.craft('boilWater').ok).toBe(true);
    expect(sim.state.canteen).toEqual({ lakeWater: 1, boiledWater: 1 });
    sim.state.needs.thirst = 40;
    // raw water is drunk first, saving the boiled water for cooking
    expect(sim.drinkCanteen()).toBe(true);
    expect(sim.state.canteen).toEqual({ lakeWater: 0, boiledWater: 1 });
    expect(sim.state.needs.thirst).toBeCloseTo(58);
    expect(sim.drinkCanteen()).toBe(true);
    expect(sim.state.needs.thirst).toBeCloseTo(86);
    expect(sim.drinkCanteen()).toBe(false);
  });
});

describe('fire and cooking', () => {
  it('campfire warms you, burns down, and can be refueled', () => {
    const sim = quietSim();
    const fire = placeCampfire(sim);
    const p = sim.state.player;
    teleport(sim, fire.x + 1.6, fire.z);
    sim.devSetHour(23);
    expect(sim.warmthTarget().target).toBeGreaterThan(80);
    teleport(sim, fire.x + 30, fire.z);
    expect(sim.warmthTarget().target).toBeLessThan(10);
    teleport(sim, fire.x + 1.6, fire.z);
    fire.fuel = 0.01;
    sim.timeScale = 50;
    const ev = run(sim, 1);
    expect(fire.fuel).toBe(0);
    expect(ev.some((e) => e.type === 'message' && /burned out/.test(e.text))).toBe(true);
    expect(sim.isNearLitFire()).toBe(false);
    give(sim, { log: 1 });
    expect(sim.addFuel(fire.id)).toBe(true);
    expect(fire.fuel).toBe(BALANCE.fire.logFuelHours);
    expect(sim.isNearLitFire()).toBe(true);
    void p;
  });

  it('cooks a multi-ingredient meal that is better than raw food', () => {
    const sim = quietSim();
    placeCampfire(sim);
    give(sim, { mushroom: 2, onion: 1, stick: 1 });
    expect(sim.craft('skewer').ok).toBe(true);
    const ev = drain(sim);
    expect(ev.some((e) => e.type === 'crafted' && e.recipe === 'skewer')).toBe(true);
    sim.state.needs.hunger = 30;
    sim.quickConsume();
    expect(sim.state.needs.hunger).toBeCloseTo(50);
    expect(sim.state.stats.crafted.skewer).toBe(1);
  });

  it('clicking a lit campfire opens cooking; an unlit one takes fuel', () => {
    const sim = quietSim();
    const fire = placeCampfire(sim);
    sim.perform({ kind: 'structure', id: fire.id, dist: 1 });
    expect(drain(sim).some((e) => e.type === 'openCooking')).toBe(true);
    fire.fuel = 0;
    give(sim, { stick: 1 });
    sim.perform({ kind: 'structure', id: fire.id, dist: 1 });
    expect(fire.fuel).toBe(BALANCE.fire.stickFuelHours);
  });
});

describe('hunting', () => {
  it('a spear kills a hare; butchering yields meat and hide', () => {
    const sim = quietSim();
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const p = sim.state.player;
    const hare = createAnimal(500, 'rabbit', p.x + 1.5, p.z, new Rng(1), sim.terrain);
    sim.state.animals.push(hare);
    sim.perform({ kind: 'animal', id: 500, dist: 2 });
    const ev = drain(sim);
    expect(ev.some((e) => e.type === 'animalHit' && e.killed)).toBe(true);
    expect(sim.state.animals).toHaveLength(0);
    expect(sim.state.stats.kills.rabbit).toBe(1);
    const carcass = sim.state.carcasses[0];
    sim.perform({ kind: 'carcass', id: carcass.id, dist: 1 });
    expect(countItem(sim.state.inventory, 'rawMeat')).toBe(1);
    expect(countItem(sim.state.inventory, 'hide')).toBe(1);
    expect(sim.state.carcasses).toHaveLength(0);
  });

  it('melee has limited reach', () => {
    const sim = quietSim();
    const p = sim.state.player;
    const hare = createAnimal(501, 'rabbit', p.x + 3, p.z, new Rng(1), sim.terrain);
    sim.state.animals.push(hare);
    sim.perform({ kind: 'animal', id: 501, dist: 3 });
    expect(hare.health).toBe(1);
  });

  it('a fully drawn arrow flies true and hits a deer at range', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    sim.selectTool('bow');
    give(sim, { arrow: 4 });
    const p = sim.state.player;
    const d = lookDir(p.yaw, 0, { x: 0, y: 0, z: 0 });
    const deer = createAnimal(600, 'deer', p.x + d.x * 14, p.z + d.z * 14, new Rng(1), sim.terrain);
    deer.temperament = 0.2; // calm so it stands still for the shot
    sim.state.animals.push(deer);
    aimAt(sim, deer.x, deer.y + 1.0 + 0.25, deer.z);
    const aim = { yaw: p.yaw, pitch: p.pitch };
    run(sim, 1 / 60, { ...aim, primary: true, primaryPressed: true });
    run(sim, 1.0, { ...aim, primary: true });
    const ev = run(sim, 1 / 60, { ...aim, primary: false, primaryReleased: true });
    expect(ev.some((e) => e.type === 'arrowFired')).toBe(true);
    expect(countItem(sim.state.inventory, 'arrow')).toBe(3);
    const after = run(sim, 1.5, aim);
    expect(after.some((e) => e.type === 'animalHit' && e.species === 'deer')).toBe(true);
    expect(deer.health).toBeLessThan(3);
  });

  it('spearing a trout puts it straight into the pack', () => {
    const sim = quietSim();
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const lake = sim.terrain.lakes[0];
    const fish = createAnimal(700, 'fish', lake.x, lake.z, new Rng(1), sim.terrain);
    sim.state.animals.push(fish);
    sim.perform({ kind: 'animal', id: 700, dist: 2 });
    expect(countItem(sim.state.inventory, 'rawFish')).toBe(1);
    expect(sim.state.carcasses).toHaveLength(0);
  });
});

describe('sleep', () => {
  function withShelter(sim: Simulation) {
    return buildFresh(sim, 'leanTo');
  }

  it('is only allowed in the evening/night', () => {
    const sim = quietSim();
    const hut = withShelter(sim);
    sim.devSetHour(15);
    expect(sim.trySleep(hut.id)).toBe(false);
    expect(drain(sim).some((e) => e.type === 'sleepDenied')).toBe(true);
  });

  it('skips to dawn of the next day and restores energy fully', () => {
    const sim = quietSim();
    const hut = withShelter(sim);
    sim.devSetHour(22);
    sim.state.needs.energy = 12;
    const day = sim.day;
    expect(sim.trySleep(hut.id)).toBe(true);
    expect(sim.day).toBe(day + 1);
    expect(sim.hour).toBeCloseTo(6);
    expect(sim.state.needs.energy).toBe(100);
    const ev = drain(sim);
    expect(ev.some((e) => e.type === 'slept')).toBe(true);
    expect(ev.some((e) => e.type === 'dayStart')).toBe(true);
  });

  it('after midnight, sleeping still wakes you at the next dawn of the same day count', () => {
    const sim = quietSim();
    const hut = withShelter(sim);
    sim.state.totalHours = 20; // 2 AM, still day 1
    expect(sim.day).toBe(1);
    sim.trySleep(hut.id);
    expect(sim.day).toBe(2);
    expect(sim.hour).toBeCloseTo(6);
  });

  it('is refused while a predator is hunting you', () => {
    const sim = quietSim();
    const hut = withShelter(sim);
    sim.devSetHour(22);
    const wolf = sim.devSpawn('wolf', 12)!;
    wolf.mode = 'chase';
    expect(sim.trySleep(hut.id)).toBe(false);
  });

  it('shelter keeps you warmer at night', () => {
    const sim = quietSim();
    const hut = withShelter(sim);
    sim.devSetHour(23);
    teleport(sim, hut.x + 2.6, hut.z);
    const inShelter = sim.warmthTarget().target;
    teleport(sim, hut.x + 30, hut.z);
    expect(inShelter).toBeGreaterThan(sim.warmthTarget().target);
  });
});

describe('predator encounters in the simulation', () => {
  it('holding a torch keeps a wolf from biting', () => {
    const sim = quietSim();
    Object.assign(sim.state.needs, { hunger: 100, thirst: 100 });
    sim.state.tools.push('torch');
    sim.selectTool('torch');
    sim.devSpawn('wolf', 12);
    const ev = run(sim, 20);
    expect(ev.some((e) => e.type === 'predatorAlert')).toBe(true);
    expect(ev.some((e) => e.type === 'hurt')).toBe(false);
  });

  it('standing by a lit campfire keeps a bear away', () => {
    const sim = quietSim();
    const fire = placeCampfire(sim);
    teleport(sim, fire.x + 1.5, fire.z);
    Object.assign(sim.state.needs, { hunger: 100, thirst: 100 });
    sim.devSpawn('bear', 13);
    const ev = run(sim, 15);
    expect(ev.some((e) => e.type === 'hurt')).toBe(false);
  });

  it('fighting back with a spear can drive off or kill a wolf', () => {
    const sim = quietSim();
    sim.state.tools.push('spear');
    sim.selectTool('spear');
    const wolf = sim.devSpawn('wolf', 2)!;
    sim.perform({ kind: 'animal', id: wolf.id, dist: 2 });
    expect(['chase', 'retreat']).toContain(wolf.mode);
    sim.perform({ kind: 'animal', id: wolf.id, dist: 2 });
    expect(sim.state.animals.find((a) => a.id === wolf.id)).toBeUndefined();
    expect(sim.state.carcasses[0].species).toBe('wolf');
  });
});
