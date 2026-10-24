/**
 * The city as the game uses it, made from the map data: what the car
 * crashes into (buildings' walls, garden walls, hedges and fences, lamp
 * posts, bollards and tree trunks), the street furniture that can be
 * knocked about (benches and bins), and an index of what's where, so the
 * ground can be drawn a piece at a time. Pure (no Phaser), so it's tested.
 */

import type { Body, Circle, Segment } from '../physics/collisions';
import { type Building, type GameMap, type LineKind, type Prop, type PropKind, type Pts, type Road, pointInRing, ringArea } from '../map/osm';
import { BoxGrid } from './geometry';
import { Decks, waterOf } from './decks';
import { trolleyRows } from './parking';
import { streetLifeWork } from './streetLife';
import { parkLifeWork } from './parkLife';
import { playgroundsWork } from './playgrounds';
import { CRANE_HEIGHT, siteLifeWork } from './sites';
import { homesWork } from './homes';
import { placesWork } from './places';
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
  cctv: 1.6,
  charger: 2.5,
  railsignal: 2,
  // An electricity pylon's feet, square, 8 m or so across.
  pylon: 26,
};

/** Street furniture that can be knocked about: how big, and how heavy (1 / mass, the car's being 1). */
const LOOSE: Partial<Record<PropKind, { r: number; length?: number; invMass: number }>> = {
  bench: { r: 4, length: 15, invMass: 5 },
  bin: { r: 4, invMass: 12 },
  picnic: { r: 6, length: 14, invMass: 3 },
  gritbin: { r: 4, invMass: 3 },
  // Heavy: shoved, not sent flying.
  planter: { r: 6, invMass: 0.8 },
  // Round the cafés, the takeaways, the shops, the garages, the substations, the allotments (see places.ts); a street cabinet.
  cafetable: { r: 4, invMass: 6 },
  moped: { r: 2.5, length: 14, invMass: 5 },
  flowers: { r: 3, invMass: 8 },
  crates: { r: 3, length: 9, invMass: 6 },
  newsstand: { r: 3, invMass: 6 },
  boards: { r: 1.5, length: 10, invMass: 8 },
  transformer: { r: 8, length: 18, invMass: 0.2 },
  butt: { r: 2.5, invMass: 10 },
  compost: { r: 3, invMass: 8 },
  toolchest: { r: 2.5, length: 7, invMass: 2 },
  cabinet: { r: 3.5, length: 10, invMass: 0.6 },
  // Round the works (see places.ts): a bulk bag of sand (a tonne); a crushed car (a stack of them, heavy); a battery storage unit (a
  // container's size, hardly moved); a pumping station's pipework and valves (bolted down); a heap of aggregate (barely shoved).
  bags: { r: 4, invMass: 0.8 },
  crushed: { r: 7, length: 30, invMass: 0.3 },
  battery: { r: 9.5, length: 48, invMass: 0.05 },
  valve: { r: 4, length: 18, invMass: 0.15 },
  heap: { r: 22, invMass: 0.02 },
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
  // On the building sites (see sites.ts): a Portakabin, a portaloo, a skip (heavy), pallets of bricks, a stack of pipes; a digger and a dumper (heavier than your truck).
  cabin: { r: 10, length: 48, invMass: 0.3 },
  portaloo: { r: 5, invMass: 2 },
  skip: { r: 7, length: 29, invMass: 0.35 },
  pallet: { r: 4.5, invMass: 1 },
  pipes: { r: 6, length: 24, invMass: 0.9 },
  digger: { r: 10, length: 40, invMass: 0.15 },
  dumper: { r: 8, length: 29, invMass: 0.4 },
  // Dumped on the brownfield: light, and sent flying.
  mattress: { r: 5.5, length: 15, invMass: 5 },
  sofa: { r: 3.6, length: 16, invMass: 2.5 },
  tyres: { r: 3, invMass: 6 },
  binbags: { r: 3, invMass: 10 },
  fridge: { r: 2.8, invMass: 2 },
  drum: { r: 2.4, invMass: 3 },
  cone: { r: 1.6, invMass: 25 },
  woodpallet: { r: 4, invMass: 6 },
  washer: { r: 2.6, invMass: 2.5 },
  carpet: { r: 2, length: 19, invMass: 6 },
  // A burnt-out car: a heavy shell. A tent, light; a campfire's ring of stones, heavy.
  burntcar: { r: 7.5, length: 35, invMass: 0.6 },
  tent: { r: 6, length: 18, invMass: 8 },
  campfire: { r: 5.5, invMass: 0.5 },
  // In people's gardens (see homes.ts): wheelie bins and a recycling box, light, sent flying; a table and chairs; a shed and a
  // greenhouse (heavier, shoved and smashed); a trampoline (big, light); a rotary washing line (its pole); a barbecue; a bike;
  // a paddling pool, full of water; a kids' playhouse; a plant pot.
  wheelie: { r: 2.6, invMass: 9 },
  recyclebox: { r: 2, invMass: 14 },
  gardenset: { r: 6.5, invMass: 3 },
  shed: { r: 7, length: 19, invMass: 0.9 },
  trampoline: { r: 12.5, invMass: 2 },
  washline: { r: 1.5, invMass: 4 },
  bbq: { r: 2.6, invMass: 6 },
  pushbike: { r: 2, length: 13, invMass: 10 },
  paddling: { r: 7, invMass: 1.5 },
  greenhouse: { r: 7.5, length: 20, invMass: 1.2 },
  playhouse: { r: 5.5, invMass: 3 },
  plantpot: { r: 2, invMass: 8 },
  // Round the places (see places.ts): a pub's parasol (its pole: the canopy's drawn over), a keg; headstones (heavy) and a tomb
  // (very); a big wheeled bin; a forklift (heavy); a shipping container (all but immovable).
  parasol: { r: 1.2, invMass: 6 },
  keg: { r: 2.4, invMass: 3 },
  headstone: { r: 2.6, invMass: 1.2 },
  tomb: { r: 4, length: 18, invMass: 0.25 },
  bigbin: { r: 5, length: 11, invMass: 1.5 },
  forklift: { r: 5.5, length: 22, invMass: 0.5 },
  container: { r: 9.5, length: 48, invMass: 0.08 },
  // On the pitches and courts (see sports.ts): goals (a full-size one 7.3 m across, a small one, a hockey goal), rugby posts
  // (set in the ground), a basketball hoop (its post and board), a netball post, cricket stumps (sent flying), croquet hoops and
  // its peg; a table-tennis table (concrete).
  goal: { r: 6, length: 60, invMass: 1.5 },
  goalsmall: { r: 5, length: 32, invMass: 3 },
  hockeygoal: { r: 5, length: 30, invMass: 2 },
  rugbypost: { r: 2, length: 46, invMass: 0.3 },
  hoop: { r: 3, length: 14, invMass: 0.6 },
  netpost: { r: 2, invMass: 2.5 },
  stumps: { r: 1.5, invMass: 25 },
  wicket: { r: 1, invMass: 30 },
  peg: { r: 1, invMass: 20 },
  pingpong: { r: 6, length: 22, invMass: 0.3 },
};

/** The maps whose gardens' drives and patios have been put in with their areas. */
const withHomes = new WeakSet<GameMap>();

/** The gardens' drives and patios, and what's laid out round the places, put down on the map with its own areas (once). */
export function layDown(map: GameMap, homes: { drives: Pts[]; patios: Pts[] }, places: { areas: GameMap['areas'] }): void {
  if (withHomes.has(map)) return;
  withHomes.add(map);
  for (const pts of homes.drives) map.areas.push({ kind: 'drive', rings: [pts] });
  for (const pts of homes.patios) map.areas.push({ kind: 'patio', rings: [pts] });
  map.areas.push(...places.areas);
}

/** Which of the food carts sells ice cream (see CARTS). */
const ICE_CREAM = 2;

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
  /** Knocked down, but what's left of it's still there, broken (see damage.ts's REMAINS): drawn so, and in the way. */
  broken?: boolean;
  /** When it was broken, s (not broken again by the same hit). */
  brokenAt?: number;
}

/** A wall: a building's (no kind: it won't break), or a garden wall, hedge, fence or railing (which will). */
export interface Wall extends Segment {
  kind?: WallKind;
  level: number;
  /** How tall, px, if measured (the usual for its kind otherwise). */
  height?: number;
  /** Not the map's: put there since (what's left of a broken wall, a fallen tree's trunk). */
  added?: boolean;
  /** One of a hut's walls (a small building that can be driven through: see `isHut`): its id in the whole map. */
  hut?: number;
}

/** The biggest a building can be (its footprint, m²) and still be a hut, driven through (a shed, a kiosk, a garage, a monument). */
export const HUT_AREA = 30;
/** What's lived in, however small: never driven through. */
const LIVED_IN = new Set(['house', 'residential', 'apartments', 'semidetached_house', 'detached', 'terrace', 'bungalow', 'flats', 'dormitory', 'houseboat']);

/** Whether a building's a hut: small enough to be driven through (and knocked down), as a garden wall can be. */
export function isHut(b: Building, pxPerMetre: number): boolean {
  return b.solid && b.drawn && !b.landmark && !LIVED_IN.has(b.kind) && Math.abs(ringArea(b.rings[0])) < HUT_AREA * pxPerMetre * pxPerMetre;
}

/** How high what's left of a hut knocked down stands, px: knee high, rubble over it. */
export const RUIN_HEIGHT = 0.7 * 8;

/** A hut knocked down: what's left of it (low, flat, rubble over it), drawn and its shadow cast so. */
export function ruin(b: Building): void {
  Object.assign(b, { ruined: true, top: RUIN_HEIGHT, bottom: 0 });
}

export interface LooseProp extends Body {
  /** A bench or bin, or a piece of something broken. */
  kind: PropKind | DebrisKind;
  /** Smashed to pieces: it's gone. */
  gone?: boolean;
  /** Smashed, and its wreck left where it was (see WRECKS). */
  wrecked?: boolean;
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
  /** The bridges' decks, their edges worked out (for the region's use: see region.ts). */
  decks?: Decks;
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
      // (Plain numbers, not taken apart from an array: this is called a great many times, and the arrays were garbage.)
      const ax = ring[i];
      const ay = ring[i + 1];
      const bx = ring[j];
      const by = ring[j + 1];
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
    const ax = p[i];
    const ay = p[i + 1];
    const bx = p[i + 2];
    const by = p[i + 3];
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
      const yi = ring[i + 1];
      const yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((ring[j] - ring[i]) * (y - yi)) / (yj - yi) + ring[i]) inside = !inside;
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
  return drain(buildingWallsWork(rings, all, level, joined));
}

/** The same, a little at a time: a pause whenever `due` says (a big building with a lot of ways into it takes a while). */
function* buildingWallsWork(rings: Pts[], all: Road[], level: number, joined: Set<string>, due: () => boolean = () => false): Work<Wall[]> {
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
      if (due()) yield;
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
        for (let k = 0; k + 3 < edge.length; k += 2) {
          if (due()) yield;
          for (const bit of runs(edge[k], edge[k + 1], edge[k + 2], edge[k + 3], keep, 4)) out.push({ ...bit, level });
        }
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
  yield;
  // (The roads and paths by where they are, in squares, each in those its line goes through: each building looks only at those near it.)
  const CELL = 256;
  const wayGrid = new Map<string, Set<Road>>();
  for (const r of map.roads) {
    if (pause()) yield;
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

  // People's gardens (see homes.ts): their drives and patios on the ground (with the map's own areas, once).
  // And round the places (see places.ts): a school's playground and its courts.
  const homes = yield* homesWork(map);
  const places = yield* placesWork(map);
  layDown(map, homes, places);
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
    for (const r of map.roads) {
      if (pause()) yield;
      for (let k = 0; k + 1 < r.pts.length; k += 2) uses.set(`${r.pts[k]},${r.pts[k + 1]}`, (uses.get(`${r.pts[k]},${r.pts[k + 1]}`) ?? 0) + 1);
    }
    for (const [k, n] of uses) if (n > 1) joined.add(k);
  }
  const buildings: Wall[] = [];
  const buildingsUp: Wall[] = [];
  // (A pause every so often: some take far longer than others, where a lot of ways go into them; a big one, partway through.)
  let since = performance.now();
  const due = () => {
    const now = performance.now();
    if (now - since <= BUILDING_STEP) return false;
    since = now;
    return true;
  };
  // (A building by its id in the whole map, in a region of it: the same hut, knocked down, in the next region it's in.)
  const buildingIds = (map as GameMap & { ids?: { buildings: number[] } }).ids?.buildings;
  // The bigger buildings, by where they are: a small one inside one of them (a stair tower, a lift's housing, up on its roof) is
  // part of it, not a hut.
  const bigger = new BoxGrid(
    map.buildings.filter((b) => b.drawn && Math.abs(ringArea(b.rings[0])) >= HUT_AREA * map.pxPerMetre ** 2).map((b) => {
      const [x0, y0, x1, y1] = bounds(b.rings[0]);
      return { x0, y0, x1, y1, ring: b.rings[0] };
    }),
  );
  const within = (b: Building) => {
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return bigger.near(cx, cy, cx, cy, (o) => cx >= o.x0 && cx <= o.x1 && cy >= o.y0 && cy <= o.y1 && pointInRing(cx, cy, o.ring)).length > 0;
  };
  yield;
  for (const [k, b] of map.buildings.entries()) {
    if (due()) yield;
    if (!b.solid) continue;
    const [x0, y0, x1, y1] = bounds(b.rings[0]);
    const near = waysNear({ ax: x0, ay: y0, bx: x1, by: y1, r: 0 });
    const onGround = near.filter((r) => !r.bridge);
    const walls = yield* buildingWallsWork(b.rings, onGround, 0, joined, due);
    const up = onGround.length === near.length ? walls : yield* buildingWallsWork(b.rings, near, 1, joined, due);
    if (isHut(b, map.pxPerMetre) && !within(b)) {
      const hut = buildingIds?.[k] ?? k;
      for (const w of walls) w.hut = hut;
      for (const w of up) w.hut = hut;
    }
    buildings.push(...walls);
    buildingsUp.push(...up);
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
  // The gardens' walls, fences and hedges (see homes.ts); the places' fences (see places.ts).
  for (const l of homes.lines) addRing(ground, l.pts, LINE_THICKNESS[l.kind]!, false, 0, l.kind, l.height);
  for (const l of places.lines) addRing(ground, l.pts, l.kind === 'mesh' || l.kind === 'net' ? 0.6 : l.kind === 'prison' ? 3 : LINE_THICKNESS[l.kind]!, false, 0, l.kind, l.height);
  // The building sites' fences (Heras panels: see sites.ts).
  for (const run of (yield* siteLifeWork(map)).fences) addRing(ground, run, 0.6, false, 0, 'heras');
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
  for (const p of map.props) {
    if (pause()) yield;
    const level = levelOf(p.x, p.y);
    const post = POST_RADIUS[p.kind];
    if (post !== undefined) posts[level].push({ x: p.x, y: p.y, r: post, thing: p.kind as ThingKind, index: fixed.length });
    // Traffic lights and bus stops are mapped on the road's centre line, not where they stand: left off for now.
    if (p.kind === 'signals' || p.kind === 'busstop') continue;
    const l = LOOSE[p.kind];
    if (l) {
      // Benches face along the nearest wall or path; without knowing which (unless the map says), turn each its own way.
      // (Turned by where it is, not its place in the list: the same in each region of the map it's in.)
      const turn = (Math.abs(Math.round(p.x * 7 + p.y * 13)) * 2.399) % Math.PI;
      loose.push({ kind: p.kind, x: p.x, y: p.y, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: p.angle ?? turn - Math.PI / 2, spin: 0, moved: false, level, home: homeOf(p) });
    } else {
      fixed.push({ ...p, level });
    }
  }
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
  // The ice-cream carts in the parks (see parkLife.ts).
  for (const c of (yield* parkLifeWork(map)).carts) add('foodcart', c.x, c.y, c.angle, ICE_CREAM);
  // On the building sites and the brownfield (see sites.ts): its things; its fences (Heras panels); its tower cranes.
  const sites = yield* siteLifeWork(map);
  for (const t of [...sites.things, ...sites.tips]) {
    const l = LOOSE[t.kind]!;
    const p = { kind: t.kind, x: t.x, y: t.y };
    loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: t.angle, spin: 0, moved: false, level: 0, home: homeOf(p) });
  }
  for (const c of sites.cranes) {
    posts[0].push({ x: c.x, y: c.y, r: POST_RADIUS.crane!, thing: 'crane', index: fixed.length });
    fixed.push({ kind: 'crane', x: c.x, y: c.y, angle: c.angle, height: CRANE_HEIGHT, tower: true, level: 0 });
  }
  // What's in the gardens (see homes.ts).
  for (const t of homes.things) {
    if (pause()) yield;
    const l = LOOSE[t.kind]!;
    const p = { kind: t.kind, x: t.x, y: t.y };
    loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: t.angle, spin: 0, moved: false, level: 0, home: homeOf(p), ...(t.variant === undefined ? {} : { variant: t.variant }) });
  }
  // What's round the places (see places.ts).
  for (const t of places.things) {
    const l = LOOSE[t.kind as PropKind];
    if (!l) continue;
    const p = { kind: t.kind as PropKind, x: t.x, y: t.y };
    loose.push({ ...p, r: l.r, length: l.length, invMass: l.invMass, vx: 0, vy: 0, angle: t.angle, spin: 0, moved: false, level: 0, home: homeOf(p), ...(t.variant === undefined ? {} : { variant: t.variant }) });
  }
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
  return { map, walls, posts, loose, fixed, chunks: yield* indexChunks(map), decks };
}

/** Which chunks each thing reaches into (with its shadow, for buildings). */
export function* indexChunks(map: GameMap): Work<Map<string, ChunkIndex>> {
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
  yield;
  map.roads.forEach((r, i) => {
    // Wide enough for the pavements either side.
    const pad = r.width / 2 + 24;
    const [x0, y0, x1, y1] = bounds(r.pts);
    add('roads', i, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
  });
  yield;
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
