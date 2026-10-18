/**
 * Vehicles going about the island: cars, trucks and tractors driving the
 * tracks between the villages (on the right, slowing for the tank and for
 * each other, turning back at the end of the road or when it's blocked), and
 * boats sailing up and down off the coast, fishing boats putting out from
 * the harbours and coming back, and forklifts busy about the harbour yards. They're things in the World like
 * any other, so they can be blown up; when one's hit, it stops and its
 * driver bails out and runs. Pure logic; TankScene draws them.
 */

import { BIOME, FIELD_TILE, type Island, type Vec2, SIZE, YARD, biomeAt, harbourPoint, townReach } from './island';
import type { ThingKind, ThingSpec } from './kinds';
import { groundSpeed } from './tank';
import { type Thing, World } from './world';

export interface Driver {
  thing: Thing;
  route: Vec2[];
  /** Distance along the route at each point. */
  at: number[];
  /** How far along it is, and which way it's going. */
  s: number;
  dir: 1 | -1;
  speed: number;
  cruise: number;
  /** Seconds left waiting (at the end of the road, or to turn round). */
  wait: number;
  /** Hit: stopped for good, driver gone. */
  stopped: boolean;
  /** Which side of the road it keeps to, px (0 for boats). */
  side: number;
}

export interface Plan {
  kind: ThingKind;
  route: Vec2[];
  s: number;
  dir: 1 | -1;
  /** Which lane: how far right of the middle of the road, px. */
  side?: number;
}

/** Which vehicles go where: a few on each track, and boats off the coast. */
export function planTraffic(island: Island, rand: () => number): Plan[] {
  const plans: Plan[] = [];
  const city = island.towns.find((t) => t.city);
  island.tracks.forEach((track, n) => {
    const length = routeLength(track);
    const kind = island.roadKinds[n];
    // (Not the little tracks out to a farm gate or a campsite just off the road.)
    if (length < 600) return;
    // The city's streets are busy: cars and buses, closer together, in both lanes of the avenues.
    if (city && (kind === 'avenue' || (kind === 'street' && Math.hypot(track[0].x - city.x, track[0].y - city.y) < townReach(city) + 10))) {
      const count = Math.max(2, Math.round(length / 260));
      for (let k = 0; k < count; k++) {
        const bus = kind === 'avenue' && rand() < 0.2;
        plans.push({ kind: bus ? 'bus' : 'car', route: track, s: ((k + rand() * 0.5) / count) * length, dir: rand() < 0.5 ? 1 : -1, side: kind === 'avenue' ? (bus || rand() < 0.5 ? 27 : 10) : 11 });
      }
      return;
    }
    const count = Math.max(1, Math.round(length / 1800));
    for (let k = 0; k < count; k++) {
      const r = rand();
      plans.push({ kind: r < 0.55 ? 'car' : r < 0.85 ? 'truck' : 'tractor', route: track, s: ((k + rand() * 0.5) / count) * length, dir: rand() < 0.5 ? 1 : -1 });
    }
  });
  // Boats: straight runs across open water, there and back.
  for (let placed = 0, tries = 0; placed < Math.round((5 * SIZE) / 6400) && tries < 6000; tries++) {
    const a = { x: rand() * SIZE, y: rand() * SIZE };
    const angle = rand() * Math.PI * 2;
    const b = { x: a.x + Math.cos(angle) * 900, y: a.y + Math.sin(angle) * 900 };
    let wet = true;
    for (let t = 0; t <= 1 && wet; t += 0.05) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // In the water, but within sight of land.
      if (biomeAt(island, x, y) !== BIOME.deep && biomeAt(island, x, y) !== BIOME.shallow) wet = false;
    }
    if (!wet || !nearLand(island, a, 500)) continue;
    plans.push({ kind: 'boat', route: [a, b], s: rand() * 900, dir: 1 });
    placed++;
  }
  // On the farms: a combine harvester working up and down the rows of the first field, and a tractor going out to the second.
  for (const farm of island.farms) {
    const [first, second] = farm.fields;
    if (first) {
      const route: Vec2[] = [];
      for (let j = 0; j < first.rows; j++) {
        const w = (j - (first.rows - 1) / 2) * FIELD_TILE;
        const ends = [-(first.cols - 1) / 2 * FIELD_TILE, ((first.cols - 1) / 2) * FIELD_TILE];
        if (j % 2) ends.reverse();
        for (const u of ends) route.push({ x: first.x + Math.cos(first.angle) * u - Math.sin(first.angle) * w, y: first.y + Math.sin(first.angle) * u + Math.cos(first.angle) * w });
      }
      plans.push({ kind: 'combine', route, s: 0, dir: 1, side: 0 });
    }
    if (second) {
      const yard = { x: farm.x + Math.cos(farm.angle) * -10 - Math.sin(farm.angle) * 30, y: farm.y + Math.sin(farm.angle) * -10 + Math.cos(farm.angle) * 30 };
      plans.push({ kind: 'tractor', route: [yard, { x: second.x, y: second.y }], s: rand() * 100, dir: 1, side: 0 });
    }
  }
  // At the harbours: forklifts going between the warehouses and the quay, and fishing boats putting out to sea and coming back in.
  for (const h of island.harbours) {
    for (const u of [-60, 60]) {
      plans.push({ kind: 'forklift', route: [harbourPoint(h, u * 0.35, YARD.depth - 40), harbourPoint(h, u * 0.35, 70)], s: rand() * 200, dir: 1 });
    }
    for (const u of [-50, 50]) {
      const route = [harbourPoint(h, u, -320), harbourPoint(h, u + (rand() - 0.5) * 300, -700), harbourPoint(h, u + (rand() - 0.5) * 900, -1300)];
      if (route.every((p) => biomeAt(island, p.x, p.y) === BIOME.deep || biomeAt(island, p.x, p.y) === BIOME.shallow)) {
        plans.push({ kind: rand() < 0.6 ? 'trawler' : 'boat', route, s: rand() * 900, dir: rand() < 0.5 ? 1 : -1 });
      }
    }
  }
  return plans;
}

function nearLand(island: Island, p: Vec2, reach: number): boolean {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const b = biomeAt(island, p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach);
    if (b !== BIOME.deep && b !== BIOME.shallow) return true;
  }
  return false;
}

/** Where each plan's vehicle starts, as things to put in the World (after the island's own). */
export function trafficSpecs(plans: Plan[]): ThingSpec[] {
  return plans.map((p, k) => {
    const pose = poseOn(p.route, cumulative(p.route), p.s, p.dir, laneOf(p));
    return { kind: p.kind, x: pose.x, y: pose.y, angle: pose.angle, variant: k * 7 };
  });
}

const CRUISE: Partial<Record<ThingKind, number>> = { boat: 60, trawler: 45, tractor: 55, truck: 95, forklift: 38, bus: 70, combine: 26 };

export function makeDriver(plan: Plan, thing: Thing): Driver {
  const cruise = CRUISE[plan.kind] ?? 120;
  const side = laneOf(plan);
  return { thing, route: plan.route, at: cumulative(plan.route), s: plan.s, dir: plan.dir, speed: cruise, cruise, wait: 0, stopped: false, side };
}

/** How far right of the middle of the way it keeps, px. */
function laneOf(plan: Plan): number {
  return plan.side ?? (afloat(plan.kind) || plan.kind === 'forklift' ? 0 : 11);
}

/** Boats (they sail, so a bridge being down doesn't stop them). */
export function afloat(kind: ThingKind): boolean {
  return kind === 'boat' || kind === 'trawler';
}

/**
 * Drives on by `dt` s. Returns true the moment it's been hit (so its driver
 * can bail out).
 */
export function stepDriver(d: Driver, dt: number, world: World, tank: Vec2, others: Driver[], island: Island): boolean {
  if (d.stopped) return false;
  const t = d.thing;
  if (t.phase !== 'intact') {
    d.stopped = true;
    d.speed = 0;
    return true;
  }
  const length = d.at[d.at.length - 1];
  if (d.wait > 0) {
    d.wait -= dt;
    return false;
  }
  // Slow down for what's ahead: the tank, another vehicle, or something across the road (turn back for that).
  const ahead = { x: t.x + Math.cos(t.angle) * 55, y: t.y + Math.sin(t.angle) * 55 };
  let want = d.cruise;
  if (Math.hypot(tank.x - ahead.x, tank.y - ahead.y) < 70) want = 0;
  for (const o of others) {
    if (o === d || o.route !== d.route) continue;
    const gap = (o.s - d.s) * d.dir;
    if (gap > 0 && gap < 70 && (o.dir === d.dir || o.stopped)) want = Math.min(want, o.stopped ? 0 : o.speed * 0.8);
  }
  // (The farm machines and forklifts work their own fields and yards, turning at the ends of the rows: what's past the edge doesn't turn them back.)
  const working = t.kind === 'combine' || t.kind === 'forklift' || (t.kind === 'tractor' && d.side === 0);
  // A bridge down ahead: turn round.
  if (!afloat(t.kind) && !working && groundSpeed(island, ahead.x, ahead.y, world) === 0) {
    d.dir = d.dir === 1 ? -1 : 1;
    d.wait = 2;
    d.speed = 0;
    return false;
  }
  for (const o of working ? [] : world.near(ahead.x, ahead.y, 40)) {
    if (o !== t && World.blocks(o) && Math.hypot(o.x - ahead.x, o.y - ahead.y) < o.def.r + 18 && !others.some((x) => x.thing === o && !x.stopped)) {
      // The way's blocked (a wreck, rubble...): turn round.
      d.dir = d.dir === 1 ? -1 : 1;
      d.wait = 1.5;
      want = 0;
      d.speed = 0;
      break;
    }
  }
  d.speed += Math.max(-200 * dt, Math.min(60 * dt, want - d.speed));
  d.s += d.speed * dt * d.dir;
  if (d.s <= 0 || d.s >= length) {
    // The end of the road: wait a little, then head back.
    d.s = Math.max(0, Math.min(length, d.s));
    d.dir = d.dir === 1 ? -1 : 1;
    d.wait = 2 + Math.random() * 4;
  }
  const pose = poseOn(d.route, d.at, d.s, d.dir, d.side);
  world.move(t, pose.x, pose.y);
  t.angle = pose.angle;
  return false;
}

function cumulative(route: Vec2[]): number[] {
  const at = [0];
  for (let k = 1; k < route.length; k++) at.push(at[k - 1] + Math.hypot(route[k].x - route[k - 1].x, route[k].y - route[k - 1].y));
  return at;
}

function routeLength(route: Vec2[]): number {
  const at = cumulative(route);
  return at[at.length - 1];
}

/** A point `s` along a route, `side` px to the right of the way it's going, and which way that is. */
export function poseOn(route: Vec2[], at: number[], s: number, dir: 1 | -1, side: number): { x: number; y: number; angle: number } {
  let k = 0;
  while (k < at.length - 2 && at[k + 1] < s) k++;
  const a = route[k];
  const b = route[k + 1];
  const span = at[k + 1] - at[k] || 1;
  const f = Math.max(0, Math.min(1, (s - at[k]) / span));
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + (dir === 1 ? 0 : Math.PI);
  return {
    x: a.x + (b.x - a.x) * f - Math.sin(angle) * side,
    y: a.y + (b.y - a.y) * f + Math.cos(angle) * side,
    angle,
  };
}
