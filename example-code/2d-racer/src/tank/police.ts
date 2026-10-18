/**
 * The police: once the tank starts destroying things (and the police are
 * switched on), cars and vans come after it, more the more it's destroyed.
 * They race round to get in front of it and stop there in its way, and
 * steer round what's in theirs. They're things in the World like any other:
 * the tank can shoot them or smash through them. Pure logic; TankScene
 * spawns and draws them.
 */

import { type Island, type Vec2, SIZE, cellOf } from './island';
import type { ThingSpec } from './kinds';
import { TANK_RADIUS, groundSpeed } from './tank';
import { type Thing, World } from './world';

export interface Cop {
  thing: Thing;
  speed: number;
  /** Hit: stopped for good. */
  stopped: boolean;
  /** Seconds left backing out of somewhere it's got wedged. */
  reverse?: number;
}

const PACE = { police: 260, policevan: 215 };
const TURN = 2.6;

/** How many police there should be after `destroyed` things have been wrecked: one to start, and another for every six, up to fourteen. */
export function wanted(destroyed: number): number {
  return destroyed <= 0 ? 0 : Math.min(14, 1 + Math.floor(destroyed / 6));
}

/** A police car or van arriving: 800 to 1,300 px from the tank (out of sight), on a road if there's one about, else on open ground; or null if there's nowhere. */
export function arrival(island: Island, tank: Vec2, rand: () => number, van: boolean): ThingSpec | null {
  let land: Vec2 | null = null;
  for (let tries = 0; tries < 60; tries++) {
    const a = rand() * Math.PI * 2;
    const d = 800 + rand() * 500;
    const p = { x: tank.x + Math.cos(a) * d, y: tank.y + Math.sin(a) * d };
    if (p.x < 50 || p.y < 50 || p.x > SIZE - 50 || p.y > SIZE - 50 || groundSpeed(island, p.x, p.y) <= 0) continue;
    const spec = { kind: van ? 'policevan' : 'police', x: p.x, y: p.y, angle: Math.atan2(tank.y - p.y, tank.x - p.x), variant: Math.floor(rand() * 1000) } as const;
    if (island.roads[cellOf(p.x, p.y)]) return spec;
    land ??= spec;
  }
  return land as ThingSpec | null;
}

/**
 * Drives a police car on by `dt` s, towards a spot just ahead of the tank
 * (cutting it off), slowing to a stop across its way. Returns true the
 * moment it's been hit.
 */
export function stepCop(c: Cop, dt: number, tank: { x: number; y: number; heading: number; speed: number }, world: World, island: Island): boolean {
  if (c.stopped) return false;
  const t = c.thing;
  if (t.phase !== 'intact') {
    c.stopped = true;
    c.speed = 0;
    return true;
  }
  const lead = 90 + Math.abs(tank.speed) * 0.7;
  const target = { x: tank.x + Math.cos(tank.heading) * lead * Math.sign(tank.speed || 1), y: tank.y + Math.sin(tank.heading) * lead * Math.sign(tank.speed || 1) };
  const toTarget = Math.hypot(target.x - t.x, target.y - t.y);
  const toTank = Math.hypot(tank.x - t.x, tank.y - t.y);
  let want = Math.atan2(target.y - t.y, target.x - t.x);
  // Steer round what's ahead (and away from water).
  const clear = (a: number) =>
    [8, 26].every((ahead) => {
      const px = t.x + Math.cos(a) * ahead;
      const py = t.y + Math.sin(a) * ahead;
      if (groundSpeed(island, px, py, world) <= 0) return false;
      return !world.near(px, py, 40).some((o) => o !== t && World.blocks(o) && Math.hypot(o.x - px, o.y - py) < o.def.r + t.def.r - 4);
    });
  let way = false;
  for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4]) {
    if (clear(want + turn)) {
      want += turn;
      way = true;
      break;
    }
  }
  // Boxed in (among the trees, say): back out a little, turning, and try again.
  if (!way && !c.reverse) c.reverse = 1.2;
  if (c.reverse) {
    c.reverse = Math.max(0, c.reverse - dt);
    t.angle += TURN * 0.6 * dt;
    const bx = t.x - Math.cos(t.angle) * 70 * dt;
    const by = t.y - Math.sin(t.angle) * 70 * dt;
    if (groundSpeed(island, bx, by, world) > 0) world.move(t, bx, by);
    c.speed = 0;
    return false;
  }
  const off = Math.atan2(Math.sin(want - t.angle), Math.cos(want - t.angle));
  t.angle += Math.max(-TURN * dt, Math.min(TURN * dt, off));
  // Flat out to get there; slowing as it arrives, and stopped broadside in the tank's way.
  const top = PACE[t.kind as keyof typeof PACE] ?? 240;
  const ground = groundSpeed(island, t.x, t.y, world);
  let target_speed = top * Math.max(0.3, Math.cos(off)) * Math.min(1, toTarget / 160) * Math.max(0.4, ground);
  if (toTank < TANK_RADIUS + t.def.r + 30) target_speed = 0;
  c.speed += Math.max(-400 * dt, Math.min(220 * dt, target_speed - c.speed));
  const nx = t.x + Math.cos(t.angle) * c.speed * dt;
  const ny = t.y + Math.sin(t.angle) * c.speed * dt;
  // (Into something is blocked; away from something it's already up against isn't.)
  const hit = world.near(nx, ny, 40).some((o) => {
    if (o === t || !World.blocks(o)) return false;
    const d = Math.hypot(o.x - nx, o.y - ny);
    return d < o.def.r + t.def.r - 4 && d < Math.hypot(o.x - t.x, o.y - t.y);
  });
  if (!hit && groundSpeed(island, nx, ny, world) > 0 && Math.hypot(tank.x - nx, tank.y - ny) > TANK_RADIUS + t.def.r) world.move(t, nx, ny);
  else c.speed *= 0.3;
  return false;
}
