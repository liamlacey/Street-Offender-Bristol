/**
 * Locations: the setting a track is generated in. Each one decides how the
 * road and its surroundings look and what lines it: the road surface and its
 * edges, what's off the road, the barriers, the obstacles, the scenery and
 * the cars. Add a location by adding an entry here (and any new kinds of
 * barrier, obstacle or car look it needs).
 *
 * Locations are natural places, not race circuits: no grandstands, crowds,
 * marshals, banners, gantries, pits or advertising, unless a location is
 * specifically meant to be a race venue: the Circuit, which has a `circuit`
 * style (see circuit/).
 */

import { SURFACE_GRIP, type SurfaceKind } from '../car/CarPhysics';
import { type CircuitStyle, FULL_CIRCUIT } from '../circuit/style';

export type LocationId = 'docklands' | 'woodlands' | 'circuit' | 'downtown' | 'winter' | 'desert';

/** What fills the land around the track (see track/decoration.ts). */
export interface DecorationStyle {
  /** What fills the land further from the track. */
  scenery: ('containers' | 'trees' | 'sheds' | 'tanks')[];
  /**
   * A working port around the track: concrete yards and dock water with quays,
   * ships, cranes, roads and a railway, and the life of the docks (gulls, tugs,
   * lorries, forklifts and dockers at work).
   */
  port: boolean;
  /** Rows of tree canopy along both sides of the track (0 = none). */
  forestRows: number;
  /** Streams (forded) and rivers (bridged) that cross the road, per 10,000 px of track. */
  water: { streamsPer10k: number; riversPer10k: number } | null;
  /** Mud and puddles on the road, per 10,000 px of track (on a medium track; more on harder ones). */
  roadPatches: { mudPer10k: number; puddlesPer10k: number } | null;
  /** Piles of logs in the run-off (solid), per 10,000 px of track. */
  logPilesPer10k: number;
  /**
   * Forestry worksites in the trees, per 10,000 px of track (at least one if
   * any): a loader filling timber lorries that come and go down a logging
   * track, a harvester at work, and felling crews in other clearings.
   */
  forestryPer10k: number;
  /** Clearings in the trees with something in them (cabins, deer, campers...), per 10,000 px of track. */
  clearingsPer10k: number;
  /** Falling leaves and birds flying over. */
  wildlife: boolean;
  /** Cloud shadows drifting over everything. */
  clouds: boolean;
  /** Street lamps along the barriers. */
  lamps: boolean;
  /**
   * A city round the track: high-rise blocks, side streets with traffic,
   * junctions with traffic lights and crossings, and people on the pavements
   * (see downtown/).
   */
  city: boolean;
  /**
   * Deep winter: the woods under snow (snow-laden conifers, chalets, frozen
   * streams, drifts and ice on the road, snow falling), and mountains, frozen
   * lakes with skaters, and ski runs with lifts, skiers and snowboarders
   * (see winter/).
   */
  winter: boolean;
  /**
   * The Nevada desert: red rock buttes leaning out from the middle of the view,
   * sand dunes with buggies, dry lake beds with land yachts, ghost towns,
   * cacti and Joshua trees, desert camps, wild horses, and dust devils,
   * tumbleweeds, vultures and the odd UFO (see desert/).
   */
  desert: boolean;
}

export interface Location {
  id: LocationId;
  name: string;
  /** One line for the menu. */
  description: string;
  road: {
    /**
     * A dirt road (looser than tarmac, so cars slide more); no road at all:
     * paved ground, the same inside the barriers as out, where only the
     * barriers mark the way; (for a race circuit) tarmac with kerbs; a city
     * street, its pavements as drivable as the road; or a road of packed
     * snow, with deep snow either side and water frozen to ice; or a dusty
     * desert track, with soft sand either side and drifted across it.
     */
    kind: 'tarmac' | 'dirt' | 'paved' | 'street' | 'snow' | 'desert';
    /** Usual width of the way through, px (the AI's racing line and the obstacles keep to it). */
    width: number;
    /** Most the width may swing either way on the hardest tracks, as a fraction of `width`. */
    widthVariation: number;
    kerbWidth: number;
    /** Colour of the road (and on the menu's map). */
    surface: number;
    /** Alternating colours along the road's edges (the verge of a dirt road, or a circuit's kerbs). */
    kerbColors: [number, number];
    /** How far in from each edge the AI keeps (past its usual margin), px: a city street's parking lanes. */
    keepOff?: number;
  };
  /** The ground off the road (the forest floor, or a circuit's mown grass). */
  ground: { base: number; stripe: number; tuft: number };
  /** What the barriers are made of (a circuit's are tyres; a city's, the bollards along the back of the pavement). */
  barrier: 'logs' | 'concrete' | 'tyres' | 'bollards' | 'snowbanks' | 'redrocks';
  /**
   * The loose things on and by the road: cones and oil drums, straw bales,
   * (at a circuit) cones and tyres, (in town) road works' cones and barrels,
   * (in the snow) snowmen and blocks of ice, or (in the desert) tumbleweeds
   * and old wooden barrels.
   */
  obstacle: 'drums' | 'bales' | 'cones' | 'barrels' | 'snowmen' | 'tumbleweeds';
  decoration: DecorationStyle;
  /** For the race circuit only: its grandstands, pits, gravel traps and so on. */
  circuit?: CircuitStyle;
  car: 'saloon' | 'rally' | 'racer';
  /** Shapes the generator makes here. */
  layout: {
    /** Higher = more corners for a given length (0.5 = standard). */
    twistiness: number;
    /** Space between the road and the barriers, as a multiple of the standard for the track difficulty. */
    runOffScale: number;
    /** Laid out along a city's street grid, with right-angle turns at the junctions (see downtown/grid.ts). */
    grid?: boolean;
  };
}

export const LOCATIONS: Record<LocationId, Location> = {
  docklands: {
    id: 'docklands',
    name: 'Docklands',
    description: 'Through a working port: quays, ships, cranes and warehouses',
    road: {
      kind: 'paved',
      width: 200,
      widthVariation: 0.3,
      kerbWidth: 16,
      surface: 0xb4b1a8,
      kerbColors: [0xa19e96, 0x96938b],
    },
    ground: { base: 0xb4b1a8, stripe: 0xaeaba2, tuft: 0x9a978f },
    barrier: 'concrete',
    obstacle: 'drums',
    decoration: {
      scenery: ['containers', 'sheds', 'tanks'],
      port: true,
      forestRows: 0,
      water: null,
      roadPatches: null,
      logPilesPer10k: 0,
      forestryPer10k: 0,
      clearingsPer10k: 0,
      wildlife: false,
      clouds: true,
      lamps: true,
      city: false,
      winter: false,
      desert: false,
    },
    car: 'saloon',
    // The barriers are the edge of the way through, so they stand close to it.
    layout: { twistiness: 0.5, runOffScale: 0.35 },
  },
  woodlands: {
    id: 'woodlands',
    name: 'Woodlands',
    description: 'Dirt roads, mud, puddles, streams and dense forest',
    road: {
      kind: 'dirt',
      width: 175,
      widthVariation: 0.35,
      kerbWidth: 10,
      surface: 0x8a6d47,
      kerbColors: [0x6f6a3c, 0x66623a],
    },
    ground: { base: 0x2f4a25, stripe: 0x324e27, tuft: 0x4a3f26 },
    barrier: 'logs',
    obstacle: 'bales',
    decoration: {
      scenery: ['trees'],
      port: false,
      forestRows: 5,
      water: { streamsPer10k: 0.9, riversPer10k: 0.35 },
      roadPatches: { mudPer10k: 2.2, puddlesPer10k: 3 },
      logPilesPer10k: 2.5,
      forestryPer10k: 1.6,
      clearingsPer10k: 3,
      wildlife: true,
      clouds: true,
      lamps: false,
      city: false,
      winter: false,
      desert: false,
    },
    car: 'rally',
    layout: { twistiness: 0.62, runOffScale: 0.85 },
  },
  circuit: {
    id: 'circuit',
    name: 'Circuit',
    description: 'A classic motor racing circuit: grandstands, pits and gravel traps',
    road: {
      kind: 'tarmac',
      width: 210,
      widthVariation: 0.2,
      kerbWidth: 14,
      surface: 0x55585e,
      kerbColors: [0xd7263d, 0xf2f2f2],
    },
    ground: { base: 0x4f8a3a, stripe: 0x5a9744, tuft: 0x3f7a30 },
    barrier: 'tyres',
    obstacle: 'cones',
    decoration: {
      scenery: ['trees'],
      port: false,
      forestRows: 0,
      water: null,
      roadPatches: null,
      logPilesPer10k: 0,
      forestryPer10k: 0,
      clearingsPer10k: 0,
      wildlife: false,
      clouds: true,
      lamps: false,
      city: false,
      winter: false,
      desert: false,
    },
    circuit: FULL_CIRCUIT,
    car: 'racer',
    // Wide run-off, for the gravel traps.
    layout: { twistiness: 0.5, runOffScale: 1 },
  },
  downtown: {
    id: 'downtown',
    name: 'Downtown',
    description: 'City streets, traffic lights, high-rises and busy pavements',
    road: {
      kind: 'street',
      // Four lanes, with a parking lane down each side.
      width: 260,
      widthVariation: 0,
      kerbWidth: 10,
      surface: 0x45484e,
      kerbColors: [0xc4c1b8, 0xb6b3aa],
      // Out of the parking lanes (see downtown/road.ts).
      keepOff: 22,
    },
    // The pavements, and the city's concrete.
    ground: { base: 0xa9a69e, stripe: 0xa29f97, tuft: 0x96938b },
    barrier: 'bollards',
    obstacle: 'barrels',
    decoration: {
      scenery: [],
      port: false,
      forestRows: 0,
      water: null,
      roadPatches: null,
      logPilesPer10k: 0,
      forestryPer10k: 0,
      clearingsPer10k: 0,
      wildlife: false,
      clouds: true,
      lamps: false,
      city: true,
      winter: false,
      desert: false,
    },
    car: 'saloon',
    // The pavement between the kerb and the bollards.
    layout: { twistiness: 0.5, runOffScale: 0.7, grid: true },
  },
  winter: {
    id: 'winter',
    name: 'Winter',
    description: 'Snowy mountain roads, frozen lakes and ski slopes',
    road: {
      kind: 'snow',
      width: 180,
      widthVariation: 0.3,
      kerbWidth: 12,
      surface: 0xd5dde3,
      // The snow ploughed up along the edges.
      kerbColors: [0xf5f8fa, 0xe8eef2],
    },
    ground: { base: 0xeef3f6, stripe: 0xe3eaef, tuft: 0xc8d5de },
    barrier: 'snowbanks',
    obstacle: 'snowmen',
    decoration: {
      // Stands of pines out across the snow.
      scenery: ['trees'],
      port: false,
      forestRows: 4,
      water: { streamsPer10k: 0.7, riversPer10k: 0.3 },
      // Drifts across the road (where the woods have mud) and sheets of ice (where they have puddles).
      roadPatches: { mudPer10k: 2, puddlesPer10k: 3.2 },
      logPilesPer10k: 1,
      forestryPer10k: 0,
      clearingsPer10k: 2.5,
      wildlife: true,
      clouds: true,
      lamps: false,
      city: false,
      winter: true,
      desert: false,
    },
    car: 'rally',
    layout: { twistiness: 0.6, runOffScale: 0.85 },
  },
  desert: {
    id: 'desert',
    name: 'Desert',
    description: 'Dusty Nevada tracks, dunes, red rocks and ghost towns',
    road: {
      kind: 'desert',
      width: 190,
      widthVariation: 0.3,
      kerbWidth: 12,
      surface: 0xc29a6b,
      // Sand blown up along the edges.
      kerbColors: [0xdcc196, 0xd5b98c],
    },
    ground: { base: 0xdcc59c, stripe: 0xd3ba8e, tuft: 0x8a8a5c },
    barrier: 'redrocks',
    obstacle: 'tumbleweeds',
    decoration: {
      scenery: [],
      port: false,
      forestRows: 0,
      water: null,
      // Sand blown across the road (where the woods have mud); no puddles here.
      roadPatches: { mudPer10k: 2.6, puddlesPer10k: 0 },
      logPilesPer10k: 0,
      forestryPer10k: 0,
      // Camps, wild horses and wrecks beside the track.
      clearingsPer10k: 2.2,
      wildlife: false,
      clouds: true,
      lamps: false,
      city: false,
      winter: false,
      desert: true,
    },
    car: 'rally',
    layout: { twistiness: 0.5, runOffScale: 0.9 },
  },
};

export const LOCATION_LIST: Location[] = Object.values(LOCATIONS);

/**
 * What a car is really driving on at a location: on a dirt road it's dirt
 * (and grass beside it); where it's paved, it's the same everywhere; on
 * tarmac, it's the road, kerbs and grass as they are.
 */
export function locationSurface(location: Location, surface: SurfaceKind): SurfaceKind {
  if (location.road.kind === 'dirt') return surface === 'road' ? 'dirt' : surface;
  // Paved all the way to the barriers: it's all the same underneath.
  if (location.road.kind === 'paved') return surface === 'kerb' || surface === 'grass' ? 'road' : surface;
  // Snow: packed on the road, deep either side; water and puddles frozen, mud piled up as drifts.
  if (location.road.kind === 'snow') {
    const winter: Partial<Record<SurfaceKind, SurfaceKind>> = { road: 'snow', kerb: 'snow', grass: 'drift', mud: 'drift', water: 'ice' };
    return winter[surface] ?? surface;
  }
  // The desert: a dirt track, soft sand either side and blown across it.
  if (location.road.kind === 'desert') {
    const desert: Partial<Record<SurfaceKind, SurfaceKind>> = { road: 'dirt', kerb: 'dirt', grass: 'sand', mud: 'sand' };
    return desert[surface] ?? surface;
  }
  // A city's kerbs and pavements are as good to drive on as its streets.
  if (location.road.kind === 'street') return surface === 'grass' || surface === 'kerb' ? 'road' : surface;
  return surface;
}

/**
 * How much less grip the road has here than tarmac, as a multiple for the
 * AI's cornering speeds (a dirt road is taken slower).
 */
export function cornerScale(location: Location): number {
  return Math.sqrt(SURFACE_GRIP[locationSurface(location, 'road')].grip);
}
