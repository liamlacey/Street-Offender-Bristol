/**
 * Makes the map from OpenStreetMap truer to life with the Environment
 * Agency's LIDAR: lines the heights up with the buildings, then gives the
 * buildings OSM doesn't give a height their measured one (and a pitched or
 * flat roof, by how much the roof's height varies), gives OSM's trees their
 * heights, and adds the trees OSM hasn't got. Pure, so it's tested.
 */

import { type HeightGrid, type Raster, bestShift, findTrees, heightAt, heightGrid, quantile, sample } from './lidar.ts';
import { type GameMap, Projection, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis, ringArea } from './osm.ts';
import { toNationalGrid } from './osgb.ts';

export interface LidarReport {
  /** How far the LIDAR was moved to line up with the buildings, metres east and south. */
  shift: [number, number];
  buildingsMeasured: number;
  roofsPitched: number;
  roofsFlat: number;
  treesMeasured: number;
  treesAdded: number;
}

/** Roofs that rise more than this from eaves to ridge are pitched, metres. */
const PITCH = 1.5;
/** And those whose heights spread less than this are flat. */
const FLAT = 0.6;

/** A map point's National Grid position: near enough linear over a few kilometres, so fitted from three points. */
export function nationalGridOf(map: GameMap): (x: number, y: number) => [number, number] {
  const proj = new Projection(map.origin.lat, map.origin.lon, map.pxPerMetre);
  const at = (x: number, y: number) => toNationalGrid(proj.lat(y), proj.lon(x));
  const [e0, n0] = at(0, 0);
  const [ex, nx] = at(map.width, 0);
  const [ey, ny] = at(0, map.height);
  const [dex, dnx] = [(ex - e0) / map.width, (nx - n0) / map.width];
  const [dey, dny] = [(ey - e0) / map.height, (ny - n0) / map.height];
  return (x, y) => [e0 + dex * x + dey * y, n0 + dnx * x + dny * y];
}

export function addLidar(map: GameMap, dsm: Raster, dtm: Raster): LidarReport {
  const px = map.pxPerMetre;
  const grid = nationalGridOf(map);

  // Line the heights up: buildings should stand high and roads lie low.
  const raw = (x: number, y: number) => {
    const [e, n] = grid(x, y);
    return sample(dsm, e, n) - sample(dtm, e, n);
  };
  const inside: [number, number][] = [];
  for (const b of map.buildings) {
    if (!b.solid || Math.abs(ringArea(b.rings[0])) < 150 * px * px) continue;
    for (const [x, y] of pointsInside(b.rings, 4 * px)) inside.push([x, y]);
  }
  const open: [number, number][] = [];
  for (const r of map.roads) {
    if (!VEHICLE_ROADS.has(r.kind) || r.kind === 'service') continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const len = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
      for (let d = 0; d < len; d += 10 * px) open.push([r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * d) / len, r.pts[i + 1] + ((r.pts[i + 3] - r.pts[i + 1]) * d) / len]);
    }
  }
  const thin = <T>(list: T[], max: number) => list.filter((_, i) => i % Math.ceil(list.length / max) === 0);
  const [sx, sy] = bestShift(raw, thin(inside, 3000), thin(open, 1500), 8 * px, px / 2);
  const g = heightGrid(dsm, dtm, map.width, map.height, px, (x, y) => grid(x + sx, y + sy));

  const report: LidarReport = { shift: [sx / px, sy / px], buildingsMeasured: 0, roofsPitched: 0, roofsFlat: 0, treesMeasured: 0, treesAdded: 0 };

  // Buildings: the height of most of the roof, and whether it's pitched.
  for (const b of map.buildings) {
    if (b.bottom > 0 || b.heightFrom === 'tag' || b.kind === 'roof') continue;
    // Away from the walls, where a reading might have caught the ground or the building next door.
    const all = pointsInside(b.rings, px);
    const core = all.filter(([x, y]) => distanceToRings(x, y, b.rings) > 1.5 * px);
    const points = (core.length >= 4 ? core : all).map(([x, y]) => [x, y, heightAt(g, x, y)] as const).filter((p) => p[2] === p[2]);
    if (points.length < 4) continue;
    const top = quantile(points.map((p) => p[2]), 0.9);
    if (top < 2.5 || top > 150) continue;
    b.top = Math.round(top * px);
    b.heightFrom = 'lidar';
    report.buildingsMeasured++;
    if (b.roofShape || points.length < 8 || Math.abs(ringArea(b.rings[0])) > 1500 * px * px) continue;
    const shape = roofShape(b.rings[0], points, px);
    if (shape === 'flat') {
      b.roofShape = 'flat';
      report.roofsFlat++;
    } else if (shape) {
      b.roofShape = 'gabled';
      if (shape === 'across') b.roofAcross = true;
      report.roofsPitched++;
    }
  }

  // Trees: where one could stand, out of the buildings, water and roads.
  const blocked = blockedCells(map, g);
  const allowed = (i: number, j: number) => i >= 0 && j >= 0 && i < g.cols && j < g.rows && !blocked[j * g.cols + i];
  const found = findTrees(g, allowed, px);
  const osm = map.trees;
  const matched = new Set<number>();
  const added: number[] = [];
  for (const t of found) {
    // An OSM tree here already: it's the one measured.
    let near = -1;
    let nearD = 5 * px;
    for (let k = 0; k < osm.length; k += 4) {
      const d = Math.hypot(osm[k] - t.x, osm[k + 1] - t.y);
      if (d < nearD) {
        nearD = d;
        near = k;
      }
    }
    if (near >= 0) {
      if (!matched.has(near)) {
        osm[near + 3] = Math.round(t.h * px);
        matched.add(near);
        report.treesMeasured++;
      }
      continue;
    }
    added.push(Math.round(t.x), Math.round(t.y), Math.round(t.r * px), Math.round(t.h * px));
  }
  osm.push(...added);
  report.treesAdded = added.length / 4;
  return report;
}

/** Points every `step` px inside some rings (filled even-odd). */
function pointsInside(rings: Pts[], step: number): [number, number][] {
  const out: [number, number][] = [];
  const outer = rings[0];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outer.length; i += 2) {
    x0 = Math.min(x0, outer[i]);
    x1 = Math.max(x1, outer[i]);
    y0 = Math.min(y0, outer[i + 1]);
    y1 = Math.max(y1, outer[i + 1]);
  }
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (rings.filter((r) => pointInRing(x, y, r)).length % 2 === 1) out.push([x, y]);
    }
  }
  return out;
}

/** The cells no tree can stand in: buildings (and a metre round them), water, and the roads' carriageways. */
function blockedCells(map: GameMap, g: HeightGrid): Uint8Array {
  const blocked = new Uint8Array(g.cols * g.rows);
  const mark = (x: number, y: number) => {
    const i = Math.floor(x / g.cell);
    const j = Math.floor(y / g.cell);
    if (i >= 0 && j >= 0 && i < g.cols && j < g.rows) blocked[j * g.cols + i] = 1;
  };
  for (const b of map.buildings) {
    if (b.bottom > 0) continue;
    for (const [x, y] of pointsInside(b.rings, g.cell)) {
      for (const [dx, dy] of [[0, 0], [g.cell, 0], [-g.cell, 0], [0, g.cell], [0, -g.cell]]) mark(x + dx, y + dy);
    }
  }
  for (const a of map.areas) if (a.kind === 'water' || a.kind === 'pool') for (const [x, y] of pointsInside(a.rings, g.cell)) mark(x, y);
  for (const r of map.roads) {
    if (!VEHICLE_ROADS.has(r.kind)) continue;
    const half = r.width / 2;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const [ax, ay, bx, by] = [r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      for (let d = 0; d <= len; d += g.cell / 2) {
        const cx = ax + ((bx - ax) * d) / len;
        const cy = ay + ((by - ay) * d) / len;
        for (let k = -half; k <= half; k += g.cell / 2) mark(cx - ((by - ay) / len) * k, cy + ((bx - ax) / len) * k);
      }
    }
  }
  return blocked;
}

/**
 * Whether a roof is pitched, by whether it falls away either side of a
 * ridge down the middle (along the building, or across it): 'along',
 * 'across', 'flat', or null if it's neither (a jumble of heights).
 */
export function roofShape(outer: Pts, points: (readonly [number, number, number])[], px: number): 'along' | 'across' | 'flat' | null {
  const heights = points.map((p) => p[2]);
  if (quantile([...heights], 0.9) - quantile([...heights], 0.1) < FLAT) return 'flat';
  let best: { fit: number; drop: number; way: 'along' | 'across' } | null = null;
  for (const way of ['along', 'across'] as const) {
    const axis = ridgeAxis(outer, way === 'across');
    // How far each point is from the ridge, against its height: a straight line down from the ridge on a pitched roof.
    const xs = points.map(([x, y]) => Math.abs(-(x - axis.ox) * axis.uy + (y - axis.oy) * axis.ux) / px);
    const n = xs.length;
    const mx = xs.reduce((a, v) => a + v, 0) / n;
    const my = heights.reduce((a, v) => a + v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (heights[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (heights[i] - my) ** 2;
    }
    if (sxx === 0 || syy === 0) continue;
    const slope = sxy / sxx;
    const r = sxy / Math.sqrt(sxx * syy);
    const drop = -slope * (axis.half / px);
    if (slope < 0 && (!best || r * r > best.fit)) best = { fit: r * r, drop, way };
  }
  return best && best.fit > 0.45 && best.drop > PITCH ? best.way : null;
}

/** How far (x, y) is from the nearest wall of some rings, px. */
function distanceToRings(x: number, y: number, rings: Pts[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i += 2) {
      const j = (i + 2) % n;
      const dx = ring[j] - ring[i];
      const dy = ring[j + 1] - ring[i + 1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ring[i]) * dx + (y - ring[i + 1]) * dy) / len2));
      best = Math.min(best, Math.hypot(ring[i] + dx * t - x, ring[i + 1] + dy * t - y));
    }
  }
  return best;
}
