/**
 * The game's pictures, drawn in code: the car, the trees, the street
 * furniture, and the puffs and sparks for smoke and crashes. Drawn at twice
 * the size they're shown, so they stay sharp when the camera's in close.
 */

import * as Phaser from 'phaser';
import { CAR_LENGTH, CAR_WIDTH } from '../car/CarPhysics';

/** Texture px per game px. */
export const ART_SCALE = 2;

export const TEX = {
  car: 'car',
  carShadow: 'car-shadow',
  puff: 'puff',
  spark: 'spark',
  tree: (k: number) => `tree-${k}`,
  prop: (kind: string) => `prop-${kind}`,
  light: (state: string) => `light-${state}`,
  beacon: (on: boolean) => `beacon-${on ? 'on' : 'off'}`,
  debris: (kind: string) => `debris-${kind}`,
  stump: 'stump',
  trunk: 'trunk',
} as const;

export const TREE_KINDS = 4;
/** The tree pictures' radius, px (they're scaled to each tree's size). */
export const TREE_RADIUS = 32;

type Ctx = CanvasRenderingContext2D;

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, Math.ceil(w * ART_SCALE), Math.ceil(h * ART_SCALE))!;
  const ctx = texture.context;
  ctx.scale(ART_SCALE, ART_SCALE);
  draw(ctx);
  texture.refresh();
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  // By hand: CanvasRenderingContext2D.roundRect is too new for older iPhones.
  const k = Math.min(r, w / 2, h / 2);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
  ctx.fill();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function createArt(scene: Phaser.Scene): void {
  const L = CAR_LENGTH;
  const W = CAR_WIDTH;

  // The car, facing right: a red hatchback with a black roof stripe, like the old games' sporty little runabouts.
  canvasTexture(scene, TEX.car, L, W, (ctx) => {
    // Tyres peeking out.
    ctx.fillStyle = '#151515';
    for (const [x, y] of [[6, 0], [L - 14, 0], [6, W - 2.5], [L - 14, W - 2.5]]) ctx.fillRect(x, y, 8, 2.5);
    // Body, with a lighter top edge for the light.
    roundRect(ctx, 0.5, 1.2, L - 1, W - 2.4, 5, '#a3161c');
    roundRect(ctx, 1.5, 1.8, L - 3, W - 5, 4.5, '#d42a2a');
    // Bonnet creases.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(L - 12, 4.5);
    ctx.lineTo(L - 3, 5.5);
    ctx.moveTo(L - 12, W - 4.5);
    ctx.lineTo(L - 3, W - 5.5);
    ctx.stroke();
    // Windscreen, roof, rear window.
    roundRect(ctx, L - 16, 3.2, 5.5, W - 6.4, 1.5, '#1e2a36');
    ctx.fillStyle = 'rgba(160,210,240,0.55)';
    ctx.fillRect(L - 15.5, 4, 2, W - 8);
    roundRect(ctx, 9, 3.4, 15.5, W - 6.8, 2, '#b81f22');
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(10, W / 2 - 2, 14, 4);
    roundRect(ctx, 5, 3.6, 4.5, W - 7.2, 1.2, '#1e2a36');
    // Wing mirrors.
    ctx.fillStyle = '#7d1316';
    ctx.fillRect(L - 17, 0.2, 2.5, 1.6);
    ctx.fillRect(L - 17, W - 1.8, 2.5, 1.6);
    // Headlights and tail lights.
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(L - 2.2, 3, 1.8, 3.5);
    ctx.fillRect(L - 2.2, W - 6.5, 1.8, 3.5);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(0.4, 3, 1.4, 3);
    ctx.fillRect(0.4, W - 6, 1.4, 3);
  });
  canvasTexture(scene, TEX.carShadow, L, W, (ctx) => roundRect(ctx, 0, 0, L, W, 5, '#000'));

  // Soft white blob for smoke and dust (tinted), and a spark.
  canvasTexture(scene, TEX.puff, 16, 16, (ctx) => {
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
  });
  canvasTexture(scene, TEX.spark, 3, 3, (ctx) => circle(ctx, 1.5, 1.5, 1.5, '#fff'));

  // Trees: a crown of leaves in clumps, lit from the top left.
  const greens = [
    ['#2f5e24', '#3f7a2e', '#5b9a3e', '#7ab655'],
    ['#2b5530', '#3a6e3c', '#548d4e', '#74ab64'],
    ['#3d5f22', '#507a2b', '#6c973a', '#8cb455'],
    ['#24502a', '#336a35', '#4a8648', '#69a560'],
  ];
  for (let k = 0; k < TREE_KINDS; k++) {
    const R = TREE_RADIUS;
    canvasTexture(scene, TEX.tree(k), R * 2, R * 2, (ctx) => {
      const rand = seeded(31 + k * 17);
      const [dark, mid, light, highlight] = greens[k];
      circle(ctx, R, R, R * 0.92, dark);
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2;
        const d = R * (0.3 + rand() * 0.38);
        circle(ctx, R + Math.cos(a) * d, R + Math.sin(a) * d, R * (0.3 + rand() * 0.16), mid);
      }
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 1.25 + (rand() - 0.5) * 1.8;
        const d = R * (0.15 + rand() * 0.4);
        circle(ctx, R + Math.cos(a) * d, R + Math.sin(a) * d, R * (0.18 + rand() * 0.14), light);
      }
      for (let i = 0; i < 5; i++) circle(ctx, R - R * 0.3 + rand() * R * 0.35, R - R * 0.35 + rand() * R * 0.3, R * 0.08 + rand() * R * 0.06, highlight);
    });
  }

  // Street furniture, from above.
  canvasTexture(scene, TEX.prop('lamp'), 12, 12, (ctx) => {
    circle(ctx, 6, 6, 3, '#2d3035');
    circle(ctx, 6, 6, 2, '#4a4f56');
    roundRect(ctx, 3.5, 3.5, 5, 5, 1.5, '#e9e2b8');
  });
  canvasTexture(scene, TEX.prop('bollard'), 6, 6, (ctx) => {
    circle(ctx, 3, 3, 2.6, '#1f2225');
    circle(ctx, 2.6, 2.6, 1.3, '#4b5056');
  });
  // Traffic lights, drawn for traffic heading right: the pole, and the head
  // with its three lamps (red, amber, green) in a row, the lit ones glowing.
  const lamps: Record<string, [boolean, boolean, boolean]> = {
    red: [true, false, false],
    redamber: [true, true, false],
    green: [false, false, true],
    amber: [false, true, false],
  };
  for (const [state, [r, a, g]] of Object.entries(lamps)) {
    canvasTexture(scene, TEX.light(state), 12, 16, (ctx) => {
      circle(ctx, 6, 2.5, 2.2, '#2a2d31');
      roundRect(ctx, 3, 2, 6, 13, 1.5, '#15171a');
      const lamp = (y: number, on: boolean, lit: string, dim: string) => {
        if (on) {
          const glow = ctx.createRadialGradient(6, y, 0, 6, y, 4.5);
          glow.addColorStop(0, lit);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(0, y - 4.5, 12, 9);
        }
        circle(ctx, 6, y, 1.6, on ? '#ffffff' : dim);
        if (on) circle(ctx, 6, y, 1.3, lit);
      };
      lamp(5, r, '#ff3b30', '#4a1512');
      lamp(8.5, a, '#ffb21a', '#4a3410');
      lamp(12, g, '#3ad16b', '#123d22');
    });
  }
  // A Belisha beacon: the amber globe on its striped pole, lit or not.
  for (const on of [true, false]) {
    canvasTexture(scene, TEX.beacon(on), 12, 12, (ctx) => {
      if (on) {
        const glow = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
        glow.addColorStop(0, 'rgba(255,190,40,0.9)');
        glow.addColorStop(1, 'rgba(255,170,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 12, 12);
      }
      circle(ctx, 6, 6, 2.6, on ? '#ffc23a' : '#b9772a');
      circle(ctx, 5.3, 5.3, 0.9, on ? '#fff6d0' : '#d9a560');
    });
  }
  canvasTexture(scene, TEX.prop('postbox'), 9, 9, (ctx) => {
    circle(ctx, 4.5, 4.5, 4, '#9d1010');
    circle(ctx, 4.5, 4.5, 3, '#d0201e');
    circle(ctx, 3.6, 3.6, 1, '#f05a50');
  });
  canvasTexture(scene, TEX.prop('phone'), 13, 13, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 12, 12, 1.5, '#8f0f0f');
    roundRect(ctx, 2, 2, 9, 9, 1, '#cf2320');
    ctx.fillStyle = '#9b1414';
    ctx.fillRect(6, 2, 1, 9);
    ctx.fillRect(2, 6, 9, 1);
  });
  canvasTexture(scene, TEX.prop('busstop'), 30, 12, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 29, 8, 1, 'rgba(160,200,220,0.75)');
    ctx.strokeStyle = '#33373c';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 29, 8);
    circle(ctx, 27, 10.5, 1.4, '#e03a3a');
  });
  canvasTexture(scene, TEX.prop('fountain'), 30, 30, (ctx) => {
    circle(ctx, 15, 15, 14.5, '#bdb4a2');
    circle(ctx, 15, 15, 12.5, '#4c9fc4');
    circle(ctx, 15, 15, 5, '#bdb4a2');
    circle(ctx, 15, 15, 3, '#cfe9f5');
  });
  canvasTexture(scene, TEX.prop('bench'), 16, 6, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 15, 5, 1, '#5a3a22');
    ctx.fillStyle = '#8a5a32';
    for (const y of [1, 2.6, 4.2]) ctx.fillRect(1, y, 14, 1);
  });
  canvasTexture(scene, TEX.prop('bin'), 8, 8, (ctx) => {
    circle(ctx, 4, 4, 3.8, '#1f2a22');
    circle(ctx, 4, 4, 2.8, '#33473a');
    circle(ctx, 4, 4, 1.5, '#111');
  });
  // A dead traffic light: no lamp lit.
  canvasTexture(scene, TEX.light('off'), 12, 16, (ctx) => {
    circle(ctx, 6, 2.5, 2.2, '#2a2d31');
    roundRect(ctx, 3, 2, 6, 13, 1.5, '#15171a');
    for (const y of [5, 8.5, 12]) circle(ctx, 6, y, 1.6, '#262626');
  });

  // What's left when things are smashed, drawn lying as they're shown (long ones along x).
  canvasTexture(scene, TEX.debris('plank'), 13, 3.2, (ctx) => {
    roundRect(ctx, 0, 0.2, 13, 2.8, 0.6, '#6b4527');
    ctx.fillStyle = '#8f6038';
    ctx.fillRect(0.5, 0.6, 12, 1);
  });
  // A clump torn out of a hedge, and a broken twig.
  canvasTexture(scene, TEX.debris('foliage'), 7, 7, (ctx) => {
    circle(ctx, 3.5, 3.5, 3.2, '#2c5323');
    circle(ctx, 2.6, 2.8, 1.6, '#417c31');
    circle(ctx, 4.6, 4.2, 1.3, '#417c31');
    circle(ctx, 2.4, 2.4, 0.6, '#5f9a45');
  });
  canvasTexture(scene, TEX.debris('twig'), 9, 4, (ctx) => {
    ctx.strokeStyle = '#5b4630';
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0.5, 2.2);
    ctx.lineTo(8.5, 1.8);
    ctx.moveTo(4, 2);
    ctx.lineTo(6.5, 0.5);
    ctx.moveTo(5.5, 1.9);
    ctx.lineTo(7.5, 3.4);
    ctx.stroke();
    circle(ctx, 6.6, 0.6, 0.7, '#417c31');
  });
  canvasTexture(scene, TEX.debris('rubble'), 6, 6, (ctx) => {
    ctx.fillStyle = '#8a7f70';
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.lineTo(4, 0.5);
    ctx.lineTo(5.6, 3);
    ctx.lineTo(4, 5.6);
    ctx.lineTo(0.6, 4.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b3a690';
    ctx.fillRect(1.6, 1.8, 2, 1.4);
  });
  canvasTexture(scene, TEX.debris('brick'), 5, 3, (ctx) => {
    roundRect(ctx, 0, 0, 5, 3, 0.5, '#8d4a36');
    ctx.fillStyle = '#a9604a';
    ctx.fillRect(0.6, 0.5, 3.6, 0.8);
  });
  canvasTexture(scene, TEX.debris('rail'), 18, 3, (ctx) => {
    ctx.strokeStyle = '#3a3f45';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0.5, 1);
    ctx.quadraticCurveTo(9, 2.8, 17.5, 0.8);
    ctx.stroke();
  });
  // Fallen poles: a lamp post with its lamp at the top end (to the right), and a short one.
  canvasTexture(scene, TEX.debris('pole'), 44, 6, (ctx) => {
    roundRect(ctx, 0, 2, 40, 2, 1, '#3d4248');
    roundRect(ctx, 38, 0.5, 6, 5, 1.5, '#d9d2ae');
    circle(ctx, 2, 3, 2, '#2d3035');
  });
  canvasTexture(scene, TEX.debris('shortpole'), 22, 4, (ctx) => {
    roundRect(ctx, 0, 1, 22, 2, 1, '#2f3338');
    ctx.fillStyle = '#e8e8e8';
    for (const x of [4, 10, 16]) ctx.fillRect(x, 1, 2.5, 2);
  });
  canvasTexture(scene, TEX.debris('head'), 6, 12, (ctx) => {
    roundRect(ctx, 0.5, 0, 5, 12, 1.2, '#15171a');
    for (const y of [2.5, 6, 9.5]) circle(ctx, 3, y, 1.3, '#2a2a2a');
  });
  canvasTexture(scene, TEX.debris('bollard'), 6, 6, (ctx) => {
    roundRect(ctx, 0, 1, 6, 4, 1.5, '#1f2225');
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(4.2, 1, 0.8, 4);
  });
  canvasTexture(scene, TEX.debris('postbox'), 10, 8, (ctx) => {
    roundRect(ctx, 0, 0.5, 10, 7, 3, '#9d1010');
    roundRect(ctx, 1, 1.5, 7, 5, 2.5, '#d0201e');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(6.5, 3.4, 2.4, 1);
  });
  canvasTexture(scene, TEX.debris('phonebox'), 18, 12, (ctx) => {
    roundRect(ctx, 0, 0, 18, 12, 1.2, '#8f0f0f');
    roundRect(ctx, 1.2, 1.2, 15.6, 9.6, 1, '#cf2320');
    ctx.fillStyle = 'rgba(190,225,240,0.8)';
    for (const x of [3, 7.5, 12]) ctx.fillRect(x, 3, 3, 6);
  });
  // A tree's stump, and its trunk lying on the ground (one 64 px long, stretched to each).
  canvasTexture(scene, TEX.stump, 10, 10, (ctx) => {
    circle(ctx, 5, 5, 4.5, '#5a3d24');
    circle(ctx, 5, 5, 3.2, '#c79a62');
    ctx.strokeStyle = '#8a6440';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(5, 5, 1.8, 0, Math.PI * 2);
    ctx.stroke();
  });
  canvasTexture(scene, TEX.trunk, 64, 8, (ctx) => {
    roundRect(ctx, 0, 0.5, 64, 7, 3, '#5a3d24');
    ctx.fillStyle = '#76532f';
    ctx.fillRect(2, 2, 60, 1.6);
    ctx.fillStyle = '#c79a62';
    ctx.fillRect(0, 1.5, 1.5, 5);
  });

  canvasTexture(scene, TEX.prop('bikes'), 16, 8, (ctx) => {
    ctx.strokeStyle = '#7a7f86';
    ctx.lineWidth = 1;
    for (const x of [3, 8, 13]) {
      ctx.beginPath();
      ctx.moveTo(x, 1);
      ctx.lineTo(x, 7);
      ctx.stroke();
    }
  });
}
