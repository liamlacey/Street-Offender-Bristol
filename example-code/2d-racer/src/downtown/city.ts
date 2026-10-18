/**
 * The layout of a downtown around its track: the junctions of the street
 * grid, the streets between them (the race's own, as wide as the track, and
 * side streets, ending at the bollards where they meet the race), and the
 * blocks in between, where the buildings go; and the race's route round the
 * grid, corner by corner, which its barriers follow. Pure geometry, from the
 * track and its grid (see grid.ts).
 */

import { type Track, type Vec2, locateOnTrack } from '../track/Track';
import type { CityGrid } from './grid';

/** Side streets: road width (two lanes and a parking lane each way), kerbs, and the pavement either side, px. */
export const SIDE_STREET = { width: 170, kerb: 6, pavement: 56 };
/** How far beyond the world's edge the city carries on, px (so nothing ends in sight). */
const BEYOND = 400;

export interface Junction {
  /** Column and row on the grid. */
  i: number;
  j: number;
  x: number;
  y: number;
  /** On the race's route (the track goes through or round it). */
  onTrack: boolean;
}

/** A street between two neighbouring junctions. */
export interface Street {
  a: Junction;
  b: Junction;
  /** Runs east-west (otherwise north-south). */
  horizontal: boolean;
  /** Part of the race's route. */
  onTrack: boolean;
  /** Kerb to kerb, px: the track's width, or a side street's. */
  width: number;
  kerb: number;
  /** How far the junction box at each end (a, b) reaches into the street from the junction's centre, px. */
  box: [number, number];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface City {
  grid: CityGrid;
  junctions: Junction[];
  streets: Street[];
  /** The ground between the streets' pavements, where the buildings go. */
  blocks: Rect[];
}

/**
 * Lays out the city round a track: every street of its grid within reach of
 * the world, which of them the race uses, and the blocks between.
 * `barrierZone` is how far past the road's edge the track's barriers reach.
 */
export function planCity(track: Track, grid: CityGrid, barrierZone: number, margin: number): City {
  const { minX, minY, maxX, maxY } = track.bounds;
  const reach = margin + BEYOND;
  const within = (lines: number[], lo: number, hi: number) =>
    lines.map((v, k) => [v, k] as const).filter(([v]) => v >= lo - reach - 2000 && v <= hi + reach + 2000);
  const cols = within(grid.xs, minX, maxX);
  const rows = within(grid.ys, minY, maxY);
  const near = (x: number, y: number, d: number) => {
    const pos = locateOnTrack(track, x, y);
    return pos.distance < d;
  };

  const junctions = new Map<number, Junction>();
  const byEnds = new Map<string, Street>();
  for (const [x, i] of cols) for (const [y, j] of rows) junctions.set(i * 1000 + j, { i, j, x, y, onTrack: false });
  const streets: Street[] = [];
  for (const a of junctions.values()) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = junctions.get((a.i + di) * 1000 + a.j + dj);
      if (!b) continue;
      // The race uses a street if its middle is on the track's centre line.
      const onTrack = near((a.x + b.x) / 2, (a.y + b.y) / 2, 24);
      if (onTrack) {
        a.onTrack = true;
        b.onTrack = true;
      }
      const street: Street = {
        a,
        b,
        horizontal: dj === 0,
        onTrack,
        width: onTrack ? track.width : SIDE_STREET.width,
        kerb: onTrack ? track.kerbWidth : SIDE_STREET.kerb,
        box: [0, 0],
      };
      streets.push(street);
      byEnds.set(`${a.i},${a.j}:${b.i},${b.j}`, street);
    }
  }

  // Each junction's box: as far as the widest street crossing the one coming in.
  const meeting = new Map<Junction, Street[]>();
  for (const st of streets) for (const j of [st.a, st.b]) meeting.set(j, [...(meeting.get(j) ?? []), st]);
  for (const st of streets) {
    st.box = [st.a, st.b].map((j) => Math.max(0, ...(meeting.get(j) ?? []).filter((o) => o.horizontal !== st.horizontal).map((o) => o.width)) / 2 + 8) as [
      number,
      number,
    ];
  }

  // Blocks: each cell of the grid, in from its streets by their half-width and pavement
  // (the track's barriers, on the sides the race goes by).
  const trackInset = track.width / 2 + track.kerbWidth + barrierZone + 6;
  const sideInset = SIDE_STREET.width / 2 + SIDE_STREET.pavement;
  const streetAt = (a: Junction, b: Junction) => byEnds.get(`${a.i},${a.j}:${b.i},${b.j}`);
  const inset = (s: Street | undefined) => (s?.onTrack ? trackInset : sideInset);
  const blocks: Rect[] = [];
  for (const a of junctions.values()) {
    const right = junctions.get((a.i + 1) * 1000 + a.j);
    const down = junctions.get(a.i * 1000 + a.j + 1);
    const diagonal = junctions.get((a.i + 1) * 1000 + a.j + 1);
    if (!right || !down || !diagonal) continue;
    blocks.push({
      x0: a.x + inset(streetAt(a, down)),
      x1: right.x - inset(streetAt(right, diagonal)),
      y0: a.y + inset(streetAt(a, right)),
      y1: down.y - inset(streetAt(down, diagonal)),
    });
  }
  return { grid, junctions: [...junctions.values()], streets, blocks };
}

/** The road of a street, as a rectangle (from junction centre to junction centre). */
export function streetRect(s: Street, width = s.width): Rect {
  const half = width / 2;
  return {
    x0: Math.min(s.a.x, s.b.x) - (s.horizontal ? 0 : half),
    x1: Math.max(s.a.x, s.b.x) + (s.horizontal ? 0 : half),
    y0: Math.min(s.a.y, s.b.y) - (s.horizontal ? half : 0),
    y1: Math.max(s.a.y, s.b.y) + (s.horizontal ? half : 0),
  };
}

export function inRect(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

/**
 * The race's route round the city's grid: its corners, in the order it
 * drives them. (The junctions it goes straight through are in between.)
 */
export function trackRoute(track: Track, grid: CityGrid): Vec2[] {
  const { minX, minY, maxX, maxY } = track.bounds;
  // The junctions on the track: it goes straight through them, or turns at them (cutting their corner a little).
  const on: { x: number; y: number; along: number }[] = [];
  for (const x of grid.xs) {
    if (x < minX - 300 || x > maxX + 300) continue;
    for (const y of grid.ys) {
      if (y < minY - 300 || y > maxY + 300) continue;
      const pos = locateOnTrack(track, x, y);
      if (pos.distance < track.width / 2 + 60) on.push({ x, y, along: pos.along });
    }
  }
  on.sort((a, b) => a.along - b.along);
  return on
    .filter((v, k) => {
      const a = on[(k - 1 + on.length) % on.length];
      const b = on[(k + 1) % on.length];
      return (v.x - a.x) * (b.y - v.y) - (v.y - a.y) * (b.x - v.x) !== 0;
    })
    .map(({ x, y }) => ({ x, y }));
}

/** A junction's centre, as a point. */
export function at(j: Junction): Vec2 {
  return { x: j.x, y: j.y };
}

/** A junction the race goes through (or turns at), where it is along the track, and how far its box reaches each way. */
export interface TrackJunction {
  junction: Junction;
  along: number;
  /** How far back and ahead of `along` the junction box reaches (to the end of the turn, at a corner), px. */
  before: number;
  after: number;
  /** The race turns here. */
  corner: boolean;
  /** Side streets leading off it: right of the track, left, or both. */
  sides: (1 | -1)[];
}

/**
 * The junctions on the race's route, in order round the lap, with the stretch
 * of track each one's box covers: the width of the side streets on a
 * straight, out to where the road straightens up at a corner.
 */
export function trackJunctions(track: Track, city: City, radii: number[]): TrackJunction[] {
  const n = track.points.length;
  const { spacing } = track;
  const half = SIDE_STREET.width / 2 + 8;
  const sides = city.streets.filter((s) => !s.onTrack);
  const out: TrackJunction[] = [];
  for (const junction of city.junctions) {
    if (!junction.onTrack) continue;
    const pos = locateOnTrack(track, junction.x, junction.y);
    const i = Math.round(pos.along / spacing) % n;
    const corner = pos.distance > 20;
    // Out from the junction both ways until the road's straight and clear of the side streets.
    const reach = (dir: 1 | -1) => {
      for (let k = 0; k < Math.ceil(900 / spacing); k++) {
        const d = k * spacing;
        if (d >= half && (!corner || radii[(i + dir * k + n * 2) % n] > 1200)) return d;
      }
      return 900;
    };
    const arms: (1 | -1)[] = [];
    for (const s of sides) {
      if (s.a !== junction && s.b !== junction) continue;
      const other = s.a === junction ? s.b : s.a;
      // Which side of the track the street heads off to.
      const nrm = track.normals[i];
      const side = (other.x - junction.x) * nrm.x + (other.y - junction.y) * nrm.y > 0 ? 1 : -1;
      if (!arms.includes(side)) arms.push(side);
    }
    out.push({ junction, along: pos.along, before: reach(-1), after: reach(1), corner, sides: arms });
  }
  return out.sort((a, b) => a.along - b.along);
}
