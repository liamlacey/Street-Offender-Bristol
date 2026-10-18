import { describe, expect, it } from 'vitest';
import { bridge, terrace } from './skyline';

describe('the title screen skyline', () => {
  it('fills the width with a terrace stepping up the hill', () => {
    let s = 7;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const houses = terrace(600, 300, rand);
    expect(houses[0].x).toBe(0);
    expect(houses[houses.length - 1].x + houses[houses.length - 1].w).toBeGreaterThanOrEqual(600);
    expect(houses[houses.length - 1].y).toBeLessThan(houses[0].y);
  });

  it('hangs the bridge chains lowest in the middle, between the towers', () => {
    const { towers, chain } = bridge(0, 1000, 200);
    expect(chain[0].x).toBeCloseTo(towers[0]);
    expect(chain[40].x).toBeCloseTo(towers[1]);
    expect(chain[20].y).toBeGreaterThan(chain[0].y);
  });
});
