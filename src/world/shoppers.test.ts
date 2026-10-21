import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { type Store, findStores } from '../map/stores';
import { parkingSpaces, trolleyRows } from './parking';
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
  // Cars parked in the car park's bays (not its trolley shelters'), every third one; none in the 8 m along the shop's front (the way along it's clear).
  const cars: Block[] = parkingSpaces(map)
    .filter((s, i) => i % 3 === 0 && s.y > 300 + 8 * M)
    .map((s) => ({ x: s.x, y: s.y, angle: s.angle, length: 4.5 * M, r: 0.9 * M, level: 0 }));
  const bodyDist = (b: Block, x: number, y: number) => {
    const h = b.length / 2 - b.r;
    const [c, s] = [Math.cos(b.angle), Math.sin(b.angle)];
    const t = Math.max(-h, Math.min(h, (x - b.x) * c + (y - b.y) * s));
    return Math.hypot(x - b.x - c * t, y - b.y - s * t);
  };

  it('has trolley shelters in bays spread about the car park (no one parks in them): two rows of trolleys in each', () => {
    const [bay, ...shelters] = trolleyRows(map)[0];
    expect(bay).toEqual(store.bay);
    // 160 bays or so: one shelter for each 25, two rows each.
    expect(shelters.length).toBeGreaterThanOrEqual(8);
    expect(shelters.length % 2).toBe(0);
    // Spread out: each shelter well away from the next, and the door.
    for (let i = 0; i < shelters.length; i += 2) {
      expect(Math.hypot(shelters[i][0] - 400, shelters[i][1] - 300)).toBeGreaterThan(12 * M);
      for (let j = i + 2; j < shelters.length; j += 2) expect(Math.hypot(shelters[i][0] - shelters[j][0], shelters[i][1] - shelters[j][1])).toBeGreaterThan(8 * M);
    }
    for (const s of parkingSpaces(map)) for (const r of shelters) expect(Math.hypot(s.x - r[0], s.y - r[1])).toBeGreaterThan(1.5 * M);
  });

  it('push trolleys from the bay into the shop, and out of it to their cars, and back to the bay or the shelter nearest their car', () => {
    const trolleys: Trolley[] = Array.from({ length: 7 }, (_, k) => ({ kind: 'trolley', x: 320 + k * 0.4 * M, y: 300, angle: Math.PI, vx: 0, vy: 0, level: 0, moved: false }));
    for (const [x, y, a] of trolleyRows(map)[0].slice(1)) {
      for (let k = 0; k < 5; k++) trolleys.push({ kind: 'trolley', x: x + Math.cos(a) * k * 0.4 * M, y: y + Math.sin(a) * k * 0.4 * M, angle: a + Math.PI, vx: 0, vy: 0, level: 0, moved: false });
    }
    const people = new People(map, { rand: seeded(99), seats: trolleys as never });
    people.blocks = cars;
    const view = { x0: 380, y0: 280, x1: 420, y1: 320 };
    const seen = new Set<string>();
    let returned = 0;
    let toShelters = 0;
    const clipped: string[] = [];
    const was = new Map<number, string>();
    for (let t = 0; t < 600; t += 1 / 30) {
      people.update(1 / 30, view, { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 }, [], () => 'red', () => true);
      for (const p of people.people) {
        if (!p.trip) continue;
        seen.add(`${p.trip.leg}${p.trip.trolley ? '+' : ''}`);
        if (was.get(p.id) === 'return' && p.trip.leg === 'home') {
          returned++;
          if (p.trip.row > 0) toShelters++;
        }
        was.set(p.id, p.trip.leg);
        // A trolley being pushed is never pushed through a parked car.
        const tr = p.trip.trolley;
        if (tr) for (const c of cars) if (bodyDist(c, tr.x, tr.y) <= c.r) clipped.push([p.trip.leg, Math.round(p.x), Math.round(p.y), Math.round(tr.x), Math.round(tr.y), c.x, c.y, p.trip.route.map(Math.round).join(' ')].join(','));
      }
    }
    expect(clipped).toEqual([]);
    // Taking one into the shop; out with one, to a car, loading it; and back to a row with it (a shelter, mostly).
    for (const leg of ['in+', 'out+', 'load+', 'return+', 'home']) expect(seen).toContain(leg);
    expect(returned).toBeGreaterThan(10);
    expect(toShelters).toBeGreaterThan(returned / 2);
    // Those standing in the rows (the bay's, the shelters'), all facing back along them.
    let standing = 0;
    for (const [x, y, a, count] of trolleyRows(map)[0]) {
      for (const t of trolleys) {
        const along = (t.x - x) * Math.cos(a) + (t.y - y) * Math.sin(a);
        const across = -(t.x - x) * Math.sin(a) + (t.y - y) * Math.cos(a);
        if (t.inside || Math.abs(across) > 1 || along < -1 || along > (count + 3) * 0.4 * M) continue;
        standing++;
        expect(Math.cos(t.angle - a)).toBeCloseTo(-1);
      }
    }
    expect(standing).toBeGreaterThan(10);
  });
});
