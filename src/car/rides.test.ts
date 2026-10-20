import { describe, expect, it } from 'vitest';
import { NO_INPUT, createCar, stepCar, carHull, CAR_LENGTH } from './CarPhysics';
import { WALKER, stepWalker, tuningFor } from './rides';
import { VEHICLES } from '../world/traffic';
import { STIFFNESS } from './dents';
import { THINGS, WALLS, breaks, treeToughness } from '../world/damage';

const run = (kind: Parameters<typeof tuningFor>[0], seconds: number) => {
  const car = createCar();
  for (let t = 0; t < seconds; t += 1 / 120) stepCar(car, { ...NO_INPUT, throttle: 1 }, 1 / 120, undefined, tuningFor(kind));
  return Math.hypot(car.vx, car.vy);
};

describe('what you can drive', () => {
  it('handles as it would: a bus slower than a car, a bike quick off the mark but slow flat out', () => {
    expect(run('bus', 3)).toBeLessThan(run('hatch', 3) * 0.6);
    expect(run('own', 20)).toBeGreaterThan(run('van', 20));
    expect(run('bike', 1)).toBeGreaterThan(100);
    expect(run('bike', 20)).toBeLessThan(115);
  });

  it("has a body its own size: a bus's is long, with no gaps along it", () => {
    const own = carHull(createCar());
    expect(own.offsets).toEqual([-(CAR_LENGTH / 2 - 9), 0, CAR_LENGTH / 2 - 9]);
    const bus = carHull({ ...createCar(), length: VEHICLES.bus.length, width: VEHICLES.bus.width, invMass: 1 / 9 });
    expect(bus.offsets[bus.offsets.length - 1] + bus.radius).toBeCloseTo(VEHICLES.bus.length / 2);
    for (let i = 1; i < bus.offsets.length; i++) expect(bus.offsets[i] - bus.offsets[i - 1]).toBeLessThanOrEqual(bus.radius * 1.2);
    expect(bus.invMass).toBeCloseTo(1 / 9);
  });

  it('gives you an armoured truck: through a wall or a tree at a speed a car would bounce off, and hard to dent', () => {
    const weight = VEHICLES.own.mass;
    // 8 m/s (18 mph).
    const speed = 8 * 8;
    for (const t of [WALLS.wall, WALLS.railing, THINGS.lamp, THINGS.bollard, treeToughness(15)]) {
      expect(breaks(t, speed)).toBe(false);
      expect(breaks(t, speed, weight)).toBe(true);
    }
    expect(STIFFNESS.own).toBeGreaterThan(STIFFNESS.double * 5);
    expect(run('own', 20)).toBeGreaterThan(run('lorry', 20) * 1.4);
  });
});

describe('on foot', () => {
  it('turns on the spot, runs the way it faces, and backs off slowly', () => {
    const you = createCar();
    for (let t = 0; t < 1; t += 1 / 120) stepWalker(you, { ...NO_INPUT, throttle: 1 }, 1 / 120);
    expect(Math.hypot(you.vx, you.vy)).toBeCloseTo(WALKER.run, 0);
    expect(you.x).toBeGreaterThan(30);
    const x = you.x;
    for (let t = 0; t < 0.5; t += 1 / 120) stepWalker(you, { ...NO_INPUT, steer: 1 }, 1 / 120);
    expect(you.heading).toBeCloseTo(WALKER.turn * 0.5, 1);
    expect(you.x - x).toBeLessThan(8);
    for (let t = 0; t < 1; t += 1 / 120) stepWalker(you, { ...NO_INPUT, brake: 1 }, 1 / 120);
    expect(Math.hypot(you.vx, you.vy)).toBeCloseTo(WALKER.back, 0);
  });
});
