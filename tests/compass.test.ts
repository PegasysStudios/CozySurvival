import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../src/data/biomes';
import { DayNight } from '../src/render/sky';
import { lookDir } from '../src/sim/movement';
import { Simulation } from '../src/sim/simulation';
import { COMPASS_NAMES, COMPASS_POINTS, compassPoint, headingDegrees } from '../src/ui/compass';

const DEG = Math.PI / 180;
/** The yaw that looks along the ground direction (dx, dz). */
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);

describe('HUD compass', () => {
  it('names all eight points as the player turns right from north', () => {
    expect(COMPASS_POINTS).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    COMPASS_POINTS.forEach((point, k) => {
      // Turning right lowers the yaw.
      const yaw = -k * 45 * DEG;
      expect(compassPoint(yaw), `${k * 45}°`).toBe(point);
      expect(headingDegrees(yaw)).toBeCloseTo(k * 45, 6);
      expect(COMPASS_NAMES[point]).toMatch(/^(north|south|east|west)+$/);
    });
  });

  it('maps each point to its world direction: north is −Z and east is +X', () => {
    const dirs: Record<string, [number, number]> = {
      N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
    };
    const out = { x: 0, y: 0, z: 0 };
    for (const [point, [dx, dz]] of Object.entries(dirs)) {
      const yaw = yawToward(dx, dz);
      expect(compassPoint(yaw), point).toBe(point);
      // The camera really looks that way at this yaw.
      lookDir(yaw, 0, out);
      expect(out.x * dx + out.z * dz, point).toBeCloseTo(Math.hypot(dx, dz), 6);
    }
  });

  it('switches point halfway between neighbours and wraps past a full turn', () => {
    expect(compassPoint(-22.4 * DEG)).toBe('N');
    expect(compassPoint(-22.6 * DEG)).toBe('NE');
    expect(compassPoint(22.4 * DEG)).toBe('N');
    expect(compassPoint(22.6 * DEG)).toBe('NW');
    expect(compassPoint(-337.6 * DEG)).toBe('N');
    expect(compassPoint(-(180 + 22.4) * DEG)).toBe('S');
    for (let k = 0; k < 8; k++) {
      const yaw = -k * 45 * DEG;
      for (const turns of [-3, -1, 1, 5]) expect(compassPoint(yaw + turns * Math.PI * 2)).toBe(COMPASS_POINTS[k]);
    }
    for (let d = -1440; d <= 1440; d += 7.3) {
      const h = headingDegrees(d * DEG);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('agrees with the sky: the sun rises in the east, stands due south at noon and sets in the west', () => {
    const dn = new DayNight();
    const sunBearing = (hour: number) => {
      dn.evaluate(hour);
      return headingDegrees(yawToward(dn.sunDir.x, dn.sunDir.z));
    };
    for (const biome of BIOME_IDS) {
      dn.setBiome(biome);
      const rise = sunBearing(5.8);
      expect(rise, `${biome} sunrise`).toBeGreaterThan(45);
      expect(rise, `${biome} sunrise`).toBeLessThan(135);
      expect(sunBearing(13), `${biome} noon`).toBeCloseTo(180, 3);
      dn.evaluate(13);
      expect(compassPoint(yawToward(dn.sunDir.x, dn.sunDir.z))).toBe('S');
      const set = sunBearing(20.2);
      expect(set, `${biome} sunset`).toBeGreaterThan(225);
      expect(set, `${biome} sunset`).toBeLessThan(315);
    }
  });

  it('reads the player yaw the same way on every map', () => {
    for (const biome of BIOME_IDS) {
      const sim = Simulation.newGame(3, biome);
      sim.state.player.yaw = yawToward(1, 0);
      expect(compassPoint(sim.state.player.yaw), biome).toBe('E');
      sim.state.player.yaw = yawToward(-1, 1);
      expect(compassPoint(sim.state.player.yaw), biome).toBe('SW');
    }
  });
});
