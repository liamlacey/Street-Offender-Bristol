/**
 * Planning a downtown around its track: the city's streets and blocks (see
 * city.ts), and what fills the blocks: buildings, mostly, from low brick
 * walk-ups to glass towers (tallest in the middle of town), split into lots
 * with alleys between some; and here and there a park, a car park, a
 * construction site or a plaza. The scenery planner (track/decoration.ts)
 * calls this when a location has a city.
 */

import type { Placer } from '../track/decoration';
import { TYRE_RADIUS } from '../track/barriers';
import { CROSSING, CROSSING_GAP, point, wrap } from './road';
import { locateOnTrack } from '../track/Track';
import { type City, type Rect, type TrackJunction, planCity, trackJunctions } from './city';
import { type StreetLife, planStreetLife } from './street';

/** A building: its footprint, how many floors, its look, and a seed for what's on its roof. */
export interface Building extends Rect {
  floors: number;
  style: number;
  seed: number;
}

/** A block (or part of one) that isn't buildings. */
export interface Grounds extends Rect {
  kind: 'park' | 'parking' | 'site' | 'plaza';
}

/** What a downtown adds to a track's scenery that isn't a prop. */
export interface Downtown {
  city: City;
  /** The junctions the race goes through, in order round the lap. */
  junctions: TrackJunction[];
  buildings: Building[];
  grounds: Grounds[];
  /** Parked cars, people and street furniture along the race's streets. */
  street: StreetLife;
  /** Traffic lights over the race's streets. */
  signals: Signal[];
}

/**
 * A traffic light over one of the race's streets: its pole at the back of
 * the pavement, the way its arm reaches out over the road and how far, and
 * which of the race's junctions it's at (for its lights).
 */
export interface Signal {
  x: number;
  y: number;
  angle: number;
  reach: number;
  junction: number;
}

/** How many looks buildings come in (see CityScenery). */
export const BUILDING_STYLES = 6;
/** Smallest a block can be and still have something on it, px. */
const MIN_BLOCK = 140;
/** Smallest lot a building goes on, px. */
const MIN_LOT = 110;

export function planDowntown(kit: Placer, margin: number): Downtown | null {
  const { track } = kit;
  if (!track.grid) return null;
  const city = planCity(track, track.grid, kit.beyond, margin);
  const junctions = trackJunctions(track, city, kit.radii);
  const street = planStreetLife(track, city, junctions, kit.runOff);
  const downtown: Downtown = { city, junctions, buildings: [], grounds: [], street, signals: signals(kit, city, junctions) };
  lamps(kit, junctions);
  const { minX, minY, maxX, maxY } = kit.bounds;
  const centre = { x: (track.bounds.minX + track.bounds.maxX) / 2, y: (track.bounds.minY + track.bounds.maxY) / 2 };
  const reach = Math.hypot(track.bounds.maxX - track.bounds.minX, track.bounds.maxY - track.bounds.minY) / 2;
  for (const whole of city.blocks) {
    // Just the part inside the world.
    const block = { x0: Math.max(whole.x0, minX), y0: Math.max(whole.y0, minY), x1: Math.min(whole.x1, maxX), y1: Math.min(whole.y1, maxY) };
    if (block.x1 - block.x0 < MIN_BLOCK || block.y1 - block.y0 < MIN_BLOCK) continue;
    const pick = kit.rng();
    if (pick < 0.07) parkOrPlaza(kit, downtown, block, 'park');
    else if (pick < 0.13) parkOrPlaza(kit, downtown, block, 'plaza');
    else if (pick < 0.21) parking(kit, downtown, block);
    else if (pick < 0.26) site(kit, downtown, block);
    else {
      // Taller towards the middle of town.
      const cx = (block.x0 + block.x1) / 2;
      const cy = (block.y0 + block.y1) / 2;
      const core = Math.max(0, 1 - Math.hypot(cx - centre.x, cy - centre.y) / (reach * 1.3));
      for (const lot of split(kit, block, 0)) building(kit, downtown, lot, core);
    }
  }
  return downtown;
}

/**
 * Traffic lights at each of the race's junctions, one for each of its
 * streets coming in: on the right-hand side of the way in, just back from the
 * stop line, standing in line with the bollards with its arm out over the
 * lanes coming in.
 */
function signals(kit: Placer, city: City, junctions: TrackJunction[]): Signal[] {
  const { track } = kit;
  const out: Signal[] = [];
  const back = track.width / 2 + track.kerbWidth + kit.runOff + TYRE_RADIUS;
  junctions.forEach((jn, index) => {
    for (const s of city.streets) {
      if (!s.onTrack || (s.a !== jn.junction && s.b !== jn.junction)) continue;
      const fromA = s.a === jn.junction;
      const length = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      const d = (fromA ? s.box[0] : s.box[1]) + CROSSING_GAP * 2 + CROSSING.depth + 16;
      // Coming in towards a, the right-hand side is the street's -side; towards b, its +side.
      const side = fromA ? -1 : 1;
      const pole = point(s, fromA ? d : length - d, side * back);
      const middle = point(s, fromA ? d : length - d, 0);
      out.push({ ...pole, angle: Math.atan2(middle.y - pole.y, middle.x - pole.x), reach: back - s.width * 0.25, junction: index });
    }
  });
  return out;
}

/** Street lamps along the pavements between the junctions. */
function lamps(kit: Placer, junctions: TrackJunction[]): void {
  const { track, n } = kit;
  const inJunction = (along: number) => junctions.some((jn) => {
    const d = wrap(along - jn.along, track.length);
    return d > -jn.before - 120 && d < jn.after + 120;
  });
  const step = Math.round(280 / track.spacing);
  let side: 1 | -1 = 1;
  for (let i = kit.int(step); i < n; i += step) {
    side = side === 1 ? -1 : 1;
    if (!inJunction(i * track.spacing)) kit.facing('lamp', i, side, 14, 14, 2, 0, [0, 8]);
  }
}

/** Cuts a block into building lots, now and then with an alley between. */
function split(kit: Placer, r: Rect, depth: number): Rect[] {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const most = 220 + kit.rng() * 320;
  if (depth >= 6 || (w <= most && h <= most) || (w < MIN_LOT * 2 + 30 && h < MIN_LOT * 2 + 30)) return [r];
  const gap = kit.rng() < 0.3 ? 14 + kit.rng() * 14 : 3;
  const across = w >= h ? w : h;
  const at = (0.35 + kit.rng() * 0.3) * across;
  if (at < MIN_LOT || across - at - gap < MIN_LOT) return [r];
  const [a, b] =
    w >= h
      ? [{ ...r, x1: r.x0 + at }, { ...r, x0: r.x0 + at + gap }]
      : [{ ...r, y1: r.y0 + at }, { ...r, y0: r.y0 + at + gap }];
  return [...split(kit, a, depth + 1), ...split(kit, b, depth + 1)];
}

/**
 * Puts a building on a lot, a little set back, if it fits clear of the track
 * (cutting it back from the track where a corner swings close).
 */
function building(kit: Placer, downtown: Downtown, lot: Rect, core: number): void {
  const setback = kit.rng() < 0.5 ? 0 : 3 + kit.rng() * 8;
  let r = { x0: lot.x0 + setback, y0: lot.y0 + setback, x1: lot.x1 - setback, y1: lot.y1 - setback };
  for (let tries = 0; tries < 4; tries++) {
    if (r.x1 - r.x0 < MIN_LOT * 0.7 || r.y1 - r.y0 < MIN_LOT * 0.7) return;
    const prop = rectProp(kit, r);
    if (kit.add(prop, kit.beyond + 4, 1)) {
      const roll = kit.rng();
      // Low walk-ups, mid-rise blocks, and towers (most of them in the middle of town).
      const floors =
        roll < 0.45 - core * 0.25
          ? 3 + kit.int(6)
          : roll < 0.85 - core * 0.3
            ? 9 + kit.int(16)
            : 26 + kit.int(Math.round(20 + core * 30));
      downtown.buildings.push({ ...r, floors, style: kit.int(BUILDING_STYLES), seed: kit.int(1_000_000) });
      return;
    }
    // Cut it back on the side nearest the track.
    const pos = locateOnTrack(kit.track, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    const dx = pos.x - (r.x0 + r.x1) / 2;
    const dy = pos.y - (r.y0 + r.y1) / 2;
    const cut = 50;
    if (Math.abs(dx) > Math.abs(dy)) r = dx > 0 ? { ...r, x1: r.x1 - cut } : { ...r, x0: r.x0 + cut };
    else r = dy > 0 ? { ...r, y1: r.y1 - cut } : { ...r, y0: r.y0 + cut };
  }
}

function rectProp(kit: Placer, r: Rect, kind: 'building' = 'building') {
  return kit.prop(kind, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0, r.x1 - r.x0, r.y1 - r.y0, 0);
}

/** Whether a stretch of ground is clear of the track's barriers (checked with a placeholder prop). */
function clear(kit: Placer, r: Rect): boolean {
  const probe = rectProp(kit, r);
  return kit.fits(probe, kit.beyond + 4, 1);
}

/** A park (lawns and trees, a fountain, benches) or a paved plaza (planted trees, a fountain). */
function parkOrPlaza(kit: Placer, downtown: Downtown, block: Rect, kind: 'park' | 'plaza'): void {
  const r = shrinkToFit(kit, block);
  if (!r) return;
  downtown.grounds.push({ ...r, kind });
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  kit.add(kit.prop('fountain', cx, cy, 0, 64, 64, kit.int(2)), kit.beyond + 4, 6);
  const step = kind === 'park' ? 70 : 110;
  for (let x = r.x0 + 40; x < r.x1 - 30; x += step) {
    for (let y = r.y0 + 40; y < r.y1 - 30; y += step) {
      if (Math.hypot(x - cx, y - cy) < 90) continue;
      const jitter = kind === 'park' ? 22 : 0;
      const size = kind === 'park' ? 40 + kit.int(28) : 40;
      if (kind === 'park' && kit.rng() < 0.25) continue;
      kit.add(
        kit.prop('tree', x + (kit.rng() - 0.5) * jitter, y + (kit.rng() - 0.5) * jitter, kit.rng() * Math.PI * 2, size, size, kit.int(3)),
        kit.beyond + 4,
        2,
      );
    }
  }
  for (const [dx, dy, angle] of [[0, -60, 0], [0, 60, Math.PI], [-60, 0, -Math.PI / 2], [60, 0, Math.PI / 2]] as const) {
    if (kit.rng() < 0.6) kit.add(kit.prop('bench', cx + dx, cy + dy, angle, 30, 10, 0), kit.beyond + 4, 4);
  }
}

/** A car park: rows of parked cars nose to nose across the lot. */
function parking(kit: Placer, downtown: Downtown, block: Rect): void {
  const r = shrinkToFit(kit, block);
  if (!r) return;
  downtown.grounds.push({ ...r, kind: 'parking' });
  const row = 46;
  const aisle = 36;
  const bay = 26;
  const across = r.x1 - r.x0 >= r.y1 - r.y0;
  const length = across ? r.x1 - r.x0 : r.y1 - r.y0;
  const depth = across ? r.y1 - r.y0 : r.x1 - r.x0;
  // Aisle, two rows nose to nose, aisle, and so on.
  for (let v = aisle, k = 0; v + row <= depth - 6; v += row + (k % 2 === 1 ? aisle : 0), k++) {
    const facing = k % 2 === 0 ? 1 : -1;
    for (let u = 12 + bay / 2; u < length - 12; u += bay) {
      if (kit.rng() < 0.25) continue;
      const x = across ? r.x0 + u : r.x0 + v + row / 2;
      const y = across ? r.y0 + v + row / 2 : r.y0 + u;
      const angle = (across ? Math.PI / 2 : 0) + (facing === 1 ? 0 : Math.PI) + (kit.rng() - 0.5) * 0.08;
      kit.add(kit.prop('parked', x, y, angle, 40, 20, kit.int(12)), kit.beyond + 4, 1);
    }
  }
}

/** A construction site: a tower crane over the hole, a digger, site cabins and materials. */
function site(kit: Placer, downtown: Downtown, block: Rect): void {
  const r = shrinkToFit(kit, block);
  if (!r) return;
  downtown.grounds.push({ ...r, kind: 'site' });
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  kit.add(kit.prop('towercrane', cx + (kit.rng() - 0.5) * 60, cy + (kit.rng() - 0.5) * 60, 0, 26, 26, kit.int(2)), kit.beyond + 4, 4);
  for (let k = 0; k < 6; k++) {
    const x = r.x0 + 40 + kit.rng() * (r.x1 - r.x0 - 80);
    const y = r.y0 + 30 + kit.rng() * (r.y1 - r.y0 - 60);
    const pick = kit.rng();
    if (pick < 0.3) kit.add(kit.prop('digger', x, y, kit.rng() * Math.PI * 2, 56, 30, 0), kit.beyond + 4, 10);
    else if (pick < 0.6) kit.add(kit.prop('portacabin', x, y, kit.int(2) * (Math.PI / 2), 72, 30, kit.int(2)), kit.beyond + 4, 8);
    else kit.add(kit.prop('pallets', x, y, kit.int(4) * (Math.PI / 2), 30, 30, kit.int(2)), kit.beyond + 4, 6);
  }
}

/** The block, cut back from the track until it's clear of it; null if too little is left. */
function shrinkToFit(kit: Placer, block: Rect): Rect | null {
  let r = { ...block };
  for (let tries = 0; tries < 6; tries++) {
    if (r.x1 - r.x0 < MIN_BLOCK || r.y1 - r.y0 < MIN_BLOCK) return null;
    if (clear(kit, r)) return r;
    const pos = locateOnTrack(kit.track, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    const dx = pos.x - (r.x0 + r.x1) / 2;
    const dy = pos.y - (r.y0 + r.y1) / 2;
    if (Math.abs(dx) > Math.abs(dy)) r = dx > 0 ? { ...r, x1: r.x1 - 50 } : { ...r, x0: r.x0 + 50 };
    else r = dy > 0 ? { ...r, y1: r.y1 - 50 } : { ...r, y0: r.y0 + 50 };
  }
  return null;
}
