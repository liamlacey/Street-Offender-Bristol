import { describe, expect, it } from 'vitest';
import { type GameMap, pointInRing } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { type Mover, People } from './people';
import { placesWork } from './places';
import { drain } from './work.ts';

const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const still = (x: number, y: number): Mover => ({ x, y, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 });
const whole = bristol as unknown as GameMap;

/** The region round a point (as the game makes it: see streamer.ts). */
function regionAt(x: number, y: number): GameMap {
  const { index, tiles } = splitMap(whole);
  const [cx, cy] = [Math.round(x / TILE) * TILE, Math.round(y / TILE) * TILE];
  const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
  return assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
}
const area = (r: number[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return Math.abs(a / 2);
};

describe('an army base', () => {
  // The Army Reserve's at Horfield.
  const base = whole.places!.find((p) => p.kind === 'military' && /Horfield/.test(p.name ?? ''))!;
  const map = regionAt(base.x, base.y);
  const life = drain(placesWork(map));
  const ring = base.rings[0];
  const inBase = (x: number, y: number) => pointInRing(x, y, ring);

  it('has its flag, its sentry box, sandbags; its tanks, armoured personnel carriers and Land Rovers parked in rows', () => {
    const things = life.things.filter((t) => inBase(t.x, t.y)).map((t) => t.kind);
    expect(things).toContain('flagpole');
    expect(things).toContain('sentrybox');
    expect(things).toContain('sandbags');
    const vehicles = life.spaces.filter((s) => inBase(s.x, s.y)).map((s) => s.kind);
    expect(vehicles).toContain('tank');
    expect(vehicles.filter((k) => k === 'tank' || k === 'apc' || k === 'landrover').length).toBeGreaterThanOrEqual(5);
  });

  it('has soldiers marching in step round its parade square, at PT, going about it; all of them kept to it', () => {
    const people = new People(map, { rand: seeded(5) });
    const view = { x0: base.x - 600, y0: base.y - 400, x1: base.x + 600, y1: base.y + 400 };
    people.populate(view, true);
    const soldiers = () => people.people.filter((p) => p.soldier);
    expect(soldiers().length).toBeGreaterThan(12);
    const marching = soldiers().filter((p) => p.mode === 'march');
    expect(marching.length).toBeGreaterThanOrEqual(9);
    expect(soldiers().filter((p) => p.mode === 'exercise').length).toBeGreaterThanOrEqual(5);
    for (let t = 0; t < 30; t += 1 / 30) people.update(1 / 30, view, still(-1e6, -1e6), [], () => 'red', () => true);
    // In step: each rank of a squad the same way, a rank's files side by side.
    const squad = soldiers().filter((p) => p.mode === 'march' && p.squad === marching[0].squad && p.slot![1] > -2);
    for (const p of squad) for (const q of squad) if (p.slot![0] === q.slot![0]) expect(Math.abs(Math.sin(p.angle - q.angle))).toBeLessThan(0.05);
    for (const p of soldiers()) expect(inBase(p.x, p.y)).toBe(true);
  }, 60_000);
});

describe('a skate park', () => {
  // The biggest of them.
  const park = whole.areas.filter((a) => a.sport === 'skate').sort((a, b) => area(b.rings[0]) - area(a.rings[0]))[0];
  const [px, py] = [park.rings[0][0], park.rings[0][1]];
  const map = regionAt(px, py);
  const life = drain(placesWork(map));
  const ring = park.rings[0];

  it('has its ramps and rails, and skaters riding round it, doing tricks (and bailing, now and then)', () => {
    const ramps = life.things.filter((t) => pointInRing(t.x, t.y, ring)).map((t) => t.kind);
    expect(ramps).toContain('quarterpipe');
    expect(ramps).toContain('funbox');
    const people = new People(map, { rand: seeded(9) });
    const view = { x0: px - 500, y0: py - 300, x1: px + 500, y1: py + 300 };
    people.populate(view, true);
    const skaters = () => people.people.filter((p) => p.ride);
    expect(skaters().length).toBeGreaterThanOrEqual(2);
    let [tricks, bails] = [0, 0];
    for (let t = 0; t < 60; t += 1 / 30) {
      people.update(1 / 30, view, still(-1e6, -1e6), [], () => 'red', () => true);
      for (const p of skaters()) {
        if (p.ride!.air > 0.69) tricks++;
        if (p.mode === 'down') bails++;
        // On the park (its ramps), all the time.
        expect(pointInRing(p.x, p.y, ring)).toBe(true);
      }
    }
    expect(tricks).toBeGreaterThan(3);
    expect(bails).toBeGreaterThan(0);
    // Back on their boards after.
    expect(skaters().filter((p) => p.mode === 'skate').length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
