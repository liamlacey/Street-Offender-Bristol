import { describe, expect, it } from 'vitest';
import { offsetLine } from './ground';

describe('offsetLine', () => {
  it('runs alongside a line, to its left as it runs (north of one running east, y down)', () => {
    expect(offsetLine([0, 0, 100, 0], 10)).toEqual([0, -10, 100, -10]);
    expect(offsetLine([0, 0, 100, 0], -10)).toEqual([0, 10, 100, 10]);
  });

  it('keeps its distance round a corner', () => {
    // East, then south: the left side's corner is out at (110, -10).
    const [, , cx, cy] = offsetLine([0, 0, 100, 0, 100, 100], 10);
    expect(cx).toBeCloseTo(110);
    expect(cy).toBeCloseTo(-10);
  });
});
