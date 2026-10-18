/**
 * Generates the tyre barriers and cone positions for a track from its centre
 * line, so every track layout gets them for free.
 */

import { trackRoute } from '../downtown/city';
import { type Track, type Vec2, locateOnTrack, poseAt, resampleLoop } from './Track';

export const TYRE_RADIUS = 15;
export const CONE_RADIUS = 9;
/** Grass between the kerb and the barrier, where the track has room for it. */
export const RUN_OFF = 150;

/**
 * Tyre barrier positions on both sides of the track. The barrier sits RUN_OFF
 * beyond the kerb, except where another part of the track (or the inside of a
 * tight corner) is closer than that: there it runs along the line halfway
 * between, so you can never cut from one part of the track to another.
 */
export function buildBarriers(track: Track, runOff = track.runOff ?? RUN_OFF): Vec2[] {
  if (track.grid) return gridBarriers(track, runOff);
  const step = 6;
  const tyres: Vec2[] = [];
  const spacing = TYRE_RADIUS * 1.8;

  for (const side of [1, -1]) {
    const line = track.points.map((p, i) => {
      const halfOuter = track.halfWidths[i] + track.kerbWidth;
      const desired = halfOuter + runOff + TYRE_RADIUS;
      const nx = track.normals[i].x * side;
      const ny = track.normals[i].y * side;
      // Walk outwards until another bit of track's road edge is closer than this
      // one's: halfway between the two roads, whatever their widths.
      let offset = desired;
      for (let t = halfOuter + step; t <= desired; t += step) {
        const other = locateOnTrack(track, p.x + nx * t, p.y + ny * t);
        if (other.distance - other.halfWidth < t - track.halfWidths[i] - 1) {
          offset = t - step;
          break;
        }
      }
      return { x: p.x + nx * offset, y: p.y + ny * offset };
    });
    for (const tyre of resampleLoop(line, spacing).map((t) => clearOfRoad(track, t))) {
      // Where barriers meet (between close parts of the track, inside hairpins) skip duplicates.
      if (!tyres.some((t) => Math.hypot(t.x - tyre.x, t.y - tyre.y) < spacing * 0.75)) tyres.push(tyre);
    }
  }
  return tyres;
}

/**
 * Downtown: barriers down both sides of the race's streets, at the back of
 * the pavements, square round the corners of the grid: straight across the
 * side streets, meeting in a sharp corner on the outside of each turn and
 * cutting the corner of the pavement on the inside.
 */
function gridBarriers(track: Track, runOff: number): Vec2[] {
  const route = trackRoute(track, track.grid!);
  const out = track.width / 2 + track.kerbWidth + runOff + TYRE_RADIUS;
  const tyres: Vec2[] = [];
  const n = route.length;
  for (const side of [1, -1]) {
    // Each corner pushed out square from both streets meeting there (to the right of the way round, or the left).
    const line = route.map((v, k) => {
      const a = route[(k - 1 + n) % n];
      const b = route[(k + 1) % n];
      const din = unit(v.x - a.x, v.y - a.y);
      const dout = unit(b.x - v.x, b.y - v.y);
      return { x: v.x + side * out * (-din.y - dout.y), y: v.y + side * out * (din.x + dout.x) };
    });
    tyres.push(...resampleLoop(line, TYRE_RADIUS * 1.8));
  }
  return tyres;
}

function unit(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

/**
 * Nudges a barrier tyre straight outwards if it would overlap the road (evening
 * the barrier out can cut the inside of a very tight corner by a pixel or two).
 */
function clearOfRoad(track: Track, tyre: Vec2): Vec2 {
  // A nudge can bring it nearer a different bit of road (where the width differs), so check again.
  let at = tyre;
  for (let attempt = 0; attempt < 4; attempt++) {
    const pos = locateOnTrack(track, at.x, at.y);
    const min = pos.halfWidth + TYRE_RADIUS + 1;
    if (pos.distance >= min || pos.distance === 0) return at;
    const scale = (min + 0.5) / pos.distance;
    at = { x: pos.x + (at.x - pos.x) * scale, y: pos.y + (at.y - pos.y) * scale };
  }
  return at;
}

/**
 * Cones on the inside of the tightest corners, just past the kerb, waiting to
 * be clipped by anyone cutting the apex. Skips spots too close to a barrier.
 */
export function placeCones(track: Track, barriers: Vec2[], maxCorners = 6): Vec2[] {
  const { points, normals } = track;
  const n = points.length;
  const k = 3;
  const corners = points.map((b, i) => {
    const a = points[(i - k + n) % n];
    const c = points[(i + k) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const radius =
      (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) * Math.hypot(a.x - c.x, a.y - c.y)) /
      (2 * Math.abs(cross) || 1e-9);
    // On a y-down screen a positive cross product is a right-hand turn, so the inside is to the right.
    return { i, radius, inside: cross > 0 ? 1 : -1 };
  });

  const apexes = corners
    .filter((c) => c.radius < 450)
    .filter((c) => c.radius <= corners[(c.i - 1 + n) % n].radius && c.radius <= corners[(c.i + 1) % n].radius)
    .sort((a, b) => a.radius - b.radius);

  const chosen: typeof apexes = [];
  for (const apex of apexes) {
    const separated = chosen.every((c) => Math.min(Math.abs(c.i - apex.i), n - Math.abs(c.i - apex.i)) > 15);
    if (separated) chosen.push(apex);
    if (chosen.length === maxCorners) break;
  }

  const cones: Vec2[] = [];
  for (const apex of chosen) {
    for (const d of [-2, 0, 2]) {
      const j = (apex.i + d + n) % n;
      const offset = track.halfWidths[j] + track.kerbWidth + CONE_RADIUS + 6;
      const cone = {
        x: points[j].x + normals[j].x * apex.inside * offset,
        y: points[j].y + normals[j].y * apex.inside * offset,
      };
      const clear = barriers.every((t) => Math.hypot(t.x - cone.x, t.y - cone.y) > TYRE_RADIUS + CONE_RADIUS + 8);
      if (clear) cones.push(cone);
    }
  }
  return cones;
}

/**
 * Where the pieces of the track's road obstacles go: a line of loose tyres or
 * cones across the road at each obstacle, from one side of its reach to the other.
 */
export function obstaclePieces(track: Track): { tyres: Vec2[]; cones: Vec2[] } {
  const tyres: Vec2[] = [];
  const cones: Vec2[] = [];
  for (const o of track.obstacles) {
    const p = poseAt(track, o.along);
    const nx = -Math.sin(p.heading);
    const ny = Math.cos(p.heading);
    const solid = o.kind === 'tyres';
    const radius = solid ? TYRE_RADIUS : CONE_RADIUS;
    const gap = solid ? TYRE_RADIUS * 1.8 : CONE_RADIUS * 2.6;
    // Spread evenly so the ends of the line sit at the edges of its reach.
    const usable = Math.max(0, o.reach * 2 - radius * 2);
    const count = Math.max(1, Math.round(usable / gap) + 1);
    for (let k = 0; k < count; k++) {
      const across = o.offset - o.reach + radius + (count === 1 ? usable / 2 : (k * usable) / (count - 1));
      (solid ? tyres : cones).push({ x: p.x + nx * across, y: p.y + ny * across });
    }
  }
  return { tyres, cones };
}
