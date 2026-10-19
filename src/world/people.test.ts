import { describe, expect, it } from 'vitest';
import mapData from '../map/bristol.json';
import type { GameMap } from '../map/osm';
import { Decks } from './decks';
import { type Mover, People } from './people';
import { buildWorld } from './world';

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
        if (p.mode === 'walk' || p.mode === 'stand' || p.mode === 'queue') expect(people.inRoad(p.x, p.y, -1.2 * 8, p.level)).toBe(false);
      }
    }
    expect(crossed).toBeGreaterThan(0);
    // Cheap: well under a millisecond a frame, most of the time.
    expect((performance.now() - t0) / frames).toBeLessThan(2);
  });

  it('walk over the bridges, up on the decks, out of the way of what goes under them', () => {
    // Park Street's bridge over Frogmore Street: its pavements.
    const decks = new Decks(map.roads, () => 0);
    const bridge = map.roads.find((r) => r.bridge && r.name === 'Park Street')!;
    const [x, y] = [(bridge.pts[0] + bridge.pts[2]) / 2, (bridge.pts[1] + bridge.pts[3]) / 2];
    const people = new People(map, { rand: seeded(3) });
    const view = viewAt(x, y);
    people.populate(view, true);
    // A car going along Frogmore Street, under the bridge, right through where they are.
    const under: Mover = { x, y, angle: 0, length: 38, width: 18, vx: 120, vy: 0, id: 7, level: 0 };
    let up = 0;
    for (let t = 0; t < 30; t += 1 / 30) {
      people.update(1 / 30, view, still(-1e6, -1e6), [under], () => 'red', (px, py, level) => level === 0 || !!decks.over(px, py), (level, px, py) => decks.stepAt(level, px, py, 0));
      for (const p of people.people) {
        if (p.level !== 1) continue;
        up++;
        expect(decks.over(p.x, p.y)).not.toBeNull();
        expect(p.mode).not.toBe('down');
        if (p.mode === 'walk') expect(people.inRoad(p.x, p.y, -1.2 * 8, 1)).toBe(false);
      }
    }
    expect(up).toBeGreaterThan(0);
  });

  it('knocked down by a slow car get up again; by a fast one, stay down', () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: seeded(7) });
    people.populate(viewAt(x, y), true);
    const [a, b] = people.people;
    const [bx, by] = [b.x, b.y];
    people.knock(a, { vx: 30, vy: 0 }, 30);
    people.knock(b, { vx: 160, vy: 0 }, 160);
    for (let t = 0; t < 8; t += 1 / 30) people.update(1 / 30, viewAt(x, y), still(-1e6, -1e6), [], () => 'red', () => true);
    expect(a.mode).not.toBe('down');
    expect(b.mode).toBe('down');
    expect(b.hurt).toBe(true);
    // Flat where they were hit.
    expect(Math.hypot(b.x - bx, b.y - by)).toBe(0);
  });

  it('lying in the road, are driven over (a bump for each axle), and barely moved', () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: seeded(11) });
    people.populate(viewAt(x, y), true);
    const p = people.people[0];
    people.knock(p, { vx: 1, vy: 0 }, 2 * 8);
    for (let t = 0; t < 1; t += 1 / 30) people.update(1 / 30, viewAt(x, y), still(-1e6, -1e6), [], () => 'red', () => true);
    people.hits.length = 0;
    const [px, py] = [p.x, p.y];
    // You, at 9 m/s, straight over them.
    const car: Mover = { x: px - 60, y: py, angle: 0, length: 38, width: 18, vx: 72, vy: 0, id: -1 };
    for (let t = 0; t < 1.6; t += 1 / 60) {
      car.x += car.vx / 60;
      people.update(1 / 60, viewAt(x, y), car, [], () => 'red', () => true);
    }
    const over = people.hits.filter((h) => h.how === 'over' && h.by === -1);
    expect(over).toHaveLength(2);
    expect(over.every((h) => h.loss > 0 && h.loss <= 0.1)).toBe(true);
    expect(people.hits.some((h) => h.how === 'hit')).toBe(false);
    expect(p.mode).toBe('down');
    expect(Math.hypot(p.x - px, p.y - py)).toBeLessThan(1 * 8);
  });

  it('hit, go down flat where they stand, and the car goes on over them', () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: () => 0.99 });
    people.populate(viewAt(x, y), true);
    const p = people.people[0];
    Object.assign(p, { mode: 'stand', timer: 99 });
    const [px, py] = [p.x, p.y];
    const car: Mover = { x: px - 60, y: py, angle: 0, length: 38, width: 18, vx: 120, vy: 0, id: -1 };
    for (let t = 0; t < 1.2; t += 1 / 60) {
      car.x += car.vx / 60;
      people.update(1 / 60, viewAt(x, y), car, [], () => 'red', () => true);
    }
    expect(people.hits.filter((h) => h.person === p).map((h) => h.how)).toEqual(['hit', 'over', 'over']);
    expect(p.mode).toBe('down');
    expect(Math.hypot(p.x - px, p.y - py)).toBeLessThan(1 * 8);
  });

  it("don't run from you on foot, running along the pavement past them", () => {
    const [x, y] = parkStreet;
    const people = new People(map, { rand: seeded(9) });
    people.populate(viewAt(x, y), true);
    const p = people.people.find((q) => q.mode === 'walk')!;
    const you: Mover = { x: p.x - 16, y: p.y, angle: 0, length: 4.8, width: 4.8, vx: 44, vy: 0, id: -1, bike: true, onFoot: true };
    for (let t = 0; t < 1; t += 1 / 30) people.update(1 / 30, viewAt(x, y), you, [], () => 'red', () => true);
    expect(people.people.filter((q) => q.mode === 'flee')).toHaveLength(0);
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

  it('step round each other, walking head on along the pavement', () => {
    const [x, y] = parkStreet;
    let closest = Infinity;
    for (let seed = 1; seed <= 8; seed++) {
      const people = new People(map, { rand: seeded(seed) });
      const view = viewAt(x, y);
      people.populate(view, true);
      // Two on the same walk, coming at each other, both down the middle of it.
      const a = people.people.find((p) => p.mode === 'walk' && p.line >= 0 && people.walks[p.line].pts.length >= 4)!;
      people.people.length = 0;
      people.people.push(a);
      const w = people.walks[a.line].pts;
      const b = { ...a, id: 999, x: w[w.length - 2], y: w[w.length - 1], dir: -a.dir as 1 | -1, side: 0, avoid: 0 };
      Object.assign(a, { x: w[0], y: w[1], dir: 1, next: 1, side: 0, avoid: 0, joining: false });
      Object.assign(b, { next: w.length / 2 - 2, joining: false });
      people.people.push(b);
      const len = Math.hypot(w[w.length - 2] - w[0], w[w.length - 1] - w[1]);
      if (len < 10 * 8 || w.length !== 4) continue;
      for (let t = 0; t < len / 8; t += 1 / 30) {
        people.update(1 / 30, { x0: -1e5, y0: -1e5, x1: -1e5 + 10, y1: -1e5 + 10 }, still(-1e6, -1e6), [], () => 'red', () => true);
        if (a.mode === 'walk' && b.mode === 'walk' && a.line === b.line) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(closest).toBeGreaterThan(0.5 * 8);
  });

  it('sit on the benches, and are knocked off one shoved hard from under them', () => {
    const world = buildWorld(map);
    const benches = world.loose.filter((b) => b.kind === 'bench');
    expect(benches.length).toBeGreaterThan(5);
    const people = new People(map, { rand: seeded(4), seats: world.loose });
    const bench = benches[0];
    const view = { x0: bench.x + 400, y0: bench.y - 140, x1: bench.x + 1000, y1: bench.y + 140 };
    (people as unknown as { sitDown(b: typeof bench): void }).sitDown(bench);
    const sitting = people.people.filter((p) => p.seat === bench);
    expect(sitting.length).toBeGreaterThan(0);
    expect(sitting.every((p) => p.mode === 'sit' && Math.hypot(p.x - bench.x, p.y - bench.y) < 1 * 8)).toBe(true);
    // A car shoves it hard.
    [bench.vx, bench.vy] = [80, 0];
    bench.x += 8;
    people.update(1 / 30, view, still(-1e6, -1e6), [], () => 'red', () => true);
    expect(sitting.every((p) => p.mode === 'down')).toBe(true);
  });

  it('have picnics on the grass in the parks', () => {
    let picnics = 0;
    for (let seed = 1; seed <= 5 && !picnics; seed++) {
      const people = new People(map, { rand: seeded(seed) });
      // The biggest park (Brandon Hill).
      const park = map.areas.filter((a) => a.kind === 'park').sort((a, b) => b.rings[0].length - a.rings[0].length)[0].rings[0];
      let [cx, cy] = [0, 0];
      for (let i = 0; i < park.length; i += 2) [cx, cy] = [cx + park[i], cy + park[i + 1]];
      people.populate(viewAt((cx * 2) / park.length, (cy * 2) / park.length), true);
      picnics += people.picnics.length;
      for (const c of people.picnics) expect(people.people.filter((p) => p.picnic === c && p.mode === 'sit').length).toBeGreaterThanOrEqual(2);
    }
    expect(picnics).toBeGreaterThan(0);
  });
});
