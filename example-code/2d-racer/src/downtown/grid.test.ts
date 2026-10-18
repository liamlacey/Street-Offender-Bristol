import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../locations/locations';
import { TRACK_DIFFICULTIES, TRACK_LENGTHS, generateTrack } from '../track/generate';
import { buildTrack, turnRadii } from '../track/Track';
import { outline } from './grid';

const key = (i: number, j: number) => i * 1000 + j;

describe('the outline of a patch of blocks', () => {
  it('is a loop of junctions round it', () => {
    const loop = outline(new Set([key(3, 3), key(4, 3), key(4, 4)]));
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(8);
  });

  it('is refused for blocks meeting only at a corner, or round a hole', () => {
    expect(outline(new Set([key(3, 3), key(4, 4)]))).toBeNull();
    const ring = new Set<number>();
    for (let i = 3; i <= 5; i++) for (let j = 3; j <= 5; j++) if (i !== 4 || j !== 4) ring.add(key(i, j));
    expect(outline(ring)).toBeNull();
  });
});

describe('downtown tracks', () => {
  const cases = TRACK_LENGTHS.flatMap((length) => TRACK_DIFFICULTIES.map((difficulty) => [length, difficulty] as const));

  it.each(cases)('%s %s ones run along the streets of their city', (length, difficulty) => {
    for (const seed of [3, 77, 1234]) {
      const def = generateTrack(LOCATIONS.downtown, length, seed, difficulty);
      expect(def.grid).toBeDefined();
      const { xs, ys } = def.grid!;
      const track = buildTrack(def);
      expect(track.grid).toEqual(def.grid);
      // Away from the corners, the road runs down the middle of a street.
      const radii = turnRadii(track, 4);
      const n = radii.length;
      track.points.forEach((p, i) => {
        for (let k = -8; k <= 8; k++) if (radii[(i + k + n) % n] < 5000) return;
        const off = Math.min(...xs.map((x) => Math.abs(p.x - x)), ...ys.map((y) => Math.abs(p.y - y)));
        expect(off).toBeLessThan(3);
      });
    }
  });

  it('get twistier with the track difficulty', () => {
    const turning = (difficulty: (typeof TRACK_DIFFICULTIES)[number]) => {
      let total = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const track = buildTrack(generateTrack(LOCATIONS.downtown, 'medium', seed, difficulty));
        const n = track.points.length;
        let turn = 0;
        for (let i = 0; i < n; i++) {
          const a = track.normals[i];
          const b = track.normals[(i + 1) % n];
          turn += Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
        }
        total += turn / (track.length / 10_000);
      }
      return total;
    };
    const [easy, medium, hard] = TRACK_DIFFICULTIES.map(turning);
    expect(medium).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(medium);
  });
});
