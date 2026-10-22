import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { pointInRing } from '../map/osm';
import { MACHINES, SITE_SIZE, SiteMachines, siteLife } from './sites';
import { buildWorld } from './world';

const M = 8;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** A building site 60 m by 50 m with a street along its south side; a patch of brownfield 30 m by 25 m east of it, the same street along it. */
function lots(): GameMap {
  return {
    attribution: '', pxPerMetre: M, width: 2000, height: 1400, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
    areas: [
      { kind: 'dirt', rings: [[200, 200, 680, 200, 680, 600, 200, 600]] },
      { kind: 'brownfield', rings: [[800, 400, 1040, 400, 1040, 600, 800, 600]] },
    ],
    roads: [{ kind: 'street', width: 6 * M, pts: [0, 640, 2000, 640], pavement: 'both' }],
    lines: [], buildings: [], props: [], crossings: [], signals: [], controllers: [], trees: [],
  };
}

describe('building sites and brownfield', () => {
  const map = lots();
  const life = siteLife(map);
  const site = map.areas[0].rings[0];
  const brown = map.areas[1].rings[0];

  it('has a building site fenced round, its gate on the side by the road, its cabins, skips, materials and machines inside', () => {
    const kinds = life.things.map((t) => t.kind);
    for (const k of ['cabin', 'portaloo', 'skip', 'pallet', 'digger', 'dumper'] as const) expect(kinds).toContain(k);
    for (const t of life.things) {
      const [hl, hw] = SITE_SIZE[t.kind].map((v) => v / 2);
      const [ux, uy] = [Math.cos(t.angle), Math.sin(t.angle)];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) expect(pointInRing(t.x + ux * hl * a - uy * hw * b, t.y + uy * hl * a + ux * hw * b, site)).toBe(true);
    }
    // Fenced nearly all round (the 216 m of its edge, less a 7 m gate), the gate on its south side, by the road.
    const length = life.fences.reduce((n, f) => n + f.reduce((m, _, i) => (i >= 2 && i % 2 === 0 ? m + Math.hypot(f[i] - f[i - 2], f[i + 1] - f[i - 1]) : m), 0), 0);
    expect(length / M).toBeGreaterThan(200);
    expect(length / M).toBeLessThan(216);
    expect(life.fences.length).toBeGreaterThanOrEqual(1);
    const ends = life.fences.flatMap((f) => [[f[0], f[1]], [f[f.length - 2], f[f.length - 1]]]).filter(([x, y]) => !(x === 200 && y === 200));
    expect(ends.some(([, y]) => y === 600)).toBe(true);
    // A tower crane over it (it's big enough), and workers about it.
    expect(life.cranes).toHaveLength(0 + (480 * 400 >= 4000 * M * M ? 1 : 0));
    expect(life.workers.length).toBeGreaterThan(2);
    // The same each time.
    expect(siteLife(lots())).toEqual(life);
  });

  it('has rubbish dumped on the brownfield, in piles near the road; all of it loose things', () => {
    expect(life.tips.length).toBeGreaterThanOrEqual(2);
    for (const t of life.tips) {
      expect(pointInRing(t.x, t.y, brown)).toBe(true);
      // (Near the road, the south side.)
      expect(t.y).toBeGreaterThan(500);
    }
    const world = buildWorld(map);
    const loose = world.loose.filter((l) => [...life.things, ...life.tips].some((t) => t.kind === l.kind && t.x === l.x && t.y === l.y));
    expect(loose).toHaveLength(life.things.length + life.tips.length);
    // The fences are walls (they can be knocked down).
    expect(world.walls[0].filter((w) => w.kind === 'heras').length).toBeGreaterThan(40);
  });

  it('has its machines going about the site, and stopped for good once knocked', () => {
    const world = buildWorld(map);
    const machines = world.loose.filter((l) => MACHINES.has(l.kind));
    expect(machines.length).toBe(2);
    const work = new SiteMachines(life.sites, seeded(2));
    const start = machines.map((m) => [m.x, m.y]);
    let swung = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      work.update(1 / 30, machines);
      for (const m of machines) {
        expect(pointInRing(m.x, m.y, site)).toBe(true);
        if (m.kind === 'digger') swung = Math.max(swung, Math.abs(m.motion?.[0] ?? 0));
      }
    }
    expect(machines.some((m, i) => Math.hypot(m.x - start[i][0], m.y - start[i][1]) > 2 * M)).toBe(true);
    expect(swung).toBeGreaterThan(0.2);
    // Knocked: it stops where it is.
    const m = machines[0];
    m.moved = true;
    const at = [m.x, m.y];
    for (let t = 0; t < 20; t += 1 / 30) work.update(1 / 30, machines);
    expect([m.x, m.y]).toEqual(at);
  });

  it('puts a tower crane over a big building site, clear of everything else', () => {
    const big = lots();
    big.areas[0].rings[0] = [200, 200, 900, 200, 900, 600, 200, 600];
    big.areas[1].rings[0] = [1000, 400, 1240, 400, 1240, 600, 1000, 600];
    const { cranes, things } = siteLife(big);
    expect(cranes).toHaveLength(1);
    const [c] = cranes;
    expect(pointInRing(c.x, c.y, big.areas[0].rings[0])).toBe(true);
    for (const t of things) expect(Math.hypot(t.x - c.x, t.y - c.y)).toBeGreaterThan(2 * M);
    expect(buildWorld(big).fixed.filter((p) => p.kind === 'crane' && p.tower)).toHaveLength(1);
  });

  it('has a bigger brownfield strewn with rubbish, a burnt-out car on it, a camp away from the road, gulls, and people cutting across it', () => {
    const big = lots();
    big.areas[1].rings[0] = [800, 120, 1300, 120, 1300, 600, 800, 600];
    const life = siteLife(big);
    const brown = big.areas[1].rings[0];
    const on = (k: string) => life.tips.filter((t) => t.kind === k && pointInRing(t.x, t.y, brown));
    expect(life.tips.filter((t) => pointInRing(t.x, t.y, brown)).length).toBeGreaterThan(25);
    expect(new Set(life.tips.map((t) => t.kind)).size).toBeGreaterThan(8);
    expect(on('burntcar').length).toBeGreaterThanOrEqual(1);
    const [fire] = on('campfire');
    expect(fire).toBeDefined();
    // (Away from the road, the south side; its tents round it.)
    expect(fire.y).toBeLessThan(400);
    expect(on('tent').length).toBeGreaterThanOrEqual(1);
    for (const t of on('tent')) expect(Math.hypot(t.x - fire.x, t.y - fire.y)).toBeLessThan(5 * M);
    expect(life.gulls.length).toBeGreaterThanOrEqual(1);
    expect(life.wanderers.length).toBeGreaterThanOrEqual(2);
    expect(life.wastes).toHaveLength(1);
  });
});
