/**
 * The people on the streets: walking along the pavements and paths,
 * crossing the roads at the crossings (waiting for the lights, or for a gap
 * at a zebra), wandering about the parks and squares, standing outside the
 * shops, cafés and bars, by the water, and in groups at the sights and in the
 * squares; waiting at the bus stops, getting on the buses and off them. More
 * where there's more to go to (as with the traffic). They jump out of the way
 * of a car coming at them, and run (across the roads, if need be) when
 * there's danger about; hit, they're knocked down: by a slow car they get up
 * again and go on their way; by a fast one they stay down. Pure, so it's
 * tested; the scene draws them (PeopleLayer.ts). On the ground and up on
 * the bridges (level 1, as the traffic): only what's on their level gets in
 * their way.
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing } from '../map/osm';
import type { Light } from './lights';
import { offsetLine } from './world';

const M = 8;
/** A vehicle standing still: its middle, which way it points, how long and half as wide, px; its level. */
export interface Block {
  x: number;
  y: number;
  angle: number;
  length: number;
  r: number;
  level: number;
}

/** Walking round a vehicle standing in the way: looking this far ahead, keeping this far from its side, stepping at most this far from the line, px. */
const ROUND_LOOK = 4 * 8;
const ROUND_ROOM = 0.45 * 8;
const ROUND_MOST = 3.5 * 8;

/** How far (x, y) is from the line down a vehicle's middle (its length, less its rounded ends), px. */
function bodyDist(b: Block, x: number, y: number): number {
  const h = Math.max(0, b.length / 2 - b.r);
  const [c, s] = [Math.cos(b.angle), Math.sin(b.angle)];
  const t = Math.max(-h, Math.min(h, (x - b.x) * c + (y - b.y) * s));
  return Math.hypot(x - b.x - c * t, y - b.y - s * t);
}

/** The pavement along a road: how wide, px (as it's drawn). */
const PAVEMENT = 2.4 * M;
/** How fast people walk, px/s (each a little faster or slower), and run. */
const WALK = 1.35 * M;
const RUN = 4.2 * M;
/** At most this many about at once; and how many per unit of how busy it is round you (see `weight`). */
const MOST = 160;
const PER_WEIGHT = 0.5;
/** Kept going this far beyond the view, px; gone beyond `FAR`. */
const NEAR = 30 * M;
const FAR = 55 * M;
/** A hit faster than this, px/s (about 15 mph), and they stay down. */
const HURT = 6.7 * M;
/** How long they're down after a slower hit, s. */
const DOWN: [number, number] = [2.5, 4.5];
/** Running from danger this long, s. */
const SCARED: [number, number] = [4, 7];
/** A person's size: their radius, px, for hits. */
const R = 0.3 * M;

export type Mode = 'walk' | 'stand' | 'wander' | 'kerb' | 'cross' | 'queue' | 'board' | 'flee' | 'dive' | 'down' | 'sit';

/** A bench or picnic table (as the world has it: it can be knocked about, or smashed). */
export interface Seat {
  kind: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  gone?: boolean;
  level: number;
}

/** A picnic on the grass: its blanket (where, which way, which pattern), and how many are sitting round it. */
export interface Picnic {
  x: number;
  y: number;
  angle: number;
  pattern: number;
  /** Packed up and gone (or left behind, and now out of sight). */
  gone: boolean;
}

export interface Person {
  id: number;
  x: number;
  y: number;
  /** Which way they're facing, radians. */
  angle: number;
  /** How fast they're moving, px/s, and which way (when they're thrown, or diving). */
  speed: number;
  vx: number;
  vy: number;
  mode: Mode;
  /** Their clothes and hair (which of the looks), and how quickly they walk. */
  look: number;
  pace: number;
  /** Walking along a line (see `Walks`): which, the point they're heading for, which way along it, and how far to the side of it they keep, px. */
  line: number;
  next: number;
  dir: 1 | -1;
  side: number;
  /** Where they're going (wandering, crossing, to a bus, running away). */
  tx: number;
  ty: number;
  /** For whatever they're doing: how long left (standing about, down, scared), s. */
  timer: number;
  /** The crossing they're at (or just crossed), so they don't go straight back. */
  crossing: number;
  /** The bus stop they're waiting at, or -1. */
  stop: number;
  /** Down for good. */
  hurt: boolean;
  /** How far through a step they are (for drawing them walking), 0 to 1. */
  step: number;
  /** What they were doing before they were scared or knocked down. */
  was: Mode;
  /** The area they're wandering in, or -1. */
  area: number;
  /** Gone (on a bus). */
  gone: boolean;
  /** Getting onto their walk: to (tx, ty) on it first. */
  joining: boolean;
  /** How far they've stepped aside to get round someone, px. */
  avoid: number;
  /** Sitting: on a seat (where on it: along, across, and where the seat was when they sat), or at a picnic. */
  seat: Seat | null;
  seatAt: [number, number, number, number];
  picnic: Picnic | null;
  /** Which level they're on: 0 the ground, 1 a bridge's deck. */
  level: number;
  /** Lying under a vehicle (its id, or null): how far along it they were, px (for its wheels going over them). */
  under: number | null;
  underAlong: number;
}

/** A vehicle as the people see it: where, which way, how big, how fast; a bus's stop. */
export interface Mover {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  vx: number;
  vy: number;
  /** A bus waiting at a stop, with its door open. */
  dwelling?: boolean;
  /** At a bus station, in a bay: where its platform is (people get off to it, and on from it); and whether it's only just pulled in. */
  bay?: [number, number];
  fresh?: boolean;
  /** On a call, its siren going (people get out of its way as from you). */
  siren?: boolean;
  id: number;
  /** Which level it's on (0, the ground, if not given). */
  level?: number;
  /** A bike: it weaves round people (they're only brushed aside), and isn't dived away from. */
  bike?: boolean;
  /** Someone on foot (you, out of a car): nothing to run from. */
  onFoot?: boolean;
}

export interface PeopleView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A line people walk along: a footway, a path, a pavement beside a road. */
interface Walk {
  pts: Pts;
  /** How many walk along it (and stand about on it) for its length, against a quiet pavement's 1. */
  busy: number;
  /** The road it's the pavement of, or -1. */
  road: number;
  /** 0 on the ground, 1 over a bridge. */
  level: number;
  /** A cycle path (bikes come along it). */
  cycle?: boolean;
}

/** Somewhere people stand: outside a shop, by the water, at a sight, in a square; in a group or not, facing which way. */
interface Spot {
  x: number;
  y: number;
  angle: number;
  /** How many are there, for its size, against the pavements' 1 per 10 m. */
  weight: number;
  group: boolean;
  /** On the grass: a picnic, perhaps. */
  grass?: boolean;
}

/** Where a crossing's kerbs are (either side of the road, on the pavement), and how it works. */
interface CrossingPoint {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: 'zebra' | 'lights' | 'plain';
  /** The traffic lights that stop the traffic for it. */
  signals: number[];
}

/** The number of looks (clothes and hair) the drawing has. */
export const LOOKS = 48;

const GRID = 128;
/** How many sit at a bench or picnic table, for how busy it is round it. */
const SEAT_WEIGHT = 0.9;
/** Cells for finding who's close, px. */
const NEAR_CELL = 4 * M;
const key = (x: number, y: number) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`;

export class People {
  readonly people: Person[] = [];
  readonly walks: Walk[] = [];
  readonly spots: Spot[] = [];
  readonly crossings: CrossingPoint[] = [];
  private readonly crossingGrid = new Map<string, number[]>();
  /** The bus stations' yards (and their bounds); and their bays' platforms, x, y. */
  private readonly yards: { ring: Pts; x0: number; y0: number; x1: number; y1: number }[] = [];
  private readonly platforms: [number, number][];
  /**
   * The vehicles standing still near the view (parked, left, stopped): walked
   * round (see `roundBlocks`). Set each frame.
   */
  blocks: Block[] = [];
  /** Where people can be (see `update`), as it was last given. */
  private walkable: (x: number, y: number, level: number) => boolean = () => true;
  /** The bus stops: where people wait (on the pavement by the stop), x, y. */
  readonly stops: [number, number][] = [];
  /** The parks and squares people wander about. */
  private readonly areas: Pts[] = [];
  /** The ends of the walks (index * 2 + 0 for its start, 1 for its end), by where they are; and points along them every 10 m. */
  private readonly ends = new Map<string, number[]>();
  private readonly along = new Map<string, [number, number, number][]>();
  private readonly spotGrid = new Map<string, number[]>();
  /** The roads' carriageways: where people mustn't walk (but to cross). */
  private readonly roads: { pts: Pts; half: number; level: number }[] = [];
  private readonly roadGrid = new Map<string, number[]>();
  private nextId = 1;
  private readonly rand: () => number;
  /** Who's where (by 4 m cells), each frame. */
  private readonly close = new Map<string, Person[]>();
  /** People hit since the scene last looked: who, and how hard (px/s). */
  /**
   * People hit since the scene last looked: who, how hard (px/s), by what
   * (a mover's id: -1 is you), and how: knocked down (`hit`), or lying there
   * and driven over (`over`), a wheel going over them; and how much of its
   * speed it lost (0 to 1).
   */
  readonly hits: { person: Person; speed: number; by?: number; how: 'hit' | 'over'; loss: number }[] = [];

  /** The benches and picnic tables people sit at, and the picnics on the grass. */
  private readonly seats: Seat[];
  private readonly seatGrid = new Map<string, number[]>();
  readonly picnics: Picnic[] = [];

  constructor(
    private readonly map: GameMap,
    options: { rand?: () => number; seats?: Seat[] } = {},
  ) {
    this.rand = options.rand ?? Math.random;
    this.seats = (options.seats ?? []).filter((b) => (b.kind === 'bench' || b.kind === 'picnic') && b.level === 0);
    this.seats.forEach((b, i) => {
      const list = this.seatGrid.get(key(b.x, b.y)) ?? [];
      list.push(i);
      this.seatGrid.set(key(b.x, b.y), list);
    });
    for (const a of map.areas) {
      if (a.kind !== 'yard') continue;
      const ring = a.rings[0];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 1 < ring.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
      this.yards.push({ ring, x0, y0, x1, y1 });
    }
    this.platforms = (map.busStations ?? []).flatMap((st) => st.bays.map((b) => b.platform));
    this.buildWalks();
    this.buildSpots();
    this.buildCrossings();
  }

  // --- What's where ---

  private buildWalks(): void {
    const { roads } = this.map;
    // The carriageways first: the walks are kept off them.
    roads.forEach((r) => {
      if (!VEHICLE_ROADS.has(r.kind) || r.kind === 'track') return;
      this.roads.push({ pts: r.pts, half: r.width / 2, level: r.bridge ? 1 : 0 });
      const k = this.roads.length - 1;
      const index = (x: number, y: number) => {
        const list = this.roadGrid.get(key(x, y)) ?? [];
        if (!list.includes(k)) list.push(k);
        this.roadGrid.set(key(x, y), list);
      };
      for (let j = 0; j + 3 < r.pts.length; j += 2) {
        const len = Math.hypot(r.pts[j + 2] - r.pts[j], r.pts[j + 3] - r.pts[j + 1]);
        // Every cell it passes through, and those either side (a wide road reaches into them).
        for (let d = 0; d <= len; d += GRID / 4) {
          const [x, y] = [r.pts[j] + ((r.pts[j + 2] - r.pts[j]) * d) / (len || 1), r.pts[j + 1] + ((r.pts[j + 3] - r.pts[j + 1]) * d) / (len || 1)];
          for (const [ox, oy] of [[0, 0], [r.width, 0], [-r.width, 0], [0, r.width], [0, -r.width]]) index(x + ox, y + oy);
        }
      }
    });
    /** A walk, less where it runs over a road away from a crossing: in pieces. */
    const add = (line: Pts, busy: number, road: number, level: number) => {
      const pieces: Pts[] = [];
      // (Over the road at a crossing, too: they cross as the crossing says, waiting for the lights or a gap, not walking straight on.)
      // (Nor through a bus station's yard.)
      const keep = (x: number, y: number) => !this.inRoad(x, y, 0.1 * M, level) && (level !== 0 || !this.inYard(x, y));
      // Every metre along it: whether it's kept, and whether it's one of its corners.
      const pts: [number, number, boolean, boolean][] = [];
      for (let i = 0; i + 3 < line.length; i += 2) {
        const [ax, ay, bx, by] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / M));
        for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
          const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
          pts.push([x, y, keep(x, y), s === 0 || s === steps]);
        }
      }
      let piece: number[] = [];
      pts.forEach(([x, y, kept, corner], i) => {
        if (!kept) {
          if (piece.length) pieces.push(piece);
          piece = [];
          return;
        }
        // Its corners, and where it's cut.
        const last = i === pts.length - 1 || !pts[i + 1][2];
        if (corner || !piece.length || last) piece.push(x, y);
      });
      if (piece.length) pieces.push(piece);
      for (const pts of pieces) if (pts.length >= 4 && lengthOf(pts) > 3 * M) this.addWalk(pts, busy, road, level);
    };
    // Over the bridges too (a road bridge's pavements are decks of their own: see Decks), on their level.
    roads.forEach((r, i) => {
      const level = r.bridge ? 1 : 0;
      if (VEHICLE_ROADS.has(r.kind)) {
        if (!r.pavement) return;
        // More people along the busier streets, as with the traffic.
        const busy = Math.min(4, 0.7 + (r.activity ?? 0) * 0.25);
        const off = r.width / 2 + PAVEMENT / 2;
        if (r.pavement !== 'right') add(offsetLine(r.pts, off), busy, i, level);
        if (r.pavement !== 'left') add(offsetLine(r.pts, -off), busy, i, level);
      } else if (r.kind === 'pedestrian') add(r.pts, 2.5, -1, level);
      else if (r.kind === 'footway' || r.kind === 'steps' || r.kind === 'cycleway') add(r.pts, r.kind === 'cycleway' ? 0.3 : 0.9, r.kind === 'cycleway' ? -2 : -1, level);
    });
  }

  private addWalk(pts: Pts, busy: number, road: number, level: number): void {
    const k = this.walks.length;
    // (-2: a cycle path.)
    this.walks.push({ pts, busy, road: Math.max(-1, road), level, ...(road === -2 ? { cycle: true } : {}) });
    const n = pts.length;
    for (const [end, x, y] of [[0, pts[0], pts[1]], [1, pts[n - 2], pts[n - 1]]] as const) {
      const list = this.ends.get(key(x, y)) ?? [];
      list.push(k * 2 + end);
      this.ends.set(key(x, y), list);
    }
    for (let i = 0; i + 3 < n; i += 2) {
      const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      for (let d = 0; d < len; d += 10 * M) {
        const t = d / len;
        const [x, y] = [pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t];
        const list = this.along.get(key(x, y)) ?? [];
        list.push([k, i / 2, t]);
        this.along.set(key(x, y), list);
      }
    }
  }

  private buildSpots(): void {
    const { map } = this;
    // The parks and squares: people wander about them, and stand about in groups.
    for (const a of map.areas) {
      if (a.kind !== 'park' && a.kind !== 'plaza' && a.kind !== 'grass' && a.kind !== 'garden' && a.kind !== 'pitch' && a.kind !== 'play') continue;
      const ring = a.rings[0];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < ring.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
      const area = Math.abs(polyArea(ring));
      if (area < 150 * M * M) continue;
      this.areas.push(ring);
      const count = Math.min(30, Math.round(area / (500 * M * M)) + 1);
      for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
        const [x, y] = [x0 + this.rand() * (x1 - x0), y0 + this.rand() * (y1 - y0)];
        if (!pointInRing(x, y, ring)) continue;
        // A square's busier than a lawn.
        this.addSpot({ x, y, angle: this.rand() * Math.PI * 2, weight: a.kind === 'plaza' ? 1.6 : 0.8, group: this.rand() < 0.55, grass: a.kind === 'park' || a.kind === 'grass' || a.kind === 'garden' });
        k++;
      }
    }
    // Outside the shops, cafés and bars, on the pavement; at the sights, in groups.
    const v = map.venues ?? [];
    for (let i = 0; i + 2 < v.length; i += 3) {
      const [x, y, kind] = [v[i], v[i + 1], v[i + 2]];
      const near = this.nearestWalk(x, y, (kind ? 30 : 16) * M);
      if (!near) continue;
      const [px, py] = near;
      // Facing it (or the sight), a little towards it from the middle of the pavement.
      const angle = Math.atan2(y - py, x - px);
      const d = Math.hypot(x - px, y - py) || 1;
      const nudge = Math.min(d, 0.7 * M);
      this.addSpot({ x: px + ((x - px) / d) * nudge, y: py + ((y - py) / d) * nudge, angle, weight: kind ? 4 : 1.6, group: kind === 1 || this.rand() < 0.25 });
    }
    // By the water: on the quays, looking out over it.
    for (const p of map.props) {
      if (p.kind !== 'mooring' && p.kind !== 'lifering') continue;
      const water = this.towardWater(p.x, p.y);
      if (water === null) continue;
      const [x, y] = [p.x - Math.cos(water) * 1.5 * M, p.y - Math.sin(water) * 1.5 * M];
      this.addSpot({ x, y, angle: water, weight: 0.7, group: this.rand() < 0.3 });
    }
    // The bus stops: by each route's stops, on the pavement.
    const seen = new Set<string>();
    for (const r of map.busRoutes ?? []) {
      for (let i = 0; i + 1 < r.stops.length; i += 2) {
        const k = `${Math.round(r.stops[i] / 40)},${Math.round(r.stops[i + 1] / 40)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        // (Not at a bus station's: people get on and off there at its bays, from its platforms: see `buses`.)
        if (this.platforms.some(([px, py]) => Math.hypot(px - r.stops[i], py - r.stops[i + 1]) < 30 * M)) continue;
        const near = this.nearestWalk(r.stops[i], r.stops[i + 1], 12 * M);
        if (near) this.stops.push([near[0], near[1]]);
      }
    }
  }

  private addSpot(s: Spot): void {
    if (this.inYard(s.x, s.y)) return;
    const k = this.spots.length;
    this.spots.push(s);
    const list = this.spotGrid.get(key(s.x, s.y)) ?? [];
    list.push(k);
    this.spotGrid.set(key(s.x, s.y), list);
  }

  private buildCrossings(): void {
    const { map } = this;
    for (const c of map.crossings) {
      const r = c.road !== undefined ? map.roads[c.road] : undefined;
      if (r?.bridge) continue;
      const [nx, ny] = [-Math.sin(c.angle), Math.cos(c.angle)];
      const off = c.width / 2 + 1.2 * M;
      const signals: number[] = [];
      if (c.kind === 'lights') map.signals.forEach((s, i) => {
        if (Math.hypot(s.x - c.x, s.y - c.y) < 30 * M && (c.controller === undefined || s.controller === c.controller)) signals.push(i);
      });
      const k = this.crossings.length;
      this.crossings.push({ ax: c.x + nx * off, ay: c.y + ny * off, bx: c.x - nx * off, by: c.y - ny * off, kind: c.kind, signals });
      // (By where its kerbs are, and round them: only those near someone walking are looked at.)
      for (const [x, y] of [[c.x + nx * off, c.y + ny * off], [c.x - nx * off, c.y - ny * off]]) {
        for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
          const cell = key(x + ox * 3 * M, y + oy * 3 * M);
          const list = this.crossingGrid.get(cell) ?? [];
          if (!list.includes(k)) list.push(k);
          this.crossingGrid.set(cell, list);
        }
      }
    }
  }

  /** The nearest point on a walk (on a level) to (x, y), within `reach` px: x, y, which walk, which segment, how far along it. */
  private nearestWalk(x: number, y: number, reach: number, offRoad = false, level = 0): [number, number, number, number, number] | null {
    let best: [number, number, number, number, number] | null = null;
    let bestD = reach;
    const cells = Math.ceil(reach / GRID) + 1;
    const seen = new Set<number>();
    for (let i = -cells; i <= cells; i++) {
      for (let j = -cells; j <= cells; j++) {
        for (const [k] of this.along.get(key(x + i * GRID, y + j * GRID)) ?? []) {
          if (seen.has(k) || this.walks[k].level !== level) continue;
          seen.add(k);
          const p = this.walks[k].pts;
          for (let s = 0; s + 3 < p.length; s += 2) {
            const [ax, ay, bx, by] = [p[s], p[s + 1], p[s + 2], p[s + 3]];
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
            const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
            const d = Math.hypot(px - x, py - y);
            if (d < bestD && (!offRoad || this.clear(x, y, px, py, level))) [best, bestD] = [[px, py, k, s / 2, t], d];
          }
        }
      }
    }
    return best;
  }

  /** Which way the nearest water is from a point (within 12 m), radians, or null. */
  private towardWater(x: number, y: number): number | null {
    let best = 12 * M;
    let angle: number | null = null;
    for (const a of this.map.areas) {
      if (a.kind !== 'water') continue;
      const ring = a.rings[0];
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
        const d = Math.hypot(px - x, py - y);
        if (d < best) [best, angle] = [d, Math.atan2(py - y, px - x)];
      }
    }
    return angle;
  }

  /** Whether the way from one point to another keeps off the roads. */
  private clear(ax: number, ay: number, bx: number, by: number, level = 0): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / M);
    for (let s = 1; s < steps; s++) {
      const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
      if (this.inRoad(x, y, undefined, level)) return false;
    }
    return true;
  }

  /** Whether a point's on a road's carriageway (on a level: where people only go to cross, or running). */
  /** Whether (x, y) is in a bus station's yard (no one walks about in it: it's all buses). */
  inYard(x: number, y: number): boolean {
    for (const a of this.yards) if (x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1 && pointInRing(x, y, a.ring)) return true;
    return false;
  }

  inRoad(x: number, y: number, margin = -0.5 * M, level = 0): boolean {
    for (const k of this.roadGrid.get(key(x, y)) ?? []) {
      const { pts, half, level: on } = this.roads[k];
      if (on !== level) continue;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        if (Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y) < half + margin) return true;
      }
    }
    return false;
  }

  // --- Coming and going ---

  private make(x: number, y: number, mode: Mode): Person {
    const p: Person = {
      id: this.nextId++,
      x,
      y,
      angle: this.rand() * Math.PI * 2,
      speed: 0,
      vx: 0,
      vy: 0,
      mode,
      look: Math.floor(this.rand() * LOOKS),
      pace: WALK * (0.8 + this.rand() * 0.4),
      line: -1,
      next: 0,
      dir: 1,
      side: (this.rand() - 0.5) * 0.9 * M,
      tx: x,
      ty: y,
      timer: 0,
      crossing: -1,
      stop: -1,
      hurt: false,
      step: this.rand(),
      was: mode,
      area: -1,
      gone: false,
      joining: false,
      avoid: 0,
      seat: null,
      seatAt: [0, 0, 0, 0],
      picnic: null,
      level: 0,
      under: null,
      underAlong: 0,
    };
    // (Never in a vehicle standing there: gone again at once.)
    if (this.blocks.some((b) => Math.abs(b.x - x) < b.length && Math.abs(b.y - y) < b.length && bodyDist(b, x, y) < b.r + 0.3 * M)) p.gone = true;
    this.people.push(p);
    return p;
  }

  /** Someone walking along walk `k`, from segment `seg` (t along it), one way or the other. */
  private walker(k: number, seg: number, t: number, side?: number): Person {
    const w = this.walks[k].pts;
    const [ax, ay, bx, by] = [w[seg * 2], w[seg * 2 + 1], w[seg * 2 + 2], w[seg * 2 + 3]];
    const p = this.make(ax + (bx - ax) * t, ay + (by - ay) * t, 'walk');
    this.onto(p, k, seg, this.rand() < 0.5 ? 1 : -1);
    if (side !== undefined) p.side = side;
    return p;
  }

  /** Puts someone onto a walk at a segment, heading one way along it (getting onto it at (x, y) first, if they're not on it). */
  private onto(p: Person, k: number, seg: number, dir: 1 | -1, at?: [number, number]): void {
    p.mode = 'walk';
    p.line = k;
    // On its level (getting onto it, once they're on it: where one walk goes on onto another up on a bridge, it's at the deck's end, level with the ground).
    if (!at) p.level = this.walks[k].level;
    p.dir = dir;
    p.next = dir === 1 ? seg + 1 : seg;
    p.joining = !!at;
    if (at) [p.tx, p.ty] = at;
  }

  /** How busy it is round a point: the walks' and the spots' weights near it. */
  private weightNear(x0: number, y0: number, x1: number, y1: number): number {
    let w = 0;
    for (let x = Math.floor(x0 / GRID); x <= Math.floor(x1 / GRID); x++) {
      for (let y = Math.floor(y0 / GRID); y <= Math.floor(y1 / GRID); y++) {
        for (const [k] of this.along.get(`${x},${y}`) ?? []) w += this.walks[k].busy;
        for (const s of this.spotGrid.get(`${x},${y}`) ?? []) w += this.spots[s].weight;
        w += (this.seatGrid.get(`${x},${y}`)?.length ?? 0) * SEAT_WEIGHT;
      }
    }
    return w;
  }

  /** Keeps the streets round the view as busy as they should be: people coming into being out of sight (or anywhere, `all`), gone once they're far off. */
  populate(view: PeopleView, all = false): void {
    const [x0, y0, x1, y1] = [view.x0 - NEAR, view.y0 - NEAR, view.x1 + NEAR, view.y1 + NEAR];
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.x < view.x0 - FAR || p.x > view.x1 + FAR || p.y < view.y0 - FAR || p.y > view.y1 + FAR || p.gone) this.people.splice(i, 1);
    }
    // Picnics: gone once no one's at them and they're out of sight (or far off).
    for (let i = this.picnics.length - 1; i >= 0; i--) {
      const c = this.picnics[i];
      const far = c.x < view.x0 - FAR || c.x > view.x1 + FAR || c.y < view.y0 - FAR || c.y > view.y1 + FAR;
      const outOfSight = c.x < view.x0 - 3 * M || c.x > view.x1 + 3 * M || c.y < view.y0 - 3 * M || c.y > view.y1 + 3 * M;
      if (far || c.gone || (outOfSight && !this.people.some((p) => p.picnic === c))) this.picnics.splice(i, 1);
    }
    const want = Math.min(MOST, this.weightNear(x0, y0, x1, y1) * PER_WEIGHT);
    const seen = (x: number, y: number) => !all && x > view.x0 - 2 * M && x < view.x1 + 2 * M && y > view.y0 - 2 * M && y < view.y1 + 2 * M;
    for (let tries = 0; tries < (all ? 400 : 6) && this.people.length < want; tries++) {
      const [x, y] = [x0 + this.rand() * (x1 - x0), y0 + this.rand() * (y1 - y0)];
      if (seen(x, y)) continue;
      const cell = key(x, y);
      // A spot, or a walk, by how busy each is.
      const spots = this.spotGrid.get(cell) ?? [];
      const walks = this.along.get(cell) ?? [];
      const seats = (this.seatGrid.get(cell) ?? []).filter((k) => !this.seats[k].gone && !seen(this.seats[k].x, this.seats[k].y) && !this.people.some((q) => q.seat === this.seats[k]));
      const sw = spots.reduce((s, k) => s + this.spots[k].weight, 0);
      const ww = walks.reduce((s, [k]) => s + this.walks[k].busy, 0);
      const cw = seats.length * SEAT_WEIGHT;
      if (sw + ww + cw <= 0) continue;
      const pick = this.rand() * (sw + ww + cw);
      if (pick >= sw + ww) {
        this.sitDown(this.seats[seats[Math.floor(this.rand() * seats.length)]]);
      } else if (pick < sw) {
        let r = this.rand() * sw;
        const k = spots.find((s) => (r -= this.spots[s].weight) <= 0) ?? spots[0];
        this.atSpot(this.spots[k]);
      } else {
        const [k, seg, t] = walks[Math.floor(this.rand() * walks.length)];
        const p = this.walker(k, seg, t);
        // Some walk in twos, side by side.
        if (this.rand() < 0.2) {
          const q = this.walker(k, seg, t, p.side + 0.7 * M * (p.side > 0 ? -1 : 1));
          Object.assign(q, { dir: p.dir, next: p.next, pace: p.pace });
        }
      }
    }
    // Waiting at the bus stops near the view.
    for (const [i, [sx, sy]] of this.stops.entries()) {
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || seen(sx, sy)) continue;
      const waiting = this.people.filter((p) => p.stop === i).length;
      if (waiting < 1 + (i % 3) && this.rand() < 0.02) {
        const a = this.rand() * Math.PI * 2;
        const p = this.make(sx + Math.cos(a) * 1.2 * M, sy + Math.sin(a) * 1.2 * M, 'queue');
        p.stop = i;
      }
    }
  }

  /** Someone (or a group) at a spot, standing about; in a park or square, some wander off about it. */
  private atSpot(s: Spot): void {
    // On the grass in a park: a picnic, now and then: a blanket, and two to five sitting round it.
    if (s.grass && this.rand() < 0.35 && !this.underTree(s.x, s.y)) {
      const picnic: Picnic = { x: s.x, y: s.y, angle: this.rand() * Math.PI, pattern: Math.floor(this.rand() * 4), gone: false };
      this.picnics.push(picnic);
      const n = 2 + Math.floor(this.rand() * 4);
      const time = 60 + this.rand() * 180;
      for (let k = 0; k < n; k++) {
        const a = picnic.angle + (k / n) * Math.PI * 2;
        const p = this.make(s.x + Math.cos(a) * 1.1 * M, s.y + Math.sin(a) * 0.9 * M, 'sit');
        p.picnic = picnic;
        p.angle = a + Math.PI;
        p.timer = time + this.rand() * 10;
      }
      return;
    }
    const area = this.areas.findIndex((ring) => pointInRing(s.x, s.y, ring));
    if (area >= 0 && !s.group && this.rand() < 0.6) {
      const p = this.make(s.x, s.y, 'wander');
      p.area = area;
      [p.tx, p.ty] = [s.x, s.y];
      return;
    }
    const n = s.group ? 2 + Math.floor(this.rand() * (area >= 0 ? 4 : 3)) : this.rand() < 0.3 ? 2 : 1;
    const r = n === 1 ? 0 : (0.55 + n * 0.1) * M;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rand() * 0.4;
      const p = this.make(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 'stand');
      // A group faces in, to each other; on their own, the way the spot faces.
      p.angle = n > 1 ? a + Math.PI : s.angle + (this.rand() - 0.5) * 0.6;
      p.timer = 30 + this.rand() * 120;
    }
  }

  /** Whether a point's under a tree's crown (no picnics there: it'd be hidden, and it's shady). */
  private underTree(x: number, y: number): boolean {
    const t = this.map.trees;
    for (let i = 0; i < t.length; i += 4) if (Math.abs(t[i] - x) < 60 && Math.abs(t[i + 1] - y) < 60 && Math.hypot(t[i] - x, t[i + 1] - y) < t[i + 2] + 1.5 * M) return true;
    return false;
  }

  /** One or two sitting on a bench (facing one way off it), or two to four round a picnic table. */
  private sitDown(seat: Seat): void {
    const bench = seat.kind === 'bench';
    // A bench faces one way: the same each time for the same bench.
    const facing = (Math.floor(seat.x * 7 + seat.y * 13) & 1) === 0 ? 1 : -1;
    const places: [number, number][] = bench
      ? [[-0.45 * M, 0.35 * M * facing], [0.45 * M, 0.35 * M * facing]]
      : [[-0.5 * M, 0.75 * M], [0.5 * M, 0.75 * M], [-0.5 * M, -0.75 * M], [0.5 * M, -0.75 * M]];
    const n = bench ? (this.rand() < 0.6 ? 1 : 2) : 2 + Math.floor(this.rand() * 3);
    const time = 20 + this.rand() * 100;
    for (const [u, v] of places.sort(() => this.rand() - 0.5).slice(0, n)) {
      const p = this.make(seat.x, seat.y, 'sit');
      p.seat = seat;
      p.seatAt = [u, v, seat.x, seat.y];
      p.timer = time + this.rand() * 20;
      this.onSeat(p);
    }
  }

  /** Where they sit on their seat, as it is now, facing out from it (a bench) or in across it (a picnic table). */
  private onSeat(p: Person): void {
    const s = p.seat!;
    const [u, v] = p.seatAt;
    const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
    p.x = s.x + ux * u - uy * v;
    p.y = s.y + uy * u + ux * v;
    const out = s.kind === 'bench' ? Math.sign(v) : -Math.sign(v);
    p.angle = s.angle + (Math.PI / 2) * out;
    p.speed = 0;
  }

  /** Sitting: a while, then up and off (a picnic packs up together). Their seat knocked from under them: knocked down; smashed or shoved away: up. */
  private sit(p: Person, dt: number): void {
    p.timer -= dt;
    const s = p.seat;
    if (s) {
      const moved = Math.hypot(s.x - p.seatAt[2], s.y - p.seatAt[3]);
      if (s.gone || moved > 0.4 * M) {
        p.seat = null;
        if (Math.hypot(s.vx, s.vy) > 3 * M) this.knock(p, { vx: s.vx, vy: s.vy }, Math.hypot(s.vx, s.vy));
        else this.rejoin(p);
        return;
      }
      this.onSeat(p);
    }
    if (p.timer > 0) return;
    if (p.picnic) {
      // Packing up: the blanket goes with the last of them.
      const c = p.picnic;
      p.picnic = null;
      if (!this.people.some((q) => q.picnic === c)) c.gone = true;
    }
    p.seat = null;
    this.rejoin(p);
  }

  // --- Each frame ---

  /**
   * Everyone does what they're doing. `player` and `movers` are the vehicles
   * (yours first): they're got out of the way of, run from, and hit by.
   * `light` says what a traffic light's showing. `walkable` says whether
   * somewhere's open ground on a level (not in the water or a building, or
   * off the edge of a bridge's deck). `levelAt` says which level someone's on
   * now, having been on one (up onto a deck at its ends, down off it).
   */
  update(
    dt: number,
    view: PeopleView,
    player: Mover,
    movers: Mover[],
    light: (signal: number) => Light,
    walkable: (x: number, y: number, level: number) => boolean,
    levelAt: (level: number, x: number, y: number) => number = (level) => level,
  ): void {
    this.populate(view);
    this.walkable = walkable;
    const all = [player, ...movers];
    // Danger: you, going fast right by them (or along the pavement at them); and anything on a call, its siren going.
    for (const m of [...(player.onFoot ? [] : [player]), ...movers.filter((o) => o.siren)]) {
      const pspeed = Math.hypot(m.vx, m.vy);
      const plevel = m.level ?? 0;
      for (const p of this.people) {
        if (p.mode === 'down' || p.mode === 'board' || p.level !== plevel) continue;
        // (Within a second of it, at most: as far as it's seen coming.)
        const reach = Math.max(6 * M, pspeed) + 2 * M;
        if (Math.abs(p.x - m.x) > reach || Math.abs(p.y - m.y) > reach) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        const onPavement = pspeed > 5 * M && d < 5 * M && !this.inRoad(m.x, m.y, undefined, plevel);
        if ((pspeed > 8 * M && d < 3.5 * M) || onPavement) this.scare(p, m.x, m.y);
        if ((p.mode as Mode) !== 'dive' && !m.bike) this.dodge(p, m, pspeed);
      }
    }
    // Who's where, for stepping round each other.
    this.close.clear();
    for (const p of this.people) {
      if (p.mode === 'board' || p.mode === 'flee' || p.mode === 'dive') continue;
      const k = `${Math.floor(p.x / NEAR_CELL)},${Math.floor(p.y / NEAR_CELL)}`;
      const list = this.close.get(k);
      if (list) list.push(p);
      else this.close.set(k, [p]);
    }
    for (const p of this.people) {
      switch (p.mode) {
        case 'walk':
          this.walk(p, dt);
          break;
        case 'wander':
          this.wander(p, dt);
          break;
        case 'sit':
          this.sit(p, dt);
          break;
        case 'stand':
          p.timer -= dt;
          if (p.timer < 0) this.leave(p);
          break;
        case 'kerb':
          this.atKerb(p, dt, all, light);
          break;
        case 'cross':
          if (this.goTo(p, p.tx, p.ty, p.pace * 1.15, dt)) this.rejoin(p);
          break;
        case 'queue':
          this.queue(p, movers);
          break;
        case 'board':
          // To the bus's door, and on.
          if (this.goTo(p, p.tx, p.ty, p.pace * 1.2, dt)) p.gone = true;
          break;
        case 'flee':
          this.flee(p, dt, walkable);
          break;
        case 'dive':
        case 'down':
          this.thrown(p, dt, walkable);
          break;
      }
      if (p.speed > 0 && p.mode !== 'down') p.step = (p.step + (dt * p.speed) / (0.75 * M)) % 1;
      p.level = levelAt(p.level, p.x, p.y);
    }
    this.hitBy(all);
    this.buses(movers, dt);
  }

  /** Along their walk, keeping to their side of it; at its end, on to another starting there (or back the way they came). */
  private walk(p: Person, dt: number): void {
    const w = this.walks[p.line]?.pts;
    if (!w) return this.leave(p);
    if (p.joining) {
      if (this.goTo(p, p.tx, p.ty, p.pace, dt)) {
        p.joining = false;
        p.level = this.walks[p.line].level;
      }
      return;
    }
    const n = w.length / 2;
    const [tx, ty] = [w[p.next * 2], w[p.next * 2 + 1]];
    const [px, py] = [w[(p.next - p.dir) * 2] ?? tx, w[(p.next - p.dir) * 2 + 1] ?? ty];
    const len = Math.hypot(tx - px, ty - py) || 1;
    const [ux, uy] = [(tx - px) / len, (ty - py) / len];
    // Stepping round anyone in the way (and slowing behind someone slower): see `make way`; and round a vehicle standing there.
    const along = (p.x - px) * ux + (p.y - py) * uy;
    const round = this.roundBlocks(p, px, py, ux, uy, along);
    const [shift, slower] = round === null ? this.makeWay(p, ux, uy) : [round, Infinity];
    // (No way round: they wait. Round one: briskly aside, slowing till they're far enough over.)
    let slow = Number.isNaN(round) ? 0 : slower;
    const rate = round !== null ? 3 * M : 1.6 * M;
    if (!Number.isNaN(shift)) p.avoid += Math.max(-rate * dt, Math.min(rate * dt, shift - p.avoid));
    if (round !== null && !Number.isNaN(shift) && Math.abs(shift - p.avoid) > 0.2 * M) slow = Math.min(slow, p.pace * 0.25);
    // Steering for a point a couple of metres on along the line (or its next corner), to one side of it.
    // (Going round a vehicle: steering for nearer on, to keep to the way round it.)
    const ahead = Math.min(len, along + (round !== null ? 0.8 : 2) * M);
    const wide = round !== null ? ROUND_MOST : 1.05 * M;
    const off = Math.max(-wide, Math.min(wide, p.side + p.avoid));
    const [sx, sy] = [px + ux * ahead - uy * off, py + uy * ahead + ux * off];
    this.goTo(p, sx, sy, Math.min(p.pace, slow), dt, 0.05 * M);
    if (len - along < 0.6 * M) {
      p.next += p.dir;
      if (p.next < 0 || p.next >= n) this.endOfWalk(p);
    }
    // Passing a crossing: now and then, over the road.
    if (p.mode === 'walk' && this.rand() < dt * 3) {
      for (const i of this.crossingGrid.get(key(p.x, p.y)) ?? []) {
        const c = this.crossings[i];
        if (i === p.crossing) continue;
        for (const [kx, ky, fx, fy] of [[c.ax, c.ay, c.bx, c.by], [c.bx, c.by, c.ax, c.ay]]) {
          if (Math.hypot(kx - p.x, ky - p.y) > 2.5 * M) continue;
          if (this.rand() < 0.5) {
            p.mode = 'kerb';
            p.crossing = i;
            [p.tx, p.ty] = [fx, fy];
            p.timer = 0;
            p.angle = Math.atan2(fy - p.y, fx - p.x);
          } else p.crossing = i;
        }
      }
    }
  }

  /**
   * A vehicle standing in the way (up on the pavement, or across the path),
   * walking along the line from (px, py), (ux, uy), `along` it: how far to
   * step aside (from the line's middle, less their own side) to get past it
   * with room, the nearer way that's open ground (away from it first); NaN if
   * there's no way round (they wait); null if nothing's in the way.
   */
  private roundBlocks(p: Person, px: number, py: number, ux: number, uy: number, along: number): number | null {
    if (!this.blocks.length) return null;
    const [nx, ny] = [-uy, ux];
    // What's a few metres ahead, near the way they're walking.
    const near = this.blocks.filter((b) => b.level === p.level && Math.abs(b.x - p.x) < b.length / 2 + 6 * M && Math.abs(b.y - p.y) < b.length / 2 + 6 * M);
    if (!near.length) return null;
    const clear = (off: number) => {
      for (let d = -0.75 * M; d <= ROUND_LOOK; d += 0.5 * M) {
        const [x, y] = [px + ux * (along + d) + nx * off, py + uy * (along + d) + ny * off];
        for (const b of near) if (bodyDist(b, x, y) < b.r + ROUND_ROOM) return false;
      }
      return true;
    };
    const now = p.side + p.avoid;
    if (clear(now)) {
      // (Already past or round it: keep the step they've taken while it's beside them.)
      return p.avoid !== 0 && !clear(p.side) ? p.avoid : null;
    }
    // Which side it's on: step away from it first.
    let across = 0;
    for (const b of near) across += (b.x - p.x) * nx + (b.y - p.y) * ny;
    const first = across > 0 ? -1 : 1;
    for (let k = 1; k * 0.25 * M <= ROUND_MOST; k++) {
      for (const side of [first, -first]) {
        const off = p.side + side * k * 0.25 * M;
        if (Math.abs(off) > ROUND_MOST || !clear(off)) continue;
        // On open ground there (not the water, a wall, a building).
        const [x, y] = [px + ux * (along + 1.5 * M) + nx * off, py + uy * (along + 1.5 * M) + ny * off];
        if (!this.walkable(x, y, p.level)) continue;
        return off - p.side;
      }
    }
    return Number.NaN;
  }

  /**
   * Anyone in the way, walking along (ux, uy): how far to step to the side to
   * get round them (to the side away from them; head on, each keeps to their
   * left), px, and how fast to go (no faster than someone close in front going
   * the same way).
   */
  private makeWay(p: Person, ux: number, uy: number): [number, number] {
    let shift = 0;
    let slow = Infinity;
    const cx = Math.floor(p.x / NEAR_CELL);
    const cy = Math.floor(p.y / NEAR_CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const q of this.close.get(`${cx + i},${cy + j}`) ?? []) {
          if (q === p || q.level !== p.level) continue;
          const [rx, ry] = [q.x - p.x, q.y - p.y];
          const ahead = rx * ux + ry * uy;
          if (ahead <= 0 || ahead > 2 * M) continue;
          const across = -rx * uy + ry * ux;
          if (Math.abs(across) > 0.8 * M) continue;
          const sameWay = q.speed > 2 && Math.cos(q.angle) * ux + Math.sin(q.angle) * uy > 0.7;
          // Close behind someone going the same way: keep pace with them (or pass, if there's room and they're slow).
          if (sameWay && ahead < 1.2 * M && q.speed < p.pace * 0.85) slow = Math.min(slow, q.speed);
          if (sameWay && q.speed >= p.pace * 0.85) continue;
          // Round them: away from the side they're on (dead ahead, to the left, as Britons do).
          const side = Math.abs(across) < 0.1 * M ? -1 : -Math.sign(across);
          const need = (0.85 * M - Math.abs(across)) * side;
          if (Math.abs(need) > Math.abs(shift)) shift = need;
        }
      }
    }
    return [shift, slow];
  }

  /** At the end of a walk: on along another that starts (or ends) near here, or back. */
  private endOfWalk(p: Person): void {
    const choices: number[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const e of this.ends.get(key(p.x + i * GRID, p.y + j * GRID)) ?? []) {
          const k = e >> 1;
          if (k === p.line) continue;
          const w = this.walks[k].pts;
          const [x, y] = e & 1 ? [w[w.length - 2], w[w.length - 1]] : [w[0], w[1]];
          if (Math.hypot(x - p.x, y - p.y) < 6 * M && this.clear(p.x, p.y, x, y, p.level)) choices.push(e);
        }
      }
    }
    if (!choices.length) {
      // A dead end: back the way they came.
      p.dir = p.dir === 1 ? -1 : 1;
      p.next = Math.max(0, Math.min(this.walks[p.line].pts.length / 2 - 1, p.next + p.dir * 2));
      return;
    }
    const e = choices[Math.floor(this.rand() * choices.length)];
    const k = e >> 1;
    const w = this.walks[k].pts;
    const n = w.length / 2;
    this.onto(p, k, e & 1 ? n - 2 : 0, e & 1 ? -1 : 1, e & 1 ? [w[w.length - 2], w[w.length - 1]] : [w[0], w[1]]);
  }

  /** Wandering about a park or square: to somewhere in it, a while there, then somewhere else. */
  private wander(p: Person, dt: number): void {
    if (p.timer > 0) {
      p.timer -= dt;
      p.speed = 0;
      return;
    }
    if (this.goTo(p, p.tx, p.ty, p.pace * 0.8, dt)) {
      p.timer = this.rand() < 0.4 ? 3 + this.rand() * 15 : 0;
      const ring = this.areas[p.area];
      for (let tries = 0; ring && tries < 10; tries++) {
        const a = this.rand() * Math.PI * 2;
        const d = (5 + this.rand() * 25) * M;
        const [x, y] = [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
        if (pointInRing(x, y, ring)) {
          [p.tx, p.ty] = [x, y];
          return;
        }
      }
      // Can't find anywhere: off along a path, if there's one near.
      this.rejoin(p);
    }
  }

  /** Done standing about: off along the nearest walk (or wandering, in a park). */
  private leave(p: Person): void {
    this.rejoin(p);
  }

  /** Back to walking: onto the nearest walk within 15 m (or wandering about the park they're in; or standing a while longer). */
  private rejoin(p: Person): void {
    const near = this.inRoad(p.x, p.y, undefined, p.level) ? this.nearestWalk(p.x, p.y, 15 * M, false, p.level) : this.nearestWalk(p.x, p.y, 15 * M, true, p.level);
    if (near) {
      const [x, y, k, seg] = near;
      this.onto(p, k, seg, this.rand() < 0.5 ? 1 : -1, [x, y]);
      return;
    }
    const area = this.areas.findIndex((ring) => pointInRing(p.x, p.y, ring));
    if (area >= 0) {
      p.mode = 'wander';
      p.area = area;
      [p.tx, p.ty] = [p.x, p.y];
      return;
    }
    p.mode = 'stand';
    p.speed = 0;
    p.timer = 20 + this.rand() * 40;
  }

  /** Waiting at the kerb to cross: for the lights to stop the traffic, or a gap in it (then over). Not for ever. */
  private atKerb(p: Person, dt: number, all: Mover[], light: (signal: number) => Light): void {
    p.speed = 0;
    p.timer += dt;
    const c = this.crossings[p.crossing];
    let go: boolean;
    if (c.kind === 'lights' && c.signals.length) go = c.signals.every((s) => light(s) === 'red');
    else {
      // A gap: nothing coming within a few seconds of it.
      const [mx, my] = [(c.ax + c.bx) / 2, (c.ay + c.by) / 2];
      go = all.every((v) => {
        const d = Math.hypot(v.x - mx, v.y - my);
        const toward = ((mx - v.x) * v.vx + (my - v.y) * v.vy) / (d || 1);
        return d > 6 * M + Math.max(0, toward) * (c.kind === 'zebra' ? 2 : 3.5);
      });
    }
    if (go && this.rand() < dt * 2.5) p.mode = 'cross';
    else if (p.timer > 40) this.rejoin(p);
  }

  /** Waiting at a bus stop: standing about, facing the road. */
  private queue(p: Person, movers: Mover[]): void {
    p.speed = 0;
    const [sx, sy] = this.stops[p.stop];
    // A bus at the stop, its door open: over to it, and on.
    for (const b of movers) {
      if (!b.dwelling || Math.hypot(b.x - sx, b.y - sy) > 20 * M) continue;
      p.mode = 'board';
      p.stop = -1;
      [p.tx, p.ty] = door(b);
      return;
    }
  }

  /** Buses at their stops: those waiting get on (see `queue`); and a few get off, and walk away. */
  private readonly served = new Set<number>();
  private buses(movers: Mover[], dt: number): void {
    for (const b of movers) {
      if (!b.dwelling) {
        this.served.delete(b.id);
        continue;
      }
      if (b.bay) {
        this.bay(b, b.bay, dt);
        continue;
      }
      if (this.served.has(b.id)) continue;
      this.served.add(b.id);
      const [dx, dy] = door(b);
      for (let k = Math.floor(this.rand() * 4); k > 0; k--) {
        const p = this.make(dx + (this.rand() - 0.5) * M, dy + (this.rand() - 0.5) * M, 'walk');
        this.rejoin(p);
      }
    }
  }

  /**
   * A bus in its bay at a bus station: as it pulls in, those on it get off,
   * up onto the platform and into the station; all the while it's there,
   * others come out to it now and then, and get on.
   */
  private bay(b: Mover, [px, py]: [number, number], dt: number): void {
    const [dx, dy] = door(b);
    const d = Math.hypot(px - dx, py - dy) || 1;
    const [ux, uy] = [(px - dx) / d, (py - dy) / d];
    if (!this.served.has(b.id)) {
      this.served.add(b.id);
      for (let k = b.fresh ? 1 + Math.floor(this.rand() * 5) : 0; k > 0; k--) {
        const p = this.make(dx + (this.rand() - 0.5) * M, dy + (this.rand() - 0.5) * M, 'board');
        [p.tx, p.ty] = [px + ux * 2.5 * M + (this.rand() - 0.5) * 2 * M, py + uy * 2.5 * M + (this.rand() - 0.5) * 2 * M];
        p.pace *= 0.6 + this.rand() * 0.4;
      }
    }
    if (this.rand() < dt * 0.3) {
      // (From in the station, a little way back from the platform's edge.)
      const back = 2.5 * M + this.rand() * 2 * M;
      const p = this.make(px + ux * back + (this.rand() - 0.5) * 2 * M, py + uy * back + (this.rand() - 0.5) * 2 * M, 'board');
      [p.tx, p.ty] = [dx, dy];
    }
  }

  /** Running from danger: away from it, roads or not (but not into the water or a wall); once it's passed, back to what they were doing. */
  private flee(p: Person, dt: number, walkable: (x: number, y: number, level: number) => boolean): void {
    p.timer -= dt;
    if (p.timer <= 0) return this.rejoin(p);
    const [ux, uy] = [Math.cos(p.angle), Math.sin(p.angle)];
    const [nx, ny] = [p.x + ux * RUN * dt, p.y + uy * RUN * dt];
    // (Not into a bus station's yard: only out of it, if they're in it.)
    if (walkable(nx, ny, p.level) && (p.level !== 0 || !this.inYard(nx, ny) || this.inYard(p.x, p.y))) {
      [p.x, p.y] = [nx, ny];
      p.speed = RUN;
    } else {
      // Blocked: off another way, away still.
      p.angle += (this.rand() < 0.5 ? 1 : -1) * (0.6 + this.rand() * 0.8);
      p.speed = 0;
    }
  }

  /** Thrown (hit, or diving out of the way): sliding to a stop; then, unless hurt, up again (diving: on their feet at once, and running). */
  private thrown(p: Person, dt: number, walkable: (x: number, y: number, level: number) => boolean): void {
    const [nx, ny] = [p.x + p.vx * dt, p.y + p.vy * dt];
    if (walkable(nx, ny, p.level)) [p.x, p.y] = [nx, ny];
    else [p.vx, p.vy] = [0, 0];
    // Diving: a short slide to a stop. (Knocked down, they're not moving.)
    const k = Math.exp(-(p.mode === 'dive' ? 3 : 14) * dt);
    p.vx *= k;
    p.vy *= k;
    p.speed = Math.hypot(p.vx, p.vy);
    p.timer -= dt;
    if (p.hurt || p.timer > 0) return;
    if (p.mode === 'dive') {
      p.mode = 'flee';
      p.timer = SCARED[0] + this.rand() * (SCARED[1] - SCARED[0]);
    } else this.rejoin(p);
  }

  /** Scared by danger at (x, y): running from it, unless they're down (or getting on a bus). */
  scare(p: Person, x: number, y: number): void {
    if (p.mode === 'down' || p.mode === 'board' || p.mode === 'dive') return;
    if (p.mode !== 'flee') p.was = p.mode;
    p.mode = 'flee';
    p.stop = -1;
    p.seat = null;
    p.picnic = null;
    p.timer = SCARED[0] + this.rand() * (SCARED[1] - SCARED[0]);
    p.angle = Math.atan2(p.y - y, p.x - x) + (this.rand() - 0.5) * 0.8;
  }

  /** Everyone within `reach` px of (x, y), on its level, is scared (a crash, someone knocked down). */
  scareAround(x: number, y: number, reach: number, level = 0): void {
    for (const p of this.people) if (p.level === level && Math.hypot(p.x - x, p.y - y) < reach) this.scare(p, x, y);
  }

  /** A car coming straight at them, fast: they jump out of the way (most of them, if they see it in time). */
  private dodge(p: Person, car: Mover, speed: number): void {
    if (speed < 4 * M) return;
    const [rx, ry] = [p.x - car.x, p.y - car.y];
    const [ux, uy] = [car.vx / speed, car.vy / speed];
    const ahead = rx * ux + ry * uy;
    const across = -rx * uy + ry * ux;
    const t = ahead / speed;
    if (t < 0.15 || t > 0.9 || Math.abs(across) > car.width / 2 + 1.2 * M) return;
    // Not everyone sees it coming (each gets a chance a frame or so, ever fewer as it nears).
    if (this.rand() > 0.12) return;
    const away = across >= 0 ? 1 : -1;
    p.was = p.mode === 'flee' ? p.was : p.mode;
    p.mode = 'dive';
    p.timer = 0.45;
    p.vx = -uy * away * 6 * M + ux * 1 * M;
    p.vy = ux * away * 6 * M + uy * 1 * M;
    p.angle = Math.atan2(p.vy, p.vx);
  }

  /** The vehicles hitting people: knocked flying, the way it was going (and up again, after a slow one). */
  private hitBy(all: Mover[]): void {
    for (const p of this.people) {
      if (p.mode === 'board') continue;
      for (const v of all) {
        if ((v.level ?? 0) !== p.level || Math.abs(v.x - p.x) > v.length || Math.abs(v.y - p.y) > v.length) continue;
        const [ux, uy] = [Math.cos(v.angle), Math.sin(v.angle)];
        const [rx, ry] = [p.x - v.x, p.y - v.y];
        const along = rx * ux + ry * uy;
        const across = -rx * uy + ry * ux;
        if (Math.abs(along) > v.length / 2 + R || Math.abs(across) > v.width / 2 + R) continue;
        const rel = Math.hypot(v.vx - p.vx, v.vy - p.vy);
        // A bike brushes past (it's slowed for them, and weaves round): they're just nudged aside.
        if (v.bike) {
          const out = across >= 0 ? 1 : -1;
          p.x += -uy * out * 1;
          p.y += ux * out * 1;
          continue;
        }
        if (p.mode === 'down') {
          this.runOver(p, v, along, across, rel);
          continue;
        }
        if (rel < 1.2 * M) {
          // Just nudged: out of the way.
          const out = across >= 0 ? 1 : -1;
          p.x += -uy * out * 1;
          p.y += ux * out * 1;
          continue;
        }
        this.knock(p, v, rel);
        // And now under it: its wheels go over them (see runOver).
        p.under = v.id;
        p.underAlong = along;
      }
      // Out from under it.
      if (p.under !== null && !all.some((v) => v.id === p.under && Math.abs((p.x - v.x) * Math.cos(v.angle) + (p.y - v.y) * Math.sin(v.angle)) <= v.length / 2 + R)) p.under = null;
    }
  }

  /**
   * Lying in a vehicle's way: it goes over them (they're too heavy to be
   * shoved along), each axle bumping over them as it reaches them, which
   * slows it a little; they're barely moved. Hurt, if it's going at any speed.
   */
  private runOver(p: Person, v: Mover, along: number, across: number, speed: number): void {
    const [ux, uy] = [Math.cos(v.angle), Math.sin(v.angle)];
    if (p.under !== v.id) {
      p.under = v.id;
      p.underAlong = along;
      return;
    }
    // The axles, a little in from each end; going forward, the front reaches them first (and in reverse, the back).
    const axle = v.length * 0.32;
    const was = p.underAlong;
    p.underAlong = along;
    for (const a of [axle, -axle]) {
      if ((was - a > 0) === (along - a > 0)) continue;
      // A wheel over them: a shove the way it's going (a little), and to the side, away from its middle.
      const out = across >= 0 ? 1 : -1;
      p.vx += ux * Math.min(speed, 4 * M) * 0.08 - uy * out * 0.4 * M;
      p.vy += uy * Math.min(speed, 4 * M) * 0.08 + ux * out * 0.4 * M;
      if (speed > HURT * 0.6) p.hurt = true;
      p.timer = Math.max(p.timer, DOWN[0]);
      // As a speed hump would: more off it the faster it's going, from a crawl to about a tenth.
      const loss = Math.min(0.1, 0.02 + speed / (40 * M) * 0.08);
      this.hits.push({ person: p, speed, by: v.id, how: 'over', loss });
    }
  }

  /** A driver (or rider) pulled out of their vehicle at (x, y): off and running, away from (fromX, fromY). */
  jumpOut(x: number, y: number, level: number, look: number, fromX: number, fromY: number): Person {
    const p = this.make(x, y, 'walk');
    Object.assign(p, { look: look % LOOKS, level });
    this.scare(p, fromX, fromY);
    return p;
  }

  /**
   * A cyclist knocked off their bike, going `speed` px/s: down on the road
   * at (x, y), facing `angle`; hurt if it was fast. (Up again, they go on on
   * foot.) `look` is their clothes, as they were riding.
   */
  unseat(x: number, y: number, angle: number, level: number, speed: number, look: number): Person {
    const p = this.make(x, y, 'down');
    Object.assign(p, { look: look % LOOKS, angle, level, was: 'walk' as Mode, hurt: speed > HURT, timer: DOWN[0] + this.rand() * (DOWN[1] - DOWN[0]) });
    return p;
  }

  /** Knocked down by a vehicle going `speed` px/s: thrown, and down for a moment, or for good. */
  knock(p: Person, v: { vx: number; vy: number; id?: number }, speed: number): void {
    if (p.mode !== 'down' && p.mode !== 'flee' && p.mode !== 'dive') p.was = p.mode;
    p.mode = 'down';
    p.stop = -1;
    p.seat = null;
    p.picnic = null;
    p.under = null;
    // Flat on the ground where they were hit (not thrown about): lying the way it was going, more or less.
    p.vx = 0;
    p.vy = 0;
    p.angle = Math.atan2(v.vy, v.vx) + (this.rand() - 0.5) * 0.8;
    if (speed > HURT) p.hurt = true;
    p.timer = DOWN[0] + this.rand() * (DOWN[1] - DOWN[0]);
    // What hit them loses a good part of its speed to the knock: 12%, and more the faster it was going (up to 30%).
    this.hits.push({ person: p, speed, by: v.id, how: 'hit', loss: speed < 1.2 * M ? 0 : Math.min(0.3, 0.12 + (speed / (40 * M)) * 0.16) });
  }

  /** Walks towards (x, y) at `speed`; whether they're there (within `near` px). */
  private goTo(p: Person, x: number, y: number, speed: number, dt: number, near = 0.3 * M): boolean {
    const [dx, dy] = [x - p.x, y - p.y];
    const d = Math.hypot(dx, dy);
    if (d <= near) return true;
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    p.speed = speed;
    // Turning to face the way they're going (not at once).
    let turn = Math.atan2(dy, dx) - p.angle;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    p.angle += turn * Math.min(1, dt * 8);
    return false;
  }

  /** Those out in the road (crossing, or running), or walking along a cycle path: for the traffic (and the bikes) to stop for. */
  inTheRoad(): Person[] {
    return this.people.filter(
      (p) => p.mode === 'cross' || p.mode === 'flee' || p.mode === 'dive' || (p.mode === 'down' && this.inRoad(p.x, p.y, undefined, p.level)) || (p.mode === 'walk' && !!this.walks[p.line]?.cycle),
    );
  }
}

/** Where a bus's door is: at the front, on the kerb side (the left: with y down, (uy, -ux)), just outside it. */
function door(b: Mover): [number, number] {
  const [ux, uy] = [Math.cos(b.angle), Math.sin(b.angle)];
  return [b.x + ux * b.length * 0.35 + uy * (b.width / 2 + 0.8 * M), b.y + uy * b.length * 0.35 - ux * (b.width / 2 + 0.8 * M)];
}

function lengthOf(pts: Pts): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return len;
}

function polyArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}
