/**
 * Where boats moor, and where the ferries call: worked out from OSM when the
 * map's made. Boats lie alongside the quays mapped as moorings
 * (`man_made=quay` + `mooring=*`) and along the edges of the floating
 * pontoons (`man_made=pier` + `floating=yes`), each berth a boat's length
 * along the edge, out on the water side, wherever a boat that size fits on
 * the water. What's moored where goes by the mooring: narrowboats and Dutch
 * barges where people live aboard (`permit`), cruisers and yachts on the
 * visitors' pontoons (`guest`), a yacht club's yachts (`private`), the old
 * working boats at the commercial wharves, and the ferry company's own
 * pontoon its spare ferries. The ferries run the ferry routes
 * (`route=ferry`), calling at their stops (`amenity=ferry_terminal`, as
 * long as it isn't disused), each stop put alongside the nearest edge a
 * ferry fits against.
 */

import type { Area, Building, Pts } from './osm.ts';
import { pointInRing } from './osm.ts';

export type BoatKind = 'narrowboat' | 'barge' | 'cruiser' | 'yacht' | 'dinghy' | 'tug' | 'ferry';

/** Each kind's length and beam, metres. */
export const BOAT_SIZE: Record<BoatKind, [number, number]> = {
  narrowboat: [17, 2.1],
  barge: [19, 4],
  cruiser: [9, 3],
  yacht: [10, 3.3],
  dinghy: [4.2, 1.7],
  tug: [21, 5.5],
  ferry: [13, 3.8],
};

/** A berth: where a boat lies (its middle), which way it points, radians, and what kind of boat it's for. */
export interface Berth {
  x: number;
  y: number;
  angle: number;
  kind: BoatKind;
}

/** A ferry route: where it calls, in order: x, y, which way the ferry lies alongside, ... */
export interface FerryRoute {
  name: string;
  stops: number[];
}

/** An edge boats moor along: a quay's line, or a pontoon's outline (closed), and what sort of mooring it is. */
export interface MooringEdge {
  pts: Pts;
  closed: boolean;
  mooring: string;
  operator?: string;
}

/** What's moored at each sort of mooring, and how likely each. */
const MIX: Record<string, [BoatKind, number][]> = {
  permit: [['narrowboat', 0.4], ['barge', 0.2], ['cruiser', 0.25], ['yacht', 0.15]],
  guest: [['cruiser', 0.4], ['yacht', 0.3], ['narrowboat', 0.3]],
  private: [['yacht', 0.5], ['cruiser', 0.4], ['dinghy', 0.1]],
  commercial: [['tug', 0.7], ['barge', 0.3]],
  ferry: [['ferry', 1]],
  yes: [['cruiser', 0.35], ['yacht', 0.25], ['narrowboat', 0.25], ['dinghy', 0.15]],
};

/** The water boats can be on: in the water areas, and not on a pontoon or a pier, or where a ship's moored for good (mapped as a building). */
export class Water {
  private readonly water: Pts[][];
  private readonly solid: Pts[][];

  constructor(areas: Area[], buildings: Building[] = []) {
    this.water = areas.filter((a) => a.kind === 'water').map((a) => a.rings);
    this.solid = [...areas.filter((a) => a.kind === 'pontoon' || a.kind === 'pier').map((a) => a.rings), ...buildings.filter((b) => b.solid).map((b) => b.rings)];
  }

  /** Each water area's rings and each pontoon's and pier's, for their edges. */
  get rings(): Pts[] {
    return [...this.water.flat(), ...this.solid.flat()];
  }

  at(x: number, y: number): boolean {
    const inAny = (list: Pts[][]) => list.some((rings) => rings.reduce((n, r) => (pointInRing(x, y, r) ? !n : n), false));
    return inAny(this.water) && !inAny(this.solid);
  }

  /** Whether a boat (length L, beam W, px) lying at (x, y), pointing `angle`, is all on the water. */
  fits(x: number, y: number, angle: number, L: number, W: number): boolean {
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    for (const [a, b] of [[0, 0], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5], [0, 0.5], [0, -0.5], [0.25, 0.5], [0.25, -0.5], [-0.25, 0.5], [-0.25, -0.5]]) {
      if (!this.at(x + ux * L * a - uy * W * b, y + uy * L * a + ux * W * b)) return false;
    }
    return true;
  }
}

/** The same every time for the same place. */
function hash(x: number, y: number, k: number): number {
  let h = Math.imul(Math.round(x) * 73856093 ^ Math.round(y) * 19349663 ^ k * 83492791, 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function pick(mix: [BoatKind, number][], r: number): BoatKind {
  for (const [kind, p] of mix) {
    if (r < p) return kind;
    r -= p;
  }
  return mix[mix.length - 1][0];
}

/** Two boats' hulls (as rectangles) overlap, with `gap` px between them to spare. */
export function overlap(a: Berth, b: Berth, pxPerMetre: number, gap: number): boolean {
  const corners = (s: Berth) => {
    const [L, W] = BOAT_SIZE[s.kind].map((m) => m * pxPerMetre + gap);
    const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([p, q]) => [s.x + (ux * L * p) / 2 - (uy * W * q) / 2, s.y + (uy * L * p) / 2 + (ux * W * q) / 2]);
  };
  const [ca, cb] = [corners(a), corners(b)];
  // Separating axes: each rectangle's two.
  for (const s of [a, b]) {
    for (const [ax, ay] of [[Math.cos(s.angle), Math.sin(s.angle)], [-Math.sin(s.angle), Math.cos(s.angle)]]) {
      const span = (cs: number[][]) => cs.map(([x, y]) => x * ax + y * ay);
      const [pa, pb] = [span(ca), span(cb)];
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

/** The berths along the moorings' edges. */
export function findBerths(edges: MooringEdge[], water: Water, pxPerMetre: number): Berth[] {
  const berths: Berth[] = [];
  const m = pxPerMetre;
  edges.forEach((edge, e) => {
    const mix = MIX[/ferr/i.test(edge.operator ?? '') ? 'ferry' : edge.mooring] ?? MIX.yes;
    const p = edge.pts;
    const n = p.length / 2 - (edge.closed && p[0] === p[p.length - 2] && p[1] === p[p.length - 1] ? 1 : 0);
    const segments = edge.closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 4 * m) continue;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      // Which side's the water: the boats lie on that side.
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
      const side = water.at(mx - uy * 1.5 * m, my + ux * 1.5 * m) ? 1 : water.at(mx + uy * 1.5 * m, my - ux * 1.5 * m) ? -1 : 0;
      if (!side) continue;
      let d = 0.6 * m;
      for (let k = 0; d < len; k++) {
        // One of those moored here that fits in what's left of the edge.
        const fits = mix.filter(([kd]) => BOAT_SIZE[kd][0] * m <= len - 0.4 * m - d);
        if (!fits.length) break;
        const total = fits.reduce((t, [, w]) => t + w, 0);
        const kind = pick(fits.map(([kd, w]) => [kd, w / total]), hash(ax + d, ay, e * 1000 + i * 31 + k));
        const [L, W] = BOAT_SIZE[kind].map((v) => v * m);
        const off = W / 2 + 0.4 * m;
        // Facing either way along the edge.
        const angle = Math.atan2(uy, ux) + (hash(ax, ay + d, k) < 0.5 ? 0 : Math.PI);
        const b: Berth = { x: ax + ux * (d + L / 2) - uy * off * side, y: ay + uy * (d + L / 2) + ux * off * side, angle, kind };
        if (water.fits(b.x, b.y, angle, L, W) && !berths.some((o) => overlap(o, b, m, 0.5 * m))) {
          berths.push(b);
          d += L + (0.8 + hash(bx, by + d, k) * 1.8) * m;
        } else {
          d += 2 * m;
        }
      }
    }
  });
  return berths.map((b) => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, angle: +b.angle.toFixed(3), kind: b.kind }));
}

/**
 * Where a ferry lies at a stop: alongside the nearest edge (a quay, a
 * pontoon) to it that a ferry fits against, within 40 m. Null if there's none.
 */
export function ferryStop(x: number, y: number, water: Water, pxPerMetre: number, taken: Berth[] = []): [number, number, number] | null {
  const m = pxPerMetre;
  const [L, W] = BOAT_SIZE.ferry.map((v) => v * m);
  const reach = 40 * m;
  const spots: [number, number, number, number][] = [];
  for (const ring of water.rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      for (let d = 0; d <= len; d += 2 * m) {
        const [px, py] = [ax + ux * d, ay + uy * d];
        const dist = Math.hypot(px - x, py - y);
        if (dist < reach) spots.push([px, py, Math.atan2(uy, ux), dist]);
      }
    }
  }
  spots.sort((a, b) => a[3] - b[3]);
  for (const [px, py, angle] of spots) {
    for (const side of [1, -1]) {
      const [nx, ny] = [-Math.sin(angle) * side, Math.cos(angle) * side];
      const off = W / 2 + 0.5 * m;
      const [cx, cy] = [px + nx * off, py + ny * off];
      const b: Berth = { x: cx, y: cy, angle, kind: 'ferry' };
      if (water.fits(cx, cy, angle, L, W) && !taken.some((o) => overlap(o, b, m, 0))) return [Math.round(cx * 10) / 10, Math.round(cy * 10) / 10, +angle.toFixed(3)];
    }
  }
  return null;
}
