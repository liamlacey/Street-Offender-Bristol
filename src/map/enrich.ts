/**
 * Makes the map from OpenStreetMap truer to life with the Environment
 * Agency's LIDAR: lines the heights up with the buildings, then gives the
 * buildings OSM doesn't give a height their measured one (and a pitched or
 * flat roof, by how much the roof's height varies), gives OSM's trees their
 * heights, and adds the trees OSM hasn't got. Pure, so it's tested.
 */

import { type HeightGrid, type Raster, bestShift, findTrees, heightAt, heightGrid, quantile, sample } from './lidar.ts';
import { DECK_STEP, type GameMap, type Ledge, Projection, type Road, type Pts, type TerrainData, VEHICLE_ROADS, pointInRing, ridgeAxis, ringArea } from './osm.ts';
import { toNationalGrid } from './osgb.ts';

export interface LidarReport {
  buildingsMeasured: number;
  roofsPitched: number;
  roofsFlat: number;
  treesMeasured: number;
  treesAdded: number;
  wallsMeasured?: number;
  sheltersFound?: number;
  stepsCounted?: number;
  banks?: number;
  ledges?: number;
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
  report.wallsMeasured = wallHeights(map, g, dtm, grid);
  report.sheltersFound = findShelters(map, g, blocked);
  report.stepsCounted = countSteps(map, dtm, grid);
  report.banks = findBanks(map, dtm, grid, blocked, g);
  report.ledges = findLedges(map, dtm, grid);
  map.terrain = terrainOf(map, dtm, grid, dsm);
  return report;
}

/** How far out from a bridge's end the road onto it is brought to meet it, px; and where the ground's measured to check the deck against. */
const APPROACH = 12 * 8;
const BEYOND = 8 * 8;

/**
 * Measures the bridges' decks (see deckProfile), and brings the ground of the
 * roads onto them (`z`, the terrain grid, metres) up or down to meet each one
 * that's measured, over the last APPROACH px. The decks are in metres above
 * sea level: the caller makes them relative to the terrain's base.
 */
function measureDecks(map: GameMap, dsm: Raster, toGrid: (x: number, y: number) => [number, number], z: Float32Array, cols: number, rows: number, cell: number): Map<Road, number[]> {
  const px = map.pxPerMetre;
  const at = (x: number, y: number) => {
    const gx = Math.max(0, Math.min(cols - 1.001, x / cell));
    const gy = Math.max(0, Math.min(rows - 1.001, y / cell));
    const [i, j] = [Math.floor(gx), Math.floor(gy)];
    const [fx, fy] = [gx - i, gy - j];
    const k = j * cols + i;
    return (z[k] * (1 - fx) + z[k + 1] * fx) * (1 - fy) + (z[k + cols] * (1 - fx) + z[k + cols + 1] * fx) * fy;
  };
  const bridges = map.roads.filter((r) => r.bridge && r.pts.length >= 4);
  // An end that meets another bridge's (a bridge mapped in pieces) isn't on the ground.
  const joint = (x: number, y: number, self: Road) => bridges.some((r) => r !== self && [0, r.pts.length - 2].some((k) => Math.hypot(r.pts[k] - x, r.pts[k + 1] - y) < 2));
  // Each end: where it is, which way is out from it, and whether it's on the ground.
  const endsOf = (road: Road) => {
    const p = road.pts;
    const n = p.length;
    const out = (x: number, y: number, fx: number, fy: number) => {
      const len = Math.hypot(x - fx, y - fy) || 1;
      return { x, y, ux: (x - fx) / len, uy: (y - fy) / len, open: !joint(x, y, road) };
    };
    return [out(p[0], p[1], p[2], p[3]), out(p[n - 2], p[n - 1], p[n - 4], p[n - 3])];
  };
  const decks = new Map<Road, number[]>();
  for (const road of bridges) {
    const ends = endsOf(road);
    // The ground a little way out along the road onto it: right at the end, it's already dipping to what's below.
    const ground = ends.map((e) => (e.open ? at(e.x + e.ux * BEYOND, e.y + e.uy * BEYOND) : null)) as [number | null, number | null];
    const deck = deckProfile(road, dsm, toGrid, px, ground);
    if (deck) decks.set(road, deck);
  }
  // The roads onto them, brought to meet them.
  for (const [road, deck] of decks) {
    const half = road.width / 2 + 3 * px;
    endsOf(road).forEach((e, k) => {
      if (!e.open) return;
      const h = k === 0 ? deck[0] : deck[deck.length - 1];
      for (let j = Math.floor((e.y - APPROACH) / cell); j <= Math.ceil((e.y + APPROACH) / cell); j++) {
        for (let i = Math.floor((e.x - APPROACH) / cell); i <= Math.ceil((e.x + APPROACH) / cell); i++) {
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          const [dx, dy] = [i * cell - e.x, j * cell - e.y];
          // How far out from the end (a cell in under it counts as at it), and how far to the side.
          const out = dx * e.ux + dy * e.uy;
          const side = Math.abs(-dx * e.uy + dy * e.ux);
          if (out < -cell || out > APPROACH || side > half) continue;
          const w = 1 - Math.max(0, out) / APPROACH;
          z[j * cols + i] += (h - z[j * cols + i]) * w;
        }
      }
    });
  }
  return decks;
}

/**
 * A bridge's deck, measured: the first-return surface (the deck itself, not
 * the water or road below) every DECK_STEP px along its middle, each the
 * median of the readings across it (a metre in from its edges, clear of the
 * parapets; the median, so a van or a lamp post on it doesn't count), gaps
 * filled from either side and smoothed; metres above sea level. Readings far
 * off the line between the ground at its ends are thrown out, and if too many
 * are (or what's left is still far off it), nothing: it's not measured.
 */
export function deckProfile(
  road: Road,
  dsm: Raster,
  toGrid: (x: number, y: number) => [number, number],
  px: number,
  /** The ground's height (metres) at each end, where it's on the ground (not where it meets another piece of the bridge). */
  ends: [number | null, number | null] = [null, null],
): number[] | undefined {
  const p = road.pts;
  const half = road.width / 2 / px;
  const across: number[] = [];
  for (let o = -(half - 1); o <= half - 1 + 1e-9; o += 1) across.push(o * px);
  if (across.length === 0) across.push(0);
  // Every DECK_STEP along it, and its very end.
  const stations: [number, number, number, number][] = [];
  let run = 0;
  let next = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    while (next <= run + len) {
      const d = next - run;
      stations.push([ax + ux * d, ay + uy * d, ux, uy]);
      next += DECK_STEP;
    }
    run += len;
  }
  if (stations.length === 0) return undefined;
  if (next - DECK_STEP < run - 1) {
    const n = p.length;
    const [ux, uy] = stations[stations.length - 1].slice(2) as [number, number];
    stations.push([p[n - 2], p[n - 1], ux, uy]);
  }
  const z = stations.map(([x, y, ux, uy]) => {
    const readings = across.map((o) => sample(dsm, ...toGrid(x - uy * o, y + ux * o))).filter((v) => v === v);
    return readings.length ? quantile(readings, 0.5) : NaN;
  });
  if (z.every((v) => v !== v)) return undefined;
  // What it should be near: straight between the ground at its ends (where they're on the ground; the
  // readings' middle, where they're not). Readings well above that are trees over it, buildings at its
  // ends or vans on it; well below, the water or the road beneath.
  const middle = quantile(z.filter((v) => v === v), 0.5);
  const [e0, e1] = ends.map((e) => (e === null ? middle : e));
  const line = (i: number) => e0 + ((e1 - e0) * i) / Math.max(1, z.length - 1);
  let rejected = 0;
  for (let i = 0; i < z.length; i++) {
    if (z[i] !== z[i]) continue;
    const off = z[i] - line(i);
    if (off > DECK_ABOVE || off < -DECK_BELOW) {
      z[i] = NaN;
      rejected++;
    }
  }
  if (rejected > z.length / 2 || z.every((v) => v !== v)) return undefined;
  // Gaps filled from the nearest readings either side.
  for (let i = 0; i < z.length; i++) {
    if (z[i] === z[i]) continue;
    let a = i - 1;
    while (a >= 0 && z[a] !== z[a]) a--;
    let b = i + 1;
    while (b < z.length && z[b] !== z[b]) b++;
    z[i] = a < 0 ? z[b] : b >= z.length ? z[a] : z[a] + ((z[b] - z[a]) * (i - a)) / (b - a);
  }
  // Smoothed, over 6 m.
  const smooth = z.map((_, i) => {
    const near = z.slice(Math.max(0, i - 1), i + 2);
    return near.reduce((s, v) => s + v, 0) / near.length;
  });
  if (smooth.some((v, i) => Math.abs(v - line(i)) > DECK_ABOVE)) return undefined;
  return smooth;
}

/** How far above, and below, the straight line between its ends a bridge's deck may be measured, metres. */
const DECK_ABOVE = 2.5;
const DECK_BELOW = 1.5;

/** How tall each kind of wall can believably be, metres: a reading outside this is something else (a tree over it, a van by it). */
const WALL_RANGE: Partial<Record<string, [number, number]>> = {
  wall: [0.5, 4],
  hedge: [0.6, 5],
  fence: [0.8, 3],
};

/**
 * Measures the garden walls, hedges and fences that aren't tagged with a
 * height: the median, along each, of the highest reading across it (on it
 * and 0.7 m either side: the readings are a metre apart, and a wall's
 * thinner). A retaining wall's how far the bare ground drops across it (1.5 m
 * either side). Kept only if it's believable for its kind; how many were.
 */
export function wallHeights(map: GameMap, g: HeightGrid, dtm: Raster, toGrid: (x: number, y: number) => [number, number]): number {
  const px = map.pxPerMetre;
  let measured = 0;
  for (const line of map.lines) {
    if (line.height !== undefined) continue;
    const range = WALL_RANGE[line.kind];
    if (!range) continue;
    const readings: number[] = [];
    const p = line.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      const [nx, ny] = [-uy, ux];
      for (let d = px / 2; d < len; d += px) {
        const [x, y] = [ax + ux * d, ay + uy * d];
        if (line.retaining) {
          const a = sample(dtm, ...toGrid(x + nx * 1.5 * px, y + ny * 1.5 * px));
          const b = sample(dtm, ...toGrid(x - nx * 1.5 * px, y - ny * 1.5 * px));
          if (a === a && b === b) readings.push(Math.abs(a - b));
          continue;
        }
        let top = -Infinity;
        for (const o of [-0.7, 0, 0.7]) {
          const h = heightAt(g, x + nx * o * px, y + ny * o * px);
          if (h === h) top = Math.max(top, h);
        }
        if (top > -Infinity) readings.push(top);
      }
    }
    if (readings.length < 3) continue;
    const h = quantile(readings, 0.5);
    if (h < range[0] || h > range[1]) continue;
    line.height = Math.round(h * px);
    measured++;
  }
  return measured;
}

/** How high a bus shelter stands, metres, as the LIDAR sees it; and how far from its stop it's looked for, px. */
const SHELTER_HEIGHT: [number, number] = [2, 3.8];
const SHELTER_SEARCH = 8 * 8;

/**
 * Finds each bus shelter (placed at its stop, along the road) in the LIDAR: a
 * small cluster of readings 2 to 3.8 m up within 8 m of it, not in a
 * building, the water or the road. If there is one, the shelter's moved to it,
 * turned along it (if it's longer one way), and made as tall. How many were.
 */
export function findShelters(map: GameMap, g: HeightGrid, blocked: Uint8Array): number {
  let found = 0;
  for (const line of map.lines) {
    if (line.kind !== 'shelter') continue;
    const [ax, ay, bx, by] = line.pts;
    const [cx, cy] = [(ax + bx) / 2, (ay + by) / 2];
    const half = Math.hypot(bx - ax, by - ay) / 2;
    const reach = Math.ceil(SHELTER_SEARCH / g.cell);
    const [ci, cj] = [Math.floor(cx / g.cell), Math.floor(cy / g.cell)];
    // The cells high enough, and where nothing else is.
    const seen = new Set<number>();
    const candidate = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= g.cols || j >= g.rows || blocked[j * g.cols + i]) return false;
      if (Math.hypot(i - ci, j - cj) > reach) return false;
      const h = g.h[j * g.cols + i];
      return h >= SHELTER_HEIGHT[0] && h <= SHELTER_HEIGHT[1];
    };
    let best: { cells: number[]; d: number } | null = null;
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        if (seen.has(j * g.cols + i) || !candidate(i, j)) continue;
        // Its cluster: the high-enough cells touching it.
        const cells: number[] = [];
        const todo = [j * g.cols + i];
        seen.add(todo[0]);
        while (todo.length) {
          const k = todo.pop()!;
          cells.push(k);
          const [ki, kj] = [k % g.cols, Math.floor(k / g.cols)];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = (kj + dj) * g.cols + ki + di;
            if (!seen.has(n) && candidate(ki + di, kj + dj)) {
              seen.add(n);
              todo.push(n);
            }
          }
        }
        // About a shelter's size (a few square metres to a couple of dozen), nearest the stop.
        if (cells.length < 3 || cells.length > 24) continue;
        const [mx, my] = cells.reduce(([sx, sy], k) => [sx + (k % g.cols) + 0.5, sy + Math.floor(k / g.cols) + 0.5], [0, 0]).map((v) => (v / cells.length) * g.cell);
        const d = Math.hypot(mx - cx, my - cy);
        if (!best || d < best.d) best = { cells, d };
      }
    }
    if (!best) continue;
    const pts = best.cells.map((k) => [((k % g.cols) + 0.5) * g.cell, (Math.floor(k / g.cols) + 0.5) * g.cell]);
    const [mx, my] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    // Which way it's longest (its readings' spread), if it is; along the road, otherwise.
    let [sxx, syy, sxy] = [0, 0, 0];
    for (const [x, y] of pts) [sxx, syy, sxy] = [sxx + (x - mx) ** 2, syy + (y - my) ** 2, sxy + (x - mx) * (y - my)];
    const spread = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy);
    const elongated = spread > 0.4 * (sxx + syy);
    const angle = elongated ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : Math.atan2(by - ay, bx - ax);
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    line.pts = [mx - ux * half, my - uy * half, mx + ux * half, my + uy * half].map(Math.round);
    const tops = best.cells.map((k) => g.h[k]);
    line.height = Math.round(Math.max(2.2, Math.min(3.5, quantile(tops, 0.9))) * map.pxPerMetre);
    found++;
  }
  return found;
}

/** The terrain grid's spacing, metres: the hills are smooth enough for this, and it keeps the map small. */
const TERRAIN_CELL = 4;

/**
 * The bare ground's height every TERRAIN_CELL metres (the average of the
 * LIDAR's readings round each point). Bridges aren't in it: they're decks
 * above it, a level of their own (see src/world/decks.ts).
 */
export function terrainOf(map: GameMap, dtm: Raster, toGrid: (x: number, y: number) => [number, number], dsm?: Raster): TerrainData {
  const px = map.pxPerMetre;
  const cell = TERRAIN_CELL * px;
  const cols = Math.ceil(map.width / cell) + 1;
  const rows = Math.ceil(map.height / cell) + 1;
  const z = new Float32Array(cols * rows);
  // What's under a bridge (a road, the water) is lower than the road that runs onto it: the ground's
  // heights aren't mixed across a bridge's edges, or the road would dip as it came to the bridge.
  const under = underBridges(map.roads);
  const region = new Int32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const own = under(i * cell, j * cell);
      region[j * cols + i] = own;
      let sum = 0;
      let n = 0;
      for (let dy = -1.5; dy <= 1.5; dy++) {
        for (let dx = -1.5; dx <= 1.5; dx++) {
          const [x, y] = [i * cell + dx * px, j * cell + dy * px];
          if (under(x, y) !== own) continue;
          const [e, nn] = toGrid(x, y);
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
  fillGaps(z, cols, rows, region);
  fillGaps(z, cols, rows);
  // Smooth out the bumps (kerbs, walls, what's left where buildings were taken out of the survey).
  for (let pass = 0; pass < 2; pass++) smooth(z, cols, rows, region);
  // The bridges' decks, measured; and the roads onto them brought up (or down) to meet them.
  const decks = dsm ? measureDecks(map, dsm, toGrid, z, cols, rows, cell) : new Map<Road, number[]>();

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
  for (const road of map.roads) delete road.deck;
  for (const [road, deck] of decks) road.deck = deck.map((v) => Math.round((v - base) * px));
  return { cell, cols, rows, base, heights: btoa(binary) };
}

/** Averages each point with its neighbours. */
/**
 * Which bridge (its index in the roads, plus 1) is overhead at a point, under
 * its deck between its ends; 0 for none.
 */
export function underBridges(roads: Road[]): (x: number, y: number) => number {
  const bridges = roads
    .map((road, index) => ({ road, index }))
    .filter(({ road }) => road.bridge && road.pts.length >= 4)
    .map(({ road, index }) => {
      const p = road.pts;
      const reach = road.width / 2 + 1 * 8;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      let length = 0;
      for (let k = 0; k < p.length; k += 2) {
        [x0, y0, x1, y1] = [Math.min(x0, p[k]), Math.min(y0, p[k + 1]), Math.max(x1, p[k]), Math.max(y1, p[k + 1])];
        if (k) length += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
      }
      return { p, reach, length, index, box: [x0 - reach, y0 - reach, x1 + reach, y1 + reach] };
    });
  return (x, y) => {
    for (const b of bridges) {
      if (x < b.box[0] || y < b.box[1] || x > b.box[2] || y > b.box[3]) continue;
      let run = 0;
      for (let k = 0; k + 3 < b.p.length; k += 2) {
        const [ax, ay, bx, by] = [b.p[k], b.p[k + 1], b.p[k + 2], b.p[k + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        const t = len ? ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len) : 0;
        const along = run + Math.max(0, Math.min(1, t)) * len;
        run += len;
        // Past its ends (and for a grid cell in from them, over its abutments), it's the road it runs onto.
        if (along <= TERRAIN_CELL * 8 || along >= b.length - TERRAIN_CELL * 8) continue;
        const c = Math.max(0, Math.min(1, t));
        if (Math.hypot(ax + (bx - ax) * c - x, ay + (by - ay) * c - y) <= b.reach) return b.index + 1;
      }
    }
    return 0;
  };
}

/** Smooths the heights, each with its neighbours (only those in the same region, if given). */
function smooth(z: Float32Array, cols: number, rows: number, region?: Int32Array): void {
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
          if (region && region[jj * cols + ii] !== region[j * cols + i]) continue;
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

/** Fills in the cells with no reading from their neighbours, a ring at a time (only those in the same region, if given). */
function fillGaps(z: Float32Array, cols: number, rows: number, region?: Int32Array): void {
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
          if (region && region[jj * cols + ii] !== region[j * cols + i]) continue;
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
  // Anything still empty is left for a pass across regions; with none, it's 0.
  if (!region) for (let k = 0; k < z.length; k++) if (z[k] !== z[k]) z[k] = 0;
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

/** A step's rise, metres: the usual for outdoor steps. */
const STEP_RISE = 0.17;

/**
 * How many steps there are up each flight that isn't tagged with its count:
 * how far the ground rises from one end to the other, a step every
 * STEP_RISE. Flights that rise less than a couple of steps' worth (or that
 * the survey can't see) are left as they are. Returns how many it counted.
 */
export function countSteps(map: GameMap, dtm: Raster, toGrid: (x: number, y: number) => [number, number]): number {
  const px = map.pxPerMetre;
  // The ground at a point: the middle of the readings round it, so a stray one (a wall, a bin) doesn't count.
  const ground = (x: number, y: number) => {
    const v: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v.push(sample(dtm, ...toGrid(x + dx * px, y + dy * px)));
    const ok = v.filter((z) => z === z);
    return ok.length >= 5 ? quantile(ok, 0.5) : NaN;
  };
  let counted = 0;
  for (const r of map.roads) {
    if (r.kind !== 'steps' || r.steps || r.pts.length < 4) continue;
    const n = r.pts.length;
    const rise = Math.abs(ground(r.pts[0], r.pts[1]) - ground(r.pts[n - 2], r.pts[n - 1]));
    if (!(rise >= 0.3)) continue;
    r.steps = Math.max(2, Math.round(rise / STEP_RISE));
    counted++;
  }
  return counted;
}

/** Banks: where the ground's this steep (rise over run, across BANK_RUN metres) or more; looked for every BANK_EVERY metres. */
const BANK_SLOPE = 0.45;
const BANK_RUN = 3;
const BANK_EVERY = 2;
/** How many of a point's eight neighbours have to be steep the same way (within 45°) for it to be part of a bank. */
const BANK_ALIKE = 3;

/**
 * The steep banks (embankments, cuttings, the sides of hills): points every
 * BANK_EVERY metres where the bare ground falls away steeply, and which way
 * it falls, for hachures. Not at buildings, water, roads or walls (whose
 * edges are steep in the survey too, but are drawn as what they are).
 * Returns how many points it found.
 */
export function findBanks(map: GameMap, dtm: Raster, toGrid: (x: number, y: number) => [number, number], blocked: Uint8Array, g: HeightGrid): number {
  const px = map.pxPerMetre;
  const near = new Uint8Array(blocked);
  const mark = (x: number, y: number) => {
    const i = Math.floor(x / g.cell);
    const j = Math.floor(y / g.cell);
    if (i >= 0 && j >= 0 && i < g.cols && j < g.rows) near[j * g.cols + i] = 1;
  };
  for (const l of map.lines) {
    if (l.kind !== 'wall' && l.kind !== 'quay') continue;
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const [ax, ay, bx, by] = [l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3]];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      for (let d = 0; d <= len; d += g.cell / 2) mark(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len);
    }
  }
  // Clear of all that by a couple of metres.
  const clear = (x: number, y: number) => {
    const i0 = Math.floor(x / g.cell);
    const j0 = Math.floor(y / g.cell);
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      for (let i = i0 - 2; i <= i0 + 2; i++) if (i >= 0 && j >= 0 && i < g.cols && j < g.rows && near[j * g.cols + i]) return false;
    }
    return true;
  };
  const z = (x: number, y: number) => sample(dtm, ...toGrid(x, y));
  const half = (BANK_RUN / 2) * px;
  const step = BANK_EVERY * px;
  const cols = Math.ceil(map.width / step);
  const rows = Math.ceil(map.height / step);
  // Which way's downhill at each point that's steep, NaN where it isn't.
  const down = new Float32Array(cols * rows).fill(NaN);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [x, y] = [(i + 0.5) * step, (j + 0.5) * step];
      if (!clear(x, y)) continue;
      const gx = (z(x + half, y) - z(x - half, y)) / BANK_RUN;
      const gy = (z(x, y + half) - z(x, y - half)) / BANK_RUN;
      if (!(Math.hypot(gx, gy) >= BANK_SLOPE)) continue;
      // Downhill, and steep that way across the whole run (not one odd reading).
      const a = Math.atan2(-gy, -gx);
      const [ux, uy] = [Math.cos(a), Math.sin(a)];
      if (!(z(x - ux * half, y - uy * half) - z(x + ux * half, y + uy * half) >= BANK_SLOPE * BANK_RUN)) continue;
      down[j * cols + i] = a;
    }
  }
  // A bank's a run of them, falling the same way: a point on its own is a bump in the survey.
  const banks: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = down[j * cols + i];
      if (a !== a) continue;
      let alike = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if ((!di && !dj) || i + di < 0 || j + dj < 0 || i + di >= cols || j + dj >= rows) continue;
          const b = down[(j + dj) * cols + i + di];
          if (b === b && Math.cos(b - a) > 0.7) alike++;
        }
      }
      if (alike >= BANK_ALIKE) banks.push(Math.round((i + 0.5) * step), Math.round((j + 0.5) * step), Math.round(a * 100));
    }
  }
  if (banks.length) map.banks = banks;
  else delete map.banks;
  return banks.length / 3;
}

/**
 * A ledge drops at least LEDGE_DROP metres, falling at least LEDGE_STEEP metres a metre all the way from its top
 * to its foot (the survey softens a wall into a slope a few metres wide), within LEDGE_RUN metres; it starts
 * falling at once (LEDGE_START a metre) from ground no steeper than LEDGE_FLAT a metre above it.
 */
const LEDGE_DROP = 1;
const LEDGE_STEEP = 0.6;
const LEDGE_RUN = 5;
const LEDGE_START = 0.35;
const LEDGE_FLAT = 0.3;
/** Its foot's where it falls less than this a metre. */
const LEDGE_FOOT = 0.25;
/** Shorter than this, metres, it's a bump in the survey, not a ledge. */
const LEDGE_SHORTEST = 3;
/** How far from the line it's kept to when it's simplified, metres. */
const LEDGE_TOLERANCE = 0.6;

/**
 * Sharp drops in the bare ground (a quay's edge into the water, a retaining
 * wall, the sides of the Bear Pit): every metre where flat ground falls away
 * steeply, LEDGE_DROP or more, joined up into lines along their tops. Not at
 * buildings (the survey's made up under them), bridges, steps, or walls OSM
 * has (they're walls already); not from the water or a carriageway (only down
 * into them). Returns how many it found.
 */
export function findLedges(map: GameMap, dtm: Raster, toGrid: (x: number, y: number) => [number, number]): number {
  const px = map.pxPerMetre;
  const cols = Math.ceil(map.width / px);
  const rows = Math.ceil(map.height / px);
  const z = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) z[j * cols + i] = sample(dtm, ...toGrid((i + 0.5) * px, (j + 0.5) * px));
  // Where there are none: 1 where it can't be a ledge's top (or foot), 2 where it can't be its top (the water, a carriageway: it can be its foot).
  const no = new Uint8Array(cols * rows);
  const mark = (x: number, y: number, v: number, r: number) => {
    const [i0, j0] = [Math.floor(x / px), Math.floor(y / px)];
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) if (i >= 0 && j >= 0 && i < cols && j < rows && no[j * cols + i] !== 1) no[j * cols + i] = v;
  };
  const along = (p: Pts, v: number, r: number, half = 0) => {
    for (let k = 0; k + 3 < p.length; k += 2) {
      const [ax, ay, bx, by] = [p[k], p[k + 1], p[k + 2], p[k + 3]];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
      for (let d = 0; d <= len; d += px / 2) for (let w = -half; w <= half; w += px / 2) mark(ax + ((bx - ax) * d) / len + nx * w, ay + ((by - ay) * d) / len + ny * w, v, r);
    }
  };
  for (const a of map.areas) if (a.kind === 'water' || a.kind === 'pool') for (const [x, y] of pointsInside(a.rings, px)) mark(x, y, 2, 0);
  for (const b of map.buildings) {
    if (b.bottom > 0) continue;
    for (const [x, y] of pointsInside(b.rings, px)) mark(x, y, 1, 1);
    for (const ring of b.rings) along([...ring, ring[0], ring[1]], 1, 1);
  }
  for (const r of map.roads) {
    if (r.bridge) along(r.pts, 1, 2, r.width / 2 + 2 * px);
    else if (r.kind === 'steps') along(r.pts, 1, 2, r.width / 2);
    // Not its top on a carriageway (the road would drop away under you); its foot can be.
    else if (VEHICLE_ROADS.has(r.kind)) along(r.pts, 2, 0, r.width / 2);
  }
  for (const l of map.lines) if (l.kind === 'wall' || l.kind === 'fence' || l.kind === 'hedge') along(l.pts, 1, 1);

  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < cols && j < rows ? z[j * cols + i] : NaN);
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  // Each ledge's top: which way's down (DIRS' index), and how far it drops, metres.
  const way = new Int8Array(cols * rows).fill(-1);
  const drop = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (no[k]) continue;
      const top = z[k];
      if (top !== top) continue;
      let best = -1;
      let most = 0;
      DIRS.forEach(([di, dj], d) => {
        const len = di && dj ? Math.SQRT2 : 1;
        // Flat above it, and falling at once.
        if (!(at(i - di, j - dj) - top <= LEDGE_FLAT * len)) return;
        if (!(top - at(i + di, j + dj) >= LEDGE_START * len)) return;
        // Down to its foot.
        let n = 1;
        while (n * len < LEDGE_RUN && at(i + di * n, j + dj * n) - at(i + di * (n + 1), j + dj * (n + 1)) >= LEDGE_FOOT * len) n++;
        const fall = top - at(i + di * n, j + dj * n);
        if (!(fall >= LEDGE_DROP) || fall / (n * len) < LEDGE_STEEP || fall <= most) return;
        if (no[(j + dj * n) * cols + i + di * n] === 1) return;
        [best, most] = [d, fall];
      });
      if (best >= 0) {
        way[k] = best;
        drop[k] = most;
      }
    }
  }
  // Joined up into lines, through neighbouring tops falling the same way (the diagonal only where there's no corner to go round).
  const same = (a: number, b: number) => {
    if (b < 0 || way[b] < 0) return false;
    const d = (way[a] - way[b] + 8) % 8;
    return Math.min(d, 8 - d) <= 2;
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (way[k] < 0) continue;
      const right = i + 1 < cols ? k + 1 : -1;
      const down = j + 1 < rows ? k + cols : -1;
      if (same(k, right)) link(k, right);
      if (same(k, down)) link(k, down);
      for (const [di, c] of [[1, k + cols + 1], [-1, k + cols - 1]] as const) {
        if (i + di < 0 || i + di >= cols || j + 1 >= rows || !same(k, c)) continue;
        const corner = (o: number) => way[o] >= 0 && same(k, o) && same(c, o);
        if (!corner(k + di) && !corner(k + cols)) link(k, c);
      }
    }
  }
  // Walked into chains: from each end (or anywhere, round a loop), till the next end or a fork.
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const chains: number[][] = [];
  const walk = (start: number, next: number) => {
    const chain = [start];
    let [prev, cur] = [start, next];
    used.add(key(start, next));
    for (;;) {
      chain.push(cur);
      const on = (links.get(cur) ?? []).filter((n) => n !== prev && !used.has(key(cur, n)));
      if ((links.get(cur) ?? []).length !== 2 || !on.length) break;
      used.add(key(cur, on[0]));
      [prev, cur] = [cur, on[0]];
    }
    chains.push(chain);
  };
  for (const [k, ns] of links) if (ns.length !== 2) for (const n of ns) if (!used.has(key(k, n))) walk(k, n);
  for (const [k, ns] of links) for (const n of ns) if (!used.has(key(k, n))) walk(k, n);

  const ledges: Ledge[] = [];
  for (const chain of chains) {
    // Each point at the edge itself: half a metre on from the top's middle, the way it falls.
    const pts = chain.flatMap((k) => {
      const [di, dj] = DIRS[way[k]];
      const l = Math.hypot(di, dj);
      return [((k % cols) + 0.5 + (di / l) * 0.5) * px, (Math.floor(k / cols) + 0.5 + (dj / l) * 0.5) * px];
    });
    let length = 0;
    for (let n = 2; n < pts.length; n += 2) length += Math.hypot(pts[n] - pts[n - 2], pts[n + 1] - pts[n - 1]);
    if (length < LEDGE_SHORTEST * px) continue;
    // Running so it falls away on its right.
    const [mi, mj] = DIRS[way[chain[Math.floor(chain.length / 2)]]];
    const m = Math.floor(chain.length / 2) * 2;
    const [tx, ty] = m + 3 < pts.length ? [pts[m + 2] - pts[m], pts[m + 3] - pts[m + 1]] : [pts[m] - pts[m - 2], pts[m + 1] - pts[m - 1]];
    const flip = -ty * mi + tx * mj < 0;
    const drops = chain.map((k) => drop[k]);
    if (flip) {
      const back: number[] = [];
      for (let n = pts.length - 2; n >= 0; n -= 2) back.push(pts[n], pts[n + 1]);
      pts.splice(0, pts.length, ...back);
      drops.reverse();
    }
    const keep = simplify(pts, LEDGE_TOLERANCE * px);
    ledges.push({ pts: keep.flatMap((n) => [Math.round(pts[n * 2]), Math.round(pts[n * 2 + 1])]), drop: keep.map((n) => Math.round(drops[n] * px)) });
  }
  if (ledges.length) map.ledges = ledges;
  else delete map.ledges;
  return ledges.length;
}

/** Which of a line's points to keep (Douglas–Peucker): those that stray more than `tolerance` from the straight line between the kept ones. */
function simplify(pts: number[], tolerance: number): number[] {
  const n = pts.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay, bx, by] = [pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]];
    const len = Math.hypot(bx - ax, by - ay);
    let [far, at] = [0, -1];
    for (let i = a + 1; i < b; i++) {
      const [x, y] = [pts[i * 2], pts[i * 2 + 1]];
      const d = len ? Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len : Math.hypot(x - ax, y - ay);
      if (d > far) [far, at] = [d, i];
    }
    if (at >= 0 && far > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
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
