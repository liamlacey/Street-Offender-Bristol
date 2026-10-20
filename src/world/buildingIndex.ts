/**
 * The buildings as Buildings.ts draws them: each one's box and the height of
 * the ground it stands on, the squares of the map each reaches into, and the
 * solar panels on its roof; worked out (a little at a time) as a region of
 * the map's made ready (see streamer.ts), so changing regions doesn't hold a
 * frame up. Pure, so it's tested.
 */

import { type Building, pointInRing, ridgeAxis } from '../map/osm';
import type { BuildingLook } from './buildingLook';
import type { Terrain } from './terrain';
import { type Work, drain, every } from './work.ts';
import type { World } from './world';

/** The squares buildings are found in, px. */
export const CELL = 512;
export const cellKey = (cx: number, cy: number) => (cx + 1024) * 4096 + (cy + 1024);

/** A building: its box, the height of the ground it stands on, px, its solar panels; and its look, once it's been near the view. */
export interface BuildingEntry {
  b: Building;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ground: number;
  panels: number[][];
  look: (BuildingLook & { ground: number }) | null;
}

export interface BuildingIndex {
  /** In the order they're drawn (those whose roofs are highest last, over the rest). */
  all: BuildingEntry[];
  /** Which are in each square of the map (by where their boxes reach), in drawing order. */
  cells: Map<number, number[]>;
}

export function buildingIndex(world: World, terrain: Terrain): BuildingIndex {
  return drain(buildingIndexWork(world, terrain));
}

/** The same, a little at a time (see work.ts). */
export function* buildingIndexWork(world: World, terrain: Terrain): Work<BuildingIndex> {
  const pause = every(400);
  const all: BuildingEntry[] = [];
  for (const b of world.map.buildings) {
    if (!b.drawn) continue;
    if (pause()) yield;
    // Its lowest corner, so it never floats above the ground on a slope.
    let ground = Infinity;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const ring = b.rings[0];
    for (let i = 0; i < ring.length; i += 2) {
      ground = Math.min(ground, terrain.at(ring[i], ring[i + 1]) * terrain.px);
      [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
    }
    all.push({ b, x0, y0, x1, y1, ground, panels: [], look: null });
  }
  all.sort((a, b) => a.ground + a.b.top - (b.ground + b.b.top));
  yield;
  const cells = new Map<number, number[]>();
  for (const [i, e] of all.entries()) {
    if (pause()) yield;
    for (let cx = Math.floor(e.x0 / CELL); cx <= Math.floor(e.x1 / CELL); cx++) {
      for (let cy = Math.floor(e.y0 / CELL); cy <= Math.floor(e.y1 / CELL); cy++) {
        const k = cellKey(cx, cy);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  }
  yield;
  // Solar panels on the roofs: an array as big as its panels (1.7 m² each), along the building's long side.
  const solar = world.map.solar ?? [];
  for (let i = 0; i + 2 < solar.length; i += 3) {
    if (pause()) yield;
    const [x, y, count] = [solar[i], solar[i + 1], solar[i + 2]];
    const k = (cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []).find((j) => {
      const l = all[j];
      return x > l.x0 && x < l.x1 && y > l.y0 && y < l.y1 && pointInRing(x, y, l.b.rings[0]);
    });
    if (k === undefined) continue;
    const on = all[k];
    const { ux, uy } = ridgeAxis(on.b.rings[0], on.b.roofAcross);
    const area = count * 1.7 * 64;
    const w = Math.sqrt(area * 2);
    const h = area / w;
    const [nx, ny] = [-uy, ux];
    on.panels.push([
      x - (ux * w) / 2 - (nx * h) / 2, y - (uy * w) / 2 - (ny * h) / 2,
      x + (ux * w) / 2 - (nx * h) / 2, y + (uy * w) / 2 - (ny * h) / 2,
      x + (ux * w) / 2 + (nx * h) / 2, y + (uy * w) / 2 + (ny * h) / 2,
      x - (ux * w) / 2 + (nx * h) / 2, y - (uy * w) / 2 + (ny * h) / 2,
    ]);
  }
  return { all, cells };
}
