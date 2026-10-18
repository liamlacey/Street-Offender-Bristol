/**
 * Paints the ground, a piece of the map at a time, onto a 2D canvas: paving
 * everywhere to start with (it's a city centre), then grass, flowerbeds,
 * squares and water, the pavements, paths, kerbs and tarmac of the roads,
 * their lane markings and crossings, walls and railway lines, and the
 * shadows of the buildings and trees.
 *
 * The same drawing in flat colours, one per surface, makes the surface
 * grid (see surface.ts), so what you drive on matches what you see.
 */

import type { AreaKind, GameMap, Pts, Road } from '../map/osm';
import { type Paving, VEHICLE_ROADS, ringArea } from '../map/osm';
import { Surface, surfacePaint } from './surface';
import { type ChunkIndex, shadowOffset, subPolyline } from './world';

type Ctx = CanvasRenderingContext2D;
type Fill = string | CanvasPattern;

/** Pavements either side of a road, px wide. */
const PAVEMENT = 2.4 * 8;
/** The kerb stone's width, px. */
const KERB = 3;

export interface Palette {
  surface: boolean;
  base: Fill;
  area: Record<AreaKind, Fill>;
  pavement: Fill;
  path: Fill;
  plaza: Fill;
  cycleway: Fill;
  steps: Fill;
  track: Fill;
  kerb: Fill;
  parapet: Fill;
  asphalt: Fill;
  /** Each surface, where one's tagged (`asphalt` here is a path's tarmac, paler than a road's). */
  paving: Record<Paving, Fill>;
  marking: string;
  quay: string;
  pool: string;
}

/** The flat colours that paint the surface grid. */
export function surfacePalette(): Palette {
  const s = surfacePaint;
  const area: Record<AreaKind, Fill> = {
    grass: s(Surface.Grass),
    park: s(Surface.Grass),
    garden: s(Surface.Grass),
    flowerbed: s(Surface.Mud),
    wood: s(Surface.Grass),
    pitch: s(Surface.Grass),
    play: s(Surface.Pavement),
    plaza: s(Surface.Pavement),
    parking: s(Surface.Road),
    dirt: s(Surface.Dirt),
    water: s(Surface.Deep),
    pool: s(Surface.Pool),
    pier: s(Surface.Pavement),
    island: s(Surface.Pavement),
  };
  const pave = s(Surface.Pavement);
  return {
    surface: true,
    base: pave,
    area,
    pavement: pave,
    path: pave,
    plaza: pave,
    cycleway: s(Surface.Road),
    steps: pave,
    track: s(Surface.Dirt),
    kerb: pave,
    parapet: pave,
    asphalt: s(Surface.Road),
    paving: {
      asphalt: s(Surface.Road),
      paving: pave,
      sett: pave,
      concrete: pave,
      gravel: s(Surface.Dirt),
      wood: pave,
      grass: s(Surface.Grass),
    },
    marking: s(Surface.Road),
    quay: pave,
    pool: s(Surface.Pool),
  };
}

/**
 * Draws the part of the map from (x0, y0), `w` by `h` px, onto `ctx` at
 * `scale` canvas px per map px. `index` lists what's in that part.
 */
export function drawGround(ctx: Ctx, map: GameMap, index: ChunkIndex, palette: Palette, x0: number, y0: number, w: number, h: number, scale = 1, shadows?: Ctx): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = palette.base;
  ctx.fillRect(x0, y0, w, h);

  // Grass, squares, water: all but the traffic islands, which stand up out of the road.
  for (const i of index.areas) {
    const a = map.areas[i];
    if (a.kind === 'island') continue;
    fillRings(ctx, a.rings, a.surface ? palette.paving[a.surface] : palette.area[a.kind]);
    if (!palette.surface && (a.kind === 'water' || a.kind === 'pool')) {
      // The quayside's coping stones, or a pool's rim.
      strokeRings(ctx, a.rings, a.kind === 'water' ? palette.quay : palette.pool, a.kind === 'water' ? 5 : 3);
    }
  }

  const roads = index.roads.map((i) => map.roads[i]);
  const vehicle = roads.filter((r) => VEHICLE_ROADS.has(r.kind) && r.kind !== 'track');
  // Pavements along the roads.
  for (const r of vehicle) if (r.pavement && !r.bridge) stroke(ctx, r.pts, palette.pavement, r.width + PAVEMENT * 2);
  // Footpaths, cycle paths, pedestrian streets and steps (bridges over the water get their parapets).
  for (const r of roads) {
    if (VEHICLE_ROADS.has(r.kind) && r.kind !== 'track') continue;
    if (r.bridge && !palette.surface) stroke(ctx, r.pts, palette.parapet, r.width + 5);
    stroke(ctx, r.pts, pathFill(r, palette), r.width);
    if (r.kind === 'steps' && !palette.surface) {
      // Each step's edge.
      ctx.setLineDash([1.5, 3.5]);
      ctx.lineCap = 'butt';
      stroke(ctx, r.pts, 'rgba(0,0,0,0.28)', r.width);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
    }
  }
  // Kerbs, then the tarmac over them, so the roads run together at junctions.
  for (const r of vehicle) stroke(ctx, r.pts, r.bridge ? palette.parapet : palette.kerb, r.width + (r.bridge ? 7 : KERB * 2));
  for (const r of vehicle) stroke(ctx, r.pts, r.surface && r.surface !== 'asphalt' ? palette.paving[r.surface] : palette.asphalt, r.width);

  if (!palette.surface) {
    drawMarkings(ctx, vehicle, palette.marking);
    for (const i of index.crossings) drawCrossing(ctx, map.crossings[i], palette.marking);
  }

  // Traffic islands, kerbed.
  for (const i of index.areas) {
    const a = map.areas[i];
    if (a.kind !== 'island') continue;
    if (!palette.surface) strokeRings(ctx, a.rings, palette.kerb, KERB * 2);
    fillRings(ctx, a.rings, palette.area.island);
  }

  if (!palette.surface) {
    for (const i of index.lines) {
      const l = map.lines[i];
      switch (l.kind) {
        case 'wall':
          stroke(ctx, l.pts, '#6f655a', 5);
          stroke(ctx, l.pts, '#a39686', 3);
          break;
        case 'hedge':
          stroke(ctx, l.pts, '#24461d', 11);
          stroke(ctx, l.pts, '#3a6a2c', 7);
          break;
        case 'fence':
          stroke(ctx, l.pts, '#3b3530', 1.6);
          break;
        case 'railing':
          stroke(ctx, l.pts, '#2c2f33', 1.4);
          break;
        case 'quay':
          stroke(ctx, l.pts, palette.quay, 4);
          break;
        case 'rail':
          // Sleepers, then the two rails along them (a wide steel line with the middle painted out).
          ctx.setLineDash([3, 4]);
          ctx.lineCap = 'butt';
          stroke(ctx, l.pts, '#5a4632', 16);
          ctx.setLineDash([]);
          stroke(ctx, l.pts, '#8f9396', 12);
          stroke(ctx, l.pts, '#6b6258', 9);
          ctx.lineCap = 'round';
          break;
      }
    }
  }

  if (shadows && !palette.surface) drawShadows(ctx, shadows, map, index, x0, y0, w, h, scale);
  ctx.restore();
}

function pathFill(r: Road, p: Palette): Fill {
  if (r.surface && r.kind !== 'steps') return p.paving[r.surface];
  switch (r.kind) {
    case 'pedestrian':
      return p.plaza;
    case 'cycleway':
      return p.cycleway;
    case 'steps':
      return p.steps;
    case 'track':
      return p.track;
    default:
      return p.path;
  }
}

/** Dashed white lines down the middle of two-way roads, stopping short of the junctions. */
function drawMarkings(ctx: Ctx, roads: Road[], colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  for (const r of roads) {
    // No lines painted on cobbles.
    if (!r.marks || (r.surface && r.surface !== 'asphalt' && r.surface !== 'concrete')) continue;
    if (r.oneway) {
      // A one-way street wide enough for two lanes gets a line between them.
      if (r.width < 6 * 8) continue;
    }
    ctx.setLineDash(r.kind === 'primary' || r.kind === 'trunk' ? [32, 16] : [24, 24]);
    ctx.lineWidth = 1.8;
    for (let k = 0; k + 1 < r.marks.length; k += 2) {
      const piece = subPolyline(r.pts, r.marks[k], r.marks[k + 1]);
      if (piece.length < 4) continue;
      ctx.beginPath();
      path(ctx, piece);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}

/** A zebra crossing's stripes, or the two dashed lines of a crossing at lights. */
function drawCrossing(ctx: Ctx, c: GameMap['crossings'][number], colour: string): void {
  const ux = Math.cos(c.angle);
  const uy = Math.sin(c.angle);
  // Across the road.
  const half = c.width / 2;
  const ax = c.x + uy * half;
  const ay = c.y - ux * half;
  const bx = c.x - uy * half;
  const by = c.y + ux * half;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  if (c.zebra) {
    ctx.setLineDash([4.5, 4.5]);
    ctx.lineWidth = 20;
    line(ctx, ax, ay, bx, by);
  } else {
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    for (const d of [-10, 10]) line(ctx, ax + ux * d, ay + uy * d, bx + ux * d, by + uy * d);
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}

/**
 * The shadows of the buildings and trees, drawn solid onto a scratch
 * canvas so overlapping ones don't darken each other, then laid over the
 * ground see-through.
 */
function drawShadows(ctx: Ctx, scratch: Ctx, map: GameMap, index: ChunkIndex, x0: number, y0: number, w: number, h: number, scale: number): void {
  const canvas = scratch.canvas;
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, canvas.width, canvas.height);
  scratch.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  scratch.fillStyle = '#000';
  scratch.beginPath();
  for (const i of index.buildings) {
    const b = map.buildings[i];
    if (!b.drawn || b.bottom > 0 || b.kind === 'roof') continue;
    const [sx, sy] = shadowOffset(b.top);
    const ring = b.rings[0];
    // The footprint swept along the shadow: the footprint, the same moved, and each wall's sweep
    // between, all wound the same way so they add up rather than cancel.
    const n = ring.length;
    const forwards = ringArea(ring) > 0;
    for (const [dx, dy] of [[0, 0], [sx, sy]]) {
      for (let k = 0; k < n; k += 2) {
        const at = forwards ? k : n - 2 - k;
        if (k === 0) scratch.moveTo(ring[at] + dx, ring[at + 1] + dy);
        else scratch.lineTo(ring[at] + dx, ring[at + 1] + dy);
      }
      scratch.closePath();
    }
    for (let k = 0; k < n; k += 2) {
      const j = (k + 2) % n;
      const cross = (ring[j] - ring[k]) * sy - (ring[j + 1] - ring[k + 1]) * sx;
      if (cross > 0) {
        scratch.moveTo(ring[k], ring[k + 1]);
        scratch.lineTo(ring[j], ring[j + 1]);
        scratch.lineTo(ring[j] + sx, ring[j + 1] + sy);
        scratch.lineTo(ring[k] + sx, ring[k + 1] + sy);
      } else {
        scratch.moveTo(ring[k], ring[k + 1]);
        scratch.lineTo(ring[k] + sx, ring[k + 1] + sy);
        scratch.lineTo(ring[j] + sx, ring[j + 1] + sy);
        scratch.lineTo(ring[j], ring[j + 1]);
      }
      scratch.closePath();
    }
  }
  scratch.fill('nonzero');
  // Trees: a soft round shadow off to the side.
  for (const t of index.trees) {
    const [x, y, r, h] = [map.trees[t * 4], map.trees[t * 4 + 1], map.trees[t * 4 + 2], map.trees[t * 4 + 3]];
    const [sx, sy] = shadowOffset(h * 0.7);
    scratch.beginPath();
    scratch.arc(x + sx, y + sy, r * 0.95, 0, Math.PI * 2);
    scratch.fill();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.3;
  ctx.drawImage(canvas, 0, 0, w * scale, h * scale, 0, 0, w * scale, h * scale);
  ctx.restore();
}

function path(ctx: Ctx, pts: Pts, closed = false): void {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (closed) ctx.closePath();
}

function line(ctx: Ctx, ax: number, ay: number, bx: number, by: number): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function stroke(ctx: Ctx, pts: Pts, fill: Fill, width: number): void {
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.beginPath();
  path(ctx, pts);
  ctx.stroke();
}

function fillRings(ctx: Ctx, rings: Pts[], fill: Fill): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const r of rings) path(ctx, r, true);
  ctx.fill('evenodd');
}

function strokeRings(ctx: Ctx, rings: Pts[], fill: Fill, width: number): void {
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const r of rings) path(ctx, r, true);
  ctx.stroke();
}
