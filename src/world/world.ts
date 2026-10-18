/**
 * The city as the game uses it, made from the map data: what the car
 * crashes into (buildings' walls, garden walls, hedges and fences, lamp
 * posts, bollards and tree trunks), the street furniture that can be
 * knocked about (benches and bins), and an index of what's where, so the
 * ground can be drawn a piece at a time. Pure (no Phaser), so it's tested.
 */

import type { Body, Circle, Segment } from '../physics/collisions';
import type { Building, GameMap, LineKind, Prop, PropKind, Pts, Road } from '../map/osm';
import { Decks } from './decks';
import type { DebrisKind, ThingKind, WallKind } from './damage';

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
};

/** How big each fixed post is, px radius; anything not listed here can be knocked about or is just painted on. */
const POST_RADIUS: Partial<Record<PropKind, number>> = {
  lamp: 3,
  bollard: 2.5,
  postbox: 4,
  phone: 6,
  fountain: 14,
  meter: 2.5,
  clock: 3,
  lifering: 2,
  bikes: 4,
  statue: 10,
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
}

export interface LooseProp extends Body {
  /** A bench or bin, or a piece of something broken. */
  kind: PropKind | DebrisKind;
  /** Smashed to pieces: it's gone. */
  gone?: boolean;
  /** 0 on the ground, 1 on a bridge. */
  level: number;
  /** Whether it's been knocked from where it stood. */
  moved: boolean;
  /** When it broke off something, seconds (game time), if it did. */
  born?: number;
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
}

export interface FixedProp extends Prop {
  /** 0 on the ground, 1 on a bridge. */
  level: number;
}

export interface World {
  map: GameMap;
  /** What you crash into on each level: [0] the ground, [1] the bridges' decks. */
  walls: [Wall[], Wall[]];
  posts: [Post[], Post[]];
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
export function openings(ax: number, ay: number, bx: number, by: number, passages: Road[]): [number, number][] {
  const out: [number, number][] = [];
  const wx = bx - ax;
  const wy = by - ay;
  const len = Math.hypot(wx, wy);
  if (!len) return out;
  for (const road of passages) {
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

export function buildWorld(map: GameMap): World {
  // Which level things are on: on a bridge's deck, or the ground.
  const decks = new Decks(map.roads, () => 0);
  const onDeck = (x: number, y: number) => decks.over(x, y) !== null;
  const passages = map.roads.filter((r) => r.passage);

  const ground: Wall[] = [];
  const deck: Wall[] = [];
  const addRing = (to: Wall[], ring: Pts, r: number, closed: boolean, level: number, kind?: WallKind, cut = false) => {
    const n = ring.length;
    for (let i = 0; i + (closed ? 1 : 3) < n; i += 2) {
      const j = (i + 2) % n;
      const s: Wall = { ax: ring[i], ay: ring[i + 1], bx: ring[j], by: ring[j + 1], r, level, ...(kind ? { kind } : {}) };
      to.push(...(cut ? cutWall(s, passages).map((piece) => ({ ...piece, level })) : [s]));
    }
  };
  // Buildings, with their archways open, stand in the way on both levels.
  const buildings: Wall[] = [];
  for (const b of map.buildings) if (b.solid) for (const ring of b.rings) addRing(buildings, ring, 0, true, 0, undefined, true);
  // Garden walls, fences and railings: on a bridge if they run along one (its handrails), otherwise on the ground.
  for (const line of map.lines) {
    const r = LINE_THICKNESS[line.kind];
    if (r === undefined) continue;
    const mid = Math.floor(line.pts.length / 4) * 2;
    const level = onDeck(line.pts[mid], line.pts[mid + 1]) ? 1 : 0;
    addRing(level ? deck : ground, line.pts, r, false, level, line.kind as WallKind);
  }
  // The edge of the map.
  const edge: Wall[] = [];
  addRing(edge, [0, 0, map.width, 0, map.width, map.height, 0, map.height], 0, true, 0);
  const walls: [Wall[], Wall[]] = [
    [...buildings, ...ground, ...edge],
    [...buildings, ...deck, ...decks.parapets().map((p) => ({ ...p, level: 1 })), ...edge],
  ];

  // Trees grow on the ground; anything else standing on a bridge is on the bridge.
  const posts: [Post[], Post[]] = [[], []];
  const levelOf = (x: number, y: number) => (onDeck(x, y) ? 1 : 0);
  for (let i = 0; i < map.trees.length; i += 4) posts[0].push({ x: map.trees[i], y: map.trees[i + 1], r: TRUNK, thing: 'tree', index: i / 4 });
  map.signals.forEach((s, index) => posts[levelOf(s.x, s.y)].push({ x: s.x, y: s.y, r: SIGNAL_POLE, thing: 'signal', index }));
  beacons(map).forEach((b, index) => posts[levelOf(b.x, b.y)].push({ x: b.x, y: b.y, r: BEACON_POLE, thing: 'beacon', index }));
  const loose: LooseProp[] = [];
  const fixed: FixedProp[] = [];
  map.props.forEach((p, i) => {
    const level = levelOf(p.x, p.y);
    const post = POST_RADIUS[p.kind];
    if (post !== undefined) posts[level].push({ x: p.x, y: p.y, r: post, thing: p.kind as ThingKind, index: fixed.length });
    // Traffic lights and bus stops are mapped on the road's centre line, not where they stand: left off for now.
    if (p.kind === 'signals' || p.kind === 'busstop') return;
    const l = LOOSE[p.kind];
    if (l) {
      // Benches face along the nearest wall or path; without knowing which, turn each its own way.
      loose.push({ kind: p.kind, x: p.x, y: p.y, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: ((i * 2.399) % Math.PI) - Math.PI / 2, spin: 0, moved: false, level });
    } else {
      fixed.push({ ...p, level });
    }
  });

  return { map, walls, posts, loose, fixed, chunks: indexChunks(map) };
}

/** Which chunks each thing reaches into (with its shadow, for buildings). */
function indexChunks(map: GameMap): Map<string, ChunkIndex> {
  const chunks = new Map<string, ChunkIndex>();
  const add = (list: keyof ChunkIndex, i: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        const key = chunkKey(cx, cy);
        let c = chunks.get(key);
        if (!c) {
          c = { areas: [], roads: [], lines: [], buildings: [], crossings: [], signals: [], trees: [], paint: [] };
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
  map.buildings.forEach((b, i) => {
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const [sx, sy] = shadowOffset(b.top);
    add('buildings', i, x0 - 2, y0 - 2, x1 + Math.max(0, sx) + 2, y1 + Math.max(0, sy) + 2);
  });
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
