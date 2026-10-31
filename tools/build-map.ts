/**
 * Makes src/map/bristol.json: Bristol from OpenStreetMap, measured and
 * filled in with the Environment Agency's LIDAR. See src/map/README.md for
 * how, and for how to grow the map.
 *
 *   npm run map
 *
 * Or another map (see src/map/maps.ts, and the README's "Other maps"), made
 * the same way from its own sources folder, into its own file:
 *
 *   npm run map -- --map llanidloes
 *
 * The map is made of the areas listed in map-sources/areas.json. Each area's
 * data is downloaded once, the first time the map's made with it, and kept
 * (gzipped) in map-sources/<area>/, so the map comes out the same every
 * time: OSM's data changes every day, and the LIDAR's now and then. An
 * area's LIDAR alignment is worked out once too, and kept in areas.json.
 *
 *   npm run map -- --refresh <area>   fetches that area's data afresh (and re-aligns it)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { type Tile, mosaic, rasterText, readTiff } from '../src/map/geotiff.ts';
import { MAPS } from '../src/map/maps.ts';
import { addLidar, alignLidar, mergeRasters, shiftRaster } from '../src/map/enrich.ts';
import { type Raster, parseWcsText } from '../src/map/lidar.ts';
import { Projection, buildMap, parseOsm, ringArea, type OsmData } from '../src/map/osm.ts';
import { toNationalGrid } from '../src/map/osgb.ts';
import { Terrain } from '../src/world/terrain.ts';

interface Bounds {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

interface Area {
  name: string;
  /** What it is, for people reading the list. */
  about?: string;
  bounds: Bounds;
  /** When its data was downloaded (set by this tool). */
  fetched?: string;
  /** The newest edit in its OSM data (set by this tool). */
  osmNewestEdit?: string;
  /** How far its LIDAR was moved to line up with the buildings, metres east and south (set by this tool). */
  lidarShift?: [number, number];
}

interface Sources {
  /** Where the car starts: it's put on the nearest road, facing along it (downhill, if asked). */
  start: { about?: string; lat: number; lon: number; facing?: 'downhill' | 'uphill' };
  /** Oldest first. Where areas overlap, the older's data wins, so adding an area never changes what's there. */
  areas: Area[];
  /** Whose LIDAR: the Environment Agency's (England: the default), or the Welsh Government's (Wales). */
  lidar?: 'england' | 'wales';
}

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const MAP_INFO = MAPS.find((m) => m.id === (arg('--map') ?? 'bristol'));
if (!MAP_INFO) throw new Error(`No map called ${arg('--map')}: see src/map/maps.ts`);
const SOURCES = MAP_INFO.sources;
const API = 'https://api.openstreetmap.org/api/0.6';
/** The Environment Agency's LIDAR composites, 1 m: first return (roofs, treetops) and the bare ground. */
const LIDAR = {
  dsm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs?coverageId=df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m',
  dtm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
};
/**
 * The Welsh Government's LIDAR (2020-23, 1 m, Open Government Licence): its catalogue of tiles (a kilometre square each),
 * which says where each one's surface (DSM) and ground (DTM) GeoTIFF is to be downloaded from.
 */
const WALES_CATALOGUE = 'https://datamap.gov.wales/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:welsh_government_lidar_tile_catalogue_2020_2023&outputFormat=application/json&srsName=EPSG:27700';
/** LIDAR is fetched this far beyond each area, metres, so it can be lined up. */
const LIDAR_MARGIN = 40;

const sources: Sources = JSON.parse(readFileSync(`${SOURCES}/areas.json`, 'utf8'));
const refresh = arg('--refresh');

/** Text from the web. */
async function download(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/** A source file, gzipped in the area's folder: read if it's there, otherwise downloaded (from `url`, or made by `make`) and kept. */
async function source(area: Area, file: string, url: string | (() => Promise<string>)): Promise<string> {
  const path = `${SOURCES}/${area.name}/${file}.gz`;
  if (existsSync(path)) return gunzipSync(readFileSync(path)).toString('utf8');
  console.log(`Downloading ${area.name}/${file}`);
  const text = typeof url === 'string' ? await download(url) : await url();
  mkdirSync(`${SOURCES}/${area.name}`, { recursive: true });
  writeFileSync(path, gzipSync(text, { level: 9 }));
  area.fetched = new Date().toISOString().slice(0, 10);
  return text;
}

/** An area's OSM data: its map, and any multipolygons only partly in it, whole. */
async function osmOf(area: Area): Promise<OsmData> {
  const { minlon, minlat, maxlon, maxlat } = area.bounds;
  const xml = await source(area, 'map.osm', `${API}/map?bbox=${minlon},${minlat},${maxlon},${maxlat}`);
  const data = parseOsm(xml);
  for (const rel of [...data.relations.values()]) {
    if (rel.tags.type !== 'multipolygon') continue;
    if (rel.members.every((m) => m.type !== 'way' || data.ways.has(m.ref))) continue;
    parseOsm(await source(area, `relation-${rel.id}.osm`, `${API}/relation/${rel.id}/full`), data);
  }
  let newest = '';
  for (const m of xml.matchAll(/timestamp="([^"]+)"/g)) if (m[1] > newest) newest = m[1];
  area.osmNewestEdit = newest;
  return data;
}

/** An area's LIDAR, surface and ground. */
async function lidarOf(area: Area): Promise<{ dsm: Raster; dtm: Raster }> {
  const { minlon, minlat, maxlon, maxlat } = area.bounds;
  const corners = [toNationalGrid(minlat, minlon), toNationalGrid(maxlat, maxlon), toNationalGrid(minlat, maxlon), toNationalGrid(maxlat, minlon)];
  const [e0, e1] = [Math.floor(Math.min(...corners.map((c) => c[0]))) - LIDAR_MARGIN, Math.ceil(Math.max(...corners.map((c) => c[0]))) + LIDAR_MARGIN];
  const [n0, n1] = [Math.floor(Math.min(...corners.map((c) => c[1]))) - LIDAR_MARGIN, Math.ceil(Math.max(...corners.map((c) => c[1]))) + LIDAR_MARGIN];
  if (sources.lidar === 'wales') {
    return {
      dsm: parseWcsText(await source(area, 'lidar-dsm.txt', () => walesLidar('dsm', e0, n0, e1, n1))),
      dtm: parseWcsText(await source(area, 'lidar-dtm.txt', () => walesLidar('dtm', e0, n0, e1, n1))),
    };
  }
  const coverage = (base: string) => `${base}&service=WCS&version=2.0.1&request=GetCoverage&subset=E(${e0},${e1})&subset=N(${n0},${n1})&format=text/plain`;
  return {
    dsm: parseWcsText(await source(area, 'lidar-dsm.txt', coverage(LIDAR.dsm))),
    dtm: parseWcsText(await source(area, 'lidar-dtm.txt', coverage(LIDAR.dtm))),
  };
}

/** The Welsh tiles' downloads, kept a while (a tile's shared by the areas round it): they're big, and only what's cut from them is kept. */
const WALES_TILES = `${tmpdir()}/street-offender-wales-lidar`;

/**
 * Wales's LIDAR over (e0, n0) to (e1, n1): the catalogue's tiles there downloaded, read, and put together, and written out as
 * the Environment Agency's coverages are, so it's kept and read the same way (the newest tile winning where they overlap).
 */
async function walesLidar(kind: 'dsm' | 'dtm', e0: number, n0: number, e1: number, n1: number): Promise<string> {
  const catalogue = JSON.parse(await download(`${WALES_CATALOGUE}&bbox=${e0},${n0},${e1},${n1},EPSG:27700`)) as {
    features: { properties: Record<string, string> }[];
  };
  const found = catalogue.features.map((f) => f.properties).filter((p) => p[`${kind}_link`]);
  found.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  const tiles: Tile[] = [];
  mkdirSync(WALES_TILES, { recursive: true });
  for (const p of found) {
    const link = p[`${kind}_link`];
    const url = link.startsWith('http') ? link : `https://${link}`;
    const kept = `${WALES_TILES}/${url.split('/').pop()}`;
    if (!existsSync(kept)) {
      console.log(`  ${p.british_gr} ${kind}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      writeFileSync(kept, new Uint8Array(await res.arrayBuffer()));
    }
    tiles.push(readTiff(new Uint8Array(readFileSync(kept)), (b) => new Uint8Array(inflateSync(b))));
  }
  if (!tiles.length) throw new Error(`No Welsh LIDAR (${kind}) at ${e0},${n0} to ${e1},${n1}`);
  return rasterText(mosaic(tiles, e0, n0, e1, n1));
}

if (refresh) {
  const area = sources.areas.find((a) => a.name === refresh);
  if (!area) throw new Error(`No area called ${refresh} in ${SOURCES}/areas.json`);
  rmSync(`${SOURCES}/${area.name}`, { recursive: true, force: true });
  delete area.lidarShift;
}

// OSM: the newest area's first, so the older areas' data is laid over it and wins where they overlap.
const data: OsmData = { bounds: null, nodes: new Map(), ways: new Map(), relations: new Map() };
for (const area of [...sources.areas].reverse()) {
  const own = await osmOf(area);
  for (const [id, n] of own.nodes) data.nodes.set(id, n);
  for (const [id, w] of own.ways) data.ways.set(id, w);
  for (const [id, r] of own.relations) data.relations.set(id, r);
}

const bounds: Bounds = {
  minlat: Math.min(...sources.areas.map((a) => a.bounds.minlat)),
  minlon: Math.min(...sources.areas.map((a) => a.bounds.minlon)),
  maxlat: Math.max(...sources.areas.map((a) => a.bounds.maxlat)),
  maxlon: Math.max(...sources.areas.map((a) => a.bounds.maxlon)),
};
const map = buildMap(data, { bounds, start: sources.start });

// LIDAR: each area's lined up with the map (once, then kept), and all laid together, the oldest winning.
const proj = new Projection(map.origin.lat, map.origin.lon, map.pxPerMetre);
const dsms: Raster[] = [];
const dtms: Raster[] = [];
/** Too few buildings to line an area's LIDAR up by (big ones, as `alignLidar` uses): it's lined up as the others are, instead. */
const FEW_BUILDINGS = 25;
const lidars: { dsm: Raster; dtm: Raster }[] = [];
const unsure: Area[] = [];
for (const area of sources.areas) {
  const { dsm, dtm } = await lidarOf(area);
  lidars.push({ dsm, dtm });
  if (!area.lidarShift) {
    const { minlat, minlon, maxlat, maxlon } = area.bounds;
    const within: [number, number, number, number] = [proj.x(minlon), proj.y(maxlat), proj.x(maxlon), proj.y(minlat)];
    area.lidarShift = alignLidar(map, dsm, dtm, within);
    const big = map.buildings.filter((b) => {
      const [x, y] = [b.rings[0][0], b.rings[0][1]];
      return b.solid && x >= within[0] && y >= within[1] && x <= within[2] && y <= within[3] && Math.abs(ringArea(b.rings[0])) >= 150 * map.pxPerMetre ** 2;
    });
    if (big.length < FEW_BUILDINGS) unsure.push(area);
  }
}
const sure = sources.areas.filter((a) => !unsure.includes(a));
if (unsure.length && sure.length) {
  const median = (k: 0 | 1) => {
    const v = sure.map((a) => a.lidarShift![k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  for (const area of unsure) {
    console.log(`${area.name}: too few buildings to line its LIDAR up by (it gave ${area.lidarShift!.join(', ')} m): lined up as the others are`);
    area.lidarShift = [median(0), median(1)];
  }
}
sources.areas.forEach((area, i) => {
  dsms.push(shiftRaster(lidars[i].dsm, area.lidarShift!));
  dtms.push(shiftRaster(lidars[i].dtm, area.lidarShift!));
});
const lidar = addLidar(map, mergeRasters(dsms), mergeRasters(dtms));

// Turn the car round if it's facing the wrong way up the hill.
if (sources.start.facing && map.terrain) {
  const terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges);
  const { x, y, heading } = map.spawn;
  const ahead = 15 * map.pxPerMetre;
  const rise = terrain.at(x + Math.cos(heading) * ahead, y + Math.sin(heading) * ahead) - terrain.at(x - Math.cos(heading) * ahead, y - Math.sin(heading) * ahead);
  if ((sources.start.facing === 'downhill') === rise > 0) map.spawn.heading = +(Math.atan2(-Math.sin(heading), -Math.cos(heading))).toFixed(3);
}
// And into the left-hand lane: Britain drives on the left (a quarter of a two-way road's width off the middle).
{
  const { x, y, heading } = map.spawn;
  const road = nearestRoad(map, x, y);
  const lane = road && !road.oneway ? road.width * 0.25 : 0;
  map.spawn.x = Math.round(x + Math.sin(heading) * lane);
  map.spawn.y = Math.round(y - Math.cos(heading) * lane);
}

writeFileSync(`${SOURCES}/areas.json`, `${JSON.stringify(sources, null, 2)}\n`);
/** The road whose line passes nearest (x, y). */
function nearestRoad(m: typeof map, x: number, y: number) {
  let best: (typeof m.roads)[number] | undefined;
  let bestD = Infinity;
  for (const r of m.roads) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const [ax, ay, bx, by] = [r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  }
  return best;
}

const json = JSON.stringify(map);
writeFileSync(MAP_INFO.file, json);
console.log(`Areas: ${sources.areas.map((a) => `${a.name} (fetched ${a.fetched}, LIDAR shift ${a.lidarShift?.join(', ')} m)`).join('; ')}`);
console.log('LIDAR:', JSON.stringify(lidar));
console.log(
  `${MAP_INFO.file}: ${(json.length / 1024).toFixed(0)} kB, ${map.width}x${map.height} px, ` +
    `${map.roads.length} roads, ${map.areas.length} areas, ${map.buildings.length} buildings, ` +
    `${map.trees.length / 4} trees, ${map.props.length} props, ${map.lines.length} lines, ${map.crossings.length} crossings`,
);
