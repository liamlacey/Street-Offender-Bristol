/**
 * The kerbs between the roads and the pavements: going up or down one at
 * speed is a jolt, and takes some speed off; but not where the kerb's
 * dropped (OSM's `kerb=lowered` or `flush`), or at a crossing (where it
 * always is). Pure, so it's tested.
 */

import type { CarState } from '../car/CarPhysics';
import type { GameMap } from '../map/osm';

/** How near a dropped kerb (OSM marks the middle of it), px. */
const DROPPED_NEAR = 3 * 8;
/** How far beyond the road's edge a crossing's dropped kerbs reach, px. */
const CROSSING_NEAR = 3 * 8;
/** Below this, px/s, it's just rolled over. */
const KERB_SLOW = 40;
/** How much speed a kerb takes off: going up it, and coming down. */
const KERB_UP = 0.08;
const KERB_DOWN = 0.04;

export class Kerbs {
  /** x, y, how near, ... */
  private readonly dropped: number[] = [];

  constructor(map: GameMap) {
    const d = map.dropped ?? [];
    for (let i = 0; i < d.length; i += 2) this.dropped.push(d[i], d[i + 1], DROPPED_NEAR);
    for (const c of map.crossings) this.dropped.push(c.x, c.y, c.width / 2 + CROSSING_NEAR);
  }

  /** Whether the kerb at (x, y) is dropped. */
  droppedAt(x: number, y: number): boolean {
    const d = this.dropped;
    for (let i = 0; i < d.length; i += 3) if (Math.hypot(d[i] - x, d[i + 1] - y) < d[i + 2]) return true;
    return false;
  }

  /**
   * The car's just gone up a kerb (`up`) or down one at (its middle): it's
   * jolted, and slowed. Returns how hard (px/s of speed lost), 0 for none.
   */
  bump(car: CarState, up: boolean): number {
    const speed = Math.hypot(car.vx, car.vy);
    if (speed < KERB_SLOW || this.droppedAt(car.x, car.y)) return 0;
    const loss = up ? KERB_UP : KERB_DOWN;
    car.vx *= 1 - loss;
    car.vy *= 1 - loss;
    return speed * loss;
  }
}
