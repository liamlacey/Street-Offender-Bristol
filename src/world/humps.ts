/**
 * Speed humps, raised tables and speed cushions across the roads: driving
 * over one fast is a jolt, and takes speed off (more the faster, more for a
 * round-topped hump than a long flat table). Pure, so it's tested.
 */

import type { CarState } from '../car/CarPhysics';
import type { GameMap, PaintMark } from '../map/osm';

type HumpKind = 'table' | 'hump' | 'cushion';

/** How long each is along the road, px; and for cushions, how wide each is (one in the middle of each lane). */
export const HUMP_LENGTH: Record<HumpKind, number> = { table: 6 * 8, hump: 3.7 * 8, cushion: 3 * 8 };
export const CUSHION_WIDTH = 1.9 * 8;

/** Below this, px/s, it's taken gently: no jolt. Above it, the speed lost grows with the speed, up to a most. */
const GENTLE: Record<HumpKind, number> = { table: 90, hump: 60, cushion: 70 };
const HARSHEST: Record<HumpKind, number> = { table: 0.18, hump: 0.32, cushion: 0.25 };

/** Where the middle of each cushion is, across the road from its middle, px: one in each lane (a two-way road's two; one-way, its middle). */
export function cushionsAcross(m: PaintMark): number[] {
  return m.width >= 6 * 8 ? [-m.width / 4, m.width / 4] : [0];
}

export class Humps {
  private readonly humps: (PaintMark & { kind: HumpKind; ux: number; uy: number })[];

  constructor(map: GameMap) {
    this.humps = (map.paint ?? [])
      .filter((m): m is PaintMark & { kind: HumpKind } => m.kind === 'table' || m.kind === 'hump' || m.kind === 'cushion')
      .map((m) => ({ ...m, ux: Math.cos(m.angle), uy: Math.sin(m.angle) }));
  }

  /**
   * The car's gone from (px, py) to where it is: if it's crossed the middle of
   * a hump (and, for cushions, gone over one, not between), it's jolted and
   * slowed. Returns how hard (px/s of speed lost), 0 for none.
   */
  over(car: CarState, px: number, py: number): number {
    for (const h of this.humps) {
      const before = (px - h.x) * h.ux + (py - h.y) * h.uy;
      const now = (car.x - h.x) * h.ux + (car.y - h.y) * h.uy;
      if (before > 0 === now > 0 || Math.abs(now) > HUMP_LENGTH[h.kind]) continue;
      const across = -(car.x - h.x) * h.uy + (car.y - h.y) * h.ux;
      if (Math.abs(across) > h.width / 2) continue;
      if (h.kind === 'cushion' && !cushionsAcross(h).some((c) => Math.abs(across - c) < CUSHION_WIDTH / 2 + 4)) continue;
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
