/**
 * Speed humps, raised tables and speed cushions across the roads: driving
 * over one fast is a jolt, and takes speed off (more the faster, more for a
 * round-topped hump than a long flat table). Down (or up) a flight of steps
 * it's a little jolt at every one. Pure, so it's tested.
 */

import type { CarState } from '../car/CarPhysics';
import type { GameMap, PaintMark } from '../map/osm';
import { lineLength, pointAlong } from './world';

type HumpKind = 'table' | 'hump' | 'cushion' | 'step';

/** How long each is along the road, px; and for cushions, how wide each is (one in the middle of each lane). A step's how far either side of its edge it's felt. */
export const HUMP_LENGTH: Record<HumpKind, number> = { table: 6 * 8, hump: 3.7 * 8, cushion: 3 * 8, step: 8 };
export const CUSHION_WIDTH = 1.9 * 8;

/** Below this, px/s, it's taken gently: no jolt. Above it, the speed lost grows with the speed, up to a most. */
const GENTLE: Record<HumpKind, number> = { table: 90, hump: 60, cushion: 70, step: 50 };
const HARSHEST: Record<HumpKind, number> = { table: 0.18, hump: 0.32, cushion: 0.25, step: 0.05 };

/** Where the middle of each cushion is, across the road from its middle, px: one in each lane (a two-way road's two; one-way, its middle). */
export function cushionsAcross(m: { width: number }): number[] {
  return m.width >= 6 * 8 ? [-m.width / 4, m.width / 4] : [0];
}

/** The humps by which square of the map they're in (each in those it reaches into), px. */
const CELL = 32 * 8;

/** Whether a point `across` the road from its middle is on one of its cushions. */
function onCushion(width: number, across: number): boolean {
  return width >= 6 * 8 ? Math.abs(across + width / 4) < CUSHION_WIDTH / 2 + 4 || Math.abs(across - width / 4) < CUSHION_WIDTH / 2 + 4 : Math.abs(across) < CUSHION_WIDTH / 2 + 4;
}

export class Humps {
  private readonly humps: (Omit<PaintMark, 'kind'> & { kind: HumpKind; ux: number; uy: number })[];
  private readonly cells = new Map<number, Humps['humps']>();

  constructor(map: GameMap) {
    this.humps = (map.paint ?? [])
      .filter((m): m is PaintMark & { kind: HumpKind } => m.kind === 'table' || m.kind === 'hump' || m.kind === 'cushion')
      .map((m) => ({ ...m, ux: Math.cos(m.angle), uy: Math.sin(m.angle) }));
    // Each step's edge, where it's drawn (see drawSteps).
    for (const r of map.roads ?? []) {
      if (r.kind !== 'steps' || !r.steps) continue;
      const len = lineLength(r.pts);
      const n = Math.max(1, Math.min(r.steps, Math.floor(len / (0.3 * 8))));
      for (let k = 0; k < n; k++) {
        const [x, y, ux, uy] = pointAlong(r.pts, (len * (k + 0.5)) / n, 4);
        this.humps.push({ kind: 'step', x, y, angle: Math.atan2(uy, ux), width: r.width, ux, uy });
      }
    }
    for (const h of this.humps) {
      const reach = h.width / 2 + HUMP_LENGTH[h.kind];
      for (let i = Math.floor((h.x - reach) / CELL); i <= Math.floor((h.x + reach) / CELL); i++) {
        for (let j = Math.floor((h.y - reach) / CELL); j <= Math.floor((h.y + reach) / CELL); j++) {
          const key = i * 100003 + j;
          const list = this.cells.get(key);
          if (list) list.push(h);
          else this.cells.set(key, [h]);
        }
      }
    }
  }

  /**
   * The car's gone from (px, py) to where it is: if it's crossed the middle of
   * a hump (and, for cushions, gone over one, not between), it's jolted and
   * slowed. Returns how hard (px/s of speed lost), 0 for none.
   */
  over(car: CarState, px: number, py: number): number {
    // (Only those round where it is.)
    const list = this.cells.get(Math.floor(car.x / CELL) * 100003 + Math.floor(car.y / CELL));
    if (!list) return 0;
    for (let k = 0; k < list.length; k++) {
      const h = list[k];
      const before = (px - h.x) * h.ux + (py - h.y) * h.uy;
      const now = (car.x - h.x) * h.ux + (car.y - h.y) * h.uy;
      if (before > 0 === now > 0 || Math.abs(now) > HUMP_LENGTH[h.kind]) continue;
      const across = -(car.x - h.x) * h.uy + (car.y - h.y) * h.ux;
      if (Math.abs(across) > h.width / 2) continue;
      if (h.kind === 'cushion' && !onCushion(h.width, across)) continue;
      const speed = Math.hypot(car.vx, car.vy);
      const loss = Math.min(HARSHEST[h.kind], Math.max(0, (speed - GENTLE[h.kind]) / 1200));
      if (!loss) return 0;
      car.vx *= 1 - loss;
      car.vy *= 1 - loss;
      return speed * loss;
    }
    return 0;
  }
}
