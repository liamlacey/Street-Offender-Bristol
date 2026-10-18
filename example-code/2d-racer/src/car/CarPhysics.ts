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

/** Car body size in px (the sprite is drawn to match). */
export const CAR_LENGTH = 44;
export const CAR_WIDTH = 24;

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
}

export const DEFAULT_TUNING: CarTuning = {
  engineAccel: 520,
  brakeDecel: 900,
  reverseAccel: 350,
  maxForwardSpeed: 620,
  maxReverseSpeed: 220,
  rollingDrag: 0.6,
  maxTurnRate: 3.6,
  fullSteerSpeed: 160,
  grip: 9,
  handbrakeGrip: 1.4,
  handbrakeDecel: 260,
  spinDamping: 3,
};

export type SurfaceKind = 'road' | 'kerb' | 'grass' | 'gravel' | 'dirt' | 'mud' | 'water' | 'bridge' | 'snow' | 'ice' | 'drift' | 'sand';

/** How a surface changes the car's handling, as multipliers on the tuning values. */
export interface SurfaceGrip {
  grip: number;
  drag: number;
}

export const SURFACE_GRIP: Record<SurfaceKind, SurfaceGrip> = {
  road: { grip: 1, drag: 1 },
  kerb: { grip: 1, drag: 1.4 },
  // Slippery and draggy: top speed on grass is well under half that on the road.
  grass: { grip: 0.5, drag: 3.6 },
  // Gravel traps: worse again, they're there to stop cars that run wide.
  gravel: { grip: 0.4, drag: 7 },
  // A dirt road: looser than tarmac, so the car slides about more, but still quick.
  dirt: { grip: 0.72, drag: 1.15 },
  // Thick mud bogs the car down and it slithers.
  mud: { grip: 0.45, drag: 3 },
  // Fords and puddles: the water drags at the car and it aquaplanes a little.
  water: { grip: 0.6, drag: 3 },
  // Wooden bridge planks drive like the road.
  bridge: { grip: 0.95, drag: 1 },
  // Packed snow: the car slides about a lot, but keeps its speed.
  snow: { grip: 0.55, drag: 1.15 },
  // Sheet ice: barely any grip at all, and nothing to slow you down.
  ice: { grip: 0.2, drag: 0.6 },
  // Deep snow off the road and drifts across it: the car ploughs in and bogs down.
  drift: { grip: 0.45, drag: 4.2 },
  // Soft sand off the road and blown across it: the wheels dig in and the car wallows.
  sand: { grip: 0.5, drag: 3.4 },
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
): void {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let vF = car.vx * cos + car.vy * sin;
  let vR = -car.vx * sin + car.vy * cos;

  if (input.throttle > 0) {
    vF = Math.min(vF + tuning.engineAccel * input.throttle * dt, Math.max(vF, tuning.maxForwardSpeed));
  }
  if (input.brake > 0) {
    if (vF > 1) {
      vF = Math.max(0, vF - tuning.brakeDecel * input.brake * dt);
    } else {
      vF = Math.max(vF - tuning.reverseAccel * input.brake * dt, Math.min(vF, -tuning.maxReverseSpeed));
    }
  }

  vF -= vF * Math.min(tuning.rollingDrag * surface.drag * dt, 1);
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
