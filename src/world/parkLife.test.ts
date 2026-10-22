import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { pointInRing } from '../map/osm';
import { type Mover, People } from './people';
import { parkLife } from './parkLife';
import { buildWorld } from './world';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const nowhere: Mover = { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 };

/** A park 150 m by 100 m, a path across it, a few trees by the path, a pond in one corner. */
function park(): GameMap {
  return {
    attribution: '', pxPerMetre: M, width: 2000, height: 1400, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [
      { kind: 'park', rings: [[200, 200, 1400, 200, 1400, 1000, 200, 1000]] },
      { kind: 'water', rings: [[1200, 800, 1400, 800, 1400, 1000, 1200, 1000]] },
    ],
    roads: [{ kind: 'footway', width: 2 * M, pts: [200, 600, 1400, 600] }],
    lines: [], buildings: [], props: [], crossings: [], signals: [], controllers: [],
    trees: [500, 560, 40, 80, 700, 640, 40, 80],
  };
}

describe('park life', () => {
  const map = park();
  const life = parkLife(map);

  it('has games on the open grass (off the path, out of the pond, from under the trees), an ice-cream cart by the path, and pigeons', () => {
    expect(life.games.length).toBeGreaterThanOrEqual(2);
    for (const g of life.games) {
      expect(pointInRing(g.x, g.y, map.areas[0].rings[0])).toBe(true);
      expect(pointInRing(g.x, g.y, map.areas[1].rings[0])).toBe(false);
      expect(Math.abs(g.y - 600)).toBeGreaterThan(7 * M);
      for (const h of life.games) if (h !== g) expect(Math.hypot(h.x - g.x, h.y - g.y)).toBeGreaterThan(14 * M);
    }
    expect(life.carts).toHaveLength(1);
    expect(Math.abs(life.carts[0].y - 600)).toBeCloseTo(2.6 * M, 0);
    expect(life.flocks).toHaveLength(1);
    // The cart's a loose thing (a food cart: ice cream).
    expect(buildWorld(map).loose.filter((l) => l.kind === 'foodcart' && l.variant === 2)).toHaveLength(1);
    // The same each time.
    expect(parkLife(park())).toEqual(life);
  });

  it('brings them to life: the ball passed about between the players; dogs on their leads; joggers', () => {
    const world = buildWorld(map);
    const people = new People(map, { rand: seeded(9), seats: world.loose });
    const view = { x0: 150, y0: 150, x1: 1450, y1: 1050 };
    people.populate(view, true);
    const holders = new Set<number>();
    let flying = false;
    let lead = 0;
    for (let t = 0; t < 30; t += 1 / 30) {
      people.update(1 / 30, view, nowhere, [], () => 'green', () => true);
      for (const g of people.games) {
        if (g.ball.holder) holders.add(g.ball.holder.id);
        if (g.ball.dur > 0) flying = true;
      }
      for (const p of people.people) if (p.dog) lead = Math.max(lead, Math.hypot(p.dog.x - p.x, p.dog.y - p.y));
    }
    expect(people.people.filter((p) => p.game).length).toBeGreaterThanOrEqual(4);
    expect(holders.size).toBeGreaterThanOrEqual(3);
    expect(flying).toBe(true);
    expect(lead).toBeLessThanOrEqual(2.2 * M + 0.01);
    // Along the path through the park: some with dogs (a few in ten), some out for a run (faster).
    const make = people as unknown as { walker(k: number, seg: number, t: number): (typeof people.people)[number] };
    const along = Array.from({ length: 60 }, () => make.walker(0, 0, 0.5));
    const dogs = along.filter((p) => p.dog).length;
    const runners = along.filter((p) => p.jog);
    expect(dogs).toBeGreaterThan(8);
    expect(dogs).toBeLessThan(30);
    expect(runners.length).toBeGreaterThan(5);
    expect(Math.min(...runners.map((p) => p.pace))).toBeGreaterThan(Math.max(...along.filter((p) => !p.jog).map((p) => p.pace)));
  });
});
