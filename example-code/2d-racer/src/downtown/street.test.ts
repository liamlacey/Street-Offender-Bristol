import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../locations/locations';
import { TYRE_RADIUS, buildBarriers } from '../track/barriers';
import { planDecoration } from '../track/decoration';
import { TRACK_DIFFICULTIES, generateTrack } from '../track/generate';
import { buildTrack, locateOnTrack } from '../track/Track';
import { mulberry32 } from '../track/generate';
import { stepBody } from '../physics/collisions';
import { inRect, streetRect } from './city';
import { PARKING_LANE, wrap } from './road';
import { type Pedestrian, PEDESTRIAN, SIGNAL, pedestrian, signal, stepPedestrian, walkSignal } from './street';

const { downtown } = LOCATIONS;

describe.each(TRACK_DIFFICULTIES)('street life on a %s downtown track', (difficulty) => {
  const track = buildTrack(generateTrack(downtown, 'medium', 99, difficulty));
  const barriers = buildBarriers(track);
  const deco = planDecoration(track, barriers, downtown.decoration, 600, difficulty);
  const { street, junctions, city } = deco.downtown!;
  const nearBarrier = (x: number, y: number, r: number) => barriers.some((b) => Math.hypot(b.x - x, b.y - y) < TYRE_RADIUS + r);
  // The race's streets, kerb to kerb, and the squares where they meet.
  const roads = city.streets.filter((st) => st.onTrack).map((st) => streetRect(st, st.width + st.kerb * 2));
  const squares = city.junctions
    .filter((j) => j.onTrack)
    .map((j) => {
      const h = track.width / 2 + track.kerbWidth;
      return { x0: j.x - h, x1: j.x + h, y0: j.y - h, y1: j.y + h };
    });
  /** On a pavement of the race's streets: off the road, inside the barriers, and not out on a side street. */
  const onPavement = (x: number, y: number, r: number) =>
    ![...roads, ...squares].some((rect) => inRect(rect, x, y)) &&
    roads.some((rect) => inRect(rect, x, y, track.runOff!)) &&
    !city.streets.some((st) => !st.onTrack && inRect(streetRect(st), x, y)) &&
    !nearBarrier(x, y, r);

  it('parks cars along the parking lanes, clear of the junctions and the grid', () => {
    expect(street.parked.length).toBeGreaterThan(track.length / 1000);
    for (const car of street.parked) {
      const pos = locateOnTrack(track, car.x, car.y);
      expect(pos.distance).toBeGreaterThan(pos.halfWidth - PARKING_LANE);
      expect(pos.distance).toBeLessThan(pos.halfWidth);
      // Lying along the road.
      expect(Math.abs(Math.sin(car.heading - pos.heading))).toBeLessThan(0.1);
      for (const jn of junctions) expect(Math.abs(wrap(pos.along - jn.along, track.length))).toBeGreaterThan(Math.min(jn.before, jn.after) + 60);
      const fromStart = wrap(pos.along, track.length);
      expect(fromStart < -1500 || fromStart > 500).toBe(true);
    }
  });

  it('has people strolling the pavements and crossings at every junction', () => {
    expect(street.walks.length).toBeGreaterThan(track.length / 10_000);
    expect(street.crossings.length).toBe(junctions.length * 2);
    for (const w of street.walks) {
      for (let t = 0; t <= 1; t += 0.1) expect(onPavement(w.a.x + (w.b.x - w.a.x) * t, w.a.y + (w.b.y - w.a.y) * t, PEDESTRIAN.radius)).toBe(true);
    }
    for (const c of street.crossings) {
      expect(onPavement(c.a.x, c.a.y, PEDESTRIAN.radius)).toBe(true);
      expect(onPavement(c.b.x, c.b.y, PEDESTRIAN.radius)).toBe(true);
    }
  });

  it('puts hydrants, bins and newspaper boxes on the pavement', () => {
    expect(street.furniture.some((f) => f.kind === 'hydrant')).toBe(true);
    expect(street.furniture.some((f) => f.kind === 'bin')).toBe(true);
    for (const f of street.furniture) expect(onPavement(f.x, f.y, 8), f.kind).toBe(true);
  });
});

describe('traffic lights', () => {
  it('only let people cross while the race has a red light', () => {
    for (let t = 0; t < SIGNAL.cycle * 3; t += 0.1) {
      for (const j of [0, 3, 7]) if (walkSignal(j, t)) expect(signal(j, t)).toBe('red');
    }
  });

  it('go green, amber and red in turn, at different times at different junctions', () => {
    const seen = new Set<string>();
    for (let t = 0; t < SIGNAL.cycle; t += 0.25) seen.add(signal(0, t));
    expect([...seen].sort()).toEqual(['amber', 'green', 'red']);
    let differ = false;
    for (let t = 0; t < SIGNAL.cycle; t += 0.25) if (signal(0, t) !== signal(1, t)) differ = true;
    expect(differ).toBe(true);
  });
});

describe('a pedestrian', () => {
  const rng = mulberry32(5);
  const DT = 1 / 120;
  /** Runs someone for `seconds`, with the given cars, from `time`. */
  function run(p: Pedestrian, seconds: number, cars: { x: number; y: number; vx: number; vy: number }[] = [], time = 0) {
    for (let t = 0; t < seconds; t += DT) {
      stepPedestrian(p, DT, time + t, cars, rng);
      stepBody(p.body, DT);
    }
  }

  it('walks to the end of their stretch and back again', () => {
    const p = pedestrian({ x: 0, y: 0 }, { x: 100, y: 0 }, null, rng);
    let far = 0;
    let back = 100;
    for (let k = 0; k < 40; k++) {
      run(p, 0.5);
      far = Math.max(far, p.body.x);
      if (far > 95) back = Math.min(back, p.body.x);
    }
    expect(far).toBeGreaterThan(95);
    expect(back).toBeLessThan(10);
    expect(Math.abs(p.body.y)).toBeLessThan(1);
  });

  it('waits at the kerb for the lights before crossing', () => {
    const p = pedestrian({ x: 0, y: 0 }, { x: 0, y: 300 }, 0, rng);
    p.dir = 1;
    // Green for the race: they wait.
    run(p, 5, [], 0);
    expect(p.body.y).toBeLessThan(1);
    // Walk: off they go.
    run(p, 4, [], SIGNAL.walk[0]);
    expect(p.body.y).toBeGreaterThan(50);
  });

  it('jumps out of the way of a car coming straight at them', () => {
    let dodged = 0;
    for (let k = 0; k < 20; k++) {
      const p = pedestrian({ x: 0, y: 0 }, { x: 0, y: 1 }, null, rng);
      p.state = 'wait';
      p.timer = 100;
      run(p, 1, [{ x: -120, y: 0, vx: 500, vy: 0 }]);
      if (Math.abs(p.body.y) > 15) dodged++;
    }
    expect(dodged).toBeGreaterThan(15);
  });

  it('goes down when knocked flying, then gets back up and carries on', () => {
    const p = pedestrian({ x: 0, y: 0 }, { x: 100, y: 0 }, null, rng);
    p.state = 'walk';
    p.body.vx = 0;
    p.body.vy = 400;
    run(p, 0.1);
    expect(p.state).toBe('down');
    run(p, 3);
    expect(p.state).not.toBe('down');
  });
});
