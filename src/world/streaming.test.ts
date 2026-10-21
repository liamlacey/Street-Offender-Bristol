import { describe, expect, it } from 'vitest';
import bristol from '../map/bristol.json';
import type { GameMap } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import { Changes } from './changes';
import { type Region, regionWork } from './region';
import { SurfaceGrid } from './surface';
import { drain } from './work.ts';

const map = bristol as unknown as GameMap;
const { index, tiles } = splitMap(map);
const M = 8;

/** A region centred on a corner of the tiles (its surfaces left out: they need a canvas). */
function region(cx: number, cy: number, ids = { traffic: 0, people: 1, boats: 1, trains: 1 }): Region {
  const b = { x0: TILE * (cx - 2), y0: TILE * (cy - 2), x1: TILE * (cx + 2), y1: TILE * (cy + 2) };
  const r = assemble(index, tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!), b);
  // eslint-disable-next-line require-yield
  return drain(regionWork(r, ids, function* () { return new SurfaceGrid(new Uint8Array(1), 1, 1, 8); }));
}

describe('moving from one region of the map to the next', () => {
  const a = region(5, 5);
  // Round where the next region's made: past the first's middle, east.
  const [x, y] = [TILE * 5.6, TILE * 5];
  const view = { x0: x - 60 * M, y0: y - 40 * M, x1: x + 60 * M, y1: y + 40 * M };
  const keep = { x0: view.x0 - 100 * M, y0: view.y0 - 100 * M, x1: view.x1 + 100 * M, y1: view.y1 + 100 * M };
  const player = { x, y, heading: 0, vx: 0, vy: 0, level: 0, length: 6 * M, width: 2.5 * M };
  for (let k = 0; k < 300; k++) {
    a.traffic.update(1 / 30, player, view, () => 'green');
    a.people.update(1 / 30, view, { ...player, angle: 0, id: -1 }, [], () => 'green', () => true);
  }
  const b = region(6, 5, { traffic: a.traffic.lastId + 100_000, people: a.people.lastId + 100_000, boats: a.boats.lastId + 100_000, trains: a.trains.lastId + 100_000 });
  const inKeep = (p: { x: number; y: number }) => p.x >= keep.x0 && p.x <= keep.x1 && p.y >= keep.y0 && p.y <= keep.y1;
  const driving = a.traffic.vehicles.filter(inKeep);
  const walking = a.people.people.filter((p) => inKeep(p) && !p.gone);
  b.traffic.adopt(a.traffic, keep);
  b.people.adopt(a.people, keep);
  b.boats.adopt(a.boats, keep);

  it('the traffic round the view is the same, on the next region\'s lanes', () => {
    expect(driving.length).toBeGreaterThan(5);
    for (const v of driving) {
      expect(b.traffic.vehicles).toContain(v);
      for (const p of v.route) if (p.lane) expect(b.traffic.lanes).toContain(p.lane);
    }
    // Ids aren't shared with the next region's own.
    const ids = [...b.traffic.vehicles, ...b.traffic.parked].map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('so are the people, on its walks', () => {
    expect(walking.length).toBeGreaterThan(5);
    for (const p of walking) {
      expect(b.people.people).toContain(p);
      if (p.mode === 'walk') expect(b.people.walks[p.line]).toBeDefined();
    }
  });

  it('and it all carries on', () => {
    for (let k = 0; k < 300; k++) {
      b.traffic.update(1 / 30, player, view, () => 'green');
      b.people.update(1 / 30, view, { ...player, angle: 0, id: -1 }, [], () => 'green', () => true);
      b.boats.update(1 / 30);
    }
    const moved = driving.filter((v) => b.traffic.vehicles.includes(v) && v.mode === 'drive');
    expect(moved.length).toBeGreaterThan(driving.length / 2);
    for (const v of b.traffic.vehicles) expect([v.x, v.y].every(Number.isFinite)).toBe(true);
  });

  it("what's broken stays broken in the next region", () => {
    const changes = new Changes();
    const wall = a.world.walls[0].find((w) => w.kind === 'wall' && inKeep({ x: w.ax, y: w.ay }))!;
    const post = a.world.posts[0].find((p) => p.thing === 'lamp' && inKeep(p))!;
    changes.wallGone(wall);
    changes.postGone(post, 0);
    const c = region(6, 5);
    const down = changes.apply(c.walls, c.posts, c.map.region);
    expect(down.map((d) => [d.post.x, d.post.y])).toContainEqual([post.x, post.y]);
    const same = c.world.walls[0].find((w) => w.ax === wall.ax && w.ay === wall.ay && w.bx === wall.bx && w.by === wall.by)!;
    expect(same.gone).toBe(true);
  });
});
