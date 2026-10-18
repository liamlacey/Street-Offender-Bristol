/**
 * Turns OpenStreetMap data (the XML the OSM API's `map` call gives) into the
 * game's map: roads, paths, ground areas, water, buildings with heights,
 * trees, walls and street furniture, in game pixels with north up.
 *
 * Pure (no Phaser, no DOM), so it can be tested, and run by
 * `tools/build-map.ts` to make `src/map/bristol.json`.
 */

import { LANDMARKS, STREETS } from './landmarks.ts';

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
  | 'island';

export interface Area {
  kind: AreaKind;
  /** The outer ring first, then any holes (filled even-odd). */
  rings: Pts[];
  /** What it's paved with, if it's tagged and not the usual for its kind. */
  surface?: Paving;
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
  /** On a bridge (drawn over the water, and you can drive across). */
  bridge?: boolean;
  /** Whether it has pavements along it. */
  pavement?: boolean;
  /** What it's surfaced with, if tagged (the drawing picks a usual one for its kind otherwise). */
  surface?: Paving;
  /** Stretches (distances along it, start, end, start, end, ...) with lane markings: not across junctions. */
  marks?: number[];
}

export type LineKind = 'wall' | 'fence' | 'hedge' | 'rail' | 'quay' | 'railing';

export interface Line {
  kind: LineKind;
  pts: Pts;
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
  | 'bikes';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
}

export interface Crossing {
  x: number;
  y: number;
  /** Direction of the road, radians. */
  angle: number;
  /** The road's width, px. */
  width: number;
  zebra: boolean;
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
  /** The lie of the land, if measured (see src/map/enrich.ts). */
  terrain?: TerrainData;
}

/**
 * The ground's height above sea level, on a grid over the map: each cell's
 * height in decimetres above `base`, as little-endian 16-bit numbers, in
 * base64 (it's a lot of numbers, and this keeps the file small).
 */
export interface TerrainData {
  /** Map px between grid points; the first is at (0, 0). */
  cell: number;
  cols: number;
  rows: number;
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
  const kind = ROAD_KINDS[tags.highway];
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
  if (tags.man_made === 'pier') return 'pier';
  if (tags['area:highway'] === 'traffic_island' || tags.footway === 'traffic_island') return 'island';
  if (tags.landuse === 'flowerbed') return 'flowerbed';
  if (tags.natural === 'wood' || tags.landuse === 'forest' || tags.natural === 'scrub') return 'wood';
  if (tags.leisure === 'pitch' || tags.leisure === 'sports_centre') return tags.surface && tags.surface !== 'grass' ? 'plaza' : 'pitch';
  if (tags.leisure === 'playground') return 'play';
  if (tags.leisure === 'park' || tags.leisure === 'common') return 'park';
  if (tags.leisure === 'garden') return 'garden';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(tags.landuse) || tags.natural === 'grassland' || tags.amenity === 'grave_yard') return 'grass';
  if (tags.landuse === 'construction' || tags.landuse === 'brownfield') return 'dirt';
  if (tags.amenity === 'parking' && !tags.building && tags.parking !== 'underground' && tags.parking !== 'multi-storey') return 'parking';
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
};

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

/** Props from tagged nodes. */
export function propKind(tags: Tags): PropKind | null {
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

export function buildMap(data: OsmData, { bounds, start }: BuildOptions): GameMap {
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

  const addArea = (kind: AreaKind, rings: Pts[], tags: Tags) => {
    const clipped = rings.map((r) => clipRing(r, cx0, cy0, cx1, cy1)).filter((r) => r.length >= 6);
    if (clipped.length === 0 || Math.abs(ringArea(clipped[0])) < 4) return;
    const surface = kind === 'plaza' || kind === 'parking' ? paving(tags.surface) : undefined;
    areas.push({ kind, rings: clipped.map(roundPts), ...(surface ? { surface } : {}) });
  };

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
      wall: landmark?.wall ?? tags['building:colour'] ?? materialColour(tags['building:material']) ?? (street && pick(street.walls)),
      roof: landmark?.roof ?? tags['roof:colour'] ?? (street && pick(street.roofs)),
      roofShape: landmark?.roofShape ?? tags['roof:shape'],
      ...(landmark ? { landmark: `${type}/${id}` } : {}),
      ...(tags['roof:orientation'] === 'across' ? { roofAcross: true } : {}),
      solid: !part && kind !== 'roof' && h.bottom < 2,
      drawn: true,
      ...(tagged ? { heightFrom: 'tag' as const } : {}),
    });
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
      if (VEHICLE_ROADS.has(road)) for (const id of way.nodes) roadNodes.set(id, (roadNodes.get(id) ?? 0) + 1);
      continue;
    }

    const area = ownTags ? areaKind(t) : null;
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

    const lineKind = t.barrier ? LINE_KINDS[t.barrier] : t.railway === 'rail' || t.railway === 'tram' ? 'rail' : t.man_made === 'quay' && !closed ? 'quay' : undefined;
    if (lineKind) {
      const pts = pointsOf(way.nodes);
      if (pts) for (const piece of clipLine(pts, cx0, cy0, cx1, cy1)) lines.push({ kind: lineKind, pts: roundPts(piece) });
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

  // Roads, with their junctions found so the lane markings stop short of them.
  for (const { way, kind } of roadWays) {
    const t = way.tags;
    const pts = pointsOf(way.nodes);
    if (!pts) continue;
    const width = roadWidth(kind, t) * PX_PER_METRE;
    const vehicle = VEHICLE_ROADS.has(kind);
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
    const bridge = t.bridge !== undefined && t.bridge !== 'no';
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
    const pavement = vehicle && kind !== 'service' && kind !== 'track' && t.sidewalk !== 'no' && t.sidewalk !== 'none';
    // Clipping the line loses the distances the markings are measured along, so only roads wholly beyond the edge are dropped.
    if (!pts.some((v, i) => i % 2 === 0 && inside(v, pts[i + 1], pad))) continue;
    roads.push({
      kind,
      ...(t.name ? { name: t.name } : {}),
      width: round(width),
      pts: roundPts(pts),
      ...(oneway ? { oneway } : {}),
      ...(bridge ? { bridge } : {}),
      ...(pavement ? { pavement } : {}),
      ...(marks ? { marks } : {}),
      ...(surface ? { surface } : {}),
    });
  }

  // Nodes: trees, street furniture and crossings.
  const roadOfNode = new Map<number, { way: OsmWay; index: number; kind: RoadKind }>();
  for (const { way, kind } of roadWays) {
    if (!VEHICLE_ROADS.has(kind)) continue;
    way.nodes.forEach((id, index) => roadOfNode.set(id, { way, index, kind }));
  }
  for (const node of data.nodes.values()) {
    const t = node.tags;
    const x = proj.x(node.lon);
    const y = proj.y(node.lat);
    if (!inside(x, y)) continue;
    if (t.natural === 'tree') {
      const crown = metres(t.diameter_crown);
      const r = Math.max(2.2, Math.min(crown ? crown / 2 : 3.2 + ((node.id % 7) / 7) * 1.6, 7));
      const h = Math.max(4, Math.min(metres(t.height) ?? TREE_HEIGHT, 35));
      trees.push(round(x), round(y), round(r * PX_PER_METRE), round(h * PX_PER_METRE));
      continue;
    }
    if (t.highway === 'crossing' || t.crossing) {
      const on = roadOfNode.get(node.id);
      if (on && on.index > 0 && on.index < on.way.nodes.length - 1) {
        const a = xy(on.way.nodes[on.index - 1]);
        const b = xy(on.way.nodes[on.index + 1]);
        if (a && b) {
          const zebra = t.crossing === 'zebra' || t['crossing:markings'] === 'zebra' || t.crossing_ref === 'zebra' || t.crossing === 'uncontrolled' || t.crossing === 'marked';
          crossings.push({ x: round(x), y: round(y), angle: +Math.atan2(b[1] - a[1], b[0] - a[0]).toFixed(3), width: round(roadWidth(on.kind, on.way.tags) * PX_PER_METRE), zebra });
        }
      }
      if (t.highway === 'crossing') continue;
    }
    const prop = propKind(t);
    if (prop) props.push({ kind: prop, x: round(x), y: round(y) });
  }

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
