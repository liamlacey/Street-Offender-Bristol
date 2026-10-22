import { describe, expect, it } from 'vitest';
import type { Building, GameMap } from '../map/osm';
import { pointInRing } from '../map/osm';
import { HOME_SIZE, homesWork } from './homes';
import { buildWorld } from './world';
import { drain } from './work.ts';

const M = 8;
const house = (id: number, x: number, y: number, w: number, d: number, kind = 'house'): Building => ({ id, rings: [[x, y, x + w, y, x + w, y + d, x, y + d]], top: 8 * M, bottom: 0, kind, solid: true, drawn: true });

/**
 * A street running east along y = 400 (7 m wide, pavements both sides); a terrace of four houses on its south side, 5 m wide and
 * 8 m deep, 3 m back from the pavement; a detached house further along, 12 m wide, 8 m back (room for a drive). Behind them, 40 m
 * on, the backs of a row of houses facing a street further south (y = 1100).
 */
function street(): GameMap {
  const buildings: Building[] = [];
  const front = 400 + 28 + 2.4 * M + 3 * M;
  for (let k = 0; k < 4; k++) buildings.push(house(k + 1, 200 + k * 5 * M, front, 5 * M, 8 * M, 'terrace'));
  buildings.push(house(5, 600, 400 + 28 + 2.4 * M + 8 * M, 12 * M, 9 * M, 'detached'));
  const back = front + 8 * M + 40 * M;
  for (let k = 0; k < 4; k++) buildings.push(house(k + 6, 200 + k * 5 * M, back, 5 * M, 8 * M, 'terrace'));
  return {
    attribution: '', pxPerMetre: M, width: 1400, height: 1400, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [{ kind: 'gardens', rings: [[0, 0, 1400, 0, 1400, 1400, 0, 1400]] }],
    roads: [
      { kind: 'street', width: 7 * M, pts: [0, 400, 1400, 400], pavement: 'both' },
      { kind: 'street', width: 7 * M, pts: [0, back + 8 * M + 3 * M + 2.4 * M + 28, 1400, back + 8 * M + 3 * M + 2.4 * M + 28], pavement: 'both' },
    ],
    lines: [], buildings, props: [], crossings: [], signals: [], controllers: [], trees: [],
  } as unknown as GameMap;
}

describe('homes', () => {
  const map = street();
  const homes = drain(homesWork(map));
  const plotOf = (id: number) => homes.plots.find((p) => map.buildings[p.building].id === id)!;

  it('finds the houses, each facing its street, a front garden to the pavement and a back garden half way to the houses behind', () => {
    expect(homes.plots).toHaveLength(9);
    const p = plotOf(2);
    // Facing north, to the street.
    expect(p.fy).toBeCloseTo(-1, 3);
    expect(p.frontDepth / M).toBeGreaterThan(2.3);
    expect(p.frontDepth / M).toBeLessThan(3.1);
    // 40 m to the houses behind: 20 m each.
    expect(p.backDepth / M).toBeCloseTo(20, 0);
    // Those behind face the other way, to their own street.
    expect(plotOf(7).fy).toBeCloseTo(1, 3);
  });

  it("fences the gardens: along the front (a gap for the gate), between the houses, and once along the backs where they meet", () => {
    const walls = homes.lines;
    expect(walls.length).toBeGreaterThan(20);
    // Along the backs, where the two rows' gardens meet (half way): one fence, not two.
    const mid = plotOf(2).y + 4 * M + 20 * M;
    const backs = walls.filter((l) => Math.abs(l.pts[1] - mid) < 1 && Math.abs(l.pts[3] - mid) < 1);
    expect(backs).toHaveLength(4);
    // All of it knocked down like any other wall.
    const world = buildWorld(map);
    expect(world.walls[0].filter((w) => w.kind === 'fence' || w.kind === 'hedge' || w.kind === 'wall').length).toBeGreaterThanOrEqual(walls.length);
  });

  it('gives the detached house a drive (a car on it, more often than not) and keeps everything in the gardens, clear of the houses', () => {
    expect(homes.drives).toHaveLength(1);
    expect(homes.spaces).toHaveLength(1);
    expect(homes.spaces[0].endOn).toBe(true);
    expect(homes.things.length).toBeGreaterThan(9);
    expect(homes.things.some((t) => t.kind === 'wheelie')).toBe(true);
    for (const t of homes.things) {
      for (const b of map.buildings) expect(pointInRing(t.x, t.y, b.rings[0])).toBe(false);
      expect(HOME_SIZE[t.kind]).toBeDefined();
    }
    // Each a loose thing, its drive and patios on the ground.
    const world = buildWorld(street());
    expect(world.loose.filter((l) => l.kind === 'wheelie').length).toBe(homes.things.filter((t) => t.kind === 'wheelie').length);
    expect(world.map.areas.some((a) => a.kind === 'drive')).toBe(true);
    // The same each time.
    expect(drain(homesWork(street()))).toEqual(homes);
  });
});
