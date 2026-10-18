/**
 * The art for winter, drawn in code like the rest: the snow on the ground (a
 * texture of its own), and on the scenery texture (decorationArt.ts packs
 * them) snow-laden conifers, chalets, snowbanks, snowmen and ice, falling
 * snowflakes, and the people out in it: skiers, snowboarders and skaters,
 * and the ski lifts. Things facing the track have their front along the top
 * edge; people and lifts face right.
 */

import type * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type FrameSpec, circle, ellipse, pick, rect, seeded } from '../scenes/artKit';

export const WINTER_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => WINTER_FRAMES.push({ name, w, h, draw });

export const WINTER_VARIANTS = { pine: 6, chalet: 2, bank: 3, rock: 3, people: 6, flake: 3 };

const SNOW = '#f7fafc';
const SNOW_SHADE = '#d6e2ea';
const SNOW_DEEP = '#b9cad6';

// Conifers under snow: layered stars of needles, the snow lying thickest on the upper layers.
const PINES = [
  ['#132a1c', '#1b3a26', '#264d31', '#36643f'],
  ['#162e24', '#20402f', '#2c543c', '#3d6b4b'],
];
for (let v = 0; v < WINTER_VARIANTS.pine; v++) {
  frame(`snowpine-${v}`, 128, 128, (ctx) => {
    const rand = seeded(v * 4447 + 31);
    const greens = PINES[v % 2];
    const heavy = v >= 3;
    const trees = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => {
      const a = rand() * Math.PI * 2;
      const r = rand() * 26;
      return { x: 64 + Math.cos(a) * r, y: 64 + Math.sin(a) * r, r: 24 + rand() * 12, turn: rand() };
    });
    greens.forEach((color, layer) => {
      for (const t of trees) {
        const spikes = 11;
        const outer = t.r * (1 - layer * 0.24);
        const star = (fill: string, scale: number, dx: number) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          for (let k = 0; k < spikes * 2; k++) {
            const a = (k / (spikes * 2)) * Math.PI * 2 + t.turn + layer * 0.3;
            const r = (k % 2 === 0 ? outer : outer * 0.62) * scale;
            const x = t.x - layer * 1.5 + dx + Math.cos(a) * r;
            const y = t.y - layer * 1.5 + dx + Math.sin(a) * r;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        };
        star(color, 1, 0);
        // Snow lying on the branches, towards the light.
        if (layer >= 1) star(layer === 3 || heavy ? SNOW : SNOW_SHADE, heavy ? 0.72 : 0.5, -2);
      }
    });
    for (const t of trees) circle(ctx, t.x - 6, t.y - 6, 3, SNOW);
  });
}

// Chalets: a snow-covered roof either side of the ridge, wooden eaves, and a stone chimney.
for (let v = 0; v < WINTER_VARIANTS.chalet; v++) {
  frame(`chalet-${v}`, 96, 72, (ctx, w, h) => {
    const wood = v === 0 ? '#6b4a2b' : '#7a3b2a';
    rect(ctx, 0, 0, w, h, wood);
    rect(ctx, 3, 3, w - 6, h / 2 - 4, SNOW);
    rect(ctx, 3, h / 2 + 1, w - 6, h / 2 - 4, SNOW_SHADE);
    rect(ctx, 0, h / 2 - 1.5, w, 3, '#4e341d');
    // Drifts of snow sliding off, and icicles along the eaves.
    for (let x = 6; x < w - 6; x += 9) rect(ctx, x, h - 4, 2, 4, '#d8ecf7');
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [x, y, r] of [[18, 12, 6], [60, 18, 8], [30, 50, 7]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    rect(ctx, w - 26, h / 2 + 6, 14, 14, '#7d7a72');
    rect(ctx, w - 23, h / 2 + 9, 8, 8, '#2a2725');
    rect(ctx, w - 26, h / 2 + 6, 14, 4, SNOW);
  });
}

// Snowbanks: the snow ploughed into mounds along the road, the barrier between it and the deep snow.
for (let v = 0; v < WINTER_VARIANTS.bank; v++) {
  frame(`snowbank-${v}`, 34, 34, (ctx) => {
    const rand = seeded(v * 131 + 7);
    const blob = (r: number, dx: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rr = r * (0.85 + rand() * 0.2);
        const x = 17 + dx + Math.cos(a) * rr;
        const y = 17 + dx + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fill();
    };
    blob(16, 1, SNOW_DEEP);
    blob(14, -1, SNOW_SHADE);
    blob(9, -4, SNOW);
  });
}

// Rocks with snow on their tops, where the barrier crosses frozen water.
for (let v = 0; v < WINTER_VARIANTS.rock; v++) {
  frame(`snowrock-${v}`, 32, 32, (ctx) => {
    const rand = seeded(v * 211 + 19);
    const shape = (r: number, dx: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.8 + rand() * 0.25);
        if (k === 0) ctx.moveTo(16 + dx + Math.cos(a) * rr, 16 + dx + Math.sin(a) * rr);
        else ctx.lineTo(16 + dx + Math.cos(a) * rr, 16 + dx + Math.sin(a) * rr);
      }
      ctx.fill();
    };
    shape(15, 0, '#4f5355');
    shape(11, -2, '#6c7072');
    shape(8, -4, SNOW);
  });
}

// A snowman seen from above: his round body, his head with a hat and a carrot nose (pointing right).
frame('snowman', 22, 22, (ctx) => {
  circle(ctx, 11, 11, 10, SNOW_DEEP);
  circle(ctx, 10, 10, 9, SNOW);
  circle(ctx, 12, 11, 5.5, SNOW_SHADE);
  circle(ctx, 11.5, 10.5, 5, SNOW);
  circle(ctx, 11.5, 10.5, 3.2, '#1d1d1f');
  ctx.fillStyle = '#f28c28';
  ctx.beginPath();
  ctx.moveTo(15, 9.5);
  ctx.lineTo(21, 10.5);
  ctx.lineTo(15, 11.5);
  ctx.fill();
  rect(ctx, 3, 9.5, 4, 2.5, '#d7263d'); // scarf end
});
// A block of ice: heavy, and it slides.
frame('iceblock', 30, 30, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#7fb3cf');
  rect(ctx, 2, 2, w - 4, h - 4, '#a9d3e8');
  rect(ctx, 5, 5, w - 14, 5, 'rgba(255,255,255,0.7)');
  rect(ctx, 5, 5, 5, h - 14, 'rgba(255,255,255,0.5)');
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, 8);
  ctx.lineTo(13, 18);
  ctx.lineTo(22, 24);
  ctx.stroke();
});

// Snowflakes.
for (let v = 0; v < WINTER_VARIANTS.flake; v++) {
  frame(`flake-${v}`, 8, 8, (ctx) => {
    if (v === 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI;
        ctx.moveTo(4 - Math.cos(a) * 3.5, 4 - Math.sin(a) * 3.5);
        ctx.lineTo(4 + Math.cos(a) * 3.5, 4 + Math.sin(a) * 3.5);
      }
      ctx.stroke();
    } else circle(ctx, 4, 4, v === 0 ? 2 : 3, 'rgba(255,255,255,0.95)');
  });
}

// People on the snow, facing right, in bright jackets.
const JACKETS = ['#d7263d', '#1d6fb8', '#f2a516', '#2a9d8f', '#8338ec', '#1d1d1f'];
const HATS = ['#ffd23f', '#f4f4f4', '#d7263d', '#1d3557', '#fb5607', '#06d6a0'];
for (let v = 0; v < WINTER_VARIANTS.people; v++) {
  // Skiers carving one way and the other: skis angled across the way they go, poles out.
  for (const [pose, tilt] of [['l', -0.25], ['r', 0.25]] as const) {
    frame(`skier-${v}-${pose}`, 26, 18, (ctx) => {
      ctx.save();
      ctx.translate(13, 9);
      ctx.rotate(tilt);
      ctx.fillStyle = '#2b2d42';
      for (const y of [-3, 3]) ctx.fillRect(-11, y - 1, 22, 2);
      ctx.restore();
      ctx.strokeStyle = '#5f646c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(13, 9);
      ctx.lineTo(7, 2);
      ctx.moveTo(13, 9);
      ctx.lineTo(7, 16);
      ctx.stroke();
      ellipse(ctx, 13, 9, 4, 5, JACKETS[v]);
      circle(ctx, 14, 9, 2.6, HATS[v]);
    });
    // Snowboarders: the board across the way they go, leaning into the turn.
    frame(`boarder-${v}-${pose}`, 24, 24, (ctx) => {
      ctx.save();
      ctx.translate(12, 12);
      ctx.rotate(Math.PI / 2 + tilt);
      ctx.fillStyle = pick(['#e63946', '#ffb703', '#2a9d8f', '#f4f4f4'], seeded(v * 3 + 1));
      ctx.beginPath();
      ctx.roundRect(-11, -3.5, 22, 7, 3.5);
      ctx.fill();
      ctx.restore();
      ellipse(ctx, 12 + tilt * 6, 12, 4.5, 5, JACKETS[(v + 2) % JACKETS.length]);
      circle(ctx, 13 + tilt * 6, 12, 2.6, HATS[(v + 3) % HATS.length]);
    });
  }
  // Skaters on the ice: a stride each way.
  for (const f of [0, 1]) {
    frame(`skater-${v}-${f}`, 16, 16, (ctx) => {
      const stride = f === 0 ? 3 : -3;
      ellipse(ctx, 8 + stride, 4.5, 2.4, 1.2, '#f4f4f4');
      ellipse(ctx, 8 - stride, 11.5, 2.4, 1.2, '#f4f4f4');
      circle(ctx, 8 - stride * 0.6, 3, 1.6, JACKETS[(v + 1) % JACKETS.length]);
      circle(ctx, 8 + stride * 0.6, 13, 1.6, JACKETS[(v + 1) % JACKETS.length]);
      ellipse(ctx, 8, 8, 4, 5.5, JACKETS[(v + 1) % JACKETS.length]);
      circle(ctx, 8.5, 8, 2.8, HATS[(v + 2) % HATS.length]);
    });
  }
}

// The chairlift: a tower, a station at each end, and chairs (empty, or with two riding up).
frame('lift-tower', 18, 18, (ctx, w, h) => {
  rect(ctx, 0, h / 2 - 2, w, 4, '#3d4148');
  circle(ctx, w / 2, h / 2, 5, '#5f646c');
  circle(ctx, w / 2, h / 2, 2.5, '#2b2d31');
});
frame('lift-station', 72, 46, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#4e341d');
  rect(ctx, 3, 3, w - 6, h - 6, SNOW);
  rect(ctx, 3, h / 2, w - 6, h / 2 - 3, SNOW_SHADE);
  // The bull wheel the cable turns round.
  circle(ctx, w - 14, h / 2, 12, '#3d4148');
  circle(ctx, w - 14, h / 2, 8, '#7b8089');
  rect(ctx, 6, 8, 18, 10, '#2b2d42');
  rect(ctx, 8, 10, 14, 4, '#9fd3ff');
});
for (const full of [0, 1]) {
  frame(`liftchair-${full}`, 16, 22, (ctx, w, h) => {
    rect(ctx, w / 2 - 1, 0, 2, h, '#2b2d31');
    rect(ctx, 1, 4, w - 2, h - 8, '#d7263d');
    rect(ctx, 1, 4, 3, h - 8, '#8a1a24');
    if (full) {
      circle(ctx, 9, 8, 3.5, '#1d6fb8');
      circle(ctx, 9, 14, 3.5, '#f2a516');
      circle(ctx, 10, 8, 2, '#ffd23f');
      circle(ctx, 10, 14, 2, '#f4f4f4');
    }
  });
}
// An ice-fishing hut out on a lake.
frame('icehut', 30, 30, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#7a2e22');
  rect(ctx, 2, 2, w - 4, h / 2 - 2, '#a63d2b');
  rect(ctx, 2, h / 2, w - 4, h / 2 - 2, '#8a3424');
  rect(ctx, 2, h / 2 - 1, w - 4, 2, '#4e1d16');
  rect(ctx, 3, 3, w - 6, 4, SNOW);
});

/** Makes (once) and returns the key of the snow on the ground: soft drifts in blue shadow, and the odd sparkle. */
export function snowTexture(scene: Phaser.Scene, location: Location): string {
  const key = `snow-${location.id}`;
  if (scene.textures.exists(key)) return key;
  const { base, stripe, tuft } = location.ground;
  const g = scene.make.graphics({}, false);
  const T = 256;
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle(base);
  g.fillRect(0, 0, T, T);
  // A few soft drifts, kept away from the edges so it tiles.
  for (let k = 0; k < 7; k++) {
    const x = 50 + rand() * (T - 100);
    const y = 40 + rand() * (T - 80);
    const w = 60 + rand() * 50;
    g.fillStyle(stripe, 0.5);
    g.fillEllipse(x, y + 3, w, 16 + rand() * 10);
    g.fillStyle(0xffffff, 0.6);
    g.fillEllipse(x - 5, y - 2, w * 0.7, 9 + rand() * 6);
  }
  g.fillStyle(tuft, 0.5);
  for (let k = 0; k < 40; k++) g.fillCircle(4 + rand() * (T - 8), 4 + rand() * (T - 8), 1 + rand() * 1.5);
  g.fillStyle(0xffffff, 1);
  for (let k = 0; k < 30; k++) g.fillRect(2 + rand() * (T - 4), 2 + rand() * (T - 4), 1.5, 1.5);
  g.generateTexture(key, T, T);
  g.destroy();
  return key;
}
