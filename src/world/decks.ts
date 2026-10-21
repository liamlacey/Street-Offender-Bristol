/**
 * The bridges: decks above the ground, a level of their own. Park Street
 * crosses Frogmore Street on one; Prince Street Bridge and the footbridges
 * cross the harbour. Below a deck is the ground (a road, the water) at
 * level 0; on it, level 1. A car gets onto a deck only at its ends, where it
 * meets the ground (driving under it in the middle, it stays below), and
 * gets off at the ends too: its sides have parapets. Each deck is as high as
 * the LIDAR measured it along its length (arched, humped, level), meeting the
 * ground at its ends; or, not measured, straight from the ground's height at
 * one end to the ground's height at the other. A road bridge's pavements
 * are decks of their own alongside it (as they're not mapped as ways), as
 * high as it is, with the parapets along their outsides.
 * Pure, so it's tested.
 */

import { DECK_STEP, type GameMap, type Pts, type Road, pointInRing } from '../map/osm';
import type { Segment } from '../physics/collisions';
import { lineLength, offsetLine, pointAlong } from './world';
import { type Work, drain } from './work.ts';

/** A road's pavement, how wide, px (as the ground's drawn). */
const PAVEMENT = 2.4 * 8;

/** You get on or off a deck within this far of one of its ends, px. */
export const DECK_END = 8 * 8;
/** A bridge mapped on past what it spans (into a junction, over its abutments) is on the ground there: within this far of an open end, px, */
const END_TRIM = 16 * 8;
/** where it's less than this above the ground, px, and not over the water. */
const RAISED = 1 * 8;
/** How high a deck's shadow is cast from (a bridge's usual height above what's under it), px; and over how far it fades to nothing at an end that's on the ground. */
export const SHADOW_HEIGHT = 5 * 8;
export const SHADOW_FADE = 8 * 8;
/** The parapets stand this far out from the edge of the deck, px, and are this thick. */
const PARAPET_OUT = 2;
const PARAPET = 1.5;
/**
 * Decks alongside each other within this, px, at much the same height (within
 * LEVEL): one bridge (a road, and its pavements mapped as bridges of their
 * own a little way off): no parapet between them, the gap paved over.
 */
const JOIN = 2.5 * 8;
/** Railway tracks side by side on a bridge are on one deck (its tracks further apart than a road and its pavement), px. */
const JOIN_RAIL = 4.5 * 8;
/** How far apart two decks side by side can be and be joined. */
const joinOf = (a: Deck, b: Deck) => (a.road.kind === 'rail' && b.road.kind === 'rail' ? JOIN_RAIL : JOIN);
const LEVEL = 1.5 * 8;

/** One side of a deck: a parapet along it, or the gap to the deck beside it paved over (`gap` px wide, out along `nx`, `ny`). */
export interface DeckEdges {
  parapets: Segment[];
  joins: { ax: number; ay: number; bx: number; by: number; nx: number; ny: number; gap: number }[];
}

export interface Deck {
  road: Road;
  /** Its index in the map's roads. */
  index: number;
  length: number;
  half: number;
  /** The ground's height at each end, px. */
  z0: number;
  z1: number;
  /** Whether each end meets the ground (rather than another deck, where a bridge is mapped in pieces). */
  open0: boolean;
  open1: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The stretches along it (from, to, px) where it's up off the ground, once worked out. */
  raised?: [number, number][];
}

/** Whether a point's over the water (the harbour, the river: not a pool), for the decks: quick, by each stretch of water's box first. */
export function waterOf(map: Pick<GameMap, 'areas'>): (x: number, y: number) => boolean {
  const waters = map.areas
    .filter((a) => a.kind === 'water')
    .map((a) => {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < a.rings[0].length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, a.rings[0][i]), Math.min(y0, a.rings[0][i + 1]), Math.max(x1, a.rings[0][i]), Math.max(y1, a.rings[0][i + 1])];
      return { rings: a.rings, box: [x0, y0, x1, y1] };
    });
  return (x, y) => waters.some((w) => x >= w.box[0] && x <= w.box[2] && y >= w.box[1] && y <= w.box[3] && w.rings.filter((r) => pointInRing(x, y, r)).length % 2 === 1);
}

/** Where a point is along a polyline (its distance along) and how far from it. */
export function nearestAlong(pts: Pts, x: number, y: number): { along: number; distance: number } {
  let best = { along: 0, distance: Infinity };
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best.distance) best = { along: run + t * len, distance: d };
    run += len;
  }
  return best;
}

export class Decks {
  readonly decks: Deck[] = [];
  /** Which level its decks are: 1, the bridges'; 2, the tunnels' (underground: see `tunnels`). */
  readonly level: number;

  private readonly ground: (x: number, y: number) => number;
  private readonly wet: (x: number, y: number) => boolean;

  /**
   * `ground` gives the ground's height (px) anywhere; `wet`, whether a
   * point's over the water (see waterOf). With `tunnels`, the tunnels
   * instead of the bridges: the same, but under everything, a level of
   * their own (2), in and out only at their ends (the portals), walled along
   * all their length, from the ground at one end to the ground at the other.
   */
  constructor(roads: Road[], ground: (x: number, y: number) => number, wet: (x: number, y: number) => boolean = () => false, tunnels = false) {
    this.ground = ground;
    this.wet = wet;
    this.level = tunnels ? 2 : 1;
    const all: [Road, number][] = [];
    roads.forEach((road, index) => {
      if (!(tunnels ? road.tunnel : road.bridge && !road.tunnel) || road.pts.length < 4) return;
      if (tunnels) {
        all.push([road, index]);
        return;
      }
      all.push([road, index]);
      // Its pavements, either side (or one), as wide as on the ground, at its height.
      if (!road.pavement) return;
      for (const side of [1, -1] as const) {
        if (road.pavement === (side === 1 ? 'right' : 'left')) continue;
        const pts = offsetLine(road.pts, side * (road.width / 2 + PAVEMENT / 2));
        all.push([{ kind: 'footway', width: PAVEMENT, pts, bridge: true, deck: road.deck, pavementOf: { road: index, side } }, index]);
      }
    });
    for (const [road, index] of all) {
      const p = road.pts;
      const n = p.length;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i += 2) {
        x0 = Math.min(x0, p[i]);
        x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
      // Room for the parapets as drawn, either side.
      const pad = road.width / 2 + 8;
      this.decks.push({
        road,
        index,
        length: lineLength(p),
        half: road.width / 2,
        z0: ground(p[0], p[1]),
        z1: ground(p[n - 2], p[n - 1]),
        open0: true,
        open1: true,
        x0: x0 - pad,
        y0: y0 - pad,
        x1: x1 + pad,
        y1: y1 + pad,
      });
    }
    // Where two decks meet end to end, that's a joint in one bridge, not a way on or off.
    const touches = (x: number, y: number, self: Deck) =>
      this.decks.some((d) => {
        if (d === self) return false;
        const p = d.road.pts;
        const n = p.length;
        return Math.hypot(p[0] - x, p[1] - y) < 2 || Math.hypot(p[n - 2] - x, p[n - 1] - y) < 2;
      });
    for (const d of this.decks) {
      const p = d.road.pts;
      d.open0 = !touches(p[0], p[1], d);
      d.open1 = !touches(p[p.length - 2], p[p.length - 1], d);
    }
  }

  /** The ground's height (px) at (x, y), as the decks were made with. */
  groundAt(x: number, y: number): number {
    return this.ground(x, y);
  }

  /** The deck over (x, y), if any (within its width), and where along it. */
  over(x: number, y: number): { deck: Deck; along: number } | null {
    // (Or in the gap between two alongside each other, at much the same height: it's paved over. See JOIN.)
    let near: { deck: Deck; along: number; out: number }[] = [];
    for (const deck of this.decks) {
      if (x < deck.x0 - JOIN_RAIL || x > deck.x1 + JOIN_RAIL || y < deck.y0 - JOIN_RAIL || y > deck.y1 + JOIN_RAIL) continue;
      const { along, distance } = nearestAlong(deck.road.pts, x, y);
      if (distance <= deck.half) return { deck, along };
      if (distance <= deck.half + JOIN_RAIL) near.push({ deck, along, out: distance - deck.half });
    }
    if (near.length < 2) return null;
    near = near.sort((a, b) => a.out - b.out);
    const [a, b] = near;
    if (a.out + b.out > joinOf(a.deck, b.deck) + 2 || Math.abs(this.height(a.deck, a.along) - this.height(b.deck, b.along)) > LEVEL) return null;
    return { deck: a.deck, along: a.along };
  }

  /**
   * Whether something on a deck at (x, y) is under another deck there, well
   * above it (a path along the river under the railway's bridge): the lowest
   * deck there's taken to be the one it's on.
   */
  covered(x: number, y: number): boolean {
    const heights: number[] = [];
    for (const deck of this.decks) {
      if (x < deck.x0 || x > deck.x1 || y < deck.y0 || y > deck.y1) continue;
      const { along, distance } = nearestAlong(deck.road.pts, x, y);
      if (distance <= deck.half + 2) heights.push(this.height(deck, along));
    }
    return heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 3 * 8;
  }

  /** The deck's height `along` px along it, px. */
  height(deck: Deck, along: number): number {
    const a = Math.max(0, Math.min(deck.length, along));
    const measured = deck.road.deck;
    if (!measured || measured.length < 2) {
      const t = deck.length ? a / deck.length : 0;
      return deck.z0 + (deck.z1 - deck.z0) * t;
    }
    const k = Math.min(measured.length - 1.000001, a / DECK_STEP);
    const i = Math.floor(k);
    const z = measured[i] + (measured[i + 1] - measured[i]) * (k - i);
    // Where it meets the ground, it's at the ground's height: any difference taken up over the way on.
    const fade = (d: number) => Math.max(0, 1 - d / DECK_END);
    const start = deck.open0 ? (deck.z0 - measured[0]) * fade(a) : 0;
    const end = deck.open1 ? (deck.z1 - measured[measured.length - 1]) * fade(deck.length - a) : 0;
    return z + start + end;
  }

  /** How steep the deck is at `along`: its rise per unit east and per unit south, as Terrain.slope gives it. */
  slope(deck: Deck, along: number): [number, number] {
    const [, , tx, ty] = pointAlong(deck.road.pts, along);
    // The deck's heights and its length are both in px, so this is rise over run.
    const d = DECK_STEP;
    const a = Math.max(d, Math.min(deck.length - d, along));
    const grade = deck.length > 2 * d ? (this.height(deck, a + d) - this.height(deck, a - d)) / (2 * d) : deck.length ? (deck.z1 - deck.z0) / deck.length : 0;
    return [tx * grade, ty * grade];
  }

  /**
   * Which level a car at (x, y) is on now, having been on `level`: up onto a
   * deck only at an end that meets the ground, and down again once it's off
   * the deck altogether.
   */
  levelAt(level: number, x: number, y: number): number {
    const on = this.over(x, y);
    if (level === this.level) return on ? this.level : 0;
    if (!on) return 0;
    const { deck, along } = on;
    if ((deck.open0 && along < DECK_END) || (deck.open1 && along > deck.length - DECK_END)) return this.level;
    return 0;
  }

  /**
   * Which level someone on foot at (x, y) is on now, having been on `level`,
   * standing on ground `ground` px high: up onto a deck only where it's level
   * with the ground (at its ends; not from under it), and down off it once
   * they're off it.
   */
  stepAt(level: number, x: number, y: number, ground: number): number {
    const on = this.over(x, y);
    if (level === this.level) return on ? this.level : 0;
    return on && Math.abs(this.height(on.deck, on.along) - ground) < 0.6 * 8 ? this.level : 0;
  }

  /**
   * Whether (x, y) is at an open end of a deck (one where it meets the road):
   * on it near the end, or just off it, within `reach` px. A vehicle there is
   * at the deck's height and drawn over it, not under it (half on and half off,
   * it'd be cut in two). Any deck, or just `only`.
   */
  atEnd(x: number, y: number, reach: number, only?: Deck): boolean {
    for (const deck of only ? [only] : this.decks) {
      if (x < deck.x0 - reach || x > deck.x1 + reach || y < deck.y0 - reach || y > deck.y1 + reach) continue;
      const p = deck.road.pts;
      const n = p.length;
      for (const [open, ex, ey, ix, iy] of [
        [deck.open0, p[0], p[1], p[2], p[3]],
        [deck.open1, p[n - 2], p[n - 1], p[n - 4], p[n - 3]],
      ] as [boolean, number, number, number, number][]) {
        if (!open) continue;
        const len = Math.hypot(ix - ex, iy - ey) || 1;
        const [ux, uy] = [(ix - ex) / len, (iy - ey) / len];
        const [rx, ry] = [x - ex, y - ey];
        const along = rx * ux + ry * uy;
        const across = Math.abs(rx * uy - ry * ux);
        if (across <= deck.half + 4 && along > -reach && along < DECK_END + reach) return true;
      }
    }
    return false;
  }

  /**
   * The stretch along a deck (from, to, px) that's up off the ground: all of
   * it, but a bridge mapped running on past what it spans (on into a
   * junction, over its abutments) is on the ground there: from an open end,
   * up to END_TRIM in, where it's less than RAISED above the ground and not
   * over the water, it's left out (no parapets, no shadow). If that'd leave
   * none of it (the survey has the bridge as the ground: a flyover), it's
   * all of it, as ever.
   */
  raised(d: Deck): [number, number][] {
    if (d.raised) return d.raised;
    // (A tunnel's walled all the way through.)
    if (this.level === 2) return (d.raised = [[0, d.length]]);
    const step = DECK_STEP / 2;
    const onGround = (a: number) => {
      const [x, y] = pointAlong(d.road.pts, a);
      return !this.wet(x, y) && this.height(d, a) - this.ground(x, y) < RAISED;
    };
    // None of it up off the ground, as the survey has it (a flyover it sees as the ground): all of it, as ever.
    let any = false;
    for (let a = 0; a <= d.length && !any; a += step) any = !onGround(a);
    if (!any) return (d.raised = [[0, d.length]]);
    let from = 0;
    if (d.open0) while (from <= Math.min(END_TRIM, d.length) && onGround(from)) from += step;
    let to = d.length;
    if (d.open1) while (to >= Math.max(d.length - END_TRIM, 0) && onGround(to)) to -= step;
    // (Back to the last bit on the ground: the edge of what it spans.)
    if (from > 0) from = Math.min(from - step / 2, END_TRIM);
    if (to < d.length) to = Math.max(to + step / 2, d.length - END_TRIM);
    return (d.raised = [[Math.max(0, from), Math.min(d.length, Math.max(to, from))]]);
  }

  /** How far off to the side a deck's shadow falls `along` it, as high as it's cast from (px): fading to nothing towards an end on the ground. */
  shadowAt(d: Deck, along: number): number {
    const [[from, to]] = this.raised(d);
    if (along < from || along > to) return 0;
    let k = 1;
    if (from > 0 || d.open0) k = Math.min(k, (along - from) / SHADOW_FADE);
    if (to < d.length || d.open1) k = Math.min(k, (to - along) / SHADOW_FADE);
    return SHADOW_HEIGHT * Math.max(0, k);
  }

  /** The parapets along both sides of each deck where it's up off the ground (open at the ends), as walls for the cars on it. */
  parapets(): Segment[] {
    return drain(this.parapetsWork());
  }

  /** The same, a little at a time (see work.ts). */
  *parapetsWork(): Work<Segment[]> {
    const walls: Segment[] = [];
    for (const d of this.decks) {
      yield;
      walls.push(...this.edges(d).parapets);
    }
    return walls;
  }

  private readonly edgesOf = new Map<Deck, DeckEdges>();

  /**
   * A deck's sides: its parapets, where it's up off the ground (open at the
   * ends); and, where another deck's alongside it (within JOIN, at much the
   * same height: a pavement mapped as a bridge of its own beside a road's), no
   * parapet: the gap between them paved over (and where it's on another deck,
   * a cycleway or a pavement within a road's, nothing: there's no edge there).
   */
  edges(d: Deck): DeckEdges {
    const had = this.edgesOf.get(d);
    if (had) return had;
    const edges: DeckEdges = { parapets: [], joins: [] };
    const p = d.road.pts;
    const out = d.half + PARAPET_OUT;
    const raised = this.raised(d);
    const others = this.decks.filter((o) => o !== d && o.x1 > d.x0 - JOIN_RAIL && o.x0 < d.x1 + JOIN_RAIL && o.y1 > d.y0 - JOIN_RAIL && o.y0 < d.y1 + JOIN_RAIL);
    let run = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [sx, sy, ex, ey] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const len = Math.hypot(ex - sx, ey - sy);
      const start = run;
      run += len;
      if (!len) continue;
      const [ux, uy] = [(ex - sx) / len, (ey - sy) / len];
      const [nx, ny] = [-uy, ux];
      // Each piece of this side that's up off the ground.
      for (const [r0, r1] of raised) {
        const [t0, t1] = [Math.max(0, (r0 - start) / len), Math.min(1, (r1 - start) / len)];
        if (t1 <= t0) continue;
        for (const side of [-1, 1]) {
          const [ox, oy] = [nx * side, ny * side];
          /** What's beside it at a point along it (t along the segment): nothing (a parapet), another deck it's on (nothing), or one a gap off (paved over, the gap's width). */
          const beside = (t: number): number | 'wall' | 'on' => {
            const [x, y] = [sx + (ex - sx) * t + ox * out, sy + (ey - sy) * t + oy * out];
            const z = this.height(d, start + len * t);
            let gap: number | 'wall' | 'on' = 'wall';
            for (const o of others) {
              const join = joinOf(d, o);
              if (x < o.x0 - join || x > o.x1 + join || y < o.y0 - join || y > o.y1 + join) continue;
              const { along, distance } = nearestAlong(o.road.pts, x, y);
              if (distance > o.half + join || Math.abs(this.height(o, along) - z) > LEVEL) continue;
              if (distance <= o.half + PARAPET_OUT) return 'on';
              // (The gap's across to it: out from here, the way this side faces.)
              const [qx, qy] = [x + ox * join, y + oy * join];
              const far = nearestAlong(o.road.pts, qx, qy).distance;
              if (far < distance) gap = Math.min(typeof gap === 'number' ? gap : Infinity, distance - o.half);
            }
            return gap;
          };
          // Along it every 4 px: runs of the same.
          const n = Math.max(1, Math.ceil(((t1 - t0) * len) / 4));
          let from = 0;
          let what = beside(t0);
          const gaps: number[] = typeof what === 'number' ? [what] : [];
          const flush = (to: number) => {
            const [a, b] = [t0 + ((t1 - t0) * from) / n, t0 + ((t1 - t0) * to) / n];
            const seg = { ax: sx + (ex - sx) * a + ox * out, ay: sy + (ey - sy) * a + oy * out, bx: sx + (ex - sx) * b + ox * out, by: sy + (ey - sy) * b + oy * out };
            if ((b - a) * len < 0.5) return;
            if (what === 'wall') edges.parapets.push({ ...seg, r: PARAPET });
            else if (what !== 'on') edges.joins.push({ ...seg, nx: ox, ny: oy, gap: Math.max(...gaps) + PARAPET_OUT });
          };
          for (let k = 1; k <= n; k++) {
            const now = beside(t0 + ((t1 - t0) * k) / n);
            const same = now === what || (typeof now === 'number' && typeof what === 'number');
            if (same) {
              if (typeof now === 'number') gaps.push(now);
              continue;
            }
            flush(k);
            [from, what] = [k, now];
            gaps.length = 0;
            if (typeof now === 'number') gaps.push(now);
          }
          flush(n);
        }
      }
    }
    this.edgesOf.set(d, edges);
    return edges;
  }
}
