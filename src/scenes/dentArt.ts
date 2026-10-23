/**
 * Paints a vehicle's damage (see src/car/dents.ts) over its picture, in a
 * picture of its own: scratches and chips through the paint, dents shaded
 * in, crumpled corners and sides pushed in, the windscreen cracked, smashed
 * lights, and what's come off gone.
 */

import * as Phaser from 'phaser';
import type { Mark, Wreck } from '../car/dents';
import { ART_SCALE } from './art';
import { softTexture } from '../world/canvas';

type Ctx = CanvasRenderingContext2D;

/** Where it is on its picture, and its own layout. */
export interface Body {
  /** Its undamaged picture. */
  base: string;
  length: number;
  width: number;
  mirror: number;
}

/** Paints the damage over a copy of the picture, as `key` (made, or painted again). */
export function paintWreck(scene: Phaser.Scene, key: string, body: Body, wreck: Wreck): void {
  const { length: L, width: W } = body;
  const [cw, ch] = [Math.ceil(L * ART_SCALE), Math.ceil(W * ART_SCALE)];
  let texture = scene.textures.exists(key) ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) : null;
  if (!texture) texture = softTexture(scene, key, cw, ch);
  // (The same picture for something else, a different size: you've got out of one vehicle and into another.)
  else if (texture.width !== cw || texture.height !== ch) texture.setSize(cw, ch);
  const ctx = texture.context;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(scene.textures.get(body.base).getSourceImage() as CanvasImageSource, 0, 0);
  // From its middle, in px: u forward, v across.
  ctx.setTransform(ART_SCALE, 0, 0, ART_SCALE, (L / 2) * ART_SCALE, (W / 2) * ART_SCALE);
  const [hl, hw] = [L / 2, W / 2];

  // What's come off: gone from the picture.
  const cut = (x: number, y: number, w: number, h: number) => {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  };
  for (const part of wreck.lost) {
    switch (part) {
      case 'mirrorLeft':
        cut(body.mirror - 1.6, -hw - 0.5, 3.4, 2.2);
        break;
      case 'mirrorRight':
        cut(body.mirror - 1.6, hw - 1.7, 3.4, 2.2);
        break;
      case 'bumperFront':
      case 'bumperRear': {
        // The end's bumper strip gone; the bare metal behind it.
        const front = part === 'bumperFront';
        cut(front ? hl - 1.8 : -hl, -hw, 1.8, W);
        ctx.fillStyle = '#3a3b3d';
        ctx.fillRect(front ? hl - 2.4 : -hl + 1.8, -hw + 2.2, 0.6, W - 4.4);
        break;
      }
      case 'hubcap':
        break;
      default: {
        // A light, smashed: a dark hole with a few shards left round it.
        const front = part.startsWith('lightFront');
        const right = part.endsWith('Right');
        const x = front ? hl - 2.3 : -hl + 0.3;
        const y = right ? hw - 6 : -hw + 2.6;
        ctx.fillStyle = '#26282a';
        ctx.fillRect(x, y, 2, 3.4);
        ctx.fillStyle = front ? 'rgba(255,250,220,0.8)' : 'rgba(220,60,50,0.8)';
        ctx.fillRect(x + 0.3, y + 0.2, 0.6, 0.6);
        ctx.fillRect(x + 1, y + 2.4, 0.6, 0.7);
      }
    }
  }

  for (const m of wreck.marks) {
    if (m.kind === 'crumple') crumple(ctx, m, hl, hw);
  }
  // The marks on what's left of the paint only.
  ctx.globalCompositeOperation = 'source-atop';
  for (const m of wreck.marks) {
    const rand = seeded(m.seed);
    switch (m.kind) {
      case 'scratch':
        scratch(ctx, m, rand);
        break;
      case 'chip':
        chip(ctx, m, rand);
        break;
      case 'dent':
        dent(ctx, m, hl, hw);
        break;
      case 'crack':
        crack(ctx, m, rand);
        break;
      case 'crumple':
        folds(ctx, m, hl, hw, rand);
        break;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  texture.refresh();
}

/** Bare metal and primer showing through, along a line, with a darker gouge beside it. */
function scratch(ctx: Ctx, m: Mark, rand: () => number): void {
  const [dx, dy] = [Math.cos(m.angle) * m.size * 0.5, Math.sin(m.angle) * m.size * 0.5];
  const wobble = (rand() - 0.5) * 0.8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(m.u - dx + 0.25, m.v - dy + 0.25);
  ctx.quadraticCurveTo(m.u + wobble + 0.25, m.v - wobble + 0.25, m.u + dx + 0.25, m.v + dy + 0.25);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(222,226,229,0.8)';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(m.u - dx, m.v - dy);
  ctx.quadraticCurveTo(m.u + wobble, m.v - wobble, m.u + dx, m.v + dy);
  ctx.stroke();
}

/** A fleck of paint gone: grey primer, or the dark beneath. */
function chip(ctx: Ctx, m: Mark, rand: () => number): void {
  ctx.fillStyle = rand() < 0.6 ? '#a9adb1' : '#3d3f42';
  ctx.beginPath();
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = m.size * (0.6 + rand() * 0.6);
    const [x, y] = [m.u + Math.cos(a) * r, m.v + Math.sin(a) * r];
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Where a mark's edge is pushed in from: the way into the body from the side it's on. */
function inward(m: Mark): [number, number] {
  switch (m.side) {
    case 'front':
      return [-1, 0];
    case 'rear':
      return [1, 0];
    case 'left':
      return [0, 1];
    default:
      return [0, -1];
  }
}

/** A dent: shaded in, darkest where it's deepest, a highlight on its far rim. */
function dent(ctx: Ctx, m: Mark, hl: number, hw: number): void {
  const [ix, iy] = inward(m);
  const r = m.size;
  const [cx, cy] = [Math.max(-hl, Math.min(hl, m.u + ix * r * 0.35)), Math.max(-hw, Math.min(hw, m.v + iy * r * 0.35))];
  const g = ctx.createRadialGradient(cx - ix * r * 0.15, cy - iy * r * 0.15, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, Math.atan2(iy, ix) - 0.9, Math.atan2(iy, ix) + 0.9);
  ctx.stroke();
}

/** The jagged bite out of the outline where the body's been pushed in. */
function bite(ctx: Ctx, m: Mark, hl: number, hw: number, inset: number): void {
  const rand = seeded(m.seed);
  const [ix, iy] = inward(m);
  // Along the edge.
  const [tx, ty] = [-iy, ix];
  const span = m.size * 2.4 + 3;
  const depth = m.size - inset;
  // Out beyond the edge, so the whole edge there goes.
  const [ox, oy] = [m.u - ix * 3, m.v - iy * 3];
  ctx.beginPath();
  ctx.moveTo(ox - tx * span, oy - ty * span);
  const n = 7;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * 2 - 1;
    const d = Math.max(0, depth * (1 - t * t) * (0.75 + rand() * 0.5));
    const [ex, ey] = [m.u + tx * span * t + ix * d, m.v + ty * span * t + iy * d];
    ctx.lineTo(Math.max(-hl - 3, Math.min(hl + 3, ex)), Math.max(-hw - 3, Math.min(hw + 3, ey)));
  }
  ctx.lineTo(ox + tx * span, oy + ty * span);
  ctx.closePath();
}

/** Crumpled in: the outline bitten away, its new edge dark. */
function crumple(ctx: Ctx, m: Mark, hl: number, hw: number): void {
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  bite(ctx, m, hl, hw, 0);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/** The folds in a crumpled panel, and its torn edge. */
function folds(ctx: Ctx, m: Mark, hl: number, hw: number, rand: () => number): void {
  ctx.strokeStyle = 'rgba(20,20,22,0.65)';
  ctx.lineWidth = 0.9;
  bite(ctx, m, hl, hw, -0.6);
  ctx.stroke();
  const [ix, iy] = inward(m);
  const [tx, ty] = [-iy, ix];
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.45;
  for (let k = 0; k < 4; k++) {
    const t = (rand() - 0.5) * m.size * 3;
    const d = m.size * (0.9 + rand() * 0.8);
    ctx.beginPath();
    ctx.moveTo(m.u + tx * t + ix * d, m.v + ty * t + iy * d);
    ctx.lineTo(m.u + tx * (t + (rand() - 0.5) * 3) + ix * (d + 1.5 + rand() * 2), m.v + ty * (t + (rand() - 0.5) * 3) + iy * (d + 1.5 + rand() * 2));
    ctx.stroke();
  }
}

/** A crack across the windscreen: lines out from where it was struck. */
function crack(ctx: Ctx, m: Mark, rand: () => number): void {
  ctx.strokeStyle = 'rgba(235,245,250,0.85)';
  ctx.lineWidth = 0.3;
  for (let k = 0; k < 6; k++) {
    const a = rand() * Math.PI * 2;
    let [x, y] = [m.u, m.v];
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      const step = (m.size / 3) * (0.6 + rand() * 0.6);
      x += Math.cos(a + (rand() - 0.5) * 0.8) * step;
      y += Math.sin(a + (rand() - 0.5) * 0.8) * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function seeded(seed: number): () => number {
  let s = (seed % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Done with a damaged vehicle's picture. */
export function forgetWreck(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
}
