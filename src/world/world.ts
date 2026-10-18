/**
 * The city as the game uses it, made from the map data: what the car
 * crashes into (buildings' walls, garden walls, hedges and fences, lamp
 * posts, bollards and tree trunks), the street furniture that can be
 * knocked about (benches and bins), and an index of what's where, so the
 * ground can be drawn a piece at a time. Pure (no Phaser), so it's tested.
 */

import type { Body, Circle, Segment } from '../physics/collisions';
import type { Building, GameMap, LineKind, Prop, PropKind, Pts } from '../map/osm';

/** Size of the pieces the ground is drawn in, and indexed by, px. */
export const CHUNK = 512;

/** How thick each kind of wall is either side of its line, px. */
const LINE_THICKNESS: Partial<Record<LineKind, number>> = {
  wall: 2,
  hedge: 5,
  fence: 1,
  railing: 1,
};

/** How big each fixed post is, px radius; anything not listed here can be knocked about or is just painted on. */
const POST_RADIUS: Partial<Record<PropKind, number>> = {
  lamp: 3,
  bollard: 2.5,
  postbox: 4,
  phone: 6,
  fountain: 14,
};

/** Street furniture that can be knocked about: how big, and how heavy (1 / mass, the car's being 1). */
const LOOSE: Partial<Record<PropKind, { r: number; length?: number; invMass: number }>> = {
  bench: { r: 4, length: 15, invMass: 5 },
  bin: { r: 4, invMass: 12 },
};

/** A tree trunk's radius, px. */
const TRUNK = 4;

export interface LooseProp extends Body {
  kind: PropKind;
  /** Whether it's been knocked from where it stood. */
  moved: boolean;
}

/** What's in one chunk of the map: indices into the map's lists. */
export interface ChunkIndex {
  areas: number[];
  roads: number[];
  lines: number[];
  buildings: number[];
  crossings: number[];
  trees: number[];
}

export interface World {
  map: GameMap;
  walls: Segment[];
  posts: Circle[];
  loose: LooseProp[];
  /** The props that are fixed or painted on (all but the loose ones). */
  fixed: Prop[];
  chunks: Map<string, ChunkIndex>;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function buildWorld(map: GameMap): World {
  const walls: Segment[] = [];
  const addRing = (ring: Pts, r: number, closed: boolean) => {
    const n = ring.length;
    for (let i = 0; i + (closed ? 1 : 3) < n; i += 2) {
      const j = (i + 2) % n;
      walls.push({ ax: ring[i], ay: ring[i + 1], bx: ring[j], by: ring[j + 1], r });
    }
  };
  for (const b of map.buildings) if (b.solid) for (const ring of b.rings) addRing(ring, 0, true);
  for (const line of map.lines) {
    const r = LINE_THICKNESS[line.kind];
    if (r !== undefined) addRing(line.pts, r, false);
  }
  // The edge of the map.
  addRing([0, 0, map.width, 0, map.width, map.height, 0, map.height], 0, true);

  const posts: Circle[] = [];
  for (let i = 0; i < map.trees.length; i += 3) posts.push({ x: map.trees[i], y: map.trees[i + 1], r: TRUNK });
  const loose: LooseProp[] = [];
  const fixed: Prop[] = [];
  map.props.forEach((p, i) => {
    const post = POST_RADIUS[p.kind];
    if (post !== undefined) posts.push({ x: p.x, y: p.y, r: post });
    // Traffic lights and bus stops are mapped on the road's centre line, not where they stand: left off for now.
    if (p.kind === 'signals' || p.kind === 'busstop') return;
    const l = LOOSE[p.kind];
    if (l) {
      // Benches face along the nearest wall or path; without knowing which, turn each its own way.
      loose.push({ kind: p.kind, x: p.x, y: p.y, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: ((i * 2.399) % Math.PI) - Math.PI / 2, spin: 0, moved: false });
    } else {
      fixed.push(p);
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
          c = { areas: [], roads: [], lines: [], buildings: [], crossings: [], trees: [] };
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
  map.lines.forEach((l, i) => {
    const [x0, y0, x1, y1] = bounds(l.pts);
    add('lines', i, x0 - 8, y0 - 8, x1 + 8, y1 + 8);
  });
  map.buildings.forEach((b, i) => {
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const [sx, sy] = shadowOffset(b.top);
    add('buildings', i, x0 - 2, y0 - 2, x1 + Math.max(0, sx) + 2, y1 + Math.max(0, sy) + 2);
  });
  map.crossings.forEach((c, i) => add('crossings', i, c.x - c.width, c.y - c.width, c.x + c.width, c.y + c.width));
  for (let i = 0; i < map.trees.length; i += 3) {
    const [x, y, r] = [map.trees[i], map.trees[i + 1], map.trees[i + 2]];
    add('trees', i / 3, x - r, y - r, x + r * 2.5, y + r * 2.5);
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

/** Light from the south-west, low in the sky: where a building's shadow falls, for its height. */
export function shadowOffset(height: number): [number, number] {
  const length = Math.min(height * 0.55, 220);
  return [length * 0.6, length * 0.8];
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
