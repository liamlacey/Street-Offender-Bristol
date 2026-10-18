import { describe, expect, it } from 'vitest';
import { SURFACE_GRIP, createCar, stepCar } from '../car/CarPhysics';
import { AiDriver } from '../ai/AiDriver';
import { DEFAULT_LINE, buildRacingLine } from '../ai/racingLine';
import { LOCATIONS, LOCATION_LIST, cornerScale } from '../locations/locations';
import { drivingSurface, planDecoration } from './decoration';
import { CircleGrid, carTouches, collideCarWithStatic } from '../physics/collisions';
import { LapTracker } from '../race/LapTracker';
import { CONE_RADIUS, TYRE_RADIUS, buildBarriers, obstaclePieces } from './barriers';
import { TRACK_DIFFICULTIES, TRACK_LENGTHS, generateTrack } from './generate';
import { buildTrack, layoutProblem, locateOnTrack, poseAt, turnRadii } from './Track';

const SEEDS = Array.from({ length: 12 }, (_, i) => i * 7919 + 1);
const EXPECTED_LENGTH = { short: [15000, 21000], medium: [24500, 33500], long: [37500, 50000] };

const cases = LOCATION_LIST.flatMap((loc) =>
  TRACK_LENGTHS.flatMap((len) => TRACK_DIFFICULTIES.map((diff) => [loc.name, len, diff, loc] as const)),
);

describe.each(cases)('generated %s tracks, %s, %s', (_name, length, difficulty, location) => {
  it('are always raceable, the right length, and start on a full-width straight', { timeout: 30_000 }, () => {
    for (const seed of SEEDS) {
      const def = generateTrack(location, length, seed, difficulty);
      const track = buildTrack(def);
      expect(layoutProblem(track)).toBeNull();
      expect(track.length).toBeGreaterThan(EXPECTED_LENGTH[length][0]);
      expect(track.length).toBeLessThan(EXPECTED_LENGTH[length][1]);
      const radii = turnRadii(track, 4);
      for (let k = -6; k <= 2; k++) {
        const i = (k + radii.length) % radii.length;
        expect(radii[i]).toBeGreaterThan(400);
        expect(track.halfWidths[i] * 2).toBeCloseTo(def.width, 0);
      }
      // Fixed barriers never overlap the road (they may touch the kerb in tight spots).
      for (const t of buildBarriers(track)) {
        const pos = locateOnTrack(track, t.x, t.y);
        expect(pos.distance).toBeGreaterThan(pos.halfWidth + TYRE_RADIUS);
      }
      // Obstacles keep clear of the grid and always leave a gap of at least two car widths.
      for (const o of track.obstacles) {
        expect(o.along).toBeGreaterThan(300);
        expect(o.along).toBeLessThan(track.length - 1200);
        const i = Math.round(o.along / track.spacing) % track.points.length;
        expect(track.halfWidths[i] * 2 - o.reach * 2).toBeGreaterThan(48);
      }
    }
  });

  it('makes the same track from the same seed, and different ones from different seeds', () => {
    expect(generateTrack(location, length, 42, difficulty)).toEqual(generateTrack(location, length, 42, difficulty));
    expect(generateTrack(location, length, 42, difficulty)).not.toEqual(generateTrack(location, length, 43, difficulty));
  });

  it('can be lapped cleanly by the AI, without touching a barrier or an obstacle', { timeout: 30_000 }, () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const track = buildTrack(generateTrack(location, length, seed, difficulty));
      // As in a real race: the location's road surface, and the decoration (mud, water, log piles...).
      const tyres = buildBarriers(track);
      const deco = planDecoration(track, tyres, location.decoration, 600, difficulty);
      const grid = new CircleGrid([...tyres.map((b) => ({ ...b, r: TYRE_RADIUS })), ...deco.solids]);
      const pieces = obstaclePieces(track);
      const obstacles = new CircleGrid([
        ...pieces.tyres.map((p) => ({ ...p, r: TYRE_RADIUS })),
        ...pieces.cones.map((p) => ({ ...p, r: CONE_RADIUS })),
      ]);
      const line = buildRacingLine(track, {
        cornerFactor: DEFAULT_LINE.cornerFactor * cornerScale(location),
        edgeMargin: DEFAULT_LINE.edgeMargin + (location.road.keepOff ?? 0),
      });
      const ai = new AiDriver(track, line, { name: 'test', color: 0, pace: 1, wobble: 0 });
      const start = poseAt(track, -120);
      const car = createCar(start.x, start.y, start.heading);
      const laps = new LapTracker(track.length);
      let lapped = false;
      let hits = 0;
      for (let t = 0; t < 150 && !lapped; t += 1 / 120) {
        const pos = locateOnTrack(track, car.x, car.y);
        stepCar(car, ai.drive(car, [], 1 / 120), 1 / 120, SURFACE_GRIP[drivingSurface(track, deco, location, pos, car.x, car.y)]);
        if (collideCarWithStatic(car, grid) > 0 || carTouches(car, obstacles)) hits++;
        if (laps.update(pos.along, t)) lapped = true;
      }
      expect(lapped, `seed ${seed} not lapped`).toBe(true);
      expect(hits, `seed ${seed} hit a barrier or obstacle`).toBe(0);
    }
  });
});

describe('track difficulty', () => {
  /** Averages over several tracks of the same length. */
  function stats(difficulty: (typeof TRACK_DIFFICULTIES)[number]) {
    const tracks = SEEDS.slice(0, 8).map((seed) => buildTrack(generateTrack(LOCATIONS.docklands, 'medium', seed, difficulty)));
    const avg = (f: (t: (typeof tracks)[number]) => number) => tracks.reduce((s, t) => s + f(t), 0) / tracks.length;
    return {
      // Share of the lap spent in corners tighter than 600px radius.
      cornering: avg((t) => turnRadii(t, 4).filter((r) => r < 600).length / t.points.length),
      tightest: avg((t) => Math.min(...turnRadii(t, 4))),
      widthSwing: avg((t) => (Math.max(...t.halfWidths) - Math.min(...t.halfWidths)) * 2),
      obstacles: avg((t) => t.obstacles.length),
      runOff: avg((t) => t.runOff ?? 0),
    };
  }

  it('makes harder tracks twistier, tighter, narrower in places, more obstructed and with less run-off', () => {
    const [easy, medium, hard] = TRACK_DIFFICULTIES.map(stats);
    expect(medium.cornering).toBeGreaterThan(easy.cornering);
    expect(hard.cornering).toBeGreaterThan(medium.cornering);
    expect(hard.tightest).toBeLessThan(easy.tightest);
    expect(easy.widthSwing).toBe(0);
    expect(hard.widthSwing).toBeGreaterThan(medium.widthSwing);
    expect(easy.obstacles).toBe(0);
    expect(hard.obstacles).toBeGreaterThan(medium.obstacles);
    expect(medium.obstacles).toBeGreaterThan(0);
    expect(hard.runOff).toBeLessThan(medium.runOff);
    expect(medium.runOff).toBeLessThan(easy.runOff);
  });
});
