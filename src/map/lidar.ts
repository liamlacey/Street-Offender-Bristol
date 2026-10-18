/**
 * Heights from the Environment Agency's LIDAR survey (© Environment Agency,
 * Open Government Licence): how far the first thing the laser hit (a roof, a
 * tree's crown) stands above the bare ground, a metre square at a time.
 * From that the map tool takes buildings' heights and whether their roofs are
 * pitched, and finds the trees OpenStreetMap hasn't got. Pure, so it's tested.
 */

/** A grid of heights in National Grid metres, as the WCS service's text output gives it. */
export interface Raster {
  /** Easting and northing of the middle of the top-left cell. */
  e0: number;
  n0: number;
  cols: number;
  rows: number;
  /** Row by row from the top (north), NaN where there's no reading. */
  data: Float32Array;
}

/** Reads the WCS service's `text/plain` coverage. */
export function parseWcsText(text: string): Raster {
  const num = (name: string) => {
    const m = text.match(new RegExp(`PARAMETER\\["${name}", (-?[\\d.E-]+)\\]`));
    if (!m) throw new Error(`No ${name} in the LIDAR file`);
    return parseFloat(m[1]);
  };
  const range = text.match(/Grid range: GridEnvelope2D\[0\.\.(\d+), 0\.\.(\d+)\]/);
  if (!range) throw new Error('No grid range in the LIDAR file');
  const cols = +range[1] + 1;
  const rows = +range[2] + 1;
  const body = text.slice(text.indexOf('Band 0:') + 7);
  const data = new Float32Array(cols * rows);
  let i = 0;
  for (const token of body.split(/\s+/)) {
    if (!token) continue;
    const v = parseFloat(token);
    data[i++] = v < -1000 || v > 10000 ? NaN : v;
    if (i === data.length) break;
  }
  return { e0: num('elt_0_2'), n0: num('elt_1_2'), cols, rows, data };
}

/** The raster's value at (e, n), nearest cell, or NaN outside it. */
export function sample(r: Raster, e: number, n: number): number {
  const c = Math.round(e - r.e0);
  const row = Math.round(r.n0 - n);
  if (c < 0 || row < 0 || c >= r.cols || row >= r.rows) return NaN;
  return r.data[row * r.cols + c];
}

/** Heights above the ground, on the map's own grid. */
export interface HeightGrid {
  /** Map px per cell. */
  cell: number;
  cols: number;
  rows: number;
  /** Metres above the ground, NaN where unknown. */
  h: Float32Array;
}

/**
 * Resamples the surface less the ground onto a grid over the map, a cell
 * every `cell` px. `toGrid` gives a map point's National Grid position.
 */
export function heightGrid(dsm: Raster, dtm: Raster, width: number, height: number, cell: number, toGrid: (x: number, y: number) => [number, number]): HeightGrid {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const h = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [e, n] = toGrid((i + 0.5) * cell, (j + 0.5) * cell);
      h[j * cols + i] = sample(dsm, e, n) - sample(dtm, e, n);
    }
  }
  return { cell, cols, rows, h };
}

export function heightAt(g: HeightGrid, x: number, y: number): number {
  const i = Math.floor(x / g.cell);
  const j = Math.floor(y / g.cell);
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return NaN;
  return g.h[j * g.cols + i];
}

/** The `q`th quantile (0..1) of some numbers (sorted in place). */
export function quantile(values: number[], q: number): number {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
}

/**
 * Which way to shift the heights (in px) so they best line up with the
 * buildings: high where the buildings are, low along the roads. Searched
 * over ±`reach` px in `step`s.
 */
export function bestShift(heights: (x: number, y: number) => number, inside: [number, number][], open: [number, number][], reach: number, step: number): [number, number] {
  let best: [number, number] = [0, 0];
  let bestScore = -Infinity;
  for (let dx = -reach; dx <= reach; dx += step) {
    for (let dy = -reach; dy <= reach; dy += step) {
      let score = 0;
      for (const [x, y] of inside) if (heights(x + dx, y + dy) > 2.5) score += 1 / inside.length;
      for (const [x, y] of open) if (heights(x + dx, y + dy) < 1.5) score += 1 / open.length;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [dx, dy];
      }
    }
  }
  return best;
}

export interface FoundTree {
  /** Where, map px. */
  x: number;
  y: number;
  /** Crown radius and height, metres. */
  r: number;
  h: number;
}

/**
 * Finds trees in the heights: the tops of rough-surfaced blobs standing 4 m
 * or more above the ground where `allowed` says a tree could be (not in a
 * building, the water or the road), each with a crown that spreads round it.
 */
export function findTrees(g: HeightGrid, allowed: (i: number, j: number) => boolean, pxPerMetre: number): FoundTree[] {
  const { cols, rows, h } = g;
  const metresPerCell = g.cell / pxPerMetre;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= cols || j >= rows ? NaN : h[j * cols + i]);
  const found: FoundTree[] = [];
  const reach = Math.round(2 / metresPerCell);
  const crownReach = Math.round(7 / metresPerCell);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const peak = h[j * cols + i];
      if (!(peak >= 4 && peak <= 35) || !allowed(i, j)) continue;
      // The highest point round about.
      let top = true;
      for (let dj = -reach; dj <= reach && top; dj++) {
        for (let di = -reach; di <= reach; di++) {
          if (!di && !dj) continue;
          const v = at(i + di, j + dj);
          if (v > peak || (v === peak && (dj < 0 || (dj === 0 && di < 0)))) {
            top = false;
            break;
          }
        }
      }
      if (!top) continue;
      // The crown: what's at least half as high round it, and how rough it is (leaves are; roofs aren't).
      let area = 0;
      let rough = 0;
      let pairs = 0;
      let blocked = 0;
      for (let dj = -crownReach; dj <= crownReach; dj++) {
        for (let di = -crownReach; di <= crownReach; di++) {
          if (di * di + dj * dj > crownReach * crownReach) continue;
          const v = at(i + di, j + dj);
          if (!(v > Math.max(2.5, peak * 0.5))) continue;
          if (!allowed(i + di, j + dj)) blocked++;
          area++;
          const right = at(i + di + 1, j + dj);
          if (right > 2.5) {
            rough += Math.abs(right - v);
            pairs++;
          }
        }
      }
      const cellArea = metresPerCell * metresPerCell;
      if (area * cellArea < 7 || blocked > area * 0.4 || pairs === 0 || rough / pairs / metresPerCell < 0.35) continue;
      const r = Math.min(8, Math.max(2, Math.sqrt((area * cellArea) / Math.PI)));
      found.push({ x: (i + 0.5) * g.cell, y: (j + 0.5) * g.cell, r, h: peak });
    }
  }
  // Big crowns have more than one high point: keep the highest of any too close together.
  found.sort((a, b) => b.h - a.h);
  const kept: FoundTree[] = [];
  for (const t of found) {
    if (kept.some((k) => Math.hypot(k.x - t.x, k.y - t.y) / pxPerMetre < Math.max(3, Math.min(k.r, t.r) * 0.9))) continue;
    kept.push(t);
  }
  return kept;
}
