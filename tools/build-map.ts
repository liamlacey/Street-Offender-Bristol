/**
 * Makes src/map/bristol.json from OpenStreetMap data, with heights from the
 * Environment Agency's LIDAR.
 *
 *   npm run map
 *
 * It downloads the area round Bristol Cathedral from the OSM API (and any
 * multipolygons only partly in it), and the LIDAR's surface and ground
 * heights for it, into .osm-cache/ (delete that to fetch them afresh).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { addLidar } from '../src/map/enrich.ts';
import { parseWcsText } from '../src/map/lidar.ts';
import { buildMap, parseOsm, type OsmData } from '../src/map/osm.ts';
import { toNationalGrid } from '../src/map/osgb.ts';

/** The area on the map: about 970 m by 950 m, with the Cathedral in the middle. */
const BOUNDS = { minlat: 51.4475, minlon: -2.6075, maxlat: 51.456, maxlon: -2.5935 };
/** The car starts on Deanery Road, in front of Bristol Cathedral. */
const START = { lat: 51.45095, lon: -2.6005 };

const API = 'https://api.openstreetmap.org/api/0.6';
/** The Environment Agency's LIDAR composites, 1 m: first return (roofs, treetops) and the bare ground. */
const LIDAR = {
  dsm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs?coverageId=df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m',
  dtm: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
};

async function download(url: string, file: string): Promise<string> {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

mkdirSync('.osm-cache', { recursive: true });
const { minlon, minlat, maxlon, maxlat } = BOUNDS;
const data = parseOsm(await download(`${API}/map?bbox=${minlon},${minlat},${maxlon},${maxlat}`, '.osm-cache/map.osm'));
// Multipolygons with members outside the area: fetch them whole.
for (const rel of [...data.relations.values()]) {
  if (rel.tags.type !== 'multipolygon') continue;
  if (rel.members.every((m) => m.type !== 'way' || data.ways.has(m.ref))) continue;
  parseOsm(await download(`${API}/relation/${rel.id}/full`, `.osm-cache/relation-${rel.id}.osm`), data);
}

// The LIDAR over the area, with 40 m to spare for lining it up.
const corners = [toNationalGrid(minlat, minlon), toNationalGrid(maxlat, maxlon), toNationalGrid(minlat, maxlon), toNationalGrid(maxlat, minlon)];
const [e0, e1] = [Math.floor(Math.min(...corners.map((c) => c[0]))) - 40, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 40];
const [n0, n1] = [Math.floor(Math.min(...corners.map((c) => c[1]))) - 40, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 40];
const coverage = (base: string) => `${base}&service=WCS&version=2.0.1&request=GetCoverage&subset=E(${e0},${e1})&subset=N(${n0},${n1})&format=text/plain`;
const dsm = parseWcsText(await download(coverage(LIDAR.dsm), `.osm-cache/lidar-dsm-${e0}-${n0}.txt`));
const dtm = parseWcsText(await download(coverage(LIDAR.dtm), `.osm-cache/lidar-dtm-${e0}-${n0}.txt`));

const map = buildMap(data, { bounds: BOUNDS, start: START });
const lidar = addLidar(map, dsm, dtm);
console.log('LIDAR:', JSON.stringify(lidar));
const json = JSON.stringify(map);
writeFileSync('src/map/bristol.json', json);
console.log(
  `src/map/bristol.json: ${(json.length / 1024).toFixed(0)} kB, ${map.width}x${map.height} px, ` +
    `${map.roads.length} roads, ${map.areas.length} areas, ${map.buildings.length} buildings, ` +
    `${map.trees.length / 4} trees, ${map.props.length} props, ${map.lines.length} lines, ${map.crossings.length} crossings`,
);
