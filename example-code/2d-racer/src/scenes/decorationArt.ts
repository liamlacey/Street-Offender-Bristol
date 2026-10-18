import * as Phaser from 'phaser';
import { CIRCUIT_FRAMES } from '../circuit/art';
import { type FrameSpec, circle, rect, seeded } from './artKit';
import { PORT_FRAMES } from './portArt';
import { WOODS_FRAMES } from './woodsArt';
import { DOWNTOWN_FRAMES } from '../downtown/art';
import { WINTER_FRAMES } from '../winter/art';
import { DESERT_FRAMES } from '../desert/art';

/**
 * The scenery's art, drawn in code onto one canvas texture with
 * a frame per picture. Keeping it all on one texture lets Phaser draw every
 * prop in one batch, which matters on phones.
 *
 * Every picture is drawn with its front (the side that faces the track) along
 * the top edge.
 */
export const DECO_TEXTURE = 'deco';

/** How many looks each kind of picture comes in. */
export const DECO_VARIANTS = {
  truck: 5,
  container: 6,
  shed: 3,
  tree: 3,
};

const CONTAINERS = ['#a63d2b', '#1f5f99', '#2f7d4a', '#d9822b', '#7b8089', '#1d8a8a'];
const TRUCKS = ['#e63946', '#1d3557', '#f4a261', '#2a9d8f', '#f1faee'];
const FRAMES: FrameSpec[] = [];

for (let v = 0; v < DECO_VARIANTS.truck; v++) {
  FRAMES.push({
    name: `truck-${v}`,
    w: 88,
    h: 26,
    draw: (ctx, _w, h) => {
      rect(ctx, 0, 1, 64, h - 2, TRUCKS[v]);
      rect(ctx, 0, h / 2 - 2, 64, 4, TRUCKS[(v + 2) % TRUCKS.length]);
      rect(ctx, 66, 3, 20, h - 6, '#2b2d42');
      rect(ctx, 80, 5, 5, h - 10, '#9fd3ff');
    },
  });
}

for (let v = 0; v < DECO_VARIANTS.container; v++) {
  FRAMES.push({
    name: `container-${v}`,
    w: 60,
    h: 24,
    draw: (ctx, w, h) => {
      rect(ctx, 0, 0, w, h, CONTAINERS[v]);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 3; x < w - 2; x += 4) ctx.fillRect(x, 1, 1.5, h - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    },
  });
}

for (let v = 0; v < DECO_VARIANTS.shed; v++) {
  FRAMES.push({
    name: `shed-${v}`,
    w: 160,
    h: 100,
    draw: (ctx, w, h) => {
      const roof = ['#9aa3ad', '#6f8597', '#8a5a44'][v];
      rect(ctx, 0, 0, w, h, roof);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let x = 2; x < w; x += 6) ctx.fillRect(x, 0, 2, h / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let x = 2; x < w; x += 6) ctx.fillRect(x, h / 2, 2, h / 2);
      rect(ctx, 0, h / 2 - 1, w, 2, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = 'rgba(200,230,255,0.55)';
      for (let x = 20; x < w - 20; x += 40) ctx.fillRect(x, 12, 14, h / 2 - 22);
      // Loading bays along the front: a canopy over each roller door.
      for (const x of [w / 4, (3 * w) / 4]) {
        rect(ctx, x - 17, 0, 34, 8, '#5f646c');
        rect(ctx, x - 17, 7, 34, 1.5, '#ffd23f');
      }
    },
  });
}

for (let v = 0; v < DECO_VARIANTS.tree; v++) {
  FRAMES.push({
    name: `tree-${v}`,
    w: 64,
    h: 64,
    draw: (ctx) => {
      const rand = seeded(v * 104729 + 7);
      const greens = [
        ['#24521f', '#2f6a28', '#3f8434'],
        ['#2d4f1e', '#3c6a27', '#55883a'],
        ['#1f4a33', '#2a6345', '#3b7d58'],
      ][v];
      // Leafy clumps: dark underneath, lighter on top where the sun hits.
      for (let layer = 0; layer < 3; layer++) {
        const count = 7 - layer * 2;
        for (let k = 0; k < count; k++) {
          const a = rand() * Math.PI * 2;
          const r = (1 - layer * 0.35) * 14 * rand();
          circle(ctx, 32 + Math.cos(a) * r - layer * 2, 32 + Math.sin(a) * r - layer * 2, 15 - layer * 4, greens[layer]);
        }
      }
    },
  });
}

/** Draws every picture onto the texture (once per game). */
export function createDecorationTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(DECO_TEXTURE)) return;
  // Pack the frames in shelves, with a pixel of space so they don't bleed into each other.
  const width = 1024;
  const pad = 2;
  const placed: { spec: FrameSpec; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const spec of [...FRAMES, ...WOODS_FRAMES, ...PORT_FRAMES, ...CIRCUIT_FRAMES, ...DOWNTOWN_FRAMES, ...WINTER_FRAMES, ...DESERT_FRAMES].sort((a, b) => b.h - a.h)) {
    if (x + spec.w > width) {
      x = 0;
      y += shelf + pad;
      shelf = 0;
    }
    placed.push({ spec, x, y });
    x += spec.w + pad;
    shelf = Math.max(shelf, spec.h);
  }
  const height = y + shelf;
  const texture = scene.textures.createCanvas(DECO_TEXTURE, width, height)!;
  const ctx = texture.getContext();
  for (const { spec, x: fx, y: fy } of placed) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.beginPath();
    ctx.rect(0, 0, spec.w, spec.h);
    ctx.clip();
    spec.draw(ctx, spec.w, spec.h);
    ctx.restore();
    texture.add(spec.name, 0, fx, fy, spec.w, spec.h);
  }
  texture.refresh();
}
