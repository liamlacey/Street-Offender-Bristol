/**
 * Collisions between the car, walls (buildings' sides, garden walls), fixed
 * posts (lamps, bollards, tree trunks) and light loose objects (benches,
 * bins). Independent of Phaser so it can be unit tested.
 *
 * The car's body is three overlapping circles
 * along its length, which is close enough to its rectangle for arcade physics
 * and keeps every test a simple circle-circle or circle-segment check. Contacts are resolved with
 * an impulse that bounces (restitution) and scrapes (friction), applied at the
 * contact point so off-centre hits spin the car.
 */

import { CAR_LENGTH, CAR_WIDTH, type CarState } from '../car/CarPhysics';

export interface Circle {
  x: number;
  y: number;
  r: number;
  /** Knocked down or smashed: no longer in the way. */
  gone?: boolean;
}

/** A loose object that can be knocked about, like a cone (or, with a length, a parked car). */
export interface Body extends Circle {
  vx: number;
  vy: number;
  /** 1 / mass, with the car's mass being 1. */
  invMass: number;
  /** Rotation: just for looks on a round body; which way a long one lies. */
  angle: number;
  spin: number;
  /** A long body (a parked car) is three circles of radius r along its angle, this long end to end. */
  length?: number;
  /** How quickly it slides to a stop on the ground (default 2.5; a parked car's handbrake is on). */
  damping?: number;
}

const CAR_RADIUS = CAR_WIDTH / 2;
/** Offsets of the car's three body circles along its heading. */
const CAR_HULL = [-(CAR_LENGTH / 2 - CAR_RADIUS), 0, CAR_LENGTH / 2 - CAR_RADIUS];
const CAR_INV_MASS = 1;
/** Moment of inertia of a solid rectangle with mass 1. */
const CAR_INV_INERTIA = 12 / (CAR_LENGTH * CAR_LENGTH + CAR_WIDTH * CAR_WIDTH);

/** Spatial hash of fixed circles, so a query only checks the few nearby. */
export class CircleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly found = new Set<number>();

  constructor(
    readonly circles: Circle[],
    private readonly cellSize = 64,
  ) {
    circles.forEach((c, i) => this.index(c, i));
  }

  /** Puts another circle in (a stump, say). */
  add(c: Circle): void {
    this.circles.push(c);
    this.index(c, this.circles.length - 1);
  }

  /** Circles that might overlap a circle of radius `r` at (x, y) (not those gone). */
  near(x: number, y: number, r: number): Circle[] {
    this.found.clear();
    this.forCells(x, y, r, (key) => {
      for (const i of this.cells.get(key) ?? []) this.found.add(i);
    });
    const out: Circle[] = [];
    for (const i of this.found) if (!this.circles[i].gone) out.push(this.circles[i]);
    return out;
  }

  private index(c: Circle, i: number): void {
    this.forCells(c.x, c.y, c.r, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(i);
      else this.cells.set(key, [i]);
    });
  }

  private forCells(x: number, y: number, r: number, fn: (key: number) => void): void {
    const s = this.cellSize;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++) {
      for (let cy = Math.floor((y - r) / s); cy <= Math.floor((y + r) / s); cy++) {
        fn((cx + 50_000) * 100_000 + (cy + 50_000));
      }
    }
  }
}

export interface ContactMaterial {
  /** 0 = dead stop, 1 = perfectly bouncy. */
  restitution: number;
  /** How much a sliding contact drags (Coulomb friction coefficient). */
  friction: number;
}

export const TYRE_WALL: ContactMaterial = { restitution: 0.3, friction: 0.35 };
export const CONE_HIT: ContactMaterial = { restitution: 0.5, friction: 0.2 };
export const CAR_BUMP: ContactMaterial = { restitution: 0.35, friction: 0.3 };
/** Brick and stone: a dull thud, and the car scrapes along. */
export const WALL_HIT: ContactMaterial = { restitution: 0.25, friction: 0.3 };

/** Filled in with where the strongest contact was, if a collision function is given one. */
export interface ContactPoint {
  x: number;
  y: number;
}

/**
 * Pushes the car out of any fixed circles it overlaps and applies the bounce and
 * scrape. Returns the strongest impulse (≈ speed lost into the wall, px/s), or 0.
 */
export function collideCarWithStatic(
  car: CarState,
  grid: CircleGrid,
  material = TYRE_WALL,
  contactOut?: ContactPoint,
): number {
  let strongest = 0;
  for (const offset of CAR_HULL) {
    for (const s of grid.near(...hullCentre(car, offset), CAR_RADIUS)) {
      const [cx, cy] = hullCentre(car, offset);
      const contact = overlap(cx, cy, CAR_RADIUS, s);
      if (!contact) continue;
      const { nx, ny, depth } = contact;
      // Contact point relative to the car's centre: the edge of this hull circle.
      const rx = cx - car.x - nx * CAR_RADIUS;
      const ry = cy - car.y - ny * CAR_RADIUS;
      car.x += nx * depth;
      car.y += ny * depth;
      const [impulse] = resolve(carSide(car, rx, ry), null, nx, ny, material);
      if (impulse > strongest) {
        strongest = impulse;
        if (contactOut) Object.assign(contactOut, { x: car.x + rx, y: car.y + ry });
      }
    }
  }
  return strongest;
}

/** A straight piece of wall (a building's side, a garden wall), `r` px thick either side of its line. */
export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Knocked down: no longer in the way. */
  gone?: boolean;
}

/** Spatial hash of wall segments, so a query only checks the few nearby. */
export class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly found = new Set<number>();
  private readonly out: Segment[] = [];

  constructor(
    readonly segments: Segment[],
    private readonly cellSize = 64,
  ) {
    segments.forEach((seg, i) => this.index(seg, i));
  }

  /** Puts another segment in (what's left of a wall, a fallen tree). */
  add(seg: Segment): void {
    this.segments.push(seg);
    this.index(seg, this.segments.length - 1);
  }

  private index(seg: Segment, i: number): void {
    // Every cell the segment's bounding box touches: walls are short, so that's only a few.
    const s = this.cellSize;
    for (let cx = Math.floor((Math.min(seg.ax, seg.bx) - seg.r) / s); cx <= Math.floor((Math.max(seg.ax, seg.bx) + seg.r) / s); cx++) {
      for (let cy = Math.floor((Math.min(seg.ay, seg.by) - seg.r) / s); cy <= Math.floor((Math.max(seg.ay, seg.by) + seg.r) / s); cy++) {
        const key = cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) cell.push(i);
        else this.cells.set(key, [i]);
      }
    }
  }

  /** Segments that might be within `r` of (x, y) (not those gone). The array is reused by the next call. */
  near(x: number, y: number, r: number): Segment[] {
    this.found.clear();
    this.out.length = 0;
    const s = this.cellSize;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++) {
      for (let cy = Math.floor((y - r) / s); cy <= Math.floor((y + r) / s); cy++) {
        for (const i of this.cells.get(cellKey(cx, cy)) ?? []) {
          if (this.found.has(i)) continue;
          this.found.add(i);
          if (!this.segments[i].gone) this.out.push(this.segments[i]);
        }
      }
    }
    return this.out;
  }
}

function cellKey(cx: number, cy: number): number {
  return (cx + 50_000) * 100_000 + (cy + 50_000);
}

/** The point on a segment nearest (x, y). */
export function nearestOnSegment(x: number, y: number, s: Segment): [number, number] {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len2));
  return [s.ax + dx * t, s.ay + dy * t];
}

/**
 * Pushes the car out of any walls it overlaps and applies the bounce and
 * scrape. Returns the strongest impulse (≈ speed lost into the wall, px/s), or 0.
 */
export function collideCarWithWalls(car: CarState, grid: SegmentGrid, material = WALL_HIT, contactOut?: ContactPoint): number {
  let strongest = 0;
  for (const offset of CAR_HULL) {
    let [cx, cy] = hullCentre(car, offset);
    for (const s of grid.near(cx, cy, CAR_RADIUS + 2)) {
      const [px, py] = nearestOnSegment(cx, cy, s);
      let nx = cx - px;
      let ny = cy - py;
      const dist = Math.hypot(nx, ny);
      const minDist = CAR_RADIUS + s.r;
      if (dist >= minDist) continue;
      if (dist < 1e-6) {
        // Right on the line: push out square to it, back the way the car came.
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
        nx = -(s.by - s.ay) / len;
        ny = (s.bx - s.ax) / len;
        if (nx * car.vx + ny * car.vy > 0) {
          nx = -nx;
          ny = -ny;
        }
      } else {
        nx /= dist;
        ny /= dist;
      }
      const depth = minDist - dist;
      const rx = px + nx * s.r - car.x;
      const ry = py + ny * s.r - car.y;
      car.x += nx * depth;
      car.y += ny * depth;
      cx += nx * depth;
      cy += ny * depth;
      const [impulse] = resolve(carSide(car, rx, ry), null, nx, ny, material);
      if (impulse > strongest) {
        strongest = impulse;
        if (contactOut) Object.assign(contactOut, { x: car.x + rx, y: car.y + ry });
      }
    }
  }
  return strongest;
}

/** Whether the car's body overlaps any of the circles (nothing is moved). */
export function carTouches(car: CarState, grid: CircleGrid): boolean {
  return CAR_HULL.some((offset) => {
    const [cx, cy] = hullCentre(car, offset);
    return grid.near(cx, cy, CAR_RADIUS).some((c) => overlap(cx, cy, CAR_RADIUS, c) !== null);
  });
}

/** Car against a loose object; both move. Returns the impulse (0 if not touching). */
export function collideCarWithBody(car: CarState, body: Body, material = CONE_HIT): number {
  // Too far apart to touch.
  const reach = CAR_LENGTH / 2 + (body.length ?? 0) / 2 + body.r;
  if (Math.abs(car.x - body.x) > reach || Math.abs(car.y - body.y) > reach) return 0;
  let strongest = 0;
  // A long body turns when hit off-centre, like a car; a round one just spins for show.
  const invInertia = body.length ? (12 * body.invMass) / (body.length ** 2 + (body.r * 2) ** 2) : 0;
  for (const offset of CAR_HULL) {
    for (const along of bodyHull(body)) {
      const [cx, cy] = hullCentre(car, offset);
      const bx = body.x + Math.cos(body.angle) * along;
      const by = body.y + Math.sin(body.angle) * along;
      const contact = overlap(cx, cy, CAR_RADIUS, { x: bx, y: by, r: body.r });
      if (!contact) continue;
      const { nx, ny, depth } = contact;
      const rx = cx - car.x - nx * CAR_RADIUS;
      const ry = cy - car.y - ny * CAR_RADIUS;
      // Separate in proportion to mass: the light object does most of the moving.
      const total = CAR_INV_MASS + body.invMass;
      car.x += nx * depth * (CAR_INV_MASS / total);
      car.y += ny * depth * (CAR_INV_MASS / total);
      body.x -= nx * depth * (body.invMass / total);
      body.y -= ny * depth * (body.invMass / total);
      // Touching at the edge of the body's circle, towards the car.
      const bodySide = { v: body, invMass: body.invMass, invInertia, rx: bx - body.x + nx * body.r, ry: by - body.y + ny * body.r };
      const [impulse, slip] = resolve(carSide(car, rx, ry), bodySide, nx, ny, material);
      if (!body.length) body.spin -= slip / body.r; // a cone clipped off-centre spins as it flies
      strongest = Math.max(strongest, impulse);
    }
  }
  return strongest;
}

/** Where a body's circles are along it, from its middle: just the one, or three along a long body. */
function bodyHull(body: Body): number[] {
  if (!body.length) return SINGLE;
  const end = body.length / 2 - body.r;
  return [-end, 0, end];
}
const SINGLE = [0];

/** Two cars bumping: both move and both can be spun. Returns the strongest impulse. */
export function collideCars(a: CarState, b: CarState, material = CAR_BUMP, contactOut?: ContactPoint): number {
  // Each car's hull reaches half its length from its centre, so further apart than a car length can't touch.
  if (Math.abs(a.x - b.x) > CAR_LENGTH || Math.abs(a.y - b.y) > CAR_LENGTH) return 0;
  let strongest = 0;
  for (const offsetA of CAR_HULL) {
    for (const offsetB of CAR_HULL) {
      const [ax, ay] = hullCentre(a, offsetA);
      const [bx, by] = hullCentre(b, offsetB);
      const contact = overlap(ax, ay, CAR_RADIUS, { x: bx, y: by, r: CAR_RADIUS });
      if (!contact) continue;
      const { nx, ny, depth } = contact;
      // Touching where the two hull circles meet.
      const px = ax - nx * CAR_RADIUS;
      const py = ay - ny * CAR_RADIUS;
      const sideA = carSide(a, px - a.x, py - a.y);
      const sideB = carSide(b, px - b.x, py - b.y);
      a.x += (nx * depth) / 2;
      a.y += (ny * depth) / 2;
      b.x -= (nx * depth) / 2;
      b.y -= (ny * depth) / 2;
      const [impulse] = resolve(sideA, sideB, nx, ny, material);
      if (impulse > strongest) {
        strongest = impulse;
        if (contactOut) Object.assign(contactOut, { x: px, y: py });
      }
    }
  }
  return strongest;
}

/** Bounces a loose object off fixed circles (all of a long body's circles, but without turning it). */
export function collideBodyWithStatic(body: Body, grid: CircleGrid, restitution = 0.4): void {
  for (const along of bodyHull(body)) {
    const cx = () => body.x + Math.cos(body.angle) * along;
    const cy = () => body.y + Math.sin(body.angle) * along;
    for (const s of grid.near(cx(), cy(), body.r)) {
      const contact = overlap(cx(), cy(), body.r, s);
      if (!contact) continue;
      const { nx, ny, depth } = contact;
      body.x += nx * depth;
      body.y += ny * depth;
      const vn = body.vx * nx + body.vy * ny;
      if (vn < 0) {
        body.vx -= (1 + restitution) * vn * nx;
        body.vy -= (1 + restitution) * vn * ny;
      }
    }
  }
}

/** Moves a loose object and slows it with ground friction. */
export function stepBody(body: Body, dt: number, damping = body.damping ?? 2.5): void {
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.angle += body.spin * dt;
  const k = Math.exp(-damping * dt);
  body.vx *= k;
  body.vy *= k;
  body.spin *= k;
}

function hullCentre(car: CarState, offset: number): [number, number] {
  return [car.x + Math.cos(car.heading) * offset, car.y + Math.sin(car.heading) * offset];
}

/** If circle (x, y, r) overlaps `other`, the push-out normal (pointing away from `other`) and depth. */
function overlap(x: number, y: number, r: number, other: Circle): { nx: number; ny: number; depth: number } | null {
  const dx = x - other.x;
  const dy = y - other.y;
  const dist = Math.hypot(dx, dy);
  const minDist = r + other.r;
  if (dist >= minDist) return null;
  // Exactly on top of each other: push out along any direction.
  if (dist < 1e-6) return { nx: 1, ny: 0, depth: minDist };
  return { nx: dx / dist, ny: dy / dist, depth: minDist - dist };
}

/** One side of a contact: what moves, how heavy it is, and where it's touched (relative to its centre). */
interface ContactSide {
  v: { vx: number; vy: number; spin: number };
  invMass: number;
  invInertia: number;
  rx: number;
  ry: number;
}

function carSide(car: CarState, rx: number, ry: number): ContactSide {
  return { v: car, invMass: CAR_INV_MASS, invInertia: CAR_INV_INERTIA, rx, ry };
}

/**
 * Applies the collision impulse between `a` and `b` (null = something fixed)
 * with normal n pointing from b towards a. Returns the normal impulse and the
 * sliding speed along the contact before friction.
 */
function resolve(
  a: ContactSide,
  b: ContactSide | null,
  nx: number,
  ny: number,
  { restitution, friction }: ContactMaterial,
): [impulse: number, slip: number] {
  const pointVel = (s: ContactSide): [number, number] => [s.v.vx - s.v.spin * s.ry, s.v.vy + s.v.spin * s.rx];
  const relVel = (): [number, number] => {
    const [ax, ay] = pointVel(a);
    const [bx, by] = b ? pointVel(b) : [0, 0];
    return [ax - bx, ay - by];
  };
  // How hard it is to change the relative velocity along direction d.
  const effectiveInvMass = (dx: number, dy: number) => {
    const term = (s: ContactSide) => {
      const r = s.rx * dy - s.ry * dx;
      return s.invMass + r * r * s.invInertia;
    };
    return term(a) + (b ? term(b) : 0);
  };
  const apply = (px: number, py: number) => {
    a.v.vx += px * a.invMass;
    a.v.vy += py * a.invMass;
    a.v.spin += (a.rx * py - a.ry * px) * a.invInertia;
    if (b) {
      b.v.vx -= px * b.invMass;
      b.v.vy -= py * b.invMass;
      b.v.spin -= (b.rx * py - b.ry * px) * b.invInertia;
    }
  };

  const [vx, vy] = relVel();
  const vn = vx * nx + vy * ny;
  if (vn >= 0) return [0, 0]; // already moving apart

  const jn = (-(1 + restitution) * vn) / effectiveInvMass(nx, ny);
  apply(nx * jn, ny * jn);

  // Friction along the contact surface, limited by how hard the hit was.
  const tx = -ny;
  const ty = nx;
  const [vx2, vy2] = relVel();
  const vt = vx2 * tx + vy2 * ty;
  const jtMax = friction * jn;
  const jt = Math.max(-jtMax, Math.min(jtMax, -vt / effectiveInvMass(tx, ty)));
  apply(tx * jt, ty * jt);
  return [jn, vt];
}
