/**
 * The people on the streets: walking along the pavements and paths,
 * crossing the roads at the crossings (waiting for the lights, or for a gap
 * at a zebra), wandering about the parks and squares, standing outside the
 * shops, cafés and bars, by the water, and in groups at the sights and in the
 * squares; waiting at the bus stops, getting on the buses and off them. More
 * where there's more to go to (as with the traffic). They jump out of the way
 * of a car coming at them, and run (across the roads, if need be) when
 * there's danger about; hit, they're knocked down: by a slow car they get up
 * again and go on their way; by a fast one they stay down. Pure, so it's
 * tested; the scene draws them (PeopleLayer.ts). On the ground and up on
 * the bridges (level 1, as the traffic): only what's on their level gets in
 * their way.
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis } from '../map/osm';
import { type Store, TROLLEY_GAP } from '../map/stores';
import { type TrolleyRow, trolleyRows } from './parking';
import { PLAY_KINDS, PLAY_SCALE, type PlayKind } from './playgrounds';
import { type Game, parkLifeWork } from './parkLife';
import { siteLifeWork } from './sites';
import type { SportGame } from './sports';
import { placesWork } from './places';
import { type Act, pedestrianBusy, streetLifeWork } from './streetLife';
import type { Light } from './lights';
import { offsetLine } from './world';
import { type Work, drain, every } from './work.ts';

const M = 8;
/** A vehicle standing still: its middle, which way it points, how long and half as wide, px; its level. */
export interface Block {
  x: number;
  y: number;
  angle: number;
  length: number;
  r: number;
  level: number;
  /** Yours (no one gets in it but you). */
  you?: boolean;
}

/** Walking round a vehicle standing in the way: looking this far ahead, keeping this far from its side, stepping at most this far from the line, px. */
const ROUND_LOOK = 4 * 8;
const ROUND_ROOM = 0.45 * 8;
const ROUND_MOST = 3.5 * 8;
/** And never closer to its side than this, px: a step that'd take them nearer slides along it instead (round its end, not through it). */
const ROUND_NEAREST = 0.3 * 8;

/** How far (x, y) is from the line down a vehicle's middle (its length, less its rounded ends), px. */
function bodyDist(b: Block, x: number, y: number): number {
  const h = Math.max(0, b.length / 2 - b.r);
  const [c, s] = [Math.cos(b.angle), Math.sin(b.angle)];
  const t = Math.max(-h, Math.min(h, (x - b.x) * c + (y - b.y) * s));
  return Math.hypot(x - b.x - c * t, y - b.y - s * t);
}

/** The pavement along a road: how wide, px (as it's drawn). */
const PAVEMENT = 2.4 * M;
/** How fast people walk, px/s (each a little faster or slower), and run. */
const WALK = 1.35 * M;
const RUN = 4.2 * M;
/** At most this many about at once; and how many per unit of how busy it is round you (see `weight`). */
const MOST = 220;
const PER_WEIGHT = 0.5;
/** How fast someone out for a run goes, px/s (each a little faster or slower). */
const JOG = 2.8 * M;
/** A dog's lead, px: it's never further than this from them. */
const LEAD = 2.2 * M;
/** How fast a football's passed, and a frisbee thrown, px/s; how high each goes (at the top of its flight), px. */
const PASS = 9 * M;
const THROW = 7 * M;

/**
 * How each game on a pitch or a court is played (see sports.ts): how fast its ball goes, px/s, and how high at the top of
 * its flight, px (a shot's: at the hoop, the goal, the posts, and how often one's taken); how high it's held, px (0: at their
 * feet); how long, s; how many play.
 */
const SPORT_PLAY: Record<SportGame, { speed: number; loft: number; held: number; hold: [number, number]; players: [number, number]; shot?: number; shotLoft?: number }> = {
  tennis: { speed: 15 * M, loft: 1.4 * M, held: 1 * M, hold: [0.1, 0.4], players: [2, 4] },
  padel: { speed: 11 * M, loft: 1.2 * M, held: 1 * M, hold: [0.1, 0.3], players: [4, 4] },
  pingpong: { speed: 5 * M, loft: 0.35 * M, held: 0.9 * M, hold: [0.05, 0.25], players: [2, 2] },
  basketball: { speed: 8 * M, loft: 0.6 * M, held: 1 * M, hold: [0.6, 2], players: [2, 5], shot: 0.4, shotLoft: 3.5 * M },
  netball: { speed: 8 * M, loft: 0.8 * M, held: 1.2 * M, hold: [0.8, 2.5], players: [4, 7], shot: 0.25, shotLoft: 3.2 * M },
  football: { speed: PASS, loft: 0.5 * M, held: 0, hold: [0.8, 2.8], players: [5, 12], shot: 0.15, shotLoft: 0.8 * M },
  hockey: { speed: 12 * M, loft: 0, held: 0, hold: [0.4, 1.5], players: [5, 12], shot: 0.15, shotLoft: 0.1 * M },
  rugby: { speed: 9 * M, loft: 1.2 * M, held: 1 * M, hold: [0.4, 1.4], players: [5, 8], shot: 0.08, shotLoft: 9 * M },
  cricket: { speed: 18 * M, loft: 0.8 * M, held: 1 * M, hold: [1.5, 3], players: [10, 10] },
  bowls: { speed: 3 * M, loft: 0, held: 0.3 * M, hold: [3, 7], players: [3, 3] },
  croquet: { speed: 2.5 * M, loft: 0, held: 0, hold: [4, 9], players: [2, 2] },
};
/** Kept going this far beyond the view, px; gone beyond `FAR`. */
const NEAR = 30 * M;
const FAR = 55 * M;
/** A hit faster than this, px/s (about 15 mph), and they stay down. */
const HURT = 6.7 * M;
/** How long they're down after a slower hit, s. */
const DOWN: [number, number] = [2.5, 4.5];
/** Running from danger this long, s. */
const SCARED: [number, number] = [4, 7];
/** A person's size: their radius, px, for hits. */
const R = 0.3 * M;
/** Shoppers at a shop at once, at most; and how far ahead of them their trolley is, px. */
const SHOPPERS = 16;
const HOLD = 0.85 * M;

export type Mode = 'walk' | 'stand' | 'wander' | 'kerb' | 'cross' | 'queue' | 'board' | 'flee' | 'dive' | 'down' | 'sit' | 'shop' | 'perform' | 'vend' | 'join' | 'game';

/** A bench or picnic table (as the world has it: it can be knocked about, or smashed). */
export interface Seat {
  kind: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  gone?: boolean;
  /** Smashed: its wreck left there (no one sits on it, or plays on it). */
  wrecked?: boolean;
  level: number;
  /** A playground's: how its moving parts are (see `play`). */
  motion?: number[];
}

/** A shopping trolley (as the world has it: it can be knocked about, or smashed); taken into the shop, it isn't there. */
export interface Trolley {
  kind: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  gone?: boolean;
  level: number;
  /** Knocked, and moving still. */
  moved: boolean;
  /** Smashed: its wreck left there. */
  wrecked?: boolean;
  inside?: boolean;
  full?: boolean;
}

/**
 * A shopper at a big shop with a car park (see stores.ts), from their car to
 * the trolley bay, a trolley into the shop, gone (shopping); or out of the
 * shop with a trolley full of shopping, to their car, loading it, the
 * trolley back to the bay, back to the car, and gone (driven off).
 */
export interface Trip {
  store: number;
  /** The row of trolleys they're taking one from, or putting theirs back in (see trolleyRows): its index in the store's. */
  row: number;
  /** What they're doing: for a trolley; into the shop; out to the car; loading it; the trolley back; back to the car. */
  leg: 'fetch' | 'in' | 'out' | 'load' | 'return' | 'home';
  /** The trolley they're pushing, or null. */
  trolley: Trolley | null;
  /** Their car: where it is, which way it points, how long and half as wide. */
  car: [number, number, number, number, number];
  /** Where they're going (x, y, ...), the next first. */
  route: number[];
}

/**
 * Somewhere people gather on the busy pedestrian streets and squares (see
 * streetLife.ts): a performer's pitch (a crowd round it, watching), or a food
 * cart (a queue at it).
 */
export interface Gather {
  kind: 'pitch' | 'cart';
  x: number;
  y: number;
  /** Which way the performer faces (the crowd's in front), or the cart's serving side. */
  angle: number;
  act?: Act;
  /** The cart, or the market stall (the scene's loose thing). */
  cart?: Trolley;
  stall?: boolean;
  /** The performer or the vendor there, if there is one. */
  host: Person | null;
}

/** A pigeon: where (and how high, flying), which way it's facing, how fast it's going; pecking, or flying off. */
export interface Bird {
  x: number;
  y: number;
  z: number;
  angle: number;
  vx: number;
  vy: number;
  /** Till its next hop, or how long it's been flying, s. */
  timer: number;
  peck: boolean;
  flying: boolean;
}

/** A flock of pigeons on a busy street or square: where they peck about; and, flown off, how long till they're back. */
export interface Flock {
  x: number;
  y: number;
  /** Gulls (at the rubbish on the brownfield), not pigeons. */
  gull?: boolean;
  birds: Bird[];
  away: number;
}

/**
 * A game on the grass in a park (see parkLife.ts): a kick-about, or a
 * frisbee thrown back and forth; and its ball (or frisbee): held, in the
 * air from one player to another, or on the ground for whoever it was
 * thrown to to run and get.
 */
export interface Kickabout {
  kind: Game;
  x: number;
  y: number;
  angle: number;
  /** On a pitch or a court: where the players stand (x, y, ...: see sports.ts), what they aim at; who's playing, in that order. */
  spots?: number[];
  aims?: number[];
  order?: Person[];
  ball: {
    x: number;
    y: number;
    /** How high it is, px. */
    z: number;
    from: [number, number];
    to: [number, number];
    /** How far through its flight it is, and how long that takes (0: not in the air), s. */
    t: number;
    dur: number;
    /** How high it goes, at the top of its flight (on a pitch), px. */
    loft?: number;
    holder: Person | null;
    target: Person | null;
    /** How long it's held (or dribbled) before it's passed on, s. */
    hold: number;
  };
}

/** A dog out on its lead with someone: where, which way, how fast, how far through its step; which dog; and sniffing something, a while. */
export interface Dog {
  x: number;
  y: number;
  angle: number;
  speed: number;
  step: number;
  look: number;
  sniff: number;
}

/** A picnic on the grass: its blanket (where, which way, which pattern), and how many are sitting round it. */
export interface Picnic {
  x: number;
  y: number;
  angle: number;
  pattern: number;
  /** Packed up and gone (or left behind, and now out of sight). */
  gone: boolean;
}

export interface Person {
  id: number;
  x: number;
  y: number;
  /** Which way they're facing, radians. */
  angle: number;
  /** How fast they're moving, px/s, and which way (when they're thrown, or diving). */
  speed: number;
  vx: number;
  vy: number;
  mode: Mode;
  /** Their clothes and hair (which of the looks), and how quickly they walk. */
  look: number;
  pace: number;
  /** Walking along a line (see `Walks`): which, the point they're heading for, which way along it, and how far to the side of it they keep, px. */
  line: number;
  next: number;
  dir: 1 | -1;
  side: number;
  /** Where they're going (wandering, crossing, to a bus, running away). */
  tx: number;
  ty: number;
  /** For whatever they're doing: how long left (standing about, down, scared), s. */
  timer: number;
  /** The crossing they're at (or just crossed), so they don't go straight back. */
  crossing: number;
  /** The bus stop they're waiting at, or -1. */
  stop: number;
  /** Down for good. */
  hurt: boolean;
  /** How far through a step they are (for drawing them walking), 0 to 1. */
  step: number;
  /** What they were doing before they were scared or knocked down. */
  was: Mode;
  /** The area they're wandering in, or -1. */
  area: number;
  /** Gone (on a bus). */
  gone: boolean;
  /** Getting onto their walk: to (tx, ty) on it first. */
  joining: boolean;
  /** How far they've stepped aside to get round someone, px. */
  avoid: number;
  /** Sitting: on a seat (where on it: along, across, and where the seat was when they sat), or at a picnic. */
  seat: Seat | null;
  seatAt: [number, number, number, number];
  picnic: Picnic | null;
  /** Which level they're on: 0 the ground, 1 a bridge's deck. */
  level: number;
  /** Lying under a vehicle (its id, or null): how far along it they were, px (for its wheels going over them). */
  under: number | null;
  underAlong: number;
  /** Shopping (see Trip), or null. */
  trip: Trip | null;
  /** A performer's act (or a food cart's vendor), and where they're gathered (performing, selling, watching, queuing), or null. */
  act: Act | 'vendor' | null;
  gather: Gather | null;
  /** Playing in a game on the grass (where they stand in it: tx, ty), or null. */
  game: Kickabout | null;
  /** Their dog, out on its lead, or null. */
  dog: Dog | null;
  /** Out for a run (in the park). */
  jog?: boolean;
  /** At work on a building site: a hi-vis vest and a hard hat. */
  hivis?: boolean;
  /** A child (how big, against a grown-up's 1): never hit, whatever comes at them (see `hitBy`). */
  child?: number;
  /** A lollipop lady (at a school, by the road): her white coat and her sign. */
  lollipop?: boolean;
}

/** A vehicle as the people see it: where, which way, how big, how fast; a bus's stop. */
export interface Mover {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  vx: number;
  vy: number;
  /** A bus waiting at a stop, with its door open. */
  dwelling?: boolean;
  /** At a bus station, in a bay: where its platform is (people get off to it, and on from it); and whether it's only just pulled in. */
  bay?: [number, number];
  fresh?: boolean;
  /** On a call, its siren going (people get out of its way as from you). */
  siren?: boolean;
  id: number;
  /** Which level it's on (0, the ground, if not given). */
  level?: number;
  /** A bike: it weaves round people (they're only brushed aside), and isn't dived away from. */
  bike?: boolean;
  /** Someone on foot (you, out of a car): nothing to run from. */
  onFoot?: boolean;
  /** A train's carriage (people get on and off it at its doors, either side, when it's waiting at a stop). */
  train?: boolean;
}

export interface PeopleView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A line people walk along: a footway, a path, a pavement beside a road. */
interface Walk {
  pts: Pts;
  /** How many walk along it (and stand about on it) for its length, against a quiet pavement's 1. */
  busy: number;
  /** The road it's the pavement of, or -1. */
  road: number;
  /** 0 on the ground, 1 over a bridge. */
  level: number;
  /** A cycle path (bikes come along it). */
  cycle?: boolean;
  /** Through a park (joggers and dog walkers along it). */
  park?: boolean;
}

/** Somewhere people stand: outside a shop, by the water, at a sight, in a square; in a group or not, facing which way. */
interface Spot {
  x: number;
  y: number;
  angle: number;
  /** How many are there, for its size, against the pavements' 1 per 10 m. */
  weight: number;
  group: boolean;
  /** On the grass: a picnic, perhaps. */
  grass?: boolean;
  /** On a building site: its workers, in hi-vis. */
  hivis?: boolean;
  /** On the brownfield: cutting across it, a dog with some. */
  waste?: boolean;
  /** Children (how big); a lollipop lady (see places.ts). */
  child?: number;
  lollipop?: boolean;
}

/** Where a crossing's kerbs are (either side of the road, on the pavement), and how it works. */
interface CrossingPoint {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: 'zebra' | 'lights' | 'plain';
  /** The traffic lights that stop the traffic for it. */
  signals: number[];
}

/** The number of looks (clothes and hair) the drawing has. */
export const LOOKS = 48;

const GRID = 128;
/** How many sit at a bench or picnic table, for how busy it is round it. */
const SEAT_WEIGHT = 0.9;
/** What's in a playground (see playgrounds.ts): people come to play on it, by how busy, as to a seat. */
const PLAY = new Set<string>(PLAY_KINDS);
const PLAY_WEIGHT = 2.2;
/** Where people play on each (along it, across it, px), as many as there's room for. */
/** (Bigger than life, as what they're on: see PLAY_SCALE.) */
const PM = PLAY_SCALE * M;
const PLAY_PLACES: Record<PlayKind, [number, number][]> = {
  swings: [[-0.8 * PM, 0], [0.8 * PM, 0]],
  slide: [[-1.6 * PM, 0]],
  roundabout: [[0.8 * PM, 0], [0, 0.8 * PM], [-0.8 * PM, 0], [0, -0.8 * PM]],
  climbframe: [[-0.8 * PM, -0.8 * PM], [0.8 * PM, -0.8 * PM], [0.8 * PM, 0.8 * PM], [-0.8 * PM, 0.8 * PM], [0, 0]],
  sandpit: [[-0.6 * PM, -0.4 * PM], [0.6 * PM, 0.5 * PM], [0.1 * PM, -0.8 * PM]],
  seesaw: [[-1.5 * PM, 0], [1.5 * PM, 0]],
  springy: [[0, 0]],
};
/** How far a swing goes out either way, px; how quickly (radians/s). A roundabout pushed round, radians/s. A go down the slide and back up its ladder, s. */
const SWING = 0.8 * PM;
const SWING_RATE = 2.3;
const ROUND = 1.6;
const SLIDE_ROUND = 4;
/** A campfire on the brownfield: two to four sit round it a good while, close, facing it. */
const FIRE_WEIGHT = 1.6;
const seatWeight = (s: Seat) => (PLAY.has(s.kind) ? PLAY_WEIGHT : s.kind === 'campfire' ? FIRE_WEIGHT : SEAT_WEIGHT);
/** Cells for finding who's close, px. */
const NEAR_CELL = 4 * M;
const key = (x: number, y: number) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`;

/** A line's name, by where it is (the same walk or ring, made again, has the same one). */
function ptsKey(pts: Pts): string {
  return `${pts[0]},${pts[1]},${pts[pts.length - 2]},${pts[pts.length - 1]},${pts.length}`;
}

export class People {
  readonly people: Person[] = [];
  readonly walks: Walk[] = [];
  readonly spots: Spot[] = [];
  readonly crossings: CrossingPoint[] = [];
  private readonly crossingGrid = new Map<string, number[]>();
  /** The bus stations' yards (and their bounds); and their bays' platforms, x, y. */
  private readonly yards: { ring: Pts; x0: number; y0: number; x1: number; y1: number }[] = [];
  private readonly platforms: [number, number][];
  /**
   * The vehicles standing still near the view (parked, left, stopped): walked
   * round (see `roundBlocks`). Set each frame.
   */
  blocks: Block[] = [];
  /** You and the vehicles about; those of them to get out of the way of (kept from frame to frame). */
  private readonly all: Mover[] = [];
  private readonly danger: Mover[] = [];
  /** Where people can be (see `update`), as it was last given. */
  private walkable: (x: number, y: number, level: number) => boolean = () => true;
  /** The bus stops: where people wait (on the pavement by the stop), x, y. */
  readonly stops: [number, number][] = [];
  /** The parks and squares people wander about. */
  private readonly areas: Pts[] = [];
  /** The ends of the walks (index * 2 + 0 for its start, 1 for its end), by where they are; and points along them every 10 m. */
  private readonly ends = new Map<string, number[]>();
  private readonly along = new Map<string, [number, number, number][]>();
  private readonly spotGrid = new Map<string, number[]>();
  /** The roads' carriageways: where people mustn't walk (but to cross). */
  private readonly roads: { pts: Pts; half: number; level: number }[] = [];
  private readonly roadGrid = new Map<string, number[]>();
  private nextId = 1;
  private readonly rand: () => number;
  /** Who's where (by 4 m cells), each frame. */
  private readonly close = new Map<string, Person[]>();
  /** People hit since the scene last looked: who, and how hard (px/s). */
  /**
   * People hit since the scene last looked: who, how hard (px/s), by what
   * (a mover's id: -1 is you), and how: knocked down (`hit`), or lying there
   * and driven over (`over`), a wheel going over them; and how much of its
   * speed it lost (0 to 1).
   */
  readonly hits: { person: Person; speed: number; by?: number; how: 'hit' | 'over'; loss: number }[] = [];

  /** The benches and picnic tables people sit at, and the picnics on the grass. */
  private seats: Seat[];
  /** Whether a point's in a park (or on a lawn): set as the walks are built. */
  private inPark: (x: number, y: number) => boolean = () => false;
  /** What's in the playgrounds (some of the seats), and the time, s, for how they move. */
  private plays: Seat[] = [];
  private clock = 0;
  private readonly seatGrid = new Map<string, number[]>();
  readonly picnics: Picnic[] = [];
  /** The shopping trolleys (the scene's loose things too), and the big shops with car parks. */
  private trolleys: Trolley[] = [];
  private readonly stores: Store[];
  /** Each store's rows of trolleys: its bay, then its car park's shelters' (worked out as it's set up). */
  private rows: TrolleyRow[][] = [];
  /** Just put about the view (see `populate`): the car parks to be filled once the parked cars are known. */
  private fresh = false;
  /** The performers' pitches and the food carts (see Gather), and the pigeons. */
  readonly pitches: Gather[] = [];
  carts: Gather[] = [];
  readonly flocks: Flock[] = [];
  /** The games on the grass in the parks. */
  readonly games: Kickabout[] = [];

  constructor(
    private readonly map: GameMap,
    options: { rand?: () => number; seats?: Seat[]; firstId?: number } = {},
    /** Not set up yet (see `setup`). */
    later = false,
  ) {
    this.rand = options.rand ?? Math.random;
    this.nextId = options.firstId ?? 1;
    this.seats = [];
    this.useSeats(options.seats ?? []);
    for (const a of map.areas) {
      if (a.kind !== 'yard') continue;
      const ring = a.rings[0];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 1 < ring.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
      this.yards.push({ ring, x0, y0, x1, y1 });
    }
    this.platforms = (map.busStations ?? []).flatMap((st) => st.bays.map((b) => b.platform));
    this.stores = map.stores ?? [];
    if (!later) drain(this.setup());
  }

  /** Sets them up, a little at a time (see work.ts): the walks, the spots people stand about at, the crossings. */
  *setup(): Work {
    this.rows = trolleyRows(this.map);
    yield;
    const life = yield* streetLifeWork(this.map);
    for (const p of life.pitches) this.pitches.push({ kind: 'pitch', x: p.x, y: p.y, angle: p.angle, act: p.act, host: null });
    for (const f of life.flocks) this.flocks.push({ x: f.x, y: f.y, birds: [], away: 0 });
    const park = yield* parkLifeWork(this.map);
    for (const g of park.games) this.games.push({ ...g, ball: { x: g.x, y: g.y, z: 0, from: [g.x, g.y], to: [g.x, g.y], t: 0, dur: 0, holder: null, target: null, hold: 0 } });
    // The games on the pitches and courts (see sports.ts).
    for (const g of (yield* placesWork(this.map)).games) this.games.push({ ...g, ball: { x: g.x, y: g.y, z: 0, from: [g.x, g.y], to: [g.x, g.y], t: 0, dur: 0, holder: null, target: null, hold: 0 } });
    for (const f of park.flocks) this.flocks.push({ x: f.x, y: f.y, birds: [], away: 0 });
    yield* this.buildWalks();
    yield* this.buildSpots();
    yield* this.buildCrossings();
  }

  /** The benches and picnic tables people sit at, and the shopping trolleys they push (the scene's loose things: see GameScene). */
  useSeats(seats: Seat[]): void {
    this.trolleys = (seats as (Seat & Partial<Trolley>)[]).filter((t): t is Seat & Trolley => t.kind === 'trolley');
    // The food carts (the same carts as before, where they were: their vendors and queues with them).
    const old = this.carts;
    this.carts = (seats as (Seat & Partial<Trolley>)[])
      .filter((t): t is Seat & Trolley => (t.kind === 'foodcart' || t.kind === 'stall') && !t.gone && !t.wrecked)
      .map((cart) => {
        const stall = cart.kind === 'stall';
        // (A stall's along its row: it faces out of it.)
        return old.find((g) => g.cart === cart) ?? { kind: 'cart' as const, x: cart.x, y: cart.y, angle: stall ? cart.angle + Math.PI / 2 : cart.angle, cart, host: null, ...(stall ? { stall } : {}) };
      });
    for (const p of this.people) {
      const g = p.gather;
      if (g?.kind !== 'cart' || this.carts.includes(g)) continue;
      const same = this.carts.find((c) => Math.hypot(c.x - g.x, c.y - g.y) < 1);
      p.gather = same ?? null;
      if (same && g.host === p) same.host = p;
    }
    this.seats = seats.filter((b) => (b.kind === 'bench' || b.kind === 'picnic' || b.kind === 'campfire' || PLAY.has(b.kind)) && b.level === 0);
    this.plays = this.seats.filter((b) => PLAY.has(b.kind));
    for (const b of this.plays) b.motion ??= [0, 0, 0, 0];
    this.seatGrid.clear();
    this.seats.forEach((b, i) => {
      const list = this.seatGrid.get(key(b.x, b.y)) ?? [];
      list.push(i);
      this.seatGrid.set(key(b.x, b.y), list);
    });
  }

  // --- What's where ---

  private *buildWalks(): Work {
    const { roads } = this.map;
    // The carriageways first: the walks are kept off them.
    const pause = every(25);
    for (const r of roads) {
      if (pause()) yield;
      if (!VEHICLE_ROADS.has(r.kind) || r.kind === 'track') continue;
      this.roads.push({ pts: r.pts, half: r.width / 2, level: r.bridge ? 1 : 0 });
      const k = this.roads.length - 1;
      const index = (x: number, y: number) => {
        const list = this.roadGrid.get(key(x, y)) ?? [];
        if (!list.includes(k)) list.push(k);
        this.roadGrid.set(key(x, y), list);
      };
      for (let j = 0; j + 3 < r.pts.length; j += 2) {
        const len = Math.hypot(r.pts[j + 2] - r.pts[j], r.pts[j + 3] - r.pts[j + 1]);
        // Every cell it passes through, and those either side (a wide road reaches into them).
        for (let d = 0; d <= len; d += GRID / 4) {
          const [x, y] = [r.pts[j] + ((r.pts[j + 2] - r.pts[j]) * d) / (len || 1), r.pts[j + 1] + ((r.pts[j + 3] - r.pts[j + 1]) * d) / (len || 1)];
          for (const [ox, oy] of [[0, 0], [r.width, 0], [-r.width, 0], [0, r.width], [0, -r.width]]) index(x + ox, y + oy);
        }
      }
    }
    /** A walk, less where it runs over a road away from a crossing: in pieces. */
    const add = (line: Pts, busy: number, road: number, level: number) => {
      const pieces: Pts[] = [];
      // (Over the road at a crossing, too: they cross as the crossing says, waiting for the lights or a gap, not walking straight on.)
      // (Nor through a bus station's yard.)
      const keep = (x: number, y: number) => !this.inRoad(x, y, 0.1 * M, level) && (level !== 0 || !this.inYard(x, y));
      // Every metre along it: whether it's kept, and whether it's one of its corners.
      const pts: [number, number, boolean, boolean][] = [];
      for (let i = 0; i + 3 < line.length; i += 2) {
        const [ax, ay, bx, by] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / M));
        for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
          const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
          pts.push([x, y, keep(x, y), s === 0 || s === steps]);
        }
      }
      let piece: number[] = [];
      pts.forEach(([x, y, kept, corner], i) => {
        if (!kept) {
          if (piece.length) pieces.push(piece);
          piece = [];
          return;
        }
        // Its corners, and where it's cut.
        const last = i === pts.length - 1 || !pts[i + 1][2];
        if (corner || !piece.length || last) piece.push(x, y);
      });
      if (piece.length) pieces.push(piece);
      for (const pts of pieces) if (pts.length >= 4 && lengthOf(pts) > 3 * M) this.addWalk(pts, busy, road, level);
    };
    // (The parks: the paths through them are walked by joggers and dog walkers too.)
    const parks = this.map.areas
      .filter((a) => a.kind === 'park' || a.kind === 'grass' || a.kind === 'garden' || a.kind === 'pitch')
      .map((a) => {
        const ring = a.rings[0];
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i + 1 < ring.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
        return { ring, x0, y0, x1, y1 };
      });
    this.inPark = (x, y) => parks.some((a) => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1 && pointInRing(x, y, a.ring));
    // Over the bridges too (a road bridge's pavements are decks of their own: see Decks), on their level.
    for (const [i, r] of roads.entries()) {
      if (pause()) yield;
      const level = r.bridge ? 1 : 0;
      if (VEHICLE_ROADS.has(r.kind)) {
        if (!r.pavement) continue;
        // More people along the busier streets, as with the traffic.
        const busy = Math.min(4, 0.7 + (r.activity ?? 0) * 0.25);
        const off = r.width / 2 + PAVEMENT / 2;
        if (r.pavement !== 'right') add(offsetLine(r.pts, off), busy, i, level);
        if (r.pavement !== 'left') add(offsetLine(r.pts, -off), busy, i, level);
      } else if (r.kind === 'pedestrian') {
        // Busier the more shops and the like along it, spread across it (three ways along it, if it's wide enough).
        const busy = 2.5 + Math.min(4.5, pedestrianBusy(this.map, r.pts) * 0.15);
        if (r.width < 4 * M) add(r.pts, busy, -1, level);
        else for (const o of [-0.3, 0, 0.3]) add(o ? offsetLine(r.pts, r.width * o) : r.pts, busy / 2, -1, level);
      }
      else if (r.kind === 'footway' || r.kind === 'steps' || r.kind === 'cycleway') {
        // (Through a park: busier.)
        const i = Math.floor((r.pts.length / 2 - 1) / 2) * 2;
        const park = r.kind !== 'steps' && this.inPark((r.pts[i] + r.pts[i + 2]) / 2, (r.pts[i + 1] + r.pts[i + 3]) / 2);
        add(r.pts, r.kind === 'cycleway' ? 0.3 : park ? 1.4 : 0.9, r.kind === 'cycleway' ? (park ? -3 : -2) : park ? -4 : -1, level);
      }
    }
  }

  private addWalk(pts: Pts, busy: number, road: number, level: number): void {
    const k = this.walks.length;
    // (-2: a cycle path; -3, one through a park; -4, a footpath through a park.)
    this.walks.push({ pts, busy, road: Math.max(-1, road), level, ...(road === -2 || road === -3 ? { cycle: true } : {}), ...(road === -3 || road === -4 ? { park: true } : {}) });
    const n = pts.length;
    for (const [end, x, y] of [[0, pts[0], pts[1]], [1, pts[n - 2], pts[n - 1]]] as const) {
      const list = this.ends.get(key(x, y)) ?? [];
      list.push(k * 2 + end);
      this.ends.set(key(x, y), list);
    }
    for (let i = 0; i + 3 < n; i += 2) {
      const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      for (let d = 0; d < len; d += 10 * M) {
        const t = d / len;
        const [x, y] = [pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t];
        const list = this.along.get(key(x, y)) ?? [];
        list.push([k, i / 2, t]);
        this.along.set(key(x, y), list);
      }
    }
  }

  private *buildSpots(): Work {
    const { map } = this;
    const pause = every(40);
    // The parks and squares: people wander about them, and stand about in groups.
    for (const a of map.areas) {
      if (a.kind !== 'park' && a.kind !== 'plaza' && a.kind !== 'grass' && a.kind !== 'garden' && a.kind !== 'pitch' && a.kind !== 'play') continue;
      const ring = a.rings[0];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < ring.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[i]), Math.min(y0, ring[i + 1]), Math.max(x1, ring[i]), Math.max(y1, ring[i + 1])];
      const area = Math.abs(polyArea(ring));
      if (area < 150 * M * M) continue;
      this.areas.push(ring);
      // (A park's grass, busier than it was: one spot every 300 m².)
      const lawn = a.kind === 'park' || a.kind === 'grass' || a.kind === 'garden';
      const count = lawn ? Math.min(50, Math.round(area / (300 * M * M)) + 1) : Math.min(30, Math.round(area / (500 * M * M)) + 1);
      for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
        const [x, y] = [x0 + this.rand() * (x1 - x0), y0 + this.rand() * (y1 - y0)];
        if (!pointInRing(x, y, ring)) continue;
        // A square's busier than a lawn.
        this.addSpot({ x, y, angle: this.rand() * Math.PI * 2, weight: a.kind === 'plaza' ? 1.6 : a.kind === 'park' ? 1.1 : 0.8, group: this.rand() < 0.55, grass: lawn });
        k++;
      }
    }
    // The building sites' workers, in hi-vis, standing about in twos and threes or going about the site.
    const sites = yield* siteLifeWork(map);
    for (const ring of sites.sites) this.areas.push(ring);
    for (const w of sites.workers) this.addSpot({ x: w.x, y: w.y, angle: this.rand() * Math.PI * 2, weight: 1.2, group: this.rand() < 0.4, hivis: true });
    // The brownfield: people cutting across it (a dog with some), and the gulls at its rubbish.
    for (const ring of sites.wastes) this.areas.push(ring);
    for (const w of sites.wanderers) this.addSpot({ x: w.x, y: w.y, angle: this.rand() * Math.PI * 2, weight: 0.8, group: false, waste: true });
    for (const g of sites.gulls) this.flocks.push({ x: g.x, y: g.y, birds: [], away: 0, gull: true });
    // Round the places (see places.ts): the children in a school's playground, its teachers, the parents at its gate, its
    // lollipop lady.
    const places = yield* placesWork(map);
    for (const ring of places.rings) this.areas.push(ring);
    for (const sp of places.spots) this.addSpot({ ...sp });
    // Outside the shops, cafés and bars, on the pavement; at the sights, in groups.
    const v = map.venues ?? [];
    for (let i = 0; i + 2 < v.length; i += 3) {
      if (pause()) yield;
      const [x, y, kind] = [v[i], v[i + 1], v[i + 2]];
      const near = this.nearestWalk(x, y, (kind ? 30 : 16) * M);
      if (!near) continue;
      const [px, py] = near;
      // Facing it (or the sight), a little towards it from the middle of the pavement.
      const angle = Math.atan2(y - py, x - px);
      const d = Math.hypot(x - px, y - py) || 1;
      const nudge = Math.min(d, 0.7 * M);
      this.addSpot({ x: px + ((x - px) / d) * nudge, y: py + ((y - py) / d) * nudge, angle, weight: kind ? 4 : 1.6, group: kind === 1 || this.rand() < 0.25 });
    }
    // By the water: on the quays, looking out over it.
    for (const p of map.props) {
      if (p.kind !== 'mooring' && p.kind !== 'lifering') continue;
      if (pause()) yield;
      const water = this.towardWater(p.x, p.y);
      if (water === null) continue;
      const [x, y] = [p.x - Math.cos(water) * 1.5 * M, p.y - Math.sin(water) * 1.5 * M];
      this.addSpot({ x, y, angle: water, weight: 0.7, group: this.rand() < 0.3 });
    }
    // The bus stops: by each route's stops, on the pavement.
    const seen = new Set<string>();
    for (const r of map.busRoutes ?? []) {
      for (let i = 0; i + 1 < r.stops.length; i += 2) {
        const k = `${Math.round(r.stops[i] / 40)},${Math.round(r.stops[i + 1] / 40)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        // (Not at a bus station's: people get on and off there at its bays, from its platforms: see `buses`.)
        if (this.platforms.some(([px, py]) => Math.hypot(px - r.stops[i], py - r.stops[i + 1]) < 30 * M)) continue;
        const near = this.nearestWalk(r.stops[i], r.stops[i + 1], 12 * M);
        if (near) this.stops.push([near[0], near[1]]);
      }
    }
    this.platformStops();
  }

  /** Where people wait along the railway platforms: down the middle of each, every 12 m (and they're as busy as a bus stop's). */
  private platformStops(): void {
    for (const a of this.map.areas) {
      if (a.kind !== 'platform') continue;
      const ring = a.rings[0];
      const { ox, oy, ux, uy, t0, t1 } = ridgeAxis(ring);
      for (let t = t0 + 4 * M; t < t1 - 4 * M; t += 12 * M) {
        const [x, y] = [ox + ux * t, oy + uy * t];
        if (pointInRing(x, y, ring)) this.stops.push([x, y]);
      }
    }
  }

  private addSpot(s: Spot): void {
    if (this.inYard(s.x, s.y)) return;
    const k = this.spots.length;
    this.spots.push(s);
    const list = this.spotGrid.get(key(s.x, s.y)) ?? [];
    list.push(k);
    this.spotGrid.set(key(s.x, s.y), list);
  }

  private *buildCrossings(): Work {
    const { map } = this;
    const pause = every(60);
    for (const c of map.crossings) {
      if (pause()) yield;
      const r = c.road !== undefined ? map.roads[c.road] : undefined;
      if (r?.bridge) continue;
      const [nx, ny] = [-Math.sin(c.angle), Math.cos(c.angle)];
      const off = c.width / 2 + 1.2 * M;
      const signals: number[] = [];
      if (c.kind === 'lights') map.signals.forEach((s, i) => {
        if (Math.hypot(s.x - c.x, s.y - c.y) < 30 * M && (c.controller === undefined || s.controller === c.controller)) signals.push(i);
      });
      const k = this.crossings.length;
      this.crossings.push({ ax: c.x + nx * off, ay: c.y + ny * off, bx: c.x - nx * off, by: c.y - ny * off, kind: c.kind, signals });
      // (By where its kerbs are, and round them: only those near someone walking are looked at.)
      for (const [x, y] of [[c.x + nx * off, c.y + ny * off], [c.x - nx * off, c.y - ny * off]]) {
        for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
          const cell = key(x + ox * 3 * M, y + oy * 3 * M);
          const list = this.crossingGrid.get(cell) ?? [];
          if (!list.includes(k)) list.push(k);
          this.crossingGrid.set(cell, list);
        }
      }
    }
  }

  /** The nearest point on a walk (on a level) to (x, y), within `reach` px: x, y, which walk, which segment, how far along it. */
  private nearestWalk(x: number, y: number, reach: number, offRoad = false, level = 0): [number, number, number, number, number] | null {
    let best: [number, number, number, number, number] | null = null;
    let bestD = reach;
    const cells = Math.ceil(reach / GRID) + 1;
    const seen = new Set<number>();
    for (let i = -cells; i <= cells; i++) {
      for (let j = -cells; j <= cells; j++) {
        for (const [k] of this.along.get(key(x + i * GRID, y + j * GRID)) ?? []) {
          if (seen.has(k) || this.walks[k].level !== level) continue;
          seen.add(k);
          const p = this.walks[k].pts;
          for (let s = 0; s + 3 < p.length; s += 2) {
            const [ax, ay, bx, by] = [p[s], p[s + 1], p[s + 2], p[s + 3]];
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
            const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
            const d = Math.hypot(px - x, py - y);
            if (d < bestD && (!offRoad || this.clear(x, y, px, py, level))) [best, bestD] = [[px, py, k, s / 2, t], d];
          }
        }
      }
    }
    return best;
  }

  /** Which way the nearest water is from a point (within 12 m), radians, or null. */
  private towardWater(x: number, y: number): number | null {
    let best = 12 * M;
    let angle: number | null = null;
    for (const a of this.map.areas) {
      if (a.kind !== 'water') continue;
      const ring = a.rings[0];
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
        const d = Math.hypot(px - x, py - y);
        if (d < best) [best, angle] = [d, Math.atan2(py - y, px - x)];
      }
    }
    return angle;
  }

  /** Whether the way from one point to another keeps off the roads. */
  private clear(ax: number, ay: number, bx: number, by: number, level = 0): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / M);
    for (let s = 1; s < steps; s++) {
      const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
      if (this.inRoad(x, y, undefined, level)) return false;
    }
    return true;
  }

  /** Whether a point's on a road's carriageway (on a level: where people only go to cross, or running). */
  /** Whether (x, y) is in a bus station's yard (no one walks about in it: it's all buses). */
  inYard(x: number, y: number): boolean {
    for (const a of this.yards) if (x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1 && pointInRing(x, y, a.ring)) return true;
    return false;
  }

  inRoad(x: number, y: number, margin = -0.5 * M, level = 0): boolean {
    for (const k of this.roadGrid.get(key(x, y)) ?? []) {
      const { pts, half, level: on } = this.roads[k];
      if (on !== level) continue;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        if (Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y) < half + margin) return true;
      }
    }
    return false;
  }

  // --- Coming and going ---

  private make(x: number, y: number, mode: Mode): Person {
    const p: Person = {
      id: this.nextId++,
      x,
      y,
      angle: this.rand() * Math.PI * 2,
      speed: 0,
      vx: 0,
      vy: 0,
      mode,
      look: Math.floor(this.rand() * LOOKS),
      pace: WALK * (0.8 + this.rand() * 0.4),
      line: -1,
      next: 0,
      dir: 1,
      side: (this.rand() - 0.5) * 0.9 * M,
      tx: x,
      ty: y,
      timer: 0,
      crossing: -1,
      stop: -1,
      hurt: false,
      step: this.rand(),
      was: mode,
      area: -1,
      gone: false,
      joining: false,
      avoid: 0,
      seat: null,
      seatAt: [0, 0, 0, 0],
      picnic: null,
      level: 0,
      under: null,
      underAlong: 0,
      trip: null,
      act: null,
      gather: null,
      game: null,
      dog: null,
    };
    // (Never in a vehicle standing there: gone again at once.)
    if (this.blocks.some((b) => Math.abs(b.x - x) < b.length && Math.abs(b.y - y) < b.length && bodyDist(b, x, y) < b.r + 0.3 * M)) p.gone = true;
    this.people.push(p);
    return p;
  }

  /** Someone walking along walk `k`, from segment `seg` (t along it), one way or the other. */
  private walker(k: number, seg: number, t: number, side?: number): Person {
    const w = this.walks[k].pts;
    const [ax, ay, bx, by] = [w[seg * 2], w[seg * 2 + 1], w[seg * 2 + 2], w[seg * 2 + 3]];
    const p = this.make(ax + (bx - ax) * t, ay + (by - ay) * t, 'walk');
    this.onto(p, k, seg, this.rand() < 0.5 ? 1 : -1);
    if (side !== undefined) p.side = side;
    // In a park, some out for a run, and some walking the dog (and a few walking it along the street).
    const walk = this.walks[k];
    if (walk.park && !walk.cycle && side === undefined && this.rand() < 0.22) {
      p.jog = true;
      p.pace = JOG * (0.85 + this.rand() * 0.3);
    } else if (!walk.cycle && this.rand() < (walk.park ? 0.3 : 0.05)) this.withDog(p);
    return p;
  }

  /** A dog on its lead with someone, at their heels. */
  private withDog(p: Person): void {
    p.dog = { x: p.x - Math.cos(p.angle) * 1.2 * M, y: p.y - Math.sin(p.angle) * 1.2 * M, angle: p.angle, speed: 0, step: 0, look: Math.floor(this.rand() * 4), sniff: 0 };
  }

  /** Puts someone onto a walk at a segment, heading one way along it (getting onto it at (x, y) first, if they're not on it). */
  private onto(p: Person, k: number, seg: number, dir: 1 | -1, at?: [number, number]): void {
    p.mode = 'walk';
    p.line = k;
    // On its level (getting onto it, once they're on it: where one walk goes on onto another up on a bridge, it's at the deck's end, level with the ground).
    if (!at) p.level = this.walks[k].level;
    p.dir = dir;
    p.next = dir === 1 ? seg + 1 : seg;
    p.joining = !!at;
    if (at) [p.tx, p.ty] = at;
  }

  /** How busy it is round a point: the walks' and the spots' weights near it. */
  private weightNear(x0: number, y0: number, x1: number, y1: number): number {
    let w = 0;
    for (let x = Math.floor(x0 / GRID); x <= Math.floor(x1 / GRID); x++) {
      for (let y = Math.floor(y0 / GRID); y <= Math.floor(y1 / GRID); y++) {
        for (const [k] of this.along.get(`${x},${y}`) ?? []) w += this.walks[k].busy;
        for (const s of this.spotGrid.get(`${x},${y}`) ?? []) w += this.spots[s].weight;
        for (const k of this.seatGrid.get(`${x},${y}`) ?? []) w += seatWeight(this.seats[k]);
      }
    }
    return w;
  }

  /** Keeps the streets round the view as busy as they should be: people coming into being out of sight (or anywhere, `all`), gone once they're far off. */
  populate(view: PeopleView, all = false): void {
    const [x0, y0, x1, y1] = [view.x0 - NEAR, view.y0 - NEAR, view.x1 + NEAR, view.y1 + NEAR];
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.x < view.x0 - FAR || p.x > view.x1 + FAR || p.y < view.y0 - FAR || p.y > view.y1 + FAR || p.gone) {
        this.leaveGather(p);
        this.people.splice(i, 1);
      }
    }
    // Picnics: gone once no one's at them and they're out of sight (or far off).
    for (let i = this.picnics.length - 1; i >= 0; i--) {
      const c = this.picnics[i];
      const far = c.x < view.x0 - FAR || c.x > view.x1 + FAR || c.y < view.y0 - FAR || c.y > view.y1 + FAR;
      const outOfSight = c.x < view.x0 - 3 * M || c.x > view.x1 + 3 * M || c.y < view.y0 - 3 * M || c.y > view.y1 + 3 * M;
      if (far || c.gone || (outOfSight && !this.people.some((p) => p.picnic === c))) this.picnics.splice(i, 1);
    }
    const want = Math.min(MOST, this.weightNear(x0, y0, x1, y1) * PER_WEIGHT);
    const seen = (x: number, y: number) => !all && x > view.x0 - 2 * M && x < view.x1 + 2 * M && y > view.y0 - 2 * M && y < view.y1 + 2 * M;
    for (let tries = 0; tries < (all ? 400 : 6) && this.people.length < want; tries++) {
      const [x, y] = [x0 + this.rand() * (x1 - x0), y0 + this.rand() * (y1 - y0)];
      if (seen(x, y)) continue;
      const cell = key(x, y);
      // A spot, or a walk, by how busy each is.
      const spots = this.spotGrid.get(cell) ?? [];
      const walks = this.along.get(cell) ?? [];
      const seats = (this.seatGrid.get(cell) ?? []).filter((k) => !this.seats[k].gone && !this.seats[k].wrecked && !seen(this.seats[k].x, this.seats[k].y) && !this.people.some((q) => q.seat === this.seats[k]));
      const sw = spots.reduce((s, k) => s + this.spots[k].weight, 0);
      const ww = walks.reduce((s, [k]) => s + this.walks[k].busy, 0);
      const cw = seats.reduce((s, k) => s + seatWeight(this.seats[k]), 0);
      if (sw + ww + cw <= 0) continue;
      const pick = this.rand() * (sw + ww + cw);
      if (pick >= sw + ww) {
        let r = pick - sw - ww;
        this.sitDown(this.seats[seats.find((k) => (r -= seatWeight(this.seats[k])) <= 0) ?? seats[0]]);
      } else if (pick < sw) {
        let r = this.rand() * sw;
        const k = spots.find((s) => (r -= this.spots[s].weight) <= 0) ?? spots[0];
        this.atSpot(this.spots[k]);
      } else {
        const [k, seg, t] = walks[Math.floor(this.rand() * walks.length)];
        const p = this.walker(k, seg, t);
        // Some walk in twos, side by side.
        if (this.rand() < 0.2) {
          const q = this.walker(k, seg, t, p.side + 0.7 * M * (p.side > 0 ? -1 : 1));
          Object.assign(q, { dir: p.dir, next: p.next, pace: p.pace });
        }
      }
    }
    // (Coming into a region, the car parks busy already: once the cars parked about are known.)
    if (all) this.fresh = true;
    const burst = this.fresh && this.blocks.some((b) => !b.you);
    if (burst) this.fresh = false;
    for (let k = burst ? 10 : 1; k > 0; k--) this.shoppers(x0, y0, x1, y1, burst ? () => false : seen, burst);
    this.streetLife(x0, y0, x1, y1, seen, all);
    this.parkGames(x0, y0, x1, y1, seen, all);
    // Waiting at the bus stops near the view.
    for (const [i, [sx, sy]] of this.stops.entries()) {
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || seen(sx, sy)) continue;
      const waiting = this.people.filter((p) => p.stop === i).length;
      if (waiting < 1 + (i % 3) && this.rand() < 0.02) {
        const a = this.rand() * Math.PI * 2;
        const p = this.make(sx + Math.cos(a) * 1.2 * M, sy + Math.sin(a) * 1.2 * M, 'queue');
        p.stop = i;
      }
    }
  }

  /**
   * Takes over from the last region's people (see streamer.ts): those in
   * `keep` (round the view) are who was there, carried over onto this one's
   * walks, crossings and stops (the same, made again: matched by where they
   * are); those this one had put there of its own go. Anyone whose walk isn't
   * here finds the nearest.
   */
  adopt(old: People, keep: PeopleView): void {
    const inside = (x: number, y: number) => x >= keep.x0 && x <= keep.x1 && y >= keep.y0 && y <= keep.y1;
    for (let i = this.people.length - 1; i >= 0; i--) if (inside(this.people[i].x, this.people[i].y)) this.people.splice(i, 1);
    for (let i = this.picnics.length - 1; i >= 0; i--) if (inside(this.picnics[i].x, this.picnics[i].y)) this.picnics.splice(i, 1);
    const walkAt = new Map(this.walks.map((w, k) => [ptsKey(w.pts), k]));
    const crossingAt = new Map(this.crossings.map((c, k) => [`${c.ax},${c.ay},${c.bx},${c.by}`, k]));
    const stopAt = new Map(this.stops.map(([x, y], k) => [`${x},${y}`, k]));
    const areaAt = new Map(this.areas.map((r, k) => [ptsKey(r), k]));
    const storeAt = new Map(this.stores.map((st, k) => [`${st.door[0]},${st.door[1]}`, k]));
    const pitchAt = new Map(this.pitches.map((g) => [`${g.x},${g.y}`, g]));
    // The games on the grass round the view, as they were (the same game, its ball where it was).
    const gameAt = new Map(this.games.map((g) => [`${g.x},${g.y}`, g]));
    for (const g of old.games) {
      const mine = gameAt.get(`${g.x},${g.y}`);
      if (mine && inside(g.x, g.y)) mine.ball = g.ball;
    }
    // The pigeons round the view, as they were.
    const flockAt = new Map(this.flocks.map((f) => [`${f.x},${f.y}`, f]));
    for (const f of old.flocks) {
      const mine = flockAt.get(`${f.x},${f.y}`);
      if (mine && inside(f.x, f.y)) Object.assign(mine, { birds: f.birds, away: f.away });
    }
    const picnics = new Set<Picnic>();
    for (const p of old.people) {
      if (p.gone || !inside(p.x, p.y)) continue;
      let lost = false;
      if (p.line >= 0) {
        const k = walkAt.get(ptsKey(old.walks[p.line].pts));
        if (k === undefined) [p.line, lost] = [-1, lost || p.mode === 'walk'];
        else p.line = k;
      }
      if (p.crossing >= 0) {
        const c = old.crossings[p.crossing];
        const k = crossingAt.get(`${c.ax},${c.ay},${c.bx},${c.by}`);
        if (k === undefined) [p.crossing, lost] = [-1, lost || p.mode === 'kerb'];
        else p.crossing = k;
      }
      if (p.stop >= 0) {
        const [x, y] = old.stops[p.stop];
        const k = stopAt.get(`${x},${y}`);
        if (k === undefined) [p.stop, lost] = [-1, lost || p.mode === 'queue'];
        else p.stop = k;
      }
      if (p.area >= 0) {
        const k = areaAt.get(ptsKey(old.areas[p.area]));
        if (k === undefined) [p.area, lost] = [-1, lost || p.mode === 'wander'];
        else p.area = k;
      }
      if (p.trip) {
        const st = old.stores[p.trip.store];
        const k = storeAt.get(`${st.door[0]},${st.door[1]}`);
        if (k === undefined) {
          this.letGo(p);
          lost = true;
        } else p.trip.store = k;
      }
      if (p.gather?.kind === 'pitch') {
        const g = pitchAt.get(`${p.gather.x},${p.gather.y}`) ?? null;
        if (g && p.gather.host === p) g.host = p;
        p.gather = g;
        if (!g && (p.mode === 'perform' || p.mode === 'stand')) lost = true;
      }
      if (p.game) {
        p.game = gameAt.get(`${p.game.x},${p.game.y}`) ?? null;
        if (!p.game && p.mode === 'game') lost = true;
      }
      if (p.picnic) picnics.add(p.picnic);
      this.people.push(p);
      if (lost) this.rejoin(p);
    }
    for (const c of old.picnics) if (inside(c.x, c.y)) picnics.add(c);
    this.picnics.push(...picnics);
    this.nextId = Math.max(this.nextId, old.nextId);
  }

  /** The last id given someone (see `adopt`). */
  get lastId(): number {
    return this.nextId;
  }

  /**
   * How far (and which way) to step something at (x, y) to be clear of a
   * vehicle (`room` px clear of its side), or null if it's clear already: an
   * animal's never under one.
   */
  private outFrom(m: Mover, x: number, y: number, room: number): [number, number] | null {
    const half = m.length / 2 + room;
    if (Math.abs(x - m.x) > half + m.width || Math.abs(y - m.y) > half + m.width) return null;
    const [c, s] = [Math.cos(m.angle), Math.sin(m.angle)];
    const [a, b] = [(x - m.x) * c + (y - m.y) * s, -(x - m.x) * s + (y - m.y) * c];
    const [hl, hw] = [m.length / 2 + room, m.width / 2 + room];
    if (Math.abs(a) >= hl || Math.abs(b) >= hw) return null;
    // Out the nearer side (or end).
    if (hw - Math.abs(b) <= hl - Math.abs(a)) {
      const d = (Math.sign(b) || 1) * hw - b;
      return [-s * d, c * d];
    }
    const d = (Math.sign(a) || 1) * hl - a;
    return [c * d, s * d];
  }

  /** Someone (or a group) at a spot, standing about; in a park or square, some wander off about it. */
  private atSpot(s: Spot): void {
    // On the grass in a park: a picnic, now and then: a blanket, and two to five sitting round it.
    if (s.grass && this.rand() < 0.35 && !this.underTree(s.x, s.y)) {
      const picnic: Picnic = { x: s.x, y: s.y, angle: this.rand() * Math.PI, pattern: Math.floor(this.rand() * 4), gone: false };
      this.picnics.push(picnic);
      const n = 2 + Math.floor(this.rand() * 4);
      const time = 60 + this.rand() * 180;
      for (let k = 0; k < n; k++) {
        const a = picnic.angle + (k / n) * Math.PI * 2;
        const p = this.make(s.x + Math.cos(a) * 1.1 * M, s.y + Math.sin(a) * 0.9 * M, 'sit');
        p.picnic = picnic;
        p.angle = a + Math.PI;
        p.timer = time + this.rand() * 10;
      }
      return;
    }
    const area = this.areas.findIndex((ring) => pointInRing(s.x, s.y, ring));
    if (area >= 0 && !s.group && (s.waste || this.rand() < 0.6)) {
      const p = this.make(s.x, s.y, 'wander');
      if (s.hivis) p.hivis = true;
      this.dress(p, s);
      if (s.waste && this.rand() < 0.5) this.withDog(p);
      p.area = area;
      [p.tx, p.ty] = [s.x, s.y];
      return;
    }
    const n = s.group ? 2 + Math.floor(this.rand() * (area >= 0 ? 4 : 3)) : this.rand() < 0.3 ? 2 : 1;
    const r = n === 1 ? 0 : (0.55 + n * 0.1) * M;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rand() * 0.4;
      const p = this.make(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, 'stand');
      if (s.hivis) p.hivis = true;
      this.dress(p, s);
      // A group faces in, to each other; on their own, the way the spot faces.
      p.angle = n > 1 ? a + Math.PI : s.angle + (this.rand() - 0.5) * 0.6;
      p.timer = 30 + this.rand() * 120;
    }
  }

  /** Who someone at a spot is: a child (quicker on their feet, and more of them running about than standing), a lollipop lady. */
  private dress(p: Person, s: Spot): void {
    if (s.child) {
      p.child = s.child;
      p.pace *= 1.25;
    }
    if (s.lollipop) {
      p.lollipop = true;
      p.angle = s.angle;
      p.timer = 600;
    }
  }

  /** Whether a point's under a tree's crown (no picnics there: it'd be hidden, and it's shady). */
  private underTree(x: number, y: number): boolean {
    const t = this.map.trees;
    for (let i = 0; i < t.length; i += 4) if (Math.abs(t[i] - x) < 60 && Math.abs(t[i + 1] - y) < 60 && Math.hypot(t[i] - x, t[i + 1] - y) < t[i + 2] + 1.5 * M) return true;
    return false;
  }

  /** One or two sitting on a bench (facing one way off it), or two to four round a picnic table. */
  private sitDown(seat: Seat): void {
    if (PLAY.has(seat.kind)) return this.playOn(seat);
    if (seat.kind === 'campfire') {
      const n = 2 + Math.floor(this.rand() * 3);
      const time = 60 + this.rand() * 180;
      const turn = this.rand() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = turn + (k / n) * Math.PI * 2 + (this.rand() - 0.5) * 0.4;
        const p = this.make(seat.x, seat.y, 'sit');
        p.seat = seat;
        p.seatAt = [Math.cos(a) * 1.5 * M, Math.sin(a) * 1.5 * M, seat.x, seat.y];
        p.timer = time + this.rand() * 20;
        this.onSeat(p);
      }
      return;
    }
    const bench = seat.kind === 'bench';
    // A bench faces one way: the same each time for the same bench.
    const facing = (Math.floor(seat.x * 7 + seat.y * 13) & 1) === 0 ? 1 : -1;
    const places: [number, number][] = bench
      ? [[-0.45 * M, 0.35 * M * facing], [0.45 * M, 0.35 * M * facing]]
      : [[-0.5 * M, 0.75 * M], [0.5 * M, 0.75 * M], [-0.5 * M, -0.75 * M], [0.5 * M, -0.75 * M]];
    const n = bench ? (this.rand() < 0.6 ? 1 : 2) : 2 + Math.floor(this.rand() * 3);
    const time = 20 + this.rand() * 100;
    for (const [u, v] of places.sort(() => this.rand() - 0.5).slice(0, n)) {
      const p = this.make(seat.x, seat.y, 'sit');
      p.seat = seat;
      p.seatAt = [u, v, seat.x, seat.y];
      p.timer = time + this.rand() * 20;
      this.onSeat(p);
    }
  }

  /** One or more playing on something in a playground (a seesaw takes two), a while. */
  private playOn(seat: Seat): void {
    const places = PLAY_PLACES[seat.kind as PlayKind];
    const n = seat.kind === 'seesaw' ? 2 : 1 + Math.floor(this.rand() * places.length);
    const time = 15 + this.rand() * 50;
    for (const [u, v] of places.slice().sort(() => this.rand() - 0.5).slice(0, n)) {
      const p = this.make(seat.x, seat.y, 'sit');
      p.seat = seat;
      p.seatAt = [u, v, seat.x, seat.y];
      p.timer = time + this.rand() * 15;
      this.onSeat(p);
    }
  }

  /**
   * The playgrounds' moving parts, as people play on them: a swing with
   * someone on it swinging higher, and dying down once they're off; a
   * roundabout pushed round, slowing once no one's on it.
   */
  private play(dt: number): void {
    this.clock += dt;
    const on = new Map<Seat, Person[]>();
    for (const p of this.people) if (p.seat && p.mode === 'sit' && PLAY.has(p.seat.kind)) on.set(p.seat, [...(on.get(p.seat) ?? []), p]);
    for (const s of this.plays) {
      const m = s.motion!;
      const who = on.get(s) ?? [];
      if (s.kind === 'swings') {
        for (const k of [0, 1]) {
          const used = who.some((p) => (p.seatAt[0] > 0 ? 1 : 0) === k);
          m[2 + k] = used ? Math.min(SWING, m[2 + k] + dt * 0.25 * M) : Math.max(0, m[2 + k] - dt * 0.2 * M);
          m[k] = m[2 + k] * Math.sin(this.clock * SWING_RATE + k * 1.7);
        }
      } else if (s.kind === 'roundabout') {
        m[1] = who.length ? Math.min(ROUND, m[1] + dt * 0.8) : m[1] * Math.exp(-dt * 0.4);
        m[0] = (m[0] + m[1] * dt) % (Math.PI * 2);
      }
    }
  }

  /** Where they sit on their seat, as it is now, facing out from it (a bench) or in across it (a picnic table); or where they are on what they're playing on. */
  private onSeat(p: Person): void {
    const s = p.seat!;
    if (PLAY.has(s.kind)) return this.onPlay(p);
    const [u, v] = p.seatAt;
    const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
    p.x = s.x + ux * u - uy * v;
    p.y = s.y + uy * u + ux * v;
    const out = s.kind === 'bench' ? Math.sign(v) : -Math.sign(v);
    p.angle = s.kind === 'campfire' ? Math.atan2(s.y - p.y, s.x - p.x) : s.angle + (Math.PI / 2) * out;
    p.speed = 0;
  }

  /** Where they are on what they're playing on, as it moves: swinging, going round, down the slide and back up its ladder, bouncing. */
  private onPlay(p: Person): void {
    const s = p.seat!;
    let [u, v] = p.seatAt;
    let face = s.angle;
    const m = s.motion ?? [0, 0, 0, 0];
    switch (s.kind) {
      case 'swings':
        // Facing the way they swing, across the frame.
        v += m[u > 0 ? 1 : 0];
        face = s.angle + Math.PI / 2;
        break;
      case 'roundabout': {
        const [c, n] = [Math.cos(m[0]), Math.sin(m[0])];
        [u, v] = [u * c - v * n, u * n + v * c];
        face = s.angle + Math.atan2(v, u) + Math.PI / 2;
        break;
      }
      case 'slide': {
        // Down it, then round and back up the ladder (the far end, as it's drawn: the slide's at +x).
        const t = (this.clock + (p.id % 7) * 0.57) % SLIDE_ROUND;
        if (t < 1.2) u = -1.6 * PM + (t / 1.2) * 3.8 * PM;
        else if (t < 2) [u, v] = [2.2 * PM - ((t - 1.2) / 0.8) * 0.4 * PM, ((t - 1.2) / 0.8) * 1.1 * PM];
        else [u, v] = [1.8 * PM - ((t - 2) / (SLIDE_ROUND - 2)) * 3.4 * PM, 1.1 * PM * (1 - Math.max(0, (t - 3.4) / 0.6))];
        face = t < 1.2 ? s.angle : s.angle + Math.PI;
        break;
      }
      case 'springy':
        u += Math.sin(this.clock * 6 + p.id) * 0.15 * PM;
        break;
      case 'seesaw':
        face = s.angle + (u > 0 ? Math.PI : 0);
        break;
      default:
        // On the climbing frame, in the sandpit: facing in.
        face = s.angle + Math.atan2(-v, -u);
    }
    const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
    p.x = s.x + ux * u - uy * v;
    p.y = s.y + uy * u + ux * v;
    p.angle = face;
    p.speed = 0;
  }

  /** Sitting: a while, then up and off (a picnic packs up together). Their seat knocked from under them: knocked down; smashed or shoved away: up. */
  private sit(p: Person, dt: number): void {
    p.timer -= dt;
    const s = p.seat;
    if (s) {
      const moved = Math.hypot(s.x - p.seatAt[2], s.y - p.seatAt[3]);
      if (s.gone || s.wrecked || moved > 0.4 * M) {
        p.seat = null;
        if (Math.hypot(s.vx, s.vy) > 3 * M) this.knock(p, { vx: s.vx, vy: s.vy }, Math.hypot(s.vx, s.vy));
        else this.rejoin(p);
        return;
      }
      this.onSeat(p);
    }
    if (p.timer > 0) return;
    if (p.picnic) {
      // Packing up: the blanket goes with the last of them.
      const c = p.picnic;
      p.picnic = null;
      if (!this.people.some((q) => q.picnic === c)) c.gone = true;
    }
    p.seat = null;
    this.rejoin(p);
  }

  // --- Each frame ---

  /**
   * Everyone does what they're doing. `player` and `movers` are the vehicles
   * (yours first): they're got out of the way of, run from, and hit by.
   * `light` says what a traffic light's showing. `walkable` says whether
   * somewhere's open ground on a level (not in the water or a building, or
   * off the edge of a bridge's deck). `levelAt` says which level someone's on
   * now, having been on one (up onto a deck at its ends, down off it).
   */
  update(
    dt: number,
    view: PeopleView,
    player: Mover,
    movers: Mover[],
    light: (signal: number) => Light,
    walkable: (x: number, y: number, level: number) => boolean,
    levelAt: (level: number, x: number, y: number) => number = (level) => level,
  ): void {
    this.populate(view);
    this.play(dt);
    this.kickabouts(dt);
    this.walkable = walkable;
    // (Lists kept from frame to frame: no garbage.)
    const all = this.all;
    all.length = 0;
    all.push(player);
    for (const m of movers) all.push(m);
    this.walkDogs(dt, all);
    // Danger: you, going fast right by them (or along the pavement at them); and anything on a call, its siren going.
    const danger = this.danger;
    danger.length = 0;
    if (!player.onFoot) danger.push(player);
    for (const m of movers) if (m.siren) danger.push(m);
    for (const m of danger) {
      const pspeed = Math.hypot(m.vx, m.vy);
      const plevel = m.level ?? 0;
      for (const p of this.people) {
        if (p.mode === 'down' || p.mode === 'board' || p.level !== plevel) continue;
        // (Within a second of it, at most: as far as it's seen coming.)
        const reach = Math.max(6 * M, pspeed) + 2 * M;
        if (Math.abs(p.x - m.x) > reach || Math.abs(p.y - m.y) > reach) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        const onPavement = pspeed > 5 * M && d < 5 * M && !this.inRoad(m.x, m.y, undefined, plevel);
        if ((pspeed > 8 * M && d < 3.5 * M) || onPavement) this.scare(p, m.x, m.y);
        if ((p.mode as Mode) !== 'dive' && !m.bike) this.dodge(p, m, pspeed);
      }
    }
    // Who's where, for stepping round each other.
    this.close.clear();
    for (const p of this.people) {
      if (p.mode === 'board' || p.mode === 'flee' || p.mode === 'dive') continue;
      const k = `${Math.floor(p.x / NEAR_CELL)},${Math.floor(p.y / NEAR_CELL)}`;
      const list = this.close.get(k);
      if (list) list.push(p);
      else this.close.set(k, [p]);
    }
    for (const p of this.people) {
      switch (p.mode) {
        case 'walk':
          this.walk(p, dt);
          break;
        case 'wander':
          this.wander(p, dt);
          break;
        case 'sit':
          this.sit(p, dt);
          break;
        case 'shop':
          this.shopping(p, dt);
          break;
        case 'perform':
          this.perform(p, dt);
          break;
        case 'vend':
          this.vend(p);
          break;
        case 'game':
          this.inGame(p, dt);
          break;
        case 'join':
          if (this.goTo(p, p.tx, p.ty, p.pace, dt)) {
            p.mode = 'stand';
            p.speed = 0;
          }
          break;
        case 'stand':
          p.timer -= dt;
          if (p.gather) this.watch(p);
          if (p.timer < 0) this.leave(p);
          break;
        case 'kerb':
          this.atKerb(p, dt, all, light);
          break;
        case 'cross':
          if (this.goTo(p, p.tx, p.ty, p.pace * 1.15, dt)) this.rejoin(p);
          break;
        case 'queue':
          this.queue(p, movers);
          break;
        case 'board':
          // To the bus's door, and on.
          if (this.goTo(p, p.tx, p.ty, p.pace * 1.2, dt)) p.gone = true;
          break;
        case 'flee':
          this.flee(p, dt, walkable);
          break;
        case 'dive':
        case 'down':
          this.thrown(p, dt, walkable);
          break;
      }
      if (p.speed > 0 && p.mode !== 'down') p.step = (p.step + (dt * p.speed) / (0.75 * M)) % 1;
      p.level = levelAt(p.level, p.x, p.y);
    }
    this.hitBy(all);
    this.buses(movers, dt);
    this.pigeons(dt, view, all);
  }

  /** Along their walk, keeping to their side of it; at its end, on to another starting there (or back the way they came). */
  private walk(p: Person, dt: number): void {
    const w = this.walks[p.line]?.pts;
    if (!w) return this.leave(p);
    if (p.joining) {
      if (this.goTo(p, p.tx, p.ty, p.pace, dt)) {
        p.joining = false;
        p.level = this.walks[p.line].level;
      }
      return;
    }
    const n = w.length / 2;
    const [tx, ty] = [w[p.next * 2], w[p.next * 2 + 1]];
    const [px, py] = [w[(p.next - p.dir) * 2] ?? tx, w[(p.next - p.dir) * 2 + 1] ?? ty];
    const len = Math.hypot(tx - px, ty - py) || 1;
    const [ux, uy] = [(tx - px) / len, (ty - py) / len];
    // Stepping round anyone in the way (and slowing behind someone slower): see `make way`; and round a vehicle standing there.
    const along = (p.x - px) * ux + (p.y - py) * uy;
    const round = this.roundBlocks(p, px, py, ux, uy, along);
    const [shift, slower] = round === null ? this.makeWay(p, ux, uy) : [round, Infinity];
    // (No way round: they wait. Round one: briskly aside, slowing till they're far enough over.)
    let slow = Number.isNaN(round) ? 0 : slower;
    const rate = round !== null ? 3 * M : 1.6 * M;
    if (!Number.isNaN(shift)) p.avoid += Math.max(-rate * dt, Math.min(rate * dt, shift - p.avoid));
    if (round !== null && !Number.isNaN(shift) && Math.abs(shift - p.avoid) > 0.2 * M) slow = Math.min(slow, p.pace * 0.25);
    // Steering for a point a couple of metres on along the line (or its next corner), to one side of it.
    // (Going round a vehicle: steering for nearer on, to keep to the way round it.)
    const ahead = Math.min(len, along + (round !== null ? 0.8 : 2) * M);
    const wide = round !== null ? ROUND_MOST : 1.05 * M;
    const off = Math.max(-wide, Math.min(wide, p.side + p.avoid));
    const [sx, sy] = [px + ux * ahead - uy * off, py + uy * ahead + ux * off];
    const [x0, y0] = [p.x, p.y];
    this.goTo(p, sx, sy, Math.min(p.pace, slow), dt, 0.05 * M);
    if (this.blocks.length) this.skirt(p, x0, y0);
    if (len - along < 0.6 * M) {
      p.next += p.dir;
      if (p.next < 0 || p.next >= n) this.endOfWalk(p);
    }
    // Passing a performer or a food cart: now and then, they stop to watch, or join the queue.
    if (p.mode === 'walk' && !p.joining && this.rand() < dt * 0.5) this.stopBy(p);
    // Passing a crossing: now and then, over the road.
    if (p.mode === 'walk' && this.rand() < dt * 3) {
      for (const i of this.crossingGrid.get(key(p.x, p.y)) ?? []) {
        const c = this.crossings[i];
        if (i === p.crossing) continue;
        for (const [kx, ky, fx, fy] of [[c.ax, c.ay, c.bx, c.by], [c.bx, c.by, c.ax, c.ay]]) {
          if (Math.hypot(kx - p.x, ky - p.y) > 2.5 * M) continue;
          if (this.rand() < 0.5) {
            p.mode = 'kerb';
            p.crossing = i;
            [p.tx, p.ty] = [fx, fy];
            p.timer = 0;
            p.angle = Math.atan2(fy - p.y, fx - p.x);
          } else p.crossing = i;
        }
      }
    }
  }

  /**
   * A vehicle standing in the way (up on the pavement, or across the path),
   * walking along the line from (px, py), (ux, uy), `along` it: how far to
   * step aside (from the line's middle, less their own side) to get past it
   * with room, the nearer way that's open ground (away from it first); NaN if
   * there's no way round (they wait); null if nothing's in the way.
   */
  private roundBlocks(p: Person, px: number, py: number, ux: number, uy: number, along: number): number | null {
    if (!this.blocks.length) return null;
    const [nx, ny] = [-uy, ux];
    // What's a few metres ahead, near the way they're walking.
    const near = this.blocks.filter((b) => b.level === p.level && Math.abs(b.x - p.x) < b.length / 2 + 6 * M && Math.abs(b.y - p.y) < b.length / 2 + 6 * M);
    if (!near.length) return null;
    const clear = (off: number) => {
      for (let d = -0.75 * M; d <= ROUND_LOOK; d += 0.5 * M) {
        const [x, y] = [px + ux * (along + d) + nx * off, py + uy * (along + d) + ny * off];
        for (const b of near) if (bodyDist(b, x, y) < b.r + ROUND_ROOM) return false;
      }
      return true;
    };
    const now = p.side + p.avoid;
    if (clear(now)) {
      // (Already past or round it: keep the step they've taken while it's beside them.)
      return p.avoid !== 0 && !clear(p.side) ? p.avoid : null;
    }
    // Which side it's on: step away from it first.
    let across = 0;
    for (const b of near) across += (b.x - p.x) * nx + (b.y - p.y) * ny;
    const first = across > 0 ? -1 : 1;
    for (let k = 1; k * 0.25 * M <= ROUND_MOST; k++) {
      for (const side of [first, -first]) {
        const off = p.side + side * k * 0.25 * M;
        if (Math.abs(off) > ROUND_MOST || !clear(off)) continue;
        // On open ground there (not the water, a wall, a building).
        const [x, y] = [px + ux * (along + 1.5 * M) + nx * off, py + uy * (along + 1.5 * M) + ny * off];
        if (!this.walkable(x, y, p.level)) continue;
        return off - p.side;
      }
    }
    return Number.NaN;
  }

  /**
   * Having stepped from (x0, y0): if that took them nearer a vehicle standing there than they should be (as when a corner of
   * their walk has them change which side they go round it), the part of the step towards it is dropped, so they go along it.
   */
  private skirt(p: Person, x0: number, y0: number): void {
    for (const b of this.blocks) {
      if (b.level !== p.level || Math.abs(b.x - p.x) > b.length || Math.abs(b.y - p.y) > b.length) continue;
      const from = bodyDist(b, x0, y0);
      if (bodyDist(b, p.x, p.y) >= Math.min(from, b.r + ROUND_NEAREST)) continue;
      // Away from the nearest point down its middle.
      const h = Math.max(0, b.length / 2 - b.r);
      const [c, s] = [Math.cos(b.angle), Math.sin(b.angle)];
      const t = Math.max(-h, Math.min(h, (x0 - b.x) * c + (y0 - b.y) * s));
      const [ox, oy] = [x0 - b.x - c * t, y0 - b.y - s * t];
      const [nx, ny] = [ox / (from || 1), oy / (from || 1)];
      const [mx, my] = [p.x - x0, p.y - y0];
      const into = Math.min(0, mx * nx + my * ny);
      [p.x, p.y] = [x0 + mx - nx * into, y0 + my - ny * into];
    }
  }

  /**
   * Anyone in the way, walking along (ux, uy): how far to step to the side to
   * get round them (to the side away from them; head on, each keeps to their
   * left), px, and how fast to go (no faster than someone close in front going
   * the same way).
   */
  private makeWay(p: Person, ux: number, uy: number): [number, number] {
    let shift = 0;
    let slow = Infinity;
    const cx = Math.floor(p.x / NEAR_CELL);
    const cy = Math.floor(p.y / NEAR_CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const q of this.close.get(`${cx + i},${cy + j}`) ?? []) {
          if (q === p || q.level !== p.level) continue;
          const [rx, ry] = [q.x - p.x, q.y - p.y];
          const ahead = rx * ux + ry * uy;
          if (ahead <= 0 || ahead > 2 * M) continue;
          const across = -rx * uy + ry * ux;
          if (Math.abs(across) > 0.8 * M) continue;
          const sameWay = q.speed > 2 && Math.cos(q.angle) * ux + Math.sin(q.angle) * uy > 0.7;
          // Close behind someone going the same way: keep pace with them (or pass, if there's room and they're slow).
          if (sameWay && ahead < 1.2 * M && q.speed < p.pace * 0.85) slow = Math.min(slow, q.speed);
          if (sameWay && q.speed >= p.pace * 0.85) continue;
          // Round them: away from the side they're on (dead ahead, to the left, as Britons do).
          const side = Math.abs(across) < 0.1 * M ? -1 : -Math.sign(across);
          const need = (0.85 * M - Math.abs(across)) * side;
          if (Math.abs(need) > Math.abs(shift)) shift = need;
        }
      }
    }
    return [shift, slow];
  }

  /** At the end of a walk: on along another that starts (or ends) near here, or back. */
  private endOfWalk(p: Person): void {
    const choices: number[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const e of this.ends.get(key(p.x + i * GRID, p.y + j * GRID)) ?? []) {
          const k = e >> 1;
          if (k === p.line) continue;
          const w = this.walks[k].pts;
          const [x, y] = e & 1 ? [w[w.length - 2], w[w.length - 1]] : [w[0], w[1]];
          if (Math.hypot(x - p.x, y - p.y) < 6 * M && this.clear(p.x, p.y, x, y, p.level)) choices.push(e);
        }
      }
    }
    if (!choices.length) {
      // A dead end: back the way they came.
      p.dir = p.dir === 1 ? -1 : 1;
      p.next = Math.max(0, Math.min(this.walks[p.line].pts.length / 2 - 1, p.next + p.dir * 2));
      return;
    }
    const e = choices[Math.floor(this.rand() * choices.length)];
    const k = e >> 1;
    const w = this.walks[k].pts;
    const n = w.length / 2;
    this.onto(p, k, e & 1 ? n - 2 : 0, e & 1 ? -1 : 1, e & 1 ? [w[w.length - 2], w[w.length - 1]] : [w[0], w[1]]);
  }

  /** Wandering about a park or square: to somewhere in it, a while there, then somewhere else. */
  private wander(p: Person, dt: number): void {
    if (p.timer > 0) {
      p.timer -= dt;
      p.speed = 0;
      return;
    }
    // (A child runs about, and hardly stops.)
    if (this.goTo(p, p.tx, p.ty, p.pace * (p.child ? 1.7 : 0.8), dt)) {
      p.timer = this.rand() < (p.child ? 0.15 : 0.4) ? (p.child ? 1 + this.rand() * 4 : 3 + this.rand() * 15) : 0;
      const ring = this.areas[p.area];
      for (let tries = 0; ring && tries < 10; tries++) {
        const a = this.rand() * Math.PI * 2;
        const d = (5 + this.rand() * 25) * M;
        const [x, y] = [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
        if (pointInRing(x, y, ring)) {
          [p.tx, p.ty] = [x, y];
          return;
        }
      }
      // Can't find anywhere: off along a path, if there's one near.
      this.rejoin(p);
    }
  }

  /** Done standing about: off along the nearest walk (or wandering, in a park). */
  private leave(p: Person): void {
    this.rejoin(p);
  }

  /** Back to walking: onto the nearest walk within 15 m (or wandering about the park they're in; or standing a while longer). */
  private rejoin(p: Person): void {
    this.leaveGather(p);
    // A child stays in the playground; the lollipop lady at her post.
    if (p.child || p.lollipop) {
      const area = p.child ? this.areas.findIndex((ring) => pointInRing(p.x, p.y, ring)) : -1;
      if (area >= 0) {
        p.mode = 'wander';
        p.area = area;
        [p.tx, p.ty] = [p.x, p.y];
      } else {
        p.mode = 'stand';
        p.speed = 0;
        p.timer = 30 + this.rand() * 60;
      }
      return;
    }
    const near = this.inRoad(p.x, p.y, undefined, p.level) ? this.nearestWalk(p.x, p.y, 15 * M, false, p.level) : this.nearestWalk(p.x, p.y, 15 * M, true, p.level);
    if (near) {
      const [x, y, k, seg] = near;
      this.onto(p, k, seg, this.rand() < 0.5 ? 1 : -1, [x, y]);
      return;
    }
    const area = this.areas.findIndex((ring) => pointInRing(p.x, p.y, ring));
    if (area >= 0) {
      p.mode = 'wander';
      p.area = area;
      [p.tx, p.ty] = [p.x, p.y];
      return;
    }
    p.mode = 'stand';
    p.speed = 0;
    p.timer = 20 + this.rand() * 40;
  }

  /** Waiting at the kerb to cross: for the lights to stop the traffic, or a gap in it (then over). Not for ever. */
  private atKerb(p: Person, dt: number, all: Mover[], light: (signal: number) => Light): void {
    p.speed = 0;
    p.timer += dt;
    const c = this.crossings[p.crossing];
    let go: boolean;
    if (c.kind === 'lights' && c.signals.length) go = c.signals.every((s) => light(s) === 'red');
    else {
      // A gap: nothing coming within a few seconds of it.
      const [mx, my] = [(c.ax + c.bx) / 2, (c.ay + c.by) / 2];
      go = all.every((v) => {
        const d = Math.hypot(v.x - mx, v.y - my);
        const toward = ((mx - v.x) * v.vx + (my - v.y) * v.vy) / (d || 1);
        return d > 6 * M + Math.max(0, toward) * (c.kind === 'zebra' ? 2 : 3.5);
      });
    }
    if (go && this.rand() < dt * 2.5) p.mode = 'cross';
    else if (p.timer > 40) this.rejoin(p);
  }

  /** Waiting at a bus stop: standing about, facing the road. */
  private queue(p: Person, movers: Mover[]): void {
    p.speed = 0;
    const [sx, sy] = this.stops[p.stop];
    // A bus at the stop, its door open: over to it, and on.
    for (const b of movers) {
      if (!b.dwelling || Math.hypot(b.x - sx, b.y - sy) > (b.train ? b.length / 2 + 6 * M : 20 * M)) continue;
      p.mode = 'board';
      p.stop = -1;
      [p.tx, p.ty] = b.train ? trainDoor(b, p.x, p.y) : door(b);
      return;
    }
  }

  /** Buses at their stops: those waiting get on (see `queue`); and a few get off, and walk away. */
  private readonly served = new Set<number>();
  private buses(movers: Mover[], dt: number): void {
    for (const b of movers) {
      if (!b.dwelling) {
        this.served.delete(b.id);
        continue;
      }
      if (b.train) {
        this.alight(b);
        continue;
      }
      if (b.bay) {
        this.bay(b, b.bay, dt);
        continue;
      }
      if (this.served.has(b.id)) continue;
      this.served.add(b.id);
      const [dx, dy] = door(b);
      for (let k = Math.floor(this.rand() * 4); k > 0; k--) {
        const p = this.make(dx + (this.rand() - 0.5) * M, dy + (this.rand() - 0.5) * M, 'walk');
        this.rejoin(p);
      }
    }
  }

  /**
   * A train's carriage, just pulled in at a stop: a few get off it, onto the
   * platform (on whichever side there's one), and walk off along it, out of
   * the station.
   */
  private alight(b: Mover): void {
    if (this.served.has(b.id)) return;
    this.served.add(b.id);
    const [ux, uy] = [Math.cos(b.angle), Math.sin(b.angle)];
    for (const side of [1, -1]) {
      const [px, py] = [b.x - uy * side * (b.width / 2 + 1.2 * M), b.y + ux * side * (b.width / 2 + 1.2 * M)];
      if (!this.map.areas.some((a) => a.kind === 'platform' && pointInRing(px, py, a.rings[0]))) continue;
      for (let k = Math.floor(this.rand() * 4); k > 0; k--) {
        const along = (this.rand() - 0.5) * b.length * 0.7;
        const p = this.make(px + ux * along, py + uy * along, 'join');
        p.level = b.level ?? 0;
        // Off along the platform, to the nearest way out of it (a path), then on their way.
        const out = this.nearestWalk(p.x, p.y, 60 * M, true, p.level);
        [p.tx, p.ty] = out ? [out[0], out[1]] : [p.x + ux * 20 * M * (this.rand() < 0.5 ? 1 : -1), p.y + uy * 20 * M];
        p.timer = 0.1;
      }
    }
  }

  /**
   * A bus in its bay at a bus station: as it pulls in, those on it get off,
   * up onto the platform and into the station; all the while it's there,
   * others come out to it now and then, and get on.
   */
  private bay(b: Mover, [px, py]: [number, number], dt: number): void {
    const [dx, dy] = door(b);
    const d = Math.hypot(px - dx, py - dy) || 1;
    const [ux, uy] = [(px - dx) / d, (py - dy) / d];
    if (!this.served.has(b.id)) {
      this.served.add(b.id);
      for (let k = b.fresh ? 1 + Math.floor(this.rand() * 5) : 0; k > 0; k--) {
        const p = this.make(dx + (this.rand() - 0.5) * M, dy + (this.rand() - 0.5) * M, 'board');
        [p.tx, p.ty] = [px + ux * 2.5 * M + (this.rand() - 0.5) * 2 * M, py + uy * 2.5 * M + (this.rand() - 0.5) * 2 * M];
        p.pace *= 0.6 + this.rand() * 0.4;
      }
    }
    if (this.rand() < dt * 0.3) {
      // (From in the station, a little way back from the platform's edge.)
      const back = 2.5 * M + this.rand() * 2 * M;
      const p = this.make(px + ux * back + (this.rand() - 0.5) * 2 * M, py + uy * back + (this.rand() - 0.5) * 2 * M, 'board');
      [p.tx, p.ty] = [dx, dy];
    }
  }

  /** Running from danger: away from it, roads or not (but not into the water or a wall); once it's passed, back to what they were doing. */
  private flee(p: Person, dt: number, walkable: (x: number, y: number, level: number) => boolean): void {
    p.timer -= dt;
    if (p.timer <= 0) return this.rejoin(p);
    const [ux, uy] = [Math.cos(p.angle), Math.sin(p.angle)];
    const [nx, ny] = [p.x + ux * RUN * dt, p.y + uy * RUN * dt];
    // (Not into a bus station's yard: only out of it, if they're in it.)
    if (walkable(nx, ny, p.level) && (p.level !== 0 || !this.inYard(nx, ny) || this.inYard(p.x, p.y))) {
      [p.x, p.y] = [nx, ny];
      p.speed = RUN;
    } else {
      // Blocked: off another way, away still.
      p.angle += (this.rand() < 0.5 ? 1 : -1) * (0.6 + this.rand() * 0.8);
      p.speed = 0;
    }
  }

  /** Thrown (hit, or diving out of the way): sliding to a stop; then, unless hurt, up again (diving: on their feet at once, and running). */
  private thrown(p: Person, dt: number, walkable: (x: number, y: number, level: number) => boolean): void {
    const [nx, ny] = [p.x + p.vx * dt, p.y + p.vy * dt];
    if (walkable(nx, ny, p.level)) [p.x, p.y] = [nx, ny];
    else [p.vx, p.vy] = [0, 0];
    // Diving: a short slide to a stop. (Knocked down, they're not moving.)
    const k = Math.exp(-(p.mode === 'dive' ? 3 : 14) * dt);
    p.vx *= k;
    p.vy *= k;
    p.speed = Math.hypot(p.vx, p.vy);
    p.timer -= dt;
    if (p.hurt || p.timer > 0) return;
    if (p.mode === 'dive') {
      p.mode = 'flee';
      p.timer = SCARED[0] + this.rand() * (SCARED[1] - SCARED[0]);
    } else this.rejoin(p);
  }

  /** Scared by danger at (x, y): running from it, unless they're down (or getting on a bus). */
  scare(p: Person, x: number, y: number): void {
    if (p.mode === 'down' || p.mode === 'board' || p.mode === 'dive') return;
    this.letGo(p);
    this.leaveGather(p);
    if (p.mode !== 'flee') p.was = p.mode;
    p.mode = 'flee';
    p.stop = -1;
    p.seat = null;
    p.picnic = null;
    p.timer = SCARED[0] + this.rand() * (SCARED[1] - SCARED[0]);
    p.angle = Math.atan2(p.y - y, p.x - x) + (this.rand() - 0.5) * 0.8;
  }

  /** Everyone within `reach` px of (x, y), on its level, is scared (a crash, someone knocked down). */
  scareAround(x: number, y: number, reach: number, level = 0): void {
    for (const p of this.people) if (p.level === level && Math.hypot(p.x - x, p.y - y) < reach) this.scare(p, x, y);
  }

  /** A car coming straight at them, fast: they jump out of the way (most of them, if they see it in time). */
  private dodge(p: Person, car: Mover, speed: number): void {
    if (speed < 4 * M) return;
    const [rx, ry] = [p.x - car.x, p.y - car.y];
    const [ux, uy] = [car.vx / speed, car.vy / speed];
    const ahead = rx * ux + ry * uy;
    const across = -rx * uy + ry * ux;
    const t = ahead / speed;
    if (t < 0.15 || t > 0.9 || Math.abs(across) > car.width / 2 + 1.2 * M) return;
    // Not everyone sees it coming (each gets a chance a frame or so, ever fewer as it nears).
    if (this.rand() > 0.12) return;
    const away = across >= 0 ? 1 : -1;
    p.was = p.mode === 'flee' ? p.was : p.mode;
    p.mode = 'dive';
    p.timer = 0.45;
    p.vx = -uy * away * 6 * M + ux * 1 * M;
    p.vy = ux * away * 6 * M + uy * 1 * M;
    p.angle = Math.atan2(p.vy, p.vx);
  }

  /** The vehicles hitting people: knocked flying, the way it was going (and up again, after a slow one). */
  private hitBy(all: Mover[]): void {
    for (const p of this.people) {
      if (p.mode === 'board') continue;
      for (const v of all) {
        if ((v.level ?? 0) !== p.level || Math.abs(v.x - p.x) > v.length || Math.abs(v.y - p.y) > v.length) continue;
        const [ux, uy] = [Math.cos(v.angle), Math.sin(v.angle)];
        const [rx, ry] = [p.x - v.x, p.y - v.y];
        const along = rx * ux + ry * uy;
        const across = -rx * uy + ry * ux;
        if (Math.abs(along) > v.length / 2 + R || Math.abs(across) > v.width / 2 + R) continue;
        const rel = Math.hypot(v.vx - p.vx, v.vy - p.vy);
        // A child is never hit: out from in front of it, whatever it is, and off running.
        if (p.child) {
          const out = this.outFrom(v, p.x, p.y, 0.3 * M);
          if (out) [p.x, p.y] = [p.x + out[0], p.y + out[1]];
          if (rel > 1.2 * M && p.mode !== 'flee') this.scare(p, v.x, v.y);
          continue;
        }
        // A bike brushes past (it's slowed for them, and weaves round): they're just nudged aside.
        if (v.bike) {
          const out = across >= 0 ? 1 : -1;
          p.x += -uy * out * 1;
          p.y += ux * out * 1;
          continue;
        }
        if (p.mode === 'down') {
          this.runOver(p, v, along, across, rel);
          continue;
        }
        if (rel < 1.2 * M) {
          // Just nudged: out of the way.
          const out = across >= 0 ? 1 : -1;
          p.x += -uy * out * 1;
          p.y += ux * out * 1;
          continue;
        }
        this.knock(p, v, rel);
        // And now under it: its wheels go over them (see runOver).
        p.under = v.id;
        p.underAlong = along;
      }
      // Out from under it.
      if (p.under !== null && !all.some((v) => v.id === p.under && Math.abs((p.x - v.x) * Math.cos(v.angle) + (p.y - v.y) * Math.sin(v.angle)) <= v.length / 2 + R)) p.under = null;
    }
  }

  /**
   * Lying in a vehicle's way: it goes over them (they're too heavy to be
   * shoved along), each axle bumping over them as it reaches them, which
   * slows it a little; they're barely moved. Hurt, if it's going at any speed.
   */
  private runOver(p: Person, v: Mover, along: number, across: number, speed: number): void {
    const [ux, uy] = [Math.cos(v.angle), Math.sin(v.angle)];
    if (p.under !== v.id) {
      p.under = v.id;
      p.underAlong = along;
      return;
    }
    // The axles, a little in from each end; going forward, the front reaches them first (and in reverse, the back).
    const axle = v.length * 0.32;
    const was = p.underAlong;
    p.underAlong = along;
    for (const a of [axle, -axle]) {
      if ((was - a > 0) === (along - a > 0)) continue;
      // A wheel over them: a shove the way it's going (a little), and to the side, away from its middle.
      const out = across >= 0 ? 1 : -1;
      p.vx += ux * Math.min(speed, 4 * M) * 0.08 - uy * out * 0.4 * M;
      p.vy += uy * Math.min(speed, 4 * M) * 0.08 + ux * out * 0.4 * M;
      if (speed > HURT * 0.6) p.hurt = true;
      p.timer = Math.max(p.timer, DOWN[0]);
      // As a speed hump would: more off it the faster it's going, from a crawl to about a tenth.
      const loss = Math.min(0.1, 0.02 + speed / (40 * M) * 0.08);
      this.hits.push({ person: p, speed, by: v.id, how: 'over', loss });
    }
  }

  /** A driver (or rider) pulled out of their vehicle at (x, y): off and running, away from (fromX, fromY). */
  jumpOut(x: number, y: number, level: number, look: number, fromX: number, fromY: number): Person {
    const p = this.make(x, y, 'walk');
    Object.assign(p, { look: look % LOOKS, level });
    this.scare(p, fromX, fromY);
    return p;
  }

  /**
   * A cyclist knocked off their bike, going `speed` px/s: down on the road
   * at (x, y), facing `angle`; hurt if it was fast. (Up again, they go on on
   * foot.) `look` is their clothes, as they were riding.
   */
  unseat(x: number, y: number, angle: number, level: number, speed: number, look: number): Person {
    const p = this.make(x, y, 'down');
    Object.assign(p, { look: look % LOOKS, angle, level, was: 'walk' as Mode, hurt: speed > HURT, timer: DOWN[0] + this.rand() * (DOWN[1] - DOWN[0]) });
    return p;
  }

  /** Knocked down by a vehicle going `speed` px/s: thrown, and down for a moment, or for good. */
  knock(p: Person, v: { vx: number; vy: number; id?: number }, speed: number): void {
    this.letGo(p);
    this.leaveGather(p);
    if (p.mode !== 'down' && p.mode !== 'flee' && p.mode !== 'dive') p.was = p.mode;
    p.mode = 'down';
    p.stop = -1;
    p.seat = null;
    p.picnic = null;
    p.under = null;
    // Flat on the ground where they were hit (not thrown about): lying the way it was going, more or less.
    p.vx = 0;
    p.vy = 0;
    p.angle = Math.atan2(v.vy, v.vx) + (this.rand() - 0.5) * 0.8;
    if (speed > HURT) p.hurt = true;
    p.timer = DOWN[0] + this.rand() * (DOWN[1] - DOWN[0]);
    // What hit them loses a good part of its speed to the knock: 12%, and more the faster it was going (up to 30%).
    this.hits.push({ person: p, speed, by: v.id, how: 'hit', loss: speed < 1.2 * M ? 0 : Math.min(0.3, 0.12 + (speed / (40 * M)) * 0.16) });
  }

  // --- Street life (see streetLife.ts) ---

  /** Where a pitch or a cart is now (a cart can be knocked about). */
  private placeOf(g: Gather): [number, number] {
    return g.cart ? [g.cart.x, g.cart.y] : [g.x, g.y];
  }

  /** Those gathered at a pitch or a cart (watching, queuing; not its performer or vendor). */
  private gathered(g: Gather): Person[] {
    return this.people.filter((q) => q.gather === g && q !== g.host);
  }

  /** Where someone watching a performer stands: in front of them, somewhere round an arc (closer round a living statue). */
  private inCrowd(g: Gather): [number, number] {
    const a = g.angle + (this.rand() - 0.5) * 2.4;
    const d = (g.act === 'statue' ? 1.8 : 2.4) * M + this.rand() * 1.4 * M;
    return [g.x + Math.cos(a) * d, g.y + Math.sin(a) * d];
  }

  /** Where the `k`th in a cart's queue stands: out from its serving side, one behind another (at a stall, side by side along its front). */
  private inQueue(g: Gather, k: number): [number, number] {
    const [x, y] = this.placeOf(g);
    if (g.stall) {
      const [ux, uy] = [Math.cos(g.angle), Math.sin(g.angle)];
      const along = (k - 1) * 0.9 * M + (this.rand() - 0.5) * 0.3 * M;
      return [x + ux * 1.8 * M - uy * along, y + uy * 1.8 * M + ux * along];
    }
    const d = 1.5 * M + k * 0.8 * M;
    return [x + Math.cos(g.angle) * d + (this.rand() - 0.5) * 0.25 * M, y + Math.sin(g.angle) * d + (this.rand() - 0.5) * 0.25 * M];
  }

  /**
   * The performers at their pitches and the vendors at their carts near the
   * view (coming out of sight, as everyone does), a crowd round each
   * performer, a queue at each cart. Not every pitch is taken (the same ones
   * aren't, by where they are), nor a cart that's been knocked about.
   */
  private streetLife(x0: number, y0: number, x1: number, y1: number, seen: (x: number, y: number) => boolean, all: boolean): void {
    for (const g of [...this.pitches, ...this.carts]) {
      const [gx, gy] = this.placeOf(g);
      if (g.host || gx < x0 || gx > x1 || gy < y0 || gy > y1 || seen(gx, gy) || (!all && this.rand() > 0.02)) continue;
      if (g.cart && (g.cart.gone || g.cart.wrecked || g.cart.moved || Math.hypot(g.cart.x - g.x, g.cart.y - g.y) > 0.5 * M)) continue;
      if (g.kind === 'pitch' && Math.abs(Math.round(g.x + g.y)) % 5 === 0) continue;
      if (g.kind === 'pitch') {
        const p = this.make(g.x, g.y, 'perform');
        if (p.gone) continue;
        Object.assign(p, { act: g.act, gather: g, angle: g.angle });
        g.host = p;
        // Charity fundraisers work in twos (a few metres apart); and they, and a Big Issue seller, draw no crowd.
        if (g.act === 'charity') {
          // (Either side, wherever's open paving: not a flowerbed, the grass, the water.)
          const [ax, ay] = [-Math.sin(g.angle), Math.cos(g.angle)];
          const at = [3, -3, 2, -2].map((d) => [g.x + ax * d * M, g.y + ay * d * M] as const).find(([x, y]) => this.paved(x, y));
          if (at) {
            const q = this.make(at[0], at[1], 'perform');
            Object.assign(q, { act: 'charity', gather: g, angle: g.angle });
          }
        }
        if (g.act === 'charity' || g.act === 'bigissue') continue;
        for (let k = (g.act === 'statue' ? 2 : 3) + Math.floor(this.rand() * 6); k > 0; k--) {
          const [x, y] = this.inCrowd(g);
          const q = this.make(x, y, 'stand');
          Object.assign(q, { gather: g, timer: 20 + this.rand() * 70, angle: Math.atan2(g.y - y, g.x - x) });
        }
      } else {
        const [ux, uy] = [Math.cos(g.angle), Math.sin(g.angle)];
        const back = (g.stall ? 1.8 : 1.3) * M;
        const p = this.make(gx - ux * back, gy - uy * back, 'vend');
        if (p.gone) continue;
        Object.assign(p, { act: 'vendor', gather: g, angle: g.angle });
        g.host = p;
        for (let k = 0, n = Math.floor(this.rand() * 4); k < n; k++) {
          const [x, y] = this.inQueue(g, k);
          const q = this.make(x, y, 'stand');
          Object.assign(q, { gather: g, timer: 8 + this.rand() * 15 + k * 8, angle: g.angle + Math.PI });
        }
      }
    }
  }

  /** Walking past a performer (or a food cart) close by: now and then, they stop and watch (or join the queue), if there's room. */
  private stopBy(p: Person): void {
    for (const g of [...this.pitches, ...this.carts]) {
      if (!g.host || g.host.level !== p.level) continue;
      const [gx, gy] = this.placeOf(g);
      if (Math.abs(gx - p.x) > 7 * M || Math.abs(gy - p.y) > 7 * M || Math.hypot(gx - p.x, gy - p.y) > 7 * M) continue;
      const n = this.gathered(g).length;
      // (Stopped by a charity fundraiser, or buying the Big Issue: one at a time, now and then, for a moment, close.)
      const asked = g.act === 'charity' || g.act === 'bigissue';
      if (asked ? n >= 1 || this.rand() > 0.12 : g.kind === 'pitch' ? n >= 12 || this.rand() > 0.4 : n >= (g.stall ? 3 : 4) || this.rand() > (g.stall ? 0.35 : 0.25)) continue;
      if (asked) {
        const host = g.host;
        [p.tx, p.ty] = [host.x + Math.cos(host.angle) * 1.1 * M, host.y + Math.sin(host.angle) * 1.1 * M];
      } else [p.tx, p.ty] = g.kind === 'pitch' ? this.inCrowd(g) : this.inQueue(g, n);
      if (!this.walkable(p.tx, p.ty, p.level)) continue;
      p.mode = 'join';
      p.gather = g;
      p.timer = asked ? 6 + this.rand() * 10 : g.kind === 'pitch' ? 15 + this.rand() * 60 : g.stall ? 10 + this.rand() * 25 : 8 + this.rand() * 15 + n * 8;
      return;
    }
  }

  /** Watching a performer (or queuing at a cart): facing them; once they've gone, off soon after. */
  private watch(p: Person): void {
    const g = p.gather!;
    if (!g.host) {
      p.timer = Math.min(p.timer, 1 + this.rand() * 3);
      return;
    }
    const [gx, gy] = g.kind === 'cart' ? this.placeOf(g) : [g.x, g.y];
    let turn = Math.atan2(gy - p.y, gx - p.x) - p.angle;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    p.angle += turn * 0.1;
  }

  /**
   * Performing: playing, juggling, or still as a statue, facing the crowd;
   * a charity fundraiser or a Big Issue seller turning to whoever's walking
   * by, to catch them. With the one they work with gone, off too.
   */
  private perform(p: Person, dt: number): void {
    p.speed = 0;
    const g = p.gather;
    if (!g || !g.host) {
      p.mode = 'walk';
      return this.rejoin(p);
    }
    if (p.act !== 'statue') p.step = (p.step + dt * (p.act === 'juggler' ? 1.6 : 2.2)) % 1;
    let face = g.angle;
    if (p.act === 'charity' || p.act === 'bigissue') {
      let best = 5 * M;
      for (const q of this.close.get(`${Math.floor(p.x / NEAR_CELL)},${Math.floor(p.y / NEAR_CELL)}`) ?? []) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (q !== p && q.act !== p.act && d < best && (q.mode === 'walk' || q.gather === g)) [best, face] = [d, Math.atan2(q.y - p.y, q.x - p.x)];
      }
    }
    let turn = face - p.angle;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    p.angle += turn * Math.min(1, dt * 4);
  }

  /** Whether somewhere's open paving to stand on: not in a flowerbed, on the grass, in the water, a building or on a road. */
  private paved(x: number, y: number): boolean {
    if (!this.walkable(x, y, 0) || this.inRoad(x, y, 0.5 * M)) return false;
    return !this.map.areas.some((a) => (a.kind === 'flowerbed' || a.kind === 'grass' || a.kind === 'water' || a.kind === 'park') && pointInRing(x, y, a.rings[0]));
  }

  /** Selling from their cart; knocked about (or smashed), they're off. */
  private vend(p: Person): void {
    p.speed = 0;
    const g = p.gather;
    const c = g?.cart;
    if (!g || !c || c.gone || c.wrecked || c.moved || Math.hypot(c.x - g.x, c.y - g.y) > 0.5 * M) {
      this.scare(p, c?.x ?? p.x, c?.y ?? p.y);
      return;
    }
    p.angle = g.angle;
  }

  /** No longer at a pitch or a cart (gone, scared, knocked down, done): if they were its performer or vendor, it's free. */
  /**
   * Games starting near the view (out of sight): on the grass, four to seven at a kick-about, two or three throwing a frisbee;
   * on a pitch or a court, as many as its game has (see SPORT_PLAY), each at their place on it.
   */
  private parkGames(x0: number, y0: number, x1: number, y1: number, seen: (x: number, y: number) => boolean, all: boolean): void {
    for (const g of this.games) {
      if (g.x < x0 || g.x > x1 || g.y < y0 || g.y > y1 || seen(g.x, g.y) || (!all && this.rand() > 0.05)) continue;
      if (this.people.some((p) => p.game === g)) continue;
      const time = 60 + this.rand() * 180;
      const players: Person[] = [];
      if (g.spots) {
        const play = SPORT_PLAY[g.kind as SportGame];
        const most = Math.min(play.players[1], g.spots.length / 2);
        const n = g.kind === 'tennis' ? (this.rand() < 0.35 && most >= 4 ? 4 : 2) : Math.max(Math.min(play.players[0], most), Math.floor(play.players[0] + this.rand() * (most - play.players[0] + 1)));
        for (let k = 0; k < n; k++) {
          const [x, y] = [g.spots[k * 2], g.spots[k * 2 + 1]];
          const p = this.make(x, y, 'game');
          if (p.gone) continue;
          Object.assign(p, { game: g, tx: x, ty: y, timer: time + this.rand() * 20, angle: Math.atan2(g.y - y, g.x - x) });
          players.push(p);
        }
        g.order = players;
      } else {
        const football = g.kind === 'football';
        const n = football ? 4 + Math.floor(this.rand() * 4) : 2 + (this.rand() < 0.3 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          // Round in a ring (a kick-about), or either end of the throw (and one off to the side).
          const [a, r] = football ? [g.angle + (k / n) * Math.PI * 2 + this.rand() * 0.4, (4 + this.rand() * 2) * M] : [g.angle + (k === 2 ? Math.PI / 2 : k * Math.PI), (k === 2 ? 5 : 7) * M];
          const [x, y] = [g.x + Math.cos(a) * r, g.y + Math.sin(a) * r];
          const p = this.make(x, y, 'game');
          if (p.gone) continue;
          Object.assign(p, { game: g, tx: x, ty: y, timer: time + this.rand() * 20, angle: a + Math.PI });
          players.push(p);
        }
      }
      const b = g.ball;
      Object.assign(b, { holder: players[0] ?? null, target: null, dur: 0, hold: 1 + this.rand() });
    }
  }

  /** Playing: chasing the ball (if it's theirs to get), holding it, or back to their place in the game, watching it. A while, then off. */
  private inGame(p: Person, dt: number): void {
    p.timer -= dt;
    const g = p.game;
    if (!g || p.timer < 0) return this.rejoin(p);
    const b = g.ball;
    if (b.holder === p) {
      p.speed = 0;
      return;
    }
    if (b.target === p) {
      // After it: to where it's coming down (or where it is).
      const [x, y] = b.dur > 0 ? b.to : [b.x, b.y];
      this.goTo(p, x, y, RUN * 0.65, dt, 0.4 * M);
      return;
    }
    if (this.goTo(p, p.tx, p.ty, p.pace, dt)) {
      p.speed = 0;
      let turn = Math.atan2(b.y - p.y, b.x - p.x) - p.angle;
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
      p.angle += turn * Math.min(1, dt * 5);
    }
  }

  /**
   * The games' balls (and frisbees): held a moment (a football dribbled at
   * their feet), then passed or thrown to someone else in the game, through
   * the air, a little off; whoever it's to runs and gets it.
   */
  private kickabouts(dt: number): void {
    const playing = new Map<Kickabout, Person[]>();
    for (const p of this.people) if (p.game && p.mode === 'game') playing.set(p.game, [...(playing.get(p.game) ?? []), p]);
    for (const g of this.games) {
      const players = playing.get(g);
      const b = g.ball;
      if (!players) {
        [b.holder, b.target] = [null, null];
        if (b.dur > 0) [b.x, b.y, b.z, b.dur] = [b.to[0], b.to[1], 0, 0];
        continue;
      }
      if (b.holder && !players.includes(b.holder)) b.holder = null;
      if (b.target && !players.includes(b.target)) b.target = null;
      const football = g.kind === 'football';
      const play = g.spots ? SPORT_PLAY[g.kind as SportGame] : null;
      if (b.dur > 0) {
        b.t += dt;
        const k = Math.min(1, b.t / b.dur);
        b.x = b.from[0] + (b.to[0] - b.from[0]) * k;
        b.y = b.from[1] + (b.to[1] - b.from[1]) * k;
        // A football along the ground, or lofted a little; a frisbee floating level, then down; on a pitch, as high as it was hit.
        b.z = play ? 4 * k * (1 - k) * (b.loft ?? 0) : football ? 4 * k * (1 - k) * 0.5 * M : (1.1 + 0.5 * Math.sin(k * Math.PI) - 0.9 * k * k) * M;
        if (k >= 1) [b.dur, b.z] = [0, 0];
        continue;
      }
      const h = b.holder;
      if (h) {
        // At their feet (or in their hand), in front of them.
        b.x = h.x + Math.cos(h.angle) * 0.45 * M;
        b.y = h.y + Math.sin(h.angle) * 0.45 * M;
        b.z = play ? play.held : football ? 0 : 1 * M;
        b.hold -= dt;
        const others = players.filter((q) => q !== h);
        if (b.hold > 0 || !others.length) continue;
        b.from = [b.x, b.y];
        b.t = 0;
        if (play) {
          const pass = this.pass(g, h, players, play);
          b.to = pass.to;
          b.loft = pass.loft;
          b.dur = Math.max(0.25, Math.hypot(b.to[0] - b.x, b.to[1] - b.y) / pass.speed);
          h.angle = Math.atan2(b.to[1] - b.y, b.to[0] - b.x);
          [b.holder, b.target] = [null, pass.target];
          continue;
        }
        const to = others[Math.floor(this.rand() * others.length)];
        const [a, d] = [this.rand() * Math.PI * 2, this.rand() * 1.6 * M];
        b.to = [to.x + Math.cos(a) * d, to.y + Math.sin(a) * d];
        b.dur = Math.max(0.4, Math.hypot(b.to[0] - b.x, b.to[1] - b.y) / (football ? PASS : THROW));
        h.angle = Math.atan2(b.to[1] - b.y, b.to[0] - b.x);
        [b.holder, b.target] = [null, to];
        continue;
      }
      // On the ground: whoever it was meant for (or whoever's nearest) gets it.
      b.target ??= players.reduce((best, q) => (Math.hypot(q.x - b.x, q.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? q : best), players[0]);
      const t = b.target;
      if (Math.hypot(t.x - b.x, t.y - b.y) < 0.7 * M) {
        [b.holder, b.target] = [t, null];
        // (A batsman hits it straight back out.)
        b.hold = play ? (g.kind === 'cricket' && t === g.order?.[1] ? 0.1 : play.hold[0] + this.rand() * (play.hold[1] - play.hold[0])) : football ? 0.8 + this.rand() * 2 : 0.5 + this.rand() * 1.2;
        // Back to (near) where they were (on a pitch, their place on it).
        if (!play) [t.tx, t.ty] = [t.tx + (t.x - t.tx) * 0.3, t.ty + (t.y - t.ty) * 0.3];
      }
    }
  }

  /**
   * Where a game on a pitch sends its ball next, from whoever has it: over the net to someone the other side (tennis, padel,
   * table tennis); a shot at the hoop or the goal, now and then, or a pass (basketball, netball, football, hockey; a kick at the
   * posts, rugby); bowled to the batsman, hit out to a fielder and thrown back to the bowler (cricket); rolled up the rink to the
   * jack, and back (bowls); at a hoop (croquet). Who's to get it, if anyone (a shot: whoever's nearest where it ends up).
   */
  private pass(g: Kickabout, h: Person, players: Person[], play: (typeof SPORT_PLAY)[SportGame]): { to: [number, number]; target: Person | null; loft: number; speed: number } {
    const others = players.filter((q) => q !== h);
    const any = () => others[Math.floor(this.rand() * others.length)];
    const near = (x: number, y: number, d: number): [number, number] => {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * d;
      return [x + Math.cos(a) * r, y + Math.sin(a) * r];
    };
    const aims = g.aims ?? [];
    const nearestAim = (): [number, number] | null => {
      let best: [number, number] | null = null;
      for (let k = 0; k + 1 < aims.length; k += 2) if (!best || Math.hypot(aims[k] - h.x, aims[k + 1] - h.y) < Math.hypot(best[0] - h.x, best[1] - h.y)) best = [aims[k], aims[k + 1]];
      return best;
    };
    const [ux, uy] = [Math.cos(g.angle), Math.sin(g.angle)];
    const end = (q: Person) => Math.sign((q.tx - g.x) * ux + (q.ty - g.y) * uy);
    switch (g.kind) {
      case 'tennis':
      case 'padel':
      case 'pingpong': {
        const over = others.filter((q) => end(q) !== end(h));
        const to = over.length ? over[Math.floor(this.rand() * over.length)] : any();
        return { to: near(to.tx, to.ty, g.kind === 'pingpong' ? 0.3 * M : 1.5 * M), target: to, loft: play.loft, speed: play.speed * (0.8 + this.rand() * 0.4) };
      }
      case 'cricket': {
        const [bowler, batsman] = g.order ?? [];
        if (h === bowler && batsman && others.includes(batsman)) return { to: [batsman.tx, batsman.ty], target: batsman, loft: play.loft, speed: play.speed };
        if (h === batsman) {
          const fielders = others.filter((q) => q !== bowler && q !== g.order?.[2]);
          const to = fielders.length ? fielders[Math.floor(this.rand() * fielders.length)] : any();
          return { to: near(to.tx, to.ty, 4 * M), target: to, loft: (0.5 + this.rand() * 6) * M, speed: (12 + this.rand() * 10) * M };
        }
        const to = bowler && others.includes(bowler) ? bowler : any();
        return { to: [to.tx, to.ty], target: to, loft: 2 * M, speed: 15 * M };
      }
      case 'bowls': {
        // From the mat up to the jack (it ends up round it, and the one up there gets it); and from up there, back to the mat.
        const skip = g.order?.[2];
        const aim = nearestAim();
        if (h === skip || !aim) {
          const to = others.find((q) => q !== skip) ?? any();
          return { to: near(to.tx, to.ty, 0.6 * M), target: to, loft: 0, speed: play.speed * 1.5 };
        }
        const [x, y] = aims.length >= 2 ? [aims[0], aims[1]] : aim;
        return { to: near(x, y, 1.2 * M), target: skip && others.includes(skip) ? skip : null, loft: 0, speed: play.speed };
      }
      case 'croquet': {
        // At a hoop, and after it (their own ball), or the other's turn.
        const k = Math.floor((this.rand() * aims.length) / 2) * 2;
        const to: [number, number] = aims.length ? near(aims[k], aims[k + 1], 1 * M) : near(h.x, h.y, 6 * M);
        return { to, target: this.rand() < 0.5 ? any() : h, loft: 0, speed: play.speed };
      }
      default: {
        // A shot (at the nearest hoop, goal or posts), now and then: whoever's nearest where it ends up gets it.
        const aim = nearestAim();
        if (aim && play.shot && this.rand() < play.shot && Math.hypot(aim[0] - h.x, aim[1] - h.y) < 35 * M) {
          return { to: near(aim[0], aim[1], (g.kind === 'basketball' || g.kind === 'netball' ? 0.4 : 1.5) * M), target: null, loft: play.shotLoft ?? play.loft, speed: play.speed * 1.2 };
        }
        const to = any();
        return { to: near(to.tx, to.ty, 1.2 * M), target: to, loft: play.loft, speed: play.speed };
      }
    }
  }

  /**
   * The dogs out on their leads: at their owner's heels (wandering from side
   * to side), stopping to sniff about, never further than the lead. Anything
   * coming at them and they're out of its way at once, to the side (the lead
   * let go of, if need be): a dog's never hit.
   */
  private walkDogs(dt: number, all: Mover[]): void {
    for (const p of this.people) {
      const d = p.dog;
      if (!d) continue;
      // Something coming (or about to run them down, or there): off to the side of its way, fast.
      let away: [number, number] | null = null;
      for (const m of all) {
        if ((m.level ?? 0) !== p.level || Math.abs(m.x - d.x) > 14 * M || Math.abs(m.y - d.y) > 14 * M) continue;
        const sp = Math.hypot(m.vx, m.vy);
        const [ux, uy] = sp > 0.2 * M ? [m.vx / sp, m.vy / sp] : [Math.cos(m.angle), Math.sin(m.angle)];
        const [rx, ry] = [d.x - m.x, d.y - m.y];
        const along = rx * ux + ry * uy;
        const side = -rx * uy + ry * ux;
        if (along > -m.length / 2 && along < m.length / 2 + sp * 1.3 + 0.5 * M && Math.abs(side) < m.width / 2 + 1.2 * M) away = [-uy * (Math.sign(side) || 1), ux * (Math.sign(side) || 1)];
      }
      if (away) {
        const speed = 7 * M;
        d.x += away[0] * speed * dt;
        d.y += away[1] * speed * dt;
        d.angle = Math.atan2(away[1], away[0]);
        d.speed = speed;
        d.step = (d.step + (dt * speed) / (0.35 * M)) % 1;
        d.sniff = 0;
        this.clearOfAll(d, all, p.level, 0.4 * M);
        continue;
      }
      d.sniff -= dt;
      const back = p.speed > 0.5 * M ? 1.3 * M : 0.9 * M;
      const side = Math.sin(this.clock * 0.7 + p.id) * 0.8 * M;
      const [ux, uy] = [Math.cos(p.angle), Math.sin(p.angle)];
      const [tx, ty] = [p.x - ux * back - uy * side, p.y - uy * back + ux * side];
      const far = Math.hypot(tx - d.x, ty - d.y);
      if (far > 0.3 * M && !(d.sniff > 0 && Math.hypot(p.x - d.x, p.y - d.y) < LEAD * 0.8)) {
        const speed = Math.min(far * 3, Math.max(p.speed * 1.4, 1.5 * M));
        d.x += ((tx - d.x) / far) * Math.min(far, speed * dt);
        d.y += ((ty - d.y) / far) * Math.min(far, speed * dt);
        d.speed = speed;
        let turn = Math.atan2(ty - d.y, tx - d.x) - d.angle;
        turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
        d.angle += turn * Math.min(1, dt * 8);
        d.step = (d.step + (dt * speed) / (0.35 * M)) % 1;
      } else {
        d.speed = 0;
        if (d.sniff < -4 && this.rand() < dt * 0.4) d.sniff = 1.5 + this.rand() * 2.5;
      }
      // Pulled along on its lead.
      const lead = Math.hypot(d.x - p.x, d.y - p.y);
      if (lead > LEAD) [d.x, d.y] = [p.x + ((d.x - p.x) / lead) * LEAD, p.y + ((d.y - p.y) / lead) * LEAD];
      this.clearOfAll(d, all, p.level, 0.4 * M);
    }
  }

  /** An animal (a dog, a pigeon on the ground) stepped clear of every vehicle on its level, whatever else: it's never under one. */
  private clearOfAll(a: { x: number; y: number }, all: Mover[], level: number, room: number): boolean {
    let moved = false;
    for (const m of all) {
      if ((m.level ?? 0) !== level) continue;
      const out = this.outFrom(m, a.x, a.y, room);
      if (!out) continue;
      a.x += out[0];
      a.y += out[1];
      moved = true;
    }
    return moved;
  }

  private leaveGather(p: Person): void {
    if (p.game) {
      const b = p.game.ball;
      if (b.holder === p) b.holder = null;
      if (b.target === p) b.target = null;
      p.game = null;
    }
    const g = p.gather;
    if (!g) return;
    if (g.host === p) g.host = null;
    p.gather = null;
  }

  /**
   * The pigeons: pecking about where they gather, hopping out of the way of
   * anyone walking through; anything coming at them fast, or close, or
   * anyone running, and they're up and away, all at once; back a minute or
   * two later (out of sight).
   */
  private pigeons(dt: number, view: PeopleView, all: Mover[]): void {
    for (const f of this.flocks) {
      const near = f.x > view.x0 - NEAR && f.x < view.x1 + NEAR && f.y > view.y0 - NEAR && f.y < view.y1 + NEAR;
      if (!f.birds.length) {
        f.away -= dt;
        const inSight = f.x > view.x0 - 3 * M && f.x < view.x1 + 3 * M && f.y > view.y0 - 3 * M && f.y < view.y1 + 3 * M;
        if (!near || inSight || f.away > 0) continue;
        for (let k = 5 + Math.floor(this.rand() * 8); k > 0; k--) {
          const [a, d] = [this.rand() * Math.PI * 2, this.rand() * 2.2 * M];
          f.birds.push({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, z: 0, angle: this.rand() * Math.PI * 2, vx: 0, vy: 0, timer: this.rand() * 2, peck: this.rand() < 0.5, flying: false });
        }
        continue;
      }
      if (!near) continue;
      // Danger: you or anything else coming fast, or close by; or someone running.
      let threat: [number, number] | null = null;
      for (const m of all) {
        if ((m.level ?? 0) !== 0 || Math.abs(m.x - f.x) > 10 * M || Math.abs(m.y - f.y) > 10 * M) continue;
        const [sp, d] = [Math.hypot(m.vx, m.vy), Math.hypot(m.x - f.x, m.y - f.y)];
        if ((sp > 1.5 * M && d < 7 * M + m.length / 2) || (sp > 0.3 * M && d < 3.5 * M + m.length / 2)) threat = [m.x, m.y];
      }
      for (const p of this.people) if ((p.mode === 'flee' || p.mode === 'dive') && Math.abs(p.x - f.x) < 4 * M && Math.abs(p.y - f.y) < 4 * M) threat = [p.x, p.y];
      for (let i = f.birds.length - 1; i >= 0; i--) {
        const b = f.birds[i];
        if (b.flying) {
          b.timer += dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += 2.5 * M * dt;
          if (b.timer > 3.5) f.birds.splice(i, 1);
          continue;
        }
        // (Anything at all right by it, however slowly it's coming: it's off, never under it.)
        const by = all.find((m) => (m.level ?? 0) === 0 && this.outFrom(m, b.x, b.y, 1 * M));
        const from = by ? [by.x, by.y] : threat;
        if (from) {
          // Up and away from it (each its own way, more or less).
          const a = Math.atan2(b.y - from[1], b.x - from[0]) + (this.rand() - 0.5) * 1.6;
          const v = (5 + this.rand() * 3) * M;
          Object.assign(b, { flying: true, timer: 0, angle: a, vx: Math.cos(a) * v, vy: Math.sin(a) * v, peck: false });
          continue;
        }
        // Someone walking right by: quickly out of their way.
        for (const q of this.close.get(`${Math.floor(b.x / NEAR_CELL)},${Math.floor(b.y / NEAR_CELL)}`) ?? []) {
          const d = Math.hypot(b.x - q.x, b.y - q.y);
          if (q.level !== 0 || d > 0.7 * M || d < 1e-6) continue;
          // (To the side of the way they're going, not on ahead of them.)
          const [nx, ny] = [-Math.sin(q.angle), Math.cos(q.angle)];
          const side = (b.x - q.x) * nx + (b.y - q.y) * ny >= 0 ? 1 : -1;
          b.x += nx * side * 2.5 * M * dt;
          b.y += ny * side * 2.5 * M * dt;
          b.angle = Math.atan2(ny * side, nx * side);
        }
        // Pecking about: now and then a few steps, back towards the others if they've strayed.
        b.timer -= dt;
        if (b.timer <= 0) {
          const home = Math.hypot(b.x - f.x, b.y - f.y) > 2.5 * M;
          b.angle = home ? Math.atan2(f.y - b.y, f.x - b.x) + (this.rand() - 0.5) : this.rand() * Math.PI * 2;
          b.peck = !home && this.rand() < 0.5;
          b.timer = 0.6 + this.rand() * 1.6;
        }
        if (!b.peck) {
          b.x += Math.cos(b.angle) * 0.45 * M * dt;
          b.y += Math.sin(b.angle) * 0.45 * M * dt;
        }
      }
      if (!f.birds.length) f.away = 40 + this.rand() * 80;
    }
  }

  // --- Shopping (see Trip) ---

  /** Whether anyone's pushing a trolley about (the scene keeps track of where the trolleys are). */
  pushing(): boolean {
    return this.people.some((p) => !!p.trip?.trolley);
  }

  /** The trolleys standing in a row (a shop's bay, or one of its shelters'), from its first on. */
  private inRow(row: TrolleyRow): Trolley[] {
    const [bx, by, a, count] = row;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const held = new Set(this.people.map((p) => p.trip?.trolley));
    const standing: [number, Trolley][] = [];
    for (const t of this.trolleys) {
      if (t.gone || t.wrecked || t.inside || t.moved || held.has(t)) continue;
      const [rx, ry] = [t.x - bx, t.y - by];
      const along = rx * ux + ry * uy;
      if (Math.abs(-rx * uy + ry * ux) > 0.4 * M || along < -0.5 * M || along > (count + 3) * TROLLEY_GAP * M) continue;
      standing.push([along, t]);
    }
    return standing.sort((p, q) => p[0] - q[0]).map(([, t]) => t);
  }

  /** Shoppers at the big shops near the view (as many as there's room for): out of the shop to their car, or from their car to the shop. */
  private shoppers(x0: number, y0: number, x1: number, y1: number, seen: (x: number, y: number) => boolean, now = false): void {
    this.stores.forEach((st, k) => {
      const [dx, dy, out] = st.door;
      if (dx < x0 || dx > x1 || dy < y0 || dy > y1 || (!now && this.rand() > 0.04)) return;
      if (this.people.filter((p) => p.trip?.store === k).length >= SHOPPERS) return;
      // Their car: one parked in the car park (not yours).
      const cars = this.blocks.filter((b) => !b.you && b.level === 0 && pointInRing(b.x, b.y, st.park));
      if (!cars.length) return;
      const b = cars[Math.floor(this.rand() * cars.length)];
      const car: Trip['car'] = [b.x, b.y, b.angle, b.length, b.r];
      if (now && this.rand() < 0.5) {
        // (Coming into a region: some at their cars already, loading their shopping, a trolley from a row.)
        const p = this.make(0, 0, 'shop');
        p.pace *= 0.85;
        p.trip = { store: k, row: 0, leg: 'load', trolley: null, car, route: [] };
        [p.x, p.y] = this.byCar(p.trip, dx, dy);
        p.angle = Math.atan2(b.y - p.y, b.x - p.x);
        p.timer = 1 + this.rand() * 8;
        // (Not where there's no room.)
        const [hx, hy] = [p.x + Math.cos(p.angle) * HOLD, p.y + Math.sin(p.angle) * HOLD];
        if (this.blocks.some((o) => bodyDist(o, p.x, p.y) < o.r + 0.3 * M || bodyDist(o, hx, hy) < o.r)) p.gone = true;
        else {
          const row = this.rows[k]?.[this.nearestRow(p.trip, true)];
          const t = row ? (this.inRow(row).pop() ?? null) : null;
          if (t) Object.assign(t, { full: true });
          p.trip.trolley = t;
          this.hold(p);
        }
      } else if (this.rand() < 0.5) {
        // Out of the shop, with a trolley full of shopping (one taken in; or, at first, out of sight, one from the bay).
        let t = this.trolleys.find((o) => o.inside && !o.gone && !o.wrecked && Math.hypot(o.x - dx, o.y - dy) < 2 * M) ?? null;
        if (!t) {
          const row = this.rows[k]?.find((r) => !seen(r[0], r[1]) && this.inRow(r).length);
          t = row ? (this.inRow(row).pop() ?? null) : null;
        }
        const p = this.make(dx, dy, 'shop');
        Object.assign(p, { angle: out, pace: p.pace * 0.85 });
        p.trip = { store: k, row: 0, leg: 'out', trolley: t, car, route: [] };
        if (t) Object.assign(t, { inside: false, full: true });
        this.hold(p);
        p.trip.route = [...this.outside(st, 3), ...this.byCar(p.trip, dx, dy)];
      } else {
        // From their car (out of sight): for a trolley.
        const [cx, cy] = this.carSide(car);
        if (seen(cx, cy)) return;
        const p = this.make(cx, cy, 'shop');
        p.pace *= 0.85;
        p.trip = { store: k, row: 0, leg: 'fetch', trolley: null, car, route: [] };
        this.toBay(p, st);
      }
    });
  }

  /** Out from a shop's door, px, d m. */
  private outside(st: Store, d: number): [number, number] {
    const [x, y, a] = st.door;
    return [x + Math.cos(a) * d * M, y + Math.sin(a) * d * M];
  }

  /** Where they stand to load their car: off its end (the nearer clear one, on open ground), a trolley's length and a bit back. */
  private byCar(trip: Trip, fromX: number, fromY: number): [number, number] {
    const [x, y, a, length] = trip.car;
    const ends = [1, -1].map((e) => [x + Math.cos(a) * e * (length / 2 + 1.8 * M), y + Math.sin(a) * e * (length / 2 + 1.8 * M)] as [number, number]);
    const ok = ([ex, ey]: [number, number]) => this.walkable(ex, ey, 0) && !this.blocks.some((b) => bodyDist(b, ex, ey) < b.r + 0.4 * M);
    const near = ends.sort((p, q) => Math.hypot(p[0] - fromX, p[1] - fromY) - Math.hypot(q[0] - fromX, q[1] - fromY));
    return near.find(ok) ?? near[0];
  }

  /** Beside their car, at its door (whichever side's clear). */
  private carSide(car: Trip['car']): [number, number] {
    const [x, y, a, , r] = car;
    const sides = [1, -1].map((e) => [x - Math.sin(a) * e * (r + 0.7 * M), y + Math.cos(a) * e * (r + 0.7 * M)] as [number, number]);
    return sides.find(([sx, sy]) => !this.blocks.some((b) => bodyDist(b, sx, sy) < b.r + 0.3 * M)) ?? sides[0];
  }

  /** Off to the trolley bay, for the trolley at the end of the row (behind it, to take it); or, none there, into the shop without. */
  private toBay(p: Person, st: Store): void {
    const trip = p.trip!;
    // (The row with trolleys in it nearest their car.)
    trip.row = this.nearestRow(trip, true);
    const row = this.rows[trip.store]?.[trip.row];
    const last = row && this.inRow(row).pop();
    if (!row || !last) {
      trip.leg = 'in';
      trip.route = [...this.outside(st, 3), st.door[0], st.door[1]];
      return;
    }
    const [ux, uy] = [Math.cos(row[2]), Math.sin(row[2])];
    const [gx, gy] = [last.x + ux * HOLD, last.y + uy * HOLD];
    trip.leg = 'fetch';
    trip.route = [gx + ux * 2 * M, gy + uy * 2 * M, gx, gy];
  }

  /** Of a trip's store's rows of trolleys, the nearest their car (with trolleys in it, if `full`; else with room). */
  private nearestRow(trip: Trip, full: boolean): number {
    const rows = this.rows[trip.store] ?? [];
    let [best, near] = [0, Infinity];
    rows.forEach((r, i) => {
      const n = this.inRow(r).length;
      if (full ? n === 0 : n >= r[3] + 2) return;
      const d = Math.hypot(r[0] - trip.car[0], r[1] - trip.car[1]);
      if (d < near) [best, near] = [i, d];
    });
    return best;
  }

  /** Where the next trolley goes in a row: on its end (or at its start). */
  private nextSlot(row: TrolleyRow): [number, number] {
    const [bx, by, a] = row;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const last = this.inRow(row).pop();
    const along = last ? (last.x - bx) * ux + (last.y - by) * uy + TROLLEY_GAP * M : 0;
    return [bx + ux * along, by + uy * along];
  }

  /** Their trolley, in front of them, the way they're facing. */
  private hold(p: Person): void {
    const t = p.trip?.trolley;
    if (!t) return;
    Object.assign(t, { x: p.x + Math.cos(p.angle) * HOLD, y: p.y + Math.sin(p.angle) * HOLD, angle: p.angle, level: p.level, vx: 0, vy: 0 });
  }

  /** Letting go of their trolley (it stays where it is), and of their shopping trip. */
  private letGo(p: Person): void {
    p.trip = null;
  }

  /** Shopping: along their way, pushing their trolley (or not); at the end of each leg, on to the next. */
  private shopping(p: Person, dt: number): void {
    const trip = p.trip;
    const st = trip && this.stores[trip.store];
    if (!trip || !st) {
      this.letGo(p);
      return this.rejoin(p);
    }
    const t = trip.trolley;
    // Their trolley knocked out of their hands (or smashed): on without it.
    if (t && (t.gone || t.wrecked || t.moved || Math.hypot(t.x - p.x - Math.cos(p.angle) * HOLD, t.y - p.y - Math.sin(p.angle) * HOLD) > 0.6 * M)) trip.trolley = null;
    if (trip.leg === 'load') {
      p.speed = 0;
      p.timer -= dt;
      p.angle = Math.atan2(trip.car[1] - p.y, trip.car[0] - p.x);
      this.hold(p);
      if (trip.trolley && p.timer < 2.5) trip.trolley.full = false;
      if (p.timer > 0) return;
      if (trip.trolley && this.rand() < 0.88) {
        // The trolley back to the bay: along the row, and pushed in on the end.
        trip.row = this.nearestRow(trip, false);
        const row = this.rows[trip.store][trip.row];
        const [ux, uy] = [Math.cos(row[2]), Math.sin(row[2])];
        const [sx, sy] = this.nextSlot(row);
        trip.leg = 'return';
        trip.route = [sx + ux * (HOLD + 2.5 * M), sy + uy * (HOLD + 2.5 * M), sx + ux * HOLD, sy + uy * HOLD];
      } else {
        // (Or left by the car.)
        trip.trolley = null;
        trip.leg = 'home';
        trip.route = [...this.carSide(trip.car)];
      }
      return;
    }
    if (trip.route.length >= 2 && this.steer(p, trip.route[0], trip.route[1], p.pace * (trip.trolley ? 0.9 : 1), dt)) trip.route.splice(0, 2);
    this.hold(p);
    if (trip.route.length >= 2) return;
    switch (trip.leg) {
      case 'fetch': {
        // Taking the trolley on the end of the row (if it's still there), and into the shop with it.
        const row = this.rows[trip.store][trip.row];
        const last = this.inRow(row).pop();
        if (last && Math.hypot(last.x - p.x + Math.cos(row[2]) * HOLD, last.y - p.y + Math.sin(row[2]) * HOLD) < 1.2 * M) {
          trip.trolley = last;
          p.angle = row[2] + Math.PI;
          this.hold(p);
        }
        trip.leg = 'in';
        trip.route = [...this.outside(st, 3), st.door[0], st.door[1]];
        break;
      }
      case 'in':
        // In: shopping (gone from here), the trolley with them.
        if (trip.trolley) Object.assign(trip.trolley, { inside: true, full: false, x: st.door[0], y: st.door[1] });
        p.gone = true;
        break;
      case 'out':
        trip.leg = 'load';
        p.timer = 5 + this.rand() * 5;
        break;
      case 'return': {
        // Pushed into the end of the row.
        const tr = trip.trolley;
        if (tr) {
          const row = this.rows[trip.store][trip.row];
          const [sx, sy] = this.nextSlot(row);
          Object.assign(tr, { x: sx, y: sy, angle: row[2] + Math.PI });
        }
        trip.trolley = null;
        trip.leg = 'home';
        trip.route = [...this.carSide(trip.car)];
        break;
      }
      case 'home':
        // Into their car, and off (as far as anyone here's concerned).
        p.gone = true;
        break;
    }
  }

  /**
   * Walks towards (x, y), round any vehicle standing in the way (and with a
   * trolley, round it with that too); whether they're there.
   */
  private steer(p: Person, x: number, y: number, speed: number, dt: number): boolean {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= 0.3 * M) return true;
    let a = Math.atan2(y - p.y, x - p.x);
    const reach = (p.trip?.trolley ? HOLD : 0) + 0.7 * M;
    // (Close to where they're going, straight there.)
    if (d > reach + 0.5 * M) {
      const near = this.blocks.filter((b) => b.level === p.level && Math.abs(b.x - p.x) < b.length + reach && Math.abs(b.y - p.y) < b.length + reach);
      // (Anywhere along the way they'd go, out to their trolley's front.)
      const blocked = (h: number) => {
        for (let r = 0.5 * M; r <= reach + 0.01; r += 0.5 * M) if (near.some((b) => bodyDist(b, p.x + Math.cos(h) * r, p.y + Math.sin(h) * r) < b.r + 0.4 * M)) return true;
        return false;
      };
      // Round it, keeping to the side they've been going round it by (so they get round a row of cars, not back and forth).
      if (blocked(a)) {
        const side = p.avoid < 0 ? -1 : 1;
        let turn = 0;
        for (let k = 0.4; k <= 3.2 && !turn; k += 0.4) turn = !blocked(a + side * k) ? side * k : !blocked(a - side * k) ? -side * k : 0;
        p.avoid = Math.sign(turn) || p.avoid;
        // (Hemmed in: they wait.)
        if (!turn) {
          p.speed = 0;
          return false;
        }
        a += turn;
      } else p.avoid = 0;
    }
    const step = Math.min(d, 2 * M);
    this.goTo(p, p.x + Math.cos(a) * step, p.y + Math.sin(a) * step, speed, dt, 0);
    return false;
  }

  /** Walks towards (x, y) at `speed`; whether they're there (within `near` px). */
  private goTo(p: Person, x: number, y: number, speed: number, dt: number, near = 0.3 * M): boolean {
    const [dx, dy] = [x - p.x, y - p.y];
    const d = Math.hypot(dx, dy);
    if (d <= near) return true;
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    p.speed = speed;
    // Turning to face the way they're going (not at once).
    let turn = Math.atan2(dy, dx) - p.angle;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    p.angle += turn * Math.min(1, dt * 8);
    return false;
  }

  /** Those out in the road (crossing, or running), or walking along a cycle path: for the traffic (and the bikes) to stop for. */
  inTheRoad(): Person[] {
    return this.people.filter(
      (p) => p.mode === 'cross' || p.mode === 'flee' || p.mode === 'dive' || (p.mode === 'down' && this.inRoad(p.x, p.y, undefined, p.level)) || (p.mode === 'walk' && !!this.walks[p.line]?.cycle),
    );
  }
}

/** The door of a train's carriage nearest someone: on their side of it, along it as far as they are (but not at its ends), just outside it. */
function trainDoor(b: Mover, x: number, y: number): [number, number] {
  const [ux, uy] = [Math.cos(b.angle), Math.sin(b.angle)];
  const [rx, ry] = [x - b.x, y - b.y];
  const along = Math.max(-b.length / 3, Math.min(b.length / 3, rx * ux + ry * uy));
  const side = -rx * uy + ry * ux >= 0 ? 1 : -1;
  return [b.x + ux * along - uy * side * (b.width / 2 + 0.3 * M), b.y + uy * along + ux * side * (b.width / 2 + 0.3 * M)];
}

/** Where a bus's door is: at the front, on the kerb side (the left: with y down, (uy, -ux)), just outside it. */
function door(b: Mover): [number, number] {
  const [ux, uy] = [Math.cos(b.angle), Math.sin(b.angle)];
  return [b.x + ux * b.length * 0.35 + uy * (b.width / 2 + 0.8 * M), b.y + uy * b.length * 0.35 - ux * (b.width / 2 + 0.8 * M)];
}

function lengthOf(pts: Pts): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return len;
}

function polyArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}
