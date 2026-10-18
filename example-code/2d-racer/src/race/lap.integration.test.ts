import { describe, expect, it } from 'vitest';
import { type CarInput, SURFACE_GRIP, createCar, stepCar } from '../car/CarPhysics';
import { CircleGrid, collideCarWithStatic } from '../physics/collisions';
import { TYRE_RADIUS, buildBarriers } from '../track/barriers';
import { buildTrack, locateOnTrack, poseAt, surfaceOf } from '../track/Track';
import { TRACKS } from '../track/tracks';
import { LapTracker } from './LapTracker';

const DT = 1 / 120;

/** Simple autopilot: aim at a point ahead on the centre line, lift off for sharp corners. */
function autopilot(track: ReturnType<typeof buildTrack>, x: number, y: number, heading: number, speed: number): CarInput {
  const pos = locateOnTrack(track, x, y);
  const target = poseAt(track, pos.along + 260);
  const desired = Math.atan2(target.y - y, target.x - x);
  const error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  const sharp = Math.abs(error) > 0.35;
  return {
    throttle: sharp && speed > 300 ? 0 : 1,
    brake: sharp && speed > 420 ? 1 : 0,
    steer: Math.max(-1, Math.min(1, error * 3)),
    handbrake: false,
  };
}

describe.each(TRACKS.map((def) => [def.name, def] as const))('driving a lap of %s', (_name, def) => {
  it('completes laps with the real physics, staying on the road and off the barriers', () => {
    const track = buildTrack(def);
    const barriers = new CircleGrid(buildBarriers(track).map((b) => ({ ...b, r: TYRE_RADIUS })));
    let barrierHits = 0;
    const start = poseAt(track, -120);
    const car = createCar(start.x, start.y, start.heading);
    const laps = new LapTracker(track.length);
    const results = [];
    let offRoadSteps = 0;

    for (let t = 0; t < 120 && results.length < 2; t += DT) {
      const pos = locateOnTrack(track, car.x, car.y);
      const surface = surfaceOf(track, pos);
      if (surface === 'grass') offRoadSteps++;
      stepCar(car, autopilot(track, car.x, car.y, car.heading, Math.hypot(car.vx, car.vy)), DT, SURFACE_GRIP[surface]);
      if (collideCarWithStatic(car, barriers) > 0) barrierHits++;
      const lap = laps.update(pos.along, t);
      if (lap) results.push(lap);
    }

    expect(results).toHaveLength(2);
    // A lap at a sensible pace: not instant (cheating) and not crawling.
    for (const lap of results) {
      expect(lap.time).toBeGreaterThan(track.length / 700);
      expect(lap.time).toBeLessThan(track.length / 150);
    }
    expect(offRoadSteps * DT).toBeLessThan(1);
    expect(barrierHits).toBe(0);
  });
});
