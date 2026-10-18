/**
 * Builds an island from a seed: the lie of the land (sea, beaches, plains,
 * forests, hills, rocky mountains with snow on top, and the odd lake),
 * rivers running down from the hills to the sea, towns laid out on a grid
 * of streets (terraced houses and shops along them, a church and a fountain
 * on the square), paved roads between the towns and dirt tracks out to the
 * villages, bridges where they cross the rivers, the villages themselves
 * (houses round a green, barns, haystacks, fenced paddocks, tractors and
 * parked cars, and one with a fuel depot) with fields of crops round them,
 * boats pulled up off the beaches, beach huts and sunshades along them,
 * campsites and forestry clearings in the woods, ski lifts up the snowy
 * peaks with a chalet at the bottom, harbours on the coast (a paved quay
 * with warehouses, cranes and containers, and jetties out into the water
 * with boats tied up), meadows of long grass, and trees,
 * bushes and rocks everywhere else. Pure data: TankScene draws it.
 */

import { KINDS, type ThingKind, type ThingSpec } from './kinds';
import { fbm, random } from './noise';

export interface Vec2 {
  x: number;
  y: number;
}

export const BIOME = { deep: 0, shallow: 1, beach: 2, grass: 3, forest: 4, hills: 5, rock: 6, snow: 7, river: 8 } as const;
export type Biome = (typeof BIOME)[keyof typeof BIOME];

/** The island's size, px, and the size of a cell of its height and biome maps. */
export const SIZE = 40960;
/** How much more there is of everything than on the first, smaller islands (by area). */
const SCALE = (SIZE / 6400) ** 2;
export const CELL = 16;
export const COLS = SIZE / CELL;
/** Width of a dirt track, px. */
export const ROAD_WIDTH = 40;
/** A dirt track, a paved road between towns, or a town's street; and how wide each is, px. */
export type RoadKind = 'track' | 'road' | 'street' | 'avenue';
export const ROAD_WIDTHS: Record<RoadKind, number> = { track: ROAD_WIDTH, road: 48, street: 44, avenue: 76 };
/** A town's blocks, between the middles of its streets, px. */
export const BLOCK = { w: 200, h: 190 };

export interface River {
  path: Vec2[];
  /** How wide it is at each point (wider towards the sea), px. */
  widths: number[];
}

/**
 * A town: a grid of streets turned to `angle`, `blocks` blocks either side of
 * its middle along and across. Its main streets cross in the middle, and run
 * on out of town as the roads. The block to the right of the crossing and
 * below it is the square; the one to its left, the church's.
 */
export interface Town {
  x: number;
  y: number;
  angle: number;
  blocks: { u: number; v: number };
  /** The island's one city: bigger, its main streets four-lane avenues, towers in the middle, and parks. */
  city?: boolean;
  /** Blocks laid out as parks (by `i`, `j`: the block from `i` to `i + 1` along, `j` to `j + 1` across). */
  parks?: { i: number; j: number }[];
}

/** Where two roads meet (or cross), and what the bigger of them is. */
export interface Junction {
  x: number;
  y: number;
  kind: RoadKind;
}

/**
 * A harbour: `x`, `y` is the middle of its quay's edge, `angle` the way out to
 * sea. Its yard runs back from the quay, and its jetties out from it.
 */
export interface Harbour {
  x: number;
  y: number;
  angle: number;
}

/** How far the yard runs along the quay either side of the middle, and back from it, px. */
export const YARD = { half: 230, depth: 250 };

/** A point by a harbour: `u` along the quay, `v` back from its edge (inland; negative is out over the water). */
export function harbourPoint(h: Harbour, u: number, v: number): Vec2 {
  const c = Math.cos(h.angle);
  const s = Math.sin(h.angle);
  return { x: h.x - s * u - c * v, y: h.y + c * u - s * v };
}

/** A field of crops: its middle, which way its rows run, and how many patches along and across. */
export interface Field {
  x: number;
  y: number;
  angle: number;
  cols: number;
  rows: number;
}

/** A farm: its yard (the middle, and which way it's laid out) and its fields. */
export interface Farm {
  x: number;
  y: number;
  angle: number;
  fields: Field[];
}

/** A station on the railway: where its platform is, which way the line runs there, how far along the line it is, px, and its town. */
export interface Station {
  x: number;
  y: number;
  angle: number;
  at: number;
  town: number;
  /** Which side of the line the station building and platform are (+1: to the right, going along). */
  side: number;
}

/** The railway: a loop round the island through every town, as a line of points (the last joining back to the first). */
export interface Railway {
  line: Vec2[];
  /** How far along the line each point is, px (one more than the points: the whole way round). */
  at: number[];
  stations: Station[];
}

/** A point `s` px along the railway (round and round), and which way it runs there. */
export function railPose(r: Railway, s: number): { x: number; y: number; angle: number } {
  const length = r.at[r.at.length - 1];
  const d = ((s % length) + length) % length;
  let lo = 0;
  let hi = r.line.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.at[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = r.line[lo];
  const b = r.line[(lo + 1) % r.line.length];
  const f = (d - r.at[lo]) / (r.at[lo + 1] - r.at[lo] || 1);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export interface Village {
  x: number;
  y: number;
  /** How far its houses spread, px. */
  r: number;
}

/** A ski lift, from its bottom station up to its top one; the piste runs down beside it on one `side` (+1: to its left, going up). */
export interface Lift {
  bottom: Vec2;
  top: Vec2;
  side: 1 | -1;
}

export interface Island {
  seed: number;
  /** Height of the land at each cell (sea level 0), row by row. */
  heights: Float32Array;
  /** How wet the land is at each cell (0..1; the wetter, the more forest). */
  moisture: Float32Array;
  biomes: Uint8Array;
  /** 1 where a cell is on (or right by) a track. */
  roads: Uint8Array;
  /** 1 where a cell is on (or right by) the railway. */
  rails: Uint8Array;
  railway: Railway | null;
  /** The tracks, roads and streets, as lines of points. */
  tracks: Vec2[][];
  /** What each of them is. */
  roadKinds: RoadKind[];
  junctions: Junction[];
  rivers: River[];
  towns: Town[];
  harbours: Harbour[];
  villages: Village[];
  farms: Farm[];
  lifts: Lift[];
  /** Footpaths through the woods and up the hills and mountains. */
  trails: Vec2[][];
  things: ThingSpec[];
  /** Where the tank starts: on a track by a village. */
  spawn: { x: number; y: number; angle: number };
}

export function cellOf(x: number, y: number): number {
  const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(COLS - 1, Math.max(0, Math.floor(y / CELL)));
  return cy * COLS + cx;
}

export function biomeAt(island: Island, x: number, y: number): Biome {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return BIOME.deep;
  return island.biomes[cellOf(x, y)] as Biome;
}

/** Height of the land at a point, smoothly between cells. */
export function heightAt(heights: Float32Array, x: number, y: number): number {
  const fx = Math.min(COLS - 1.001, Math.max(0, x / CELL - 0.5));
  const fy = Math.min(COLS - 1.001, Math.max(0, y / CELL - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * COLS + x0;
  const a = heights[i];
  const b = heights[i + 1];
  const c = heights[i + COLS];
  const d = heights[i + COLS + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** How high the land is at a point (sea level 0, snow above about 0.76). */
export function landHeight(seed: number, x: number, y: number): number {
  // Deep sea right round the edge of the map, whatever the noise says.
  const edge = Math.min(x, y, SIZE - x, SIZE - y) / SIZE;
  const shelf = edge < 0.07 ? (0.07 - edge) * 14 : 0;
  const half = SIZE / 2;
  // Distance from the middle, the coast pushed in and out by noise.
  const wobble = 0.8 + 0.4 * fbm(x / 1300, y / 1300, seed + 3, 3);
  const d = (Math.hypot(x - half, y - half) / half) * wobble;
  const e = fbm(x / 1500, y / 1500, seed, 5);
  // Ridged noise for mountain chains.
  const ridge = 1 - Math.abs(fbm(x / 1000, y / 1000, seed + 7, 4) * 2 - 1);
  return -shelf + (e - 0.5) * 1.2 + 0.38 - d * d * 0.95 + Math.max(0, ridge - 0.64) * 1.8 * Math.max(0, 1 - d);
}

export function biomeFor(h: number, moisture: number): Biome {
  if (h < -0.08) return BIOME.deep;
  if (h < 0) return BIOME.shallow;
  if (h < 0.035) return BIOME.beach;
  if (h > 0.76) return BIOME.snow;
  if (h > 0.6) return BIOME.rock;
  if (h > 0.45) return BIOME.hills;
  return moisture > 0.5 ? BIOME.forest : BIOME.grass;
}

/** Builds an island all in one go. */
export function generateIsland(seed: number): Island {
  const steps = islandSteps(seed);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Builds an island a step at a time, yielding how far it's got (0..1) after
 * each, so a loading screen can show progress between them.
 */
export function* islandSteps(seed: number): Generator<number, Island> {
  const rand = random(seed);
  const heights = new Float32Array(COLS * COLS);
  const biomes = new Uint8Array(COLS * COLS);
  const moisture = new Float32Array(COLS * COLS);
  // The noise is worked out on coarser grids (every other cell for the height, every fourth for the wetness), then
  // filled in between: the finest detail in it is several cells across, and it's four times quicker.
  const coarse = (stride: number, value: (x: number, y: number) => number, from: number, share: number): Generator<number, Float32Array> =>
    (function* () {
      const n = COLS / stride + 1;
      const grid = new Float32Array(n * n);
      for (let gy = 0; gy < n; gy++) {
        if (gy % 10 === 0) yield from + (gy / n) * share;
        for (let gx = 0; gx < n; gx++) grid[gy * n + gx] = value(gx * stride * CELL, gy * stride * CELL);
      }
      return grid;
    })();
  const sample = (grid: Float32Array, stride: number, x: number, y: number) => {
    const n = COLS / stride + 1;
    const fx = Math.min(n - 1.001, x / (stride * CELL));
    const fy = Math.min(n - 1.001, y / (stride * CELL));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * n + x0;
    return grid[i] * (1 - tx) * (1 - ty) + grid[i + 1] * tx * (1 - ty) + grid[i + n] * (1 - tx) * ty + grid[i + n + 1] * tx * ty;
  };
  const heightGrid = yield* coarse(2, (x, y) => landHeight(seed, x, y), 0, 0.3);
  const wetGrid = yield* coarse(4, (x, y) => fbm(x / 1100, y / 1100, seed + 11, 4), 0.3, 0.04);
  for (let cy = 0; cy < COLS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      const i = cy * COLS + cx;
      heights[i] = sample(heightGrid, 2, x, y);
      moisture[i] = sample(wetGrid, 4, x, y);
      biomes[i] = biomeFor(heights[i], moisture[i]);
    }
  }
  yield 0.35;
  const island: Island = {
    seed,
    heights,
    moisture,
    biomes,
    roads: new Uint8Array(COLS * COLS),
    rails: new Uint8Array(COLS * COLS),
    railway: null,
    tracks: [],
    roadKinds: [],
    junctions: [],
    rivers: [],
    towns: [],
    harbours: [],
    villages: [],
    farms: [],
    lifts: [],
    trails: [],
    things: [],
    spawn: { x: SIZE / 2, y: SIZE / 2, angle: 0 },
  };
  island.rivers = carveRivers(island, rand);
  yield 0.4;
  const placer = new Placer(island, rand);
  const costs = roadCosts(island);
  const land = mainland(costs);
  island.towns = findTowns(island, rand, land);
  // No roads across the towns: they come in at the ends of the main streets.
  for (const t of island.towns) {
    const halfU = t.blocks.u * BLOCK.w - 24;
    const halfV = t.blocks.v * BLOCK.h - 24;
    for (let u = -halfU; u <= halfU; u += STEP / 2) {
      for (let v = -halfV; v <= halfV; v += STEP / 2) {
        const p = townPoint(t, u, v);
        costs[Math.floor(p.y / STEP) * STEPS + Math.floor(p.x / STEP)] = Infinity;
      }
    }
  }
  island.villages = findVillages(island, rand, land);
  island.harbours = findHarbours(island, rand, land);
  // No roads through the harbour yards (they come in at the gate).
  for (const h of island.harbours) {
    for (let u = -YARD.half - 30; u <= YARD.half + 30; u += STEP / 2) {
      for (let v = -20; v <= YARD.depth + 20; v += STEP / 2) {
        const p = harbourPoint(h, u, v);
        costs[Math.floor(p.y / STEP) * STEPS + Math.floor(p.x / STEP)] = Infinity;
      }
    }
  }
  yield 0.45;
  for (const done of linkPlaces(island, rand, costs)) yield 0.45 + done * 0.2;
  for (const town of island.towns) {
    for (const street of townStreets(town)) {
      island.tracks.push(street.path);
      island.roadKinds.push(street.kind);
    }
  }
  island.tracks.forEach((track, k) => markRoad(island, track, island.roadKinds[k]));
  island.railway = layRailway(island, costs);
  placer.stations();
  for (const town of island.towns) placer.town(town);
  for (const harbour of island.harbours) placer.harbour(harbour);
  island.villages.forEach((v, k) => {
    placer.village(v, k === 0);
    placer.farms(v);
  });
  placer.boats();
  placer.beaches();
  island.lifts = placer.skiLifts();
  placer.campsites();
  placer.forestry();
  accessTracks(island, costs, placer.sites);
  const bridges = findBridges(island);
  island.junctions = findJunctions(island);
  island.trails = placer.trails();
  placer.meadows();
  yield 0.7;
  for (const done of placer.wilds()) yield 0.7 + done * 0.3;
  island.things.push(...bridges, ...railBridges(island));
  island.spawn = spawnPoint(island);
  return island;
}

// --- Villages and tracks ------------------------------------------------------

function findVillages(island: Island, rand: () => number, land: Uint8Array): Village[] {
  const villages: Village[] = [];
  for (const spacing of [1100, 850, 700]) {
    for (let k = 0; k < 600 * SCALE && villages.length < 7 * SCALE; k++) {
      const x = 600 + rand() * (SIZE - 1200);
      const y = 600 + rand() * (SIZE - 1200);
      if (villages.some((v) => Math.hypot(v.x - x, v.y - y) < spacing)) continue;
      if (island.towns.some((t) => Math.hypot(t.x - x, t.y - y) < townReach(t) + spacing * 0.6)) continue;
      if (!land[Math.floor(y / STEP) * STEPS + Math.floor(x / STEP)]) continue;
      const h = heightAt(island.heights, x, y);
      if (h < 0.07 || h > 0.4) continue;
      // Flat, dry land all round.
      let ok = true;
      for (let a = 0; a < 8 && ok; a++) {
        const px = x + Math.cos((a / 8) * Math.PI * 2) * 260;
        const py = y + Math.sin((a / 8) * Math.PI * 2) * 260;
        const b = biomeAt(island, px, py);
        if (b !== BIOME.grass && b !== BIOME.forest) ok = false;
      }
      if (ok) villages.push({ x, y, r: 230 + rand() * 110 });
    }
    if (villages.length + island.towns.length >= 5 * SCALE) break;
  }
  return villages;
}

/**
 * Joins every town and village up (the shortest links that join them all,
 * and a couple more for loops), with paths found round the hills and water:
 * paved roads out of the towns' main streets, dirt tracks between villages.
 */
function* linkPlaces(island: Island, rand: () => number, costs: Float32Array): Generator<number, void> {
  // (A harbour's joined up at its gate, at the back of its yard.)
  const places: Vec2[] = [...island.towns, ...island.villages, ...island.harbours.map((h) => harbourPoint(h, 0, YARD.depth + 70))];
  const paved = island.towns.length + island.villages.length;
  if (places.length < 2) return;
  const edges: [number, number][] = [];
  const joined = new Set([0]);
  while (joined.size < places.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of joined) {
      places.forEach((v, b) => {
        if (joined.has(b)) return;
        const d = Math.hypot(v.x - places[a].x, v.y - places[a].y);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      });
    }
    if (!best) break;
    edges.push(best);
    joined.add(best[1]);
  }
  // The extra links are between neighbours (one of each place's few nearest), so the roads don't cross the whole island.
  for (let k = 0; k < 2 * SCALE && places.length > 3; k++) {
    const a = Math.floor(rand() * places.length);
    const near = places.map((p, i) => ({ i, d: Math.hypot(p.x - places[a].x, p.y - places[a].y) })).sort((p, q) => p.d - q.d);
    const b = near[1 + Math.floor(rand() * Math.min(4, near.length - 1))].i;
    if (a !== b && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
  }
  const towns = island.towns.length;
  // A town's end of a link is the end of one of its main streets, the one facing the other place.
  const end = (k: number, towards: Vec2): Vec2 => (k < towns ? townExit(island.towns[k], towards) : places[k]);
  const network = new Network();
  for (const [n, edge] of edges.entries()) {
    let a = edge[0];
    const b = edge[1];
    yield n / edges.length;
    let from = end(a, places[b]);
    let to = end(b, from);
    let path = findPath(island, costs, from, to);
    // No way through (cut off by water, or a harbour yard): join it to another of its neighbours instead.
    // (The place being joined on is the second of the pair.)
    const near = path ? [] : places.map((p, i) => ({ i, d: Math.hypot(p.x - places[b].x, p.y - places[b].y) })).sort((p, q) => p.d - q.d);
    for (let k = 1; !path && k < Math.min(8, near.length); k++) {
      if (near[k].i === a) continue;
      a = near[k].i;
      from = end(a, places[b]);
      to = end(b, from);
      path = findPath(island, costs, from, to);
    }
    if (!path) continue;
    const road = network.snap(smooth(path));
    network.add(resample(road, 12), island.tracks.length);
    island.tracks.push(road);
    // (Marked straight away, so the roads found after it share it rather than running alongside.)
    markRoad(island, road, a < towns || b < towns || a >= paved || b >= paved ? 'road' : 'track');
    island.roadKinds.push(a < towns || b < towns || a >= paved || b >= paved ? 'road' : 'track');
  }
}

// --- Harbours ------------------------------------------------------------------------

/**
 * Harbours round the coast, on the main landmass: where there's flat dry land
 * for a yard behind the shore and open water in front for the jetties, away
 * from the towns and villages (a road's laid to each).
 */
function findHarbours(island: Island, rand: () => number, land: Uint8Array): Harbour[] {
  const harbours: Harbour[] = [];
  const { heights } = island;
  const wet = (p: Vec2) => {
    const b = biomeAt(island, p.x, p.y);
    return b === BIOME.deep || b === BIOME.shallow;
  };
  const dry = (p: Vec2) => {
    const b = biomeAt(island, p.x, p.y);
    return b === BIOME.beach || b === BIOME.grass || b === BIOME.forest || b === BIOME.hills;
  };
  for (let tries = 0; tries < 3000 * SCALE && harbours.length < Math.max(1, Math.round(SCALE / 3)); tries++) {
    const x = 600 + rand() * (SIZE - 1200);
    const y = 600 + rand() * (SIZE - 1200);
    if (biomeAt(island, x, y) !== BIOME.beach) continue;
    // Out to sea: downhill.
    const gx = heightAt(heights, x + 32, y) - heightAt(heights, x - 32, y);
    const gy = heightAt(heights, x, y + 32) - heightAt(heights, x, y - 32);
    if (Math.hypot(gx, gy) < 0.002) continue;
    const angle = Math.atan2(-gy, -gx);
    // The water's edge.
    let edge = 0;
    while (edge < 300 && !wet({ x: x + Math.cos(angle) * edge, y: y + Math.sin(angle) * edge })) edge += 8;
    if (edge >= 300) continue;
    const h: Harbour = { x: x + Math.cos(angle) * (edge - 8), y: y + Math.sin(angle) * (edge - 8), angle };
    if (harbours.some((o) => Math.hypot(o.x - h.x, o.y - h.y) < 3000)) continue;
    if (island.towns.some((t) => Math.hypot(t.x - h.x, t.y - h.y) < townReach(t) + 450)) continue;
    if (island.villages.some((v) => Math.hypot(v.x - h.x, v.y - h.y) < v.r + 450)) continue;
    const gate = harbourPoint(h, 0, YARD.depth + 70);
    if (!land[Math.floor(gate.y / STEP) * STEPS + Math.floor(gate.x / STEP)]) continue;
    let ok = true;
    for (let u = -YARD.half; u <= YARD.half && ok; u += 40) {
      for (let v = 24; v <= YARD.depth + 70 && ok; v += 40) if (!dry(harbourPoint(h, u, v))) ok = false;
      // Open water out in front, for the jetties and the boats.
      if (Math.abs(u) <= 160) for (let v = -40; v >= -300 && ok; v -= 40) if (!wet(harbourPoint(h, u, v))) ok = false;
    }
    if (ok) harbours.push(h);
  }
  return harbours;
}

// --- Towns ---------------------------------------------------------------------------

/** A point in a town's grid (u along it, v across) on the map. */
export function townPoint(t: Town, u: number, v: number): Vec2 {
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return { x: t.x + c * u - s * v, y: t.y + s * u + c * v };
}

/** How far a town reaches from its middle, px (to its corners). */
export function townReach(t: Town): number {
  return Math.hypot(t.blocks.u * BLOCK.w, t.blocks.v * BLOCK.h);
}

/** The ends of a town's two main streets, at its edges: the one nearest a point. */
function townExit(t: Town, towards: Vec2): Vec2 {
  const halfU = t.blocks.u * BLOCK.w;
  const halfV = t.blocks.v * BLOCK.h;
  const ends = [townPoint(t, halfU, 0), townPoint(t, -halfU, 0), townPoint(t, 0, halfV), townPoint(t, 0, -halfV)];
  return ends.reduce((best, p) => (Math.hypot(p.x - towards.x, p.y - towards.y) < Math.hypot(best.x - towards.x, best.y - towards.y) ? p : best));
}

/** Room for one or two towns on flat, dry land, well away from the water. */
function findTowns(island: Island, rand: () => number, land: Uint8Array): Town[] {
  const towns: Town[] = [];
  // Whether a town fits: on the main landmass, clear of the others, on land all over (no water, river or snow), and mostly low and green.
  const fits = (t: Town, roughness: number) => {
    if (!land[Math.floor(t.y / STEP) * STEPS + Math.floor(t.x / STEP)]) return false;
    if (towns.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < townReach(o) + townReach(t) + 800)) return false;
    const halfU = t.blocks.u * BLOCK.w + 60;
    const halfV = t.blocks.v * BLOCK.h + 60;
    let rough = 0;
    let samples = 0;
    for (let u = -halfU; u <= halfU; u += 60) {
      for (let v = -halfV; v <= halfV; v += 60) {
        const p = townPoint(t, u, v);
        const b = biomeAt(island, p.x, p.y);
        samples++;
        if (b === BIOME.deep || b === BIOME.shallow || b === BIOME.river || b === BIOME.snow) return false;
        if (b !== BIOME.grass && b !== BIOME.forest) rough++;
      }
    }
    return rough < samples * roughness;
  };
  // The city first, as big as there's room for.
  for (const blocks of [{ u: 5, v: 4 }, { u: 4, v: 3 }, { u: 3, v: 3 }]) {
    for (let k = 0; k < 1500 * SCALE && towns.length === 0; k++) {
      const t: Town = { x: 1500 + rand() * (SIZE - 3000), y: 1500 + rand() * (SIZE - 3000), angle: rand() * Math.PI, blocks, city: true, parks: [] };
      if (!fits(t, 0.25)) continue;
      // A few blocks for parks, out from the middle (where the towers are), and not the square or the church's.
      for (let tries = 0; tries < 60 && t.parks!.length < 3; tries++) {
        const i = Math.floor(rand() * blocks.u * 2) - blocks.u;
        const j = Math.floor(rand() * blocks.v * 2) - blocks.v;
        if (Math.abs(i + 0.5) < 2 && Math.abs(j + 0.5) < 2) continue;
        if (t.parks!.some((q) => Math.abs(q.i - i) + Math.abs(q.j - j) < 3)) continue;
        t.parks!.push({ i, j });
      }
      towns.push(t);
    }
    if (towns.length > 0) break;
  }
  for (let k = 0; k < 1500 * SCALE && towns.length < Math.round(SCALE / 2); k++) {
    const t: Town = { x: 800 + rand() * (SIZE - 1600), y: 800 + rand() * (SIZE - 1600), angle: rand() * Math.PI, blocks: { u: rand() < 0.5 ? 3 : 2, v: 2 } };
    if (fits(t, 0.15)) towns.push(t);
  }
  return towns;
}

/** A town's streets: a line along each row and down each column of its grid. */
/** A town's streets (in the city, its two main streets are avenues). */
function townStreets(t: Town): { path: Vec2[]; kind: RoadKind }[] {
  const halfU = t.blocks.u * BLOCK.w;
  const halfV = t.blocks.v * BLOCK.h;
  const streets: { path: Vec2[]; kind: RoadKind }[] = [];
  const kind = (main: boolean): RoadKind => (main && t.city ? 'avenue' : 'street');
  for (let j = -t.blocks.v; j <= t.blocks.v; j++) streets.push({ path: [townPoint(t, -halfU, j * BLOCK.h), townPoint(t, halfU, j * BLOCK.h)], kind: kind(j === 0) });
  for (let i = -t.blocks.u; i <= t.blocks.u; i++) streets.push({ path: [townPoint(t, i * BLOCK.w, -halfV), townPoint(t, i * BLOCK.w, halfV)], kind: kind(i === 0) });
  return streets;
}

/**
 * Where the roads meet: where one comes up to another and joins it (or
 * leaves it), or crosses it. (So the drawing can make a proper junction of
 * it, with no lines painted across.)
 */
function findJunctions(island: Island): Junction[] {
  const GAP = 8;
  const net = new Network();
  island.tracks.forEach((t, k) => net.add(resample(t, GAP), k));
  const rank: Record<RoadKind, number> = { track: 0, road: 1, street: 2, avenue: 3 };
  const found: Junction[] = [];
  const add = (p: Vec2, kinds: RoadKind[]) => {
    if (found.some((j) => Math.abs(j.x - p.x) < 40 && Math.abs(j.y - p.y) < 40)) return;
    found.push({ x: p.x, y: p.y, kind: kinds.reduce((a, b) => (rank[b] > rank[a] ? b : a)) });
  };
  island.tracks.forEach((track, k) => {
    const pts = resample(track, GAP);
    let other: number | null = null;
    pts.forEach((p, n) => {
      const near = net.nearestOther(p, k, ROAD_WIDTHS[island.roadKinds[k]] / 2 + 2);
      const at = near?.track ?? null;
      // Onto another road, or off it.
      if ((at === null) !== (other === null) && n > 0) add(at !== null ? p : pts[n - 1], [island.roadKinds[k], island.roadKinds[(at ?? other)!]]);
      // Its very ends, if they're on another road.
      else if (at !== null && (n === 0 || n === pts.length - 1)) add(p, [island.roadKinds[k], island.roadKinds[at]]);
      other = at;
    });
  });
  return found;
}

/**
 * Tracks out to the nearest road from the places that need one (farms,
 * campsites, forestry, the beaches, the ski lifts), found the easy way (a
 * wooden bridge's put in where one crosses a river). Anything small that was
 * in the way is cleared off it.
 */
function accessTracks(island: Island, costs: Float32Array, sites: { x: number; y: number; trim: number }[]): void {
  const dry = Float32Array.from(costs);
  // Round the buildings and anything else solid, and the campsites and sunshades, not through them.
  const solids = new Uint8Array(STEPS * STEPS);
  const solidNear = new Map<number, ThingSpec[]>();
  for (const t of island.things) {
    const solid = KINDS[t.kind].solid;
    if (solid) {
      const key = Math.floor(t.x / 128) * 4096 + Math.floor(t.y / 128);
      const list = solidNear.get(key);
      if (list) list.push(t);
      else solidNear.set(key, [t]);
    }
    if (!solid && t.kind !== 'tent' && t.kind !== 'campfire' && t.kind !== 'parasol') continue;
    // (With room for the track's own width either side.)
    const r = KINDS[t.kind].r + 40;
    for (let gy = Math.floor((t.y - r) / STEP); gy <= Math.floor((t.y + r) / STEP); gy++) {
      for (let gx = Math.floor((t.x - r) / STEP); gx <= Math.floor((t.x + r) / STEP); gx++) {
        if (gx < 0 || gy < 0 || gx >= STEPS || gy >= STEPS) continue;
        // (The roads themselves stay open, even between the houses, so a track can always join one.)
        if (island.roads[cellOf((gx + 0.5) * STEP, (gy + 0.5) * STEP)]) continue;
        dry[gy * STEPS + gx] = Infinity;
        if (solid) solids[gy * STEPS + gx] = 1;
      }
    }
  }
  const network = new Network();
  island.tracks.forEach((t, k) => network.add(resample(t, 24), k));
  const before = island.tracks.length;
  for (const site of sites) {
    let target: Vec2 | null = null;
    for (const reach of [300, 800, 1600, 3000, 6000]) {
      // (Not onto a bridge.)
      target = network.nearestOther(site, -1, reach, (q) => biomeAt(island, q.x, q.y) !== BIOME.river)?.p ?? null;
      if (target) break;
    }
    if (!target || Math.hypot(target.x - site.x, target.y - site.y) < site.trim + 30) continue;
    // (Out from the place itself, though: clear round it while looking.)
    const clear: [number, number][] = [];
    const r = site.trim + 60;
    for (let gy = Math.floor((site.y - r) / STEP); gy <= Math.floor((site.y + r) / STEP); gy++) {
      for (let gx = Math.floor((site.x - r) / STEP); gx <= Math.floor((site.x + r) / STEP); gx++) {
        const i = gy * STEPS + gx;
        if (gx < 0 || gy < 0 || gx >= STEPS || gy >= STEPS || dry[i] !== Infinity) continue;
        const d = Math.hypot((gx + 0.5) * STEP - site.x, (gy + 0.5) * STEP - site.y);
        // (Right by where it starts, even past something solid, so it can always get out.)
        if (d > r || costs[i] === Infinity || (solids[i] && d > 24)) continue;
        clear.push([i, dry[i]]);
        dry[i] = costs[i];
      }
    }
    // A few tries: if the track would clip something standing (it's been rounded off, and may cut a corner), it's
    // steered wider round that and found again.
    let track: Vec2[] | null = null;
    for (let attempt = 0; attempt < 3 && !track; attempt++) {
      const path = findPath(island, dry, site, target);
      if (!path) break;
      const kept = path.filter((p) => Math.hypot(p.x - site.x, p.y - site.y) >= site.trim);
      if (kept.length < 2) break;
      // (Laid onto the road it joins where it runs along it.)
      const laid = network.snap(smooth(kept));
      const clipped: ThingSpec[] = [];
      for (const p of laid) {
        // (Where it's on a road that's already there, whatever's beside it was put there knowing.)
        if (network.nearestOther(p, -1, 1)) continue;
        for (let gx = Math.floor(p.x / 128) - 1; gx <= Math.floor(p.x / 128) + 1; gx++) {
          for (let gy = Math.floor(p.y / 128) - 1; gy <= Math.floor(p.y / 128) + 1; gy++) {
            for (const t of solidNear.get(gx * 4096 + gy) ?? []) {
              if (!clipped.includes(t) && Math.hypot(t.x - p.x, t.y - p.y) < KINDS[t.kind].r + ROAD_WIDTH / 2 + CELL * 1.5) clipped.push(t);
            }
          }
        }
      }
      if (clipped.length === 0) track = laid;
      for (const t of clipped) {
        const wide = KINDS[t.kind].r + 90;
        for (let gy = Math.floor((t.y - wide) / STEP); gy <= Math.floor((t.y + wide) / STEP); gy++) {
          for (let gx = Math.floor((t.x - wide) / STEP); gx <= Math.floor((t.x + wide) / STEP); gx++) {
            const i = gy * STEPS + gx;
            if (gx < 0 || gy < 0 || gx >= STEPS || gy >= STEPS || dry[i] === Infinity) continue;
            if (Math.hypot((gx + 0.5) * STEP - site.x, (gy + 0.5) * STEP - site.y) < 24) continue;
            clear.push([i, dry[i]]);
            dry[i] = Infinity;
          }
        }
      }
    }
    for (const [i, c] of clear.reverse()) dry[i] = c;
    if (!track) continue;
    network.add(resample(track, 24), island.tracks.length);
    island.tracks.push(track);
    island.roadKinds.push('track');
    markRoad(island, track, 'track');
  }
  if (island.tracks.length === before) return;
  island.things = island.things.filter((t) => KINDS[t.kind].solid || KINDS[t.kind].material === 'bridge' || !island.roads[cellOf(t.x, t.y)]);
}

/** Cost of laying railway across each kind of land: it keeps low and level (no snow, no sea; a bridge over a river). */
const RAIL_COST: Record<Biome, number> = {
  [BIOME.deep]: Infinity,
  [BIOME.shallow]: Infinity,
  [BIOME.beach]: 2,
  [BIOME.grass]: 1,
  [BIOME.forest]: 1.6,
  [BIOME.hills]: 4,
  [BIOME.rock]: 14,
  [BIOME.snow]: Infinity,
  [BIOME.river]: 12,
};

/**
 * The railway: a loop round the towns (the city among them), in the order
 * that makes the shortest loop, with a station beside each, on the side
 * facing along the line. Laid low and level, round the towns rather than
 * through them, and smoothed into long curves. (Null if there aren't two
 * towns to join.)
 */
function layRailway(island: Island, costs: Float32Array): Railway | null {
  const towns = island.towns.map((t, i) => ({ t, i }));
  if (towns.length < 2) return null;
  const rail = Float32Array.from(costs, (c, k) => (c === Infinity ? Infinity : RAIL_COST[biomeAt(island, ((k % STEPS) + 0.5) * STEP, (Math.floor(k / STEPS) + 0.5) * STEP)]));
  // The order round: nearest neighbours, then untangled (2-opt).
  const order = [0];
  const left = new Set(towns.map((_, k) => k).slice(1));
  while (left.size > 0) {
    const last = towns[order[order.length - 1]].t;
    let best = -1;
    for (const k of left) if (best < 0 || Math.hypot(towns[k].t.x - last.x, towns[k].t.y - last.y) < Math.hypot(towns[best].t.x - last.x, towns[best].t.y - last.y)) best = k;
    order.push(best);
    left.delete(best);
  }
  const d = (a: number, b: number) => Math.hypot(towns[a].t.x - towns[b].t.x, towns[a].t.y - towns[b].t.y);
  for (let improved = true, rounds = 0; improved && rounds < 50; rounds++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 2; j < order.length; j++) {
        const a = order[i];
        const b = order[i + 1];
        const c = order[j];
        const e = order[(j + 1) % order.length];
        if (e === a) continue;
        if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 1) {
          order.splice(i + 1, j - i, ...order.slice(i + 1, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  // Each town's station: beside it, on the side facing between the towns before and after it.
  const stops: { p: Vec2; town: number }[] = [];
  order.forEach((k, n) => {
    const { t } = towns[k];
    const prev = towns[order[(n + order.length - 1) % order.length]].t;
    const next = towns[order[(n + 1) % order.length]].t;
    const want = { x: (prev.x + next.x) / 2 - t.x, y: (prev.y + next.y) / 2 - t.y };
    const halfU = t.blocks.u * BLOCK.w + 140;
    const halfV = t.blocks.v * BLOCK.h + 140;
    const sides = [townPoint(t, halfU, 0), townPoint(t, -halfU, 0), townPoint(t, 0, halfV), townPoint(t, 0, -halfV)].sort(
      (a, b) => (b.x - t.x) * want.x + (b.y - t.y) * want.y - ((a.x - t.x) * want.x + (a.y - t.y) * want.y),
    );
    const side = sides.find((p) => rail[Math.floor(p.y / STEP) * STEPS + Math.floor(p.x / STEP)] !== Infinity);
    if (side) stops.push({ p: side, town: towns[k].i });
  });
  if (stops.length < 2) return null;
  // The way between each station and the next (skipping any that can't be reached).
  const raw: Vec2[] = [];
  const kept: typeof stops = [];
  for (let n = 0; n < stops.length; n++) {
    const from = stops[n];
    let path: Vec2[] | null = null;
    for (let m = 1; m < stops.length && !path; m++) {
      const to = stops[(n + m) % stops.length];
      path = findPath(island, rail, from.p, to.p, false);
      if (path) {
        kept.push(from);
        raw.push(...path.slice(0, -1));
        n += m - 1;
      }
    }
    if (!path) break;
  }
  if (kept.length < 2) return null;
  // Smoothed all the way round into long curves (more passes than a road).
  let line = raw.filter((_, k) => k % 2 === 0);
  for (let pass = 0; pass < 4; pass++) {
    const next: Vec2[] = [];
    for (let k = 0; k < line.length; k++) {
      const a = line[k];
      const b = line[(k + 1) % line.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    line = next;
  }
  const at = [0];
  for (let k = 1; k <= line.length; k++) at.push(at[k - 1] + Math.hypot(line[k % line.length].x - line[k - 1].x, line[k % line.length].y - line[k - 1].y));
  const railway: Railway = { line, at, stations: [] };
  // Each station where the line passes nearest its stop.
  for (const stop of kept) {
    let best = 0;
    for (let k = 1; k < line.length; k++) if (Math.hypot(line[k].x - stop.p.x, line[k].y - stop.p.y) < Math.hypot(line[best].x - stop.p.x, line[best].y - stop.p.y)) best = k;
    const pose = railPose(railway, at[best]);
    railway.stations.push({ x: pose.x, y: pose.y, angle: pose.angle, at: at[best], town: stop.town, side: 1 });
  }
  railway.stations.sort((a, b) => a.at - b.at);
  // Kept clear of things.
  for (const p of resample([...line, line[0]], CELL / 2)) {
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < COLS && py < COLS && Math.hypot((px + 0.5) * CELL - p.x, (py + 0.5) * CELL - p.y) < 34) island.rails[py * COLS + px] = 1;
      }
    }
  }
  return railway;
}

/** Stone bridges carrying the railway over the rivers. */
function railBridges(island: Island): ThingSpec[] {
  const r = island.railway;
  if (!r) return [];
  const bridges: ThingSpec[] = [];
  const pts = resample([...r.line, r.line[0]], 8);
  let start = -1;
  for (let i = 0; i < pts.length; i++) {
    const wet = biomeAt(island, pts[i].x, pts[i].y) === BIOME.river;
    if (wet && start < 0) start = i;
    if ((!wet || i === pts.length - 1) && start >= 0) {
      const a = pts[Math.max(0, start - 2)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      bridges.push({ kind: 'railbridge', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: Math.atan2(b.y - a.y, b.x - a.x), variant: bridges.length, length: Math.hypot(b.x - a.x, b.y - a.y) + 30 });
      start = -1;
    }
  }
  return bridges;
}

/** Points along a line every `gap` px or so. */
function resample(line: Vec2[], gap: number): Vec2[] {
  const out: Vec2[] = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / gap));
    for (let s = 1; s <= n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  return out;
}

/** The roads laid so far, as points looked up by area: to find the nearest, and to snap new roads onto old where they run together. */
class Network {
  private readonly cells = new Map<number, { p: Vec2; track: number }[]>();

  add(points: Vec2[], track: number): void {
    for (const p of points) {
      const key = Math.floor(p.x / 64) * 4096 + Math.floor(p.y / 64);
      const list = this.cells.get(key);
      if (list) list.push({ p, track });
      else this.cells.set(key, [{ p, track }]);
    }
  }

  /** The nearest point within `reach` px that's on a different road from `not`. */
  nearestOther(p: Vec2, not: number, reach: number, ok: (q: Vec2) => boolean = () => true): { p: Vec2; track: number } | null {
    let best: { p: Vec2; track: number } | null = null;
    let bestD = reach;
    for (let gx = Math.floor((p.x - reach) / 64); gx <= Math.floor((p.x + reach) / 64); gx++) {
      for (let gy = Math.floor((p.y - reach) / 64); gy <= Math.floor((p.y + reach) / 64); gy++) {
        for (const q of this.cells.get(gx * 4096 + gy) ?? []) {
          if (q.track === not || !ok(q.p)) continue;
          const d = Math.hypot(q.p.x - p.x, q.p.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
    }
    return best;
  }

  /**
   * A new road laid onto the old where it runs along beside one (a stretch
   * of it, not just crossing), so they're one road there, branching where
   * they part.
   */
  snap(path: Vec2[]): Vec2[] {
    const near = path.map((p) => this.nearestOther(p, -1, 30));
    const out: Vec2[] = [];
    let k = 0;
    while (k < path.length) {
      let end = k;
      while (end < path.length && (near[end] !== null) === (near[k] !== null)) end++;
      const along = near[k] !== null && end - k >= 4;
      for (let n = k; n < end; n++) {
        const q = along && n > 0 && n < path.length - 1 ? near[n]!.p : path[n];
        const last = out[out.length - 1];
        // (The very end always stays where it was.)
        if (n === path.length - 1 && last && Math.hypot(last.x - q.x, last.y - q.y) <= 2) out[out.length - 1] = q;
        else if (!last || Math.hypot(last.x - q.x, last.y - q.y) > 2) out.push(q);
      }
      k = end;
    }
    return out;
  }
}

// --- Rivers ---------------------------------------------------------------------------

/**
 * Rivers: from springs up in the hills, downhill all the way to the sea
 * (over the odd rise, or into another river), winding a little, and wider
 * as they go. Each is cut into the land: water down the middle, its banks
 * sloping down to it.
 */
function carveRivers(island: Island, rand: () => number): River[] {
  const { heights } = island;
  const rivers: River[] = [];
  for (let tries = 0; tries < 800 * SCALE && rivers.length < 3 * SCALE; tries++) {
    let cx = Math.floor(rand() * COLS);
    let cy = Math.floor(rand() * COLS);
    const h0 = heights[cy * COLS + cx];
    if (h0 < 0.38 || h0 > 0.66) continue;
    if (rivers.some((r) => Math.hypot(r.path[0].x - (cx + 0.5) * CELL, r.path[0].y - (cy + 0.5) * CELL) < 1400)) continue;
    const cells: Vec2[] = [];
    const seen = new Set<number>();
    let climbs = 0;
    let reached = false;
    for (let step = 0; step < 2000; step++) {
      const i = cy * COLS + cx;
      cells.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL });
      seen.add(i);
      if (heights[i] < -0.03 || island.biomes[i] === BIOME.river) {
        reached = true;
        break;
      }
      let best = -1;
      let bestH = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if ((dx === 0 && dy === 0) || nx < 1 || ny < 1 || nx >= COLS - 1 || ny >= COLS - 1) continue;
          const n = ny * COLS + nx;
          if (seen.has(n)) continue;
          const h = heights[n] + rand() * 0.006;
          if (h < bestH) {
            bestH = h;
            best = n;
          }
        }
      }
      if (best < 0) break;
      if (bestH > heights[i] && ++climbs > 80) break;
      cx = best % COLS;
      cy = Math.floor(best / COLS);
    }
    if (!reached || cells.length < 50) continue;
    const path = smooth(cells);
    const widths = path.map((_, k) => 26 + (44 * k) / path.length);
    carve(island, path, widths);
    rivers.push({ path, widths });
  }
  if (rivers.length > 0) smoothBanks(island);
  return rivers;
}

/** Softens the land along the rivers, so the banks slope evenly down to the water (and keeps the water water). */
function smoothBanks(island: Island): void {
  const { heights, biomes, moisture } = island;
  const near = new Uint8Array(COLS * COLS);
  for (let i = 0; i < biomes.length; i++) {
    if (biomes[i] !== BIOME.river) continue;
    const cx = i % COLS;
    const cy = Math.floor(i / COLS);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x > 0 && y > 0 && x < COLS - 1 && y < COLS - 1) near[y * COLS + x] = 1;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = Float32Array.from(heights);
    for (let i = 0; i < near.length; i++) {
      if (!near[i]) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += heights[i + dy * COLS + dx];
      next[i] = sum / 9;
    }
    for (let i = 0; i < near.length; i++) {
      if (!near[i] || biomes[i] === BIOME.deep || biomes[i] === BIOME.shallow) continue;
      if (biomes[i] === BIOME.river) heights[i] = Math.min(next[i], -0.025);
      else {
        heights[i] = Math.max(next[i], 0.004);
        biomes[i] = biomeFor(heights[i], moisture[i]);
      }
    }
  }
}

const BANK = 30;

function carve(island: Island, path: Vec2[], widths: number[]): void {
  const { heights, biomes, moisture } = island;
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const half = widths[k] / 2;
    const reach = Math.ceil((half + BANK) / CELL) + 1;
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= COLS || py >= COLS) continue;
        const i = py * COLS + px;
        const d = Math.hypot((px + 0.5) * CELL - p.x, (py + 0.5) * CELL - p.y);
        const sea = biomes[i] === BIOME.deep || biomes[i] === BIOME.shallow;
        if (d < half) {
          heights[i] = Math.min(heights[i], -0.03 - 0.05 * (1 - d / half));
          if (!sea) biomes[i] = BIOME.river;
        } else if (d < half + BANK && biomes[i] !== BIOME.river && !sea) {
          heights[i] = Math.min(heights[i], 0.012 + ((d - half) / BANK) * 0.06);
          biomes[i] = biomeFor(heights[i], moisture[i]);
        }
      }
    }
  }
}

/** Bridges where the roads and tracks cross the rivers: stone on the roads and streets, wooden on the tracks. */
function findBridges(island: Island): ThingSpec[] {
  const bridges: ThingSpec[] = [];
  island.tracks.forEach((track, k) => {
    let start = -1;
    for (let i = 0; i < track.length; i++) {
      const wet = biomeAt(island, track[i].x, track[i].y) === BIOME.river;
      if (wet && start < 0) start = i;
      if ((!wet || i === track.length - 1) && start >= 0) {
        // From the last dry point before it to the first after, and a bit onto each bank.
        const a = track[Math.max(0, start - 1)];
        const b = track[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y) + 36;
        bridges.push({
          kind: island.roadKinds[k] === 'track' ? 'bridge' : 'stonebridge',
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
          variant: bridges.length,
          length,
        });
        start = -1;
      }
    }
  });
  return bridges;
}

const STEP = 32;
const STEPS = SIZE / STEP;

/** Cost of driving a track across each kind of land (Infinity: it can't). */
const ROAD_COST: Record<Biome, number> = {
  [BIOME.deep]: Infinity,
  [BIOME.shallow]: Infinity,
  [BIOME.beach]: 2,
  [BIOME.grass]: 1,
  [BIOME.forest]: 2.2,
  [BIOME.hills]: 3.5,
  [BIOME.rock]: 9,
  [BIOME.snow]: Infinity,
  // Rivers: a bridge, so only where it's worth it.
  [BIOME.river]: 7,
};

/** Cost of walking a footpath across each kind of land (no further than the shore, never across a river). */
const FOOT_COST: Record<Biome, number> = {
  [BIOME.deep]: Infinity,
  [BIOME.shallow]: Infinity,
  [BIOME.beach]: 1.5,
  [BIOME.grass]: 1,
  [BIOME.forest]: 1.1,
  [BIOME.hills]: 1.4,
  [BIOME.rock]: 2.2,
  [BIOME.snow]: 3,
  [BIOME.river]: Infinity,
};

/** The cost of a track across each square of the path-finding grid. */
function roadCosts(island: Island): Float32Array {
  const costs = new Float32Array(STEPS * STEPS);
  for (let y = 0; y < STEPS; y++) {
    for (let x = 0; x < STEPS; x++) costs[y * STEPS + x] = ROAD_COST[biomeAt(island, (x + 0.5) * STEP, (y + 0.5) * STEP)];
  }
  return costs;
}

/** The squares of the biggest stretch of land a track can cross (1), so every village can be joined to every other. */
function mainland(costs: Float32Array): Uint8Array {
  const label = new Int32Array(STEPS * STEPS).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < costs.length; start++) {
    if (label[start] !== -1 || costs[start] === Infinity) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size++;
      const cx = cur % STEPS;
      const cy = Math.floor(cur / STEPS);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= STEPS || ny >= STEPS) continue;
        const n = ny * STEPS + nx;
        if (label[n] !== -1 || costs[n] === Infinity) continue;
        label[n] = id;
        stack.push(n);
      }
    }
    sizes.push(size);
  }
  const biggest = sizes.indexOf(Math.max(...sizes));
  return Uint8Array.from(label, (l) => (l === biggest ? 1 : 0));
}

/**
 * The search's working space, kept between searches (the grid's big, and
 * each search only touches a little of it): a square's entries count only if
 * it's been reached in this search (`seen` holds the search's number).
 */
const search = { cost: new Float32Array(0), came: new Int32Array(0), seen: new Int32Array(0), done: new Int32Array(0), id: 0 };

function findPath(island: Island, costs: Float32Array, from: Vec2, to: Vec2, shareRoads = true): Vec2[] | null {
  const idx = (x: number, y: number) => y * STEPS + x;
  const sx = Math.floor(from.x / STEP);
  const sy = Math.floor(from.y / STEP);
  const tx = Math.floor(to.x / STEP);
  const ty = Math.floor(to.y / STEP);
  if (search.cost.length !== STEPS * STEPS) {
    search.cost = new Float32Array(STEPS * STEPS);
    search.came = new Int32Array(STEPS * STEPS);
    search.seen = new Int32Array(STEPS * STEPS);
    search.done = new Int32Array(STEPS * STEPS);
  }
  const id = ++search.id;
  const { cost, came, seen, done } = search;
  const reach = (n: number) => {
    if (seen[n] !== id) {
      seen[n] = id;
      cost[n] = Infinity;
      came[n] = -1;
    }
  };
  const heap = new Heap();
  reach(idx(sx, sy));
  cost[idx(sx, sy)] = 0;
  heap.push(idx(sx, sy), 0);
  const goal = idx(tx, ty);
  // (A search that's gone on this long isn't going to get there: give up.)
  let budget = 250_000;
  while (heap.size > 0 && budget-- > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (done[cur] === id) continue;
    done[cur] = id;
    const cx = cur % STEPS;
    const cy = Math.floor(cur / STEPS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= STEPS || ny >= STEPS) continue;
        const n0 = ny * STEPS + nx;
        // (The goal itself can always be stepped onto, even if it's on the edge of somewhere roads don't go.)
        const terrain = n0 === goal ? 1 : costs[n0];
        if (terrain === Infinity) continue;
        // Not cutting across a corner of water.
        if (dx !== 0 && dy !== 0 && n0 !== goal && (costs[cy * STEPS + nx] === Infinity || costs[ny * STEPS + cx] === Infinity)) continue;
        // Existing tracks are cheap, so they share the way.
        const shared = shareRoads && island.roads[cellOf((nx + 0.5) * STEP, (ny + 0.5) * STEP)] ? 0.35 : 1;
        const n = idx(nx, ny);
        reach(n);
        const c = cost[cur] + terrain * shared * (dx !== 0 && dy !== 0 ? 1.414 : 1);
        if (c < cost[n]) {
          cost[n] = c;
          came[n] = cur;
          heap.push(n, c + Math.hypot(tx - nx, ty - ny) * 0.9);
        }
      }
    }
  }
  reach(goal);
  if (came[goal] === -1) return null;
  const path: Vec2[] = [];
  for (let at = goal; at !== -1; at = came[at]) path.push({ x: ((at % STEPS) + 0.5) * STEP, y: (Math.floor(at / STEPS) + 0.5) * STEP });
  path.reverse();
  path[0] = { x: from.x, y: from.y };
  path[path.length - 1] = { x: to.x, y: to.y };
  return path;
}

/** Rounds off a path's corners (and thins it out first, so it winds gently). */
function smooth(path: Vec2[]): Vec2[] {
  let pts = path.filter((_, k) => k % 3 === 0 || k === path.length - 1);
  for (let pass = 0; pass < 3; pass++) {
    const next: Vec2[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function markRoad(island: Island, track: Vec2[], kind: RoadKind): void {
  // A town's streets (and the city's avenues) are kept tight, for the buildings along them; out in the country, a margin either side.
  const within = ROAD_WIDTHS[kind] / 2 + (kind === 'street' || kind === 'avenue' ? 4 : CELL);
  const reach = Math.ceil(within / CELL) + 1;
  const within2 = within * within;
  for (let k = 0; k < track.length - 1; k++) {
    const a = track[k];
    const b = track[k + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
    if (steps === 0) continue;
    for (let s = 0; s <= steps; s++) {
      const x = a.x + ((b.x - a.x) * s) / steps;
      const y = a.y + ((b.y - a.y) * s) / steps;
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || py < 0 || px >= COLS || py >= COLS) continue;
          const ex = (px + 0.5) * CELL - x;
          const ey = (py + 0.5) * CELL - y;
          if (ex * ex + ey * ey < within2) island.roads[py * COLS + px] = 1;
        }
      }
    }
  }
}

function spawnPoint(island: Island): Island['spawn'] {
  const v = island.villages[0] ?? island.towns[0];
  const track = island.tracks.find((t) => Math.hypot(t[0].x - v?.x, t[0].y - v?.y) < 1) ?? island.tracks[0];
  if (track && track.length > 12) {
    // A little way out of the first village, along its track, somewhere clear.
    const clear = (p: Vec2) =>
      biomeAt(island, p.x, p.y) !== BIOME.river && !island.things.some((t) => KINDS[t.kind].solid && Math.hypot(t.x - p.x, t.y - p.y) < KINDS[t.kind].r + 40);
    let k = Math.min(track.length - 2, 14);
    while (k < track.length - 2 && !clear(track[k])) k++;
    const a = track[k];
    const b = track[k + 1];
    return { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  if (v) return { x: v.x, y: v.y, angle: 0 };
  // No villages (it can happen on a very mountainous island): the first dry land from the middle out.
  for (let r = 0; r < SIZE / 2; r += CELL) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = SIZE / 2 + Math.cos(a) * r;
      const y = SIZE / 2 + Math.sin(a) * r;
      const b = biomeAt(island, x, y);
      if (b === BIOME.grass || b === BIOME.beach) return { x, y, angle: 0 };
    }
  }
  return { x: SIZE / 2, y: SIZE / 2, angle: 0 };
}

// --- Putting things down ----------------------------------------------------------

const GRID = 128;
/** The squares the land's divided into for what it's given over to (see Placer.zones), px. */
const ZONE = 32;
const ZONES = SIZE / ZONE;
const ZONE_KIND = { village: 1, town: 2, clear: 3 };
/** How far apart the patches of a field of crops or long grass are, px. */
export const FIELD_TILE = 40;

/** Places things on the island without them overlapping each other, the tracks or the water. */
class Placer {
  private readonly cells = new Map<number, ThingSpec[]>();
  /** Places kept clear of trees (campsites, forestry, the ski lifts and pistes). */
  private readonly clearings: { x: number; y: number; r: number }[] = [];
  /** Places that want a track out to the road: where, and how far short of the middle it should stop, px. */
  readonly sites: { x: number; y: number; trim: number }[] = [];
  /** Points along the footpaths, kept clear of trees. */
  private readonly trailPoints: Vec2[] = [];

  constructor(
    private readonly island: Island,
    private readonly rand: () => number,
  ) {}

  /** Puts a thing down if it fits: on dry land, off the tracks, clear of everything else by `gap` px. */
  put(kind: ThingKind, x: number, y: number, angle: number, gap = 4, onRoad = false, variant = Math.floor(this.rand() * 1000)): boolean {
    const { r } = KINDS[kind];
    if (x < r || y < r || x > SIZE - r || y > SIZE - r) return false;
    const water = kind === 'boat' || kind === 'trawler';
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const b = biomeAt(this.island, x + dx, y + dy);
      const wet = b === BIOME.deep || b === BIOME.shallow || b === BIOME.river;
      if (wet !== water && !(water && b === BIOME.beach)) return false;
      if (!onRoad && this.island.roads[cellOf(x + dx, y + dy)]) return false;
      if (this.island.rails[cellOf(x + dx, y + dy)]) return false;
    }
    // (Far enough out to catch the biggest thing, a barn.)
    if (this.near(x, y, r + gap + KINDS.barn.r).some((t) => Math.hypot(t.x - x, t.y - y) < r + KINDS[t.kind].r + gap)) return false;
    this.add({ kind, x, y, angle, variant });
    return true;
  }

  add(t: ThingSpec): void {
    this.island.things.push(t);
    const key = Math.floor(t.x / GRID) * 1000 + Math.floor(t.y / GRID);
    const list = this.cells.get(key);
    if (list) list.push(t);
    else this.cells.set(key, [t]);
  }

  private near(x: number, y: number, reach: number): ThingSpec[] {
    const found: ThingSpec[] = [];
    for (let gx = Math.floor((x - reach) / GRID); gx <= Math.floor((x + reach) / GRID); gx++) {
      for (let gy = Math.floor((y - reach) / GRID); gy <= Math.floor((y + reach) / GRID); gy++) found.push(...(this.cells.get(gx * 1000 + gy) ?? []));
    }
    return found;
  }

  /**
   * A town: terraced houses along its streets, facing them (shops along the
   * main street), a church, a square with a fountain and cars parked round it.
   * The city has towers in its middle, office blocks round them, shops all
   * along its avenues, and parks with trees, paths, benches and a fountain.
   */
  town(t: Town): void {
    const { rand } = this;
    // How far back from a street (or avenue) the buildings stand.
    const edge = (line: number) => (t.city && line === 0 ? ROAD_WIDTHS.avenue : ROAD_WIDTHS.street) / 2 + 10;
    for (let i = -t.blocks.u; i < t.blocks.u; i++) {
      for (let j = -t.blocks.v; j < t.blocks.v; j++) {
        const u0 = i * BLOCK.w;
        const v0 = j * BLOCK.h;
        const mid = townPoint(t, u0 + BLOCK.w / 2, v0 + BLOCK.h / 2);
        const left = u0 + edge(i);
        const right = u0 + BLOCK.w - edge(i + 1);
        const top = v0 + edge(j);
        const bottom = v0 + BLOCK.h - edge(j + 1);
        if (i === 0 && j === 0) {
          // The square.
          this.put('fountain', mid.x, mid.y, 0, 4);
          for (const [du, dv] of [[-55, -60], [-20, -60], [20, 60], [55, 60]]) {
            const p = townPoint(t, u0 + BLOCK.w / 2 + du, v0 + BLOCK.h / 2 + dv);
            if (rand() < 0.7) this.put('car', p.x, p.y, t.angle + Math.PI / 2, 2);
          }
          if (t.city) {
            for (const du of [-50, 50]) {
              const p = townPoint(t, u0 + BLOCK.w / 2 + du, v0 + BLOCK.h / 2);
              this.put('bench', p.x, p.y, t.angle + Math.PI / 2, 2);
            }
          }
          continue;
        }
        if (i === -1 && j === 0) {
          this.put('church', mid.x, mid.y, t.angle, 4);
          continue;
        }
        if (t.parks?.some((q) => q.i === i && q.j === j)) {
          this.park(t, left, top, right, bottom);
          continue;
        }
        // The city's middle: towers, then office blocks round them.
        const out = t.city ? Math.max(Math.abs(i + 0.5) / t.blocks.u, Math.abs(j + 0.5) / t.blocks.v) : 1;
        if (out < 0.45) {
          this.put('tower', mid.x, mid.y, t.angle + (rand() < 0.5 ? 0 : Math.PI / 2), 2);
          continue;
        }
        if (out < 0.75) {
          const w = KINDS.office.w;
          for (const du of [-(w / 2 + 3), w / 2 + 3]) {
            const p = townPoint(t, (left + right) / 2 + du, (top + bottom) / 2);
            this.put('office', p.x, p.y, t.angle + Math.PI / 2, 1);
          }
          continue;
        }
        // Two rows of buildings back to back, each facing its street (shops on the main ones).
        for (const [row, facing, line] of [[top, 0, j], [bottom, Math.PI, j + 1]] as const) {
          const main = line === 0 || (t.city && rand() < 0.4);
          const kind: ThingKind = main ? 'shop' : 'townhouse';
          const { w, h } = KINDS[kind];
          const depth = facing === 0 ? row + h / 2 : row - h / 2;
          for (let u = left + w / 2; u <= right - w / 2 + 1; u += w + 8) {
            const p = townPoint(t, u, depth);
            if (rand() < 0.92) this.put(kind, p.x, p.y, t.angle + facing, 2);
          }
        }
      }
    }
  }

  /** A park in a city block: trees round the edge and dotted about, a fountain in the middle, benches by the paths. */
  private park(t: Town, left: number, top: number, right: number, bottom: number): void {
    const { rand } = this;
    const at = (u: number, v: number) => townPoint(t, u, v);
    const mid = at((left + right) / 2, (top + bottom) / 2);
    this.put('fountain', mid.x, mid.y, 0, 4);
    for (let k = 0; k < 14; k++) {
      const p = at(left + 14 + rand() * (right - left - 28), top + 14 + rand() * (bottom - top - 28));
      if (Math.hypot(p.x - mid.x, p.y - mid.y) < 60) continue;
      this.put(rand() < 0.75 ? 'oak' : 'bush', p.x, p.y, rand() * Math.PI * 2, 4);
    }
    for (const [du, dv] of [[-30, -30], [30, 30], [-30, 30], [30, -30]]) {
      const p = at((left + right) / 2 + du * 1.6, (top + bottom) / 2 + dv);
      this.put('bench', p.x, p.y, t.angle + (du > 0 ? Math.PI / 4 : -Math.PI / 4), 2);
    }
  }


  /**
   * A village: houses round its green facing in, a barn with haystacks and a
   * fenced paddock out on the edge with a tractor, cars parked by the houses,
   * crates and barrels about, and in the first one a fuel depot.
   */
  village(v: Village, depot: boolean): void {
    const { rand } = this;
    const houses = 7 + Math.floor(rand() * 7);
    for (let k = 0, tries = 0; k < houses && tries < houses * 12; tries++) {
      const a = rand() * Math.PI * 2;
      const d = 100 + rand() * (v.r - 100);
      const x = v.x + Math.cos(a) * d;
      const y = v.y + Math.sin(a) * d;
      // Facing the green.
      if (this.put('house', x, y, a + Math.PI / 2 + (rand() - 0.5) * 0.3, 14)) {
        k++;
        if (rand() < 0.45) {
          const side = a + (rand() < 0.5 ? 0.5 : -0.5);
          this.put('car', v.x + Math.cos(side) * (d + 10), v.y + Math.sin(side) * (d + 10), a + Math.PI / 2, 6);
        }
        if (rand() < 0.4) this.put(rand() < 0.5 ? 'crate' : 'barrel', x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90, rand() * 6, 2);
      }
    }
    // The farm on the edge: a barn, haystacks, a tractor, and a paddock fenced off.
    const fa = rand() * Math.PI * 2;
    const farm = { x: v.x + Math.cos(fa) * (v.r + 70), y: v.y + Math.sin(fa) * (v.r + 70) };
    if (this.put('barn', farm.x, farm.y, fa + Math.PI / 2, 10)) {
      for (let k = 0; k < 5; k++) this.put('haystack', farm.x + (rand() - 0.5) * 220, farm.y + (rand() - 0.5) * 220, 0, 3);
      this.put('tractor', farm.x + Math.cos(fa + 1) * 90, farm.y + Math.sin(fa + 1) * 90, rand() * 6, 6);
      this.paddock(farm.x + Math.cos(fa) * 170, farm.y + Math.sin(fa) * 170, fa);
    }
    if (depot) {
      // Round the far side from the farm, wherever there's room.
      let da = fa + Math.PI;
      let dx = 0;
      let dy = 0;
      for (let k = 0; k < 16; k++, da += 0.4 * (k % 2 ? k : -k)) {
        dx = v.x + Math.cos(da) * (v.r + 60);
        dy = v.y + Math.sin(da) * (v.r + 60);
        if (this.put('fueltank', dx, dy, 0, 8)) break;
      }
      this.put('fueltank', dx + Math.cos(da + 1.6) * 80, dy + Math.sin(da + 1.6) * 80, 0, 8);
      this.put('truck', dx + Math.cos(da - 1.6) * 80, dy + Math.sin(da - 1.6) * 80, da, 6);
      for (let k = 0; k < 10; k++) this.put('barrel', dx + (rand() - 0.5) * 200, dy + (rand() - 0.5) * 200, 0, 2);
    }
    // A truck or two out on the tracks nearby.
    for (let k = 0; k < 2; k++) {
      const a = rand() * Math.PI * 2;
      this.put('truck', v.x + Math.cos(a) * (v.r + 30), v.y + Math.sin(a) * (v.r + 30), a + Math.PI / 2, 8);
    }
  }

  /** A square of fence, panel by panel. */
  private paddock(x: number, y: number, angle: number): void {
    const half = 90 + this.rand() * 40;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const panel = KINDS.fence.w;
    for (const side of [0, 1, 2, 3]) {
      const turn = angle + (side * Math.PI) / 2;
      for (let u = -half + panel / 2; u < half; u += panel) {
        // Each side, from its middle out; the corners line up.
        const [lu, lv] = side === 0 ? [u, -half] : side === 1 ? [half, u] : side === 2 ? [-u, half] : [-half, -u];
        if (side === 3 && Math.abs(u) < panel) continue; // the gate
        this.put('fence', x + c * lu - s * lv, y + s * lu + c * lv, turn, -6);
      }
    }
  }

  /** Boats pulled up in the shallows off the beaches. */
  boats(): void {
    for (let placed = 0, tries = 0; placed < 10 * SCALE && tries < 4000 * SCALE; tries++) {
      const x = this.rand() * SIZE;
      const y = this.rand() * SIZE;
      if (biomeAt(this.island, x, y) !== BIOME.shallow) continue;
      // With the beach close by: facing out to sea.
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        if (biomeAt(this.island, x + Math.cos(a) * 60, y + Math.sin(a) * 60) === BIOME.beach) {
          if (this.put('boat', x, y, a + Math.PI, 30)) placed++;
          break;
        }
      }
    }
  }

  /** The railway's stations: a station building beside each platform, on the town's side, and benches on the platform. */
  stations(): void {
    const r = this.island.railway;
    if (!r) return;
    for (const st of r.stations) {
      const t = this.island.towns[st.town];
      // Along the line a way, if the road out of town's in the way right by it.
      // (On the town's side if it'll go, else the other.)
      const tries = [0, 140, -140, 280, -280, 420, -420, 560, -560, 700, -700].flatMap((shift) => [
        { shift, flip: 1 },
        { shift, flip: -1 },
      ]);
      for (const { shift, flip } of tries) {
        const pose = railPose(r, st.at + shift);
        const nx = -Math.sin(pose.angle);
        const ny = Math.cos(pose.angle);
        const side = ((t.x - pose.x) * nx + (t.y - pose.y) * ny > 0 ? 1 : -1) * flip;
        if (!this.put('station', pose.x + nx * side * 62, pose.y + ny * side * 62, pose.angle, 4)) continue;
        const length = r.at[r.at.length - 1];
        Object.assign(st, { x: pose.x, y: pose.y, angle: pose.angle, at: (st.at + shift + length) % length, side });
        for (const along of [-50, 50]) {
          this.put('bench', pose.x + Math.cos(pose.angle) * along + nx * side * 30, pose.y + Math.sin(pose.angle) * along + ny * side * 30, pose.angle, 1);
        }
        break;
      }
    }
  }

  /**
   * A harbour's yard, quay and jetties: warehouses at the back, cranes on the
   * quay, stacks of containers either side of the way down the middle, crates
   * and barrels about, and jetties out into the water with boats tied up.
   */
  harbour(h: Harbour): void {
    const { rand } = this;
    const at = (u: number, v: number) => harbourPoint(h, u, v);
    const along = h.angle + Math.PI / 2;
    this.clearings.push({ ...at(0, YARD.depth / 2), r: YARD.half + 60 });
    for (const u of [-125, 125]) {
      const p = at(u, YARD.depth - 50);
      this.put('warehouse', p.x, p.y, h.angle, 4);
    }
    for (const u of [-165, 165]) {
      const p = at(u, 26);
      this.put('crane', p.x, p.y, h.angle, 4);
    }
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        for (let k = 0; k < 3; k++) {
          if (rand() < 0.2) continue;
          const p = at(side * (62 + k * 58), 82 + row * 30);
          this.put('container', p.x, p.y, along, 1);
        }
      }
    }
    for (let k = 0; k < 8; k++) {
      const p = at((rand() < 0.5 ? -1 : 1) * (40 + rand() * 170), 45 + rand() * 20);
      this.put(rand() < 0.5 ? 'crate' : 'barrel', p.x, p.y, rand() * 6, 2);
    }
    // The jetties, from just up on the quay out over the water, with boats along them.
    for (const u of [-100, 0, 100]) {
      const length = 170 + rand() * 110;
      const mid = at(u, (14 - length) / 2);
      const jetty: ThingSpec = { kind: 'jetty', x: mid.x, y: mid.y, angle: h.angle, variant: Math.floor(rand() * 1000), length: length + 14 };
      this.add(jetty);
      for (const side of [-1, 1]) {
        if (rand() < 0.3) continue;
        const kind: ThingKind = rand() < 0.5 ? 'trawler' : 'boat';
        const p = at(u + side * (KINDS[kind].h / 2 + 16), -length * (0.35 + rand() * 0.3));
        this.put(kind, p.x, p.y, h.angle + (rand() < 0.5 ? 0 : Math.PI), 2);
      }
    }
  }

  /**
   * A farm or two out from a village, by their fields: a farmhouse, a barn,
   * grain silos and haystacks round the yard, and two fields of crops in rows
   * (the combine harvester works the first, the tractor goes out to the other).
   */
  farms(v: Village): void {
    const { rand, island } = this;
    for (let n = 0, tries = 0, want = 1 + Math.floor(rand() * 2); n < want && tries < 24; tries++) {
      const a = rand() * Math.PI * 2;
      const d = v.r + 300 + rand() * 200;
      const x = v.x + Math.cos(a) * d;
      const y = v.y + Math.sin(a) * d;
      if (biomeAt(island, x, y) !== BIOME.grass || island.farms.some((f) => Math.hypot(f.x - x, f.y - y) < 900)) continue;
      const angle = rand() * Math.PI * 2;
      const at = (u: number, w: number) => ({ x: x + Math.cos(angle) * u - Math.sin(angle) * w, y: y + Math.sin(angle) * u + Math.cos(angle) * w });
      // (Only where its first field will be on open grass.)
      const first = at(0, 210);
      if (biomeAt(island, first.x, first.y) !== BIOME.grass) continue;
      const barn = at(60, -50);
      if (!this.put('barn', barn.x, barn.y, angle, 8)) continue;
      n++;
      const house = at(-70, -40);
      this.put('house', house.x, house.y, angle + Math.PI / 2, 8);
      for (const w of [-14, 22]) {
        const p = at(140, w);
        this.put('silo', p.x, p.y, 0, 2);
      }
      for (let k = 0; k < 3; k++) {
        const p = at(-30 + k * 40 + (rand() - 0.5) * 16, 40 + rand() * 20);
        this.put('haystack', p.x, p.y, 0, 3);
      }
      const farm: Farm = { x, y, angle, fields: [] };
      // (The track comes in at the back of the yard, behind the house and barn.)
      const gate = at(-10, -170);
      this.sites.push({ x: gate.x, y: gate.y, trim: 0 });
      for (const [fu, fw, cols, rows] of [[0, 210, 9, 5], [-420, 60, 6, 7]] as const) {
        const c = at(fu, fw);
        const field: Field = { x: c.x, y: c.y, angle, cols, rows };
        if (this.field(field)) farm.fields.push(field);
      }
      island.farms.push(farm);
    }
  }

  /** A field of crops in rows, patch by patch, all one crop; whether much of it fitted. */
  private field(f: Field): boolean {
    const variant = Math.floor(this.rand() * 1000);
    const c = Math.cos(f.angle);
    const s = Math.sin(f.angle);
    let placed = 0;
    for (let i = 0; i < f.cols; i++) {
      for (let j = 0; j < f.rows; j++) {
        const u = (i - (f.cols - 1) / 2) * FIELD_TILE;
        const w = (j - (f.rows - 1) / 2) * FIELD_TILE;
        const x = f.x + c * u - s * w;
        const y = f.y + s * u + c * w;
        if (biomeAt(this.island, x, y) === BIOME.grass && this.put('crop', x, y, f.angle, 2, false, variant)) placed++;
      }
    }
    return placed > (f.cols * f.rows) / 2;
  }


  /** Meadows of long grass out in the open, in rounded patches. */
  meadows(): void {
    const { rand, island } = this;
    const open = (x: number, y: number) => {
      const b = biomeAt(island, x, y);
      return b === BIOME.grass || b === BIOME.hills;
    };
    for (let placed = 0, tries = 0; placed < 6 * SCALE && tries < 600 * SCALE; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (!open(x, y) || this.nearPlaces(x, y, 250)) continue;
      const r = 110 + rand() * 130;
      const lobes = rand() * Math.PI * 2;
      let tiles = 0;
      for (let gy = -r; gy <= r; gy += FIELD_TILE) {
        for (let gx = -r; gx <= r; gx += FIELD_TILE) {
          if (Math.hypot(gx, gy) > r * (0.75 + 0.25 * Math.sin(Math.atan2(gy, gx) * 3 + lobes))) continue;
          const px = x + gx + (rand() - 0.5) * 6;
          const py = y + gy + (rand() - 0.5) * 6;
          if (open(px, py) && this.put('grass', px, py, rand() * Math.PI * 2, 0)) tiles++;
        }
      }
      if (tiles > 6) placed++;
    }
  }

  /**
   * Beaches with people on: a row of beach huts along the back of the sand
   * facing the sea, and sunshades with towels out in front of them.
   */
  beaches(): void {
    const { rand, island } = this;
    const resorts: Vec2[] = [];
    for (let placed = 0, tries = 0; placed < 8 * SCALE && tries < 3000 * SCALE; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (biomeAt(island, x, y) !== BIOME.beach || resorts.some((r) => Math.hypot(r.x - x, r.y - y) < 900)) continue;
      if (this.nearPlaces(x, y, 100)) continue;
      // Inland: uphill.
      const gx = heightAt(island.heights, x + 24, y) - heightAt(island.heights, x - 24, y);
      const gy = heightAt(island.heights, x, y + 24) - heightAt(island.heights, x, y - 24);
      if (Math.hypot(gx, gy) < 0.002) continue;
      const up = Math.atan2(gy, gx);
      const along = up + Math.PI / 2;
      // The back of the beach, where the sand gives out.
      let back = 0;
      while (back < 160 && biomeAt(island, x + Math.cos(up) * back, y + Math.sin(up) * back) === BIOME.beach) back += 8;
      const bx = x + Math.cos(up) * (back - 22);
      const by = y + Math.sin(up) * (back - 22);
      let huts = 0;
      const hutVariant = Math.floor(rand() * 1000);
      for (let k = -3; k <= 3; k++) {
        if (this.put('beachhut', bx + Math.cos(along) * k * 44, by + Math.sin(along) * k * 44, up + Math.PI, 3, false, hutVariant + k + 3)) huts++;
      }
      if (huts < 2) continue;
      resorts.push({ x, y });
      this.sites.push({ x: bx + Math.cos(up) * 90, y: by + Math.sin(up) * 90, trim: 0 });
      placed++;
      for (let k = 0, n = 6 + Math.floor(rand() * 6); k < 60 && n > 0; k++) {
        const u = (rand() - 0.5) * 360;
        const d = 45 + rand() * (back + 40);
        const px = bx + Math.cos(along) * u - Math.cos(up) * d;
        const py = by + Math.sin(along) * u - Math.sin(up) * d;
        if (biomeAt(island, px, py) === BIOME.beach && this.put('parasol', px, py, along + (rand() - 0.5) * 0.5, 8)) n--;
      }
    }
  }

  /** Campsites in clearings in the woods: tents round a campfire, and maybe the car they came in. */
  campsites(): void {
    const { rand } = this;
    for (let placed = 0, tries = 0; placed < 6 * SCALE && tries < 3000 * SCALE; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (!this.wooded(x, y, 130) || this.nearPlaces(x, y, 400) || this.clearings.some((c) => Math.hypot(c.x - x, c.y - y) < 800)) continue;
      if (!this.put('campfire', x, y, 0, 2)) continue;
      this.clearings.push({ x, y, r: 90 });
      this.sites.push({ x, y, trim: 85 });
      placed++;
      const tents = 2 + Math.floor(rand() * 3);
      const turn = rand() * Math.PI * 2;
      for (let k = 0; k < tents; k++) {
        const a = turn + (k / tents) * Math.PI * 2 + (rand() - 0.5) * 0.4;
        // Door to the fire.
        this.put('tent', x + Math.cos(a) * 52, y + Math.sin(a) * 52, a + Math.PI, 3);
      }
      if (rand() < 0.5) {
        const a = turn + Math.PI / tents;
        this.put('car', x + Math.cos(a) * 80, y + Math.sin(a) * 80, a + Math.PI / 2, 4);
      }
    }
  }

  /** Forestry clearings: a harvester at work, stacks of logs, stumps, and a truck to take them away. */
  forestry(): void {
    const { rand } = this;
    for (let placed = 0, tries = 0; placed < 4 * SCALE && tries < 3000 * SCALE; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (!this.wooded(x, y, 100) || this.nearPlaces(x, y, 400) || this.clearings.some((c) => Math.hypot(c.x - x, c.y - y) < 700)) continue;
      const angle = rand() * Math.PI * 2;
      if (!this.put('harvester', x, y, angle, 6)) continue;
      this.clearings.push({ x, y, r: 170 });
      // (The track comes in at the edge of the clearing, where the machinery isn't.)
      this.sites.push({ x: x + Math.cos(angle + 1) * 110, y: y + Math.sin(angle + 1) * 110, trim: 0 });
      placed++;
      for (let k = 0; k < 2; k++) {
        const a = angle + 2 + k * 1.3;
        this.put('logpile', x + Math.cos(a) * 95, y + Math.sin(a) * 95, angle + (rand() - 0.5) * 0.3, 6);
      }
      this.put('truck', x + Math.cos(angle - 1.8) * 120, y + Math.sin(angle - 1.8) * 120, angle + Math.PI / 2, 8);
      for (let k = 0; k < 16; k++) {
        const a = rand() * Math.PI * 2;
        const d = 50 + rand() * 120;
        this.put('stump', x + Math.cos(a) * d, y + Math.sin(a) * d, rand() * Math.PI * 2, 6);
      }
    }
  }

  /**
   * Ski lifts up the snowy peaks: a station just below the snow (with a
   * chalet by it) and one at the top, pylons between, and the piste kept clear beside it.
   */
  skiLifts(): Lift[] {
    const { rand, island } = this;
    const { heights } = island;
    const lifts: Lift[] = [];
    const step = 24;
    for (let tries = 0; tries < 3000 * SCALE && lifts.length < 2 * SCALE; tries++) {
      let x = rand() * SIZE;
      let y = rand() * SIZE;
      if (biomeAt(island, x, y) !== BIOME.snow) continue;
      // Up to the peak.
      for (let k = 0; k < 60; k++) {
        const gx = heightAt(heights, x + step, y) - heightAt(heights, x - step, y);
        const gy = heightAt(heights, x, y + step) - heightAt(heights, x, y - step);
        const g = Math.hypot(gx, gy);
        if (g < 1e-5) break;
        x += (gx / g) * step;
        y += (gy / g) * step;
      }
      const top = { x, y };
      if (lifts.some((l) => Math.hypot(l.top.x - x, l.top.y - y) < 1500)) continue;
      // Down the steepest way, till it's a little below the snow.
      let bx = x;
      let by = y;
      let below = 0;
      for (let k = 0; k < 70; k++) {
        const gx = heightAt(heights, bx + step, by) - heightAt(heights, bx - step, by);
        const gy = heightAt(heights, bx, by + step) - heightAt(heights, bx, by - step);
        const g = Math.hypot(gx, gy);
        if (g < 1e-5) break;
        bx -= (gx / g) * step;
        by -= (gy / g) * step;
        if (biomeAt(island, bx, by) !== BIOME.snow) below += step;
        if (below >= 120 && Math.hypot(bx - x, by - y) > 450) break;
      }
      const length = Math.hypot(bx - x, by - y);
      if (length < 450 || length > 1400) continue;
      const b = biomeAt(island, bx, by);
      if (b === BIOME.snow || b === BIOME.river || b <= BIOME.shallow) continue;
      // Straight up, over dry land all the way.
      const dir = Math.atan2(y - by, x - bx);
      let dry = true;
      for (let d = 0; d < length && dry; d += 40) {
        const lb = biomeAt(island, bx + Math.cos(dir) * d, by + Math.sin(dir) * d);
        if (lb === BIOME.river || lb <= BIOME.shallow) dry = false;
      }
      if (!dry || !this.put('liftstation', bx, by, dir, 6)) continue;
      this.put('liftstation', x, y, dir + Math.PI, 6);
      const side: 1 | -1 = rand() < 0.5 ? 1 : -1;
      const nx = -Math.sin(dir) * side;
      const ny = Math.cos(dir) * side;
      this.put('chalet', bx - nx * 110 - Math.cos(dir) * 30, by - ny * 110 - Math.sin(dir) * 30, dir, 6);
      for (let d = 150; d < length - 80; d += 150) this.put('lifttower', bx + Math.cos(dir) * d, by + Math.sin(dir) * d, dir, 2);
      for (let d = 0; d < length; d += 80) {
        const px = bx + Math.cos(dir) * d;
        const py = by + Math.sin(dir) * d;
        this.clearings.push({ x: px, y: py, r: 40 }, { x: px + nx * 160, y: py + ny * 160, r: 120 });
      }
      lifts.push({ bottom: { x: bx, y: by }, top, side });
      this.sites.push({ x: bx - Math.cos(dir) * 50, y: by - Math.sin(dir) * 50, trim: 0 });
    }
    return lifts;
  }

  /**
   * Footpaths: from the campsites, the villages by the woods and hills, and
   * the ski lifts' chalets, up to the tops of the hills and mountains round
   * about, and through the woods from one side to the other. Found the easy
   * way (round the steep rock, never across a river), and kept clear of trees.
   */
  trails(): Vec2[][] {
    const { rand, island } = this;
    const { heights } = island;
    const costs = new Float32Array(STEPS * STEPS);
    for (let y = 0; y < STEPS; y++) {
      for (let x = 0; x < STEPS; x++) costs[y * STEPS + x] = FOOT_COST[biomeAt(island, (x + 0.5) * STEP, (y + 0.5) * STEP)];
    }
    const climb = (x: number, y: number): Vec2 => {
      for (let k = 0; k < 60; k++) {
        const gx = heightAt(heights, x + 24, y) - heightAt(heights, x - 24, y);
        const gy = heightAt(heights, x, y + 24) - heightAt(heights, x, y - 24);
        const g = Math.hypot(gx, gy);
        if (g < 1e-5) break;
        x += (gx / g) * 24;
        y += (gy / g) * 24;
      }
      return { x, y };
    };
    // Where they start.
    const starts: Vec2[] = [];
    for (const t of island.things) if (t.kind === 'campfire' || t.kind === 'chalet') starts.push({ x: t.x, y: t.y });
    for (const v of island.villages) {
      const a = rand() * Math.PI * 2;
      const p = { x: v.x + Math.cos(a) * (v.r + 60), y: v.y + Math.sin(a) * (v.r + 60) };
      const b = biomeAt(island, p.x + Math.cos(a) * 500, p.y + Math.sin(a) * 500);
      if (b === BIOME.forest || b === BIOME.hills || b === BIOME.rock) starts.push(p);
    }
    const trails: Vec2[][] = [];
    const add = (from: Vec2, to: Vec2) => {
      if (Math.hypot(to.x - from.x, to.y - from.y) < 300) return;
      if (costs[Math.floor(to.y / STEP) * STEPS + Math.floor(to.x / STEP)] === Infinity) return;
      const path = findPath(island, costs, from, to);
      if (!path || path.length < 6) return;
      const trail = smooth(path);
      if (trail.some((p) => {
        const b = biomeAt(island, p.x, p.y);
        return b === BIOME.deep || b === BIOME.shallow || b === BIOME.river;
      })) return;
      trails.push(trail);
      for (const p of trail) this.trailPoints.push(p);
    };
    for (const s of starts) {
      if (costs[Math.floor(s.y / STEP) * STEPS + Math.floor(s.x / STEP)] === Infinity) continue;
      // Up to a top somewhere round about.
      for (let k = 0; k < 6; k++) {
        const a = rand() * Math.PI * 2;
        const d = 400 + rand() * 900;
        const top = climb(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
        if (heightAt(heights, top.x, top.y) > heightAt(heights, s.x, s.y) + 0.12 && Math.hypot(top.x - s.x, top.y - s.y) < 1800) {
          add(s, top);
          break;
        }
      }
    }
    // Walks through the woods.
    for (let placed = 0, tries = 0; placed < 2 * SCALE && tries < 400 * SCALE; tries++) {
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      if (!this.wooded(x, y, 60)) continue;
      const a = rand() * Math.PI * 2;
      const d = 700 + rand() * 700;
      const to = { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
      if (biomeAt(island, to.x, to.y) !== BIOME.forest) continue;
      const before = trails.length;
      add({ x, y }, to);
      if (trails.length > before) placed++;
    }
    return trails;
  }

  /** Whether it's woods all round a point, `r` px out. */
  private wooded(x: number, y: number, r: number): boolean {
    if (biomeAt(this.island, x, y) !== BIOME.forest) return false;
    for (let a = 0; a < 8; a++) {
      if (biomeAt(this.island, x + Math.cos((a / 8) * Math.PI * 2) * r, y + Math.sin((a / 8) * Math.PI * 2) * r) !== BIOME.forest) return false;
    }
    return true;
  }

  /** Whether a point's within `margin` px of a village, town or harbour. */
  private nearPlaces(x: number, y: number, margin: number): boolean {
    return (
      this.island.harbours.some((h) => Math.hypot(h.x - x, h.y - y) < YARD.half + 200 + margin) ||
      this.island.villages.some((v) => Math.hypot(v.x - x, v.y - y) < v.r + margin) ||
      this.island.towns.some((t) => Math.hypot(t.x - x, t.y - y) < townReach(t) + margin)
    );
  }

  /** Trees, bushes and rocks over the rest of the island, by what grows where. */
  *wilds(): Generator<number, void> {
    const { rand } = this;
    const step = 46;
    const zones = this.zones();
    for (let gy = 0; gy < SIZE / step; gy++) {
      if (gy % 10 === 0) yield gy / (SIZE / step);
      for (let gx = 0; gx < SIZE / step; gx++) {
        const x = (gx + rand()) * step;
        const y = (gy + rand()) * step;
        const zone = zones[Math.floor(y / ZONE) * ZONES + Math.floor(x / ZONE)];
        const roll = rand();
        if (zone === ZONE_KIND.town || zone === ZONE_KIND.clear) continue;
        const inVillage = zone === ZONE_KIND.village;
        const b = biomeAt(this.island, x, y);
        let kind: ThingKind | null = null;
        if (b === BIOME.forest) kind = inVillage ? null : roll < 0.5 ? 'oak' : roll < 0.78 ? 'pine' : roll < 0.84 ? 'bush' : null;
        else if (b === BIOME.grass) kind = roll < (inVillage ? 0.02 : 0.05) ? 'oak' : roll < 0.09 ? 'bush' : roll < 0.1 ? 'rock' : null;
        else if (b === BIOME.hills) kind = roll < 0.12 ? 'pine' : roll < 0.18 ? 'rock' : roll < 0.21 ? 'boulder' : roll < 0.26 ? 'bush' : null;
        else if (b === BIOME.rock) kind = roll < 0.1 ? 'rock' : roll < 0.16 ? 'boulder' : roll < 0.19 ? 'pine' : null;
        else if (b === BIOME.snow) kind = roll < 0.04 ? 'boulder' : null;
        else if (b === BIOME.beach) kind = roll < 0.06 ? 'palm' : roll < 0.075 ? 'rock' : null;
        if (kind) this.put(kind, x, y, rand() * Math.PI * 2, 2);
      }
    }
  }

  /** What the land's given over to, square by square: villages (few trees), towns and clearings (none). */
  private zones(): Uint8Array {
    const zones = new Uint8Array(ZONES * ZONES);
    const paint = (x: number, y: number, r: number, zone: number) => {
      for (let gy = Math.max(0, Math.floor((y - r) / ZONE)); gy <= Math.min(ZONES - 1, Math.floor((y + r) / ZONE)); gy++) {
        for (let gx = Math.max(0, Math.floor((x - r) / ZONE)); gx <= Math.min(ZONES - 1, Math.floor((x + r) / ZONE)); gx++) {
          if (Math.hypot((gx + 0.5) * ZONE - x, (gy + 0.5) * ZONE - y) < r && zones[gy * ZONES + gx] < zone) zones[gy * ZONES + gx] = zone;
        }
      }
    };
    for (const v of this.island.villages) paint(v.x, v.y, v.r + 40, ZONE_KIND.village);
    for (const t of this.island.towns) paint(t.x, t.y, townReach(t) + 60, ZONE_KIND.town);
    for (const c of this.clearings) paint(c.x, c.y, c.r, ZONE_KIND.clear);
    for (const p of this.trailPoints) paint(p.x, p.y, 24, ZONE_KIND.clear);
    return zones;
  }

}

/** A min-heap of grid indices by priority, for the path search. */
class Heap {
  private readonly items: number[] = [];
  private readonly prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let k = this.items.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (this.prio[up] <= this.prio[k]) break;
      this.swap(k, up);
      k = up;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === k) break;
        this.swap(k, m);
        k = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
