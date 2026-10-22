import { describe, expect, it } from 'vitest';
import { createCar } from '../car/CarPhysics';
import type { GameMap } from '../map/osm';
import bristol from '../test/bristol';
import { GRAVITY, Ledges, landingSpeed } from './ledges';

const M = 8;
// A 3 m drop along y = 100, from x = 0 to 400, the ground falling away to the south (on its right, running east).
const ledges = new Ledges({ ledges: [{ pts: [0, 100, 400, 100], drop: [3 * M, 3 * M] }] });

describe('drops', () => {
  it('are gone over from the top, not from below, and only along them', () => {
    expect(ledges.wentOver(200, 90, 200, 104)?.drop).toBe(3 * M);
    expect(ledges.wentOver(200, 104, 200, 90)).toBeNull();
    expect(ledges.wentOver(500, 90, 500, 104)).toBeNull();
    expect(ledges.wentOver(200, 60, 200, 80)).toBeNull();
  });

  it('are a wall from below: the car pushed back out and bounced off', () => {
    const car = { ...createCar(200, 110, -Math.PI / 2), vy: -100 };
    const hit = ledges.collide(car);
    expect(hit).toBeCloseTo(100);
    expect(car.vy).toBeGreaterThan(0);
    // Its nose (and the rest of it) back out below the edge.
    expect(car.y - 19).toBeGreaterThanOrEqual(100 - 0.01);
  });

  it("aren't in the way from the top (you go over)", () => {
    const car = { ...createCar(200, 95, Math.PI / 2), vy: 100 };
    expect(ledges.collide(car)).toBe(0);
    expect([car.x, car.y, car.vy]).toEqual([200, 95, 100]);
  });

  it('land you as fast as you fell', () => {
    expect(landingSpeed(2 * M)).toBeCloseTo(Math.sqrt(2 * GRAVITY * 2 * M));
    // From 2 m, about 6 m/s.
    expect(landingSpeed(2 * M) / M).toBeCloseTo(6.26, 1);
    expect(ledges.dropNear(200, 104, 10)).toBe(3 * M);
    expect(ledges.dropNear(200, 140, 10)).toBe(0);
  });

  it("are found round Bristol: the quays, and the Bear Pit's sides", () => {
    const map = bristol as unknown as GameMap;
    const all = new Ledges(map);
    expect(all.segments.length).toBeGreaterThan(1000);
    // Narrow Quay's edge, into the harbour.
    const quay = map.roads.find((r) => r.name === 'Narrow Quay')!;
    const near = (x: number, y: number, r: number) => all.near(x, y, r).length > 0;
    expect(near(quay.pts[0], quay.pts[1], 40 * M) || near(quay.pts[quay.pts.length - 2], quay.pts[quay.pts.length - 1], 40 * M)).toBe(true);
    // The Bear Pit, in St James' Barton roundabout.
    const ring = map.roads.filter((r) => r.name === "St James' Barton").flatMap((r) => r.pts);
    let [sx, sy] = [0, 0];
    for (let k = 0; k < ring.length; k += 2) [sx, sy] = [sx + ring[k], sy + ring[k + 1]];
    const [cx, cy] = [sx / (ring.length / 2), sy / (ring.length / 2)];
    // (Its sides all round: how long they are, together.)
    const sides = all.near(cx, cy, 45 * M).filter((s) => s.drop >= 1.5 * M);
    expect(sides.reduce((l, s) => l + Math.hypot(s.bx - s.ax, s.by - s.ay), 0)).toBeGreaterThan(35 * M);
  });
});
