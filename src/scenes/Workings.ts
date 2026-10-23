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
  /** The crossings shut, for the traffic to stop at: where, and how wide (half the road's width, and a little). */
  readonly shut: { x: number; y: number; r: number }[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** The region's (see streamer.ts): its crossings, signals and locks, from its fixed things. */
  use(fixed: FixedProp[], groundAt: (x: number, y: number) => number): void {
    this.crossings = [];
    this.signals = [];
    this.gates = [];
    for (const p of fixed) {
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
  }
}
