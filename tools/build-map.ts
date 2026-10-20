/**
 * Makes src/map/bristol.json: Bristol from OpenStreetMap, measured and
 * filled in with the Environment Agency's LIDAR. See src/map/README.md for
 * how, and for how to grow the map.
 *
 *   npm run map
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
import { gunzipSync, gzipSync } from 'node:zlib';
import { addLidar, alignLidar, mergeRasters, shiftRaster } from '../src/map/enrich.ts';
import { type Raster, parseWcsText } from '../src/map/lidar.ts';
import { Projection, buildMap, parseOsm, type OsmData } from '../src/map/osm.ts';
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
}

const SOURCES = 'map-sources';
const API = 'https://api.openstreetmap.org/api/0.6';
/** The Environment Agency's LIDAR composites, 1 m: first return (roofs, treetops) and the bare ground. */
const LIDAR = {
  dsm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs?coverageId=df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m',
  dtm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
};
/** LIDAR is fetched this far beyond each area, metres, so it can be lined up. */
const LIDAR_MARGIN = 40;

const sources: Sources = JSON.parse(readFileSync(`${SOURCES}/areas.json`, 'utf8'));
const refresh = process.argv.includes('--refresh') ? process.argv[process.argv.indexOf('--refresh') + 1] : null;

/** A source file, gzipped in the area's folder: read if it's there, otherwise downloaded and kept. */
async function source(area: Area, file: string, url: string): Promise<string> {
  const path = `${SOURCES}/${area.name}/${file}.gz`;
  if (existsSync(path)) return gunzipSync(readFileSync(path)).toString('utf8');
  console.log(`Downloading ${area.name}/${file}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
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
  const coverage = (base: string) => `${base}&service=WCS&version=2.0.1&request=GetCoverage&subset=E(${e0},${e1})&subset=N(${n0},${n1})&format=text/plain`;
  return {
    dsm: parseWcsText(await source(area, 'lidar-dsm.txt', coverage(LIDAR.dsm))),
    dtm: parseWcsText(await source(area, 'lidar-dtm.txt', coverage(LIDAR.dtm))),
  };
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
for (const area of sources.areas) {
  const { dsm, dtm } = await lidarOf(area);
  if (!area.lidarShift) {
    const { minlat, minlon, maxlat, maxlon } = area.bounds;
    area.lidarShift = alignLidar(map, dsm, dtm, [proj.x(minlon), proj.y(maxlat), proj.x(maxlon), proj.y(minlat)]);
  }
  dsms.push(shiftRaster(dsm, area.lidarShift));
  dtms.push(shiftRaster(dtm, area.lidarShift));
}
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
writeFileSync('src/map/bristol.json', json);
console.log(`Areas: ${sources.areas.map((a) => `${a.name} (fetched ${a.fetched}, LIDAR shift ${a.lidarShift?.join(', ')} m)`).join('; ')}`);
console.log('LIDAR:', JSON.stringify(lidar));
console.log(
  `src/map/bristol.json: ${(json.length / 1024).toFixed(0)} kB, ${map.width}x${map.height} px, ` +
    `${map.roads.length} roads, ${map.areas.length} areas, ${map.buildings.length} buildings, ` +
    `${map.trees.length / 4} trees, ${map.props.length} props, ${map.lines.length} lines, ${map.crossings.length} crossings`,
);
