import { describe, expect, it } from 'vitest';
import type { Building, GameMap, Place } from '../map/osm';
import { pointInRing } from '../map/osm';
import { type Mover, People } from './people';
import { placesWork } from './places';
import { buildWorld } from './world';
import { drain } from './work.ts';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A primary school's grounds, 70 m by 50 m, a street along their south side; the school building in the north-west corner. */
function schoolMap(): GameMap {
  const ring = [200, 200, 760, 200, 760, 600, 200, 600];
  const building: Building = { id: 1, rings: [[220, 220, 420, 220, 420, 360, 220, 360]], top: 8 * M, bottom: 0, kind: 'school', solid: true, drawn: true };
  const place: Place = { kind: 'school', name: 'Hillside Primary School', x: 480, y: 400, rings: [ring] };
  return {
    attribution: '', pxPerMetre: M, width: 1200, height: 1000, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [], roads: [{ kind: 'street', width: 7 * M, pts: [0, 660, 1200, 660], pavement: 'both' }],
    lines: [], buildings: [building], props: [], crossings: [], signals: [], controllers: [], trees: [], places: [place],
  } as unknown as GameMap;
}

describe('schools', () => {
  const map = schoolMap();
  const life = drain(placesWork(map));
  const ring = map.places![0].rings[0];

  it('surface the playground, mark out a netball court and hopscotch on it, and put up its climbing frame, slide and benches', () => {
    expect(life.areas.some((a) => a.kind === 'schoolyard')).toBe(true);
    const courts = life.areas.filter((a) => a.kind === 'court');
    expect(courts.length).toBeGreaterThanOrEqual(2);
    expect(courts.some((c) => c.markings![0].segs.length > 40 && !c.bare)).toBe(true);
    expect(courts.some((c) => c.bare)).toBe(true);
    const kinds = life.things.map((t) => t.kind);
    for (const k of ['climbframe', 'springy', 'picnic']) expect(kinds).toContain(k);
    for (const t of life.things) {
      expect(pointInRing(t.x, t.y, ring)).toBe(true);
      expect(pointInRing(t.x, t.y, map.buildings[0].rings[0])).toBe(false);
    }
  });

  it('fence its grounds in green mesh, the gate on the side by the road, and none across the building', () => {
    const fence = life.lines.filter((l) => l.kind === 'mesh');
    expect(fence.length).toBeGreaterThanOrEqual(1);
    const length = fence.reduce((n, l) => n + l.pts.reduce((m, _, i, p) => (i >= 2 && i % 2 === 0 ? m + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]) : m), 0), 0);
    // Round 240 m of edge, less the building's 42 m along it and the 5 m gate.
    expect(length / M).toBeGreaterThan(180);
    expect(length / M).toBeLessThan(240);
    const ends = fence.flatMap((l) => [[l.pts[0], l.pts[1]], [l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]]);
    expect(ends.some(([, y]) => y === 600)).toBe(true);
    // Knocked down a panel at a time, like a building site's.
    expect(buildWorld(schoolMap()).walls[0].filter((w) => w.kind === 'mesh').length).toBeGreaterThan(50);
  });

  it('has its children in the playground, parents at the gate and a lollipop lady by the road; the children never hit', () => {
    const children = life.spots.filter((s) => s.child);
    expect(children.length).toBeGreaterThan(4);
    for (const s of children) expect(pointInRing(s.x, s.y, ring)).toBe(true);
    expect(life.spots.some((s) => s.lollipop)).toBe(true);
    const people = new People(map, { rand: seeded(3) });
    people.populate({ x0: 0, y0: 0, x1: 1200, y1: 1000 }, true);
    const kids = people.people.filter((p) => p.child);
    expect(kids.length).toBeGreaterThan(4);
    // Driven straight at, fast, again and again: never down.
    const kid = kids[0];
    for (let k = 0; k < 20; k++) {
      const car: Mover = { x: kid.x - 30, y: kid.y, angle: 0, length: 38, width: 18, vx: 160, vy: 0, id: -1 };
      for (let t = 0; t < 0.6; t += 1 / 30) {
        car.x += car.vx / 30;
        people.update(1 / 30, { x0: 0, y0: 0, x1: 1200, y1: 1000 }, car, [], () => 'green', () => true);
      }
    }
    expect(people.people.filter((p) => p.child).every((p) => p.mode !== 'down')).toBe(true);
    expect(people.hits.filter((h) => h.person.child)).toHaveLength(0);
  });
});

/**
 * A street along y = 400 with, north of it: a pub (its building, open ground behind), a churchyard 60 m by 40 m, a block of flats
 * and a row of lock-up garages; south of it an industrial estate, its shed 40 m by 25 m facing the street.
 */
function townMap(): GameMap {
  const box = (id: number, x: number, y: number, w: number, d: number, kind: string): Building => ({ id, rings: [[x, y, x + w, y, x + w, y + d, x, y + d]], top: 8 * M, bottom: 0, kind, solid: true, drawn: true });
  const buildings = [
    box(1, 100, 300, 12 * M, 8 * M, 'pub'),
    box(2, 900, 180, 25 * M, 12 * M, 'apartments'),
    box(3, 1300, 330, 18 * M, 5.5 * M, 'garages'),
    box(4, 400, 580, 40 * M, 25 * M, 'industrial'),
  ];
  const yard: Place = { kind: 'graveyard', x: 640, y: 160, rings: [[400, 0, 880, 0, 880, 320, 400, 320]] };
  const pub: Place = { kind: 'pub', name: 'The Plough', x: 148, y: 332, rings: [[146, 330, 150, 330, 150, 334, 146, 334]] };
  const estate: Place = { kind: 'industrial', x: 600, y: 700, rings: [[300, 440, 1000, 440, 1000, 960, 300, 960]] };
  return {
    attribution: '', pxPerMetre: M, width: 1600, height: 1000, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [], roads: [{ kind: 'street', width: 7 * M, pts: [0, 400, 1600, 400], pavement: 'both' }],
    lines: [], buildings, props: [], crossings: [], signals: [], controllers: [], trees: [], places: [yard, pub, estate],
  } as unknown as GameMap;
}

describe('pubs, graveyards, flats, garages and industrial estates', () => {
  const map = townMap();
  const life = drain(placesWork(map));
  const kinds = (k: string) => life.things.filter((t) => t.kind === k);

  it("gives a pub a beer garden (tables under parasols, behind it, off the road) and kegs by its door", () => {
    const tables = kinds('picnic').filter((t) => t.x < 400);
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const t of tables) expect(t.y).toBeLessThan(400 - 28);
    expect(kinds('keg').length).toBeGreaterThanOrEqual(1);
  });

  it('fills a churchyard with headstones in rows, clear of the church', () => {
    const stones = [...kinds('headstone'), ...kinds('tomb')];
    expect(stones.length).toBeGreaterThan(100);
    for (const s of stones) expect(s.x > 400 && s.x < 880 && s.y > 0 && s.y < 320).toBe(true);
  });

  it('puts a lawn round the flats and big bins by them; tarmac and a car or junk in front of the garages', () => {
    expect(life.areas.some((a) => a.kind === 'gardens')).toBe(true);
    expect(kinds('bigbin').length).toBeGreaterThanOrEqual(2);
    expect(life.areas.some((a) => a.kind === 'drive')).toBe(true);
  });

  it('concretes the industrial estate, a lorry at the shed\'s loading door, a forklift, pallets, workers in hi-vis', () => {
    expect(life.areas.some((a) => a.kind === 'works')).toBe(true);
    expect(life.spaces.some((s) => s.kind === 'lorry')).toBe(true);
    expect(life.things.length).toBeGreaterThan(5);
    expect(life.spots.some((s) => s.hivis)).toBe(true);
    // The same each time.
    expect(drain(placesWork(townMap()))).toEqual(life);
  });
});
