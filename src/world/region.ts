/**
 * Everything the game makes of a region of the map (see streamer.ts): what
 * you crash into, what's underfoot, the lie of the land, the bridges, drops,
 * kerbs and humps, the buildings as they're drawn, and the traffic, people
 * and boats. Made a little at a time (see work.ts), so the next region can
 * be made ready while you drive about this one, a few milliseconds a frame.
 */

import type { RegionMap } from '../map/regions';
import { CircleGrid, SegmentGrid } from '../physics/collisions';
import { Boats } from './boats';
import { type BuildingIndex, buildingIndexWork } from './buildingIndex';
import { Decks, waterOf } from './decks';
import { Humps } from './humps';
import { Kerbs } from './kerbs';
import { Ledges } from './ledges';
import { People } from './people';
import type { SurfaceGrid } from './surface';
import { Terrain } from './terrain';
import { Traffic } from './traffic';
import { Trains } from './trains';
import type { Work } from './work.ts';
import { type World, worldWork } from './world';

export interface Region {
  map: RegionMap;
  world: World;
  terrain: Terrain;
  surfaces: SurfaceGrid;
  /** What you hit on each level: the ground's, the bridges' decks', the tunnels'. */
  walls: [SegmentGrid, SegmentGrid, SegmentGrid];
  posts: [CircleGrid, CircleGrid, CircleGrid];
  decks: Decks;
  /** The tunnels (level 2: see Decks). */
  tunnels: Decks;
  ledges: Ledges;
  kerbs: Kerbs;
  humps: Humps;
  buildings: BuildingIndex;
  traffic: Traffic;
  boats: Boats;
  people: People;
  trains: Trains;
}

/** How far along making a region is (0 to 1), and what it's doing. */
export interface Progress {
  done: number;
  label: string;
}

/** Where its ids start (so none is the same as one in the region before it: see the systems' `adopt`). */
export interface FirstIds {
  traffic: number;
  people: number;
  boats: number;
  trains: number;
}

/**
 * Makes a region of the map, a little at a time. The surfaces are painted by
 * `surfaces` (it needs a canvas: see GroundLayer.ts). `progress` is kept up
 * to date, for a loading screen. `underway`: how many boats are out on the
 * water already (finding their ways takes a while: none, for a region made
 * while you drive, its boats out of sight, set off in time).
 */
export function* regionWork(map: RegionMap, ids: FirstIds, surfaces: (world: World, bounds: RegionMap['region']) => Work<SurfaceGrid>, progress: Progress = { done: 0, label: '' }, underway = 3): Work<Region> {
  const stage = (done: number, label: string) => Object.assign(progress, { done, label });
  stage(0.02, 'Laying the ground');
  const terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges, true);
  if (map.terrain) yield* terrain.build(map.terrain, map.ledges);
  const world = yield* worldWork(map, terrain);
  stage(0.2, 'Painting the roads');
  const grid = yield* surfaces(world, map.region);
  // (Put in a few thousand at a time: a region has a great many walls.)
  const walls: [SegmentGrid, SegmentGrid, SegmentGrid] = [new SegmentGrid([]), new SegmentGrid([]), new SegmentGrid([])];
  const posts: [CircleGrid, CircleGrid, CircleGrid] = [new CircleGrid([]), new CircleGrid([]), new CircleGrid([])];
  for (const level of [0, 1, 2]) {
    for (const [k, w] of world.walls[level].entries()) {
      walls[level].add(w);
      if (k % 4000 === 3999) yield;
    }
    for (const [k, p] of world.posts[level].entries()) {
      posts[level].add(p);
      if (k % 8000 === 7999) yield;
    }
  }
  stage(0.3, 'Putting up the buildings');
  const decks = new Decks(map.roads, (x, y) => terrain.at(x, y) * terrain.px, waterOf(map));
  const tunnels = new Decks(map.roads, (x, y) => terrain.at(x, y) * terrain.px, () => false, true);
  yield;
  const ledges = new Ledges(map);
  const kerbs = new Kerbs(map);
  yield;
  const humps = new Humps(map);
  yield;
  const buildings = yield* buildingIndexWork(world, terrain);
  stage(0.38, 'Starting the traffic');
  const traffic = new Traffic(map, { terrain, firstId: ids.traffic }, true);
  yield* traffic.setup(map, { terrain, firstId: ids.traffic });
  stage(0.62, 'Mooring the boats');
  const boats = new Boats(map, { firstId: ids.boats }, true);
  yield* boats.setup(underway);
  stage(0.75, 'Filling the streets');
  const people = new People(map, { seats: world.loose, firstId: ids.people }, true);
  yield* people.setup();
  stage(0.92, 'Running the trains');
  const trains = new Trains(map, { firstId: ids.trains }, true);
  yield* trains.setup();
  stage(0.95, 'Looking round');
  return { map, world, terrain, surfaces: grid, walls, posts, decks, tunnels, ledges, kerbs, humps, buildings, traffic, boats, people, trains };
}
