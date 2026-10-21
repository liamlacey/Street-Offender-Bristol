import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { type Store, findStores } from '../map/stores';
import { type Block, People, type Trolley } from './people';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe('big shops with car parks', () => {
  // A shop 40 m by 30 m; its car park along its south side, 40 m deep.
  const shop = rect(100, 100, 420, 340);
  const park = rect(60, 345, 460, 665);

  it('finds a big shop next to a car park, its door facing it, and a trolley bay along its wall', () => {
    const [store] = findStores([{ kind: 'supermarket', name: 'Shop', ring: shop }], [park], () => true, M);
    expect(store).toBeDefined();
    const [dx, dy, out] = store.door;
    // In the middle of the south wall, just outside, facing south (y is down).
    expect(dx).toBeCloseTo(260, -1);
    expect(dy).toBeGreaterThan(340);
    expect(dy).toBeLessThan(352);
    expect(Math.sin(out)).toBeCloseTo(1);
    // The bay: along that wall, short of the door, out from it.
    const [bx, by, along, count] = store.bay;
    expect(by).toBeGreaterThan(340);
    expect(by).toBeLessThan(345 + 8);
    expect(Math.abs(Math.cos(along))).toBeCloseTo(1);
    expect(count).toBeGreaterThanOrEqual(4);
    for (let k = 0; k < count; k++) expect(Math.abs(bx + Math.cos(along) * k * 0.4 * M - dx)).toBeGreaterThan(2 * M);
  });

  it("leaves out small shops, those with no car park by them, and where there's no room for the trolleys", () => {
    expect(findStores([{ kind: 'supermarket', ring: rect(300, 280, 380, 340) }], [park], () => true, M)).toHaveLength(0);
    expect(findStores([{ kind: 'supermarket', ring: shop }], [rect(60, 600, 460, 900)], () => true, M)).toHaveLength(0);
    expect(findStores([{ kind: 'supermarket', ring: shop }], [park], () => false, M)).toHaveLength(0);
  });
});

describe('shoppers', () => {
  // A shop's door facing south at (400, 300), its bay running east along its wall towards the door, its car park south of it.
  const store: Store = { kind: 'supermarket', door: [400, 300, Math.PI / 2], bay: [320, 300, 0, 10], park: rect(200, 296, 700, 700) };
  const map: GameMap = {
    attribution: '', pxPerMetre: M, width: 2000, height: 2000, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [{ kind: 'parking', rings: [store.park] }], roads: [], lines: [], buildings: [], trees: [], props: [], crossings: [], signals: [], controllers: [], stores: [store],
  };
  const cars: Block[] = [380, 460, 540, 620].map((x) => ({ x, y: 460, angle: Math.PI / 2, length: 4.5 * M, r: 0.9 * M, level: 0 }));
  const bodyDist = (b: Block, x: number, y: number) => {
    const h = b.length / 2 - b.r;
    const [c, s] = [Math.cos(b.angle), Math.sin(b.angle)];
    const t = Math.max(-h, Math.min(h, (x - b.x) * c + (y - b.y) * s));
    return Math.hypot(x - b.x - c * t, y - b.y - s * t);
  };

  it('push trolleys from the bay into the shop, and out of it to their cars, and back to the bay', () => {
    const trolleys: Trolley[] = Array.from({ length: 7 }, (_, k) => ({ kind: 'trolley', x: 320 + k * 0.4 * M, y: 300, angle: Math.PI, vx: 0, vy: 0, level: 0, moved: false }));
    const people = new People(map, { rand: seeded(7), seats: trolleys as never });
    people.blocks = cars;
    const view = { x0: 380, y0: 280, x1: 420, y1: 320 };
    const seen = new Set<string>();
    let returned = 0;
    const was = new Map<number, string>();
    for (let t = 0; t < 600; t += 1 / 30) {
      people.update(1 / 30, view, { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 }, [], () => 'red', () => true);
      for (const p of people.people) {
        if (!p.trip) continue;
        seen.add(`${p.trip.leg}${p.trip.trolley ? '+' : ''}`);
        if (was.get(p.id) === 'return' && p.trip.leg === 'home') returned++;
        was.set(p.id, p.trip.leg);
        // A trolley being pushed is never pushed through a parked car.
        const tr = p.trip.trolley;
        if (tr) for (const c of cars) expect(bodyDist(c, tr.x, tr.y)).toBeGreaterThan(c.r);
      }
    }
    // Taking one from the bay into the shop; out with one, to a car, loading it; and back to the bay with it.
    for (const leg of ['in+', 'out+', 'load+', 'return+', 'home']) expect(seen).toContain(leg);
    expect(returned).toBeGreaterThan(0);
    // Those not in the shop are in the bay's row (or left by a car, now and then), all facing back along it.
    const inRow = trolleys.filter((t) => !t.inside && Math.abs(t.y - 300) < 1 && t.x >= 319 && t.x < 320 + 12 * 0.4 * M);
    expect(inRow.length).toBeGreaterThan(0);
    for (const t of inRow) expect(Math.cos(t.angle)).toBeCloseTo(-1);
  });
});
