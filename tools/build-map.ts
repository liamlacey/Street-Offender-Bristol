/**
 * Makes src/map/bristol.json from OpenStreetMap data.
 *
 *   node --experimental-strip-types tools/build-map.ts [osm files...]
 *
 * With no files it downloads the area round Bristol Cathedral from the OSM
 * API (and any multipolygons only partly in it), into .osm-cache/.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildMap, parseOsm, type OsmData } from '../src/map/osm.ts';

/** The area on the map: about 970 m by 950 m, with the Cathedral in the middle. */
const BOUNDS = { minlat: 51.4475, minlon: -2.6075, maxlat: 51.456, maxlon: -2.5935 };
/** The car starts on Deanery Road, in front of Bristol Cathedral. */
const START = { lat: 51.45095, lon: -2.6005 };

const API = 'https://api.openstreetmap.org/api/0.6';

async function download(url: string, file: string): Promise<string> {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

const files = process.argv.slice(2);
let data: OsmData;
if (files.length > 0) {
  data = parseOsm(readFileSync(files[0], 'utf8'));
  for (const f of files.slice(1)) parseOsm(readFileSync(f, 'utf8'), data);
} else {
  mkdirSync('.osm-cache', { recursive: true });
  const { minlon, minlat, maxlon, maxlat } = BOUNDS;
  data = parseOsm(await download(`${API}/map?bbox=${minlon},${minlat},${maxlon},${maxlat}`, '.osm-cache/map.osm'));
  // Multipolygons with members outside the area: fetch them whole.
  for (const rel of [...data.relations.values()]) {
    if (rel.tags.type !== 'multipolygon') continue;
    if (rel.members.every((m) => m.type !== 'way' || data.ways.has(m.ref))) continue;
    parseOsm(await download(`${API}/relation/${rel.id}/full`, `.osm-cache/relation-${rel.id}.osm`), data);
  }
}

const map = buildMap(data, { bounds: data.bounds ?? BOUNDS, start: START });
const json = JSON.stringify(map);
writeFileSync('src/map/bristol.json', json);
console.log(
  `src/map/bristol.json: ${(json.length / 1024).toFixed(0)} kB, ${map.width}x${map.height} px, ` +
    `${map.roads.length} roads, ${map.areas.length} areas, ${map.buildings.length} buildings, ` +
    `${map.trees.length / 3} trees, ${map.props.length} props, ${map.lines.length} lines, ${map.crossings.length} crossings`,
);
