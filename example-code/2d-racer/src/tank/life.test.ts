import { describe, expect, it } from 'vitest';
import { generateIsland } from './island';
import { type Agent, FRIGHT, type Ground, groundFor, populate, settle, stepAgent } from './life';
import { random } from './noise';
import { makeDriver, planTraffic, stepDriver, trafficSpecs } from './traffic';
import { World } from './world';

const open: Ground = { free: () => true };
const person = (x = 0, y = 0): Agent => ({
  kind: 'person',
  x,
  y,
  heading: 0,
  speed: 0,
  home: { x: 0, y: 0, r: 200 },
  target: null,
  wait: 0,
  scared: 0,
  from: { x: 0, y: 0 },
  look: 0,
});
const far = { x: 99999, y: 99999 };

describe('people and animals', () => {
  it('wander about near home, stopping now and then', () => {
    const a = person();
    const rand = random(3);
    let stood = 0;
    for (let k = 0; k < 6000; k++) {
      stepAgent(a, 1 / 30, open, far, [], rand);
      if (a.speed === 0) stood++;
      expect(Math.hypot(a.x, a.y)).toBeLessThan(260);
    }
    expect(stood).toBeGreaterThan(500);
    expect(stood).toBeLessThan(5500);
  });

  it('run from an explosion, and from the tank', () => {
    const a = person(100, 0);
    stepAgent(a, 1 / 30, open, far, [{ x: 0, y: 0 }], random(1));
    expect(a.scared).toBeGreaterThan(0);
    for (let k = 0; k < 30; k++) stepAgent(a, 1 / 30, open, far, [], random(1));
    expect(a.x).toBeGreaterThan(200);
    const b = person(0, 0);
    stepAgent(b, 1 / 30, open, { x: 0, y: FRIGHT.person.tank - 10 }, [], random(1));
    expect(b.scared).toBeGreaterThan(0);
    for (let k = 0; k < 30; k++) stepAgent(b, 1 / 30, open, { x: 0, y: FRIGHT.person.tank - 10 }, [], random(1));
    expect(b.y).toBeLessThan(-50);
  });

  it('step out from under the tank', () => {
    const a = person(5, 0);
    a.wait = 100;
    stepAgent(a, 1 / 30, open, { x: 0, y: 0 }, [], random(1));
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(30);
  });

  it('sunbathe in their spot till something scares them off it, then come back and lie down again', () => {
    const a: Agent = { ...person(0, 0), role: 'sunbather', face: 1, wait: Infinity };
    const rand = random(4);
    for (let k = 0; k < 300; k++) stepAgent(a, 1 / 30, open, far, [], rand);
    expect([a.x, a.y, a.speed]).toEqual([0, 0, 0]);
    stepAgent(a, 1 / 30, open, far, [{ x: 50, y: 0 }], rand);
    for (let k = 0; k < 60; k++) stepAgent(a, 1 / 30, open, far, [], rand);
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(50);
    for (let k = 0; k < 1200; k++) stepAgent(a, 1 / 30, open, far, [], rand);
    expect(Math.hypot(a.x, a.y)).toBeLessThan(4);
    expect(a.speed).toBe(0);
    expect(a.wait).toBe(Infinity);
  });

  it('live on dry land (swimmers in the shallows), out of the houses, and stay there', () => {
    const island = generateIsland(42);
    const world = new World(island.things);
    const rand = random(9);
    const agents = settle(populate(island, rand), (k) => groundFor(island, world, k), rand);
    expect(agents.filter((a) => a.kind === 'person').length).toBeGreaterThan(20);
    for (const kind of ['sheep', 'cow', 'deer', 'hiker', 'swimmer'] as const) expect(agents.some((a) => a.kind === kind)).toBe(true);
    for (const role of ['sunbather', 'camper', 'worker'] as const) expect(agents.some((a) => a.role === role)).toBe(true);
    for (let k = 0; k < 300; k++) {
      for (const a of agents) stepAgent(a, 1 / 20, groundFor(island, world, a.kind), far, k === 100 ? [{ x: a.x + 50, y: a.y }] : [], rand);
    }
    for (const a of agents) expect(groundFor(island, world, a.kind).free(a.x, a.y)).toBe(true);
  }, 120_000);
});

describe('traffic', { timeout: 60_000 }, () => {
  const island = generateIsland(42);
  const plans = planTraffic(island, random(4));
  const setup = () => {
    const world = new World([...island.things, ...trafficSpecs(plans)]);
    const drivers = plans.map((p, k) => makeDriver(p, world.things[island.things.length + k]));
    return { world, drivers };
  };

  it('has vehicles on the tracks and boats on the water', () => {
    expect(plans.filter((p) => p.kind !== 'boat').length).toBeGreaterThanOrEqual(island.tracks.length);
    expect(plans.some((p) => p.kind === 'boat')).toBe(true);
  });

  it('drives along the tracks, and back again', () => {
    const { world, drivers } = setup();
    const travelled = drivers.map(() => 0);
    for (let k = 0; k < 600; k++) {
      drivers.forEach((d, i) => {
        const { x, y } = d.thing;
        stepDriver(d, 1 / 20, world, far, drivers, island);
        travelled[i] += Math.hypot(d.thing.x - x, d.thing.y - y);
      });
    }
    // (Even on the shortest town street, with waits at each end.)
    for (const t of travelled) expect(t).toBeGreaterThan(250);
    // Still findable where it now is.
    const d = drivers[0];
    expect(world.near(d.thing.x, d.thing.y, 10)).toContain(d.thing);
  });

  it('stops for the tank', () => {
    const { world, drivers } = setup();
    // A car out on a long road.
    const d = drivers.find((x) => x.thing.kind === 'car' && x.at[x.at.length - 1] > 3000)!;
    for (let k = 0; k < 40; k++) stepDriver(d, 1 / 20, world, far, drivers, island);
    const tank = { x: d.thing.x + Math.cos(d.thing.angle) * 60, y: d.thing.y + Math.sin(d.thing.angle) * 60 };
    for (let k = 0; k < 60; k++) stepDriver(d, 1 / 20, world, tank, drivers, island);
    expect(d.speed).toBe(0);
  });

  it("stops for good when it's hit, and says so once (the driver bails out)", () => {
    const { world, drivers } = setup();
    const d = drivers[0];
    world.blast(d.thing.x, d.thing.y, 60, 100, d.thing);
    expect(stepDriver(d, 1 / 20, world, far, drivers, island)).toBe(true);
    expect(stepDriver(d, 1 / 20, world, far, drivers, island)).toBe(false);
    const x = d.thing.x;
    for (let k = 0; k < 20; k++) stepDriver(d, 1 / 20, world, far, drivers, island);
    expect(d.thing.x).toBe(x);
  });
});
