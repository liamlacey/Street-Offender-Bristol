import { describe, expect, it } from 'vitest';
import { buildTrack, layoutProblem, locateOnTrack, poseAt, surfaceAt, type TrackDefinition } from './Track';
import { TRACKS } from './tracks';

const SQUARE: TrackDefinition = {
  name: 'square',
  width: 100,
  kerbWidth: 10,
  points: [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ],
};

describe('buildTrack', () => {
  const track = buildTrack(SQUARE, 20);

  it('samples the centre line at even spacing', () => {
    const n = track.points.length;
    for (let i = 0; i < n; i++) {
      const a = track.points[i];
      const b = track.points[(i + 1) % n];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(track.spacing, 0);
    }
  });

  it('starts at the first control point', () => {
    expect(track.points[0].x).toBeCloseTo(0);
    expect(track.points[0].y).toBeCloseTo(0);
  });

  it('points normals to the right of the driving direction', () => {
    // Driving east along the top edge, "right" on a y-down screen is +y.
    expect(track.normals[0].y).toBeGreaterThan(0.6);
  });
});

describe('surfaceAt / locateOnTrack', () => {
  const track = buildTrack(SQUARE, 20);
  const p = track.points[10];
  const nrm = track.normals[10];
  const at = (offset: number) => surfaceAt(track, p.x + nrm.x * offset, p.y + nrm.y * offset);

  it('is road on and near the centre line', () => {
    expect(at(0)).toBe('road');
    expect(at(45)).toBe('road');
    expect(at(-45)).toBe('road');
  });

  it('is kerb just past the road edge', () => {
    expect(at(55)).toBe('kerb');
    expect(at(-55)).toBe('kerb');
  });

  it('is grass beyond the kerb', () => {
    expect(at(70)).toBe('grass');
    expect(at(-300)).toBe('grass');
  });

  it('reports distance along the track', () => {
    const pos = locateOnTrack(track, p.x, p.y);
    expect(pos.along).toBeCloseTo(10 * track.spacing, 0);
    expect(pos.distance).toBeCloseTo(0, 5);
  });
});

describe('poseAt', () => {
  const track = buildTrack(SQUARE, 20);

  it('wraps around the loop in both directions', () => {
    const a = poseAt(track, 100);
    const b = poseAt(track, 100 + track.length);
    const c = poseAt(track, 100 - track.length);
    expect(b.x).toBeCloseTo(a.x);
    expect(c.y).toBeCloseTo(a.y);
  });

  it('faces the driving direction', () => {
    // Middle of the top edge, well clear of the rounded corners.
    expect(Math.cos(poseAt(track, track.length * 0.125).heading)).toBeGreaterThan(0.95); // heading east
  });
});

describe.each(TRACKS.map((def) => [def.name, def] as const))('track layout: %s', (_name, def) => {
  it('can be raced: no overlapping road, no corner too tight to draw', () => {
    expect(layoutProblem(buildTrack(def))).toBeNull();
  });
});

describe('startAlong', () => {
  it('moves the start line along the loop', () => {
    const plain = buildTrack(SQUARE, 20);
    const moved = buildTrack({ ...SQUARE, startAlong: 500 }, 20);
    expect(moved.length).toBeCloseTo(plain.length);
    expect(moved.points[0].x).toBeCloseTo(poseAt(plain, 500).x, -1);
    expect(moved.points[0].y).toBeCloseTo(poseAt(plain, 500).y, -1);
  });
});

describe('layoutProblem', () => {
  it('rejects a hairpin too tight to draw', () => {
    const tight: TrackDefinition = { ...SQUARE, width: 200, points: [[0, 0], [1000, 0], [1000, 120], [0, 120]] };
    expect(layoutProblem(buildTrack(tight))).not.toBeNull();
  });
});

describe('locateOnTrack', () => {
  it('finds the same nearest point as checking every segment, on and far off the track', () => {
    const track = buildTrack(TRACKS[0]);
    const brute = (x: number, y: number) => {
      let best = Infinity;
      const n = track.points.length;
      for (let i = 0; i < n; i++) {
        const a = track.points[i];
        const b = track.points[(i + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
      }
      return best;
    };
    const { minX, minY, maxX, maxY } = track.bounds;
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 2000; k++) {
      // Includes points well outside the track's bounding box.
      const x = minX - 3000 + rand() * (maxX - minX + 6000);
      const y = minY - 3000 + rand() * (maxY - minY + 6000);
      expect(locateOnTrack(track, x, y).distance).toBeCloseTo(brute(x, y), 6);
    }
  });
});
