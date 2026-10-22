import { describe, expect, it } from 'vitest';
import type { Area, GameMap } from '../map/osm';
import { type Mover, People } from './people';
import { PLAY_SIZE, playgrounds } from './playgrounds';
import { buildWorld } from './world';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const nowhere: Mover = { x: -1e6, y: -1e6, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 };

/** A playground 20 m by 15 m on a lawn, a building's corner reaching into it, a street along its south side. */
function park(): GameMap {
  const play: Area = { kind: 'play', rings: [[400, 400, 560, 400, 560, 520, 400, 520]] };
  return {
    attribution: '', pxPerMetre: M, width: 1200, height: 1200, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [{ kind: 'park', rings: [[200, 200, 900, 200, 900, 700, 200, 700]] }, play],
    roads: [{ kind: 'street', width: 6 * M, pts: [100, 545, 1000, 545] }],
    lines: [], trees: [], props: [], crossings: [], signals: [], controllers: [],
    buildings: [{ rings: [[520, 360, 600, 360, 600, 440, 520, 440]], height: 60, solid: true } as unknown as GameMap['buildings'][number]],
  };
}

describe('playgrounds', () => {
  const map = park();
  const things = playgrounds(map);

  it('are filled with swings, a slide, a roundabout and the rest: inside, clear of the building, the road and each other', () => {
    const kinds = things.map((t) => t.kind);
    expect(kinds).toContain('swings');
    expect(kinds).toContain('slide');
    expect(kinds).toContain('roundabout');
    expect(things.length).toBeGreaterThanOrEqual(5);
    for (const t of things) {
      const [hl, hw] = PLAY_SIZE[t.kind];
      const [ux, uy] = [Math.cos(t.angle), Math.sin(t.angle)];
      for (const [s, r] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [x, y] = [t.x + (ux * hl * s) / 2 - (uy * hw * r) / 2, t.y + (uy * hl * s) / 2 + (ux * hw * r) / 2];
        expect(x).toBeGreaterThanOrEqual(399);
        expect(x).toBeLessThanOrEqual(561);
        expect(y).toBeGreaterThanOrEqual(399);
        // (Off the road, and its pavement.)
        expect(y).toBeLessThanOrEqual(545 - 3 * M);
        expect(x > 520 && y < 440).toBe(false);
      }
      for (const o of things) if (o !== t) expect(Math.hypot(o.x - t.x, o.y - t.y)).toBeGreaterThan(M);
    }
    // The same each time.
    expect(playgrounds(park())).toEqual(things);
  });

  it('are loose things (knocked about, smashed), and people come to play on them: the swings swing, the roundabout goes round', () => {
    const world = buildWorld(map);
    const loose = world.loose.filter((l) => things.some((t) => t.kind === l.kind && t.x === l.x && t.y === l.y));
    expect(loose).toHaveLength(things.length);
    const people = new People(map, { rand: seeded(4), seats: world.loose });
    const view = { x0: 300, y0: 300, x1: 700, y1: 600 };
    people.populate(view, true);
    const swings = loose.find((l) => l.kind === 'swings')!;
    const round = loose.find((l) => l.kind === 'roundabout')!;
    // (And someone on the swings and the roundabout, whoever came.)
    const play = people as unknown as { playOn(seat: typeof swings): void };
    for (const s of [swings, round]) if (!people.people.some((p) => p.seat === s)) play.playOn(s);
    let swung = 0;
    let turned = 0;
    let playing = 0;
    for (let t = 0; t < 40; t += 1 / 30) {
      people.update(1 / 30, view, nowhere, [], () => 'green', () => true);
      swung = Math.max(swung, Math.abs(swings.motion?.[0] ?? 0), Math.abs(swings.motion?.[1] ?? 0));
      turned = Math.max(turned, round.motion?.[0] ?? 0);
      playing = Math.max(playing, people.people.filter((p) => p.seat && things.some((o) => o.x === p.seat!.x && o.y === p.seat!.y)).length);
    }
    expect(playing).toBeGreaterThan(2);
    expect(swung).toBeGreaterThan(0.3 * M);
    expect(turned).toBeGreaterThan(0.5);
  });
});
