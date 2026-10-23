import { describe, expect, it } from 'vitest';
import type { Area, GameMap, PitchSurface, Sport } from '../map/osm';
import { areaKind, pitchSurface, pointInRing, sportOf } from '../map/osm';
import { People } from './people';
import { frameOf, sportsOf } from './sports';
import { buildWorld } from './world';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const box = (x: number, y: number, w: number, d: number) => [x, y, x + w, y, x + w, y + d, x, y + d];

/** A map with pitches on it: each `[sport, surface, x, y, w, d]` (metres). */
function pitches(list: [Sport, PitchSurface, number, number, number, number][]): GameMap {
  const areas: Area[] = list.map(([sport, pitch, x, y, w, d]) => ({ kind: pitch === 'hard' || pitch === 'clay' ? 'court' : 'pitch', rings: [box(x * M, y * M, w * M, d * M)], sport, pitch }));
  return {
    attribution: '', pxPerMetre: M, width: 2400 * M, height: 400 * M, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas, roads: [], lines: [], buildings: [], props: [], crossings: [], signals: [], controllers: [], trees: [],
  } as unknown as GameMap;
}

describe('the map: pitches by their sport', () => {
  it('keeps the sport, and what it is played on (as tagged, or the usual for it)', () => {
    expect(sportOf({ sport: 'soccer' })).toBe('football');
    expect(sportOf({ sport: 'rugby_union' })).toBe('rugby');
    expect(sportOf({ sport: 'table_tennis;tennis' })).toBe('tennis');
    expect(sportOf({ sport: 'darts' })).toBeUndefined();
    expect(pitchSurface({}, 'tennis')).toBe('hard');
    expect(pitchSurface({ surface: 'grass' }, 'tennis')).toBe('grass');
    expect(pitchSurface({ surface: 'artificial_turf' }, 'football')).toBe('turf');
    expect(pitchSurface({}, 'hockey')).toBe('turf');
    expect(pitchSurface({}, 'bowls')).toBe('grass');
    // A hard court's a court (not a square), a grass or turf pitch a pitch; a court only tagged with its sport, too.
    expect(areaKind({ leisure: 'pitch', sport: 'tennis', surface: 'acrylic' })).toBe('court');
    expect(areaKind({ leisure: 'pitch', sport: 'soccer', surface: 'artificial_turf' })).toBe('pitch');
    expect(areaKind({ sport: 'tennis' })).toBe('court');
    expect(areaKind({ shop: 'sports', sport: 'tennis' })).toBeNull();
    expect(areaKind({ leisure: 'pitch', surface: 'asphalt' })).toBe('plaza');
  });

  it('fits a frame to a pitch: its long way, and in from a corner cut off', () => {
    const f = frameOf([0, 0, 0, 400, 200, 400, 200, 0])!;
    expect(Math.abs(f.uy)).toBeCloseTo(1, 5);
    expect(f.hl).toBeCloseTo(200, 0);
    expect(f.hw).toBeCloseTo(100, 0);
    const cut = frameOf([0, 0, 300, 0, 300, 160, 40, 160, 0, 120])!;
    expect(cut.hl * cut.hw).toBeLessThan(150 * 80);
  });
});

describe('sports', () => {
  // Three tennis courts' worth of ground; a full-size football pitch; a bowling green; a cricket field; a basketball court;
  // a hockey pitch; a rugby pitch.
  const map = pitches([
    ['tennis', 'hard', 0, 0, 37, 52],
    ['football', 'grass', 100, 0, 105, 68],
    ['bowls', 'grass', 300, 0, 36, 36],
    ['cricket', 'grass', 400, 0, 140, 120],
    ['basketball', 'hard', 600, 0, 32, 19],
    ['hockey', 'turf', 700, 0, 95, 58],
    ['rugby', 'grass', 900, 0, 120, 75],
  ]);
  const life = sportsOf(map);
  const inPitch = (k: number, x: number, y: number) => pointInRing(x, y, map.areas[k].rings[0]);

  it('lays out tennis courts side by side, painted, lined, a net across each and a fence round them', () => {
    const courts = life.areas.filter((a) => inPitch(0, ...(a.rings[0].slice(0, 2) as [number, number])) && a.markings);
    expect(courts.length).toBe(3);
    for (const c of courts) expect(c.markings!.flatMap((m) => m.segs).length / 4).toBeGreaterThanOrEqual(11);
    expect(life.areas.some((a) => a.tint && inPitch(0, a.rings[0][0] + 1, a.rings[0][1] + 1))).toBe(true);
    const nets = life.lines.filter((l) => l.kind === 'net');
    expect(nets).toHaveLength(3);
    // Across the courts, at their middle: 12.8 m long.
    for (const n of nets) expect(Math.hypot(n.pts[2] - n.pts[0], n.pts[3] - n.pts[1]) / M).toBeCloseTo(12.77, 0);
    expect(life.lines.some((l) => l.kind === 'mesh' && l.pts.every((v, i) => (i % 2 ? v <= 52 * M : v <= 37 * M)))).toBe(true);
  });

  it('marks out a football pitch (its areas, circles and spots), mown in stripes, a goal at each end', () => {
    const goals = life.things.filter((t) => t.kind === 'goal');
    expect(goals).toHaveLength(2);
    for (const g of goals) expect(inPitch(1, g.x, g.y)).toBe(true);
    // A goal at each end: 100 m or more apart.
    expect(Math.hypot(goals[0].x - goals[1].x, goals[0].y - goals[1].y) / M).toBeGreaterThan(98);
    const lines = life.areas.find((a) => a.markings && inPitch(1, a.rings[0][0] + 1, a.rings[0][1] + 1))!;
    expect(lines.bare).toBe(true);
    expect(lines.markings!.some((m) => m.width > 40)).toBe(true);
  });

  it('puts posts up on the rugby pitch, hoops at the basketball court, goals on the hockey pitch, stumps on the cricket square', () => {
    expect(life.things.filter((t) => t.kind === 'rugbypost')).toHaveLength(2);
    expect(life.things.filter((t) => t.kind === 'hoop')).toHaveLength(2);
    expect(life.things.filter((t) => t.kind === 'hockeygoal')).toHaveLength(2);
    expect(life.things.filter((t) => t.kind === 'stumps')).toHaveLength(2);
    // The hockey pitch is artificial turf; the cricket square's strip, mown short.
    expect(life.areas.some((a) => a.tint && inPitch(5, a.rings[0][0] + 1, a.rings[0][1] + 1))).toBe(true);
    expect(life.areas.some((a) => a.tint && inPitch(3, a.rings[0][0], a.rings[0][1]) && Math.abs(a.rings[0][0] - a.rings[0][2]) + Math.abs(a.rings[0][1] - a.rings[0][3]) < 30 * M)).toBe(true);
    // All of it knocked about: loose things, and the nets come down like a fence.
    const world = buildWorld(pitches([['tennis', 'hard', 0, 0, 37, 52], ['basketball', 'hard', 600, 0, 32, 19]]));
    expect(world.loose.filter((l) => l.kind === 'hoop')).toHaveLength(2);
    expect(world.walls[0].some((w) => w.kind === 'net')).toBe(true);
  });

  it('has games on some: on the pitch they are for, players where they play, and the same every time', () => {
    const kinds = new Set(life.games.map((g) => g.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    for (const g of life.games) {
      const k = map.areas.findIndex((a) => pointInRing(g.x, g.y, a.rings[0]));
      expect(k).toBeGreaterThanOrEqual(0);
      expect(g.spots.length).toBeGreaterThanOrEqual(4);
    }
    expect(sportsOf(pitches([['tennis', 'hard', 0, 0, 37, 52]]))).toEqual(sportsOf(pitches([['tennis', 'hard', 0, 0, 37, 52]])));
  });

  it('plays tennis over the net: the ball goes from one end to the other and back', () => {
    // Courts enough that some have a game on.
    const many = pitches([0, 1, 2, 3, 4, 5].map((k) => ['tennis', 'hard', k * 60, 0, 37, 52] as [Sport, PitchSurface, number, number, number, number]));
    const people = new People(many, { rand: seeded(7) });
    const game = people.games.find((g) => g.kind === 'tennis')!;
    expect(game).toBeDefined();
    const view = { x0: game.x - 400, y0: game.y - 300, x1: game.x + 400, y1: game.y + 300 };
    // (Started as if out of sight.)
    (people as unknown as { parkGames: (...a: unknown[]) => void }).parkGames(view.x0, view.y0, view.x1, view.y1, () => false, true);
    const players = people.people.filter((p) => p.game === game);
    expect(players.length === 2 || players.length === 4).toBe(true);
    const [ux, uy] = [Math.cos(game.angle), Math.sin(game.angle)];
    const end = (x: number, y: number) => Math.sign((x - game.x) * ux + (y - game.y) * uy);
    let crossings = 0;
    let last = end(game.ball.x, game.ball.y);
    for (let t = 0; t < 20; t += 1 / 30) {
      people.update(1 / 30, view, { x: -1e5, y: -1e5, angle: 0, length: 38, width: 18, vx: 0, vy: 0, id: -1 }, [], () => 'green', () => true);
      const now = end(game.ball.x, game.ball.y);
      if (now && now !== last) crossings++;
      if (now) last = now;
    }
    expect(crossings).toBeGreaterThan(8);
  });
});
