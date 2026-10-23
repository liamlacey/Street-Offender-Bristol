/**
 * The traffic's pictures, drawn in code, seen from above facing right: little
 * cars, hatchbacks, saloons, estates, SUVs, vans and lorries, each in each of
 * its colours (made when one's first needed), and their shadows.
 */

import type * as Phaser from 'phaser';
import { COLOURS, VEHICLES, type VehicleKind } from '../world/traffic';
import { TEX, canvasTexture, roundRect } from './art';
import { clothes } from './PeopleLayer';

type Ctx = CanvasRenderingContext2D;

export function vehicleTexture(scene: Phaser.Scene, kind: VehicleKind, colour: number, rider = 0, sale = false): string {
  if (kind === 'bike') return bikeTexture(scene, colour, rider);
  // Your own car, left somewhere.
  if (kind === 'own') return TEX.car;
  // The emergency services' in their liveries (one each).
  if (kind === 'police' || kind === 'ambulance' || kind === 'fire' || kind === 'taxi') colour = 0;
  const key = `vehicle-${kind}-${colour}${sale ? '-sale' : ''}`;
  const { length: L, width: W, paint } = VEHICLES[kind];
  const body = LIVERY[kind] ?? COLOURS[paint][colour][0];
  canvasTexture(scene, key, L, W, (ctx) => {
    draw(ctx, kind, L, W, body);
    // For sale, on a dealer's forecourt: its price on a card behind its windscreen.
    if (sale && kind in LAYOUT) {
      const at = L * LAYOUT[kind as keyof typeof LAYOUT][2];
      roundRect(ctx, at - 2.2, W / 2 - 2.6, 1.8, 5.2, 0.3, '#fbfbf6');
      ctx.fillStyle = '#d62828';
      ctx.fillRect(at - 1.9, W / 2 - 2, 1.2, 4);
    }
  });
  return key;
}

/** A bus in its route's colour, its route's number on its roof. */
export function busTexture(scene: Phaser.Scene, kind: VehicleKind, colour: string, ref: string): string {
  const key = `bus-${kind}-${colour}-${ref}`;
  const { length: L, width: W } = VEHICLES[kind];
  canvasTexture(scene, key, L, W, (ctx) => bus(ctx, L, W, colour, ref, kind === 'double'));
  return key;
}

export function vehicleShadow(scene: Phaser.Scene, kind: VehicleKind): string {
  if (kind === 'own') return TEX.carShadow;
  const key = `vehicle-shadow-${kind}`;
  const { length: L, width: W } = VEHICLES[kind];
  canvasTexture(scene, key, L, W, (ctx) => (kind === 'bike' ? roundRect(ctx, 0, W * 0.25, L, W * 0.5, W * 0.25, '#000') : roundRect(ctx, 0, 0, L, W, kind === 'lorry' || kind === 'van' || kind === 'ambulance' || kind === 'fire' ? 2.5 : 5, '#000')));
  return key;
}

/**
 * A cyclist from above, riding right: the bike's wheels (thin, end on) and
 * frame in its colour, the handlebars across; the rider's legs either side of
 * the frame, their back and shoulders leaning over it, arms out to the bars,
 * and a helmet (or not).
 */
function bikeTexture(scene: Phaser.Scene, colour: number, rider: number): string {
  const key = `vehicle-bike-${colour}-${rider}`;
  const { length: L, width: W } = VEHICLES.bike;
  const frame = COLOURS.bike[colour][0];
  const { top, bottom, hair, skin } = clothes(rider);
  const helmet = rider % 3 !== 0 ? ['#e8e9eb', '#1d1e22', '#b21f24', '#22508f', '#e2c23b'][rider % 5] : null;
  canvasTexture(scene, key, L, W, (ctx) => {
    const mid = W / 2;
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    // Tyres, end on, and the frame between them.
    ctx.fillStyle = '#141414';
    ctx.fillRect(0.2, mid - 0.45, 4.6, 0.9);
    ctx.fillRect(L - 4.8, mid - 0.45, 4.6, 0.9);
    ctx.fillStyle = frame;
    ctx.fillRect(3, mid - 0.4, L - 6.4, 0.8);
    // The handlebars.
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(L - 4.4, mid - 2.3, 0.8, 4.6);
    // Legs down either side; back and shoulders, leaning forward; arms to the bars; head.
    ellipse(L * 0.48, mid - 1.1, 1.6, 0.6, bottom);
    ellipse(L * 0.48, mid + 1.1, 1.6, 0.6, bottom);
    ellipse(L * 0.45, mid, 2.6, 1.5, top);
    ellipse(L * 0.58, mid - 1.6, 2, 0.5, top);
    ellipse(L * 0.58, mid + 1.6, 2, 0.5, top);
    ellipse(L * 0.62, mid, 1.3, 2.1, top);
    ellipse(L - 4.1, mid - 1.9, 0.5, 0.45, skin);
    ellipse(L - 4.1, mid + 1.9, 0.5, 0.45, skin);
    ellipse(L * 0.7, mid, 1.2, 1.05, helmet ?? hair);
    if (helmet) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(L * 0.7 - 1, mid - 0.15, 2.2, 0.3);
    }
  });
  return key;
}

/** Where a kind's wing mirrors and windscreen are along it, from its middle, px (for its damage). */
export function bodyLayout(kind: VehicleKind): { mirror: number; screen: number } {
  const L = VEHICLES[kind].length;
  if (kind === 'lorry') return { mirror: L / 2 - 4.9, screen: L / 2 - 3.3 };
  if (kind === 'fire') return { mirror: L / 2 - 4.2, screen: L / 2 - 3 };
  if (kind === 'bus' || kind === 'double') return { mirror: L / 2 - 2, screen: L / 2 - 1.5 };
  if (kind === 'bike') return { mirror: 0, screen: 0 };
  if (kind === 'own') return { mirror: L / 2 - 9.5, screen: L / 2 - 7.5 };
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
  const axles = kind === 'lorry' ? [L * 0.08, L * 0.22, L * 0.82] : kind === 'fire' ? [L * 0.14, L * 0.78] : [L * 0.14, L * 0.72];
  for (const x of axles) {
    ctx.fillRect(x, 0, wheel, 2.2);
    ctx.fillRect(x, W - 2.2, wheel, 2.2);
  }
  if (kind === 'lorry') return lorry(ctx, L, W, colour);
  if (kind === 'fire') return fireEngine(ctx, L, W);
  if (kind === 'bus' || kind === 'double') return bus(ctx, L, W, colour, '', kind === 'double');
  const boxy = kind === 'van' || kind === 'suv' || kind === 'ambulance';
  if (kind === 'bike' || kind === 'own') return;
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
  roundRect(ctx, roof, 3.2, screen - roof, W - 6.4, 2, kind === 'van' || kind === 'ambulance' ? shade(colour, 0.08) : shade(colour, 0.12));
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
  if (kind === 'police') police(ctx, L, W, screen);
  if (kind === 'ambulance') ambulance(ctx, L, W, screen);
  if (kind === 'taxi') taxi(ctx, L, W);
}

/** A taxi's sign on its roof, lit yellow, across it in the middle. */
function taxi(ctx: Ctx, L: number, W: number): void {
  roundRect(ctx, L * 0.44, W / 2 - 3, 2.6, 6, 0.5, '#f5d22e');
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(L * 0.44 + 0.9, W / 2 - 2, 0.8, 4);
}

/** The emergency services' bodies' colours: a police car's white, an ambulance's yellow. */
const LIVERY: Partial<Record<VehicleKind, string>> = { police: '#f2f3f1', ambulance: '#f0e010', fire: '#c3161c', taxi: '#2d63a8' };

/** A strip of chequers (Battenburg markings) along both its sides, from `x0` to `x1`, alternating two colours. */
function chequers(ctx: Ctx, x0: number, x1: number, W: number, a: string, b: string, size: number, inset: number): void {
  for (let x = x0, k = 0; x < x1; x += size, k++) {
    const w = Math.min(size, x1 - x);
    ctx.fillStyle = k % 2 ? a : b;
    ctx.fillRect(x, inset, w, 1.4);
    ctx.fillStyle = k % 2 ? b : a;
    ctx.fillRect(x, W - inset - 1.4, w, 1.4);
  }
}

/** A light bar across the roof, at `x` along it: dark, with its blue lamps at the ends (lit, they flash: see TrafficLayer). */
function lightBar(ctx: Ctx, x: number, W: number, depth: number): void {
  roundRect(ctx, x, 3.4, depth, W - 6.8, 0.8, '#2a2d33');
  ctx.fillStyle = '#3d63c9';
  ctx.fillRect(x + 0.3, 3.8, depth - 0.6, 2.4);
  ctx.fillRect(x + 0.3, W - 6.2, depth - 0.6, 2.4);
}

/** A police car: white, blue and yellow chequers down its sides, a light bar on the roof, its number on the roof. */
function police(ctx: Ctx, L: number, W: number, screen: number): void {
  chequers(ctx, L * 0.05, L * 0.93, W, '#1b3f94', '#dfe31c', 2.6, 1.1);
  lightBar(ctx, screen - 4.2, W, 2.6);
  ctx.save();
  ctx.translate(L * 0.36, W / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#1d1e22';
  ctx.font = 'bold 4px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A27', 0, 0);
  ctx.restore();
}

/** An ambulance: yellow, green and yellow chequers down its sides, a light bar over the cab, lamps at the back corners, red and yellow chevrons across the back. */
function ambulance(ctx: Ctx, L: number, W: number, screen: number): void {
  chequers(ctx, L * 0.03, L * 0.95, W, '#1d8a3c', '#f0e010', 3, 1.1);
  lightBar(ctx, screen - 3.2, W, 2.4);
  ctx.fillStyle = '#3d63c9';
  ctx.fillRect(1.4, 2.4, 2, 2);
  ctx.fillRect(1.4, W - 4.4, 2, 2);
  for (let y = 4.6, k = 0; y < W - 4.6; y += 1.6, k++) {
    ctx.fillStyle = k % 2 ? '#d22222' : '#f0e010';
    ctx.fillRect(0.6, y, 1, 1.6);
  }
  // The star of life on the roof, in green.
  ctx.save();
  ctx.translate(L * 0.4, W / 2);
  ctx.fillStyle = '#1d8a3c';
  for (let k = 0; k < 3; k++) {
    ctx.rotate(Math.PI / 3);
    ctx.fillRect(-4, -1.1, 8, 2.2);
  }
  ctx.restore();
}

/**
 * A fire engine: red, its cab at the front (windscreen, a light bar on its
 * roof), the body behind with its lockers' roof, and the ladder along the
 * top, silver, its rungs across.
 */
function fireEngine(ctx: Ctx, L: number, W: number): void {
  const red = LIVERY.fire!;
  roundRect(ctx, 0.3, 0.6, L - 0.6, W - 1.2, 2.2, shade(red, -0.35));
  roundRect(ctx, 0.9, 1.1, L - 1.8, W - 2.2, 2, red);
  // A white line down each side.
  ctx.fillStyle = '#eef0f0';
  ctx.fillRect(1.5, 1.4, L * 0.72, 0.7);
  ctx.fillRect(1.5, W - 2.1, L * 0.72, 0.7);
  // The cab: its roof a shade lighter, the windscreen, mirrors; the light bar.
  const cab = L * 0.74;
  roundRect(ctx, cab, 2.2, L - cab - 2.6, W - 4.4, 2, shade(red, 0.12));
  roundRect(ctx, L - 3.6, 2.4, 2.8, W - 4.8, 1, GLASS);
  ctx.fillStyle = SHINE;
  ctx.fillRect(L - 3.2, 3.4, 0.9, W - 6.8);
  ctx.fillStyle = '#1f2124';
  ctx.fillRect(L - 5, -0.3, 2, 1.6);
  ctx.fillRect(L - 5, W - 1.3, 2, 1.6);
  lightBar(ctx, cab + 1, W, 2.6);
  // The lockers' roof, and the ladder on it.
  roundRect(ctx, 2, 2.6, cab - 3.5, W - 5.2, 1.2, shade(red, -0.12));
  ctx.fillStyle = '#c9ced3';
  const [y0, y1] = [W * 0.3, W * 0.7];
  ctx.fillRect(L * 0.04, y0 - 0.6, L * 0.78, 1.2);
  ctx.fillRect(L * 0.04, y1 - 0.6, L * 0.78, 1.2);
  ctx.fillStyle = '#aab0b6';
  for (let x = L * 0.06; x < L * 0.8; x += 3) ctx.fillRect(x, y0, 0.8, y1 - y0);
  // A hose reel at the back, and the lamps.
  ctx.fillStyle = '#5a5e63';
  ctx.beginPath();
  ctx.arc(3.6, W / 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  lights(ctx, L, W);
}

/** Along each kind, from the back, as fractions of its length: where the rear window starts, the roof, the windscreen, and the bonnet. */
const LAYOUT: Record<Exclude<VehicleKind, 'lorry' | 'bus' | 'double' | 'bike' | 'own' | 'fire'>, [number, number, number, number]> = {
  small: [0.1, 0.22, 0.58, 0.72],
  hatch: [0.09, 0.2, 0.56, 0.7],
  saloon: [0.2, 0.31, 0.58, 0.71],
  estate: [0.05, 0.13, 0.6, 0.72],
  suv: [0.05, 0.13, 0.62, 0.74],
  van: [0.02, 0.03, 0.74, 0.85],
  police: [0.05, 0.13, 0.6, 0.72],
  taxi: [0.2, 0.31, 0.58, 0.71],
  ambulance: [0.02, 0.03, 0.78, 0.87],
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

/**
 * A bus from above: mostly its roof (pale, with its hatches, and a
 * single-decker's air conditioning pods), its sides in the route's colour,
 * its windscreen at the front, and its route number painted big on the roof,
 * reading from the back.
 */
function bus(ctx: Ctx, L: number, W: number, colour: string, ref: string, double: boolean): void {
  // Wheels peeking out: two axles (three on a long single-decker).
  ctx.fillStyle = '#151515';
  for (const x of double ? [L * 0.16, L * 0.72] : [L * 0.15, L * 0.68]) {
    ctx.fillRect(x, 0, 9, 2);
    ctx.fillRect(x, W - 2, 9, 2);
  }
  roundRect(ctx, 0.3, 0.8, L - 0.6, W - 1.6, 3, '#1f2124');
  // Its sides, in the route's colour.
  roundRect(ctx, 0.8, 1.2, L - 1.6, W - 2.4, 2.6, colour);
  // The roof.
  roundRect(ctx, 2.2, 3.2, L - 5.5, W - 6.4, 2, double ? '#e3e5e7' : '#d6d9dc');
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(2.2, W / 2 - 0.3, L - 5.5, 0.6);
  // Hatches; a single-decker's air conditioning pods.
  ctx.fillStyle = '#b9bdc1';
  for (const f of double ? [0.25, 0.6] : [0.45]) ctx.fillRect(L * f, W / 2 - 3, 5, 6);
  if (!double) {
    roundRect(ctx, L * 0.12, 4.2, L * 0.22, W - 8.4, 1.5, '#c4c8cb');
    roundRect(ctx, L * 0.62, 4.2, L * 0.16, W - 8.4, 1.5, '#c4c8cb');
  }
  // The windscreen, wrapping round the front; the back window.
  roundRect(ctx, L - 3.2, 1.6, 2.4, W - 3.2, 1.2, '#1e2a36');
  ctx.fillStyle = 'rgba(160,210,240,0.45)';
  ctx.fillRect(L - 2.8, 2.5, 0.8, W - 5);
  ctx.fillStyle = '#1e2a36';
  ctx.fillRect(0.9, 3.5, 1.1, W - 7);
  // Its number on the roof, in its colour.
  if (ref) {
    ctx.save();
    ctx.translate(L * (double ? 0.78 : 0.86), W / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = colour;
    ctx.font = `bold ${Math.min(W - 9, 28 / Math.max(2, ref.length))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ref, 0, 0);
    ctx.restore();
  }
  // Mirrors out front, and the lights.
  ctx.fillStyle = '#1f2124';
  ctx.fillRect(L - 2.6, -0.4, 1.6, 1.6);
  ctx.fillRect(L - 2.6, W - 1.2, 1.6, 1.6);
  ctx.fillStyle = '#fff6c8';
  ctx.fillRect(L - 1, 2.6, 0.8, 2.6);
  ctx.fillRect(L - 1, W - 5.2, 0.8, 2.6);
  ctx.fillStyle = '#8e1f1a';
  ctx.fillRect(0.2, 2.6, 0.8, 2.6);
  ctx.fillRect(0.2, W - 5.2, 0.8, 2.6);
}
