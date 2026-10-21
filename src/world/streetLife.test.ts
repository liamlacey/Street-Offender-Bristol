import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { pointInRing } from '../map/osm';
import { central } from '../test/central';
import { type Mover, People } from './people';
import { BUSY_STREET, pedestrianBusy, streetLife } from './streetLife';
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

  it('has a performer with a crowd watching, a vendor at each cart with a queue, and people joining them; pigeons that fly off from a car', () => {
    const world = buildWorld(map);
    const people = new People(map, { rand: seeded(11), seats: world.loose as never });
    const pitch = life.pitches[0];
    const cart = life.carts[0];
    const flock = life.flocks[0];
    const around = (x: number, y: number) => ({ x0: x - 300, y0: y - 140, x1: x + 300, y1: y + 140 });
    // Somewhere else first (out of sight of them all), then each comes into view.
    for (const [x, y] of [[pitch.x, pitch.y], [cart.x, cart.y]]) {
      people.populate({ x0: x + 900, y0: y + 900, x1: x + 1000, y1: y + 1000 }, true);
      people.populate(around(x + 400, y), true);
      for (let t = 0; t < 30; t += 1 / 30) people.update(1 / 30, around(x + 400, y), nowhere, [], () => 'red', () => true);
    }
    const performer = people.people.find((p) => p.mode === 'perform');
    expect(performer).toBeDefined();
    const crowd = people.people.filter((p) => p.gather === performer!.gather && p !== performer);
    expect(crowd.length).toBeGreaterThanOrEqual(2);
    for (const p of crowd.filter((q) => q.mode === 'stand')) expect(Math.hypot(p.x - performer!.x, p.y - performer!.y)).toBeLessThan(4.5 * M);
    expect(people.people.some((p) => p.mode === 'vend')).toBe(true);

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
