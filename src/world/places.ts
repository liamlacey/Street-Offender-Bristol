/**
 * What goes on round the places on the map (see the map's `places`): worked
 * out from the map as each region's made ready, the same every time.
 *
 * - Schools and nurseries: the grounds surfaced (tarmac), the courts marked
 *   out on it (netball or five-a-side), hopscotch; a green mesh fence round
 *   the grounds, its gate on the side nearest the road; at a primary school
 *   or nursery, a climbing frame, a slide, spring riders; picnic benches; the
 *   bikes in a row by the building (a secondary school). The children in
 *   the playground (never hit: see people.ts), a teacher or two keeping an
 *   eye, parents waiting at the gate, a lollipop lady out on the pavement.
 *
 * - Pubs: a beer garden (picnic tables under parasols, on open ground behind
 *   or beside it), kegs by the door, an A-board, smokers out the front.
 * - Graveyards (a churchyard, a cemetery): rows of headstones and the odd
 *   tomb, clear of the paths and the trees; benches by the paths; a few
 *   visitors.
 * - Blocks of flats: a lawn round them, the bin store (big communal bins), a
 *   row of bikes. Lock-up garages: the tarmac in front, a car at some, junk.
 * - Industrial estates: the yards concreted; at the big sheds, a lorry backed
 *   up to the loading door, a forklift, pallets, a container or two, a skip,
 *   big bins; the workers in hi-vis. Shops' and offices' land: bins and
 *   pallets out the back.
 * - A university's buildings, students about them and their bikes; a
 *   hospital's entrance, people outside it; a stadium, a crowd (and the
 *   burger vans, the stewards); a library, a sports centre or a community
 *   centre, its bikes and people at the door; the prison, its high wall.
 *
 * Pure (from the map alone), so it's tested.
 */

import { type Area, type AreaKind, type GameMap, type Place, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis } from '../map/osm';
import { rectsOverlap } from './playgrounds';
import { type SportsGame, sportsOf } from './sports';
import { type Work, every } from './work.ts';
import { distToSeg } from './geometry';

const M = 8;

/** The loose things put down round the places (world.ts says how heavy each is). */
export interface PlaceThing {
  kind: string;
  x: number;
  y: number;
  angle: number;
  variant?: number;
}

/** A fence (or a wall) put up round a place. */
export interface PlaceLine {
  kind: 'mesh' | 'wall' | 'fence' | 'railing' | 'hedge' | 'prison' | 'net';
  pts: Pts;
  height: number;
}

/** Where people are about a place: a spot (as people.ts has them), and who. */
export interface PlaceSpot {
  x: number;
  y: number;
  angle: number;
  weight: number;
  group: boolean;
  /** Children (how big: a nursery's are smaller than a secondary school's). */
  child?: number;
  /** In hi-vis: a lollipop lady, with her sign; a worker. */
  lollipop?: boolean;
  hivis?: boolean;
}

export interface PlaceLife {
  things: PlaceThing[];
  lines: PlaceLine[];
  /** Ground laid down (a school's tarmac, its courts and their markings), drawn with the map's own areas. */
  areas: Area[];
  spots: PlaceSpot[];
  /** Where those at a place wander about (a school's grounds). */
  rings: Pts[];
  /** Where a vehicle's parked (a lorry at a loading bay, a car at a lock-up), and how likely it's there. */
  spaces: { x: number; y: number; angle: number; length: number; taken: number; endOn: boolean; kind?: string; sale?: boolean }[];
  /** The games on the pitches and courts (see sports.ts). */
  games: SportsGame[];
}

/** A court marked out on a school's playground: netball (30.5 m by 15.25 m) or five-a-side, and smaller ones where there's no room. */
const COURTS: [number, number][] = [
  [30.5 * M, 15.25 * M],
  [24 * M, 13 * M],
  [18 * M, 10 * M],
];
/** The least a school's (and a nursery's) grounds have to be to be laid out, px². */
const SCHOOL_LEAST = 600 * M * M;
const NURSERY_LEAST = 150 * M * M;
/** One child out for every this much of the grounds, at most this many. */
const PER_CHILD = 70 * M * M;
const CHILDREN = 40;
/** What a playground's things aren't put on: what's mapped already (grass, the pitches, the car park, ...). */
const MAPPED: ReadonlySet<AreaKind> = new Set(['grass', 'park', 'garden', 'flowerbed', 'wood', 'pitch', 'play', 'parking', 'water', 'pool', 'dirt', 'brownfield', 'forecourt', 'yard', 'platform', 'island', 'plaza']);
const CELL = 16 * M;

const cache = new WeakMap<GameMap, PlaceLife>();

/** What's been laid out for a map elsewhere (in the layout worker: see layout.ts), taken as worked out here. */
export function primePlaces(map: GameMap, value: PlaceLife): void {
  cache.set(map, value);
}

/** What goes on round a map's places (worked out once for each), a little at a time (see work.ts). */
export function* placesWork(map: GameMap): Work<PlaceLife> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(1);
  const out: PlaceLife = { things: [], lines: [], areas: [], spots: [], rings: [], spaces: [], games: [] };
  const places = map.places ?? [];
  const ground = new Ground(map);
  yield;
  const seen = new Set<string>();
  // (Where the cafés' tables are, by the metre: one place's not put over another's.)
  const tables = new Set<string>();
  for (const place of places) {
    if (pause()) yield;
    // (The same place twice over, in two tiles: once.)
    const name = `${place.kind},${place.x},${place.y}`;
    if (seen.has(name)) continue;
    seen.add(name);
    switch (place.kind) {
      case 'school':
      case 'nursery':
        yield* school(place, ground, out);
        break;
      case 'pub':
        pub(place, ground, out);
        break;
      case 'graveyard':
        graveyard(place, ground, out);
        break;
      case 'industrial':
      case 'commercial':
        works(place, ground, out);
        break;
      case 'university':
      case 'college':
      case 'hospital':
      case 'library':
      case 'sports':
      case 'community':
      case 'stadium':
        crowd(place, ground, out);
        break;
      case 'prison':
        prison(place, ground, out);
        break;
      case 'food':
        food(place, ground, out, tables);
        break;
      case 'takeaway':
        takeaway(place, ground, out);
        break;
      case 'seating':
        seating(place, ground, out, tables);
        break;
      case 'cardealer':
        dealer(place, ground, out);
        break;
      case 'carrepair':
        repairs(place, ground, out);
        break;
      case 'taxi':
        rank(place, ground, out);
        break;
      case 'substation':
        substation(place, ground, out);
        break;
      case 'allotments':
        allotments(place, ground, out);
        break;
      case 'shop':
        shopFront(place, ground, out);
        break;
      case 'atm':
        cashpoint(place, ground, out);
        break;
      case 'charger':
        charging(place, ground, out);
        break;
    }
  }
  // The blocks of flats, and the lock-up garages.
  const pauseB = every(200);
  for (let i = 0; i < (map.buildings ?? []).length; i++) {
    if (pauseB()) yield;
    const b = map.buildings[i];
    if (!b.solid || b.bottom || !b.drawn) continue;
    if (b.kind === 'apartments') flats(i, ground, out);
    else if (b.kind === 'garages' || (b.kind === 'garage' && Math.abs(ringArea(b.rings[0])) > 40 * M * M)) garages(i, ground, out);
  }
  // The pitches and courts: laid out for their sports (see sports.ts).
  yield;
  const sports = sportsOf(map);
  out.things.push(...sports.things);
  out.lines.push(...sports.lines);
  out.areas.push(...sports.areas);
  out.games.push(...sports.games);
  cache.set(map, out);
  return out;
}

/** The map's buildings, roads and areas, by the squares they're in, to ask what's at a point. */
class Ground {
  private readonly buildings = new Map<number, number[]>();
  private readonly boxes: [number, number, number, number][];
  private readonly areas = new Map<number, Area[]>();
  private readonly roads = new Map<number, { ax: number; ay: number; bx: number; by: number; reach: number; half: number; vehicle: boolean }[]>();
  private readonly trees = new Map<number, [number, number][]>();

  constructor(readonly map: GameMap) {
    this.boxes = (map.buildings ?? []).map((b) => bounds(b.rings[0]));
    (map.buildings ?? []).forEach((b, i) => {
      if (b.solid && !b.bottom) this.add(this.buildings, i, this.boxes[i]);
    });
    for (const a of map.areas ?? []) if (MAPPED.has(a.kind)) this.add(this.areas, a, bounds(a.rings[0]));
    const t = map.trees ?? [];
    for (let k = 0; k + 3 < t.length; k += 4) this.add(this.trees, [t[k], t[k + 1]] as [number, number], [t[k] - 2 * M, t[k + 1] - 2 * M, t[k] + 2 * M, t[k + 1] + 2 * M]);
    for (const r of map.roads ?? []) {
      if (r.tunnel || r.bridge) continue;
      const reach = r.width / 2 + (VEHICLE_ROADS.has(r.kind) && r.pavement ? 2.4 * M : 0);
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const s = { ax: r.pts[k], ay: r.pts[k + 1], bx: r.pts[k + 2], by: r.pts[k + 3], reach, half: VEHICLE_ROADS.has(r.kind) ? r.width / 2 : Number.NaN, vehicle: VEHICLE_ROADS.has(r.kind) && r.kind !== 'service' && r.kind !== 'track' };
        this.add(this.roads, s, [Math.min(s.ax, s.bx) - reach, Math.min(s.ay, s.by) - reach, Math.max(s.ax, s.bx) + reach, Math.max(s.ay, s.by) + reach]);
      }
    }
  }

  private add<T>(grid: Map<number, T[]>, item: T, [x0, y0, x1, y1]: [number, number, number, number]): void {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
        const k = i * 100003 + j;
        const list = grid.get(k);
        if (list) list.push(item);
        else grid.set(k, [item]);
      }
    }
  }

  private at<T>(grid: Map<number, T[]>, x: number, y: number): T[] {
    return grid.get(Math.floor(x / CELL) * 100003 + Math.floor(y / CELL)) ?? [];
  }

  /** The building at a point (its index), or -1. */
  buildingAt(x: number, y: number): number {
    for (const i of this.at(this.buildings, x, y)) {
      const [x0, y0, x1, y1] = this.boxes[i];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInRing(x, y, this.map.buildings[i].rings[0])) return i;
    }
    return -1;
  }

  /** The buildings whose outlines are within a box. */
  buildingsIn(x0: number, y0: number, x1: number, y1: number): number[] {
    const found = new Set<number>();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) for (const k of this.buildings.get(i * 100003 + j) ?? []) found.add(k);
    }
    return [...found].filter((k) => {
      const [a0, b0, a1, b1] = this.boxes[k];
      return a1 > x0 && a0 < x1 && b1 > y0 && b0 < y1;
    });
  }

  /** Under a tree's trunk (or within `pad` px of it). */
  byTree(x: number, y: number, pad: number): boolean {
    for (const [tx, ty] of this.at(this.trees, x, y)) if (Math.hypot(tx - x, ty - y) < pad) return true;
    return false;
  }

  inBuilding(x: number, y: number): boolean {
    for (const i of this.at(this.buildings, x, y)) {
      const [x0, y0, x1, y1] = this.boxes[i];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInRing(x, y, this.map.buildings[i].rings[0])) return true;
    }
    return false;
  }

  inMapped(x: number, y: number): boolean {
    for (const a of this.at(this.areas, x, y)) if (a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0))) return true;
    return false;
  }

  /** On grass (or a garden) that's mapped. */
  onGrass(x: number, y: number): boolean {
    for (const a of this.at(this.areas, x, y)) if ((a.kind === 'grass' || a.kind === 'park' || a.kind === 'garden') && pointInRing(x, y, a.rings[0])) return true;
    return false;
  }

  onRoad(x: number, y: number, pad = 0): boolean {
    for (const s of this.at(this.roads, x, y)) if (distToSeg(x, y, s.ax, s.ay, s.bx, s.by) < s.reach + pad) return true;
    return false;
  }

  /** In a carriageway (not on its pavements), or within `pad` px of one. */
  onCarriageway(x: number, y: number, pad = 0): boolean {
    for (const s of this.at(this.roads, x, y)) if (distToSeg(x, y, s.ax, s.ay, s.bx, s.by) < s.half + pad) return true;
    return false;
  }

  /** The nearest point on a road (a carriageway) within `reach` px, or null. */
  nearestRoad(x: number, y: number, reach: number): [number, number] | null {
    let best: [number, number] | null = null;
    let d = reach;
    for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++) {
      for (let j = Math.floor((y - reach) / CELL); j <= Math.floor((y + reach) / CELL); j++) {
        for (const s of this.roads.get(i * 100003 + j) ?? []) {
          if (!s.vehicle) continue;
          const [px, py] = nearestOnSeg(x, y, s.ax, s.ay, s.bx, s.by);
          const dd = Math.hypot(px - x, py - y);
          if (dd < d) [best, d] = [[px, py], dd];
        }
      }
    }
    return best;
  }
}

/** A school's (or a nursery's) grounds laid out, and who's about them. */
function* school(place: Place, ground: Ground, out: PlaceLife): Work {
  const ring = place.rings[0];
  if (!ring || ring.length < 6) return;
  const nursery = place.kind === 'nursery';
  const area = Math.abs(ringArea(ring));
  if (area < (nursery ? NURSERY_LEAST : SCHOOL_LEAST)) return;
  const primary = nursery || /primary|infant|junior|nursery|first|c of e|ce |church of england|catholic|st\.? /i.test(place.name ?? '') && !/secondary|academy|college|high|grammar/i.test(place.name ?? '');
  const rand = seeded(hash(ring[0], ring[1]));
  const box = bounds(ring);
  const inside = (x: number, y: number) => pointInRing(x, y, ring);
  // Open ground: in the grounds, not in a building, on a road, or on anything mapped there already.
  const open = (x: number, y: number) => inside(x, y) && !ground.inBuilding(x, y) && !ground.inMapped(x, y) && !ground.onRoad(x, y);
  // The grounds, surfaced (under what's mapped on them: the grass, the pitches, the car park).
  out.areas.push({ kind: 'schoolyard', rings: [ring] });
  out.rings.push(ring);

  // The spots tried, two metres apart, in an order of their own.
  const spots: [number, number][] = [];
  const step = Math.max(2 * M, Math.ceil(Math.sqrt(area / 6000) / M) * M);
  for (let x = box[0] + M; x < box[2]; x += step) for (let y = box[1] + M; y < box[3]; y += step) if (inside(x, y)) spots.push([x, y]);
  const order = spots.map((p) => [p, hash(p[0], p[1])] as const).sort((p, q) => p[1] - q[1]).map(([p]) => p);
  const placed: [number, number, number, number, number][] = [];
  const { ux, uy } = ridgeAxis(ring);
  const square = Math.atan2(uy, ux);
  // Something this big (half along, half across) at the first spot it fits, square to the grounds (or across them).
  // (A pause every so often: a big school's grounds take a while.)
  const fit = function* (hl: number, hw: number, apart: number, tries = 1500): Work<[number, number, number] | null> {
    let n = 0;
    for (const [x, y] of order) {
      if (++n > tries) break;
      if (n % 40 === 0) yield;
      for (const angle of [square, square + Math.PI / 2]) {
        const [c, s] = [Math.cos(angle), Math.sin(angle)];
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [x + c * hl * a - s * hw * b, y + s * hl * a + c * hw * b]);
        if (!pts.every(([px, py]) => open(px, py))) continue;
        if (placed.some((o) => rectsOverlap([x, y, angle, hl + apart, hw + apart], [o[0], o[1], o[2], o[3], o[4]]))) continue;
        placed.push([x, y, angle, hl, hw]);
        return [x, y, angle];
      }
    }
    return null;
  };

  // The courts: one (two, on big grounds) of the biggest that fit; netball at a primary, five-a-side at a secondary.
  for (let k = 0; k < (area > 6000 * M * M ? 2 : 1) && !nursery; k++) {
    for (const [len, wide] of COURTS) {
      const at = yield* fit(len / 2, wide / 2, 1.5 * M);
      if (!at) continue;
      out.areas.push(court(at, len, wide, primary && k === 0 ? 'netball' : 'football'));
      break;
    }
  }
  // Hopscotch (two at a primary, one at a nursery), by the building.
  for (let k = 0; k < (primary ? 2 : 0); k++) {
    const at = yield* fit(2.2 * M, 0.7 * M, 0.5 * M);
    if (at) out.areas.push(hopscotch(at));
  }
  // The climbing frame, the slide, the spring riders; picnic benches.
  const put = function* (kind: string, hl: number, hw: number, apart = 1.2 * M): Work {
    const at = yield* fit(hl, hw, apart);
    if (at) out.things.push({ kind, x: r1(at[0]), y: r1(at[1]), angle: +at[2].toFixed(3) });
  };
  if (primary) {
    yield* put('climbframe', 2 * M, 2 * M);
    if (rand() < 0.7) yield* put('slide', 3.2 * M, 1.1 * M);
    yield* put('springy', 1 * M, 1 * M);
    if (rand() < 0.6) yield* put('springy', 1 * M, 1 * M);
    if (nursery) yield* put('sandpit', 2.1 * M, 2.1 * M);
  }
  for (let k = 0, n = nursery ? 1 : 2 + Math.floor(rand() * 3); k < n; k++) yield* put('picnic', 1.1 * M, 0.9 * M, 1.5 * M);
  // The bikes, in a row (a secondary school's).
  if (!primary) {
    const at = yield* fit(4 * M, 1.1 * M, 0.6 * M);
    if (at) {
      const [x, y, angle] = at;
      const [c, s] = [Math.cos(angle), Math.sin(angle)];
      for (let k = 0, n = 5 + Math.floor(rand() * 5); k < n; k++) {
        const t = -3.6 * M + (k * 7.2 * M) / Math.max(1, n - 1);
        out.things.push({ kind: 'pushbike', x: r1(x + c * t), y: r1(y + s * t), angle: +(angle + Math.PI / 2 + (rand() - 0.5) * 0.2).toFixed(3) });
      }
    }
  }

  // The fence round it, green mesh (not across a building or a road), its gate nearest the road (and a gap for those on foot).
  const edge = [...ring, ring[0], ring[1]];
  let [gx, gy, gd] = [ring[0], ring[1], Infinity];
  for (let i = 0; i + 3 < edge.length; i += 2) {
    const len = Math.hypot(edge[i + 2] - edge[i], edge[i + 3] - edge[i + 1]);
    for (let d = 0; d <= len; d += 2 * M) {
      const t = len ? d / len : 0;
      const [x, y] = [edge[i] + (edge[i + 2] - edge[i]) * t, edge[i + 1] + (edge[i + 3] - edge[i + 1]) * t];
      const road = ground.nearestRoad(x, y, 25 * M);
      if (road && Math.hypot(road[0] - x, road[1] - y) < gd) [gx, gy, gd] = [x, y, Math.hypot(road[0] - x, road[1] - y)];
    }
  }
  const GATE = 5 * M;
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 4) out.lines.push({ kind: 'mesh', pts: run, height: 1.8 * M });
    run = [];
  };
  for (let i = 0; i + 3 < edge.length; i += 2) {
    const [ax, ay, bx, by] = [edge[i], edge[i + 1], edge[i + 2], edge[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / (2.5 * M)));
    for (let k = 0; k < n; k++) {
      const [x0, y0, x1, y1] = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n];
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (Math.hypot(mx - gx, my - gy) < GATE / 2 || ground.inBuilding(mx, my) || ground.onRoad(mx, my, -0.5 * M)) {
        flush();
        continue;
      }
      if (!run.length) run.push(r1(x0), r1(y0));
      run.push(r1(x1), r1(y1));
    }
  }
  flush();

  // Who's about: the children out in the playground (and on the field), a teacher or two; parents waiting outside the gate, and a
  // lollipop lady by the road.
  const size = nursery ? 0.6 : primary ? 0.72 : 0.88;
  const children = Math.max(nursery ? 4 : 8, Math.min(nursery ? 12 : CHILDREN, Math.round(area / PER_CHILD)));
  let kids = 0;
  for (const [x, y] of order) {
    if (kids >= children) break;
    if (ground.inBuilding(x, y) || ground.onRoad(x, y) || !inside(x, y)) continue;
    const group = rand() < 0.35;
    out.spots.push({ x: r1(x), y: r1(y), angle: +(rand() * Math.PI * 2).toFixed(3), weight: group ? 1.4 : 1, group, child: size });
    kids += group ? 3 : 1;
  }
  for (let k = 0, n = nursery ? 1 : 2; k < n; k++) {
    const [x, y] = order[Math.floor(rand() * order.length)] ?? [0, 0];
    if (order.length && !ground.inBuilding(x, y)) out.spots.push({ x: r1(x), y: r1(y), angle: 0, weight: 0.6, group: false });
  }
  const road = ground.nearestRoad(gx, gy, 25 * M);
  if (road) {
    // Outside the gate, towards the road; the lollipop lady at the kerb.
    const [dx, dy] = unit(road[0] - gx, road[1] - gy);
    const d = Math.hypot(road[0] - gx, road[1] - gy);
    out.spots.push({ x: r1(gx + dx * Math.min(2 * M, d * 0.4)), y: r1(gy + dy * Math.min(2 * M, d * 0.4)), angle: +Math.atan2(-dy, -dx).toFixed(3), weight: 1.5, group: true });
    if (!nursery) out.spots.push({ x: r1(road[0] - dx * 0.4 * M), y: r1(road[1] - dy * 0.4 * M), angle: +Math.atan2(dy, dx).toFixed(3), weight: 0.6, group: false, lollipop: true });
  }
}

/** Something put down at (x, y), turned `angle`. */
function thing(out: PlaceLife, kind: string, x: number, y: number, angle: number, variant?: number): void {
  out.things.push({ kind, x: r1(x), y: r1(y), angle: +angle.toFixed(3), ...(variant === undefined ? {} : { variant }) });
}

/** A building's outline, its middle, its long axis, and its extent along and across that (from its middle), px. */
function shape(ring: Pts): { cx: number; cy: number; ux: number; uy: number; a0: number; a1: number; b0: number; b1: number } {
  const { ux, uy } = ridgeAxis(ring);
  let [cx, cy] = [0, 0];
  for (let k = 0; k + 1 < ring.length; k += 2) [cx, cy] = [cx + ring[k], cy + ring[k + 1]];
  [cx, cy] = [(cx * 2) / ring.length, (cy * 2) / ring.length];
  let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k + 1 < ring.length; k += 2) {
    const [dx, dy] = [ring[k] - cx, ring[k + 1] - cy];
    const a = dx * ux + dy * uy;
    const b = -dx * uy + dy * ux;
    [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
  }
  return { cx, cy, ux, uy, a0, a1, b0, b1 };
}

/** The point on a building's edge nearest the road (its door, near enough), and the way out of it, towards the road; or null. */
function doorOf(ring: Pts, ground: Ground, reach = 40 * M): { x: number; y: number; ox: number; oy: number; road: [number, number] } | null {
  let best: { x: number; y: number; d: number; road: [number, number] } | null = null;
  for (let k = 0; k + 1 < ring.length; k += 2) {
    const j = (k + 2) % ring.length;
    const [x, y] = [(ring[k] + ring[j]) / 2, (ring[k + 1] + ring[j + 1]) / 2];
    const road = ground.nearestRoad(x, y, reach);
    if (!road) continue;
    const d = Math.hypot(road[0] - x, road[1] - y);
    if (!best || d < best.d) best = { x, y, d, road };
  }
  if (!best) return null;
  const [ox, oy] = unit(best.road[0] - best.x, best.road[1] - best.y);
  return { x: best.x, y: best.y, ox, oy, road: best.road };
}

/** Where to stand out of a door: `want` px out, or nearer if that's too near the road (a metre clear, for a group round it); or null. */
function outOf(door: { x: number; y: number; ox: number; oy: number }, ground: Ground, want: number): [number, number] | null {
  for (let d = want; d >= 0.5 * M; d -= 0.4 * M) {
    const [x, y] = [door.x + door.ox * d, door.y + door.oy * d];
    if (!ground.onCarriageway(x, y, M)) return [r1(x), r1(y)];
  }
  return null;
}

/** A pub: its beer garden, kegs and A-board, its smokers. */
function pub(place: Place, ground: Ground, out: PlaceLife): void {
  // Its building: the one it's mapped as, or the one it's in.
  const own = place.rings[0];
  const b = ground.buildingAt(place.x, place.y);
  const ring = b >= 0 ? ground.map.buildings[b].rings[0] : Math.abs(ringArea(own)) > 30 * M * M ? own : null;
  if (!ring) return;
  const rand = seeded(hash(place.x, place.y));
  const door = doorOf(ring, ground, 30 * M);
  if (door) {
    const { x, y, ox, oy } = door;
    // Out the front, on the pavement: two to four having a smoke; an A-board; kegs against the wall by the door.
    const at = outOf(door, ground, 1.6 * M);
    if (at) out.spots.push({ x: at[0], y: at[1], angle: 0, weight: 1.2, group: true });
    const [sx, sy] = [-oy, ox];
    if (!ground.onRoad(x + ox * 1.2 * M + sx * 1.5 * M, y + oy * 1.2 * M + sy * 1.5 * M, -1.5 * M)) thing(out, 'aboard', x + ox * 1.2 * M + sx * 1.5 * M, y + oy * 1.2 * M + sy * 1.5 * M, Math.atan2(sy, sx));
    for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
      const [kx, ky] = [x + ox * 0.45 * M - sx * (1.6 + k * 0.6) * M, y + oy * 0.45 * M - sy * (1.6 + k * 0.6) * M];
      if (!ground.inBuilding(kx, ky)) thing(out, 'keg', kx, ky, 0);
    }
  }
  // The beer garden: open ground round the back and sides (up to 20 m off), tables 3 m apart, a parasol over most.
  const { cx, cy } = shape(ring);
  const tables: [number, number][] = [];
  const want = 2 + Math.floor(rand() * 5);
  for (let r = 3 * M; r < 20 * M && tables.length < want; r += 2 * M) {
    for (let k = 0; k < 16 && tables.length < want; k++) {
      const a = (k / 16) * Math.PI * 2 + r;
      // Not out the front (the road side).
      if (door && Math.cos(a) * door.ox + Math.sin(a) * door.oy > 0.3) continue;
      // From its edge, outwards.
      const [x, y] = [cx + Math.cos(a) * (r + 6 * M), cy + Math.sin(a) * (r + 6 * M)];
      if (ground.inBuilding(x, y) || ground.onRoad(x, y, 1 * M) || ground.inMapped(x, y) && !ground.onGrass(x, y)) continue;
      if (tables.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 3 * M)) continue;
      // (Each side of a table clear too.)
      if ([[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([dx, dy]) => ground.inBuilding(x + dx * M, y + dy * M))) continue;
      tables.push([x, y]);
    }
  }
  if (tables.length < 2) return;
  const turn = Math.atan2(shape(ring).uy, shape(ring).ux);
  const colour = Math.floor(rand() * 4);
  for (const [x, y] of tables) {
    thing(out, 'picnic', x, y, turn);
    if (rand() < 0.75) thing(out, 'parasol', x, y, turn, colour);
  }
}

/** A graveyard: rows of headstones (and tombs), benches by its paths, visitors. */
function graveyard(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring || ring.length < 6) return;
  const area = Math.abs(ringArea(ring));
  if (area < 150 * M * M) return;
  const rand = seeded(hash(ring[0], ring[1]));
  const box = bounds(ring);
  const { ux, uy } = ridgeAxis(ring);
  const [vx, vy] = [-uy, ux];
  // In rows across its long axis: a headstone every 1.4 m along a row, the rows 2.6 m apart (fewer, on a big one, so there aren't
  // too many: at most about 500).
  const stretch = Math.max(1, Math.sqrt(area / (500 * 1.4 * 2.6 * M * M)));
  const [along, apart] = [1.4 * M * stretch, 2.6 * M * stretch];
  const reach = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2;
  const [mx, my] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  let n = 0;
  for (let b = -reach; b < reach; b += apart) {
    for (let a = -reach; a < reach; a += along) {
      if (n >= 500) break;
      const [x, y] = [mx + ux * a + vx * b + (rand() - 0.5) * 0.3 * M, my + uy * a + vy * b + (rand() - 0.5) * 0.3 * M];
      if (!pointInRing(x, y, ring) || rand() < 0.2) continue;
      // Clear of the paths (a metre and a half), the trees' trunks, the church.
      if (ground.onRoad(x, y, 1.5 * M) || ground.byTree(x, y, 1.2 * M) || ground.inBuilding(x, y) || ground.inBuilding(x + vx * M, y + vy * M) || ground.inBuilding(x - vx * M, y - vy * M)) continue;
      const tomb = rand() < 0.06;
      // Facing along the row (east, more or less), each a little off true.
      thing(out, tomb ? 'tomb' : 'headstone', x, y, Math.atan2(vy, vx) + (rand() - 0.5) * 0.12, tomb ? 0 : Math.floor(rand() * 3));
      n++;
    }
  }
  // Benches beside its paths; a few visitors.
  let benches = 0;
  for (let k = 0; k < 60 && benches < Math.min(6, 1 + area / (2000 * M * M)); k++) {
    const [x, y] = [box[0] + rand() * (box[2] - box[0]), box[1] + rand() * (box[3] - box[1])];
    if (!pointInRing(x, y, ring) || ground.inBuilding(x, y) || ground.onRoad(x, y, 0.8 * M) || !ground.onRoad(x, y, 2.5 * M)) continue;
    thing(out, 'bench', x, y, Math.atan2(uy, ux));
    benches++;
  }
  for (let k = 0, v = Math.min(4, 1 + Math.floor(area / (3000 * M * M))); k < 30 && v > 0; k++) {
    const [x, y] = [box[0] + rand() * (box[2] - box[0]), box[1] + rand() * (box[3] - box[1])];
    if (!pointInRing(x, y, ring) || ground.inBuilding(x, y)) continue;
    out.spots.push({ x: r1(x), y: r1(y), angle: +(rand() * Math.PI * 2).toFixed(3), weight: 0.5, group: rand() < 0.3 });
    v--;
  }
}

/** A block of flats: the lawn round it, its bin store, its bikes. */
function flats(i: number, ground: Ground, out: PlaceLife): void {
  const ring = ground.map.buildings[i].rings[0];
  const area = Math.abs(ringArea(ring));
  if (area < 120 * M * M) return;
  const { cx, cy, ux, uy, a0, a1, b0, b1 } = shape(ring);
  const [vx, vy] = [-uy, ux];
  const at = (a: number, b: number): [number, number] => [cx + ux * a + vx * b, cy + uy * a + vy * b];
  // A lawn round it, 6 m out (under the roads, paths, car parks and everything else).
  const pad = 6 * M;
  out.areas.push({ kind: 'gardens', rings: [[...at(a0 - pad, b0 - pad), ...at(a1 + pad, b0 - pad), ...at(a1 + pad, b1 + pad), ...at(a0 - pad, b1 + pad)].map(r1)] });
  const rand = seeded(hash(cx, cy));
  const door = doorOf(ring, ground, 40 * M);
  if (!door) return;
  // The bin store: big communal bins in a row, beside the building, towards the road (not on it).
  const [sx, sy] = [-door.oy, door.ox];
  const bins = 3 + Math.floor(rand() * 4);
  const side = rand() < 0.5 ? 1 : -1;
  for (let k = 0; k < bins; k++) {
    const [x, y] = [door.x + door.ox * 1.4 * M + sx * side * (3 + k * 1.5) * M, door.y + door.oy * 1.4 * M + sy * side * (3 + k * 1.5) * M];
    if (ground.inBuilding(x, y) || ground.onRoad(x, y, 0.3 * M)) continue;
    thing(out, 'bigbin', x, y, Math.atan2(door.oy, door.ox) + Math.PI / 2, Math.floor(rand() * 3));
  }
  // A row of bikes the other side of the door.
  if (rand() < 0.6) {
    for (let k = 0, n = 3 + Math.floor(rand() * 5); k < n; k++) {
      const [x, y] = [door.x + door.ox * 1.2 * M - sx * side * (3 + k * 0.7) * M, door.y + door.oy * 1.2 * M - sy * side * (3 + k * 0.7) * M];
      if (ground.inBuilding(x, y) || ground.onRoad(x, y, 0.3 * M)) continue;
      thing(out, 'pushbike', x, y, Math.atan2(door.oy, door.ox) + (rand() - 0.5) * 0.2);
    }
  }
  // Someone at the door, now and then.
  const stand = rand() < 0.4 && outOf(door, ground, 1.5 * M);
  if (stand) out.spots.push({ x: stand[0], y: stand[1], angle: 0, weight: 0.6, group: false });
}

/** Lock-up garages: the tarmac in front of their doors, a car at some, junk at others. */
function garages(i: number, ground: Ground, out: PlaceLife): void {
  const ring = ground.map.buildings[i].rings[0];
  const { cx, cy, ux, uy, a0, a1, b0, b1 } = shape(ring);
  const [vx, vy] = [-uy, ux];
  const at = (a: number, b: number): [number, number] => [cx + ux * a + vx * b, cy + uy * a + vy * b];
  // The doors along the long side facing the nearer way in (a road, a lane, a drive).
  const front = (side: number) => {
    const [x, y] = at((a0 + a1) / 2, side > 0 ? b1 + 3 * M : b0 - 3 * M);
    const road = ground.nearestRoad(x, y, 30 * M);
    return road ? Math.hypot(road[0] - x, road[1] - y) : Infinity;
  };
  const side = front(1) <= front(-1) ? 1 : -1;
  const edge = side > 0 ? b1 : b0;
  const depth = 5.5 * M;
  const apron = [...at(a0, edge), ...at(a1, edge), ...at(a1, edge + side * depth), ...at(a0, edge + side * depth)];
  // (Not out over a building or a road.)
  const [mx, my] = at((a0 + a1) / 2, edge + side * depth * 0.6);
  if (ground.inBuilding(mx, my)) return;
  out.areas.push({ kind: 'drive', rings: [apron.map(r1)] });
  const rand = seeded(hash(cx, cy));
  const doors = Math.max(1, Math.round((a1 - a0) / (3 * M)));
  for (let k = 0; k < doors; k++) {
    const a = a0 + ((k + 0.5) * (a1 - a0)) / doors;
    const r = rand();
    const [x, y] = at(a, edge + side * 2.8 * M);
    if (ground.inBuilding(x, y) || ground.onRoad(x, y)) continue;
    // A car, nose to the door, at some; junk at others (old tyres, a pallet, a bin).
    if (r < 0.35) out.spaces.push({ x: r1(x), y: r1(y), angle: +Math.atan2(-side * vy, -side * vx).toFixed(3), length: 4.6 * M, taken: 1, endOn: true });
    else if (r < 0.5) thing(out, rand() < 0.4 ? 'tyres' : rand() < 0.5 ? 'woodpallet' : 'wheelie', ...at(a + (rand() - 0.5) * M, edge + side * 0.8 * M), rand() * Math.PI, 0);
  }
}

/** An industrial estate (or shops' and offices' land): its yards concreted; at its big sheds, loading bays and all that goes on there. */
function works(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring || ring.length < 6 || Math.abs(ringArea(ring)) < 800 * M * M) return;
  const industrial = place.kind === 'industrial';
  if (industrial) out.areas.push({ kind: 'works', rings: [ring] });
  const box = bounds(ring);
  const rand = seeded(hash(ring[0], ring[1]));
  let sheds = 0;
  for (const i of ground.buildingsIn(...box)) {
    if (sheds >= 30) break;
    const b = ground.map.buildings[i];
    const area = Math.abs(ringArea(b.rings[0]));
    const { cx, cy } = shape(b.rings[0]);
    if (!pointInRing(cx, cy, ring) || area < (industrial ? 300 : 500) * M * M || b.kind === 'house' || b.kind === 'apartments') continue;
    const door = doorOf(b.rings[0], ground, 45 * M);
    if (!door) continue;
    sheds++;
    const { x, y, ox, oy } = door;
    const [sx, sy] = [-oy, ox];
    const out1 = (d: number, s: number): [number, number] => [x + ox * d + sx * s, y + oy * d + sy * s];
    const clear = (p: [number, number]) => !ground.inBuilding(...p) && !ground.onRoad(...p, 0.5 * M);
    if (industrial) {
      // A lorry backed up to the loading door (most of the time), its back to the door.
      const bay = out1(5.5 * M, 0);
      if (clear(bay) && clear(out1(9 * M, 0))) out.spaces.push({ x: r1(bay[0]), y: r1(bay[1]), angle: +Math.atan2(oy, ox).toFixed(3), length: 10 * M, taken: 0.7, endOn: true, kind: 'lorry' });
      // A forklift; pallets stacked by the wall; a container or two; a skip; big bins.
      const spots: [string, number, number, number, number?][] = [
        ['forklift', 3.5 * M, 4.5 * M, Math.atan2(oy, ox) + rand() * 2],
        ['woodpallet', 1 * M, -4 * M, 0],
        ['pallet', 1 * M, -5.2 * M, 0],
        ['woodpallet', 1 * M, -6.4 * M, 0.3],
        ['container', 7 * M, -9 * M, Math.atan2(oy, ox), Math.floor(rand() * 4)],
        ['skip', 2 * M, 8 * M, Math.atan2(sy, sx)],
        ['bigbin', 1 * M, 6 * M, Math.atan2(sy, sx), Math.floor(rand() * 3)],
      ];
      for (const [kind, d, s, angle, variant] of spots) {
        if (rand() < 0.3) continue;
        const p = out1(d, s);
        if (clear(p)) thing(out, kind, p[0], p[1], angle, variant);
      }
      out.spots.push({ x: r1(out1(3 * M, 2 * M)[0]), y: r1(out1(3 * M, 2 * M)[1]), angle: 0, weight: 1, group: rand() < 0.5, hivis: true });
    } else {
      // Out the back of a shop or an office: big bins, a pallet or two.
      for (const [kind, d, s, variant] of [['bigbin', 1.2 * M, 4 * M, 0], ['bigbin', 1.2 * M, 5.5 * M, 1], ['woodpallet', 1 * M, -4 * M, undefined]] as [string, number, number, number | undefined][]) {
        if (rand() < 0.35) continue;
        const p = out1(d, s);
        if (clear(p)) thing(out, kind, p[0], p[1], Math.atan2(sy, sx), variant);
      }
    }
  }
}

/** A university, a hospital, a library, a sports centre, a stadium: people about its doors, bikes, benches; a crowd at a stadium. */
function crowd(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring) return;
  const rand = seeded(hash(place.x, place.y));
  const box = bounds(ring);
  const area = Math.abs(ringArea(ring));
  const stadium = place.kind === 'stadium';
  // The buildings in it (or the one it is), each its door.
  const own = ground.buildingAt(place.x, place.y);
  const inIt = area > 30 * M * M ? ground.buildingsIn(...box).filter((i) => pointInRing(shape(ground.map.buildings[i].rings[0]).cx, shape(ground.map.buildings[i].rings[0]).cy, ring)) : [];
  const buildings = [...new Set([...(own >= 0 ? [own] : []), ...inIt])].slice(0, stadium ? 4 : 12);
  for (const i of buildings) {
    const door = doorOf(ground.map.buildings[i].rings[0], ground, 50 * M);
    if (!door) continue;
    const { x, y, ox, oy } = door;
    const [sx, sy] = [-oy, ox];
    const weight = stadium ? 4 : place.kind === 'university' || place.kind === 'college' ? 1.6 : place.kind === 'hospital' ? 1.4 : 0.8;
    const at = outOf(door, ground, 2 * M);
    if (at) out.spots.push({ x: at[0], y: at[1], angle: 0, weight, group: true });
    const [hx, hy] = [x + ox * 1.5 * M + sx * 4 * M, y + oy * 1.5 * M + sy * 4 * M];
    if (place.kind === 'hospital' && rand() < 0.8 && !ground.onCarriageway(hx, hy, M)) out.spots.push({ x: r1(hx), y: r1(hy), angle: 0, weight: 0.8, group: true });
    // Bikes by the door (not at a hospital or a stadium), a bench or two.
    if (!stadium && place.kind !== 'hospital' && rand() < 0.7) {
      for (let k = 0, n = 3 + Math.floor(rand() * (place.kind === 'university' ? 8 : 4)); k < n; k++) {
        const [bx, by] = [x + ox * 1 * M - sx * (3 + k * 0.7) * M, y + oy * 1 * M - sy * (3 + k * 0.7) * M];
        if (ground.inBuilding(bx, by) || ground.onRoad(bx, by, 0.3 * M)) continue;
        thing(out, 'pushbike', bx, by, Math.atan2(oy, ox) + (rand() - 0.5) * 0.2);
      }
    }
    if (!stadium && rand() < 0.6) {
      const [bx, by] = [x + ox * 2.5 * M + sx * 5 * M, y + oy * 2.5 * M + sy * 5 * M];
      if (!ground.inBuilding(bx, by) && !ground.onRoad(bx, by, 0.5 * M)) thing(out, 'bench', bx, by, Math.atan2(sy, sx));
    }
  }
  if (!stadium) return;
  // A stadium: the crowd all round it (a match on), the stewards in hi-vis, the burger vans.
  const edge = [...ring, ring[0], ring[1]];
  for (let i = 0; i + 3 < edge.length; i += 2) {
    const len = Math.hypot(edge[i + 2] - edge[i], edge[i + 3] - edge[i + 1]);
    for (let d = 4 * M; d < len; d += 9 * M) {
      const t = d / len;
      const [x, y] = [edge[i] + (edge[i + 2] - edge[i]) * t, edge[i + 1] + (edge[i + 3] - edge[i + 1]) * t];
      // Just outside it.
      const [nx, ny] = unit(x - place.x, y - place.y);
      const [px, py] = [x + nx * 3 * M, y + ny * 3 * M];
      if (ground.inBuilding(px, py) || ground.onRoad(px, py, -2.4 * M)) continue;
      const r = rand();
      if (r < 0.08 && !ground.onRoad(px, py)) thing(out, 'foodcart', px + nx * 2 * M, py + ny * 2 * M, Math.atan2(ny, nx), 3);
      else out.spots.push({ x: r1(px), y: r1(py), angle: +Math.atan2(-ny, -nx).toFixed(3), weight: r < 0.2 ? 0.6 : 3.5, group: r >= 0.2, ...(r < 0.2 ? { hivis: true } : {}) });
    }
  }
}

/** A café's table, by where it is to the metre and round it (see `food`, `seating`): whether there's one there already, and if not, it's taken. */
function tableAt(tables: Set<string>, x: number, y: number): boolean {
  const [i, j] = [Math.round(x / (2 * M)), Math.round(y / (2 * M))];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (tables.has(`${i + a},${j + b}`)) return true;
  tables.add(`${i},${j}`);
  return false;
}

/** A place's building (the one it's mapped as, or the one it's in), and its door: or null. */
function frontOf(place: Place, ground: Ground, reach = 25 * M): { ring: Pts; door: NonNullable<ReturnType<typeof doorOf>> } | null {
  const b = ground.buildingAt(place.x, place.y);
  const ring = b >= 0 ? ground.map.buildings[b].rings[0] : place.rings[0];
  if (!ring) return null;
  const door = doorOf(ring, ground, reach);
  return door ? { ring, door } : null;
}

/** Along the front of a place from its door (`along` px either way, `out` px out from the wall), clear of the road and the buildings: or null. */
function onFront(door: { x: number; y: number; ox: number; oy: number }, ground: Ground, along: number, out: number, clear = 1 * M): [number, number] | null {
  const [sx, sy] = [-door.oy, door.ox];
  const [x, y] = [door.x + door.ox * out + sx * along, door.y + door.oy * out + sy * along];
  if (ground.inBuilding(x, y) || ground.onCarriageway(x, y, clear)) return null;
  return [x, y];
}

/** A café or restaurant: its tables and chairs out on the pavement in front (where there's room), a parasol over some, people at them. */
function food(place: Place, ground: Ground, out: PlaceLife, tables: Set<string>): void {
  const front = frontOf(place, ground);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  const colour = Math.floor(rand() * 4);
  const want = place.sub === 'restaurant' ? 2 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 3);
  const turn = Math.atan2(door.ox, -door.oy);
  let put = 0;
  for (const k of [0.6, -0.6, 1.8, -1.8, 3, -3]) {
    if (put >= want) break;
    const at = onFront(door, ground, k * 2.4 * M, 1.6 * M, 1.4 * M);
    if (!at || tableAt(tables, at[0], at[1])) continue;
    thing(out, 'cafetable', at[0], at[1], turn, colour);
    if (place.sub === 'restaurant' && rand() < 0.3) thing(out, 'parasol', at[0], at[1], turn, colour);
    if (rand() < 0.7) out.spots.push({ x: r1(at[0]), y: r1(at[1]), angle: 0, weight: 0.9, group: true });
    put++;
  }
}

/** A takeaway: a queue out of its door along the front, and a delivery moped (or two) at the kerb. */
function takeaway(place: Place, ground: Ground, out: PlaceLife): void {
  const front = frontOf(place, ground);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  const [sx, sy] = [-door.oy, door.ox];
  for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
    const at = onFront(door, ground, (0.9 + k * 0.8) * M, 0.9 * M, 0.5 * M);
    if (at) out.spots.push({ x: r1(at[0]), y: r1(at[1]), angle: +Math.atan2(-sy, -sx).toFixed(3), weight: 0.8, group: false });
  }
  for (let k = 0, n = rand() < 0.5 ? 1 : rand() < 0.5 ? 2 : 0; k < n; k++) {
    const kerb = outOf(door, ground, 4 * M);
    if (!kerb) break;
    const [x, y] = [kerb[0] - sx * (2 + k * 1.2) * M, kerb[1] - sy * (2 + k * 1.2) * M];
    if (!ground.inBuilding(x, y) && !ground.onCarriageway(x, y, 0.3 * M)) thing(out, 'moped', x, y, Math.atan2(sy, sx) + (rand() - 0.5) * 0.3, Math.floor(rand() * 3));
  }
}

/** Tables outside (`leisure=outdoor_seating`): as many as there's room for, 2.6 m apart, people at some. */
function seating(place: Place, ground: Ground, out: PlaceLife, tables: Set<string>): void {
  const ring = place.rings[0];
  if (!ring) return;
  const rand = seeded(hash(place.x, place.y));
  const colour = Math.floor(rand() * 4);
  const [x0, y0, x1, y1] = bounds(ring);
  let put = 0;
  for (let y = y0 + 1.3 * M; y < y1 && put < 14; y += 2.6 * M) {
    for (let x = x0 + 1.3 * M; x < x1 && put < 14; x += 2.6 * M) {
      if (!pointInRing(x, y, ring) || ground.inBuilding(x, y) || ground.onCarriageway(x, y, 1 * M) || tableAt(tables, x, y)) continue;
      thing(out, 'cafetable', x, y, 0, colour);
      if (rand() < 0.6) out.spots.push({ x: r1(x), y: r1(y), angle: 0, weight: 0.8, group: true });
      put++;
    }
  }
}

/** A car dealer: its forecourt full of cars for sale (in rows, noses to the road; any of them can be driven off), an A-board. */
function dealer(place: Place, ground: Ground, out: PlaceLife): void {
  const front = frontOf(place, ground, 40 * M);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  const kinds = ['hatch', 'saloon', 'suv', 'small', 'estate'];
  const nose = +Math.atan2(door.oy, door.ox).toFixed(3);
  let put = 0;
  for (let row = 0; row < 3 && put < 14; row++) {
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      if (put >= 14) break;
      const out1 = (3.4 + row * 5.6) * M;
      // (Room for the whole car: its front and back clear too.)
      const at = onFront(door, ground, k * 2.7 * M, out1, 1.5 * M);
      if (!at || !onFront(door, ground, k * 2.7 * M, out1 + 2.5 * M, 1 * M) || !onFront(door, ground, k * 2.7 * M, out1 - 2.5 * M, 0)) continue;
      out.spaces.push({ x: r1(at[0]), y: r1(at[1]), angle: nose, length: 5 * M, taken: 1, endOn: true, kind: kinds[Math.floor(rand() * kinds.length)], sale: true });
      put++;
    }
  }
  const board = onFront(door, ground, 2 * M, 1.2 * M);
  if (put && board) thing(out, 'aboard', board[0], board[1], Math.atan2(door.ox, -door.oy));
}

/** A garage that mends cars: a car or two out front waiting, old tyres stacked, a tool chest and an oil drum, a mechanic. */
function repairs(place: Place, ground: Ground, out: PlaceLife): void {
  const front = frontOf(place, ground);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  const nose = +Math.atan2(-door.oy, -door.ox).toFixed(3);
  for (const k of [0, 1.2]) {
    const at = onFront(door, ground, k * 2.7 * M, 3.2 * M, 1.5 * M);
    if (at && onFront(door, ground, k * 2.7 * M, 5.5 * M, 1 * M)) out.spaces.push({ x: r1(at[0]), y: r1(at[1]), angle: nose, length: 4.8 * M, taken: 0.8, endOn: true });
  }
  for (const [kind, along] of [['tyres', -2.2], ['tyres', -3], ['toolchest', 2.6], ['drum', -3.8]] as [string, number][]) {
    if (rand() < 0.3) continue;
    const at = onFront(door, ground, along * M, 0.8 * M, 0.5 * M);
    if (at) thing(out, kind, at[0], at[1], Math.atan2(door.ox, -door.oy) + (rand() - 0.5) * 0.4);
  }
  const at = outOf(door, ground, 1.8 * M);
  if (at && rand() < 0.8) out.spots.push({ x: at[0], y: at[1], angle: 0, weight: 0.6, group: false, hivis: true });
}

/** A taxi rank: those waiting for one, in a line along the kerb by it (the taxis are the traffic's: see posts.ts). */
function rank(place: Place, ground: Ground, out: PlaceLife): void {
  // The nearest pavement to it (it's mapped on the road, or at its edge), and the way along the road.
  const road = ground.nearestRoad(place.x, place.y, 20 * M);
  if (!road) return;
  let best: [number, number] | null = null;
  for (let d = 0; d <= 8 * M && !best; d += 0.5 * M) {
    for (let a = 0; a < 16 && !best; a++) {
      const [x, y] = [place.x + Math.cos((a / 16) * Math.PI * 2) * d, place.y + Math.sin((a / 16) * Math.PI * 2) * d];
      if (!ground.onCarriageway(x, y, 0.6 * M) && !ground.inBuilding(x, y)) best = [x, y];
    }
  }
  if (!best) return;
  const [ox, oy] = unit(road[0] - best[0], road[1] - best[1]);
  const [sx, sy] = [-oy, ox];
  const rand = seeded(hash(place.x, place.y));
  for (let k = 0, n = Math.floor(rand() * 4); k < n; k++) {
    const [x, y] = [best[0] + sx * k * 0.9 * M, best[1] + sy * k * 0.9 * M];
    if (!ground.onCarriageway(x, y, 0.4 * M) && !ground.inBuilding(x, y)) out.spots.push({ x: r1(x), y: r1(y), angle: +Math.atan2(-sy, -sx).toFixed(3), weight: 0.8, group: false });
  }
}

/** An electricity substation: a mesh fence round its compound (if it's not a building of its own), its transformers inside. */
function substation(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring) return;
  const area = Math.abs(ringArea(ring));
  const { cx, cy, ux, uy, a0, a1 } = shape(ring);
  // (In a building, or a box in a wall: nothing to fence.)
  if (ground.buildingAt(cx, cy) >= 0) return;
  if (area > 12 * M * M) out.lines.push({ kind: 'mesh', pts: [...ring, ring[0], ring[1]].map(r1), height: 2.4 * M });
  const count = Math.max(1, Math.min(4, Math.floor(area / (45 * M * M))));
  for (let k = 0; k < count; k++) {
    const a = count === 1 ? 0 : a0 + ((k + 0.5) * (a1 - a0)) / count;
    const [x, y] = [cx + ux * a, cy + uy * a];
    if (!pointInRing(x, y, ring) && count > 1) continue;
    if (!ground.inBuilding(x, y) && !ground.onRoad(x, y)) thing(out, 'transformer', x, y, Math.atan2(uy, ux) + Math.PI / 2);
  }
}

/** Allotments: on its plots (8 m by 16 m, along it), sheds, the odd greenhouse, water butts, compost bins; people at work on some. */
function allotments(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring || Math.abs(ringArea(ring)) < 200 * M * M) return;
  const rand = seeded(hash(place.x, place.y));
  const { cx, cy, ux, uy, a0, a1, b0, b1 } = shape(ring);
  const [vx, vy] = [-uy, ux];
  const at = (a: number, b: number): [number, number] => [cx + ux * a + vx * b, cy + uy * a + vy * b];
  const turn = Math.atan2(uy, ux);
  let things = 0;
  for (let a = a0 + 4 * M; a < a1 - 2 * M && things < 160; a += 8 * M) {
    for (let b = b0 + 8 * M; b < b1 - 2 * M && things < 160; b += 16 * M) {
      const [x, y] = at(a, b);
      if (!pointInRing(x, y, ring) || ground.inBuilding(x, y) || ground.onRoad(x, y, 1 * M)) continue;
      // At the plot's end (by the path): a shed, a greenhouse; a butt and a compost bin by them.
      const [ex, ey] = at(a + 2.2 * M, b - 6 * M);
      const r = rand();
      if (pointInRing(ex, ey, ring) && !ground.inBuilding(ex, ey)) {
        if (r < 0.35) thing(out, 'shed', ex, ey, turn, 0);
        else if (r < 0.43) thing(out, 'greenhouse', ex, ey, turn, 0);
        things++;
      }
      const [wx, wy] = at(a - 2.6 * M, b - 6.5 * M);
      if (rand() < 0.5 && pointInRing(wx, wy, ring)) (thing(out, 'butt', wx, wy, 0), things++);
      const [kx, ky] = at(a - 2.6 * M, b - 4.6 * M);
      if (rand() < 0.35 && pointInRing(kx, ky, ring)) (thing(out, 'compost', kx, ky, turn), things++);
      if (rand() < 0.12) out.spots.push({ x: r1(x), y: r1(y), angle: 0, weight: 0.5, group: false });
    }
  }
}

/** A shop with its goods (or what it is) out front: flowers, fruit and veg, bikes, papers; an empty one boarded up. */
function shopFront(place: Place, ground: Ground, out: PlaceLife): void {
  const front = frontOf(place, ground);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  const along = Math.atan2(door.ox, -door.oy);
  const put = (kind: string, k: number, outward: number, angle = along, variant?: number) => {
    const at = onFront(door, ground, k * M, outward * M, 0.5 * M);
    if (at) thing(out, kind, at[0], at[1], angle, variant);
  };
  switch (place.sub) {
    case 'florist':
      for (const k of [-1.2, 0, 1.2, 2.4]) if (rand() < 0.8) put('flowers', k + 1.4, 0.7, along, Math.floor(rand() * 3));
      break;
    case 'greengrocer':
      for (const k of [-1.4, 1.4, 2.6]) if (rand() < 0.8) put('crates', k, 0.8, along, Math.floor(rand() * 3));
      break;
    case 'bicycle':
      for (let k = 0; k < 5; k++) put('pushbike', 1.6 + k * 0.7, 0.9, Math.atan2(door.oy, door.ox));
      break;
    case 'newsagent':
    case 'convenience':
      put('newsstand', 1.4, 0.6);
      if (rand() < 0.5) put('aboard', -1.6, 1.2);
      break;
    case 'vacant':
      // Its windows boarded, against its front.
      put('boards', 1.6, 0.3);
      if (rand() < 0.6) put('boards', -1.8, 0.3);
      if (rand() < 0.4) put('binbags', 2.8, 0.6);
      break;
    case 'charity':
      // Bags of donations left outside.
      if (rand() < 0.7) put('binbags', 1.4, 0.5);
      break;
    case 'hardware':
      put('woodpallet', 1.8, 0.8, along + Math.PI / 2);
      if (rand() < 0.5) put('drum', -1.4, 0.6);
      break;
    case 'furniture':
      if (rand() < 0.4) put('sofa', 2, 1, along);
      break;
  }
}

/** A cash machine: a queue at it (one to three), from its wall out. */
function cashpoint(place: Place, ground: Ground, out: PlaceLife): void {
  const front = frontOf(place, ground, 15 * M);
  if (!front) return;
  const { door } = front;
  const rand = seeded(hash(place.x, place.y));
  for (let k = 0, n = Math.floor(rand() * 3) + (rand() < 0.5 ? 1 : 0); k < n; k++) {
    const at = onFront(door, ground, 0, (0.7 + k * 0.8) * M, 0.5 * M);
    if (at) out.spots.push({ x: r1(at[0]), y: r1(at[1]), angle: +Math.atan2(-door.oy, -door.ox).toFixed(3), weight: 0.7, group: false });
  }
}

/** An electric car's charging point: a car on charge beside it, most of the time. */
function charging(place: Place, ground: Ground, out: PlaceLife): void {
  const road = ground.nearestRoad(place.x, place.y, 15 * M);
  if (!road) return;
  const [ox, oy] = unit(road[0] - place.x, road[1] - place.y);
  const [sx, sy] = [-oy, ox];
  const [x, y] = [place.x + sx * 1.6 * M, place.y + sy * 1.6 * M];
  if (ground.inBuilding(x, y) || ground.onCarriageway(x, y, 0)) return;
  out.spaces.push({ x: r1(x), y: r1(y), angle: +Math.atan2(oy, ox).toFixed(3), length: 4.8 * M, taken: 0.75, endOn: true, kind: 'hatch' });
}

/** The prison: its high wall round it. */
function prison(place: Place, ground: Ground, out: PlaceLife): void {
  const ring = place.rings[0];
  if (!ring || Math.abs(ringArea(ring)) < 2000 * M * M) return;
  const edge = [...ring, ring[0], ring[1]];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 4) out.lines.push({ kind: 'prison', pts: run, height: 5.5 * M });
    run = [];
  };
  for (let i = 0; i + 3 < edge.length; i += 2) {
    const [ax, ay, bx, by] = [edge[i], edge[i + 1], edge[i + 2], edge[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / (4 * M)));
    for (let k = 0; k < n; k++) {
      const [x0, y0, x1, y1] = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n];
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (ground.inBuilding(mx, my) || ground.onRoad(mx, my, -1 * M)) {
        flush();
        continue;
      }
      if (!run.length) run.push(r1(x0), r1(y0));
      run.push(r1(x1), r1(y1));
    }
  }
  flush();
}

/** A court on the playground: its surface, and its lines. */
function court([x, y, angle]: [number, number, number], len: number, wide: number, kind: 'netball' | 'football'): Area {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const at = (a: number, b: number): [number, number] => [r1(x + c * a - s * b), r1(y + s * a + c * b)];
  const [hl, hw] = [len / 2, wide / 2];
  const rect = [...at(-hl, -hw), ...at(hl, -hw), ...at(hl, hw), ...at(-hl, hw)];
  const segs: number[] = [];
  const line = (a0: number, b0: number, a1: number, b1: number) => segs.push(...at(a0, b0), ...at(a1, b1));
  const arc = (ca: number, cb: number, r: number, from: number, to: number) => {
    const n = Math.max(6, Math.round(((to - from) * r) / (1 * M)));
    for (let k = 0; k < n; k++) {
      const [t0, t1] = [from + ((to - from) * k) / n, from + ((to - from) * (k + 1)) / n];
      line(ca + Math.cos(t0) * r, cb + Math.sin(t0) * r, ca + Math.cos(t1) * r, cb + Math.sin(t1) * r);
    }
  };
  // Round its edge.
  line(-hl, -hw, hl, -hw);
  line(hl, -hw, hl, hw);
  line(hl, hw, -hl, hw);
  line(-hl, hw, -hl, -hw);
  if (kind === 'netball') {
    // Thirds; the centre circle; the shooting circles (semicircles, 4.9 m, or less on a small court).
    line(-hl / 3, -hw, -hl / 3, hw);
    line(hl / 3, -hw, hl / 3, hw);
    arc(0, 0, 0.45 * M, 0, Math.PI * 2);
    const r = Math.min(4.9 * M, hw * 0.9);
    arc(-hl, 0, r, -Math.PI / 2, Math.PI / 2);
    arc(hl, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
  } else {
    // Halfway; the centre circle; the goal areas.
    line(0, -hw, 0, hw);
    arc(0, 0, Math.min(3 * M, hw * 0.4), 0, Math.PI * 2);
    const r = Math.min(4 * M, hw * 0.55);
    arc(-hl, 0, r, -Math.PI / 2, Math.PI / 2);
    arc(hl, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
  }
  return { kind: 'court', rings: [rect], markings: [{ colour: kind === 'netball' ? '#f2f0e6' : '#f2c94c', width: 1.2, segs }] };
}

/** Hopscotch, painted on the playground: its squares, numbered (one, two, one, two, one, two at the top). */
function hopscotch([x, y, angle]: [number, number, number]): Area {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const at = (a: number, b: number): [number, number] => [r1(x + c * a - s * b), r1(y + s * a + c * b)];
  const segs: number[] = [];
  const box = (a0: number, b0: number, a1: number, b1: number) => {
    segs.push(...at(a0, b0), ...at(a1, b0), ...at(a1, b0), ...at(a1, b1), ...at(a1, b1), ...at(a0, b1), ...at(a0, b1), ...at(a0, b0));
  };
  const q = 0.6 * M;
  const rows = [1, 2, 1, 2, 1, 2];
  rows.forEach((n, k) => {
    const a = -1.8 * M + k * q;
    if (n === 1) box(a, -q / 2, a + q, q / 2);
    else {
      box(a, -q, a + q, 0);
      box(a, 0, a + q, q);
    }
  });
  return { kind: 'court', rings: [[...at(-2 * M, -0.7 * M), ...at(2 * M, -0.7 * M), ...at(2 * M, 0.7 * M), ...at(-2 * M, 0.7 * M)]], markings: [{ colour: '#f2c94c', width: 1, segs }], bare: true };
}

function bounds(pts: Pts): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < pts.length; k += 2) {
    x0 = Math.min(x0, pts[k]);
    y0 = Math.min(y0, pts[k + 1]);
    x1 = Math.max(x1, pts[k]);
    y1 = Math.max(y1, pts[k + 1]);
  }
  return [x0, y0, x1, y1];
}

function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

function unit(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

function nearestOnSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}


function hash(x: number, y: number): number {
  return (Math.abs(Math.round(x * 7.31 + y * 13.17) * 2654435761) % 2147483646) + 1;
}

function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
