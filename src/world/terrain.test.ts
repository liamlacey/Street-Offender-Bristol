import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import bristol from '../map/bristol.json';
import { Perspective } from './perspective';
import { Terrain } from './terrain';

/** A terrain from heights in metres, a grid point every `cell` px. */
function terrainOf(cols: number, rows: number, cell: number, z: (i: number, j: number) => number): Terrain {
  let binary = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = Math.round(z(i, j) * 10);
      binary += String.fromCharCode(d & 255, d >> 8);
    }
  }
  return new Terrain({ cell, cols, rows, base: 0, heights: btoa(binary) }, 8);
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

describe('Bristol\'s hills', () => {
  const map = bristol as unknown as GameMap;
  const terrain = new Terrain(map.terrain, map.pxPerMetre);
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
