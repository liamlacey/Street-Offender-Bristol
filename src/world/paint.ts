/**
 * The road markings beyond the lane lines and crossings: bus lanes, cycle
 * lanes and their bikes, parking bays, give way and stop lines, arrows in the
 * lanes, cycle boxes at the lights, bus stops' boxes, a mini-roundabout, and
 * tactile paving at the crossings: in white, yellow, red and green, as in
 * Britain. Words are painted long along the way, read as you come up to them.
 */

import { BUS_STOP_DEPTH, type GameMap, type Lane, type PaintMark, type Pts, type Road } from '../map/osm';
import { CUSHION_WIDTH, HUMP_LENGTH, cushionsAcross } from './humps';
import { carParkBays, streetBays } from './parking';
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

/** The bus lanes' red, under everything else painted on the road. */
export function drawLaneFills(ctx: Ctx, roads: Road[]): void {
  ctx.lineCap = 'butt';
  for (const r of roads) {
    for (const lane of r.lanes ?? []) {
      if (lane.kind !== 'bus') continue;
      for (const piece of spans(r)) stroke(ctx, offsetLine(piece.pts, lane.side * (r.width / 2 - lane.width / 2)), BUS_RED, lane.width);
    }
  }
  ctx.lineCap = 'round';
}

/** A car park's bays: how wide, how deep, and the aisle between rows, px. */

/**
 * The bays in the car parks: along both sides of each aisle mapped through one
 * (`service=parking_aisle`), a line every 2.5 m out 5 m from the aisle's edge;
 * or, where none's mapped, in double rows with 6 m aisles between, lined up with
 * its longest side. Kept inside its outline.
 */
export function drawCarParks(ctx: Ctx, map: GameMap, index: ChunkIndex): void {
  for (const i of index.areas) {
    const a = map.areas[i];
    if (a.lines) {
      // A forecourt's lanes: dashed lines between the pump islands.
      ctx.save();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'butt';
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      for (let k = 0; k + 3 < a.lines.length; k += 4) {
        ctx.moveTo(a.lines[k], a.lines[k + 1]);
        ctx.lineTo(a.lines[k + 2], a.lines[k + 3]);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (a.kind !== 'parking') continue;
    const { lines } = carParkBays(map, a);
    ctx.save();
    ctx.beginPath();
    for (const r of a.rings) {
      ctx.moveTo(r[0], r[1]);
      for (let k = 2; k < r.length; k += 2) ctx.lineTo(r[k], r[k + 1]);
      ctx.closePath();
    }
    ctx.clip('evenodd');
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let k = 0; k + 3 < lines.length; k += 4) {
      ctx.moveTo(lines[k], lines[k + 1]);
      ctx.lineTo(lines[k + 2], lines[k + 3]);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Speed humps, raised tables and cushions: their raised surface (a table's
 * in red block paving), and white triangles up each ramp, pointing up it.
 * Drawn under the crossings and lines (a table's often under a zebra).
 */
export function drawHumps(ctx: Ctx, map: GameMap, index: ChunkIndex): void {
  const paint = map.paint;
  if (!paint) return;
  for (const i of index.paint) {
    const m = paint[i];
    if (m.kind !== 'table' && m.kind !== 'hump' && m.kind !== 'cushion') continue;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle + Math.PI / 2);
    const long = HUMP_LENGTH[m.kind];
    const raised = (x0: number, w: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.fillRect(x0, -long / 2, w, long);
      // Each ramp's foot, a little darker.
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x0, -long / 2, w, 1.2);
      ctx.fillRect(x0, long / 2 - 1.2, w, 1.2);
      // Triangles up each ramp, from its foot towards the top.
      const ramp = Math.min(1.2 * 8, long / 3);
      const count = Math.max(1, Math.round(w / (1.1 * 8)));
      const step = w / count;
      ctx.fillStyle = WHITE;
      for (const end of [-1, 1]) {
        for (let k = 0; k < count; k++) {
          const cx = x0 + step * (k + 0.5);
          const foot = (end * long) / 2;
          ctx.beginPath();
          ctx.moveTo(cx - step * 0.32, foot);
          ctx.lineTo(cx + step * 0.32, foot);
          ctx.lineTo(cx, foot - end * ramp);
          ctx.closePath();
          ctx.fill();
        }
      }
    };
    if (m.kind === 'cushion') for (const c of cushionsAcross(m)) raised(c - CUSHION_WIDTH / 2, CUSHION_WIDTH, 'rgba(255,255,255,0.08)');
    else raised(-m.width / 2, m.width, m.kind === 'table' ? 'rgba(128,72,58,0.9)' : 'rgba(255,255,255,0.07)');
    ctx.restore();
  }
}

/** The stretches of a road its lanes are painted along (clear of junctions, crossings and sharp bends): where they start and end along it, and their line. */
function spans(r: Road): { from: number; to: number; pts: Pts }[] {
  const s = r.laneSpans ?? [];
  const out: { from: number; to: number; pts: Pts }[] = [];
  for (let k = 0; k + 1 < s.length; k += 2) out.push({ from: s[k], to: s[k + 1], pts: subPolyline(r.pts, s[k], s[k + 1]) });
  return out;
}

/** Whether a distance along a road (as its way runs) is on one of its lanes' stretches, `margin` px in from their ends. */
function onSpan(r: Road, d: number, margin: number): boolean {
  const s = r.laneSpans ?? [];
  for (let k = 0; k + 1 < s.length; k += 2) if (d >= s[k] + margin && d <= s[k + 1] - margin) return true;
  return false;
}

/** The lanes' lines, words and bikes, and the parking bays (no words over a bus stop's box, among `paint`). */
export function drawLanes(ctx: Ctx, roads: Road[], paint: PaintMark[] = []): void {
  const stops = paint.filter((m) => m.kind === 'busstop');
  const clear = (x: number, y: number) => !stops.some((m) => Math.hypot(m.x - x, m.y - y) < m.width / 2 + 6 * 8);
  ctx.lineCap = 'butt';
  for (const r of roads) {
    if (!r.lanes) continue;
    const length = lineLength(r.pts);
    const pieces = spans(r);
    // Distances along, the way the lane's traffic goes, that are on its stretches: for its bikes and words.
    const along = (lane: Lane, first: number, step: number, margin: number) =>
      every(length, step, first).filter((d) => onSpan(r, lane.side === 1 ? d : length - d, margin));
    for (const lane of r.lanes) {
      const inner = r.width / 2 - lane.width;
      switch (lane.kind) {
        case 'bus': {
          // A thick solid line along its edge; BUS LANE where it starts; a bike in it every so often, if bikes share it.
          for (const p of pieces) stroke(ctx, offsetLine(p.pts, lane.side * inner), WHITE, 2.4);
          if (!lane.continues && pieces.length) {
            const first = lane.side === 1 ? pieces[0].from : length - pieces[pieces.length - 1].to;
            const [x, y, angle] = laneAt(r, lane, first + 6 * 8, lane.width / 2);
            if (onSpan(r, lane.side === 1 ? first + 6 * 8 : length - first - 6 * 8, 4 * 8) && clear(x, y)) words(ctx, ['BUS', 'LANE'], x, y, angle, WHITE, lane.width);
          }
          if (lane.bikes) for (const d of along(lane, 30 * 8, BIKES_EVERY, 3 * 8)) bike(ctx, ...laneAt(r, lane, d, lane.width / 2), WHITE);
          break;
        }
        case 'cycle':
          // Its line: solid where cars mustn't cross it, dashed where they may; a bike every 40 m.
          ctx.setLineDash(lane.solid ? [] : [12, 6]);
          for (const p of pieces) stroke(ctx, offsetLine(p.pts, lane.side * inner), WHITE, 1.4);
          ctx.setLineDash([]);
          for (const d of along(lane, 6 * 8, BIKES_EVERY, 3 * 8)) bike(ctx, ...laneAt(r, lane, d, lane.width / 2), WHITE);
          break;
        case 'shared':
          // Just the bikes, near the kerb in the traffic's lane.
          for (const d of along(lane, 6 * 8, BIKES_EVERY, 3 * 8)) bike(ctx, ...laneAt(r, lane, d, 1.6 * 8), WHITE);
          break;
        case 'parking':
          for (const p of pieces) bays(ctx, r, lane, p.from, p.to, stops);
          break;
      }
    }
  }
  ctx.lineCap = 'round';
}

/** Parking bays along the kerb between `from` and `to` px along the road: their edge and the lines between them. */
function bays(ctx: Ctx, r: Road, lane: Lane, from: number, to: number, stops: PaintMark[]): void {
  const { lines, edge, start, end } = streetBays(r, lane, from, to);
  // Not at a bus stop.
  const clear = (x: number, y: number) => !stops.some((m) => Math.hypot(m.x - x, m.y - y) < m.width / 2 + 2 * 8);
  for (let k = lines.length - 4; k >= 0; k -= 4) if (!clear(lines[k], lines[k + 1])) lines.splice(k, 4);
  if (!lines.length) return;
  const depth = lane.width;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1;
  // Parallel bays' outer edge; the lines across.
  if (edge) stroke(ctx, offsetLine(edge, lane.side * (r.width / 2 - depth)), WHITE, 1);
  ctx.beginPath();
  for (let k = 0; k + 3 < lines.length; k += 4) {
    ctx.moveTo(lines[k], lines[k + 1]);
    ctx.lineTo(lines[k + 2], lines[k + 3]);
  }
  ctx.stroke();
  const length = lineLength(r.pts);
  if (lane.loading) {
    for (const d of every(end - start, 60 * 8, 6 * 8)) {
      // laneAt measures the way the lane's traffic goes.
      const at = lane.side === 1 ? start + d : length - (start + d);
      words(ctx, ['LOADING', 'ONLY'], ...laneAt(r, lane, at, depth / 2), WHITE, depth);
    }
  }
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
      case 'triangle':
        triangle(ctx, m);
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
        arrow(ctx, m.turns ?? 'through', m.width);
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
        words(ctx, ['BUS', 'STOP'], m.x, m.y, m.angle, YELLOW, BUS_STOP_DEPTH, 13);
        continue;
      case 'tactile':
        tactile(ctx, m);
        break;
    }
    ctx.restore();
  }
}

/** Two dashed lines across the lanes. */
function giveWay(ctx: Ctx, m: PaintMark): void {
  ctx.setLineDash([5, 3]);
  line(ctx, -m.width / 2, 0, m.width / 2, 0, WHITE, 1.6);
  line(ctx, -m.width / 2, 5, m.width / 2, 5, WHITE, 1.6);
  ctx.setLineDash([]);
}

/** The triangle in a lane before give way lines: long and thin, its point at the driver coming up, as wide as fits in the lane. */
function triangle(ctx: Ctx, m: PaintMark): void {
  const w = Math.min(m.width * 0.55, 2 * 8);
  const long = w * 2.6;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(-w / 2, -long / 2);
  ctx.lineTo(w / 2, -long / 2);
  ctx.lineTo(0, long / 2);
  ctx.closePath();
  ctx.stroke();
}

/**
 * A bus stop's bay along the kerb (on the traffic's left, −x): surfaced red, edged in yellow on the
 * road's side; or, where the road won't take one, just a yellow outline, open on the kerb's side.
 */
function busStop(ctx: Ctx, m: PaintMark): void {
  const half = m.width / 2;
  const d = BUS_STOP_DEPTH;
  if (m.outline) {
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(-d / 2, -half);
    ctx.lineTo(d / 2, -half);
    ctx.lineTo(d / 2, half);
    ctx.lineTo(-d / 2, half);
    ctx.stroke();
    return;
  }
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
 * An arrow in a lane, pointing the way(s) it goes, as painted in Britain:
 * a long stem with its head at the far end for straight on, and a branch
 * curving off it, its head pointing the way, for each turn. In the frame
 * where up (−y) is the traffic's heading; about 5 m long, as wide as fits.
 */
function arrow(ctx: Ctx, turns: string, laneWidth: number): void {
  const k = Math.min(1, laneWidth / (3 * 8));
  ctx.save();
  ctx.scale(k, 1);
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.8;
  const list = turns.split(';').filter((t) => ARROW_TURNS[t] !== undefined);
  const straight = list.includes('through');
  // The stem, from the near end; on to the head if it goes straight on.
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(0, straight ? -12 : -2);
  ctx.stroke();
  if (straight) head(ctx, 0, -20, 0, -1);
  for (const t of list) {
    const bend = ARROW_TURNS[t];
    if (!bend) continue;
    // Curving off from partway up the stem, out to the side, its head pointing that way (and a little on).
    const [ex, ey] = [bend * 8, -10];
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.quadraticCurveTo(0, -6, ex * 0.7, ey);
    ctx.stroke();
    const len = Math.hypot(1, 0.25);
    head(ctx, ex * 0.7, ey, Math.sign(bend) / len, -0.25 / len);
  }
  ctx.restore();
}

/** An arrow's head, its point `(ux, uy)` on from (x, y). */
function head(ctx: Ctx, x: number, y: number, ux: number, uy: number): void {
  const [px, py] = [-uy, ux];
  ctx.beginPath();
  ctx.moveTo(x + ux * 8, y + uy * 8);
  ctx.lineTo(x + px * 3.4, y + py * 3.4);
  ctx.lineTo(x - px * 3.4, y - py * 3.4);
  ctx.closePath();
  ctx.fill();
}

/** Which way each turn's branch goes off the stem (−1 left, 1 right; 0 for straight on, which is the stem itself), and how far. */
const ARROW_TURNS: Record<string, number> = {
  through: 0,
  left: -1,
  sharp_left: -1.2,
  slight_left: -0.6,
  right: 1,
  sharp_right: 1.2,
  slight_right: 0.6,
};

/**
 * A bike, side on, as the driver coming up sees it: its wheels side by side
 * across the lane, its saddle and handlebars towards the far end, stretched
 * along the way (as the words are), about 1.8 m across, as painted in cycle lanes.
 */
function bike(ctx: Ctx, x: number, y: number, angle: number, colour: string, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(scale, scale * 1.6);
  ctx.strokeStyle = colour;
  ctx.lineWidth = scale > 1 ? 0.9 : 0.7;
  ctx.beginPath();
  // The wheels: back on the left, front on the right.
  ctx.arc(-4.5, 0, 2.6, 0, Math.PI * 2);
  ctx.moveTo(7.1, 0);
  ctx.arc(4.5, 0, 2.6, 0, Math.PI * 2);
  // Frame (up, −y, is the far end): back wheel to saddle to pedals, and up to the handlebars and down to the front wheel.
  ctx.moveTo(-4.5, 0);
  ctx.lineTo(-1.2, -3.4);
  ctx.lineTo(0, 0);
  ctx.lineTo(-4.5, 0);
  ctx.moveTo(-1.2, -3.4);
  ctx.lineTo(3.2, -3.4);
  ctx.lineTo(4.5, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(3.2, -3.4);
  // Saddle and handlebars.
  ctx.moveTo(-2.4, -3.9);
  ctx.lineTo(-0.4, -3.9);
  ctx.moveTo(3.2, -3.4);
  ctx.lineTo(2.6, -4.6);
  ctx.lineTo(3.8, -4.8);
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
