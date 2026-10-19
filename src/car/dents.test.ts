import { describe, expect, it } from 'vitest';
import { CRUMPLE, DENT, type Shape, hit, newWreck, onOutline, toBody, toWorld } from './dents';

// A car 38 px long and 18 wide, its mirrors 3 px ahead of its middle, its windscreen 6.
const car: Shape = { length: 38, width: 18, stiffness: 1, mirror: 3, screen: 6 };
const lorry: Shape = { ...car, length: 75, width: 22, stiffness: 2.2 };
let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const kinds = (marks: { kind: string }[]) => new Set(marks.map((m) => m.kind));

describe('where a hit lands', () => {
  it('finds the side of the body nearest the point, and puts it on the outline', () => {
    expect(onOutline(car, 30, 2)).toMatchObject({ side: 'front', u: 19, v: 2 });
    expect(onOutline(car, -25, -1)).toMatchObject({ side: 'rear', u: -19 });
    expect(onOutline(car, 4, 12)).toMatchObject({ side: 'right', v: 9 });
    expect(onOutline(car, -4, -10)).toMatchObject({ side: 'left', v: -9 });
  });

  it('turns points from the world to the body and back', () => {
    const [u, v] = toBody(110, 100, 100, 100, Math.PI / 2);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-10);
    const [x, y] = toWorld(u, v, 100, 100, Math.PI / 2);
    expect(x).toBeCloseTo(110);
    expect(y).toBeCloseTo(100);
  });
});

describe('damage', () => {
  it('a touch does nothing; a light bump just scratches', () => {
    expect(hit(newWreck(), car, 25, 0, 4, 0, rand).marks).toEqual([]);
    expect(kinds(hit(newWreck(), car, 25, 0, 12, 0, rand).marks)).toEqual(new Set(['scratch']));
  });

  it('harder, chips the paint and dents the panel; a big hit crumples it and cracks the windscreen', () => {
    const dent = kinds(hit(newWreck(), car, 25, 0, DENT + 10, 0, rand).marks);
    expect(dent.has('chip') && dent.has('dent') && !dent.has('crumple')).toBe(true);
    const big = kinds(hit(newWreck(), car, 25, 0, CRUMPLE + 40, 0, rand).marks);
    expect(big.has('crumple') && big.has('crack')).toBe(true);
  });

  it('is worse the harder the hit', () => {
    const size = (impulse: number) => hit(newWreck(), car, 25, 0, impulse, 0, rand).marks.find((m) => m.kind === 'dent')!.size;
    expect(size(120)).toBeGreaterThan(size(50));
  });

  it("does less to something built heavier: a hit that dents a car only scratches a lorry", () => {
    expect(kinds(hit(newWreck(), car, 25, 0, 40, 0, rand).marks).has('dent')).toBe(true);
    expect(kinds(hit(newWreck(), lorry, 40, 0, 40, 0, rand).marks).has('dent')).toBe(false);
  });

  it('smashes the light at the corner hit, and knocks a wing mirror off from the side', () => {
    const corner = hit(newWreck(), car, 25, -6, 60, 0, rand);
    expect(corner.lost.map((l) => l.part)).toContain('lightFrontLeft');
    expect(corner.lost.map((l) => l.part)).not.toContain('lightFrontRight');
    expect(hit(newWreck(), car, 3, 12, 40, 0, rand).lost.map((l) => l.part)).toEqual(['mirrorRight']);
  });

  it('adds up, hit after hit: the bumper comes off once its end has taken enough', () => {
    const w = newWreck();
    const lost: string[] = [];
    for (let k = 0; k < 6; k++) lost.push(...hit(w, car, -25, 0, 45, k, rand).lost.map((l) => l.part));
    expect(lost).toContain('bumperRear');
    expect(w.taken.rear).toBeGreaterThan(200);
    // Once.
    expect(lost.filter((p) => p === 'bumperRear').length).toBe(1);
  });

  it("counts a car pressed against something as the one hit, not one every moment", () => {
    const w = newWreck();
    hit(w, car, 25, 0, 40, 0, rand);
    const marks = w.marks.length;
    for (let t = 0.01; t < 0.1; t += 0.01) hit(w, car, 25, 0, 30, t, rand);
    expect(w.marks.length).toBe(marks);
    // A harder one, though, counts.
    hit(w, car, 25, 0, 90, 0.11, rand);
    expect(w.marks.length).toBeGreaterThan(marks);
  });
});
