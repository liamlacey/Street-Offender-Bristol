import { describe, expect, it } from 'vitest';
import type { GameMap, Road } from '../map/osm';
import type { Light } from './lights';
import { parkingSpaces } from './parking';
import { PAUSE, Traffic, buildLanes } from './traffic';

// A crossroads: a main road running east-west along y = 400, 8 m wide, and a side street north-south along x = 400, 6 m wide.
const road = (kind: Road['kind'], width: number, pts: number[], extra: Partial<Road> = {}): Road => ({ kind, width, pts, ...extra }) as Road;
const crossroads = (extra: Partial<GameMap> = {}): GameMap =>
  ({
    pxPerMetre: 8,
    width: 800,
    height: 800,
    roads: [road('primary', 64, [0, 400, 400, 400, 800, 400]), road('street', 48, [400, 0, 400, 400, 400, 800])],
    areas: [],
    signals: [],
    controllers: [],
    paint: [],
    ...extra,
  }) as unknown as GameMap;

const view = { x0: 0, y0: 0, x1: 800, y1: 800 };
const away = { x: 20, y: 780, heading: 0, vx: 0, vy: 0, level: 0, length: 38, width: 18 };
const green = (): Light => 'green';

/** A traffic with nothing coming and going on its own: just what a test puts there. */
function quiet(map: GameMap): Traffic {
  let seed = 7;
  const traffic = new Traffic(map, { max: 0, buses: 0, rand: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
  return traffic;
}

const run = (traffic: Traffic, seconds: number, player = away, light = green) => {
  for (let t = 0; t < seconds; t += 1 / 60) traffic.update(1 / 60, player, view, light);
};

describe('the lanes', () => {
  it('split the roads at the junction, a lane each way, on the left (as in Britain)', () => {
    const { lanes } = buildLanes(crossroads());
    expect(lanes.length).toBe(8);
    const east = lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    const west = lanes.find((l) => l.road === 0 && l.dir === -1 && l.pts[0] < 400)!;
    // Heading east, the left is north (y is down).
    expect(east.pts[1]).toBeLessThan(400);
    expect(west.pts[1]).toBeGreaterThan(400);
    // Stopping short of the junction, to leave room for the turns.
    expect(east.pts[east.pts.length - 2]).toBeLessThan(400 - 32);
  });

  it('give way at the end of the side street, not the main road', () => {
    const { lanes } = buildLanes(crossroads());
    expect(lanes.filter((l) => l.road === 1).every((l) => l.giveWay === (l.to !== l.from && (l.pts[l.pts.length - 1] < 400 ? l.dir === 1 : l.dir === -1)))).toBe(true);
    expect(lanes.filter((l) => l.road === 0).some((l) => l.giveWay)).toBe(false);
  });
});

describe('driving', () => {
  it('drives along its lane at about the speed for the road', () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    const v = traffic.spawn(lane, 10, 'hatch');
    run(traffic, 2);
    expect(v.x).toBeGreaterThan(80);
    // A main road: about 30 mph (13.4 m/s), never over it.
    expect(v.speed).toBeGreaterThan(70);
    expect(v.speed).toBeLessThanOrEqual(13.4 * 8 + 0.01);
  });

  it('drives at its own pace, and not quite steadily: no two alike, and never a fixed speed', () => {
    const long = crossroads({ width: 8000, roads: [road('street', 48, [0, 400, 8000, 400])] } as Partial<GameMap>);
    const traffic = quiet(long);
    const lane = traffic.lanes.find((l) => l.dir === 1)!;
    const paces = Array.from({ length: 30 }, () => traffic.spawn(lane, 10, 'hatch').pace);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(0.2);
    // One on its own, along a straight road: its speed swells and eases.
    const solo = quiet(long);
    const v = solo.spawn(solo.lanes.find((l) => l.dir === 1)!, 10, 'hatch');
    const speeds: number[] = [];
    for (let t = 0; t < 40; t += 1 / 60) {
      solo.update(1 / 60, { ...away, x: v.x, y: 700 }, { x0: v.x - 400, y0: 0, x1: v.x + 400, y1: 800 }, green);
      if (t > 6) speeds.push(v.speed);
    }
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(6);
  });

  it("stops behind something in the way, without hitting it", () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    const v = traffic.spawn(lane, 10, 'hatch');
    const [, y] = [0, lane.pts[1]];
    const you = { ...away, x: 250, y, heading: 0 };
    run(traffic, 8, you);
    expect(v.speed).toBeLessThan(1);
    expect(you.x - v.x).toBeGreaterThan((38 + v.length) / 2);
    expect(you.x - v.x).toBeLessThan((38 + v.length) / 2 + 40);
  });

  it('stops at a red light, and goes on green', () => {
    const map = crossroads({
      signals: [{ x: 360, y: 360, angle: 0, stop: [350, 368, 350, 400], controller: 0, group: 0 }],
      controllers: [{ x: 400, y: 400, groups: 2, walk: false }],
    } as Partial<GameMap>);
    const traffic = quiet(map);
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    expect(lane.stops.length).toBe(1);
    const v = traffic.spawn(lane, 10, 'hatch');
    let light: Light = 'red';
    run(traffic, 8, away, () => light);
    expect(v.speed).toBeLessThan(1);
    expect(v.x + v.length / 2).toBeLessThan(352);
    expect(v.x + v.length / 2).toBeGreaterThan(320);
    light = 'green';
    run(traffic, 6, away, () => light);
    expect(v.x).toBeGreaterThan(400);
  });

  it("gives way at the end of the side street to what's coming along the main road", () => {
    const traffic = quiet(crossroads());
    const side = traffic.lanes.find((l) => l.road === 1 && l.giveWay && l.pts[1] < 400)!;
    const v = traffic.spawn(side, side.length - 60, 'hatch');
    // You, coming along the main road towards the junction.
    const you = { ...away, x: 300, y: 384, vx: 80 };
    run(traffic, 1, you);
    expect(v.y + v.length / 2).toBeLessThan(side.pts[side.pts.length - 1] + 2);
    // Gone by: it goes (on across the junction, or turning into the main road).
    run(traffic, 6);
    expect(v.route[0]).not.toBe(side);
    expect(v.y).toBeGreaterThan(side.pts[side.pts.length - 1] + 10);
  });

  it('knocked about, stops a moment, then drives back into its lane and on', () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    const v = traffic.spawn(lane, 60, 'hatch');
    run(traffic, 0.5);
    // Shunted sideways, turned a little.
    v.vx = 40;
    v.vy = 160;
    v.spin = 1;
    traffic.knock(v, 100);
    run(traffic, PAUSE * 0.5);
    expect(v.mode).toBe('knocked');
    run(traffic, PAUSE + 8);
    expect(v.mode).toBe('drive');
    const x = v.x;
    run(traffic, 2);
    expect(v.x).toBeGreaterThan(x + 50);
    expect(Math.abs(v.y - lane.pts[1])).toBeLessThan(4);
  });
});

describe('parked cars knocked into the road', () => {
  it("don't stop the traffic (a car giving way next to one carries on)", () => {
    const side = road('street', 80, [400, 0, 400, 400, 400, 800], {
      lanes: [{ side: 1, kind: 'parking', width: 16, bays: 'parallel' }],
      laneSpans: [0, 800],
    });
    const traffic = quiet(crossroads({ roads: [road('primary', 64, [0, 400, 400, 400, 800, 400]), side] }));
    expect(traffic.parked.length).toBeGreaterThan(0);
    for (const v of traffic.parked) {
      v.vx = 30;
      traffic.knock(v, 100);
    }
    const lane = traffic.lanes.find((l) => l.road === 1 && l.giveWay && l.pts[1] < 400)!;
    const v = traffic.spawn(lane, lane.length - 60, 'hatch');
    expect(() => run(traffic, 3)).not.toThrow();
    expect(traffic.vehicles).toContain(v);
  });
});

describe('parking', () => {
  it('puts the bays of a parking lane along the kerb, facing the way the traffic goes', () => {
    const street = road('street', 80, [0, 400, 800, 400], {
      lanes: [{ side: 1, kind: 'parking', width: 16, bays: 'parallel' }],
      laneSpans: [0, 800],
    });
    const spaces = parkingSpaces(crossroads({ roads: [street] }));
    expect(spaces.length).toBeGreaterThan(8);
    for (const s of spaces) {
      // Left of the way (north), against the kerb.
      expect(s.y).toBeCloseTo(400 - 40 + 8, 0);
      expect(Math.cos(s.angle)).toBeCloseTo(1, 3);
    }
  });

  it('fills most of them with parked cars', () => {
    const street = road('street', 80, [0, 400, 800, 400], {
      lanes: [{ side: 1, kind: 'parking', width: 40, bays: 'perpendicular' }],
      laneSpans: [0, 800],
    });
    const traffic = quiet(crossroads({ roads: [street] }));
    expect(traffic.parked.length).toBeGreaterThan(10);
    expect(traffic.parked.every((v) => v.mode === 'parked' && v.kind !== 'lorry')).toBe(true);
  });
});

describe('buses', () => {
  // A main road east-west, with a stop on it at x = 300; the route turns north up the side street at the crossroads.
  const route = (extra: Partial<GameMap> = {}) =>
    crossroads({ busRoutes: [{ ref: '8', colour: '#016f45', legs: [0, 3], stops: [300, 384] }], ...extra } as Partial<GameMap>);
  const start = (traffic: Traffic) => {
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    return traffic.spawn(lane, 10, 'bus', { route: 0, leg: 0 });
  };

  it('stops at its stop a while, then carries on along its route', () => {
    const traffic = quiet(route());
    const bus = start(traffic);
    expect(bus.bus!.stops.length).toBe(1);
    run(traffic, 7);
    expect(bus.speed).toBeLessThan(1);
    expect(bus.bus!.dwell).toBeGreaterThan(0);
    // Its front just past the stop.
    expect(bus.x + bus.length / 2).toBeGreaterThan(300);
    expect(bus.x + bus.length / 2).toBeLessThan(345);
    let north = Infinity;
    for (let t = 0; t < 25; t += 0.5) {
      run(traffic, 0.5);
      north = Math.min(north, bus.y);
    }
    expect(bus.bus!.served.has(0)).toBe(true);
    // And it's turned up the side street (north: y going down), as its route does.
    expect(north).toBeLessThan(330);
    expect(bus.bus!.leg).toBe(1);
  });

  it('drives in the bus lane, out of the way of the cars', () => {
    const main = road('primary', 80, [0, 400, 800, 400], { lanes: [{ side: 1, kind: 'bus', width: 24 }], laneSpans: [0, 800] });
    const traffic = quiet(crossroads({ roads: [main], busRoutes: [{ ref: '8', legs: [0], stops: [] }] } as Partial<GameMap>));
    const lane = traffic.lanes.find((l) => l.dir === 1 && l.index === 0)!;
    expect(lane.busLane).toBe(24);
    const bus = traffic.spawn(lane, 10, 'double', { route: 0, leg: 0 });
    run(traffic, 4);
    // Over to the left (north) by most of the bus lane's width.
    expect(bus.bus!.side).toBeGreaterThan(18);
    expect(bus.y).toBeLessThan(lane.pts[1] - 15);
  });
});
