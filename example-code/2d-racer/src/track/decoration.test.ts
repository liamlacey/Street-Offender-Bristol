import { describe, expect, it } from 'vitest';
import { onGravel } from '../circuit/plan';
import { LOCATIONS, type Location } from '../locations/locations';
import { TYRE_RADIUS, buildBarriers } from './barriers';
import {
  AFLOAT,
  type Decoration,
  OVERHEAD,
  decorationSurface,
  planDecoration,
  propSamples,
  propsOverlap,
} from './decoration';
import { TRACK_DIFFICULTIES, TRACK_LENGTHS, generateTrack } from './generate';
import { type Track, type TrackDifficulty, buildTrack, locateOnTrack, poseAt } from './Track';
import { TRACKS } from './tracks';
import { inWater } from './water';
import { PORT_CELL, isLand } from './port';

const { docklands, woodlands, circuit, downtown, winter, desert } = LOCATIONS;
const generated = (location: Location, seeds: number[]) =>
  TRACK_LENGTHS.flatMap((length) =>
    TRACK_DIFFICULTIES.flatMap((difficulty) =>
      seeds.map(
        (seed) =>
          [`${location.name} ${length} ${difficulty} #${seed}`, location, difficulty, buildTrack(generateTrack(location, length, seed, difficulty))] as [
            string,
            Location,
            TrackDifficulty,
            Track,
          ],
      ),
    ),
  );
const cases: [string, Location, TrackDifficulty, Track][] = [
  ...TRACKS.map((def) => [def.name, docklands, 'medium', buildTrack(def)] as [string, Location, TrackDifficulty, Track]),
  ...generated(docklands, [11, 4242]),
  ...generated(woodlands, [11, 4242]),
  ...generated(circuit, [11, 4242]),
  ...generated(downtown, [11, 4242]),
  ...generated(winter, [11, 4242]),
  ...generated(desert, [11, 4242]),
];

describe.each(cases)('decoration: %s', (_name, location, difficulty, track) => {
  const barriers = buildBarriers(track);
  const deco: Decoration = planDecoration(track, barriers, location.decoration, 600, difficulty, location.circuit ?? null);
  const runOff = track.runOff ?? 150;
  const style = location.decoration;
  const circuitStyle = location.circuit ?? null;

  it('keeps every prop out beyond the barriers, clear of them and of each other', { timeout: 30_000 }, () => {
    const problems: string[] = [];
    for (const prop of deco.props) {
      // Tree tops may hang over the run-off, and log piles lie in it (see below); boats float.
      if (OVERHEAD.has(prop.kind) || prop.kind === 'logs' || AFLOAT.has(prop.kind)) continue;
      for (const s of propSamples(prop)) {
        const pos = locateOnTrack(track, s.x, s.y);
        const grass = pos.distance - pos.halfWidth - track.kerbWidth;
        if (grass <= runOff + TYRE_RADIUS * 2) problems.push(`${prop.kind} ${grass.toFixed(0)}px from the road`);
        if (deco.water.length > 0 && inWater(deco.water, s.x, s.y)) problems.push(`${prop.kind} in the water`);
        if (deco.port && !isLand(deco.port, s.x, s.y)) problems.push(`${prop.kind} in the dock`);
      }
      // The samples above are inside the barrier line; also check the tyres themselves.
      for (const t of barriers) {
        const c = Math.cos(prop.angle);
        const s = Math.sin(prop.angle);
        const u = Math.abs((t.x - prop.x) * c + (t.y - prop.y) * s) - prop.w / 2;
        const v = Math.abs(-(t.x - prop.x) * s + (t.y - prop.y) * c) - prop.h / 2;
        if (Math.hypot(Math.max(u, 0), Math.max(v, 0)) < TYRE_RADIUS) problems.push(`${prop.kind} on a barrier tyre`);
      }
    }
    const solid = deco.props.filter((p) => !OVERHEAD.has(p.kind));
    for (let a = 0; a < solid.length; a++) {
      for (let b = a + 1; b < solid.length; b++) {
        if (propsOverlap(solid[a], solid[b])) problems.push(`${solid[a].kind} overlaps ${solid[b].kind}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the docks clear of the track: the verge and concrete between, ships and boats afloat', () => {
    const port = deco.port;
    expect(port !== null).toBe(style.port);
    if (!port) return;
    const problems: string[] = [];
    const barrierZone = runOff + TYRE_RADIUS * 2;
    for (let r = 0; r < port.rows; r++) {
      for (let c = 0; c < port.cols; c++) {
        if (port.land[r * port.cols + c]) continue;
        // Every corner and edge-middle of a water plot is well beyond the verge.
        for (const [u, v] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
          const x = port.x0 + (c + u) * PORT_CELL;
          const y = port.y0 + (r + v) * PORT_CELL;
          const pos = locateOnTrack(track, x, y);
          const beyond = pos.distance - pos.halfWidth - track.kerbWidth - barrierZone - port.verge[Math.floor(pos.along / track.spacing) % port.verge.length];
          if (beyond < 40) problems.push(`water ${beyond.toFixed(0)}px past the verge`);
        }
      }
    }
    for (const prop of deco.props.filter((p) => AFLOAT.has(p.kind))) {
      if (propSamples(prop, 12).some((q) => isLand(port, q.x, q.y))) problems.push(`${prop.kind} aground`);
    }
    expect([...new Set(problems)]).toEqual([]);
    expect(deco.props.some((p) => p.kind === 'ship' || p.kind === 'boat')).toBe(true);
  });

  it('never hangs tree tops over the road', () => {
    for (const prop of deco.props.filter((p) => OVERHEAD.has(p.kind))) {
      const pos = locateOnTrack(track, prop.x, prop.y);
      expect(pos.distance - pos.halfWidth - track.kerbWidth - prop.w / 2).toBeGreaterThanOrEqual(29);
    }
  });

  it('has what the location calls for', () => {
    const count = (kind: string) => deco.props.filter((p) => p.kind === kind).length;
    if (circuitStyle) {
      expect(count('grandstand')).toBeGreaterThanOrEqual(2);
      expect(count('pits')).toBe(1);
      expect(count('marshal')).toBeGreaterThan(0);
      expect(count('board')).toBeGreaterThan(0);
      if (circuitStyle.banksPer10k > 0) expect(count('crowd')).toBeGreaterThan(2);
      if (circuitStyle.venue) {
        for (const kind of ['carpark', 'stall', 'screen', 'marquee', 'fans', 'tent']) expect(count(kind), kind).toBeGreaterThan(0);
        expect(deco.movers.length).toBeGreaterThan(0);
      }
    } else {
      // The natural places have none of a race circuit's things.
      for (const kind of ['grandstand', 'crowd', 'marshal', 'board', 'pits', 'tyres', 'flag']) expect(count(kind)).toBe(0);
      expect(deco.circuit).toBeNull();
    }
    if (style.lamps) expect(count('lamp')).toBeGreaterThan(0);
    if (style.forestRows > 0) expect(count('canopy')).toBeGreaterThan(track.length / 50);
    if (style.water) expect(deco.water.length).toBeGreaterThan(0);
    if (style.roadPatches) expect(deco.patches.length).toBeGreaterThan(0);
    if (style.clearingsPer10k > 0) expect(deco.props.some((p) => ['cabin', 'deer', 'tent', 'logstack', 'campsite', 'wreck'].includes(p.kind))).toBe(true);
    if (style.winter) {
      expect(count('piste')).toBeGreaterThan(0);
      expect(count('peak')).toBeGreaterThan(0);
    } else for (const kind of ['piste', 'peak', 'lake', 'snowmen']) expect(count(kind)).toBe(0);
    if (style.desert) {
      for (const kind of ['town', 'mesa', 'dune', 'playa', 'cactus']) expect(count(kind)).toBeGreaterThan(0);
    } else for (const kind of ['town', 'mesa', 'dune', 'playa', 'cactus', 'campsite', 'wreck']) expect(count(kind)).toBe(0);
  });

  it('keeps the docks busy, with everything that moves on dry land and clear of the track', () => {
    const port = deco.port;
    if (!port) {
      expect(deco.yards).toEqual([]);
      // Only fans, at a circuit, walk about away from the docks.
      if (!circuitStyle?.venue) expect(deco.movers).toEqual([]);
      const barrierZone = runOff + TYRE_RADIUS * 2;
      const problems: string[] = [];
      for (const m of deco.movers) {
        if (m.kind !== 'fan') problems.push(`a ${m.kind} away from the docks`);
        for (let t = 0; t <= 1; t += 0.05) {
          const pos = locateOnTrack(track, m.from.x + (m.to.x - m.from.x) * t, m.from.y + (m.to.y - m.from.y) * t);
          if (pos.distance - pos.halfWidth - track.kerbWidth < barrierZone + 20) problems.push('a fan on the track');
        }
      }
      expect([...new Set(problems)]).toEqual([]);
      return;
    }
    expect(deco.movers.filter((m) => m.kind === 'docker').length).toBeGreaterThan(0);
    expect(deco.props.some((p) => p.kind === 'workers')).toBe(true);
    const barrierZone = runOff + TYRE_RADIUS * 2;
    const problems: string[] = [];
    for (const m of deco.movers) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = m.from.x + (m.to.x - m.from.x) * t;
        const y = m.from.y + (m.to.y - m.from.y) * t;
        if (!isLand(port, x, y)) problems.push(`${m.kind} walks into the dock`);
        const pos = locateOnTrack(track, x, y);
        if (pos.distance - pos.halfWidth - track.kerbWidth < barrierZone + 20) problems.push(`${m.kind} on the track`);
      }
    }
    for (const yard of deco.yards) {
      const pos = locateOnTrack(track, yard.x, yard.y);
      if (pos.distance - pos.halfWidth - track.kerbWidth < barrierZone + 40) problems.push('yard crane by the track');
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('has forestry at work in the woods, each worksite with its logging track', () => {
    if (style.forestryPer10k === 0) {
      expect(deco.worksites).toEqual([]);
      expect(deco.props.some((p) => ['worksite', 'trail', 'fellers'].includes(p.kind))).toBe(false);
      return;
    }
    expect(deco.worksites.length).toBeGreaterThan(0);
    const trails = deco.props.filter((p) => p.kind === 'trail');
    expect(trails.length).toBe(deco.worksites.length);
    for (const { site, trail } of deco.worksites) {
      expect(deco.props).toContain(site);
      expect(trail).toBeGreaterThanOrEqual(240);
      // The track leads off the back of its site, away from the road.
      const back = { x: site.x - Math.sin(site.angle) * (site.h / 2 + 4 + trail / 2), y: site.y + Math.cos(site.angle) * (site.h / 2 + 4 + trail / 2) };
      expect(trails.some((t) => Math.hypot(t.x - back.x, t.y - back.y) < 140)).toBe(true);
    }
  });

  it('puts gravel only on the grass between the kerb and the barriers', () => {
    if (!deco.circuit) return;
    const gravel = deco.circuit.gravel;
    let traps = 0;
    for (const [side, band] of [[1, gravel.right], [-1, gravel.left]] as const) {
      band.outer.forEach((outer, i) => {
        if (outer === 0) return;
        traps++;
        const nrm = track.normals[i];
        for (const d of [band.inner[i], (band.inner[i] + outer) / 2, outer]) {
          const x = track.points[i].x + nrm.x * d * side;
          const y = track.points[i].y + nrm.y * d * side;
          const pos = locateOnTrack(track, x, y);
          expect(pos.distance).toBeGreaterThan(pos.halfWidth + track.kerbWidth);
          expect(barriers.every((t) => Math.hypot(t.x - x, t.y - y) > TYRE_RADIUS)).toBe(true);
        }
        // The middle of the band reads as gravel; the road beside it doesn't.
        const mid = (band.inner[i] + outer) / 2;
        const mx = track.points[i].x + nrm.x * mid * side;
        const my = track.points[i].y + nrm.y * mid * side;
        expect(onGravel(track, gravel, locateOnTrack(track, mx, my), mx, my)).toBe(true);
        const rx = track.points[i].x + nrm.x * 10 * side;
        const ry = track.points[i].y + nrm.y * 10 * side;
        expect(onGravel(track, gravel, locateOnTrack(track, rx, ry), rx, ry)).toBe(false);
      });
    }
    expect(traps > 0).toBe(circuitStyle?.gravel != null);
  });

  it('keeps solid things (gantry posts, railings, log piles) off the road', () => {
    for (const s of deco.solids) {
      const pos = locateOnTrack(track, s.x, s.y);
      expect(pos.distance - s.r).toBeGreaterThan(pos.halfWidth + track.kerbWidth);
    }
  });

  it('makes water, mud and puddles where it says, and plain road elsewhere', () => {
    const at = (along: number, offset: number) => {
      const p = poseAt(track, along);
      const x = p.x - Math.sin(p.heading) * offset;
      const y = p.y + Math.cos(p.heading) * offset;
      return decorationSurface(track, deco, locateOnTrack(track, x, y), x, y);
    };
    for (const w of deco.water) {
      expect(at(w.crossing.along, 0)).toBe(w.crossing.bridge ? 'bridge' : 'water');
      expect(at(w.crossing.along + w.width / 2 + 60, 0)).not.toBe('water');
    }
    for (const patch of deco.patches) expect(at(patch.along, patch.offset)).toBe(patch.kind === 'mud' ? 'mud' : 'water');
    // The grid is clear.
    expect(at(track.length - 300, 0)).toBeNull();
  });
});

describe('decoration', () => {
  it('is the same every time for the same track', () => {
    for (const location of [docklands, woodlands]) {
      const track = buildTrack(generateTrack(location, 'medium', 99, 'hard'));
      const barriers = buildBarriers(track);
      const a = planDecoration(track, barriers, location.decoration, 600, 'hard');
      const b = planDecoration(track, barriers, location.decoration, 600, 'hard');
      expect(a).toEqual(b);
    }
  });
});
