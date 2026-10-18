/**
 * Life on the streets the race goes down, all of it loose (knocked about by
 * the cars, as everything on or by the road is): cars parked along the
 * parking lanes, people walking the pavements and crossing at the junctions
 * when the lights let them, and hydrants, bins and newspaper boxes at the
 * kerb. Where they all go, how the traffic lights cycle, and how people get
 * about (and out of the way). No Phaser, so it can be tested.
 */

import type { Body } from '../physics/collisions';
import { mulberry32 } from '../track/generate';
import { type Pose, type Track, type Vec2, poseAt, turnRadii } from '../track/Track';
import type { City, TrackJunction } from './city';
import { CROSSING, CROSSING_GAP, PARKING_LANE, point, wrap } from './road';

/** A parked car, nose to tail along a parking lane: about as heavy as the racers, with the handbrake on. */
export const PARKED_CAR = { length: 40, width: 20, gap: 14, invMass: 1.3, damping: 5 };
/** Where people walk across a junction's crossing: from one kerb to the other. */
export interface Crossing {
  /** Which of the track's junctions it's at (for its lights). */
  junction: number;
  a: Vec2;
  b: Vec2;
}

/** A stretch of pavement someone walks up and down. */
export interface Walk {
  a: Vec2;
  b: Vec2;
}

export type FurnitureKind = 'hydrant' | 'bin' | 'newsbox';

/** How big and heavy the street furniture is, and how quickly it stops sliding. */
export const FURNITURE: Record<FurnitureKind, { r: number; invMass: number; damping: number }> = {
  hydrant: { r: 7, invMass: 3, damping: 6 },
  bin: { r: 8, invMass: 8, damping: 4 },
  newsbox: { r: 8, invMass: 6, damping: 4 },
};

export interface StreetLife {
  parked: Pose[];
  walks: Walk[];
  crossings: Crossing[];
  furniture: (Vec2 & { kind: FurnitureKind })[];
}

/** Stretch either side of the start line kept clear for the grid, px. */
const GRID_CLEAR = { behind: 1500, ahead: 500 };

/**
 * Where the parked cars, people and street furniture go along a downtown
 * track. Deterministic for a track.
 */
export function planStreetLife(track: Track, city: City, junctions: TrackJunction[], runOff: number): StreetLife {
  const rng = mulberry32(Math.round(track.length * 7 + track.points.length));
  const radii = turnRadii(track, 4);
  const n = track.points.length;
  const life: StreetLife = { parked: [], walks: [], crossings: [], furniture: [] };
  const kerb = (along: number, side: 1 | -1, out: number): Vec2 => {
    const p = poseAt(track, along);
    return { x: p.x - Math.sin(p.heading) * side * out, y: p.y + Math.cos(p.heading) * side * out };
  };
  const halfAt = (along: number) => track.halfWidths[((Math.round(along / track.spacing) % n) + n) % n];
  const straight = (along: number, reach = 120) => {
    const i = Math.round(along / track.spacing);
    const k = Math.ceil(reach / track.spacing);
    for (let d = -k; d <= k; d++) if (radii[(((i + d) % n) + n) % n] < 1500) return false;
    return true;
  };
  const nearGrid = (along: number) => {
    const d = wrap(along, track.length);
    return d > -GRID_CLEAR.behind && d < GRID_CLEAR.ahead;
  };
  const nearObstacle = (along: number) => track.obstacles.some((o) => Math.abs(wrap(along - o.along, track.length)) < o.reach + 200);
  const pavement = (along: number) => halfAt(along) + track.kerbWidth + runOff * 0.5;

  // The crossings over the race's streets at each junction it goes through (or turns at).
  junctions.forEach((jn, index) => {
    for (const s of city.streets) {
      if (!s.onTrack || (s.a !== jn.junction && s.b !== jn.junction)) continue;
      const fromA = s.a === jn.junction;
      const length = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      // Distance along the street from the junction, measured from its a end.
      const along = (d: number) => (fromA ? d : length - d);
      const mid = (fromA ? s.box[0] : s.box[1]) + CROSSING_GAP + CROSSING.depth / 2;
      const out = s.width / 2 + s.kerb + 12;
      life.crossings.push({ junction: index, a: point(s, along(mid), out), b: point(s, along(mid), -out) });
      // A hydrant on one corner, now and then a newspaper box on another.
      const side = rng() < 0.5 ? 1 : -1;
      if (rng() < 0.6) life.furniture.push({ ...point(s, along(mid + 34), side * out), kind: 'hydrant' });
      if (rng() < 0.4) life.furniture.push({ ...point(s, along(mid + 52), -side * (out + runOff * 0.25)), kind: 'newsbox' });
    }
  });

  // Between the junctions: the stretches of street, each side.
  const order = [...junctions].sort((a, b) => a.along - b.along);
  for (let k = 0; k < order.length; k++) {
    const from = order[k];
    const to = order[(k + 1) % order.length];
    const start = from.along + from.after + 10 + CROSSING.depth + 60;
    const end = (to.along < from.along ? to.along + track.length : to.along) - to.before - 10 - CROSSING.depth - 60;
    for (const side of [1, -1] as const) {
      // Parked cars in runs along the parking lane, on the straight, away from the grid and the road works.
      const spacing = PARKED_CAR.length + PARKED_CAR.gap;
      for (let along = start + rng() * spacing; along < end; along += spacing) {
        if (!straight(along) || nearGrid(along) || nearObstacle(along) || rng() < 0.4) continue;
        const p = poseAt(track, along);
        const out = halfAt(along) - PARKING_LANE / 2 - 1;
        // Facing the way the traffic on that side goes.
        life.parked.push({ ...kerb(along, side, out), heading: p.heading + (side === 1 ? 0 : Math.PI) });
      }
      // Someone (or two) walking up and down the pavement.
      if (end - start > 300) {
        for (let w = 0; w < 1 + Math.floor(rng() * 2); w++) {
          const a = start + rng() * (end - start - 250);
          const b = Math.min(end, a + 200 + rng() * 400);
          if (!straight((a + b) / 2, (b - a) / 2)) continue;
          life.walks.push({ a: kerb(a, side, pavement(a)), b: kerb(b, side, pavement(b)) });
        }
      }
      // Bins along the kerb.
      for (let along = start + rng() * 300; along < end; along += 350 + rng() * 300) {
        if (straight(along, 40)) life.furniture.push({ ...kerb(along, side, halfAt(along) + track.kerbWidth + 13), kind: 'bin' });
      }
    }
  }
  return life;
}

// --- Traffic lights -----------------------------------------------------------

/** A junction's light cycle, s: green for the race's way, amber, then red, when people cross. */
export const SIGNAL = { cycle: 16, green: 8, amber: 1.5, walk: [9.5, 14.5] as const };

/** The lights for the race's way through a junction at a time, s. */
export function signal(junction: number, time: number): 'green' | 'amber' | 'red' {
  const t = (((time + junction * 3.7) % SIGNAL.cycle) + SIGNAL.cycle) % SIGNAL.cycle;
  return t < SIGNAL.green ? 'green' : t < SIGNAL.green + SIGNAL.amber ? 'amber' : 'red';
}

/** Whether people may cross the race's road at a junction at a time, s. */
export function walkSignal(junction: number, time: number): boolean {
  const t = (((time + junction * 3.7) % SIGNAL.cycle) + SIGNAL.cycle) % SIGNAL.cycle;
  return t >= SIGNAL.walk[0] && t < SIGNAL.walk[1];
}

// --- People -------------------------------------------------------------------

/** Pedestrians: radius and lightness (cars barely notice them). */
export const PEDESTRIAN = { radius: 7, invMass: 18, walk: [28, 46] as const, dodge: 140 };
/** Faster than this (px/s), someone's been knocked flying. */
const KNOCKED = 170;
/** How long someone stays down after being knocked over, s. */
const DOWN_FOR = 2.6;
/** A car this close (px) and heading their way sends people jumping aside. */
const DANGER = 150;

export interface Pedestrian {
  body: Body;
  /** Where they go back and forth between. */
  a: Vec2;
  b: Vec2;
  /** Heading for b (1) or a (-1). */
  dir: 1 | -1;
  /** A crossing's junction (they wait for the lights), or null for a stroll along the pavement. */
  junction: number | null;
  state: 'walk' | 'wait' | 'dodge' | 'down';
  /** Seconds left in this state (waiting, dodging, lying down). */
  timer: number;
  speed: number;
  /** Which way they're facing. */
  heading: number;
}

/** Someone at `at` walking between a and b. */
export function pedestrian(a: Vec2, b: Vec2, junction: number | null, rng: () => number): Pedestrian {
  const t = junction === null ? rng() : 0;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  return {
    body: { x, y, r: PEDESTRIAN.radius, vx: 0, vy: 0, invMass: PEDESTRIAN.invMass, angle: 0, spin: 0, damping: 3 },
    a,
    b,
    dir: rng() < 0.5 ? 1 : -1,
    junction,
    state: 'wait',
    timer: rng() * 3,
    speed: PEDESTRIAN.walk[0] + rng() * (PEDESTRIAN.walk[1] - PEDESTRIAN.walk[0]),
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** A car, as far as people dodging it care. */
export interface Oncoming {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * One step of someone's day: walking to the end of their stretch (or across,
 * when the lights say so), waiting, jumping out of the way of a car coming
 * at them, and if they're knocked flying, lying there a moment before
 * getting up and carrying on. Sets their velocity (the physics moves them).
 */
export function stepPedestrian(p: Pedestrian, dt: number, time: number, cars: Oncoming[], rng: () => number): void {
  const { body } = p;
  const speed = Math.hypot(body.vx, body.vy);
  if (p.state !== 'down' && speed > KNOCKED) {
    p.state = 'down';
    p.timer = DOWN_FOR;
  }
  if (p.state === 'down') {
    // Tumbling to a stop, then lying still.
    p.timer -= dt;
    if (p.timer <= 0) {
      p.state = 'walk';
      body.spin = 0;
    }
    return;
  }
  body.spin = 0;

  // A car bearing down: jump sideways out of its way.
  if (p.state !== 'dodge') {
    for (const c of cars) {
      const dx = body.x - c.x;
      const dy = body.y - c.y;
      const dist = Math.hypot(dx, dy);
      const v = Math.hypot(c.vx, c.vy);
      if (dist > DANGER || v < 120) continue;
      // Coming this way, and they're near its path.
      const ahead = (dx * c.vx + dy * c.vy) / v;
      const aside = (dx * c.vy - dy * c.vx) / v;
      if (ahead > 0 && Math.abs(aside) < 40 && rng() < 0.08) {
        const away = aside >= 0 ? 1 : -1;
        p.state = 'dodge';
        p.timer = 0.45;
        body.vx = (c.vy / v) * away * PEDESTRIAN.dodge;
        body.vy = (-c.vx / v) * away * PEDESTRIAN.dodge;
        p.heading = Math.atan2(body.vy, body.vx);
        break;
      }
    }
  }
  if (p.state === 'dodge') {
    p.timer -= dt;
    if (p.timer <= 0) p.state = 'walk';
    return;
  }

  if (p.state === 'wait') {
    body.vx = 0;
    body.vy = 0;
    p.timer -= dt;
    const lights = p.junction === null || walkSignal(p.junction, time);
    if (p.timer <= 0 && lights) p.state = 'walk';
    return;
  }

  // Walking to the end they're heading for.
  const target = p.dir === 1 ? p.b : p.a;
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) {
    p.dir = p.dir === 1 ? -1 : 1;
    p.state = 'wait';
    p.timer = p.junction === null ? 1 + rng() * 4 : 0.5 + rng() * 2;
    body.vx = 0;
    body.vy = 0;
    return;
  }
  body.vx = (dx / dist) * p.speed;
  body.vy = (dy / dist) * p.speed;
  p.heading = Math.atan2(dy, dx);
}
