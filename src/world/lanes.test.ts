import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { buildLanes, turnBetween } from './traffic';

/** Where a line turns back on itself: each pair of segments more than `most` radians apart (and how long the first is, px). */
function doublings(pts: number[], most = 2.5): { at: [number, number]; len: number; turn: number }[] {
  const out: { at: [number, number]; len: number; turn: number }[] = [];
  for (let k = 0; k + 5 < pts.length; k += 2) {
    const [ax, ay] = [pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]];
    const [bx, by] = [pts[k + 4] - pts[k + 2], pts[k + 5] - pts[k + 3]];
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (turn > most) out.push({ at: [pts[k + 2], pts[k + 3]], len: Math.hypot(ax, ay), turn });
  }
  return out;
}

describe('the lanes', () => {
  // The region round the M32's junction at Newfoundland Way (where a lane began with a step backwards, and the turn into it
  // looped round to come at it that way: the traffic spun round there).
  const map = bristol as unknown as GameMap;
  const { index, tiles } = splitMap(map);
  const [cx, cy] = [Math.round(57072 / TILE) * TILE, Math.round(20495 / TILE) * TILE];
  const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
  const region = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
  const { lanes } = buildLanes(region);

  it('never double back on themselves', () => {
    const bad = lanes.flatMap((l) => doublings(l.pts).map((d) => ({ lane: l.id, ...d })));
    expect(bad).toEqual([]);
  });

  it('are turned into smoothly, without looping round', () => {
    // Every lane into the next from the same junction (as the traffic might turn): the turn between them never doubles back.
    const into = new Map<number, typeof lanes>();
    for (const l of lanes) into.set(l.from, [...(into.get(l.from) ?? []), l]);
    let loops = 0;
    for (const a of lanes) {
      for (const next of into.get(a.to) ?? []) {
        // (Not one turning right round, back the way it came, or near enough: that's as tight as it is.)
        const [ux, uy] = [a.pts.at(-2)! - a.pts.at(-4)!, a.pts.at(-1)! - a.pts.at(-3)!];
        const [vx, vy] = [next.pts[2] - next.pts[0], next.pts[3] - next.pts[1]];
        if (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > 2.2) continue;
        if (doublings(turnBetween(a, next).pts, 2).length) loops++;
      }
    }
    expect(loops).toBe(0);
  });
}, 300_000);
