import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { ToolId } from '../data/items';
import type { Avatar } from '../net/protocol';
import { F_AIR, F_DEAD, F_SIT, F_SLEEP, F_SWIM } from '../net/protocol';
import type { Peer } from '../net/peers';
import { between, col, GeoBuilder, mix, tf } from './geo';

const { BoxGeometry, CylinderGeometry, IcosahedronGeometry, ConeGeometry, DodecahedronGeometry } = THREE;

interface Palette {
  skin: string;
  hair: string;
  shirt: string;
  shirtDark: string;
  pants: string;
  boots: string;
  hat: string | null;
}

const PALETTES: Record<Avatar, Palette> = {
  m: { skin: '#dfb08a', hair: '#5a3b26', shirt: '#b0443a', shirtDark: '#6e2622', pants: '#3f5877', boots: '#4a3222', hat: '#3f6b4a' },
  f: { skin: '#e6bb97', hair: '#8a4526', shirt: '#2f7f7a', shirtDark: '#1d5552', pants: '#4a3b33', boots: '#5a3a28', hat: null },
};

interface AvatarParts {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
}

const HIP_Y = 0.92;
const SHOULDER_Y = 1.43;
const NECK_Y = 1.52;

function flannel(p: Palette) {
  return (x: number, y: number) => {
    const band = (Math.floor(x * 14 + 40) + Math.floor(y * 14 + 40)) % 2 === 0;
    return band ? col(p.shirt) : mix(p.shirt, p.shirtDark, 0.55);
  };
}

function buildParts(kind: Avatar): AvatarParts {
  const p = PALETTES[kind];
  const female = kind === 'f';
  const torso = new GeoBuilder(kind === 'm' ? 31 : 37);
  const shirt = kind === 'm' ? flannel(p) : (_x: number, y: number) => mix(p.shirt, p.shirtDark, y < 1.0 ? 0.5 : 0);
  // Jacket/shirt body, a little narrower at the waist for the female model.
  torso.add(new CylinderGeometry(female ? 0.2 : 0.23, female ? 0.17 : 0.2, 0.58, 7, 2), { matrix: tf(0, 1.2, 0, 0, 0, 0, 1, 1, 0.68), color: shirt, jitter: 0.012 });
  torso.add(new CylinderGeometry(0.19, 0.2, 0.16, 7), { matrix: tf(0, 0.94, 0, 0, 0, 0, 1, 1, 0.7), color: p.pants });
  torso.add(new BoxGeometry(0.34, 0.05, 0.19), { matrix: tf(0, 1.01, 0), color: '#3a2a1e' });
  torso.add(new CylinderGeometry(0.06, 0.07, 0.08, 6), { matrix: tf(0, 1.5, 0), color: p.skin });
  if (female) {
    torso.add(new BoxGeometry(0.12, 0.34, 0.03), { matrix: tf(0, 1.25, 0.14), color: '#e8dcc4' });
  } else {
    torso.add(new BoxGeometry(0.03, 0.5, 0.02), { matrix: tf(0, 1.22, 0.16), color: p.shirtDark });
  }

  const head = new GeoBuilder(kind === 'm' ? 41 : 43);
  head.add(new IcosahedronGeometry(0.13, 1), { matrix: tf(0, 0.12, 0, 0, 0, 0, 0.92, 1.05, 0.98), color: p.skin, jitter: 0.008 });
  head.add(new BoxGeometry(0.04, 0.05, 0.04), { matrix: tf(0, 0.1, 0.13), color: mix(p.skin, '#b07a58', 0.35) });
  for (const s of [-1, 1]) head.add(new BoxGeometry(0.026, 0.026, 0.01), { matrix: tf(s * 0.047, 0.15, 0.123), color: '#231a14', vary: 0 });
  if (female) {
    head.add(new IcosahedronGeometry(0.145, 1), { matrix: tf(0, 0.17, -0.02, 0, 0, 0, 1, 0.82, 1.02), color: p.hair, jitter: 0.012, warp: (v) => (v.z > 0.07 && v.y < 0.06 ? (v.z = 0.07) : undefined) });
    head.add(new ConeGeometry(0.07, 0.32, 6), { matrix: tf(0, 0.02, -0.16, -0.35, 0, Math.PI), color: p.hair, jitter: 0.01 });
    head.add(new IcosahedronGeometry(0.05, 0), { matrix: tf(0, 0.16, -0.14), color: mix(p.hair, '#3a1d10', 0.4) });
  } else {
    head.add(new IcosahedronGeometry(0.138, 1), { matrix: tf(0, 0.2, -0.01, 0, 0, 0, 1, 0.62, 1), color: p.hair, jitter: 0.01 });
    head.add(new IcosahedronGeometry(0.1, 1), { matrix: tf(0, 0.03, 0.06, 0, 0, 0, 1.05, 0.72, 0.8), color: p.hair, jitter: 0.012, warp: (v) => (v.y > 0.02 ? (v.y = 0.02) : undefined) });
    head.add(new CylinderGeometry(0.14, 0.145, 0.1, 8), { matrix: tf(0, 0.25, -0.005), color: p.hat! });
    head.add(new CylinderGeometry(0.146, 0.146, 0.04, 8), { matrix: tf(0, 0.2, -0.005), color: mix(p.hat!, '#ffffff', 0.25) });
    head.add(new IcosahedronGeometry(0.04, 0), { matrix: tf(0, 0.33, -0.005), color: '#e0c36a' });
  }

  const arm = new GeoBuilder(51);
  arm.add(new CylinderGeometry(0.06, 0.05, 0.36, 6), { matrix: tf(0, -0.18, 0), color: kind === 'm' ? flannel(p) : p.shirt });
  arm.add(new CylinderGeometry(0.05, 0.042, 0.24, 6), { matrix: tf(0, -0.46, 0), color: kind === 'm' ? mix(p.shirt, p.shirtDark, 0.3) : p.shirtDark });
  arm.add(new IcosahedronGeometry(0.048, 0), { matrix: tf(0, -0.62, 0.01), color: p.skin });

  const leg = new GeoBuilder(61);
  leg.add(new CylinderGeometry(0.085, 0.07, 0.46, 6), { matrix: tf(0, -0.23, 0), color: p.pants, jitter: 0.006 });
  leg.add(new CylinderGeometry(0.07, 0.06, 0.34, 6), { matrix: tf(0, -0.63, 0), color: mix(p.pants, '#1b1a22', 0.2) });
  leg.add(new BoxGeometry(0.12, 0.1, 0.22), { matrix: tf(0, -0.86, 0.04), color: p.boots });
  return { torso: torso.build(), head: head.build(), arm: arm.build(), leg: leg.build() };
}

function toolGeometry(tool: ToolId): THREE.BufferGeometry | null {
  const b = new GeoBuilder(71);
  switch (tool) {
    case 'axe':
      b.add(new CylinderGeometry(0.02, 0.022, 0.62, 5), { matrix: tf(0, 0, 0.12, Math.PI / 2, 0, 0), color: '#8a6440' });
      b.add(new BoxGeometry(0.03, 0.14, 0.12), { matrix: tf(0, 0.06, 0.4), color: '#8d8a84' });
      break;
    case 'spear':
      b.add(new CylinderGeometry(0.018, 0.02, 1.7, 5), { matrix: tf(0, 0, 0.35, Math.PI / 2, 0, 0), color: '#9a7449' });
      b.add(new ConeGeometry(0.04, 0.16, 5), { matrix: tf(0, 0, 1.25, Math.PI / 2, 0, 0), color: '#6f6b66' });
      break;
    case 'torch':
      b.add(new CylinderGeometry(0.022, 0.028, 0.5, 5), { matrix: tf(0, 0.1, 0.05, -0.3, 0, 0), color: '#6d4d2f' });
      b.add(new DodecahedronGeometry(0.06, 0), { matrix: tf(0, 0.36, 0.13), color: '#ffb347', vary: 0 });
      break;
    case 'bow':
      for (let i = 0; i < 6; i++) {
        const a0 = -0.9 + (i / 6) * 1.8;
        const a1 = -0.9 + ((i + 1) / 6) * 1.8;
        b.add(new CylinderGeometry(0.014, 0.014, 1, 4), { matrix: between(0, Math.sin(a0) * 0.5, Math.cos(a0) * 0.18, 0, Math.sin(a1) * 0.5, Math.cos(a1) * 0.18), color: '#7a5634' });
      }
      break;
    default:
      return null;
  }
  return b.build();
}

const partCache = new Map<Avatar, AvatarParts>();
const toolCache = new Map<ToolId, THREE.BufferGeometry | null>();

function parts(kind: Avatar): AvatarParts {
  let p = partCache.get(kind);
  if (!p) partCache.set(kind, (p = buildParts(kind)));
  return p;
}

function toolGeo(tool: ToolId): THREE.BufferGeometry | null {
  if (!toolCache.has(tool)) toolCache.set(tool, toolGeometry(tool));
  return toolCache.get(tool)!;
}

/** One posable low-poly person, facing +Z. */
export class AvatarModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head: THREE.Mesh;
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  private readonly hand = new THREE.Group();
  private toolMesh: THREE.Mesh | null = null;
  private tool: ToolId = 'hands';
  private readonly material: THREE.Material;

  constructor(kind: Avatar, material: THREE.Material) {
    this.material = material;
    const g = parts(kind);
    const mesh = (geo: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(geo, material);
      m.castShadow = true;
      return m;
    };
    this.root.add(this.body);
    this.body.add(mesh(g.torso));
    this.head = mesh(g.head);
    this.head.position.y = NECK_Y;
    this.body.add(this.head);
    this.armL.position.set(0.25, SHOULDER_Y, 0);
    this.armR.position.set(-0.25, SHOULDER_Y, 0);
    this.armL.add(mesh(g.arm));
    this.armR.add(mesh(g.arm));
    this.hand.position.set(0, -0.62, 0.02);
    this.armR.add(this.hand);
    this.legL.position.set(0.1, HIP_Y, 0);
    this.legR.position.set(-0.1, HIP_Y, 0);
    this.legL.add(mesh(g.leg));
    this.legR.add(mesh(g.leg));
    this.body.add(this.armL, this.armR, this.legL, this.legR);
  }

  setTool(tool: ToolId): void {
    if (tool === this.tool) return;
    this.tool = tool;
    if (this.toolMesh) this.hand.remove(this.toolMesh);
    const geo = toolGeo(tool);
    this.toolMesh = geo ? new THREE.Mesh(geo, this.material) : null;
    if (this.toolMesh) {
      this.toolMesh.rotation.x = -Math.PI / 2;
      this.hand.add(this.toolMesh);
    }
  }
}

/** Canvas-backed label sprite (name tags and chat bubbles). */
class Label {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private readonly bubble: boolean;
  private text = '';
  aspect = 1;

  constructor(bubble: boolean) {
    this.bubble = bubble;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, transparent: true, fog: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.renderOrder = 10;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const font = this.bubble ? '600 30px ui-rounded, system-ui, sans-serif' : '800 34px ui-rounded, system-ui, sans-serif';
    ctx.font = font;
    const lines = this.bubble ? wrap(ctx, text, 460) : [text];
    const w = Math.ceil(Math.min(520, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36));
    const lh = this.bubble ? 38 : 44;
    const h = lines.length * lh + (this.bubble ? 26 : 14);
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = this.bubble ? 'rgba(250, 244, 232, 0.95)' : 'rgba(24, 18, 14, 0.62)';
    roundRect(ctx, 2, 2, w - 4, h - 4, this.bubble ? 18 : 20);
    ctx.fill();
    ctx.fillStyle = this.bubble ? '#2a211b' : '#fff4df';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, (this.bubble ? 13 : 7) + lh * (i + 0.5)));
    this.aspect = w / h;
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
    if (lines.length === 3) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  return lines.slice(0, 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface AvatarView {
  model: AvatarModel;
  tag: Label;
  bubble: Label;
  phase: number;
  lie: number;
  sit: number;
  swim: number;
  stamp: number;
}

const CHAT_SHOW = 6;

/** Every other player in the world: body, held tool, name tag, chat bubble and simple animations. */
export class AvatarLayer {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, AvatarView>();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private stamp = 0;

  update(peers: Iterable<Peer>, dt: number, camX: number, camY: number, camZ: number): void {
    this.stamp++;
    for (const peer of peers) {
      if (!peer.target) continue;
      let v = this.views.get(peer.pid);
      if (!v) {
        const model = new AvatarModel(peer.avatar, this.material);
        v = { model, tag: new Label(false), bubble: new Label(true), phase: 0, lie: 0, sit: 0, swim: 0, stamp: 0 };
        model.root.add(v.tag.sprite, v.bubble.sprite);
        this.group.add(model.root);
        this.views.set(peer.pid, v);
      }
      v.stamp = this.stamp;
      this.pose(v, peer, dt, camX, camY, camZ);
    }
    for (const [pid, v] of this.views) {
      if (v.stamp === this.stamp) continue;
      this.group.remove(v.model.root);
      v.tag.dispose();
      v.bubble.dispose();
      this.views.delete(pid);
    }
  }

  private pose(v: AvatarView, peer: Peer, dt: number, camX: number, camY: number, camZ: number): void {
    const m = v.model;
    const f = peer.flags;
    const lying = f & (F_SLEEP | F_DEAD) ? 1 : 0;
    v.lie = damp(v.lie, lying, 5, dt);
    v.sit = damp(v.sit, f & F_SIT && !lying ? 1 : 0, 8, dt);
    v.swim = damp(v.swim, f & F_SWIM && !lying ? 1 : 0, 5, dt);
    m.root.position.set(peer.x, peer.y, peer.z);
    m.root.rotation.y = peer.yaw + Math.PI;
    m.setTool(lying ? 'hands' : peer.tool);

    const speed = peer.speed;
    const moveK = clamp(speed / 3, 0, 1.4);
    v.phase += dt * (speed * 2.1 + v.swim * 3);
    const s = Math.sin(v.phase);
    const air = f & F_AIR ? 1 : 0;
    const legAmp = 0.62 * moveK * (1 - v.sit) * (1 - v.swim) * (1 - air * 0.6);
    m.legL.rotation.x = s * legAmp - v.sit * 1.45 - air * 0.35 + v.swim * Math.sin(v.phase * 2) * 0.35;
    m.legR.rotation.x = -s * legAmp - v.sit * 1.45 - air * 0.2 - v.swim * Math.sin(v.phase * 2) * 0.35;
    let armLx = -s * 0.5 * moveK * (1 - v.swim) - v.sit * 0.3;
    let armRx = s * 0.5 * moveK * (1 - v.swim) - v.sit * 0.3;
    let armRz = 0;
    let armLz = 0;
    if (v.swim > 0.01) {
      armLx += v.swim * (-1.6 + Math.sin(v.phase) * 1.3);
      armRx += v.swim * (-1.6 - Math.sin(v.phase) * 1.3);
    }
    if (peer.swingT < 0.45 && !lying) {
      const k = peer.swingT / 0.45;
      armRx = k < 0.35 ? -2.6 * (k / 0.35) : -2.6 + 2.4 * ((k - 0.35) / 0.65);
    } else if (peer.tool !== 'hands' && !lying && v.swim < 0.5) {
      armRx = Math.min(armRx, -0.45);
    }
    if (peer.waveT < 2.2 && !lying) {
      armRx = 0;
      armRz = -2.7 + Math.sin(peer.waveT * 11) * 0.35;
    }
    if (v.lie > 0.01) {
      armLz += v.lie * 0.5;
      armRz += v.lie * -0.5;
    }
    m.armL.rotation.set(armLx, 0, armLz);
    m.armR.rotation.set(armRx, 0, armRz);
    m.head.rotation.x = clamp(-(peer.target?.pitch ?? 0) * 0.6, -0.5, 0.5) * (1 - v.lie);
    // Lying (asleep or dead), sitting, swimming.
    m.body.rotation.x = v.lie * (-Math.PI / 2) + v.swim * 1.2 + (1 - v.lie) * moveK * 0.06;
    m.body.position.y = -v.sit * 0.47 + v.lie * 0.15 - v.swim * 0.95 + (1 - v.lie) * Math.abs(Math.sin(v.phase)) * 0.035 * moveK;
    m.body.position.z = v.lie * 0.9;

    // Labels keep a readable on-screen size at any distance.
    const d = Math.hypot(peer.x - camX, peer.y + 2 - camY, peer.z - camZ);
    const k = clamp(d * 0.028, 0.28, 1.6);
    const topY = 2.12 - v.lie * 1.5 - v.sit * 0.45 - v.swim * 0.9;
    v.tag.set(peer.name);
    v.tag.sprite.scale.set(k * 0.36 * v.tag.aspect, k * 0.36, 1);
    v.tag.sprite.position.set(0, topY + k * 0.1, 0);
    const chat = peer.chatT < CHAT_SHOW ? peer.chat : f & F_SLEEP ? 'Zzz…' : '';
    v.bubble.sprite.visible = !!chat && d < 60;
    if (chat) {
      v.bubble.set(chat);
      v.bubble.sprite.scale.set(k * 0.3 * v.bubble.aspect, k * 0.3, 1);
      v.bubble.sprite.position.set(0, topY + k * 0.3 + k * 0.15, 0);
    }
  }

  clear(): void {
    this.update([], 0, 0, 0, 0);
  }
}

/** A still portrait of an avatar for the character picker, drawn with the game's renderer. */
export function avatarPortrait(renderer: THREE.WebGLRenderer, kind: Avatar, w = 220, h = 280): string {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3a2f26');
  scene.add(new THREE.HemisphereLight('#fff1dc', '#3a2e24', 2.2));
  const sun = new THREE.DirectionalLight('#ffd9a8', 2.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const model = new AvatarModel(kind, material);
  model.root.rotation.y = -0.45;
  model.armR.rotation.x = -0.15;
  model.armL.rotation.x = 0.1;
  scene.add(model.root);
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 30);
  cam.position.set(0, 1.2, 4.3);
  cam.lookAt(0, 0.98, 0);
  const pr = renderer.getPixelRatio();
  const prevViewport = renderer.getViewport(new THREE.Vector4());
  const prevScissor = renderer.getScissor(new THREE.Vector4());
  const prevTest = renderer.getScissorTest();
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, w / pr, h / pr);
  renderer.setScissor(0, 0, w / pr, h / pr);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const gl = renderer.domElement;
  out.getContext('2d')?.drawImage(gl, 0, gl.height - h, w, h, 0, 0, w, h);
  renderer.setScissorTest(prevTest);
  renderer.setViewport(prevViewport);
  renderer.setScissor(prevScissor);
  material.dispose();
  return out.toDataURL('image/png');
}
