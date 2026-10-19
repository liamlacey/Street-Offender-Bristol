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

import { DECK_STEP, type Pts, type Road } from '../map/osm';
import type { Segment } from '../physics/collisions';
import { lineLength, offsetLine, pointAlong } from './world';

/** A road's pavement, how wide, px (as the ground's drawn). */
const PAVEMENT = 2.4 * 8;

/** You get on or off a deck within this far of one of its ends, px. */
export const DECK_END = 8 * 8;
/** The parapets stand this far out from the edge of the deck, px, and are this thick. */
const PARAPET_OUT = 2;
const PARAPET = 1.5;

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

  /** `ground` gives the ground's height (px) anywhere. */
  constructor(roads: Road[], ground: (x: number, y: number) => number) {
    const all: [Road, number][] = [];
    roads.forEach((road, index) => {
      if (!road.bridge || road.pts.length < 4) return;
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

  /** The deck over (x, y), if any (within its width), and where along it. */
  over(x: number, y: number): { deck: Deck; along: number } | null {
    for (const deck of this.decks) {
      if (x < deck.x0 || x > deck.x1 || y < deck.y0 || y > deck.y1) continue;
      const { along, distance } = nearestAlong(deck.road.pts, x, y);
      if (distance <= deck.half) return { deck, along };
    }
    return null;
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
    if (level === 1) return on ? 1 : 0;
    if (!on) return 0;
    const { deck, along } = on;
    if ((deck.open0 && along < DECK_END) || (deck.open1 && along > deck.length - DECK_END)) return 1;
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
    if (level === 1) return on ? 1 : 0;
    return on && Math.abs(this.height(on.deck, on.along) - ground) < 0.6 * 8 ? 1 : 0;
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

  /** The parapets along both sides of each deck (open at the ends), as walls for the cars on it. */
  parapets(): Segment[] {
    const walls: Segment[] = [];
    for (const d of this.decks) {
      const p = d.road.pts;
      const out = d.half + PARAPET_OUT;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        if (!len) continue;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        for (const side of [-1, 1]) {
          const w = { ax: ax + nx * out * side, ay: ay + ny * out * side, bx: bx + nx * out * side, by: by + ny * out * side, r: PARAPET };
          // Not where it'd stand on another deck alongside (a cycleway or a pavement mapped as a bridge of its own, beside or within a road's): there's no edge there.
          const [mx, my] = [(w.ax + w.bx) / 2, (w.ay + w.by) / 2];
          if (this.decks.some((o) => o !== d && mx >= o.x0 && mx <= o.x1 && my >= o.y0 && my <= o.y1 && nearestAlong(o.road.pts, mx, my).distance <= o.half + PARAPET_OUT)) continue;
          walls.push(w);
        }
      }
    }
    return walls;
  }
}
