import { describe, expect, it } from 'vitest';
import { roofShape } from './enrich';
import { type HeightGrid, bestShift, findTrees, parseWcsText, quantile, sample } from './lidar';
import { toNationalGrid } from './osgb';
import { paving } from './osm';

describe('toNationalGrid', () => {
  it('lands within a few metres of the Ordnance Survey\'s own worked example', () => {
    // Caister water tower, from OS's guide to coordinate systems.
    const [e, n] = toNationalGrid(52 + 39 / 60 + 28.71 / 3600, 1 + 42 / 60 + 57.79 / 3600);
    expect(Math.abs(e - 651409.9)).toBeLessThan(10);
    expect(Math.abs(n - 313177.3)).toBeLessThan(10);
  });
});

describe('parseWcsText', () => {
  it('reads the grid and where it is', () => {
    const r = parseWcsText(`Grid range: GridEnvelope2D[0..2, 0..1]
  PARAMETER["elt_0_2", 358300.5],
  PARAMETER["elt_1_1", -1.0],
  PARAMETER["elt_1_2", 172694.5]]
Contents:
Band 0:
1 2 3
4 5 -99999
`);
    expect([r.cols, r.rows]).toEqual([3, 2]);
    expect(sample(r, 358300.5, 172694.5)).toBe(1);
    expect(sample(r, 358302.4, 172693.6)).toBeNaN();
    expect(sample(r, 358301.5, 172693.5)).toBe(5);
    expect(sample(r, 0, 0)).toBeNaN();
  });
});

/** A grid of heights from a function of the cell. */
function grid(cols: number, rows: number, h: (i: number, j: number) => number): HeightGrid {
  const data = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = h(i, j);
  return { cell: 8, cols, rows, h: data };
}

describe('findTrees', () => {
  // A rough-crowned tree 12 m tall at cell (20, 20), 5 m across the crown.
  const crown = (i: number, j: number, ci: number, cj: number, top: number) => {
    const d = Math.hypot(i - ci, j - cj);
    return d > 5 ? 0 : top - d * 1.2 + (((i * 7 + j * 13) % 5) - 2) * 0.4;
  };

  it('finds a tree, with its height and crown', () => {
    const trees = findTrees(grid(40, 40, (i, j) => crown(i, j, 20, 20, 12)), () => true, 8);
    expect(trees).toHaveLength(1);
    // At the top, give or take the bumps of its leaves.
    expect(Math.abs(trees[0].x - 20.5 * 8)).toBeLessThanOrEqual(16);
    expect(Math.abs(trees[0].y - 20.5 * 8)).toBeLessThanOrEqual(16);
    expect(trees[0].h).toBeGreaterThan(11);
    expect(trees[0].r).toBeGreaterThan(2);
  });

  it('passes over a flat roof, and anywhere a tree can\'t be', () => {
    expect(findTrees(grid(40, 40, (i, j) => (i > 10 && i < 30 && j > 10 && j < 30 ? 9 : 0)), () => true, 8)).toHaveLength(0);
    expect(findTrees(grid(40, 40, (i, j) => crown(i, j, 20, 20, 12)), () => false, 8)).toHaveLength(0);
  });

  it('keeps two trees apart', () => {
    const trees = findTrees(grid(60, 40, (i, j) => Math.max(crown(i, j, 15, 20, 12), crown(i, j, 40, 20, 10))), () => true, 8);
    expect(trees).toHaveLength(2);
  });
});

describe('roofShape', () => {
  // A house 10 m by 6 m, its ridge along its length, 4 m above the eaves.
  const outer = [0, 0, 80, 0, 80, 48, 0, 48];
  const points = (h: (x: number, y: number) => number) => {
    const out: [number, number, number][] = [];
    for (let y = 4; y < 48; y += 8) for (let x = 4; x < 80; x += 8) out.push([x, y, h(x, y)]);
    return out;
  };

  it('sees a pitched roof, and which way its ridge runs', () => {
    expect(roofShape(outer, points((_, y) => 10 - (Math.abs(y - 24) / 24) * 4), 8)).toBe('along');
    expect(roofShape(outer, points((x) => 10 - (Math.abs(x - 40) / 40) * 4), 8)).toBe('across');
  });

  it('sees a flat roof, and leaves a jumble alone', () => {
    expect(roofShape(outer, points(() => 10), 8)).toBe('flat');
    expect(roofShape(outer, points((x, y) => 8 + ((x * 3 + y * 5) % 7)), 8)).toBeNull();
  });
});

describe('bestShift', () => {
  it('finds how far the heights are out from the buildings', () => {
    // A building at 100..200 whose heights have come out 24 px to the east.
    const heights = (x: number, y: number) => (x >= 124 && x < 224 && y >= 100 && y < 200 ? 10 : 0);
    const inside: [number, number][] = [];
    for (let x = 100; x < 200; x += 4) for (let y = 100; y < 200; y += 4) inside.push([x, y]);
    const open: [number, number][] = [];
    for (let k = 0; k < 300; k += 4) open.push([96, k], [204, k], [k, 96], [k, 204]);
    expect(bestShift(heights, inside, open, 64, 4)).toEqual([24, 0]);
  });
});

describe('quantile and paving', () => {
  it('takes quantiles', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([5, 1, 3, 2, 4], 1)).toBe(5);
  });

  it('sorts OSM surfaces into the ones drawn', () => {
    expect(paving('sett')).toBe('sett');
    expect(paving('unhewn_cobblestone')).toBe('sett');
    expect(paving('paving_stones')).toBe('paving');
    expect(paving('concrete:plates')).toBe('concrete');
    expect(paving('compacted')).toBe('gravel');
    expect(paving('paved')).toBeUndefined();
  });
});
