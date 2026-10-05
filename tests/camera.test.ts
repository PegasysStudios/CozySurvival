import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { RESOURCES } from '../src/data/resources';
import { LocalAvatar } from '../src/render/avatars';
import { PlayerCamera } from '../src/render/camera';
import { CameraWorld } from '../src/render/cameraWorld';
import type { CameraPose } from '../src/render/view';
import { countItem } from '../src/sim/inventory';
import { lookDir } from '../src/sim/movement';
import { IDLE_INPUT, type SimInput, type Simulation } from '../src/sim/simulation';
import { Terrain } from '../src/sim/terrain';
import { aimAt, fakeTerrain, give, giveRecipe, nearestResource, quietSim, teleport } from './helpers';

const eyeY = BALANCE.player.eyeHeight;
const pose = (): CameraPose => ({ x: 0, y: eyeY, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 72 });
const clear = (_o: THREE.Vector3, _d: THREE.Vector3, length: number) => length;
function settle(camera: PlayerCamera, clip = clear, dt = 1 / 60): CameraPose {
  let p = pose();
  for (let i = 0; i < Math.round(2 / dt); i++) {
    p = pose();
    camera.update(p, dt, clip);
  }
  return p;
}
function flatWorld(height = 0): Simulation {
  const terrain = fakeTerrain(() => height);
  terrain.raycast = Terrain.prototype.raycast;
  return { terrain } as Simulation;
}
function obstacle(x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.userData.cameraObstacle = true;
  m.updateMatrixWorld(true);
  return m;
}
function toward(x: number, y: number, z: number): NonNullable<SimInput['resolveAim']> {
  return (eye, out) => {
    const len = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
    out.x = (x - eye.x) / len;
    out.y = (y - eye.y) / len;
    out.z = (z - eye.z) / len;
  };
}

describe('player camera views', () => {
  it('starts in first person and cycles close, far, first person', () => {
    const c = new PlayerCamera();
    expect(c.mode).toBe('firstPerson');
    expect(c.active).toBe(false);
    expect(c.cycle()).toBe('thirdPersonClose');
    const near = settle(c);
    expect(near.z).toBeCloseTo(2.8, 4);
    expect(near.x).toBeCloseTo(0.65, 4);
    expect(c.avatarOpacity).toBe(1);
    expect(c.cycle()).toBe('thirdPersonFar');
    expect(settle(c).z).toBeCloseTo(5.6, 4);
    expect(c.cycle()).toBe('firstPerson');
    expect(settle(c)).toEqual(pose());
    expect(c.active).toBe(false);
    expect(c.avatarOpacity).toBe(0);
  });

  it('eases view switches with equivalent results at 30, 60 and 144 fps', () => {
    const positions = [30, 60, 144].map((fps) => {
      const c = new PlayerCamera();
      c.cycle();
      const p = pose();
      c.update(p, 1 / fps, clear);
      expect(p.z).toBeGreaterThan(0);
      expect(p.z).toBeLessThan(2.8);
      return settle(c, clear, 1 / fps).z;
    });
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.001);
  });

  it('tracks movement and mouse look immediately, including vertical pitch and full-turn yaw', () => {
    const c = new PlayerCamera();
    c.cycle();
    settle(c);
    for (const pitch of [-1.5, 0, 1.5]) {
      const p = { ...pose(), x: 30, y: 12, z: -15, yaw: Math.PI * 4 + 0.4, pitch };
      c.update(p, 1 / 60, clear);
      expect(p.yaw).toBe(Math.PI * 4 + 0.4);
      expect(p.pitch).toBe(pitch);
      expect(Math.hypot(p.x - 30, p.y - 12, p.z + 15)).toBeLessThan(3);
      expect(Object.values(p).every(Number.isFinite)).toBe(true);
    }
  });

  it('pulls in immediately for an obstacle, fades the body, and eases back out after it clears', () => {
    const c = new PlayerCamera();
    c.cycle();
    settle(c);
    const p = pose();
    c.update(p, 1 / 60, () => 0.4);
    expect(Math.hypot(p.x, p.y - eyeY, p.z)).toBeCloseTo(0.4);
    expect(c.avatarOpacity).toBe(0);
    const next = pose();
    c.update(next, 1 / 60, clear);
    expect(next.z).toBeGreaterThan(p.z);
    expect(next.z).toBeLessThan(2.8);
    c.reset();
    expect(c.active).toBe(false);
    expect(settle(c)).toEqual(pose());
  });
});

describe('camera collision and crosshair', () => {
  it('sweeps through open space and pulls in before a wall or an off-center near-plane obstruction', () => {
    const w = new CameraWorld();
    const o = new THREE.Vector3(0, eyeY, 0);
    const d = new THREE.Vector3(0, 0, 1);
    w.setObjects([]);
    expect(w.clip(flatWorld(), o, d, 5)).toBe(5);
    w.setObjects([obstacle(0, eyeY, 2, 4, 4, 0.1)]);
    expect(w.clip(flatWorld(), o, d, 5)).toBeCloseTo(1.71);
    w.setObjects([obstacle(0.24, eyeY, 2, 0.1, 2, 0.1)]);
    expect(w.clip(flatWorld(), o, d, 5)).toBeLessThan(2);
    const diagonal = 0.24 * Math.SQRT1_2;
    w.setObjects([obstacle(diagonal, eyeY + diagonal, 2, 0.06, 0.06, 0.1)]);
    expect(w.clip(flatWorld(), o, d, 5)).toBeLessThan(2);
  });

  it('blocks cave ceilings and single-sided walls from inside', () => {
    const w = new CameraWorld();
    const roof = obstacle(0, eyeY + 1, 0, 6, 0.1, 6);
    w.setObjects([roof]);
    expect(w.clip(flatWorld(), new THREE.Vector3(0, eyeY, 0), new THREE.Vector3(0, 1, 0), 5)).toBeLessThan(1);
    w.setObjects([obstacle(0, eyeY, 0, 1, 1, 1)]);
    expect(w.clip(flatWorld(), new THREE.Vector3(0, eyeY, 0), new THREE.Vector3(0, 0, 1), 5)).toBeLessThan(0.5);
  });

  it('keeps the camera above terrain and water while looking up', () => {
    const w = new CameraWorld();
    w.setObjects([]);
    const d = new THREE.Vector3(0, -1, 1).normalize();
    for (const ground of [0, -5]) {
      const safe = w.clip(flatWorld(ground), new THREE.Vector3(0, eyeY, 0), d, 5);
      expect(eyeY + d.y * safe).toBeGreaterThanOrEqual(0.24);
      expect(safe).toBeLessThan(5);
    }
  });

  it('allows the swimming camera to pull back without counting its water clearance twice', () => {
    const w = new CameraWorld();
    w.setObjects([]);
    const origin = new THREE.Vector3(0, eyeY - BALANCE.player.swimDepth, 0);
    const direction = new THREE.Vector3(0.65, 0.4, 5.6).normalize();
    expect(w.clip(flatWorld(-5), origin, direction, 5.6)).toBe(5.6);
  });

  it('ignores hidden objects, grass and effects when converging aim', () => {
    const w = new CameraWorld();
    const grass = obstacle(0.65, 2.02, -2, 1, 1, 1);
    grass.name = 'grass';
    const hidden = obstacle(0.65, 2.02, -3, 1, 1, 1);
    hidden.visible = false;
    const effect = obstacle(0.65, 2.02, -4, 1, 1, 1);
    (effect.material as THREE.Material).transparent = true;
    w.setObjects([grass, hidden, effect]);
    const p = { ...pose(), x: 0.65, y: eyeY + 0.4, z: 2.8 };
    const out = new THREE.Vector3();
    w.aim(flatWorld(), p, { x: 0, y: eyeY, z: 0 }, out);
    expect(out.x).toBeLessThan(0.01);
    expect(out.z).toBeLessThan(-0.99);
  });

  it('converges on the exact centered crosshair point at close and long distances in both views', () => {
    const w = new CameraWorld();
    for (const distance of [2, 20, 80]) {
      for (const mode of ['thirdPersonClose', 'thirdPersonFar'] as const) {
        const c = new PlayerCamera();
        c.mode = mode;
        const p = settle(c);
        const box = obstacle(p.x, p.y, -distance, 1, 1, 1);
        w.setObjects([box]);
        const out = new THREE.Vector3();
        const eye = new THREE.Vector3(0, eyeY, 0);
        w.aim(flatWorld(), p, eye, out);
        const target = new THREE.Vector3(p.x, p.y, -distance + 0.5);
        expect(out.distanceTo(target.sub(eye).normalize())).toBeLessThan(1e-7);
      }
    }
  });
});

describe('camera aim uses the existing gameplay rules', () => {
  it('resolves aim after movement without changing movement yaw or look pitch', () => {
    const sim = quietSim();
    const before = sim.state.player.z;
    let eyeZ = Infinity;
    sim.step(0.1, { ...IDLE_INPUT, yaw: 0, pitch: 0.2, moveZ: 1, resolveAim: (eye, out) => {
      eyeZ = eye.z;
      lookDir(-1, -0.5, out);
    } });
    expect(eyeZ).toBe(sim.state.player.z);
    expect(eyeZ).toBeLessThan(before);
    expect(sim.state.player.yaw).toBe(0);
    expect(sim.state.player.pitch).toBe(0.2);
  });

  it('gathers under the crosshair and retains player-based reach, even with the far camera', () => {
    const sim = quietSim();
    const i = nearestResource(sim, 'stonePile');
    const r = sim.gen.resources[i];
    const y = sim.terrain.heightAt(r.x, r.z) + RESOURCES.stonePile.hitHeight * r.scale;
    teleport(sim, r.x, r.z + 2);
    const aim = toward(r.x, y, r.z);
    sim.step(0, { ...IDLE_INPUT, yaw: 1, pitch: 0, primary: true, primaryPressed: true, resolveAim: aim });
    expect(sim.target).toMatchObject({ kind: 'resource', index: i });
    expect(countItem(sim.state.inventory, 'stone')).toBe(1);
    teleport(sim, r.x, r.z + 8);
    sim.step(0, { ...IDLE_INPUT, resolveAim: aim });
    expect(sim.target?.kind === 'resource' && sim.target.index === i).toBe(false);
  });

  it('fires arrows along camera aim with unchanged speed and returns to first-person aim', () => {
    const sim = quietSim();
    sim.state.tools.push('bow');
    sim.selectTool('bow');
    give(sim, { arrow: 3 });
    const d = new THREE.Vector3(0.4, 0.1, -1).normalize();
    const fire = (resolveAim?: SimInput['resolveAim']) => {
      sim.actionCooldown = 0;
      sim.bowDraw = BALANCE.combat.bow.fullDraw;
      sim.step(0, { ...IDLE_INPUT, primaryReleased: true, resolveAim });
      return sim.projectiles.at(-1)!;
    };
    const third = fire((_eye, out) => Object.assign(out, { x: d.x, y: d.y, z: d.z }));
    expect(new THREE.Vector3(third.vx, third.vy, third.vz).normalize().distanceTo(d)).toBeLessThan(1e-7);
    const first = fire();
    expect(first.vx).toBeCloseTo(0);
    expect(first.vy).toBe(0);
    expect(first.vz).toBe(-BALANCE.combat.bow.maxSpeed);
    expect(Math.hypot(third.vx, third.vy, third.vz)).toBeCloseTo(-first.vz);
  });

  it('places structures and casts fishing lines along the resolved aim', () => {
    const sim = quietSim();
    giveRecipe(sim, 'campfire');
    expect(sim.beginPlacement('campfire')).toBe(true);
    const p = sim.state.player;
    const x = p.x + 3;
    const z = p.z;
    const y = sim.terrain.heightAt(x, z);
    aimAt(sim, x, y, z);
    sim.step(0, { ...IDLE_INPUT, yaw: p.yaw, pitch: p.pitch });
    const first = { x: sim.placement!.x, z: sim.placement!.z };
    sim.step(0, { ...IDLE_INPUT, yaw: 0, pitch: 0, resolveAim: toward(x, y, z) });
    expect(sim.placement!.x).toBeCloseTo(first.x, 4);
    expect(sim.placement!.z).toBeCloseTo(first.z, 4);
    sim.cancelPlacement();
    sim.state.tools.push('rod');
    sim.selectTool('rod');
    sim.fishing = { phase: 'charging', t: 1, power: 1, fromX: p.x, fromZ: p.z, x: p.x, z: p.z, biteAt: 0 };
    sim.step(0, { ...IDLE_INPUT, primaryReleased: true, resolveAim: toward(p.x + 10, p.y + eyeY, p.z) });
    expect(sim.fishing?.x).toBeCloseTo(p.x + BALANCE.fishing.maxCast);
    expect(sim.fishing?.z).toBeCloseTo(p.z);
  });

  it('uses the seated eye height for third-person arrows', () => {
    const sim = quietSim();
    sim.state.player.sitting = true;
    sim.state.tools.push('bow');
    sim.selectTool('bow');
    give(sim, { arrow: 1 });
    sim.bowDraw = BALANCE.combat.bow.fullDraw;
    let eyeY = 0;
    sim.step(0, { ...IDLE_INPUT, primaryReleased: true, resolveAim: (eye, out) => {
      eyeY = eye.y;
      lookDir(0, 0, out);
    } });
    expect(eyeY).toBeCloseTo(sim.state.player.y + BALANCE.player.seatedEyeHeight);
    expect(sim.projectiles[0].y).toBeCloseTo(eyeY - 0.08);
  });
});

describe('local third-person avatar', () => {
  it('lets hidden tool swings and waves expire before returning to third person', () => {
    const a = new LocalAvatar();
    const sim = quietSim();
    a.update(sim, 'm', 0, 1);
    const body = a.group.children[0].children[0];
    const arm = body.children.filter((o) => o instanceof THREE.Group)[1];
    const idle = arm.rotation.clone();
    a.swing();
    a.wave();
    a.update(sim, 'm', 0.1, 1);
    expect(arm.rotation.z).not.toBe(idle.z);
    a.hide(3);
    a.update(sim, 'm', 0.1, 1);
    expect(arm.rotation.x).toBe(idle.x);
    expect(arm.rotation.z).toBe(idle.z);
  });

  it('keeps the swimming character visible above the water with feet at the simulation float depth', () => {
    const a = new LocalAvatar();
    const sim = quietSim();
    Object.assign(sim.state.player, { y: -BALANCE.player.swimDepth, swimming: true, grounded: false });
    for (let i = 0; i < 120; i++) a.update(sim, 'm', 1 / 60, 1);
    const bounds = new THREE.Box3().setFromObject(a.group);
    expect(bounds.max.y).toBeGreaterThan(0.3);
    expect(bounds.max.y).toBeLessThan(1);
  });

  it('uses the male rig by default, follows the player without interpolation, and has no labels', () => {
    const a = new LocalAvatar();
    const sim = quietSim();
    a.update(sim, 'm', 1 / 60, 1);
    expect(a.group.children).toHaveLength(1);
    const root = a.group.children[0];
    expect(root.position.x).toBe(sim.state.player.x);
    let sprites = 0;
    root.traverse((o) => { if (o instanceof THREE.Sprite) sprites++; });
    expect(sprites).toBe(0);
    sim.state.player.x += 10;
    a.update(sim, 'm', 1 / 60, 1);
    expect(root.position.x).toBe(sim.state.player.x);
    a.update(sim, 'f', 1 / 60, 1);
    expect(a.group.children).toHaveLength(1);
    expect(a.group.children[0]).not.toBe(root);
    a.update(sim, 'f', 1 / 60, 0);
    expect(a.group.visible).toBe(false);
  });
});
