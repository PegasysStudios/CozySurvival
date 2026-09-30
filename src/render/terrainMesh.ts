import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { hash2 } from '../core/rng';
import { TERRAIN_CELL, TERRAIN_CELLS, TERRAIN_VERTS, WATER_LEVEL, WORLD_HALF, WORLD_SIZE, type Terrain } from '../sim/terrain';

const C = {
  deep: new THREE.Color('#4d4a3c'),
  silt: new THREE.Color('#857a5c'),
  sand: new THREE.Color('#bba77c'),
  pebble: new THREE.Color('#9d978a'),
  meadow: new THREE.Color('#7fa24a'),
  meadowWarm: new THREE.Color('#98b456'),
  forest: new THREE.Color('#4d6b34'),
  moss: new THREE.Color('#5d7a3a'),
  duff: new THREE.Color('#6a5a3c'),
  rock: new THREE.Color('#7f7b72'),
  rockDark: new THREE.Color('#66645e'),
  snow: new THREE.Color('#eef2f4'),
};

const D = {
  poolFloor: new THREE.Color('#6e5a44'),
  mud: new THREE.Color('#8a6a4a'),
  sand: new THREE.Color('#c98a5c'),
  sandPale: new THREE.Color('#dcae80'),
  wash: new THREE.Color('#e2c79c'),
  soil: new THREE.Color('#a8704c'),
  grass: new THREE.Color('#b4a064'),
  grassGreen: new THREE.Color('#8f9656'),
  slick: new THREE.Color('#e6ab7e'),
  slickPale: new THREE.Color('#f2d2aa'),
  crust: new THREE.Color('#ece8dc'),
  crustDim: new THREE.Color('#d6cfbc'),
  basalt: new THREE.Color('#3e3a38'),
  basaltLight: new THREE.Color('#5a524c'),
  /** Cliff strata from the base up: dark red mudstone, red sandstone, orange, a pale cap. */
  strata: ['#8a3f2c', '#b5553a', '#c9744a', '#a84c34', '#d49060', '#e8c49a'].map((h) => new THREE.Color(h)),
};

/** Desert colouring: red sand flats, pale washes, slickrock, banded cliffs, basalt, grassy uplands, alkali crust. */
function desertColor(t: Terrain, c: THREE.Color, mx: number, my: number, mz: number, up: number, patch: number): void {
  if (my < WATER_LEVEL - 0.1) {
    c.copy(D.mud).lerp(D.poolFloor, clamp(-my / 2, 0, 1));
    return;
  }
  const u = t.upland(mx, mz);
  c.copy(D.sand).lerp(D.sandPale, patch * 0.6);
  c.lerp(D.wash, t.wash(mx, mz) * 0.75);
  if (u > 0) {
    const g = c.clone().lerp(D.soil, 0.6).lerp(patch > 0.5 ? D.grass : D.grassGreen, 0.5 + patch * 0.3);
    c.lerp(g, smoothstep(0.05, 0.5, u));
  }
  const slick = t.slickrock(mx, mz);
  if (slick > 0) c.lerp(Math.sin(my * 7 + mx * 0.3) > 0.2 ? D.slickPale : D.slick, smoothstep(0.1, 0.6, slick));
  const lf = t.landformAt(mx, mz);
  const steep = 1 - smoothstep(0.62, 0.86, up);
  const n = D.strata.length;
  const band = D.strata[((Math.floor((my + 0.8 * Math.sin(mx * 0.05 + mz * 0.04)) / 2.3) % n) + n) % n];
  if (lf.volcanic && lf.rock > 0.2) c.copy(patch > 0.5 ? D.basalt : D.basaltLight);
  else if (steep > 0 && (lf.rock > 0.1 || my > 9)) c.lerp(band, steep);
  else if (lf.rock > 0.6 && up > 0.86) c.lerp(D.soil, 0.5);
  else c.lerp(D.soil, steep * 0.6);
  for (const l of t.lakes) {
    const d = Math.hypot(mx - l.x, mz - l.z) / l.r;
    if (l.kind === 'alkali' && d < 1.75 && my > WATER_LEVEL - 0.1) c.lerp(patch > 0.45 ? D.crust : D.crustDim, 1 - smoothstep(1.2, 1.75, d));
    else if (l.kind === 'spring' && d < 2.2) c.lerp(D.grassGreen, (1 - smoothstep(1.05, 2.2, d)) * 0.55);
    else if (d < 1.3 && my < WATER_LEVEL + 0.4) c.lerp(D.mud, 0.6);
  }
}

/**
 * Flat-shaded terrain whose triangulation matches `Terrain.heightAt` exactly
 * (each cell split along its (i,j)-(i+1,j+1) diagonal).
 */
export function buildTerrainMesh(t: Terrain): THREE.Mesh {
  const tris = TERRAIN_CELLS * TERRAIN_CELLS * 2;
  const pos = new Float32Array(tris * 9);
  const colors = new Float32Array(tris * 9);
  const h = t.heights;
  const c = new THREE.Color();
  let o = 0;
  const vx = (i: number) => -WORLD_HALF + i * TERRAIN_CELL;
  const put = (x: number, y: number, z: number) => {
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    o += 3;
  };
  const shade = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, k: number) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const up = ny / nl;
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;
    const forest = t.field(mx, mz, 1);
    const patch = t.field(mx * 3.1, mz * 3.1, 6);
    if (t.biome === 'desert') {
      desertColor(t, c, mx, my, mz, up, patch);
    } else if (my < WATER_LEVEL - 0.2) {
      c.copy(C.silt).lerp(C.deep, clamp(-my / 4, 0, 1));
    } else if (my < WATER_LEVEL + 0.55) {
      c.copy(C.sand).lerp(C.pebble, patch);
    } else {
      c.copy(C.meadow).lerp(C.meadowWarm, patch);
      const f = smoothstep(0.35, 0.62, forest);
      c.lerp(patch > 0.55 ? C.duff : C.forest, f * 0.85);
      if (f > 0.5 && patch < 0.35) c.lerp(C.moss, 0.5);
      const shoreBlend = 1 - smoothstep(0.55, 1.1, my);
      c.lerp(C.sand, shoreBlend * 0.6);
    }
    if (t.biome !== 'desert') {
      const steep = 1 - smoothstep(0.72, 0.9, up);
      c.lerp(patch > 0.5 ? C.rock : C.rockDark, steep);
      if (my > 16) c.lerp(C.rock, smoothstep(16, 24, my));
      if (my > 27 && up > 0.72) c.lerp(C.snow, smoothstep(27, 33, my));
    }
    const j = 1 + (k - 0.5) * 0.09;
    for (let v = 0; v < 3; v++) {
      const ci = o - 9 + v * 3;
      colors[ci] = c.r * j;
      colors[ci + 1] = c.g * j;
      colors[ci + 2] = c.b * j;
    }
  };
  for (let jz = 0; jz < TERRAIN_CELLS; jz++) {
    for (let ix = 0; ix < TERRAIN_CELLS; ix++) {
      const x0 = vx(ix), x1 = vx(ix + 1), z0 = vx(jz), z1 = vx(jz + 1);
      const h00 = h[jz * TERRAIN_VERTS + ix];
      const h10 = h[jz * TERRAIN_VERTS + ix + 1];
      const h01 = h[(jz + 1) * TERRAIN_VERTS + ix];
      const h11 = h[(jz + 1) * TERRAIN_VERTS + ix + 1];
      put(x0, h00, z0);
      put(x0, h01, z1);
      put(x1, h11, z1);
      shade(x0, h00, z0, x0, h01, z1, x1, h11, z1, hash2(ix, jz, 1));
      put(x0, h00, z0);
      put(x1, h11, z1);
      put(x1, h10, z0);
      shade(x0, h00, z0, x1, h11, z1, x1, h10, z0, hash2(ix, jz, 2));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Water depth encoded in a texture so the water shader can tint shallows and draw shore foam. */
export function buildDepthTexture(t: Terrain): THREE.DataTexture {
  const n = TERRAIN_VERTS;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = clamp((WATER_LEVEL - t.heights[j * n + i]) / 5, -0.2, 1);
      const k = (j * n + i) * 4;
      data[k] = Math.round(clamp(d + 0.2, 0, 1.2) / 1.2 * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export const WORLD_UV_SCALE = 1 / WORLD_SIZE;
