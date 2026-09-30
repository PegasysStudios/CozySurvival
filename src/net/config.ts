/** Bumped whenever the wire format changes; hosts and guests must match. */
export const PROTOCOL_VERSION = 2;
export const MAX_PLAYERS = 4;
export const LOBBY_CHANNEL = 'cozy:lobby';

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** The Supabase project from `.env.local` (see docs/multiplayer-setup.md), or null when it isn't set up. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

/** `?net=local` runs multiplayer between tabs of this browser (BroadcastChannel), for testing without Supabase. */
export function localNetRequested(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('net') === 'local';
}

export function roomChannel(sid: string): string {
  return `cozy:s:${sid}`;
}

export function uplinkChannel(sid: string, pid: string): string {
  return `cozy:s:${sid}:u:${pid}`;
}

export function randomId(len = 10): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
