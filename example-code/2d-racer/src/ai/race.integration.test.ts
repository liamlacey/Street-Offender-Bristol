import { describe, expect, it } from 'vitest';
import { type CarState, SURFACE_GRIP, createCar, stepCar } from '../car/CarPhysics';
import { type Body, CircleGrid, collideBodyWithStatic, collideCarWithBody, collideCarWithStatic, collideCars, stepBody } from '../physics/collisions';
import { FURNITURE, PARKED_CAR, type Pedestrian, pedestrian, stepPedestrian } from '../downtown/street';
import { LapTracker } from '../race/LapTracker';
import { gridSlots } from '../race/grid';
import { CONE_RADIUS, RUN_OFF, TYRE_RADIUS, buildBarriers, obstaclePieces, placeCones } from '../track/barriers';
import { buildTrack, locateOnTrack } from '../track/Track';
import { TRACKS } from '../track/tracks';
import { TRACK_LENGTHS, generateTrack, mulberry32 } from '../track/generate';
import { LOCATIONS, cornerScale } from '../locations/locations';
import { drivingSurface, planDecoration } from '../track/decoration';
import { AiDriver } from './AiDriver';
import { DIFFICULTIES } from '../settings';
import { DIFFICULTY, MAX_OPPONENTS, driversFor } from './drivers';
import { DEFAULT_LINE, buildRacingLine } from './racingLine';

const DT = 1 / 120;
const LAPS = 3;

// Hard tracks: twisty, varying width, obstacles on the road.
const generated = TRACK_LENGTHS.map((length) => {
  const def = generateTrack(LOCATIONS.docklands, length, 2024, 'hard');
  return { ...def, name: `generated hard ${length}` };
});
// In the woods: a dirt road with mud, puddles, fords and log piles.
const woods = (['short', 'medium'] as const).map((length) => {
  const def = generateTrack(LOCATIONS.woodlands, length, 77, 'hard');
  return { ...def, name: `woodlands hard ${length}` };
});
// Downtown: city streets, with parked cars and people in the way.
const downtownTracks = (['short', 'medium'] as const).map((length) => {
  const def = generateTrack(LOCATIONS.downtown, length, 51, 'hard');
  return { ...def, name: `downtown hard ${length}` };
});
// At the circuit: tarmac, kerbs, gravel traps and tyre walls.
const circuitTracks = (['short', 'medium'] as const).map((length) => {
  const def = generateTrack(LOCATIONS.circuit, length, 31, 'hard');
  return { ...def, name: `circuit hard ${length}` };
});
const { docklands, woodlands, circuit, downtown } = LOCATIONS;
const cases = [
  ...TRACKS.flatMap((def) => DIFFICULTIES.map((difficulty) => [def.name, difficulty, 3, def, docklands] as const)),
  // The hardest field on a generated track of each length.
  ...generated.map((def) => [def.name, 'hard' as const, 3, def, docklands] as const),
  // The biggest field, on the classic track and on the shortest generated one (most crowded).
  [TRACKS[0].name, 'medium' as const, MAX_OPPONENTS, TRACKS[0], docklands] as const,
  [generated[0].name, 'hard' as const, MAX_OPPONENTS, generated[0], docklands] as const,
  ...woods.map((def) => [def.name, 'hard' as const, 6, def, woodlands] as const),
  ...circuitTracks.map((def) => [def.name, 'hard' as const, 6, def, circuit] as const),
  ...downtownTracks.map((def) => [def.name, 'hard' as const, 6, def, downtown] as const),
];

describe.each(cases)('a full AI race at %s on %s with %i opponents', (_name, difficulty, opponents, def, location) => {
  // Long tracks with big fields take a while to simulate.
  it('gets every car to the finish, bumping and all, without anyone escaping or getting stuck', { timeout: 120_000 }, () => {
    const track = buildTrack(def);
    const obstacles = obstaclePieces(track);
    const tyres = buildBarriers(track);
    const deco = planDecoration(track, tyres, location.decoration, 600, def.difficulty ?? 'medium', location.circuit ?? null);
    const grid = new CircleGrid([...tyres.map((t) => ({ ...t, r: TYRE_RADIUS })), ...deco.solids]);
    // Everything on the road is loose: cones, and heavier tyres.
    const cones: Body[] = [
      ...[...placeCones(track, tyres), ...obstacles.cones].map((c) => ({
        ...c, r: CONE_RADIUS, vx: 0, vy: 0, invMass: 12.5, angle: 0, spin: 0,
      })),
      ...obstacles.tyres.map((t) => ({ ...t, r: TYRE_RADIUS, vx: 0, vy: 0, invMass: 2.5, angle: 0, spin: 0 })),
    ];
    // Downtown: parked cars, street furniture and people walking about, all loose.
    const people: Pedestrian[] = [];
    const rng = mulberry32(7);
    if (deco.downtown) {
      const { street } = deco.downtown;
      for (const p of street.parked) {
        const { length, width, invMass, damping } = PARKED_CAR;
        cones.push({ x: p.x, y: p.y, r: width / 2, length, vx: 0, vy: 0, invMass, angle: p.heading, spin: 0, damping });
      }
      for (const f of street.furniture) cones.push({ x: f.x, y: f.y, vx: 0, vy: 0, angle: 0, spin: 0, ...FURNITURE[f.kind] });
      for (const w of street.walks) people.push(pedestrian(w.a, w.b, null, rng));
      for (const c of street.crossings) people.push(pedestrian(c.a, c.b, c.junction, rng));
      cones.push(...people.map((p) => p.body));
    }
    const line = buildRacingLine(track, {
      cornerFactor: DIFFICULTY[difficulty].cornerFactor * cornerScale(location),
      edgeMargin: DEFAULT_LINE.edgeMargin + (location.road.keepOff ?? 0),
    });
    // Four AI cars: the three opponents plus a stand-in for the player.
    const profiles = [...driversFor(difficulty, opponents), { name: 'Stand-in', color: 0, pace: 0.95, wobble: 10 }];
    const racers = gridSlots(track, profiles.length).map((slot, i) => ({
      car: createCar(slot.x, slot.y, slot.heading),
      driver: new AiDriver(track, line, profiles[i], i),
      laps: new LapTracker(track.length),
      finishTime: null as number | null,
    }));
    const cars: CarState[] = racers.map((r) => r.car);
    const limit = halfOuter(track) + RUN_OFF + 2 * TYRE_RADIUS;
    let contacts = 0;

    const timeLimit = (LAPS * track.length) / 250 + 30;
    for (let t = 0; t < timeLimit && racers.some((r) => r.finishTime === null); t += DT) {
      for (const p of people) stepPedestrian(p, DT, t, cars, rng);
      for (const r of racers) {
        const pos = locateOnTrack(track, r.car.x, r.car.y);
        expect(pos.distance).toBeLessThan(limit);
        const input = r.driver.drive(r.car, cars.filter((c) => c !== r.car), DT);
        stepCar(r.car, input, DT, SURFACE_GRIP[drivingSurface(track, deco, location, pos, r.car.x, r.car.y)]);
        collideCarWithStatic(r.car, grid);
        for (const cone of cones) collideCarWithBody(r.car, cone);
        const lap = r.laps.update(pos.along, t);
        if (lap?.lap === LAPS && r.finishTime === null) r.finishTime = t;
      }
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) if (collideCars(cars[a], cars[b]) > 0) contacts++;
      }
      for (const cone of cones) {
        stepBody(cone, DT);
        collideBodyWithStatic(cone, grid);
      }
    }

    const times = racers.map((r) => r.finishTime);
    expect(times.every((t) => t !== null)).toBe(true);
    // A racing pace: comfortably under 4 seconds per 1000px of lap, even with traffic.
    for (const time of times) expect(time!).toBeLessThan((LAPS * track.length) / 250);
    // They start together, so they should have rubbed at least a little.
    expect(contacts).toBeGreaterThan(0);
  });
});

function halfOuter(track: { width: number; kerbWidth: number }) {
  return track.width / 2 + track.kerbWidth;
}
