/**
 * An AI driver. It only ever produces the same inputs a player can (throttle,
 * brake, steer), so AI cars use exactly the same physics as the player's car.
 */

import { type CarInput, type CarState, forwardSpeed } from '../car/CarPhysics';
import { type Track, locateOnTrack } from '../track/Track';
import type { RacingLine } from './racingLine';

export interface DriverProfile {
  name: string;
  /** Car colour (0xRRGGBB). */
  color: number;
  /** Multiplier on the racing line's target speeds: 1 = flat out, lower = more cautious. */
  pace: number;
  /** Slow weave either side of the ideal line in px, so drivers aren't robotic. */
  wobble: number;
}

/** Seconds of travel to aim ahead (plus a fixed minimum), for steering. */
const AIM_AHEAD_TIME = 0.32;
const AIM_AHEAD_MIN = 70;
const STEER_GAIN = 2.6;
/** How far ahead (px) and how close sideways another car must be to need passing. */
const AVOID_AHEAD = 150;
const AVOID_SIDE = 40;
/** Sideways gap to leave when passing another car. */
const PASS_GAP = 46;

export class AiDriver {
  private avoidOffset = 0;
  private stuckFor = 0;
  private reversingFor = 0;
  private clock = 0;
  private readonly phase: number;

  constructor(
    private readonly track: Track,
    private readonly line: RacingLine,
    readonly profile: DriverProfile,
    seed = 0,
  ) {
    this.phase = seed * 2.39996; // spread drivers' weaves apart
  }

  drive(car: CarState, others: CarState[], dt: number): CarInput {
    this.clock += dt;
    const { track, line } = this;
    const n = track.points.length;
    const pos = locateOnTrack(track, car.x, car.y);
    const i = Math.round(pos.along / track.spacing) % n;
    const speed = forwardSpeed(car);

    // Aim at a point a little way ahead on the racing line, nudged sideways to pass or weave.
    const ahead = Math.round((AIM_AHEAD_MIN + AIM_AHEAD_TIME * Math.abs(speed)) / track.spacing);
    const j = (i + ahead) % n;
    this.updateAvoidance(car, others, j, dt);
    const wobble = this.profile.wobble * Math.sin(this.clock * 0.6 + this.phase);
    const offset = clamp(line.offsets[j] + this.avoidOffset + wobble, line.lo[j], line.hi[j]);
    const tx = track.points[j].x + track.normals[j].x * offset;
    const ty = track.points[j].y + track.normals[j].y * offset;
    const error = wrapAngle(Math.atan2(ty - car.y, tx - car.x) - car.heading);
    const steer = clamp(error * STEER_GAIN, -1, 1);

    // Stuck against something (or the wrong way round in a corner): back out for a moment.
    if (this.reversingFor > 0) {
      this.reversingFor -= dt;
      // Steering is reversed when going backwards, so steer the other way to swing the nose round.
      return { throttle: 0, brake: 1, steer: -steer, handbrake: false };
    }
    this.stuckFor = Math.abs(speed) < 25 ? this.stuckFor + dt : 0;
    if (this.stuckFor > 0.8) {
      this.stuckFor = 0;
      this.reversingFor = 0.9;
    }

    // Target speed from the racing line just ahead, slower if pointing well off line (after a spin).
    let target = Infinity;
    for (let k = 1; k <= 3; k++) target = Math.min(target, line.speeds[(i + k) % n]);
    target *= this.profile.pace;
    if (Math.abs(error) > 1) target = Math.min(target, 180);
    target = Math.min(target, this.blockedSpeed(car, others) ?? Infinity);

    if (speed < target - 15) return { throttle: 1, brake: 0, steer, handbrake: false };
    if (speed > target + 25 && speed > 40) return { throttle: 0, brake: 1, steer, handbrake: false };
    return { throttle: 0.4, brake: 0, steer, handbrake: false };
  }

  /** Eases the sideways offset towards a gap beside any slower car in the way, or back to the line. */
  private updateAvoidance(car: CarState, others: CarState[], j: number, dt: number): void {
    const { track, line } = this;
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    let wanted = 0;
    for (const other of others) {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const along = dx * fx + dy * fy;
      const side = -dx * fy + dy * fx;
      if (along <= 0 || along > AVOID_AHEAD || Math.abs(side) > AVOID_SIDE) continue;
      if (forwardSpeed(other) > forwardSpeed(car) + 20) continue; // pulling away, no need to pass
      // Go round whichever side of it has more road.
      const otherOffset =
        (other.x - track.points[j].x) * track.normals[j].x + (other.y - track.points[j].y) * track.normals[j].y;
      const passRight = otherOffset < 0;
      wanted = otherOffset + (passRight ? PASS_GAP : -PASS_GAP) - line.offsets[j];
      break;
    }
    this.avoidOffset += (wanted - this.avoidOffset) * (1 - Math.exp(-4 * dt));
  }

  /** If a car is right in front and there's no way past yet, match its speed instead of ramming it. */
  private blockedSpeed(car: CarState, others: CarState[]): number | null {
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    for (const other of others) {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const along = dx * fx + dy * fy;
      const side = -dx * fy + dy * fx;
      if (along > 0 && along < 65 && Math.abs(side) < 22) return Math.max(0, forwardSpeed(other) - 10);
    }
    return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
