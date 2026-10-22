import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import bristol from '../test/bristol';
import { jumpSpot, placeName } from './overview';

const map = bristol as unknown as GameMap;
const M = 8;

describe("the pause menu's map", () => {
  it('puts you down on a road you can drive along, near where you picked, facing along it', () => {
    // The middle of College Green (the grass).
    const { x, y } = map.spawn;
    const spot = jumpSpot(map, x + 40 * M, y + 30 * M, 'drive')!;
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot.x - x - 40 * M, spot.y - y - 30 * M)).toBeLessThan(80 * M);
    const road = map.roads.find((r) => ['trunk', 'primary', 'secondary', 'tertiary', 'street', 'service'].includes(r.kind) && !r.bridge && near(r.pts, spot.x, spot.y, r.width / 2 + 1));
    expect(road).toBeDefined();
    expect(spot.name).toBeTruthy();
  });

  it('on foot, onto a path too; never up on a bridge', () => {
    for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.5], [0.7, 0.4], [0.2, 0.8], [0.8, 0.8]]) {
      const [x, y] = [map.width * fx, map.height * fy];
      const walk = jumpSpot(map, x, y, 'foot')!;
      const drive = jumpSpot(map, x, y, 'drive')!;
      // Walking, it's never further off than driving (driving, you're put on the left of the road).
      expect(Math.hypot(walk.x - x, walk.y - y)).toBeLessThanOrEqual(Math.hypot(drive.x - x, drive.y - y) + 4 * M);
      expect(map.roads.some((r) => r.bridge && near(r.pts, drive.x, drive.y, 0.5) && !map.roads.some((o) => !o.bridge && near(o.pts, drive.x, drive.y, r.width)))).toBe(false);
    }
  });

  it('names the street there', () => {
    // (The one up from College Green, by where you start: not Totterdown's.)
    const park = map.roads.find((r) => r.name === 'Park Street' && Math.hypot(r.pts[0] - map.spawn.x, r.pts[1] - map.spawn.y) < 600 * 8)!;
    expect(placeName(map, park.pts[0], park.pts[1])).toBe('Park Street');
  });
});

function near(pts: number[], x: number, y: number, within: number): boolean {
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay, dx, dy] = [pts[k], pts[k + 1], pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(ax + dx * t - x, ay + dy * t - y) <= within) return true;
  }
  return false;
}
