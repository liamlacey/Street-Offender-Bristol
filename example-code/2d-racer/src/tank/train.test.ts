import { describe, expect, it } from 'vitest';
import { generateIsland, railPose } from './island';
import { random } from './noise';
import { arrival, stepCop, wanted } from './police';
import { type Train, planTrains, stepTrain, trainSpecs } from './train';
import { World } from './world';

const island = generateIsland(42);
const railway = island.railway!;
const far = { x: -99999, y: -99999 };

const setup = () => {
  const plans = planTrains(railway, random(3));
  const world = new World([...island.things, ...trainSpecs(railway, plans)]);
  let k = island.things.length;
  const trains: Train[] = plans.map((p) => ({ cars: p.kinds.map(() => world.things[k++]), s: p.s, speed: 0, dwell: 0, last: -1, stopped: false }));
  return { world, trains };
};

describe('the trains', { timeout: 60_000 }, () => {
  it('run round the line, stopping at the stations', () => {
    const { world, trains } = setup();
    const train = trains[0];
    const start = train.s;
    let dwelt = 0;
    for (let k = 0; k < 20 * 180; k++) {
      stepTrain(train, railway, world, far, 1 / 20);
      if (train.dwell > 0) dwelt++;
    }
    expect(train.s - start).toBeGreaterThan(3000);
    expect(dwelt).toBeGreaterThan(0);
    // The carriages follow the locomotive along the line.
    const pose = railPose(railway, train.s - 74);
    expect(Math.hypot(train.cars[1].x - pose.x, train.cars[1].y - pose.y)).toBeLessThan(1);
  });

  it('stop for the tank on the line, and for good once hit', () => {
    const { world, trains } = setup();
    const train = trains[0];
    for (let k = 0; k < 400; k++) stepTrain(train, railway, world, far, 1 / 20);
    const ahead = railPose(railway, train.s + 260);
    for (let k = 0; k < 400; k++) stepTrain(train, railway, world, ahead, 1 / 20);
    expect(train.speed).toBe(0);
    world.blast(train.cars[2].x, train.cars[2].y, 80, 200, train.cars[2]);
    expect(stepTrain(train, railway, world, far, 1 / 20)).toBe(true);
    const s = train.s;
    for (let k = 0; k < 100; k++) stepTrain(train, railway, world, far, 1 / 20);
    expect(train.s).toBe(s);
  });
});

describe('the police', { timeout: 60_000 }, () => {
  it('come after the tank, more the more it destroys', () => {
    expect(wanted(0)).toBe(0);
    expect(wanted(1)).toBe(1);
    expect(wanted(30)).toBeGreaterThan(wanted(6));
    expect(wanted(1000)).toBe(14);
  });

  it('arrive out of sight, and race to get in front of the tank', () => {
    const world = new World(island.things);
    const tank = { x: island.spawn.x, y: island.spawn.y, heading: 0, speed: 100 };
    const spec = arrival(island, tank, random(5), false)!;
    expect(spec).not.toBeNull();
    const d0 = Math.hypot(spec.x - tank.x, spec.y - tank.y);
    expect(d0).toBeGreaterThan(780);
    const cop = { thing: world.add(spec), speed: 0, stopped: false };
    let best = d0;
    for (let k = 0; k < 20 * 20; k++) {
      stepCop(cop, 1 / 20, tank, world, island);
      best = Math.min(best, Math.hypot(cop.thing.x - tank.x, cop.thing.y - tank.y));
    }
    expect(best).toBeLessThan(d0 - 300);
    world.blast(cop.thing.x, cop.thing.y, 80, 200, cop.thing);
    expect(stepCop(cop, 1 / 20, tank, world, island)).toBe(true);
  });
});
