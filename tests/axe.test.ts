import { describe, expect, it } from 'vitest';
import { toolGeometry } from '../src/render/props';

describe('the held axe (round 8)', () => {
  it('points its blade forward, away from the camera, rather than off to the right', () => {
    const pos = toolGeometry('axe').getAttribute('position');
    let minZ = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.4) continue;
      minZ = Math.min(minZ, pos.getZ(i));
      maxX = Math.max(maxX, pos.getX(i));
    }
    expect(minZ).toBeLessThan(-0.18);
    expect(maxX).toBeLessThan(0.06);
  });
});
