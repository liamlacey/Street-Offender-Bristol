import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import bristol from '../map/bristol.json';
import { buildingLook, clipHalfPlane, parseColour } from './buildingLook';
import { Surface, SurfaceGrid, surfacePaint } from './surface';
import { CHUNK, buildWorld, chunkKey, shadowOffset, subPolyline } from './world';

const map = bristol as unknown as GameMap;

describe('the Bristol map', () => {
  it('has the Cathedral, its towers, and the harbour', () => {
    expect(map.buildings.some((b) => b.name === 'Bristol Cathedral')).toBe(true);
    expect(map.buildings.filter((b) => b.top >= 30 * 8 && b.roofShape === 'pyramidal').length).toBeGreaterThanOrEqual(2);
    expect(map.areas.some((a) => a.kind === 'water')).toBe(true);
    expect(map.roads.some((r) => r.name === 'Anchor Road')).toBe(true);
  });

  it('starts the car on a road inside the map', () => {
    const { x, y } = map.spawn;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(x).toBeLessThan(map.width);
    expect(y).toBeLessThan(map.height);
  });
});

describe('buildWorld', () => {
  const world = buildWorld(map);

  it('walls in every solid building and the edge of the map', () => {
    const solid = map.buildings.filter((b) => b.solid);
    expect(world.walls.length).toBeGreaterThan(solid.length * 3);
    expect(world.walls).toContainEqual({ ax: 0, ay: 0, bx: map.width, by: 0, r: 0 });
  });

  it('makes benches and bins loose, and lamp posts and trees fixed', () => {
    expect(world.loose.every((l) => l.kind === 'bench' || l.kind === 'bin')).toBe(true);
    expect(world.loose.length).toBeGreaterThan(100);
    expect(world.posts.length).toBeGreaterThan(map.trees.length / 3);
    expect(world.fixed.some((p) => p.kind === 'signals')).toBe(false);
  });

  it('indexes each tree in the chunk it stands in', () => {
    const [x, y] = [map.trees[0], map.trees[1]];
    expect(world.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))?.trees).toContain(0);
  });

  it('casts taller buildings\' shadows further, but not without end', () => {
    expect(shadowOffset(200)[0]).toBeGreaterThan(shadowOffset(80)[0]);
    expect(Math.hypot(...shadowOffset(5000))).toBeLessThanOrEqual(220);
  });
});

describe('subPolyline', () => {
  it('cuts out a stretch of a line by distance along it', () => {
    expect(subPolyline([0, 0, 100, 0, 100, 100], 50, 150)).toEqual([50, 0, 100, 0, 100, 50]);
    expect(subPolyline([0, 0, 100, 0], 20, 40)).toEqual([20, 0, 40, 0]);
  });
});

describe('SurfaceGrid', () => {
  it('reads back the surfaces from their painted colours, even blurred a little', () => {
    const paint = (s: Surface, blur = 0) => {
      const red = Number(surfacePaint(s).match(/\d+/)![0]) + blur;
      return [red, 0, 0, 255];
    };
    const pixels = new Uint8ClampedArray([...paint(Surface.Road), ...paint(Surface.Deep, -8), ...paint(Surface.Grass, 10), ...paint(Surface.Pavement)]);
    const grid = SurfaceGrid.fromPixels(pixels, 2, 2, 8);
    expect(grid.at(3, 3)).toBe(Surface.Road);
    expect(grid.at(12, 3)).toBe(Surface.Deep);
    expect(grid.at(3, 12)).toBe(Surface.Grass);
    expect(grid.at(-5, 3)).toBe(Surface.Pavement);
  });
});

describe('buildingLook', () => {
  // Just fans each polygon from its first point, which is right for the convex footprints here.
  const fan = (data: number[]) => {
    const out: number[] = [];
    for (let i = 1; i + 1 < data.length / 2; i++) out.push(0, i, i + 1);
    return out;
  };
  const house = { id: 7, rings: [[0, 0, 80, 0, 80, 40, 0, 40]], top: 64, bottom: 0, kind: 'house', solid: true, drawn: true };

  it('gives a house a pitched roof: two slopes, lit differently, with a ridge along its length', () => {
    const look = buildingLook(house, fan);
    expect(look.facets).toHaveLength(2);
    expect(look.facets[0].colour).not.toBe(look.facets[1].colour);
    const [ax, ay, bx, by] = look.ridge!;
    expect(ay).toBeCloseTo(20);
    expect(by).toBeCloseTo(20);
    expect(Math.abs(bx - ax)).toBeCloseTo(80);
  });

  it('gives an office a flat roof with a parapet, and windows', () => {
    const look = buildingLook({ ...house, kind: 'office', rings: [[0, 0, 300, 0, 300, 300, 0, 300]] }, fan);
    expect(look.facets).toHaveLength(1);
    expect(look.rim).not.toBeNull();
    expect(look.windows).not.toBeNull();
    expect(look.boxes.length).toBeGreaterThan(0);
  });

  it('points each wall outward, whichever way round the outline goes', () => {
    for (const ring of [house.rings[0], [0, 0, 0, 40, 80, 40, 80, 0]]) {
      const look = buildingLook({ ...house, rings: [ring] }, fan);
      for (const w of look.walls) {
        const mx = (w.ax + w.bx) / 2 + w.nx;
        const my = (w.ay + w.by) / 2 + w.ny;
        // A step out along the normal leaves the building.
        expect(mx < 0 || mx > 80 || my < 0 || my > 40).toBe(true);
      }
    }
  });

  it('uses the colours OSM gives', () => {
    expect(parseColour('#ff0000')).toBe(0xff0000);
    expect(parseColour('#f00')).toBe(0xff0000);
    expect(parseColour('LightGrey')).toBe(0xb5b4ae);
    expect(buildingLook({ ...house, roof: '#123456', kind: 'office' }, fan).facets[0].colour).toBe(0x123456);
  });

  it('cuts a polygon along a line', () => {
    const half = clipHalfPlane([0, 0, 80, 0, 80, 40, 0, 40], 0, 20, 1, 0, 1);
    const ys = half.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(20);
    expect(Math.max(...ys)).toBeCloseTo(40);
  });
});
