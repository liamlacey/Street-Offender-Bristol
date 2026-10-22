/**
 * For the tests: the region of the map round where you start (the 2 km the
 * game first makes: see src/world/streamer.ts), rather than the whole map,
 * so a test of the traffic or the people in the middle of Bristol takes as
 * long however big the map grows.
 */

import bristol from './bristol';
import type { GameMap } from '../map/osm';
import { type RegionMap, TILE, assemble, splitMap, tilesFor } from '../map/regions';

let made: RegionMap | null = null;

export function central(): RegionMap {
  if (made) return made;
  const map = bristol as unknown as GameMap;
  const { index, tiles } = splitMap(map);
  const [cx, cy] = [Math.round(map.spawn.x / TILE) * TILE, Math.round(map.spawn.y / TILE) * TILE];
  const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
  made = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
  return made;
}
