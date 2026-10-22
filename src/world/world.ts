/**
 * The city as the game uses it, made from the map data: what the car
 * crashes into (buildings' walls, garden walls, hedges and fences, lamp
 * posts, bollards and tree trunks), the street furniture that can be
 * knocked about (benches and bins), and an index of what's where, so the
 * ground can be drawn a piece at a time. Pure (no Phaser), so it's tested.
 */

import type { Body, Circle, Segment } from '../physics/collisions';
import type { Building, GameMap, LineKind, Prop, PropKind, Pts, Road } from '../map/osm';
import { Decks, waterOf } from './decks';
import { trolleyRows } from './parking';
import { streetLifeWork } from './streetLife';
import { playgroundsWork } from './playgrounds';
import { Terrain } from './terrain';
import type { DebrisKind, ThingKind, WallKind } from './damage';
import { type Work, drain, every } from './work.ts';

/** Size of the pieces the ground is drawn in, and indexed by, px. */
export const CHUNK = 512;

/** How thick each kind of wall is either side of its line, px. */
const LINE_THICKNESS: Partial<Record<LineKind, number>> = {
  wall: 2,
  hedge: 5,
  fence: 1,
  railing: 1,
  gate: 1,
  liftgate: 0.8,
  chain: 0.5,
  shelter: 6,
};

/** How big each fixed post is, px radius; anything not listed here can be knocked about or is just painted on. */
const POST_RADIUS: Partial<Record<PropKind, number>> = {
  lamp: 3,
  bollard: 2.5,
  mooring: 3,
  postbox: 4,
  phone: 6,
  fountain: 14,
  meter: 2.5,
  pump: 3.5,
  clock: 3,
  lifering: 2,
  bikes: 4,
  statue: 10,
  crane: 16,
};

/** Street furniture that can be knocked about: how big, and how heavy (1 / mass, the car's being 1). */
const LOOSE: Partial<Record<PropKind, { r: number; length?: number; invMass: number }>> = {
  bench: { r: 4, length: 15, invMass: 5 },
  bin: { r: 4, invMass: 12 },
  picnic: { r: 6, length: 14, invMass: 3 },
  gritbin: { r: 4, invMass: 3 },
  // Heavy: shoved, not sent flying.
  planter: { r: 6, invMass: 0.8 },
  block: { r: 5, invMass: 0.4 },
  // A shopping trolley: on wheels, it rolls a long way.
  trolley: { r: 2.5, length: 8, invMass: 9 },
  // A food cart: on wheels, but heavy (a stove, a fridge).
  foodcart: { r: 6, length: 13, invMass: 1.2 },
  // A market stall (a canopy over a trestle table, and what's on it); and a shop's A-board, light.
  stall: { r: 9, length: 24, invMass: 0.8 },
  aboard: { r: 2, length: 5, invMass: 14 },
  // The playgrounds' swings, slide, roundabout and climbing frame (steel, set in the ground: shoved, not thrown), sandpit, seesaw and spring riders (bigger than life: see PLAY_SCALE).
  swings: { r: 9, length: 39, invMass: 0.6 },
  slide: { r: 5, length: 42, invMass: 0.9 },
  roundabout: { r: 13, invMass: 0.5 },
  climbframe: { r: 13, invMass: 0.5 },
  sandpit: { r: 16, invMass: 0.3 },
  seesaw: { r: 3, length: 38, invMass: 1.5 },
  springy: { r: 4.5, invMass: 3 },
};

/** A tree trunk's radius, px. */
const TRUNK = 4;
/** Traffic lights' and Belisha beacons' poles, px. */
const SIGNAL_POLE = 2.5;
const BEACON_POLE = 2;

/** The Belisha beacons: on the pavement at each end of each zebra crossing. */
export function beacons(map: GameMap): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const c of map.crossings) {
    if (c.kind !== 'zebra') continue;
    const reach = c.width / 2 + 1.2 * 8;
    // Across the road, either way.
    const nx = -Math.sin(c.angle);
    const ny = Math.cos(c.angle);
    for (const side of [-1, 1]) out.push({ x: Math.round(c.x + nx * reach * side), y: Math.round(c.y + ny * reach * side) });
  }
  return out;
}

/** Something standing in the way, and what it is: which tree, light, beacon or prop (by its index in its list). */
export interface Post extends Circle {
  thing: ThingKind;
  index: number;
}

/** A wall: a building's (no kind: it won't break), or a garden wall, hedge, fence or railing (which will). */
export interface Wall extends Segment {
  kind?: WallKind;
  level: number;
  /** How tall, px, if measured (the usual for its kind otherwise). */
  height?: number;
  /** Not the map's: put there since (what's left of a broken wall, a fallen tree's trunk). */
  added?: boolean;
}

export interface LooseProp extends Body {
  /** A bench or bin, or a piece of something broken. */
  kind: PropKind | DebrisKind;
  /** Smashed to pieces: it's gone. */
  gone?: boolean;
  /** How its moving parts are, as people play on it (see people.ts): a roundabout's turn, radians; each swing's seat, how far out, px. */
  motion?: number[];
  /** 0 on the ground, 1 on a bridge. */
  level: number;
  /** Whether it's been knocked from where it stood. */
  moved: boolean;
  /** When it broke off something, seconds (game time), if it did. */
  born?: number;
  /** Where it stood on the map (see `homeOf`), if it's one of the map's (not a piece of something). */
  home?: string;
  /** A trolley: taken into the shop (not there), or full of shopping (see people.ts). */
  inside?: boolean;
  full?: boolean;
  /** Which of its kind's looks (a food cart: hot dogs, coffee, ice cream, crêpes). */
  variant?: number;
}

/** A loose thing's place on the map: what it is and where it stood (the same in each region of the map it's in). */
export function homeOf(p: { kind: string; x: number; y: number }): string {
  return `${p.kind},${p.x},${p.y}`;
}

/** What's in one chunk of the map: indices into the map's lists. */
export interface ChunkIndex {
  areas: number[];
  roads: number[];
  lines: number[];
  buildings: number[];
  crossings: number[];
  signals: number[];
  trees: number[];
  paint: number[];
  /** The steep banks' points (index in `banks`, by three). */
  banks: number[];
}

export interface FixedProp extends Prop {
  /** 0 on the ground, 1 on a bridge. */
  level: number;
}

export interface World {
  map: GameMap;
  /** What you crash into on each level: [0] the ground, [1] the bridges' decks. */
  /** What you hit on each level: the ground, the bridges' decks, the tunnels. */
  walls: [Wall[], Wall[], Wall[]];
  posts: [Post[], Post[], Post[]];
  loose: LooseProp[];
  /** The props that are fixed or painted on (all but the loose ones). */
  fixed: FixedProp[];
  chunks: Map<string, ChunkIndex>;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** An archway is at least this wide, px, so a car fits through. */
const ARCHWAY = 3.4 * 8;

/**
 * The stretches (as fractions along it, start and end) of a wall that the
 * roads through archways cut through: each as wide as its road, measured
 * along the wall, where the road crosses it.
 */
/** How far beyond its path an arcade's open, px: the depth of the walk under the building, about. */
const ARCADE_OPEN = 2 * 8;

function distanceToLine(x: number, y: number, pts: Pts): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
  }
  return best;
}

const boxes = new WeakMap<Road, [number, number, number, number]>();

/** A road's line's bounding box (worked out once). */
function boxOf(road: Road): [number, number, number, number] {
  let box = boxes.get(road);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < road.pts.length; i += 2) box = [Math.min(box[0], road.pts[i]), Math.min(box[1], road.pts[i + 1]), Math.max(box[2], road.pts[i]), Math.max(box[3], road.pts[i + 1])];
    boxes.set(road, box);
  }
  return box;
}

export function openings(ax: number, ay: number, bx: number, by: number, passages: Road[]): [number, number][] {
  const out: [number, number][] = [];
  const wx = bx - ax;
  const wy = by - ay;
  const len = Math.hypot(wx, wy);
  if (!len) return out;
  const [x0, y0, x1, y1] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  for (const road of passages) {
    // (Nowhere near this wall: nothing to open in it. A big map has a great many walls.)
    const [rx0, ry0, rx1, ry1] = boxOf(road);
    const pad = Math.max(road.width, ARCHWAY) * 3 + ARCADE_OPEN + len * 0.2;
    if (rx0 - pad > x1 || rx1 + pad < x0 || ry0 - pad > y1 || ry1 + pad < y0) continue;
    if (road.arcade) {
      // An arcade or colonnade runs under a building's front, open along it: no wall wherever the wall's beside it.
      const reach = road.width / 2 + ARCADE_OPEN;
      const steps = Math.max(1, Math.ceil(len / 2));
      let start = -1;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const near = distanceToLine(ax + wx * t, ay + wy * t, road.pts) < reach;
        if (near && start < 0) start = t;
        if ((!near || k === steps) && start >= 0) {
          out.push([start - 1 / steps, near ? 1 : t]);
          start = -1;
        }
      }
      continue;
    }
    const half = Math.max(road.width, ARCHWAY) / 2;
    const p = road.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [cx, cy, dx, dy] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const rx = dx - cx;
      const ry = dy - cy;
      const denom = wx * ry - wy * rx;
      if (Math.abs(denom) < 1e-9) continue;
      // Where the road's line crosses the wall: t along the wall, u along the road.
      const t = ((cx - ax) * ry - (cy - ay) * rx) / denom;
      const u = ((cx - ax) * wy - (cy - ay) * wx) / denom;
      if (t < -0.2 || t > 1.2 || u < 0 || u > 1) continue;
      // Crossing at a slant, the gap along the wall is wider.
      const sin = Math.abs(denom) / (len * Math.hypot(rx, ry));
      const gap = Math.min(half / Math.max(sin, 0.3), half * 3) / len;
      out.push([t - gap, t + gap]);
    }
  }
  return out;
}

/** How long the buildings' walls are worked out for between pauses, ms (see worldWork). */
const BUILDING_STEP = 6;

/** How far in from a way's edge its opening through a building stops, px (a building only just over a way's edge is left as it is). */
const SLACK = 0.4 * 8;

/** How far either side of its line a way's open through a building, px; an arcade's, its walk under the building's front. */
function openReach(r: Road): number {
  return r.arcade ? r.width / 2 + ARCADE_OPEN : Math.max(r.width, r.passage ? ARCHWAY : 0) / 2 - SLACK;
}

/** A way that goes no further into a building than this, px, and stops there, doesn't open it. */
const STOPS_SHORT = 3 * 8;

/** Whether a way ends at a building (on its walls, or inside it, not where it meets another way) having gone less than STOPS_SHORT into it. */
function stopsAt(r: Road, rings: Pts[], joined: Set<string>): boolean {
  const p = r.pts;
  const reach = Math.max(openReach(r), 1);
  const ends = [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]].filter(([x, y]) => !joined.has(`${x},${y}`) && (insideRings(x, y, rings) || ringsDistance(x, y, rings) < reach));
  if (!ends.length) return false;
  // How far of its line is inside (looked at every 2 px, where it's over the building).
  const [x0, y0, x1, y1] = bounds(rings[0]);
  let inside = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (Math.max(p[i], p[i + 2]) < x0 || Math.min(p[i], p[i + 2]) > x1 || Math.max(p[i + 1], p[i + 3]) < y0 || Math.min(p[i + 1], p[i + 3]) > y1) continue;
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) if (insideRings(p[i] + ((p[i + 2] - p[i]) * (k + 0.5)) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * (k + 0.5)) / n, rings)) inside += len / n;
  }
  return inside < STOPS_SHORT;
}

/** How far a point is from a building's walls, px. */
function ringsDistance(x: number, y: number, rings: Pts[]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
    }
  }
  return best;
}

/** How far a point is from a way's line, if it's within `max` px (Infinity if not). */
function wayDistance(x: number, y: number, r: Road, max: number): number {
  let best = Infinity;
  const p = r.pts;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
    if (x < Math.min(ax, bx) - max || x > Math.max(ax, bx) + max || y < Math.min(ay, by) - max || y > Math.max(ay, by) + max) continue;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
  }
  return best;
}

/** Whether a point's inside a building (its rings, even-odd: in a courtyard isn't). */
function insideRings(x: number, y: number, rings: Pts[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) {
      const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The stretches of a line from (ax, ay) to (bx, by) where `keep` holds (looked at every `step` px), as segments. */
function runs(ax: number, ay: number, bx: number, by: number, keep: (x: number, y: number) => boolean, step = 2): Segment[] {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Segment[] = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const kept = keep(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (kept && start < 0) start = t;
    if ((!kept || k === n) && start >= 0) {
      const end = kept ? 1 : (k - 1) / n;
      if ((end - start) * len > 0.5) out.push({ ax: ax + (bx - ax) * start, ay: ay + (by - ay) * start, bx: ax + (bx - ax) * end, by: ay + (by - ay) * end, r: 0 });
      start = -1;
    }
  }
  return out;
}

/**
 * A building's walls, open wherever a road or path (of `all`, those near it)
 * goes into it: through it under an archway, a canopy or an overhang, or only
 * across a corner of it (as mapped, there's often no telling which: it's gone
 * through, wherever the way is). Not one that only comes up to it (or barely
 * into it) and stops there, a path to its door (see `stopsAt`). Its walls are
 * cut away across the way (as wide as it is, less SLACK); inside, walls along
 * its edges keep you to it (not into the rest of the building), and a way that
 * ends inside it (`joined` says which points are where ways meet: not those)
 * is closed off there. An arcade's open along the building's front, as it was.
 * The walls along the ways inside aren't drawn: the building's drawn as it is
 * (and see-through while you're under it: see Buildings.ts).
 */
export function buildingWalls(rings: Pts[], all: Road[], level: number, joined: Set<string> = new Set()): Wall[] {
  const out: Wall[] = [];
  // (Most buildings have no way reaching into them at all: their walls as they are, looked at no further.)
  const [x0, y0, x1, y1] = bounds(rings[0]);
  const reaching = all.filter((r) => {
    const reach = openReach(r);
    if (reach <= 0) return false;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.max(p[i], p[i + 2]) < x0 - reach || Math.min(p[i], p[i + 2]) > x1 + reach || Math.max(p[i + 1], p[i + 3]) < y0 - reach || Math.min(p[i + 1], p[i + 3]) > y1 + reach) continue;
      return true;
    }
    return false;
  });
  if (!reaching.length) {
    for (const ring of rings) for (let i = 0; i < ring.length; i += 2) out.push({ ax: ring[i], ay: ring[i + 1], bx: ring[(i + 2) % ring.length], by: ring[(i + 3) % ring.length], r: 0, level });
    return out;
  }
  // (Not a way that only comes up to it, or barely into it, and stops: a path to its door, a drive to its garage. It stays shut.)
  const ways = reaching.filter((r) => !stopsAt(r, rings, joined));
  // (Only the bits of each way near the building are looked at: a road's often far longer than a building's wide.)
  const local: { of: Road; piece: Road }[] = [];
  for (const r of ways) {
    const pad = openReach(r) * 2 + 4;
    const p = r.pts;
    let run: number[] | null = null;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const over = !(Math.max(p[i], p[i + 2]) < x0 - pad || Math.min(p[i], p[i + 2]) > x1 + pad || Math.max(p[i + 1], p[i + 3]) < y0 - pad || Math.min(p[i + 1], p[i + 3]) > y1 + pad);
      if (over) (run ??= [p[i], p[i + 1]]).push(p[i + 2], p[i + 3]);
      else if (run) {
        local.push({ of: r, piece: { ...r, pts: run } });
        run = null;
      }
    }
    if (run) local.push({ of: r, piece: { ...r, pts: run } });
  }
  const opened = new Set<Road>();
  const near = (x: number, y: number, except?: Road) => {
    for (const { of, piece } of local) {
      if (of === except) continue;
      const reach = openReach(piece);
      if (wayDistance(x, y, piece, reach) < reach) return of;
    }
    return undefined;
  };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      // (Most walls are nowhere near a way: those are kept whole, without looking along them.)
      const len = Math.hypot(bx - ax, by - ay);
      const close = local.filter(({ piece }) => {
        const reach = openReach(piece) + len / 2;
        return wayDistance((ax + bx) / 2, (ay + by) / 2, piece, reach) < reach;
      });
      if (!close.length) {
        out.push({ ax, ay, bx, by, r: 0, level });
        continue;
      }
      for (const piece of runs(ax, ay, bx, by, (x, y) => {
        for (const c of close) {
          const reach = openReach(c.piece);
          if (wayDistance(x, y, c.piece, reach) < reach) {
            opened.add(c.of);
            return false;
          }
        }
        return true;
      })) out.push({ ...piece, level });
    }
  }
  // Inside: along the edges of each way that goes in (not an arcade's: it's open along the front), and across its end if it ends there.
  for (const r of opened) {
    if (r.arcade) continue;
    const h = openReach(r);
    const keep = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && insideRings(x, y, rings) && !near(x, y, r);
    for (const { piece } of local.filter((l) => l.of === r)) {
      for (const side of [1, -1]) {
        const edge = offsetLine(piece.pts, side * h);
        // (Every 4 px: they're only kept to, never seen.)
        for (let k = 0; k + 3 < edge.length; k += 2) for (const bit of runs(edge[k], edge[k + 1], edge[k + 2], edge[k + 3], keep, 4)) out.push({ ...bit, level });
      }
    }
    const p = r.pts;
    for (const [x, y, px, py] of [[p[0], p[1], p[2], p[3]], [p[p.length - 2], p[p.length - 1], p[p.length - 4], p[p.length - 3]]]) {
      if (joined.has(`${x},${y}`) || !insideRings(x, y, rings)) continue;
      const len = Math.hypot(x - px, y - py) || 1;
      const [nx, ny] = [-(y - py) / len, (x - px) / len];
      for (const piece of runs(x + nx * h, y + ny * h, x - nx * h, y - ny * h, keep)) out.push({ ...piece, level });
    }
  }
  return out;
}

/** A wall with the archways cut out of it: what's left of it. */
export function cutWall(s: Segment, passages: Road[]): Segment[] {
  const gaps = openings(s.ax, s.ay, s.bx, s.by, passages).sort((a, b) => a[0] - b[0]);
  if (!gaps.length) return [s];
  const pieces: Segment[] = [];
  let from = 0;
  const at = (t: number) => [s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t];
  for (const [g0, g1] of [...gaps, [1, 1] as [number, number]]) {
    const to = Math.min(1, Math.max(from, g0));
    if (to - from > 1e-3) {
      const [x0, y0] = at(from);
      const [x1, y1] = at(to);
      pieces.push({ ax: x0, ay: y0, bx: x1, by: y1, r: s.r });
    }
    from = Math.max(from, Math.min(1, g1));
  }
  return pieces;
}

export function buildWorld(map: GameMap, terrain?: Terrain): World {
  return drain(worldWork(map, terrain));
}

/** The same, a little at a time (see work.ts). */
export function* worldWork(map: GameMap, shared?: Terrain): Work<World> {
  const pause = every(150);
  // Which level things are on: on a bridge's deck, or the ground.
  const terrain = shared ?? new Terrain(map.terrain, map.pxPerMetre, map.ledges);
  const decks = new Decks(map.roads, (x, y) => terrain.at(x, y) * terrain.px, waterOf(map));
  const onDeck = (x: number, y: number) => decks.over(x, y) !== null;
  // (The roads and paths by where they are, in squares, each in those its line goes through: each building looks only at those near it.)
  const CELL = 256;
  const wayGrid = new Map<string, Set<Road>>();
  for (const r of map.roads) {
    // (A railway in a tunnel is under everything: it opens no building's walls.)
    if (r.tunnel) continue;
    const pad = Math.max(0, openReach(r)) + 4;
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const [ax, ay, bx, by] = [r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]];
      for (let cx = Math.floor((Math.min(ax, bx) - pad) / CELL); cx <= Math.floor((Math.max(ax, bx) + pad) / CELL); cx++) {
        for (let cy = Math.floor((Math.min(ay, by) - pad) / CELL); cy <= Math.floor((Math.max(ay, by) + pad) / CELL); cy++) {
          const key = `${cx},${cy}`;
          const set = wayGrid.get(key);
          if (set) set.add(r);
          else wayGrid.set(key, new Set([r]));
        }
      }
    }
  }
  const waysNear = (w: Segment): Road[] => {
    const out = new Set<Road>();
    for (let cx = Math.floor(Math.min(w.ax, w.bx) / CELL); cx <= Math.floor(Math.max(w.ax, w.bx) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(w.ay, w.by) / CELL); cy <= Math.floor(Math.max(w.ay, w.by) / CELL); cy++) for (const r of wayGrid.get(`${cx},${cy}`) ?? []) out.add(r);
    }
    return [...out];
  };
  yield;

  const ground: Wall[] = [];
  const deck: Wall[] = [];
  const addRing = (to: Wall[], ring: Pts, r: number, closed: boolean, level: number, kind?: WallKind, height?: number) => {
    const n = ring.length;
    for (let i = 0; i + (closed ? 1 : 3) < n; i += 2) {
      const j = (i + 2) % n;
      to.push({ ax: ring[i], ay: ring[i + 1], bx: ring[j], by: ring[j + 1], r, level, ...(kind ? { kind } : {}), ...(height ? { height } : {}) });
    }
  };
  // Buildings stand in the way on both levels, open wherever a way goes into them (see buildingWalls): on the ground, the roads and
  // paths; up on a bridge, the bridges too.
  const joined = new Set<string>();
  {
    const uses = new Map<string, number>();
    for (const r of map.roads) for (let k = 0; k + 1 < r.pts.length; k += 2) uses.set(`${r.pts[k]},${r.pts[k + 1]}`, (uses.get(`${r.pts[k]},${r.pts[k + 1]}`) ?? 0) + 1);
    for (const [k, n] of uses) if (n > 1) joined.add(k);
  }
  const buildings: Wall[] = [];
  const buildingsUp: Wall[] = [];
  // (A pause every so often: some take far longer than others, where a lot of ways go into them.)
  let since = performance.now();
  for (const b of map.buildings) {
    if (performance.now() - since > BUILDING_STEP) {
      yield;
      since = performance.now();
    }
    if (!b.solid) continue;
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const near = waysNear({ ax: x0, ay: y0, bx: x1, by: y1, r: 0 });
    const onGround = near.filter((r) => !r.bridge);
    const walls = buildingWalls(b.rings, onGround, 0, joined);
    buildings.push(...walls);
    buildingsUp.push(...(onGround.length === near.length ? walls : buildingWalls(b.rings, near, 1, joined)));
  }
  // Garden walls, fences and railings: on a bridge if they run along one (its handrails), otherwise on the ground.
  for (const line of map.lines) {
    const r = LINE_THICKNESS[line.kind];
    if (r === undefined) continue;
    const mid = Math.floor(line.pts.length / 4) * 2;
    const level = onDeck(line.pts[mid], line.pts[mid + 1]) ? 1 : 0;
    addRing(level ? deck : ground, line.pts, r, false, level, line.kind as WallKind, line.height);
    if (pause()) yield;
  }
  // The edge of the map.
  const edge: Wall[] = [];
  addRing(edge, [0, 0, map.width, 0, map.width, map.height, 0, map.height], 0, true, 0);
  // The tunnels: their walls (all along them, open at the portals), and nothing else down there.
  const tunnels = new Decks(map.roads, (x, y) => terrain.at(x, y) * terrain.px, () => false, true);
  const walls: [Wall[], Wall[], Wall[]] = [
    [...buildings, ...ground, ...edge],
    [...buildingsUp, ...deck, ...(yield* decks.parapetsWork()).map((p) => ({ ...p, level: 1, kind: 'parapet' as const })), ...edge],
    // (Rock: they can't be knocked through, as a building's walls can't.)
    (yield* tunnels.parapetsWork()).map((p) => ({ ...p, level: 2 })),
  ];

  // Trees grow on the ground; anything else standing on a bridge is on the bridge.
  const posts: [Post[], Post[], Post[]] = [[], [], []];
  const levelOf = (x: number, y: number) => (onDeck(x, y) ? 1 : 0);
  // (A tree's by its id in the whole map, in a region of it: it's the same tree, if it's knocked down, in the next region it's in.)
  const treeIds = (map as GameMap & { ids?: { trees: number[] } }).ids?.trees;
  for (let i = 0; i < map.trees.length; i += 4) posts[0].push({ x: map.trees[i], y: map.trees[i + 1], r: TRUNK, thing: 'tree', index: treeIds?.[i / 4] ?? i / 4 });
  map.signals.forEach((s, index) => posts[levelOf(s.x, s.y)].push({ x: s.x, y: s.y, r: SIGNAL_POLE, thing: 'signal', index }));
  beacons(map).forEach((b, index) => posts[levelOf(b.x, b.y)].push({ x: b.x, y: b.y, r: BEACON_POLE, thing: 'beacon', index }));
  const loose: LooseProp[] = [];
  const fixed: FixedProp[] = [];
  map.props.forEach((p) => {
    const level = levelOf(p.x, p.y);
    const post = POST_RADIUS[p.kind];
    if (post !== undefined) posts[level].push({ x: p.x, y: p.y, r: post, thing: p.kind as ThingKind, index: fixed.length });
    // Traffic lights and bus stops are mapped on the road's centre line, not where they stand: left off for now.
    if (p.kind === 'signals' || p.kind === 'busstop') return;
    const l = LOOSE[p.kind];
    if (l) {
      // Benches face along the nearest wall or path; without knowing which (unless the map says), turn each its own way.
      // (Turned by where it is, not its place in the list: the same in each region of the map it's in.)
      const turn = (Math.abs(Math.round(p.x * 7 + p.y * 13)) * 2.399) % Math.PI;
      loose.push({ kind: p.kind, x: p.x, y: p.y, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: p.angle ?? turn - Math.PI / 2, spin: 0, moved: false, level, home: homeOf(p) });
    } else {
      fixed.push({ ...p, level });
    }
  });
  // The food carts on the busy pedestrian streets and squares, the market stalls (along their rows), and the A-boards (see streetLife.ts).
  const life = yield* streetLifeWork(map);
  const add = (kind: 'foodcart' | 'stall' | 'aboard', x: number, y: number, angle: number, variant?: number) => {
    const l = LOOSE[kind]!;
    const p = { kind, x, y };
    loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle, spin: 0, moved: false, level: 0, home: homeOf(p), ...(variant === undefined ? {} : { variant }) });
  };
  for (const c of life.carts) add('foodcart', c.x, c.y, c.angle, c.kind);
  for (const s of life.stalls) add('stall', s.x, s.y, s.angle - Math.PI / 2, s.kind);
  for (const b of life.boards) add('aboard', b.x, b.y, b.angle);
  // What's in the playgrounds (see playgrounds.ts).
  for (const t of yield* playgroundsWork(map)) {
    const l = LOOSE[t.kind]!;
    const p = { kind: t.kind, x: t.x, y: t.y };
    loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: t.angle, spin: 0, moved: false, level: 0, home: homeOf(p) });
  }
  // The trolleys in the big shops' car parks' shelters (more than half full, each its own way).
  for (const rows of trolleyRows(map)) {
    for (const [x, y, angle, count] of rows.slice(1)) {
      const l = LOOSE.trolley!;
      const n = Math.round(count * (0.5 + (Math.abs(Math.round(x * 7 + y * 13)) % 5) / 10));
      for (let k = 0; k < n; k++) {
        const p = { kind: 'trolley' as const, x: Math.round((x + Math.cos(angle) * k * 0.4 * 8) * 10) / 10, y: Math.round((y + Math.sin(angle) * k * 0.4 * 8) * 10) / 10 };
        loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: angle + Math.PI, spin: 0, moved: false, level: 0, home: homeOf(p) });
      }
    }
  }

  yield;
  return { map, walls, posts, loose, fixed, chunks: yield* indexChunks(map) };
}

/** Which chunks each thing reaches into (with its shadow, for buildings). */
function* indexChunks(map: GameMap): Work<Map<string, ChunkIndex>> {
  const pause = every(800);
  const chunks = new Map<string, ChunkIndex>();
  const add = (list: keyof ChunkIndex, i: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        const key = chunkKey(cx, cy);
        let c = chunks.get(key);
        if (!c) {
          c = { areas: [], roads: [], lines: [], buildings: [], crossings: [], signals: [], trees: [], paint: [], banks: [] };
          chunks.set(key, c);
        }
        c[list].push(i);
      }
    }
  };
  map.areas.forEach((a, i) => {
    const [x0, y0, x1, y1] = bounds(a.rings[0]);
    add('areas', i, x0 - 4, y0 - 4, x1 + 4, y1 + 4);
  });
  map.roads.forEach((r, i) => {
    // Wide enough for the pavements either side.
    const pad = r.width / 2 + 24;
    const [x0, y0, x1, y1] = bounds(r.pts);
    add('roads', i, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
  });
  (map.paint ?? []).forEach((p, i) => {
    // Arrows and boxes run a few metres along their way.
    const reach = p.width + 6 * 8;
    add('paint', i, p.x - reach, p.y - reach, p.x + reach, p.y + reach);
  });
  map.lines.forEach((l, i) => {
    const [x0, y0, x1, y1] = bounds(l.pts);
    add('lines', i, x0 - 8, y0 - 8, x1 + 8, y1 + 8);
  });
  yield;
  for (const [i, b] of map.buildings.entries()) {
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const [sx, sy] = shadowOffset(b.top);
    add('buildings', i, x0 - 2, y0 - 2, x1 + Math.max(0, sx) + 2, y1 + Math.max(0, sy) + 2);
    if (pause()) yield;
  }
  // With their zig-zags, which run along the road either side.
  map.crossings.forEach((c, i) => {
    const reach = c.width + 14 * 8;
    add('crossings', i, c.x - reach, c.y - reach, c.x + reach, c.y + reach);
  });
  map.signals.forEach((s, i) => {
    const [x0, y0, x1, y1] = s.stop;
    add('signals', i, Math.min(x0, x1, s.x) - 4, Math.min(y0, y1, s.y) - 4, Math.max(x0, x1, s.x) + 4, Math.max(y0, y1, s.y) + 4);
  });
  for (let i = 0; i < map.trees.length; i += 4) {
    const [x, y, r, h] = [map.trees[i], map.trees[i + 1], map.trees[i + 2], map.trees[i + 3]];
    const [sx, sy] = shadowOffset(h * 0.7);
    add('trees', i / 4, x - r, y - r, x + sx + r, y + sy + r);
    if (pause()) yield;
  }
  const banks = map.banks ?? [];
  for (let i = 0; i < banks.length; i += 3) {
    add('banks', i / 3, banks[i] - 8, banks[i + 1] - 8, banks[i] + 8, banks[i + 1] + 8);
    if (pause()) yield;
  }
  return chunks;
}

export function bounds(pts: Pts): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0, y0, x1, y1];
}

/** Light from the top left (the north-west, as in the old games), low in the sky: where a building's shadow falls, for its height. */
export function shadowOffset(height: number): [number, number] {
  const length = Math.min(height * 0.55, 220);
  return [length * 0.6, length * 0.8];
}

/** The point `d` px along a polyline (clamped to its ends), and which way it runs there, smoothed over `smooth` px either side. */
export function pointAlong(pts: Pts, d: number, smooth = 0): [number, number, number, number] {
  const at = (dist: number): [number, number] => {
    let run = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      if (run + len >= dist || i + 4 >= pts.length) {
        const t = len ? Math.max(0, Math.min(1, (dist - run) / len)) : 0;
        return [pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t];
      }
      run += len;
    }
    return [pts[0], pts[1]];
  };
  const [x, y] = at(d);
  const reach = Math.max(smooth, 1);
  const [ax, ay] = at(d - reach);
  const [bx, by] = at(d + reach);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [x, y, (bx - ax) / len, (by - ay) / len];
}

/** A polyline's length. */
export function lineLength(pts: Pts): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return len;
}

/** The part of a polyline from distance `from` to `to` along it. */
export function subPolyline(pts: Pts, from: number, to: number): Pts {
  const out: Pts = [];
  let dist = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const end = dist + len;
    if (end > from && dist < to && len > 0) {
      const t0 = Math.max(0, (from - dist) / len);
      const t1 = Math.min(1, (to - dist) / len);
      if (out.length === 0) out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      out.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
    dist = end;
    if (dist >= to) break;
  }
  return out;
}

/** A building's hash, for picking its look the same way every time. */
export function buildingSeed(b: Building): number {
  let h = b.id | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A line running alongside another, `d` px to its left (as it runs; right if negative), keeping its corners square-ish. */
export function offsetLine(pts: Pts, d: number): Pts {
  const n = pts.length / 2;
  const out: number[] = [];
  const unit = (i: number): [number, number] => {
    const dx = pts[i * 2 + 2] - pts[i * 2];
    const dy = pts[i * 2 + 3] - pts[i * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  for (let i = 0; i < n; i++) {
    const [ax, ay] = unit(Math.max(0, i - 1));
    const [bx, by] = unit(Math.min(n - 2, i));
    // Left of the way as it runs, with y down: (uy, -ux); at a corner, the two sides' normals averaged, pushed out so the strip keeps its width (within reason).
    let [nx, ny] = [ay + by, -(ax + bx)];
    const len = Math.hypot(nx, ny) || 1;
    [nx, ny] = [nx / len, ny / len];
    const k = Math.min(2, 1 / Math.max(0.5, nx * ay - ny * ax));
    out.push(pts[i * 2] + nx * d * k, pts[i * 2 + 1] + ny * d * k);
  }
  return out;
}
