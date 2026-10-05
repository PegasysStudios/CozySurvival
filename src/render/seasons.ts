import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import type { Season } from '../sim/seasons';

type Surface = 'solid' | 'plant' | 'evergreen' | 'deciduous' | 'terrain';
const snow = new THREE.Color('#e7f0f4');
const snowShade = new THREE.Color('#a6c7d7');
const spring = new THREE.Color('#76ae4c');
const gold = new THREE.Color('#e6a331');
const scarlet = new THREE.Color('#be4928');
const copper = new THREE.Color('#c78440');
const umber = new THREE.Color('#78432b');
const litter = new THREE.Color('#93703e');

/** Recolour freshly built PNW geometry once per season, including each LOD and stripped tree variant. */
export function seasonColors(g: THREE.BufferGeometry, season: Season | null, surface: Surface = 'solid'): THREE.BufferGeometry {
  if (!season || season === 'summer') return g;
  const colors = g.getAttribute('color');
  const normals = g.getAttribute('normal');
  const pos = g.getAttribute('position');
  if (!colors || !normals) return g;
  const c = new THREE.Color();
  const tint = new THREE.Color();
  for (let i = 0; i < colors.count; i++) {
    c.fromBufferAttribute(colors, i);
    const green = c.g > c.r * 1.08 && c.g > c.b * 1.16;
    const up = normals.getY(i);
    const y = pos.getY(i);
    const variation = 0.5 + 0.5 * Math.sin(pos.getX(i) * 0.83 + y * 1.2 + pos.getZ(i) * 0.6);
    if (season === 'winter') {
      if (surface === 'terrain') {
        if (y >= -0.02) c.lerp(tint.copy(snowShade).lerp(snow, smoothstep(0.35, 1, up)), 0.65 + 0.35 * smoothstep(0.15, 0.8, up));
      } else {
        // Snow settles on upper faces; dark needles and bark still show beneath it.
        const cover = green ? 0.5 + 0.48 * smoothstep(-0.35, 0.5, up) : smoothstep(0.25, 0.8, up) * 0.9;
        c.lerp(tint.copy(snowShade).lerp(snow, clamp(up, 0, 1)), cover);
      }
    } else if (season === 'fall') {
      if (green && surface === 'deciduous') c.copy(tint.copy(gold).lerp(scarlet, variation)).multiplyScalar(0.8 + 0.2 * clamp(up, 0, 1));
      else if (green && surface === 'evergreen') c.copy(tint.copy(copper).lerp(umber, variation)).multiplyScalar(0.7 + 0.3 * clamp(up, 0, 1));
      else if (green && (surface === 'plant' || surface === 'terrain')) c.lerp(litter, 0.65);
      else if (surface === 'terrain' && y > 0 && up > 0.7) c.lerp(litter, 0.2);
    } else if (green && surface !== 'evergreen') {
      c.lerp(spring, 0.26);
    }
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
  return g;
}
