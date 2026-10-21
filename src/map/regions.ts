/**
 * The map in pieces, so the game only ever holds the part of it round you
 * (see src/world/streamer.ts): the whole map (bristol.json) is cut into
 * square TILEs, each with what's in it, and a small index with what's
 * everywhere (the bus routes, the ferries, the traffic lights' timings, the
 * lie of the land's grid); and a region of the map (a block of tiles round
 * you) is put back together from them, a GameMap like the whole one, but of
 * only what's in it.
 *
 * Everything keeps its number in the whole map (its id), so it's the same
 * thing in each region it's in: a fallen tree, a broken wall, a bus's route.
 * What's long or wide (a road, a building, a park) is in every tile it
 * reaches into; what's at a point (a tree, a lamp post) is in the one tile
 * it's in. Pure, so it's tested.
 */

import type { BusRoute, BusStation, Controller, Crossing, GameMap, Pts, Service, Signal, TerrainData } from './osm';
import type { Area, Building, Ledge, Line, PaintMark, Prop, Road } from './osm';
import type { Berth, FerryRoute } from './berths';
import type { Store } from './stores';

/** A tile's side, px (500 m). */
export const TILE = 500 * 8;

/** What's everywhere: the map's size and where it is, where you start, and what isn't anywhere in particular. */
export interface MapIndex {
  attribution: string;
  pxPerMetre: number;
  width: number;
  height: number;
  origin: GameMap['origin'];
  spawn: GameMap['spawn'];
  /** How many tiles across and down; which there are ("i,j"). */
  tiles: { cols: number; rows: number; keys: string[] };
  controllers: Controller[];
  /** Their legs by the roads' ids (road * 2 + which way, as in the whole map). */
  busRoutes: BusRoute[];
  ferries: FerryRoute[];
  /** The lie of the land's grid (its heights are in the tiles). */
  terrain?: Omit<TerrainData, 'heights'>;
}

/** One tile: what's in it, each with its id. */
export interface Tile {
  i: number;
  j: number;
  roads: [number, Road][];
  areas: [number, Area][];
  lines: [number, Line][];
  buildings: [number, Building][];
  ledges: [number, Ledge][];
  services: [number, Service][];
  stores: [number, Store][];
  /** Their bays' roads by id. */
  busStations: [number, BusStation][];
  props: [number, Prop][];
  /** Its road by id. */
  crossings: [number, Crossing][];
  signals: [number, Signal][];
  paint: [number, PaintMark][];
  /** x, y, crown radius, height, id, species (-1 if not known), ... */
  trees: number[];
  dropped: number[];
  solar: number[];
  venues: number[];
  banks: number[];
  berths: Berth[];
  /** Its piece of the lie of the land: the grid's points from (i0, j0) (cells), cols by rows, heights as in TerrainData. */
  terrain?: { i0: number; j0: number; cols: number; rows: number; heights: string };
}

/** A region of the map: a GameMap of what's in it, its bounds, and what each thing in it is in the whole map (its id). */
export interface RegionMap extends GameMap {
  region: { x0: number; y0: number; x1: number; y1: number };
  ids: Record<'roads' | 'areas' | 'lines' | 'buildings' | 'ledges' | 'services' | 'stores' | 'busStations' | 'props' | 'crossings' | 'signals' | 'paint' | 'trees', number[]>;
}

const STRIDE: Record<'trees' | 'dropped' | 'solar' | 'venues' | 'banks', number> = { trees: 4, dropped: 2, solar: 3, venues: 3, banks: 3 };

export function tileKey(i: number, j: number): string {
  return `${i},${j}`;
}

function bboxOf(rings: Pts[]): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (let k = 0; k + 1 < r.length; k += 2) b = [Math.min(b[0], r[k]), Math.min(b[1], r[k + 1]), Math.max(b[2], r[k]), Math.max(b[3], r[k + 1])];
  return b;
}

/** Cuts the whole map into tiles: the index, and the tiles (only those with something in them). */
export function splitMap(map: GameMap): { index: MapIndex; tiles: Map<string, Tile> } {
  const cols = Math.ceil(map.width / TILE);
  const rows = Math.ceil(map.height / TILE);
  const tiles = new Map<string, Tile>();
  const tile = (i: number, j: number): Tile => {
    const k = tileKey(i, j);
    let t = tiles.get(k);
    if (!t) {
      t = { i, j, roads: [], areas: [], lines: [], buildings: [], ledges: [], services: [], stores: [], busStations: [], props: [], crossings: [], signals: [], paint: [], trees: [], dropped: [], solar: [], venues: [], banks: [], berths: [] };
      tiles.set(k, t);
    }
    return t;
  };
  const clampI = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor(x / TILE)));
  const clampJ = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor(y / TILE)));
  /** Into every tile its bounds reach into. */
  const spread = <T>(list: 'roads' | 'areas' | 'lines' | 'buildings' | 'ledges' | 'services' | 'stores' | 'busStations', id: number, item: T, rings: Pts[]) => {
    const [x0, y0, x1, y1] = bboxOf(rings);
    if (!Number.isFinite(x0)) return;
    for (let i = clampI(x0); i <= clampI(x1); i++) for (let j = clampJ(y0); j <= clampJ(y1); j++) (tile(i, j)[list] as [number, T][]).push([id, item]);
  };
  /** Into the tile it's in. */
  const at = (x: number, y: number) => tile(clampI(x), clampJ(y));

  map.roads.forEach((r, id) => spread('roads', id, r, [r.pts]));
  map.areas.forEach((a, id) => spread('areas', id, a, a.rings));
  map.lines.forEach((l, id) => spread('lines', id, l, [l.pts]));
  map.buildings.forEach((b, id) => spread('buildings', id, b, b.rings));
  (map.ledges ?? []).forEach((l, id) => spread('ledges', id, l, [l.pts]));
  (map.services ?? []).forEach((s, id) => spread('services', id, s, s.rings));
  (map.stores ?? []).forEach((s, id) => spread('stores', id, s, [s.park, [s.door[0], s.door[1], s.bay[0], s.bay[1]]]));
  (map.busStations ?? []).forEach((s, id) => spread('busStations', id, s, [s.bays.flatMap((b) => [b.x, b.y, ...b.platform])]));
  map.props.forEach((p, id) => at(p.x, p.y).props.push([id, p]));
  map.crossings.forEach((c, id) => at(c.x, c.y).crossings.push([id, c]));
  map.signals.forEach((s, id) => at(s.x, s.y).signals.push([id, s]));
  (map.paint ?? []).forEach((p, id) => at(p.x, p.y).paint.push([id, p]));
  const species = new Map<number, number>();
  const ts = map.treeSpecies ?? [];
  for (let k = 0; k + 1 < ts.length; k += 2) species.set(ts[k], ts[k + 1]);
  for (let k = 0; k + 3 < map.trees.length; k += 4) {
    const t = map.trees;
    at(t[k], t[k + 1]).trees.push(t[k], t[k + 1], t[k + 2], t[k + 3], k / 4, species.get(k / 4) ?? -1);
  }
  for (const list of ['dropped', 'solar', 'venues', 'banks'] as const) {
    const flat = map[list] ?? [];
    const n = STRIDE[list];
    for (let k = 0; k + n - 1 < flat.length; k += n) at(flat[k], flat[k + 1])[list].push(...flat.slice(k, k + n));
  }
  for (const b of map.berths ?? []) at(b.x, b.y).berths.push(b);

  // The lie of the land: each tile its block of the grid's points (with the points on its far edges, shared with the next).
  const td = map.terrain;
  if (td) {
    const binary = atob(td.heights);
    const per = TILE / td.cell;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const [i0, j0] = [i * per, j * per];
        if (i0 >= td.cols || j0 >= td.rows) continue;
        const [w, h] = [Math.min(per + 1, td.cols - i0), Math.min(per + 1, td.rows - j0)];
        let out = '';
        for (let jj = 0; jj < h; jj++) {
          const from = ((j0 + jj) * td.cols + i0) * 2;
          out += binary.slice(from, from + w * 2);
        }
        tile(i, j).terrain = { i0, j0, cols: w, rows: h, heights: btoa(out) };
      }
    }
  }

  const index: MapIndex = {
    attribution: map.attribution,
    pxPerMetre: map.pxPerMetre,
    width: map.width,
    height: map.height,
    origin: map.origin,
    spawn: map.spawn,
    tiles: { cols, rows, keys: [...tiles.keys()].sort() },
    controllers: map.controllers,
    busRoutes: map.busRoutes ?? [],
    ferries: map.ferries ?? [],
    ...(td ? { terrain: { cell: td.cell, cols: td.cols, rows: td.rows, base: td.base } } : {}),
  };
  return { index, tiles };
}

/** Which tiles a region (x0, y0) to (x1, y1), px, takes in: "i,j". */
export function tilesFor(index: MapIndex, x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = [];
  const [i0, i1] = [Math.max(0, Math.floor(x0 / TILE)), Math.min(index.tiles.cols - 1, Math.floor((x1 - 1) / TILE))];
  const [j0, j1] = [Math.max(0, Math.floor(y0 / TILE)), Math.min(index.tiles.rows - 1, Math.floor((y1 - 1) / TILE))];
  const have = new Set(index.tiles.keys);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (have.has(tileKey(i, j))) out.push(tileKey(i, j));
  return out;
}

/**
 * A region of the map put together from its tiles (all those in it): each
 * thing once, in the whole map's order, and what refers to another by its
 * place in its list (a crossing's road, a bus station's bays' roads, the bus
 * routes' legs, the trees' species) by its place in the region's. A bus
 * route's legs on roads not in it are gaps (-1); a crossing, or a bus
 * station's bay, whose road isn't in it is left out.
 */
export function assemble(index: MapIndex, unsorted: Tile[], bounds: { x0: number; y0: number; x1: number; y1: number }): RegionMap {
  const work = assembleWork(index, unsorted, bounds);
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
  }
}

/** The same, a little at a time (see src/world/work.ts). */
export function* assembleWork(index: MapIndex, unsorted: Tile[], bounds: { x0: number; y0: number; x1: number; y1: number }): Generator<void, RegionMap, void> {
  // (In a fixed order, whichever came first.)
  const tiles = [...unsorted].sort((a, b) => a.i - b.i || a.j - b.j);
  const ids: RegionMap['ids'] = { roads: [], areas: [], lines: [], buildings: [], ledges: [], services: [], stores: [], busStations: [], props: [], crossings: [], signals: [], paint: [], trees: [] };
  /** Each once, in id order (a pause after each tile's, and after sorting them). */
  function* gather<T>(list: keyof Tile): Generator<void, T[], void> {
    const all = new Map<number, T>();
    for (const t of tiles) {
      for (const [id, item] of t[list] as [number, T][]) all.set(id, item);
      yield;
    }
    const sorted = [...all.entries()].sort((a, b) => a[0] - b[0]);
    yield;
    (ids as Record<string, number[]>)[list] = sorted.map(([id]) => id);
    return sorted.map(([, item]) => item);
  }
  const roads = yield* gather<Road>('roads');
  const roadAt = new Map<number, number>(ids.roads.map((id, i) => [id, i]));
  const areas = yield* gather<Area>('areas');
  const lines = yield* gather<Line>('lines');
  const buildings = yield* gather<Building>('buildings');
  const ledges = yield* gather<Ledge>('ledges');
  const services = yield* gather<Service>('services');
  const stores = yield* gather<Store>('stores');
  const props = yield* gather<Prop>('props');
  const signals = yield* gather<Signal>('signals');
  const paint = yield* gather<PaintMark>('paint');
  // Crossings and bus stations by their roads in the region (those whose roads aren't, left out).
  const crossings: Crossing[] = [];
  const crossingIds: number[] = [];
  for (const [id, c] of [...new Map(tiles.flatMap((t) => t.crossings)).entries()].sort((a, b) => a[0] - b[0])) {
    // (One not on a road, as it was; one whose road isn't here, left out.)
    const road = c.road === undefined ? undefined : roadAt.get(c.road);
    if (c.road !== undefined && road === undefined) continue;
    crossings.push(road === undefined ? c : { ...c, road });
    crossingIds.push(id);
  }
  ids.crossings = crossingIds;
  const busStations: BusStation[] = [];
  const stationIds: number[] = [];
  for (const [id, s] of [...new Map(tiles.flatMap((t) => t.busStations)).entries()].sort((a, b) => a[0] - b[0])) {
    const bays = s.bays.filter((b) => roadAt.has(b.road)).map((b) => ({ ...b, road: roadAt.get(b.road)! }));
    if (bays.length < 2) continue;
    busStations.push({ ...s, bays });
    stationIds.push(id);
  }
  ids.busStations = stationIds;
  // The points: trees (and their species), and the rest, in id order (as they were in the whole map).
  const treeRows: number[][] = [];
  for (const t of tiles) for (let k = 0; k + 5 < t.trees.length; k += 6) treeRows.push(t.trees.slice(k, k + 6));
  treeRows.sort((a, b) => a[4] - b[4]);
  const trees: number[] = [];
  const treeSpecies: number[] = [];
  treeRows.forEach((r, i) => {
    trees.push(r[0], r[1], r[2], r[3]);
    ids.trees.push(r[4]);
    if (r[5] >= 0) treeSpecies.push(i, r[5]);
  });
  const flat = (list: 'dropped' | 'solar' | 'venues' | 'banks') => {
    const n = STRIDE[list];
    const rowsOf: number[][] = [];
    for (const t of tiles) for (let k = 0; k + n - 1 < t[list].length; k += n) rowsOf.push(t[list].slice(k, k + n));
    // (In the order of the tiles they came from, as they were: a stable order, the same whichever tiles are loaded first.)
    return rowsOf.flat();
  };
  yield;
  const legs = (r: BusRoute): BusRoute => ({
    ...r,
    legs: r.legs.map((leg) => {
      if (leg < 0) return leg;
      const road = roadAt.get(leg >> 1);
      return road === undefined ? -1 : road * 2 + (leg & 1);
    }),
  });
  yield;
  const terrain = index.terrain ? yield* terrainOf(index.terrain, tiles) : undefined;
  return {
    attribution: index.attribution,
    pxPerMetre: index.pxPerMetre,
    width: index.width,
    height: index.height,
    origin: index.origin,
    spawn: index.spawn,
    areas,
    roads,
    lines,
    buildings,
    trees,
    props,
    crossings,
    signals,
    controllers: index.controllers,
    dropped: flat('dropped'),
    paint,
    treeSpecies,
    solar: flat('solar'),
    busRoutes: index.busRoutes.map(legs),
    busStations,
    services,
    stores,
    berths: tiles.flatMap((t) => t.berths),
    ferries: index.ferries,
    venues: flat('venues'),
    banks: flat('banks'),
    ledges,
    ...(terrain ? { terrain } : {}),
    region: bounds,
    ids,
  };
}

/** The region's piece of the lie of the land: its tiles' blocks, stitched together. */
function* terrainOf(grid: Omit<TerrainData, 'heights'>, tiles: Tile[]): Generator<void, TerrainData | undefined, void> {
  const blocks = tiles.map((t) => t.terrain).filter((b): b is NonNullable<Tile['terrain']> => !!b);
  if (!blocks.length) return undefined;
  const i0 = Math.min(...blocks.map((b) => b.i0));
  const j0 = Math.min(...blocks.map((b) => b.j0));
  const cols = Math.max(...blocks.map((b) => b.i0 + b.cols)) - i0;
  const rows = Math.max(...blocks.map((b) => b.j0 + b.rows)) - j0;
  const out = new Uint8Array(cols * rows * 2);
  for (const b of blocks) {
    yield;
    const bin = atob(b.heights);
    for (let jj = 0; jj < b.rows; jj++) {
      for (let ii = 0; ii < b.cols * 2; ii++) out[((b.j0 - j0 + jj) * cols + (b.i0 - i0)) * 2 + ii] = bin.charCodeAt(jj * b.cols * 2 + ii);
    }
  }
  let s = '';
  for (let k = 0; k < out.length; k += 8192) {
    if (k % (8192 * 16) === 0) yield;
    s += String.fromCharCode(...out.subarray(k, k + 8192));
  }
  return { cell: grid.cell, cols, rows, base: grid.base, i0, j0, heights: btoa(s) };
}
