/**
 * The game's pictures, drawn in code: your armoured truck, the trees, the street
 * furniture, and the puffs and sparks for smoke and crashes. Drawn at twice
 * the size they're shown, so they stay sharp when the camera's in close.
 */

import * as Phaser from 'phaser';
import { VEHICLES } from '../world/traffic';
import { softTexture } from '../world/canvas';

/** Texture px per game px. */
export const ART_SCALE = 2;

export const TEX = {
  car: 'car',
  carShadow: 'car-shadow',
  puff: 'puff',
  spark: 'spark',
  tree: (k: number) => `tree-${k}`,
  species: (name: string) => `tree-${name}`,
  prop: (kind: string) => `prop-${kind}`,
  light: (state: string) => `light-${state}`,
  beacon: (on: boolean) => `beacon-${on ? 'on' : 'off'}`,
  debris: (kind: string) => `debris-${kind}`,
  stump: 'stump',
  trunk: 'trunk',
  bole: 'bole',
  pole: 'pole',
  jib: 'crane-jib',
  /** A tower crane's: its jib (and counter-jib), and its mast. */
  towerJib: 'crane-towerjib',
  mast: 'crane-mast',
} as const;

export const TREE_KINDS = 4;

/** Each species' crown from above: its greens (dark to the highlights), how lumpy, and any touch of other colour. */
const SPECIES_LOOK: Record<string, { greens: [string, string, string, string]; clumps: number; clumpSize: number; needles?: boolean; accent?: { colour: string; count: number; size: number } }> = {
  // London plane: big, a yellowish green, with pale patches.
  plane: { greens: ['#56742f', '#6f9038', '#8eae4c', '#b6cc6e'], clumps: 11, clumpSize: 0.32, accent: { colour: '#c8d58a', count: 9, size: 0.06 } },
  // Sweet gum: a deep green, touched with burgundy.
  sweetgum: { greens: ['#2b4a28', '#3a6431', '#548440', '#7aa45c'], clumps: 10, clumpSize: 0.28, accent: { colour: '#7a2b32', count: 12, size: 0.07 } },
  // Lime: a bright, fresh green, dense and round.
  lime: { greens: ['#3a7428', '#4f9832', '#70b844', '#a4d86a'], clumps: 12, clumpSize: 0.3 },
  // Maple: a mid green, in big lobes.
  maple: { greens: ['#2e6230', '#3d863b', '#58a24b', '#8ac46e'], clumps: 7, clumpSize: 0.4 },
  // Oak: dark, in irregular clumps.
  oak: { greens: ['#283f1f', '#36562a', '#4b7034', '#678d45'], clumps: 13, clumpSize: 0.24 },
  // Hawthorn: small and dark, with red haws.
  hawthorn: { greens: ['#2b4828', '#3a5f34', '#507a42', '#6f9858'], clumps: 9, clumpSize: 0.26, accent: { colour: '#b5322c', count: 16, size: 0.04 } },
  // Birch: light and airy.
  birch: { greens: ['#527f37', '#6b9c4c', '#8ebb68', '#b7d68f'], clumps: 8, clumpSize: 0.22 },
  // Cherry: a soft green.
  cherry: { greens: ['#3b6a34', '#4f8443', '#6d9f57', '#93bc78'], clumps: 9, clumpSize: 0.3 },
  // Conifers: a dark star of needles.
  conifer: { greens: ['#1d3a2c', '#28503d', '#386a50', '#5a8a6c'], clumps: 0, clumpSize: 0, needles: true },
};
/** The tree pictures' radius, px (they're scaled to each tree's size). */
export const TREE_RADIUS = 32;

type Ctx = CanvasRenderingContext2D;

/**
 * Something smashed, its wreck left where it was: its own picture crushed
 * (squashed and twisted a little), torn (bites out of its edges), and
 * battered (grimy, scorched, scratched). Made once for each picture.
 */
export function wreckTexture(scene: Phaser.Scene, key: string): string {
  const out = `${key}-wreck`;
  if (scene.textures.exists(out)) return out;
  const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
  const [w, h] = [src.width, src.height];
  const texture = softTexture(scene, out, w, h);
  const ctx = texture.context;
  let seed = 7;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rand = seeded(seed || 1);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rand() - 0.5) * 0.14);
  ctx.scale(0.93, 0.84);
  ctx.drawImage(src, -w / 2, -h / 2);
  ctx.restore();
  // Torn: jagged bites out of its edges.
  ctx.globalCompositeOperation = 'destination-out';
  const bites = 3 + Math.floor(rand() * 3);
  for (let k = 0; k < bites; k++) {
    const edge = Math.floor(rand() * 4);
    const t = rand();
    const [cx, cy] = edge === 0 ? [t * w, 0] : edge === 1 ? [w, t * h] : edge === 2 ? [t * w, h] : [0, t * h];
    const r = Math.min(w, h) * (0.15 + rand() * 0.2);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const d = r * (0.5 + rand() * 0.6);
      if (i) ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      else ctx.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fill();
  }
  // Battered: grimy all over, scorched in places, and scratched, on what's left of it.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(45,38,30,0.3)';
  ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 4; k++) {
    const g = ctx.createRadialGradient(rand() * w, rand() * h, 0, rand() * w, rand() * h, Math.min(w, h) * (0.3 + rand() * 0.4));
    g.addColorStop(0, 'rgba(20,16,12,0.55)');
    g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.strokeStyle = 'rgba(210,205,195,0.45)';
  ctx.lineWidth = Math.max(1, w / 60);
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    const [x, y] = [rand() * w, rand() * h];
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * w * 0.4, y + (rand() - 0.5) * h * 0.4);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  texture.refresh();
  return out;
}

export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = softTexture(scene, key, Math.ceil(w * ART_SCALE), Math.ceil(h * ART_SCALE));
  const ctx = texture.context;
  ctx.scale(ART_SCALE, ART_SCALE);
  draw(ctx);
  texture.refresh();
}

/** A colour (#rrggbb) lightened (+) or darkened (-) by a fraction. */
function shadeOf(colour: string, by: number): string {
  const n = parseInt(colour.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(by < 0 ? c * (1 + by) : c + (255 - c) * by)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
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
  const { length: L, width: W } = VEHICLES.own;

  // Yours, facing right: an armoured truck in dark olive plate. A short cab in front with slit windows
  // behind a bull bar; behind it the armoured body, its plates riveted, a hatch and a light bar on its roof.
  canvasTexture(scene, TEX.car, L, W, (ctx) => {
    const cab = 13;
    // Big tyres peeking out: one axle under the cab, two under the body.
    ctx.fillStyle = '#121212';
    for (const x of [L - cab + 1.5, 8, 17]) {
      ctx.fillRect(x, 0, 8, 2.2);
      ctx.fillRect(x, W - 2.2, 8, 2.2);
    }
    // The body, its edges darker, the plate's top lighter where the light catches it.
    roundRect(ctx, 0.5, 1, L - 3, W - 2, 2.5, '#262c22');
    roundRect(ctx, 1.4, 1.8, L - cab - 2.6, W - 3.6, 1.6, '#4a5541');
    roundRect(ctx, 2.6, 3, L - cab - 5, W - 6, 1.2, '#56624b');
    // The plates' seams and rivets.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const x of [13, 25, 36]) {
      ctx.moveTo(x, 2);
      ctx.lineTo(x, W - 2);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let x = 4; x < L - cab - 2; x += 3) {
      ctx.fillRect(x, 2.4, 0.6, 0.6);
      ctx.fillRect(x, W - 3, 0.6, 0.6);
    }
    // A round roof hatch, and a blue light bar at the body's front.
    ctx.fillStyle = '#2c3327';
    ctx.beginPath();
    ctx.arc(19, W / 2, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#56624b';
    ctx.beginPath();
    ctx.arc(19, W / 2, 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(18.6, W / 2 - 2.7, 0.8, 5.4);
    roundRect(ctx, L - cab - 4.5, 4, 2.4, W - 8, 0.8, '#151515');
    ctx.fillStyle = '#3d7bff';
    ctx.fillRect(L - cab - 4, 4.6, 1.4, 4);
    ctx.fillStyle = '#ff3a3a';
    ctx.fillRect(L - cab - 4, W - 8.6, 1.4, 4);
    // The cab: lower, with slit windows in its plate.
    roundRect(ctx, L - cab - 1, 2, cab - 1.5, W - 4, 2, '#3f4937');
    roundRect(ctx, L - cab, 3.2, cab - 6, W - 6.4, 1.2, '#4c5843');
    ctx.fillStyle = '#10171d';
    ctx.fillRect(L - 7, 4, 1.6, W - 8);
    ctx.fillStyle = 'rgba(150,200,230,0.5)';
    ctx.fillRect(L - 6.8, 5, 0.6, W - 10);
    ctx.fillStyle = '#10171d';
    ctx.fillRect(L - cab + 1, 2, 4, 1);
    ctx.fillRect(L - cab + 1, W - 3, 4, 1);
    // Wing mirrors on stalks.
    ctx.fillStyle = '#1b1f18';
    ctx.fillRect(L - 9, 0, 1.6, 2);
    ctx.fillRect(L - 9, W - 2, 1.6, 2);
    // Bull bar across the front, headlights behind its bars.
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(L - 4.2, 3.4, 1.6, 3.2);
    ctx.fillRect(L - 4.2, W - 6.6, 1.6, 3.2);
    roundRect(ctx, L - 2.6, 1.6, 2.4, W - 3.2, 1, '#151515');
    ctx.fillStyle = '#5a5f63';
    for (let y = 3; y < W - 3; y += 3) ctx.fillRect(L - 2.2, y, 1.8, 0.8);
    // The back: its doors' seam, black and yellow stripes, and tail lights.
    ctx.fillStyle = '#e2c23b';
    ctx.fillRect(0.6, 2.5, 1.4, W - 5);
    ctx.fillStyle = '#151515';
    for (let y = 3.5; y < W - 3; y += 3) ctx.fillRect(0.6, y, 1.4, 1.4);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(0.4, 2.2, 1.6, 2);
    ctx.fillRect(0.4, W - 4.2, 1.6, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(2.4, W / 2 - 0.3, 9, 0.6);
  });
  canvasTexture(scene, TEX.carShadow, L, W, (ctx) => roundRect(ctx, 0, 0, L, W, 2.5, '#000'));

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

  // Trees whose species is known: each its own crown.
  for (const [name, look] of Object.entries(SPECIES_LOOK)) {
    const R = TREE_RADIUS;
    canvasTexture(scene, TEX.species(name), R * 2, R * 2, (ctx) => {
      const rand = seeded(97 + name.length * 31 + name.charCodeAt(0));
      const [dark, mid, light, highlight] = look.greens;
      if (look.needles) {
        // A conifer: a dark star of needled branches, lighter towards the top.
        ctx.fillStyle = dark;
        ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const r = i % 2 ? R * 0.62 : R * (0.86 + rand() * 0.1);
          ctx.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        circle(ctx, R, R, R * 0.5, mid);
        circle(ctx, R - R * 0.12, R - R * 0.12, R * 0.26, light);
        circle(ctx, R - R * 0.18, R - R * 0.2, R * 0.08, highlight);
        return;
      }
      circle(ctx, R, R, R * 0.92, dark);
      for (let i = 0; i < look.clumps; i++) {
        const a = rand() * Math.PI * 2;
        const d = R * (0.3 + rand() * 0.38);
        circle(ctx, R + Math.cos(a) * d, R + Math.sin(a) * d, R * (look.clumpSize + rand() * 0.16), mid);
      }
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 1.25 + (rand() - 0.5) * 1.8;
        const d = R * (0.15 + rand() * 0.4);
        circle(ctx, R + Math.cos(a) * d, R + Math.sin(a) * d, R * (0.18 + rand() * 0.14), light);
      }
      for (let i = 0; i < 5; i++) circle(ctx, R - R * 0.3 + rand() * R * 0.35, R - R * 0.35 + rand() * R * 0.3, R * 0.08 + rand() * R * 0.06, highlight);
      // Its touches of colour: a plane's pale bark showing through, berries, a sweet gum's dark red leaves.
      if (look.accent) {
        for (let i = 0; i < look.accent.count; i++) {
          const a = rand() * Math.PI * 2;
          const d = R * rand() * 0.8;
          circle(ctx, R + Math.cos(a) * d, R + Math.sin(a) * d, R * look.accent.size * (0.6 + rand() * 0.8), look.accent.colour);
        }
      }
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
  // A fountain smashed: its rim broken through, the water run out (a puddle left), its middle broken off to a stump, cracked.
  canvasTexture(scene, `${TEX.prop('fountain')}-broken`, 30, 30, (ctx) => {
    circle(ctx, 15, 15, 14.5, '#bdb4a2');
    circle(ctx, 15, 15, 12.5, '#8d877c');
    ctx.fillStyle = '#4c9fc4';
    ctx.beginPath();
    ctx.ellipse(11, 18, 6, 4, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // (The gap broken through its rim.)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(15, 15);
    ctx.arc(15, 15, 15, -0.55, 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    circle(ctx, 15, 15, 3.4, '#a59d8e');
    circle(ctx, 14.4, 14.4, 1.4, '#c9c0ae');
    ctx.strokeStyle = '#6e675c';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(4, 9);
    ctx.lineTo(8, 11.5);
    ctx.lineTo(9.5, 15);
    ctx.moveTo(18, 22);
    ctx.lineTo(20.5, 25);
    ctx.lineTo(19.5, 28.5);
    ctx.stroke();
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
  // A shopping trolley, from above (facing along x, its handle at the back): a wire basket; and full of shopping.
  for (const full of [false, true]) {
    canvasTexture(scene, full ? `${TEX.prop('trolley')}-full` : TEX.prop('trolley'), 8, 5, (ctx) => {
      ctx.fillStyle = 'rgba(205,212,218,0.35)';
      ctx.fillRect(1.6, 0.5, 6, 4);
      ctx.strokeStyle = '#a7afb6';
      ctx.lineWidth = 0.35;
      for (let x = 2.8; x < 7.6; x += 1.2) ctx.strokeRect(x, 0.5, 0, 4);
      for (const y of [1.8, 3.2]) ctx.strokeRect(1.6, y, 6, 0);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = '#c3c9ce';
      ctx.strokeRect(1.6, 0.5, 6, 4);
      if (full) {
        roundRect(ctx, 2, 0.8, 2.4, 1.8, 0.4, '#e9e4d6');
        roundRect(ctx, 4.6, 0.9, 2.6, 1.6, 0.3, '#d9822b');
        roundRect(ctx, 2.2, 2.7, 2, 1.5, 0.5, '#3f8f4a');
        roundRect(ctx, 4.4, 2.6, 2.8, 1.6, 0.3, '#3b6fb0');
      }
      roundRect(ctx, 0.2, 0, 1, 5, 0.5, '#d2372b');
    });
  }
  // The food carts, from above (serving side along x): the cart, its counter, and a striped parasol over it; hot dogs, coffee, ice cream, crêpes.
  const carts: [string, string, string][] = [['#c62d2a', '#f4f0e6', '#e9b23a'], ['#5a3b26', '#efe2c8', '#2e2a26'], ['#e58bb0', '#fbf3f6', '#7cc8e0'], ['#2f5d9a', '#f2f2ee', '#e2a64a']];
  carts.forEach(([stripe, white, trim], k) => {
    canvasTexture(scene, `${TEX.prop('foodcart')}-${k}`, 18, 18, (ctx) => {
      // The cart, and its wheels' shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(3.6, 6.2, 12, 7);
      roundRect(ctx, 2.5, 5, 13, 8, 1, trim);
      roundRect(ctx, 11.5, 5.6, 3.4, 6.8, 0.6, '#d9d9d4');
      // The parasol: eight panels, every other one striped.
      const [cx, cy, r] = [8, 9, 7.6];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? white : stripe;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, (i * Math.PI) / 4, ((i + 1) * Math.PI) / 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      circle(ctx, cx, cy, 0.8, '#3a3a3a');
    });
  });
  // The market stalls' canopies, from above (3 m along x, 2.5 m deep along y, the front at the bottom): a peaked roof, its four faces shaded, a valance along the front.
  const canopies: [string, string][] = [['#e8e4da', '#c9c3b4'], ['#2f6db0', '#e8eef5'], ['#c83a32', '#f2ece2'], ['#3f8a4a', '#eef2e8'], ['#e0a53a', '#f6efe0'], ['#7a4a8a', '#eee8f2']];
  canopies.forEach(([main, stripe], k) => {
    canvasTexture(scene, `${TEX.prop('stall')}-${k}`, 24, 20, (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(1.2, 1.2, 23, 19);
      const face = (pts: number[], shade: number) => {
        ctx.fillStyle = main;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fill();
      };
      face([0, 0, 24, 0, 16, 10, 8, 10], 0.12);
      face([24, 0, 24, 20, 16, 10], 0.05);
      face([0, 20, 24, 20, 16, 10, 8, 10], 0);
      face([0, 0, 8, 10, 0, 20], 0.18);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(8, 10);
      ctx.lineTo(0, 20);
      ctx.moveTo(24, 0);
      ctx.lineTo(16, 10);
      ctx.lineTo(24, 20);
      ctx.moveTo(8, 10);
      ctx.lineTo(16, 10);
      ctx.stroke();
      // The valance along its front, scalloped and striped.
      for (let x = 0; x < 24; x += 3) {
        ctx.fillStyle = (x / 3) % 2 ? stripe : main;
        ctx.fillRect(x, 18.4, 3, 1.6);
      }
    });
  });
  // A shop's A-board from above: its two boards tented over, chalked.
  canvasTexture(scene, TEX.prop('aboard'), 5, 4, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0.6, 0.6, 4.4, 3.4);
    roundRect(ctx, 0, 0, 4.6, 3.4, 0.3, '#6b4a2e');
    ctx.fillStyle = '#23282a';
    ctx.fillRect(0.4, 0.3, 3.8, 1.2);
    ctx.fillRect(0.4, 1.9, 3.8, 1.2);
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(0.8, 0.6, 2.4, 0.3);
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(0.8, 2.3, 1.8, 0.3);
  });
  // The playgrounds' things, from above (along x), in the bright paint they come in.
  // The swings: a steel A-frame at each end, the bar between (their seats drawn on their own, swinging).
  canvasTexture(scene, TEX.prop('swings'), 30, 16, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(1.5, 7.8, 29, 1.6);
    ctx.strokeStyle = '#2f6b45';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (const x of [1.2, 28.8]) {
      ctx.beginPath();
      ctx.moveTo(x, 1);
      ctx.lineTo(x, 15);
      ctx.stroke();
    }
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#37804f';
    ctx.beginPath();
    ctx.moveTo(1.2, 8);
    ctx.lineTo(28.8, 8);
    ctx.stroke();
    // Worn patches under each swing.
    ctx.fillStyle = 'rgba(110,86,58,0.35)';
    for (const x of [8.6, 21.4]) {
      ctx.beginPath();
      ctx.ellipse(x, 8, 2.4, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  canvasTexture(scene, `${TEX.prop('swings')}-seat`, 4, 2.4, (ctx) => {
    roundRect(ctx, 0.2, 0.2, 3.6, 2, 0.6, '#1d1d1f');
    ctx.fillStyle = '#9aa1a6';
    ctx.fillRect(0, 0.9, 0.4, 0.6);
    ctx.fillRect(3.6, 0.9, 0.4, 0.6);
  });
  // The slide: its ladder, the platform at the top, and the chute down.
  canvasTexture(scene, TEX.prop('slide'), 32, 8, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(2, 2.5, 30, 5);
    ctx.strokeStyle = '#8e969c';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(0.5, 1.6, 6, 4.8);
    for (let x = 1.7; x < 6.5; x += 1.2) ctx.strokeRect(x, 1.6, 0, 4.8);
    roundRect(ctx, 6, 1, 4.6, 6, 0.6, '#d8452e');
    roundRect(ctx, 10.2, 1.6, 21.4, 4.8, 1.4, '#c9ced2');
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(11, 3.4, 19.6, 1.1);
    ctx.fillStyle = '#e8b730';
    ctx.fillRect(10.2, 1.6, 21.4, 0.7);
    ctx.fillRect(10.2, 5.7, 21.4, 0.7);
  });
  // The roundabout: a steel disc, in coloured quarters, its grab rails and the post in the middle.
  canvasTexture(scene, TEX.prop('roundabout'), 20, 20, (ctx) => {
    circle(ctx, 10.8, 10.8, 9.4, 'rgba(0,0,0,0.22)');
    ['#d8452e', '#e8b730', '#2f74c0', '#3f9a52'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(10, 10);
      ctx.arc(10, 10, 9.2, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
      ctx.closePath();
      ctx.fill();
    });
    ctx.strokeStyle = '#d6dadd';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(10 + Math.cos(a) * 2, 10 + Math.sin(a) * 2);
      ctx.lineTo(10 + Math.cos(a) * 8.6, 10 + Math.sin(a) * 8.6);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(10, 10, 9.2, 0, Math.PI * 2);
    ctx.stroke();
    circle(ctx, 10, 10, 2, '#9aa1a6');
  });
  // The climbing frame: a lattice of bars, a deck in the middle, a bit of netting.
  canvasTexture(scene, TEX.prop('climbframe'), 22, 22, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(2.5, 2.5, 19, 19);
    roundRect(ctx, 7, 7, 8, 8, 0.5, '#8a5a32');
    ctx.strokeStyle = '#2f74c0';
    ctx.lineWidth = 0.9;
    for (let k = 1; k <= 21; k += 5) {
      ctx.beginPath();
      ctx.moveTo(k, 1);
      ctx.lineTo(k, 21);
      ctx.moveTo(1, k);
      ctx.lineTo(21, k);
      ctx.stroke();
    }
    ctx.strokeStyle = '#e8b730';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(1, 1, 20, 20);
    ctx.strokeStyle = 'rgba(230,220,190,0.8)';
    ctx.lineWidth = 0.35;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(16 + k, 16);
      ctx.lineTo(16, 21 - k);
      ctx.stroke();
    }
  });
  // The sandpit: its timber edging, and the sand, raked about and dug.
  canvasTexture(scene, TEX.prop('sandpit'), 26, 26, (ctx) => {
    roundRect(ctx, 0, 0, 26, 26, 1, '#7a5230');
    roundRect(ctx, 1.6, 1.6, 22.8, 22.8, 0.6, '#e2cf98');
    ctx.fillStyle = 'rgba(160,130,80,0.35)';
    for (const [x, y, r] of [[8, 9, 2.4], [17, 15, 3], [11, 19, 1.6], [19, 6, 1.4]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    circle(ctx, 18.5, 18.5, 1.2, '#d8452e');
    circle(ctx, 6, 18, 0.9, '#2f74c0');
  });
  // The seesaw: its plank, the pivot in the middle, a handle at each seat.
  canvasTexture(scene, TEX.prop('seesaw'), 30, 6, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(1.4, 2.4, 29, 3);
    roundRect(ctx, 0.5, 1.6, 29, 2.8, 1, '#3f9a52');
    roundRect(ctx, 13, 0.5, 4, 5, 0.8, '#5c6368');
    ctx.fillStyle = '#e8b730';
    ctx.fillRect(4.5, 0.4, 0.8, 5.2);
    ctx.fillRect(24.7, 0.4, 0.8, 5.2);
  });
  // A spring rider: a yellow duck on its spring.
  canvasTexture(scene, TEX.prop('springy'), 8, 8, (ctx) => {
    circle(ctx, 4.5, 4.5, 3.2, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = '#efc53a';
    ctx.beginPath();
    ctx.ellipse(3.6, 4, 3, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, 6.4, 4, 1.4, '#efc53a');
    ctx.fillStyle = '#e07a2a';
    ctx.fillRect(7.4, 3.6, 0.6, 0.8);
    circle(ctx, 6.6, 3.4, 0.3, '#1d1d1f');
  });
  // The building sites' things, from above (along x).
  const shade = (ctx: Ctx, w: number, h: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(1.2, 1.2, w - 1, h - 1);
  };
  // A Portakabin: its flat roof, ribbed, a blue rim; an air-conditioning box.
  canvasTexture(scene, TEX.prop('cabin'), 49, 21, (ctx) => {
    shade(ctx, 49, 21);
    roundRect(ctx, 0, 0, 48, 20, 0.8, '#2f5e94');
    roundRect(ctx, 1, 1, 46, 18, 0.5, '#c9ccc8');
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 4; x < 46; x += 4) ctx.fillRect(x, 1, 0.5, 18);
    roundRect(ctx, 36, 6, 6, 8, 0.5, '#9a9ea2');
  });
  // A portaloo: its blue roof and vent.
  canvasTexture(scene, TEX.prop('portaloo'), 11, 11, (ctx) => {
    shade(ctx, 11, 11);
    roundRect(ctx, 0, 0, 10, 10, 1.6, '#2f6fc0');
    circle(ctx, 5, 5, 3.2, '#3b80d6');
    circle(ctx, 7, 3, 0.9, '#e8ecef');
  });
  // A skip: yellow, its sloping ends, rubble in it.
  canvasTexture(scene, TEX.prop('skip'), 30, 16, (ctx) => {
    shade(ctx, 30, 16);
    ctx.fillStyle = '#e2b41c';
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(29, 1);
    ctx.lineTo(29, 14);
    ctx.lineTo(0, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7b6a55';
    ctx.fillRect(3.5, 3, 22, 9);
    const rand = seeded(5);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = ['#9a5a42', '#b4b0a6', '#5b4630', '#8a8478'][i % 4];
      ctx.fillRect(4 + rand() * 20, 3.5 + rand() * 7.5, 1 + rand() * 2.5, 0.8 + rand() * 1.5);
    }
  });
  // A pallet of bricks, shrink-wrapped.
  canvasTexture(scene, TEX.prop('pallet'), 10, 10, (ctx) => {
    shade(ctx, 10, 10);
    roundRect(ctx, 0, 0, 9.6, 8.8, 0.3, '#8a5a32');
    roundRect(ctx, 0.6, 0.6, 8.4, 7.6, 0.3, '#a5503a');
    ctx.fillStyle = 'rgba(60,20,10,0.35)';
    for (let y = 1.6; y < 8; y += 1.5) ctx.fillRect(0.6, y, 8.4, 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0.6, 3.8, 8.4, 0.6);
  });
  // Drainage pipes, stacked: orange plastic.
  canvasTexture(scene, TEX.prop('pipes'), 25, 13, (ctx) => {
    shade(ctx, 25, 13);
    for (let k = 0; k < 4; k++) {
      roundRect(ctx, 0, k * 3, 24, 2.8, 1.4, '#c86a2a');
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(1, k * 3 + 0.5, 22, 0.5);
    }
  });
  // A digger: its tracks, its house (the engine, the cab's glass); its arm's drawn on its own (it swings).
  canvasTexture(scene, TEX.prop('digger'), 41, 22, (ctx) => {
    shade(ctx, 41, 22);
    for (const y of [0, 15.5]) {
      roundRect(ctx, 2, y, 30, 5.5, 2.5, '#2b2b2c');
      ctx.fillStyle = '#4a4a4c';
      for (let x = 4; x < 31; x += 2.2) ctx.fillRect(x, y + 0.5, 0.8, 4.5);
    }
    roundRect(ctx, 5, 3.5, 24, 14, 2, '#e2a919');
    roundRect(ctx, 5, 4.5, 8, 12, 1.5, '#c69212');
    roundRect(ctx, 20, 4.5, 7, 6, 1, '#27353d');
    ctx.fillStyle = 'rgba(200,230,240,0.4)';
    ctx.fillRect(21, 5.2, 5, 1.2);
    circle(ctx, 29, 10.5, 2, '#9b7a10');
  });
  // Its arm: boom and dipper out from where it's pinned, the bucket on the end.
  canvasTexture(scene, `${TEX.prop('digger')}-arm`, 26, 8, (ctx) => {
    roundRect(ctx, 0, 2.5, 22, 3, 1.4, '#d39d14');
    ctx.fillStyle = '#9b7a10';
    ctx.fillRect(10, 3.4, 8, 1.2);
    roundRect(ctx, 20, 0.5, 5.5, 7, 1, '#4a4a4c');
    ctx.fillStyle = '#2b2b2c';
    for (let y = 1.2; y < 7; y += 1.4) ctx.fillRect(24.6, y, 0.9, 0.6);
  });
  // A site dumper: its hopper up front, its engine behind, its wheels.
  canvasTexture(scene, TEX.prop('dumper'), 30, 17, (ctx) => {
    shade(ctx, 30, 17);
    for (const [x, y] of [[4, 0], [4, 13], [21, 0], [21, 13]]) roundRect(ctx, x, y, 6, 3.5, 1.4, '#2b2b2c');
    roundRect(ctx, 1, 2.5, 13, 11, 1, '#e2a919');
    roundRect(ctx, 16, 3.5, 13, 9, 1.5, '#d39d14');
    ctx.fillStyle = '#7b6a55';
    ctx.fillRect(15, 4.5, 12, 7);
    ctx.fillStyle = '#8a8478';
    ctx.fillRect(17, 5.5, 8, 5);
    roundRect(ctx, 3, 5, 6, 6, 1, '#3a3a3c');
  });
  // The fly-tipped rubbish: a stained mattress, an old sofa, a stack of tyres, burst bin bags, a fridge.
  canvasTexture(scene, TEX.prop('mattress'), 16, 12, (ctx) => {
    shade(ctx, 16, 12);
    roundRect(ctx, 0, 0, 15.2, 11.2, 1.2, '#e6e0cf');
    ctx.strokeStyle = 'rgba(120,110,90,0.35)';
    ctx.lineWidth = 0.3;
    for (let x = 2.5; x < 15; x += 2.5) for (let y = 2.5; y < 11; y += 2.5) ctx.strokeRect(x - 0.4, y - 0.4, 0.8, 0.8);
    ctx.fillStyle = 'rgba(150,120,60,0.35)';
    ctx.beginPath();
    ctx.ellipse(9, 6.5, 3.5, 2.2, 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
  canvasTexture(scene, TEX.prop('sofa'), 17, 8, (ctx) => {
    shade(ctx, 17, 8);
    roundRect(ctx, 0, 0, 16, 7.4, 1.2, '#6e3a35');
    roundRect(ctx, 1.6, 2.4, 6.2, 4.2, 0.8, '#84473f');
    roundRect(ctx, 8.2, 2.4, 6.2, 4.2, 0.8, '#84473f');
    ctx.fillStyle = 'rgba(255,240,210,0.6)';
    ctx.fillRect(10, 3.6, 2, 1.4);
  });
  canvasTexture(scene, TEX.prop('tyres'), 7, 7, (ctx) => {
    circle(ctx, 3.8, 3.8, 3, 'rgba(0,0,0,0.22)');
    circle(ctx, 3.2, 3.2, 3, '#1c1c1d');
    circle(ctx, 3.2, 3.2, 1.6, '#4a4f53');
    ctx.strokeStyle = '#333436';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(3.2, 3.2, 2.4, 0, Math.PI * 2);
    ctx.stroke();
  });
  canvasTexture(scene, TEX.prop('binbags'), 7, 7, (ctx) => {
    for (const [x, y, r] of [[2.4, 2.6, 2], [4.6, 3.6, 2.1], [2.8, 4.8, 1.6]]) {
      circle(ctx, x + 0.5, y + 0.5, r, 'rgba(0,0,0,0.2)');
      circle(ctx, x, y, r, '#1b1d20');
      circle(ctx, x - 0.6, y - 0.6, r * 0.35, 'rgba(255,255,255,0.18)');
    }
    ctx.fillStyle = '#d9d2c0';
    ctx.fillRect(4.6, 5.2, 0.9, 0.6);
  });
  canvasTexture(scene, TEX.prop('fridge'), 7, 7, (ctx) => {
    shade(ctx, 7, 7);
    roundRect(ctx, 0, 0, 6, 6, 0.6, '#e8ebec');
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 3.6, 6, 0.3);
    ctx.fillStyle = 'rgba(160,110,60,0.4)';
    ctx.fillRect(3.5, 0.8, 1.6, 1.4);
  });
  // More fly-tipped: an oil drum (rusting), a traffic cone, a wooden pallet, a washing machine, a rolled-up carpet.
  canvasTexture(scene, TEX.prop('drum'), 6, 6, (ctx) => {
    circle(ctx, 3.3, 3.3, 2.5, 'rgba(0,0,0,0.22)');
    circle(ctx, 2.9, 2.9, 2.5, '#2f5a8a');
    circle(ctx, 2.9, 2.9, 1.9, '#3b6a9c');
    circle(ctx, 3.6, 2.2, 0.8, '#8a4a22');
    circle(ctx, 2, 3.4, 0.35, '#1d1f22');
  });
  canvasTexture(scene, TEX.prop('cone'), 4, 4, (ctx) => {
    roundRect(ctx, 0.2, 0.2, 3.4, 3.4, 0.5, '#e8541c');
    circle(ctx, 1.9, 1.9, 1.2, '#f2f2ee');
    circle(ctx, 1.9, 1.9, 0.7, '#e8541c');
  });
  canvasTexture(scene, TEX.prop('woodpallet'), 10, 9, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0.8, 0.8, 9.2, 8);
    ctx.fillStyle = '#a7834f';
    for (let y = 0; y < 8; y += 1.75) ctx.fillRect(0, y, 9.6, 1.2);
    ctx.fillStyle = '#8a6a3c';
    for (const x of [0.3, 4.3, 8.3]) ctx.fillRect(x, 0, 1, 8);
  });
  canvasTexture(scene, TEX.prop('washer'), 6, 6, (ctx) => {
    roundRect(ctx, 0.6, 0.6, 5.2, 5.2, 0.5, 'rgba(0,0,0,0.22)');
    roundRect(ctx, 0, 0, 5.2, 5.2, 0.5, '#e4e7e8');
    circle(ctx, 2.6, 3, 1.6, '#5c6a72');
    circle(ctx, 2.6, 3, 1.1, '#8fa3ad');
    ctx.fillStyle = '#b5babd';
    ctx.fillRect(0.4, 0.4, 4.4, 0.9);
  });
  canvasTexture(scene, TEX.prop('carpet'), 20, 5, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0.8, 0.8, 19, 4);
    roundRect(ctx, 0, 0, 19, 4, 2, '#7a3b3b');
    ctx.fillStyle = '#c0a060';
    for (let x = 2; x < 18; x += 3) ctx.fillRect(x, 0.4, 1, 3.2);
    circle(ctx, 1.8, 2, 1.6, '#5c2c2c');
  });
  // A burnt-out car: its shell blackened and rusted, no glass, its tyres burnt off.
  canvasTexture(scene, TEX.prop('burntcar'), 36, 17, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(1.5, 1.5, 35, 15.5);
    roundRect(ctx, 0, 0, 35, 15.5, 3, '#2c2622');
    roundRect(ctx, 1.5, 1.5, 32, 12.5, 2.5, '#5a3e2c');
    const rand = seeded(17);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = ['#7a4a2a', '#1b1714', '#8f5a32', '#3a2e26'][i % 4];
      ctx.beginPath();
      ctx.arc(2 + rand() * 31, 2 + rand() * 11.5, 0.6 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Where its windows were: holes.
    roundRect(ctx, 8, 2.5, 6, 10.5, 1, '#141210');
    roundRect(ctx, 22, 3, 5, 9.5, 1, '#141210');
    for (const [x, y] of [[6, -0.5], [6, 13.5], [27, -0.5], [27, 13.5]]) roundRect(ctx, x, y, 5, 2.5, 1, '#3d3a37');
  });
  // A tent: its flysheet (green), ridge along it, its door at the front (+x).
  canvasTexture(scene, TEX.prop('tent'), 19, 13, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(1.5, 1.5, 17.5, 11.5);
    roundRect(ctx, 0, 0, 18, 12, 2, '#3f6b3a');
    ctx.fillStyle = '#4f8248';
    ctx.fillRect(1, 1, 16, 5);
    ctx.fillStyle = '#2f5230';
    ctx.fillRect(0, 5.6, 18, 0.8);
    ctx.fillStyle = '#26402a';
    ctx.beginPath();
    ctx.moveTo(18, 3);
    ctx.lineTo(14.5, 6);
    ctx.lineTo(18, 9);
    ctx.closePath();
    ctx.fill();
  });
  // A campfire: a ring of stones, the logs in it, the ash (its flames drawn on their own, flickering).
  canvasTexture(scene, TEX.prop('campfire'), 12, 12, (ctx) => {
    circle(ctx, 6, 6, 5, '#5a5248');
    circle(ctx, 6, 6, 3.8, '#2a2522');
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      circle(ctx, 6 + Math.cos(a) * 4.6, 6 + Math.sin(a) * 4.6, 1.1, k % 2 ? '#8a8378' : '#9e978b');
    }
    ctx.strokeStyle = '#5a3a22';
    ctx.lineWidth = 1;
    for (const a of [0.3, 1.9, 3.6]) {
      ctx.beginPath();
      ctx.moveTo(6 - Math.cos(a) * 3, 6 - Math.sin(a) * 3);
      ctx.lineTo(6 + Math.cos(a) * 3, 6 + Math.sin(a) * 3);
      ctx.stroke();
    }
  });
  for (let f = 0; f < 3; f++) {
    canvasTexture(scene, `${TEX.prop('campfire')}-flame-${f}`, 8, 8, (ctx) => {
      const g = ctx.createRadialGradient(4, 4, 0, 4, 4, 3.6 + f * 0.3);
      g.addColorStop(0, 'rgba(255,240,170,0.95)');
      g.addColorStop(0.4, 'rgba(255,160,40,0.85)');
      g.addColorStop(1, 'rgba(220,60,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + f;
        const r = k % 2 ? 2.2 : 3.8 - f * 0.3;
        if (k) ctx.lineTo(4 + Math.cos(a) * r, 4 + Math.sin(a) * r);
        else ctx.moveTo(4 + Math.cos(a) * r, 4 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    });
  }
  // In people's gardens (see src/world/homes.ts), from above, along x.
  // Wheelie bins, each council's colour: their lids, hinged at the back, the handle.
  ['#26282b', '#2f6b34', '#2d5c9a', '#6b4a2e'].forEach((colour, v) => {
    canvasTexture(scene, `${TEX.prop('wheelie')}-${v}`, 7, 6, (ctx) => {
      shade(ctx, 6.2, 5.2);
      roundRect(ctx, 0, 0, 6, 5, 0.5, colour);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0.6, 0.6, 4.4, 3.8);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, 0.7, 5);
    });
  });
  // A recycling box: green, open, full of tins and paper.
  canvasTexture(scene, TEX.prop('recyclebox'), 6, 5, (ctx) => {
    shade(ctx, 5, 4);
    roundRect(ctx, 0, 0, 4.8, 3.6, 0.4, '#2e7d3a');
    ctx.fillStyle = '#1f5a28';
    ctx.fillRect(0.5, 0.5, 3.8, 2.6);
    for (const [x, y, c] of [[1.2, 1.2, '#d8d8d2'], [2.6, 1.6, '#c0392b'], [3.4, 1, '#e8e2c8'], [1.8, 2.3, '#9aa0a6']] as [number, number, string][]) circle(ctx, x, y, 0.5, c);
  });
  // A garden table and four chairs: a round white table, its parasol's hole, green chairs round it.
  canvasTexture(scene, TEX.prop('gardenset'), 16, 16, (ctx) => {
    for (const [x, y] of [[7.5, 1.6], [7.5, 13.4], [1.6, 7.5], [13.4, 7.5]]) {
      circle(ctx, x + 0.6, y + 0.6, 1.7, 'rgba(0,0,0,0.2)');
      roundRect(ctx, x - 1.6, y - 1.6, 3.2, 3.2, 0.8, '#3d6b3a');
    }
    circle(ctx, 8.2, 8.2, 4.4, 'rgba(0,0,0,0.22)');
    circle(ctx, 7.5, 7.5, 4.4, '#ecebe4');
    circle(ctx, 7.5, 7.5, 0.6, '#9a9a94');
  });
  // A shed: felt roof, its ridge along it, a little window at one end.
  canvasTexture(scene, TEX.prop('shed'), 21, 16, (ctx) => {
    shade(ctx, 20, 15);
    roundRect(ctx, 0, 0, 19.2, 14.4, 0.4, '#3a3d40');
    ctx.fillStyle = '#2d3033';
    ctx.fillRect(0, 7.2, 19.2, 7.2);
    ctx.fillStyle = '#4a4e52';
    ctx.fillRect(0, 6.8, 19.2, 0.8);
    ctx.fillStyle = '#7a5a38';
    ctx.fillRect(0, 0, 0.8, 14.4);
    ctx.fillRect(18.4, 0, 0.8, 14.4);
  });
  // A trampoline: its black mat, the blue pad round it, the safety net's poles.
  canvasTexture(scene, TEX.prop('trampoline'), 27, 27, (ctx) => {
    circle(ctx, 13.8, 13.8, 12.8, 'rgba(0,0,0,0.2)');
    circle(ctx, 12.8, 12.8, 12.8, '#2f6fb5');
    circle(ctx, 12.8, 12.8, 10.6, '#1a1b1d');
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.4;
    for (const r of [4, 7.5]) {
      ctx.beginPath();
      ctx.arc(12.8, 12.8, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      circle(ctx, 12.8 + Math.cos(a) * 12, 12.8 + Math.sin(a) * 12, 0.7, '#d8dadc');
    }
  });
  // A rotary washing line: its arms and lines (a square web), some washing pegged out.
  canvasTexture(scene, TEX.prop('washline'), 22, 22, (ctx) => {
    ctx.strokeStyle = 'rgba(220,220,214,0.85)';
    ctx.lineWidth = 0.3;
    for (const r of [3, 6, 9]) ctx.strokeRect(11 - r, 11 - r, r * 2, r * 2);
    ctx.strokeStyle = '#9ea2a6';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(1.5, 1.5);
    ctx.lineTo(20.5, 20.5);
    ctx.moveTo(20.5, 1.5);
    ctx.lineTo(1.5, 20.5);
    ctx.stroke();
    const rand = seeded(17);
    const colours = ['#e8e4dc', '#c0392b', '#2d5c9a', '#f2c94c', '#7d4ea8', '#e8e4dc'];
    for (let k = 0; k < 7; k++) {
      const r = [6, 9][k % 2];
      const side = Math.floor(rand() * 4);
      const t = -r + 1 + rand() * (r * 2 - 3);
      const [x, y] = side === 0 ? [11 + t, 11 - r] : side === 1 ? [11 + r, 11 + t] : side === 2 ? [11 + t, 11 + r] : [11 - r, 11 + t];
      ctx.fillStyle = colours[k % colours.length];
      if (side % 2) ctx.fillRect(x - 0.6, y, 1.2, 2.2);
      else ctx.fillRect(x, y - 0.6, 2.2, 1.2);
    }
    circle(ctx, 11, 11, 1, '#6a6e72');
  });
  // A barbecue: a black kettle, its lid's vent; a bag of charcoal by it.
  canvasTexture(scene, TEX.prop('bbq'), 8, 6, (ctx) => {
    circle(ctx, 3.2, 3.2, 2.5, 'rgba(0,0,0,0.22)');
    circle(ctx, 2.8, 2.8, 2.5, '#1c1d1f');
    circle(ctx, 2.4, 2.3, 0.8, '#45484c');
    roundRect(ctx, 5.4, 1.4, 2, 3, 0.3, '#3a5f8a');
  });
  // A bike, left lying: its wheels, frame and bars.
  canvasTexture(scene, TEX.prop('pushbike'), 14, 6, (ctx) => {
    ctx.strokeStyle = '#1d1e20';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(1, 2.7);
    ctx.lineTo(5, 2.7);
    ctx.moveTo(8.6, 2.7);
    ctx.lineTo(12.8, 2.7);
    ctx.stroke();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(3, 2.7);
    ctx.lineTo(11, 2.7);
    ctx.stroke();
    ctx.fillStyle = '#2a2b2e';
    ctx.fillRect(10.4, 0.4, 0.8, 4.6);
    roundRect(ctx, 4.4, 1.9, 2.2, 1.6, 0.5, '#1d1e20');
  });
  // A paddling pool: inflatable, blue, the water in it.
  canvasTexture(scene, TEX.prop('paddling'), 16, 16, (ctx) => {
    circle(ctx, 8.1, 8.1, 7.2, 'rgba(0,0,0,0.18)');
    circle(ctx, 7.5, 7.5, 7.2, '#3b8fd6');
    circle(ctx, 7.5, 7.5, 5.6, '#8fd0ee');
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(4.5, 5, 3, 0.5);
    ctx.fillRect(8, 9, 2.4, 0.5);
  });
  // A greenhouse: glass panes on an aluminium frame, tomatoes inside.
  canvasTexture(scene, TEX.prop('greenhouse'), 21, 17, (ctx) => {
    shade(ctx, 20, 16);
    roundRect(ctx, 0, 0, 20, 15.2, 0.3, '#4f7d44');
    ctx.fillStyle = 'rgba(200,225,230,0.55)';
    ctx.fillRect(0, 0, 20, 15.2);
    ctx.strokeStyle = '#d4d8da';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0.25, 0.25, 19.5, 14.7);
    ctx.beginPath();
    for (let x = 4; x < 20; x += 4) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 15.2);
    }
    ctx.moveTo(0, 7.6);
    ctx.lineTo(20, 7.6);
    ctx.stroke();
    for (const [x, y] of [[3, 3.5], [8, 4], [13, 3], [16, 11], [6, 11.5]]) circle(ctx, x, y, 0.6, '#d0402a');
  });
  // A kids' playhouse: plastic, its red roof's ridge, a yellow chimney.
  canvasTexture(scene, TEX.prop('playhouse'), 13, 13, (ctx) => {
    shade(ctx, 12, 12);
    roundRect(ctx, 0, 0, 11.2, 11.2, 0.6, '#d8402e');
    ctx.fillStyle = '#b8321f';
    ctx.fillRect(0, 5.6, 11.2, 5.6);
    roundRect(ctx, 7.4, 1.6, 2, 2, 0.3, '#f2c94c');
  });
  // A plant pot: terracotta, something growing in it.
  canvasTexture(scene, TEX.prop('plantpot'), 5, 5, (ctx) => {
    circle(ctx, 2.4, 2.4, 2, 'rgba(0,0,0,0.2)');
    circle(ctx, 2, 2, 2, '#b8643a');
    circle(ctx, 2, 2, 1.4, '#3f7a2e');
    circle(ctx, 1.6, 1.6, 0.6, '#5c9a3a');
  });
  // Round the places (see src/world/places.ts).
  // A pub's parasol, from above: its canopy's eight panels, in its colour, the top of its pole.
  ['#2d5c3a', '#b02a2a', '#efe9d8', '#1f3d6e'].forEach((colour, v) => {
    canvasTexture(scene, `${TEX.prop('parasol')}-${v}`, 22, 22, (ctx) => {
      circle(ctx, 11.8, 11.8, 10, 'rgba(0,0,0,0.18)');
      for (let k = 0; k < 8; k++) {
        const [a0, a1] = [(k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2];
        ctx.fillStyle = k % 2 ? colour : shadeOf(colour, -0.12);
        ctx.beginPath();
        ctx.moveTo(11, 11);
        ctx.lineTo(11 + Math.cos(a0) * 10, 11 + Math.sin(a0) * 10);
        ctx.lineTo(11 + Math.cos(a1) * 10, 11 + Math.sin(a1) * 10);
        ctx.closePath();
        ctx.fill();
      }
      circle(ctx, 11, 11, 0.9, '#d8d8d2');
    });
  });
  // A keg: steel, its rim and its fitting.
  // A café's table and its two chairs, from above: white, black, timber, green.
  ['#f2f0ea', '#2c2c2e', '#9a6a3c', '#3f7d4a'].forEach((top, v) => {
    canvasTexture(scene, `${TEX.prop('cafetable')}-${v}`, 10, 10, (ctx) => {
      for (const y of [0.4, 7]) roundRect(ctx, 3, y, 4, 2.6, 0.6, v === 1 ? '#555' : '#3a3a3c');
      circle(ctx, 5.3, 5.3, 2.8, 'rgba(0,0,0,0.22)');
      circle(ctx, 5, 5, 2.8, top);
      circle(ctx, 4.4, 4.4, 1, 'rgba(255,255,255,0.25)');
    });
  });
  // A delivery moped, from above, facing right: its body (red, white, black), the box on the back (teal, orange, green).
  [['#b3241f', '#21a6a0'], ['#e8e8e4', '#e8742a'], ['#262626', '#4caf50']].forEach(([body, box], v) => {
    canvasTexture(scene, `${TEX.prop('moped')}-${v}`, 14, 5, (ctx) => {
      roundRect(ctx, 0.5, 1.6, 13, 1.8, 0.8, '#1d1d1d');
      roundRect(ctx, 4, 1, 7, 3, 1.2, body);
      roundRect(ctx, 0.3, 0.2, 4.4, 4.6, 0.5, box);
      ctx.fillStyle = '#1d1d1d';
      ctx.fillRect(11.5, 0.3, 0.8, 4.4);
    });
  });
  // A florist's bucket of flowers: a grey bucket, the blooms (reds and pinks, yellows, whites and purples) over it.
  [['#d7263d', '#f49ac1', '#ff5d73'], ['#ffd23f', '#f4a261', '#fff1a8'], ['#ffffff', '#9b5de5', '#c9b6e4']].forEach((blooms, v) => {
    canvasTexture(scene, `${TEX.prop('flowers')}-${v}`, 6, 6, (ctx) => {
      circle(ctx, 3, 3, 2.9, '#8a8f94');
      circle(ctx, 3, 3, 2.4, '#3f6e33');
      for (const [x, y, k] of [[2, 2, 0], [4, 2.3, 1], [3, 3.8, 2], [1.9, 3.9, 1], [4, 4, 0]]) circle(ctx, x, y, 0.9, blooms[k]);
    });
  });
  // A greengrocer's crate on its stand: apples, oranges, tomatoes.
  ['#7cb342', '#f39c12', '#d63a2f'].forEach((fruit, v) => {
    canvasTexture(scene, `${TEX.prop('crates')}-${v}`, 9, 6, (ctx) => {
      roundRect(ctx, 0, 0, 9, 6, 0.4, '#a87b4f');
      roundRect(ctx, 0.6, 0.6, 7.8, 4.8, 0.3, '#5e4128');
      for (let x = 1.4; x < 8.4; x += 1.4) for (let y = 1.4; y < 5.4; y += 1.4) circle(ctx, x, y, 0.65, fruit);
    });
  });
  // A newspaper stand: a wire rack, the papers in it.
  canvasTexture(scene, TEX.prop('newsstand'), 6, 5, (ctx) => {
    roundRect(ctx, 0, 0, 6, 5, 0.4, '#4a4f55');
    ['#f4f1e8', '#d8d2c0', '#e63946', '#f4f1e8'].forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.fillRect(0.6 + k * 1.3, 0.6, 1.1, 3.8);
    });
  });
  // A vacant shop's boards: a sheet of plywood over its window, tagged.
  canvasTexture(scene, TEX.prop('boards'), 10, 3, (ctx) => {
    roundRect(ctx, 0, 0, 10, 3, 0.2, '#c8a46e');
    ctx.strokeStyle = '#2f5fd0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(1.5, 2.2);
    ctx.bezierCurveTo(3, 0.4, 4, 2.6, 5.5, 0.8);
    ctx.lineTo(7.5, 2.2);
    ctx.stroke();
  });
  // A substation's transformer: a grey-green tank, its cooling fins along both sides, the yellow warning sign.
  canvasTexture(scene, TEX.prop('transformer'), 18, 16, (ctx) => {
    roundRect(ctx, 1.2, 1.2, 17, 15, 1, 'rgba(0,0,0,0.25)');
    roundRect(ctx, 0, 0, 17, 15, 1, '#6f7d6f');
    ctx.fillStyle = '#56635a';
    for (let x = 1; x < 16; x += 1.6) {
      ctx.fillRect(x, 0, 0.8, 3);
      ctx.fillRect(x, 12, 0.8, 3);
    }
    roundRect(ctx, 3, 4, 11, 7, 0.6, '#7f8d7f');
    ctx.fillStyle = '#f2c500';
    ctx.beginPath();
    ctx.moveTo(8.5, 5);
    ctx.lineTo(11, 9.6);
    ctx.lineTo(6, 9.6);
    ctx.closePath();
    ctx.fill();
  });
  // A water butt, its lid; a compost bin (black plastic, its hatch).
  canvasTexture(scene, TEX.prop('butt'), 5, 5, (ctx) => {
    circle(ctx, 2.5, 2.5, 2.4, '#2f4f2f');
    circle(ctx, 2.5, 2.5, 1.6, '#3d633d');
  });
  canvasTexture(scene, TEX.prop('compost'), 6, 6, (ctx) => {
    roundRect(ctx, 0, 0, 6, 6, 1.2, '#1f1f1f');
    roundRect(ctx, 1, 1, 4, 4, 0.8, '#333');
  });
  // A mechanic's tool chest: red, its drawers.
  canvasTexture(scene, TEX.prop('toolchest'), 7, 5, (ctx) => {
    roundRect(ctx, 0, 0, 7, 5, 0.4, '#c0262c');
    ctx.fillStyle = '#e8e8e8';
    for (const y of [1, 2.4, 3.8]) ctx.fillRect(1, y, 5, 0.4);
  });
  // A street cabinet: a phone or power company's dark green steel box, its doors.
  canvasTexture(scene, TEX.prop('cabinet'), 10, 6, (ctx) => {
    roundRect(ctx, 0.8, 0.8, 9.2, 5.2, 0.5, 'rgba(0,0,0,0.25)');
    roundRect(ctx, 0, 0, 9.2, 5.2, 0.5, '#2f4a3a');
    ctx.fillStyle = '#3d5d4a';
    ctx.fillRect(0.6, 0.6, 3.8, 4);
    ctx.fillRect(4.8, 0.6, 3.8, 4);
  });
  // A CCTV camera on its pole, from above: the pole's top, the camera on its arm.
  canvasTexture(scene, TEX.prop('cctv'), 6, 6, (ctx) => {
    circle(ctx, 2, 3, 1.4, '#5a5f66');
    roundRect(ctx, 2.4, 2.2, 3.4, 1.6, 0.4, '#e8e8e8');
    ctx.fillStyle = '#222';
    ctx.fillRect(5.2, 2.5, 0.6, 1);
  });
  // An electric car's charging post: a white post, its screen, a green light.
  canvasTexture(scene, TEX.prop('charger'), 5, 4, (ctx) => {
    roundRect(ctx, 0, 0, 5, 4, 0.6, '#eef0ee');
    ctx.fillStyle = '#26323a';
    ctx.fillRect(1, 1, 2.2, 2);
    circle(ctx, 4, 2, 0.5, '#2ecc71');
  });
  // A railway signal on its post, from above: the post, the signal's head (its light's drawn over it: see Workings).
  canvasTexture(scene, TEX.prop('railsignal'), 6, 6, (ctx) => {
    circle(ctx, 3, 3, 1.2, '#5a5f66');
    roundRect(ctx, 1.4, 1.6, 3.2, 2.8, 0.5, '#1d1d1d');
  });
  canvasTexture(scene, TEX.prop('keg'), 6, 6, (ctx) => {
    circle(ctx, 3.3, 3.3, 2.4, 'rgba(0,0,0,0.22)');
    circle(ctx, 2.9, 2.9, 2.4, '#a8adb2');
    circle(ctx, 2.9, 2.9, 1.8, '#c4c9cd');
    circle(ctx, 2.9, 2.9, 0.6, '#3a3d40');
  });
  // Round the works (see places.ts). A bulk bag of sand: the white bag, its lifting loops at the corners, the sand heaped in its top.
  canvasTexture(scene, TEX.prop('bags'), 9, 9, (ctx) => {
    shade(ctx, 8, 8);
    roundRect(ctx, 0, 0, 8, 8, 0.6, '#e8e6df');
    circle(ctx, 4, 4, 2.8, '#c9a86a');
    circle(ctx, 3.6, 3.6, 1.4, '#d8bc84');
    ctx.fillStyle = '#e8e6df';
    for (const [x, y] of [[0.4, 0.4], [6.6, 0.4], [0.4, 6.6], [6.6, 6.6]]) ctx.fillRect(x, y, 1, 1);
  });
  // A car crushed for scrap: flattened, its roof gone in, rust through the paint; in what colour it was.
  ['#7a2e2a', '#2f4f7a', '#5d6266', '#a8a49a'].forEach((paint, v) => {
    canvasTexture(scene, `${TEX.prop('crushed')}-${v}`, 32, 15, (ctx) => {
      shade(ctx, 31, 14);
      roundRect(ctx, 0, 0, 31, 14, 1, shadeOf(paint, -0.15));
      const rand = seeded(17 + v);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = i % 3 ? paint : '#6b4a2e';
        ctx.fillRect(rand() * 28, rand() * 12, 2 + rand() * 4, 1 + rand() * 2);
      }
      ctx.fillStyle = 'rgba(20,24,28,0.55)';
      ctx.fillRect(10, 3, 9, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 3; x < 30; x += 5) ctx.fillRect(x, 0, 0.6, 14);
    });
  });
  // A battery storage unit: a white steel box, its vents along both sides, the warning sign.
  canvasTexture(scene, TEX.prop('battery'), 49, 20, (ctx) => {
    shade(ctx, 48, 19.4);
    roundRect(ctx, 0, 0, 48, 19.4, 0.5, '#dfe3e2');
    ctx.fillStyle = '#a9b0b1';
    for (let x = 3; x < 45; x += 3) {
      ctx.fillRect(x, 1, 1.6, 2.4);
      ctx.fillRect(x, 16, 1.6, 2.4);
    }
    roundRect(ctx, 4, 6, 40, 7.4, 0.4, '#cfd5d4');
    ctx.fillStyle = '#2a8a4a';
    ctx.fillRect(4, 8.8, 40, 1.4);
    ctx.fillStyle = '#f2c500';
    ctx.beginPath();
    ctx.moveTo(43, 6.6);
    ctx.lineTo(45.8, 12);
    ctx.lineTo(40.2, 12);
    ctx.closePath();
    ctx.fill();
  });
  // A pumping station's pipework: two blue pipes, their flanges, a valve's red wheel on each.
  canvasTexture(scene, TEX.prop('valve'), 19, 9, (ctx) => {
    shade(ctx, 18, 8);
    for (const y of [1, 5]) {
      roundRect(ctx, 0, y, 18, 2.6, 1.2, '#2f5f9a');
      ctx.fillStyle = '#244a78';
      for (const x of [2, 9, 16]) ctx.fillRect(x - 0.5, y - 0.4, 1, 3.4);
    }
    for (const [x, y] of [[5.5, 2.3], [12.5, 6.3]]) {
      ctx.strokeStyle = '#c8302a';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 1.6, y);
      ctx.lineTo(x + 1.6, y);
      ctx.moveTo(x, y - 1.6);
      ctx.lineTo(x, y + 1.6);
      ctx.stroke();
    }
  });
  // A heap of aggregate (gravel or sand), from above: darker round its foot, its stones, a lighter top.
  ['#8f8a80', '#c2a46a'].forEach((stone, v) => {
    canvasTexture(scene, `${TEX.prop('heap')}-${v}`, 46, 46, (ctx) => {
      circle(ctx, 24, 24.5, 21.5, 'rgba(0,0,0,0.25)');
      circle(ctx, 23, 23, 21.5, shadeOf(stone, -0.2));
      circle(ctx, 22, 22, 15, stone);
      circle(ctx, 20.5, 20.5, 7, shadeOf(stone, 0.15));
      const rand = seeded(23 + v);
      for (let i = 0; i < 160; i++) {
        const [a, r] = [rand() * Math.PI * 2, Math.sqrt(rand()) * 20];
        ctx.fillStyle = rand() < 0.5 ? shadeOf(stone, -0.3) : shadeOf(stone, 0.25);
        ctx.fillRect(23 + Math.cos(a) * r, 23 + Math.sin(a) * r, 0.7, 0.7);
      }
    });
  });
  // An electricity pylon's foot: its four legs on their concrete pads, the bracing between them (the rest of it's drawn rising: see
  // Workings.ts).
  canvasTexture(scene, TEX.prop('pylon'), 54, 54, (ctx) => {
    const [a, b] = [5, 49];
    ctx.strokeStyle = 'rgba(70,74,78,0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(a, a);
    ctx.lineTo(b, b);
    ctx.moveTo(b, a);
    ctx.lineTo(a, b);
    ctx.rect(a, a, b - a, b - a);
    ctx.stroke();
    for (const [x, y] of [[a, a], [b, a], [a, b], [b, b]]) {
      roundRect(ctx, x - 3.5, y - 3.5, 7, 7, 0.5, '#a9a59b');
      roundRect(ctx, x - 1.6, y - 1.6, 3.2, 3.2, 0.3, '#5e6266');
    }
  });
  // Headstones, from above: their tops (rounded, square, a cross), a little lichen; weathered grey, a pale one, a dark one.
  ['#8f8d87', '#c9c4b8', '#4c4d50'].forEach((stone, v) => {
    canvasTexture(scene, `${TEX.prop('headstone')}-${v}`, 4, 7, (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(1.2, 0.8, 2.6, 6);
      if (v === 2) {
        roundRect(ctx, 1, 2.6, 2, 1.6, 0.2, stone);
        roundRect(ctx, 1.6, 0.4, 0.8, 6, 0.2, stone);
      } else roundRect(ctx, 0.6, 0.4, 2.2, 6, v === 0 ? 1 : 0.2, stone);
      ctx.fillStyle = 'rgba(160,170,90,0.4)';
      ctx.fillRect(1, 4.4, 1, 1);
    });
  });
  // A chest tomb: a stone box, its lid's edge.
  canvasTexture(scene, TEX.prop('tomb'), 19, 9, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(1.2, 1.2, 18, 7.6);
    roundRect(ctx, 0, 0, 18, 7.6, 0.4, '#9a958b');
    ctx.strokeStyle = 'rgba(60,55,45,0.4)';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(1, 1, 16, 5.6);
    ctx.fillStyle = 'rgba(140,150,80,0.35)';
    ctx.fillRect(3, 2, 4, 2);
  });
  // A big communal bin (1,100 litres): grey, green or blue, its lid's two halves.
  ['#6d7276', '#2f6b34', '#2d5c9a'].forEach((colour, v) => {
    canvasTexture(scene, `${TEX.prop('bigbin')}-${v}`, 12, 11, (ctx) => {
      shade(ctx, 11, 10);
      roundRect(ctx, 0, 0, 11, 10, 0.6, colour);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0.6, 0.6, 4.6, 8.8);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(5.3, 0, 0.4, 10);
    });
  });
  // A forklift: yellow, its cab's roof, the counterweight behind, the forks out in front.
  canvasTexture(scene, TEX.prop('forklift'), 23, 11, (ctx) => {
    shade(ctx, 16, 10);
    ctx.fillStyle = '#9ea2a6';
    ctx.fillRect(15, 2.4, 7.6, 1.2);
    ctx.fillRect(15, 6.4, 7.6, 1.2);
    roundRect(ctx, 0, 0.6, 15, 8.8, 1.2, '#e8b81c');
    roundRect(ctx, 0, 1.4, 4, 7.2, 1, '#3a3d40');
    roundRect(ctx, 5, 1.6, 7, 6.8, 0.6, '#2a2c2e');
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(5.6, 2.2, 5.8, 1);
  });
  // A shipping container: its ribbed roof, in one of the shipping lines' colours.
  ['#a8442e', '#2f5e94', '#2f7a4a', '#c08a2a'].forEach((colour, v) => {
    canvasTexture(scene, `${TEX.prop('container')}-${v}`, 49, 20, (ctx) => {
      shade(ctx, 48, 19.4);
      roundRect(ctx, 0, 0, 48, 19.4, 0.4, colour);
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let x = 2; x < 47; x += 2.4) ctx.fillRect(x, 0.6, 0.8, 18.2);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, 0, 48, 1.2);
    });
  });
  // On the pitches and courts (see sports.ts), from above. A goal: its white posts and crossbar along the top edge, its net back
  // from them (a full-size one 7.3 m across, a small one, a hockey goal with its boards); stood up, so a shadow.
  const goal = (key: string, w: number, d: number, boards: boolean) =>
    canvasTexture(scene, key, w + 2, d + 2, (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(2, 2.4, w - 1, d - 1);
      ctx.strokeStyle = 'rgba(235,235,230,0.55)';
      ctx.lineWidth = 0.25;
      for (let x = 1.5; x < w; x += 1.6) {
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x, d);
        ctx.stroke();
      }
      for (let y = 2.5; y < d; y += 1.6) {
        ctx.beginPath();
        ctx.moveTo(1, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = '#f4f4f0';
      ctx.lineWidth = 0.9;
      ctx.strokeRect(1, 1, w - 1, d - 1);
      if (boards) {
        ctx.fillStyle = '#1f2a3a';
        ctx.fillRect(1, d - 0.8, w - 1, 1);
      }
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0.6, 1);
      ctx.lineTo(w + 0.4, 1);
      ctx.stroke();
    });
  goal(TEX.prop('goal'), 59, 16, false);
  goal(TEX.prop('goalsmall'), 30, 11, false);
  goal(TEX.prop('hockeygoal'), 29, 9, true);
  // Rugby posts: the crossbar between the two tall posts (padded at their feet), their long shadow.
  canvasTexture(scene, TEX.prop('rugbypost'), 48, 8, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(3, 4.5, 44, 1.6);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(1, 3.4, 46, 0.9);
    for (const x of [2.5, 45.5]) {
      circle(ctx, x, 3.8, 1.9, '#c8323a');
      circle(ctx, x, 3.8, 0.8, '#f4f4f0');
    }
  });
  // A basketball hoop: its post (at the end), the arm out to the board, the white board and the orange ring, its net.
  canvasTexture(scene, TEX.prop('hoop'), 16, 10, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(2.5, 4.4, 9, 2);
    circle(ctx, 2, 5, 1.3, '#4a4f55');
    ctx.fillStyle = '#5c6268';
    ctx.fillRect(2.5, 4.4, 5.5, 1.2);
    roundRect(ctx, 8, 1, 1.2, 8, 0.2, '#f2f2ee');
    ctx.strokeStyle = '#e26a1f';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(11.6, 5, 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.arc(11.6, 5, 1.2, 0, Math.PI * 2);
    ctx.stroke();
  });
  // A netball post: the pole, its ring (no board).
  canvasTexture(scene, TEX.prop('netpost'), 6, 6, (ctx) => {
    circle(ctx, 3.4, 3.4, 1, 'rgba(0,0,0,0.25)');
    ctx.strokeStyle = '#c9ccd0';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(3, 3, 1.9, 0, Math.PI * 2);
    ctx.stroke();
    circle(ctx, 3, 3, 0.6, '#6c7176');
  });
  // Cricket stumps: three, side by side, the bails across them.
  canvasTexture(scene, TEX.prop('stumps'), 4, 3, (ctx) => {
    ctx.fillStyle = '#e8d9b0';
    ctx.fillRect(0.5, 1.1, 3, 0.5);
    for (const x of [0.7, 2, 3.3]) circle(ctx, x, 1.35, 0.35, '#d8c290');
  });
  // A croquet hoop, white; the peg in the middle, its coloured bands.
  canvasTexture(scene, TEX.prop('wicket'), 3, 2, (ctx) => {
    ctx.strokeStyle = '#f4f4f0';
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(0.4, 1);
    ctx.lineTo(2.6, 1);
    ctx.stroke();
  });
  canvasTexture(scene, TEX.prop('peg'), 2, 2, (ctx) => {
    circle(ctx, 1, 1, 0.8, '#f4f4f0');
    circle(ctx, 1, 1, 0.45, '#2d58b8');
  });
  // A table-tennis table, concrete, in the park: its green-painted top, the white lines, the steel net across the middle.
  canvasTexture(scene, TEX.prop('pingpong'), 24, 14, (ctx) => {
    shade(ctx, 22.4, 12.6);
    roundRect(ctx, 0, 0, 22, 12.2, 0.4, '#3d6f55');
    ctx.strokeStyle = 'rgba(245,245,240,0.85)';
    ctx.lineWidth = 0.35;
    ctx.strokeRect(0.4, 0.4, 21.2, 11.4);
    ctx.beginPath();
    ctx.moveTo(0.4, 6.1);
    ctx.lineTo(21.6, 6.1);
    ctx.stroke();
    ctx.fillStyle = '#5a6066';
    ctx.fillRect(10.6, -0.2, 0.8, 12.6);
  });
  // A tower crane's foot: its concrete base, the mast's corner legs.
  canvasTexture(scene, `${TEX.prop('crane')}-tower`, 32, 32, (ctx) => {
    roundRect(ctx, 4, 4, 24, 24, 1, '#9e9a91');
    roundRect(ctx, 11, 11, 10, 10, 0.5, '#d9a41a');
    ctx.strokeStyle = '#8f6d0d';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(11, 11);
    ctx.lineTo(21, 21);
    ctx.moveTo(21, 11);
    ctx.lineTo(11, 21);
    ctx.stroke();
  });
  // Its jib (along x from the mast at a fifth of the way along) and counter-jib behind, its counterweight; the hook's trolley out along it.
  canvasTexture(scene, TEX.towerJib, 80, 8, (ctx) => {
    ctx.strokeStyle = '#d9a41a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(80, 3);
    ctx.moveTo(0, 6);
    ctx.lineTo(80, 5);
    ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 0; x < 78; x += 3) {
      ctx.moveTo(x, 2 + x / 80);
      ctx.lineTo(x + 3, 6 - (x + 3) / 80);
    }
    ctx.stroke();
    roundRect(ctx, 0, 1, 6, 6, 0.5, '#7c7a74');
    roundRect(ctx, 14, 1.5, 4, 5, 0.6, '#2f3a40');
    roundRect(ctx, 52, 2.6, 3, 2.8, 0.4, '#3a3e43');
  });
  canvasTexture(scene, TEX.mast, 64, 4, (ctx) => {
    ctx.strokeStyle = '#d9a41a';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(64, 0.5);
    ctx.moveTo(0, 3.5);
    ctx.lineTo(64, 3.5);
    for (let x = 0; x < 64; x += 3) {
      ctx.moveTo(x, 0.5);
      ctx.lineTo(x + 3, 3.5);
    }
    ctx.stroke();
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
  // A pay-and-display machine on its side, a clock's face, a life ring's post and the ring, bits of a grit bin, and a car park barrier's arm.
  canvasTexture(scene, TEX.debris('meter'), 8, 6, (ctx) => {
    roundRect(ctx, 0, 0, 8, 6, 1, '#5d636a');
    roundRect(ctx, 5, 1, 2.4, 4, 0.4, '#2a4b66');
  });
  canvasTexture(scene, TEX.debris('pump'), 12, 8, (ctx) => {
    roundRect(ctx, 0, 0.5, 12, 7, 1, '#d6d6d2');
    ctx.fillStyle = '#c62828';
    ctx.fillRect(4.5, 0.5, 2.4, 7);
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(9, 1.8, 2.2, 4.4);
  });
  canvasTexture(scene, TEX.debris('clockface'), 6, 6, (ctx) => {
    circle(ctx, 3, 3, 2.9, '#1f2a24');
    circle(ctx, 3, 3, 2.1, '#d9d4c2');
  });
  canvasTexture(scene, TEX.debris('post'), 12, 3, (ctx) => roundRect(ctx, 0, 0.3, 12, 2.4, 0.6, '#3b2a1c'));
  canvasTexture(scene, TEX.debris('ring'), 5, 5, (ctx) => {
    circle(ctx, 2.5, 2.5, 2.4, '#e8601c');
    ctx.globalCompositeOperation = 'destination-out';
    circle(ctx, 2.5, 2.5, 1.1, '#000');
    ctx.globalCompositeOperation = 'source-over';
  });
  canvasTexture(scene, TEX.debris('plastic'), 3, 2, (ctx) => {
    ctx.fillStyle = '#f2c21a';
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(1.2, 0);
    ctx.lineTo(3, 1.4);
    ctx.closePath();
    ctx.fill();
  });
  canvasTexture(scene, TEX.debris('arm'), 20, 2, (ctx) => {
    roundRect(ctx, 0, 0, 20, 2, 0.8, '#eeeeee');
    ctx.fillStyle = '#d8312a';
    for (let x = 2; x < 20; x += 5) ctx.fillRect(x, 0, 2.5, 2);
  });
  // A log off a fallen trunk, half of one, and a splinter.
  canvasTexture(scene, TEX.debris('log'), 22, 7, (ctx) => {
    roundRect(ctx, 0, 0.5, 22, 6, 2.5, '#5a3d24');
    ctx.fillStyle = '#76532f';
    ctx.fillRect(2, 1.8, 18, 1.4);
    circle(ctx, 1.4, 3.5, 2.2, '#c79a62');
    circle(ctx, 20.6, 3.5, 2.2, '#c79a62');
  });
  canvasTexture(scene, TEX.debris('billet'), 10, 6, (ctx) => {
    roundRect(ctx, 0, 0.5, 10, 5, 2, '#5a3d24');
    circle(ctx, 1.4, 3, 1.9, '#c79a62');
    ctx.fillStyle = '#d8b07a';
    ctx.fillRect(8, 1, 2, 4);
  });
  canvasTexture(scene, TEX.debris('splinter'), 6, 1.6, (ctx) => roundRect(ctx, 0, 0, 6, 1.6, 0.6, '#b98a55'));
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
  // Off a car: a bumper (dark plastic), a wing mirror, a hubcap, a bit of a light's red lens.
  canvasTexture(scene, TEX.debris('bumper'), 16, 3.2, (ctx) => {
    roundRect(ctx, 0, 0.2, 16, 2.8, 1.2, '#262729');
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(1, 0.6, 14, 0.5);
  });
  canvasTexture(scene, TEX.debris('mirror'), 3, 2.4, (ctx) => {
    roundRect(ctx, 0, 0, 3, 2.4, 0.8, '#2a2c2e');
    ctx.fillStyle = 'rgba(180,210,230,0.8)';
    ctx.fillRect(0.6, 0.5, 1.6, 1.2);
  });
  canvasTexture(scene, TEX.debris('hubcap'), 4.4, 4.4, (ctx) => {
    circle(ctx, 2.2, 2.2, 2.1, '#9da2a6');
    circle(ctx, 2.2, 2.2, 1.5, '#c9cdd0');
    circle(ctx, 2.2, 2.2, 0.5, '#7d8286');
  });
  canvasTexture(scene, TEX.debris('lens'), 2.4, 2, (ctx) => {
    ctx.fillStyle = 'rgba(214,52,44,0.9)';
    ctx.beginPath();
    ctx.moveTo(0.1, 1.8);
    ctx.lineTo(1.2, 0.1);
    ctx.lineTo(2.3, 1.5);
    ctx.closePath();
    ctx.fill();
  });
  // A bike lying on its side: both wheels, its frame, the bars and saddle.
  // A statue's bronze figure, lying on its side: its head, its body, an arm out.
  canvasTexture(scene, TEX.debris('figure'), 16, 7, (ctx) => {
    ctx.fillStyle = '#3f4a3c';
    ctx.beginPath();
    ctx.ellipse(8.5, 3.5, 5.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, 2.4, 3.4, 1.9, '#3f4a3c');
    ctx.strokeStyle = '#3f4a3c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(6, 2);
    ctx.lineTo(9, 0.6);
    ctx.moveTo(13, 3);
    ctx.lineTo(15.5, 2.4);
    ctx.moveTo(13, 4.4);
    ctx.lineTo(15.5, 5.2);
    ctx.stroke();
    ctx.fillStyle = '#5b6b55';
    ctx.beginPath();
    ctx.ellipse(8, 2.6, 3.5, 1, 0, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, 2, 2.8, 0.7, '#7f9077');
  });
  canvasTexture(scene, TEX.debris('bike'), 16, 7, (ctx) => {
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = '#161616';
    for (const x of [3.3, 12.7]) {
      ctx.beginPath();
      ctx.arc(x, 3.6, 2.9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#22508f';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(3.3, 3.6);
    ctx.lineTo(7, 3.8);
    ctx.lineTo(11.4, 1.6);
    ctx.lineTo(6.4, 1.4);
    ctx.lineTo(7, 3.8);
    ctx.moveTo(11.4, 1.6);
    ctx.lineTo(12.7, 3.6);
    ctx.stroke();
    ctx.fillStyle = '#1d1e22';
    ctx.fillRect(5.4, 0.4, 2.2, 0.8);
    ctx.fillRect(10.8, 0.2, 1.6, 0.9);
  });
  // A rack's stands with bikes locked to them: none to four (see `racked`), upright, either side of the stands.
  for (let n = 0; n <= 4; n++) {
    canvasTexture(scene, `${TEX.prop('bikes')}-${n}`, 16, 18, (ctx) => {
      const frames = ['#1d1e22', '#b21f24', '#22508f', '#b8bcc1', '#2f5d3a', '#e8e9eb'];
      const slots = [2, 9.6, 4.6, 14, 7, 11.6];
      for (let k = 0; k < n; k++) {
        const x = slots[k];
        const flip = k % 2 ? 1 : -1;
        ctx.fillStyle = '#141414';
        ctx.fillRect(x - 0.4, 1, 0.8, 4.2);
        ctx.fillRect(x - 0.4, 12.8, 0.8, 4.2);
        ctx.fillStyle = frames[(k * 3 + n) % frames.length];
        ctx.fillRect(x - 0.35, 4, 0.7, 10);
        // Bars at one end, saddle nearer the other.
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(x - 2, flip > 0 ? 13 : 4.2, 4, 0.7);
        ctx.fillRect(x - 0.6, flip > 0 ? 6 : 11.2, 1.2, 1.6);
      }
      // The stands: hoops of steel, seen from above.
      ctx.fillStyle = '#7a7f86';
      for (const x of [3.3, 8, 12.7]) ctx.fillRect(x - 0.5, 6, 1, 6);
    });
  }
  // A shard of broken glass, catching the light.
  canvasTexture(scene, TEX.debris('glass'), 3, 3, (ctx) => {
    ctx.fillStyle = 'rgba(200, 228, 240, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0.2, 2.6);
    ctx.lineTo(1.6, 0.2);
    ctx.lineTo(2.8, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1.3, 0.9, 0.6, 0.6);
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
  // A pole on its way down (one 16 px long, stretched to each).
  canvasTexture(scene, TEX.pole, 16, 2, (ctx) => roundRect(ctx, 0, 0, 16, 2, 1, '#3d4248'));
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
  // A standing tree's trunk seen from above, where it goes up into the crown: bark, darker round its edge.
  canvasTexture(scene, TEX.bole, 10, 10, (ctx) => {
    circle(ctx, 5, 5, 4.6, '#3e2a19');
    circle(ctx, 5, 5, 3.6, '#5a3d24');
    circle(ctx, 4.2, 4.2, 1.6, 'rgba(140,105,70,0.45)');
  });
  canvasTexture(scene, TEX.trunk, 64, 8, (ctx) => {
    roundRect(ctx, 0, 0.5, 64, 7, 3, '#5a3d24');
    ctx.fillStyle = '#76532f';
    ctx.fillRect(2, 2, 60, 1.6);
    ctx.fillStyle = '#c79a62';
    ctx.fillRect(0, 1.5, 1.5, 5);
  });

  // A pay-and-display machine: a grey box with its little screen.
  canvasTexture(scene, TEX.prop('meter'), 6, 5, (ctx) => {
    roundRect(ctx, 0, 0, 6, 5, 1, '#5d636a');
    roundRect(ctx, 0.8, 0.8, 4.4, 2, 0.4, '#3a8fd0');
    ctx.fillStyle = '#d8dde2';
    ctx.fillRect(1.2, 3.4, 3.6, 0.8);
  });
  // A petrol pump from above: its white cabinet, a red band along its top, the hoses hanging either side.
  canvasTexture(scene, TEX.prop('pump'), 8, 12, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 7, 11, 1, '#e8e8e4');
    ctx.fillStyle = '#c62828';
    ctx.fillRect(0.5, 4.8, 7, 2.4);
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(1.5, 1.5, 5, 2.4);
    ctx.fillRect(1.5, 8.1, 5, 2.4);
  });
  // A street clock on its pole: the face from above, on its dark case.
  canvasTexture(scene, TEX.prop('clock'), 10, 10, (ctx) => {
    circle(ctx, 5, 5, 4.6, '#1f2a24');
    circle(ctx, 5, 5, 3.6, '#f2eedf');
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(5, 5);
    ctx.lineTo(5, 2.4);
    ctx.moveTo(5, 5);
    ctx.lineTo(6.8, 5.6);
    ctx.stroke();
  });
  // A life ring, orange and white, on its post.
  canvasTexture(scene, TEX.prop('lifering'), 8, 8, (ctx) => {
    circle(ctx, 4, 4, 3.6, '#e8601c');
    circle(ctx, 4, 4, 2, '#3b2a1c');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3.4, 0.4, 1.2, 1.6);
    ctx.fillRect(3.4, 6, 1.2, 1.6);
  });
  // A statue on its plinth: the stone plinth, and the bronze figure, lit from the top left.
  canvasTexture(scene, TEX.prop('statue'), 22, 22, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 21, 21, 1.5, '#9c9488');
    roundRect(ctx, 2.5, 2.5, 17, 17, 1, '#bdb4a2');
    circle(ctx, 11, 11, 5.5, '#3f4a3c');
    circle(ctx, 9.8, 9.6, 3.2, '#5b6b55');
    circle(ctx, 9, 8.8, 1.2, '#7f9077');
  });
  // Its plinth, the figure knocked off it: the stumps of its feet, the stone cracked and a corner broken away.
  canvasTexture(scene, `${TEX.prop('statue')}-broken`, 22, 22, (ctx) => {
    roundRect(ctx, 0.5, 0.5, 21, 21, 1.5, '#9c9488');
    roundRect(ctx, 2.5, 2.5, 17, 17, 1, '#bdb4a2');
    ctx.fillStyle = '#8c8478';
    ctx.beginPath();
    ctx.moveTo(15, 21.5);
    ctx.lineTo(21.5, 21.5);
    ctx.lineTo(21.5, 14.5);
    ctx.lineTo(18.5, 16);
    ctx.lineTo(16.5, 19);
    ctx.closePath();
    ctx.fill();
    circle(ctx, 9.4, 11, 1.6, '#3f4a3c');
    circle(ctx, 12.6, 11.4, 1.6, '#3f4a3c');
    circle(ctx, 9.1, 10.6, 0.6, '#7f9077');
    ctx.strokeStyle = '#6e675c';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(4, 6);
    ctx.lineTo(7.5, 8.5);
    ctx.lineTo(9, 13);
    ctx.lineTo(7, 17.5);
    ctx.moveTo(13, 12.5);
    ctx.lineTo(16, 15);
    ctx.lineTo(16.5, 18.5);
    ctx.stroke();
  });
  // A concrete block, and a stone planter with its shrubs.
  canvasTexture(scene, TEX.prop('block'), 10, 10, (ctx) => {
    roundRect(ctx, 0, 0, 10, 10, 1, '#8e8b84');
    roundRect(ctx, 1, 1, 8, 8, 0.8, '#b4b0a7');
  });
  canvasTexture(scene, TEX.prop('planter'), 12, 12, (ctx) => {
    roundRect(ctx, 0, 0, 12, 12, 1.2, '#8a8174');
    roundRect(ctx, 1.4, 1.4, 9.2, 9.2, 1, '#4a3a2a');
    for (const [x, y, r] of [[4, 4, 2.4], [8, 5, 2.2], [5.5, 8, 2.4], [8.4, 8.6, 1.6]]) circle(ctx, x, y, r, '#3f7a2e');
    circle(ctx, 3.6, 3.4, 1, '#5f9a45');
  });
  // A yellow grit bin.
  canvasTexture(scene, TEX.prop('gritbin'), 8, 7, (ctx) => {
    roundRect(ctx, 0, 0, 8, 7, 1.2, '#c99a10');
    roundRect(ctx, 0.6, 0.6, 6.8, 4, 1, '#f2c21a');
    ctx.fillStyle = '#8a6a0a';
    ctx.fillRect(0.6, 4.8, 6.8, 0.6);
  });
  // A picnic table, with its benches either side.
  canvasTexture(scene, TEX.prop('picnic'), 14, 12, (ctx) => {
    roundRect(ctx, 0.5, 0, 13, 2.6, 0.6, '#5a3a22');
    roundRect(ctx, 0.5, 9.4, 13, 2.6, 0.6, '#5a3a22');
    roundRect(ctx, 0, 3.4, 14, 5.2, 0.8, '#6b4527');
    ctx.fillStyle = '#8f6038';
    for (const y of [3.9, 5.5, 7.1]) ctx.fillRect(0.5, y, 13, 1);
  });
  // A harbour crane from above: its cab on its bogies, the machinery house's roof, and where the jib's pinned.
  canvasTexture(scene, TEX.prop('crane'), 32, 32, (ctx) => {
    roundRect(ctx, 1, 3, 30, 26, 2, '#2c2f33');
    ctx.fillStyle = '#4a4e53';
    for (const y of [4, 25]) ctx.fillRect(2, y, 28, 3);
    roundRect(ctx, 6, 7, 20, 18, 1.5, '#7d2f26');
    roundRect(ctx, 7.5, 8.5, 17, 7, 1, '#9b3d31');
    circle(ctx, 16, 16, 3, '#1d1f22');
  });
  // A crane's jib: a lattice girder, drawn along x from where it's pinned (one 64 px long, stretched to each).
  canvasTexture(scene, TEX.jib, 64, 8, (ctx) => {
    ctx.strokeStyle = '#3a3e43';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(64, 3);
    ctx.moveTo(0, 7);
    ctx.lineTo(64, 5);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let x = 0; x < 62; x += 4) {
      ctx.moveTo(x, 1 + x / 32);
      ctx.lineTo(x + 4, 7 - (x + 4) / 32);
    }
    ctx.stroke();
    // The hook block hanging at its head.
    roundRect(ctx, 60, 2.5, 4, 3, 0.6, '#c9a227');
  });
  // A ladder down the quay wall into the water: its two rails and rungs, drawn along x from the top.
  canvasTexture(scene, TEX.prop('ladder'), 12, 4, (ctx) => {
    ctx.fillStyle = '#3b3f44';
    ctx.fillRect(0, 0.4, 12, 0.8);
    ctx.fillRect(0, 2.8, 12, 0.8);
    for (let x = 1; x < 12; x += 2) ctx.fillRect(x, 0.4, 0.6, 3.2);
  });
  // A mooring bollard: a squat cast-iron post, its rounded top catching the light.
  canvasTexture(scene, TEX.prop('mooring'), 7, 7, (ctx) => {
    circle(ctx, 3.5, 3.5, 3.2, '#16181a');
    circle(ctx, 3.5, 3.5, 2.3, '#2d3134');
    circle(ctx, 2.8, 2.8, 0.9, '#5a6066');
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
