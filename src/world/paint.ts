/**
 * The road markings beyond the lane lines and crossings: bus lanes, cycle
 * lanes and their bikes, parking bays, give way and stop lines, arrows in the
 * lanes, cycle boxes at the lights, bus stops' boxes, a mini-roundabout, and
 * tactile paving at the crossings: in white, yellow, red and green, as in
 * Britain. Words are painted long along the way, read as you come up to them.
 */

import type { GameMap, Lane, PaintMark, Pts, Road } from '../map/osm';
import { type ChunkIndex, lineLength, offsetLine, pointAlong, subPolyline } from './world';

type Ctx = CanvasRenderingContext2D;

const WHITE = 'rgba(236,233,220,0.9)';
const YELLOW = 'rgba(240,196,40,0.95)';
const BUS_RED = 'rgba(150,52,44,0.85)';
/** Cycle boxes at the lights: Bristol's are a terracotta red. */
const CYCLE_RED = 'rgba(140,72,58,0.88)';
const TACTILE_RED = '#a8453a';
const TACTILE_BUFF = '#c9b487';

/** How far apart the bikes painted along a cycle lane are, px (40 m), and how far in from a road's ends parking bays start. */
const BIKES_EVERY = 40 * 8;
const BAYS_FROM_END = 8 * 8;

/** The bus lanes' red, under everything else painted on the road. */
export function drawLaneFills(ctx: Ctx, roads: Road[]): void {
  ctx.lineCap = 'butt';
  for (const r of roads) {
    for (const lane of r.lanes ?? []) {
      if (lane.kind !== 'bus') continue;
      stroke(ctx, offsetLine(r.pts, lane.side * (r.width / 2 - lane.width / 2)), BUS_RED, lane.width);
    }
  }
  ctx.lineCap = 'round';
}

/** The lanes' lines, words and bikes, and the parking bays. */
export function drawLanes(ctx: Ctx, roads: Road[]): void {
  ctx.lineCap = 'butt';
  for (const r of roads) {
    if (!r.lanes) continue;
    const length = lineLength(r.pts);
    for (const lane of r.lanes) {
      const inner = r.width / 2 - lane.width;
      switch (lane.kind) {
        case 'bus': {
          // A thick solid line along its edge; BUS LANE at its start; a bike in it every so often, if bikes share it.
          stroke(ctx, offsetLine(r.pts, lane.side * inner), WHITE, 2.4);
          const [x, y, angle] = laneAt(r, lane, Math.min(10 * 8, length / 2), lane.width / 2);
          words(ctx, ['BUS', 'LANE'], x, y, angle, WHITE, lane.width);
          if (lane.bikes) for (const d of every(length, BIKES_EVERY, 30 * 8)) bike(ctx, ...laneAt(r, lane, d, lane.width / 2), WHITE);
          break;
        }
        case 'cycle':
          // Its line: solid where cars mustn't cross it, dashed where they may; a bike every 40 m.
          ctx.setLineDash(lane.solid ? [] : [12, 6]);
          stroke(ctx, offsetLine(r.pts, lane.side * inner), WHITE, 1.4);
          ctx.setLineDash([]);
          for (const d of every(length, BIKES_EVERY, 6 * 8)) bike(ctx, ...laneAt(r, lane, d, lane.width / 2), WHITE);
          break;
        case 'shared':
          // Just the bikes, near the kerb in the traffic's lane.
          for (const d of every(length, BIKES_EVERY, 6 * 8)) bike(ctx, ...laneAt(r, lane, d, 1.6 * 8), WHITE);
          break;
        case 'parking':
          bays(ctx, r, lane, length);
          break;
      }
    }
  }
  ctx.lineCap = 'round';
}

/** Parking bays along the kerb: their edge and the lines between them. */
function bays(ctx: Ctx, r: Road, lane: Lane, length: number): void {
  if (length < BAYS_FROM_END * 2 + 6 * 8) return;
  const start = BAYS_FROM_END;
  const end = length - BAYS_FROM_END;
  const kerb = r.width / 2;
  const depth = lane.width;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1;
  const across = (d: number, slant: number) => {
    const [x, y, tx, ty] = pointAlong(r.pts, d);
    const [nx, ny] = [ty * lane.side, -tx * lane.side];
    const t = slant * lane.side;
    ctx.beginPath();
    ctx.moveTo(x + nx * kerb, y + ny * kerb);
    ctx.lineTo(x + nx * (kerb - depth) + tx * t, y + ny * (kerb - depth) + ty * t);
    ctx.stroke();
  };
  if (lane.bays === 'parallel') {
    // The bays' outer edge, and a line every 6 m.
    stroke(ctx, offsetLine(subPolyline(r.pts, start, end), lane.side * (kerb - depth)), WHITE, 1);
    for (let d = start; d <= end; d += 6 * 8) across(d, 0);
  } else {
    // End on, or slanted: a line every 2.5 m.
    for (let d = start; d <= end; d += 2.5 * 8) across(d, lane.bays === 'diagonal' ? depth * 0.8 : 0);
  }
  if (lane.loading) for (const d of every(end - start, 60 * 8, 6 * 8)) words(ctx, ['LOADING', 'ONLY'], ...laneAt(r, lane, start + d, depth / 2), WHITE, depth);
}

/** The give way and stop lines, arrows, cycle boxes, bus stops, mini-roundabouts and tactile paving in a piece of the map. */
export function drawPaint(ctx: Ctx, map: GameMap, index: ChunkIndex): void {
  const paint = map.paint;
  if (!paint) return;
  for (const i of index.paint) {
    const m = paint[i];
    ctx.save();
    // Turned so that up (−y) is the way the traffic's heading (or out from the road).
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle + Math.PI / 2);
    switch (m.kind) {
      case 'giveway':
        giveWay(ctx, m);
        break;
      case 'stop':
        line(ctx, -m.width / 2, 0, m.width / 2, 0, WHITE, 2.6);
        ctx.restore();
        words(ctx, ['STOP'], ...behind(m, 4 * 8), WHITE, m.width);
        continue;
      case 'mini':
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.arc(0, 0, m.width / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'arrow':
        arrow(ctx, m.turns ?? 'through');
        break;
      case 'asl': {
        // The box in front of the traffic's stop line, for bikes: red, a line at each end, a big bike filling it.
        const depth = 4.5 * 8;
        ctx.fillStyle = CYCLE_RED;
        ctx.fillRect(-m.width / 2, 0, m.width, depth);
        line(ctx, -m.width / 2, 0, m.width / 2, 0, WHITE, 2);
        line(ctx, -m.width / 2, depth, m.width / 2, depth, WHITE, 2);
        ctx.restore();
        bike(ctx, ...behind(m, depth / 2), WHITE, 2.1);
        continue;
      }
      case 'busstop':
        busStop(ctx, m);
        ctx.restore();
        words(ctx, ['BUS', 'STOP'], m.x, m.y, m.angle, YELLOW, 3 * 8, 13);
        continue;
      case 'tactile':
        tactile(ctx, m);
        break;
    }
    ctx.restore();
  }
}

/** Two dashed lines across the lanes, and the triangle before them, pointing at the driver coming up. */
function giveWay(ctx: Ctx, m: PaintMark): void {
  ctx.setLineDash([5, 3]);
  line(ctx, -m.width / 2, 0, m.width / 2, 0, WHITE, 1.6);
  line(ctx, -m.width / 2, 5, m.width / 2, 5, WHITE, 1.6);
  ctx.setLineDash([]);
  const w = Math.min(m.width * 0.6, 3 * 8);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 7 * 8);
  ctx.lineTo(w / 2, 7 * 8);
  ctx.lineTo(0, 11 * 8);
  ctx.closePath();
  ctx.stroke();
}

/** A bus stop's bay along the kerb (on the traffic's left): surfaced red, edged in yellow on the road's side. */
function busStop(ctx: Ctx, m: PaintMark): void {
  const half = m.width / 2;
  const d = 3 * 8;
  ctx.fillStyle = BUS_RED;
  ctx.fillRect(-d / 2, -half, d, m.width);
  ctx.setLineDash([10, 5]);
  line(ctx, d / 2, -half, d / 2, half, YELLOW, 1.2);
  ctx.setLineDash([]);
}

/** Blister paving: a slab of rows of raised dots, red at crossings with lights, buff at the rest. */
function tactile(ctx: Ctx, m: PaintMark): void {
  const depth = 1.2 * 8;
  ctx.fillStyle = m.red ? TACTILE_RED : TACTILE_BUFF;
  ctx.fillRect(-m.width / 2, -depth / 2, m.width, depth);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = -m.width / 2 + 1; x < m.width / 2; x += 2) for (let y = -depth / 2 + 1; y < depth / 2; y += 2) ctx.fillRect(x, y, 0.8, 0.8);
}

/**
 * An arrow in a lane, pointing the way(s) it goes: straight on, left, right,
 * or a little either way, each from the one stem. In the frame where up is the
 * traffic's heading.
 */
function arrow(ctx: Ctx, turns: string): void {
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'butt';
  const fork = -2;
  line(ctx, 0, 18, 0, fork, WHITE, 1.6);
  for (const turn of turns.split(';')) {
    const dir = TURNS[turn];
    if (!dir) continue;
    const [dx, dy] = dir;
    const len = Math.hypot(dx, dy);
    const [ux, uy] = [dx / len, dy / len];
    const [ex, ey] = [ux * 11, fork + uy * 11];
    line(ctx, 0, fork, ex, ey, WHITE, 1.6);
    // Its head.
    const [px, py] = [-uy, ux];
    ctx.beginPath();
    ctx.moveTo(ex + ux * 7, ey + uy * 7);
    ctx.lineTo(ex + px * 3.2, ey + py * 3.2);
    ctx.lineTo(ex - px * 3.2, ey - py * 3.2);
    ctx.closePath();
    ctx.fill();
  }
}

/** Which way each turn's arrow points, with up the way ahead (−y) and left −x. */
const TURNS: Record<string, [number, number]> = {
  through: [0, -1],
  left: [-1, -0.9],
  sharp_left: [-1, -0.5],
  slight_left: [-0.45, -1],
  right: [1, -0.9],
  sharp_right: [1, -0.5],
  slight_right: [0.45, -1],
};

/**
 * A bike, side on, laid along the way (the way it goes is up): two wheels and
 * its frame, about 1.8 m long, as painted in cycle lanes.
 */
function bike(ctx: Ctx, x: number, y: number, angle: number, colour: string, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = colour;
  ctx.lineWidth = scale > 1 ? 1.1 : 0.8;
  ctx.beginPath();
  ctx.arc(0, 4.5, 2.6, 0, Math.PI * 2);
  ctx.moveTo(2.6, -4.5);
  ctx.arc(0, -4.5, 2.6, 0, Math.PI * 2);
  // Frame, saddle and handlebars, to one side (the bike's up).
  ctx.moveTo(0, 4.5);
  ctx.lineTo(-2.8, 1);
  ctx.lineTo(0, -1);
  ctx.lineTo(0, 4.5);
  ctx.moveTo(-2.8, 1);
  ctx.lineTo(-3.4, -3);
  ctx.lineTo(0, -4.5);
  ctx.moveTo(-3.8, 1.6);
  ctx.lineTo(-3.4, 0.2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Words painted on the road, one above the other, the first nearest the
 * driver coming up to them: each letter tall and thin, stretched along the
 * way (2.5 times), sized to fit across `across` px (and no bigger than `biggest` px before stretching).
 */
function words(ctx: Ctx, list: string[], x: number, y: number, angle: number, colour: string, across: number, biggest = 8): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  const longest = Math.max(...list.map((w) => w.length));
  // Letters about 0.6 of their height wide; as big as fits, up to 1 m high before stretching.
  const size = Math.min(biggest, (across * 0.85) / (longest * 0.62));
  const stretch = 2.5;
  ctx.scale(1, stretch);
  ctx.font = `bold ${size.toFixed(2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  const step = size * 1.25;
  list.forEach((w, i) => ctx.fillText(w, 0, ((list.length - 1) / 2 - i) * step));
  ctx.restore();
}

/** A point in a lane `d` px along its road, `from` px in from the kerb, and the way the traffic in it is heading. */
function laneAt(r: Road, lane: Lane, d: number, from: number): [number, number, number] {
  // A lane on the right runs against the way: measure from its far end.
  const along = lane.side === 1 ? d : lineLength(r.pts) - d;
  const [x, y, tx, ty] = pointAlong(r.pts, Math.max(0, along));
  const off = (r.width / 2 - from) * lane.side;
  return [x + ty * off, y - tx * off, Math.atan2(ty * lane.side, tx * lane.side)];
}

/** Behind a mark (back towards the traffic coming up to it), `d` px: where its words go. */
function behind(m: PaintMark, d: number): [number, number, number] {
  return [m.x - Math.cos(m.angle) * d, m.y - Math.sin(m.angle) * d, m.angle];
}

/** Distances along something `length` px long, `step` apart, starting `first` in. */
function every(length: number, step: number, first: number): number[] {
  const out: number[] = [];
  for (let d = first; d < length - 4 * 8; d += step) out.push(d);
  return out;
}

function stroke(ctx: Ctx, pts: Pts, colour: string, width: number): void {
  if (pts.length < 4) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

function line(ctx: Ctx, ax: number, ay: number, bx: number, by: number, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
