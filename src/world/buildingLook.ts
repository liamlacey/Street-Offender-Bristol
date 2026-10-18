/**
 * How each building looks, worked out once from its map data: its walls'
 * and roof's colours, which way each wall faces (and so how lit it is),
 * its roof cut into triangles (in two slopes for a pitched roof, with the
 * ridge between), the plant boxes on a flat roof, and how many floors of
 * windows it has. Pure, so it's tested; Buildings.ts draws it.
 */

import { type Building, type Pts, centroid, ridgeAxis, ringArea } from '../map/osm';
import { buildingSeed } from './world';

/** A storey's height, px. */
export const FLOOR = 3.2 * 8;

export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Outward normal. */
  nx: number;
  ny: number;
  colour: number;
}

export interface RoofFacet {
  /** Triangles: x0, y0, x1, y1, x2, y2, ... */
  tris: number[];
  colour: number;
}

export interface BuildingLook {
  b: Building;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  walls: Wall[];
  facets: RoofFacet[];
  /** The roof's outline, for a flat roof's parapet: x0, y0, x1, y1, ... (closed). */
  rim: Pts | null;
  rimColour: number;
  ridge: [number, number, number, number] | null;
  ridgeColour: number;
  /** Plant and vents on a flat roof: x, y, w, h. */
  boxes: [number, number, number, number][];
  /** Window bands' colour, or null for no windows (sheds, canopies, ships). */
  windows: number | null;
  /** Just a roof on posts (a canopy): no walls drawn. */
  canopy: boolean;
}

/** Earcut, from Phaser (passed in, so this file needn't load Phaser to be tested). */
export type Triangulate = (data: number[], holeIndices?: number[]) => number[];

const PITCHED_KINDS = new Set(['house', 'terrace', 'detached', 'semidetached_house', 'church', 'chapel', 'cathedral', 'bungalow', 'cottage', 'garage', 'shed']);
const PITCHED_SHAPES = new Set(['gabled', 'hipped', 'pitched', 'half-hipped', 'gambrel', 'mansard', 'saltbox', 'side_hipped', 'double_saltbox']);
const NO_WINDOWS = new Set(['roof', 'shed', 'garage', 'garages', 'ship', 'kiosk', 'hut', 'service', 'toilets']);

/** Where the light comes from (the top left, the north-west, as the shadows say), as a direction on the map. */
const LIGHT = { x: -0.6, y: -0.8 };

const NAMED_COLOURS: Record<string, number> = {
  white: 0xe6e3da,
  grey: 0x8f8f8c,
  gray: 0x8f8f8c,
  lightgrey: 0xb5b4ae,
  lightgray: 0xb5b4ae,
  darkgrey: 0x5c5c5a,
  darkgray: 0x5c5c5a,
  silver: 0xb9bcbf,
  black: 0x34363a,
  red: 0x9a4436,
  maroon: 0x6e3229,
  brown: 0x7a5440,
  tan: 0xc0a47c,
  beige: 0xd5c6a1,
  cream: 0xe0d6b8,
  yellow: 0xd8c27a,
  orange: 0xc77a46,
  green: 0x58705a,
  blue: 0x50708c,
  pink: 0xd7a3a0,
};

export function parseColour(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return parseInt(h, 16);
  }
  return NAMED_COLOURS[v];
}

export function shade(colour: number, k: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((colour >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((colour >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((colour & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

/** Walls and roofs for each kind of building, to pick from. */
function palette(kind: string): { walls: number[]; roofs: number[] } {
  switch (kind) {
    case 'cathedral':
    case 'church':
    case 'chapel':
      return { walls: [0xb7a17c, 0xa8916c, 0xbfae8c], roofs: [0x6c7772, 0x5f6966, 0x76807a] };
    case 'house':
    case 'terrace':
    case 'detached':
    case 'semidetached_house':
      return { walls: [0x8d5040, 0xd8cfb8, 0xa0644c, 0xc9b28a, 0xe0d9c6], roofs: [0x5a5e66, 0x8f4e3a, 0x4f535a, 0x9b5a44] };
    case 'apartments':
    case 'residential':
    case 'dormitory':
      return { walls: [0xb9ad98, 0x8d5c48, 0xd2c8b3, 0x9b9a95, 0xa66e55], roofs: [0x7e7f7c, 0x5d6065, 0x8c8a84, 0x6a6c70] };
    case 'office':
    case 'commercial':
    case 'hotel':
      return { walls: [0x9a9893, 0x6b8299, 0xc8bea8, 0x8a6a58, 0x55697c, 0xb7b2a6], roofs: [0x8e8f8a, 0x56585c, 0xa8a49a, 0x6d6f73] };
    case 'retail':
      return { walls: [0xc4b69a, 0xa86a50, 0xd9d1bf, 0x9d9a92], roofs: [0x7a7b77, 0x5e6064, 0x9a968c] };
    case 'industrial':
    case 'warehouse':
      return { walls: [0x8a6a52, 0x7f8790, 0x9c8a74], roofs: [0x6d747a, 0x8a8f92, 0x5b6268] };
    case 'ship':
      return { walls: [0x1f2a3a, 0x2c2c2c, 0x5a1f1f], roofs: [0x9a7a54] };
    case 'roof':
      return { walls: [0x6f6f6c], roofs: [0x7c8086, 0x5f6a72, 0x8a8478] };
    case 'government':
    case 'civic':
    case 'public':
    case 'university':
    case 'college':
    case 'school':
      return { walls: [0xa6684e, 0xbba585, 0x8d5040, 0xc9bda2], roofs: [0x6a7270, 0x5d6065, 0x7d7a74] };
    default:
      return { walls: [0xb5a993, 0x8d5c48, 0x9e9c96, 0xc9bfa9, 0xa77556, 0x7d8a96], roofs: [0x7f807c, 0x5d6065, 0x8f8b83, 0x6a6e72, 0x9a948a] };
  }
}

export function buildingLook(b: Building, triangulate: Triangulate): BuildingLook {
  const seed = buildingSeed(b);
  const pick = <T>(list: T[], salt: number) => list[Math.floor(((seed * 7919 * (salt + 1)) % 1) * list.length)];
  const { walls: wallChoices, roofs: roofChoices } = palette(b.kind);
  const wallColour = parseColour(b.wall) ?? pick(wallChoices, 0);
  const roofColour = parseColour(b.roof) ?? pick(roofChoices, 1);
  const outer = b.rings[0];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outer.length; i += 2) {
    x0 = Math.min(x0, outer[i]);
    x1 = Math.max(x1, outer[i]);
    y0 = Math.min(y0, outer[i + 1]);
    y1 = Math.max(y1, outer[i + 1]);
  }

  // Walls, each with its outward normal (away from the building: into a courtyard for its inner rings).
  const walls: Wall[] = [];
  b.rings.forEach((ring, r) => {
    const sign = (ringArea(ring) > 0 ? 1 : -1) * (r === 0 ? 1 : -1);
    const n = ring.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const dx = ring[j] - ring[i];
      const dy = ring[j + 1] - ring[i + 1];
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      // y is down on screen, so this (dy, -dx) is outward for a ring with positive area.
      const nx = (sign * dy) / len;
      const ny = (sign * -dx) / len;
      const lit = nx * LIGHT.x + ny * LIGHT.y;
      walls.push({ ax: ring[i], ay: ring[i + 1], bx: ring[j], by: ring[j + 1], nx, ny, colour: shade(wallColour, 0.78 + lit * 0.2) });
    }
  });

  const area = Math.abs(ringArea(outer));
  const pitched =
    b.kind !== 'roof' &&
    (b.roofShape ? PITCHED_SHAPES.has(b.roofShape) : PITCHED_KINDS.has(b.kind)) &&
    area < 6000 * 64 &&
    b.rings.length === 1;
  const facets: RoofFacet[] = [];
  let ridge: BuildingLook['ridge'] = null;
  const c = centroid(outer);
  if (pitched) {
    // The ridge runs along the building's longest side (or across it), through its middle; the two slopes either side are lit differently.
    const { ox, oy, ux, uy, t0, t1, half: halfWidth } = ridgeAxis(outer, b.roofAcross);
    for (const side of [1, -1]) {
      const half = clipHalfPlane(outer, ox, oy, ux, uy, side);
      if (half.length < 6) continue;
      // This slope faces out from the ridge, across it.
      const nx = -uy * side;
      const ny = ux * side;
      const lit = nx * LIGHT.x + ny * LIGHT.y;
      facets.push({ tris: triangles(half, [], triangulate), colour: shade(roofColour, 0.9 + lit * 0.24) });
    }
    const hip = b.roofShape === 'hipped' ? halfWidth : 0;
    if (t1 - t0 > hip * 2) ridge = [ox + ux * (t0 + hip), oy + uy * (t0 + hip), ox + ux * (t1 - hip), oy + uy * (t1 - hip)];
  }
  const pyramid = !pitched && (b.roofShape === 'pyramidal' || b.roofShape === 'dome' || b.roofShape === 'onion') && b.rings.length === 1;
  if (pyramid) {
    // A spire's or tower's pointed roof: a triangle up to the middle from each side, lit by which way it faces.
    for (const w of walls) {
      const lit = w.nx * LIGHT.x + w.ny * LIGHT.y;
      facets.push({ tris: [w.ax, w.ay, w.bx, w.by, c.x, c.y], colour: shade(roofColour, 0.9 + lit * 0.2) });
    }
  }
  if (facets.length === 0) facets.push({ tris: triangles(outer, b.rings.slice(1), triangulate), colour: roofColour });

  // Plant on the roofs of big flat-roofed buildings, somewhere inside the outline.
  const boxes: BuildingLook['boxes'] = [];
  if (!pitched && b.kind !== 'roof' && b.kind !== 'ship' && area > 160 * 64) {
    const count = Math.min(5, Math.floor(area / (300 * 64)) + 1);
    let s = Math.floor(seed * 2147483646) + 1;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0, tries = 0; k < count && tries < 30; tries++) {
      const w = 10 + rand() * 22;
      const h = 8 + rand() * 16;
      const x = x0 + rand() * (x1 - x0 - w);
      const y = y0 + rand() * (y1 - y0 - h);
      const corners = [x, y, x + w, y, x, y + h, x + w, y + h];
      if (!corners.every((_, i) => i % 2 || insideRings(corners[i], corners[i + 1], b.rings, 4))) continue;
      boxes.push([x, y, w, h]);
      k++;
    }
  }

  const glass = wallColour === 0x6b8299 || wallColour === 0x55697c || wallColour === 0x7d8a96;
  return {
    b,
    x0,
    y0,
    x1,
    y1,
    walls,
    facets,
    rim: pitched || pyramid || b.kind === 'roof' || b.roofShape === 'skillion' ? null : outer,
    rimColour: shade(roofColour, 1.18),
    ridge,
    ridgeColour: shade(roofColour, 0.7),
    boxes,
    windows: NO_WINDOWS.has(b.kind) ? null : glass ? 0x9fc3db : shade(wallColour, 0.5),
    canopy: b.kind === 'roof',
  };
}

function triangles(outer: Pts, holes: Pts[], triangulate: Triangulate): number[] {
  const data = [...outer];
  const holeIndices: number[] = [];
  for (const h of holes) {
    holeIndices.push(data.length / 2);
    data.push(...h);
  }
  const idx = triangulate(data, holeIndices.length ? holeIndices : undefined);
  const tris: number[] = [];
  for (const i of idx) tris.push(data[i * 2], data[i * 2 + 1]);
  return tris;
}

/** The part of a ring on one side of a line through (ox, oy) along (ux, uy). */
export function clipHalfPlane(ring: Pts, ox: number, oy: number, ux: number, uy: number, side: number): Pts {
  const out: Pts = [];
  const n = ring.length;
  const d = (i: number) => side * (ux * (ring[i + 1] - oy) - uy * (ring[i] - ox));
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const di = d(i);
    const dj = d(j);
    if (di >= 0) out.push(ring[i], ring[i + 1]);
    if ((di >= 0) !== (dj >= 0)) {
      const t = di / (di - dj);
      out.push(ring[i] + (ring[j] - ring[i]) * t, ring[i + 1] + (ring[j + 1] - ring[i + 1]) * t);
    }
  }
  return out;
}

function insideRings(x: number, y: number, rings: Pts[], margin: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) {
      const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      // Too near a wall.
      const dx = xj - xi;
      const dy = yj - yi;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / len2));
      if (Math.hypot(xi + dx * t - x, yi + dy * t - y) < margin) return false;
    }
  }
  return inside;
}
