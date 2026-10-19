/**
 * The boats' pictures, drawn in code, seen from above facing right:
 * narrowboats, Dutch barges, motor cruisers, yachts, dinghies, an old tug and
 * the harbour ferries, each in each of its colours (made when one's first
 * needed), and their shadows on the water.
 */

import type * as Phaser from 'phaser';
import { BOAT_SIZE, type BoatKind } from '../map/berths';
import { BOAT_COLOURS } from '../world/boats';
import { canvasTexture, roundRect } from './art';

type Ctx = CanvasRenderingContext2D;

const PX = 8;

export function boatTexture(scene: Phaser.Scene, kind: BoatKind, colour: number): string {
  const key = `boat-${kind}-${colour}`;
  const [L, W] = BOAT_SIZE[kind].map((m) => m * PX);
  const [hull, trim] = BOAT_COLOURS[kind][colour % BOAT_COLOURS[kind].length];
  canvasTexture(scene, key, L, W, (ctx) => DRAW[kind](ctx, L, W, hull, trim));
  return key;
}

export function boatShadow(scene: Phaser.Scene, kind: BoatKind): string {
  const key = `boat-shadow-${kind}`;
  const [L, W] = BOAT_SIZE[kind].map((m) => m * PX);
  canvasTexture(scene, key, L, W, (ctx) => {
    hullPath(ctx, 0, 0, L, W, BOW[kind], kind === 'narrowboat' || kind === 'barge' ? 0.3 : 0.25);
    ctx.fillStyle = '#000';
    ctx.fill();
  });
  return key;
}

/** Where the bow starts to narrow, as a fraction of the length from the stern. */
const BOW: Record<BoatKind, number> = { narrowboat: 0.9, barge: 0.84, cruiser: 0.62, yacht: 0.55, dinghy: 0.68, tug: 0.78, ferry: 0.8 };

/** A hull's outline: a rounded stern, straight sides, narrowing to the bow (inset by `i`). */
function hullPath(ctx: Ctx, x: number, y: number, L: number, W: number, bow: number, stern: number, i = 0): void {
  const [x0, y0, x1, y1] = [x + i, y + i, x + L - i, y + W - i];
  const b = x + L * bow;
  const r = (W / 2) * stern;
  const mid = (y0 + y1) / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(b, y0);
  ctx.bezierCurveTo(b + (x1 - b) * 0.6, y0, x1, mid - (y1 - y0) * 0.12, x1, mid);
  ctx.bezierCurveTo(x1, mid + (y1 - y0) * 0.12, b + (x1 - b) * 0.6, y1, b, y1);
  ctx.lineTo(x0 + r, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
  ctx.lineTo(x0, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

function fillHull(ctx: Ctx, L: number, W: number, bow: number, stern: number, inset: number, fill: string): void {
  hullPath(ctx, 0, 0, L, W, bow, stern, inset);
  ctx.fillStyle = fill;
  ctx.fill();
}

function dot(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A colour lighter (k > 0) or darker (k < 0). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const GLASS = '#1e2a36';
const RUBBER = '#1a1a1a';

const DRAW: Record<BoatKind, (ctx: Ctx, L: number, W: number, hull: string, trim: string) => void> = {
  /** A narrowboat: long and thin, its cabin roof nearly all of it, with its chimney, pots and bike up top, the well deck at the bow and the tiller at the stern. */
  narrowboat(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.9, 0.3, 0, RUBBER);
    fillHull(ctx, L, W, 0.9, 0.3, 0.6, hull);
    // The cabin roof, its edge picked out in the trim.
    const [r0, r1] = [L * 0.08, L * 0.86];
    roundRect(ctx, r0, 2.2, r1 - r0, W - 4.4, 1.2, trim);
    roundRect(ctx, r0 + 0.8, 3, r1 - r0 - 1.6, W - 6, 1, shade(hull, 0.12));
    // Hatches, the chimney, plant pots, a bike, a coil of rope.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (const f of [0.2, 0.55]) ctx.fillRect(L * f, 4, 6, W - 8);
    dot(ctx, L * 0.74, W / 2, 1.6, '#202020');
    dot(ctx, L * 0.74, W / 2, 0.8, '#555');
    for (const f of [0.32, 0.36, 0.4]) dot(ctx, L * f, W / 2 + (f === 0.36 ? -1.5 : 1.2), 1.4, f === 0.36 ? '#4f7d3a' : '#3d6b30');
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(L * 0.47, W / 2, 2, 0, Math.PI * 2);
    ctx.arc(L * 0.47 + 7, W / 2, 2, 0, Math.PI * 2);
    ctx.stroke();
    // The stern deck and tiller; the well deck at the bow.
    roundRect(ctx, 1.4, 2, r0 - 1.8, W - 4, 1, '#3b2f25');
    ctx.strokeStyle = '#c9a23a';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(r0 - 1, W / 2);
    ctx.lineTo(1.5, W / 2 - 2);
    ctx.stroke();
    roundRect(ctx, r1 + 1, 2.6, L * 0.06, W - 5.2, 1, '#3b2f25');
  },

  /** A Dutch barge: a broad dark hull, a long hatch cover over its hold, the wheelhouse aft, its mast lowered along the top. */
  barge(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.84, 0.45, 0, RUBBER);
    fillHull(ctx, L, W, 0.84, 0.45, 0.7, hull);
    fillHull(ctx, L, W, 0.84, 0.45, 2.2, '#6b5a45');
    roundRect(ctx, L * 0.28, 5, L * 0.5, W - 10, 3, trim);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = L * 0.28 + 8; x < L * 0.78 - 4; x += 8) ctx.fillRect(x, 5, 0.7, W - 10);
    // The wheelhouse.
    roundRect(ctx, L * 0.08, 4.5, L * 0.16, W - 9, 2, shade(hull, 0.18));
    roundRect(ctx, L * 0.2, 5.5, L * 0.035, W - 11, 1, GLASS);
    // The lowered mast.
    ctx.fillStyle = '#c9b48a';
    ctx.fillRect(L * 0.3, W / 2 - 0.6, L * 0.55, 1.2);
    dot(ctx, L * 0.88, W / 2, 1.4, '#3a3a3a');
  },

  /** A motor cruiser: white, a pointed bow, its cabin top with tinted windows, and an open cockpit under a canopy at the back. */
  cruiser(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.62, 0.35, 0, shade(hull, -0.25));
    fillHull(ctx, L, W, 0.62, 0.35, 0.8, hull);
    // A stripe down each side in the trim.
    ctx.save();
    hullPath(ctx, 0, 0, L, W, 0.62, 0.35, 0.8);
    ctx.clip();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 1.6;
    hullPath(ctx, 0, 0, L, W, 0.62, 0.35, 0.8);
    ctx.stroke();
    ctx.restore();
    // The cabin top, and its windscreen.
    roundRect(ctx, L * 0.32, 4.5, L * 0.36, W - 9, 3, shade(hull, -0.06));
    roundRect(ctx, L * 0.62, 5.5, L * 0.05, W - 11, 1.5, GLASS);
    ctx.fillStyle = 'rgba(30,42,54,0.6)';
    ctx.fillRect(L * 0.4, 5.2, L * 0.16, 1.2);
    ctx.fillRect(L * 0.4, W - 6.4, L * 0.16, 1.2);
    // The cockpit, with its seats, half under the canopy.
    roundRect(ctx, 3, 3.5, L * 0.28, W - 7, 2, '#d9cdb4');
    roundRect(ctx, L * 0.14, 3, L * 0.18, W - 6, 2, trim);
    // The foredeck hatch, a cleat at the bow.
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(L * 0.74, W / 2 - 3, 5, 6);
    dot(ctx, L - 4, W / 2, 0.8, '#999');
  },

  /** A yacht: its deck, the cabin top, the mast with its boom and furled sail in its cover, and the cockpit with its wheel. */
  yacht(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.55, 0.45, 0, shade(hull, -0.3));
    fillHull(ctx, L, W, 0.55, 0.45, 0.8, hull === '#1b2f4a' ? '#e8e6e0' : shade(hull, -0.04));
    roundRect(ctx, L * 0.3, 5, L * 0.32, W - 10, 3, shade(hull === '#1b2f4a' ? '#e8e6e0' : hull, 0.3));
    roundRect(ctx, L * 0.04, 4.5, L * 0.24, W - 9, 2, '#b8996a');
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(L * 0.1, W / 2, 2.4, 0, Math.PI * 2);
    ctx.stroke();
    // The boom, with the sail furled on it in its cover, and the mast.
    roundRect(ctx, L * 0.2, W / 2 - 1.6, L * 0.42, 3.2, 1.5, trim);
    dot(ctx, L * 0.62, W / 2, 1.5, '#cfd3d6');
    // Shrouds and forestay.
    ctx.strokeStyle = 'rgba(80,80,80,0.6)';
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(L - 1, W / 2);
    ctx.lineTo(L * 0.62, W / 2);
    ctx.moveTo(L * 0.62, 1.2);
    ctx.lineTo(L * 0.62, W - 1.2);
    ctx.stroke();
  },

  /** A dinghy: open, its thwarts across it and an outboard on the transom. */
  dinghy(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.68, 0.5, 0, shade(hull, -0.25));
    fillHull(ctx, L, W, 0.68, 0.5, 0.6, hull);
    fillHull(ctx, L, W, 0.68, 0.5, 2, trim);
    ctx.fillStyle = shade(trim, -0.2);
    for (const f of [0.3, 0.6]) ctx.fillRect(L * f, 2, 2.2, W - 4);
    roundRect(ctx, -0.5, W / 2 - 2, 3.4, 4, 1, '#2a2a2a');
  },

  /** An old harbour tug: black hull, fenders all round, a red deck, the cream wheelhouse and its funnel. */
  tug(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.78, 0.8, 0, '#262626');
    fillHull(ctx, L, W, 0.78, 0.8, 1.6, hull);
    fillHull(ctx, L, W, 0.78, 0.8, 3.4, '#7a2a22');
    // Tyres hung over the side.
    for (let x = L * 0.12; x < L * 0.8; x += 10) {
      dot(ctx, x, 1.3, 1.5, '#111');
      dot(ctx, x, W - 1.3, 1.5, '#111');
    }
    roundRect(ctx, L * 0.3, 9, L * 0.42, W - 18, 2.5, '#e6dcc4');
    roundRect(ctx, L * 0.6, 10.5, L * 0.08, W - 21, 1.5, GLASS);
    // The funnel: its colour, a black top.
    roundRect(ctx, L * 0.4, W / 2 - 4, 8, 8, 3, trim);
    roundRect(ctx, L * 0.4 + 1.2, W / 2 - 2.8, 5.6, 5.6, 2, '#151515');
    dot(ctx, L * 0.15, W / 2, 2.2, '#a59f8f');
  },

  /** A harbour ferry: its blue hull, the cabin's long yellow roof with its windows along the sides, and open decks fore and aft with their seats. */
  ferry(ctx, L, W, hull, trim) {
    fillHull(ctx, L, W, 0.8, 0.55, 0, RUBBER);
    fillHull(ctx, L, W, 0.8, 0.55, 0.9, trim);
    fillHull(ctx, L, W, 0.8, 0.55, 2.2, '#9a8f7a');
    roundRect(ctx, L * 0.2, 3.2, L * 0.52, W - 6.4, 2.5, GLASS);
    roundRect(ctx, L * 0.21, 4.4, L * 0.5, W - 8.8, 2, hull);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(L * 0.21, W / 2 - 0.3, L * 0.5, 0.6);
    // Seats on the open decks.
    ctx.fillStyle = '#5a4a3a';
    for (const x of [L * 0.06, L * 0.12]) ctx.fillRect(x, 4.5, 2, W - 9);
    ctx.fillRect(L * 0.76, 5, 2, W - 10);
  },
};
