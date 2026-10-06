import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { circle } from '../src/core/geom2d';
import { Rng } from '../src/core/rng';
import { SPECIES } from '../src/data/species';
import { decodeAnimal, encodeAnimal } from '../src/net/protocol';
import { AMBIENT_CAPS, PnwAmbience, advanceInsect, createInsect, insectRig, insectsSunlit, perchPosition, type Perch } from '../src/render/pnwAmbience';
import { rigParts } from '../src/render/creatures';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { animalHidden, createAnimal, damageAnimal, updateAnimal, type AnimalEnv } from '../src/sim/animals';
import { makeCollider } from '../src/sim/colliders';
import { deserializeState, serializeState } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import type { AnimalState } from '../src/sim/state';
import { animalEnv, colliderQuery, fakeTerrain, quietSim, run } from './helpers';

const land = fakeTerrain(() => 2);
const tree = { x: 4, z: 0, radius: 0.4, height: 10 };
const collider = makeCollider('tree', 0, circle(4, 0, 0.4), circle(4, 0, 0.4));
function setup() {
  const a = createAnimal(1, 'squirrel', 0, 0, new Rng(3), land);
  a.temperament = 1;
  const env = animalEnv(land, { playerX: -3, playerZ: 0, query: colliderQuery([collider]), tree: () => tree });
  return { a, env };
}
function ticks(a: AnimalState, env: AnimalEnv, seconds: number, fps = 60) {
  const modes = new Set<string>();
  for (let i = 0; i < seconds * fps; i++) { updateAnimal(a, env, 1 / fps); modes.add(a.mode); }
  return modes;
}

describe('Douglas squirrel behavior', () => {
  it('has less health than a hare, and fast, nimble movement', () => {
    expect(SPECIES.squirrel.maxHealth).toBeLessThan(SPECIES.rabbit.maxHealth);
    expect(SPECIES.squirrel.runSpeed).toBeGreaterThanOrEqual(SPECIES.rabbit.runSpeed);
    expect(SPECIES.squirrel.turnRate).toBeGreaterThan(SPECIES.rabbit.turnRate);
    const { a, env } = setup();
    expect(damageAnimal(a, 0.7, env)).toBe(true);
    const rabbit = createAnimal(2, 'rabbit', 0, 0, new Rng(3), land);
    expect(damageAnimal(rabbit, 0.7, env)).toBe(false);
  });
  it.each([15, 30, 60])('runs to a real trunk, climbs and hides at %i Hz', (fps) => {
    const { a, env } = setup();
    const modes = ticks(a, env, 9, fps);
    expect(modes.has('flee')).toBe(true);
    expect(modes.has('climb')).toBe(true);
    expect(a.mode).toBe('hide');
    expect(a.tree).toBe(0);
    expect(a.y).toBeGreaterThan(7);
    expect(Math.hypot(a.x - tree.x, a.z - tree.z)).toBeCloseTo(tree.radius + 0.04, 5);
    expect(a.speed).toBe(0);
  });
  it('holds its refuge while threatened, then descends when it is safe', () => {
    const { a, env } = setup();
    ticks(a, env, 30);
    expect(a.mode).toBe('hide');
    env.playerX = 80;
    const modes = ticks(a, env, 15);
    expect(modes.has('descend')).toBe(true);
    expect(a.y).toBe(2);
    expect(a.tree).toBeUndefined();
    expect(animalHidden(a)).toBe(false);
  });
  it('uses tree shelter at night, stays active through winter, and comes out by day', () => {
    const { a, env } = setup();
    env.playerDead = true; env.night = true;
    ticks(a, env, 45);
    expect(a.mode).toBe('hide');
    env.night = false;
    ticks(a, env, 15);
    expect(a.tree).toBeUndefined();
    expect(a.y).toBe(2);
  });
  it('flees normally when no suitable tree exists', () => {
    const { a, env } = setup();
    env.tree = () => null;
    ticks(a, env, 6);
    expect(a.y).toBe(2);
    expect(a.tree).toBeUndefined();
    expect(Math.hypot(a.x - env.playerX, a.z - env.playerZ)).toBeGreaterThan(17);
  });
  it('rejects a refuge that would run through the approaching player', () => {
    const { a, env } = setup();
    env.playerX = 2;
    ticks(a, env, 1);
    expect(a.tree).toBeUndefined();
    expect(a.x).toBeLessThan(0);
  });
  it('abandons an obstructed trunk and uses a different tree', () => {
    const { a, env } = setup();
    const second = { x: 0, z: 5, radius: 0.4, height: 10 };
    const c2 = makeCollider('tree', 1, circle(0, 5, 0.4), circle(0, 5, 0.4));
    const rock = makeCollider('rock', 0, circle(4, 0, 1.8), circle(4, 0, 1.8));
    env.night = true; env.playerDead = true;
    env.tree = (ref) => ref === 0 ? tree : second;
    env.query = colliderQuery([collider, c2, rock]);
    ticks(a, env, 22);
    expect(a.failedTree).toBe(0);
    expect(a.tree).toBe(1);
    expect(a.mode).toBe('hide');
  });
  it('cannot remain hidden in a felled tree', () => {
    const { a, env } = setup();
    ticks(a, env, 9);
    env.tree = () => null;
    const modes = ticks(a, env, 2);
    expect(modes.has('descend')).toBe(true);
    expect(animalHidden(a)).toBe(false);
    expect(a.tree).toBeUndefined();
    expect(a.y).toBe(2);
  });
  it('can be hit while climbing, while hidden animals cannot take hits', () => {
    const { a, env } = setup();
    a.tree = 0; a.mode = 'climb'; a.y = 4; a.climbHeight = 6;
    expect(damageAnimal(a, 0.1, env)).toBe(false);
    expect(a.mode).toBe('climb');
    expect(a.health).toBeCloseTo(0.5);
    a.mode = 'hide';
    expect(damageAnimal(a, 10, env)).toBe(false);
    expect(a.health).toBeCloseTo(0.5);
  });
  it('saves a refuge without moving existing world state and resumes it after loading', () => {
    const sim = Simulation.newGame(42);
    const a = sim.state.animals.find((o) => o.species === 'squirrel')!;
    const ref = sim.gen.trees.findIndex((tr) => Math.hypot(tr.x - a.x, tr.z - a.z) < 20);
    const tr = sim.gen.trees[ref];
    a.tree = ref; a.mode = 'hide'; a.climbHeight = 6; a.x = tr.x + tr.trunkR + 0.04; a.z = tr.z;
    a.y = sim.terrain.heightAt(tr.x, tr.z) + 6;
    const restored = new Simulation(deserializeState(serializeState(sim.state))!);
    expect(restored.state.animals.find((o) => o.id === a.id)).toEqual(a);
    expect(restored.state.trees).toEqual(sim.state.trees);
    expect(restored.state.resources).toEqual(sim.state.resources);
    run(restored, 0.2);
    expect(restored.state.animals.find((o) => o.id === a.id)?.mode).toBe('hide');
  });
  it.each([1, 42, 777, 20260929])('populates expanded PNW forest only, deterministically for seed %i', (seed) => {
    const sim = Simulation.newGame(seed);
    const squirrels = sim.state.animals.filter((a) => a.species === 'squirrel');
    expect(squirrels).toHaveLength(128);
    for (const a of squirrels) {
      expect(sim.gen.trees.some((tr) => Math.hypot(tr.x - a.x, tr.z - a.z) < tr.trunkR + 3.6)).toBe(true);
      expect(a.y).toBeGreaterThan(0.15);
    }
    expect(Simulation.newGame(seed).state.animals).toEqual(sim.state.animals);
    for (const biome of ['desert', 'island'] as const) expect(Simulation.newGame(seed, biome).state.animals.some((a) => a.species === 'squirrel')).toBe(false);
    const legacy = Simulation.newGame(seed, 'pnw', 1);
    legacy.maintainPopulation();
    expect(legacy.state.animals.some((a) => a.species === 'squirrel')).toBe(false);
  });
  it('replenishes squirrels without changing other species targets', () => {
    const sim = Simulation.newGame(42);
    sim.state.animals = sim.state.animals.filter((a) => a.species !== 'squirrel');
    sim.maintainPopulation();
    expect(sim.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(1);
    expect(sim.state.animals.filter((a) => a.species === 'rabbit')).toHaveLength(18);
    sim.devSetSeason('winter');
    expect(sim.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(1);
  });
  it.each(['climb', 'hide', 'descend'] as const)('sends %s and elevation to guests without changing other animals wire format', (mode) => {
    const { a } = setup();
    a.mode = mode; a.y = 8.43;
    const pose = decodeAnimal(encodeAnimal(a))!;
    expect(pose.species).toBe('squirrel'); expect(pose.mode).toBe(mode); expect(pose.y).toBe(8.43);
    const rabbit = createAnimal(2, 'rabbit', 0, 0, new Rng(3), land);
    expect(encodeAnimal(rabbit)).toHaveLength(8);
    expect(decodeAnimal(encodeAnimal(rabbit))?.y).toBeUndefined();
  });
  it('hunting produces a reachable ground carcass with meat and hide', () => {
    const sim = quietSim();
    const tr = sim.gen.trees[0];
    const a = createAnimal(sim.state.nextId++, 'squirrel', tr.x + tr.trunkR + 0.04, tr.z, new Rng(1), sim.terrain);
    a.mode = 'climb'; a.tree = 0; a.y += 4;
    sim.state.animals.push(a);
    sim.hitAnimal(a, 0.7, 'spear');
    const c = sim.state.carcasses[0];
    expect(c.species).toBe('squirrel');
    expect(c.y).toBe(sim.terrain.heightAt(c.x, c.z));
    expect(Math.hypot(c.x - tr.x, c.z - tr.z)).toBeGreaterThan(tr.trunkR + 0.3);
    expect(c.remaining).toEqual(expect.arrayContaining([{ item: 'rawMeat', count: 1 }, { item: 'hide', count: 1 }]));
    expect(sim.state.stats.kills.squirrel).toBe(1);
  });
  it('arrows hunt squirrels and pass through hidden ones', () => {
    for (const mode of ['idle', 'hide'] as const) {
      const sim = quietSim(), m = sim.terrain.pnw!.meadow;
      const a = createAnimal(sim.state.nextId++, 'squirrel', m.x, m.z, new Rng(3), sim.terrain);
      a.mode = mode; a.timer = 100;
      // Pause wildlife AI; arrow hits still go through the real projectile path.
      sim.authority = 'guest';
      sim.state.animals.push(a);
      sim.projectiles.push({ x: a.x - 0.4, y: a.y + 0.12, z: a.z, vx: 20, vy: 0, vz: 0, damage: 1, life: 3, tool: 'bow' });
      run(sim, 0.05);
      // Guest hits request the host; hiding must suppress the request entirely.
      expect(sim.netOut.some((r) => r.k === 'hit')).toBe(mode === 'idle');
    }
  });
});

const flower: Perch = { x: 1, y: 2.5, z: 0, flower: true, water: true };
const stone: Perch = { x: -1, y: 2.2, z: 1, flower: false, water: true };
describe('ambient insect behavior and scale (numeric checks only)', () => {
  it.each([0, 5.9, 6.9, 18, 20, 23.9])('no insects without daylight at %s:00', (hour) => {
    expect(insectsSunlit(hour, 'summer', 'sunny')).toBe(false);
  });
  it('only permits sunlit nonwinter weather', () => {
    for (const weather of ['cloudy', 'rainy', 'foggy', 'snowy'] as const) expect(insectsSunlit(12, 'summer', weather)).toBe(false);
    expect(insectsSunlit(12, 'winter', 'sunny')).toBe(false);
    expect(insectsSunlit(12, 'summer', 'sunny')).toBe(true);
  });
  it('butterflies flutter, feed on real flowers and rest on other surfaces', () => {
    const rng = new Rng(9), a = createInsect('butterfly', flower, rng);
    const modes = new Set<string>();
    for (let i = 0; i < 180 * 60; i++) {
      advanceInsect(a, 1 / 60, i / 60, 0.8, rng, [flower, stone], land);
      modes.add(a.mode);
      if (a.mode === 'feed') { expect(a.landing?.flower).toBe(true); expect(a.position.y).toBeCloseTo(2.506, 3); }
      if (a.mode === 'rest') expect(a.landing?.flower).toBe(false);
      expect(a.position.y).toBeGreaterThan(2);
    }
    expect([...modes]).toEqual(expect.arrayContaining(['flutter', 'feed', 'rest']));
  });
  it('dragonflies patrol, hover, dart and perch without feeding on flowers', () => {
    const rng = new Rng(10), a = createInsect('dragonfly', stone, rng), modes = new Set<string>();
    for (let i = 0; i < 120 * 60; i++) {
      advanceInsect(a, 1 / 60, i / 60, 0.8, rng, [flower, stone], land); modes.add(a.mode);
      expect(Math.hypot(a.position.x - stone.x, a.position.z - stone.z)).toBeLessThan(8);
    }
    expect([...modes]).toEqual(expect.arrayContaining(['patrol', 'hover', 'dart', 'rest']));
    expect(modes.has('feed')).toBe(false);
  });
  it('landed visitors follow flower sway and settle without overshooting', () => {
    const bloom = { x: 1, y: 2.5, z: 0, rootX: 1, rootZ: 0, rot: 0.8, scale: 1.1 };
    const p = { ...flower, bloom }, rng = new Rng(5), a = createInsect('butterfly', p, rng);
    a.mode = 'feed'; a.landing = p; a.duration = 100;
    advanceInsect(a, 0.1, 5, 1, rng, [p], land);
    expect(a.position.toArray()).toEqual(perchPosition(p, 5, 1, new THREE.Vector3()).toArray());
    expect(a.position.x).not.toBe(p.x);
  });
  it.each(['butterfly', 'dragonfly'] as const)('%s uses real centimetre dimensions', (kind) => {
    const material = new THREE.MeshLambertMaterial();
    const rig = insectRig(kind, material, material);
    const box = new THREE.Box3().setFromObject(rig.root), size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0.07); expect(size.x).toBeLessThan(0.105);
    expect(size.z).toBeLessThan(0.08);
    material.dispose();
    rig.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  });
  it('the squirrel rig is smaller than the hare, with four legs and a bushy tail', () => {
    const squirrel = rigParts('squirrel'), rabbit = rigParts('rabbit');
    const size = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!.getSize(new THREE.Vector3()); };
    expect(size(squirrel.body).z).toBeLessThan(size(rabbit.body).z);
    expect(squirrel.legs).toHaveLength(4); expect(squirrel.tail).toBeDefined();
  });
  it('visual behavior is deterministic for a seed', () => {
    const simulate = () => {
      const rng = new Rng(54), a = createInsect('butterfly', flower, rng);
      for (let i = 0; i < 600; i++) advanceInsect(a, 1 / 60, i / 60, 0.8, rng, [flower, stone], land);
      return a;
    };
    expect(simulate()).toEqual(simulate());
  });
  it.each([1, 42, 777])('water edges provide dragonfly habitat for seed %i', (seed) => {
    const sim = quietSim(seed), mats = makeNatureMaterials(), nature = new NatureView(sim.terrain, sim.gen, mats, 'summer');
    const ambient = new PnwAmbience(sim.terrain, sim.gen, nature.flowerPerches);
    sim.state.totalHours = 6; sim.state.weather!.id = 'sunny';
    const layout = sim.terrain.pnw!, lake = layout.lakes[0];
    let sightings = 0;
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6, radius = layout.shoreRadius(lake, angle) + 6;
      const x = lake.x + Math.cos(angle) * radius, z = lake.z + Math.sin(angle) * radius;
      ambient.update(1, i, x, z, sim.state);
      const dragonflies = ambient.insects.filter((s) => s.rig.root.visible && s.insect?.kind === 'dragonfly');
      if (dragonflies.length) sightings++;
      for (const slot of dragonflies) {
        const p = slot.insect!.home;
        let wet = false;
        for (let a = 0; a < 16; a++) for (const r of [0, 4, 9, 16]) wet ||= sim.terrain.waterDepth(p.x + Math.sin(a * Math.PI / 8) * r, p.z + Math.cos(a * Math.PI / 8) * r) > 0.05;
        expect(wet).toBe(true);
        expect(slot.rig.root.scale.toArray()).toEqual([1, 1, 1]);
      }
    }
    expect(sightings).toBeGreaterThanOrEqual(8);
    ambient.dispose(); nature.dispose(); Object.values(mats).forEach((m) => m.dispose());
  });
  it('integrates real blooms, caps effects, honors the game clock, and shows wisps all day', () => {
    const sim = quietSim(), mats = makeNatureMaterials(), nature = new NatureView(sim.terrain, sim.gen, mats, 'summer');
    const ambient = new PnwAmbience(sim.terrain, sim.gen, nature.flowerPerches);
    const before = serializeState(sim.state);
    expect(ambient.insects).toHaveLength(AMBIENT_CAPS.butterflies + AMBIENT_CAPS.dragonflies);
    expect(ambient.wisps).toHaveLength(2);
    const f = nature.flowerPerches[0];
    sim.state.weather!.id = 'sunny';
    for (const hour of [8, 12, 16, 20, 0]) {
      sim.state.totalHours = (hour - 6 + 24) % 24;
      ambient.update(1, hour, f.x, f.z, sim.state);
      expect(ambient.insects.some((s) => s.rig.root.visible)).toBe(hour >= 7 && hour < 18);
    }
    const tr = sim.gen.trees.find((t) => sim.terrain.inPlayBounds(t.x, t.z, 30)
      && sim.terrain.slopeAt(t.x, t.z) < 0.5 && sim.terrain.field(t.x, t.z, 1) > 0.6)!;
    for (const hour of [12, 0]) {
      sim.state.totalHours = (hour - 6 + 24) % 24;
      ambient.update(1, hour, tr.x, tr.z, sim.state);
      expect(ambient.wisps.some((w) => w.sprite.visible && w.sprite.material.opacity > 0)).toBe(true);
      expect(ambient.wisps.every((w) => w.sprite.material.opacity < 0.35)).toBe(true);
    }
    // Effects do not add animals, items, RNG draws, or any save payload.
    const saved = JSON.parse(before), after = JSON.parse(serializeState(sim.state));
    expect(after.animals).toEqual(saved.animals); expect(after.rng).toBe(saved.rng); expect(after.nextId).toBe(saved.nextId);
    ambient.dispose(); nature.dispose(); Object.values(mats).forEach((m) => m.dispose());
  });
});
