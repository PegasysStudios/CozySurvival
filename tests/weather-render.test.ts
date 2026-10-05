import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DayNight, SkyView } from '../src/render/sky';
import { applyWeatherLight, precipitationSurface, WeatherView } from '../src/render/weather';
import { Simulation } from '../src/sim/simulation';
import type { StructureState } from '../src/sim/state';
import { WEATHER } from '../src/sim/weather';
import { fakeTerrain } from './helpers';

// Inspect scene data only: these tests never create a renderer, browser or image.
describe('PNW weather scene data', () => {
  it('softens overcast lighting throughout the clock and immediately restores the clear palette', () => {
    const dn = new DayNight();
    const clear = new DayNight();
    for (const hour of [0, 6, 12, 18, 23]) for (const weather of WEATHER) {
      dn.evaluate(hour);
      clear.evaluate(hour);
      applyWeatherLight(dn, weather);
      if (weather !== 'sunny') {
        expect(dn.sunIntensity).toBeLessThan(clear.sunIntensity);
        expect(dn.hemiIntensity).toBeGreaterThanOrEqual(clear.hemiIntensity);
        expect(dn.fog.equals(clear.fog)).toBe(false);
      }
      dn.evaluate(hour);
      applyWeatherLight(dn, 'sunny');
      expect(dn.top.equals(clear.top)).toBe(true);
      expect(dn.fog.equals(clear.fog)).toBe(true);
      expect(dn.sunIntensity).toBe(clear.sunIntensity);
    }
    for (const biome of ['desert', 'island'] as const) {
      dn.setBiome(biome);
      clear.setBiome(biome);
      dn.evaluate(12); clear.evaluate(12);
      applyWeatherLight(dn, null);
      expect(dn.top.equals(clear.top)).toBe(true);
      expect(dn.sunIntensity).toBe(clear.sunIntensity);
    }
  });

  it('adds overcast cloud cover, obscures celestial light and restores clouds without accumulating scale', () => {
    const sky = new SkyView(42, 32);
    const dn = new DayNight();
    const camera = new THREE.PerspectiveCamera();
    dn.evaluate(12);
    const clouds = sky.group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial);
    sky.update(dn, camera, 0, 'sunny');
    const sunnyScale = clouds[0].scale.clone();
    expect(clouds.filter((o) => o.visible)).toHaveLength(8);
    sky.update(dn, camera, 0, 'cloudy');
    expect(clouds.filter((o) => o.visible)).toHaveLength(32);
    const cloudyScale = clouds[0].scale.clone();
    for (let i = 0; i < 100; i++) sky.update(dn, camera, i, 'cloudy');
    expect(clouds[0].scale.equals(cloudyScale)).toBe(true);
    const dome = sky.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(dome.material.uniforms.uClear.value).toBeLessThan(0.2);
    sky.update(dn, camera, 0, 'sunny');
    expect(clouds[0].scale.equals(sunnyScale)).toBe(true);
    expect(dome.material.uniforms.uClear.value).toBe(1);
    sky.dispose();
  });

  it('places rain and snow above water, terrain and rotated shelters, and hides them immediately on dry days', () => {
    const terrain = fakeTerrain((x) => x < 0 ? -3 : 2);
    const shelter: StructureState = { id: 1, prefab: 'barkHut', x: 4, y: 2, z: 0, rot: Math.PI / 2, fuel: 0 };
    expect(precipitationSurface(terrain, [], -5, 0)).toBe(0);
    expect(precipitationSurface(terrain, [], 5, 0)).toBe(2);
    expect(precipitationSurface(terrain, [shelter], 4, 0)).toBeGreaterThan(4);
    expect(precipitationSurface(terrain, [shelter], 4, 6)).toBe(2);
    const view = new WeatherView(terrain, 42);
    expect(view.snow.geometry.getAttribute('position').count).toBe(640);
    expect(view.snow.geometry.getAttribute('aSize').count).toBe(640);
    expect(view.rain.geometry.getAttribute('position').count).toBe(560 * 2);
    const camera = new THREE.PerspectiveCamera(72);
    camera.position.set(4, 3, 0);
    for (const weather of ['rainy', 'snowy'] as const) {
      for (let frame = 0; frame < 150; frame++) {
        if (frame === 50) camera.position.set(100, 7, 100);
        view.update(weather, 1 / 30, frame / 30, camera, 900, 0, [shelter]);
        const pos = (weather === 'rainy' ? view.rain : view.snow).geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
          expect(Math.abs(pos.getX(i) - camera.position.x)).toBeLessThan(24);
          expect(pos.getY(i)).toBeGreaterThanOrEqual(precipitationSurface(terrain, [shelter], pos.getX(i), pos.getZ(i)));
        }
      }
      expect(view.rain.visible).toBe(weather === 'rainy');
      expect(view.snow.visible).toBe(weather === 'snowy');
    }
    for (const weather of ['sunny', 'cloudy', 'foggy', null] as const) {
      view.update(weather, 0, 0, camera, 900, 0, []);
      expect(view.rain.visible || view.snow.visible).toBe(false);
    }
    const disposed = vi.fn();
    for (const part of [view.rain, view.snow]) {
      part.geometry.addEventListener('dispose', disposed);
      part.material.addEventListener('dispose', disposed);
      expect(part.material.depthWrite).toBe(false);
      expect(part.material.depthTest).toBe(true);
    }
    view.dispose();
    expect(disposed).toHaveBeenCalledTimes(4);
  });

  it('creates weather meshes without changing the simulation', () => {
    const sim = Simulation.newGame(42);
    const before = JSON.stringify(sim.state);
    const view = new WeatherView(sim.terrain, sim.state.seed);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(sim.state.player.x, sim.state.player.y + 1.65, sim.state.player.z);
    for (const weather of WEATHER) view.update(weather, 0.1, 1, camera, 900, 0, sim.state.structures);
    expect(JSON.stringify(sim.state)).toBe(before);
    view.dispose();
  });
});
