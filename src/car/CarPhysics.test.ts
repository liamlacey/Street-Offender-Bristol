import { describe, expect, it } from 'vitest';
import {
  type CarInput,
  DEFAULT_TUNING,
  NO_INPUT,
  SURFACE_GRIP,
  createCar,
  forwardSpeed,
  lateralSpeed,
  stepCar,
} from './CarPhysics';

const DT = 1 / 120;

function simulate(seconds: number, input: Partial<CarInput>, car = createCar(), surface = SURFACE_GRIP.road) {
  const full = { ...NO_INPUT, ...input };
  for (let t = 0; t < seconds; t += DT) stepCar(car, full, DT, surface);
  return car;
}

describe('stepCar', () => {
  it('accelerates along its heading', () => {
    const car = simulate(1, { throttle: 1 });
    expect(car.vx).toBeGreaterThan(200);
    expect(car.x).toBeGreaterThan(50);
    expect(Math.abs(car.vy)).toBeLessThan(1e-9);
  });

  it('never exceeds max forward speed', () => {
    const car = simulate(10, { throttle: 1 });
    expect(forwardSpeed(car)).toBeLessThanOrEqual(DEFAULT_TUNING.maxForwardSpeed);
    expect(forwardSpeed(car)).toBeGreaterThan(DEFAULT_TUNING.maxForwardSpeed * 0.9);
  });

  it('coasts to a stop with no input', () => {
    const car = simulate(10, {}, simulate(2, { throttle: 1 }));
    expect(Math.abs(forwardSpeed(car))).toBeLessThan(5);
  });

  it('brakes to a stop, then reverses up to max reverse speed', () => {
    const car = simulate(2, { throttle: 1 });
    simulate(0.3, { brake: 1 }, car);
    expect(forwardSpeed(car)).toBeGreaterThan(0);
    simulate(10, { brake: 1 }, car);
    expect(forwardSpeed(car)).toBeLessThan(0);
    expect(forwardSpeed(car)).toBeGreaterThanOrEqual(-DEFAULT_TUNING.maxReverseSpeed);
  });

  it('cannot turn while stationary', () => {
    const car = simulate(1, { steer: 1 });
    expect(car.heading).toBe(0);
  });

  it('turns right (clockwise on screen) when steering right while moving forward', () => {
    const car = simulate(0.5, { steer: 1 }, simulate(1, { throttle: 1 }));
    expect(car.heading).toBeGreaterThan(0);
  });

  it('inverts steering when reversing', () => {
    const car = simulate(0.5, { steer: 1, brake: 1 }, simulate(2, { brake: 1 }));
    expect(car.heading).toBeLessThan(0);
  });

  it('bleeds off sideways velocity through tyre grip', () => {
    const car = createCar();
    car.vy = 300; // pure sideways slide
    simulate(0.5, {}, car);
    expect(Math.abs(lateralSpeed(car))).toBeLessThan(5);
  });

  it('slides further with the handbrake held', () => {
    const grippy = createCar();
    grippy.vy = 300;
    const loose = createCar();
    loose.vy = 300;
    simulate(0.3, {}, grippy);
    simulate(0.3, { handbrake: true }, loose);
    expect(Math.abs(lateralSpeed(loose))).toBeGreaterThan(Math.abs(lateralSpeed(grippy)) * 5);
  });

  it('keeps heading within -PI..PI', () => {
    const car = simulate(10, { throttle: 1, steer: 1 });
    expect(car.heading).toBeGreaterThanOrEqual(-Math.PI);
    expect(car.heading).toBeLessThanOrEqual(Math.PI);
  });

  it('has a much lower top speed on grass', () => {
    const road = simulate(10, { throttle: 1 });
    const grass = simulate(10, { throttle: 1 }, createCar(), SURFACE_GRIP.grass);
    expect(forwardSpeed(grass)).toBeLessThan(forwardSpeed(road) * 0.5);
  });

  it('is slower again in a flowerbed', () => {
    const grass = simulate(10, { throttle: 1 }, createCar(), SURFACE_GRIP.grass);
    const mud = simulate(10, { throttle: 1 }, createCar(), SURFACE_GRIP.mud);
    expect(forwardSpeed(mud)).toBeLessThan(forwardSpeed(grass));
  });

  it('slows quickly when driving from road onto grass', () => {
    const car = simulate(10, { throttle: 1 });
    simulate(1, { throttle: 1 }, car, SURFACE_GRIP.grass);
    expect(forwardSpeed(car)).toBeLessThan(DEFAULT_TUNING.maxForwardSpeed * 0.6);
  });

  it('slides more on grass', () => {
    const road = createCar();
    road.vy = 300;
    const grass = createCar();
    grass.vy = 300;
    simulate(0.2, {}, road);
    simulate(0.2, {}, grass, SURFACE_GRIP.grass);
    expect(Math.abs(lateralSpeed(grass))).toBeGreaterThan(Math.abs(lateralSpeed(road)) * 2);
  });
});

describe('hills', () => {
  /** A slope rising `grade` metres per metre to the east (the way a new car faces). */
  const hill = (grade: number) => ({ x: grade, y: 0 });
  const climb = (grade: number, seconds = 10, car = createCar()) => {
    const full = { ...NO_INPUT, throttle: 1 };
    for (let t = 0; t < seconds; t += DT) stepCar(car, full, DT, SURFACE_GRIP.road, DEFAULT_TUNING, hill(grade));
    return car;
  };

  it('is slower up a hill, and slower the steeper it is', () => {
    const flat = forwardSpeed(climb(0));
    const gentle = forwardSpeed(climb(0.05));
    const steep = forwardSpeed(climb(0.15));
    expect(gentle).toBeLessThan(flat);
    expect(steep).toBeLessThan(gentle * 0.8);
  });

  it('is faster down one', () => {
    expect(forwardSpeed(climb(-0.12))).toBeGreaterThan(forwardSpeed(climb(0)) * 1.1);
  });

  it('rolls back down a steep hill when stopped, unless the handbrake is on', () => {
    const rolling = createCar();
    for (let t = 0; t < 2; t += DT) stepCar(rolling, NO_INPUT, DT, SURFACE_GRIP.road, DEFAULT_TUNING, hill(0.15));
    expect(rolling.x).toBeLessThan(-10);
    const held = createCar();
    for (let t = 0; t < 2; t += DT) stepCar(held, { ...NO_INPUT, handbrake: true }, DT, SURFACE_GRIP.road, DEFAULT_TUNING, hill(0.15));
    expect(Math.abs(held.x)).toBeLessThan(1);
  });

  it('stays put on a gentle one', () => {
    const car = createCar();
    for (let t = 0; t < 2; t += DT) stepCar(car, NO_INPUT, DT, SURFACE_GRIP.road, DEFAULT_TUNING, hill(0.03));
    expect(Math.abs(car.x)).toBeLessThan(0.5);
  });
});
