import { describe, expect, it } from 'vitest';
import { type GameMap, pointInRing } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { type Mover, People } from './people';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const still = (x: number, y: number): Mover => ({ x, y, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 });

describe('the prison', () => {
  // The region round HMP Bristol, at Horfield.
  const whole = bristol as unknown as GameMap;
  const place = whole.places!.find((p) => p.kind === 'prison')!;
  const { index, tiles } = splitMap(whole);
  const [cx, cy] = [Math.round(place.x / TILE) * TILE, Math.round(place.y / TILE) * TILE];
  const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
  const map = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
  const ring = place.rings[0];
  const view = { x0: place.x - 600, y0: place.y - 400, x1: place.x + 600, y1: place.y + 400 };
  // Its wall (as the game's walls are, solid to walk into), and a gap knocked in it.
  const edge = (x: number, y: number, gap: [number, number] | null) => {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
      if (Math.hypot(px - x, py - y) < 1.5 * M && !(gap && Math.hypot(px - gap[0], py - gap[1]) < 4 * M)) return true;
    }
    return false;
  };
  const run = (people: People, seconds: number, gap: [number, number] | null, at = view) => {
    for (let t = 0; t < seconds; t += 1 / 30) people.update(1 / 30, at, still(-1e6, -1e6), [], () => 'red', (x, y) => !edge(x, y, gap));
  };

  it('has its yard full of prisoners in orange, fighting, at the gym, about the yard; all of them kept in by its wall', () => {
    const people = new People(map, { rand: seeded(11) });
    people.populate(view, true);
    const inmates = () => people.people.filter((p) => p.inmate);
    expect(inmates().length).toBeGreaterThan(20);
    expect(inmates().filter((p) => p.mode === 'fight').length).toBeGreaterThanOrEqual(2);
    expect(inmates().filter((p) => p.mode === 'exercise').length).toBeGreaterThan(0);
    run(people, 60, null);
    expect(inmates().length).toBeGreaterThan(20);
    // (Fights flaring up still, a minute on: not just those it started with.)
    expect(inmates().filter((p) => p.mode === 'fight').length).toBeGreaterThanOrEqual(2);
    for (const p of inmates()) expect(pointInRing(p.x, p.y, ring)).toBe(true);
  });

  it('broken out of: they make a run for the gap, through it, and away', () => {
    const people = new People(map, { rand: seeded(11) });
    people.populate(view, true);
    run(people, 5, null);
    const before = people.people.filter((p) => p.inmate).length;
    // A gap in its wall, at the middle of its longest side.
    let [best, gap] = [0, [0, 0] as [number, number]];
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
      if (len > best) [best, gap] = [len, [(ring[i] + ring[j]) / 2, (ring[i + 1] + ring[j + 1]) / 2]];
    }
    people.breakout(gap[0] - 3 * M, gap[1], gap[0] + 3 * M, gap[1]);
    // (Watching from by the gap: long enough for those from the far side of the yard, 180 m off, to get there and out.)
    const by = { x0: gap[0] - 600, y0: gap[1] - 400, x1: gap[0] + 600, y1: gap[1] + 400 };
    run(people, 60, gap, by);
    const out = people.people.filter((p) => p.inmate && p.free && !pointInRing(p.x, p.y, ring));
    expect(out.length).toBeGreaterThan(before / 3);
    // Free: none left wandering the yard; and no more come out into it.
    expect(people.people.filter((p) => p.inmate && !p.free && p.mode === 'wander').length).toBe(0);
  }, 60_000);
});
