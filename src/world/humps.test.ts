import { describe, expect, it } from 'vitest';
import { createCar } from '../car/CarPhysics';
import type { GameMap } from '../map/osm';
import { Humps } from './humps';

// A road running east, 8 m wide: a hump across it at x = 0, a table at x = 400, cushions at x = 800.
const map = {
  paint: [
    { kind: 'hump', x: 0, y: 0, angle: 0, width: 64 },
    { kind: 'table', x: 400, y: 0, angle: 0, width: 64 },
    { kind: 'cushion', x: 800, y: 0, angle: 0, width: 64 },
  ],
} as unknown as GameMap;

const over = (x: number, y: number, speed: number) => {
  const car = createCar(x + 4, y, 0);
  car.vx = speed;
  const jolt = new Humps(map).over(car, x - 4, y);
  return { jolt, after: car.vx };
};

describe('Humps', () => {
  it('jolts and slows a car going over one fast, more the faster', () => {
    expect(over(0, 0, 400).jolt).toBeGreaterThan(over(0, 0, 200).jolt);
    expect(over(0, 0, 400).after).toBeLessThan(400);
  });

  it('lets a car taking it gently go over without a jolt', () => {
    expect(over(0, 0, 40).jolt).toBe(0);
  });

  it('jolts less over a long flat table than a round-topped hump', () => {
    expect(over(400, 0, 400).jolt).toBeLessThan(over(0, 0, 400).jolt);
  });

  it("jolts going over a cushion, but not between them, or off the road", () => {
    expect(over(800, 16, 400).jolt).toBeGreaterThan(0);
    expect(over(800, 0, 400).jolt).toBe(0);
    expect(over(0, 60, 400).jolt).toBe(0);
  });
});

describe('Steps', () => {
  // A flight of 4 steps running east, 8 m long, 2 m wide.
  const flight = { roads: [{ kind: 'steps', width: 16, pts: [0, 0, 64, 0], steps: 4 }] } as unknown as GameMap;

  it('jolts a little at each step, and only on the steps', () => {
    const at = (x: number, y: number, speed: number) => {
      const car = createCar(x + 4, y, 0);
      car.vx = speed;
      return new Humps(flight).over(car, x - 4, y);
    };
    // The step edges are at 8, 24, 40 and 56.
    expect(at(8, 0, 300)).toBeGreaterThan(0);
    expect(at(24, 0, 300)).toBeGreaterThan(0);
    expect(at(16, 0, 300)).toBe(0);
    expect(at(8, 20, 300)).toBe(0);
    expect(at(8, 0, 30)).toBe(0);
    expect(at(8, 0, 300)).toBeLessThan(at(0, 0, 0) + 300 * 0.06);
  });
});
