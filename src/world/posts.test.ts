import { describe, expect, it } from 'vitest';
import type { GameMap, Service } from '../map/osm';
import { central } from '../test/central';
import { type KerbLane, ROOM, kerbsides } from './posts';
import { Traffic, VEHICLES, type Vehicle } from './traffic';

const M = 8;
/** (The middle of Bristol, round where you start: see src/test/central.ts.) */
const map: GameMap = central();

describe('emergency services', () => {
  // A two-way street 7 m wide along y = 100, a police station on its south side (x 300 to 500), a zebra at x = 380.
  const road = { kind: 'street', pts: [0, 100, 800, 100], width: 7 * M } as GameMap['roads'][number];
  const street = { roads: [road], crossings: [{ x: 380, y: 100, angle: 0, width: 7 * M, kind: 'zebra' }], paint: [] } as unknown as Pick<GameMap, 'roads' | 'crossings' | 'paint'>;
  const lane = (pts: number[], id: number): KerbLane => ({ id, road: 0, pts, length: 800, index: 0, count: 1, stops: [] });
  // (Eastbound: on the north side, its kerb on its left; westbound on the south side, by the station.)
  const east = lane([0, 100 - 1.75 * M, 800, 100 - 1.75 * M], 0);
  const west = lane([800, 100 + 1.75 * M, 0, 100 + 1.75 * M], 1);
  const station: Service = { kind: 'police', x: 400, y: 200, rings: [[300, 150, 500, 150, 500, 250, 300, 250]] };
  const { length, width } = VEHICLES.police;

  it('park along the kerb by their building, on its side, clear of the crossing and of each other', () => {
    const spots = kerbsides(street, [east, west], station, length, width, [], [], 5);
    expect(spots.length).toBeGreaterThan(1);
    expect(spots.length).toBeLessThanOrEqual(5);
    for (const s of spots) {
      // On the station's side (westbound), facing on along it, up at the kerb, leaving room in the lane to get by.
      expect(s.lane).toBe(west);
      expect(Math.cos(s.angle)).toBeLessThan(-0.99);
      expect(s.y - (100 + 1.75 * M)).toBeCloseTo(s.off, 3);
      expect(s.off - width / 2).toBeGreaterThanOrEqual(ROOM - 0.01);
      expect(s.y + width / 2).toBeGreaterThan(100 + 3.5 * M);
      // Near the station, not by the zebra.
      expect(s.x).toBeGreaterThan(300 - 25 * M);
      expect(s.x).toBeLessThan(500 + 25 * M);
      expect(Math.abs(s.x - 380)).toBeGreaterThan(length / 2);
    }
    for (const a of spots) for (const b of spots) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(length);
  });

  it("have their places outside Bristol's police station, hospitals and fire station", () => {
    const traffic = new Traffic(map, { rand: () => 0.4 });
    const post = (name: string) => traffic.posts.find((p) => p.service.name === name);
    expect(post('The Bridewell Police Station')?.kind).toBe('police');
    expect(post('The Bridewell Police Station')!.spots.length).toBeGreaterThanOrEqual(3);
    expect(post('Bristol Royal Infirmary')?.kind).toBe('ambulance');
    expect(post('Bristol Royal Infirmary')!.spots.length).toBeGreaterThanOrEqual(4);
    expect(post('Temple Fire Station')?.kind).toBe('fire');
    expect(post('Temple Fire Station')!.spots.length).toBeGreaterThanOrEqual(2);
    const all = traffic.posts.flatMap((p) => p.spots);
    for (const a of all) for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4 * M);
    // Most taken at first: parked there.
    const parked = traffic.parked.filter((v) => v.post !== undefined);
    expect(parked.length).toBeGreaterThan(all.length / 2);
    for (const v of parked) expect(Math.hypot(v.x - v.spot!.x, v.y - v.spot!.y)).toBeLessThan(0.1);
  });

  it('come and go: off on a call (sirens going), and back to park, with the traffic getting by', () => {
    let seed = 7;
    const traffic = new Traffic(map, { rand: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
    const post = traffic.posts.find((p) => p.service.name === 'Temple Fire Station')!;
    const player = { x: post.x + 30 * M, y: post.y + 30 * M, heading: 0, vx: 0, vy: 0, level: 0, length: 38, width: 18 };
    const view = { x0: post.x - 300, y0: post.y - 140, x1: post.x + 300, y1: post.y + 140 };
    const there = new Set(post.spots.map((s) => s.taken).filter((id) => id !== null));
    let [left, sirens, came] = [0, 0, 0];
    const seen = new Set<number>();
    let heldUp = 0;
    const behind = new Map<number, number>();
    for (let t = 0; t < 300; t += 1 / 30) {
      traffic.update(1 / 30, player, view, () => 'green');
      for (const v of traffic.vehicles) {
        if (v.kind === 'fire' && !seen.has(v.id)) {
          seen.add(v.id);
          if (there.has(v.id)) left++;
          if (v.siren) sirens++;
        }
        // Not held up behind one parked there for long (they're gone round).
        const by = v.behind !== undefined && traffic.parked.find((p) => p.id === v.behind && p.post !== undefined);
        behind.set(v.id, by && v.speed < 1 ? (behind.get(v.id) ?? 0) + 1 / 30 : 0);
        heldUp = Math.max(heldUp, behind.get(v.id)!);
      }
      for (const s of post.spots) {
        if (s.taken === null || there.has(s.taken)) continue;
        const v = traffic.parked.find((p) => p.id === s.taken);
        if (!v) continue;
        there.add(s.taken);
        came++;
        // Parked in its place, at the kerb.
        expect(Math.hypot(v.x - s.x, v.y - s.y)).toBeLessThan(1);
      }
      // Those parked stay where they're parked.
      for (const v of traffic.parked) if (v.post !== undefined && v.mode === 'parked') expect(Math.hypot(v.x - v.spot!.x, v.y - v.spot!.y)).toBeLessThan(1);
    }
    expect(left).toBeGreaterThan(0);
    expect(sirens).toBeGreaterThan(0);
    expect(came).toBeGreaterThan(0);
    expect(heldUp).toBeLessThan(20);
  }, 120_000);

  it('on a call, keep no speed limit nor the rules of the road, going round what holds them up (wrong side, pavement), but hit nothing', () => {
    // (Runs where traffic holds it up, so it has to go round it: a few, as how often it's held up depends on the traffic.)
    let [top, round, pulledOver, nearest] = [0, 0, 0, Infinity];
    for (const start of [1, 2, 3]) {
      let seed = start;
      const traffic = new Traffic(map, { rand: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
      const post = traffic.posts.find((p) => p.service.name === 'Bristol Royal Infirmary')!;
      const player = { x: post.x + 40 * M, y: post.y + 40 * M, heading: 0, vx: 0, vy: 0, level: 0, length: 38, width: 18 };
      const view = { x0: post.x - 300, y0: post.y - 140, x1: post.x + 300, y1: post.y + 140 };
      for (let t = 0; t < 150; t += 1 / 30) {
        traffic.update(1 / 30, player, view, (i) => (Math.floor(t / 15 + i) % 2 ? 'green' : 'red'));
        for (const v of traffic.vehicles) {
          if (!v.siren) {
            if (v.side > 0.5 * M && v.kind !== 'bike' && !v.bus && !v.parking) pulledOver++;
            continue;
          }
          top = Math.max(top, v.speed);
          if (v.passing) round++;
          for (const o of [...traffic.vehicles, ...traffic.parked]) {
            if (o === v || o.level !== v.level || Math.abs(o.x - v.x) > 15 * M || Math.abs(o.y - v.y) > 15 * M) continue;
            nearest = Math.min(nearest, apart(v, o));
          }
        }
      }
    }
    // Well over the streets' 30 mph (13.4 m/s); round things; others pulling over; and never into anything.
    expect(top).toBeGreaterThan(17 * M);
    expect(round).toBeGreaterThan(0);
    expect(pulledOver).toBeGreaterThan(0);
    expect(nearest).toBeGreaterThan(-0.3 * M);
  }, 120_000);
});

/** How far apart two vehicles' sides are, px (less than 0, overlapping). */
function apart(a: Vehicle, b: Vehicle): number {
  const ends = (v: Vehicle) => {
    const h = Math.max(0, v.length / 2 - v.r);
    const [c, s] = [Math.cos(v.angle), Math.sin(v.angle)];
    return [v.x - c * h, v.y - s * h, v.x + c * h, v.y + s * h];
  };
  const [p, q] = [ends(a), ends(b)];
  let near = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) near = Math.min(near, Math.hypot(p[0] + ((p[2] - p[0]) * i) / 8 - q[0] - ((q[2] - q[0]) * j) / 8, p[1] + ((p[3] - p[1]) * i) / 8 - q[1] - ((q[3] - q[1]) * j) / 8));
  return near - a.r - b.r;
}
