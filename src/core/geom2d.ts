/**
 * 2D (XZ-plane) collision shapes and tests. Rotation follows three.js `rotation.y`:
 * local +X maps to world (cos r, -sin r) and local +Z maps to world (sin r, cos r).
 */

export interface CircleShape {
  type: 'circle';
  x: number;
  z: number;
  r: number;
}

export interface BoxShape {
  type: 'box';
  x: number;
  z: number;
  /** half extent along local X */
  hw: number;
  /** half extent along local Z */
  hd: number;
  rot: number;
}

export type Shape2D = CircleShape | BoxShape;

export function circle(x: number, z: number, r: number): CircleShape {
  return { type: 'circle', x, z, r };
}

export function box(x: number, z: number, hw: number, hd: number, rot: number): BoxShape {
  return { type: 'box', x, z, hw, hd, rot };
}

export function boundingRadius(s: Shape2D): number {
  return s.type === 'circle' ? s.r : Math.sqrt(s.hw * s.hw + s.hd * s.hd);
}

/** World -> box-local transform written into `out` ([lx, lz]). */
export function toLocal(b: BoxShape, x: number, z: number, out: number[]): number[] {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  out[0] = dx * c - dz * s;
  out[1] = dx * s + dz * c;
  return out;
}

/** Box-local -> world transform written into `out` ([x, z]). */
export function toWorld(b: BoxShape, lx: number, lz: number, out: number[]): number[] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  out[0] = b.x + lx * c + lz * s;
  out[1] = b.z - lx * s + lz * c;
  return out;
}

const tmpA = [0, 0];
const tmpB = [0, 0];

export function circleCircle(a: CircleShape, b: CircleShape): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const r = a.r + b.r;
  return dx * dx + dz * dz < r * r;
}

export function circleBox(c: CircleShape, b: BoxShape): boolean {
  toLocal(b, c.x, c.z, tmpA);
  const cx = Math.max(-b.hw, Math.min(b.hw, tmpA[0]));
  const cz = Math.max(-b.hd, Math.min(b.hd, tmpA[1]));
  const dx = tmpA[0] - cx;
  const dz = tmpA[1] - cz;
  return dx * dx + dz * dz < c.r * c.r;
}

function projectBox(b: BoxShape, ax: number, az: number): [number, number] {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const center = b.x * ax + b.z * az;
  // local X axis (c, -s), local Z axis (s, c)
  const ext = b.hw * Math.abs(c * ax - s * az) + b.hd * Math.abs(s * ax + c * az);
  return [center - ext, center + ext];
}

export function boxBox(a: BoxShape, b: BoxShape): boolean {
  const axes: number[][] = [
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
  ];
  for (const [ax, az] of axes) {
    const pa = projectBox(a, ax, az);
    const pb = projectBox(b, ax, az);
    if (pa[1] <= pb[0] || pb[1] <= pa[0]) return false;
  }
  return true;
}

export function overlaps(a: Shape2D, b: Shape2D): boolean {
  if (a.type === 'circle') {
    return b.type === 'circle' ? circleCircle(a, b) : circleBox(a, b);
  }
  return b.type === 'circle' ? circleBox(b, a) : boxBox(a, b);
}

/**
 * Minimum translation that pushes a circle (x, z, r) out of `s`.
 * Writes [dx, dz] into `out` and returns true when there was penetration.
 */
export function pushCircleOut(x: number, z: number, r: number, s: Shape2D, out: number[]): boolean {
  if (s.type === 'circle') {
    const dx = x - s.x;
    const dz = z - s.z;
    const min = r + s.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      out[0] = min;
      out[1] = 0;
      return true;
    }
    const k = (min - d) / d;
    out[0] = dx * k;
    out[1] = dz * k;
    return true;
  }
  toLocal(s, x, z, tmpA);
  const lx = tmpA[0];
  const lz = tmpA[1];
  const inside = Math.abs(lx) < s.hw && Math.abs(lz) < s.hd;
  let nx: number;
  let nz: number;
  let depth: number;
  if (inside) {
    const px = s.hw - Math.abs(lx);
    const pz = s.hd - Math.abs(lz);
    if (px < pz) {
      nx = Math.sign(lx) || 1;
      nz = 0;
      depth = px + r;
    } else {
      nx = 0;
      nz = Math.sign(lz) || 1;
      depth = pz + r;
    }
  } else {
    const cx = Math.max(-s.hw, Math.min(s.hw, lx));
    const cz = Math.max(-s.hd, Math.min(s.hd, lz));
    const dx = lx - cx;
    const dz = lz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2) || 1e-6;
    nx = dx / d;
    nz = dz / d;
    depth = r - d;
  }
  // rotate local normal back to world
  const c = Math.cos(s.rot);
  const sn = Math.sin(s.rot);
  const wx = nx * c + nz * sn;
  const wz = -nx * sn + nz * c;
  out[0] = wx * depth;
  out[1] = wz * depth;
  return true;
}

/** Sample points covering a footprint (center, corners/rim, edge midpoints) into `out` as flat [x,z,...]. */
export function footprintSamples(s: Shape2D, out: number[]): number[] {
  out.length = 0;
  out.push(s.x, s.z);
  if (s.type === 'circle') {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push(s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r);
      out.push(s.x + Math.cos(a) * s.r * 0.5, s.z + Math.sin(a) * s.r * 0.5);
    }
    return out;
  }
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      if (ix === 0 && iz === 0) continue;
      toWorld(s, ix * s.hw, iz * s.hd, tmpB);
      out.push(tmpB[0], tmpB[1]);
      toWorld(s, ix * s.hw * 0.5, iz * s.hd * 0.5, tmpB);
      out.push(tmpB[0], tmpB[1]);
    }
  }
  return out;
}

/**
 * Ray vs sphere. Returns distance along the (normalized) ray or -1.
 */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t >= 0 ? t : -1;
}

/**
 * Ray vs vertical cylinder (axis along Y) spanning [y0, y1]. Returns distance or -1.
 */
export function rayCylinder(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, r: number, y0: number, y1: number,
): number {
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    if (px * px + pz * pz > r * r) return -1;
    return -1;
  }
  const b = px * dx + pz * dz;
  const c = px * px + pz * pz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / a;
  if (t < 0) {
    if (c <= 0) t = 0;
    else return -1;
  }
  const y = oy + dy * t;
  if (y < y0 || y > y1) return -1;
  return t;
}
