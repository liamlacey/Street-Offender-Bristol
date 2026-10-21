import { describe, expect, it } from 'vitest';
import type { GameMap, Road, TrainRoute } from '../map/osm';
import { Trains, UNITS, unitFor } from './trains';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A line 3 km long, west to east, a bridge 750 m along it; a local service along it, stopping 1 km in. */
function line(extra: Partial<TrainRoute> = {}): GameMap {
  const rail = (pts: number[], more: Partial<Road> = {}): Road => ({ kind: 'rail', width: 3.8 * M, pts, ...more });
  const roads = [rail([0, 4000, 6000, 4000]), rail([6000, 4000, 7000, 4000], { bridge: true }), rail([7000, 4000, 24000, 4000])];
  return {
    attribution: '', pxPerMetre: M, width: 24000, height: 8000, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [], roads, lines: [], buildings: [], trees: [], props: [], crossings: [], signals: [], controllers: [],
    trainRoutes: [{ name: 'GWR: Bristol Temple Meads → Severn Beach', operator: 'Great Western Railway', legs: [0, 2, 4], stops: [8000, 4010], ...extra }],
  };
}

describe('trains', () => {
  it('are the unit each company runs on each service', () => {
    expect(unitFor({ name: 'CrossCountry: Plymouth → Edinburgh', operator: 'CrossCountry' })).toBe('voyager');
    expect(unitFor({ name: 'GWR: Bristol Temple Meads → London Paddington' })).toBe('iet');
    expect(unitFor({ name: 'GWR: Cardiff Central → Portsmouth Harbour' })).toBe('sprinter');
    expect(unitFor({ name: 'GWR: Bristol Temple Meads → Severn Beach' })).toBe('turbo');
  });

  it('run along the line, up onto its bridge, stop at the station (doors open a while), and go on', () => {
    const trains = new Trains(line(), { rand: seeded(3) });
    // (You off to one side, watching: the train sets off from the line's start, out of sight.)
    const view = { x0: 4500, y0: 3000, x1: 4600, y1: 3100 };
    let stopped = 0;
    let bridged = false;
    let at = -1;
    let first: (typeof trains.trains)[number] | null = null;
    let cars: { x: number; y: number }[] = [];
    for (let t = 0; t < 300; t += 1 / 30) {
      trains.update(1 / 30, view, []);
      first ??= trains.trains[0] ?? null;
      const tr = first;
      if (!tr || !trains.trains.includes(tr)) continue;
      if (tr.cars.some((c) => c.level === 1)) bridged = true;
      if (tr.dwell > 0) {
        stopped += 1 / 30;
        at = tr.s;
      }
      if (tr.s > 9000 && !cars.length) cars = tr.cars.map((c) => ({ x: c.x, y: c.y }));
    }
    expect(first).not.toBeNull();
    expect(stopped).toBeGreaterThan(15);
    // At the stop: its front within a couple of metres of it.
    expect(Math.abs(at - 8000)).toBeLessThan(2 * M);
    expect(bridged).toBe(true);
    // Its carriages one behind the other, along the track (gone on past the stop).
    expect(first!.cars).toHaveLength(UNITS.turbo.cars);
    expect(cars).toHaveLength(UNITS.turbo.cars);
    for (const c of cars) expect(Math.abs(c.y - 4000)).toBeLessThan(0.5);
    for (let i = 1; i < cars.length; i++) expect(cars[i - 1].x - cars[i].x).toBeCloseTo(UNITS.turbo.length + 0.8 * M, 0);
  });

  it('brake for something on the line (sounding the horn), and stop short of it; and for a train stopped ahead', () => {
    const trains = new Trains(line({ stops: [23000, 4000] }), { rand: seeded(5) });
    const view = { x0: 4500, y0: 3000, x1: 4600, y1: 3100 };
    const car = { x: 6000, y: 4000, r: 1.2 * M, level: 0 };
    let horned = false;
    for (let t = 0; t < 120; t += 1 / 30) {
      trains.update(1 / 30, view, [car]);
      if (trains.horns.length) horned = true;
    }
    const tr = trains.trains[0];
    expect(tr.speed).toBe(0);
    expect(tr.s).toBeLessThan(car.x - car.r);
    expect(tr.s).toBeGreaterThan(car.x - 20 * M);
    expect(horned).toBe(true);
  });

  it('wrecked, a carriage stops its train for good', () => {
    const trains = new Trains(line({ stops: [23000, 4000] }), { rand: seeded(7) });
    const view = { x0: 4500, y0: 3000, x1: 4600, y1: 3100 };
    for (let t = 0; t < 20; t += 1 / 30) trains.update(1 / 30, view, []);
    const tr = trains.trains[0];
    expect(tr.speed).toBeGreaterThan(5 * M);
    trains.knock(tr.cars[0], 1500);
    expect(tr.dead).toBe(false);
    trains.knock(tr.cars[0], 1500, 10, 5);
    expect(tr.dead).toBe(true);
    expect(tr.cars[0].hits.length).toBe(2);
    for (let t = 0; t < 30; t += 1 / 30) trains.update(1 / 30, view, []);
    expect(tr.speed).toBe(0);
  });
});
