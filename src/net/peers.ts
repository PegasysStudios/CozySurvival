import { damp } from '../core/math';
import type { ToolId } from '../data/items';
import { F_DEAD, F_SLEEP, F_SPRINT, type Avatar, type Pose, type PoseWire } from './protocol';

/** Another player as this client sees them: identity plus a smoothed pose for rendering. */
export interface Peer {
  pid: string;
  name: string;
  avatar: Avatar;
  host: boolean;
  /** Latest pose received, dead-reckoned forward between updates. */
  target: Pose | null;
  wire: PoseWire | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  flags: number;
  tool: ToolId;
  /** Seconds since the last tool swing started (large when idle). */
  swingT: number;
  waveT: number;
  chat: string;
  chatT: number;
  /** Seconds since the last pose arrived. */
  age: number;
}

export function newPeer(pid: string, name: string, avatar: Avatar, host: boolean): Peer {
  return { pid, name, avatar, host, target: null, wire: null, x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0, tool: 'hands', swingT: 99, waveT: 99, chat: '', chatT: 99, age: 0 };
}

export function applyPose(peer: Peer, pose: Pose, wire: PoseWire): void {
  const first = !peer.target;
  if (peer.target && pose.act !== peer.target.act) peer.swingT = 0;
  peer.target = pose;
  peer.wire = wire;
  peer.flags = pose.flags;
  peer.tool = pose.tool;
  peer.age = 0;
  if (first || Math.hypot(pose.x - peer.x, pose.z - peer.z) > 8) {
    peer.x = pose.x;
    peer.y = pose.y;
    peer.z = pose.z;
    peer.yaw = pose.yaw;
  }
}

export function updatePeer(peer: Peer, dt: number): void {
  peer.swingT += dt;
  peer.waveT += dt;
  peer.chatT += dt;
  peer.age += dt;
  const t = peer.target;
  if (!t) return;
  if (peer.age < 0.6) {
    t.x += t.vx * dt;
    t.z += t.vz * dt;
  }
  peer.x = damp(peer.x, t.x, 10, dt);
  peer.y = damp(peer.y, t.y, 10, dt);
  peer.z = damp(peer.z, t.z, 10, dt);
  let dy = t.yaw - peer.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  peer.yaw += dy * Math.min(1, dt * 12);
  peer.speed = damp(peer.speed, peer.age < 0.6 ? Math.hypot(t.vx, t.vz) : 0, 8, dt);
}

export function peerDead(p: Peer): boolean {
  return (p.flags & F_DEAD) !== 0;
}

export function peerAsleep(p: Peer): boolean {
  return (p.flags & F_SLEEP) !== 0;
}

/** How much noise the peer makes for animal perception (matches the local player's scale). */
export function peerNoise(p: Peer): number {
  if (p.speed < 0.5) return 0.5;
  return p.flags & F_SPRINT ? 1.6 : 1;
}
