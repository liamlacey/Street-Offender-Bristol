import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import bristol from '../test/bristol';
import { Perspective } from './perspective';
import { Cuts, Terrain } from './terrain';

/** A terrain from heights in metres, a grid point every `cell` px (and any ledges). */
function terrainOf(cols: number, rows: number, cell: number, z: (i: number, j: number) => number, ledges?: GameMap['ledges']): Terrain {
  let binary = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = Math.round(z(i, j) * 10);
      binary += String.fromCharCode(d & 255, d >> 8);
    }
  }
  return new Terrain({ cell, cols, rows, base: 0, heights: btoa(binary) }, 8, ledges);
}

describe('Terrain', () => {
  // A slope rising 1 m every 10 m eastwards: 1 m per 80 px.
  const ramp = terrainOf(10, 10, 32, (i) => (i * 32) / 80);

  it('gives the height between the grid points', () => {
    expect(ramp.at(0, 0)).toBeCloseTo(0);
    expect(ramp.at(80, 50)).toBeCloseTo(1, 1);
    expect(ramp.at(120, 0)).toBeCloseTo(1.5, 1);
  });

  it('gives the slope', () => {
    const [sx, sy] = ramp.slope(100, 100);
    expect(sx).toBeCloseTo(0.1, 2);
    expect(sy).toBeCloseTo(0, 5);
  });

  it('is flat without any data', () => {
    const flat = new Terrain(undefined, 8);
    expect(flat.at(100, 100)).toBe(0);
    expect(flat.slope(100, 100)).toEqual([0, 0]);
  });
});

describe('the ground at a ledge', () => {
  // Flat, 10 m up north of y = 100 (between the grid's rows at 96 and 128), 7 m below it: a 3 m drop along it, falling south.
  const ledge = [{ pts: [0, 100, 320, 100], drop: [24, 24] }];
  const step = terrainOf(10, 10, 32, (_, j) => (j * 32 < 100 ? 10 : 7), ledge);
  const smooth = terrainOf(10, 10, 32, (_, j) => (j * 32 < 100 ? 10 : 7));

  it('steps down at its edge (not a slope across the grid square)', () => {
    expect(step.at(150, 99)).toBeCloseTo(10, 5);
    expect(step.at(150, 101)).toBeCloseTo(7, 5);
    expect(step.at(150, 112)).toBeCloseTo(7, 5);
    // Without it, a ramp from one grid row to the next.
    expect(smooth.at(150, 112)).toBeCloseTo(8.5, 5);
  });

  it("is flat either side (the slope's not measured across it)", () => {
    expect(step.slope(150, 92)).toEqual([0, 0]);
    expect(step.slope(150, 108)).toEqual([0, 0]);
    expect(Math.abs(smooth.slope(150, 104)[1])).toBeGreaterThan(0.3);
  });

  it('is the same as ever away from it', () => {
    for (const [x, y] of [[150, 40], [150, 200], [60, 250]]) expect(step.at(x, y)).toBeCloseTo(smooth.at(x, y), 6);
    expect(step.cutAcross(128, 96, 32)).toBe(true);
    expect(step.cutAcross(128, 160, 32)).toBe(false);
  });

  it('knows what crosses it, and what touches the squares it runs through', () => {
    const cuts = new Cuts(ledge);
    expect(cuts.crosses(50, 90, 50, 110)).toBe(true);
    expect(cuts.crosses(50, 90, 80, 95)).toBe(false);
    expect(cuts.crosses(400, 90, 400, 110)).toBe(false);
    expect(cuts.inSquare(300, 80, 32)).toBe(true);
    expect(cuts.inSquare(330, 80, 32)).toBe(false);
  });
});

describe('Bristol\'s hills', () => {
  const map = bristol as unknown as GameMap;
  const terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges);
  const ground = (lat: number, lon: number) => terrain.at((lon - map.origin.lon) * 69440 * 8, (map.origin.lat - lat) * 111250 * 8);

  it('climbs from the harbour up Park Street to Brandon Hill', () => {
    const harbour = ground(51.4505, -2.598);
    const parkStreetTop = ground(51.4555, -2.6025);
    expect(parkStreetTop - harbour).toBeGreaterThan(25);
  });
});

describe('Perspective', () => {
  it('pushes what\'s higher than the camera\'s ground out from the middle, and pulls what\'s lower in', () => {
    const p = new Perspective();
    Object.assign(p, { cx: 100, cy: 100, height: 1000, ground: 50 });
    expect(p.lift(50)).toBe(1);
    expect(p.x(200, p.lift(250))).toBeGreaterThan(200);
    expect(p.x(200, p.lift(0))).toBeLessThan(200);
    expect(p.lift(1e9)).toBeLessThan(10);
  });
});
