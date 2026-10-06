import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { circle, overlaps } from '../src/core/geom2d';
import { stateFromSnapshot, takeSnapshot } from '../src/net/worldSync';
import { makeNatureMaterials, NatureView } from '../src/render/nature';
import { PnwAmbience } from '../src/render/pnwAmbience';
import type { Collider } from '../src/sim/colliders';
import { deserializeState, serializeState } from '../src/sim/save';
import { MemoryStorage, RunManager } from '../src/sim/run';
import { Simulation } from '../src/sim/simulation';

function fixture(seed: number, flowers = true) {
  const sim = Simulation.newGame(seed), mats = makeNatureMaterials();
  sim.devSetSeason('summer'); sim.state.totalHours = 6; sim.state.weather!.id = 'sunny';
  const nature = new NatureView(sim.terrain, sim.gen, mats, 'summer');
  const ambient = new PnwAmbience(sim.terrain, sim.gen, flowers ? nature.flowerPerches : [], sim.colliders);
  const p = sim.state.player;
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 500);
  camera.position.set(p.x, p.y + 1.6, p.z); camera.rotation.order = 'YXZ'; camera.rotation.y = p.yaw;
  camera.updateMatrixWorld();
  const step = (seconds: number, offset = 0) => {
    for (let i = 0; i < seconds * 60; i++) ambient.update(1 / 60, offset + i / 60, camera.position.x, camera.position.z, sim.state, camera.rotation.y);
  };
  const inView = (position: THREE.Vector3) => {
    const ndc = position.clone().project(camera);
    return Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && Math.abs(ndc.z) < 1;
  };
  const pixels = (position: THREE.Vector3, size: number) => {
    const depth = -position.clone().applyMatrix4(camera.matrixWorldInverse).z;
    return size * 900 / (2 * Math.tan(camera.fov * Math.PI / 360) * depth);
  };
  const dispose = () => { ambient.dispose(); nature.dispose(); Object.values(mats).forEach((m) => m.dispose()); };
  return { sim, ambient, camera, step, inView, pixels, dispose };
}

describe('PNW encounter visibility, measured without images', () => {
  it.each([1, 42, 777, 20260929])('places natural-scale insects and subtle wisps in the starting view for seed %i', (seed) => {
    const f = fixture(seed);
    try {
      f.step(5);
      for (const kind of ['butterfly', 'dragonfly']) {
        const encounters = f.ambient.insects.filter((s) => s.insect?.kind === kind && s.opacity > 0.5
          && f.inView(s.rig.root.position) && f.pixels(s.rig.root.position, 0.085) >= 4);
        expect(encounters.length).toBeGreaterThanOrEqual(2);
        expect(encounters.every((s) => s.rig.root.scale.equals(new THREE.Vector3(1, 1, 1)))).toBe(true);
      }
      expect(f.ambient.wisps.filter((w) => w.sprite.visible && f.inView(w.sprite.position) && f.pixels(w.sprite.position, 0.38) >= 20)).toHaveLength(2);
      expect(f.ambient.wisps.every((w) => w.sprite.material.opacity > 0 && w.sprite.material.opacity < 0.35)).toBe(true);
      // The same positions remain available at night, while every insect is removed.
      f.sim.state.totalHours = 18;
      f.step(0.1, 5);
      expect(f.ambient.insects.every((s) => !s.rig.root.visible && !s.insect)).toBe(true);
      expect(f.ambient.wisps.filter((w) => w.sprite.visible && f.inView(w.sprite.position))).toHaveLength(2);
    } finally { f.dispose(); }
  });

  it('butterflies can fly in forest habitat even when no flowers have been generated nearby', () => {
    const f = fixture(42, false);
    try {
      f.step(5);
      expect(f.ambient.insects.filter((s) => s.insect?.kind === 'butterfly' && f.inView(s.rig.root.position)).length).toBeGreaterThanOrEqual(2);
      expect(f.ambient.insects.every((s) => s.insect?.mode !== 'feed')).toBe(true);
    } finally { f.dispose(); }
  });

  it('replaces distant or behind-camera effects after walking and turning', () => {
    const f = fixture(42);
    try {
      f.step(5);
      const tr = f.sim.gen.trees.find((t) => Math.hypot(t.x - f.camera.position.x, t.z - f.camera.position.z) > 45
        && Math.abs(t.x) < f.sim.terrain.playHalf - 40 && Math.abs(t.z) < f.sim.terrain.playHalf - 40
        && f.sim.terrain.heightAt(t.x + 2, t.z) > 0.5)!;
      f.camera.position.set(tr.x + 2, f.sim.terrain.heightAt(tr.x + 2, tr.z) + 1.6, tr.z);
      f.camera.rotation.y += Math.PI; f.camera.updateMatrixWorld();
      f.step(6, 5);
      expect(f.ambient.insects.filter((s) => s.insect?.kind === 'butterfly' && f.inView(s.rig.root.position)).length).toBeGreaterThanOrEqual(2);
      expect(f.ambient.insects.filter((s) => s.insect).every((s) => s.rig.root.position.distanceTo(f.camera.position) < 20)).toBe(true);
      expect(f.ambient.wisps.some((w) => w.sprite.visible && f.inView(w.sprite.position))).toBe(true);
    } finally { f.dispose(); }
  });

  it.each([1, 42, 777, 20260929])('seeds reachable squirrels near the start and across standing forest trees for seed %i', (seed) => {
    const sim = Simulation.newGame(seed), p = sim.state.player;
    const squirrels = sim.state.animals.filter((a) => a.species === 'squirrel');
    expect(squirrels).toHaveLength(128);
    expect(squirrels.filter((a) => Math.hypot(a.x - p.x, a.z - p.z) <= 20)).toHaveLength(3);
    const nearby: Collider[] = [], occupied = new Set<string>();
    for (const a of squirrels) {
      expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeGreaterThanOrEqual(8);
      const body = circle(a.x, a.z, 0.12);
      sim.colliders.query(a.x, a.z, body.r, nearby);
      expect(nearby.some((c) => c.body && overlaps(body, c.body))).toBe(false);
      expect(sim.terrain.waterDepth(a.x, a.z)).toBe(0);
      occupied.add(Math.floor(a.x / 48) + ',' + Math.floor(a.z / 48));
    }
    expect(occupied.size).toBeGreaterThan(55);
  });

  it.each([0, 32])('initializes a previously expanded save with %i squirrels once, preserving its world and progress', (count) => {
    const original = Simulation.newGame(42);
    original.state.animals = original.state.animals.filter((a) => a.species !== 'squirrel')
      .concat(original.state.animals.filter((a) => a.species === 'squirrel').slice(0, count));
    original.state.trees[0].hp = 1; original.state.resources[0].charges = 0;
    delete original.state.pnwWildlife;
    const oldState = deserializeState(serializeState(original.state))!;
    const before = structuredClone(oldState);
    const loaded = new Simulation(oldState);
    expect(loaded.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(128);
    expect(loaded.state.animals.slice(0, before.animals.length)).toEqual(before.animals);
    for (const key of ['player', 'inventory', 'rng', 'totalHours', 'trees', 'resources', 'structures', 'carcasses'] as const) {
      expect(loaded.state[key]).toEqual(before[key]);
    }
    expect(loaded.gen).toBe(original.gen); expect(loaded.terrain).toBe(original.terrain);
    expect(new Set(loaded.state.animals.map((a) => a.id)).size).toBe(loaded.state.animals.length);
    const prey = loaded.state.animals.find((a) => a.species === 'squirrel')!;
    loaded.hitAnimal(prey, 10, 'spear');
    const restored = new Simulation(deserializeState(serializeState(loaded.state))!);
    expect(restored.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(127);
    expect(restored.state.carcasses).toEqual(loaded.state.carcasses);
    expect(restored.state.animals).toEqual(loaded.state.animals);
  });

  it('guests wait for host squirrel poses and never seed a separate population', () => {
    const host = Simulation.newGame(42);
    const guest = new Simulation(stateFromSnapshot(takeSnapshot(host)));
    expect(guest.state.animals).toHaveLength(0);
    expect(guest.state.pnwWildlife).toBe(1);
  });

  it.each([1, 42, 777, 20260929])('Continue, Retry and Restart activate wildlife on a legacy PNW save without expanding it, seed %i', (seed) => {
    const rm = new RunManager(new MemoryStorage(), () => seed);
    const original = Simulation.newGame(seed, 'pnw', 1);
    original.state.trees[0].hp = 1; original.state.resources[0].charges = 0;
    rm.save(original); rm.writeSnapshot(original);
    const before = structuredClone(original.state);
    for (const loaded of [rm.loadCurrent()!, rm.retryDay()]) {
      expect(loaded.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(32);
      expect(loaded.state.animals.slice(0, before.animals.length)).toEqual(before.animals);
      for (const key of ['player', 'inventory', 'rng', 'totalHours', 'trees', 'resources'] as const) expect(loaded.state[key]).toEqual(before[key]);
      expect(loaded.terrain).toBe(original.terrain); expect(loaded.gen).toBe(original.gen);
      expect(loaded.terrain.playHalf).toBe(148);
      expect(loaded.state.pnwWildlife).toBe(1);
      const guest = new Simulation(stateFromSnapshot(takeSnapshot(loaded)));
      expect(guest.state.animals).toHaveLength(0);
    }
    const restarted = rm.restartFromDay1();
    expect(restarted.state.animals.filter((a) => a.species === 'squirrel')).toHaveLength(32);
    expect(restarted.terrain).toBe(original.terrain);
    const loaded = rm.loadCurrent()!, a = loaded.state.animals.find((o) => o.species === 'squirrel')!;
    loaded.hitAnimal(a, 10, 'spear'); rm.save(loaded);
    expect(rm.loadCurrent()!.state.animals.filter((o) => o.species === 'squirrel')).toHaveLength(31);
  });
});
