/**
 * The damage bill: what everything you break costs to put right, £ (see GameScene's `charge`, and the HUD's count of it).
 * Roughly what it'd cost in Bristol: a lamp post put back up, a garden wall rebuilt, a car's dents beaten out (or, past
 * mending, the car). Independent of Phaser, so it can be tested.
 */

import { BREAKUP, type ThingKind, type WallKind } from './damage';
import type { VehicleKind } from './traffic';

/** Street furniture and the like, knocked down (a tree's priced by its height: see `treePrice`). */
export const THING_PRICE: Record<Exclude<ThingKind, 'tree'>, number> = {
  lamp: 3_500,
  signal: 12_000,
  beacon: 2_500,
  bollard: 450,
  mooring: 900,
  postbox: 3_000,
  phone: 6_000,
  meter: 1_200,
  pump: 25_000,
  clock: 8_000,
  lifering: 250,
  bikes: 2_000,
  fountain: 45_000,
  statue: 80_000,
  crane: 250_000,
  stump: 0,
  cctv: 3_500,
  charger: 9_000,
  railsignal: 30_000,
  pylon: 400_000,
  flagpole: 1_500,
};

/** What's left of a statue's plinth or a fountain's basin, smashed to rubble after. */
export const REMAINS_PRICE = 15_000;

/** A street tree felled: putting another in, and what it was worth (an older, taller one more), £. */
export function treePrice(heightMetres: number): number {
  return Math.round((900 + 350 * heightMetres) / 50) * 50;
}

/** A wall, fence or hedge knocked through: a metre of it put back, £. (A bus shelter's glass, a whole one.) */
export const WALL_PRICE: Record<WallKind, number> = {
  wall: 450,
  hedge: 120,
  fence: 90,
  railing: 300,
  gate: 900,
  liftgate: 600,
  chain: 40,
  shelter: 1_500,
  parapet: 1_800,
  heras: 60,
  mesh: 90,
  prison: 9_000,
  net: 30,
};

/** A hut (a shed, a garage, a kiosk: see world.ts's `isHut`) knocked down. */
export const HUT_PRICE = 15_000;

/** The loose things, smashed (what's left of them standing: a wreck); those not here, by how tough they are (see `loosePrice`). */
export const LOOSE_PRICE: Partial<Record<string, number>> = {
  bench: 1_200,
  picnic: 800,
  bin: 400,
  wheelie: 60,
  recyclebox: 15,
  gardenset: 250,
  shed: 1_500,
  trampoline: 300,
  washline: 80,
  bbq: 150,
  pushbike: 350,
  paddling: 30,
  greenhouse: 900,
  playhouse: 400,
  plantpot: 40,
  cafetable: 250,
  parasol: 150,
  moped: 2_000,
  flowers: 60,
  crates: 40,
  newsstand: 800,
  boards: 50,
  aboard: 120,
  trolley: 180,
  foodcart: 5_000,
  stall: 1_500,
  swings: 7_000,
  slide: 6_000,
  roundabout: 9_000,
  climbframe: 12_000,
  sandpit: 1_500,
  seesaw: 2_500,
  springy: 900,
  cabin: 9_000,
  portaloo: 1_200,
  skip: 1_800,
  pallet: 150,
  pipes: 600,
  digger: 70_000,
  dumper: 25_000,
  forklift: 20_000,
  container: 3_500,
  transformer: 40_000,
  battery: 60_000,
  cabinet: 4_000,
  headstone: 2_500,
  tomb: 9_000,
  goal: 1_200,
  goalsmall: 500,
  hockeygoal: 900,
  rugbypost: 3_000,
  hoop: 1_500,
  netpost: 400,
  pingpong: 2_000,
  keg: 150,
  bigbin: 900,
  gritbin: 350,
  planter: 1_200,
  block: 800,
  sentrybox: 3_000,
  // (Fly-tipped: no one's paying to have it back.)
  mattress: 0,
  sofa: 0,
  tyres: 0,
  binbags: 0,
  fridge: 0,
  washer: 0,
  carpet: 0,
  burntcar: 0,
  drum: 0,
};

/** What a loose thing smashed costs: its price; one not priced, by how tough it is (£8 a point of strength); a bit of something, nothing. */
export function loosePrice(kind: string): number {
  const price = LOOSE_PRICE[kind];
  if (price !== undefined) return price;
  const tough = BREAKUP[kind as keyof typeof BREAKUP];
  // (Pieces of what's already broken: the bill's for what they were part of.)
  if (!tough || PIECES.has(kind)) return 0;
  return Math.round((tough.strength * 8) / 10) * 10;
}

/** The debris: bits of what's been broken, already paid for. */
const PIECES = new Set(['pump', 'meter', 'clockface', 'post', 'ring', 'plastic', 'arm', 'log', 'billet', 'splinter', 'plank', 'foliage', 'twig', 'glass', 'rubble', 'brick', 'rail', 'pole', 'shortpole', 'bollard', 'postbox', 'phonebox', 'head', 'bumper', 'mirror', 'hubcap', 'lens', 'bike', 'figure']);

/** What each vehicle's worth, £: a dent costs a share of it, and it's written off at that (yours too: it's someone's). */
export const VEHICLE_PRICE: Record<VehicleKind, number> = {
  small: 9_000,
  hatch: 14_000,
  saloon: 22_000,
  estate: 20_000,
  suv: 35_000,
  van: 25_000,
  lorry: 90_000,
  bus: 220_000,
  double: 300_000,
  bike: 600,
  own: 18_000,
  police: 40_000,
  ambulance: 120_000,
  fire: 300_000,
  taxi: 25_000,
  tank: 4_000_000,
  apc: 1_500_000,
  landrover: 60_000,
};

/**
 * A vehicle's damage (all its sides', all told: see dents.ts's `taken`, how hard it's been hit, for how strongly it's built)
 * at which it's written off: about two big crashes, or a long scrape.
 */
const WRITE_OFF = 600;

/** What more damage to a vehicle costs, £ (`taken`, as dents.ts counts it): its share of the vehicle's worth. */
export function dentPrice(kind: VehicleKind, taken: number): number {
  if (taken <= 0) return 0;
  return Math.round(VEHICLE_PRICE[kind] * Math.min(1, taken / WRITE_OFF));
}

/** A bit knocked off a vehicle: a bumper, a mirror, a hubcap, a light. */
export function partPrice(part: string): number {
  if (part.startsWith('bumper')) return 450;
  if (part.startsWith('mirror')) return 180;
  if (part === 'hubcap') return 40;
  return 220;
}

/**
 * Someone knocked down (`over`: driven over, lying there), at this speed, m/s: the claim for it, £. A bump at walking pace,
 * about £2,000; at 20 mph, about £12,000; at 45 mph, about £37,000; and twice that for going over them.
 */
export function personPrice(how: 'hit' | 'over', speed: number): number {
  const claim = 1_000 + 400 * Math.max(0, speed) ** 1.5;
  return Math.round(((how === 'over' ? 2 : 1) * claim) / 50) * 50;
}

/** The most anyone's claim comes to, all told (however many times they're hit). */
export const PERSON_MOST = 250_000;

/** £1,234,567 (to the pound). */
export function pounds(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}
