/**
 * Turns OpenStreetMap data (the XML the OSM API's `map` call gives) into the
 * game's map: roads, paths, ground areas, water, buildings with heights,
 * trees, walls and street furniture, in game pixels with north up.
 *
 * Pure (no Phaser, no DOM), so it can be tested, and run by
 * `tools/build-map.ts` to make `src/map/bristol.json`.
 */

import { type Berth, type FerryRoute, type MooringEdge, Water, ferryStop, findBerths, overlap } from './berths.ts';
import { CORRECTIONS, GATEWAYS, LANDMARKS, STREETS } from './landmarks.ts';
import { type Arm, type Controller, type LightPoint, type Signal, trafficLights } from './signals.ts';

export type { Controller, Signal } from './signals.ts';

/** Game pixels per metre: a car is about 4.75 m long, 38 px. */
export const PX_PER_METRE = 8;

// --- The map format the game reads ---

/** A flat list of coordinates, x0, y0, x1, y1, ... in px (y down, north up). */
export type Pts = number[];

export type AreaKind =
  | 'grass'
  | 'park'
  | 'garden'
  | 'flowerbed'
  | 'wood'
  | 'pitch'
  | 'play'
  | 'plaza'
  | 'parking'
  | 'dirt'
  | 'water'
  | 'pool'
  | 'pier'
  | 'pontoon'
  | 'slipway'
  | 'forecourt'
  /** Paved for vehicles, not people (OSM's `area:highway=service`: a bus station's yard). */
  | 'yard'
  | 'island';

export interface Area {
  kind: AreaKind;
  /** The outer ring first, then any holes (filled even-odd). */
  rings: Pts[];
  /** What it's paved with, if it's tagged and not the usual for its kind. */
  surface?: Paving;
  /** A slipway's way down, into the water, radians. */
  angle?: number;
  /** Lines painted on it: a petrol station forecourt's lanes (x0, y0, x1, y1, ...). */
  lines?: number[];
}

/** What a road, path or square is surfaced with (tarmac, the usual for roads, is left unsaid). */
export type Paving = 'asphalt' | 'paving' | 'sett' | 'concrete' | 'gravel' | 'wood' | 'grass';

/** Sorts OSM's `surface` values into the few the game draws. */
export function paving(surface: string | undefined): Paving | undefined {
  if (!surface) return undefined;
  const s = surface.split(/[;:]/)[0];
  if (s === 'asphalt' || s === 'chipseal' || s === 'tartan') return 'asphalt';
  if (s === 'paving_stones' || s === 'bricks' || s === 'brick' || s === 'stone' || s === 'composite' || s === 'tiles') return 'paving';
  if (s === 'sett' || s === 'cobblestone' || s === 'unhewn_cobblestone') return 'sett';
  if (s === 'concrete' || s === 'metal' || s === 'stepping_stones') return 'concrete';
  if (s === 'compacted' || s === 'fine_gravel' || s === 'gravel' || s === 'pebblestone' || s === 'dirt' || s === 'ground' || s === 'earth' || s === 'unpaved' || s === 'mud' || s === 'sand') return 'gravel';
  if (s === 'wood') return 'wood';
  if (s === 'grass' || s === 'grass_paver') return 'grass';
  return undefined;
}

export type RoadKind =
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'street'
  | 'service'
  | 'pedestrian'
  | 'footway'
  | 'cycleway'
  | 'steps'
  | 'track';

export interface Road {
  kind: RoadKind;
  name?: string;
  /** Carriageway width, px. */
  width: number;
  pts: Pts;
  oneway?: boolean;
  /** On a bridge: a deck above whatever's below it (the water, another road), a level of its own. */
  bridge?: boolean;
  /** A bridge's deck's height every DECK_STEP px along it, px (as the terrain's: above its base), measured by the LIDAR. */
  deck?: number[];
  /** Through an archway under a building (OSM's `tunnel=building_passage`): the building's walls open to let it through. */
  passage?: boolean;
  /** Along an arcade or colonnade (`covered=arcade/colonnade`): under the front of a building, open along its side. */
  arcade?: boolean;
  /** A car park's aisle (`service=parking_aisle`): bays painted along both sides. */
  aisle?: boolean;
  /** Which sides it has pavements along (as it runs: left and right of its line), drawn with it. */
  pavement?: 'both' | 'left' | 'right';
  /** Not mapped: a road bridge's pavement, made a deck of its own (see Decks): the road's index, and which side of it it's on (1 left, -1 right). */
  pavementOf?: { road: number; side: 1 | -1 };
  /** What it's surfaced with, if tagged (the drawing picks a usual one for its kind otherwise). */
  surface?: Paving;
  /** Stretches (distances along it, start, end, start, end, ...) with lane markings: not across junctions. */
  marks?: number[];
  /** How many lanes each way (the way's way, and against it), where there are more than one lane a side: a line's painted between each. */
  lanesAcross?: [number, number];
  /** Lanes painted along its sides: bus lanes, cycle lanes, parking bays. */
  lanes?: Lane[];
  /** Where they're painted (distances along it, start, end, ...): clear of junctions, crossings and sharp bends. */
  laneSpans?: number[];
  /** Only for buses (`access=no` with `bus` or `psv=yes`: a bus station's yard, its bays): the rest of the traffic keeps out. */
  bus?: boolean;
  /** How busy it is: the shops, cafés, bars, offices and the like within ACTIVITY_REACH of it, per 100 m of it (more traffic, and more parked). */
  activity?: number;
  /** Steps: how many there are up the flight (OSM's `step_count`, or from how far it rises, measured by the LIDAR). */
  steps?: number;
}

/**
 * A lane painted along one side of a road (left, 1, or right, -1, as the way
 * runs; the traffic in it goes the way the way runs on the left, against it on
 * the right, as in Britain): a bus lane (red), a cycle lane (its line dashed,
 * or solid where cars mustn't cross it), bike symbols in the traffic lane
 * (shared), or parking bays along the kerb.
 */
export interface Lane {
  side: 1 | -1;
  kind: 'bus' | 'cycle' | 'shared' | 'parking';
  /** How wide, px. */
  width: number;
  /** A cycle lane's line is solid (mandatory) rather than dashed (advisory). */
  solid?: boolean;
  /** Bikes ride in it too (a bus lane they share). */
  bikes?: boolean;
  /** Parking bays: which way round the cars park, and whether it's for loading only. */
  bays?: 'parallel' | 'perpendicular' | 'diagonal';
  loading?: boolean;
  /** It carries on from the same lane on the road before (so its name isn't painted again at its start). */
  continues?: boolean;
}

/** How far clear of a junction, a crossing and a sharp bend lanes are painted, px. */
const LANE_CLEAR_JUNCTION = 6 * PX_PER_METRE;
const LANE_CLEAR_CROSSING = 3 * PX_PER_METRE;
const LANE_CLEAR_BEND = 3 * PX_PER_METRE;
/** A bend sharper than this (radians) breaks the lanes painted along a road. */
const SHARP_BEND = 0.7;

/** Stretches of lane shorter than this aren't painted, px: they'd just be stubs between junctions. */
const LANE_SHORTEST = 10 * PX_PER_METRE;

/** Takes stretches out of a list of them (start, end, ...), keeping what's left that's long enough to paint. */
export function cutSpans(spans: number[], cuts: [number, number][]): number[] {
  let out = spans;
  for (const [a, b] of cuts) {
    const next: number[] = [];
    for (let k = 0; k + 1 < out.length; k += 2) {
      const [s, e] = [out[k], out[k + 1]];
      if (b <= s || a >= e) next.push(s, e);
      else {
        if (a > s) next.push(s, a);
        if (b < e) next.push(b, e);
      }
    }
    out = next;
  }
  const kept: number[] = [];
  for (let k = 0; k + 1 < out.length; k += 2) if (out[k + 1] - out[k] >= LANE_SHORTEST) kept.push(round(out[k]), round(out[k + 1]));
  return kept;
}

/**
 * Something painted on the road or pavement at a point: give way lines, a
 * stop line, a mini-roundabout, an arrow in a lane, a cycle box at lights,
 * a bus stop's box, or tactile paving at a crossing.
 */
export interface PaintMark {
  kind: 'giveway' | 'triangle' | 'stop' | 'mini' | 'arrow' | 'asl' | 'busstop' | 'tactile' | 'table' | 'hump' | 'cushion';
  /** Its middle. */
  x: number;
  y: number;
  /** Which way the traffic it's for is heading (tactile paving: which way is out from the road), radians. */
  angle: number;
  /** How wide it is across the way (a bus stop's box, how long; tactile paving, how long along the kerb; a mini-roundabout, across), px. */
  width: number;
  /** An arrow's turns, as OSM's `turn:lanes` has them (`left;through`). */
  turns?: string;
  /** Tactile paving at a crossing with lights: red (buff at the rest). */
  red?: boolean;
  /** A bus stop's box where the road won't take a red bay (a bend, a junction): just its outline. */
  outline?: boolean;
}

/** How far back from the give way lines their triangle's painted, px. */
const GIVE_WAY_TRIANGLE = 9 * PX_PER_METRE;

/** How deep a bus stop's box is, out from the kerb, px. */
export const BUS_STOP_DEPTH = 3 * PX_PER_METRE;

/** A bus lane's and a cycle lane's width, px. */
const BUS_LANE = 3.2 * PX_PER_METRE;
const CYCLE_LANE = 1.5 * PX_PER_METRE;

/**
 * The lanes painted along a road's sides, from OSM's `lanes:psv`, `lanes:bus`
 * (`:forward`, `:backward`), `cycleway`, `cycleway:left/right/both` (and
 * `:lane`), and `parking:lane:*` or `parking:*` tags.
 */
export function roadLanes(t: Tags, oneway: boolean, width: number): Lane[] | undefined {
  const lanes: Lane[] = [];
  const count = (k: string) => parseInt(t[k] ?? '', 10) || 0;
  const total = Math.max(1, parseInt(t.lanes ?? '', 10) || (oneway ? 1 : 2));
  const laneWidth = Math.min(BUS_LANE, width / total);
  // Bus lanes: at the kerb, on the side the traffic's going their way.
  let forward = count('lanes:psv:forward') || count('lanes:bus:forward');
  let backward = count('lanes:psv:backward') || count('lanes:bus:backward');
  const either = count('lanes:psv') || count('lanes:bus');
  if (!forward && !backward && either) {
    if (oneway) forward = either;
    // Two of them on a two-way road: one each way. (Just one, it's not said which way.)
    else if (either >= 2) forward = backward = 1;
  }
  const half = oneway ? width : width / 2;
  if (forward) lanes.push({ side: 1, kind: 'bus', width: Math.round(Math.min(half, forward * laneWidth)) });
  if (backward) lanes.push({ side: -1, kind: 'bus', width: Math.round(Math.min(half, backward * laneWidth)) });
  // Cycle lanes, and bike symbols where bikes share a lane.
  const sides: [1 | -1, string | undefined, string | undefined][] = [
    [1, t['cycleway:left'] ?? t['cycleway:both'] ?? t.cycleway, t['cycleway:left:lane'] ?? t['cycleway:both:lane'] ?? t['cycleway:lane']],
    [-1, t['cycleway:right'] ?? t['cycleway:both'] ?? (oneway ? undefined : t.cycleway), t['cycleway:right:lane'] ?? t['cycleway:both:lane'] ?? t['cycleway:lane']],
  ];
  for (const [side, kind, line] of sides) {
    if (kind === 'lane' && line !== 'pictogram') lanes.push({ side, kind: 'cycle', width: CYCLE_LANE, ...(line === 'exclusive' ? { solid: true } : {}) });
    else if (kind === 'lane' || kind === 'shared_lane') lanes.push({ side, kind: 'shared', width: CYCLE_LANE });
    else if (kind === 'share_busway') {
      const bus = lanes.find((l) => l.kind === 'bus' && l.side === side);
      if (bus) bus.bikes = true;
      else lanes.push({ side, kind: 'bus', width: Math.round(Math.min(half, laneWidth)), bikes: true });
    }
  }
  // Parking bays along the kerb (not lay-bys off the road, or on the pavement).
  for (const [side, name] of [[1, 'left'], [-1, 'right']] as const) {
    const old = t[`parking:lane:${name}`] ?? t['parking:lane:both'];
    const fresh = t[`parking:${name}`] ?? t['parking:both'];
    const bays = old && ['parallel', 'perpendicular', 'diagonal'].includes(old) ? old : fresh === 'lane' ? (t[`parking:${name}:orientation`] ?? t['parking:both:orientation'] ?? 'parallel') : undefined;
    if (!bays || !['parallel', 'perpendicular', 'diagonal'].includes(bays)) continue;
    const where = t[`parking:lane:${name}:${bays}`] ?? t[`parking:lane:both:${bays}`];
    if (where === 'street_side' || where === 'on_kerb' || where === 'shoulder') continue;
    const loading = (t[`parking:${name}:restriction`] ?? t['parking:both:restriction']) === 'loading_only';
    const depth = bays === 'parallel' ? 2 : bays === 'diagonal' ? 4.5 : 5;
    lanes.push({ side, kind: 'parking', width: Math.round(Math.min(half, depth * PX_PER_METRE)), bays: bays as Lane['bays'], ...(loading ? { loading } : {}) });
  }
  return lanes.length ? lanes : undefined;
}

/**
 * How many lanes a road has each way (as the way runs, and against it), from
 * OSM's `lanes`, `lanes:forward` and `lanes:backward`: only where a side has
 * more than one (one each way is just the centre line).
 */
export function lanesAcross(t: Tags, oneway: boolean): [number, number] | undefined {
  const total = parseInt(t.lanes ?? '', 10) || 0;
  const forward = parseInt(t['lanes:forward'] ?? '', 10) || (oneway ? total : Math.ceil(total / 2));
  const backward = oneway ? 0 : parseInt(t['lanes:backward'] ?? '', 10) || Math.max(0, total - forward);
  if (forward < 2 && backward < 2) return undefined;
  return [Math.max(1, forward), backward];
}

/**
 * The arrows painted in each lane coming up to a junction, from OSM's
 * `turn:lanes` (`:forward`, `:backward`): lanes listed left to right as the
 * driver sees them; on a two-way road, the traffic going the way's way keeps
 * to its left half. Each set's painted 15 m before the way's end (or in its
 * middle, if it's short), and again 35 m before if there's room.
 */
export function laneArrows(t: Tags, oneway: boolean, width: number, pts: Pts): PaintMark[] {
  const out: PaintMark[] = [];
  const length = polylineLength(pts);
  const sets: [string | undefined, 1 | -1][] = oneway ? [[t['turn:lanes'] ?? t['turn:lanes:forward'], 1]] : [[t['turn:lanes:forward'], 1], [t['turn:lanes:backward'], -1]];
  for (const [turns, way] of sets) {
    if (!turns) continue;
    const lanes = turns.split('|');
    const across = oneway ? width : width / 2;
    const laneWidth = across / lanes.length;
    const befores = length < 30 * PX_PER_METRE ? [length / 2] : length < 60 * PX_PER_METRE ? [15 * PX_PER_METRE] : [15 * PX_PER_METRE, 35 * PX_PER_METRE];
    for (const before of befores) {
      const along = way === 1 ? length - before : before;
      const [x, y, ux, uy] = alongPolyline(pts, along);
      // The traffic's heading, and its left as it goes (y down): its lanes run from there.
      const [hx, hy] = [ux * way, uy * way];
      const [lx, ly] = [hy, -hx];
      const leftEdge = oneway ? width / 2 : width / 2;
      lanes.forEach((turn, i) => {
        if (!turn || turn === 'none') return;
        const off = leftEdge - (i + 0.5) * laneWidth;
        out.push({ kind: 'arrow', x: round(x + lx * off), y: round(y + ly * off), angle: +Math.atan2(hy, hx).toFixed(3), width: round(laneWidth), turns: turn });
      });
    }
  }
  return out;
}

/** Where along a polyline a point's nearest, and how far from it it is. */
function nearestAlongPolyline(pts: Pts, x: number, y: number): { along: number; distance: number } {
  let best = { along: 0, distance: Infinity };
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best.distance) best = { along: run + t * len, distance: d };
    run += len;
  }
  return best;
}

function polylineLength(pts: Pts): number {
  let d = 0;
  for (let i = 2; i < pts.length; i += 2) d += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return d;
}

/** The point `along` px along a polyline, and the way it's heading there. */
/** How far along a polyline the nearest point to (x, y) is, and how far it is from it. */
function nearestAlongLine(pts: Pts, x: number, y: number): { along: number; distance: number } {
  let best = { along: 0, distance: Infinity };
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best.distance) best = { along: run + t * len, distance: d };
    run += len;
  }
  return best;
}

function alongPolyline(pts: Pts, along: number): [number, number, number, number] {
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    if (run + len >= along || i + 4 >= pts.length) {
      const t = Math.max(0, Math.min(1, (along - run) / len));
      return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
    }
    run += len;
  }
  return [pts[0], pts[1], 1, 0];
}

/** How far apart a bridge deck's measured heights are, px (2 m). */
export const DECK_STEP = 2 * PX_PER_METRE;

export type LineKind = 'wall' | 'fence' | 'hedge' | 'rail' | 'quay' | 'railing' | 'kerb' | 'gate' | 'liftgate' | 'chain' | 'shelter';

export interface Line {
  kind: LineKind;
  pts: Pts;
  /** How tall it is, px, as the LIDAR measured it (or as tagged); the usual for its kind otherwise. */
  height?: number;
  /** A retaining wall (`barrier=retaining_wall`): holding the ground back, as high as the ground drops across it. */
  retaining?: boolean;
}

export interface Building {
  id: number;
  name?: string;
  /** The outline (and any courtyards). */
  rings: Pts[];
  /** Top and bottom, px above the ground (bottom > 0 for overhangs and upper parts). */
  top: number;
  bottom: number;
  kind: string;
  wall?: string;
  roof?: string;
  roofShape?: string;
  /** Whether you crash into it (the outlines; parts sit on them and canopies are open underneath). */
  solid: boolean;
  /** Whether it's drawn (an outline whose parts are drawn instead isn't). */
  drawn: boolean;
  /** Which of src/map/landmarks.ts it is, if any. */
  landmark?: string;
  /** A pitched roof's ridge runs across the building rather than along it. */
  roofAcross?: boolean;
  /** Where its height came from, if not its number of floors or a guess: tagged in OSM, or measured by LIDAR. */
  heightFrom?: 'tag' | 'lidar';
  /** What its roof's made of (OSM's `roof:material`): how it's textured. */
  roofMaterial?: string;
  /** A petrol station's canopy over its pumps. */
  fuel?: boolean;
}

export type PropKind =
  | 'lamp'
  | 'bollard'
  | 'bench'
  | 'bin'
  | 'postbox'
  | 'phone'
  | 'signals'
  | 'busstop'
  | 'fountain'
  | 'bikes'
  | 'meter'
  | 'clock'
  | 'lifering'
  | 'statue'
  | 'block'
  | 'planter'
  | 'gritbin'
  | 'picnic'
  | 'crane'
  | 'ladder'
  | 'mooring'
  | 'pump';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  /** Which way it faces, radians: a crane's jib and a ladder, out over the water. */
  angle?: number;
  /** How tall, px: a crane. */
  height?: number;
}

export interface Crossing {
  x: number;
  y: number;
  /** Direction of the road, radians. */
  angle: number;
  /** The road's width, px. */
  width: number;
  /** A zebra (stripes, flashing beacons), one with lights (studs; traffic stops at its lights), or just a dropped kerb (nothing painted). */
  kind: CrossingKind;
  /** For one with lights, the controller that works them. */
  controller?: number;
  /** The road it crosses (its index in the map's roads) and how far along that road it is, px, so its zig-zags can follow the kerbs. */
  road?: number;
  at?: number;
}

export type CrossingKind = 'zebra' | 'lights' | 'plain';

/** What sort of crossing OSM's tags make it. */
export function crossingKind(t: Tags): CrossingKind {
  const markings = t['crossing:markings'] ?? '';
  if (t.crossing === 'traffic_signals' || ['pelican', 'puffin', 'toucan', 'pegasus'].includes(t.crossing_ref)) return 'lights';
  if (t.crossing === 'zebra' || t.crossing_ref === 'zebra' || markings.includes('zebra')) return 'zebra';
  return 'plain';
}

export interface GameMap {
  attribution: string;
  pxPerMetre: number;
  width: number;
  height: number;
  /** The map's north-west corner. */
  origin: { lat: number; lon: number };
  spawn: { x: number; y: number; heading: number };
  areas: Area[];
  roads: Road[];
  lines: Line[];
  buildings: Building[];
  /** Trees: x, y, crown radius, height (all px), ... */
  trees: number[];
  props: Prop[];
  crossings: Crossing[];
  /** Each way into each set of traffic lights, and the controllers that work them. */
  signals: Signal[];
  controllers: Controller[];
  /** The lie of the land, if measured (see src/map/enrich.ts). */
  terrain?: TerrainData;
  /** Where the kerb's dropped (lowered or flush, OSM's `kerb=*` on a node): x, y, ... */
  dropped?: number[];
  /** What's painted at points on the roads and pavements (see PaintMark). */
  paint?: PaintMark[];
  /** Trees whose species is known: index in `trees` (by four), species (TREE_SPECIES' index), ... */
  treeSpecies?: number[];
  /** Solar panels on roofs: x, y, how many panels, ... */
  solar?: number[];
  /** Steep banks (embankments, cuttings), measured by the LIDAR: x, y, which way's downhill (radians, as a hundredth), ... */
  banks?: number[];
  /** Sharp drops in the bare ground, measured by the LIDAR (see Ledge). */
  ledges?: Ledge[];
  /** The bus routes through the map (see BusRoute). */
  busRoutes?: BusRoute[];
  /** The bus stations, and their bays (see BusStation). */
  busStations?: BusStation[];
  /** The police stations, fire stations, hospitals and ambulance stations (see Service). */
  services?: Service[];
  /** Where boats moor, and the ferry routes (see berths.ts). */
  berths?: Berth[];
  /** Where people go: x, y, what (0 a shop, café, bar or the like; 1 a sight: a museum, gallery, monument, statue, viewpoint), ... */
  venues?: number[];
  ferries?: FerryRoute[];
}

/**
 * A bus station (OSM's `public_transport=stop_area`, with its bays on ways
 * only buses use): where each bay is, for the buses to pull into (nose in,
 * then back out), and where their passengers wait.
 */
export interface BusStation {
  name?: string;
  bays: Bay[];
}

export interface Bay {
  /** Where the bus stops (the end of the way into the bay, `stop_position`), and which way it's facing there (into the bay), radians. */
  x: number;
  y: number;
  angle: number;
  /** The way into the bay (the road's index). */
  road: number;
  /** Where its passengers wait (its `platform`), x, y. */
  platform: [number, number];
}

/**
 * An emergency service's place: a police station (`amenity=police`), a fire
 * station (`amenity=fire_station`), or a hospital or ambulance station
 * (`amenity=hospital`, a `building=hospital` named as one, or
 * `emergency=ambulance_station`): what it is, its outlines (those within
 * 120 m of each other, of a kind, as one, as a hospital's buildings), and its
 * middle. Mapped as a point, it's a 10 m square.
 */
export interface Service {
  kind: ServiceKind;
  name?: string;
  /** A hospital with an accident and emergency department (`emergency=yes`): busier. */
  emergency?: boolean;
  x: number;
  y: number;
  rings: Pts[];
}

export type ServiceKind = 'police' | 'fire' | 'ambulance';

/** What emergency service a place is, if any (see Service). */
export function serviceKind(t: Tags): ServiceKind | null {
  if (t.amenity === 'police') return 'police';
  if (t.amenity === 'fire_station') return 'fire';
  if (t.emergency === 'ambulance_station' || t.amenity === 'ambulance_station' || t.amenity === 'hospital') return 'ambulance';
  if (t.building === 'hospital' && /hospital|infirmary/i.test(t.name ?? '')) return 'ambulance';
  return null;
}

/** A way only buses use (`access=no` with `bus` or `psv=yes`). */
export function busOnly(t: Tags): boolean {
  const closed = t.access === 'no' || t.access === 'private' || t.motor_vehicle === 'no' || t.motorcar === 'no';
  return closed && (t.bus === 'yes' || t.bus === 'designated' || t.psv === 'yes' || t.psv === 'designated');
}

/**
 * A sharp drop in the ground (a quay's edge, a retaining wall, the side of a
 * sunken square): its top edge, with the ground falling away on the right of
 * it, as it runs (y being down); and how far it drops at each point, px.
 */
export interface Ledge {
  pts: Pts;
  drop: number[];
}

/**
 * A bus route (OSM's `route=bus`): the roads it runs along, in order, and
 * its stops. Each leg is a road's index times two, plus one if the bus goes
 * along it against the way it's drawn; -1 where the route leaves the map's
 * roads for a while (off the map, or along a way only buses use).
 */
export interface BusRoute {
  /** Its number (`ref`), and its colour (`colour`), if mapped. */
  ref: string;
  colour?: string;
  legs: number[];
  /** Where it stops, in order: x, y, ... */
  stops: number[];
}

/**
 * The ground's height above sea level, on a grid over the map: each cell's
 * height in decimetres above `base`, as little-endian 16-bit numbers, in
 * base64 (it's a lot of numbers, and this keeps the file small).
 */
export interface TerrainData {
  /** Map px between grid points; the first is at (0, 0), or (i0, j0) cells from it (a region of the map: see regions.ts). */
  cell: number;
  cols: number;
  rows: number;
  i0?: number;
  j0?: number;
  /** Metres above sea level of the lowest point. */
  base: number;
  heights: string;
}

// --- Reading the XML ---

type Tags = Record<string, string>;

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags: Tags;
}
export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Tags;
}
export interface OsmRelation {
  id: number;
  members: { type: string; ref: number; role: string }[];
  tags: Tags;
}
export interface OsmData {
  bounds: { minlat: number; minlon: number; maxlat: number; maxlon: number } | null;
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  relations: Map<number, OsmRelation>;
}

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
}

function unescapeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(quot|amp|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    switch (e) {
      case 'quot':
        return '"';
      case 'amp':
        return '&';
      case 'apos':
        return "'";
      case 'lt':
        return '<';
      case 'gt':
        return '>';
    }
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** Reads OSM XML (as the API's `map` and `relation/full` calls give it). Several files can be merged by calling it with `into`. */
export function parseOsm(xml: string, into?: OsmData): OsmData {
  const data: OsmData = into ?? { bounds: null, nodes: new Map(), ways: new Map(), relations: new Map() };
  let current: { tags: Tags } | null = null;
  for (const m of xml.matchAll(/<(\/?)(bounds|node|way|relation|nd|tag|member)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, body, selfClosing] = m;
    if (closing) {
      current = null;
      continue;
    }
    const a = attrs(body);
    switch (name) {
      case 'bounds':
        data.bounds ??= { minlat: +a.minlat, minlon: +a.minlon, maxlat: +a.maxlat, maxlon: +a.maxlon };
        break;
      case 'node': {
        const node: OsmNode = { id: +a.id, lat: +a.lat, lon: +a.lon, tags: {} };
        if (a.visible !== 'false') data.nodes.set(node.id, node);
        current = selfClosing ? null : node;
        break;
      }
      case 'way': {
        const way: OsmWay = { id: +a.id, nodes: [], tags: {} };
        if (a.visible !== 'false') data.ways.set(way.id, way);
        current = selfClosing ? null : way;
        break;
      }
      case 'relation': {
        const rel: OsmRelation = { id: +a.id, members: [], tags: {} };
        if (a.visible !== 'false') data.relations.set(rel.id, rel);
        current = selfClosing ? null : rel;
        break;
      }
      case 'nd':
        if (current && 'nodes' in current) (current as OsmWay).nodes.push(+a.ref);
        break;
      case 'member':
        if (current && 'members' in current) (current as OsmRelation).members.push({ type: a.type, ref: +a.ref, role: a.role ?? '' });
        break;
      case 'tag':
        if (current) current.tags[a.k] = a.v;
        break;
    }
  }
  return data;
}

// --- Projection and geometry ---

/** Flat projection about the map's north-west corner: metres east and south, as px. */
export class Projection {
  private readonly kx: number;
  private readonly ky: number;
  readonly lat0: number;
  readonly lon0: number;

  constructor(lat0: number, lon0: number, pxPerMetre = PX_PER_METRE) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    const rad = (lat0 * Math.PI) / 180;
    // Metres per degree at this latitude (WGS84, good to well under a metre over a few km).
    this.kx = (111412.84 * Math.cos(rad) - 93.5 * Math.cos(3 * rad)) * pxPerMetre;
    this.ky = (111132.92 - 559.82 * Math.cos(2 * rad) + 1.175 * Math.cos(4 * rad)) * pxPerMetre;
  }

  x(lon: number): number {
    return (lon - this.lon0) * this.kx;
  }

  y(lat: number): number {
    return (this.lat0 - lat) * this.ky;
  }

  lon(x: number): number {
    return this.lon0 + x / this.kx;
  }

  lat(y: number): number {
    return this.lat0 - y / this.ky;
  }
}

/** Signed area of a closed ring (positive when clockwise on screen, y down). */
export function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

export function centroid(pts: Pts): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i += 2) {
    x += pts[i];
    y += pts[i + 1];
  }
  const n = pts.length / 2;
  return { x: x / n, y: y / n };
}

export function pointInRing(x: number, y: number, pts: Pts): boolean {
  let inside = false;
  for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where a pitched roof's ridge runs: along the building's longest side (or
 * across it), through the middle of the building measured across the ridge.
 * Returns a point on the ridge, its direction, how far the building reaches
 * along it each way from that point, and half the building's width across it.
 */
export function ridgeAxis(outer: Pts, across = false): { ox: number; oy: number; ux: number; uy: number; t0: number; t1: number; half: number } {
  let best = 0;
  let ux = 1;
  let uy = 0;
  for (let i = 0; i < outer.length; i += 2) {
    const j = (i + 2) % outer.length;
    const dx = outer[j] - outer[i];
    const dy = outer[j + 1] - outer[i + 1];
    const len = Math.hypot(dx, dy);
    if (len > best) {
      best = len;
      ux = dx / len;
      uy = dy / len;
    }
  }
  if (across) [ux, uy] = [-uy, ux];
  const c = centroid(outer);
  let [t0, t1, s0, s1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < outer.length; i += 2) {
    const px = outer[i] - c.x;
    const py = outer[i + 1] - c.y;
    const t = px * ux + py * uy;
    const s = -px * uy + py * ux;
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
  }
  const mid = (s0 + s1) / 2;
  return { ox: c.x - uy * mid, oy: c.y + ux * mid, ux, uy, t0, t1, half: (s1 - s0) / 2 };
}

/** Clips a closed ring to a rectangle (Sutherland-Hodgman). */
export function clipRing(pts: Pts, x0: number, y0: number, x1: number, y1: number): Pts {
  let out = pts;
  const edges: [(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]][] = [
    [(x) => x >= x0, (ax, ay, bx, by) => [x0, ay + ((by - ay) * (x0 - ax)) / (bx - ax)]],
    [(x) => x <= x1, (ax, ay, bx, by) => [x1, ay + ((by - ay) * (x1 - ax)) / (bx - ax)]],
    [(_, y) => y >= y0, (ax, ay, bx, by) => [ax + ((bx - ax) * (y0 - ay)) / (by - ay), y0]],
    [(_, y) => y <= y1, (ax, ay, bx, by) => [ax + ((bx - ax) * (y1 - ay)) / (by - ay), y1]],
  ];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    const n = input.length;
    if (n === 0) break;
    for (let i = 0; i < n; i += 2) {
      const ax = input[(i - 2 + n) % n];
      const ay = input[(i - 1 + n) % n];
      const bx = input[i];
      const by = input[i + 1];
      const aIn = inside(ax, ay);
      const bIn = inside(bx, by);
      if (bIn) {
        if (!aIn) out.push(...cut(ax, ay, bx, by));
        out.push(bx, by);
      } else if (aIn) {
        out.push(...cut(ax, ay, bx, by));
      }
    }
  }
  return out;
}

/** Clips an open polyline to a rectangle: the pieces inside it. */
export function clipLine(pts: Pts, x0: number, y0: number, x1: number, y1: number): Pts[] {
  const pieces: Pts[] = [];
  let piece: Pts = [];
  const flush = () => {
    if (piece.length >= 4) pieces.push(piece);
    piece = [];
  };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const seg = clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], x0, y0, x1, y1);
    if (!seg) {
      flush();
      continue;
    }
    const [ax, ay, bx, by] = seg;
    const last = piece.length;
    if (last === 0 || piece[last - 2] !== ax || piece[last - 1] !== ay) {
      flush();
      piece.push(ax, ay);
    }
    piece.push(bx, by);
    // Left the rectangle partway along: the next piece starts afresh.
    if (bx !== pts[i + 2] || by !== pts[i + 3]) flush();
  }
  flush();
  return pieces;
}

/** Liang-Barsky: the part of a segment inside a rectangle, or null. */
function clipSegment(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const checks: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [t0 === 0 ? ax : ax + t0 * dx, t0 === 0 ? ay : ay + t0 * dy, t1 === 1 ? bx : ax + t1 * dx, t1 === 1 ? by : ay + t1 * dy];
}

/** Joins ways (lists of node ids) end to end into closed rings, as for a multipolygon's members. */
export function joinRings(ways: number[][]): number[][] {
  const pending = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: number[][] = [];
  while (pending.length > 0) {
    const ring = pending.shift()!;
    let grown = true;
    while (ring[0] !== ring[ring.length - 1] && grown) {
      grown = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pending.length; i++) {
        const w = pending[i];
        if (w[0] === end) ring.push(...w.slice(1));
        else if (w[w.length - 1] === end) ring.push(...w.slice(0, -1).reverse());
        else continue;
        pending.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// --- What things are ---

/** Parses a length tag ("12", "12 m", "40'"), in metres. */
export function metres(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(m|ft|')?/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return m[2] === 'ft' || m[2] === "'" ? n * 0.3048 : n;
}

const ROAD_KINDS: Record<string, RoadKind> = {
  motorway: 'trunk',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  motorway_link: 'trunk',
  trunk_link: 'trunk',
  primary_link: 'primary',
  secondary_link: 'secondary',
  tertiary_link: 'tertiary',
  unclassified: 'street',
  residential: 'street',
  living_street: 'street',
  road: 'street',
  service: 'service',
  pedestrian: 'pedestrian',
  footway: 'footway',
  path: 'footway',
  bridleway: 'footway',
  cycleway: 'cycleway',
  steps: 'steps',
  track: 'track',
};

/** Carriageway width in metres by kind, when it isn't tagged. */
const ROAD_WIDTH: Record<RoadKind, number> = {
  trunk: 12,
  primary: 10,
  secondary: 9,
  tertiary: 8,
  street: 7,
  service: 4.5,
  pedestrian: 5,
  footway: 2.4,
  cycleway: 2.4,
  steps: 2.4,
  track: 3,
};

export const VEHICLE_ROADS: ReadonlySet<RoadKind> = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'street', 'service', 'track']);

export function roadKind(tags: Tags): RoadKind | null {
  // Being built (or mended: Pero's Bridge): what it'll be.
  const kind = ROAD_KINDS[tags.highway === 'construction' ? tags.construction : tags.highway];
  if (!kind) return null;
  // Underground: not on the map.
  if (tags.tunnel === 'yes' || tags.tunnel === 'culvert') return null;
  if (tags.area === 'yes') return null;
  return kind;
}

export function roadWidth(kind: RoadKind, tags: Tags): number {
  const tagged = metres(tags.width);
  if (tagged && tagged > 1 && tagged < 40 && VEHICLE_ROADS.has(kind)) return tagged;
  const lanes = parseInt(tags.lanes ?? '', 10);
  if (lanes > 0 && VEHICLE_ROADS.has(kind) && kind !== 'service') return Math.max(lanes * 3.3, ROAD_WIDTH[kind] * (lanes === 1 ? 0.6 : 1));
  if (kind === 'service' && (tags.service === 'driveway' || tags.service === 'alley')) return 3.5;
  if (kind === 'service' && tags.service === 'parking_aisle') return 5.5;
  if (tagged && tagged > 0.5 && tagged < 20) return tagged;
  return ROAD_WIDTH[kind];
}

export function areaKind(tags: Tags): AreaKind | null {
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.waterway === 'dock' || tags.landuse === 'basin' || tags.landuse === 'reservoir') {
    return tags.water === 'reflecting_pool' || tags.water === 'pond' || tags.water === 'fountain' ? 'pool' : 'water';
  }
  if (tags.amenity === 'fountain') return 'pool';
  if (tags.leisure === 'swimming_pool') return 'pool';
  // A floating jetty (a pontoon) rides on the water; a pier stands on legs.
  if (tags.man_made === 'pier') return tags.floating === 'yes' ? 'pontoon' : 'pier';
  if (tags['area:highway'] === 'traffic_island' || tags.footway === 'traffic_island') return 'island';
  if (tags.landuse === 'flowerbed') return 'flowerbed';
  if (tags.natural === 'wood' || tags.landuse === 'forest' || tags.natural === 'scrub') return 'wood';
  if (tags.leisure === 'pitch' || tags.leisure === 'sports_centre') return tags.surface && tags.surface !== 'grass' ? 'plaza' : 'pitch';
  if (tags.leisure === 'playground') return 'play';
  if (tags.leisure === 'park' || tags.leisure === 'common') return 'park';
  if (tags.leisure === 'garden') return 'garden';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(tags.landuse) || tags.natural === 'grassland' || tags.amenity === 'grave_yard') return 'grass';
  if (tags.landuse === 'construction' || tags.landuse === 'brownfield') return 'dirt';
  if (tags.amenity === 'fuel' && !tags.building) return 'forecourt';
  if (tags.amenity === 'parking' && !tags.building && tags.parking !== 'underground' && tags.parking !== 'multi-storey') return 'parking';
  if (tags['area:highway'] === 'service') return 'yard';
  if (tags.highway === 'pedestrian' || tags.place === 'square' || tags.amenity === 'marketplace' || tags['area:highway'] || (tags.highway === 'footway' && tags.area === 'yes')) return 'plaza';
  return null;
}

/** Where an area sits in the drawing order (later on top). */
export const AREA_ORDER: Record<AreaKind, number> = {
  wood: 0,
  park: 1,
  grass: 2,
  garden: 3,
  pitch: 4,
  dirt: 4,
  plaza: 5,
  parking: 6,
  play: 7,
  flowerbed: 8,
  water: 9,
  pool: 10,
  pier: 11,
  pontoon: 11,
  slipway: 11,
  forecourt: 6,
  yard: 6,
  island: 12,
};

const LINE_KINDS: Record<string, LineKind> = {
  wall: 'wall',
  retaining_wall: 'wall',
  city_wall: 'wall',
  fence: 'fence',
  guard_rail: 'railing',
  handrail: 'railing',
  hedge: 'hedge',
  kerb: 'kerb',
};

/** Roofs' colours by what they're made of (OSM's `roof:material`), where their colour isn't tagged. */
export const ROOF_MATERIALS: Record<string, string> = {
  metal: '#7b858e',
  zinc: '#a2a9ad',
  copper: '#5f9a84',
  lead: '#7d8388',
  roof_tiles: '#9a5a44',
  tile: '#9a5a44',
  slate: '#4c5159',
  tar_paper: '#323234',
  asphalt: '#3a3a3c',
  glass: '#9cc2d3',
  concrete: '#a6a39b',
  gravel: '#9b968b',
  grass: '#5f8a45',
  thatch: '#a08a55',
  stone: '#8f877a',
};

/** How a chimney and a ship's funnel look: a brick stack, sooty at the top; a funnel, buff with a black top. */
const STRUCTURE_LOOK: Record<string, { wall: string; roof: string }> = {
  chimney: { wall: '#8a4b38', roof: '#2a2522' },
  funnel: { wall: '#d4ac54', roof: '#1e1e20' },
};

/** Trees' species, from OSM's `genus`, `taxon`, `species` or `leaf_type`: which crown each is drawn with. */
export const TREE_SPECIES = ['plane', 'sweetgum', 'lime', 'maple', 'oak', 'hawthorn', 'conifer', 'birch', 'cherry'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export function treeSpecies(t: Tags): TreeSpecies | undefined {
  const name = `${t.genus ?? ''} ${t.taxon ?? ''} ${t.species ?? ''} ${t['taxon:en'] ?? ''} ${t['species:en'] ?? ''}`.toLowerCase();
  if (/platanus|plane/.test(name)) return 'plane';
  if (/liquidambar|sweet ?gum/.test(name)) return 'sweetgum';
  if (/tilia|\blime\b|linden/.test(name)) return 'lime';
  if (/\bacer\b|maple|sycamore/.test(name)) return 'maple';
  if (/quercus|\boak\b/.test(name)) return 'oak';
  if (/crataegus|hawthorn/.test(name)) return 'hawthorn';
  if (/betula|birch/.test(name)) return 'birch';
  if (/prunus|cherry/.test(name)) return 'cherry';
  if (/pinus|picea|abies|taxus|cedrus|larix|pine|spruce|fir|yew|cedar/.test(name) || t.leaf_type === 'needleleaved') return 'conifer';
  return undefined;
}

/** Gates and barriers across roads and paths, as lines across them. */
const GATES: Record<string, LineKind> = {
  gate: 'gate',
  swing_gate: 'gate',
  lift_gate: 'liftgate',
  chain: 'chain',
};

/** Speed humps and the like (OSM's `traffic_calming`), by how they're painted. */
const HUMPS: Record<string, 'table' | 'hump' | 'cushion'> = {
  table: 'table',
  bump: 'hump',
  hump: 'hump',
  cushion: 'cushion',
};

/** A petrol station's pump islands: how far apart along the canopy, how long, how wide, px. */
const ISLAND_EVERY = 6 * PX_PER_METRE;
const ISLAND_LONG = 4 * PX_PER_METRE;
const ISLAND_WIDE = 1.2 * PX_PER_METRE;
/** How far out round its canopy a forecourt's made, where none's mapped, px. */
const FORECOURT_ROUND = 5 * PX_PER_METRE;

/** A bus shelter's length, px; a kiosk's height mapped as a point, m. */
const SHELTER_LONG = 4 * PX_PER_METRE;
const KIOSK_HEIGHT = 2.6;

/** A crane's height, if it's not tagged, m: the harbour's are about this. */
const CRANE_HEIGHT = 15;

/** A kerb that's been dropped to the road's level (`kerb=lowered`, `flush` or `no`): nothing to mount. */
const DROPPED_KERB = new Set(['lowered', 'flush', 'no']);

/** Default heights in metres for each kind of building, when there's nothing better to go on. */
const BUILDING_HEIGHT: Record<string, number> = {
  house: 8,
  terrace: 9,
  detached: 8,
  semidetached_house: 8,
  residential: 13,
  apartments: 16,
  dormitory: 15,
  commercial: 14,
  office: 16,
  retail: 9,
  hotel: 18,
  church: 16,
  chapel: 10,
  cathedral: 22,
  university: 15,
  college: 14,
  school: 12,
  civic: 14,
  government: 18,
  public: 12,
  industrial: 9,
  warehouse: 10,
  garage: 3,
  garages: 3,
  shed: 3,
  kiosk: 3,
  roof: 4,
  ship: 7,
  service: 4,
  hut: 3,
  toilets: 3,
};

const LEVEL = 3.2;
/** A tree's height when nothing says, metres. */
export const TREE_HEIGHT = 9;

export function buildingHeights(tags: Tags, kind: string): { top: number; bottom: number } {
  let top = metres(tags.height);
  const levels = parseFloat(tags['building:levels'] ?? '');
  const roofLevels = parseFloat(tags['roof:levels'] ?? '') || 0;
  const roofHeight = metres(tags['roof:height']);
  if (top === undefined && levels >= 0) top = (levels + roofLevels * 0.6) * LEVEL + (roofHeight ?? (levels > 0 ? 1 : 0));
  if (top === undefined || !(top > 0)) top = BUILDING_HEIGHT[kind] ?? 11;
  let bottom = metres(tags.min_height);
  const minLevel = parseFloat(tags['building:min_level'] ?? '');
  if (bottom === undefined && minLevel > 0) bottom = minLevel * LEVEL;
  bottom = Math.max(0, Math.min(bottom ?? 0, top - 1));
  return { top: Math.min(top, 150), bottom };
}

/**
 * Which sides of a road there's a pavement drawn with it, from OSM's
 * `sidewalk`, `sidewalk:both`, `sidewalk:left` and `sidewalk:right` (left and
 * right as the way runs): both, unless they say otherwise. One mapped as a
 * footpath of its own (`separate`) isn't drawn with the road: it's drawn as
 * that footpath.
 */
export function pavementSides(t: Tags): [boolean, boolean] {
  const has = (v: string | undefined, otherwise: boolean) => (v === undefined ? otherwise : v === 'yes' || v === 'both' || v === 'left' || v === 'right');
  let left = true;
  let right = true;
  const s = t.sidewalk;
  if (s === 'left' || s === 'right') [left, right] = [s === 'left', s === 'right'];
  else if (s !== undefined) left = right = has(s, true);
  if (t['sidewalk:both'] !== undefined) left = right = has(t['sidewalk:both'], true);
  left = has(t['sidewalk:left'], left);
  right = has(t['sidewalk:right'], right);
  return [left, right];
}

/** How far out from a road's edge, px, a footpath of its own counts as its pavement; and how much of the road it has to run along. */
const SIDEWALK_NEAR = 4 * PX_PER_METRE;
const SIDEWALK_ALONG = 0.5;

/**
 * Whether a footpath mapped on its own (`footway=sidewalk`) runs along one
 * side of a road (left: +1, right: -1, as the road runs), for at least half
 * its length: then that's the pavement, not one drawn with the road.
 */
export function sidewalkAlong(road: Pts, width: number, side: 1 | -1, sidewalks: Pts[]): boolean {
  const step = 8 * PX_PER_METRE;
  let samples = 0;
  let along = 0;
  for (let i = 0; i + 3 < road.length; i += 2) {
    const [ax, ay, bx, by] = [road[i], road[i + 1], road[i + 2], road[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    // Left of the way as it runs, with y down: (uy, -ux).
    const [nx, ny] = [uy * side, -ux * side];
    for (let d = Math.min(step / 2, len / 2); d < len; d += step) {
      samples++;
      const px = ax + ux * d + nx * (width / 2 + 1.2 * PX_PER_METRE);
      const py = ay + uy * d + ny * (width / 2 + 1.2 * PX_PER_METRE);
      if (sidewalks.some((w) => nearParallel(w, px, py, ux, uy))) along++;
    }
  }
  return samples > 0 && along / samples >= SIDEWALK_ALONG;
}

function nearParallel(w: Pts, x: number, y: number, ux: number, uy: number): boolean {
  for (let i = 0; i + 3 < w.length; i += 2) {
    const [ax, ay, bx, by] = [w[i], w[i + 1], w[i + 2], w[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
    if (Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y) > SIDEWALK_NEAR) continue;
    if (Math.abs(((bx - ax) * ux + (by - ay) * uy) / len) > 0.7) return true;
  }
  return false;
}

/** Props from tagged nodes (those indoors, up on a roof or gone left out). */
export function propKind(tags: Tags): PropKind | null {
  if (tags.indoor === 'yes' || tags.disused === 'yes' || tags.location === 'indoor' || tags.location === 'roof') return null;
  if (tags.amenity === 'vending_machine' && tags.vending === 'parking_tickets') return 'meter';
  if (tags.amenity === 'clock' && tags.display !== 'sundial' && tags.support !== 'wall_mounted') return 'clock';
  if (tags.emergency === 'life_ring') return 'lifering';
  if ((tags.tourism === 'artwork' && (tags.artwork_type === 'statue' || tags.artwork_type === 'sculpture')) || tags.historic === 'monument' || tags.memorial === 'statue' || tags.memorial === 'sculpture') return 'statue';
  if (tags.barrier === 'block') return 'block';
  if (tags.barrier === 'planter' || tags.man_made === 'planter') return 'planter';
  if (tags.amenity === 'grit_bin') return 'gritbin';
  if (tags.leisure === 'picnic_table') return 'picnic';
  if (tags.man_made === 'crane') return 'crane';
  if (tags.man_made === 'ladder') return 'ladder';
  if (tags.highway === 'street_lamp') return 'lamp';
  if (tags.barrier === 'bollard') return 'bollard';
  if (tags.amenity === 'bench') return 'bench';
  if (tags.amenity === 'waste_basket' || tags.amenity === 'recycling') return 'bin';
  if (tags.amenity === 'post_box') return 'postbox';
  if (tags.amenity === 'telephone') return 'phone';
  if (tags.highway === 'traffic_signals') return 'signals';
  if (tags.highway === 'bus_stop') return 'busstop';
  if (tags.amenity === 'fountain') return 'fountain';
  if (tags.amenity === 'bicycle_parking') return 'bikes';
  return null;
}

// --- Building the map ---

export interface BuildOptions {
  /** The area to keep (the data can reach beyond it, for the roads and areas that cross its edge). */
  bounds: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  /** Where the car starts: it's put on the nearest road. */
  start: { lat: number; lon: number };
}

const round = (v: number) => Math.round(v);
const roundPts = (pts: Pts) => pts.map(round);

/**
 * Each gateway's building (see GATEWAYS in landmarks.ts) made an archway over
 * the road that runs through it (the widest, if more than one does): squared
 * up to the road, a pier either side of it (solid, standing on the ground),
 * and a span over the road between them, lower than they are (up off the
 * ground: you drive under it), centred on the road where it runs through the
 * building.
 */
export function gateways(buildings: Building[], roads: Road[]): void {
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    const g = b.id === undefined ? undefined : GATEWAYS[b.id];
    if (!g) continue;
    const ring = b.rings[0];
    let [cx, cy] = [0, 0];
    for (let k = 0; k < ring.length; k += 2) [cx, cy] = [cx + ring[k], cy + ring[k + 1]];
    [cx, cy] = [cx / (ring.length / 2), cy / (ring.length / 2)];
    // The road through it: the nearest stretch of the widest of those with a point in it, or crossing it.
    let best: { road: Road; x: number; y: number; ux: number; uy: number; d: number } | null = null;
    for (const r of roads) {
      if (!VEHICLE_ROADS.has(r.kind)) continue;
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const [ax, ay, bx, by] = [r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        if (!len) continue;
        const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / (len * len)));
        const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
        const d = Math.hypot(px - cx, py - cy);
        if (d > 6 * PX_PER_METRE || (best && (r.width < best.road.width || (r.width === best.road.width && d >= best.d)))) continue;
        best = { road: r, x: px, y: py, ux: (bx - ax) / len, uy: (by - ay) / len, d };
      }
    }
    if (!best) continue;
    const { x, y, ux, uy } = best;
    const [nx, ny] = [-uy, ux];
    // As deep along the road as the building is (or `deep`).
    let [lo, hi] = [Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) {
      const along = (ring[k] - x) * ux + (ring[k + 1] - y) * uy;
      [lo, hi] = [Math.min(lo, along), Math.max(hi, along)];
    }
    const half = Math.max(hi - lo, g.deep * PX_PER_METRE) / 2;
    const mid = (lo + hi) / 2;
    const open = best.road.width / 2 + 0.5 * PX_PER_METRE;
    const out = open + g.pier * PX_PER_METRE;
    /** A box along the road from `a` to `b` across it (+ to its left). */
    const box = (a: number, c: number): Pts =>
      [
        [mid - half, a],
        [mid + half, a],
        [mid + half, c],
        [mid - half, c],
      ].flatMap(([s, t]) => [round(x + ux * s + nx * t), round(y + uy * s + ny * t)]);
    const piece = (rings: Pts[], bottom: number, top: number, solid: boolean): Building => {
      const { roofShape: _r, roofAcross: _a, ...rest } = b;
      return { ...rest, rings, top: round(top * PX_PER_METRE), bottom: round(bottom * PX_PER_METRE), roofShape: 'flat', solid, drawn: true, heightFrom: 'tag' };
    };
    // (The span between the piers only, not over them.)
    buildings.splice(i, 1, piece([box(open, out)], 0, g.height, true), piece([box(-out, -open)], 0, g.height, true), piece([box(-open, open)], g.opening, g.span, false));
  }
}

export function buildMap(source: OsmData, { bounds, start }: BuildOptions): GameMap {
  // What's different on the ground from what OSM has (see landmarks.ts): its tags put over the element's own.
  const data: OsmData = { ...source, ways: new Map(source.ways) };
  for (const [ref, c] of Object.entries(CORRECTIONS)) {
    const [type, id] = ref.split('/');
    const way = type === 'way' ? data.ways.get(Number(id)) : undefined;
    if (way) data.ways.set(way.id, { ...way, tags: { ...way.tags, ...c.tags } });
  }
  const proj = new Projection(bounds.maxlat, bounds.minlon);
  const width = round(proj.x(bounds.maxlon));
  const height = round(proj.y(bounds.minlat));
  // Things crossing the edge are kept a little past it, so nothing's seen to stop short.
  const pad = 30 * PX_PER_METRE;
  const [cx0, cy0, cx1, cy1] = [-pad, -pad, width + pad, height + pad];
  const inside = (x: number, y: number, margin = 0) => x >= -margin && y >= -margin && x <= width + margin && y <= height + margin;

  const xy = (id: number): [number, number] | null => {
    const n = data.nodes.get(id);
    return n ? [proj.x(n.lon), proj.y(n.lat)] : null;
  };
  const pointsOf = (ids: number[]): Pts | null => {
    const pts: Pts = [];
    for (const id of ids) {
      const p = xy(id);
      if (!p) return null;
      pts.push(p[0], p[1]);
    }
    return pts;
  };
  /** A closed way's ring (without the repeated last point). */
  const ringOf = (ids: number[]) => (ids.length >= 4 && ids[0] === ids[ids.length - 1] ? pointsOf(ids.slice(0, -1)) : null);

  const areas: Area[] = [];
  const roads: Road[] = [];
  const lines: Line[] = [];
  const buildings: Building[] = [];
  const trees: number[] = [];
  const props: Prop[] = [];
  const crossings: Crossing[] = [];
  const paint: PaintMark[] = [];

  const addArea = (kind: AreaKind, rings: Pts[], tags: Tags) => {
    const clipped = rings.map((r) => clipRing(r, cx0, cy0, cx1, cy1)).filter((r) => r.length >= 6);
    if (clipped.length === 0 || Math.abs(ringArea(clipped[0])) < 4) return;
    const surface = kind === 'plaza' || kind === 'parking' ? paving(tags.surface) : undefined;
    areas.push({ kind, rings: clipped.map(roundPts), ...(surface ? { surface } : {}) });
  };

  /** Buildings tagged as a petrol station (its canopy, or its shop). */
  const fuelBuildings = new Set<Building>();
  const addBuilding = (type: 'way' | 'relation', id: number, tags: Tags, rings: Pts[], part: boolean) => {
    if (rings.length === 0 || !rings[0].some((v, i) => i % 2 === 0 && inside(v, rings[0][i + 1], 20 * PX_PER_METRE))) return;
    const kind = part ? (tags['building:part'] === 'yes' ? (tags.building ?? 'yes') : tags['building:part']) : tags.building;
    const h = buildingHeights(tags, kind);
    const landmark = LANDMARKS[`${type}/${id}`];
    if (landmark?.height) h.top = landmark.height;
    const tagged = metres(tags.height) !== undefined || landmark?.height !== undefined;
    const street = STREETS[tags['addr:street']];
    const pick = (list: string[]) => list[id % list.length];
    buildings.push({
      id,
      name: tags.name,
      rings: rings.map(roundPts),
      top: round(h.top * PX_PER_METRE),
      bottom: round(h.bottom * PX_PER_METRE),
      kind,
      wall: landmark?.wall ?? tags['building:colour'] ?? materialColour(tags['building:material']) ?? STRUCTURE_LOOK[tags.man_made]?.wall ?? (street && pick(street.walls)),
      roof: landmark?.roof ?? tags['roof:colour'] ?? ROOF_MATERIALS[tags['roof:material']] ?? STRUCTURE_LOOK[tags.man_made]?.roof ?? (street && pick(street.roofs)),
      ...(tags['roof:material'] ? { roofMaterial: tags['roof:material'] } : {}),
      roofShape: landmark?.roofShape ?? tags['roof:shape'],
      ...(landmark ? { landmark: `${type}/${id}` } : {}),
      ...(tags['roof:orientation'] === 'across' ? { roofAcross: true } : {}),
      solid: !part && kind !== 'roof' && h.bottom < 2,
      drawn: true,
      ...(tagged ? { heightFrom: 'tag' as const } : {}),
    });
    if (tags.amenity === 'fuel') fuelBuildings.add(buildings[buildings.length - 1]);
  };

  /** Ways that are members of multipolygons: their own tags (if any) are ignored when the relation's tags say what they are. */
  const multipolygonMembers = new Set<number>();

  for (const rel of data.relations.values()) {
    const t = rel.tags;
    if (t.type !== 'multipolygon') continue;
    const outerIds = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.ref);
    const innerIds = rel.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => m.ref);
    const ways = (ids: number[]) => ids.map((id) => data.ways.get(id)?.nodes).filter((w): w is number[] => !!w);
    const toPts = (rings: number[][]) => rings.map((r) => pointsOf(r.slice(0, -1))).filter((p): p is Pts => !!p && p.length >= 6);
    const outers = toPts(joinRings(ways(outerIds)));
    const inners = toPts(joinRings(ways(innerIds)));
    if (outers.length === 0) continue;
    const isBuilding = !!t.building && t.building !== 'no';
    const kind = isBuilding ? null : areaKind(t);
    if (!isBuilding && !kind) continue;
    for (const id of outerIds) multipolygonMembers.add(id);
    for (const outer of outers) {
      const holes = inners.filter((h) => pointInRing(h[0], h[1], outer));
      if (isBuilding) addBuilding('relation', rel.id, t, [outer, ...holes], false);
      else addArea(kind!, [outer, ...holes], t);
    }
  }

  const roadNodes = new Map<number, number>();
  /** Slipways mapped as ways (their outline, or a line down them), and quays where boats moor. */
  const slipwayWays: { pts: Pts; closed: boolean }[] = [];
  const mooringQuays: Pts[] = [];
  /** The edges boats moor along: those quays, and the pontoons. */
  const mooringEdges: MooringEdge[] = [];
  /** How many ways out of each node along the roads: three or more is a junction (two's just where a street's mapped in pieces). */
  const branches = new Map<number, number>();
  /** Each road's way's nodes, by its index in `roads`. */
  const nodesOfRoad: number[][] = [];
  const roadWays: { way: OsmWay; kind: RoadKind }[] = [];

  for (const way of data.ways.values()) {
    const t = way.tags;
    const closed = way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];
    const ownTags = !multipolygonMembers.has(way.id) || Object.keys(t).some((k) => k !== 'source' && k !== 'note');

    if (closed && ((t.building && t.building !== 'no') || t['building:part'])) {
      const ring = ringOf(way.nodes);
      if (ring) addBuilding('way', way.id, t, [ring], !t.building || t.building === 'no' || !!t['building:part']);
      continue;
    }

    const road = roadKind(t);
    if (road) {
      roadWays.push({ way, kind: road });
      if (VEHICLE_ROADS.has(road)) {
        for (const id of way.nodes) roadNodes.set(id, (roadNodes.get(id) ?? 0) + 1);
        // Each way through a node is two ways out of it; one ending there, one.
        way.nodes.forEach((id, k) => branches.set(id, (branches.get(id) ?? 0) + (k === 0 || k === way.nodes.length - 1 ? 1 : 2)));
      }
      continue;
    }

    if (t.leisure === 'slipway') {
      const pts = pointsOf(way.nodes);
      if (pts) slipwayWays.push({ pts, closed });
      continue;
    }
    // Where boats moor along a quay: mooring bollards along its edge, by the water.
    if (t.man_made === 'quay' && t.mooring && t.mooring !== 'no') {
      const pts = pointsOf(way.nodes);
      if (pts) mooringQuays.push(pts);
      if (pts) mooringEdges.push({ pts, closed, mooring: t.mooring, operator: t.operator });
    }
    const area = ownTags ? areaKind(t) : null;
    if (area === 'pontoon' && closed && t.mooring !== 'no') {
      const pts = pointsOf(way.nodes);
      if (pts) mooringEdges.push({ pts, closed, mooring: t.mooring ?? 'yes', operator: t.operator });
    }
    if (area && closed) {
      const ring = ringOf(way.nodes);
      if (ring) addArea(area, [ring], t);
      continue;
    }
    if (area === 'pier' && !closed) {
      // A jetty mapped as a line: a deck along it.
      const pts = pointsOf(way.nodes);
      if (pts) for (const piece of clipLine(pts, cx0, cy0, cx1, cy1)) roads.push({ kind: 'footway', width: round((metres(t.width) ?? 3) * PX_PER_METRE), pts: roundPts(piece), bridge: true, name: t.name, surface: paving(t.surface) ?? 'wood' });
      continue;
    }

    const lineKind = t.barrier === 'kerb' && DROPPED_KERB.has(t.kerb) ? undefined : t.barrier ? LINE_KINDS[t.barrier] : t.railway === 'rail' || t.railway === 'tram' ? 'rail' : t.man_made === 'quay' && !closed ? 'quay' : undefined;
    if (lineKind) {
      const pts = pointsOf(way.nodes);
      const tagged = metres(t.height);
      if (pts) {
        for (const piece of clipLine(pts, cx0, cy0, cx1, cy1)) {
          lines.push({
            kind: lineKind,
            pts: roundPts(piece),
            ...(tagged && tagged > 0.2 && tagged < 8 ? { height: round(tagged * PX_PER_METRE) } : {}),
            ...(t.barrier === 'retaining_wall' ? { retaining: true } : {}),
          });
        }
      }
      continue;
    }

    if (t.natural === 'tree_row') {
      const pts = pointsOf(way.nodes);
      if (pts) for (const [x, y] of along(pts, 7 * PX_PER_METRE)) if (inside(x, y)) trees.push(round(x), round(y), 3.5 * PX_PER_METRE, TREE_HEIGHT * PX_PER_METRE);
    }
  }

  // Outlines with parts on them: the parts are drawn instead.
  const parts = buildings.filter((b) => !b.solid && b.kind !== 'roof');
  for (const b of buildings.filter((o) => o.solid)) {
    const outline = b.rings[0];
    const covered = parts.filter((p) => {
      const c = centroid(p.rings[0]);
      return pointInRing(c.x, c.y, outline);
    });
    const coveredArea = covered.reduce((sum, p) => sum + (p.bottom === 0 ? Math.abs(ringArea(p.rings[0])) : 0), 0);
    if (covered.length > 0 && coveredArea > Math.abs(ringArea(outline)) * 0.5) {
      // What you see is what you hit: the parts standing on the ground, not the outline round them.
      b.drawn = false;
      b.solid = false;
      for (const p of covered) if (p.bottom < 2 * PX_PER_METRE) p.solid = true;
      // A landmark's colours go on its parts.
      const look = b.landmark ? LANDMARKS[b.landmark] : undefined;
      if (look) for (const p of covered) Object.assign(p, { wall: look.wall ?? p.wall, roof: look.roof ?? p.roof });
    }
  }

  /** Each road's index in `roads`, by its OSM way. */
  const roadIndexOfWay = new Map<number, number>();
  // The pavements mapped as footpaths of their own.
  const sidewalks: Pts[] = [];
  for (const { way } of roadWays) {
    if (way.tags.footway !== 'sidewalk') continue;
    const pts = pointsOf(way.nodes);
    if (pts) sidewalks.push(pts);
  }
  // Roads, with their junctions found so the lane markings stop short of them.
  for (const { way, kind } of roadWays) {
    const t = way.tags;
    const pts = pointsOf(way.nodes);
    if (!pts) continue;
    const width = roadWidth(kind, t) * PX_PER_METRE;
    const vehicle = VEHICLE_ROADS.has(kind);
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
    const bridge = t.bridge !== undefined && t.bridge !== 'no';
    const arcade = t.covered === 'arcade' || t.covered === 'colonnade';
    const passage = t.tunnel === 'building_passage' || arcade;
    const surface = paving(t.surface);
    let marks: number[] | undefined;
    if (vehicle && kind !== 'service' && kind !== 'track' && width >= 6 * PX_PER_METRE) {
      // Junction points along the road: anywhere another road joins it.
      const stops: number[] = [];
      let dist = 0;
      for (let i = 0; i < way.nodes.length; i++) {
        if (i > 0) dist += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
        if ((roadNodes.get(way.nodes[i]) ?? 0) > 1) stops.push(dist);
      }
      const clear = 9 * PX_PER_METRE;
      marks = [];
      let from = 0;
      for (const s of [...stops, dist + clear]) {
        const a = from;
        const b = s - clear;
        if (b - a > 4 * PX_PER_METRE) marks.push(round(a), round(b));
        from = Math.max(from, s + clear);
      }
      if (marks.length === 0) marks = undefined;
    }
    let pavement: Road['pavement'];
    if (vehicle && kind !== 'service' && kind !== 'track') {
      let [left, right] = pavementSides(t);
      // Where the pavement's mapped as a footpath of its own, it's that, not one drawn with the road too.
      if (left && sidewalkAlong(pts, width, 1, sidewalks)) left = false;
      if (right && sidewalkAlong(pts, width, -1, sidewalks)) right = false;
      pavement = left && right ? 'both' : left ? 'left' : right ? 'right' : undefined;
    }
    // Clipping the line loses the distances the markings are measured along, so only roads wholly beyond the edge are dropped.
    if (!pts.some((v, i) => i % 2 === 0 && inside(v, pts[i + 1], pad))) continue;
    const lanes = vehicle ? roadLanes(t, oneway, width) : undefined;
    const across = vehicle ? lanesAcross(t, oneway) : undefined;
    let laneSpans: number[] | undefined;
    if (lanes) {
      // Clear of junctions along it (and at its ends), and of sharp bends.
      const cuts: [number, number][] = [];
      let run = 0;
      for (let k = 0; k < way.nodes.length; k++) {
        if (k) run += Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
        if ((branches.get(way.nodes[k]) ?? 0) >= 3) cuts.push([run - LANE_CLEAR_JUNCTION, run + LANE_CLEAR_JUNCTION]);
        else if (k > 0 && k < way.nodes.length - 1) {
          const [ax, ay, bx, by, cx, cy] = pts.slice(k * 2 - 2, k * 2 + 4);
          const turn = Math.abs(Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by)));
          if (turn > SHARP_BEND) cuts.push([run - LANE_CLEAR_BEND, run + LANE_CLEAR_BEND]);
        }
      }
      laneSpans = cutSpans([0, run], cuts);
    }
    if (vehicle) paint.push(...laneArrows(t, oneway, width, pts));
    roadIndexOfWay.set(way.id, roads.length);
    nodesOfRoad.push(way.nodes);
    roads.push({
      kind,
      ...(t.name ? { name: t.name } : {}),
      width: round(width),
      pts: roundPts(pts),
      ...(oneway ? { oneway } : {}),
      ...(bridge ? { bridge } : {}),
      ...(passage ? { passage } : {}),
      ...(arcade ? { arcade } : {}),
      ...(t.service === 'parking_aisle' ? { aisle: true } : {}),
      ...(pavement ? { pavement } : {}),
      ...(marks ? { marks } : {}),
      ...(surface ? { surface } : {}),
      ...(across ? { lanesAcross: across } : {}),
      ...(lanes && laneSpans?.length ? { lanes, laneSpans } : {}),
      ...(kind === 'steps' && stepCount(t) ? { steps: stepCount(t) } : {}),
      ...(vehicle && busOnly(t) ? { bus: true } : {}),
    });
  }
  // A lane that carries on from the same lane on the road before it: its name's painted only where it starts.
  // (On the left, its traffic comes in at the way's first node; on the right, at its last.)
  const laneEnds = new Map<string, number>();
  roads.forEach((r, i) => {
    const nodes = nodesOfRoad[i];
    for (const l of r.lanes ?? []) laneEnds.set(`${l.kind}:${l.side === 1 ? nodes[nodes.length - 1] : nodes[0]}`, i);
  });
  roads.forEach((r, i) => {
    const nodes = nodesOfRoad[i];
    for (const l of r.lanes ?? []) {
      const before = laneEnds.get(`${l.kind}:${l.side === 1 ? nodes[0] : nodes[nodes.length - 1]}`);
      if (before !== undefined && before !== i) l.continues = true;
    }
  });

  // Nodes: trees, street furniture, crossings and traffic lights.
  const roadsOfNode = new Map<number, { way: OsmWay; index: number; kind: RoadKind }[]>();
  for (const { way, kind } of roadWays) {
    if (!VEHICLE_ROADS.has(kind)) continue;
    way.nodes.forEach((id, index) => {
      const list = roadsOfNode.get(id);
      if (list) list.push({ way, index, kind });
      else roadsOfNode.set(id, [{ way, index, kind }]);
    });
  }
  const roadOfNode = new Map([...roadsOfNode].map(([id, list]) => [id, list[0]]));
  const lightPoints: LightPoint[] = [];
  /** The ways into a point on the roads, as the traffic heads (allowing for one-way streets and which way the lights face). */
  const armsOf = (node: OsmNode, facing: string | undefined): Arm[] => {
    const arms: Arm[] = [];
    const p = xy(node.id)!;
    for (const { way, index, kind } of roadsOfNode.get(node.id) ?? []) {
      const t = way.tags;
      const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
      const width = roadWidth(kind, t) * PX_PER_METRE;
      const arm = (from: number, forwards: boolean) => {
        const q = xy(way.nodes[from]);
        if (!q) return;
        const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (len < 1) return;
        if (facing === 'forward' && !forwards) return;
        if (facing === 'backward' && forwards) return;
        arms.push({ dx: (p[0] - q[0]) / len, dy: (p[1] - q[1]) / len, width, oneway, road: way.id });
      };
      if (index > 0 && t.oneway !== '-1') arm(index - 1, true);
      if (index < way.nodes.length - 1 && !oneway) arm(index + 1, false);
    }
    return arms;
  };
  const dropped: number[] = [];
  /** Petrol stations mapped as points. */
  const fuelPoints: [number, number][] = [];
  const treeKinds: number[] = [];
  const solar: number[] = [];
  /** The nearest road for cars within 20 m: which way it runs there (ux, uy), and which way's away from it (nx, ny). */
  const nearestRoadDirection = (x: number, y: number): [number, number, number, number] | null => {
    let best = 20 * PX_PER_METRE;
    let out: [number, number, number, number] | null = null;
    for (const r of roads) {
      if (!VEHICLE_ROADS.has(r.kind)) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
        const d = Math.hypot(px - x, py - y);
        if (d < best) {
          best = d;
          const len = Math.sqrt(len2);
          const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
          // Away from the road: the side the point's on.
          const side = (x - px) * -uy + (y - py) * ux >= 0 ? 1 : -1;
          out = [ux, uy, -uy * side, ux * side];
        }
      }
    }
    return out;
  };
  /** Which way's the nearest water (the harbour, a river) from a point, within 40 m, radians; or the biggest water within 60 m. */
  const towardWater = (x: number, y: number, biggest = false): number | null => waterFrom(x, y, biggest)?.angle ?? null;
  /** The nearest water's edge from a point (or the biggest water's): which way, and how far, px. */
  const waterFrom = (x: number, y: number, biggest = false, reach = biggest ? 60 : 40): { angle: number; distance: number } | null => {
    let best = reach * PX_PER_METRE;
    let angle: number | null = null;
    const waters = areas.filter((a) => a.kind === 'water');
    if (biggest) waters.sort((p, q) => Math.abs(ringArea(q.rings[0])) - Math.abs(ringArea(p.rings[0])));
    for (const a of waters) {
      if (biggest && angle !== null) break;
      for (const ring of a.rings) {
        for (let i = 0; i < ring.length; i += 2) {
          const j = (i + 2) % ring.length;
          const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
          const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
          const d = Math.hypot(px - x, py - y);
          if (d < best) {
            best = d;
            // Out across the water's edge: square to it, the side the water's on.
            const len = Math.sqrt(len2) || 1;
            let [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
            if (!pointInRing(px + nx * 2 * PX_PER_METRE, py + ny * 2 * PX_PER_METRE, ring)) [nx, ny] = [-nx, -ny];
            angle = Math.atan2(ny, nx);
          }
        }
      }
    }
    return angle === null ? null : { angle, distance: best };
  };
  // Slipways: a ramp 4 m wide from 5 m up the bank to 7 m out into the water, the way down to it;
  // mapped as an outline, that; as a line, 4 m wide along it.
  const SLIP_WIDTH = 4 * PX_PER_METRE;
  const addSlipway = (x: number, y: number, angle: number, back: number, out: number) => {
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    const [nx, ny] = [-uy * SLIP_WIDTH / 2, ux * SLIP_WIDTH / 2];
    const [ax, ay, bx, by] = [x - ux * back, y - uy * back, x + ux * out, y + uy * out];
    areas.push({ kind: 'slipway', rings: [roundPts([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny])], angle: +angle.toFixed(3) });
  };
  for (const w of slipwayWays) {
    const p = w.pts;
    const [mx, my] = [p.reduce((a, v, i) => (i % 2 ? a : a + v), 0) / (p.length / 2), p.reduce((a, v, i) => (i % 2 ? a + v : a), 0) / (p.length / 2)];
    const water = waterFrom(mx, my);
    if (w.closed && water) {
      areas.push({ kind: 'slipway', rings: [roundPts(p.slice(0, -2))], angle: +water.angle.toFixed(3) });
    } else if (p.length >= 4) {
      // Down the line, towards the water.
      const n = p.length;
      const first = waterFrom(p[0], p[1])?.distance ?? Infinity;
      const last = waterFrom(p[n - 2], p[n - 1])?.distance ?? Infinity;
      const [ax, ay, bx, by] = first > last ? [p[0], p[1], p[n - 2], p[n - 1]] : [p[n - 2], p[n - 1], p[0], p[1]];
      const len = Math.hypot(bx - ax, by - ay);
      addSlipway(ax, ay, Math.atan2(by - ay, bx - ax), 0, len + 4 * PX_PER_METRE);
    }
  }
  // Mooring bollards along the quays boats moor at: every 10 m along the edge, 0.8 m in from the water.
  const mooringAt: [number, number][] = [];
  for (const q of mooringQuays) {
    for (const [x, y] of along(q, 10 * PX_PER_METRE)) {
      const water = waterFrom(x, y, false, 5);
      if (!water || !inside(x, y)) continue;
      const d = water.distance - 0.8 * PX_PER_METRE;
      const [bx, by] = [x + Math.cos(water.angle) * d, y + Math.sin(water.angle) * d];
      if (mooringAt.some(([px, py]) => Math.hypot(px - bx, py - by) < 6 * PX_PER_METRE)) continue;
      mooringAt.push([bx, by]);
      props.push({ kind: 'mooring', x: round(bx), y: round(by) });
    }
  }
  // The ferries' stops (alongside, where a ferry fits), and their routes; then the berths, clear of the stops.
  const water = new Water(areas, buildings.filter((b) => b.kind === 'ship' || b.kind === 'boat'));
  const ferries: FerryRoute[] = [];
  const stopAt = new Map<number, [number, number, number] | null>();
  const stopOf = (id: number) => {
    if (!stopAt.has(id)) {
      const n = data.nodes.get(id);
      const live = n && n.tags.amenity === 'ferry_terminal';
      const [x, y] = n ? [proj.x(n.lon), proj.y(n.lat)] : [0, 0];
      stopAt.set(id, live && inside(x, y) ? ferryStop(x, y, water, PX_PER_METRE, [...stopAt.values()].filter((s) => !!s).map(([sx, sy, a]) => ({ x: sx, y: sy, angle: a, kind: 'ferry' as const }))) : null);
    }
    return stopAt.get(id) ?? null;
  };
  const addFerry = (name: string, ids: number[]) => {
    const stops = ids.map(stopOf).filter((s) => !!s);
    const unique = stops.filter((s, i) => stops.findIndex((o) => o[0] === s[0] && o[1] === s[1]) === i);
    if (unique.length < 2) return;
    const key = unique.map((s) => `${s[0]},${s[1]}`).sort().join(' ');
    if (ferries.some((f) => f.stops.reduce<string[]>((k, v, i) => (i % 3 ? k : [...k, `${v},${f.stops[i + 1]}`]), []).sort().join(' ') === key)) return;
    ferries.push({ name, stops: unique.flat() });
  };
  const terminals = [...data.nodes.values()].filter((n) => n.tags.amenity === 'ferry_terminal');
  const inRoutes = new Set<number>();
  for (const rel of data.relations.values()) {
    if (rel.tags.route !== 'ferry' || rel.tags.disused) continue;
    const ids = rel.members.filter((m) => m.type === 'node' && (m.role === 'stop' || m.role.startsWith('stop_') || data.nodes.get(m.ref)?.tags.amenity === 'ferry_terminal')).map((m) => m.ref);
    for (const m of rel.members) if (m.type === 'way') inRoutes.add(m.ref);
    addFerry(rel.tags.name ?? rel.tags.ref ?? 'Ferry', ids);
  }
  // Ferry crossings mapped only as a way: from the stop at one end to the stop at the other.
  for (const way of data.ways.values()) {
    if (way.tags.route !== 'ferry' || inRoutes.has(way.id) || way.nodes.length < 2) continue;
    const ends = [way.nodes[0], way.nodes[way.nodes.length - 1]].map((id) => {
      const e = data.nodes.get(id);
      if (!e) return null;
      let best: number | null = null;
      let bestD = 30 * PX_PER_METRE;
      for (const n of terminals) {
        const d = Math.hypot(proj.x(n.lon) - proj.x(e.lon), proj.y(n.lat) - proj.y(e.lat));
        if (d < bestD) [best, bestD] = [n.id, d];
      }
      return best;
    });
    if (ends[0] !== null && ends[1] !== null) addFerry(way.tags.name ?? 'Ferry', ends as number[]);
  }
  const stopBerths: Berth[] = ferries.flatMap((f) => f.stops.reduce<Berth[]>((out, v, i) => (i % 3 ? out : [...out, { x: v, y: f.stops[i + 1], angle: f.stops[i + 2], kind: 'ferry' }]), []));
  const berths = findBerths(mooringEdges, water, PX_PER_METRE).filter((b) => inside(b.x, b.y) && !stopBerths.some((s) => overlap(s, b, PX_PER_METRE, 2 * PX_PER_METRE)));
  // Where the bus stops' signs and platforms are, beside the road.
  const stopsBeside: [number, number][] = [];
  // And where there's tactile paving (at crossings, and the dropped kerbs either side of them).
  const tactile: [number, number][] = [];
  for (const n of data.nodes.values()) {
    if (n.tags.highway === 'bus_stop' || n.tags.public_transport === 'platform') stopsBeside.push([proj.x(n.lon), proj.y(n.lat)]);
    if (n.tags.tactile_paving === 'yes' || n.tags.tactile_paving === 'partial') tactile.push([proj.x(n.lon), proj.y(n.lat)]);
  }
  // Which nodes are on buildings' outlines, and each road's ways through each node, for gates.
  const onBuilding = new Set<number>();
  for (const way of data.ways.values()) if ((way.tags.building && way.tags.building !== 'no') || way.tags['building:part']) for (const id of way.nodes) onBuilding.add(id);
  const waysOfNode = new Map<number, { way: OsmWay; index: number; kind: RoadKind }[]>();
  for (const { way, kind } of roadWays) {
    way.nodes.forEach((id, index) => {
      const list = waysOfNode.get(id);
      if (list) list.push({ way, index, kind });
      else waysOfNode.set(id, [{ way, index, kind }]);
    });
  }
  /** A road through a node, and which way along it: the way it says, or else towards the nearer junction. */
  const approach = (id: number, direction?: string) => {
    const on = waysOfNode.get(id)?.find((w) => VEHICLE_ROADS.has(w.kind)) ?? waysOfNode.get(id)?.[0];
    if (!on) return null;
    const nodes = on.way.nodes;
    const a = xy(nodes[Math.max(0, on.index - 1)]);
    const b = xy(nodes[Math.min(nodes.length - 1, on.index + 1)]);
    if (!a || !b) return null;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) return null;
    let way: 1 | -1 = 1;
    if (direction === 'backward') way = -1;
    else if (direction !== 'forward') {
      // Nearest junction: count nodes each way.
      const junction = (id: number) => (roadNodes.get(id) ?? 0) > 1;
      let ahead = Infinity;
      let behind = Infinity;
      for (let k = on.index + 1; k < nodes.length; k++) if (junction(nodes[k])) { ahead = k - on.index; break; }
      for (let k = on.index - 1; k >= 0; k--) if (junction(nodes[k])) { behind = on.index - k; break; }
      if (behind < ahead) way = -1;
    }
    const oneway = on.way.tags.oneway === 'yes' || on.way.tags.oneway === '1' || on.way.tags.junction === 'roundabout';
    const [ux, uy] = [((b[0] - a[0]) / len) * way, ((b[1] - a[1]) / len) * way];
    return { ux, uy, oneway, width: roadWidth(on.kind, on.way.tags) * PX_PER_METRE, on };
  };
  /** Where a line across the lanes coming into a junction goes: across the left half (all of it, one-way), at the node. */
  const acrossLanes = (id: number, x: number, y: number, direction?: string) => {
    const a = approach(id, direction);
    if (!a) return null;
    const across = a.oneway ? a.width : a.width / 2;
    // The traffic's left (y down): its half of the road.
    const off = a.oneway ? 0 : a.width / 4;
    return { x: round(x + a.uy * off), y: round(y - a.ux * off), angle: +Math.atan2(a.uy, a.ux).toFixed(3), width: round(across) };
  };
  /**
   * The triangles before give way lines: 9 m back along the road from them (following its bends), one
   * in the middle of each lane coming in, as big as fits in it.
   */
  const giveWayTriangles = (id: number, direction?: string): PaintMark[] => {
    const a = approach(id, direction);
    if (!a) return [];
    // Back along whichever road through it the traffic comes in on (the street may be mapped in pieces, the line at a join).
    let best: { pts: Pts; at: number; forwards: boolean; room: number; way: OsmWay } | null = null;
    // The same kind of way as the lines are across: a road's for traffic, a cycle path's for bikes.
    const vehicle = VEHICLE_ROADS.has(a.on.kind);
    for (const w of waysOfNode.get(id) ?? []) {
      if (VEHICLE_ROADS.has(w.kind) !== vehicle) continue;
      const pts = pointsOf(w.way.nodes);
      if (!pts) continue;
      let at = 0;
      for (let k = 0; k < w.index; k++) at += Math.hypot(pts[k * 2 + 2] - pts[k * 2], pts[k * 2 + 3] - pts[k * 2 + 1]);
      // Is the traffic going this way's way, or against it? (At its end, look at its last piece.)
      const [wx, wy] = alongPolyline(pts, Math.max(0, Math.min(polylineLength(pts) - 1, at - (w.index === w.way.nodes.length - 1 ? 1 : 0)))).slice(2) as [number, number];
      const forwards = wx * a.ux + wy * a.uy >= 0;
      const room = forwards ? at : polylineLength(pts) - at;
      if (!best || room > best.room) best = { pts, at, forwards, room, way: w.way };
    }
    if (!best) return [];
    const { pts, at, forwards, room } = best;
    // 9 m back, or as far as that road goes (but not under 5 m: then there's no room for it).
    const by = Math.min(GIVE_WAY_TRIANGLE, room - PX_PER_METRE);
    if (by < 5 * PX_PER_METRE) return [];
    const back = forwards ? at - by : at + by;
    const [px, py, tx, ty] = alongPolyline(pts, back);
    const [hx, hy] = forwards ? [tx, ty] : [-tx, -ty];
    // Its lanes: from the traffic's left kerb, across its half (all of it, one-way).
    const t = best.way.tags;
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
    const kind = roadKind(t);
    const width = kind ? roadWidth(kind, t) * PX_PER_METRE : a.width;
    const across = lanesAcross(t, oneway);
    const count = Math.max(1, across ? (forwards ? across[0] : across[1]) : 1);
    const laneWidth = (oneway ? width : width / 2) / count;
    const out: PaintMark[] = [];
    for (let i = 0; i < count; i++) {
      const off = width / 2 - (i + 0.5) * laneWidth;
      out.push({ kind: 'triangle', x: round(px + hy * off), y: round(py - hx * off), angle: +Math.atan2(hy, hx).toFixed(3), width: round(laneWidth) });
    }
    return out;
  };
  /**
   * A bus stop's box along the kerb, on the side its platform (or sign) is (else the left, one-way): a
   * rectangle, only where the road's straight enough for one (22 m long, or as short as 12 m), with no
   * junction along it and room for it on its own side of the road; and not over one already there.
   */
  const busStopBoxes: { x: number; y: number; angle: number; width: number; outline?: boolean }[] = [];
  /** Not over another stop's box (two stops mapped for one). */
  const placeBox = (box: { x: number; y: number; angle: number; width: number; outline?: boolean }) => {
    if (busStopBoxes.some((o) => Math.hypot(o.x - box.x, o.y - box.y) < (o.width + box.width) / 2 && Math.cos(o.angle - box.angle) > 0.7)) return null;
    busStopBoxes.push(box);
    return box;
  };
  const busStopBox = (id: number, x: number, y: number) => {
    const a = approach(id, 'forward');
    if (!a) return null;
    // Left of the way as it runs (y down).
    const [lx, ly] = [a.uy, -a.ux];
    let side = a.oneway ? 1 : 0;
    let best = 30 * PX_PER_METRE;
    for (const p of stopsBeside) {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < best && d > 1) {
        best = d;
        side = (p[0] - x) * lx + (p[1] - y) * ly > 0 ? 1 : -1;
      }
    }
    if (!side) return null;
    const depth = BUS_STOP_DEPTH;
    // Where the road won't take a red bay: just the box's outline, 12 m long, lined up with the road at the stop.
    const outline = () => {
      const off = (a.width / 2 - depth / 2) * side;
      return placeBox({ x: round(x + lx * off), y: round(y + ly * off), angle: +Math.atan2(a.uy * side, a.ux * side).toFixed(3), width: 12 * PX_PER_METRE, outline: true });
    };
    if ((a.oneway ? a.width : a.width / 2) < depth) return outline();
    const nodes = a.on.way.nodes;
    const pts = pointsOf(nodes);
    if (!pts) return outline();
    let at = 0;
    for (let k = 0; k < a.on.index; k++) at += Math.hypot(pts[k * 2 + 2] - pts[k * 2], pts[k * 2 + 3] - pts[k * 2 + 1]);
    const total = polylineLength(pts);
    // Junctions along the way, and how far along each is.
    const junctions: number[] = [];
    let run = 0;
    for (let k = 0; k < nodes.length; k++) {
      if (k) run += Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
      if ((roadNodes.get(nodes[k]) ?? 0) > 1) junctions.push(run);
    }
    for (const metres of [22, 18, 15, 12]) {
      const length = metres * PX_PER_METRE;
      const from = at - length / 2;
      const to = at + length / 2;
      if (from < 0 || to > total || junctions.some((j) => j > from && j < to)) continue;
      const [ax, ay] = alongPolyline(pts, from);
      const [bx, by] = alongPolyline(pts, to);
      // Straight enough: the road between keeps within half a metre of the line from one end to the other.
      const chord = Math.hypot(bx - ax, by - ay);
      if (!chord) continue;
      const [ux, uy] = [(bx - ax) / chord, (by - ay) / chord];
      let bent = false;
      let d = 0;
      for (let k = 0; k + 3 < pts.length && !bent; k += 2) {
        const seg = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
        if (d + seg > from && d < to) {
          for (const [px, py] of [[pts[k], pts[k + 1]], [pts[k + 2], pts[k + 3]]]) {
            const along = (px - ax) * ux + (py - ay) * uy;
            if (along < -1 || along > chord + 1) continue;
            if (Math.abs((px - ax) * uy - (py - ay) * ux) > 0.5 * PX_PER_METRE) bent = true;
          }
        }
        d += seg;
      }
      if (bent) continue;
      const off = (a.width / 2 - depth / 2) * side;
      const [nx, ny] = [uy, -ux];
      const box = {
        x: round((ax + bx) / 2 + nx * off),
        y: round((ay + by) / 2 + ny * off),
        angle: +Math.atan2(uy * side, ux * side).toFixed(3),
        width: round(length),
      };
      return placeBox(box);
    }
    return outline();
  };
  /** A line across the way through a node, as wide as the way: where a gate or barrier is. */
  const gateAcross = (id: number, x: number, y: number): Pts | null => {
    const on = waysOfNode.get(id)?.[0];
    if (!on) return null;
    const a = xy(on.way.nodes[Math.max(0, on.index - 1)]);
    const b = xy(on.way.nodes[Math.min(on.way.nodes.length - 1, on.index + 1)]);
    if (!a || !b) return null;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) return null;
    const half = Math.max(1.5 * PX_PER_METRE, (roadWidth(on.kind, on.way.tags) * PX_PER_METRE) / 2);
    const [nx, ny] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    return [x - nx * half, y - ny * half, x + nx * half, y + ny * half];
  };
  for (const node of data.nodes.values()) {
    const t = node.tags;
    const x = proj.x(node.lon);
    const y = proj.y(node.lat);
    if (!inside(x, y)) continue;
    if (DROPPED_KERB.has(t.kerb)) dropped.push(round(x), round(y));
    if (t.amenity === 'fuel') fuelPoints.push([x, y]);
    if (t.highway === 'give_way' || t.highway === 'stop' || t.cycleway === 'asl') {
      const at = acrossLanes(node.id, x, y, t.direction);
      if (at) paint.push({ kind: t.highway === 'give_way' ? 'giveway' : t.highway === 'stop' ? 'stop' : 'asl', ...at });
      if (at && t.highway === 'give_way') paint.push(...giveWayTriangles(node.id, t.direction));
    }
    if (t.highway === 'mini_roundabout') paint.push({ kind: 'mini', x: round(x), y: round(y), angle: 0, width: 4 * PX_PER_METRE });
    if (t.public_transport === 'stop_position' && (t.bus === 'yes' || !t.tram) && !waysOfNode.get(node.id)?.some((w) => busOnly(w.way.tags))) {
      const box = busStopBox(node.id, x, y);
      if (box) paint.push({ kind: 'busstop', ...box });
    }
    if (t.natural === 'tree') {
      const crown = metres(t.diameter_crown);
      const r = Math.max(2.2, Math.min(crown ? crown / 2 : 3.2 + ((node.id % 7) / 7) * 1.6, 7));
      const h = Math.max(4, Math.min(metres(t.height) ?? TREE_HEIGHT, 35));
      const species = treeSpecies(t);
      if (species) treeKinds.push(trees.length / 4, TREE_SPECIES.indexOf(species));
      trees.push(round(x), round(y), round(r * PX_PER_METRE), round(h * PX_PER_METRE));
      continue;
    }
    // A bus shelter at a stop (`shelter=yes`): 4 m along the nearest road, set back a metre from where the stop is (the LIDAR finds it, if it can: see enrich.ts).
    if (t.shelter === 'yes' && (t.highway === 'bus_stop' || t.public_transport === 'platform')) {
      const along = nearestRoadDirection(x, y);
      if (along) {
        const [ux, uy, nx, ny] = along;
        const [cx, cy] = [x + nx * PX_PER_METRE, y + ny * PX_PER_METRE];
        const half = SHELTER_LONG / 2;
        lines.push({ kind: 'shelter', pts: roundPts([cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half]) });
      }
    }
    // A kiosk mapped as a point: a small one, 2.5 m square.
    if ((t.shop === 'kiosk' || t.amenity === 'kiosk') && !onBuilding.has(node.id)) {
      const k = 1.25 * PX_PER_METRE;
      buildings.push({ id: node.id, name: t.name, rings: [roundPts([x - k, y - k, x + k, y - k, x + k, y + k, x - k, y + k])], top: round(KIOSK_HEIGHT * PX_PER_METRE), bottom: 0, kind: 'kiosk', solid: true, drawn: true });
    }
    if (t.leisure === 'slipway') {
      const water = waterFrom(x, y, false, 25);
      if (water) addSlipway(x, y, water.angle, 5 * PX_PER_METRE, water.distance + 7 * PX_PER_METRE);
    }
    if (t['generator:source'] === 'solar' && t.location === 'roof') {
      solar.push(round(x), round(y), Math.max(4, Math.min(120, parseInt(t['generator:solar:modules'] ?? '', 10) || 12)));
    }
    const calming = HUMPS[t.traffic_calming];
    if (calming) {
      const a = approach(node.id, 'forward');
      if (a && VEHICLE_ROADS.has(a.on.kind)) paint.push({ kind: calming, x: round(x), y: round(y), angle: +Math.atan2(a.uy, a.ux).toFixed(3), width: round(a.width) });
    }
    if (t.highway === 'crossing' || t.crossing) {
      const on = roadOfNode.get(node.id);
      if (on && on.index > 0 && on.index < on.way.nodes.length - 1) {
        const a = xy(on.way.nodes[on.index - 1]);
        const b = xy(on.way.nodes[on.index + 1]);
        if (a && b) {
          const kind = crossingKind(t);
          const road = roadIndexOfWay.get(on.way.id);
          let at = 0;
          if (road !== undefined) {
            const p = roads[road].pts;
            for (let k = 0; k < on.index; k++) at += Math.hypot(p[k * 2 + 2] - p[k * 2], p[k * 2 + 3] - p[k * 2 + 1]);
          }
          crossings.push({
            x: round(x),
            y: round(y),
            angle: +Math.atan2(b[1] - a[1], b[0] - a[0]).toFixed(3),
            width: round(roadWidth(on.kind, on.way.tags) * PX_PER_METRE),
            kind,
            ...(road !== undefined ? { road, at: round(at) } : {}),
          });
        }
      }
    }
    const lights = t.highway === 'traffic_signals' || (t.highway === 'crossing' && crossingKind(t) === 'lights');
    if (lights && roadsOfNode.has(node.id)) {
      const arms = armsOf(node, t['traffic_signals:direction']);
      if (arms.length) lightPoints.push({ x, y, crossing: t.highway === 'crossing' || t.crossing === 'traffic_signals', arms });
    }
    if (t.highway === 'crossing' || t.highway === 'traffic_signals') continue;
    const gate = GATES[t.barrier];
    if (gate) {
      // Across the way it's on, as wide as the way (a gate in a wall's just part of the wall).
      const across = gateAcross(node.id, x, y);
      if (across) lines.push({ kind: gate, pts: roundPts(across) });
      continue;
    }
    const prop = propKind(t);
    // A clock or a statue on a building's wall is part of the building.
    if (prop && (prop === 'clock' || prop === 'statue') && onBuilding.has(node.id)) continue;
    if (prop === 'crane' || prop === 'ladder') {
      // Facing out over the nearest water.
      // A crane on a quay faces the harbour, not the nearest dock behind it.
      const water = towardWater(x, y, prop === 'crane');
      props.push({ kind: prop, x: round(x), y: round(y), angle: +(water ?? 0).toFixed(3), ...(prop === 'crane' ? { height: round(Math.max(6, Math.min(40, metres(t.height) ?? CRANE_HEIGHT)) * PX_PER_METRE) } : {}) });
      continue;
    }
    if (prop) props.push({ kind: prop, x: round(x), y: round(y) });
  }

  // The traffic lights, and which controller works each crossing with lights.
  const { signals, controllers } = trafficLights(lightPoints);
  for (const c of crossings) {
    if (c.kind !== 'lights') continue;
    let best = -1;
    let bestD = 40 * PX_PER_METRE;
    controllers.forEach((k, i) => {
      const d = Math.hypot(k.x - c.x, k.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) c.controller = best;
  }
  // Lanes end at the traffic lights' stop lines: nothing painted from there into the junction.
  for (const sig of signals) {
    const [x0, y0, x1, y1] = sig.stop;
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [hx, hy] = [Math.cos(sig.angle), Math.sin(sig.angle)];
    for (const r of roads) {
      if (!r.laneSpans) continue;
      const near = nearestAlongPolyline(r.pts, mx, my);
      if (near.distance > r.width / 2 + 2 * PX_PER_METRE) continue;
      // Which way along the road the traffic stopping here is heading.
      const [, , tx, ty] = alongPolyline(r.pts, near.along);
      const ahead = tx * hx + ty * hy >= 0 ? 1 : -1;
      const into = 20 * PX_PER_METRE;
      r.laneSpans = cutSpans(r.laneSpans, [ahead === 1 ? [near.along - PX_PER_METRE, near.along + into] : [near.along - into, near.along + PX_PER_METRE]]);
      if (!r.laneSpans.length) {
        delete r.lanes;
        delete r.laneSpans;
      }
    }
  }
  // No lanes painted over a zebra or a crossing with lights.
  for (const c of crossings) {
    const r = c.road === undefined || c.at === undefined || c.kind === 'plain' ? undefined : roads[c.road];
    if (!r?.laneSpans) continue;
    r.laneSpans = cutSpans(r.laneSpans, [[c.at! - LANE_CLEAR_CROSSING, c.at! + LANE_CLEAR_CROSSING]]);
    if (!r.laneSpans.length) {
      delete r.lanes;
      delete r.laneSpans;
    }
  }
  // Tactile paving at the kerbs either side of a crossing that has it (tagged on it, or its kerbs): red where there are lights.
  for (const c of crossings) {
    if (!tactile.some(([x, y]) => Math.hypot(x - c.x, y - c.y) < c.width / 2 + 4 * PX_PER_METRE)) continue;
    for (const side of [-1, 1]) {
      // Out from the road's middle, across it.
      const [ox, oy] = [-Math.sin(c.angle) * side, Math.cos(c.angle) * side];
      const out = c.width / 2 + 0.8 * PX_PER_METRE;
      paint.push({ kind: 'tactile', x: round(c.x + ox * out), y: round(c.y + oy * out), angle: +Math.atan2(oy, ox).toFixed(3), width: round(2.4 * PX_PER_METRE), ...(c.kind === 'lights' ? { red: true } : {}) });
    }
  }

  // Petrol stations, however they're mapped: a forecourt (`amenity=fuel` outline) with a canopy
  // (`building=roof`) on it; a canopy tagged as the station; or the station as a point, or its shop
  // tagged as it, with a canopy within 40 m. The canopy's the station's (white, a red fascia), and
  // since OSM doesn't map the pumps, they're made under it: a raised island every 6 m along its long
  // side, square to it, 4 m long, a pump at each end, dashed lanes between. A canopy with no forecourt
  // mapped gets one: tarmac 5 m out round it. A forecourt with no canopy gets its islands in its middle.
  const stationCanopies = new Set<Building>();
  /** Islands, pumps and lanes along a line through (ox, oy) the way (ux, uy), `span` px long, onto a forecourt. */
  const pumpIslands = (court: Area, ox: number, oy: number, ux: number, uy: number, span: number) => {
    const [nx, ny] = [-uy, ux];
    const count = Math.max(1, Math.floor(span / ISLAND_EVERY));
    const lines: number[] = [];
    const [hl, hw] = [ISLAND_LONG / 2, ISLAND_WIDE / 2];
    for (let k = 0; k < count; k++) {
      const along = (k - (count - 1) / 2) * ISLAND_EVERY;
      const [ix, iy] = [ox + ux * along, oy + uy * along];
      areas.push({
        kind: 'island',
        rings: [roundPts([ix - nx * hl - ux * hw, iy - ny * hl - uy * hw, ix + nx * hl - ux * hw, iy + ny * hl - uy * hw, ix + nx * hl + ux * hw, iy + ny * hl + uy * hw, ix - nx * hl + ux * hw, iy - ny * hl + uy * hw])],
      });
      for (const end of [-1, 1]) props.push({ kind: 'pump', x: round(ix + nx * end * (hl - 0.7 * PX_PER_METRE)), y: round(iy + ny * end * (hl - 0.7 * PX_PER_METRE)), angle: +Math.atan2(ny, nx).toFixed(3) });
      // A lane either side of each island: a dashed line halfway to the next.
      for (const side of [-0.5, 0.5]) {
        const [lx, ly] = [ix + ux * side * ISLAND_EVERY, iy + uy * side * ISLAND_EVERY];
        lines.push(round(lx - nx * (hl + 2 * PX_PER_METRE)), round(ly - ny * (hl + 2 * PX_PER_METRE)), round(lx + nx * (hl + 2 * PX_PER_METRE)), round(ly + ny * (hl + 2 * PX_PER_METRE)));
      }
    }
    court.lines = [...(court.lines ?? []), ...lines];
  };
  /** A canopy made the station's, on its forecourt (or one made round it). */
  const station = (canopy: Building, court: Area | null) => {
    if (stationCanopies.has(canopy)) return;
    stationCanopies.add(canopy);
    canopy.fuel = true;
    const axis = ridgeAxis(canopy.rings[0]);
    const { ux, uy, t0, t1, half } = axis;
    const mid = (t0 + t1) / 2;
    const [ox, oy] = [axis.ox + ux * mid, axis.oy + uy * mid];
    if (!court) {
      const [nx, ny] = [-uy, ux];
      const [hl, hw] = [(t1 - t0) / 2 + FORECOURT_ROUND, half + FORECOURT_ROUND];
      court = { kind: 'forecourt', rings: [roundPts([ox - ux * hl - nx * hw, oy - uy * hl - ny * hw, ox + ux * hl - nx * hw, oy + uy * hl - ny * hw, ox + ux * hl + nx * hw, oy + uy * hl + ny * hw, ox - ux * hl + nx * hw, oy - uy * hl + ny * hw])] };
      areas.push(court);
    }
    pumpIslands(court, ox, oy, ux, uy, t1 - t0);
  };
  const roofs = buildings.filter((b) => b.kind === 'roof');
  const forecourts = areas.filter((a) => a.kind === 'forecourt');
  for (const f of forecourts) {
    const on = roofs.filter((b) => {
      const c = centroid(b.rings[0]);
      return pointInRing(c.x, c.y, f.rings[0]);
    });
    for (const b of on) station(b, f);
    // No canopy on it: the islands in its middle, along its longest side (if it's big enough for any).
    if (!on.length && Math.abs(ringArea(f.rings[0])) > 300 * PX_PER_METRE * PX_PER_METRE) {
      const axis = ridgeAxis(f.rings[0]);
      const mid = (axis.t0 + axis.t1) / 2;
      pumpIslands(f, axis.ox + axis.ux * mid, axis.oy + axis.uy * mid, axis.ux, axis.uy, (axis.t1 - axis.t0) * 0.5);
    }
  }
  const inForecourt = (x: number, y: number) => forecourts.some((f) => pointInRing(x, y, f.rings[0]));
  // A canopy tagged as the station itself.
  for (const b of fuelBuildings) if (b.kind === 'roof') station(b, null);
  // The station as a point (or its shop tagged as it): the nearest canopy within 40 m.
  const points = [...fuelPoints, ...[...fuelBuildings].filter((b) => b.kind !== 'roof').map((b) => centroid(b.rings[0])).map((c) => [c.x, c.y] as [number, number])];
  for (const [x, y] of points) {
    if (inForecourt(x, y)) continue;
    let best: Building | null = null;
    let bestD = 40 * PX_PER_METRE;
    for (const b of roofs) {
      const c = centroid(b.rings[0]);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD && !stationCanopies.has(b)) [best, bestD] = [b, d];
    }
    if (best) station(best, null);
  }

  // The bus routes: the roads each runs along, in order and which way along each, and its stops.
  const busRoutes: BusRoute[] = [];
  for (const rel of data.relations.values()) {
    const t = rel.tags;
    if (t.route !== 'bus' || t.disused) continue;
    const members = rel.members.filter((m) => m.type === 'way');
    // An old-style route mapped both ways at once (ways marked forward and backward) can't be followed in order.
    if (members.some((m) => m.role === 'backward')) continue;
    const ways = members.filter((m) => m.role === '' || m.role === 'forward');
    const ends = (w: OsmWay) => [w.nodes[0], w.nodes[w.nodes.length - 1]];
    const legs: number[] = [];
    ways.forEach((m, i) => {
      const road = roadIndexOfWay.get(m.ref);
      const way = data.ways.get(m.ref);
      if (road === undefined || !way || !VEHICLE_ROADS.has(roads[road].kind)) {
        if (legs.length && legs[legs.length - 1] !== -1) legs.push(-1);
        return;
      }
      // Which way along it: towards the next way, or on from the one before.
      const [first, last] = ends(way);
      const next = data.ways.get(ways[i + 1]?.ref ?? -1);
      const prev = data.ways.get(ways[i - 1]?.ref ?? -1);
      let forward = true;
      if (next && !next.nodes.includes(last) && next.nodes.includes(first)) forward = false;
      else if (!next && prev && !prev.nodes.includes(first) && prev.nodes.includes(last)) forward = false;
      const leg = road * 2 + (forward ? 0 : 1);
      if (legs[legs.length - 1] !== leg) legs.push(leg);
    });
    while (legs[legs.length - 1] === -1) legs.pop();
    if (!legs.some((l) => l >= 0)) continue;
    // Its stops: where the bus stops (on the road), or failing that, where people wait (beside it).
    const isStop = (role: string) => role === 'stop' || role.startsWith('stop_');
    let stopMembers = rel.members.filter((m) => m.type === 'node' && isStop(m.role));
    if (!stopMembers.length) stopMembers = rel.members.filter((m) => m.type === 'node' && m.role.startsWith('platform'));
    const stops: number[] = [];
    for (const m of stopMembers) {
      const n = data.nodes.get(m.ref);
      if (!n) continue;
      const [x, y] = [proj.x(n.lon), proj.y(n.lat)];
      if (x >= 0 && y >= 0 && x <= width && y <= height) stops.push(round(x), round(y));
    }
    busRoutes.push({ ref: t.ref ?? '', ...(t.colour ? { colour: t.colour } : {}), legs, stops });
  }

  // The bus stations: each stop_area's bays (a stop at the dead end of a way only buses use), and their platforms.
  const busStations: BusStation[] = [];
  for (const rel of data.relations.values()) {
    if (rel.tags.public_transport !== 'stop_area') continue;
    const number = (n: OsmNode) => (n.tags.local_ref ?? n.tags.ref ?? '').match(/\d+/)?.[0];
    const platforms = rel.members
      .filter((m) => m.type === 'node' && m.role.startsWith('platform'))
      .map((m) => data.nodes.get(m.ref))
      .filter((n): n is OsmNode => !!n)
      .map((n) => ({ x: proj.x(n.lon), y: proj.y(n.lat), number: number(n) }));
    const bays: Bay[] = [];
    for (const m of rel.members) {
      if (m.type !== 'node' || !(m.role === 'stop' || m.role.startsWith('stop_'))) continue;
      const n = data.nodes.get(m.ref);
      if (!n) continue;
      // At the dead end of the way into it (no other way goes on from there).
      const ways = waysOfNode.get(n.id) ?? [];
      const on = ways.length === 1 ? ways.find((w) => busOnly(w.way.tags) && (w.index === 0 || w.index === w.way.nodes.length - 1) && roadIndexOfWay.has(w.way.id)) : undefined;
      if (!on) continue;
      const before = data.nodes.get(on.way.nodes[on.index === 0 ? 1 : on.index - 1]);
      if (!before) continue;
      const [x, y] = [proj.x(n.lon), proj.y(n.lat)];
      if (x < 0 || y < 0 || x > width || y > height) continue;
      const [bx, by] = [proj.x(before.lon), proj.y(before.lat)];
      // Its platform: the one with its number, or else the nearest.
      const own = platforms.find((p) => p.number !== undefined && p.number === number(n));
      const near = own ?? [...platforms].sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
      if (!near || Math.hypot(near.x - x, near.y - y) > 25 * PX_PER_METRE) continue;
      bays.push({ x: round(x), y: round(y), angle: +Math.atan2(y - by, x - bx).toFixed(3), road: roadIndexOfWay.get(on.way.id)!, platform: [round(near.x), round(near.y)] });
    }
    if (bays.length >= 2) busStations.push({ ...(rel.tags.name ? { name: rel.tags.name } : {}), bays });
  }

  // The emergency services' places: outlines (closed ways, multipolygons' outer rings) and points, those of a kind near each other as one.
  const services: Service[] = [];
  const addService = (t: Tags, rings: Pts[]) => {
    const kind = serviceKind(t);
    if (!kind || !rings.length) return;
    let [sx, sy, n] = [0, 0, 0];
    for (const r of rings) for (let k = 0; k + 1 < r.length; k += 2) [sx, sy, n] = [sx + r[k], sy + r[k + 1], n + 1];
    const [x, y] = [sx / n, sy / n];
    if (x < 0 || y < 0 || x > width || y > height) return;
    const same = services.find((o) => o.kind === kind && Math.hypot(o.x - x, o.y - y) < 120 * PX_PER_METRE);
    const emergency = t.emergency === 'yes';
    if (same) {
      same.rings.push(...rings.map(roundPts));
      if (emergency) same.emergency = true;
      // (Named for the hospital itself, over its other buildings.)
      if (t.name && (!same.name || t.amenity)) same.name = t.name;
      return;
    }
    services.push({ kind, ...(t.name ? { name: t.name } : {}), ...(emergency ? { emergency } : {}), x: round(x), y: round(y), rings: rings.map(roundPts) });
  };
  for (const way of data.ways.values()) {
    if (!serviceKind(way.tags)) continue;
    const ring = ringOf(way.nodes);
    if (ring) addService(way.tags, [ring]);
  }
  for (const rel of data.relations.values()) {
    if (rel.tags.type !== 'multipolygon' || !serviceKind(rel.tags)) continue;
    const outer = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => data.ways.get(m.ref)?.nodes).filter((w): w is number[] => !!w);
    addService(rel.tags, joinRings(outer).map((r) => pointsOf(r.slice(0, -1))).filter((p): p is Pts => !!p && p.length >= 6));
  }
  for (const n of data.nodes.values()) {
    if (!serviceKind(n.tags)) continue;
    const [x, y] = [proj.x(n.lon), proj.y(n.lat)];
    const h = 5 * PX_PER_METRE;
    addService(n.tags, [[x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h]]);
  }

  // How busy each road is: what's along it to go to.
  const businesses: [number, number][] = [];
  for (const n of data.nodes.values()) if (isBusiness(n.tags)) businesses.push([proj.x(n.lon), proj.y(n.lat)]);
  for (const way of data.ways.values()) {
    if (!isBusiness(way.tags)) continue;
    const pts = pointsOf(way.nodes);
    if (!pts) continue;
    let [sx, sy] = [0, 0];
    for (let k = 0; k < pts.length; k += 2) [sx, sy] = [sx + pts[k], sy + pts[k + 1]];
    businesses.push([(sx * 2) / pts.length, (sy * 2) / pts.length]);
  }
  roadActivity(roads, businesses);
  // Where people go, and gather: the businesses, and the sights.
  const venues: number[] = [];
  for (const [x, y] of businesses) if (inside(x, y)) venues.push(round(x), round(y), 0);
  const centre = (way: OsmWay) => {
    const pts = pointsOf(way.nodes);
    if (!pts) return null;
    let [sx, sy] = [0, 0];
    for (let k = 0; k < pts.length; k += 2) [sx, sy] = [sx + pts[k], sy + pts[k + 1]];
    return [(sx * 2) / pts.length, (sy * 2) / pts.length] as const;
  };
  for (const n of data.nodes.values()) {
    if (!isSight(n.tags)) continue;
    const [x, y] = [proj.x(n.lon), proj.y(n.lat)];
    if (inside(x, y)) venues.push(round(x), round(y), 1);
  }
  for (const way of data.ways.values()) {
    if (!isSight(way.tags)) continue;
    const c = centre(way);
    if (c && inside(c[0], c[1])) venues.push(round(c[0]), round(c[1]), 1);
  }

  // A street made pedestrian (see landmarks.ts): bollards across it where the roads meet it, and the pubs' and bars' tables along it.
  for (const [ref, c] of Object.entries(CORRECTIONS)) {
    const way = data.ways.get(Number(ref.split('/')[1]));
    const pts = way && pointsOf(way.nodes);
    if (!way || !pts || !(c.bollards || c.seating)) continue;
    const half = (roadWidth('pedestrian', way.tags) * PX_PER_METRE) / 2;
    const length = polylineLength(pts);
    // Where along it the roads cross it or meet it, and how wide each is (half).
    const meets: [number, number][] = [];
    let run = 0;
    for (let k = 0; k < way.nodes.length; k++) {
      if (k > 0) run += Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
      for (const other of data.ways.values()) {
        const kind = other === way ? null : roadKind(other.tags);
        if (!kind || !VEHICLE_ROADS.has(kind) || kind === 'service' || kind === 'track' || !other.nodes.includes(way.nodes[k])) continue;
        // (Once for each point, however many roads meet there: the widest.)
        const h = (roadWidth(kind, other.tags) * PX_PER_METRE) / 2;
        const same = meets.find(([d]) => d === run);
        if (same) same[1] = Math.max(same[1], h);
        else meets.push([run, h]);
      }
    }
    if (c.bollards) {
      for (const [d, h] of meets) {
        for (const dir of [-1, 1]) {
          const at = d + dir * (h + 1.2 * PX_PER_METRE);
          if (at < 0 || at > length) continue;
          const [x, y, ux, uy] = alongPolyline(pts, at);
          for (let o = -half + 0.7 * PX_PER_METRE; o <= half - 0.7 * PX_PER_METRE + 0.1; o += 1.6 * PX_PER_METRE) {
            const [bx, by] = [x - uy * o, y + ux * o];
            if (inside(bx, by)) props.push({ kind: 'bollard', x: round(bx), y: round(by) });
          }
        }
      }
    }
    if (c.seating) {
      const tables: [number, number][] = [];
      const drinking = (t: Tags) => t.amenity === 'pub' || t.amenity === 'bar';
      const spots: [number, number][] = [];
      for (const n of data.nodes.values()) if (drinking(n.tags)) spots.push([proj.x(n.lon), proj.y(n.lat)]);
      for (const w of data.ways.values()) {
        const cw = drinking(w.tags) ? centre(w) : null;
        if (cw) spots.push([cw[0], cw[1]]);
      }
      for (const [vx, vy] of spots) {
        // In front of it: level with it along the street, on its side, a table's width out from the middle's way through.
        const { along: d, distance } = nearestAlongLine(pts, vx, vy);
        if (distance > half + 25 * PX_PER_METRE || d < 2 * PX_PER_METRE || d > length - 2 * PX_PER_METRE) continue;
        const [x0, y0, ux, uy] = alongPolyline(pts, d);
        const side = Math.sign(-(vx - x0) * uy + (vy - y0) * ux) || 1;
        for (const j of [-1, 0, 1]) {
          const at = d + j * 2.4 * PX_PER_METRE;
          if (at < 1.5 * PX_PER_METRE || at > length - 1.5 * PX_PER_METRE || meets.some(([m, h]) => Math.abs(at - m) < h + 3 * PX_PER_METRE)) continue;
          const [x, y, tx, ty] = alongPolyline(pts, at);
          const off = side * 2.6 * PX_PER_METRE;
          const [px, py] = [x - ty * off, y + tx * off];
          // (On the street: not over the water, nor in a building.)
          const wet = areas.some((ar) => ar.kind === 'water' && ar.rings.reduce((inn, r) => (pointInRing(px, py, r) ? !inn : inn), false));
          const built = buildings.some((b) => b.solid && pointInRing(px, py, b.rings[0]));
          if (!inside(px, py) || wet || built || tables.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < 2 * PX_PER_METRE)) continue;
          tables.push([px, py]);
          props.push({ kind: 'picnic', x: round(px), y: round(py), angle: +Math.atan2(ty, tx).toFixed(3) });
        }
      }
    }
  }

  // The gateways: their buildings made archways over the roads through them.
  gateways(buildings, roads);

  // Draw small areas over big ones of the same kind.
  areas.sort((a, b) => AREA_ORDER[a.kind] - AREA_ORDER[b.kind] || Math.abs(ringArea(b.rings[0])) - Math.abs(ringArea(a.rings[0])));
  // Taller buildings drawn last.
  buildings.sort((a, b) => a.top - b.top);

  return {
    attribution: '© OpenStreetMap contributors (ODbL)',
    pxPerMetre: PX_PER_METRE,
    width,
    height,
    origin: { lat: bounds.maxlat, lon: bounds.minlon },
    spawn: spawnOn(roads, proj.x(start.lon), proj.y(start.lat)),
    areas,
    roads,
    lines,
    buildings,
    trees,
    props,
    crossings,
    signals,
    controllers,
    ...(dropped.length ? { dropped } : {}),
    ...(paint.length ? { paint } : {}),
    ...(treeKinds.length ? { treeSpecies: treeKinds } : {}),
    ...(solar.length ? { solar } : {}),
    ...(busRoutes.length ? { busRoutes } : {}),
    ...(busStations.length ? { busStations } : {}),
    ...(services.length ? { services } : {}),
    ...(berths.length ? { berths } : {}),
    ...(ferries.length ? { ferries } : {}),
    ...(venues.length ? { venues } : {}),
  };
}

/** Points every `step` px along a polyline. */
function along(pts: Pts, step: number): [number, number][] {
  const out: [number, number][] = [];
  let carry = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = carry; d < len; d += step) out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  return out;
}

/** The point on the nearest road a car can drive to (x, y), and which way the road goes there. */
export function spawnOn(roads: Road[], x: number, y: number): { x: number; y: number; heading: number } {
  let best = { d: Infinity, x, y, heading: 0 };
  for (const r of roads) {
    if (!VEHICLE_ROADS.has(r.kind) || r.kind === 'service') continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const [ax, ay, bx, by] = [r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { d, x: px, y: py, heading: Math.atan2(dy, dx) };
    }
  }
  return { x: round(best.x), y: round(best.y), heading: +best.heading.toFixed(3) };
}

function materialColour(material: string | undefined): string | undefined {
  if (!material) return undefined;
  return (
    {
      brick: '#8d4f3a',
      stone: '#b9a98a',
      sandstone: '#c8b088',
      limestone: '#d6ccb0',
      concrete: '#9a9a96',
      glass: '#5a7d99',
      metal: '#8f969c',
      wood: '#8a6a48',
      plaster: '#e2dccd',
      render: '#e2dccd',
    } as Record<string, string>
  )[material];
}

/** How many steps up a flight, if it's tagged (and believable). */
function stepCount(t: Tags): number | undefined {
  const n = parseInt(t.step_count ?? '', 10);
  return n >= 1 && n <= 300 ? n : undefined;
}

/** Places people go to (and so drive to, and park at): shops, cafés, bars, offices, hotels and the like. */
const BUSY_AMENITIES = new Set([
  'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'nightclub', 'ice_cream', 'food_court', 'biergarten',
  'bank', 'pharmacy', 'post_office', 'bureau_de_change', 'cinema', 'theatre', 'arts_centre', 'events_venue', 'casino',
  'library', 'doctors', 'dentist', 'clinic', 'hospital', 'veterinary', 'college', 'university', 'school', 'marketplace',
  'car_rental', 'car_wash', 'fuel', 'community_centre', 'conference_centre', 'courthouse', 'townhall',
]);
const BUSY_TOURISM = new Set(['hotel', 'hostel', 'guest_house', 'apartment', 'museum', 'gallery', 'attraction', 'aquarium']);

/** A sight, where people gather to look: a museum, a gallery, an attraction, a viewpoint, a monument, a statue or other artwork. */
export function isSight(t: Tags): boolean {
  if (t.tourism && ['attraction', 'museum', 'gallery', 'viewpoint', 'artwork', 'aquarium', 'zoo', 'theme_park'].includes(t.tourism)) return true;
  if (t.historic && ['monument', 'memorial', 'ship', 'castle', 'ruins', 'archaeological_site', 'building', 'church'].includes(t.historic)) return true;
  return t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'fountain';
}

export function isBusiness(t: Tags): boolean {
  if (t.shop && t.shop !== 'vacant' && t.shop !== 'no') return true;
  if (t.amenity && BUSY_AMENITIES.has(t.amenity)) return true;
  if (t.office || t.craft) return true;
  if (t.tourism && BUSY_TOURISM.has(t.tourism)) return true;
  return t.leisure === 'fitness_centre' || t.leisure === 'sports_centre' || t.leisure === 'bowling_alley';
}

/** Businesses this close to a road are on it, px. */
const ACTIVITY_REACH = 30 * PX_PER_METRE;

/** Sets each road's `activity`: the businesses within ACTIVITY_REACH, per 100 m of road (a short road counted as 50 m). */
export function roadActivity(roads: Road[], businesses: [number, number][]): void {
  for (const r of roads) {
    delete r.activity;
    if (!VEHICLE_ROADS.has(r.kind) || r.pts.length < 4) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < r.pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, r.pts[k]), Math.min(y0, r.pts[k + 1]), Math.max(x1, r.pts[k]), Math.max(y1, r.pts[k + 1])];
    const reach = ACTIVITY_REACH + r.width / 2;
    let count = 0;
    for (const [x, y] of businesses) {
      if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) continue;
      if (distanceToLine(x, y, r.pts) <= reach) count++;
    }
    if (!count) continue;
    let length = 0;
    for (let k = 0; k + 3 < r.pts.length; k += 2) length += Math.hypot(r.pts[k + 2] - r.pts[k], r.pts[k + 3] - r.pts[k + 1]);
    r.activity = Math.round((count / Math.max(length, 50 * PX_PER_METRE)) * 100 * PX_PER_METRE * 10) / 10;
  }
}

/** How far a point is from a polyline. */
function distanceToLine(x: number, y: number, pts: Pts): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay, bx, by] = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t));
  }
  return best;
}
