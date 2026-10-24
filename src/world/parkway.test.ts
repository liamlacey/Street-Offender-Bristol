import { describe, expect, it } from 'vitest';
import { type GameMap, Projection } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { placesWork } from './places';
import { drain } from './work.ts';

const M = 8;
const whole = bristol as unknown as GameMap;
const proj = new Projection(whole.origin.lat, whole.origin.lon, whole.pxPerMetre);

describe('Bristol Parkway', () => {
  // Its bus stops, A to D (by the station's doors, on its bus loop, and D out by the car park).
  const stops = [
    [51.5142668, -2.5443581],
    [51.5142586, -2.544162],
    [51.5142559, -2.5439062],
    [51.5147123, -2.5437343],
  ].map(([lat, lon]) => [proj.x(lon), proj.y(lat)]);
  const [cx, cy] = [proj.x(-2.5438), proj.y(51.5143)];
  const { index, tiles } = splitMap(whole);
  const [tx, ty] = [Math.round(cx / TILE) * TILE, Math.round(cy / TILE) * TILE];
  const b = { x0: tx - 2 * TILE, y0: ty - 2 * TILE, x1: tx + 2 * TILE, y1: ty + 2 * TILE };
  const map = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);

  it('has a bay painted at each of its bus stops (its bus loop only buses use)', () => {
    const bays = (map.paint ?? []).filter((p) => p.kind === 'busstop');
    for (const [x, y] of stops) expect(bays.some((p) => Math.hypot(p.x - x, p.y - y) < 15 * M)).toBe(true);
  });

  it('has taxis waiting at its ranks, off the street, nose to tail', () => {
    const cabs = drain(placesWork(map)).spaces.filter((s) => s.kind === 'taxi' && Math.hypot(s.x - cx, s.y - cy) < 150 * M);
    expect(cabs.length).toBeGreaterThanOrEqual(8);
    for (const a of cabs) for (const c of cabs) if (a !== c) expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(5 * M);
  });
});
