/**
 * The trains: each a unit of a few carriages running one of the train
 * services (OSM's `route=train`, see TrainRoute) along its tracks, as far as
 * they're in the region: up to the line's speed, braking for its stops (at
 * the stations, where it waits with its doors open while people get on and
 * off: see people.ts), for the train ahead, and for anything on the line
 * (you, a car at a level crossing, someone on the track), sounding its horn;
 * up onto the bridges and down into the tunnels with the track. They look
 * as each company's do: GWR's green (a Class 800 to London, Class 158s on
 * the longer routes, Class 166s on the locals), CrossCountry's Voyagers.
 * Knocked hard, a carriage is damaged, and wrecked, the train stops for
 * good. Pure, so it's tested; TrainLayer.ts draws them.
 */

import type { GameMap, Pts, Road, TrainRoute } from '../map/osm';
import { type Work, drain } from './work.ts';

const M = 8;

/** The kinds of unit: a GWR Class 800 (IET), Class 158 Express Sprinter, Class 166 Turbo; a CrossCountry Class 220 Voyager. */
export type UnitKind = 'iet' | 'sprinter' | 'turbo' | 'voyager';

/** Each kind: its carriages' length and width, px; how many; its top speed here, px/s; how heavy each carriage is (your car's 1). */
export const UNITS: Record<UnitKind, { length: number; width: number; cars: number; top: number; mass: number }> = {
  iet: { length: 26 * M, width: 2.7 * M, cars: 5, top: 26 * M, mass: 45 },
  sprinter: { length: 22.6 * M, width: 2.7 * M, cars: 2, top: 22 * M, mass: 38 },
  turbo: { length: 23 * M, width: 2.8 * M, cars: 3, top: 22 * M, mass: 40 },
  voyager: { length: 23 * M, width: 2.7 * M, cars: 4, top: 26 * M, mass: 45 },
};

/** Which unit runs a service: CrossCountry's Voyagers; GWR's Class 800s to and from London, 158s on the longer routes, 166 Turbos on the locals. */
export function unitFor(route: Pick<TrainRoute, 'name' | 'operator'>): UnitKind {
  if (/crosscountry|cross country/i.test(`${route.operator ?? ''} ${route.name}`)) return 'voyager';
  if (/paddington|london/i.test(route.name)) return 'iet';
  if (/portsmouth|weymouth|worcester|gloucester|cardiff|exeter/i.test(route.name)) return 'sprinter';
  return 'turbo';
}

/** The gap between carriages, px; how hard a train speeds up and brakes (and in an emergency), px/s². */
const GAP = 0.8 * M;
const ACCEL = 0.6 * M;
const BRAKE = 0.9 * M;
const EMERGENCY = 1.6 * M;
/** At a stop: how long it waits, s. A stop's this near its track to be on it, px. */
const DWELL: [number, number] = [22, 40];
const STOP_REACH = 30 * M;
/** At most this many trains in a region; one sets off on each service about this often, s (with you near). */
const MOST = 6;
const EVERY: [number, number] = [180, 360];
/** Looking this far past its braking distance for what's on the line, px. */
const LOOK = 40 * M;

/** A carriage: where its middle is, which way it points, its level (a bridge's deck, a tunnel), how damaged (0 to 1). */
export interface Carriage {
  id: number;
  x: number;
  y: number;
  angle: number;
  level: number;
  /** Its velocity (along the track), px/s; for the collisions. */
  vx: number;
  vy: number;
  r: number;
  length: number;
  invMass: number;
  spin: number;
  damage: number;
  /** Where it's been hit (along it, across it, px from its middle), for its marks. */
  hits: [number, number][];
  /** Which in the unit it is (0 the front), and whether it has a cab (the ends). */
  index: number;
  cab: 'front' | 'back' | null;
  train: Train;
}

/** A run of a service's track through the region: its line, how far along it each piece of track starts, its levels, its stops. */
interface Run {
  route: number;
  pts: Pts;
  /** How far along each point is, px. */
  at: number[];
  length: number;
  /** The levels along it: [from, to, level], px. */
  levels: [number, number, number][];
  /** Its stops, how far along. */
  stops: number[];
}

export interface Train {
  id: number;
  kind: UnitKind;
  route: number;
  run: Run;
  /** How far along its run its front is, and how fast it's going, px/s. */
  s: number;
  speed: number;
  /** Waiting at a stop: seconds left (0 not); the next stop (an index into its run's). */
  dwell: number;
  next: number;
  /** Just pulled in (its doors opening: people get off); stopped for good (wrecked); braking hard for something on the line (its horn). */
  fresh: boolean;
  dead: boolean;
  alarmed: boolean;
  cars: Carriage[];
}

/** Something on the line, as the trains see it: where, how big (its radius), on which level. */
export interface Obstacle {
  x: number;
  y: number;
  r: number;
  level: number;
}

export class Trains {
  readonly trains: Train[] = [];
  private runs: Run[] = [];
  private nextId: number;
  private readonly rand: () => number;
  /** Seconds till each service next sets off. */
  private readonly due = new Map<number, number>();
  /** Horns sounded since the scene last looked (where). */
  readonly horns: [number, number][] = [];

  constructor(
    private readonly map: GameMap,
    options: { rand?: () => number; firstId?: number } = {},
    later = false,
  ) {
    this.rand = options.rand ?? Math.random;
    this.nextId = options.firstId ?? 1;
    if (!later) drain(this.setup());
  }

  /** Works out each service's runs through the region (a little at a time). */
  *setup(): Work {
    const { roads } = this.map;
    (this.map.trainRoutes ?? []).forEach((route, ri) => {
      // (Not a line with no stops: a goods line's, or a heritage railway's.)
      if (!route.stops.length) return;
      let legs: number[] = [];
      const flush = () => {
        if (legs.length) this.addRun(ri, route, legs, roads);
        legs = [];
      };
      for (const leg of route.legs) {
        if (leg < 0 || !roads[leg >> 1] || roads[leg >> 1].kind !== 'rail') flush();
        else legs.push(leg);
      }
      flush();
    });
    yield;
    for (const [i] of (this.map.trainRoutes ?? []).entries()) this.due.set(i, this.rand() * EVERY[0]);
  }

  /** A run of track from its legs, joined end to end (each piece the way the service goes along it); and its stops along it. */
  private addRun(ri: number, route: TrainRoute, legs: number[], roads: Road[]): void {
    const pts: Pts = [];
    const levels: [number, number, number][] = [];
    let run = 0;
    for (const leg of legs) {
      const road = roads[leg >> 1];
      const p = road.pts;
      const way: number[] = [];
      if (leg & 1) for (let k = p.length - 2; k >= 0; k -= 2) way.push(p[k], p[k + 1]);
      else way.push(...p);
      // (Joined on: the first point's where the last left off.)
      const from = run;
      for (let k = pts.length ? 2 : 0; k < way.length; k += 2) {
        if (pts.length) run += Math.hypot(way[k] - pts[pts.length - 2], way[k + 1] - pts[pts.length - 1]);
        pts.push(way[k], way[k + 1]);
      }
      levels.push([from, run, road.tunnel ? 2 : road.bridge ? 1 : 0]);
    }
    if (pts.length < 4 || run < 150 * M) return;
    const at = [0];
    for (let k = 2; k < pts.length; k += 2) at.push(at[at.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
    const r: Run = { route: ri, pts, at, length: at[at.length - 1], levels, stops: [] };
    for (let k = 0; k + 1 < route.stops.length; k += 2) {
      const { along, distance } = this.nearest(r, route.stops[k], route.stops[k + 1]);
      if (distance < STOP_REACH && along > 20 * M && !r.stops.some((s) => Math.abs(s - along) < 50 * M)) r.stops.push(along);
    }
    r.stops.sort((a, b) => a - b);
    this.runs.push(r);
  }

  /** The point `s` along a run: x, y, and which way it's going. */
  at(r: Run, s: number): [number, number, number] {
    const a = r.at;
    const d = Math.max(0, Math.min(r.length, s));
    let lo = 0;
    let hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = a[hi] - a[lo] || 1;
    const t = (d - a[lo]) / seg;
    const [ax, ay, bx, by] = [r.pts[lo * 2], r.pts[lo * 2 + 1], r.pts[hi * 2], r.pts[hi * 2 + 1]];
    return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
  }

  /** Which level a run's on, `s` along it. */
  private levelOf(r: Run, s: number): number {
    for (const [from, to, level] of r.levels) if (s >= from && s <= to) return level;
    return 0;
  }

  /** How far along a run the point nearest (x, y) is, and how far off it. */
  private nearest(r: Run, x: number, y: number): { along: number; distance: number } {
    let best = { along: 0, distance: Infinity };
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const [ax, ay, bx, by] = [r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
      const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
      if (d < best.distance) best = { along: r.at[k / 2] + t * Math.sqrt(len2), distance: d };
    }
    return best;
  }

  /** How long a train of this kind is, px. */
  private lengthOf(kind: UnitKind): number {
    const u = UNITS[kind];
    return u.cars * u.length + (u.cars - 1) * GAP;
  }

  /** A train on a run, its front `s` along it, going at `speed`. */
  private make(run: Run, s: number, speed: number): Train {
    const kind = unitFor(this.map.trainRoutes![run.route]);
    const u = UNITS[kind];
    const train: Train = { id: this.nextId++, kind, route: run.route, run, s, speed, dwell: 0, next: run.stops.findIndex((a) => a > s - 5 * M), fresh: false, dead: false, alarmed: false, cars: [] };
    if (train.next < 0) train.next = run.stops.length;
    for (let i = 0; i < u.cars; i++) {
      train.cars.push({ id: this.nextId++, x: 0, y: 0, angle: 0, level: 0, vx: 0, vy: 0, r: u.width / 2, length: u.length, invMass: 1 / u.mass, spin: 0, damage: 0, hits: [], index: i, cab: i === 0 ? 'front' : i === u.cars - 1 ? 'back' : null, train });
    }
    this.place(train);
    this.trains.push(train);
    return train;
  }

  /** Its carriages where they are, behind its front. */
  private place(t: Train): void {
    const u = UNITS[t.kind];
    for (const c of t.cars) {
      const mid = t.s - c.index * (u.length + GAP) - u.length / 2;
      // Lying between its bogies' points (a little in from each end), so it cuts the corner on a curve, as a carriage does.
      const [fx, fy] = this.at(t.run, mid + u.length * 0.35);
      const [bx, by] = this.at(t.run, mid - u.length * 0.35);
      c.x = (fx + bx) / 2;
      c.y = (fy + by) / 2;
      c.angle = Math.atan2(fy - by, fx - bx);
      c.level = this.levelOf(t.run, mid);
      c.vx = Math.cos(c.angle) * t.speed;
      c.vy = Math.sin(c.angle) * t.speed;
    }
  }

  /** Every carriage. */
  carriages(): Carriage[] {
    return this.trains.flatMap((t) => t.cars);
  }

  /**
   * Trains setting off on their services near the view (out of sight), now
   * and then; those gone off the end of their run, or far from the view,
   * gone. `all`: coming into a region, a few out on the line already.
   */
  populate(view: { x0: number; y0: number; x1: number; y1: number }, dt: number, all = false): void {
    const far = 600 * M;
    const near = (x: number, y: number) => x > view.x0 - far && x < view.x1 + far && y > view.y0 - far && y < view.y1 + far;
    const seen = (x: number, y: number) => x > view.x0 - 20 * M && x < view.x1 + 20 * M && y > view.y0 - 20 * M && y < view.y1 + 20 * M;
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const t = this.trains[i];
      const back = this.at(t.run, t.s - this.lengthOf(t.kind));
      const gone = t.s - this.lengthOf(t.kind) > t.run.length || (!near(back[0], back[1]) && !near(...(this.at(t.run, t.s).slice(0, 2) as [number, number])));
      if (gone && !t.cars.some((c) => seen(c.x, c.y))) this.trains.splice(i, 1);
    }
    for (const run of this.runs) {
      const due = (this.due.get(run.route) ?? 0) - dt;
      this.due.set(run.route, due);
      if ((!all && due > 0) || this.trains.length >= MOST) continue;
      // Somewhere along it near the view (but out of sight), clear of any train on it: at its start, if that's near.
      const length = this.lengthOf(unitFor(this.map.trainRoutes![run.route]));
      const tries = [length + 1, ...Array.from({ length: 4 }, () => length + this.rand() * (run.length - length))];
      let made = false;
      for (const s of tries) {
        if (s < length || s > run.length) continue;
        const [x, y] = this.at(run, s);
        const [bx, by] = this.at(run, s - length);
        if (!near(x, y) || seen(x, y) || seen(bx, by)) continue;
        if (this.carriages().some((c) => Math.hypot(c.x - x, c.y - y) < 150 * M || Math.hypot(c.x - bx, c.y - by) < 150 * M)) continue;
        // (Under way, out on the line; from its start, setting off.)
        const top = UNITS[unitFor(this.map.trainRoutes![run.route])].top;
        this.make(run, s, s > length + 1 ? top * 0.7 : 12 * M);
        made = true;
        break;
      }
      // The next on this service a while after; none could start (none near), soon look again.
      this.due.set(run.route, made ? EVERY[0] + this.rand() * (EVERY[1] - EVERY[0]) : 3 + this.rand() * 4);
    }
  }

  /**
   * Each train along its run: up to speed, braking for its next stop (and
   * waiting there), for the train ahead and for whatever's on the line ahead
   * (`obstacles`: you, the traffic, people), sounding its horn for that.
   */
  update(dt: number, view: { x0: number; y0: number; x1: number; y1: number }, obstacles: Obstacle[]): void {
    this.populate(view, dt);
    this.horns.length = 0;
    const cars = this.carriages();
    for (const t of this.trains) {
      t.fresh = false;
      if (t.dead) {
        t.speed = Math.max(0, t.speed - EMERGENCY * 1.5 * dt);
      } else if (t.dwell > 0) {
        t.dwell -= dt;
        t.speed = 0;
        if (t.dwell <= 0) t.next++;
      } else {
        const u = UNITS[t.kind];
        // How far it can go: to its next stop, the train ahead, anything on the line.
        let room = Infinity;
        const stop = t.run.stops[t.next];
        if (stop !== undefined) room = stop - t.s;
        const brakeDist = (t.speed * t.speed) / (2 * BRAKE);
        const look = brakeDist + LOOK;
        let blocked = Infinity;
        // (The line ahead, every 3 m; and only what's anywhere near it looked at.)
        const ahead: [number, number, number, number][] = [];
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let d = 4 * M; d < look && t.s + d <= t.run.length; d += 3 * M) {
          const [x, y] = this.at(t.run, t.s + d);
          ahead.push([d, x, y, this.levelOf(t.run, t.s + d)]);
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        }
        const pad = 15 * M;
        const box = (x: number, y: number) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad;
        const others = cars.filter((c) => c.train !== t && box(c.x, c.y));
        const things = obstacles.filter((o) => box(o.x, o.y));
        const half = u.width / 2;
        for (const [d, x, y, level] of ahead) {
          if (others.some((c) => c.level === level && carriageDist(c, x, y) < c.r + half * 0.8) || things.some((o) => o.level === level && Math.hypot(o.x - x, o.y - y) < o.r + half * 0.8)) {
            blocked = d - 6 * M;
            break;
          }
        }
        room = Math.min(room, blocked);
        // Something on the line, close: its horn, and the brakes on hard.
        const hard = blocked < brakeDist + 10 * M && t.speed > 2 * M;
        if (hard && !t.alarmed) this.horns.push(this.at(t.run, t.s).slice(0, 2) as [number, number]);
        t.alarmed = hard;
        const target = Math.min(u.top, Math.sqrt(Math.max(0, 2 * BRAKE * Math.max(0, room - 1 * M))));
        if (t.speed < target) t.speed = Math.min(target, t.speed + ACCEL * dt);
        else t.speed = Math.max(target, t.speed - (hard ? EMERGENCY : BRAKE * 1.3) * dt);
        // At its stop: doors open.
        if (stop !== undefined && stop - t.s < 1.5 * M && t.speed < 1.5 * M) {
          t.speed = 0;
          t.dwell = DWELL[0] + this.rand() * (DWELL[1] - DWELL[0]);
          t.fresh = true;
        }
      }
      t.s += t.speed * dt;
      this.place(t);
    }
  }

  /**
   * A carriage knocked (by you, or a car it ran into), this hard: damaged
   * (and marked where it was hit, `along` and `across` it from its middle);
   * wrecked, the train stops for good. Any knock and its brakes go on.
   */
  knock(c: Carriage, impulse: number, along = 0, across = 0): void {
    c.damage = Math.min(1, c.damage + impulse / 2500);
    if (impulse > 30) c.hits.push([along, across]);
    if (c.damage >= 1) c.train.dead = true;
  }

  /** Whether a train's waiting at a stop with its doors open. */
  dwelling(t: Train): boolean {
    return t.dwell > 0;
  }

  /** Takes over from the last region's trains (see streamer.ts): those round the view, on their runs in this one (found where they are). */
  adopt(old: Trains, keep: { x0: number; y0: number; x1: number; y1: number }): void {
    const inside = (x: number, y: number) => x >= keep.x0 && x <= keep.x1 && y >= keep.y0 && y <= keep.y1;
    for (let i = this.trains.length - 1; i >= 0; i--) if (this.trains[i].cars.some((c) => inside(c.x, c.y))) this.trains.splice(i, 1);
    for (const t of old.trains) {
      if (!t.cars.some((c) => inside(c.x, c.y))) continue;
      const [fx, fy, fa] = old.at(t.run, t.s);
      let best: { run: Run; s: number } | null = null;
      let bestD = 4 * M;
      for (const run of this.runs) {
        if (run.route !== t.route) continue;
        const { along, distance } = this.nearest(run, fx, fy);
        const [, , a] = this.at(run, along);
        if (distance < bestD && Math.cos(a - fa) > 0.5) [best, bestD] = [{ run, s: along }, distance];
      }
      if (!best) continue;
      t.run = best.run;
      t.s = best.s;
      t.next = best.run.stops.findIndex((a) => a > t.s - 1 * M);
      if (t.next < 0) t.next = best.run.stops.length;
      this.trains.push(t);
    }
    this.nextId = Math.max(this.nextId, old.nextId);
  }

  get lastId(): number {
    return this.nextId;
  }
}

/** How far (x, y) is from a carriage's middle line (its length, less its rounded ends), px. */
export function carriageDist(c: Pick<Carriage, 'x' | 'y' | 'angle' | 'length' | 'r'>, x: number, y: number): number {
  const h = Math.max(0, c.length / 2 - c.r);
  const [ux, uy] = [Math.cos(c.angle), Math.sin(c.angle)];
  const t = Math.max(-h, Math.min(h, (x - c.x) * ux + (y - c.y) * uy));
  return Math.hypot(x - c.x - ux * t, y - c.y - uy * t);
}
