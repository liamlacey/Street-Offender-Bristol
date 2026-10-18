/**
 * Makes the map from OpenStreetMap truer to life with the Environment
 * Agency's LIDAR: lines the heights up with the buildings, then gives the
 * buildings OSM doesn't give a height their measured one (and a pitched or
 * flat roof, by how much the roof's height varies), gives OSM's trees their
 * heights, and adds the trees OSM hasn't got. Pure, so it's tested.
 */

import { type HeightGrid, type Raster, bestShift, findTrees, heightAt, heightGrid, quantile, sample } from './lidar.ts';
import { type GameMap, Projection, type Pts, type TerrainData, VEHICLE_ROADS, pointInRing, ridgeAxis, ringArea } from './osm.ts';
import { toNationalGrid } from './osgb.ts';

export interface LidarReport {
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

/**
 * How far to move the LIDAR (metres east and south) so it lines up with the
 * buildings: they should stand high and the roads lie low. Only the
 * buildings and roads within `within` (map px: x0, y0, x1, y1) are used, if given.
 */
export function alignLidar(map: GameMap, dsm: Raster, dtm: Raster, within?: [number, number, number, number]): [number, number] {
  const px = map.pxPerMetre;
  const grid = nationalGridOf(map);
  const raw = (x: number, y: number) => {
    const [e, n] = grid(x, y);
    return sample(dsm, e, n) - sample(dtm, e, n);
  };
  const keep = ([x, y]: [number, number]) => !within || (x >= within[0] && y >= within[1] && x <= within[2] && y <= within[3]);
  const inside: [number, number][] = [];
  for (const b of map.buildings) {
    if (!b.solid || Math.abs(ringArea(b.rings[0])) < 150 * px * px) continue;
    for (const p of pointsInside(b.rings, 4 * px)) if (keep(p)) inside.push(p);
  }
  const open: [number, number][] = [];
  for (const r of map.roads) {
    if (!VEHICLE_ROADS.has(r.kind) || r.kind === 'service') continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const len = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
      for (let d = 0; d < len; d += 10 * px) {
        const p: [number, number] = [r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * d) / len, r.pts[i + 1] + ((r.pts[i + 3] - r.pts[i + 1]) * d) / len];
        if (keep(p)) open.push(p);
      }
    }
  }
  const thin = <T>(list: T[], max: number) => list.filter((_, i) => i % Math.ceil(list.length / max) === 0);
  const [sx, sy] = bestShift(raw, thin(inside, 3000), thin(open, 1500), 8 * px, px / 2);
  return [sx / px, sy / px];
}

/**
 * Moves a raster by a shift from `alignLidar` (metres east and south), so
 * reading it at a map point's position gives the reading that lines up there.
 */
export function shiftRaster(r: Raster, [east, south]: [number, number]): Raster {
  return { ...r, e0: r.e0 - east, n0: r.n0 + south };
}

/**
 * Lays rasters over each other into one covering them all: where they
 * overlap, the first with a reading there wins.
 */
export function mergeRasters(rasters: Raster[]): Raster {
  if (rasters.length === 1) return rasters[0];
  const e0 = Math.min(...rasters.map((r) => r.e0));
  const n0 = Math.max(...rasters.map((r) => r.n0));
  const e1 = Math.max(...rasters.map((r) => r.e0 + r.cols - 1));
  const n1 = Math.min(...rasters.map((r) => r.n0 - r.rows + 1));
  const cols = Math.round(e1 - e0) + 1;
  const rows = Math.round(n0 - n1) + 1;
  const data = new Float32Array(cols * rows).fill(NaN);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      for (const r of rasters) {
        const v = sample(r, e0 + i, n0 - j);
        if (v === v) {
          data[j * cols + i] = v;
          break;
        }
      }
    }
  }
  return { e0, n0, cols, rows, data };
}

/**
 * Measures the buildings and trees, and makes the terrain, from LIDAR that's
 * already lined up with the map (see alignLidar and shiftRaster).
 */
export function addLidar(map: GameMap, dsm: Raster, dtm: Raster): LidarReport {
  const px = map.pxPerMetre;
  const grid = nationalGridOf(map);
  const g = heightGrid(dsm, dtm, map.width, map.height, px, grid);

  const report: LidarReport = { buildingsMeasured: 0, roofsPitched: 0, roofsFlat: 0, treesMeasured: 0, treesAdded: 0 };

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
  map.terrain = terrainOf(map, dtm, grid);
  return report;
}

/** The terrain grid's spacing, metres: the hills are smooth enough for this, and it keeps the map small. */
const TERRAIN_CELL = 4;

/**
 * The bare ground's height every TERRAIN_CELL metres (the average of the
 * LIDAR's readings round each point), with the bridges' decks laid across
 * the water and roads they span rather than dipping down to them.
 */
export function terrainOf(map: GameMap, dtm: Raster, toGrid: (x: number, y: number) => [number, number]): TerrainData {
  const px = map.pxPerMetre;
  const cell = TERRAIN_CELL * px;
  const cols = Math.ceil(map.width / cell) + 1;
  const rows = Math.ceil(map.height / cell) + 1;
  const z = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1.5; dy <= 1.5; dy++) {
        for (let dx = -1.5; dx <= 1.5; dx++) {
          const [e, nn] = toGrid(i * cell + dx * px, j * cell + dy * px);
          const v = sample(dtm, e, nn);
          if (v === v) {
            sum += v;
            n++;
          }
        }
      }
      z[j * cols + i] = n ? sum / n : NaN;
    }
  }
  fillGaps(z, cols, rows);
  // Smooth out the bumps (kerbs, walls, what's left where buildings were taken out of the survey).
  for (let pass = 0; pass < 2; pass++) smooth(z, cols, rows);

  // Bridges: a straight deck from one end to the other, over whatever's below.
  const at = (x: number, y: number) => z[Math.max(0, Math.min(rows - 1, Math.round(y / cell))) * cols + Math.max(0, Math.min(cols - 1, Math.round(x / cell)))];
  for (const r of map.roads) {
    if (!r.bridge || r.pts.length < 4) continue;
    const n = r.pts.length;
    const z0 = at(r.pts[0], r.pts[1]);
    const z1 = at(r.pts[n - 2], r.pts[n - 1]);
    let total = 0;
    for (let k = 0; k + 3 < n; k += 2) total += Math.hypot(r.pts[k + 2] - r.pts[k], r.pts[k + 3] - r.pts[k + 1]);
    let along = 0;
    const reach = r.width / 2 + cell;
    for (let k = 0; k + 3 < n; k += 2) {
      const [ax, ay, bx, by] = [r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]];
      const len = Math.hypot(bx - ax, by - ay);
      for (let i = Math.floor((Math.min(ax, bx) - reach) / cell); i <= Math.ceil((Math.max(ax, bx) + reach) / cell); i++) {
        for (let j = Math.floor((Math.min(ay, by) - reach) / cell); j <= Math.ceil((Math.max(ay, by) + reach) / cell); j++) {
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          const t = len ? Math.max(0, Math.min(1, ((i * cell - ax) * (bx - ax) + (j * cell - ay) * (by - ay)) / (len * len))) : 0;
          if (Math.hypot(ax + (bx - ax) * t - i * cell, ay + (by - ay) * t - j * cell) > reach) continue;
          const deck = z0 + ((z1 - z0) * (along + t * len)) / (total || 1);
          z[j * cols + i] = Math.max(z[j * cols + i], deck);
        }
      }
      along += len;
    }
  }

  let base = Infinity;
  for (const v of z) base = Math.min(base, v);
  base = Math.floor(base);
  const bytes = new Uint8Array(cols * rows * 2);
  for (let k = 0; k < z.length; k++) {
    const d = Math.max(0, Math.min(65535, Math.round((z[k] - base) * 10)));
    bytes[k * 2] = d & 255;
    bytes[k * 2 + 1] = d >> 8;
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { cell, cols, rows, base, heights: btoa(binary) };
}

/** Averages each point with its neighbours. */
function smooth(z: Float32Array, cols: number, rows: number): void {
  const out = z.slice();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let sum = 0;
      let weight = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const w = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
          sum += z[jj * cols + ii] * w;
          weight += w;
        }
      }
      out[j * cols + i] = sum / weight;
    }
  }
  z.set(out);
}

/** Fills in the cells with no reading from their neighbours, a ring at a time. */
function fillGaps(z: Float32Array, cols: number, rows: number): void {
  for (let pass = 0; pass < 50; pass++) {
    let missing = 0;
    const next = z.slice();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (z[j * cols + i] === z[j * cols + i]) continue;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const v = z[jj * cols + ii];
          if (v === v) {
            sum += v;
            n++;
          }
        }
        if (n) next[j * cols + i] = sum / n;
        else missing++;
      }
    }
    z.set(next);
    if (!missing) return;
  }
  for (let k = 0; k < z.length; k++) if (z[k] !== z[k]) z[k] = 0;
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
