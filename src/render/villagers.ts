import * as THREE from 'three';
import { damp, turnToward } from '../core/math';
import { tribeFor, type VillagerRole } from '../data/tribes';
import type { GameState, VillagerState } from '../sim/state';
import { between, GeoBuilder, tf } from './geo';

const C = { skin: '#ae805b', skinLight: '#c49a75', dark: '#292b29', leather: '#65523b', pale: '#d4c8ad', bone: '#e5d5af', blue: '#537b87', green: '#70795a', wood: '#786343', stone: '#93988c' };
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 6);

function block(b: GeoBuilder, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0): void {
  b.add(boxGeo, { color, matrix: tf(x, y, z, 0, 0, rz, sx, sy, sz), vary: 0.04 });
}
function oval(b: GeoBuilder, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  b.add(sphereGeo, { color, matrix: tf(x, y, z, 0, 0, 0, sx, sy, sz), vary: 0.045 });
}
function rod(b: GeoBuilder, color: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
  b.add(cylinderGeo, { color, matrix: between(ax, ay, az, bx, by, bz, r), vary: 0.05 });
}
function flap(b: GeoBuilder, color: string, x: number, y: number, z: number, width: number, length: number, angle = 0): void {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-width / 2, 0, 0, width / 2, 0, 0, width * 0.2, -length, 0.05], 3));
  b.add(g, { color, matrix: tf(x, y, z, 0, angle), vary: 0.07 }); g.dispose();
}

function antlers(b: GeoBuilder, y: number): void {
  for (const sign of [-1, 1]) {
    rod(b, C.wood, sign * 0.13, y, 0, sign * 0.31, y + 0.22, 0, 0.035);
    rod(b, C.wood, sign * 0.31, y + 0.22, 0, sign * 0.39, y + 0.43, -0.015, 0.026);
    rod(b, C.bone, sign * 0.39, y + 0.43, -0.015, sign * 0.38, y + 0.52, 0.02, 0.012);
    rod(b, C.wood, sign * 0.26, y + 0.17, 0, sign * 0.5, y + 0.22, 0.04, 0.02);
    rod(b, C.bone, sign * 0.5, y + 0.22, 0.04, sign * 0.55, y + 0.32, 0.045, 0.012);
  }
}

function torso(role: VillagerRole): THREE.BufferGeometry {
  const b = new GeoBuilder(172 + role.length);
  const fabric = role === 'scout' || role === 'gatherer' ? C.green : C.blue;
  oval(b, fabric, 0, 1.12, 0, 0.28, 0.35, 0.18);
  oval(b, C.dark, 0, 0.86, 0, 0.24, 0.19, 0.15);
  rod(b, C.skin, 0, 1.4, 0, 0, 1.58, 0, 0.08);
  // Overlapping hide panels, a woven sash, individual belt ties and small hand-stitched pouches.
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2;
    flap(b, i % 3 === 0 ? C.leather : i % 3 === 1 ? fabric : C.pale, Math.sin(a) * 0.23, 0.95, Math.cos(a) * 0.15, 0.14, 0.25 + (i % 3) * 0.06, a);
  }
  block(b, C.leather, 0, 1, 0, 0.51, 0.07, 0.35);
  rod(b, C.pale, -0.28, 0.98, 0.15, 0.22, 1.04, 0.16, 0.014);
  for (const x of [-0.2, 0.2]) {
    oval(b, C.leather, x, 0.88, 0.14, 0.075, 0.1, 0.045);
    block(b, C.bone, x, 0.92, 0.185, 0.025, 0.024, 0.008);
    rod(b, C.pale, x, 1, 0.18, x + 0.025, 0.7, 0.19, 0.008);
  }
  rod(b, C.leather, -0.23, 1.4, 0.145, 0.21, 1.03, 0.18, 0.035);
  // Bone ring pendant and three carved beads.
  rod(b, C.pale, -0.11, 1.43, 0.16, 0, 1.23, 0.22, 0.008);
  rod(b, C.pale, 0.11, 1.43, 0.16, 0, 1.23, 0.22, 0.008);
  const ring = new THREE.TorusGeometry(0.051, 0.013, 4, 8);
  b.add(ring, { color: C.bone, matrix: tf(0, 1.21, 0.23) }); ring.dispose();
  for (let i = 0; i < 3; i++) oval(b, i === 1 ? C.blue : C.bone, -0.1 + i * 0.1, 1.3, 0.19, 0.02, 0.027, 0.017);
  // Layered shoulder mantle, deliberately irregular rather than one smooth cone.
  if (role !== 'scout') {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      flap(b, role === 'gatherer' && i % 3 ? C.green : i % 3 ? C.pale : C.bone, Math.sin(a) * 0.27, 1.42, Math.cos(a) * 0.2, 0.18, 0.18 + i % 3 * 0.045, a);
    }
  }
  if (role === 'elder' || role === 'guardian') {
    // A split, patchwork cape down the back; the elder's falls to the ankles.
    const length = role === 'elder' ? 1.05 : 0.5;
    for (let i = 0; i < 7; i++) {
      flap(b, i % 3 === 0 ? C.blue : i % 2 ? C.pale : C.dark, (i - 3) * 0.085, 1.37, -0.22 - Math.abs(i - 3) * 0.008, 0.16, length + (i % 2) * 0.08, Math.PI);
    }
  }
  if (role === 'scout') {
    rod(b, C.leather, 0.15, 1.01, -0.19, 0.22, 1.46, -0.22, 0.075);
    for (let i = 0; i < 5; i++) {
      const x = 0.14 + i * 0.035;
      rod(b, C.wood, x, 1.26, -0.22, x + 0.08, 1.68 + i % 2 * 0.05, -0.25, 0.008);
      flap(b, C.pale, x + 0.06, 1.65 + i % 2 * 0.05, -0.25, 0.065, 0.11, Math.PI);
    }
  }
  if (role === 'gatherer') {
    const basket = new THREE.CylinderGeometry(0.2, 0.16, 0.42, 8, 1, true);
    b.add(basket, { color: '#9a8055', matrix: tf(0, 1.17, -0.34) }); basket.dispose();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      rod(b, C.leather, Math.sin(a) * 0.18, 0.96, -0.34 + Math.cos(a) * 0.18, Math.sin(a) * 0.21, 1.38, -0.34 + Math.cos(a) * 0.21, 0.01);
      oval(b, i % 2 ? C.green : '#85985d', Math.sin(a) * 0.14, 1.41 + i % 3 * 0.07, -0.34 + Math.cos(a) * 0.14, 0.07, 0.15, 0.035);
    }
    for (const x of [-0.16, 0.16]) rod(b, C.leather, x, 1.4, -0.16, x, 1.03, -0.18, 0.024);
  }
  return b.build();
}

function head(role: VillagerRole): THREE.BufferGeometry {
  const b = new GeoBuilder(481 + role.length);
  oval(b, C.skin, 0, 0, 0, 0.158, 0.21, 0.15);
  oval(b, C.skinLight, 0, -0.065, 0.095, 0.115, 0.125, 0.075);
  oval(b, C.skinLight, 0, -0.005, 0.166, 0.029, 0.06, 0.034);
  for (const sign of [-1, 1]) {
    oval(b, C.skin, sign * 0.15, -0.01, 0, 0.032, 0.065, 0.032);
    block(b, '#ddd5c5', sign * 0.065, 0.035, 0.142, 0.056, 0.023, 0.022);
    block(b, '#292725', sign * 0.064, 0.035, 0.158, 0.023, 0.024, 0.012);
    block(b, C.dark, sign * 0.065, 0.072, 0.147, 0.065, 0.015, 0.016, sign * -0.08);
    block(b, C.blue, sign * 0.108, -0.055, 0.128, 0.02, 0.11, 0.023, sign * 0.05);
    oval(b, C.bone, sign * 0.16, -0.07, 0.013, 0.013, 0.025, 0.012);
  }
  block(b, '#734e3b', 0, -0.108, 0.151, 0.058, 0.01, 0.009);
  const hair = role === 'elder' ? '#d6d3c0' : C.dark;
  oval(b, hair, 0, 0.15, -0.02, 0.17, 0.105, 0.16);
  const long = role === 'elder' || role === 'guardian';
  for (let i = 0; i < (long ? 12 : 7); i++) {
    const a = (i / (long ? 12 : 7)) * Math.PI * 2;
    if (Math.cos(a) > 0.55) continue;
    flap(b, i % 3 === 0 && role === 'elder' ? C.pale : hair, Math.sin(a) * 0.16, 0.16, Math.cos(a) * 0.15, 0.105, long ? 0.43 + i % 3 * 0.05 : 0.2, a);
  }
  if (role === 'elder') {
    for (let i = 0; i < 5; i++) flap(b, i % 2 ? C.pale : hair, (i - 2) * 0.03, -0.105, 0.13, 0.055, 0.23 + (2 - Math.abs(i - 2)) * 0.05);
  }
  if (role === 'elder' || role === 'guardian') {
    block(b, C.blue, 0, 0.158, 0.08, 0.29, 0.045, 0.16);
    antlers(b, 0.18);
    block(b, C.bone, 0, 0.08, 0.16, 0.026, 0.13, 0.016);
  }
  if (role === 'scout') {
    // Hood surrounds the face with an open rim and draped cloth at the back.
    for (let i = 0; i < 9; i++) {
      const a = i / 8 * Math.PI;
      oval(b, C.green, Math.cos(a) * 0.17, Math.sin(a) * 0.23 - 0.035, -0.02, 0.055, 0.075, 0.19);
    }
    flap(b, C.green, -0.17, 0.07, -0.07, 0.13, 0.4, -1.7);
    flap(b, C.green, 0.17, 0.07, -0.07, 0.13, 0.4, 1.7);
  }
  if (role === 'gatherer') {
    oval(b, hair, 0, 0.24, -0.08, 0.1, 0.08, 0.09);
    rod(b, C.wood, -0.14, 0.24, -0.08, 0.17, 0.26, -0.08, 0.008);
  }
  return b.build();
}

function limb(part: 'arm' | 'forearm' | 'thigh' | 'shin', role: VillagerRole): THREE.BufferGeometry {
  const b = new GeoBuilder(86 + part.length + role.length);
  const leg = part === 'thigh' || part === 'shin';
  const length = part === 'arm' ? 0.28 : part === 'forearm' ? 0.27 : part === 'thigh' ? 0.38 : 0.39;
  const r = part === 'thigh' ? 0.105 : leg ? 0.08 : 0.065;
  const fabric = role === 'scout' || role === 'gatherer' ? C.green : C.blue;
  rod(b, leg ? C.dark : part === 'arm' ? fabric : C.skin, 0, 0, 0, 0, -length, 0, r);
  if (part === 'thigh') oval(b, role === 'elder' ? C.dark : C.leather, 0, -0.1, 0, 0.115, 0.2, 0.09);
  if (part === 'forearm' || part === 'shin') {
    for (let i = 0; i < 4; i++) rod(b, i % 2 ? C.pale : C.leather, -r, -0.09 - i * 0.045, 0, r, -0.09 - i * 0.045, 0, 0.014);
  }
  if (part === 'forearm') {
    oval(b, C.skinLight, 0, -length - 0.04, 0.005, 0.045, 0.066, 0.04);
    for (let i = 0; i < 3; i++) rod(b, C.skin, -0.025 + i * 0.023, -length - 0.035, 0.035, -0.025 + i * 0.023, -length - 0.08, 0.04, 0.009);
    block(b, C.blue, 0, -0.025, r, 0.09, 0.023, 0.015);
  }
  if (part === 'shin') oval(b, C.leather, 0, -length + 0.01, 0.055, 0.085, 0.09, 0.14);
  return b.build();
}

function equipment(kind: 'staff' | 'spear' | 'shield' | 'bow' | 'axe' | 'herbs'): THREE.BufferGeometry {
  const b = new GeoBuilder(193 + kind.length);
  if (kind === 'staff' || kind === 'spear') {
    rod(b, C.wood, 0, -0.65, 0, 0, 1.1, 0, 0.025);
    if (kind === 'spear') {
      const tip = new THREE.ConeGeometry(0.065, 0.33, 4);
      b.add(tip, { color: C.stone, matrix: tf(0, 1.24, 0, 0, 0, 0, 0.6, 1, 1) }); tip.dispose();
      for (let i = 0; i < 4; i++) block(b, C.pale, 0, 1 + i * 0.025, 0, 0.07, 0.013, 0.07);
    } else {
      const ring = new THREE.TorusGeometry(0.15, 0.025, 5, 10);
      b.add(ring, { color: C.bone, matrix: tf(0, 1.06, 0) }); ring.dispose();
      for (const x of [-0.12, 0.12]) { rod(b, C.leather, x, 1, 0, x, 0.7, 0, 0.007); flap(b, C.blue, x, 0.73, 0, 0.06, 0.19); }
    }
  }
  if (kind === 'shield') {
    const g = new THREE.CylinderGeometry(0.32, 0.34, 0.065, 10);
    b.add(g, { color: C.leather, matrix: tf(0, 0.05, 0.12, Math.PI / 2, 0, 0, 0.92, 1, 1.5) }); g.dispose();
    for (let i = -2; i <= 2; i++) block(b, C.wood, i * 0.1, 0.05, 0.16, 0.009, 0.62 - Math.abs(i) * 0.1, 0.01);
    const ring = new THREE.TorusGeometry(0.105, 0.015, 4, 10);
    b.add(ring, { color: C.bone, matrix: tf(0, 0.05, 0.175) }); ring.dispose();
    block(b, C.bone, 0, 0.05, 0.18, 0.064, 0.064, 0.012, Math.PI / 4);
  }
  if (kind === 'bow') {
    const points = [[0, -0.45, 0], [0, -0.25, 0.13], [0, 0, 0.19], [0, 0.25, 0.13], [0, 0.45, 0]];
    for (let i = 1; i < points.length; i++) rod(b, C.wood, ...points[i - 1] as [number, number, number], ...points[i] as [number, number, number], 0.021);
    rod(b, C.pale, 0, -0.45, 0, 0, 0.45, 0, 0.005);
  }
  if (kind === 'axe') {
    rod(b, C.wood, 0, -0.15, 0, 0, 0.55, 0, 0.022);
    oval(b, C.stone, 0.08, 0.51, 0, 0.14, 0.095, 0.045);
    for (let i = 0; i < 3; i++) block(b, C.pale, 0, 0.47 + i * 0.025, 0, 0.055, 0.01, 0.09);
  }
  if (kind === 'herbs') for (let i = 0; i < 5; i++) {
    rod(b, C.green, 0, -0.05, 0, (i - 2) * 0.04, 0.22, 0, 0.006);
    oval(b, i % 2 ? '#8b9b66' : C.green, (i - 2) * 0.04, 0.19, 0, 0.04, 0.1, 0.018);
  }
  return b.build();
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group[];
  forearms: THREE.Group[];
  legs: THREE.Group[];
  knees: THREE.Group[];
  tools: { group: THREE.Group; task?: string }[];
  phase: number;
}

/** Five distinct, articulated people: layered hides, blue face paint, antlers, tools and woven packs. */
export class VillagerView {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private readonly rigs = new Map<string, Rig>();

  private geometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) { g = build(); this.geos.set(key, g); }
    return g;
  }

  private mesh(parent: THREE.Group, key: string, build: () => THREE.BufferGeometry): void {
    const mesh = new THREE.Mesh(this.geometry(key, build), this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }

  private build(role: VillagerRole): Rig {
    const root = new THREE.Group(), body = new THREE.Group(), headGroup = new THREE.Group();
    root.name = `villager-${role}`; root.add(body); body.add(headGroup); headGroup.position.y = 1.67;
    this.mesh(body, `${role}:body`, () => torso(role));
    this.mesh(headGroup, `${role}:head`, () => head(role));
    const rig: Rig = { root, body, head: headGroup, arms: [], forearms: [], legs: [], knees: [], tools: [], phase: 0 };
    for (const sign of [-1, 1]) {
      const arm = new THREE.Group(), forearm = new THREE.Group(), thigh = new THREE.Group(), knee = new THREE.Group();
      arm.position.set(sign * 0.3, 1.4, 0); forearm.position.y = -0.28;
      thigh.position.set(sign * 0.12, 0.89, 0); knee.position.y = -0.38;
      body.add(arm, thigh); arm.add(forearm); thigh.add(knee);
      this.mesh(arm, `${role}:arm`, () => limb('arm', role)); this.mesh(forearm, `${role}:forearm`, () => limb('forearm', role));
      this.mesh(thigh, `${role}:thigh`, () => limb('thigh', role)); this.mesh(knee, `${role}:shin`, () => limb('shin', role));
      rig.arms.push(arm); rig.forearms.push(forearm); rig.legs.push(thigh); rig.knees.push(knee);
    }
    const tool = (kind: Parameters<typeof equipment>[0], arm: number, task?: string) => {
      const group = new THREE.Group(); group.position.set(0, -0.3, 0.07);
      rig.forearms[arm].add(group); this.mesh(group, `tool:${kind}`, () => equipment(kind)); rig.tools.push({ group, task });
    };
    if (role === 'elder') tool('staff', 1);
    if (role === 'guardian') { tool('spear', 1); tool('shield', 0); }
    if (role === 'scout') tool('bow', 0);
    if (role === 'gatherer') tool('herbs', 0, 'gather');
    if (role === 'guardian' || role === 'gatherer') tool('axe', 1, 'chop');
    if (role === 'young') root.scale.setScalar(0.73);
    this.group.add(root);
    return rig;
  }

  update(state: GameState, dt: number, time: number, camX: number, camZ: number): void {
    const live = new Set<string>();
    for (const camp of state.settlements ?? []) {
      const tribe = tribeFor(camp.tribe, state.biome ?? 'pnw');
      if (!tribe) continue;
      for (const n of camp.members) {
        const member = tribe.members.find((m) => m.id === n.id);
        if (!member) continue;
        const key = `${camp.tribe}:${n.id}`; live.add(key);
        let rig = this.rigs.get(key);
        if (!rig) { rig = this.build(member.role); this.rigs.set(key, rig); }
        this.pose(rig, n, dt, time, camX, camZ);
      }
    }
    for (const [key, rig] of this.rigs) if (!live.has(key)) { this.group.remove(rig.root); this.rigs.delete(key); }
  }

  private pose(r: Rig, n: VillagerState, dt: number, time: number, camX: number, camZ: number): void {
    r.root.visible = Math.hypot(n.x - camX, n.z - camZ) < 115;
    if (!r.root.visible) return;
    if (Math.hypot(r.root.position.x - n.x, r.root.position.z - n.z) > 6 || dt <= 0) r.root.position.set(n.x, n.y, n.z);
    else r.root.position.set(damp(r.root.position.x, n.x, 16, dt), damp(r.root.position.y, n.y, 16, dt), damp(r.root.position.z, n.z, 16, dt));
    r.root.rotation.y = turnToward(r.root.rotation.y, n.heading, dt > 0 ? dt * 8 : Math.PI * 2);
    const moving = Math.min(1, n.speed / 1.35);
    r.phase += dt * n.speed * 5.5;
    const work = n.phase === 'work';
    const chop = work && n.task === 'chop', craft = work && n.task === 'craft', gather = work && n.task === 'gather', hunt = work && n.task === 'hunt';
    const bend = gather ? 0.45 : craft ? 0.16 : 0;
    r.body.rotation.x = damp(r.body.rotation.x, bend, 6, dt);
    r.body.position.y = Math.sin(r.phase * 2) * 0.015 * moving + Math.sin(time * 1.6) * 0.004;
    r.head.rotation.x = damp(r.head.rotation.x, gather ? 0.22 : craft ? 0.12 : -0.025 + Math.sin(time * 0.4) * 0.025, 5, dt);
    for (let i = 0; i < 2; i++) {
      const stride = Math.sin(r.phase + i * Math.PI);
      r.legs[i].rotation.x = stride * 0.45 * moving;
      r.knees[i].rotation.x = Math.max(0, -stride) * 0.55 * moving;
      const arm = chop ? -0.6 - Math.max(0, Math.sin(time * 4)) * 0.9 : craft ? -0.65 + Math.sin(time * 5 + i) * 0.16 : hunt ? -1.1 : gather ? -0.6 : -stride * 0.4 * moving;
      r.arms[i].rotation.x = damp(r.arms[i].rotation.x, arm, 8, dt);
      r.arms[i].rotation.z = i === 0 ? 0.07 : -0.07;
      r.forearms[i].rotation.x = damp(r.forearms[i].rotation.x, hunt && i === 1 ? -1 : craft ? -0.5 : -0.1, 8, dt);
    }
    for (const t of r.tools) {
      t.group.visible = t.task ? n.task === t.task : !(work && ['craft', 'gather'].includes(n.task)) && !(n.task === 'chop' && t.group.parent === r.forearms[1]);
    }
  }

  dispose(): void {
    for (const geo of this.geos.values()) geo.dispose();
    this.geos.clear(); this.rigs.clear(); this.group.clear(); this.material.dispose();
  }
}
