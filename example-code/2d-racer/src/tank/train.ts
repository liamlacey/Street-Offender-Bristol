/**
 * The trains going round the railway: a locomotive and its carriages, one
 * after another along the line, pulling up at every station for a while and
 * setting off again. A train stops for the tank on the line ahead, and short
 * of a bridge that's down; hit any part of it and it's stopped for good.
 * They're things in the World like any other. Pure logic; TankScene draws
 * them.
 */

import { type Railway, railPose } from './island';
import type { ThingKind, ThingSpec } from './kinds';
import { type Thing, World } from './world';

export interface Train {
  /** The locomotive first, then the carriages. */
  cars: Thing[];
  /** How far round the line the front is, px (it keeps counting up). */
  s: number;
  speed: number;
  /** Seconds left standing at a station. */
  dwell: number;
  /** The station it's stopped at, so it doesn't stop there again straight away. */
  last: number;
  /** Hit: stopped for good. */
  stopped: boolean;
}

export const TRAIN = { cruise: 180, accel: 45, brake: 110, gap: 74, dwell: 8 };

/** How many trains, and how long: one every 25,000 px or so of line, each a locomotive and three or four carriages. */
export function planTrains(railway: Railway, rand: () => number): { s: number; kinds: ThingKind[] }[] {
  const length = railway.at[railway.at.length - 1];
  const count = Math.max(1, Math.round(length / 25_000));
  return Array.from({ length: count }, (_, k) => ({
    s: (k / count) * length + rand() * 2000,
    kinds: ['loco', ...Array.from({ length: 3 + Math.floor(rand() * 2) }, () => 'carriage' as const)] as ThingKind[],
  }));
}

/** Where each train's cars start, as things to put in the World. */
export function trainSpecs(railway: Railway, plans: { s: number; kinds: ThingKind[] }[]): ThingSpec[] {
  return plans.flatMap((p, n) =>
    p.kinds.map((kind, k) => {
      const pose = railPose(railway, p.s - k * TRAIN.gap);
      return { kind, x: pose.x, y: pose.y, angle: pose.angle, variant: n * 10 + k };
    }),
  );
}

/**
 * Moves a train on by `dt` s. Returns true the moment it's been hit (so
 * whoever's aboard can get off and run).
 */
export function stepTrain(train: Train, railway: Railway, world: World, tank: { x: number; y: number }, dt: number): boolean {
  if (train.stopped) return false;
  if (train.cars.some((c) => c.phase !== 'intact')) {
    train.stopped = true;
    train.speed = 0;
    return true;
  }
  const length = railway.at[railway.at.length - 1];
  const front = ((train.s % length) + length) % length;
  // How far to the next station on, and to anything in the way.
  let stop = Infinity;
  railway.stations.forEach((st, k) => {
    if (k === train.last) return;
    const ahead = (st.at - front + length) % length;
    stop = Math.min(stop, ahead);
  });
  let blocked = Infinity;
  for (let d = 40; d < 420; d += 30) {
    const p = railPose(railway, train.s + d);
    if (Math.hypot(tank.x - p.x, tank.y - p.y) < 60) {
      blocked = Math.min(blocked, d - 40);
      break;
    }
    for (const o of world.near(p.x, p.y, 40)) {
      if (train.cars.includes(o) || Math.hypot(o.x - p.x, o.y - p.y) > o.def.r + 10) continue;
      // A bridge down, or something wrecked (or standing) on the line.
      const broken = o.def.material === 'bridge' && o.phase !== 'intact' && o.phase !== 'damaged';
      if (broken || World.blocks(o)) blocked = Math.min(blocked, d - 40);
    }
    if (blocked < Infinity) break;
  }
  if (train.dwell > 0) {
    train.dwell -= dt;
    train.speed = 0;
  } else {
    // Brake in time for the station (or whatever's in the way), else run up to speed.
    const room = Math.min(stop, blocked);
    const want = room < Infinity ? Math.min(TRAIN.cruise, Math.sqrt(2 * TRAIN.brake * Math.max(0, room - 1))) : TRAIN.cruise;
    train.speed += Math.max(-TRAIN.brake * 2 * dt, Math.min(TRAIN.accel * dt, want - train.speed));
    train.speed = Math.max(0, train.speed);
    // Drawing up at the platform: it stops there (not past it), and stands a while.
    const step = train.speed * dt;
    if (stop <= step + 4 && blocked > stop) {
      train.s += Math.max(0, stop);
      train.dwell = TRAIN.dwell;
      train.speed = 0;
      train.last = railway.stations.findIndex((st) => Math.abs(((st.at - front + length) % length) - stop) < 1);
    } else train.s += step;
  }
  train.cars.forEach((car, k) => {
    const pose = railPose(railway, train.s - k * TRAIN.gap);
    world.move(car, pose.x, pose.y);
    car.angle = pose.angle;
  });
  return false;
}
