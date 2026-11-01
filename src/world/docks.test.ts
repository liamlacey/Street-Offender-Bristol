import { describe, expect, it } from 'vitest';
import { Water } from '../map/berths';
import type { Building, GameMap, OsmData, Place, Pts } from '../map/osm';
import { dockQuays, industrySub, pointInRing } from '../map/osm';
import { placesWork } from './places';
import { drain } from './work.ts';

const M = 8;

/** An industrial place 200 m by 120 m (of a kind), a road along its north side, a shed in its north-east corner; tanks if asked. */
function yardMap(sub: Place['sub'], name: string, tanks = 0): GameMap {
  const ring = [0, 200, 1600, 200, 1600, 1160, 0, 1160];
  const shed: Building = { id: 1, rings: [[1300, 260, 1560, 260, 1560, 460, 1300, 460]], top: 10 * M, bottom: 0, kind: 'industrial', solid: true, drawn: true };
  const tankRings: Building[] = Array.from({ length: tanks }, (_, k) => {
    const [x, y, r] = [200 + k * 260, 800, 80];
    return { id: 10 + k, rings: [[x - r, y - r, x + r, y - r, x + r, y + r, x - r, y + r]], top: 15 * M, bottom: 0, kind: 'storage_tank', solid: true, drawn: true };
  });
  const place: Place = { kind: 'industrial', name, ...(sub ? { sub } : {}), x: 800, y: 680, rings: [ring] };
  return {
    attribution: '', pxPerMetre: M, width: 1700, height: 1300, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [], roads: [{ kind: 'street', width: 7 * M, pts: [0, 150, 1700, 150], pavement: 'both' }],
    lines: [], buildings: [shed, ...tankRings], props: [], crossings: [], signals: [], controllers: [], trees: [], places: [place],
  } as unknown as GameMap;
}

/** Nothing put down in a building or on the road, and all of it in the place. */
function tidy(map: GameMap, pts: [number, number][]): void {
  const ring = map.places![0].rings[0];
  for (const [x, y] of pts) {
    expect(pointInRing(x, y, ring)).toBe(true);
    for (const b of map.buildings) expect(pointInRing(x, y, b.rings[0])).toBe(false);
    expect(Math.abs(y - 150)).toBeGreaterThan(3.5 * M);
  }
}

describe('what industry a place is, from its name', () => {
  it('knows a container terminal, a car terminal, a bulk yard, a fuel terminal and the docks', () => {
    expect(industrySub({ name: 'Avonmouth Container Port' })).toBe('container');
    expect(industrySub({ name: 'Vehicle Storage Yard (Autologic)' })).toBe('cars');
    expect(industrySub({ name: 'Portbury Coal Stockyard' })).toBe('bulk');
    expect(industrySub({ name: 'Remix Dry Mortar Works' })).toBe('bulk');
    expect(industrySub({ name: 'Avonmouth LPG Storage Facility' })).toBe('fuel');
    expect(industrySub({ name: 'Oil Terminal' })).toBe('fuel');
    expect(industrySub({ landuse: 'industrial', industrial: 'port' })).toBe('port');
    expect(industrySub({ name: 'Royal Portbury Dock' })).toBe('port');
    expect(industrySub({ name: 'Cabot Business Park' })).toBeUndefined();
  });
});

describe('the docks and the yards', () => {
  it("stacks a container terminal's containers in blocks, reach stackers and lorries in the aisles", () => {
    const map = yardMap('container', 'Avonmouth Container Port');
    const life = drain(placesWork(map));
    const boxes = life.things.filter((t) => t.kind === 'container');
    expect(boxes.length).toBeGreaterThan(100);
    expect(life.things.some((t) => t.kind === 'forklift')).toBe(true);
    expect(life.spaces.some((s) => s.kind === 'lorry')).toBe(true);
    tidy(map, boxes.map((t) => [t.x, t.y]));
    // None on top of another.
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y)).toBeGreaterThan(2.5 * M);
  });

  it("fills a car terminal with rows of new cars, nose to nose", () => {
    const map = yardMap('cars', 'Vehicle Storage Yard');
    const cars = drain(placesWork(map)).spaces.filter((s) => s.kind !== 'lorry' && s.kind !== 'van');
    expect(cars.length).toBeGreaterThan(150);
    tidy(map, cars.map((s) => [s.x, s.y]));
  });

  it("heaps up a bulk yard's coal, a loader and a dumper by each heap, a conveyor off it", () => {
    const map = yardMap('bulk', 'Coal Yard');
    const life = drain(placesWork(map));
    const heaps = life.areas.filter((a) => a.kind === 'coal');
    expect(heaps.length).toBeGreaterThan(1);
    expect(life.things.filter((t) => t.kind === 'digger').length).toBe(heaps.length);
    expect(life.lines.some((l) => l.kind === 'pipe')).toBe(true);
    tidy(map, heaps.flatMap((h) => [[h.rings[0][0], h.rings[0][1]] as [number, number]]));
  });

  it("walls a tank farm's tanks in their bunds, and pipes them one to the next", () => {
    const map = yardMap('fuel', 'Oil Terminal', 4);
    const life = drain(placesWork(map));
    expect(life.lines.filter((l) => l.kind === 'wall').length).toBe(4);
    expect(life.lines.filter((l) => l.kind === 'pipe').length).toBe(3);
  });

  it("fills an ordinary works' open yard with lorries parked up, containers, pallets and skips, and its workers", () => {
    const map = yardMap(undefined, 'Sevalco Plant');
    const life = drain(placesWork(map));
    const kinds = new Set(life.things.map((t) => t.kind));
    expect(life.spaces.filter((s) => s.kind === 'lorry').length).toBeGreaterThan(2);
    expect(kinds.has('container') && kinds.has('skip')).toBe(true);
    expect(life.spots.filter((s) => s.hivis).length).toBeGreaterThan(2);
    tidy(map, life.things.map((t) => [t.x, t.y]));
  });
});

describe("the docks' quays", () => {
  it('moor ships along a big dock where the port is behind its edge, and put cranes along it, their jibs out over the water', () => {
    // A dock 300 m by 100 m; the port's land along its south side.
    const dock: Pts = [0, 0, 2400, 0, 2400, 800, 0, 800];
    const water = new Water([{ kind: 'water', rings: [dock] }]);
    const port = [-100, 800, 2500, 800, 2500, 1600, -100, 1600];
    const nodes = new Map(port.reduce<[number, { id: number; lat: number; lon: number; tags: Record<string, string> }][]>((list, _v, k) => (k % 2 ? list : [...list, [k / 2 + 1, { id: k / 2 + 1, lat: 0, lon: 0, tags: {} }]]), []));
    const data = { bounds: null, nodes, ways: new Map([[1, { id: 1, nodes: [1, 2, 3, 4, 1], tags: { landuse: 'industrial', name: 'Avonmouth Dock' } }]]), relations: new Map() } as unknown as OsmData;
    const quays = dockQuays([{ kind: 'water', rings: [dock] }], water, data, () => port, M);
    expect(quays.ships.length).toBe(1);
    // Along the south edge.
    expect(quays.ships[0].filter((_, k) => k % 2).every((y) => y === 800)).toBe(true);
    expect(quays.cranes.length).toBeGreaterThanOrEqual(2);
    for (const c of quays.cranes) {
      expect(c.y).toBeGreaterThan(800);
      // Facing north, out over the water.
      expect(Math.sin(c.angle)).toBeLessThan(-0.99);
    }
  });
});
