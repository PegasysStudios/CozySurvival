import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { TOOL_ORDER, type ToolId } from '../data/items';
import { arrowGeometry, bowStringGeometry, flameGeometry, toolGeometry } from './props';

export interface ViewModelInput {
  tool: ToolId;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  lookDX: number;
  lookDY: number;
  /** Bow draw or fishing-cast wind-up fraction 0..1, or -1 when not drawing. */
  draw: number;
  sitting: boolean;
  hasArrows: boolean;
}

type SwingKind = 'chop' | 'thrust' | 'grab' | 'swipe' | 'cast';

/** First-person tool rendered in its own scene on top of the world (no clipping into trees). */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  readonly sun = new THREE.DirectionalLight('#ffffff', 1.5);
  readonly torchGlow = new THREE.PointLight('#ffa050', 0, 3, 1.5);
  private readonly holder = new THREE.Group();
  private readonly tools = new Map<ToolId, THREE.Group>();
  private readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly string: THREE.Line;
  private readonly nocked: THREE.Mesh;
  private readonly flame: THREE.Mesh;
  private current: ToolId = 'hands';
  private equipT = 1;
  private swingT = 1;
  private swingKind: SwingKind = 'grab';
  private swingHit = false;
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  private walkK = 0;
  private drawK = 0;

  constructor() {
    this.scene.add(this.hemi, this.sun, this.sun.target, this.camera);
    this.sun.position.set(0.5, 1, 0.6);
    this.camera.add(this.holder);
    this.holder.add(this.torchGlow);
    this.torchGlow.position.set(0.1, 0.55, -0.3);
    for (const id of TOOL_ORDER) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(toolGeometry(id), this.mat));
      g.visible = id === 'hands';
      this.tools.set(id, g);
      this.holder.add(g);
    }
    this.string = new THREE.Line(bowStringGeometry(), new THREE.LineBasicMaterial({ color: '#e8dfcc' }));
    this.tools.get('bow')!.add(this.string);
    this.nocked = new THREE.Mesh(arrowGeometry(), this.mat);
    this.nocked.rotation.set(0, Math.PI, 0);
    this.nocked.visible = false;
    this.tools.get('bow')!.add(this.nocked);
    this.flame = new THREE.Mesh(flameGeometry(), this.flameMat);
    this.flame.scale.setScalar(0.28);
    this.flame.position.set(0, 0.5, -0.02);
    this.tools.get('torch')!.add(this.flame);
    this.holder.position.set(0.3, -0.34, -0.5);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  swing(tool: ToolId, hit: boolean): void {
    this.swingT = 0;
    this.swingHit = hit;
    this.swingKind = tool === 'axe' ? 'chop' : tool === 'spear' ? 'thrust' : tool === 'torch' || tool === 'knife' ? 'swipe' : tool === 'rod' ? 'cast' : 'grab';
  }

  /** World-space position of the torch flame (for embers). */
  flameWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.flame.getWorldPosition(out);
  }

  update(dt: number, time: number, i: ViewModelInput): void {
    if (i.tool !== this.current) {
      this.equipT = 0;
      this.tools.get(this.current)!.visible = false;
      this.current = i.tool;
      this.tools.get(this.current)!.visible = true;
      this.swingT = 1;
    }
    this.equipT = Math.min(1, this.equipT + dt * 3.2);
    this.swingT = Math.min(1, this.swingT + dt / (this.swingKind === 'thrust' ? 0.42 : 0.36));

    const moving = i.grounded && i.speed > 0.4 && !i.sitting;
    this.walkK = damp(this.walkK, moving ? Math.min(1.4, i.speed / 4.3) : 0, 8, dt);
    this.bob += dt * (i.sprinting ? 11 : 8.2) * (moving ? 1 : 0.2);
    this.swayX = damp(this.swayX, clamp(-i.lookDX * 0.0009, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(i.lookDY * 0.0009, -0.05, 0.05), 10, dt);
    this.drawK = damp(this.drawK, i.draw >= 0 ? i.draw : 0, 14, dt);

    const breathe = Math.sin(time * 1.6) * 0.006;
    const bx = Math.cos(this.bob) * 0.018 * this.walkK;
    const by = -Math.abs(Math.sin(this.bob)) * 0.026 * this.walkK;
    const equip = 1 - this.equipT;
    const h = this.holder;
    h.position.set(0.3 + bx + this.swayX, -0.34 + by + breathe - equip * equip * 0.45 + this.swayY - (i.sprinting ? 0.04 : 0), -0.5);
    h.rotation.set(this.swayY * 2 + (i.sprinting ? 0.25 : 0), this.swayX * 2, 0);

    const s = this.swingT;
    const env = s < 1 ? Math.sin(s * Math.PI) : 0;
    switch (this.swingKind) {
      case 'chop': {
        let c: number;
        if (s < 0.25) c = 0.55 * (1 - (1 - s / 0.25) ** 2);
        else if (s < 0.45) c = 0.55 - 1.6 * ((s - 0.25) / 0.2) ** 2;
        else {
          const t = (s - 0.45) / 0.55;
          c = -1.05 * (1 - t * t * (3 - 2 * t));
        }
        if (s >= 1) c = 0;
        h.rotation.x += c * (this.swingHit ? 1 : 0.9);
        h.position.z -= Math.max(0, -c) * 0.12;
        h.position.y += Math.max(0, c) * 0.06;
        break;
      }
      case 'thrust':
        h.position.z -= env * 0.38;
        h.position.x -= env * 0.08;
        h.rotation.x -= env * 0.15;
        break;
      case 'swipe':
        h.rotation.z += env * 0.8;
        h.position.x -= env * 0.18;
        break;
      case 'cast':
        h.rotation.x -= env * 0.5;
        h.position.z -= env * 0.1;
        break;
      case 'grab':
        h.position.z -= env * 0.22;
        h.position.y -= env * 0.08;
        h.rotation.x -= env * 0.4;
        break;
    }

    if (i.tool === 'bow') {
      h.rotation.z += 0.45 - this.drawK * 0.35;
      h.position.x -= 0.12 + this.drawK * 0.08;
      h.position.z += this.drawK * 0.06;
      const pos = this.string.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setZ(1, -0.02 + this.drawK * 0.32);
      pos.needsUpdate = true;
      this.nocked.visible = i.hasArrows && (i.draw >= 0 || this.swingT >= 1);
      this.nocked.position.set(0, 0.04, -0.02 + this.drawK * 0.32 - 0.3);
    }
    if (i.tool === 'rod') {
      h.rotation.x += this.drawK * 0.9;
      h.position.y += this.drawK * 0.05;
    }
    if (i.tool === 'torch') {
      const f = 1 + Math.sin(time * 14) * 0.08 + Math.sin(time * 23) * 0.05;
      this.flame.scale.set(0.28 * f, 0.3 * (2 - f), 0.28 * f);
      this.torchGlow.intensity = 1.6 * f;
    } else {
      this.torchGlow.intensity = 0;
    }
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
    });
    this.mat.dispose();
    this.flameMat.dispose();
  }
}
