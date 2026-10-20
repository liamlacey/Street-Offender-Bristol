/**
 * The sharp drops in the ground (a quay's edge, a retaining wall, the sides
 * of the Bear Pit; see findLedges): pieces of their top edges, each knowing
 * which way is down and how far. Go over one from the top and you fall; come
 * at one from below and it's a wall. Pure, so it's tested.
 */

import type { GameMap } from '../map/osm';
import { type CarState, carHull } from '../car/CarPhysics';

export interface LedgeSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Its length, px; and the way down (a unit vector, square to it). */
  len: number;
  nx: number;
  ny: number;
  /** How far it drops, px. */
  drop: number;
}

/** Real gravity, px/s² (8 px a metre). */
export const GRAVITY = 9.81 * 8;

const CELL = 128;

export class Ledges {
  readonly segments: LedgeSegment[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly found = new Set<number>();
  private readonly out: LedgeSegment[] = [];

  constructor(map: Pick<GameMap, 'ledges'>) {
    for (const l of map.ledges ?? []) {
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const [ax, ay, bx, by] = [l.pts[k], l.pts[k + 1], l.pts[k + 2], l.pts[k + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        if (!len) continue;
        // (Down's on the right of the way it runs: y is down.)
        const seg = { ax, ay, bx, by, len, nx: -(by - ay) / len, ny: (bx - ax) / len, drop: (l.drop[k / 2] + l.drop[k / 2 + 1]) / 2 };
        const i = this.segments.push(seg) - 1;
        for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++) {
          for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) {
            const key = cx * 100_000 + cy;
            const cell = this.cells.get(key);
            if (cell) cell.push(i);
            else this.cells.set(key, [i]);
          }
        }
      }
    }
  }

  /** Those that might be within `r` of (x, y). The array is reused by the next call. */
  near(x: number, y: number, r: number): LedgeSegment[] {
    this.found.clear();
    this.out.length = 0;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
        for (const i of this.cells.get(cx * 100_000 + cy) ?? []) {
          if (this.found.has(i)) continue;
          this.found.add(i);
          this.out.push(this.segments[i]);
        }
      }
    }
    return this.out;
  }

  /** The one gone over from the top, moving from (x0, y0) to (x1, y1), if any (the highest, if more than one). */
  wentOver(x0: number, y0: number, x1: number, y1: number): LedgeSegment | null {
    let best: LedgeSegment | null = null;
    for (const s of this.near(x1, y1, Math.hypot(x1 - x0, y1 - y0) + 4)) {
      if (!(side(s, x0, y0) < 0 && side(s, x1, y1) >= 0)) continue;
      const t = along(s, x1, y1);
      if (t < -2 || t > s.len + 2) continue;
      if (!best || s.drop > best.drop) best = s;
    }
    return best;
  }

  /** Whether (x, y) is within `r` of one (either side). */
  by(x: number, y: number, r: number): boolean {
    for (const s of this.near(x, y, r)) {
      const t = along(s, x, y);
      if (t >= -r && t <= s.len + r && Math.abs(side(s, x, y)) < r) return true;
    }
    return false;
  }

  /** The biggest drop within `r` of (x, y), px, or 0. */
  dropNear(x: number, y: number, r: number): number {
    let most = 0;
    for (const s of this.near(x, y, r)) {
      const t = Math.max(0, Math.min(s.len, along(s, x, y)));
      if (Math.hypot(s.ax + ((s.bx - s.ax) * t) / s.len - x, s.ay + ((s.by - s.ay) * t) / s.len - y) < r) most = Math.max(most, s.drop);
    }
    return most;
  }

  /**
   * Below one, it's a wall: the car (its middle on the low side) pushed back
   * out of any it's into, and bounced off. From the top, it's not in the way
   * (you go over it). Returns the hardest hit, px/s, and where.
   */
  collide(car: CarState, contact?: { x: number; y: number }): number {
    const { radius, offsets } = carHull(car);
    const [c, s] = [Math.cos(car.heading), Math.sin(car.heading)];
    let strongest = 0;
    for (const seg of this.near(car.x, car.y, offsets[offsets.length - 1] + radius + 2)) {
      if (side(seg, car.x, car.y) <= 0) continue;
      // How far the nearest of its circles is into it.
      let deepest = 0;
      let at: [number, number] | null = null;
      for (const o of offsets) {
        const [x, y] = [car.x + c * o, car.y + s * o];
        const t = along(seg, x, y);
        const off = side(seg, x, y);
        // (Not what's over the top: going over the edge, or landing below it, that's not up against it.)
        if (t < 0 || t > seg.len || off < 0) continue;
        const depth = radius - off;
        if (depth > deepest) [deepest, at] = [depth, [x - seg.nx * radius, y - seg.ny * radius]];
      }
      if (deepest <= 0) continue;
      car.x += seg.nx * deepest;
      car.y += seg.ny * deepest;
      // Into it: that speed bounced back a little; along it, scraped.
      const into = -(car.vx * seg.nx + car.vy * seg.ny);
      if (into > 0) {
        car.vx += seg.nx * into * 1.3;
        car.vy += seg.ny * into * 1.3;
        const [tx, ty] = [-seg.ny, seg.nx];
        const slide = car.vx * tx + car.vy * ty;
        car.vx -= tx * slide * 0.15;
        car.vy -= ty * slide * 0.15;
        if (into > strongest) {
          strongest = into;
          if (contact && at) [contact.x, contact.y] = at;
        }
      }
    }
    return strongest;
  }
}

/** How far (x, y) is off its line, px: on the low side, positive. */
export function side(s: LedgeSegment, x: number, y: number): number {
  return (x - s.ax) * s.nx + (y - s.ay) * s.ny;
}

/** How far along it (x, y) is, px. */
export function along(s: LedgeSegment, x: number, y: number): number {
  return ((x - s.ax) * (s.bx - s.ax) + (y - s.ay) * (s.by - s.ay)) / s.len;
}

/** How fast something falling `drop` px hits the ground, px/s. */
export function landingSpeed(drop: number): number {
  return Math.sqrt(2 * GRAVITY * Math.max(0, drop));
}
