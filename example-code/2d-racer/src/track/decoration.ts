/**
 * The scenery around a track, planned from the track's shape so every track
 * (hand made, generated or saved) gets it. Locations are natural places: in
 * the woods, dense forest, streams and rivers crossing the road, mud and
 * puddles, log piles, and clearings with cabins, campers and deer; at the
 * docks, a working port of concrete yards and quays, with ships, cranes,
 * boats, roads, a railway, warehouses and tank farms (see port.ts). A race
 * circuit adds its own things: see circuit/.
 *
 * Pure geometry: says what goes where, not how it looks. Water, mud, puddles
 * and gravel change how a car drives. Log piles sit in the run-off and are solid;
 * everything else stays out beyond the barriers, where no car can reach it.
 * Nothing fixed ever goes on the road.
 */

import type { SurfaceKind } from '../car/CarPhysics';
import { type CircuitPlan, onGravel, planCircuit } from '../circuit/plan';
import { CIRCUIT_PROP_SIZE, type CircuitPropKind, type CircuitStyle } from '../circuit/style';
import { type DecorationStyle, LOCATIONS, type Location, locationSurface } from '../locations/locations';
import { RUN_OFF, TYRE_RADIUS } from './barriers';
import { mulberry32 } from './generate';
import { type Track, type TrackDifficulty, type TrackPosition, type Vec2, locateOnTrack, poseAt, surfaceOf, turnRadii } from './Track';
import { type Port, PORT_CELL, type Route, isLand, planPort } from './port';
import { type Downtown, planDowntown } from '../downtown/plan';
import { CITY_PROP_SIZE, type CityPropKind } from '../downtown/style';
import { planWinter } from '../winter/plan';
import { WINTER_PROP_SIZE, type WinterPropKind } from '../winter/style';
import { planDesert, planScrub } from '../desert/plan';
import { DESERT_PROP_SIZE, type DesertPropKind } from '../desert/style';
import { type Water, crossingSurface, inWater, planWater } from './water';

export type PropKind =
  | CircuitPropKind
  | CityPropKind
  | WinterPropKind
  | DesertPropKind
  | 'truck'
  | 'container'
  | 'shed'
  | 'tree'
  | 'canopy'
  | 'logs'
  | 'cabin'
  | 'logstack'
  | 'tent'
  | 'campfire'
  | 'camper'
  | 'deer'
  | 'road'
  | 'rail'
  | 'ship'
  | 'boat'
  | 'crane'
  | 'tank'
  | 'gulls'
  | 'lamp'
  | 'pontoon'
  | 'pallets'
  | 'workers'
  | 'path'
  | 'crates'
  | 'reels'
  | 'drums'
  | 'portacabin'
  | 'coils'
  | 'van'
  | 'worksite'
  | 'trail'
  | 'fellers';

/** Footprint of each kind of prop, px: w along its length, h front to back. Sheds and trees vary. */
export const PROP_SIZE: Record<PropKind, { w: number; h: number }> = {
  ...CIRCUIT_PROP_SIZE,
  ...CITY_PROP_SIZE,
  ...WINTER_PROP_SIZE,
  ...DESERT_PROP_SIZE,
  truck: { w: 88, h: 26 },
  container: { w: 60, h: 24 },
  shed: { w: 160, h: 100 },
  tree: { w: 48, h: 48 },
  canopy: { w: 120, h: 120 },
  logs: { w: 76, h: 26 },
  cabin: { w: 96, h: 72 },
  logstack: { w: 130, h: 46 },
  tent: { w: 44, h: 44 },
  campfire: { w: 30, h: 30 },
  camper: { w: 78, h: 34 },
  deer: { w: 130, h: 100 },
  road: { w: 0, h: 40 },
  rail: { w: 0, h: 32 },
  ship: { w: 360, h: 72 },
  boat: { w: 60, h: 24 },
  crane: { w: 56, h: 60 },
  tank: { w: 90, h: 90 },
  gulls: { w: 70, h: 40 },
  lamp: { w: 12, h: 12 },
  pontoon: { w: 26, h: 120 },
  pallets: { w: 30, h: 30 },
  workers: { w: 36, h: 36 },
  path: { w: 0, h: 16 },
  crates: { w: 36, h: 36 },
  reels: { w: 30, h: 30 },
  drums: { w: 40, h: 40 },
  portacabin: { w: 72, h: 30 },
  coils: { w: 56, h: 24 },
  van: { w: 50, h: 22 },
  worksite: { w: 320, h: 210 },
  trail: { w: 0, h: 34 },
  fellers: { w: 130, h: 90 },
};

/**
 * Where things stand in a forestry worksite, in its own coordinates (u along
 * the road, v back from it, from its middle): the timber lorry's parking
 * place in line with the logging track out the back, the loader that fills
 * it, the timber pile, the harvester at the treeline, and the crew's pickup.
 */
export const WORKSITE = {
  trailU: 80,
  lorry: { u: 80, v: 42 },
  loader: { u: 22, v: 30 },
  pile: { u: -38, v: 32 },
  harvester: { u: -122, v: 58 },
  pickup: { u: 40, v: -74 },
};

/** Things lying about the docks, and how many looks each has. */
const DOCK_CLUTTER: { kind: PropKind; variants: number; weight: number }[] = [
  { kind: 'crates', variants: 2, weight: 3 },
  { kind: 'reels', variants: 2, weight: 2 },
  { kind: 'drums', variants: 1, weight: 2 },
  { kind: 'portacabin', variants: 2, weight: 1.2 },
  { kind: 'coils', variants: 1, weight: 1.5 },
  { kind: 'van', variants: 3, weight: 1.2 },
];

/** Boats moored at the quays, by variant: tug, fishing boat, yacht, launch. */
export const BOAT_SIZES = [
  { w: 60, h: 24 },
  { w: 74, h: 26 },
  { w: 56, h: 20 },
  { w: 46, h: 18 },
];

/** Port kinds that stand out on the yards, clear of the strip beside the barriers. */
const CONCRETE: ReadonlySet<PropKind> = new Set(['container', 'shed', 'tank', 'road', 'rail', 'crane', 'pallets', 'path']);
/** Kinds that float. */
export const AFLOAT: ReadonlySet<PropKind> = new Set(['ship', 'boat', 'pontoon']);

/** Kinds that are overhead (tree tops): they may hang over the run-off and each other. */
export const OVERHEAD: ReadonlySet<PropKind> = new Set(['canopy', 'tree']);

/** A rectangle of decoration, centred on (x, y). */
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /**
   * Rotation in radians. Props are drawn with their front along the top edge
   * (local -y); things that face the track are turned so the front faces it.
   */
  angle: number;
  w: number;
  h: number;
  /** Picks between looks of the same kind (colours and so on). */
  variant: number;
}

/** A patch of mud or a puddle on the road: an ellipse laid along the track. */
export interface Patch {
  kind: 'mud' | 'puddle';
  /** Distance along the track of its middle, px. */
  along: number;
  /** Sideways position of its middle from the centre line (+ = right), px. */
  offset: number;
  /** Size along the track and across it, px. */
  length: number;
  width: number;
}

/**
 * A container yard with a gantry crane straddling its stacks: the crane runs
 * `length` px back and forth along `angle`, spanning `span` px across.
 */
export interface Yard {
  x: number;
  y: number;
  angle: number;
  length: number;
  span: number;
}

/** Something going back and forth on a clear path: a forklift or a docker at the docks, or a fan at a circuit. */
export interface Mover {
  kind: 'forklift' | 'docker' | 'fan';
  from: Vec2;
  to: Vec2;
}

/** Something solid that isn't a barrier: bridge railings, log piles, a circuit's gantry posts. */
export interface Solid {
  x: number;
  y: number;
  r: number;
}

/** A forestry worksite: a clearing, and the logging track off its back, `trail` px long. */
export interface Worksite {
  site: Prop;
  trail: number;
}

export interface Decoration {
  props: Prop[];
  /** A race circuit's gravel traps and start gantry, if the location is one. */
  circuit: CircuitPlan | null;
  water: Water[];
  patches: Patch[];
  solids: Solid[];
  /** The docks around the track, if the location has them. */
  port: Port | null;
  yards: Yard[];
  movers: Mover[];
  worksites: Worksite[];
  /** The city round the track, if the location is downtown. */
  downtown: Downtown | null;
}

/** More mud and puddles on harder tracks. */
const PATCH_SCALE: Record<TrackDifficulty, number> = { easy: 0.5, medium: 1, hard: 1.6 };
/** Stretch of track kept clear for the grid behind the line and just after it, px. */
const START_ZONE = { behind: 1500, ahead: 500 };
const BRIDGE_RAIL_RADIUS = 5;

/**
 * Plans the decoration for a track. Deterministic: the same track always gets
 * the same decoration. `barriers` are the barrier tyres; `margin` is how far
 * the world extends beyond the track's bounds.
 */
export function planDecoration(
  track: Track,
  barriers: Vec2[],
  style: DecorationStyle = LOCATIONS.docklands.decoration,
  margin = 600,
  difficulty: TrackDifficulty = 'medium',
  circuit: CircuitStyle | null = null,
): Decoration {
  return new Planner(track, barriers, style, margin, difficulty, circuit).plan();
}

/**
 * What the race circuit planner (circuit/plan.ts) gets to place things with:
 * the track and the scenery planner's helpers.
 */
export interface Placer {
  readonly track: Track;
  readonly rng: () => number;
  /** Number of track samples. */
  readonly n: number;
  /** Turning radius at each sample. */
  readonly radii: number[];
  /** +1 where the track turns right, -1 where it turns left. */
  readonly turn: number[];
  readonly runOff: number;
  /** How far past the edge of the road the barrier zone reaches, px. */
  readonly beyond: number;
  /** The world's edges. */
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly solids: Solid[];
  readonly movers: Mover[];
  facing(kind: PropKind, i: number, side: 1 | -1, w: number, h: number, gap: number, variant: number, pushBack?: number[]): Prop | null;
  add(prop: Prop, roadGap: number, propGap: number): boolean;
  /** Whether a prop would fit there (without adding it). */
  fits(prop: Prop, roadGap: number, propGap: number): boolean;
  prop(kind: PropKind, x: number, y: number, angle: number, w: number, h: number, variant: number): Prop;
  apexes(maxRadius: number, apart: number): number[];
  nearBarrier(x: number, y: number, within: number): boolean;
  sides(): [1 | -1, 1 | -1];
  int(below: number): number;
}

/**
 * What decoration makes the ground at a located point, if anything: water or
 * a bridge where a stream or river crosses, mud, a puddle, or gravel. Null
 * means the plain surface (road, kerb or off the road).
 */
export function decorationSurface(track: Track, deco: Decoration, pos: TrackPosition, x: number, y: number): SurfaceKind | null {
  if (deco.water.length > 0) {
    const crossing = crossingSurface(track, deco.water, pos);
    if (crossing) return crossing;
  }
  if (deco.patches.length > 0) {
    const nrm = track.normals[Math.floor(pos.along / track.spacing) % track.points.length];
    const lateral = (x - pos.x) * nrm.x + (y - pos.y) * nrm.y;
    for (const patch of patchesNear(track, deco, pos.along)) {
      let d = Math.abs(pos.along - patch.along) % track.length;
      d = Math.min(d, track.length - d);
      const u = d / (patch.length / 2);
      const v = (lateral - patch.offset) / (patch.width / 2);
      if (u * u + v * v <= 1) return patch.kind === 'mud' ? 'mud' : 'water';
    }
  }
  if (deco.circuit && onGravel(track, deco.circuit.gravel, pos, x, y)) return 'gravel';
  return null;
}

/** What a car at a located point is driving on, all things considered: the decoration, the road, and the location. */
export function drivingSurface(track: Track, deco: Decoration, location: Location, pos: TrackPosition, x: number, y: number): SurfaceKind {
  return locationSurface(location, decorationSurface(track, deco, pos, x, y) ?? surfaceOf(track, pos));
}

const PATCH_BUCKET = 512;
const patchBuckets = new WeakMap<Decoration, Patch[][]>();

/** Patches that could cover a point this far along the track (bucketed once per decoration). */
function patchesNear(track: Track, deco: Decoration, along: number): Patch[] {
  let buckets = patchBuckets.get(deco);
  if (!buckets) {
    const count = Math.ceil(track.length / PATCH_BUCKET);
    const filled: Patch[][] = Array.from({ length: count }, () => []);
    for (const patch of deco.patches) {
      const from = Math.floor((patch.along - patch.length / 2) / PATCH_BUCKET);
      const to = Math.floor((patch.along + patch.length / 2) / PATCH_BUCKET);
      for (let b = from; b <= to; b++) filled[((b % count) + count) % count].push(patch);
    }
    buckets = filled;
    patchBuckets.set(deco, buckets);
  }
  return buckets[Math.floor(along / PATCH_BUCKET) % buckets.length];
}

/** Corners of a prop's rectangle. */
export function propCorners(p: Prop): Vec2[] {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({ x: p.x + (c * u * p.w - s * v * p.h) / 2, y: p.y + (s * u * p.w + c * v * p.h) / 2 }));
}

/** Points spread over a prop's rectangle (edges included), no more than `step` px apart. */
export function propSamples(p: Prop, step = 20): Vec2[] {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const nu = Math.max(1, Math.ceil(p.w / step));
  const nv = Math.max(1, Math.ceil(p.h / step));
  const out: Vec2[] = [];
  for (let a = 0; a <= nu; a++) {
    for (let b = 0; b <= nv; b++) {
      const u = (a / nu - 0.5) * p.w;
      const v = (b / nv - 0.5) * p.h;
      out.push({ x: p.x + c * u - s * v, y: p.y + s * u + c * v });
    }
  }
  return out;
}

/** Whether two props' rectangles come within `pad` px of each other (separating axis test). */
export function propsOverlap(a: Prop, b: Prop, pad = 0): boolean {
  if (Math.hypot(a.x - b.x, a.y - b.y) > (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 2 + pad) return false;
  for (const axis of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const c = Math.cos(axis);
    const s = Math.sin(axis);
    const d = Math.abs((b.x - a.x) * c + (b.y - a.y) * s);
    if (d > halfExtent(a, c, s) + halfExtent(b, c, s) + pad) return false;
  }
  return true;
}

function halfExtent(p: Prop, c: number, s: number): number {
  const ux = Math.cos(p.angle);
  const uy = Math.sin(p.angle);
  return (Math.abs(ux * c + uy * s) * p.w + Math.abs(-uy * c + ux * s) * p.h) / 2;
}

/** Distance from a point to a prop's rectangle (0 inside it). */
function distanceToProp(p: Prop, x: number, y: number): number {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const u = Math.abs((x - p.x) * c + (y - p.y) * s) - p.w / 2;
  const v = Math.abs(-(x - p.x) * s + (y - p.y) * c) - p.h / 2;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

/** Gap (px) between the props and things around them. */
const GAP = {
  /** Behind the barrier, for things that line it (lamps, gulls). */
  barrier: 6,
  /** Between neighbouring props. */
  props: 8,
  /** Extra space between scenery and the barrier line. */
  scenery: 50,
};

const MAX_SCENERY = 320;
const BARRIER_CELL = 64;
const PROP_CELL = 256;

class Planner implements Placer {
  readonly rng: () => number;
  readonly n: number;
  readonly radii: number[];
  /** +1 where the track turns right (inside on the right), -1 where it turns left. */
  readonly turn: number[];
  private readonly props: Prop[] = [];
  /** The props by area, so checking a new one only looks at its neighbours. */
  private readonly propCells = new Map<number, Prop[]>();
  private readonly barrierCells = new Map<number, Vec2[]>();
  private water: Water[] = [];
  private port: Port | null = null;
  private readonly patches: Patch[] = [];
  readonly solids: Solid[] = [];
  private readonly yards: Yard[] = [];
  readonly movers: Mover[] = [];
  private readonly worksites: Worksite[] = [];
  readonly runOff: number;
  /** Distance from the road edge (outside of the kerb) to the back of the barrier, where it isn't squeezed. */
  readonly beyond: number;
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(
    readonly track: Track,
    barriers: Vec2[],
    private readonly style: DecorationStyle,
    private readonly margin: number,
    private readonly difficulty: TrackDifficulty,
    private readonly circuit: CircuitStyle | null,
  ) {
    this.rng = mulberry32(trackSeed(track));
    this.n = track.points.length;
    this.radii = turnRadii(track, 4);
    this.turn = turnDirections(track, 4);
    this.runOff = track.runOff ?? RUN_OFF;
    this.beyond = this.runOff + TYRE_RADIUS * 2;
    const b = track.bounds;
    const inset = 10;
    this.bounds = {
      minX: b.minX - margin + inset,
      minY: b.minY - margin + inset,
      maxX: b.maxX + margin - inset,
      maxY: b.maxY + margin - inset,
    };
    for (const t of barriers) {
      const key = cell(t.x, t.y);
      const list = this.barrierCells.get(key);
      if (list) list.push(t);
      else this.barrierCells.set(key, [t]);
    }
  }

  plan(): Decoration {
    const { style } = this;
    if (style.port) this.docks();
    if (style.water) this.waterCourses(style.water);
    if (style.roadPatches) this.roadPatches(style.roadPatches);
    const circuit = this.circuit ? planCircuit(this, this.circuit) : null;
    const downtown = style.city ? planDowntown(this, this.margin) : null;
    if (style.logPilesPer10k > 0) this.logPiles();
    if (style.forestryPer10k > 0) this.forestry();
    if (style.winter) planWinter(this);
    if (style.desert) planDesert(this);
    if (style.clearingsPer10k > 0) this.clearings();
    if (style.forestRows > 0) this.forest(style.forestRows);
    if (style.desert) planScrub(this);
    if (style.lamps) this.lamps();
    if (this.port) {
      this.ships();
      this.pontoons();
      this.moorings();
      this.perchedGulls();
    }
    this.scenery();
    if (this.port) {
      this.dockers();
      this.workGangs();
      this.containerWalls();
      this.dockClutter();
    }
    return {
      props: this.props,
      circuit,
      water: this.water,
      patches: this.patches,
      solids: this.solids,
      port: this.port,
      yards: this.yards,
      movers: this.movers,
      worksites: this.worksites,
      downtown,
    };
  }

  /** How many of something to place, from a rate per 10,000 px of track. */
  private per10k(rate: number): number {
    return Math.round((rate * this.track.length) / 10_000);
  }

  /** Whether a distance along the track is in the stretch kept clear around the start. */
  private nearStart(along: number, extra = 0): boolean {
    return along < START_ZONE.ahead + extra || along > this.track.length - START_ZONE.behind - extra;
  }

  // --- A race circuit ---------------------------------------------------------

  // --- The docks ------------------------------------------------------------

  /** Lays out the port, and its railway and roads across the yards. */
  private docks(): void {
    const port = planPort(this.track, this.rng, {
      barrierZone: this.beyond,
      bounds: this.bounds,
      tugs: Math.min(4, 1 + this.per10k(0.6)),
    });
    this.port = port;
    const maxRoads = Math.min(9, 2 + this.per10k(1.8));
    let roads = 0;
    let rail = false;
    for (const lane of port.lanes) {
      const length = Math.hypot(lane.to.x - lane.from.x, lane.to.y - lane.from.y);
      const kind = !rail && length >= 1000 ? 'rail' : 'road';
      if (kind === 'road' && roads >= maxRoads) continue;
      const prop = this.prop(
        kind,
        (lane.from.x + lane.to.x) / 2,
        (lane.from.y + lane.to.y) / 2,
        Math.atan2(lane.to.y - lane.from.y, lane.to.x - lane.from.x),
        length,
        PROP_SIZE[kind].h,
        0,
      );
      // Kept well apart, so they don't cross or run side by side.
      if (!this.add(prop, this.beyond + 1, PORT_CELL)) continue;
      if (kind === 'rail') rail = true;
      else roads++;
    }
  }

  /** Cargo ships moored at the longest quays, with cranes on the quay working them. */
  private ships(): void {
    const port = this.port!;
    const { w, h } = PROP_SIZE.ship;
    let ships = 0;
    const max = Math.min(3, 1 + this.per10k(0.4));
    for (const q of port.quays) {
      if (ships >= max) break;
      const length = Math.hypot(q.to.x - q.from.x, q.to.y - q.from.y);
      if (length < w + 80) continue;
      const dir = { x: (q.to.x - q.from.x) / length, y: (q.to.y - q.from.y) / length };
      const mid = { x: (q.from.x + q.to.x) / 2, y: (q.from.y + q.to.y) / 2 };
      const flip = this.rng() < 0.5 ? 0 : Math.PI;
      const ship = this.prop('ship', mid.x + q.water.x * (8 + h / 2), mid.y + q.water.y * (8 + h / 2), Math.atan2(dir.y, dir.x) + flip, w, h, this.int(3));
      if (!this.afloat(ship, 10)) continue;
      this.place(ship);
      ships++;
      // Local +y of a crane points inland, so its boom reaches out over the water.
      const angle = Math.atan2(q.water.x, -q.water.y);
      const { w: cw, h: ch } = PROP_SIZE.crane;
      for (const u of [-95, 95]) {
        const at = { x: mid.x + dir.x * u - q.water.x * (ch / 2 + 6), y: mid.y + dir.y * u - q.water.y * (ch / 2 + 6) };
        this.add(this.prop('crane', at.x, at.y, angle, cw, ch, this.int(2)), this.beyond + 1, 8);
      }
    }
  }

  /** Smaller boats tied up along the quays. */
  private moorings(): void {
    const port = this.port!;
    let left = this.per10k(3);
    for (const q of port.quays) {
      const length = Math.hypot(q.to.x - q.from.x, q.to.y - q.from.y);
      const dir = { x: (q.to.x - q.from.x) / length, y: (q.to.y - q.from.y) / length };
      for (let t = 50; t < length - 50 && left > 0; t += 130) {
        if (this.rng() > 0.35) continue;
        const variant = this.int(BOAT_SIZES.length);
        const { w, h } = BOAT_SIZES[variant];
        const x = q.from.x + dir.x * t + q.water.x * (6 + h / 2);
        const y = q.from.y + dir.y * t + q.water.y * (6 + h / 2);
        const boat = this.prop('boat', x, y, Math.atan2(dir.y, dir.x) + (this.rng() < 0.5 ? 0 : Math.PI), w, h, variant);
        if (!this.afloat(boat, 10)) continue;
        this.place(boat);
        left--;
      }
    }
  }

  /** Whether something afloat fits: on open water, clear of other props and the tugboats' runs. */
  private afloat(prop: Prop, pad: number): boolean {
    const port = this.port!;
    const { minX, minY, maxX, maxY } = this.bounds;
    for (const c of propCorners(prop)) if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) return false;
    if (propSamples(prop, 12).some((q) => isLand(port, q.x, q.y))) return false;
    if (this.propsNear(prop, pad).length > 0) return false;
    const reach = Math.max(prop.w, prop.h) / 2 + 40;
    return port.tugRoutes.every((r) => distanceToRoute(r, prop.x, prop.y) > reach);
  }

  /** Wooden pontoons reaching out from the quays, with small boats tied up alongside. */
  private pontoons(): void {
    const port = this.port!;
    const { w, h } = PROP_SIZE.pontoon;
    let left = this.per10k(1.2);
    for (const q of port.quays) {
      if (left <= 0) break;
      const length = Math.hypot(q.to.x - q.from.x, q.to.y - q.from.y);
      if (length < 256 || this.rng() < 0.5) continue;
      const t = 60 + this.rng() * (length - 120);
      const dir = { x: (q.to.x - q.from.x) / length, y: (q.to.y - q.from.y) / length };
      const base = { x: q.from.x + dir.x * t, y: q.from.y + dir.y * t };
      // Local +y runs out from the quay into the water.
      const angle = Math.atan2(-q.water.x, q.water.y);
      const pontoon = this.prop('pontoon', base.x + q.water.x * (h / 2 + 1), base.y + q.water.y * (h / 2 + 1), angle, w, h, 0);
      if (!this.afloat(pontoon, 10)) continue;
      this.place(pontoon);
      left--;
      for (const side of [1, -1]) {
        if (this.rng() < 0.3) continue;
        const variant = 1 + this.int(BOAT_SIZES.length - 1);
        const size = BOAT_SIZES[variant];
        const along = (this.rng() - 0.5) * (h - size.w - 10);
        const out = w / 2 + 4 + size.h / 2;
        const boat = this.prop(
          'boat',
          pontoon.x + dir.x * out * side + q.water.x * along,
          pontoon.y + dir.y * out * side + q.water.y * along,
          Math.atan2(q.water.y, q.water.x) + (this.rng() < 0.5 ? 0 : Math.PI),
          size.w,
          size.h,
          variant,
        );
        if (this.afloat(boat, 2)) this.place(boat);
      }
    }
  }

  /** Street lamps along the road, behind the barriers, on alternate sides. */
  private lamps(): void {
    const { w, h } = PROP_SIZE.lamp;
    const step = Math.round(300 / this.track.spacing);
    let side: 1 | -1 = 1;
    for (let i = this.int(step); i < this.n; i += step) {
      side = side === 1 ? -1 : 1;
      this.facing('lamp', i, side, w, h, 4, 0, [0, 12]);
    }
  }

  /** Gulls sat on the grass by the track, ready to scatter as cars go by. */
  private perchedGulls(): void {
    const { w, h } = PROP_SIZE.gulls;
    const count = this.per10k(2.5);
    let placed = 0;
    for (let attempt = 0; attempt < count * 6 && placed < count; attempt++) {
      if (this.facing('gulls', this.int(this.n), this.sides()[0], w, h, 8 + this.int(30), 0)) placed++;
    }
  }

  private tankFarm(x: number, y: number, angle: number): void {
    const d = 70 + this.int(40);
    const cols = 1 + this.int(3);
    const rows = 1 + this.int(2);
    const gap = 16;
    const farm = this.prop('tank', x, y, angle, cols * (d + gap), rows * (d + gap), 0);
    if (!this.fits(farm, this.beyond + GAP.scenery, GAP.props * 2)) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let a = 0; a < cols; a++) {
      for (let b = 0; b < rows; b++) {
        const u = (a - (cols - 1) / 2) * (d + gap);
        const v = (b - (rows - 1) / 2) * (d + gap);
        this.place(this.prop('tank', x + c * u - s * v, y + s * u + c * v, angle, d, d, this.int(2)));
      }
    }
  }

  // --- The woods ------------------------------------------------------------

  /** Streams and rivers across the road, with railings along each bridge. */
  private waterCourses(rates: NonNullable<DecorationStyle['water']>): void {
    const { track } = this;
    this.water = planWater(track, this.rng, {
      streams: this.per10k(rates.streamsPer10k),
      rivers: this.per10k(rates.riversPer10k),
      runOff: this.runOff,
      bounds: this.bounds,
      avoid: [
        [0, START_ZONE.ahead],
        [track.length - START_ZONE.behind, track.length],
        ...track.obstacles.map((o): [number, number] => [o.along - 300, o.along + 300]),
      ],
    });
    for (const w of this.water) {
      if (!w.crossing.bridge) continue;
      const half = w.width / 2 + 14;
      for (let d = -half; d <= half; d += BRIDGE_RAIL_RADIUS * 1.6) {
        const pose = poseAt(track, (w.crossing.along + d + track.length) % track.length);
        const i = Math.round(w.crossing.along / track.spacing) % this.n;
        const out = track.halfWidths[i] + track.kerbWidth + 3 + BRIDGE_RAIL_RADIUS;
        for (const side of [1, -1]) {
          this.solids.push({
            x: pose.x - Math.sin(pose.heading) * out * side,
            y: pose.y + Math.cos(pose.heading) * out * side,
            r: BRIDGE_RAIL_RADIUS,
          });
        }
      }
    }
  }

  /** Mud and puddles on the road, more on harder tracks. Away from the start, the water and obstacles. */
  private roadPatches(rates: NonNullable<DecorationStyle['roadPatches']>): void {
    const { track } = this;
    const scale = PATCH_SCALE[this.difficulty];
    const kinds: Patch['kind'][] = [
      ...new Array<Patch['kind']>(this.per10k(rates.mudPer10k * scale)).fill('mud'),
      ...new Array<Patch['kind']>(this.per10k(rates.puddlesPer10k * scale)).fill('puddle'),
    ];
    const gap = (a: number, b: number) => {
      const d = Math.abs(a - b) % track.length;
      return Math.min(d, track.length - d);
    };
    for (const kind of kinds) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const along = this.rng() * track.length;
        const mud = kind === 'mud';
        const length = mud ? 140 + this.rng() * 200 : 60 + this.rng() * 110;
        if (this.nearStart(along, length)) continue;
        if (this.water.some((w) => gap(along, w.crossing.along) < w.width / 2 + length / 2 + 150)) continue;
        if (track.obstacles.some((o) => gap(along, o.along) < length / 2 + 250)) continue;
        if (this.patches.some((p) => gap(along, p.along) < (length + p.length) / 2 + 120)) continue;
        const half = track.halfWidths[Math.floor(along / track.spacing) % this.n];
        const width = mud ? Math.min(half * 2, 70 + this.rng() * 110) : 40 + this.rng() * 70;
        const room = Math.max(0, half - width * 0.3);
        this.patches.push({ kind, along, offset: (this.rng() * 2 - 1) * room, length, width });
        break;
      }
    }
  }

  /** Piles of felled logs in the run-off, lying along the road. Solid. */
  private logPiles(): void {
    const { track } = this;
    const { w, h } = PROP_SIZE.logs;
    const kerbGap = 28;
    // Only where there's room to drive round them both sides.
    if (this.runOff < kerbGap + h + 20) return;
    const count = this.per10k(this.style.logPilesPer10k);
    let placed = 0;
    for (let attempt = 0; attempt < count * 8 && placed < count; attempt++) {
      const i = this.int(this.n);
      if (this.nearStart(i * track.spacing, 200)) continue;
      const side = this.sides()[0];
      const nrm = track.normals[i];
      const halfOuter = track.halfWidths[i] + track.kerbWidth;
      const out = halfOuter + kerbGap + h / 2 + this.rng() * (this.runOff - kerbGap - h - 14);
      const p = track.points[i];
      const pile = this.prop('logs', p.x + nrm.x * side * out, p.y + nrm.y * side * out, Math.atan2(-nrm.x * side, nrm.y * side), w, h, this.int(3));
      // Clear of the road, the barrier, water, other solids and props.
      if (propSamples(pile).some((q) => {
        const pos = locateOnTrack(track, q.x, q.y);
        return pos.distance - pos.halfWidth - track.kerbWidth < kerbGap - 4 || (this.water.length > 0 && inWater(this.water, q.x, q.y, 12));
      })) continue;
      if (this.barriersNear(pile.x, pile.y, w).some((t) => distanceToProp(pile, t.x, t.y) < TYRE_RADIUS + 6)) continue;
      if (this.solids.some((o) => distanceToProp(pile, o.x, o.y) < o.r + 30)) continue;
      if (this.propsNear(pile, 8).length > 0) continue;
      this.place(pile);
      const c = Math.cos(pile.angle);
      const s = Math.sin(pile.angle);
      for (const u of [-(w - h) / 2, 0, (w - h) / 2]) this.solids.push({ x: pile.x + c * u, y: pile.y + s * u, r: h / 2 });
      placed++;
    }
  }

  /**
   * Forestry worksites cut into the trees beside the track, each with a
   * logging track running off the back of it into the forest.
   */
  private forestry(): void {
    const { track } = this;
    const { w, h } = PROP_SIZE.worksite;
    const count = Math.max(1, this.per10k(this.style.forestryPer10k));
    let placed = 0;
    for (let attempt = 0; attempt < count * 10 && placed < count; attempt++) {
      const i = this.int(this.n);
      if (this.nearStart(i * track.spacing, 300)) continue;
      const side = this.sides()[0];
      const p = track.points[i];
      const nrm = track.normals[i];
      const angle = Math.atan2(-nrm.x * side, nrm.y * side);
      const out = track.halfWidths[i] + track.kerbWidth + this.beyond + 16 + h / 2;
      const site = this.prop('worksite', p.x + nrm.x * side * out, p.y + nrm.y * side * out, angle, w, h, 0);
      if (!this.fits(site, this.beyond + 1, GAP.props)) continue;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const u = WORKSITE.trailU;
      for (const length of [720, 520, 360, 240]) {
        const v = h / 2 + 4 + length / 2;
        const trail = this.prop('trail', site.x + c * u - s * v, site.y + s * u + c * v, angle + Math.PI / 2, length, PROP_SIZE.trail.h, 0);
        if (!this.fits(trail, this.beyond + GAP.scenery, 2)) continue;
        this.place(site);
        this.place(trail);
        this.worksites.push({ site, trail: length });
        placed++;
        break;
      }
    }
  }

  /**
   * Gaps in the trees beside the track with something to see: cabins, campers,
   * timber stacks, deer. (In the desert, with no trees: camps, wild horses and
   * old wrecks.)
   */
  private clearings(): void {
    const { n } = this;
    const count = this.per10k(this.style.clearingsPer10k);
    const woods = [
      'cabin',
      // In winter, snowmen built in a clearing rather than tents pitched in one.
      this.style.winter ? 'snowmen' : 'camp',
      'deer',
      'logstack',
      'deer',
      ...(this.style.forestryPer10k > 0 ? (['fellers', 'fellers'] as const) : []),
    ] as const;
    const kinds = this.style.desert ? (['campsite', 'deer', 'campsite', 'wreck', 'deer'] as const) : woods;
    let placed = 0;
    for (let attempt = 0; attempt < count * 6 && placed < count; attempt++) {
      const i = this.int(n);
      const side = this.sides()[0];
      const at = (k: number) => (i + k + n) % n;
      const kind = kinds[this.int(kinds.length)];
      let main: Prop | null = null;
      if (kind === 'cabin') {
        main = this.facing('cabin', i, side, 96, 72, 24, this.int(2), [0, 30, 60]);
        if (main) this.facing('logstack', at(4), side, 130, 46, 20, this.int(2), [0, 30]);
      } else if (kind === 'camp') {
        main = this.facing('tent', i, side, 44, 44, 36, this.int(3), [0, 30]);
        if (main) {
          this.facing('campfire', at(2), side, 30, 30, 40, 0, [0, 20]);
          this.facing('camper', at(-3), side, 78, 34, 22, this.int(3), [0, 30]);
        }
      } else if (kind === 'fellers') {
        const { w, h } = PROP_SIZE.fellers;
        main = this.facing('fellers', i, side, w, h, 10, this.int(2), [0, 30, 60]);
      } else if (kind === 'snowmen') {
        const { w, h } = PROP_SIZE.snowmen;
        main = this.facing('snowmen', i, side, w, h, 16, this.int(1000), [0, 30]);
      } else if (kind === 'campsite' || kind === 'wreck') {
        const { w, h } = PROP_SIZE[kind];
        main = this.facing(kind, i, side, w, h, 20, this.int(1000), [0, 30, 60]);
      } else if (kind === 'deer') {
        main = this.facing('deer', i, side, 130, 100, 6, this.int(2), [0, 30]);
      } else {
        main = this.facing('logstack', i, side, 130, 46, 12, this.int(2), [0, 30]);
      }
      if (main) placed++;
    }
  }

  /**
   * Dense tree tops in rows along both sides, the first hanging over the
   * barrier. They leave gaps around everything else beside the track (so
   * clearings show), and over water.
   */
  private forest(rows: number): void {
    const { track, n } = this;
    const { minX, minY, maxX, maxY } = this.bounds;
    const overhang = Math.max(30, this.runOff * 0.4);
    for (const side of [1, -1]) {
      for (let row = 0; row < rows; row++) {
        for (let along = this.rng() * 60; along < track.length; ) {
          const d = 100 + row * 16 + this.rng() * 34;
          const i = Math.floor(along / track.spacing) % n;
          along += d * 0.6 + this.rng() * d * 0.25;
          const p = track.points[i];
          const nrm = track.normals[i];
          const out = track.halfWidths[i] + track.kerbWidth + this.runOff + TYRE_RADIUS + 18 + row * 78 + (this.rng() - 0.5) * 26;
          const slide = (this.rng() - 0.5) * 20;
          const x = p.x + nrm.x * side * out + nrm.y * slide;
          const y = p.y + nrm.y * side * out - nrm.x * slide;
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          const pos = locateOnTrack(track, x, y);
          if (pos.distance - pos.halfWidth - track.kerbWidth - d / 2 < overhang) continue;
          if (this.water.length > 0 && inWater(this.water, x, y, d * 0.3)) continue;
          const canopy = this.prop('canopy', x, y, this.rng() * Math.PI * 2, d, d, this.int(6));
          const solid = { ...canopy, w: d * 0.8, h: d * 0.8 };
          if (this.propsNear(solid, 4).some((other) => !OVERHEAD.has(other.kind))) continue;
          this.place(canopy);
        }
      }
    }
  }

  // --- Scenery further out -------------------------------------------------

  private scenery(): void {
    const kinds = this.style.scenery;
    if (kinds.length === 0) return;
    const { minX, minY, maxX, maxY } = this.bounds;
    const area = (maxX - minX) * (maxY - minY);
    // A port is packed; elsewhere, enough to fill the view without slowing phones down.
    const tries = this.port ? Math.min(2500, Math.round(area / 9000)) : Math.min(600, Math.round(area / 40_000));
    const limit = this.props.length + (this.port ? Math.min(1400, Math.round(area / 16_000)) : Math.min(MAX_SCENERY, Math.round(area / 60_000)));
    const weight = this.port ? { containers: 9, trees: 0, sheds: 2, tanks: 1 } : { containers: 4, trees: 5, sheds: 1.5, tanks: 1 };
    const total = kinds.reduce((sum, k) => sum + weight[k], 0);
    for (let k = 0; k < tries && this.props.length < limit; k++) {
      let pick = this.rng() * total;
      const kind = kinds.find((kd) => (pick -= weight[kd]) < 0) ?? kinds[0];
      let x = minX + this.rng() * (maxX - minX);
      let y = minY + this.rng() * (maxY - minY);
      if (this.port && kind === 'trees') {
        // At the docks, trees only grow on the verge by the track.
        const i = this.int(this.n);
        const side = this.sides()[0];
        const out = this.track.halfWidths[i] + this.track.kerbWidth + this.beyond + GAP.scenery + this.rng() * Math.max(0, this.port.verge[i] - GAP.scenery - 20);
        x = this.track.points[i].x + this.track.normals[i].x * side * out;
        y = this.track.points[i].y + this.track.normals[i].y * side * out;
      }
      const pos = locateOnTrack(this.track, x, y);
      if (pos.distance - pos.halfWidth - this.track.kerbWidth < this.beyond + GAP.scenery) continue;
      // Line things up with the nearest road, as if the land was laid out around it (or, at
      // the docks, with the grid the port is laid out on).
      const turn = this.rng() < 0.5 ? 0 : Math.PI / 2;
      const aligned = this.port ? turn : pos.heading + turn;
      if (kind === 'containers') this.containerYard(x, y, aligned);
      else if (kind === 'trees') this.trees(x, y);
      else if (kind === 'tanks') this.tankFarm(x, y, aligned);
      else this.shed(x, y, aligned);
    }
  }

  private containerYard(x: number, y: number, angle: number): void {
    const { w, h } = PROP_SIZE.container;
    // At the docks, bigger stacks, and the biggest have a gantry crane working them.
    const cols = this.port ? 2 + this.int(5) : 1 + this.int(4);
    const rows = this.port ? 2 + this.int(4) : 1 + this.int(4);
    const gapX = 6;
    const gapY = 3;
    const crane = this.port !== null && cols >= 3 && rows >= 2;
    const legs = crane ? 22 : 0;
    const yard = this.prop('container', x, y, angle, cols * (w + gapX), rows * (h + gapY) + legs * 2, 0);
    if (!this.fits(yard, this.beyond + GAP.scenery, GAP.props)) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (crane) {
      const length = cols * (w + gapX);
      const span = rows * (h + gapY) + legs;
      this.yards.push({ x, y, angle, length, span });
      // Keep the crane's tracks either side clear.
      for (const side of [1, -1]) {
        const v = side * (span / 2 + 3);
        this.place(this.prop('path', x - s * v, y + c * v, angle, length, legs - 8, 0));
      }
    }
    for (let a = 0; a < cols; a++) {
      for (let b = 0; b < rows; b++) {
        if (this.rng() < 0.12) continue; // a gap where one's been moved
        const u = (a - (cols - 1) / 2) * (w + gapX);
        const v = (b - (rows - 1) / 2) * (h + gapY);
        this.place(this.prop('container', x + c * u - s * v, y + s * u + c * v, angle + (this.rng() < 0.5 ? 0 : Math.PI), w, h, this.int(6)));
      }
    }
  }

  private trees(x: number, y: number): void {
    const count = 2 + this.int(6);
    for (let k = 0; k < count; k++) {
      const size = 34 + this.int(26);
      const a = this.rng() * Math.PI * 2;
      const r = k === 0 ? 0 : 20 + this.rng() * 60;
      const tree = this.prop('tree', x + Math.cos(a) * r, y + Math.sin(a) * r, this.rng() * Math.PI * 2, size, size, this.int(3));
      // Trees may overlap each other a little, but nothing else.
      this.add(tree, this.beyond + GAP.scenery, GAP.props, (other) => OVERHEAD.has(other.kind));
    }
  }

  private shed(x: number, y: number, angle: number): void {
    const w = 140 + this.int(140);
    const h = 90 + this.int(60);
    const shed = this.prop('shed', x, y, angle, w, h, this.int(3));
    if (!this.add(shed, this.beyond + GAP.scenery, GAP.props * 2) || !this.port) return;
    // At the docks, each loading door has a lorry backed up to it, or a forklift
    // shuttling pallets out to a stack in the yard.
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const at = (u: number, v: number) => ({ x: x + c * u - s * v, y: y + s * u + c * v });
    const { w: tw, h: th } = PROP_SIZE.truck;
    for (const u of [-w / 4, w / 4]) {
      if (this.rng() < 0.5) {
        const p = at(u, -h / 2 - 4 - tw / 2);
        this.add(this.prop('truck', p.x, p.y, angle - Math.PI / 2, tw, th, this.int(5)), this.beyond + GAP.scenery, 2, (other) => other === shed);
        continue;
      }
      const run = 90 + this.int(50);
      const lane = at(u, -h / 2 - 4 - run / 2);
      const path = this.prop('path', lane.x, lane.y, angle - Math.PI / 2, run, 22, 0);
      const stack = at(u + 34, -h / 2 - 4 - run + 15);
      const pallets = this.prop('pallets', stack.x, stack.y, angle, 30, 30, this.int(2));
      if (!this.fits(path, this.beyond + GAP.scenery, 2, (other) => other === shed)) continue;
      if (!this.fits(pallets, this.beyond + GAP.scenery, 2, (other) => other === shed)) continue;
      this.place(path);
      this.place(pallets);
      this.movers.push({ kind: 'forklift', from: at(u, -h / 2 - 20), to: at(u, -h / 2 - 4 - run + 16) });
    }
  }

  /** Rows of containers stacked along behind the barriers, one or two deep, with gaps. */
  private containerWalls(): void {
    const { track } = this;
    const { w, h } = PROP_SIZE.container;
    for (const side of [1, -1] as const) {
      for (let i = this.int(6); i < this.n; i += 4 + this.int(7)) {
        if (this.rng() < 0.2) continue;
        const count = 2 + this.int(6);
        const rows = 1 + this.int(3);
        const p = track.points[i];
        const nrm = track.normals[i];
        const along = { x: nrm.y, y: -nrm.x };
        const angle = Math.atan2(along.y, along.x);
        for (let r = 0; r < rows; r++) {
          const out = track.halfWidths[i] + track.kerbWidth + this.beyond + this.port!.verge[i] + 12 + h / 2 + r * (h + 3);
          for (let k = 0; k < count; k++) {
            const u = (k - (count - 1) / 2) * (w + 4);
            const x = p.x + nrm.x * side * out + along.x * u;
            const y = p.y + nrm.y * side * out + along.y * u;
            this.add(this.prop('container', x, y, angle + (this.rng() < 0.5 ? 0 : Math.PI), w, h, this.int(6)), this.beyond + 1, 3);
          }
        }
      }
    }
  }

  /** Everything else lying about the yards: crates, cable reels, drums, site offices, steel coils, parked vans. */
  private dockClutter(): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const area = (maxX - minX) * (maxY - minY);
    const tries = Math.min(3000, Math.round(area / 5000));
    const total = DOCK_CLUTTER.reduce((sum, c) => sum + c.weight, 0);
    for (let k = 0; k < tries; k++) {
      let pick = this.rng() * total;
      const item = DOCK_CLUTTER.find((c) => (pick -= c.weight) < 0) ?? DOCK_CLUTTER[0];
      // Half of it near the track, where it's seen most.
      let x = minX + this.rng() * (maxX - minX);
      let y = minY + this.rng() * (maxY - minY);
      let angle = this.int(4) * (Math.PI / 2);
      if (k % 2 === 0) {
        const i = this.int(this.n);
        const side = this.rng() < 0.5 ? 1 : -1;
        const nrm = this.track.normals[i];
        const out = this.track.halfWidths[i] + this.track.kerbWidth + this.beyond + this.port!.verge[i] + 20 + this.rng() * 360;
        x = this.track.points[i].x + nrm.x * side * out;
        y = this.track.points[i].y + nrm.y * side * out;
        angle = Math.atan2(nrm.x, -nrm.y) + this.int(4) * (Math.PI / 2);
      }
      const { w, h } = PROP_SIZE[item.kind];
      if (item.kind !== 'van') {
        this.add(this.prop(item.kind, x, y, angle, w, h, this.int(item.variants)), this.beyond + 8, 6);
        continue;
      }
      // Vans parked in a row, side by side.
      const count = 2 + this.int(5);
      const row = this.prop('van', x, y, angle, h * count + 6 * (count - 1), w, 0);
      if (!this.fits(row, this.beyond + 8, 8)) continue;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let a = 0; a < count; a++) {
        if (this.rng() < 0.2) continue; // an empty space
        const u = (a - (count - 1) / 2) * (h + 6);
        this.place(this.prop('van', x + c * u, y + s * u, angle + Math.PI / 2 + (this.rng() < 0.5 ? 0 : Math.PI), w, h, this.int(item.variants)));
      }
    }
  }

  /** Dockers walking about the yards and quays, each on a clear straight path. */
  private dockers(): void {
    const port = this.port!;
    const { minX, minY, maxX, maxY } = this.bounds;
    const want = this.per10k(5);
    let placed = 0;
    // Some along the quays where ships are being worked, the rest anywhere on the yards.
    const ships = this.props.filter((p) => p.kind === 'ship');
    for (let attempt = 0; attempt < want * 12 && placed < want; attempt++) {
      let x: number;
      let y: number;
      let angle: number;
      if (ships.length > 0 && this.rng() < 0.35) {
        const ship = ships[this.int(ships.length)];
        const along = (this.rng() - 0.5) * ship.w;
        const back = ship.h / 2 + 34 + this.rng() * 50;
        const quayward = isLand(port, ship.x - Math.sin(ship.angle) * back, ship.y + Math.cos(ship.angle) * back) ? 1 : -1;
        x = ship.x + Math.cos(ship.angle) * along - Math.sin(ship.angle) * back * quayward;
        y = ship.y + Math.sin(ship.angle) * along + Math.cos(ship.angle) * back * quayward;
        angle = ship.angle;
      } else {
        x = minX + this.rng() * (maxX - minX);
        y = minY + this.rng() * (maxY - minY);
        angle = this.int(4) * (Math.PI / 2);
      }
      const length = 120 + this.rng() * 260;
      const path = this.prop('path', x, y, angle, length, 14, 0);
      if (!this.add(path, this.beyond + GAP.scenery, 6)) continue;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      this.movers.push({ kind: 'docker', from: { x: x - (c * length) / 2, y: y - (s * length) / 2 }, to: { x: x + (c * length) / 2, y: y + (s * length) / 2 } });
      placed++;
    }
  }

  /** Little groups of dockers stood together: by the ships and the warehouses, or out on the yards. */
  private workGangs(): void {
    const { w, h } = PROP_SIZE.workers;
    const { minX, minY, maxX, maxY } = this.bounds;
    const want = this.per10k(3);
    const near = this.props.filter((p) => p.kind === 'crane' || p.kind === 'shed');
    let placed = 0;
    for (let attempt = 0; attempt < want * 12 && placed < want; attempt++) {
      let x = minX + this.rng() * (maxX - minX);
      let y = minY + this.rng() * (maxY - minY);
      if (near.length > 0 && this.rng() < 0.6) {
        const by = near[this.int(near.length)];
        const a = this.rng() * Math.PI * 2;
        const r = Math.max(by.w, by.h) / 2 + 30 + this.rng() * 40;
        x = by.x + Math.cos(a) * r;
        y = by.y + Math.sin(a) * r;
      }
      if (this.add(this.prop('workers', x, y, 0, w, h, this.int(4)), this.beyond + GAP.scenery, 6)) placed++;
    }
  }

  // --- Helpers --------------------------------------------------------------

  /**
   * Places a prop beside the track at sample i on one side, its front facing
   * the road, `gap` px behind the barrier line (tries pushing it further back
   * by each of `pushBack` if it doesn't fit). Returns it, or null if it can't go there.
   */
  facing(
    kind: PropKind,
    i: number,
    side: 1 | -1,
    w: number,
    h: number,
    gap: number,
    variant: number,
    pushBack = [0],
  ): Prop | null {
    const { track } = this;
    const p = track.points[i];
    const nrm = track.normals[i];
    // Local +y (front to back) points away from the road.
    const angle = Math.atan2(-nrm.x * side, nrm.y * side);
    for (const extra of pushBack) {
      const out = track.halfWidths[i] + track.kerbWidth + this.beyond + gap + extra + h / 2;
      const prop = this.prop(kind, p.x + nrm.x * side * out, p.y + nrm.y * side * out, angle, w, h, variant);
      if (this.add(prop, this.beyond + 1, GAP.props)) return prop;
    }
    return null;
  }

  /** Adds the prop if it fits. */
  add(prop: Prop, roadGap: number, propGap: number, ignore?: (other: Prop) => boolean): boolean {
    if (!this.fits(prop, roadGap, propGap, ignore)) return false;
    this.place(prop);
    return true;
  }

  private place(prop: Prop): void {
    this.props.push(prop);
    this.forCells(prop, 0, (key) => {
      const list = this.propCells.get(key);
      if (list) list.push(prop);
      else this.propCells.set(key, [prop]);
    });
  }

  /** Props whose rectangles come within `pad` px of this one. */
  private propsNear(prop: Prop, pad: number): Prop[] {
    const found = new Set<Prop>();
    this.forCells(prop, pad, (key) => {
      for (const other of this.propCells.get(key) ?? []) if (!found.has(other) && propsOverlap(prop, other, pad)) found.add(other);
    });
    return [...found];
  }

  /** Calls `fn` with each grid cell a prop's bounding circle (plus `pad`) touches. */
  private forCells(prop: Prop, pad: number, fn: (key: number) => void): void {
    const r = Math.hypot(prop.w, prop.h) / 2 + pad;
    for (let gx = Math.floor((prop.x - r) / PROP_CELL); gx <= Math.floor((prop.x + r) / PROP_CELL); gx++) {
      for (let gy = Math.floor((prop.y - r) / PROP_CELL); gy <= Math.floor((prop.y + r) / PROP_CELL); gy++) fn(key(gx, gy));
    }
  }

  /** Whether a prop is at least `roadGap` px from every road edge, clear of the barriers and other props, and in the world. */
  fits(prop: Prop, roadGap: number, propGap: number, ignore?: (other: Prop) => boolean): boolean {
    const { minX, minY, maxX, maxY } = this.bounds;
    for (const c of propCorners(prop)) if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) return false;
    if (this.propsNear(prop, propGap).some((other) => !ignore?.(other))) return false;
    const reach = Math.hypot(prop.w, prop.h) / 2 + TYRE_RADIUS + GAP.barrier;
    for (const t of this.barriersNear(prop.x, prop.y, reach)) {
      if (distanceToProp(prop, t.x, t.y) < TYRE_RADIUS + 2) return false;
    }
    const port = this.port;
    for (const s of propSamples(prop)) {
      const pos = locateOnTrack(this.track, s.x, s.y);
      const grass = pos.distance - pos.halfWidth - this.track.kerbWidth;
      if (grass < roadGap) return false;
      if (this.water.length > 0 && inWater(this.water, s.x, s.y, 6)) return false;
      if (port) {
        // On dry land; yard things on the concrete, trees on the grass.
        if (!isLand(port, s.x, s.y)) return false;
        const pastVerge = grass - this.beyond - port.verge[Math.floor(pos.along / this.track.spacing) % this.n];
        if (CONCRETE.has(prop.kind) && pastVerge < 10) return false;
        if (prop.kind === 'tree' && pastVerge > -8) return false;
      }
    }
    return true;
  }

  private barriersNear(x: number, y: number, within: number): Vec2[] {
    const out: Vec2[] = [];
    const r = Math.ceil(within / BARRIER_CELL);
    const cx = Math.floor(x / BARRIER_CELL);
    const cy = Math.floor(y / BARRIER_CELL);
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) out.push(...(this.barrierCells.get(key(gx, gy)) ?? []));
    }
    return out;
  }

  nearBarrier(x: number, y: number, within: number): boolean {
    return this.barriersNear(x, y, within).some((t) => Math.hypot(t.x - x, t.y - y) < within);
  }

  /** Samples at the tightest point of each corner tighter than `maxRadius`, at least `apart` samples apart, tightest first. */
  apexes(maxRadius: number, apart: number): number[] {
    const { radii, n } = this;
    const all = radii
      .map((radius, i) => ({ i, radius }))
      .filter(({ i, radius }) => radius < maxRadius && radius <= radii[(i - 1 + n) % n] && radius <= radii[(i + 1) % n])
      .sort((a, b) => a.radius - b.radius);
    const chosen: number[] = [];
    for (const { i } of all) if (chosen.every((c) => circular(c, i, n) > apart)) chosen.push(i);
    return chosen;
  }

  prop(kind: PropKind, x: number, y: number, angle: number, w: number, h: number, variant: number): Prop {
    return { kind, x, y, angle, w, h, variant };
  }

  /** Both sides, in random order. */
  sides(): [1 | -1, 1 | -1] {
    return this.rng() < 0.5 ? [1, -1] : [-1, 1];
  }

  /** Random whole number from 0 to below `below`. */
  int(below: number): number {
    return Math.floor(this.rng() * below);
  }
}

/** Distance from a point to a straight route, px. */
function distanceToRoute(route: Route, x: number, y: number): number {
  const dx = route.to.x - route.from.x;
  const dy = route.to.y - route.from.y;
  const t = Math.max(0, Math.min(1, ((x - route.from.x) * dx + (y - route.from.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - route.from.x - dx * t, y - route.from.y - dy * t);
}

function cell(x: number, y: number): number {
  return key(Math.floor(x / BARRIER_CELL), Math.floor(y / BARRIER_CELL));
}

function key(gx: number, gy: number): number {
  return (gx + 50_000) * 100_000 + (gy + 50_000);
}

/** +1 where the centre line bends right (on a y-down screen), -1 where it bends left. */
function turnDirections(track: Track, k: number): number[] {
  const { points } = track;
  const n = points.length;
  return points.map((b, i) => {
    const a = points[(i - k + n) % n];
    const c = points[(i + k) % n];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0 ? 1 : -1;
  });
}

/** Samples apart around a loop of n. */
function circular(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/** A seed from the track's shape, so each layout gets its own (but always the same) decoration. */
function trackSeed(track: Track): number {
  let h = 2166136261;
  for (const p of track.points) {
    h = Math.imul(h ^ Math.round(p.x), 16777619);
    h = Math.imul(h ^ Math.round(p.y), 16777619);
  }
  return h >>> 0;
}
