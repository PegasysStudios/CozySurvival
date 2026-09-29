import { describe, expect, it } from 'vitest';
import { box, circle, circleBox, boxBox, overlaps, pushCircleOut, raySphere, rayCylinder, toLocal, toWorld } from '../src/core/geom2d';
import { angleDiff, damp, turnToward, wrapAngle } from '../src/core/math';
import { Rng, hash2 } from '../src/core/rng';
import { SpatialGrid } from '../src/core/spatialGrid';

describe('math', () => {
  it('wraps angles into [-PI, PI)', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('turnToward is capped by max step and never overshoots', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });

  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 10, 5, 1 / 60);
    let b = 0;
    for (let i = 0; i < 144; i++) b = damp(b, 10, 5, 1 / 144);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('rng', () => {
  it('is deterministic per seed and in [0,1)', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
  });

  it('resumes from serialized state', () => {
    const a = new Rng(99);
    a.next();
    a.next();
    const b = new Rng(a.s);
    expect(b.next()).toBe(a.next());
  });
});

describe('geom2d', () => {
  it('local/world transforms are inverse and match three.js rotation.y', () => {
    const b = box(3, -2, 1, 2, 0.7);
    const l = toLocal(b, 5, 1, [0, 0]);
    const w = toWorld(b, l[0], l[1], [0, 0]);
    expect(w[0]).toBeCloseTo(5);
    expect(w[1]).toBeCloseTo(1);
    // rotation.y = 90deg maps local +X to world -Z
    const r = box(0, 0, 1, 1, Math.PI / 2);
    const px = toWorld(r, 1, 0, [0, 0]);
    expect(px[0]).toBeCloseTo(0);
    expect(px[1]).toBeCloseTo(-1);
  });

  it('circle/box overlap respects rotation', () => {
    const long = box(0, 0, 2, 0.25, 0);
    expect(circleBox(circle(1.8, 0, 0.1), long)).toBe(true);
    expect(circleBox(circle(0, 1.8, 0.1), long)).toBe(false);
    const turned = box(0, 0, 2, 0.25, Math.PI / 2);
    expect(circleBox(circle(0, 1.8, 0.1), turned)).toBe(true);
    expect(circleBox(circle(1.8, 0, 0.1), turned)).toBe(false);
  });

  it('box/box SAT handles rotated boxes', () => {
    const a = box(0, 0, 1, 1, 0);
    expect(boxBox(a, box(2.5, 0, 1, 1, 0))).toBe(false);
    expect(boxBox(a, box(1.9, 0, 1, 1, 0))).toBe(true);
    // diamond whose left corner reaches x = 2.3 - sqrt(2) ≈ 0.886, inside the first box
    expect(boxBox(a, box(2.3, 0, 1, 1, Math.PI / 4))).toBe(true);
    expect(boxBox(a, box(2.5, 0, 1, 1, Math.PI / 4))).toBe(false);
    expect(boxBox(a, box(2.5, 2.5, 1, 1, Math.PI / 4))).toBe(false);
    expect(overlaps(a, circle(0, 0, 0.1))).toBe(true);
  });

  it('pushCircleOut resolves penetration for circles and boxes', () => {
    const out = [0, 0];
    expect(pushCircleOut(0.5, 0, 0.4, circle(0, 0, 0.3), out)).toBe(true);
    expect(0.5 + out[0]).toBeCloseTo(0.7);
    expect(pushCircleOut(5, 0, 0.4, circle(0, 0, 0.3), out)).toBe(false);
    const b = box(0, 0, 1, 1, 0.3);
    expect(pushCircleOut(0.9, 0.2, 0.3, b, out)).toBe(true);
    expect(circleBox(circle(0.9 + out[0], 0.2 + out[1], 0.299), b)).toBe(false);
  });

  it('ray tests hit spheres and vertical cylinders', () => {
    expect(raySphere(0, 0, 0, 0, 0, -1, 0, 0, -5, 1)).toBeCloseTo(4);
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, -5, 1)).toBe(-1);
    expect(rayCylinder(0, 1, 0, 1, 0, 0, 5, 0, 0.5, 0, 3)).toBeCloseTo(4.5);
    expect(rayCylinder(0, 5, 0, 1, 0, 0, 5, 0, 0.5, 0, 3)).toBe(-1);
  });
});

describe('spatial grid', () => {
  it('returns items overlapping the query and supports removal without duplicates', () => {
    const g = new SpatialGrid<{ id: number }>(4);
    const a = { id: 1 };
    const b = { id: 2 };
    g.insert(a, 0, 0, 5);
    g.insert(b, 30, 30, 1);
    const out: { id: number }[] = [];
    expect(g.query(1, 1, 1, out)).toEqual([a]);
    expect(g.query(30, 30, 0.5, out)).toEqual([b]);
    g.remove(a, 0, 0, 5);
    expect(g.query(1, 1, 1, out)).toEqual([]);
  });
});
