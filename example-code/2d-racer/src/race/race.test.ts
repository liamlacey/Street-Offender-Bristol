import { describe, expect, it } from 'vitest';
import { LapTracker } from './LapTracker';
import { WrongWayDetector } from './WrongWayDetector';
import { formatDelta, formatTime } from './formatTime';
import { ordinal, raceOrder } from './standings';

const LENGTH = 1200; // 12 sectors of 100

/** Drives forward from `from` to `to` (distance along the loop, may exceed LENGTH) in 10px steps. */
function drive(tracker: LapTracker, from: number, to: number, clock: { t: number }, dtPerStep = 0.01) {
  const results = [];
  const dir = Math.sign(to - from);
  for (let d = from; dir > 0 ? d <= to : d >= to; d += 10 * dir) {
    clock.t += dtPerStep;
    const along = ((d % LENGTH) + LENGTH) % LENGTH;
    const r = tracker.update(along, clock.t);
    if (r) results.push(r);
  }
  return results;
}

describe('LapTracker', () => {
  it('starts the first lap on crossing the start line, without counting a lap', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    expect(drive(tracker, LENGTH - 100, LENGTH + 50, clock)).toEqual([]);
    expect(tracker.lap).toBe(1);
  });

  it('counts a lap after every checkpoint is passed in order', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    const results = drive(tracker, 60, LENGTH + 50, clock);
    expect(results).toHaveLength(1);
    expect(results[0].lap).toBe(1);
    expect(results[0].time).toBeCloseTo(1.2, 1); // 120 steps of 0.01s
    expect(tracker.lap).toBe(2);
  });

  it('does not count a lap if a sector was skipped', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    drive(tracker, 60, 350, clock); // sectors 0-3
    // Cut across: jump straight from sector 3 to sector 6, then carry on to the line.
    expect(drive(tracker, 650, LENGTH + 50, clock)).toEqual([]);
    expect(tracker.lap).toBe(1);
  });

  it('ignores reversing back and forth over the line', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    drive(tracker, 50, -50, clock); // back over the line
    expect(drive(tracker, -50, 50, clock)).toEqual([]); // and forward again
    expect(tracker.lap).toBe(1);
  });

  it('tracks last and best laps', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    const [first] = drive(tracker, 60, LENGTH + 50, clock, 0.02); // slow lap
    const [second] = drive(tracker, 60, LENGTH + 50, clock, 0.01); // faster
    const [third] = drive(tracker, 60, LENGTH + 50, clock, 0.03); // slowest
    expect(first.isBest).toBe(true);
    expect(second.isBest).toBe(true);
    expect(second.previousBest).toBeCloseTo(first.time);
    expect(third.isBest).toBe(false);
    expect(tracker.bestLap).toBeCloseTo(second.time);
    expect(tracker.lastLap).toBeCloseTo(third.time);
  });

  it('only marks a lap as best if it beats a saved best', () => {
    const tracker = new LapTracker(LENGTH, 12, 0.5);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    const [lap] = drive(tracker, 60, LENGTH + 50, clock);
    expect(lap.isBest).toBe(false);
    expect(tracker.bestLap).toBe(0.5);
  });

  it('flags a skipped checkpoint straight away, until the car goes back for it', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    drive(tracker, 60, 350, clock); // sectors 0-3
    expect(tracker.missedCheckpoint).toBe(false);
    expect(tracker.nextCheckpointAlong).toBe(400);
    drive(tracker, 650, 700, clock); // cut across to sector 6
    expect(tracker.missedCheckpoint).toBe(true);
    drive(tracker, 700, 520, clock); // drive back...
    expect(tracker.missedCheckpoint).toBe(true);
    drive(tracker, 520, 450, clock); // ...into the missed sector, from either direction
    expect(tracker.missedCheckpoint).toBe(false);
    expect(drive(tracker, 450, LENGTH + 50, clock)).toHaveLength(1);
  });

  it('never flags a miss on a normal lap, or when reversing', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, -300, clock); // reverse away from the grid
    expect(tracker.missedCheckpoint).toBe(false);
    drive(tracker, -300, LENGTH * 2 + 50, clock);
    expect(tracker.missedCheckpoint).toBe(false);
    drive(tracker, 50, -200, clock); // back over the line
    expect(tracker.missedCheckpoint).toBe(false);
  });

  it('reports the current lap time', () => {
    const tracker = new LapTracker(LENGTH);
    expect(tracker.currentLapTime(5)).toBe(0);
    tracker.update(LENGTH - 10, 1);
    tracker.update(5, 2);
    expect(tracker.currentLapTime(3.5)).toBeCloseTo(1.5);
  });
});

describe('LapTracker.progress', () => {
  it('is negative on the grid and grows steadily through the laps', () => {
    const tracker = new LapTracker(LENGTH);
    expect(tracker.progress(LENGTH - 100)).toBeCloseTo(-100);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    expect(tracker.progress(50)).toBeCloseTo(50);
    drive(tracker, 50, LENGTH + 50, clock);
    expect(tracker.lap).toBe(2);
    expect(tracker.progress(50)).toBeCloseTo(LENGTH + 50);
  });

  it('does not jump a lap ahead when backing over the line', () => {
    const tracker = new LapTracker(LENGTH);
    const clock = { t: 0 };
    drive(tracker, LENGTH - 100, LENGTH + 50, clock);
    drive(tracker, 50, -30, clock);
    expect(tracker.progress(LENGTH - 30)).toBeCloseTo(-30);
  });
});

describe('raceOrder', () => {
  it('puts finishers first in finishing order, then the rest by distance', () => {
    const order = raceOrder([
      { finishTime: null, progress: 900 },
      { finishTime: 70.2, progress: 3700 },
      { finishTime: null, progress: 1200 },
      { finishTime: 68.9, progress: 3650 },
    ]);
    expect(order).toEqual([3, 1, 2, 0]);
  });

  it('names positions', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd',
    ]);
  });
});

describe('WrongWayDetector', () => {
  it('warns only after driving backwards for a while', () => {
    const d = new WrongWayDetector(60, 0.8);
    for (let i = 0; i < 7; i++) d.update(-200, 0.1);
    expect(d.wrongWay).toBe(false);
    d.update(-200, 0.1);
    expect(d.wrongWay).toBe(true);
  });

  it('clears once driving the right way again', () => {
    const d = new WrongWayDetector(60, 0.8);
    for (let i = 0; i < 10; i++) d.update(-200, 0.1);
    d.update(200, 0.1);
    expect(d.wrongWay).toBe(false);
  });

  it('ignores slow movement such as a spin', () => {
    const d = new WrongWayDetector(60, 0.8);
    for (let i = 0; i < 20; i++) d.update(-30, 0.1);
    expect(d.wrongWay).toBe(false);
  });
});

describe('formatTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(59.999)).toBe('0:59.99');
    expect(formatTime(600)).toBe('10:00.00');
  });

  it('formats deltas with a sign', () => {
    expect(formatDelta(-0.5)).toBe('-0.50');
    expect(formatDelta(1.234)).toBe('+1.23');
  });
});
