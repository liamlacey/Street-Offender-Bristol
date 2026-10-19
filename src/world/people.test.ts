import { describe, expect, it } from 'vitest';
import mapData from '../map/bristol.json';
import type { GameMap } from '../map/osm';
import { type Mover, People } from './people';

const map = mapData as unknown as GameMap;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const still = (x: number, y: number): Mover => ({ x, y, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 });
const viewAt = (x: number, y: number) => ({ x0: x - 300, y0: y - 140, x1: x + 300, y1: y + 140 });
/** Park Street, about halfway up: shops, pavements, a crossing. */
const parkStreet = (() => {
  const r = map.roads.filter((r) => r.name === 'Park Street')[2];
  const i = Math.floor(r.pts.length / 4) * 2;
  return [r.pts[i], r.pts[i + 1]] as const;
})();

describe('people', () => {
  it('fill the busy streets more than the quiet ones', () => {
    const count = (x: number, y: number) => {
      const p = new People(map, { rand: seeded(3) });
      p.populate(viewAt(x, y), true);
      return p.people.length;
    };
    expect(count(...parkStreet)).toBeGreaterThan(60);
    // A quiet corner of the map, by its edge.
    expect(count(150, 7400)).toBeLessThan(count(...parkStreet) / 2);
  });

  it('keep off the roads, but to cross at a crossing (or running), and do it in good time', () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: seeded(5) });
    const view = viewAt(x, y);
    people.populate(view, true);
    let crossed = 0;
    const t0 = performance.now();
    let frames = 0;
    for (let t = 0; t < 90; t += 1 / 30, frames++) {
      people.update(1 / 30, view, still(-1e6, -1e6), [], () => 'red', () => true);
      for (const p of people.people) {
        if (p.mode === 'cross') crossed++;
        if (p.mode === 'walk' || p.mode === 'stand' || p.mode === 'queue') expect(people.inRoad(p.x, p.y, -1.2 * 8)).toBe(false);
      }
    }
    expect(crossed).toBeGreaterThan(0);
    // Cheap: well under a millisecond a frame, most of the time.
    expect((performance.now() - t0) / frames).toBeLessThan(2);
  });

  it('knocked down by a slow car get up again; by a fast one, stay down', () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: seeded(7) });
    people.populate(viewAt(x, y), true);
    const [a, b] = people.people;
    people.knock(a, { vx: 30, vy: 0 }, 30);
    people.knock(b, { vx: 160, vy: 0 }, 160);
    for (let t = 0; t < 8; t += 1 / 30) people.update(1 / 30, viewAt(x, y), still(-1e6, -1e6), [], () => 'red', () => true);
    expect(a.mode).not.toBe('down');
    expect(b.mode).toBe('down');
    expect(b.hurt).toBe(true);
  });

  it('jump out of the way of a car coming straight at them', () => {
    const [x, y] = parkStreet;
    let dived = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const people = new People(map, { rand: seeded(seed) });
      const view = viewAt(x, y);
      people.populate(view, true);
      const p = people.people.find((q) => q.mode === 'walk')!;
      // A car 15 m off, coming at them at 30 mph.
      const car: Mover = { x: p.x - 120, y: p.y, angle: 0, length: 38, width: 18, vx: 107, vy: 0, id: -1 };
      for (let t = 0; t < 1.2; t += 1 / 30) {
        car.x += car.vx / 30;
        people.update(1 / 30, view, car, [], () => 'red', () => true);
      }
      if (!p.hurt) dived++;
    }
    expect(dived).toBeGreaterThan(10);
  });

  it('get on a bus waiting at their stop', () => {
    const people = new People(map, { rand: seeded(9) });
    const [sx, sy] = people.stops[0];
    // The stop just out of sight, to the left of the view.
    const view = { x0: sx + 60, y0: sy - 140, x1: sx + 660, y1: sy + 140 };
    for (let t = 0; t < 120 && !people.people.some((p) => p.stop === 0); t += 1 / 30) people.populate(view);
    const waiting = people.people.filter((p) => p.stop === 0);
    expect(waiting.length).toBeGreaterThan(0);
    const bus: Mover = { x: sx, y: sy, angle: 0, length: 96, width: 20, vx: 0, vy: 0, id: 99, dwelling: true };
    for (let t = 0; t < 10; t += 1 / 30) people.update(1 / 30, view, still(-1e6, -1e6), [bus], () => 'red', () => true);
    for (const p of waiting) expect(p.gone || !people.people.includes(p)).toBe(true);
  });
});
