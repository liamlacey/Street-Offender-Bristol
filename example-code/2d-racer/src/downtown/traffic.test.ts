import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../locations/locations';
import { TYRE_RADIUS, buildBarriers } from '../track/barriers';
import { CircleGrid } from '../physics/collisions';
import { planDecoration } from '../track/decoration';
import { generateTrack, mulberry32 } from '../track/generate';
import { buildTrack, locateOnTrack } from '../track/Track';
import { Traffic, crossLights } from './traffic';

const { downtown } = LOCATIONS;

describe('the city traffic', () => {
  const track = buildTrack(generateTrack(downtown, 'short', 5, 'medium'));
  const barriers = buildBarriers(track);
  const grid = new CircleGrid(barriers.map((b) => ({ ...b, r: TYRE_RADIUS })));
  const deco = planDecoration(track, barriers, downtown.decoration, 600, 'medium');
  const { city } = deco.downtown!;
  const closure = track.width / 2 + track.kerbWidth + track.runOff! + TYRE_RADIUS * 2;
  const traffic = new Traffic(city, closure, mulberry32(3));
  const DT = 1 / 30;
  const start = traffic.vehicles.map((v) => ({ x: v.x, y: v.y }));
  const problems = new Set<string>();
  let turnedRound = 0;
  let movedThroughRed = 0;
  for (let t = 0; t < 120; t += DT) {
    const before = traffic.vehicles.map((v) => ({ lane: v.lane, s: v.s, turn: v.turn }));
    traffic.step(DT, t);
    traffic.vehicles.forEach((v, k) => {
      const was = before[k];
      // Turning round: a new turn back along the same street.
      if (!was.turn && v.turn && v.turn.next.street === was.lane.street) turnedRound++;
      // Over the stop line on red.
      const lane = was.lane;
      const crossed = !was.turn && was.s + v.length / 2 <= lane.stop && (v.turn ? true : v.s + v.length / 2 > lane.stop + 0.5);
      if (crossed && v.lane === lane && !lane.to.onTrack && crossLights(lane.to, t) !== (lane.street.horizontal ? 'ew' : 'ns')) movedThroughRed++;
      // Clear of the race: outside its barriers, front bumper and all.
      for (const end of [1, -1]) {
        const x = v.x + Math.cos(v.heading) * end * (v.length / 2);
        const y = v.y + Math.sin(v.heading) * end * (v.length / 2);
        if (grid.near(x, y, 8).some((b) => Math.hypot(b.x - x, b.y - y) < TYRE_RADIUS + 8)) problems.add('into the barriers');
        const pos = locateOnTrack(track, x, y);
        if (pos.distance < pos.halfWidth + track.kerbWidth + 20) problems.add('on the race track');
      }
    });
    for (const v of traffic.vehicles) {
      if (v.turn) continue;
      for (const w of v.lane.cars) {
        if (w === v || w.turn) continue;
        if (Math.abs(w.s - v.s) < (w.length + v.length) / 2 - 1) problems.add('two vehicles in each other');
      }
    }
  }

  it('fills the side streets', () => {
    expect(traffic.vehicles.length).toBeGreaterThan(40);
  });

  it('never drives onto the race track or into its barriers, or into the vehicle in front', () => {
    expect([...problems]).toEqual([]);
  });

  it('keeps moving, turning round where streets are closed for the race', () => {
    const moved = traffic.vehicles.filter((v, k) => Math.hypot(v.x - start[k].x, v.y - start[k].y) > 200).length;
    expect(moved).toBeGreaterThan(traffic.vehicles.length * 0.5);
    expect(turnedRound).toBeGreaterThan(0);
  });

  it('stops at red lights', () => {
    expect(movedThroughRed).toBe(0);
  });
});
