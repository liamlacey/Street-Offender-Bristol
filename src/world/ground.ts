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

import type { Area, AreaKind, GameMap, Pts, Road } from '../map/osm';
import { type Paving, VEHICLE_ROADS, ringArea } from '../map/osm';
import { drawCarParks, drawHumps, drawLaneFills, drawLanes, drawPaint } from './paint';
import { Surface, surfacePaint } from './surface';
import { type ChunkIndex, lineLength, offsetLine, pointAlong, shadowOffset, subPolyline } from './world';

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
    pontoon: s(Surface.Pavement),
    forecourt: s(Surface.Road),
    slipway: s(Surface.Pavement),
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
    // A pontoon floats: its shadow on the water round it, first.
    if (a.kind === 'pontoon' && !palette.surface) strokeRings(ctx, a.rings, 'rgba(10,25,35,0.35)', 7);
    fillRings(ctx, a.rings, a.surface ? palette.paving[a.surface] : palette.area[a.kind]);
    if (!palette.surface && a.kind === 'pontoon') pontoonEdges(ctx, a.rings);
    if (!palette.surface && a.kind === 'slipway') slipwayLook(ctx, a);
    if (!palette.surface && (a.kind === 'water' || a.kind === 'pool')) {
      // The quayside's coping stones, or a pool's rim.
      strokeRings(ctx, a.rings, a.kind === 'water' ? palette.quay : palette.pool, a.kind === 'water' ? 5 : 3);
    }
  }

  // Bridges aren't on the ground: they're decks above it (see drawDeck).
  const roads = index.roads.map((i) => map.roads[i]).filter((r) => !r.bridge);
  const vehicle = roads.filter((r) => VEHICLE_ROADS.has(r.kind) && r.kind !== 'track');
  // Pavements along the roads.
  for (const r of vehicle) {
    if (r.pavement === 'both') stroke(ctx, r.pts, palette.pavement, r.width + PAVEMENT * 2);
    // On one side only: a strip from the middle of the road out (the road's drawn over the inner half).
    else if (r.pavement) stroke(ctx, offsetLine(r.pts, ((r.width / 2 + PAVEMENT) / 2) * (r.pavement === 'left' ? 1 : -1)), palette.pavement, r.width / 2 + PAVEMENT);
  }
  // Footpaths, cycle paths, pedestrian streets and steps.
  for (const r of roads) {
    if (VEHICLE_ROADS.has(r.kind) && r.kind !== 'track') continue;
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
  for (const r of vehicle) stroke(ctx, r.pts, palette.kerb, r.width + KERB * 2);
  for (const r of vehicle) stroke(ctx, r.pts, r.surface && r.surface !== 'asphalt' ? palette.paving[r.surface] : palette.asphalt, r.width);

  if (!palette.surface) {
    // The road markings, painted on a layer of their own, worn, then laid on the road.
    const paint = paintLayer(ctx);
    // Bus lanes' red first, then the lines and words over everything.
    drawLaneFills(paint, vehicle);
    drawHumps(paint, map, index);
    drawMarkings(paint, vehicle, palette.marking);
    for (const i of index.crossings) drawCrossing(paint, map, map.crossings[i], palette.marking);
    for (const i of index.signals) drawStopLine(paint, map.signals[i], palette.marking);
    drawCarParks(paint, map, index);
    drawLanes(paint, vehicle, map.paint);
    drawPaint(paint, map, index);
    weather(paint, x0, y0, w, h);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paint.canvas, 0, 0);
    ctx.restore();
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
        // Garden walls, hedges, fences and railings stand up off the ground, and can be knocked down: see WallLayer.
        case 'quay':
          stroke(ctx, l.pts, palette.quay, 4);
          break;
        // A kerb mapped on its own (round a square, along a path): its edge stones.
        case 'kerb':
          stroke(ctx, l.pts, palette.kerb, KERB);
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

/**
 * A bridge's deck, for drawing above the ground: its parapets either side,
 * and its surface (tarmac and a centre line for a road, the path's paving or
 * planks for a footbridge or jetty), in map px.
 */
export function drawDeck(ctx: Ctx, r: Road, palette: Palette): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const vehicle = VEHICLE_ROADS.has(r.kind) && r.kind !== 'track';
  // Stone parapets, with a dark edge to show they stand up off the deck.
  stroke(ctx, r.pts, '#3f3a34', r.width + 10);
  stroke(ctx, r.pts, '#b9ae99', r.width + 7);
  stroke(ctx, r.pts, 'rgba(0,0,0,0.35)', r.width + 2);
  stroke(ctx, r.pts, vehicle ? (r.surface && r.surface !== 'asphalt' ? palette.paving[r.surface] : palette.asphalt) : pathFill(r, palette), r.width);
  if (vehicle) drawMarkings(ctx, [r], palette.marking);
  ctx.lineCap = 'round';
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
    // Where its lanes are: the centre line of a two-way road, and a line between each lane each way where there's more than one.
    const offsets: number[] = [];
    const [forward, backward] = r.lanesAcross ?? (r.oneway ? [r.width >= 6 * 8 ? 2 : 1, 0] : [1, 1]);
    if (r.oneway) {
      for (let i = 1; i < forward; i++) offsets.push(r.width / 2 - (i * r.width) / forward);
    } else {
      offsets.push(0);
      for (let i = 1; i < forward; i++) offsets.push(r.width / 2 - (i * r.width) / 2 / forward);
      for (let i = 1; i < backward; i++) offsets.push(-(r.width / 2 - (i * r.width) / 2 / backward));
    }
    // Not inside a bus lane (its own solid line's its edge).
    const bus = (r.lanes ?? []).filter((l) => l.kind === 'bus');
    const kept = offsets.filter((off) => !bus.some((l) => off * l.side > r.width / 2 - l.width - 6));
    offsets.length = 0;
    offsets.push(...kept);
    ctx.setLineDash(r.kind === 'primary' || r.kind === 'trunk' ? [32, 16] : [24, 24]);
    ctx.lineWidth = 1.8;
    for (let k = 0; k + 1 < r.marks.length; k += 2) {
      const piece = subPolyline(r.pts, r.marks[k], r.marks[k + 1]);
      if (piece.length < 4) continue;
      for (const off of offsets) {
        ctx.beginPath();
        path(ctx, off ? offsetLine(piece, off) : piece);
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}

/** A zebra crossing's stripes, or the two dashed lines of a crossing at lights. */
/**
 * A crossing: a zebra's stripes, or the two lines of studs either side of a
 * crossing with lights; and either way the zig-zags along both kerbs, where
 * you mustn't stop or overtake. A crossing that's just a dropped kerb has
 * nothing painted.
 */
function drawCrossing(ctx: Ctx, map: GameMap, c: GameMap['crossings'][number], colour: string): void {
  if (c.kind === 'plain') return;
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
  if (c.kind === 'zebra') {
    ctx.setLineDash([4.5, 4.5]);
    ctx.lineWidth = 20;
    line(ctx, ax, ay, bx, by);
  } else {
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    for (const d of [-10, 10]) line(ctx, ax + ux * d, ay + uy * d, bx + ux * d, by + uy * d);
  }
  ctx.setLineDash([]);
  // The zig-zags, along each kerb, both sides of the crossing, following the road round its bends
  // (and stopping where it ends, at a junction).
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'miter';
  const road = c.road !== undefined ? map.roads[c.road] : undefined;
  const length = road ? lineLength(road.pts) : 0;
  for (const side of [-1, 1]) {
    const edge = side * (half - 3);
    for (const way of [-1, 1]) {
      ctx.beginPath();
      let started = false;
      for (let k = 0; k <= ZIGZAGS; k++) {
        const along = way * (ZIGZAG_FROM + k * ZIGZAG_STEP);
        const out = edge + (k % 2 ? -side * 2.5 : 0);
        let x: number;
        let y: number;
        if (road && c.at !== undefined) {
          const d = c.at + along;
          if (d < 0 || d > length) break;
          const [px, py, tx, ty] = pointAlong(road.pts, d, 16);
          x = px - ty * out;
          y = py + tx * out;
        } else {
          x = c.x + ux * along - uy * out;
          y = c.y + uy * along + ux * out;
        }
        if (!started) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        started = true;
      }
      ctx.stroke();
    }
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

/** The zig-zags start this far from a crossing's middle, px, and go this many zigs of this length. */
const ZIGZAG_FROM = 2.5 * 8;
const ZIGZAGS = 10;
const ZIGZAG_STEP = 1 * 8;

/** A stop line across the lanes coming into a set of lights. */
function drawStopLine(ctx: Ctx, s: GameMap['signals'][number], colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 3;
  line(ctx, ...s.stop);
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
  // The bridges' decks, overhead.
  scratch.strokeStyle = '#000';
  scratch.lineCap = 'butt';
  for (const i of index.roads) {
    const r = map.roads[i];
    if (!r.bridge) continue;
    const [sx, sy] = shadowOffset(5 * 8);
    scratch.lineWidth = r.width + 6;
    scratch.beginPath();
    scratch.moveTo(r.pts[0] + sx, r.pts[1] + sy);
    for (let k = 2; k < r.pts.length; k += 2) scratch.lineTo(r.pts[k] + sx, r.pts[k + 1] + sy);
    scratch.stroke();
  }
  // Trees: a soft round shadow off to the side.
  for (const t of index.trees) {
    const [x, y, r, h] = [map.trees[t * 4], map.trees[t * 4 + 1], map.trees[t * 4 + 2], map.trees[t * 4 + 3]];
    // One that's been knocked down (its crown's size set to 0) is lying flat: no shadow.
    if (r <= 0) continue;
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

/** A pontoon's edges: a black rubber fender all round, and a mooring cleat every 6 m along it. */
function pontoonEdges(ctx: Ctx, rings: Pts[]): void {
  strokeRings(ctx, rings, '#1c1d1f', 2);
  ctx.fillStyle = '#2b2c2f';
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 3 * 8) continue;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      for (let d = 3 * 8; d < len - 1.5 * 8; d += 6 * 8) {
        ctx.save();
        ctx.translate(ax + ux * d, ay + uy * d);
        ctx.rotate(Math.atan2(uy, ux));
        ctx.fillRect(-1.6, -0.6, 3.2, 1.2);
        ctx.restore();
      }
    }
  }
}

/** A slipway: grooves across it (for grip), and its lower end wet, going under the water. */
function slipwayLook(ctx: Ctx, a: Area): void {
  const ring = a.rings[0];
  const angle = a.angle ?? 0;
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  // How far it runs, the way down.
  let [lo, hi] = [Infinity, -Infinity];
  for (let i = 0; i < ring.length; i += 2) {
    const t = ring[i] * ux + ring[i + 1] * uy;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  ctx.save();
  ctx.beginPath();
  path(ctx, ring, true);
  ctx.clip();
  ctx.strokeStyle = 'rgba(60,58,52,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  // Across it, every half metre: lines square to the way down, long enough to cross it.
  const [nx, ny] = [-uy, ux];
  for (let t = lo + 2; t < hi; t += 4) {
    const [cx, cy] = [ux * t, uy * t];
    // A point on this line near the slipway: its middle's offset across.
    let mid = 0;
    for (let i = 0; i < ring.length; i += 2) mid += ring[i] * nx + ring[i + 1] * ny;
    mid /= ring.length / 2;
    ctx.moveTo(cx + nx * (mid - 40), cy + ny * (mid - 40));
    ctx.lineTo(cx + nx * (mid + 40), cy + ny * (mid + 40));
  }
  ctx.stroke();
  // The water over its lower part, deepening.
  const g = ctx.createLinearGradient(ux * lo, uy * lo, ux * hi, uy * hi);
  g.addColorStop(0, 'rgba(43,92,120,0)');
  g.addColorStop(0.45, 'rgba(43,92,120,0)');
  g.addColorStop(0.65, 'rgba(43,92,120,0.35)');
  g.addColorStop(1, 'rgba(43,92,120,0.8)');
  ctx.fillStyle = g;
  ctx.beginPath();
  path(ctx, ring, true);
  ctx.fill();
  ctx.restore();
  strokeRings(ctx, a.rings, 'rgba(90,86,78,0.8)', 1);
}

let paintCanvas: HTMLCanvasElement | null = null;

/** A clear layer the size of `ctx`'s canvas, drawn on as `ctx` is (the same transform), for the road markings. */
function paintLayer(ctx: Ctx): Ctx {
  const { width, height } = ctx.canvas;
  if (!paintCanvas) paintCanvas = document.createElement('canvas');
  if (paintCanvas.width !== width || paintCanvas.height !== height) {
    paintCanvas.width = width;
    paintCanvas.height = height;
  }
  const paint = paintCanvas.getContext('2d')!;
  paint.setTransform(1, 0, 0, 1, 0, 0);
  paint.clearRect(0, 0, width, height);
  paint.setTransform(ctx.getTransform());
  paint.lineJoin = 'round';
  paint.lineCap = 'round';
  paint.globalAlpha = 1;
  paint.globalCompositeOperation = 'source-over';
  return paint;
}

/** How big the weathering's tile is, map px (12 m): it repeats, pinned to the map, so it runs on from one piece of ground to the next. */
const WEAR_TILE = 96;
let wearTile: HTMLCanvasElement | null = null;

/**
 * Years of traffic and weather on the paint: a little faded all over, rubbed
 * thin in patches and along the wheel tracks, and pitted with tiny bare
 * spots. The tile's what's taken away (its alpha), the same every time.
 */
function wear(): HTMLCanvasElement {
  if (wearTile) return wearTile;
  const c = document.createElement('canvas');
  c.width = c.height = WEAR_TILE;
  const ctx = c.getContext('2d')!;
  let seed = 1234567;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Faded all over.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, 0, WEAR_TILE, WEAR_TILE);
  // Each mark drawn again wrapped round the tile's edges, so it tiles without a seam.
  const wrapped = (draw: (x: number, y: number) => void, x: number, y: number) => {
    for (const dx of [-WEAR_TILE, 0, WEAR_TILE]) for (const dy of [-WEAR_TILE, 0, WEAR_TILE]) draw(x + dx, y + dy);
  };
  // Worn patches.
  for (let i = 0; i < 14; i++) {
    const [x, y, r, a] = [rand() * WEAR_TILE, rand() * WEAR_TILE, 5 + rand() * 12, 0.15 + rand() * 0.25];
    wrapped((px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(0,0,0,${a.toFixed(2)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }, x, y);
  }
  // Scuffs and scrapes, every which way.
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const [x, y, a, len, wd] = [rand() * WEAR_TILE, rand() * WEAR_TILE, rand() * Math.PI, 6 + rand() * 18, 0.6 + rand() * 1.6];
    ctx.strokeStyle = `rgba(0,0,0,${(0.15 + rand() * 0.25).toFixed(2)})`;
    ctx.lineWidth = wd;
    wrapped((px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    }, x, y);
  }
  // Pitted: tiny bare spots.
  for (let i = 0; i < 700; i++) {
    const [x, y] = [Math.floor(rand() * WEAR_TILE), Math.floor(rand() * WEAR_TILE)];
    ctx.fillStyle = `rgba(0,0,0,${(0.35 + rand() * 0.6).toFixed(2)})`;
    ctx.fillRect(x, y, rand() < 0.3 ? 2 : 1, 1);
  }
  wearTile = c;
  return c;
}

/** Wears the markings on a layer (`paint`, drawn in map px) between (x0, y0) and w × h further. */
function weather(paint: Ctx, x0: number, y0: number, w: number, h: number): void {
  const pattern = paint.createPattern(wear(), 'repeat');
  if (!pattern) return;
  paint.save();
  paint.globalCompositeOperation = 'destination-out';
  paint.fillStyle = pattern;
  // In map px, so the wear's pinned to the map.
  paint.fillRect(x0, y0, w, h);
  paint.restore();
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
