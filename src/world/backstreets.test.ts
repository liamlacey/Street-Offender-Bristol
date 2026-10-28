import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { Traffic } from './traffic';

const M = 8;
const whole = bristol as unknown as GameMap;

describe('backstreets', () => {
  it('Pitch Lane, hemmed in by the walls and garages behind the houses, is one lane wide, no pavements', () => {
    const lane = whole.roads.find((r) => r.name === 'Pitch Lane')!;
    expect(lane.backstreet).toBe(true);
    expect(lane.width).toBeLessThan(5 * M);
    expect(lane.width).toBeGreaterThanOrEqual(3.5 * M);
    expect(lane.pavement).toBeUndefined();
  });

  it('are few, and the main streets are none of them', () => {
    const back = whole.roads.filter((r) => r.backstreet);
    expect(back.length).toBeGreaterThan(20);
    expect(back.length).toBeLessThan(150);
    for (const r of back) expect(r.kind).toBe('street');
    for (const name of ['Gloucester Road', 'Cheltenham Road', 'Whiteladies Road', 'Park Street']) expect(whole.roads.some((r) => r.name === name && r.backstreet)).toBe(false);
  });

  it('Picton Lane, its far side built up too, has room for cars parked along it and a lane to drive (no pavements)', () => {
    const lane = whole.roads.find((r) => r.name === 'Picton Lane' && r.backstreet)!;
    expect(lane.width).toBeGreaterThanOrEqual(6.5 * M);
    expect(lane.pavement).toBeUndefined();
    expect(lane.lanes?.some((l) => l.kind === 'parking')).toBe(true);
    expect(lane.marks).toBeUndefined();
  });

  it('the traffic drives them, even a one-lane one, squeezing by', () => {
    const lane = whole.roads.find((r) => r.name === 'Pitch Lane')!;
    const { index, tiles } = splitMap(whole);
    const [cx, cy] = [Math.round(lane.pts[0] / TILE) * TILE, Math.round(lane.pts[1] / TILE) * TILE];
    const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
    const map = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
    const traffic = new Traffic(map, { rand: () => 0.4 });
    const ours = map.roads.findIndex((r) => r.name === 'Pitch Lane');
    expect(ours).toBeGreaterThanOrEqual(0);
    expect((traffic as unknown as { lanes: { road: number }[] }).lanes.filter((l) => l.road === ours).length).toBe(2);
  }, 60_000);
});
