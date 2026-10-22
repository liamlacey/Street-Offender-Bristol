/**
 * What you can drive, and you on foot. Each kind of vehicle you can take
 * handles as it would (CarPhysics's model, tuned): a little car's nippy, a
 * van's slower and leans on its tyres sooner, a lorry or a bus is slow to get
 * going and slow to turn, a bike pulls away quickly but tops out at a cyclist's
 * speed. On foot you turn on the spot and walk (or run) the way you face, as
 * in the old games. Pure, so it's tested.
 */

import { type CarInput, type CarState, type CarTuning, DEFAULT_TUNING, type SurfaceGrip } from './CarPhysics';
import type { VehicleKind } from '../world/traffic';

const M = 8;

/** Each kind's handling: a quick car's (DEFAULT_TUNING), changed. */
const TUNED: Record<VehicleKind, Partial<CarTuning>> = {
  // Your armoured truck: a big engine for its weight, but it's heavy to stop and to turn.
  own: { engineAccel: 340, maxForwardSpeed: 360, brakeDecel: 620, maxTurnRate: 2.8, fullSteerSpeed: 120, grip: 9.5, climbSpeedLoss: 2 },
  small: { engineAccel: 320, maxForwardSpeed: 330, maxTurnRate: 3.5 },
  // The emergency services': a quick police car; an ambulance, quicker than a van; a fire engine, a lorry but punchier.
  police: { engineAccel: 380, maxForwardSpeed: 400, maxTurnRate: 3.3 },
  ambulance: { engineAccel: 250, maxForwardSpeed: 300, maxTurnRate: 2.6, grip: 7.5, brakeDecel: 580 },
  fire: { engineAccel: 170, maxForwardSpeed: 240, maxTurnRate: 2, grip: 7, brakeDecel: 470, fullSteerSpeed: 140, climbSpeedLoss: 3.5 },
  hatch: { engineAccel: 330, maxForwardSpeed: 340 },
  saloon: { engineAccel: 340, maxForwardSpeed: 360, maxTurnRate: 3.2 },
  estate: { engineAccel: 320, maxForwardSpeed: 350, maxTurnRate: 3.1 },
  suv: { engineAccel: 300, maxForwardSpeed: 330, maxTurnRate: 3, grip: 8 },
  van: { engineAccel: 230, maxForwardSpeed: 280, maxTurnRate: 2.7, grip: 7.5, brakeDecel: 600 },
  lorry: { engineAccel: 140, maxForwardSpeed: 220, maxTurnRate: 2, grip: 7, brakeDecel: 450, fullSteerSpeed: 140, climbSpeedLoss: 4 },
  bus: { engineAccel: 120, maxForwardSpeed: 200, maxTurnRate: 1.8, grip: 7, brakeDecel: 420, fullSteerSpeed: 150, climbSpeedLoss: 4 },
  double: { engineAccel: 110, maxForwardSpeed: 190, maxTurnRate: 1.7, grip: 7, brakeDecel: 420, fullSteerSpeed: 150, climbSpeedLoss: 4.5 },
  // About 14 m/s flat out (fast for a bike), 3 on the flat in reverse (pushing it), turning sharply, and gripping.
  bike: {
    engineAccel: 150,
    maxForwardSpeed: 110,
    brakeDecel: 500,
    reverseAccel: 40,
    maxReverseSpeed: 24,
    maxTurnRate: 4.2,
    fullSteerSpeed: 40,
    grip: 14,
    handbrakeGrip: 3,
    rollingDrag: 0.35,
    climbSpeedLoss: 5,
    descentSpeedGain: 1.6,
  },
};

/**
 * How little the going and what it hits matter to it: your armoured truck's
 * built for anything. `terrain`, how much of the grass's (the dirt's, the
 * mud's) slip and drag it shrugs off; `people`, how much of the knock of
 * hitting someone it feels, against an ordinary car's 1.
 */
export const RUGGED: Partial<Record<VehicleKind, { terrain: number; people: number }>> = {
  own: { terrain: 0.9, people: 0.25 },
};

/** The grip it gets on a surface, as rugged as it is (see RUGGED). */
export function surfaceFor(kind: VehicleKind, s: SurfaceGrip): SurfaceGrip {
  const r = RUGGED[kind]?.terrain ?? 0;
  return r ? { grip: s.grip + (1 - s.grip) * r, drag: s.drag + (1 - s.drag) * r } : s;
}

const tunings = new Map<VehicleKind, CarTuning>();

export function tuningFor(kind: VehicleKind): CarTuning {
  let t = tunings.get(kind);
  if (!t) {
    t = { ...DEFAULT_TUNING, ...TUNED[kind] };
    tunings.set(kind, t);
  }
  return t;
}

/** You on foot: how big (as a body, px), how heavy (1 / your mass against your car's 1), how fast you run and back off, px/s, and turn, radians/s. */
export const WALKER = { size: 0.6 * M, invMass: 12.5, run: 5.5 * M, back: 1.4 * M, turn: 4.2 };

/** A step on foot: turning on the spot with the steering, running ahead with the throttle, backing off with the brake. */
export function stepWalker(you: CarState, input: CarInput, dt: number): void {
  you.heading += input.steer * WALKER.turn * dt;
  you.heading = Math.atan2(Math.sin(you.heading), Math.cos(you.heading));
  const want = input.throttle > 0 ? WALKER.run * input.throttle : input.brake > 0 ? -WALKER.back * input.brake : 0;
  const [ux, uy] = [Math.cos(you.heading), Math.sin(you.heading)];
  // Quick to get going and to stop (and anything knocking you about dies away as quickly).
  const k = 1 - Math.exp(-10 * dt);
  you.vx += (ux * want - you.vx) * k;
  you.vy += (uy * want - you.vy) * k;
  you.spin = 0;
  you.x += you.vx * dt;
  you.y += you.vy * dt;
}
