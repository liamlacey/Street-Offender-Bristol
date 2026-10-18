import { describe, expect, it } from 'vitest';
import { AI_DRIVERS, MAX_OPPONENTS, driversFor } from './drivers';

describe('driversFor', () => {
  it('makes fields of every size from 1 to 20, all different colours and none red', () => {
    for (let n = 1; n <= MAX_OPPONENTS; n++) {
      const field = driversFor('medium', n);
      expect(field).toHaveLength(n);
      expect(new Set(field.map((d) => d.color)).size).toBe(n);
      expect(new Set(field.map((d) => d.name)).size).toBe(n);
      expect(field.some((d) => d.color === 0xd7263d)).toBe(false);
    }
  });

  it('spreads the pace from fastest to slowest', () => {
    const field = driversFor('medium', 20);
    for (let i = 1; i < field.length; i++) expect(field[i].pace).toBeLessThan(field[i - 1].pace);
    expect(field[0].pace).toBeCloseTo(0.97);
    expect(field[19].pace).toBeCloseTo(0.85);
  });

  it('keeps the classic three-car field as it was', () => {
    expect(driversFor('medium', 3).map((d) => d.pace)).toEqual(AI_DRIVERS.map((d) => d.pace));
    expect(AI_DRIVERS.map((d) => d.pace.toFixed(2))).toEqual(['0.97', '0.94', '0.91']);
  });
});
