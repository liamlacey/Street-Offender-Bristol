/**
 * Planning the race circuit things around a track: gravel traps on the
 * outside of corners, grandstands, spectator banks, marshals at corners,
 * advertising boards, the pits, spare tyres and the start gantry, and the
 * rest of race day around it: the paddock, big screens, food stalls, car
 * parks and campsites, and fans walking about. The scenery planner
 * (track/decoration.ts) calls this when a location has a `circuit` style.
 */

import { TYRE_RADIUS } from '../track/barriers';
import type { Placer, Prop, PropKind } from '../track/decoration';
import { type Track, type TrackPosition, type Vec2, locateOnTrack } from '../track/Track';
import { CARPARK, CIRCUIT_PROP_SIZE, type CircuitStyle } from './style';

/**
 * Gravel either side of the track: at sample i, the gravel runs from
 * inner[i] to outer[i] px from the centre line on that side (0 = none).
 */
export interface GravelBands {
  right: { inner: number[]; outer: number[] };
  left: { inner: number[]; outer: number[] };
}

/** The gantry over the start/finish line: centre, the track's heading there, and its two posts. */
export interface Gantry {
  x: number;
  y: number;
  heading: number;
  span: number;
  posts: Vec2[];
}

/** How thick a gantry's posts are (they're solid), px. */
export const GANTRY_POST_RADIUS = 9;

/** What a race circuit adds to a track's scenery that isn't a prop. */
export interface CircuitPlan {
  gravel: GravelBands;
  gantry: Gantry;
}

/** Gaps (px) between circuit things and what's around them. */
const GAP = {
  /** Behind the barrier, for things that line it (boards, stands, marshals). */
  barrier: 6,
  /** Grass left between a gravel trap and the kerb, and the barrier. */
  gravelKerb: 14,
  gravelBarrier: 16,
};

const STRAIGHT_RADIUS = 1400;

/**
 * Places a race circuit's things with the scenery planner's placer, and
 * returns its gravel traps and start gantry.
 */
export function planCircuit(kit: Placer, style: CircuitStyle): CircuitPlan {
  const start = gantry(kit);
  // A gantry or banner over the start stands on posts; a line painted across doesn't.
  if (style.start !== 'line') kit.solids.push(...start.posts.map((post) => ({ ...post, r: GANTRY_POST_RADIUS })));
  const gravel = style.gravel !== null ? gravelTraps(kit) : emptyBands(kit.n);
  const pitsAt = style.pits ? pits(kit) : null;
  if (style.standsPer10k > 0) grandstands(kit, style);
  if (style.cornerCrowds) cornerCrowdsAndMarshals(kit);
  if (style.banksPer10k > 0) spectatorBanks(kit, style);
  if (style.boards) boards(kit);
  if (style.tyreStacks) tyreStacks(kit);
  if (style.venue) {
    if (pitsAt) paddock(kit, pitsAt);
    screens(kit);
    walkways(kit);
    milling(kit);
    stalls(kit);
    carParks(kit);
    campsites(kit);
  }
  return { gravel, gantry: start };
}

/** Whether a located point is in a gravel trap. */
export function onGravel(track: Track, gravel: GravelBands, pos: TrackPosition, x: number, y: number): boolean {
  const n = track.points.length;
  const f = pos.along / track.spacing;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const t = f - Math.floor(f);
  const nrm = track.normals[i];
  const band = (x - pos.x) * nrm.x + (y - pos.y) * nrm.y >= 0 ? gravel.right : gravel.left;
  const [inner, outer] = gravelAcross(band, i, j, t);
  return outer > 0 && pos.distance >= inner && pos.distance <= outer;
}

/**
 * Inner and outer edges of the gravel a fraction t of the way from sample i
 * to j (outer 0 = none). At the ends of a trap, where only one of the two
 * samples has gravel, the edges carry straight on from that one.
 */
export function gravelAcross(band: GravelBands['right'], i: number, j: number, t: number): [number, number] {
  const at = (a: number[]) => {
    const from = a[i] || a[j];
    const to = a[j] || a[i];
    return from + (to - from) * t;
  };
  return [at(band.inner), at(band.outer)];
}

function gantry(kit: Placer): Gantry {
  const { track } = kit;
  const p = track.points[0];
  const nrm = track.normals[0];
  const reach = track.halfWidths[0] + track.kerbWidth + 34;
  return {
    x: p.x,
    y: p.y,
    heading: Math.atan2(-nrm.x, nrm.y),
    span: reach * 2,
    posts: [1, -1].map((side) => ({ x: p.x + nrm.x * reach * side, y: p.y + nrm.y * reach * side })),
  };
}


/** Gravel in the run-off on the outside of each proper corner, longer after the apex where cars run wide. */
function gravelTraps(kit: Placer): GravelBands {
  const { track, n } = kit;
  const bands = emptyBands(n);
  const before = 5;
  const after = 11;
  for (const apex of kit.apexes(700, 20)) {
    const side = -kit.turn[apex] as 1 | -1;
    const band = side === 1 ? bands.right : bands.left;
    // Keep the start/finish straight clear (the gantry posts are there).
    if (circular(apex, 0, n) < after + 6) continue;
    for (let k = -before; k <= after; k++) {
      const i = (apex + k + n) % n;
      const halfOuter = track.halfWidths[i] + track.kerbWidth;
      const inner = halfOuter + GAP.gravelKerb;
      const u = (k + before + 1) / (before + after + 2);
      const deepest = halfOuter + kit.runOff - GAP.gravelBarrier;
      const want = inner + (deepest - inner) * Math.sin(Math.PI * u) ** 0.6;
      // Stop short of any other bit of track, or a barrier that's been pulled in.
      let outer = inner;
      const p = track.points[i];
      const nx = track.normals[i].x * side;
      const ny = track.normals[i].y * side;
      for (let t = inner; t <= want; t += 6) {
        const x = p.x + nx * t;
        const y = p.y + ny * t;
        const other = locateOnTrack(track, x, y);
        if (other.distance - other.halfWidth < t - track.halfWidths[i] - 1) break;
        if (kit.nearBarrier(x, y, TYRE_RADIUS + GAP.gravelBarrier)) break;
        outer = t;
      }
      if (outer - inner >= 20 && outer > band.outer[i]) {
        band.inner[i] = inner;
        band.outer[i] = outer;
      }
    }
  }
  return bands;
}


/** The pit garages behind the grid, with team trucks parked behind them. Returns where they are. */
function pits(kit: Placer): { at: number; side: 1 | -1 } | null {
  const { w, h } = CIRCUIT_PROP_SIZE.pits;
  const behind = Math.round((w / 2 + 160) / kit.track.spacing);
  for (const shift of [0, 6, -6, 12]) {
    for (const side of kit.sides()) {
      const at = (kit.n - behind + shift) % kit.n;
      const pits = kit.facing('pits', at, side, w, h, GAP.barrier + 10, 0);
      if (!pits) continue;
      for (let k = -2; k <= 2; k++) {
        const t = kit.facing('truck', (at + k * 3 + kit.n) % kit.n, side, 88, 26, GAP.barrier + 10 + h + 24, kit.int(5));
        if (t) t.angle += Math.PI; // parked nose to the garages
      }
      return { at, side };
    }
  }
  return null;
}


/** Grandstands on the straights, the main one opposite the pits on the start line. */
function grandstands(kit: Placer, style: CircuitStyle): void {
  const { n, track } = kit;
  const { w, h } = CIRCUIT_PROP_SIZE.grandstand;
  const target = Math.max(2, Math.round((style.standsPer10k * track.length) / 10_000));
  const halfLength = Math.ceil(w / 2 / track.spacing);
  const straight = (i: number) => {
    for (let k = -halfLength; k <= halfLength; k++) if (kit.radii[(i + k + n) % n] < STRAIGHT_RADIUS) return false;
    return true;
  };
  let placed = 0;
  const tryAt = (i: number, side: 1 | -1): boolean => {
    const stand = kit.facing('grandstand', i, side, w, h, GAP.barrier, kit.int(4), [0, 20, 40]);
    if (!stand) return false;
    placed++;
    // Flags at either end.
    for (const end of [-1, 1]) {
      const c = Math.cos(stand.angle);
      const s = Math.sin(stand.angle);
      const along = end * (w / 2 + 14);
      const flag = kit.prop('flag', stand.x + c * along + s * (h / 2 - 8), stand.y + s * along - c * (h / 2 - 8), stand.angle, 10, 10, kit.int(4));
      kit.add(flag, GAP.barrier, 2);
    }
    return true;
  };

  // The main stand, across from the pits if there's room.
  for (const i of [0, 4, n - 4, 8, n - 8]) {
    if (kit.sides().some((side) => tryAt(i, side))) break;
  }
  const candidates: number[] = [];
  for (let i = 0; i < n; i += 4) if (straight(i)) candidates.push(i);
  shuffle(candidates, kit.rng);
  for (const i of candidates) {
    if (placed >= target) break;
    for (const side of kit.sides()) {
      if (!tryAt(i, side)) continue;
      // Sometimes a second stand alongside.
      const step = Math.round((w + 20) / track.spacing);
      if (kit.rng() < 0.5 && placed < target && straight((i + step) % n)) tryAt((i + step) % n, side);
      break;
    }
  }
}


/** Spectators behind the fence and a marshal post at the outside of corners. */
function cornerCrowdsAndMarshals(kit: Placer): void {
  const { n } = kit;
  const apexes = kit.apexes(1000, 14);
  let crowds = Math.max(2, Math.round(kit.track.length / 5000));
  for (const apex of apexes) {
    const outside = -kit.turn[apex] as 1 | -1;
    const post = (apex - 9 + n) % n;
    kit.facing('marshal', post, outside, 26, 26, GAP.barrier + 4, kit.int(2), [0, 20]);
    if (crowds > 0 && kit.rng() < 0.7) {
      const { w, h } = CIRCUIT_PROP_SIZE.crowd;
      if (kit.facing('crowd', (apex + 2) % n, outside, w, h, GAP.barrier + 2, kit.int(4), [0, 16, 32])) crowds--;
    }
  }
}


/** Advertising boards lining the barriers on straighter bits. */
function boards(kit: Placer): void {
  const { w, h } = CIRCUIT_PROP_SIZE.board;
  const step = Math.round(300 / kit.track.spacing);
  for (let i = kit.int(step); i < kit.n; i += step) {
    if (kit.radii[i] < 500 || kit.rng() < 0.35) continue;
    kit.facing('board', i, kit.sides()[0], w, h, GAP.barrier - 2, kit.int(6));
  }
}


/** Spare tyres stacked up here and there behind the barriers. */
function tyreStacks(kit: Placer): void {
  const count = Math.round(kit.track.length / 1500);
  for (let k = 0; k < count; k++) {
    const i = kit.int(kit.n);
    kit.facing('tyres', i, kit.sides()[0], 40, 40, GAP.barrier + kit.int(80), kit.int(3));
  }
}


// --- Race day around the track ---------------------------------------------

/** A point `gap` px past the barrier zone at sample i, on one side. */
function beside(kit: Placer, i: number, side: 1 | -1, gap: number): Vec2 {
  const { track } = kit;
  const p = track.points[i];
  const nrm = track.normals[i];
  const out = track.halfWidths[i] + track.kerbWidth + kit.beyond + gap;
  return { x: p.x + nrm.x * side * out, y: p.y + nrm.y * side * out };
}

/** A point on a prop, `u` px along it and `v` px back from its centre. */
function local(prop: Prop, u: number, v: number): Vec2 {
  const c = Math.cos(prop.angle);
  const s = Math.sin(prop.angle);
  return { x: prop.x + c * u - s * v, y: prop.y + s * u + c * v };
}

/** A random spot in the world, at least `clear` px past the barrier zone, and the track's heading nearest it. */
function spot(kit: Placer, clear: number): { x: number; y: number; heading: number } | null {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const x = minX + kit.rng() * (maxX - minX);
  const y = minY + kit.rng() * (maxY - minY);
  const pos = locateOnTrack(kit.track, x, y);
  if (pos.distance - pos.halfWidth - kit.track.kerbWidth < kit.beyond + clear) return null;
  return { x, y, heading: pos.heading };
}

function worldArea(kit: Placer): number {
  const { minX, minY, maxX, maxY } = kit.bounds;
  return (maxX - minX) * (maxY - minY);
}

/** Spectators lining the fences along the straighter bits, a few banks running on together, with more fans milling about behind. */
function spectatorBanks(kit: Placer, style: CircuitStyle): void {
  const { n } = kit;
  const { w, h } = CIRCUIT_PROP_SIZE.crowd;
  const target = Math.round((style.banksPer10k * kit.track.length) / 10_000);
  const step = Math.ceil((w + 14) / kit.track.spacing);
  const starts: number[] = [];
  for (let i = kit.int(step); i < n; i += step) starts.push(i);
  shuffle(starts, kit.rng);
  let placed = 0;
  for (const start of starts) {
    if (placed >= target) break;
    for (const side of kit.sides()) {
      let i = start;
      let run = 0;
      while (run < 4 && kit.radii[i] > 350 && kit.facing('crowd', i, side, w, h, GAP.barrier + 2, kit.int(4), [0, 14])) {
        placed++;
        run++;
        if (kit.rng() < 0.6) kit.facing('fans', (i + kit.int(step)) % n, side, 36, 36, GAP.barrier + h + 24 + kit.int(70), kit.int(8));
        if (kit.rng() < 0.35) break;
        i = (i + step) % n;
      }
      if (run > 0) break;
    }
  }
}

/** Behind the pits: the teams' motorhomes, hospitality marquees and transporters, with people walking between. */
function paddock(kit: Placer, { at, side }: { at: number; side: 1 | -1 }): void {
  const { n, track } = kit;
  const along = (px: number) => Math.round(px / track.spacing);
  const row = (kind: PropKind, w: number, h: number, gap: number, apart: number, count: number, variants: number) => {
    for (let k = -count; k <= count; k++) kit.facing(kind, (at + along(k * apart) + n) % n, side, w, h, gap, kit.int(variants));
  };
  // Pits and their trucks reach about 140 px back.
  row('camper', 78, 34, 160, 96, 3, 3);
  row('marquee', 96, 64, 222, 116, 2, 2);
  row('truck', 88, 26, 306, 100, 3, 5);
  for (const v of [204, 293]) {
    const reach = along(260);
    const from = beside(kit, (at - reach + n) % n, side, v);
    const to = beside(kit, (at + reach) % n, side, v);
    kit.movers.push({ kind: 'fan', from, to });
  }
}

/** Big screens facing the track, for the crowds across from them. */
function screens(kit: Placer): void {
  const { w, h } = CIRCUIT_PROP_SIZE.screen;
  const count = Math.max(2, Math.round(kit.track.length / 7000));
  for (let placed = 0, tries = 0; placed < count && tries < count * 10; tries++) {
    const i = kit.int(kit.n);
    if (kit.radii[i] < 900) continue;
    if (kit.facing('screen', i, kit.sides()[0], w, h, 40 + kit.int(60), kit.int(4))) placed++;
  }
}

/** Paths behind the spectator banks with fans strolling along them. */
function walkways(kit: Placer): void {
  const { n, track } = kit;
  const count = Math.round((3 * track.length) / 10_000);
  const length = 320;
  const half = Math.ceil(length / 2 / track.spacing);
  for (let placed = 0, tries = 0; placed < count && tries < count * 10; tries++) {
    const i = kit.int(n);
    let straight = true;
    for (let k = -half; k <= half; k++) if (kit.radii[(i + k + n) % n] < 1200) straight = false;
    if (!straight) continue;
    const side = kit.sides()[0];
    const at = beside(kit, i, side, 70 + kit.int(60));
    const nrm = track.normals[i];
    const angle = Math.atan2(-nrm.x, nrm.y);
    if (!kit.add(kit.prop('path', at.x, at.y, angle, length, 16, 0), kit.beyond + 20, 4)) continue;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    kit.movers.push({ kind: 'fan', from: { x: at.x - (c * length) / 2, y: at.y - (s * length) / 2 }, to: { x: at.x + (c * length) / 2, y: at.y + (s * length) / 2 } });
    placed++;
  }
}

/** Groups of fans stood about behind the fences. */
function milling(kit: Placer): void {
  const count = Math.round((14 * kit.track.length) / 10_000);
  for (let k = 0; k < count * 2; k++) {
    kit.facing('fans', kit.int(kit.n), kit.sides()[0], 36, 36, 16 + kit.int(240), kit.int(8));
  }
}

/** Food and merchandise stalls back from the fences, each with its queue. */
function stalls(kit: Placer): void {
  const { w, h } = CIRCUIT_PROP_SIZE.stall;
  const count = Math.round((4 * kit.track.length) / 10_000);
  for (let placed = 0, tries = 0; placed < count && tries < count * 8; tries++) {
    if (kit.facing('stall', kit.int(kit.n), kit.sides()[0], w, h, 60 + kit.int(220), kit.int(4))) placed++;
  }
}

/** Fields full of parked cars, in rows either side of aisles that fans walk down. */
function carParks(kit: Placer): void {
  const tries = Math.min(500, Math.round(worldArea(kit) / 45_000));
  for (let k = 0; k < tries; k++) {
    const at = spot(kit, 90);
    if (!at) continue;
    const cols = 6 + kit.int(12);
    const pairs = 1 + kit.int(3);
    const w = cols * CARPARK.bay;
    const h = pairs * 2 * CARPARK.row + (pairs + 1) * CARPARK.aisle;
    const lot = kit.prop('carpark', at.x, at.y, at.heading + (kit.rng() < 0.5 ? 0 : Math.PI / 2), w, h, kit.int(10_000));
    if (!kit.add(lot, kit.beyond + 90, 16)) continue;
    for (let a = 0; a <= pairs; a++) {
      if (kit.rng() < 0.45) continue;
      const v = -h / 2 + CARPARK.aisle / 2 + a * (2 * CARPARK.row + CARPARK.aisle);
      kit.movers.push({ kind: 'fan', from: local(lot, -w / 2 + 6, v), to: local(lot, w / 2 - 6, v) });
    }
  }
}

/** What a campsite has in it, and how many looks each comes in. */
const CAMP: { kind: PropKind; w: number; h: number; variants: number; weight: number }[] = [
  { kind: 'tent', w: 44, h: 44, variants: 3, weight: 5 },
  { kind: 'camper', w: 78, h: 34, variants: 3, weight: 3 },
  { kind: 'gazebo', w: 40, h: 40, variants: 3, weight: 2 },
  { kind: 'fans', w: 36, h: 36, variants: 8, weight: 2.5 },
  { kind: 'flag', w: 10, h: 10, variants: 4, weight: 1.5 },
];

/** Campsites of fans staying for the weekend: tents, camper vans and gazebos, with flags flying. */
function campsites(kit: Placer): void {
  const count = Math.max(2, Math.round(worldArea(kit) / 1_500_000));
  const total = CAMP.reduce((sum, c) => sum + c.weight, 0);
  for (let placed = 0, tries = 0; placed < count && tries < count * 8; tries++) {
    const at = spot(kit, 220);
    if (!at) continue;
    const items = 10 + kit.int(14);
    let got = 0;
    for (let k = 0; k < items * 3 && got < items; k++) {
      let pick = kit.rng() * total;
      const item = CAMP.find((c) => (pick -= c.weight) < 0) ?? CAMP[0];
      const a = kit.rng() * Math.PI * 2;
      const r = 20 + Math.sqrt(kit.rng()) * 210;
      const angle = item.kind === 'tent' || item.kind === 'gazebo' ? kit.rng() * Math.PI * 2 : at.heading + kit.int(4) * (Math.PI / 2);
      const prop = kit.prop(item.kind, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, angle, item.w, item.h, kit.int(item.variants));
      if (kit.add(prop, kit.beyond + 100, 8)) got++;
    }
    if (got >= 4) placed++;
  }
}


function emptyBands(n: number): GravelBands {
  const side = () => ({ inner: new Array<number>(n).fill(0), outer: new Array<number>(n).fill(0) });
  return { right: side(), left: side() };
}


function shuffle<T>(list: T[], rng: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}


/** Samples apart around a loop of n. */
function circular(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}
