import { describe, expect, it } from 'vitest';
import { NO_INPUT, SURFACE_GRIP, createCar, stepCar } from '../car/CarPhysics';
import { CircleGrid, collideCarWithStatic } from '../physics/collisions';
import { CONE_RADIUS, RUN_OFF, TYRE_RADIUS, buildBarriers, placeCones } from './barriers';
import { buildTrack, locateOnTrack, surfaceOf } from './Track';
import { TRACKS } from './tracks';

const DT = 1 / 120;

describe.each(TRACKS.map((def) => [def.name, def] as const))('barriers: %s', (_name, def) => {
  const track = buildTrack(def);
  const barriers = buildBarriers(track);
  const grid = new CircleGrid(barriers.map((b) => ({ ...b, r: TYRE_RADIUS })));
  const halfOuter = track.width / 2 + track.kerbWidth;

  it('keeps every tyre off the road', () => {
    for (const t of barriers) {
      const pos = locateOnTrack(track, t.x, t.y);
      expect(pos.distance).toBeGreaterThan(pos.halfWidth + TYRE_RADIUS);
    }
  });

  it('keeps every tyre within the run-off distance', () => {
    for (const t of barriers) {
      const pos = locateOnTrack(track, t.x, t.y);
      expect(pos.distance).toBeLessThan(pos.halfWidth + track.kerbWidth + RUN_OFF + TYRE_RADIUS + 1);
    }
  });

  it('stops a car driven off the track anywhere, at any angle', () => {
    const n = track.points.length;
    for (let i = 0; i < n; i += 8) {
      const p = track.points[i];
      const heading = Math.atan2(track.normals[i].x, -track.normals[i].y); // track direction
      for (const side of [1, -1]) {
        for (const angle of [0.4, 0.9, 1.5]) {
          const car = createCar(p.x, p.y, heading + side * angle);
          car.vx = 600 * Math.cos(car.heading);
          car.vy = 600 * Math.sin(car.heading);
          let along = locateOnTrack(track, car.x, car.y).along;
          for (let t = 0; t < 2.5; t += DT) {
            const pos = locateOnTrack(track, car.x, car.y);
            stepCar(car, { ...NO_INPUT, throttle: 1 }, DT, SURFACE_GRIP[surfaceOf(track, pos)]);
            collideCarWithStatic(car, grid);
            // Never past the barrier...
            expect(pos.distance).toBeLessThan(halfOuter + RUN_OFF + 2 * TYRE_RADIUS);
            // ...and never through to a different part of the track (the closest
            // point on the track would suddenly jump).
            const jump = Math.abs(pos.along - along);
            expect(Math.min(jump, track.length - jump)).toBeLessThan(150);
            along = pos.along;
          }
        }
      }
    }
  });

  it('puts cones just off the road on the inside of corners', () => {
    const cones = placeCones(track, barriers);
    expect(cones.length).toBeGreaterThan(5);
    for (const c of cones) {
      const d = locateOnTrack(track, c.x, c.y).distance;
      expect(d).toBeGreaterThan(halfOuter);
      expect(d).toBeLessThan(halfOuter + 3 * CONE_RADIUS);
    }
  });
});
