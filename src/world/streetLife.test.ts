import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { pointInRing } from '../map/osm';
import { central } from '../test/central';
import { type Mover, People } from './people';
import { parkingSpaces } from './parking';
import { BUSY_STREET, footprints, onFootprints, pedestrianBusy, streetLife } from './streetLife';
import { buildWorld } from './world';

/** (The middle of Bristol, round where you start: see src/test/central.ts.) */
const map: GameMap = central();
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const M = 8;
const nowhere: Mover = { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 };

describe('street life', () => {
  const life = streetLife(map);

  it('finds Broadmead and the busy pedestrian streets, not the quiet lanes', () => {
    const broadmead = map.roads.filter((r) => r.kind === 'pedestrian' && r.name === 'Broadmead');
    expect(broadmead.length).toBeGreaterThan(0);
    expect(Math.max(...broadmead.map((r) => pedestrianBusy(map, r.pts)))).toBeGreaterThan(BUSY_STREET);
  });

  it('puts performers, food carts and pigeons on them, on open ground, apart, the same each time', () => {
    expect(life.pitches.length).toBeGreaterThan(5);
    expect(life.carts.length).toBeGreaterThan(5);
    expect(life.flocks.length).toBeGreaterThan(5);
    const all = [...life.pitches, ...life.carts, ...life.flocks];
    for (const o of all) {
      expect(map.buildings.some((b) => b.solid && !b.bottom && pointInRing(o.x, o.y, b.rings[0]))).toBe(false);
      for (const q of all) if (q !== o) expect(Math.hypot(q.x - o.x, q.y - o.y)).toBeGreaterThanOrEqual(12 * M);
    }
    // The carts are loose things (they're knocked about), where they stand.
    const world = buildWorld(map);
    expect(world.loose.filter((l) => l.kind === 'foodcart').length).toBe(life.carts.length);
  });

  it("puts the shops' A-boards out on the busy streets, in front of them, and the market stalls in rows in St Nicholas Market", () => {
    expect(life.boards.length).toBeGreaterThan(10);
    for (const b of life.boards) expect(map.buildings.some((o) => o.solid && !o.bottom && pointInRing(b.x, b.y, o.rings[0]))).toBe(false);
    const nicks = (map.markets ?? []).find((m) => m.name === 'Saint Nicholas Market');
    expect(nicks).toBeDefined();
    const inNicks = life.stalls.filter((s) => pointInRing(s.x, s.y, nicks!.ring));
    expect(inNicks.length).toBeGreaterThan(4);
    for (const s of life.stalls) for (const o of life.stalls) if (o !== s) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThanOrEqual(3 * M - 0.5);
    const world = buildWorld(map);
    expect(world.loose.filter((l) => l.kind === 'stall').length).toBe(life.stalls.length);
    expect(world.loose.filter((l) => l.kind === 'aboard').length).toBe(life.boards.length);
  });

  it("takes over the bays of a car park a market's held in (the Tobacco Factory's): no one parks under a stall", () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
    const park = rect(0, 0, 400, 300);
    const market: GameMap = {
      attribution: '', pxPerMetre: M, width: 1000, height: 1000, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
      areas: [{ kind: 'parking', rings: [park] }], roads: [], lines: [], buildings: [], trees: [], props: [], crossings: [], signals: [], controllers: [],
      markets: [{ name: 'Market', ring: rect(100, 50, 292, 242) }],
    };
    const stalls = streetLife(market).stalls;
    expect(stalls.length).toBeGreaterThan(10);
    const spaces = parkingSpaces(market);
    // Bays still about the rest of the car park, but none under the stalls.
    expect(spaces.length).toBeGreaterThan(20);
    const taken = footprints(streetLife(market));
    for (const b of spaces) expect(onFootprints(taken, b.x, b.y, b.angle, b.length / 2, 1.25 * M)).toBe(false);
    for (const t of stalls) for (const b of spaces) expect(Math.hypot(b.x - t.x, b.y - t.y)).toBeGreaterThan(2 * M);
  });

  it('has charity fundraisers in twos, and Big Issue sellers, catching passers-by one at a time', () => {
    const world = buildWorld(map);
    const people = new People(map, { rand: seeded(5), seats: world.loose as never });
    for (const act of ['charity', 'bigissue'] as const) {
      // (A pitch that's taken: four in five are.)
      const pitch = life.pitches.find((p) => p.act === act && Math.abs(Math.round(p.x + p.y)) % 5 !== 0)!;
      expect(pitch).toBeDefined();
      const view = { x0: pitch.x + 100, y0: pitch.y - 140, x1: pitch.x + 700, y1: pitch.y + 140 };
      people.populate({ x0: pitch.x + 900, y0: pitch.y + 900, x1: pitch.x + 1000, y1: pitch.y + 1000 }, true);
      people.populate(view, true);
      for (let t = 0; t < 60; t += 1 / 30) people.update(1 / 30, view, nowhere, [], () => 'red', () => true);
      const workers = people.people.filter((p) => p.mode === 'perform' && p.act === act && Math.hypot(p.x - pitch.x, p.y - pitch.y) < 4 * M);
      expect(workers.length).toBe(act === 'charity' ? 2 : 1);
      expect(people.people.filter((p) => p.gather === workers[0].gather && p.mode !== 'perform').length).toBeLessThanOrEqual(1);
    }
  });

  it('has a performer with a crowd watching, a vendor at each cart with a queue, and people joining them; pigeons that fly off from a car', () => {
    const world = buildWorld(map);
    const people = new People(map, { rand: seeded(11), seats: world.loose as never });
    const pitch = life.pitches.find((p) => p.act !== 'charity' && p.act !== 'bigissue' && Math.abs(Math.round(p.x + p.y)) % 5 !== 0)!;
    const cart = life.carts[0];
    const flock = life.flocks[0];
    const around = (x: number, y: number) => ({ x0: x - 300, y0: y - 140, x1: x + 300, y1: y + 140 });
    // Somewhere else first (out of sight of them all), then each comes into view.
    const visit = (x: number, y: number) => {
      people.populate({ x0: x + 900, y0: y + 900, x1: x + 1000, y1: y + 1000 }, true);
      people.populate(around(x + 400, y), true);
      for (let t = 0; t < 30; t += 1 / 30) people.update(1 / 30, around(x + 400, y), nowhere, [], () => 'red', () => true);
    };
    visit(pitch.x, pitch.y);
    const performer = people.people.find((p) => p.mode === 'perform' && Math.hypot(p.x - pitch.x, p.y - pitch.y) < 1);
    expect(performer).toBeDefined();
    const crowd = people.people.filter((p) => p.gather === performer!.gather && p !== performer);
    expect(crowd.length).toBeGreaterThanOrEqual(2);
    for (const p of crowd.filter((q) => q.mode === 'stand')) expect(Math.hypot(p.x - performer!.x, p.y - performer!.y)).toBeLessThan(4.5 * M);
    visit(cart.x, cart.y);
    expect(people.people.some((p) => p.mode === 'vend' && Math.hypot(p.x - cart.x, p.y - cart.y) < 2 * M)).toBe(true);

    // The pigeons: pecking about, till a car comes through fast.
    people.populate({ x0: flock.x + 900, y0: flock.y + 900, x1: flock.x + 1000, y1: flock.y + 1000 }, true);
    for (let t = 0; t < 1; t += 1 / 30) people.update(1 / 30, around(flock.x + 400, flock.y), nowhere, [], () => 'red', () => true);
    const f = people.flocks.find((o) => o.x === flock.x && o.y === flock.y)!;
    expect(f.birds.length).toBeGreaterThanOrEqual(5);
    expect(f.birds.every((b) => !b.flying && Math.hypot(b.x - f.x, b.y - f.y) < 4 * M)).toBe(true);
    const car: Mover = { ...nowhere, x: f.x - 5 * M, y: f.y, vx: 10 * M };
    people.update(1 / 30, around(f.x, f.y), car, [], () => 'red', () => true);
    expect(f.birds.length).toBeGreaterThan(0);
    expect(f.birds.every((b) => b.flying)).toBe(true);
    for (let t = 0; t < 4; t += 1 / 30) people.update(1 / 30, around(f.x, f.y), nowhere, [], () => 'red', () => true);
    expect(f.birds.length).toBe(0);
  });
});
