import { describe, expect, it } from 'vitest';
import { type Light, cycleLength, lightAt, walkAt } from './lights';

describe('traffic lights', () => {
  const junction = { x: 0, y: 0, groups: 2, walk: true };

  /** What each group shows, and whether people may cross, every half second through a cycle. */
  const states = () => {
    const out: { lights: Light[]; walk: boolean }[] = [];
    for (let t = 0; t < cycleLength(junction); t += 0.5) out.push({ lights: [0, 1].map((g) => lightAt(junction, 0, g, t)), walk: walkAt(junction, 0, t) });
    return out;
  };

  it('never shows two groups anything but red at once', () => {
    for (const { lights } of states()) expect(lights.filter((l) => l !== 'red').length).toBeLessThanOrEqual(1);
  });

  it('lets people cross only when every light is red', () => {
    const walking = states().filter((s) => s.walk);
    expect(walking.length).toBeGreaterThan(0);
    for (const { lights } of walking) expect(lights).toEqual(['red', 'red']);
  });

  it('goes red, red and amber, green, amber, red', () => {
    const seen: Light[] = [];
    for (const { lights } of states()) if (seen[seen.length - 1] !== lights[1]) seen.push(lights[1]);
    expect(seen).toEqual(['red', 'redamber', 'green', 'amber', 'red']);
  });

  it('keeps each controller out of step with the others', () => {
    const at = (id: number) => [0, 5, 10, 15, 20].map((t) => lightAt(junction, id, 0, t)).join();
    expect(at(0)).not.toBe(at(1));
  });
});
