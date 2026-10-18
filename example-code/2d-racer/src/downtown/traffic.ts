/**
 * The city's own traffic, on the side streets: cars, taxis, vans, buses and
 * the odd police car driving on the right, keeping their distance, stopping
 * at red lights, going straight on or turning at the junctions, and where a
 * street is closed off for the race, waiting at the lights a while and then
 * giving up and turning round. Never on the race's streets. No Phaser, so it
 * can be tested.
 */

import type { Vec2 } from '../track/Track';
import type { City, Junction, Street } from './city';
import { CROSSING } from './road';

export type VehicleKind = 'car' | 'taxi' | 'van' | 'bus' | 'truck' | 'police';

/** How long each kind is, px, and how fast it likes to go, px/s. */
export const VEHICLES: Record<VehicleKind, { length: number; speed: number }> = {
  car: { length: 40, speed: 120 },
  taxi: { length: 40, speed: 130 },
  van: { length: 50, speed: 110 },
  bus: { length: 84, speed: 85 },
  truck: { length: 88, speed: 85 },
  police: { length: 42, speed: 140 },
};

/** How far right of a street's middle a car drives, px. */
const LANE = 26;
/** Gap kept to the car in front, bumper to bumper, px. */
const GAP = 12;
const ACCEL = 90;
const BRAKE = 170;
/** Slower round corners, px/s. */
const TURN_SPEED = 60;

/** One way along a street. */
interface Lane {
  street: Street;
  /** Driving from a to b (1) or b to a (-1). */
  dir: 1 | -1;
  from: Junction;
  to: Junction;
  length: number;
  /** Unit vector the way of travel, and to its right. */
  u: Vec2;
  r: Vec2;
  /** Where cars stop for the lights at the far end (distance from `from`). */
  stop: number;
  /** Where the far junction's box starts. */
  end: number;
  /** Where the lane starts, out of the near junction's box. */
  start: number;
  cars: Vehicle[];
}

/** A path through a junction (or round a turning), from one lane to the next. */
interface Turn {
  p0: Vec2;
  c: Vec2;
  p2: Vec2;
  length: number;
  t: number;
  next: Lane;
  /** Distance along the next lane where it comes out. */
  at: number;
}

export interface Vehicle {
  kind: VehicleKind;
  look: number;
  length: number;
  lane: Lane;
  /** Distance along its lane from the near junction's centre, px. */
  s: number;
  speed: number;
  cruise: number;
  turn: Turn | null;
  /** Seconds stood waiting at a closed street before turning round. */
  waited: number;
  /** Where it is and which way it faces, worked out each step. */
  x: number;
  y: number;
  heading: number;
}

/** The lights at a junction off the race's route: east-west and north-south take turns. */
export function crossLights(j: Junction, time: number): 'ew' | 'ns' | 'none' {
  const t = (((time + j.i * 2.3 + j.j * 1.7) % 20) + 20) % 20;
  return t < 8 ? 'ew' : t < 10 ? 'none' : t < 18 ? 'ns' : 'none';
}

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private readonly lanes: Lane[] = [];
  /** The lanes leaving each junction. */
  private readonly leaving = new Map<Junction, Lane[]>();

  constructor(
    city: City,
    /** How far from the middle of the race's junctions its barriers reach, px: closed streets stop short of them. */
    closure: number,
    private readonly rng: () => number,
    density = 0.8,
  ) {
    for (const street of city.streets) {
      if (street.onTrack) continue;
      // Both ends at the track: closed off both ends, nowhere to go.
      if (street.a.onTrack && street.b.onTrack) continue;
      for (const dir of [1, -1] as const) {
        const from = dir === 1 ? street.a : street.b;
        const to = dir === 1 ? street.b : street.a;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
        const [boxFrom, boxTo] = dir === 1 ? street.box : [street.box[1], street.box[0]];
        const end = length - boxTo;
        const lane: Lane = {
          street,
          dir,
          from,
          to,
          length,
          u,
          r: { x: -u.y, y: u.x },
          end,
          // Closed off for the race: the queue stops short of the barriers.
          stop: to.onTrack ? length - closure - 50 : end - 10 - CROSSING.depth - 12,
          // Out of a closed street, starting beyond the barriers.
          start: from.onTrack ? closure + 50 : boxFrom,
          cars: [],
        };
        this.lanes.push(lane);
        // Nobody sets off from the track's junctions.
        if (!from.onTrack) this.leaving.set(from, [...(this.leaving.get(from) ?? []), lane]);
      }
    }
    // Fill the lanes, spaced out.
    const kinds: [VehicleKind, number][] = [['car', 10], ['taxi', 3], ['van', 2], ['bus', 0.8], ['truck', 0.8], ['police', 0.4]];
    const total = kinds.reduce((sum, [, w]) => sum + w, 0);
    for (const lane of this.lanes) {
      let s = lane.start + 20 + this.rng() * 120;
      while (s < lane.stop - 30) {
        if (this.rng() < density) {
          let pick = this.rng() * total;
          const kind = (kinds.find(([, w]) => (pick -= w) < 0) ?? kinds[0])[0];
          const { length, speed } = VEHICLES[kind];
          if (s + length / 2 > lane.stop) break;
          const v: Vehicle = {
            kind,
            look: Math.floor(this.rng() * 12),
            length,
            lane,
            s: s + length / 2,
            speed: 0,
            cruise: speed * (0.85 + this.rng() * 0.3),
            turn: null,
            waited: 0,
            x: 0,
            y: 0,
            heading: 0,
          };
          lane.cars.push(v);
          this.vehicles.push(v);
          this.place(v);
          s += length + GAP + 30 + this.rng() * 160;
        } else s += 120 + this.rng() * 200;
      }
    }
  }

  /** Moves the traffic on by `dt` seconds; `time` is the lights' clock, s. */
  step(dt: number, time: number): void {
    for (const lane of this.lanes) lane.cars.sort((a, b) => b.s - a.s);
    for (const lane of this.lanes) {
      // A copy: cars leave the lane as they turn off it.
      const cars = [...lane.cars];
      cars.forEach((v, k) => this.drive(v, k === 0 ? null : cars[k - 1], dt, time));
    }
    for (const v of this.vehicles) this.place(v);
  }

  private drive(v: Vehicle, ahead: Vehicle | null, dt: number, time: number): void {
    if (v.turn) {
      this.turning(v, dt);
      return;
    }
    const { lane } = v;
    // How far it may go: up to the car in front, and up to the stop line unless it may go on.
    let limit = ahead && !ahead.turn ? ahead.s - ahead.length / 2 - GAP - v.length / 2 : Infinity;
    const front = v.s + v.length / 2;
    const closed = lane.to.onTrack;
    const green = !closed && crossLights(lane.to, time) === (lane.street.horizontal ? 'ew' : 'ns');
    // Through the stop line on green (or once past it), otherwise wait there.
    if (!green && front <= lane.stop + 1) limit = Math.min(limit, lane.stop - v.length / 2);
    if (closed) limit = Math.min(limit, lane.stop - v.length / 2);
    const room = limit - v.s;
    const want = Math.min(v.cruise, Math.sqrt(Math.max(0, 2 * BRAKE * Math.max(0, room - 2))));
    v.speed = want > v.speed ? Math.min(want, v.speed + ACCEL * dt) : want;
    v.s = Math.min(v.s + v.speed * dt, Math.max(v.s, limit));

    // At a closed street's stop line, first in the queue: wait, then turn round.
    if (closed && !ahead && v.s >= lane.stop - v.length / 2 - 1 && v.speed < 1) {
      v.waited += dt;
      if (v.waited > 3 + (v.look % 5)) this.turnRound(v);
      return;
    }
    // Into the junction.
    if (!closed && front >= lane.end) this.enterJunction(v);
  }

  /** Picks the way on from a junction (straight on mostly) and starts through it. */
  private enterJunction(v: Vehicle): void {
    const { lane } = v;
    const options = (this.leaving.get(lane.to) ?? []).filter((l) => l.street !== lane.street);
    if (options.length === 0) {
      this.turnRound(v);
      return;
    }
    const weight = (l: Lane) => (l.u.x * lane.u.x + l.u.y * lane.u.y > 0.9 ? 3 : 1);
    let pick = this.rng() * options.reduce((s, l) => s + weight(l), 0);
    const next = options.find((l) => (pick -= weight(l)) < 0) ?? options[0];
    // Don't block the junction if there's no room on the far side.
    const tail = next.cars[next.cars.length - 1];
    if (tail && tail.s - tail.length / 2 < next.start + v.length + GAP) {
      v.speed = 0;
      return;
    }
    const p0 = this.at(lane, v.s);
    const at = next.start + v.length / 2;
    const p2 = this.at(next, at);
    this.startTurn(v, p0, p2, lane.u, next, at);
  }

  /** A U-turn across the street, back the way it came. */
  private turnRound(v: Vehicle): void {
    const { lane } = v;
    const back = this.lanes.find((l) => l.street === lane.street && l.dir !== lane.dir);
    if (!back) return;
    const at = lane.length - v.s;
    const tail = back.cars.find((c) => Math.abs(c.s - at) < v.length + GAP);
    if (tail) return;
    v.waited = 0;
    const p0 = this.at(lane, v.s);
    const p2 = this.at(back, at);
    // Out wide and round.
    const c = { x: (p0.x + p2.x) / 2 + lane.u.x * 70, y: (p0.y + p2.y) / 2 + lane.u.y * 70 };
    this.setTurn(v, { p0, c, p2, length: 0, t: 0, next: back, at });
  }

  private startTurn(v: Vehicle, p0: Vec2, p2: Vec2, u0: Vec2, next: Lane, at: number): void {
    // The corner of the two lanes' lines (or halfway, going straight on).
    const u2 = next.u;
    const cross = u0.x * u2.y - u0.y * u2.x;
    let c: Vec2;
    if (Math.abs(cross) < 1e-6) c = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
    else {
      const t = ((p2.x - p0.x) * u2.y - (p2.y - p0.y) * u2.x) / cross;
      c = { x: p0.x + u0.x * t, y: p0.y + u0.y * t };
    }
    this.setTurn(v, { p0, c, p2, length: 0, t: 0, next, at });
  }

  private setTurn(v: Vehicle, turn: Turn): void {
    turn.length = Math.hypot(turn.c.x - turn.p0.x, turn.c.y - turn.p0.y) + Math.hypot(turn.p2.x - turn.c.x, turn.p2.y - turn.c.y);
    v.turn = turn;
    const lane = v.lane;
    lane.cars.splice(lane.cars.indexOf(v), 1);
  }

  private turning(v: Vehicle, dt: number): void {
    const turn = v.turn!;
    const straight = Math.abs((turn.c.x - turn.p0.x) * (turn.p2.y - turn.c.y) - (turn.c.y - turn.p0.y) * (turn.p2.x - turn.c.x)) < 1;
    const want = straight ? v.cruise : TURN_SPEED;
    v.speed = want > v.speed ? Math.min(want, v.speed + ACCEL * dt) : Math.max(want, v.speed - BRAKE * dt);
    turn.t += (v.speed * dt) / Math.max(1, turn.length);
    if (turn.t >= 1) {
      v.turn = null;
      v.lane = turn.next;
      v.s = turn.at;
      turn.next.cars.push(v);
    }
  }

  /** A point in a lane, `s` px along it. */
  private at(lane: Lane, s: number): Vec2 {
    return { x: lane.from.x + lane.u.x * s + lane.r.x * LANE, y: lane.from.y + lane.u.y * s + lane.r.y * LANE };
  }

  /** Works out where a vehicle is and which way it faces. */
  private place(v: Vehicle): void {
    if (v.turn) {
      const { p0, c, p2, t } = v.turn;
      const k = Math.min(1, t);
      const m = 1 - k;
      v.x = m * m * p0.x + 2 * m * k * c.x + k * k * p2.x;
      v.y = m * m * p0.y + 2 * m * k * c.y + k * k * p2.y;
      const dx = 2 * m * (c.x - p0.x) + 2 * k * (p2.x - c.x);
      const dy = 2 * m * (c.y - p0.y) + 2 * k * (p2.y - c.y);
      if (Math.hypot(dx, dy) > 1e-6) v.heading = Math.atan2(dy, dx);
      return;
    }
    const p = this.at(v.lane, v.s);
    v.x = p.x;
    v.y = p.y;
    v.heading = Math.atan2(v.lane.u.y, v.lane.u.x);
  }
}
