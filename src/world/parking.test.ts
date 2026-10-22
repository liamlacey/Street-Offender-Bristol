import { describe, expect, it } from 'vitest';
import type { Area, GameMap, Road } from '../map/osm';
import { central } from '../test/central';
import { BAY_DEPTH, BAY_WIDTH, type Space, carParkBays, parkingSpaces } from './parking';
import { rectsOverlap } from './playgrounds';

const M = 8;
const box = (s: Space): [number, number, number, number, number] => [s.x, s.y, s.angle, s.length / 2 - 1, (s.endOn ? BAY_WIDTH : 2 * M) / 2 - 1];
const overlaps = (spaces: Space[]) => {
  let n = 0;
  for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) if (Math.hypot(spaces[i].x - spaces[j].x, spaces[i].y - spaces[j].y) < BAY_DEPTH && rectsOverlap(box(spaces[i]), box(spaces[j]))) n++;
  return n;
};

describe('car park bays', () => {
  it("don't overlap where an aisle bends, or another branches off it", () => {
    // A car park 60 m square; an aisle along it that turns a corner, and another off its middle.
    const lot: Area = { kind: 'parking', rings: [[0, 0, 480, 0, 480, 480, 0, 480]] };
    const aisle = (pts: number[]): Road => ({ kind: 'service', width: 6 * M, pts, aisle: true });
    const map = { roads: [aisle([60, 100, 400, 100, 400, 420]), aisle([230, 100, 230, 420])], areas: [lot] } as unknown as GameMap;
    const { spaces } = carParkBays(map, lot);
    expect(spaces.length).toBeGreaterThan(40);
    expect(overlaps(spaces)).toBe(0);
  });

  it("don't overlap anywhere in the middle of Bristol", () => {
    expect(overlaps(parkingSpaces(central()))).toBe(0);
  });
});
