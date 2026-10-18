/**
 * The tank: how it drives (it turns on the spot and goes the way it's
 * pointing, quicker on the roads, slower through sand, shallow water and up
 * into the rocks, wading slowly across the rivers (quickly over a bridge),
 * not at all into deep water, and smashing through whatever it drives into, which slows it), its
 * turret swinging round to aim, and its rockets. Pure logic, so it can be tested; TankScene draws it.
 */

import { BIOME, type Island, SIZE, biomeAt, cellOf } from './island';
import { type Thing, World, type WorldEvent } from './world';

export interface Tank {
  x: number;
  y: number;
  /** Which way the hull points, radians. */
  heading: number;
  /** Forward speed, px/s (negative when reversing). */
  speed: number;
  /** Which way the turret points, radians. */
  turret: number;
  /** Seconds until it can fire again. */
  reload: number;
  /** What it's pushing into now (by id). */
  ramming: Set<number>;
}

/**
 * What the player is asking for. `drive` is a direction to go in (a thumb
 * stick: the tank turns to face it and drives off, faster the further it's
 * pushed); `throttle` and `turn` are the keyboard's (forward/back, and
 * turning on the spot). `aim` is where to point the turret; `fire` fires.
 */
export interface TankInput {
  drive: { x: number; y: number } | null;
  throttle: number;
  turn: number;
  aim: number | null;
  fire: boolean;
}

export const TANK_RADIUS = 24;
export const TOP_SPEED = 230;
const ACCEL = 380;
const TURN_RATE = 2.4;
const TURRET_RATE = 4;
export const RELOAD = 0.55;
/** Rockets: how fast they fly, how far, and the blast where they land. */
export const ROCKET_SPEED = 950;
export const ROCKET_RANGE = 760;
export const ROCKET_BLAST = { radius: 80, power: 60 };
/** Where a rocket leaves the barrel, px ahead of the middle of the turret. */
export const MUZZLE = 42;

/** How fast the tank goes over each kind of ground, as a share of its top speed (0: it can't go there). */
const GROUND_SPEED: Record<number, number> = {
  [BIOME.deep]: 0,
  [BIOME.shallow]: 0.45,
  [BIOME.beach]: 0.8,
  [BIOME.grass]: 1,
  [BIOME.forest]: 0.9,
  [BIOME.hills]: 0.8,
  [BIOME.rock]: 0.6,
  [BIOME.snow]: 0.5,
  [BIOME.river]: 0.3,
};
const ROAD_BONUS = 1.2;

export function createTank(island: Island): Tank {
  const { x, y, angle } = island.spawn;
  return { x, y, heading: angle, speed: 0, turret: angle, reload: 0, ramming: new Set() };
}

/** How fast the tank can go at a point, as a share of its top speed (0: it can't): wading a river, unless on a bridge that's still standing. */
export function groundSpeed(island: Island, x: number, y: number, world?: World): number {
  const b = biomeAt(island, x, y);
  // Over a bridge, or out along a harbour's jetty.
  if ((b === BIOME.river || b === BIOME.deep || b === BIOME.shallow) && world && bridgeAt(world, x, y)) return ROAD_BONUS;
  const ground = GROUND_SPEED[b];
  return island.roads[cellOf(x, y)] && ground > 0 ? ground * ROAD_BONUS : ground;
}

/** The bridge (or jetty) standing at a point, if there is one (anywhere on its deck). */
export function bridgeAt(world: World, x: number, y: number, standing = true): Thing | null {
  for (const t of world.near(x, y, 160)) {
    if (t.def.material !== 'bridge' || (standing && t.phase !== 'intact' && t.phase !== 'damaged')) continue;
    const dx = x - t.x;
    const dy = y - t.y;
    const along = dx * Math.cos(t.angle) + dy * Math.sin(t.angle);
    const across = -dx * Math.sin(t.angle) + dy * Math.cos(t.angle);
    if (Math.abs(along) < (t.length ?? t.def.w) / 2 && Math.abs(across) < t.def.h / 2) return t;
  }
  return null;
}

/** How hard the tank hits what it drives into: a knock for running into it, and more for each second it keeps pushing, hit points. */
const RAM = { perSpeed: 0.6, grind: 70 };

/** Moves the tank on by `dt` s. Returns what it flattened on the way. */
export function stepTank(tank: Tank, input: TankInput, island: Island, world: World, dt: number): WorldEvent[] {
  let throttle = input.throttle;
  let turn = input.turn;
  if (input.drive) {
    // Turn to face the way the stick points, then drive that way.
    const push = Math.min(1, Math.hypot(input.drive.x, input.drive.y));
    const want = Math.atan2(input.drive.y, input.drive.x);
    const off = wrap(want - tank.heading);
    turn = Math.max(-1, Math.min(1, off * 2.5));
    throttle = push * Math.max(0, Math.cos(off));
  }
  tank.heading = wrap(tank.heading + turn * TURN_RATE * dt * (1 - Math.min(0.4, Math.abs(tank.speed) / TOP_SPEED / 2)));
  const ground = groundSpeed(island, tank.x, tank.y, world);
  const target = throttle * TOP_SPEED * Math.max(0.3, ground) * (throttle < 0 ? 0.55 : 1);
  const change = ACCEL * dt;
  tank.speed += Math.max(-change, Math.min(change, target - tank.speed));

  // Move, a bit at a time, stopping at deep water and the edge of the world.
  const nx = tank.x + Math.cos(tank.heading) * tank.speed * dt;
  const ny = tank.y + Math.sin(tank.heading) * tank.speed * dt;
  // (Stuck somewhere it can't drive, like in the river when a bridge goes, it can always drive out.)
  const stuck = ground <= 0;
  const ahead = (x: number, y: number) => {
    const s = Math.sign(tank.speed) * TANK_RADIUS * 0.8;
    const ok = stuck || groundSpeed(island, x + Math.cos(tank.heading) * s, y + Math.sin(tank.heading) * s, world) > 0;
    return ok && x > TANK_RADIUS && y > TANK_RADIUS && x < SIZE - TANK_RADIUS && y < SIZE - TANK_RADIUS;
  };
  if (ahead(nx, ny)) {
    tank.x = nx;
    tank.y = ny;
  } else if (ahead(nx, tank.y)) {
    tank.x = nx;
  } else if (ahead(tank.x, ny)) {
    tank.y = ny;
  } else {
    tank.speed = 0;
  }

  // Driving into something solid: held back by it while smashing into it (slowed the more, the tougher it is); small things flattened.
  const events: WorldEvent[] = [];
  for (const t of world.near(tank.x, tank.y, TANK_RADIUS + 60)) {
    const dx = tank.x - t.x;
    const dy = tank.y - t.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const overlap = TANK_RADIUS + t.def.r - d;
    if (overlap <= 0) continue;
    if (World.blocks(t)) {
      tank.x += (dx / d) * overlap;
      tank.y += (dy / d) * overlap;
      const into = ((Math.cos(tank.heading) * -dx + Math.sin(tank.heading) * -dy) / d) * Math.sign(tank.speed);
      if (into > 0.3 && Math.abs(tank.speed) > 20) {
        const fresh = !tank.ramming.has(t.id);
        events.push(...world.ram(t, (fresh ? Math.abs(tank.speed) * RAM.perSpeed * into : 0) + RAM.grind * dt));
        tank.ramming.add(t.id);
        // The knock of hitting it, more the tougher it is.
        if (fresh) tank.speed *= Math.max(0.3, Math.min(0.85, 1 - t.def.hp / 200));
        // The tougher it is, the more it holds the tank up.
        tank.speed *= Math.max(0.2, 1 - dt * Math.min(9, t.def.hp / 18));
      }
    } else if (World.crushable(t) && Math.abs(tank.speed) > 15) {
      events.push(...world.crush(t));
    }
  }

  // The turret swings round to its aim.
  if (input.aim !== null) {
    const off = wrap(input.aim - tank.turret);
    const step = TURRET_RATE * dt;
    tank.turret = wrap(tank.turret + Math.max(-step, Math.min(step, off)));
  }
  tank.reload = Math.max(0, tank.reload - dt);
  // Forget what it's no longer touching, so running into it again is a fresh knock.
  for (const id of tank.ramming) {
    const t = world.things[id];
    if (!t || t.phase === 'gone' || Math.hypot(t.x - tank.x, t.y - tank.y) > TANK_RADIUS + t.def.r + 6) tank.ramming.delete(id);
  }
  return events;
}

/** Whether the tank fires this frame (and if so, starts its reload). */
export function wantsToFire(tank: Tank, input: TankInput): boolean {
  if (!input.fire || tank.reload > 0) return false;
  tank.reload = RELOAD;
  return true;
}

export interface Rocket {
  x: number;
  y: number;
  angle: number;
  travelled: number;
  /** The bridge it was fired from (it flies over that one). */
  from: Thing | null;
}

export function launch(tank: Tank, world?: World): Rocket {
  return {
    x: tank.x + Math.cos(tank.turret) * MUZZLE,
    y: tank.y + Math.sin(tank.turret) * MUZZLE,
    angle: tank.turret,
    travelled: 0,
    from: world ? bridgeAt(world, tank.x, tank.y) : null,
  };
}

/**
 * Flies a rocket on by `dt` s. If it hits something (or runs out of range) it
 * blows up: returns where, and what it hit. Otherwise null.
 */
export function stepRocket(rocket: Rocket, world: World, dt: number): { x: number; y: number; hit: Thing | null } | null {
  const step = 10;
  let left = Math.min(ROCKET_SPEED * dt, ROCKET_RANGE - rocket.travelled);
  while (left > 0) {
    const d = Math.min(step, left);
    rocket.x += Math.cos(rocket.angle) * d;
    rocket.y += Math.sin(rocket.angle) * d;
    rocket.travelled += d;
    left -= d;
    for (const t of world.near(rocket.x, rocket.y, 40)) {
      if (!World.target(t) || t.def.material === 'bridge') continue;
      if (Math.hypot(t.x - rocket.x, t.y - rocket.y) < t.def.r + 3) return { x: rocket.x, y: rocket.y, hit: t };
    }
    // A bridge is hit anywhere on its deck.
    const bridge = bridgeAt(world, rocket.x, rocket.y);
    if (bridge && bridge !== rocket.from) return { x: rocket.x, y: rocket.y, hit: bridge };
  }
  return rocket.travelled >= ROCKET_RANGE ? { x: rocket.x, y: rocket.y, hit: null } : null;
}

export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
