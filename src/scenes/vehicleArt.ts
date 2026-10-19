/**
 * The traffic's pictures, drawn in code, seen from above facing right: little
 * cars, hatchbacks, saloons, estates, SUVs, vans and lorries, each in each of
 * its colours (made when one's first needed), and their shadows.
 */

import type * as Phaser from 'phaser';
import { COLOURS, VEHICLES, type VehicleKind } from '../world/traffic';
import { canvasTexture, roundRect } from './art';

type Ctx = CanvasRenderingContext2D;

export function vehicleTexture(scene: Phaser.Scene, kind: VehicleKind, colour: number): string {
  const key = `vehicle-${kind}-${colour}`;
  const { length: L, width: W, paint } = VEHICLES[kind];
  const body = COLOURS[paint][colour][0];
  canvasTexture(scene, key, L, W, (ctx) => draw(ctx, kind, L, W, body));
  return key;
}

export function vehicleShadow(scene: Phaser.Scene, kind: VehicleKind): string {
  const key = `vehicle-shadow-${kind}`;
  const { length: L, width: W } = VEHICLES[kind];
  canvasTexture(scene, key, L, W, (ctx) => roundRect(ctx, 0, 0, L, W, kind === 'lorry' || kind === 'van' ? 2.5 : 5, '#000'));
  return key;
}

/** Where a kind's wing mirrors and windscreen are along it, from its middle, px (for its damage). */
export function bodyLayout(kind: VehicleKind): { mirror: number; screen: number } {
  const L = VEHICLES[kind].length;
  if (kind === 'lorry') return { mirror: L / 2 - 4.9, screen: L / 2 - 3.3 };
  const [, , screen, bonnet] = LAYOUT[kind].map((f) => f * L);
  return { mirror: screen + 0.1 - L / 2, screen: (screen + bonnet) / 2 - L / 2 };
}

/** A colour lighter (k > 0) or darker (k < 0). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const GLASS = '#1e2a36';
const SHINE = 'rgba(160,210,240,0.45)';

function draw(ctx: Ctx, kind: VehicleKind, L: number, W: number, colour: string): void {
  // Tyres peeking out.
  ctx.fillStyle = '#151515';
  const wheel = Math.min(8, L * 0.18);
  const axles = kind === 'lorry' ? [L * 0.08, L * 0.22, L * 0.82] : [L * 0.14, L * 0.72];
  for (const x of axles) {
    ctx.fillRect(x, 0, wheel, 2.2);
    ctx.fillRect(x, W - 2.2, wheel, 2.2);
  }
  if (kind === 'lorry') return lorry(ctx, L, W, colour);
  const boxy = kind === 'van' || kind === 'suv';
  const corner = boxy ? 3 : kind === 'small' ? 5.5 : 5;
  // The body, with a lighter top edge for the light.
  roundRect(ctx, 0.5, 1, L - 1, W - 2, corner, shade(colour, -0.3));
  roundRect(ctx, 1.3, 1.6, L - 2.6, W - 4.2, corner - 0.5, colour);
  // Where the glass and the roof go, along it (from the back): rear window, roof, windscreen.
  const [rear, roof, screen, bonnet] = LAYOUT[kind].map((f) => f * L);
  roundRect(ctx, rear, 3, roof - rear, W - 6, 1.2, GLASS);
  roundRect(ctx, screen, 3, bonnet - screen, W - 6, 1.5, GLASS);
  ctx.fillStyle = SHINE;
  ctx.fillRect(screen + 0.6, 4, 1.6, W - 8);
  // The roof.
  roundRect(ctx, roof, 3.2, screen - roof, W - 6.4, 2, kind === 'van' ? shade(colour, 0.08) : shade(colour, 0.12));
  if (kind === 'van') {
    // Its roof's ribs, and the line of the back doors.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = roof + 4; x < screen - 2; x += 5) {
      ctx.moveTo(x, 4);
      ctx.lineTo(x, W - 4);
    }
    ctx.moveTo(1.5, W / 2);
    ctx.lineTo(roof, W / 2);
    ctx.stroke();
  }
  if (kind === 'suv' || kind === 'estate') {
    // Roof rails.
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    ctx.fillRect(roof + 1, 3.6, screen - roof - 2, 0.9);
    ctx.fillRect(roof + 1, W - 4.5, screen - roof - 2, 0.9);
  }
  // Bonnet creases.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(bonnet + 1, 4.5);
  ctx.lineTo(L - 3, 5.2);
  ctx.moveTo(bonnet + 1, W - 4.5);
  ctx.lineTo(L - 3, W - 5.2);
  ctx.stroke();
  // Wing mirrors.
  ctx.fillStyle = shade(colour, -0.35);
  ctx.fillRect(screen - 1, 0.2, 2.2, 1.4);
  ctx.fillRect(screen - 1, W - 1.6, 2.2, 1.4);
  lights(ctx, L, W);
}

/** Along each kind, from the back, as fractions of its length: where the rear window starts, the roof, the windscreen, and the bonnet. */
const LAYOUT: Record<Exclude<VehicleKind, 'lorry'>, [number, number, number, number]> = {
  small: [0.1, 0.22, 0.58, 0.72],
  hatch: [0.09, 0.2, 0.56, 0.7],
  saloon: [0.2, 0.31, 0.58, 0.71],
  estate: [0.05, 0.13, 0.6, 0.72],
  suv: [0.05, 0.13, 0.62, 0.74],
  van: [0.02, 0.03, 0.74, 0.85],
};

function lights(ctx: Ctx, L: number, W: number): void {
  ctx.fillStyle = '#fff6c8';
  ctx.fillRect(L - 2, 2.8, 1.6, 3);
  ctx.fillRect(L - 2, W - 5.8, 1.6, 3);
  ctx.fillStyle = '#8e1f1a';
  ctx.fillRect(0.4, 2.8, 1.3, 2.8);
  ctx.fillRect(0.4, W - 5.6, 1.3, 2.8);
}

/** A lorry: a box body (white, mostly), a gap, and its cab in its colour. */
function lorry(ctx: Ctx, L: number, W: number, colour: string): void {
  const box = L * 0.74;
  roundRect(ctx, 0.3, 0.6, box, W - 1.2, 1.2, '#b9bbbd');
  roundRect(ctx, 0.9, 1.1, box - 1.2, W - 2.6, 1, '#e4e5e6');
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let x = 6; x < box - 3; x += 7) {
    ctx.moveTo(x, 1.6);
    ctx.lineTo(x, W - 2);
  }
  ctx.stroke();
  const cab = box + 1.5;
  roundRect(ctx, cab, 1.2, L - cab - 0.5, W - 2.4, 2.5, shade(colour, -0.3));
  roundRect(ctx, cab + 0.6, 1.8, L - cab - 2, W - 4, 2, colour);
  roundRect(ctx, cab + 1.5, 3, (L - cab) * 0.45, W - 6, 1.5, shade(colour, 0.15));
  roundRect(ctx, L - 4.6, 2.6, 2.6, W - 5.2, 1, GLASS);
  ctx.fillStyle = shade(colour, -0.4);
  ctx.fillRect(L - 6, -0.2, 2.2, 1.6);
  ctx.fillRect(L - 6, W - 1.4, 2.2, 1.6);
  lights(ctx, L, W);
}
