import { describe, expect, it } from 'vitest';
import { type CarState, createCar } from '../car/CarPhysics';
import type { GameMap } from '../map/osm';
import { Kerbs } from './kerbs';

const map = { dropped: [100, 0], crossings: [{ x: 0, y: 200, angle: 0, width: 80, kind: 'zebra' }] } as unknown as GameMap;

function going(speed: number, x = 0, y = 0): CarState {
  const car = createCar(x, y, 0);
  car.vx = speed;
  return car;
}

describe('Kerbs', () => {
  it('jolts and slows a car going up a kerb, more than coming down one', () => {
    const kerbs = new Kerbs(map);
    const up = going(300);
    const down = going(300);
    expect(kerbs.bump(up, true)).toBeGreaterThan(kerbs.bump(down, false));
    expect(up.vx).toBeLessThan(300);
    expect(down.vx).toBeLessThan(300);
  });

  it('lets a slow car roll over it', () => {
    const car = going(20);
    expect(new Kerbs(map).bump(car, true)).toBe(0);
    expect(car.vx).toBe(20);
  });

  it("doesn't jolt where the kerb's dropped, or at a crossing", () => {
    const kerbs = new Kerbs(map);
    expect(kerbs.bump(going(300, 110, 5), true)).toBe(0);
    // Half the road's width plus a little from the crossing's middle.
    expect(kerbs.bump(going(300, 0, 255), true)).toBe(0);
    expect(kerbs.bump(going(300, 0, 300), true)).toBeGreaterThan(0);
  });
});
