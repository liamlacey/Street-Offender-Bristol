/**
 * Everything on the island that can be shot at, and what it's made of. The
 * material decides how it takes a hit: stone cracks then crumbles, trees
 * split and burn to ash, buildings collapse and burn, vehicles and fuel
 * explode, straw (haystacks, crops, long grass, tents) goes up in flames
 * and spreads it, fences and crates splinter, and bridges fall into the
 * river.
 */

export type Material = 'plant' | 'stone' | 'building' | 'metal' | 'fuel' | 'straw' | 'wood' | 'bridge';

export type ThingKind =
  | 'oak'
  | 'pine'
  | 'palm'
  | 'bush'
  | 'rock'
  | 'boulder'
  | 'house'
  | 'barn'
  | 'car'
  | 'truck'
  | 'tractor'
  | 'haystack'
  | 'fence'
  | 'barrel'
  | 'crate'
  | 'fueltank'
  | 'boat'
  | 'townhouse'
  | 'shop'
  | 'church'
  | 'fountain'
  | 'bridge'
  | 'stonebridge'
  | 'crop'
  | 'grass'
  | 'beachhut'
  | 'parasol'
  | 'tent'
  | 'campfire'
  | 'stump'
  | 'logpile'
  | 'harvester'
  | 'lifttower'
  | 'liftstation'
  | 'chalet'
  | 'jetty'
  | 'warehouse'
  | 'crane'
  | 'container'
  | 'trawler'
  | 'forklift'
  | 'tower'
  | 'office'
  | 'bench'
  | 'bus'
  | 'silo'
  | 'combine'
  | 'railbridge'
  | 'station'
  | 'loco'
  | 'carriage'
  | 'police'
  | 'policevan';

export interface KindDef {
  material: Material;
  /** Collision radius, px. */
  r: number;
  /** Drawn size, px. */
  w: number;
  h: number;
  hp: number;
  /** Stops the tank while standing. (The rest it rolls over and flattens.) */
  solid: boolean;
  /** Still stops the tank once wrecked (a burnt-out vehicle, a fuel tank's shell). */
  wreckSolid?: boolean;
  /** How long it burns once alight, s (0: it doesn't). */
  burns: number;
  /** The blast when it goes up: reach, px, and strength (hit points at the middle). */
  explodes?: { radius: number; power: number };
  /** Rockets fly over it rather than hitting it. */
  low?: boolean;
}

export const KINDS: Record<ThingKind, KindDef> = {
  oak: { material: 'plant', r: 17, w: 64, h: 64, hp: 30, solid: true, burns: 9 },
  pine: { material: 'plant', r: 13, w: 52, h: 52, hp: 24, solid: true, burns: 8 },
  palm: { material: 'plant', r: 11, w: 58, h: 58, hp: 20, solid: true, burns: 6 },
  bush: { material: 'plant', r: 10, w: 28, h: 28, hp: 4, solid: false, burns: 3, low: true },
  rock: { material: 'stone', r: 15, w: 34, h: 34, hp: 45, solid: true, burns: 0 },
  boulder: { material: 'stone', r: 29, w: 66, h: 66, hp: 110, solid: true, burns: 0 },
  house: { material: 'building', r: 34, w: 74, h: 58, hp: 70, solid: true, burns: 16 },
  barn: { material: 'building', r: 46, w: 108, h: 72, hp: 110, solid: true, burns: 22 },
  car: { material: 'metal', r: 17, w: 46, h: 22, hp: 30, solid: true, wreckSolid: true, burns: 9, explodes: { radius: 90, power: 55 } },
  truck: { material: 'metal', r: 22, w: 66, h: 28, hp: 50, solid: true, wreckSolid: true, burns: 12, explodes: { radius: 110, power: 70 } },
  tractor: { material: 'metal', r: 17, w: 42, h: 30, hp: 40, solid: true, wreckSolid: true, burns: 9, explodes: { radius: 80, power: 50 } },
  haystack: { material: 'straw', r: 13, w: 32, h: 32, hp: 6, solid: false, burns: 7 },
  fence: { material: 'wood', r: 8, w: 40, h: 8, hp: 6, solid: false, burns: 0, low: true },
  barrel: { material: 'fuel', r: 9, w: 20, h: 20, hp: 6, solid: false, burns: 0, explodes: { radius: 120, power: 90 } },
  crate: { material: 'wood', r: 10, w: 22, h: 22, hp: 6, solid: false, burns: 0 },
  fueltank: { material: 'fuel', r: 30, w: 64, h: 64, hp: 40, solid: true, wreckSolid: true, burns: 15, explodes: { radius: 190, power: 130 } },
  boat: { material: 'metal', r: 18, w: 48, h: 20, hp: 25, solid: true, burns: 8, explodes: { radius: 70, power: 40 } },
  townhouse: { material: 'building', r: 29, w: 64, h: 54, hp: 90, solid: true, burns: 16 },
  shop: { material: 'building', r: 28, w: 62, h: 52, hp: 70, solid: true, burns: 14 },
  church: { material: 'building', r: 48, w: 116, h: 70, hp: 170, solid: true, burns: 25 },
  fountain: { material: 'stone', r: 20, w: 44, h: 44, hp: 50, solid: true, burns: 0 },
  // Bridges: the tank drives over them; their length is the thing's own (see ThingSpec).
  bridge: { material: 'bridge', r: 40, w: 128, h: 48, hp: 70, solid: false, burns: 14 },
  stonebridge: { material: 'bridge', r: 40, w: 128, h: 56, hp: 140, solid: false, burns: 0 },
  // A patch of a field of crops, or of long grass: laid edge to edge, so fire runs across them.
  crop: { material: 'straw', r: 15, w: 48, h: 48, hp: 3, solid: false, burns: 5, low: true },
  grass: { material: 'straw', r: 15, w: 50, h: 50, hp: 2, solid: false, burns: 4, low: true },
  beachhut: { material: 'building', r: 17, w: 36, h: 38, hp: 30, solid: true, burns: 10 },
  // A sunshade with towels laid out either side.
  parasol: { material: 'wood', r: 11, w: 64, h: 44, hp: 3, solid: false, burns: 0, low: true },
  tent: { material: 'straw', r: 14, w: 34, h: 30, hp: 4, solid: false, burns: 5 },
  campfire: { material: 'stone', r: 8, w: 24, h: 24, hp: 8, solid: false, burns: 0, low: true },
  stump: { material: 'plant', r: 8, w: 20, h: 20, hp: 6, solid: false, burns: 3, low: true },
  logpile: { material: 'wood', r: 20, w: 58, h: 34, hp: 25, solid: true, burns: 0 },
  harvester: { material: 'metal', r: 22, w: 64, h: 34, hp: 50, solid: true, wreckSolid: true, burns: 10, explodes: { radius: 90, power: 55 } },
  // A ski lift's pylons, and the stations at either end.
  lifttower: { material: 'stone', r: 7, w: 16, h: 16, hp: 30, solid: true, burns: 0 },
  liftstation: { material: 'building', r: 26, w: 58, h: 44, hp: 70, solid: true, burns: 14 },
  chalet: { material: 'building', r: 30, w: 66, h: 54, hp: 70, solid: true, burns: 16 },
  // The harbours: jetties (the tank can drive out along them, like a bridge), the yard's buildings and machinery, and fishing boats.
  jetty: { material: 'bridge', r: 4, w: 128, h: 26, hp: 40, solid: false, burns: 12 },
  warehouse: { material: 'building', r: 40, w: 96, h: 70, hp: 130, solid: true, burns: 22 },
  crane: { material: 'metal', r: 16, w: 38, h: 38, hp: 60, solid: true, wreckSolid: true, burns: 0 },
  container: { material: 'metal', r: 16, w: 54, h: 22, hp: 40, solid: true, wreckSolid: true, burns: 8 },
  trawler: { material: 'metal', r: 22, w: 76, h: 26, hp: 45, solid: true, burns: 10, explodes: { radius: 80, power: 45 } },
  // The city: towers and office blocks, park benches, and buses.
  tower: { material: 'building', r: 46, w: 100, h: 100, hp: 260, solid: true, burns: 30 },
  office: { material: 'building', r: 32, w: 60, h: 100, hp: 160, solid: true, burns: 22 },
  bench: { material: 'wood', r: 7, w: 26, h: 10, hp: 3, solid: false, burns: 0, low: true },
  bus: { material: 'metal', r: 22, w: 74, h: 26, hp: 55, solid: true, wreckSolid: true, burns: 12, explodes: { radius: 100, power: 60 } },
  // The railway: its bridges, stations and trains.
  railbridge: { material: 'bridge', r: 30, w: 128, h: 40, hp: 160, solid: false, burns: 0 },
  station: { material: 'building', r: 34, w: 110, h: 50, hp: 110, solid: true, burns: 18 },
  loco: { material: 'metal', r: 18, w: 72, h: 24, hp: 90, solid: true, wreckSolid: true, burns: 12, explodes: { radius: 130, power: 80 } },
  carriage: { material: 'metal', r: 18, w: 68, h: 24, hp: 60, solid: true, wreckSolid: true, burns: 14, explodes: { radius: 70, power: 30 } },
  // The police: cars and vans.
  police: { material: 'metal', r: 17, w: 48, h: 22, hp: 35, solid: true, wreckSolid: true, burns: 9, explodes: { radius: 85, power: 50 } },
  policevan: { material: 'metal', r: 21, w: 62, h: 28, hp: 55, solid: true, wreckSolid: true, burns: 11, explodes: { radius: 100, power: 60 } },
  // The farms' grain silos, and the combine harvester.
  silo: { material: 'metal', r: 15, w: 32, h: 32, hp: 60, solid: true, wreckSolid: true, burns: 0 },
  combine: { material: 'metal', r: 24, w: 66, h: 46, hp: 50, solid: true, wreckSolid: true, burns: 12, explodes: { radius: 90, power: 50 } },
  forklift: { material: 'metal', r: 11, w: 30, h: 18, hp: 15, solid: true, wreckSolid: true, burns: 6, explodes: { radius: 60, power: 30 } },
};

/** Where something stands on the island, before anything's happened to it. */
export interface ThingSpec {
  kind: ThingKind;
  x: number;
  y: number;
  /** Which way it faces, radians. */
  angle: number;
  variant: number;
  /** How long it is, px (bridges, from bank to bank). */
  length?: number;
}
