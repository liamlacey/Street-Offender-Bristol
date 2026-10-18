/**
 * The art for downtown, drawn in code like the rest: the pavement's paving
 * slabs (a texture of its own), and on the scenery texture (decorationArt.ts
 * packs them) the city's rooftops, street furniture, traffic, people and the
 * little things that animate.
 */

import type * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type FrameSpec, circle, rect } from '../scenes/artKit';

export const DOWNTOWN_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => DOWNTOWN_FRAMES.push({ name, w, h, draw });

// A steel bollard seen from above, along the back of the pavement.
frame('bollard', 18, 18, (ctx) => {
  circle(ctx, 9, 9, 8.5, '#1d1f22');
  circle(ctx, 9, 9, 6.5, '#3a3d42');
  circle(ctx, 7.5, 7.5, 2.5, 'rgba(255,255,255,0.25)');
});

// A road works barrel: orange with white reflective bands.
frame('barrel', 30, 30, (ctx) => {
  circle(ctx, 15, 15, 14.5, '#2b2b2b');
  circle(ctx, 15, 15, 13, '#f26b1d');
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 2.5;
  for (const r of [9.5, 5]) {
    ctx.beginPath();
    ctx.arc(15, 15, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  circle(ctx, 15, 15, 2.5, '#2b2b2b');
});

// Fountains: a round basin of water, in stone or granite.
for (let v = 0; v < 2; v++) {
  frame(`fountain-${v}`, 64, 64, (ctx) => {
    circle(ctx, 32, 32, 31, v === 0 ? '#c9c4b8' : '#8f949b');
    circle(ctx, 32, 32, 26, '#3f7fa8');
    circle(ctx, 32, 32, 22, '#5596bf');
    circle(ctx, 32, 32, 8, v === 0 ? '#c9c4b8' : '#8f949b');
  });
}
// Water thrown up from the middle, three frames.
for (let f = 0; f < 3; f++) {
  frame(`spray-${f}`, 40, 40, (ctx) => {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + f * 0.7;
      const r = 6 + ((k * 7 + f * 5) % 11);
      circle(ctx, 20 + Math.cos(a) * r, 20 + Math.sin(a) * r, 1.6, 'rgba(225,240,255,0.85)');
    }
    circle(ctx, 20, 20, 4, 'rgba(235,245,255,0.9)');
  });
}

// A park bench, its back along the bottom.
frame('bench', 30, 10, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h - 3, '#8a6a45');
  rect(ctx, 0, h - 3, w, 3, '#3d4148');
  for (let x = 0; x < w; x += 6) rect(ctx, x, 0, 1, h - 3, 'rgba(0,0,0,0.2)');
});

// A tower crane: the lattice mast, the jib (the pivot 60 px from its counterweight end), and its load.
export const JIB = { w: 300, h: 14, pivot: 60 };
frame('crane-mast', 26, 26, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#e0a100');
  ctx.strokeStyle = '#8a6400';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.moveTo(w, 0);
  ctx.lineTo(0, h);
  ctx.stroke();
  ctx.strokeRect(1, 1, w - 2, h - 2);
});
frame('crane-jib', JIB.w, JIB.h, (ctx, w, h) => {
  rect(ctx, 0, 2, 36, h - 4, '#6b6f76'); // counterweight
  rect(ctx, 36, h / 2 - 4, w - 36, 8, '#e0a100');
  ctx.strokeStyle = '#8a6400';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < w - 4; x += 10) {
    ctx.moveTo(x, h / 2 - 4);
    ctx.lineTo(x + 5, h / 2 + 4);
    ctx.lineTo(x + 10, h / 2 - 4);
  }
  ctx.stroke();
  rect(ctx, JIB.pivot - 9, 0, 18, h, '#2b2d42'); // cab
  rect(ctx, JIB.pivot - 6, 2, 8, 5, '#9fd3ff');
});
frame('crane-load', 40, 14, (ctx, w, h) => {
  // A bundle of steel beams.
  for (let y = 1; y < h; y += 4) rect(ctx, 0, y, w, 3, y % 8 === 1 ? '#7b8089' : '#5f646c');
});

// An excavator facing right: tracks, the turning body and cab, and its arm with the bucket.
frame('digger', 56, 30, (ctx, _w, h) => {
  rect(ctx, 4, 0, 40, 7, '#2b2b2b');
  rect(ctx, 4, h - 7, 40, 7, '#2b2b2b');
  rect(ctx, 6, 5, 34, h - 10, '#e0a100');
  rect(ctx, 6, 5, 10, h - 10, '#5f646c');
  rect(ctx, 24, 7, 12, 10, '#2b2d42');
  rect(ctx, 26, 8, 8, 4, '#9fd3ff');
  rect(ctx, 36, h / 2 - 2, 14, 4, '#c88f00');
  rect(ctx, 48, h / 2 - 6, 8, 12, '#3d4148');
});

/** Makes (once) and returns the key of a city's ground tile: paving slabs, a little uneven, with the odd stain. */
export function pavementTexture(scene: Phaser.Scene, location: Location): string {
  const key = `pavement-${location.id}`;
  if (scene.textures.exists(key)) return key;
  const { base, stripe, tuft } = location.ground;
  const g = scene.make.graphics({}, false);
  const T = 128;
  const slab = 32;
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle(tuft);
  g.fillRect(0, 0, T, T);
  for (let x = 0; x < T; x += slab) {
    for (let y = 0; y < T; y += slab) {
      g.fillStyle(rand() < 0.5 ? base : stripe);
      g.fillRect(x + 1, y + 1, slab - 2, slab - 2);
    }
  }
  // Stains and chewing gum.
  for (let k = 0; k < 10; k++) {
    g.fillStyle(0x000000, 0.05 + rand() * 0.05);
    g.fillCircle(6 + rand() * (T - 12), 6 + rand() * (T - 12), 2 + rand() * 5);
  }
  g.fillStyle(0x6f6c66, 0.5);
  for (let k = 0; k < 12; k++) g.fillCircle(3 + rand() * (T - 6), 3 + rand() * (T - 6), 1.2);
  g.generateTexture(key, T, T);
  g.destroy();
  return key;
}

// Street furniture by the kerb: a fire hydrant, a bin, a newspaper box.
frame('hydrant', 14, 14, (ctx) => {
  circle(ctx, 7, 7, 6.5, '#7a1410');
  circle(ctx, 7, 7, 5.5, '#c8231b');
  rect(ctx, 0, 5.5, 14, 3, '#c8231b');
  circle(ctx, 7, 7, 2.5, '#e8d44a');
});
frame('bin', 16, 16, (ctx) => {
  circle(ctx, 8, 8, 7.5, '#1d2a22');
  circle(ctx, 8, 8, 6, '#2f4a3a');
  circle(ctx, 8, 8, 3, '#1d2a22');
});
frame('newsbox', 16, 16, (ctx) => {
  rect(ctx, 0, 0, 16, 16, '#123a6b');
  rect(ctx, 1.5, 1.5, 13, 13, '#1f5f99');
  rect(ctx, 3, 3, 10, 5, '#d8dee4');
});
// A drop of water, for a knocked-over hydrant's fountain.
frame('drop', 5, 5, (ctx) => circle(ctx, 2.5, 2.5, 2.3, 'rgba(200,230,255,0.95)'));

// Someone knocked flat, lying on their back, arms and legs out (head at the right).
const SHIRTS = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#8338ec', '#fb5607', '#1d3557'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
export const PEOPLE = SHIRTS.length;
SHIRTS.forEach((shirt, v) => {
  frame(`down-${v}`, 24, 18, (ctx) => {
    const skin = SKIN[v % SKIN.length];
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(8, 9);
    ctx.lineTo(2, 3);
    ctx.moveTo(8, 9);
    ctx.lineTo(2, 15);
    ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.beginPath();
    ctx.moveTo(15, 9);
    ctx.lineTo(18, 2);
    ctx.moveTo(15, 9);
    ctx.lineTo(18, 16);
    ctx.stroke();
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(12, 9, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, 20, 9, 3, skin);
  });
});

// Traffic lights: the pole, the arm out over the road (stretched to length), and the lights
// hanging from it, seen from above: whichever is lit glows.
frame('signal-pole', 16, 16, (ctx) => {
  circle(ctx, 8, 8, 7.5, '#1d1f22');
  circle(ctx, 8, 8, 5, '#3a3d42');
});
frame('signal-arm', 8, 6, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#2b2d31');
  rect(ctx, 0, 1, w, 1.5, '#4a4e55');
});
for (const [state, lit] of [['green', 2], ['amber', 1], ['red', 0]] as const) {
  frame(`signal-${state}`, 34, 16, (ctx, w, h) => {
    rect(ctx, 2, 3, w - 4, h - 6, '#1d1f22');
    const colors = ['#d7263d', '#f2a516', '#3ddc84'];
    for (let k = 0; k < 3; k++) {
      const x = 8 + k * 9;
      if (k === lit) {
        circle(ctx, x, h / 2, 6.5, 'rgba(255,255,255,0.25)');
        circle(ctx, x, h / 2, 4, '#ffffff');
        circle(ctx, x, h / 2, 3.5, colors[k]);
      } else circle(ctx, x, h / 2, 3, '#3a3d42');
    }
  });
}

// The city's traffic, facing right: a yellow cab, a city bus, and a police car with its lights going.
frame('taxi', 40, 20, (ctx, w, h) => {
  for (const [x, y] of [[6, 0], [w - 13, 0], [6, h - 3], [w - 13, h - 3]]) rect(ctx, x, y, 7, 3, '#111111');
  ctx.fillStyle = '#f2c230';
  ctx.beginPath();
  ctx.roundRect(1, 2, w - 2, h - 4, 4);
  ctx.fill();
  rect(ctx, w - 14, 4.5, 5, h - 9, '#9fd3ff');
  rect(ctx, 7, 5, 4, h - 10, '#6fa8d6');
  rect(ctx, 17, h / 2 - 3, 6, 6, '#f4f4f4');
  for (let x = 3; x < w - 3; x += 4) rect(ctx, x, h - 5, 2, 1.5, x % 8 === 3 ? '#111111' : '#f2c230');
});
frame('bus', 84, 24, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#1d3557');
  rect(ctx, 1.5, 1.5, w - 3, h - 3, '#2f6db3');
  rect(ctx, 1.5, 1.5, w - 3, 4, '#f4f4f4');
  rect(ctx, 1.5, h - 5.5, w - 3, 4, '#f4f4f4');
  rect(ctx, 20, 8, 22, 8, '#5f646c');
  rect(ctx, 50, 8, 14, 8, '#5f646c');
  rect(ctx, w - 6, 3, 4, h - 6, '#9fd3ff');
});
for (const f of [0, 1]) {
  frame(`police-${f}`, 42, 20, (ctx, w, h) => {
    for (const [x, y] of [[6, 0], [w - 13, 0], [6, h - 3], [w - 13, h - 3]]) rect(ctx, x, y, 7, 3, '#111111');
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.roundRect(1, 2, w - 2, h - 4, 4);
    ctx.fill();
    rect(ctx, 1, 2, 10, h - 4, '#111111');
    rect(ctx, w - 10, 2, 9, h - 4, '#111111');
    rect(ctx, w - 15, 4.5, 5, h - 9, '#9fd3ff');
    // The light bar: red one side and blue the other, swapping.
    rect(ctx, 19, 3.5, 4, h / 2 - 3.5, f === 0 ? '#ff2a3a' : '#3a2a6a');
    rect(ctx, 19, h / 2, 4, h / 2 - 3.5, f === 0 ? '#2a3a6a' : '#3a6aff');
  });
}
