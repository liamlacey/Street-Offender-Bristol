import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import bristol from '../map/bristol.json';
import { type Mover, People } from './people';
import { Traffic, type Vehicle } from './traffic';

const map = bristol as unknown as GameMap;

describe('Bristol Bus Station', () => {
  it('has its 19 bays, each a stop at the end of its own way in, by its platform', () => {
    const st = map.busStations!.find((s) => s.name === 'Bristol Bus Station')!;
    expect(st.bays).toHaveLength(19);
    for (const b of st.bays) expect(Math.hypot(b.platform[0] - b.x, b.platform[1] - b.y)).toBeLessThan(8 * 8);
    // Its yard's ways are for buses only; and its yard's paved for them, not a square for people.
    for (const b of st.bays) expect(map.roads[b.road].bus).toBe(true);
    const yard = map.areas.filter((a) => a.kind === 'yard');
    expect(yard.length).toBeGreaterThan(0);
  });

  it('has buses in and out of its bays: in from Marlborough Street, nose into a free bay, a while there, backing out, and away to the south-west', () => {
    let seed = 11;
    const traffic = new Traffic(map, { rand: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const st = traffic.stations[0];
    expect(st.bays).toHaveLength(19);
    // Standing on the far side of the yard (out of the way), looking at it.
    const player = { x: st.x - 60 * 8, y: st.y - 60 * 8, heading: 0, vx: 0, vy: 0, level: 0, length: 38, width: 18 };
    const view = { x0: st.x - 300, y0: st.y - 140, x1: st.x + 300, y1: st.y + 140 };
    const seen = new Map<number, { inBay: boolean; backed: boolean; out: boolean; entered: boolean }>();
    const yardCars = new Set<number>();
    let most = 0;
    const step = 1 / 30;
    for (let t = 0; t < 180; t += step) {
      traffic.update(step, player, view, () => 'green');
      let inBays = 0;
      for (const v of traffic.vehicles) {
        const lane = v.route[0]?.lane;
        const inYard = lane !== undefined && st.yard.has(lane.id);
        if (!v.bus) {
          if (inYard && v.mode === 'drive') yardCars.add(v.id);
          continue;
        }
        if (v.bus.station === undefined && !v.bus.done) continue;
        const k = seen.get(v.id) ?? { inBay: false, backed: false, out: false, entered: false };
        if (v.bus.bay && v.bus.dwell > 0) k.inBay = true;
        if (v.mode === 'reverse') k.backed = true;
        if (inYard && !k.inBay) k.entered = true;
        if (v.bus.done && !inYard && v.mode === 'drive') k.out = true;
        seen.set(v.id, k);
        if (v.bus.bay && v.bus.dwell > 0) inBays++;
      }
      most = Math.max(most, inBays);
      // A bay's never taken by two.
      const taken = st.bays.map((b) => b.taken).filter((id) => id !== null);
      expect(new Set(taken).size).toBe(taken.length);
    }
    const all = [...seen.values()];
    // Busy: lots in their bays at once; some come in from outside, some back out and leave.
    expect(most).toBeGreaterThanOrEqual(8);
    expect(all.filter((k) => k.entered && k.inBay).length).toBeGreaterThan(3);
    expect(all.filter((k) => k.backed && k.out).length).toBeGreaterThan(3);
    // No cars in the yard.
    expect(yardCars.size).toBe(0);
    // Every bus that's backed out faced on round the yard after (towards the way out, the south-west: x falling, y rising).
    const out = traffic.vehicles.filter((v: Vehicle) => v.bus?.done && v.mode === 'drive' && v.route[0].lane && st.yard.has(v.route[0].lane.id));
    for (const v of out) expect(Math.cos(v.angle) < 0.3 || Math.sin(v.angle) > -0.3).toBe(true);
  }, 120_000);

  it("has no one walking about in its yard: they get off at the bays, onto the platforms, and on from them", () => {
    const st = map.busStations![0];
    const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const people = new People(map, { rand: seeded(7) });
    const [cx, cy] = [st.bays.reduce((t, b) => t + b.x, 0) / st.bays.length, st.bays.reduce((t, b) => t + b.y, 0) / st.bays.length];
    const view = { x0: cx - 400, y0: cy - 400, x1: cx + 400, y1: cy + 400 };
    // No walks through it, nowhere to stand about in it, no bus stops by it.
    for (const w of people.walks) for (let k = 0; k + 1 < w.pts.length; k += 2) if (w.level === 0) expect(people.inYard(w.pts[k], w.pts[k + 1])).toBe(false);
    for (const s of people.spots) expect(people.inYard(s.x, s.y)).toBe(false);
    for (const [x, y] of people.stops) for (const b of st.bays) expect(Math.hypot(x - b.platform[0], y - b.platform[1])).toBeGreaterThan(20 * 8);
    people.populate(view, true);
    const before = people.people.length;
    expect(people.people.filter((p) => people.inYard(p.x, p.y))).toHaveLength(0);
    // A bus pulls in to a bay: some get off, to the platform; over the next while, others come and get on.
    const b = st.bays[5];
    const angle = Math.atan2(b.y - b.platform[1], b.x - b.platform[0]) + Math.PI;
    const bus: Mover = { x: b.x - Math.cos(angle) * 48, y: b.y - Math.sin(angle) * 48, angle, length: 96, width: 20, vx: 0, vy: 0, id: 1, dwelling: true, bay: b.platform, fresh: true };
    const still: Mover = { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 };
    people.update(1 / 30, view, still, [bus], () => 'red', () => true);
    const off = people.people.slice(before).filter((p) => p.mode === 'board');
    expect(off.length).toBeGreaterThan(0);
    const on = new Set<number>();
    for (let t = 0; t < 40; t += 1 / 30) {
      people.update(1 / 30, view, still, [{ ...bus, fresh: false }], () => 'red', () => true);
      for (const p of people.people) if (p.mode === 'board' && !off.includes(p)) on.add(p.id);
    }
    // Off, and into the station (gone, by the platform); and others on.
    expect(off.every((p) => p.gone || Math.hypot(p.x - b.platform[0], p.y - b.platform[1]) < 5 * 8)).toBe(true);
    expect(on.size).toBeGreaterThan(1);
  });
});
