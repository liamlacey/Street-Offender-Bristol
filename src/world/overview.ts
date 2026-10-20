/**
 * The pause menu's map of the whole of Bristol: drawn small (a pixel for every
 * 1.5 m), and where you'd land if you jumped to a point on it: the nearest bit
 * of road you can drive (or walk, or ride) along, facing along it, on the
 * left of it as the traffic drives.
 */

import type { AreaKind, GameMap, Pts, Road, RoadKind } from '../map/osm';

/** The map's pixels for each of the game's (8 a metre): one for every 1.5 m. */
export const OVERVIEW_SCALE = 1 / 12;

const M = 8;

/** What you're getting about in: where you can be put down. */
export type Going = 'drive' | 'ride' | 'foot';

const DRIVE: RoadKind[] = ['trunk', 'primary', 'secondary', 'tertiary', 'street', 'service'];
const ALONG: Record<Going, Set<RoadKind>> = {
  drive: new Set(DRIVE),
  ride: new Set([...DRIVE, 'cycleway']),
  foot: new Set([...DRIVE, 'pedestrian', 'footway', 'cycleway', 'track']),
};

export interface Spot {
  x: number;
  y: number;
  heading: number;
  /** The street it's on (or the nearest named one). */
  name?: string;
}

/** A road, as the overview has it. */
export type OverviewRoad = Pick<Road, 'kind' | 'pts' | 'width' | 'bridge' | 'passage' | 'arcade' | 'oneway' | 'name'>;

/**
 * What the overview's drawn from: the whole map, but only what's drawn, and
 * that only as finely as it's drawn (lines simplified to within a pixel of
 * it; the smallest buildings left out). Made from the map when the game's
 * built (see vite.config.ts), and fetched only when the menu's map is opened.
 */
export interface Overview {
  width: number;
  height: number;
  areas: { kind: AreaKind; rings: Pts[] }[];
  buildings: { rings: Pts[] }[];
  roads: OverviewRoad[];
}

/** How finely the overview's lines are kept, px: about a pixel of it; and the smallest building on it, px² (25 m²). */
const FINE = 1 / OVERVIEW_SCALE;
const SPECK = 25 * M * M;

export function overviewOf(map: GameMap): Overview {
  const fine = (pts: Pts, closed: boolean) => simplify(pts, FINE, closed).map(Math.round);
  const area = (ring: Pts) => {
    let a = 0;
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const j = (k + 2) % ring.length;
      a += ring[k] * ring[j + 1] - ring[j] * ring[k + 1];
    }
    return Math.abs(a / 2);
  };
  return {
    width: map.width,
    height: map.height,
    areas: map.areas.filter((a) => AREAS[a.kind] || a.kind === 'water' || a.kind === 'island').map((a) => ({ kind: a.kind, rings: a.rings.map((r) => fine(r, true)).filter((r) => r.length >= 6) })),
    // (A building smaller than a garage is a speck on it: left out.)
    buildings: map.buildings.filter((b) => b.bottom <= 0 && area(b.rings[0]) > SPECK).map((b) => ({ rings: b.rings.map((r) => fine(r, true)).filter((r) => r.length >= 6) })),
    roads: map.roads
      .filter((r) => r.pts.length >= 4)
      .map((r) => ({
        kind: r.kind,
        pts: fine(r.pts, false),
        width: r.width,
        ...(r.bridge ? { bridge: r.bridge } : {}),
        ...(r.passage ? { passage: r.passage } : {}),
        ...(r.arcade ? { arcade: r.arcade } : {}),
        ...(r.oneway ? { oneway: r.oneway } : {}),
        ...(r.name ? { name: r.name } : {}),
      })),
  };
}

/** A line with only the points it needs to stay within `tolerance` px of itself (Douglas-Peucker). */
function simplify(pts: Pts, tolerance: number, closed: boolean): Pts {
  const n = pts.length / 2;
  if (n <= (closed ? 4 : 2)) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay, bx, by] = [pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]];
    const [dx, dy] = [bx - ax, by - ay];
    const len = Math.hypot(dx, dy);
    let [far, at] = [0, -1];
    for (let k = a + 1; k < b; k++) {
      const [px, py] = [pts[k * 2], pts[k * 2 + 1]];
      const d = len ? Math.abs(dx * (ay - py) - dy * (ax - px)) / len : Math.hypot(px - ax, py - ay);
      if (d > far) [far, at] = [d, k];
    }
    if (at < 0 || far <= tolerance) continue;
    keep[at] = 1;
    stack.push([a, at], [at, b]);
  }
  const out: Pts = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2], pts[k * 2 + 1]);
  return out;
}

/** Where you'd be put down for (x, y): on the nearest road you can be on (not up on a bridge, nor under a building), or null if there's none. */
export function jumpSpot(map: { roads: OverviewRoad[] }, x: number, y: number, going: Going): Spot | null {
  const kinds = ALONG[going];
  let best: { d: number; x: number; y: number; heading: number; road: number } | null = null;
  map.roads.forEach((r, i) => {
    if (!kinds.has(r.kind) || r.bridge || r.passage || r.arcade) return;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const [ax, ay, bx, by] = [p[k], p[k + 1], p[k + 2], p[k + 3]];
      const [dx, dy] = [bx - ax, by - ay];
      const len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const [px, py] = [ax + dx * t, ay + dy * t];
      const d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { d, x: px, y: py, heading: Math.atan2(dy, dx), road: i };
    }
  });
  if (!best) return null;
  const { road, heading } = best as { road: number; heading: number };
  const r = map.roads[road];
  let { x: sx, y: sy } = best as { x: number; y: number };
  // Driving, on the left half of a two-way road (left of the way you face, y being down).
  if (going !== 'foot' && !r.oneway) {
    const off = r.width / 4;
    sx += Math.sin(heading) * off;
    sy -= Math.cos(heading) * off;
  }
  return { x: sx, y: sy, heading, name: r.name ?? placeName(map, sx, sy) };
}

/** The name of the nearest named street within 60 m of (x, y), if any. */
export function placeName(map: { roads: OverviewRoad[] }, x: number, y: number): string | undefined {
  let best = 60 * M;
  let name: string | undefined;
  for (const r of map.roads) {
    if (!r.name) continue;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const [ax, ay, dx, dy] = [p[k], p[k + 1], p[k + 2] - p[k], p[k + 3] - p[k + 1]];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < best) [best, name] = [d, r.name];
    }
  }
  return name;
}

type Ctx = CanvasRenderingContext2D;

const LAND = '#ddd6c6';
const AREAS: Partial<Record<AreaKind, string>> = {
  grass: '#a8cc88',
  park: '#a8cc88',
  garden: '#a8cc88',
  flowerbed: '#a8cc88',
  pitch: '#9cc47c',
  play: '#b7d39a',
  wood: '#86b06a',
  plaza: '#e9e3d6',
  parking: '#cfc9bd',
  forecourt: '#cfc9bd',
  yard: '#c4beb2',
  dirt: '#cdbb98',
  pier: '#b9ab92',
  pontoon: '#b9ab92',
  slipway: '#b9ab92',
};
const WATER = '#6aa3c9';
const BUILDING = '#a19a8f';
const BUILDING_EDGE = '#8a8378';
/** Each kind of road's colour and its least width on the map, map px; the order they're drawn in (the biggest on top). */
const ROADS: [RoadKind[], string, number][] = [
  [['footway', 'pedestrian', 'track', 'steps', 'cycleway'], '#f3eee3', 0.6],
  [['service'], '#ffffff', 0.9],
  [['street'], '#ffffff', 1.4],
  [['tertiary'], '#fff6d8', 1.8],
  [['secondary'], '#f8e08e', 2.2],
  [['primary', 'trunk'], '#f2c94c', 2.6],
];

function trace(ctx: Ctx, rings: Pts[], s: number): void {
  ctx.beginPath();
  for (const ring of rings) {
    for (let k = 0; k + 1 < ring.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ring[k] * s, ring[k + 1] * s);
    ctx.closePath();
  }
}

/** The whole map, drawn at `s` of its size: the ground, green and water, buildings, then the roads (and bridges over the rest). */
export function drawOverview(ctx: Ctx, map: Overview, s = OVERVIEW_SCALE): void {
  ctx.fillStyle = LAND;
  ctx.fillRect(0, 0, map.width * s, map.height * s);
  for (const a of map.areas) {
    const fill = AREAS[a.kind];
    if (!fill) continue;
    ctx.fillStyle = fill;
    trace(ctx, a.rings, s);
    ctx.fill('evenodd');
  }
  ctx.fillStyle = WATER;
  for (const a of map.areas) {
    if (a.kind !== 'water') continue;
    trace(ctx, a.rings, s);
    ctx.fill('evenodd');
  }
  ctx.fillStyle = LAND;
  for (const a of map.areas) {
    if (a.kind !== 'island') continue;
    trace(ctx, a.rings, s);
    ctx.fill('evenodd');
  }
  ctx.fillStyle = BUILDING;
  ctx.strokeStyle = BUILDING_EDGE;
  ctx.lineWidth = 0.5;
  for (const b of map.buildings) {
    trace(ctx, b.rings, s);
    ctx.fill('evenodd');
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const draw = (bridges: boolean) => {
    for (const [kinds, colour, least] of ROADS) {
      for (const r of map.roads) {
        if (!kinds.includes(r.kind) || !!r.bridge !== bridges || r.pts.length < 4) continue;
        const width = Math.max(least, r.width * s);
        ctx.beginPath();
        for (let k = 0; k + 1 < r.pts.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, r.pts[k] * s, r.pts[k + 1] * s);
        if (bridges) {
          ctx.strokeStyle = '#4a4740';
          ctx.lineWidth = width + 1.2;
          ctx.stroke();
        }
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
  };
  draw(false);
  draw(true);
}
