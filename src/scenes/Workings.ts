import * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import type { Carriage } from '../world/trains';
import type { FixedProp } from '../world/world';

const M = 8;
/** A level crossing shuts for a train this near, px, coming its way (or this near, whichever way it's going). */
const SHUT_COMING = 350 * M;
const SHUT_NEAR = 60 * M;
/** How long its barriers take to come down and go up, s. */
const LOWERING = 4;
const RAISING = 3;
/** A railway signal's red with a train this near it, px (it's just passed, or it's coming up to it). */
const SIGNAL_NEAR = 250 * M;
/** A lock's gates: shut, opening, open, shutting, s (round and round, each lock in its own time). */
const LOCK = [50, 10, 50, 10];
/** A pylon: how far out its feet are from its middle, and its waist (where it narrows), px; its arms (how high, as a share of its
 * height, and how far out each side), px; how far its wires sag in the middle of a span, as a share of the span. */
const PYLON_FOOT = 3.3 * M;
const PYLON_WAIST = 1.1 * M;
const PYLON_ARMS: [number, number][] = [
  [0.62, 5.5 * M],
  [0.74, 6.5 * M],
  [0.86, 5 * M],
];
const SAG = 0.05;

interface Pylon {
  x: number;
  y: number;
  z: number;
  angle: number;
  height: number;
  to: number[];
}

interface Crossing {
  x: number;
  y: number;
  z: number;
  angle: number;
  wide: number;
  /** How far down its barriers are (0 up, 1 down). */
  down: number;
}

/**
 * The things that work, drawn each frame as they are: the level crossings (their barriers coming down, their red lights
 * flashing, for a train), the railway signals' lights (red with a train near), and the locks' gates (opening and shutting).
 * What a crossing's barriers keep the traffic back from is said by `shut` (see GameScene).
 */
export class Workings {
  private readonly g: Phaser.GameObjects.Graphics;
  private crossings: Crossing[] = [];
  private signals: { x: number; y: number; z: number }[] = [];
  private gates: { x: number; y: number; z: number; angle: number; wide: number; phase: number }[] = [];
  /** The pylons, and where they are by the metre (to find the one a wire goes to). */
  private pylons: Pylon[] = [];
  private pylonAt = new Map<string, Pylon>();
  /** The pylons and their wires: over everything, the buildings too. */
  private readonly high: Phaser.GameObjects.Graphics;
  /** The crossings shut, for the traffic to stop at: where, and how wide (half the road's width, and a little). */
  readonly shut: { x: number; y: number; r: number }[] = [];

  constructor(scene: Phaser.Scene, depth: number, highDepth: number) {
    this.g = scene.add.graphics().setDepth(depth);
    this.high = scene.add.graphics().setDepth(highDepth);
  }

  /** The region's (see streamer.ts): its crossings, signals and locks, from its fixed things. */
  use(fixed: FixedProp[], groundAt: (x: number, y: number) => number): void {
    this.crossings = [];
    this.signals = [];
    this.gates = [];
    this.pylons = [];
    this.pylonAt.clear();
    for (const p of fixed) {
      if (p.kind === 'pylon') {
        const pylon = { x: p.x, y: p.y, z: groundAt(p.x, p.y), angle: p.angle ?? 0, height: p.height ?? 26 * M, to: p.to ?? [] };
        this.pylons.push(pylon);
        this.pylonAt.set(`${Math.round(p.x / M)},${Math.round(p.y / M)}`, pylon);
        continue;
      }
      if (p.kind === 'levelcrossing') this.crossings.push({ x: p.x, y: p.y, z: groundAt(p.x, p.y), angle: p.angle ?? 0, wide: p.length ?? 7 * M, down: 0 });
      else if (p.kind === 'railsignal') this.signals.push({ x: p.x, y: p.y, z: groundAt(p.x, p.y) });
      else if (p.kind === 'lockgate') this.gates.push({ x: p.x, y: p.y, z: groundAt(p.x, p.y), angle: p.angle ?? 0, wide: p.length ?? 12 * M, phase: Math.abs(Math.round(p.x * 7 + p.y * 13)) % 120 });
    }
  }

  update(dt: number, view: Phaser.Geom.Rectangle, perspective: Perspective, carriages: Carriage[], time: number): void {
    const g = this.g.clear();
    this.shut.length = 0;
    const pad = 200;
    const seen = (x: number, y: number) => x > view.left - pad && x < view.right + pad && y > view.top - pad && y < view.bottom + pad;
    const flash = time % 1 < 0.5;
    for (const c of this.crossings) {
      // A train near, or coming: its barriers come down (and go up again once it's gone).
      let coming = false;
      for (const k of carriages) {
        const [dx, dy] = [c.x - k.x, c.y - k.y];
        const d = Math.hypot(dx, dy);
        if (d < SHUT_NEAR || (d < SHUT_COMING && dx * k.vx + dy * k.vy > 0)) {
          coming = true;
          break;
        }
      }
      c.down = coming ? Math.min(1, c.down + dt / LOWERING) : Math.max(0, c.down - dt / RAISING);
      if (c.down > 0.3) this.shut.push({ x: c.x, y: c.y, r: c.wide / 2 + 4 * M });
      if (!seen(c.x, c.y)) continue;
      this.crossing(g, c, perspective, coming || c.down > 0 ? flash : null);
    }
    for (const s of this.signals) {
      if (!seen(s.x, s.y)) continue;
      const red = carriages.some((k) => Math.abs(k.x - s.x) < SIGNAL_NEAR && Math.abs(k.y - s.y) < SIGNAL_NEAR && Math.hypot(k.x - s.x, k.y - s.y) < SIGNAL_NEAR);
      const l = perspective.lift(s.z + 4 * M);
      g.fillStyle(red ? 0xff3b30 : 0x34d058, 1).fillCircle(perspective.x(s.x, l), perspective.y(s.y, l), 1.1 * l);
    }
    for (const gate of this.gates) {
      if (!seen(gate.x, gate.y)) continue;
      this.gate(g, gate, perspective, time);
    }
    this.power(view, perspective);
  }

  /** The pylons in view (they lean out from the middle of it, as tall as they are), and the wires between them. */
  private power(view: Phaser.Geom.Rectangle, p: Perspective): void {
    const h = this.high.clear();
    // (Tall: one well out of view leans into it.)
    const pad = 60 * M;
    const near = (x: number, y: number) => x > view.left - pad && x < view.right + pad && y > view.top - pad && y < view.bottom + pad;
    for (const a of this.pylons) {
      const [ux, uy] = [Math.cos(a.angle), Math.sin(a.angle)];
      const [nx, ny] = [-uy, ux];
      // Its wires to the next: from each arm's end to the same arm's on the next (or, not a pylon, down to the next's top).
      for (let k = 0; k + 1 < a.to.length; k += 2) {
        const [bx, by] = [a.to[k], a.to[k + 1]];
        if (!near(a.x, a.y) && !near(bx, by) && !near((a.x + bx) / 2, (a.y + by) / 2)) continue;
        const b = this.pylonAt.get(`${Math.round(bx / M)},${Math.round(by / M)}`);
        const bz = b ? b.z : a.z;
        const bh = b ? b.height : a.height * 0.5;
        // (Its arms across the line; the next's the same way across, whichever way it's turned.)
        const [bnx, bny] = b ? [-Math.sin(b.angle), Math.cos(b.angle)] : [nx, ny];
        const flip = bnx * nx + bny * ny < 0 ? -1 : 1;
        const span = Math.hypot(bx - a.x, by - a.y);
        h.lineStyle(0.35 * M, 0x2b2e31, 0.85);
        for (const [share, out] of PYLON_ARMS) {
          for (const side of [1, -1]) {
            const [x0, y0, z0] = [a.x + nx * out * side, a.y + ny * out * side, a.z + a.height * share];
            const [x1, y1, z1] = [bx + bnx * out * side * flip, by + bny * out * side * flip, bz + bh * share];
            this.wire(h, p, x0, y0, z0, x1, y1, z1, span * SAG);
          }
        }
        // The earth wire, from peak to peak.
        this.wire(h, p, a.x, a.y, a.z + a.height, bx, by, bz + bh, span * SAG);
      }
      if (near(a.x, a.y)) this.pylon(h, a, p, ux, uy, nx, ny);
    }
  }

  /** A wire from one point to another, sagging in the middle (heights in px). */
  private wire(h: Phaser.GameObjects.Graphics, p: Perspective, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, sag: number): void {
    const steps = 6;
    let [px, py] = [0, 0];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = z0 + (z1 - z0) * t - sag * 4 * t * (1 - t);
      const l = p.lift(z);
      const [sx, sy] = [p.x(x0 + (x1 - x0) * t, l), p.y(y0 + (y1 - y0) * t, l)];
      if (i) h.lineBetween(px, py, sx, sy);
      [px, py] = [sx, sy];
    }
  }

  /** A pylon, rising from its feet: its four legs narrowing to the waist and the peak, its cross-bracing, its arms. */
  private pylon(h: Phaser.GameObjects.Graphics, a: Pylon, p: Perspective, ux: number, uy: number, nx: number, ny: number): void {
    const at = (along: number, across: number, up: number): [number, number] => {
      const l = p.lift(a.z + up);
      return [p.x(a.x + ux * along + nx * across, l), p.y(a.y + uy * along + ny * across, l)];
    };
    const half = (up: number) => (up < 0.62 * a.height ? PYLON_FOOT + (PYLON_WAIST - PYLON_FOOT) * (up / (0.62 * a.height)) : PYLON_WAIST * (1 - (up - 0.62 * a.height) / (0.38 * a.height)) + 0.2 * M);
    const levels = [0, 0.2, 0.4, 0.62, 0.74, 0.86, 1].map((s) => s * a.height);
    h.lineStyle(0.45 * M, 0x6c7176, 1);
    for (const [s, t] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      for (let i = 0; i + 1 < levels.length; i++) {
        const [p0, p1] = [at(s * half(levels[i]), t * half(levels[i]), levels[i]), at(s * half(levels[i + 1]), t * half(levels[i + 1]), levels[i + 1])];
        h.lineBetween(p0[0], p0[1], p1[0], p1[1]);
      }
    }
    // Its bracing, across each face between the levels.
    h.lineStyle(0.2 * M, 0x7d8287, 1);
    for (let i = 0; i + 1 < 4; i++) {
      const [z0, z1] = [levels[i], levels[i + 1]];
      const [w0, w1] = [half(z0), half(z1)];
      for (const [s, t] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [number, number][]) {
        const a0 = s === t ? at(s * w0, -t * w0, z0) : at(-s * w0, t * w0, z0);
        const b1 = at(s * w1, t * w1, z1);
        h.lineBetween(a0[0], a0[1], b1[0], b1[1]);
      }
    }
    // Its arms, out across the line, each end its insulators.
    h.lineStyle(0.4 * M, 0x6c7176, 1);
    for (const [share, out] of PYLON_ARMS) {
      const up = a.height * share;
      const [l0, l1] = [at(0, -out, up), at(0, out, up)];
      h.lineBetween(l0[0], l0[1], l1[0], l1[1]);
      h.fillStyle(0xd7dadc, 1);
      for (const e of [l0, l1]) h.fillCircle(e[0], e[1], 0.35 * M * p.lift(a.z + up));
    }
  }

  /** A level crossing: a barrier each side of the railway across the half of the road coming in, its posts' lights. */
  private crossing(g: Phaser.GameObjects.Graphics, c: Crossing, p: Perspective, flash: boolean | null): void {
    const [ux, uy] = [Math.cos(c.angle), Math.sin(c.angle)];
    const [nx, ny] = [-uy, ux];
    const half = c.wide / 2;
    const l = p.lift(c.z + 1 * M);
    const at = (x: number, y: number): [number, number] => [p.x(x, l), p.y(y, l)];
    for (const side of [1, -1]) {
      // Its post at the kerb, 4 m back from the line, on the traffic's left; its arm across the lane in.
      const [bx, by] = [c.x - ux * side * 4 * M, c.y - uy * side * 4 * M];
      const [px, py] = [bx + nx * side * (half + 0.6 * M), by + ny * side * (half + 0.6 * M)];
      const reach = (half + 0.6 * M) * c.down;
      const [ex, ey] = [px - nx * side * reach, py - ny * side * reach];
      const [a, b] = [at(px, py), at(ex, ey)];
      // Red and white, in stripes.
      const stripes = 6;
      for (let k = 0; k < stripes; k++) {
        const [t0, t1] = [k / stripes, (k + 1) / stripes];
        g.lineStyle(0.6 * M * l, k % 2 ? 0xffffff : 0xd62828, 1);
        g.lineBetween(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
      }
      g.fillStyle(0x2b2b2b, 1).fillCircle(a[0], a[1], 0.5 * M * l);
      // The lights on the post: red, flashing each in turn, while it's shut.
      const lit = flash === null ? null : side === 1 ? flash : !flash;
      g.fillStyle(lit ? 0xff2d20 : 0x4a1a18, 1).fillCircle(a[0] + nx * side * 0.8 * M, a[1] + ny * side * 0.8 * M, 0.45 * M * l);
    }
  }

  /** A lock's gates: a pair, hinged at its sides; shut, they meet in the middle (pointing upstream), open, they're back against its sides. */
  private gate(g: Phaser.GameObjects.Graphics, gate: Workings['gates'][number], p: Perspective, time: number): void {
    const cycle = LOCK.reduce((a, b) => a + b, 0);
    let t = (time + gate.phase) % cycle;
    let open: number;
    if (t < LOCK[0]) open = 0;
    else if ((t -= LOCK[0]) < LOCK[1]) open = t / LOCK[1];
    else if ((t -= LOCK[1]) < LOCK[2]) open = 1;
    else open = 1 - (t - LOCK[2]) / LOCK[3];
    const [ux, uy] = [Math.cos(gate.angle), Math.sin(gate.angle)];
    const [nx, ny] = [-uy, ux];
    const half = gate.wide / 2;
    const l = p.lift(gate.z + 0.8 * M);
    const leaf = half / Math.cos(0.3);
    for (const side of [1, -1]) {
      const [hx, hy] = [gate.x + nx * side * half, gate.y + ny * side * half];
      // Shut: across, angled 17° upstream to meet the other; open: swung back along the side.
      const a = Math.atan2(-ny * side, -nx * side) + side * (0.3 * (1 - open) - (Math.PI / 2 - 0.05) * open);
      const [ex, ey] = [hx + Math.cos(a) * leaf, hy + Math.sin(a) * leaf];
      const [h, e] = [[p.x(hx, l), p.y(hy, l)], [p.x(ex, l), p.y(ey, l)]];
      g.lineStyle(1.2 * M * l, 0x4a3524, 1).lineBetween(h[0], h[1], e[0], e[1]);
      g.lineStyle(0.25 * M * l, 0xf0f0f0, 1).lineBetween(h[0], h[1], e[0], e[1]);
      g.fillStyle(0x2b2b2b, 1).fillCircle(h[0], h[1], 0.6 * M * l);
    }
  }

  destroy(): void {
    this.g.destroy();
    this.high.destroy();
  }
}
