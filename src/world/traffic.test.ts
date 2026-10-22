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
  it("keep clear of the cars parked along one side of a street, both ways keeping to what's left between", () => {
    // A street 7 m wide running east, cars parked along its left (north) kerb, 2 m deep.
    const map = { ...crossroads(), roads: [road('street', 56, [0, 400, 800, 400], { lanes: [{ side: 1, kind: 'parking', width: 16, bays: 'parallel', unmarked: true }], laneSpans: [0, 800] })] } as unknown as GameMap;
    const { lanes } = buildLanes(map);
    const across = (dir: 1 | -1) => lanes.find((l) => l.dir === dir)!.pts[1] - 400;
    // (y down: the left kerb's at 400 - 28 = 372, the parked cars' bays to 388, the cars themselves (1.8 m wide) to 386; the right kerb's at 428.)
    for (const dir of [1, -1] as const) {
      const y = across(dir) + 400;
      expect(y - 9).toBeGreaterThan(386);
      expect(y + 9).toBeLessThan(428);
    }
    expect(across(1)).toBeLessThan(across(-1));
  });

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
    expect(bus.side).toBeGreaterThan(18);
    expect(bus.y).toBeLessThan(lane.pts[1] - 15);
  });
});

describe('changing lanes and overtaking', () => {
  it('moves over into the kerb lane in good time to turn left', () => {
    // A two-lane one-way road east, turning left (north) at its end into a street: the only way on.
    const map = crossroads({
      width: 1600,
      roads: [road('primary', 64, [0, 800, 1200, 800], { oneway: true, lanesAcross: [2, 0] }), road('street', 48, [1200, 800, 1200, 0])],
    } as Partial<GameMap>);
    const traffic = quiet(map);
    const outer = traffic.lanes.find((l) => l.road === 0 && l.index === 1)!;
    const v = traffic.spawn(outer, 20, 'hatch');
    let kerb = false;
    for (let t = 0; t < 12 && !kerb; t += 0.25) {
      run(traffic, 0.25, { ...away, x: v.x, y: 1500 });
      kerb = v.route[0].lane?.index === 0 && v.x < 1150;
    }
    expect(kerb).toBe(true);
  });

  it('pulls out past a broken-down car on a two-way street when nothing is coming, and back in', () => {
    const map = crossroads({ width: 2000, roads: [road('street', 56, [0, 400, 2000, 400])] } as Partial<GameMap>);
    const traffic = quiet(map);
    const east = traffic.lanes.find((l) => l.dir === 1)!;
    const broken = traffic.spawn(east, 600, 'hatch');
    broken.broken = true;
    broken.mode = 'parked';
    broken.speed = 0;
    const v = traffic.spawn(east, 100, 'hatch');
    let closest = Infinity;
    for (let t = 0; t < 20; t += 1 / 60) {
      traffic.update(1 / 60, { ...away, x: v.x, y: 900 }, { x0: v.x - 400, y0: 0, x1: v.x + 400, y1: 800 }, green);
      closest = Math.min(closest, Math.hypot(v.x - broken.x, v.y - broken.y));
    }
    expect(v.x).toBeGreaterThan(broken.x + 100);
    expect(closest).toBeGreaterThan(broken.r + v.r);
    expect(Math.abs(v.side)).toBeLessThan(2);
    expect(traffic.stats.overtakes).toBe(1);
  });
});

describe('damage', () => {
  it('limps along when badly damaged, and breaks down when wrecked', () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    const v = traffic.spawn(lane, 10, 'hatch');
    v.wreck = { taken: { front: 90, rear: 0, left: 0, right: 0 }, marks: [], lost: [], version: 1, last: 0, lastForce: 0 };
    traffic.hurt(v);
    expect(v.limping && !v.broken).toBe(true);
    v.wreck.taken.front = 200;
    traffic.hurt(v);
    expect(v.broken).toBe(true);
    expect(v.mode).toBe('parked');
  });
});

describe('cyclists', () => {
  it('ride along the cycle lane where there is one, out of the way of the cars', () => {
    const main = road('primary', 80, [0, 400, 2000, 400], { lanes: [{ side: 1, kind: 'cycle', width: 12 }], laneSpans: [0, 2000] });
    const traffic = quiet(crossroads({ width: 2000, roads: [main] } as Partial<GameMap>));
    const lane = traffic.lanes.find((l) => l.dir === 1 && l.index === 0)!;
    expect(lane.cycleLane).toBe(true);
    const bike = traffic.spawn(lane, 10, 'bike');
    const car = traffic.spawn(lane, -60, 'hatch');
    car.speed = 12 * 8;
    run(traffic, 6, { ...away, x: bike.x, y: 900 });
    // In the middle of the cycle lane (34 px north of the road's line), at a cyclist's speed.
    expect(Math.abs(bike.y - (400 - 34))).toBeLessThan(2);
    expect(bike.speed).toBeGreaterThan(3.5 * 8);
    expect(bike.speed).toBeLessThan(7 * 8);
    // The car's gone on past it, without pulling out.
    expect(car.x).toBeGreaterThan(bike.x + 40);
    expect(traffic.stats.overtakes).toBe(0);
  });

  it('keep to the left, near the kerb, where there is no cycle lane, and are given room going past', () => {
    const map = crossroads({ width: 3000, roads: [road('street', 64, [0, 400, 3000, 400])] } as Partial<GameMap>);
    const traffic = quiet(map);
    const east = traffic.lanes.find((l) => l.dir === 1)!;
    const bike = traffic.spawn(east, 300, 'bike');
    const car = traffic.spawn(east, 60, 'hatch');
    let closest = Infinity;
    for (let t = 0; t < 25; t += 1 / 60) {
      traffic.update(1 / 60, { ...away, x: car.x, y: 900 }, { x0: car.x - 400, y0: 0, x1: car.x + 400, y1: 800 }, green);
      // Alongside: how far apart their sides are.
      if (Math.abs(car.x - bike.x) < (car.length + bike.length) / 2) closest = Math.min(closest, Math.abs(car.y - bike.y) - car.r - bike.r);
    }
    // 0.8 m in from the kerb (the road's 8 m wide: the kerb's 32 px north of its line).
    expect(Math.abs(bike.y - (400 - 32 + 6.4))).toBeLessThan(2);
    expect(car.x).toBeGreaterThan(bike.x + 40);
    expect(traffic.stats.overtakes).toBe(1);
    expect(closest).toBeGreaterThan(1.4 * 8);
  });

  it('stop at a red light in the box for bikes in front of the stop line', () => {
    const map = crossroads({
      signals: [{ x: 360, y: 360, angle: 0, stop: [320, 368, 320, 400], controller: 0, group: 0 }],
      controllers: [{ x: 400, y: 400, groups: 2, walk: false }],
      paint: [{ kind: 'asl', x: 356, y: 384, angle: 0, width: 32 }],
    } as Partial<GameMap>);
    const traffic = quiet(map);
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1 && l.pts[0] < 400)!;
    expect(lane.stops[0].box).toBeGreaterThan(30);
    const bike = traffic.spawn(lane, 10, 'bike');
    run(traffic, 15, away, () => 'red');
    expect(bike.speed).toBeLessThan(1);
    // Past the cars' stop line (x = 320), up to the box's front (x = 356).
    expect(bike.x + bike.length / 2).toBeGreaterThan(330);
    expect(bike.x + bike.length / 2).toBeLessThan(358);
  });

  it('ride the cycle paths (only bikes: the cars keep to the roads)', () => {
    const map = crossroads({ roads: [...crossroads().roads, road('cycleway', 19, [0, 200, 800, 200])] } as Partial<GameMap>);
    const traffic = quiet(map);
    const path = traffic.lanes.find((l) => l.path && l.dir === 1)!;
    expect(path).toBeDefined();
    // Not joined to the roads: no road leads onto it.
    expect(traffic.nodes.filter((n) => n.out.some((i) => !traffic.lanes[i].path)).some((n) => n.out.includes(path.id))).toBe(false);
    const v = traffic.spawn(path, 20);
    expect(v.kind).toBe('bike');
    run(traffic, 5, { ...away, x: 400, y: 200 });
    expect(v.x).toBeGreaterThan(130);
    expect(Math.abs(v.y - 200)).toBeLessThan(8);
  });

  it('come off a cycle path onto the road it meets (giving way), and the road leads onto the path', () => {
    // A path from the north, ending 2 m short of the main road's edge (x = 200).
    const map = crossroads({ roads: [...crossroads().roads, road('cycleway', 19, [200, 100, 200, 352])] } as Partial<GameMap>);
    const traffic = quiet(map);
    const south = traffic.lanes.find((l) => l.path && l.pts[1] < l.pts[l.pts.length - 1])!;
    expect(south.giveWay).toBe(true);
    // Its end is clear of the road (the carriageway's edge is at y = 368).
    expect(south.pts[south.pts.length - 1]).toBeLessThan(366);
    // From the road's lanes there, the path's one of the ways on.
    expect(traffic.lanes.some((l) => !l.path && traffic.nodes[l.to].out.some((i) => traffic.lanes[i].path))).toBe(true);
    const v = traffic.spawn(south, 20);
    let onRoad = false;
    for (let t = 0; t < 20 && !onRoad; t += 0.25) {
      run(traffic, 0.25, { ...away, x: v.x, y: 700 });
      onRoad = !!v.route[0].lane && !v.route[0].lane.path;
    }
    expect(onRoad).toBe(true);
    expect(v.kind).toBe('bike');
  });

  it('knocked hard enough, come off: off the road, for the scene to put down', () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1)!;
    const bike = traffic.spawn(lane, 10, 'bike');
    traffic.knock(bike, 0.5);
    expect(traffic.vehicles).toContain(bike);
    traffic.knock(bike, 3);
    expect(traffic.vehicles).not.toContain(bike);
    expect(traffic.unseated.map((u) => u.bike)).toEqual([bike]);
  });
});

describe('taken and left', () => {
  it('takes a vehicle out of the traffic (or off its bay), and leaves one where you got out, in the way', () => {
    const traffic = quiet(crossroads());
    const lane = traffic.lanes.find((l) => l.road === 0 && l.dir === 1)!;
    const v = traffic.spawn(lane, 100, 'van');
    traffic.take(v);
    expect(traffic.vehicles).not.toContain(v);
    const left = traffic.leave('own', 200, 384, 0, 0, { colour: 0 });
    expect(traffic.parked).toContain(left);
    expect(left.mode).toBe('parked');
    // A car coming along the lane goes round it (as anything stuck in the road), without touching it.
    const car = traffic.spawn(lane, 10, 'hatch');
    let closest = Infinity;
    for (let t = 0; t < 10; t += 1 / 60) {
      traffic.update(1 / 60, away, view, green);
      closest = Math.min(closest, Math.hypot(car.x - left.x, car.y - left.y));
    }
    expect(car.x).toBeGreaterThan(260);
    expect(closest).toBeGreaterThan(car.r + left.r);
    expect(traffic.stats.overtakes).toBe(1);
  });
});
