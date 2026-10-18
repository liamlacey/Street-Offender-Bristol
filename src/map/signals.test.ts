import { describe, expect, it } from 'vitest';
import { type Arm, trafficLights } from './signals';

/** A road 10 m (80 px) wide, two-way, heading (dx, dy). */
const arm = (dx: number, dy: number, road: number, oneway = false): Arm => ({ dx, dy, width: 80, oneway, road });

describe('trafficLights', () => {
  it('gives a crossroads a stop line and a pole for each way in, taking turns in two groups', () => {
    // Two two-way roads crossing at (1000, 1000): the lights are mapped at the junction.
    const { signals, controllers } = trafficLights([{ x: 1000, y: 1000, crossing: false, arms: [arm(1, 0, 1), arm(-1, 0, 1), arm(0, 1, 2), arm(0, -1, 2)] }]);
    expect(signals).toHaveLength(4);
    expect(controllers).toEqual([expect.objectContaining({ groups: 2, walk: false })]);
    const eastbound = signals.find((s) => Math.abs(s.angle) < 0.01)!;
    const westbound = signals.find((s) => Math.abs(Math.abs(s.angle) - Math.PI) < 0.01)!;
    const southbound = signals.find((s) => Math.abs(s.angle - Math.PI / 2) < 0.01)!;
    // Traffic that faces each other goes together; across it, the other group.
    expect(eastbound.group).toBe(westbound.group);
    expect(southbound.group).not.toBe(eastbound.group);
    // Eastbound stops short of the road it's crossing, and its pole is on its left (north, y up the screen): Britain drives on the left.
    expect(eastbound.stop[0]).toBeLessThan(1000 - 40);
    expect(eastbound.y).toBeLessThan(1000 - 40);
    // Its stop line runs across its own lanes only, from the middle of the road to the kerb.
    const [, y0, , y1] = eastbound.stop;
    expect(Math.min(y0, y1)).toBeCloseTo(960);
    expect(Math.max(y0, y1)).toBeCloseTo(1000);
  });

  it('counts lights mapped either side of a crossing once for each way, at the first the traffic meets', () => {
    const road = [arm(1, 0, 7), arm(-1, 0, 7)];
    const { signals, controllers } = trafficLights([
      { x: 900, y: 500, crossing: false, arms: [arm(1, 0, 7)] },
      { x: 1000, y: 500, crossing: true, arms: road },
      { x: 1100, y: 500, crossing: false, arms: [arm(-1, 0, 7)] },
    ]);
    expect(controllers).toEqual([expect.objectContaining({ groups: 1, walk: true })]);
    expect(signals).toHaveLength(2);
    expect(signals.find((s) => Math.abs(s.angle) < 0.01)!.stop[0]).toBe(900);
    expect(signals.find((s) => Math.abs(s.angle) > 3)!.stop[0]).toBe(1100);
  });

  it('keeps lights far apart on separate controllers', () => {
    const { controllers } = trafficLights([
      { x: 0, y: 0, crossing: true, arms: [arm(1, 0, 1), arm(-1, 0, 1)] },
      { x: 2000, y: 0, crossing: true, arms: [arm(1, 0, 1), arm(-1, 0, 1)] },
    ]);
    expect(controllers).toHaveLength(2);
  });
});
