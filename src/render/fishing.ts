import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { BALANCE } from '../data/balance';
import type { FishingLine } from '../sim/simulation';
import { WATER_LEVEL } from '../sim/terrain';
import { col, GeoBuilder } from './geo';

const LINE_POINTS = 14;

/** The float and line out on the water while fishing. */
export class FishingView {
  readonly group = new THREE.Group();
  private readonly float: THREE.Mesh;
  private readonly line: THREE.Line;
  private readonly pos: THREE.BufferAttribute;
  private readonly tip = new THREE.Vector3();
  private readonly lure = new THREE.Vector3();

  constructor() {
    const b = new GeoBuilder(3);
    b.add(new THREE.SphereGeometry(0.07, 10, 6), { color: (_x, y) => col(y > 0 ? '#d8452f' : '#f2ede2'), vary: 0.02 });
    this.float = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.pos = new THREE.BufferAttribute(new Float32Array((LINE_POINTS + 1) * 3), 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.pos);
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ece7dc', transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false;
    this.group.add(this.float, this.line);
    this.group.visible = false;
  }

  update(f: FishingLine | null, cam: THREE.Camera, time: number, toolTip?: THREE.Vector3): void {
    if (!f || f.phase === 'charging') {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (toolTip) this.tip.copy(toolTip);
    else this.tip.set(0.5, 0.45, -1.8).applyMatrix4(cam.matrixWorld);
    const water = WATER_LEVEL + 0.03;
    if (f.phase === 'flying') {
      const k = clamp(f.t / BALANCE.fishing.flightSeconds, 0, 1);
      this.lure.set(lerp(this.tip.x, f.x, k), lerp(this.tip.y, water, k) + Math.sin(k * Math.PI) * (1 + f.power * 2), lerp(this.tip.z, f.z, k));
    } else {
      const dip = f.phase === 'bite' ? -0.08 + Math.sin(time * 28) * 0.03 : Math.sin(time * 2.3) * 0.012;
      this.lure.set(f.x, water + dip, f.z);
    }
    this.float.position.copy(this.lure);
    const span = this.tip.distanceTo(this.lure);
    const sag = f.phase === 'flying' ? 0.05 : Math.min(1.2, span * 0.06);
    for (let i = 0; i <= LINE_POINTS; i++) {
      const t = i / LINE_POINTS;
      const y = lerp(this.tip.y, this.lure.y, t) - Math.sin(t * Math.PI) * sag;
      this.pos.setXYZ(i, lerp(this.tip.x, this.lure.x, t), f.phase === 'flying' ? y : Math.max(y, water), lerp(this.tip.z, this.lure.z, t));
    }
    this.pos.needsUpdate = true;
  }
}
