export interface PresenceEntry {
  key: string;
  meta: Record<string, unknown>;
}

/** One pub/sub topic: broadcast events plus a presence list (who is here, with a small metadata record). */
export interface NetChannel {
  /** Register handlers before `subscribe()`. Broadcasts never echo back to the sender. */
  on(event: string, cb: (payload: unknown) => void): void;
  /** Called with the full member list (including this client once it tracks) whenever it changes. */
  onPresence(cb: (entries: PresenceEntry[]) => void): void;
  subscribe(): Promise<void>;
  send(event: string, payload: unknown): void;
  track(meta: Record<string, unknown>): Promise<void>;
  close(): void;
}

export interface Transport {
  readonly kind: 'supabase' | 'local';
  /** `presenceKey` identifies this client in the channel's presence list. */
  channel(name: string, presenceKey: string): NetChannel;
  close(): void;
}

// ------------------------------------------------------------------ local transport (tests, same-browser tabs)

type BusMsg =
  | { ch: string; t: 'b'; ev: string; p: unknown }
  | { ch: string; t: 'p+'; key: string; meta: Record<string, unknown> }
  | { ch: string; t: 'p-'; key: string }
  | { ch: string; t: 'p?' };

/** Delivers messages to every other endpoint (never back to the sender), like a broadcast network. */
export interface Bus {
  post(msg: BusMsg): void;
  onMessage: ((msg: BusMsg) => void) | null;
  close(): void;
}

/**
 * In-memory network for tests: every `bus()` is one client. Payloads are JSON-copied like a real network.
 * With `manual`, nothing is delivered until `flush()`; otherwise delivery happens on the next microtask.
 */
export class MemoryHub {
  private readonly ends = new Set<Bus>();
  private readonly queue: { to: Bus; data: string }[] = [];
  private scheduled = false;
  sent = 0;
  private readonly manual: boolean;

  constructor(manual = false) {
    this.manual = manual;
  }

  bus(): Bus {
    const hub = this;
    const end: Bus = {
      onMessage: null,
      post(msg) {
        hub.enqueue(end, msg);
      },
      close() {
        hub.ends.delete(end);
      },
    };
    this.ends.add(end);
    return end;
  }

  private enqueue(from: Bus, msg: BusMsg): void {
    if (!this.ends.has(from)) return;
    this.sent++;
    const data = JSON.stringify(msg);
    for (const e of this.ends) if (e !== from) this.queue.push({ to: e, data });
    if (!this.manual && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.flush();
      });
    }
  }

  /** Deliver everything queued, including messages sent while delivering. */
  flush(): void {
    for (let guard = 0; this.queue.length && guard < 100_000; guard++) {
      const { to, data } = this.queue.shift()!;
      if (this.ends.has(to)) to.onMessage?.(JSON.parse(data));
    }
  }
}

/** Cross-tab bus for `?net=local`: every tab of this browser on the same origin is on the network. */
export function broadcastBus(name = 'cozysurvival-net'): Bus {
  const bc = new BroadcastChannel(name);
  const bus: Bus = {
    onMessage: null,
    post: (msg) => bc.postMessage(msg),
    close: () => bc.close(),
  };
  bc.onmessage = (e) => bus.onMessage?.(e.data as BusMsg);
  return bus;
}

export class LocalTransport implements Transport {
  readonly kind = 'local';
  private readonly channels = new Set<LocalChannel>();
  private readonly timer: ReturnType<typeof setInterval> | null = null;
  private readonly bus: Bus;
  readonly heartbeatMs: number;

  /** With `heartbeatMs`, presence is re-announced periodically and members that go quiet expire (closed tabs). */
  constructor(bus: Bus, heartbeatMs = 0) {
    this.bus = bus;
    this.heartbeatMs = heartbeatMs;
    bus.onMessage = (m) => {
      for (const c of this.channels) if (c.name === m.ch) c.receive(m);
    };
    if (heartbeatMs > 0) this.timer = setInterval(() => this.channels.forEach((c) => c.heartbeat()), heartbeatMs);
  }

  channel(name: string, presenceKey: string): NetChannel {
    const c = new LocalChannel(this, name, presenceKey);
    this.channels.add(c);
    return c;
  }

  post(msg: BusMsg): void {
    this.bus.post(msg);
  }

  forget(c: LocalChannel): void {
    this.channels.delete(c);
  }

  close(): void {
    for (const c of [...this.channels]) c.close();
    if (this.timer) clearInterval(this.timer);
    this.bus.close();
  }
}

class LocalChannel implements NetChannel {
  private readonly handlers = new Map<string, ((p: unknown) => void)[]>();
  private readonly presenceCbs: ((e: PresenceEntry[]) => void)[] = [];
  private readonly members = new Map<string, { meta: Record<string, unknown>; seen: number }>();
  private mine: Record<string, unknown> | null = null;
  private live = false;
  private readonly net: LocalTransport;
  readonly name: string;
  private readonly key: string;

  constructor(net: LocalTransport, name: string, key: string) {
    this.net = net;
    this.name = name;
    this.key = key;
  }

  on(event: string, cb: (payload: unknown) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  onPresence(cb: (entries: PresenceEntry[]) => void): void {
    this.presenceCbs.push(cb);
  }

  subscribe(): Promise<void> {
    this.live = true;
    this.net.post({ ch: this.name, t: 'p?' });
    return Promise.resolve();
  }

  send(event: string, payload: unknown): void {
    if (this.live) this.net.post({ ch: this.name, t: 'b', ev: event, p: payload });
  }

  track(meta: Record<string, unknown>): Promise<void> {
    this.mine = meta;
    this.members.set(this.key, { meta, seen: Infinity });
    if (this.live) this.net.post({ ch: this.name, t: 'p+', key: this.key, meta });
    this.emitPresence();
    return Promise.resolve();
  }

  close(): void {
    if (this.live && this.mine) this.net.post({ ch: this.name, t: 'p-', key: this.key });
    this.live = false;
    this.mine = null;
    this.net.forget(this);
  }

  receive(m: BusMsg): void {
    if (!this.live) return;
    if (m.t === 'b') {
      for (const cb of this.handlers.get(m.ev) ?? []) cb(m.p);
    } else if (m.t === 'p+') {
      const prev = this.members.get(m.key);
      this.members.set(m.key, { meta: m.meta, seen: Date.now() });
      if (!prev || JSON.stringify(prev.meta) !== JSON.stringify(m.meta)) this.emitPresence();
    } else if (m.t === 'p-') {
      if (this.members.delete(m.key)) this.emitPresence();
    } else if (m.t === 'p?' && this.mine) {
      this.net.post({ ch: this.name, t: 'p+', key: this.key, meta: this.mine });
    }
  }

  heartbeat(): void {
    if (!this.live) return;
    if (this.mine) this.net.post({ ch: this.name, t: 'p+', key: this.key, meta: this.mine });
    const cutoff = Date.now() - this.net.heartbeatMs * 3;
    let changed = false;
    for (const [k, m] of this.members) {
      if (m.seen < cutoff) {
        this.members.delete(k);
        changed = true;
      }
    }
    if (changed) this.emitPresence();
  }

  private emitPresence(): void {
    const entries = [...this.members].map(([key, m]) => ({ key, meta: m.meta }));
    for (const cb of this.presenceCbs) cb(entries);
  }
}
