import { describe, expect, it } from 'vitest';
import { CAR_LENGTH, NO_INPUT, createCar, stepCar } from '../car/CarPhysics';
import {
  type Body,
  type Circle,
  CircleGrid,
  collideCarWithBody,
  collideCarWithStatic,
  collideCars,
  stepBody,
} from './collisions';

const DT = 1 / 120;

/** A vertical wall of tyres at x = 0, from y = -400 to 400. */
function wall(): CircleGrid {
  const tyres: Circle[] = [];
  for (let y = -400; y <= 400; y += 27) tyres.push({ x: 0, y, r: 15 });
  return new CircleGrid(tyres);
}

function speed(car: { vx: number; vy: number }) {
  return Math.hypot(car.vx, car.vy);
}

/** Lets the car coast for `seconds` with collisions against `grid`. Returns the max impulse seen. */
function coast(car: ReturnType<typeof createCar>, grid: CircleGrid, seconds: number) {
  let maxImpulse = 0;
  for (let t = 0; t < seconds; t += DT) {
    stepCar(car, NO_INPUT, DT);
    maxImpulse = Math.max(maxImpulse, collideCarWithStatic(car, grid));
  }
  return maxImpulse;
}

describe('car against a tyre wall', () => {
  it('bounces back from a head-on hit, losing most of its speed', () => {
    const car = createCar(-100, 0, 0);
    car.vx = 600;
    const impulse = coast(car, wall(), 0.5);
    expect(impulse).toBeGreaterThan(400);
    expect(car.vx).toBeLessThan(0);
    expect(speed(car)).toBeLessThan(600 * 0.4);
  });

  it('never passes through, even at top speed for a long time', () => {
    const car = createCar(-100, 0, 0);
    for (let t = 0; t < 3; t += DT) {
      stepCar(car, { ...NO_INPUT, throttle: 1 }, DT);
      collideCarWithStatic(car, wall());
      expect(car.x).toBeLessThan(-15 - 12 + 1); // tyre radius + half car width
    }
  });

  it('scrapes along at a shallow angle, keeping most of its speed', () => {
    const angle = Math.PI / 2 - 0.2; // driving along the wall (+y), ~11° into it
    const car = createCar(-35, 0, angle);
    car.vx = 500 * Math.cos(angle);
    car.vy = 500 * Math.sin(angle);
    coast(car, wall(), 0.3);
    expect(car.x).toBeLessThan(0);
    expect(speed(car)).toBeGreaterThan(250);
  });

  it('spins the car on an angled hit', () => {
    const angle = 0.7; // ~40°
    const car = createCar(-80, 0, angle);
    car.vx = 600 * Math.cos(angle);
    car.vy = 600 * Math.sin(angle);
    let maxSpin = 0;
    for (let t = 0; t < 0.4; t += DT) {
      stepCar(car, NO_INPUT, DT);
      collideCarWithStatic(car, wall());
      maxSpin = Math.max(maxSpin, Math.abs(car.spin));
    }
    expect(maxSpin).toBeGreaterThan(1);
  });

  it('never gains speed from a collision', () => {
    for (const angle of [0, 0.3, 0.7, 1.1, -0.5]) {
      const car = createCar(-60, 0, angle);
      car.vx = 600 * Math.cos(angle);
      car.vy = 600 * Math.sin(angle);
      let before = speed(car);
      for (let t = 0; t < 0.5; t += DT) {
        collideCarWithStatic(car, wall());
        expect(speed(car)).toBeLessThanOrEqual(before + 1e-6);
        stepCar(car, NO_INPUT, DT);
        before = speed(car);
      }
    }
  });

  it('does nothing when not touching', () => {
    const car = createCar(-200, 0, 0);
    car.vx = 300;
    expect(collideCarWithStatic(car, wall())).toBe(0);
    expect(car.vx).toBe(300);
  });
});

describe('car against a cone', () => {
  const cone = (): Body => ({ x: 0, y: 0, r: 9, vx: 0, vy: 0, invMass: 12.5, angle: 0, spin: 0 });

  it('knocks the cone flying and only loses a little speed', () => {
    const car = createCar(-CAR_LENGTH, 0, 0);
    car.vx = 400;
    const c = cone();
    for (let t = 0; t < 0.2; t += DT) {
      stepCar(car, NO_INPUT, DT);
      collideCarWithBody(car, c);
      stepBody(c, DT);
    }
    expect(c.vx).toBeGreaterThan(car.vx);
    expect(car.vx).toBeGreaterThan(300);
  });

  it('cones slow down and stop on their own', () => {
    const c = cone();
    c.vx = 500;
    for (let t = 0; t < 4; t += DT) stepBody(c, DT);
    expect(Math.abs(c.vx)).toBeLessThan(5);
  });
});

describe('car against a parked car (a long body)', () => {
  /** A parked car lying across the road (north-south) at the origin. */
  const parked = (): Body => ({ x: 0, y: 0, r: 10, length: 40, vx: 0, vy: 0, invMass: 1.6, angle: Math.PI / 2, spin: 0, damping: 4 });
  /** Drives a car east into it, `y` px off its middle, and lets them both slide. */
  function hit(y: number): Body {
    const body = parked();
    const car = createCar(-60, y, 0);
    car.vx = 500;
    for (let t = 0; t < 0.6; t += DT) {
      stepCar(car, NO_INPUT, DT);
      collideCarWithBody(car, body);
      stepBody(body, DT);
    }
    return body;
  }

  it('shoves it along without turning it when hit square in the middle', () => {
    const body = hit(0);
    expect(body.x).toBeGreaterThan(20);
    expect(Math.abs(body.angle - Math.PI / 2)).toBeLessThan(0.05);
  });

  it('spins it round when hit near one end', () => {
    expect(Math.abs(hit(16).angle - Math.PI / 2)).toBeGreaterThan(0.2);
  });

  it('is hit along its whole length, not just in the middle', () => {
    const body = parked();
    const car = createCar(-60, 17, 0);
    car.vx = 300;
    let touched = 0;
    for (let t = 0; t < 0.3; t += DT) {
      stepCar(car, NO_INPUT, DT);
      touched = Math.max(touched, collideCarWithBody(car, body));
    }
    expect(touched).toBeGreaterThan(0);
  });
});

describe('car against car', () => {
  const momentum = (cars: { vx: number; vy: number }[]) => [
    cars.reduce((sum, c) => sum + c.vx, 0),
    cars.reduce((sum, c) => sum + c.vy, 0),
  ];
  const energy = (cars: { vx: number; vy: number }[]) => cars.reduce((sum, c) => sum + c.vx ** 2 + c.vy ** 2, 0);

  it('rear-ending a slower car shoves it forward and slows the hitter', () => {
    const hitter = createCar(-CAR_LENGTH - 5, 0, 0);
    hitter.vx = 500;
    const victim = createCar(0, 0, 0);
    victim.vx = 200;
    for (let t = 0; t < 0.3; t += DT) {
      stepCar(hitter, NO_INPUT, DT);
      stepCar(victim, NO_INPUT, DT);
      collideCars(hitter, victim);
    }
    expect(victim.vx).toBeGreaterThan(250);
    expect(hitter.vx).toBeLessThan(400);
    expect(victim.x - hitter.x).toBeGreaterThan(CAR_LENGTH - 1); // no overlap left
  });

  it('conserves momentum and never creates energy', () => {
    for (const [angle, offsetY] of [
      [0.5, 6],
      [Math.PI / 2, -8],
      [2.5, 0],
    ]) {
      const a = createCar(-30, offsetY, 0);
      a.vx = 450;
      const b = createCar(-2, 0, angle);
      b.vy = -150;
      const p0 = momentum([a, b]);
      const e0 = energy([a, b]);
      const impulse = collideCars(a, b);
      expect(impulse).toBeGreaterThan(0);
      const p1 = momentum([a, b]);
      expect(p1[0]).toBeCloseTo(p0[0], 6);
      expect(p1[1]).toBeCloseTo(p0[1], 6);
      // Linear energy can only drop or move into spin, never appear from nowhere.
      expect(energy([a, b])).toBeLessThanOrEqual(e0 + 1e-6);
    }
  });

  it('a side swipe spins the car that gets hit', () => {
    const hitter = createCar(0, -40, Math.PI / 2); // heading down, into the rear of the other car's side
    hitter.vy = 450;
    const victim = createCar(14, 0, 0);
    for (let t = 0; t < 0.2; t += DT) {
      stepCar(hitter, NO_INPUT, DT);
      stepCar(victim, NO_INPUT, DT);
      collideCars(hitter, victim);
    }
    expect(Math.abs(victim.spin)).toBeGreaterThan(0.5);
  });
});

describe('CircleGrid', () => {
  it('finds circles near a point, including across cell borders', () => {
    const grid = new CircleGrid([
      { x: 63, y: 0, r: 5 },
      { x: 500, y: 500, r: 5 },
    ]);
    expect(grid.near(70, 0, 5)).toHaveLength(1);
    expect(grid.near(-200, -200, 5)).toHaveLength(0);
  });
});
