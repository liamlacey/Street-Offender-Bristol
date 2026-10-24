/**
 * The sports pitches and courts (OSM's `leisure=pitch`, with its `sport` and
 * `surface`: see the map's areas), laid out for what's played on them, the
 * same every time:
 *
 * - Tennis and padel: the courts (as many as fit, side by side), painted (a
 *   hard court's two colours, clay, grass or artificial turf), their lines,
 *   the net across each (knocked down like a fence), a tall mesh fence round
 *   them (a gate in it); two or four playing on some.
 * - Basketball, netball: the court's lines, the hoops or the posts at each
 *   end; a few shooting about at one end. A multi-sport court (a cage): its
 *   five-a-side lines, small goals, a tall mesh fence.
 * - Football, rugby, hockey: the pitch fitted to the ground, the grass mown in
 *   stripes (or the artificial turf), its lines, the goals or the posts; a
 *   game on some (keepers in goal, shots at it; kicks at the posts).
 * - Cricket: the square, its strip and creases, the stumps, the boundary
 *   rope; a game on some (bowler, batsman, keeper, fielders).
 * - Bowls and croquet: the green (or lawn), mown in stripes, the bowling
 *   green's ditch; bowls rolled up a rink to the jack, croquet balls through
 *   the hoops.
 * - A skate park: its concrete; its quarter pipes (one at each end, where it's long enough), a funbox in the middle, grind rails;
 *   the way round it the skaters ride (see people.ts). A table-tennis table (a prop): two playing.
 *
 * Pure (from the map alone), so it's tested; places.ts puts it in with what's
 * round the places, and people.ts plays the games.
 */

import { type Area, type GameMap, type PitchSurface, type Pts, type Sport, pointInRing } from '../map/osm';

const M = 8;

/** The games played on them (see people.ts: each its ball, and how it's passed). */
export type SportGame = 'tennis' | 'padel' | 'pingpong' | 'basketball' | 'netball' | 'football' | 'hockey' | 'rugby' | 'cricket' | 'bowls' | 'croquet';

/** A game on a pitch: its middle, which way the pitch runs, where the players stand (in order: x, y, ...) and what they aim at. */
export interface SportsGame {
  kind: SportGame;
  x: number;
  y: number;
  angle: number;
  spots: number[];
  aims: number[];
}

export interface SportsLife {
  things: { kind: string; x: number; y: number; angle: number; variant?: number }[];
  lines: { kind: 'mesh' | 'net'; pts: Pts; height: number }[];
  areas: Area[];
  games: SportsGame[];
  /** The skate parks: their middles, and the way round each the skaters ride (x, y, ...), through its ramps. */
  parks: { x: number; y: number; hl: number; hw: number; angle: number; loop: number[] }[];
}

/** Courts' paint (hard ones): what's round the courts, and the courts themselves. */
const HARD: [string, string][] = [
  ['rgba(52,96,66,0.85)', 'rgba(70,120,80,0.85)'],
  ['rgba(46,90,64,0.85)', 'rgba(44,92,142,0.85)'],
  ['rgba(140,72,54,0.85)', 'rgba(62,108,74,0.85)'],
  ['rgba(150,78,58,0.85)', 'rgba(150,78,58,0.85)'],
];
const CLAY = 'rgba(184,100,62,0.9)';
const TURF = 'rgba(70,150,72,0.8)';
const HOCKEY_BLUE = 'rgba(40,98,166,0.85)';
const LAWN = 'rgba(78,158,70,0.55)';
const WHITE = '#f2f0e6';
/** Mown stripes, the paler of each pair. */
const STRIPE = 'rgba(255,255,255,0.07)';

/** A frame fitted to a pitch: its middle, its long way (ux, uy), and half its length and width, px. */
interface Frame {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  hl: number;
  hw: number;
}

const cache = new WeakMap<GameMap, SportsLife>();

/** The sports on a map (worked out once for each). */
export function sportsOf(map: GameMap): SportsLife {
  const had = cache.get(map);
  if (had) return had;
  const life: SportsLife = { things: [], lines: [], areas: [], games: [], parks: [] };
  const seen = new Set<string>();
  for (const a of map.areas ?? []) {
    if (!a.sport || (a.kind !== 'pitch' && a.kind !== 'court')) continue;
    const ring = a.rings[0];
    // (The same pitch twice over, in two tiles: once.)
    const name = `${ring[0]},${ring[1]},${ring.length}`;
    if (seen.has(name)) continue;
    seen.add(name);
    // (A skate park's often an odd shape: whatever's the biggest of it that's square, its ramps in that.)
    const skate = a.sport === 'skate';
    const f = skate ? (frameOf(ring) ?? deepest(ring)) : frameOf(ring);
    if (!f || f.hw < (skate ? 1.5 : 2) * M) continue;
    if (skate) skatePark(f, ring, life);
    else pitch(a.sport, a.pitch ?? 'grass', f, seeded(hash(f.cx, f.cy)), life);
  }
  // The table-tennis tables: two playing at some.
  for (const p of map.props ?? []) {
    if (p.kind !== 'pingpong') continue;
    const rand = seeded(hash(p.x, p.y));
    if (rand() > 0.5) continue;
    const angle = p.angle ?? 0;
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    life.games.push({ kind: 'pingpong', x: p.x, y: p.y, angle, spots: [p.x - c * 2.2 * M, p.y - s * 2.2 * M, p.x + c * 2.2 * M, p.y + s * 2.2 * M].map(r1), aims: [] });
  }
  cache.set(map, life);
  return life;
}

/**
 * The rectangle that fits a pitch: lined up with the edge that gives the smallest one round it (a pitch is mapped as a
 * rectangle, near enough), then drawn in till its corners are in it (one that isn't quite).
 */
/**
 * An odd-shaped ground's biggest square: round the point furthest in from its edges (looked for every metre), along its longest
 * side, as far out as it's that far in (a little less); or null.
 */
function deepest(ring: Pts): Frame | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
  const edge = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
    }
    return best;
  };
  let [bx, by, bd] = [0, 0, 0];
  for (let x = x0; x <= x1; x += M) for (let y = y0; y <= y1; y += M) if (pointInRing(x, y, ring)) {
    const d = edge(x, y);
    if (d > bd) [bx, by, bd] = [x, y, d];
  }
  if (bd < 2 * M) return null;
  let [ux, uy, longest] = [1, 0, 0];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (len > longest) [ux, uy, longest] = [(ring[j] - ring[i]) / len, (ring[j + 1] - ring[i + 1]) / len, len];
  }
  return { cx: bx, cy: by, ux, uy, hl: bd * 0.68, hw: bd * 0.68 };
}

export function frameOf(ring: Pts, least = 0.5): Frame | null {
  if (ring.length < 6) return null;
  let best: Frame | null = null;
  let bestArea = Infinity;
  let [mx, my] = [0, 0];
  for (let k = 0; k + 1 < ring.length; k += 2) [mx, my] = [mx + ring[k], my + ring[k + 1]];
  [mx, my] = [(mx * 2) / ring.length, (my * 2) / ring.length];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    if (len < 0.5 * M) continue;
    const [ux, uy] = [(ring[j] - ring[i]) / len, (ring[j + 1] - ring[i + 1]) / len];
    let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const [dx, dy] = [ring[k] - mx, ring[k + 1] - my];
      const a = dx * ux + dy * uy;
      const b = -dx * uy + dy * ux;
      [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area >= bestArea) continue;
    bestArea = area;
    const [ca, cb] = [(a0 + a1) / 2, (b0 + b1) / 2];
    const [cx, cy] = [mx + ux * ca - uy * cb, my + uy * ca + ux * cb];
    // The long way along.
    best = a1 - a0 >= b1 - b0 ? { cx, cy, ux, uy, hl: (a1 - a0) / 2, hw: (b1 - b0) / 2 } : { cx, cy, ux: -uy, uy: ux, hl: (b1 - b0) / 2, hw: (a1 - a0) / 2 };
  }
  if (!best) return null;
  const f = best;
  const inside = (k: number) => {
    const [hl, hw] = [f.hl * k - 0.3 * M, f.hw * k - 0.3 * M];
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw], [hl, 0], [-hl, 0]]) {
      if (!pointInRing(f.cx + f.ux * a - f.uy * b, f.cy + f.uy * a + f.ux * b, ring)) return false;
    }
    return true;
  };
  let k = 1;
  while (k > least && !inside(k)) k -= 0.05;
  if (k <= least) return null;
  return { ...f, hl: f.hl * k, hw: f.hw * k };
}

/** Drawing in a frame's own terms: `a` along it, `b` across, from its middle (px); markings by colour and width. */
class Layout {
  readonly marks = new Map<string, number[]>();

  constructor(readonly f: Frame, readonly offA = 0, readonly offB = 0) {}

  at(a: number, b: number): [number, number] {
    const { cx, cy, ux, uy } = this.f;
    const [p, q] = [a + this.offA, b + this.offB];
    return [r1(cx + ux * p - uy * q), r1(cy + uy * p + ux * q)];
  }

  /** The way across the frame (along `b`), radians: a goal's, a net's. */
  get across(): number {
    return +Math.atan2(this.f.ux, -this.f.uy).toFixed(3);
  }

  get along(): number {
    return +Math.atan2(this.f.uy, this.f.ux).toFixed(3);
  }

  /** A goal's way at end `e` (its texture's crossbar across the frame, its net behind, away from the pitch). */
  goal(e: number): number {
    return e > 0 ? +(this.across + Math.PI).toFixed(3) : this.across;
  }

  line(a0: number, b0: number, a1: number, b1: number, colour = WHITE, width = 1.2): void {
    const key = `${colour}|${width}`;
    if (!this.marks.has(key)) this.marks.set(key, []);
    this.marks.get(key)!.push(...this.at(a0, b0), ...this.at(a1, b1));
  }

  rect(a0: number, b0: number, a1: number, b1: number, colour = WHITE, width = 1.2): void {
    this.line(a0, b0, a1, b0, colour, width);
    this.line(a1, b0, a1, b1, colour, width);
    this.line(a1, b1, a0, b1, colour, width);
    this.line(a0, b1, a0, b0, colour, width);
  }

  arc(ca: number, cb: number, r: number, from: number, to: number, colour = WHITE, width = 1.2): void {
    const n = Math.max(6, Math.round(((to - from) * r) / (1 * M)));
    for (let k = 0; k < n; k++) {
      const [t0, t1] = [from + ((to - from) * k) / n, from + ((to - from) * (k + 1)) / n];
      this.line(ca + Math.cos(t0) * r, cb + Math.sin(t0) * r, ca + Math.cos(t1) * r, cb + Math.sin(t1) * r, colour, width);
    }
  }

  /** A dashed line: dashes `dash` long, as far apart. */
  dashed(a0: number, b0: number, a1: number, b1: number, dash: number): void {
    const len = Math.hypot(a1 - a0, b1 - b0);
    for (let d = 0; d < len; d += dash * 2) {
      const [t0, t1] = [d / len, Math.min(1, (d + dash) / len)];
      this.line(a0 + (a1 - a0) * t0, b0 + (b1 - b0) * t0, a0 + (a1 - a0) * t1, b0 + (b1 - b0) * t1);
    }
  }

  /** A rectangle in the frame's terms, as a ring. */
  ring(a0: number, b0: number, a1: number, b1: number): Pts {
    return [...this.at(a0, b0), ...this.at(a1, b0), ...this.at(a1, b1), ...this.at(a0, b1)];
  }

  markings(): { colour: string; width: number; segs: number[] }[] {
    return [...this.marks].map(([key, segs]) => {
      const [colour, width] = key.split('|');
      return { colour, width: +width, segs };
    });
  }

  /** Where a point is, in the map's terms, flattened for a game's spots. */
  pts(list: [number, number][]): number[] {
    return list.flatMap(([a, b]) => this.at(a, b));
  }
}

/** Lays out one pitch for its sport. */
function pitch(sport: Sport, surface: PitchSurface, f: Frame, rand: () => number, life: SportsLife): void {
  switch (sport) {
    case 'tennis':
    case 'padel':
      return courts(sport, surface, f, rand, life);
    case 'basketball':
      return basketball(surface, f, rand, life);
    case 'netball':
      return netball(surface, f, rand, life);
    case 'multi':
      return cage(surface, f, rand, life);
    case 'football':
    case 'rugby':
    case 'hockey':
      return field(sport, surface, f, rand, life);
    case 'cricket':
      return cricket(f, rand, life);
    case 'bowls':
    case 'croquet':
      return lawn(sport, f, rand, life);
    case 'skate':
      return;
  }
}

/** A skate park's quarter pipe (along, across), its funbox, its grind rail, px. */
const QUARTER: [number, number] = [3 * M, 6 * M];
const FUNBOX: [number, number] = [5 * M, 3 * M];
const RAIL = 4 * M;

/**
 * A skate park: its concrete; a quarter pipe at each end (facing in, its coping at the back), if it's long and wide enough; a
 * funbox in the middle; grind rails either side of it, where there's room; and the way round it the skaters ride: an oval,
 * up each quarter pipe and over the funbox.
 */
function skatePark(f: Frame, ring: Pts, life: SportsLife): void {
  const lay = new Layout(f);
  life.areas.push({ kind: 'court', rings: [ring], tint: 'rgba(176,174,166,0.92)' });
  const along = Math.atan2(f.uy, f.ux);
  const quarters = f.hl >= QUARTER[0] * 2 + FUNBOX[0] && f.hw * 2 >= QUARTER[1] - 0.5 * M;
  if (quarters) {
    for (const end of [1, -1]) {
      const [x, y] = lay.at(end * (f.hl - QUARTER[0] / 2), 0);
      // (Its coping, at the back of the picture, out towards its end.)
      life.things.push({ kind: 'quarterpipe', x, y, angle: +(along + (end > 0 ? Math.PI : 0)).toFixed(3) });
    }
  }
  if (f.hl * 2 >= FUNBOX[0] + 2 * M && f.hw * 2 >= FUNBOX[1] + M) {
    const [x, y] = lay.at(0, 0);
    life.things.push({ kind: 'funbox', x, y, angle: +along.toFixed(3) });
  }
  if (f.hw >= FUNBOX[1] / 2 + 2.2 * M && f.hl * 2 >= RAIL + 2 * M) {
    for (const side of [1, -1]) {
      const [x, y] = lay.at(0, side * (FUNBOX[1] / 2 + 1.4 * M));
      life.things.push({ kind: 'grindrail', x, y, angle: +along.toFixed(3) });
    }
  }
  // The way round: an oval, nearly to its ends (up the quarter pipes), over the funbox each way.
  const [a, b] = [Math.max(M, f.hl - (quarters ? 1.2 * M : 1.5 * M)), Math.max(0.8 * M, f.hw * 0.62)];
  const loop: number[] = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    loop.push(...lay.at(Math.cos(t) * a, Math.sin(t) * b));
  }
  const [cx, cy] = lay.at(0, 0);
  life.parks.push({ x: cx, y: cy, hl: f.hl, hw: f.hw, angle: +along.toFixed(3), loop });
}

/** The whole of a pitch, painted (or the turf), under its lines. */
function surfaceOf(surface: PitchSurface, f: Frame, life: SportsLife, tint?: string): Layout {
  const lay = new Layout(f);
  const t = tint ?? (surface === 'turf' ? TURF : surface === 'clay' ? CLAY : undefined);
  if (t) life.areas.push({ kind: surface === 'hard' || surface === 'clay' ? 'court' : 'pitch', rings: [lay.ring(-f.hl, -f.hw, f.hl, f.hw)], tint: t });
  return lay;
}

/** A tall mesh fence round a frame (0.3 m in), a gate 1.2 m wide in the middle of one long side. */
function fenceRound(lay: Layout, f: Frame, height: number, life: SportsLife): void {
  const [hl, hw, g] = [f.hl - 0.3 * M, f.hw - 0.3 * M, 0.6 * M];
  life.lines.push({ kind: 'mesh', pts: [...lay.at(g, -hw), ...lay.at(hl, -hw), ...lay.at(hl, hw), ...lay.at(-hl, hw), ...lay.at(-hl, -hw), ...lay.at(-g, -hw)], height });
}

function lines(lay: Layout, life: SportsLife, bare: boolean, kind: 'pitch' | 'court', ring: Pts, tint?: string): void {
  life.areas.push({ kind, rings: [ring], markings: lay.markings(), ...(bare ? { bare: true } : {}), ...(tint ? { tint } : {}) });
}

/**
 * Tennis (23.77 m by 10.97 m, 6.4 m to the service lines) and padel (20 m by 10 m, 6.95 m) courts: as many as fit side by
 * side (3.66 m apart), smaller where they must be; the net across each; a fence round them all; players on some.
 */
function courts(sport: 'tennis' | 'padel', surface: PitchSurface, frame: Frame, rand: () => number, life: SportsLife): void {
  const padel = sport === 'padel';
  const [L, W, gap, back] = padel ? [20 * M, 10 * M, 2 * M, 0.5 * M] : [23.77 * M, 10.97 * M, 3.66 * M, 5 * M];
  // How many fit side by side, and how much smaller they must be: along the ground's long way, or across it (three courts side by
  // side take ground wider than it's long), whichever has more full-size ones.
  const layout = (f: Frame): [Frame, number, number] => {
    let n = Math.max(1, Math.floor((2 * f.hw - gap) / (W + gap)));
    const fit = (k: number) => Math.min(1, (2 * f.hl) / (L + 2 * back), (2 * f.hw) / (k * (W + gap) + (padel ? 0 : gap)));
    let s = fit(n);
    if (s < 0.75 && n > 1) s = fit((n = Math.max(1, Math.floor((n * s) / 0.75))));
    return [f, n, s];
  };
  const a = layout(frame);
  const b = layout({ ...frame, ux: -frame.uy, uy: frame.ux, hl: frame.hw, hw: frame.hl });
  const [f, n, s] = b[1] * b[2] ** 2 > a[1] * a[2] ** 2 + 0.01 ? b : a;
  const [round, own] = surface === 'hard' ? HARD[Math.floor(rand() * HARD.length)] : surface === 'clay' ? [CLAY, CLAY] : surface === 'turf' ? [TURF, padel ? HOCKEY_BLUE : TURF] : [undefined, undefined];
  const whole = surfaceOf(surface, f, life, padel ? 'rgba(46,90,64,0.85)' : round);
  if (s < 0.5) return;
  const [l, w] = [(L * s) / 2, (W * s) / 2];
  for (let k = 0; k < n; k++) {
    const b = (k - (n - 1) / 2) * (W + gap) * s;
    const lay = new Layout(f, 0, b);
    lay.rect(-l, -w, l, w, WHITE, 1.4);
    const service = (padel ? 6.95 : 6.4) * M * s;
    if (padel) lay.line(-service, 0, service, 0);
    else {
      // The singles sidelines; the service lines and the centre line between them; the centre marks.
      const single = 4.115 * M * s;
      lay.line(-l, -single, l, -single);
      lay.line(-l, single, l, single);
      lay.line(-service, -single, -service, single);
      lay.line(service, -single, service, single);
      lay.line(-service, 0, service, 0);
      lay.line(-l, 0, -l + 0.5 * M, 0);
      lay.line(l, 0, l - 0.5 * M, 0);
    }
    if (padel) {
      lay.line(-service, -w, -service, w);
      lay.line(service, -w, service, w);
    }
    lines(lay, life, false, surface === 'grass' ? 'pitch' : surface === 'turf' ? 'pitch' : 'court', lay.ring(-l, -w, l, w), own);
    // The net, across the middle (its posts just outside the court).
    life.lines.push({ kind: 'net', pts: [...lay.at(0, -w - 0.9 * M * s), ...lay.at(0, w + 0.9 * M * s)], height: 1.07 * M });
    // A padel court's walls (glass and mesh), a door each side of the net.
    if (padel) {
      const d = 0.8 * M;
      life.lines.push({ kind: 'mesh', pts: [...lay.at(d, -w), ...lay.at(l, -w), ...lay.at(l, w), ...lay.at(d, w)], height: 3 * M });
      life.lines.push({ kind: 'mesh', pts: [...lay.at(-d, w), ...lay.at(-l, w), ...lay.at(-l, -w), ...lay.at(-d, -w)], height: 3 * M });
    }
    // Two playing (a baseline each), or four (one of each pair up at the net), on some.
    if (rand() < 0.55) {
      const j = () => (rand() - 0.5) * 2 * M * s;
      const spots: [number, number][] = [[-l - 0.8 * M, j()], [l + 0.8 * M, j()], [-l * 0.35, w * 0.5], [l * 0.35, -w * 0.5]];
      if (padel) spots.splice(0, 4, [-l * 0.7, -w * 0.5], [l * 0.7, w * 0.5], [-l * 0.4, w * 0.5], [l * 0.4, -w * 0.5]);
      const [x, y] = lay.at(0, 0);
      life.games.push({ kind: sport, x, y, angle: lay.along, spots: lay.pts(spots), aims: [] });
    }
  }
  if (surface !== 'grass' && !padel) fenceRound(whole, f, 2.75 * M, life);
}

/** A court's size, scaled down to fit (1 m clear round it). */
function courtFit(f: Frame, L: number, W: number): [number, number, number] {
  const s = Math.min(1, (2 * f.hl - 2 * M) / L, (2 * f.hw - 2 * M) / W);
  return [s, (L * s) / 2, (W * s) / 2];
}

/** A basketball court (28 m by 15 m): its key, circles and three-point line; the hoops; a few shooting at one end, on some. */
function basketball(surface: PitchSurface, f: Frame, rand: () => number, life: SportsLife): void {
  const lay = surfaceOf(surface, f, life, surface === 'hard' && rand() < 0.4 ? HARD[Math.floor(rand() * HARD.length)][1] : undefined);
  const [s, l, w] = courtFit(f, 28 * M, 15 * M);
  if (s < 0.35) return;
  lay.rect(-l, -w, l, w, WHITE, 1.4);
  lay.line(0, -w, 0, w);
  lay.arc(0, 0, 1.8 * M * s, 0, Math.PI * 2);
  for (const e of [-1, 1]) {
    const basket = e * (l - 1.575 * M * s);
    const key = e * (l - 5.8 * M * s);
    lay.rect(Math.min(e * l, key), -2.45 * M * s, Math.max(e * l, key), 2.45 * M * s);
    lay.arc(key, 0, 1.8 * M * s, 0, Math.PI * 2);
    // The three-point line: an arc round the basket, straight to the baseline where it meets the sides.
    const r = 6.75 * M * s;
    const side = Math.min(6.6 * M * s, w - 0.3 * M);
    const t = Math.asin(Math.min(1, side / r));
    const from = e > 0 ? Math.PI - t : -t;
    lay.arc(basket, 0, r, from, from + 2 * t);
    const meet = basket - e * r * Math.cos(t);
    lay.line(e * l, -side, meet, -side);
    lay.line(e * l, side, meet, side);
    // The hoop: its post behind the baseline, its board and ring out over the court.
    const [hx, hy] = lay.at(e * (l + 0.2 * M), 0);
    life.things.push({ kind: 'hoop', x: hx, y: hy, angle: e > 0 ? +(lay.along + Math.PI).toFixed(3) : lay.along });
  }
  lines(lay, life, true, surface === 'hard' ? 'court' : 'pitch', lay.ring(-l, -w, l, w));
  if (rand() < 0.6) {
    const e = rand() < 0.5 ? -1 : 1;
    const basket = e * (l - 1.575 * M * s);
    const spots: [number, number][] = [0, 1, 2, 3, 4].map((k) => {
      const a = Math.PI + (k - 2) * 0.55 + (rand() - 0.5) * 0.3;
      const r = (3 + rand() * 4) * M * s;
      return [basket + e * Math.cos(a) * r, Math.sin(a) * r];
    });
    const [x, y] = lay.at(basket - e * 4 * M * s, 0);
    life.games.push({ kind: 'basketball', x, y, angle: lay.along, spots: lay.pts(spots), aims: lay.at(basket, 0) });
  }
}

/** A netball court (30.5 m by 15.25 m): thirds, the centre circle, the shooting circles; a post at each end; a game on some. */
function netball(surface: PitchSurface, f: Frame, rand: () => number, life: SportsLife): void {
  const lay = surfaceOf(surface, f, life);
  const [s, l, w] = courtFit(f, 30.5 * M, 15.25 * M);
  if (s < 0.35) return;
  lay.rect(-l, -w, l, w, WHITE, 1.4);
  lay.line(-l / 3, -w, -l / 3, w);
  lay.line(l / 3, -w, l / 3, w);
  lay.arc(0, 0, 0.45 * M * s, 0, Math.PI * 2);
  const r = Math.min(4.9 * M * s, w * 0.9);
  lay.arc(-l, 0, r, -Math.PI / 2, Math.PI / 2);
  lay.arc(l, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
  for (const e of [-1, 1]) {
    const [px, py] = lay.at(e * l, 0);
    life.things.push({ kind: 'netpost', x: px, y: py, angle: 0 });
  }
  lines(lay, life, true, surface === 'hard' ? 'court' : 'pitch', lay.ring(-l, -w, l, w));
  if (rand() < 0.5) {
    // (From the middle out, so however few are playing they're about the whole court.)
    const spots: [number, number][] = [0, -0.55, 0.55, -0.3, 0.3, -0.8, 0.8].map((k, i) => [k * l, (i % 2 ? 0.45 : -0.45) * w * rand()]);
    const [x, y] = lay.at(0, 0);
    life.games.push({ kind: 'netball', x, y, angle: lay.along, spots: lay.pts(spots), aims: [...lay.at(-l, 0), ...lay.at(l, 0)] });
  }
}

/** A multi-sport court (a cage): five-a-side lines, small goals at the ends, a tall fence round it; a kick-about on some. */
function cage(surface: PitchSurface, f: Frame, rand: () => number, life: SportsLife): void {
  const lay = surfaceOf(surface, f, life, surface === 'hard' && rand() < 0.5 ? HARD[Math.floor(rand() * HARD.length)][0] : undefined);
  const [l, w] = [f.hl - 1 * M, f.hw - 1 * M];
  if (l < 6 * M || w < 4 * M) return;
  lay.rect(-l, -w, l, w);
  lay.line(0, -w, 0, w);
  lay.arc(0, 0, Math.min(3 * M, w * 0.4), 0, Math.PI * 2);
  const r = Math.min(4 * M, w * 0.55);
  lay.arc(-l, 0, r, -Math.PI / 2, Math.PI / 2);
  lay.arc(l, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
  // Basketball's keys too, in yellow, where there's room.
  if (w > 5 * M) for (const e of [-1, 1]) lay.rect(e * l, -1.8 * M, e * (l - 4.5 * M), 1.8 * M, '#f2c94c', 1);
  for (const e of [-1, 1]) {
    const [gx, gy] = lay.at(e * (l + 0.75 * M), 0);
    life.things.push({ kind: 'goalsmall', x: gx, y: gy, angle: lay.goal(e) });
  }
  lines(lay, life, true, surface === 'hard' ? 'court' : 'pitch', lay.ring(-l, -w, l, w));
  fenceRound(lay, f, 3.5 * M, life);
  if (rand() < 0.5) {
    const spots: [number, number][] = [[-l + 0.8 * M, 0], [l - 0.8 * M, 0], [-l * 0.4, -w * 0.4], [l * 0.4, w * 0.4], [-l * 0.2, w * 0.5], [l * 0.25, -w * 0.5]];
    const [x, y] = lay.at(0, 0);
    life.games.push({ kind: 'football', x, y, angle: lay.along, spots: lay.pts(spots), aims: [...lay.at(-l, 0), ...lay.at(l, 0)] });
  }
}

/**
 * A football, rugby or hockey pitch: fitted to the ground (2 m clear round it, as long as about one and a half times as wide),
 * mown in stripes (grass) or the artificial turf; its lines; the goals or the posts; a game on some.
 */
function field(sport: 'football' | 'rugby' | 'hockey', surface: PitchSurface, f: Frame, rand: () => number, life: SportsLife): void {
  const tint = surface === 'turf' ? (sport === 'hockey' && rand() < 0.5 ? HOCKEY_BLUE : TURF) : surface === 'hard' ? 'rgba(88,92,96,0.6)' : undefined;
  const lay = surfaceOf(surface, f, life, tint);
  let [l, w] = [f.hl - 2 * M, f.hw - 2 * M];
  if (l < 8 * M || w < 5 * M) return;
  const ratio = sport === 'hockey' ? 1.66 : sport === 'rugby' ? 1.55 : 1.5;
  if (l > w * ratio * 1.25) l = w * ratio * 1.25;
  if (l < w * 1.15) w = l / 1.15;
  // Mown in stripes across it, 5.5 m wide (grass).
  if (surface === 'grass') {
    const stripe = 5.5 * M;
    for (let a = -f.hl + stripe / 2; a < f.hl; a += stripe * 2) lay.line(a, -f.hw, a, f.hw, STRIPE, stripe);
  }
  const big = l * 2 > 70 * M;
  lay.rect(-l, -w, l, w, WHITE, big ? 1.6 : 1.3);
  lay.line(0, -w, 0, w);
  const aims: number[] = [];
  const spots: [number, number][] = [];
  if (sport === 'football') {
    const cr = Math.min(9.15 * M, w * 0.28);
    lay.arc(0, 0, cr, 0, Math.PI * 2);
    lay.arc(0, 0, 0.25 * M, 0, Math.PI * 2);
    const [pd, pw] = [Math.min(16.5 * M, l * 0.32), Math.min(20.15 * M, w * 0.6)];
    const [gd, gw] = [pd / 3, pw * 0.455];
    for (const e of [-1, 1]) {
      lay.rect(e * l, -pw, e * (l - pd), pw);
      lay.rect(e * l, -gw, e * (l - gd), gw);
      const spot = e * (l - (pd * 2) / 3);
      lay.arc(spot, 0, 0.2 * M, 0, Math.PI * 2);
      // The arc outside the area, round the penalty spot.
      const t = Math.acos(Math.min(1, pd / 3 / cr));
      lay.arc(spot, 0, cr, e > 0 ? Math.PI - t : -t, e > 0 ? Math.PI + t : t);
      // The corner arcs, a quarter circle into the pitch from each corner.
      for (const sb of [-1, 1]) {
        const inward = Math.atan2(-sb, -e);
        lay.arc(e * l, sb * w, 0.8 * M, inward - Math.PI / 4, inward + Math.PI / 4);
      }
      const [gx, gy] = lay.at(e * (l + 0.9 * M), 0);
      life.things.push({ kind: big ? 'goal' : 'goalsmall', x: gx, y: gy, angle: lay.goal(e) });
      aims.push(...lay.at(e * l, 0));
      spots.push([e * (l - 0.8 * M), 0]);
    }
  } else if (sport === 'rugby') {
    const inGoal = Math.min(10 * M, l * 0.09);
    const tryLine = l - inGoal;
    for (const e of [-1, 1]) {
      lay.line(e * tryLine, -w, e * tryLine, w);
      lay.line(e * (tryLine - Math.min(22 * M, tryLine * 0.44)), -w, e * (tryLine - Math.min(22 * M, tryLine * 0.44)), w);
      lay.dashed(e * Math.min(10 * M, tryLine * 0.2), -w, e * Math.min(10 * M, tryLine * 0.2), w, 1.5 * M);
      lay.dashed(e * tryLine, -w + 5 * M, 0, -w + 5 * M, 1 * M);
      lay.dashed(e * tryLine, w - 5 * M, 0, w - 5 * M, 1 * M);
      const [px, py] = lay.at(e * tryLine, 0);
      life.things.push({ kind: 'rugbypost', x: px, y: py, angle: lay.across });
      aims.push(...lay.at(e * tryLine, 0));
    }
  } else {
    const r = Math.min(14.63 * M, w * 0.5);
    for (const e of [-1, 1]) {
      lay.line(e * l * 0.5, -w, e * l * 0.5, w);
      // The shooting circle: quarter circles round each post, joined straight.
      const post = 1.83 * M;
      lay.arc(e * l, -post, r, e > 0 ? Math.PI : 0, e > 0 ? (Math.PI * 3) / 2 : -Math.PI / 2);
      lay.arc(e * l, post, r, e > 0 ? Math.PI / 2 : 0, e > 0 ? Math.PI : Math.PI / 2);
      lay.line(e * (l - r), -post, e * (l - r), post);
      lay.arc(e * (l - 6.4 * M), 0, 0.15 * M, 0, Math.PI * 2);
      const [gx, gy] = lay.at(e * (l + 0.6 * M), 0);
      life.things.push({ kind: 'hockeygoal', x: gx, y: gy, angle: lay.goal(e) });
      aims.push(...lay.at(e * l, 0));
      spots.push([e * (l - 0.6 * M), 0]);
    }
  }
  lines(lay, life, !tint, tint && surface !== 'grass' && surface !== 'turf' ? 'court' : 'pitch', lay.ring(-f.hl, -f.hw, f.hl, f.hw));
  if (rand() < (big ? 0.45 : 0.55)) {
    // The rest about the pitch, here and there (a rugby side in a line across it, practising passing).
    const n = sport === 'rugby' ? 8 : 10;
    for (let k = 0; k < n; k++) {
      if (sport === 'rugby') spots.push([(-0.1 + (k % 2) * 0.05 + k * 0.03) * l, (-0.8 + (k * 1.6) / (n - 1)) * w]);
      else spots.push([(rand() * 1.5 - 0.75) * l, (rand() * 1.6 - 0.8) * w]);
    }
    const [x, y] = lay.at(0, 0);
    life.games.push({ kind: sport, x, y, angle: lay.along, spots: lay.pts(spots), aims });
  }
}

/** A cricket field: the square in its middle (a strip mown short, its creases, the stumps), the boundary rope; a game on some. */
function cricket(f: Frame, rand: () => number, life: SportsLife): void {
  const lay = new Layout(f);
  const [half, wide] = [10.06 * M, 1.6 * M];
  if (f.hl < 20 * M || f.hw < 12 * M) return;
  life.areas.push({ kind: 'pitch', rings: [lay.ring(-half - 2 * M, -wide, half + 2 * M, wide)], tint: 'rgba(196,186,128,0.75)' });
  for (const e of [-1, 1]) {
    lay.line(e * half, -1.32 * M, e * half, 1.32 * M);
    lay.line(e * (half - 1.22 * M), -wide, e * (half - 1.22 * M), wide);
    for (const sb of [-1, 1]) lay.line(e * (half + 1.22 * M), sb * 1.32 * M, e * (half - 1.22 * M), sb * 1.32 * M);
    const [sx, sy] = lay.at(e * half, 0);
    life.things.push({ kind: 'stumps', x: sx, y: sy, angle: lay.across });
  }
  // The rope round the boundary, 3 m in from the edge.
  const [ra, rb] = [f.hl - 3 * M, f.hw - 3 * M];
  const n = 72;
  for (let k = 0; k < n; k++) {
    const [t0, t1] = [(k / n) * Math.PI * 2, ((k + 1) / n) * Math.PI * 2];
    lay.line(Math.cos(t0) * ra, Math.sin(t0) * rb, Math.cos(t1) * ra, Math.sin(t1) * rb, WHITE, 1);
  }
  lines(lay, life, true, 'pitch', lay.ring(-f.hl, -f.hw, f.hl, f.hw));
  if (rand() < 0.6) {
    // Bowler (at the end of their run up), batsman, wicket keeper; the fielders round about.
    const spots: [number, number][] = [[-half - 2.5 * M, 0.6 * M], [half - 1.2 * M, 0.3 * M], [half + 3 * M, 0]];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rand() * 0.5;
      const r = 0.45 + rand() * 0.35;
      spots.push([Math.cos(a) * ra * r, Math.sin(a) * rb * r]);
    }
    const [x, y] = lay.at(0, 0);
    life.games.push({ kind: 'cricket', x, y, angle: lay.along, spots: lay.pts(spots), aims: [] });
  }
}

/**
 * A bowling green (its rinks, 5.5 m wide, mown in stripes, the ditch round it) or a croquet lawn (its six hoops and the peg); bowls
 * up some of the rinks, croquet on some lawns.
 */
function lawn(sport: 'bowls' | 'croquet', f: Frame, rand: () => number, life: SportsLife): void {
  const lay = new Layout(f);
  life.areas.push({ kind: 'pitch', rings: [lay.ring(-f.hl, -f.hw, f.hl, f.hw)], tint: LAWN });
  const rink = 5.5 * M;
  const rinks = Math.max(1, Math.floor((2 * f.hw - 1 * M) / rink));
  for (let k = 0; k < rinks; k += 2) {
    const b = (k - (rinks - 1) / 2) * rink;
    lay.line(-f.hl, b, f.hl, b, STRIPE, rink);
  }
  if (sport === 'bowls') {
    lay.rect(-f.hl + 0.2 * M, -f.hw + 0.2 * M, f.hl - 0.2 * M, f.hw - 0.2 * M, 'rgba(78,62,40,0.8)', 3);
    lines(lay, life, true, 'pitch', lay.ring(-f.hl, -f.hw, f.hl, f.hw));
    if (f.hl < 8 * M) return;
    let games = 0;
    for (let k = 0; k < rinks && games < 3; k++) {
      if (rand() > 0.4) continue;
      games++;
      const b = (k - (rinks - 1) / 2) * rink;
      // Two at the mat, one up at the far end, by the jack.
      const spots: [number, number][] = [[-f.hl + 2.5 * M, b - 0.6 * M], [-f.hl + 2.2 * M, b + 0.8 * M], [f.hl - 3.5 * M, b + 0.5 * M]];
      const [x, y] = lay.at(0, b);
      life.games.push({ kind: 'bowls', x, y, angle: lay.along, spots: lay.pts(spots), aims: lay.at(f.hl - 5.5 * M, b + (rand() - 0.5) * 1.5 * M) });
    }
    return;
  }
  // Croquet: the hoops, 6.4 m in from the corners and either side of the peg; the peg in the middle.
  const [ha, hb] = [Math.max(2 * M, f.hl - 6.4 * M), Math.max(2 * M, f.hw - 6.4 * M)];
  const hoops: [number, number][] = [[-ha, -hb], [ha, -hb], [ha, hb], [-ha, hb], [-Math.min(6.4 * M, ha * 0.6), 0], [Math.min(6.4 * M, ha * 0.6), 0]];
  for (const [a, b] of hoops) {
    const [x, y] = lay.at(a, b);
    life.things.push({ kind: 'wicket', x, y, angle: lay.across });
  }
  const [px, py] = lay.at(0, 0);
  life.things.push({ kind: 'peg', x: px, y: py, angle: 0 });
  lines(lay, life, true, 'pitch', lay.ring(-f.hl, -f.hw, f.hl, f.hw));
  if (rand() < 0.5) life.games.push({ kind: 'croquet', x: px, y: py, angle: lay.along, spots: lay.pts([[-ha * 0.5, -hb * 0.3], [ha * 0.3, hb * 0.4]]), aims: lay.pts(hoops) });
}

function hash(x: number, y: number): number {
  return (Math.abs(Math.round(x * 7.31 + y * 13.17) * 2654435761) % 2147483646) + 1;
}

function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
