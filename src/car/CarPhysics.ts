/**
 * Arcade top-down car model, independent of Phaser so it can be unit tested.
 *
 * Velocity is split into a forward component (along the car's heading) and a
 * lateral component (sideways). Tyre grip bleeds off the lateral component each
 * step; lowering grip (handbrake) lets the car slide, which is what gives the
 * Micro Machines style drift.
 *
 * Units: pixels, seconds, radians. Heading 0 points along +x (screen right),
 * and positive steering turns clockwise on screen (y points down).
 */

/** Car body size in px (the sprite is drawn to match): 4.75 m by 2.25 m at 8 px a metre. */
export const CAR_LENGTH = 38;
export const CAR_WIDTH = 18;

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — brakes when moving forward, reverses when (nearly) stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
}

export interface CarState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  /** Yaw rate in rad/s from collisions (steering turns the car directly, not through this). */
  spin: number;
}

export interface CarTuning {
  engineAccel: number;
  brakeDecel: number;
  reverseAccel: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  /** Fraction of forward speed lost per second when coasting. */
  rollingDrag: number;
  /** Max turn rate in rad/s once at or above `fullSteerSpeed`. */
  maxTurnRate: number;
  /** Below this speed, steering is scaled down so the car can't spin on the spot. */
  fullSteerSpeed: number;
  /** How quickly sideways velocity is killed (per second). Higher = grippier. */
  grip: number;
  handbrakeGrip: number;
  /** Forward speed lost per second while the handbrake is held. */
  handbrakeDecel: number;
  /** How quickly spin from a collision dies away (per second). */
  spinDamping: number;
  /** Gravity pulling the car down a hill, px/s² for a vertical drop (real gravity, 78 px/s², made a bit stronger so you feel it). */
  hillGravity: number;
  /** How much of its top speed the car loses climbing, for each unit of the slope's sine (a 1 in 10 hill's is 0.1). */
  climbSpeedLoss: number;
  /** And how much faster it can go downhill. */
  descentSpeedGain: number;
}

/** How steep the ground is under the car: its rise per metre east and per metre south (y is down). */
export interface Slope {
  x: number;
  y: number;
}

export const FLAT: Slope = { x: 0, y: 0 };

/** A quick city car: 400 px/s is 50 m/s, 112 mph. */
export const DEFAULT_TUNING: CarTuning = {
  engineAccel: 400,
  brakeDecel: 760,
  reverseAccel: 300,
  maxForwardSpeed: 400,
  maxReverseSpeed: 150,
  rollingDrag: 0.5,
  maxTurnRate: 3.4,
  fullSteerSpeed: 110,
  grip: 9,
  handbrakeGrip: 1.3,
  handbrakeDecel: 200,
  spinDamping: 3,
  hillGravity: 160,
  climbSpeedLoss: 2.5,
  descentSpeedGain: 1.2,
};

export type SurfaceKind = 'road' | 'pavement' | 'grass' | 'dirt' | 'mud' | 'water';

/** How a surface changes the car's handling, as multipliers on the tuning values. */
export interface SurfaceGrip {
  grip: number;
  drag: number;
}

export const SURFACE_GRIP: Record<SurfaceKind, SurfaceGrip> = {
  road: { grip: 1, drag: 1 },
  // Paving slabs and setts: a touch less grip than tarmac.
  pavement: { grip: 0.9, drag: 1.1 },
  // Slippery and draggy: top speed on grass is well under half that on the road.
  grass: { grip: 0.5, drag: 4.6 },
  // Bare earth (building sites): looser than tarmac, so the car slides about more.
  dirt: { grip: 0.72, drag: 1.6 },
  // Flowerbeds: soft soil bogs the car down and it slithers.
  mud: { grip: 0.45, drag: 6 },
  // Fountains and pools: the water drags at the car and it aquaplanes a little.
  water: { grip: 0.6, drag: 5 },
};

export const NO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export function createCar(x = 0, y = 0, heading = 0): CarState {
  return { x, y, heading, vx: 0, vy: 0, spin: 0 };
}

/** Speed along the car's heading (negative when reversing). */
export function forwardSpeed(car: CarState): number {
  return car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
}

/** Sideways speed relative to the car's heading — non-zero while sliding. */
export function lateralSpeed(car: CarState): number {
  return -car.vx * Math.sin(car.heading) + car.vy * Math.cos(car.heading);
}

/** Advances the car by `dt` seconds in place. Use a fixed `dt` for consistent handling. */
export function stepCar(
  car: CarState,
  input: CarInput,
  dt: number,
  surface: SurfaceGrip = SURFACE_GRIP.road,
  tuning: CarTuning = DEFAULT_TUNING,
  slope: Slope = FLAT,
): void {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let vF = car.vx * cos + car.vy * sin;
  let vR = -car.vx * sin + car.vy * cos;

  // The hill: how steep it is the way the car's pointing (the sine of the angle, + uphill) and across it.
  const norm = Math.sqrt(1 + slope.x * slope.x + slope.y * slope.y);
  const climb = (slope.x * cos + slope.y * sin) / norm;
  const tilt = (-slope.x * sin + slope.y * cos) / norm;
  const topSpeed = tuning.maxForwardSpeed * (1 - tuning.climbSpeedLoss * Math.max(0, climb) + tuning.descentSpeedGain * Math.max(0, -climb));

  if (input.throttle > 0) {
    vF = Math.min(vF + tuning.engineAccel * input.throttle * dt, Math.max(vF, topSpeed));
  }
  if (input.brake > 0) {
    if (vF > 1) {
      vF = Math.max(0, vF - tuning.brakeDecel * input.brake * dt);
    } else {
      vF = Math.max(vF - tuning.reverseAccel * input.brake * dt, Math.min(vF, -tuning.maxReverseSpeed));
    }
  }

  vF -= vF * Math.min(tuning.rollingDrag * surface.drag * dt, 1);
  // Gravity, down the hill: slowing the car climbing, speeding it descending, and rolling it back if
  // it stops on a steep one (the handbrake holds it).
  const held = input.handbrake && Math.abs(vF) < 30;
  const resting = Math.abs(vF) < 5 && input.throttle === 0 && input.brake === 0 && Math.hypot(climb, tilt) < 0.06;
  if (!held && !resting) {
    vF -= tuning.hillGravity * climb * dt;
    vR -= tuning.hillGravity * tilt * dt;
  }
  if (input.handbrake) {
    vF = moveTowardZero(vF, tuning.handbrakeDecel * dt);
  }

  const grip = (input.handbrake ? tuning.handbrakeGrip : tuning.grip) * surface.grip;
  vR *= Math.exp(-grip * dt);

  // Rebuild velocity from the pre-turn heading, then turn the car. The velocity
  // lagging behind the heading is what makes the car slide through corners.
  car.vx = vF * cos - vR * sin;
  car.vy = vF * sin + vR * cos;

  const steerScale = Math.min(Math.abs(vF) / tuning.fullSteerSpeed, 1);
  const turnDirection = vF >= 0 ? 1 : -1; // steering inverts when reversing, like a real car
  const steerRate = input.steer * tuning.maxTurnRate * steerScale * turnDirection;
  car.heading = wrapAngle(car.heading + (steerRate + car.spin) * dt);
  car.spin *= Math.exp(-tuning.spinDamping * dt);

  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

function moveTowardZero(value: number, amount: number): number {
  return value > 0 ? Math.max(0, value - amount) : Math.min(0, value + amount);
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
