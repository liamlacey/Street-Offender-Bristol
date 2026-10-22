import { describe, expect, it } from 'vitest';
import { countSteps, deckProfile, findBanks, findLedges, findShelters, mergeRasters, pointsInside, roofShape, shiftRaster, underBridges, wallHeights } from './enrich';
import { type HeightGrid, type Raster, bestShift, findTrees, parseWcsText, quantile, sample } from './lidar';
import { toNationalGrid } from './osgb';
import { type GameMap, type Line, type Road, paving, pointInRing } from './osm';

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

describe('shiftRaster and mergeRasters', () => {
  const raster = (e0: number, n0: number, v: number): Raster => ({ e0, n0, cols: 2, rows: 2, data: new Float32Array([v, v, v, NaN]) });

  it('moves a raster so a reading lines up a shift away', () => {
    const r = raster(100, 200, 5);
    // Shifted 1 m east: what was read at (101, 200) is now read at (100, 200).
    expect(sample(shiftRaster({ ...r, data: new Float32Array([1, 2, 3, 4]) }, [1, 0]), 100, 200)).toBe(2);
  });

  it('lays rasters together, the first winning where they overlap', () => {
    const merged = mergeRasters([raster(100, 200, 1), raster(101, 200, 2)]);
    expect(sample(merged, 100, 200)).toBe(1);
    expect(sample(merged, 101, 200)).toBe(1);
    expect(sample(merged, 102, 200)).toBe(2);
    // The first has no reading here, so the second's is used.
    expect(sample(merged, 101, 199)).toBe(2);
  });
});

describe('bridge decks', () => {
  // A bridge 20 m long running east, 6 m wide, on a map where px = east and south metres × 8.
  const bridge: Road = { kind: 'street', width: 48, pts: [0, 0, 160, 0], bridge: true };
  const toGrid = (x: number, y: number): [number, number] => [x / 8, -y / 8];
  // The surface: the deck 10 m up, a tree over the middle of it 18 m up.
  const cols = 40;
  const rows = 20;
  const data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = Math.abs(c - 5 - 10) < 2 ? 18 : 10;
  const dsm: Raster = { e0: -5, n0: 10, cols, rows, data };

  it('measures the deck, leaving out a tree over it', () => {
    const deck = deckProfile(bridge, dsm, toGrid, 8, [10, 10])!;
    expect(deck).toHaveLength(11);
    for (const z of deck) expect(z).toBeCloseTo(10);
  });

  it("doesn't measure one that's mostly something else", () => {
    // The ground at its ends 6 m below everything read: walkways between upper floors, say.
    expect(deckProfile(bridge, dsm, toGrid, 8, [4, 4])).toBeUndefined();
  });

  it("finds what's under a bridge, but not past its ends or off its sides", () => {
    const under = underBridges([bridge]);
    expect(under(80, 0)).toBe(1);
    expect(under(80, 40)).toBe(0);
    expect(under(-8, 0)).toBe(0);
    expect(under(16, 0)).toBe(0);
  });
});

// A 40 m square of map, 8 px to the metre, with the survey's 1 m cells lined up with the map's.
describe('walls, shelters, steps and banks from the LIDAR', () => {
  const size = 40;
  const toGrid = (x: number, y: number): [number, number] => [x / 8, -y / 8];
  const raster = (z: (e: number, s: number) => number): Raster => {
    const data = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = z(i, j);
    return { e0: 0, n0: 0, cols: size, rows: size, data };
  };
  const grid = (h: (i: number, j: number) => number): HeightGrid => {
    const g = { cell: 8, cols: size, rows: size, h: new Float32Array(size * size) };
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) g.h[j * size + i] = h(i, j);
    return g;
  };
  const mapOf = (parts: Partial<GameMap>) => ({ pxPerMetre: 8, width: size * 8, height: size * 8, lines: [], roads: [], ...parts }) as unknown as GameMap;
  const flat = raster(() => 10);

  it('measures a garden wall, and a retaining wall by how far the ground drops across it', () => {
    const wall = { kind: 'wall', pts: [40, 164, 280, 164] } as Line;
    const low = { kind: 'wall', pts: [40, 40, 280, 40] } as Line;
    const retaining = { kind: 'wall', retaining: true, pts: [40, 160, 280, 160] } as Line;
    const map = mapOf({ lines: [wall, low, retaining] });
    const g = grid((_, j) => (j === 20 ? 1.8 : 0));
    const step = raster((_, s) => (s < 20 ? 12 : 10));
    expect(wallHeights(map, g, step, toGrid)).toBe(2);
    expect(wall.height).toBe(Math.round(1.8 * 8));
    expect(low.height).toBeUndefined();
    expect(retaining.height).toBe(2 * 8);
  });

  it('moves a bus shelter onto what the LIDAR sees by its stop, turned along it, as tall', () => {
    const shelter = { kind: 'shelter', pts: [100, 100, 132, 100] } as Line;
    const map = mapOf({ lines: [shelter] });
    const g = grid((i, j) => (i >= 16 && i <= 17 && j >= 10 && j <= 13 ? 2.7 : 0));
    expect(findShelters(map, g, new Uint8Array(size * size))).toBe(1);
    const [ax, ay, bx, by] = shelter.pts;
    expect((ax + bx) / 2).toBeCloseTo(136, 0);
    expect((ay + by) / 2).toBeCloseTo(96, 0);
    expect(Math.abs(bx - ax)).toBeLessThan(2);
    expect(shelter.height).toBe(Math.round(2.7 * 8));
  });

  it('counts the steps up a flight by how far it rises, and leaves a level one', () => {
    const up = { kind: 'steps', width: 16, pts: [40, 80, 200, 80] } as Road;
    const tagged = { kind: 'steps', width: 16, pts: [40, 120, 200, 120], steps: 5 } as Road;
    const level = { kind: 'steps', width: 16, pts: [40, 240, 200, 240] } as Road;
    const ramp = raster((e, s) => (s < 20 ? 10 + e * 0.1 : 10));
    expect(countSteps(mapOf({ roads: [up, tagged, level] }), ramp, toGrid)).toBe(1);
    expect(up.steps).toBe(12);
    expect(tagged.steps).toBe(5);
    expect(level.steps).toBeUndefined();
  });

  it('finds a steep bank, and which way it falls, but not on level ground', () => {
    const map = mapOf({});
    const bank = raster((e) => 10 + Math.max(0, Math.min(6, e - 17)));
    const g = grid(() => 0);
    expect(findBanks(map, bank, toGrid, new Uint8Array(size * size), g)).toBeGreaterThan(10);
    for (let k = 0; k < map.banks!.length; k += 3) {
      expect(map.banks![k] / 8).toBeGreaterThan(15);
      expect(map.banks![k] / 8).toBeLessThan(26);
      // Downhill's west.
      expect(Math.abs(map.banks![k + 2] / 100)).toBeCloseTo(Math.PI, 1);
    }
    const level = mapOf({});
    expect(findBanks(level, flat, toGrid, new Uint8Array(size * size), g)).toBe(0);
    expect(level.banks).toBeUndefined();
  });

  it('finds a sharp drop (softened over a couple of metres, as the survey has a wall), along its top, falling away on its right', () => {
    const map = mapOf({ areas: [], buildings: [] });
    // Flat at 12 m to the north, 9 m to the south: a 3 m wall along row 20, softened over 2 m.
    const wall = raster((_, s) => (s <= 20 ? 12 : s === 21 ? 11 : s === 22 ? 10 : 9));
    expect(findLedges(map, wall, toGrid)).toBe(1);
    const [l] = map.ledges!;
    expect(l.drop.every((d) => Math.abs(d - 3 * 8) <= 4)).toBe(true);
    // Its top edge, about 20.5 m down (within the survey's metre).
    for (let k = 1; k < l.pts.length; k += 2) expect(Math.abs(l.pts[k] / 8 - 20.5)).toBeLessThanOrEqual(1);
    // All along it, down on its right: running east (y being down, the south's on the right).
    const [x0, x1] = [l.pts[0], l.pts[l.pts.length - 2]];
    expect(x1 - x0).toBeGreaterThan(30 * 8);
  });

  it('passes over a steep bank (falling all the way), gentle slopes, and level ground', () => {
    const bank = mapOf({ areas: [], buildings: [] });
    expect(findLedges(bank, raster((e) => 30 - Math.max(0, Math.min(15, e - 10)) * 0.5), toGrid)).toBe(0);
    expect(findLedges(bank, raster((e) => 30 - e * 0.4), toGrid)).toBe(0);
    expect(findLedges(bank, flat, toGrid)).toBe(0);
    expect(bank.ledges).toBeUndefined();
  });
});

describe('points inside rings', () => {
  it('are those pointInRing has inside (holes, and all), row by row', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 30; n++) {
      // A jagged ring round a middle, and a hole in it.
      const ring = (cx: number, cy: number, r: number, k: number) => Array.from({ length: k }, (_, i) => [cx + Math.cos((i / k) * Math.PI * 2) * r * (0.5 + rand()), cy + Math.sin((i / k) * Math.PI * 2) * r * (0.5 + rand())]).flat();
      const rings = [ring(100, 100, 80, 5 + Math.floor(rand() * 20)), ring(100, 100, 20, 6)];
      const want: [number, number][] = [];
      for (let y = Math.min(...rings[0].filter((_, i) => i % 2)) + 2; y < Math.max(...rings[0].filter((_, i) => i % 2)); y += 4) {
        for (let x = Math.min(...rings[0].filter((_, i) => i % 2 === 0)) + 2; x < Math.max(...rings[0].filter((_, i) => i % 2 === 0)); x += 4) if (rings.filter((r) => pointInRing(x, y, r)).length % 2 === 1) want.push([x, y]);
      }
      expect(pointsInside(rings, 4)).toEqual(want);
    }
  });
});
