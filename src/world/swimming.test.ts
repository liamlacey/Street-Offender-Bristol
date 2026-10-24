import { describe, expect, it } from 'vitest';
import { type GameMap, Projection, pointInRing } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { type Mover, People } from './people';
import { placesWork } from './places';
import { drain } from './work.ts';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const still = (x: number, y: number): Mover => ({ x, y, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 });
const whole = bristol as unknown as GameMap;
const proj = new Projection(whole.origin.lat, whole.origin.lon, whole.pxPerMetre);

/** The region round a point (as the game makes it: see streamer.ts). */
function regionAt(x: number, y: number): GameMap {
  const { index, tiles } = splitMap(whole);
  const [cx, cy] = [Math.round(x / TILE) * TILE, Math.round(y / TILE) * TILE];
  const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
  return assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
}

/** The people round a place, a while on (their spots filled, all of them at it). */
function peopleAt(map: GameMap, x: number, y: number, seconds = 30): People {
  const people = new People(map, { rand: seeded(7) });
  const view = { x0: x - 500, y0: y - 300, x1: x + 500, y1: y + 300 };
  people.populate(view, true);
  for (let t = 0; t < seconds; t += 1 / 30) people.update(1 / 30, view, still(-1e6, -1e6), [], () => 'red', () => true);
  return people;
}

describe('somewhere to swim outdoors', () => {
  const swims = whole.places!.filter((p) => p.kind === 'swim');

  it('has Henleaze Lake (the swimming club), the Clifton Lido and the paddling pool in St Andrews Park; not a garden pool', () => {
    expect(swims.some((p) => /Henleaze/.test(p.name ?? ''))).toBe(true);
    expect(swims.some((p) => /Paddling/.test(p.name ?? ''))).toBe(true);
    expect(swims.length).toBeLessThan(12);
  });

  it('the lake: swimmers about it near the club, in the water all the while; people out on the bank on their towels', () => {
    const club = swims.find((p) => /Henleaze/.test(p.name ?? ''))!;
    const map = regionAt(club.x, club.y);
    const lake = map.areas.filter((a) => a.kind === 'water').sort((a, b) => edge(a.rings[0], club.x, club.y) - edge(b.rings[0], club.x, club.y))[0];
    expect(edge(lake.rings[0], club.x, club.y)).toBeLessThan(80 * M);
    expect(lake).toBeTruthy();
    const people = peopleAt(map, club.x, club.y);
    const swimmers = people.people.filter((p) => p.mode === 'swim');
    expect(swimmers.length).toBeGreaterThanOrEqual(6);
    for (const p of swimmers) {
      expect(pointInRing(p.x, p.y, lake.rings[0])).toBe(true);
      expect(Math.hypot(p.x - club.x, p.y - club.y)).toBeLessThan(120 * M);
    }
    expect(swimmers.some((p) => p.speed > 0)).toBe(true);
    expect(people.people.filter((p) => p.mode === 'bathe').length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('the lido: its lanes (their lines, ropes), and swimmers doing lengths up and down them; sunbathers round it', () => {
    // (The lido's pool, behind Oakfield Place.)
    const [lx, ly] = [proj.x(-2.6114), proj.y(51.4599)];
    const lido = swims.sort((a, b) => Math.hypot(a.x - lx, a.y - ly) - Math.hypot(b.x - lx, b.y - ly))[0];
    expect(Math.hypot(lido.x - lx, lido.y - ly)).toBeLessThan(150 * M);
    const map = regionAt(lido.x, lido.y);
    const life = drain(placesWork(map));
    const lanes = life.areas.find((a) => a.bare && a.kind === 'pool' && pointInRing(lido.x, lido.y, a.rings[0]));
    expect(lanes?.markings?.length).toBe(3);
    const people = peopleAt(map, lido.x, lido.y);
    const swimmers = people.people.filter((p) => p.swim?.stroke === 'crawl');
    expect(swimmers.length).toBeGreaterThanOrEqual(3);
    for (const p of swimmers) expect(pointInRing(p.x, p.y, lido.rings[0])).toBe(true);
    // Up and down: some each way.
    const [ux, uy] = [Math.cos(swimmers[0].angle), Math.sin(swimmers[0].angle)];
    expect(swimmers.some((p) => Math.cos(p.angle) * ux + Math.sin(p.angle) * uy < -0.9)).toBe(true);
    expect(people.people.filter((p) => p.mode === 'bathe').length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('the paddling pool: children paddling about in it', () => {
    const pool = swims.find((p) => /Paddling/.test(p.name ?? ''))!;
    const map = regionAt(pool.x, pool.y);
    const people = peopleAt(map, pool.x, pool.y);
    const paddlers = people.people.filter((p) => p.swim?.stroke === 'paddle');
    expect(paddlers.length).toBeGreaterThanOrEqual(3);
    for (const p of paddlers) {
      expect(p.child).toBeLessThan(1);
      expect(pointInRing(p.x, p.y, pool.rings[0])).toBe(true);
    }
  }, 60_000);
});

/** How far a point is from a ring's edge. */
function edge(r: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < r.length; i += 2) best = Math.min(best, Math.hypot(r[i] - x, r[i + 1] - y));
  return pointInRing(x, y, r) ? 0 : best;
}
