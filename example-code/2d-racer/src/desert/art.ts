/**
 * The art for the desert, drawn in code like the rest: the sand on the ground
 * (a texture of its own), and on the scenery texture (decorationArt.ts packs
 * them) red rocks, tumbleweeds, cacti and Joshua trees, a ghost town's
 * weathered buildings, water tower and windmill, wrecks, a desert camp, wild
 * horses, buggies, land yachts, vultures and a UFO. Things facing the track
 * have their front along the top edge; things that move face right.
 */

import type * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type FrameSpec, circle, ellipse, rect, seeded } from '../scenes/artKit';

export const DESERT_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => DESERT_FRAMES.push({ name, w, h, draw });

export const DESERT_VARIANTS = { rock: 3, tumbleweed: 2, joshua: 3, saguaro: 2, pear: 2, sage: 3, shack: 4, wreck: 2, people: 4, yacht: 3 };

/** Red sandstone, from in shade to in the sun. */
const RED = ['#6e2b18', '#8f3a1f', '#b24e2a', '#cf6b3d', '#e39462'];
/** Old wood, bleached grey by the sun. */
const WOOD = ['#4a3f35', '#6b5d4f', '#857565', '#9c8b78', '#b3a28e'];
const RUST = ['#5a2e17', '#7d3f1d', '#9a5426', '#b56b34'];

/** A lumpy closed shape round (cx, cy). */
function lump(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, rand: () => number, points = 9, rough = 0.25): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const rr = r * (1 - rough + rand() * rough);
    if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// Red rocks along the track: sandstone boulders, lit from the top left.
for (let v = 0; v < DESERT_VARIANTS.rock; v++) {
  frame(`redrock-${v}`, 34, 34, (ctx) => {
    const rand = seeded(v * 337 + 11);
    lump(ctx, 18, 18, 15, RED[0], rand, 8);
    lump(ctx, 17, 17, 13, RED[1 + (v % 2)], rand, 8);
    lump(ctx, 14, 14, 8, RED[3], rand, 7);
    // Bands in the stone.
    ctx.strokeStyle = 'rgba(240,200,160,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, 20 + v);
    ctx.quadraticCurveTo(17, 16 + v, 29, 22 - v);
    ctx.stroke();
  });
}

// Tumbleweeds: a tangled ball of dry twigs.
for (let v = 0; v < DESERT_VARIANTS.tumbleweed; v++) {
  frame(`tumbleweed-${v}`, 26, 26, (ctx) => {
    const rand = seeded(v * 71 + 3);
    circle(ctx, 13, 13, 11, 'rgba(120,90,50,0.35)');
    ctx.lineWidth = 1;
    for (let k = 0; k < 46; k++) {
      ctx.strokeStyle = k % 3 === 0 ? '#5c4528' : k % 3 === 1 ? '#8b6b40' : '#a8875a';
      const a = rand() * Math.PI * 2;
      const r = rand() * 10;
      const x = 13 + Math.cos(a) * r;
      const y = 13 + Math.sin(a) * r;
      const b = a + 1.5 + rand() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(13 + Math.cos(b) * 6, 13 + Math.sin(b) * 6, 13 + Math.cos(b + 1) * (5 + rand() * 6), 13 + Math.sin(b + 1) * (5 + rand() * 6));
      ctx.stroke();
    }
  });
}

// An old wooden barrel seen from above: staves, iron hoops and the lid.
frame('woodbarrel', 30, 30, (ctx) => {
  circle(ctx, 15, 15, 14, '#3a2a1a');
  circle(ctx, 15, 15, 12.5, '#7a5530');
  circle(ctx, 15, 15, 11, '#3a2a1a');
  circle(ctx, 15, 15, 10, '#8f6a40');
  ctx.strokeStyle = '#6b4a28';
  ctx.lineWidth = 1;
  for (let x = 8; x < 23; x += 3.5) {
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, 24);
    ctx.stroke();
  }
  circle(ctx, 18, 12, 1.4, '#2a1d12');
});

// Joshua trees: forked branches ending in spiky rosettes, seen from above.
for (let v = 0; v < DESERT_VARIANTS.joshua; v++) {
  frame(`joshua-${v}`, 72, 72, (ctx) => {
    const rand = seeded(v * 919 + 17);
    const tips: [number, number][] = [];
    const branch = (x: number, y: number, a: number, len: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      ctx.strokeStyle = '#6a5640';
      ctx.lineWidth = 4 - depth;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (depth < 2 && rand() < 0.85) {
        branch(x2, y2, a - 0.5 - rand() * 0.4, len * 0.7, depth + 1);
        branch(x2, y2, a + 0.5 + rand() * 0.4, len * 0.7, depth + 1);
      } else tips.push([x2, y2]);
    };
    const arms = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < arms; k++) branch(36, 36, (k / arms) * Math.PI * 2 + rand(), 9 + rand() * 4, 0);
    for (const [x, y] of tips) {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        ctx.strokeStyle = k % 2 ? '#4f6b35' : '#6f8a45';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 6.5, y + Math.sin(a) * 6.5);
        ctx.stroke();
      }
      circle(ctx, x - 0.5, y - 0.5, 1.8, '#a3b86c');
    }
  });
}

// Saguaros: a ribbed column with arms reaching out, seen from above.
for (let v = 0; v < DESERT_VARIANTS.saguaro; v++) {
  frame(`saguaro-${v}`, 52, 52, (ctx) => {
    const rand = seeded(v * 577 + 41);
    const arm = (a: number, len: number) => {
      ctx.save();
      ctx.translate(26, 26);
      ctx.rotate(a);
      ctx.fillStyle = '#3f6b3a';
      ctx.beginPath();
      ctx.roundRect(0, -4, len, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#5b8a4d';
      ctx.beginPath();
      ctx.roundRect(0, -2.5, len - 2, 3, 1.5);
      ctx.fill();
      circle(ctx, len - 4, 0, 4, '#4f7d44');
      ctx.restore();
    };
    for (let k = 0; k < 2 + v; k++) arm(rand() * Math.PI * 2, 14 + rand() * 9);
    circle(ctx, 26, 26, 9, '#355e31');
    ctx.strokeStyle = '#5b8a4d';
    ctx.lineWidth = 1;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(26 + Math.cos(a) * 3, 26 + Math.sin(a) * 3);
      ctx.lineTo(26 + Math.cos(a) * 8.5, 26 + Math.sin(a) * 8.5);
      ctx.stroke();
    }
    circle(ctx, 25, 25, 2.5, '#e8e4c8');
  });
}

// Barrel cactus, with a ring of yellow flowers on top.
frame('barrelcactus', 18, 18, (ctx) => {
  circle(ctx, 9, 9, 8, '#3c6a3a');
  ctx.strokeStyle = '#6e9a55';
  ctx.lineWidth = 1;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(9 + Math.cos(a) * 2, 9 + Math.sin(a) * 2);
    ctx.lineTo(9 + Math.cos(a) * 8, 9 + Math.sin(a) * 8);
    ctx.stroke();
  }
  for (let k = 0; k < 6; k++) circle(ctx, 9 + Math.cos(k) * 2.5, 9 + Math.sin(k) * 2.5, 1.3, '#f2c230');
});

// Prickly pear: a sprawl of flat pads, a few with red fruit.
for (let v = 0; v < DESERT_VARIANTS.pear; v++) {
  frame(`pricklypear-${v}`, 36, 36, (ctx) => {
    const rand = seeded(v * 233 + 9);
    for (let k = 0; k < 7; k++) {
      const x = 8 + rand() * 20;
      const y = 8 + rand() * 20;
      ellipse(ctx, x, y, 6, 4.5, k % 2 ? '#5f8f4a' : '#6f9d55', rand() * Math.PI);
      if (rand() < 0.4) circle(ctx, x + 3, y - 3, 1.6, '#b8314a');
    }
  });
}

// Sagebrush: a grey-green mound.
for (let v = 0; v < DESERT_VARIANTS.sage; v++) {
  frame(`sage-${v}`, 28, 28, (ctx) => {
    const rand = seeded(v * 97 + 5);
    for (let k = 0; k < 16; k++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 8;
      circle(ctx, 14 + Math.cos(a) * r, 14 + Math.sin(a) * r, 3 + rand() * 2.5, k % 3 === 0 ? '#7d8a6a' : k % 3 === 1 ? '#95a181' : '#a9b494');
    }
  });
}

/**
 * The ghost town's buildings from above: roofs of weathered planks or rusty
 * tin, gaps where boards have fallen in, and (along the front, the top edge)
 * a boardwalk with a broken rail. The last is a building that's collapsed.
 */
const SHACKS: [number, number][] = [
  [116, 80],
  [86, 64],
  [72, 56],
  [96, 64],
];
SHACKS.forEach(([w, h], v) => {
  frame(`shack-${v}`, w, h, (ctx) => {
    const rand = seeded(v * 1301 + 77);
    const front = 12;
    // The boardwalk along the front.
    rect(ctx, 0, 0, w, front, WOOD[3]);
    for (let x = 3; x < w; x += 6) rect(ctx, x, 0, 1, front, WOOD[1]);
    rect(ctx, 0, 1, w, 1.5, WOOD[0]);
    if (v === 3) {
      // Fallen in: a heap of boards, the odd beam still standing, and sand blown in.
      rect(ctx, 4, front, w - 8, h - front - 4, '#4b3a2a');
      for (let k = 0; k < 26; k++) {
        ctx.save();
        ctx.translate(8 + rand() * (w - 16), front + 6 + rand() * (h - front - 14));
        ctx.rotate(rand() * Math.PI);
        rect(ctx, -12, -2, 24, 4, WOOD[1 + Math.floor(rand() * 4)]);
        ctx.restore();
      }
      ellipse(ctx, w * 0.3, h * 0.7, 18, 8, 'rgba(220,197,156,0.85)');
      for (const x of [6, w - 10]) rect(ctx, x, front, 4, h - front - 4, WOOD[0]);
      return;
    }
    const tin = v === 1;
    rect(ctx, 0, front, w, h - front, WOOD[0]);
    // The roof, split along its ridge: one slope in the sun, the other in shade.
    const roof = (y0: number, y1: number, lit: boolean) => {
      if (tin) {
        rect(ctx, 2, y0, w - 4, y1 - y0, lit ? RUST[3] : RUST[1]);
        for (let x = 4; x < w - 4; x += 5) rect(ctx, x, y0, 1.5, y1 - y0, lit ? RUST[2] : RUST[0]);
        for (let k = 0; k < 5; k++) ellipse(ctx, 6 + rand() * (w - 12), y0 + rand() * (y1 - y0), 4 + rand() * 6, 2 + rand() * 2, 'rgba(60,30,15,0.4)');
      } else {
        for (let y = y0; y < y1; y += 5) {
          rect(ctx, 2, y, w - 4, 4, WOOD[lit ? 3 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2)]);
          rect(ctx, 2, y + 4, w - 4, 1, WOOD[0]);
        }
      }
    };
    const ridge = front + (h - front) / 2;
    roof(front + 2, ridge, true);
    roof(ridge, h - 2, false);
    rect(ctx, 2, ridge - 1, w - 4, 2, WOOD[0]);
    // Holes where the roof's fallen in.
    for (let k = 0; k < 2; k++) {
      const x = 10 + rand() * (w - 34);
      const y = front + 6 + rand() * (h - front - 22);
      rect(ctx, x, y, 12 + rand() * 12, 6 + rand() * 6, '#211912');
    }
    // A false front standing up over the boardwalk (the saloon's has its sign).
    if (v === 0) {
      rect(ctx, 6, front - 3, w - 12, 5, WOOD[1]);
      rect(ctx, w / 2 - 22, front - 3, 44, 5, '#7a2e22');
    }
    // Hitching rail.
    rect(ctx, 6, 3, w - 12, 1.5, WOOD[0]);
  });
});

// The town's water tower: a round tank of staves with a conical roof.
frame('watertower', 46, 46, (ctx) => {
  circle(ctx, 23, 23, 22, WOOD[0]);
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2;
    const a1 = ((k + 1) / 16) * Math.PI * 2;
    ctx.fillStyle = WOOD[(k + (k < 8 ? 3 : 1)) % 5];
    ctx.beginPath();
    ctx.moveTo(23, 23);
    ctx.arc(23, 23, 20, a0, a1);
    ctx.fill();
  }
  circle(ctx, 23, 23, 3, WOOD[0]);
  ctx.strokeStyle = '#3d3a36';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(23, 23, 20.5, 0, Math.PI * 2);
  ctx.stroke();
});

// A windpump: its lattice tower, the wheel of blades (it turns), and its tail vane.
frame('windmill-tower', 30, 30, (ctx) => {
  ctx.strokeStyle = '#5b5752';
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 24, 24);
  ctx.beginPath();
  ctx.moveTo(3, 3);
  ctx.lineTo(27, 27);
  ctx.moveTo(27, 3);
  ctx.lineTo(3, 27);
  ctx.stroke();
});
frame('windmill-wheel', 50, 50, (ctx) => {
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    ctx.save();
    ctx.translate(25, 25);
    ctx.rotate(a);
    ctx.fillStyle = k % 2 ? '#c9c4bb' : '#a8a299';
    ctx.beginPath();
    ctx.moveTo(6, -1);
    ctx.lineTo(23, -3.5);
    ctx.lineTo(23, 3.5);
    ctx.lineTo(6, 1);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = '#6d6862';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(25, 25, 15, 0, Math.PI * 2);
  ctx.stroke();
  circle(ctx, 25, 25, 5, '#55514c');
});
frame('windmill-tail', 34, 10, (ctx) => {
  rect(ctx, 0, 4, 22, 2, '#55514c');
  rect(ctx, 18, 0, 16, 10, '#b23a2a');
  rect(ctx, 18, 0, 16, 2, '#d2604a');
});

// A broken-down wagon, a lone wheel, a trough, an outhouse and a cow's skull.
frame('wagon', 50, 28, (ctx, _w, h) => {
  for (const [x, y] of [[8, 1], [8, h - 4], [38, 1], [38, h - 4]]) rect(ctx, x - 6, y, 12, 3, '#3a2c1f');
  rect(ctx, 4, 4, 40, h - 8, WOOD[1]);
  for (let x = 6; x < 44; x += 5) rect(ctx, x, 5, 4, h - 10, WOOD[2 + (x % 2)]);
  // The torn canvas hoops.
  for (let x = 10; x < 42; x += 10) rect(ctx, x, 3, 2, h - 6, '#d8cdb5');
  rect(ctx, 44, h / 2 - 1, 6, 2, WOOD[0]);
});
frame('wagonwheel', 18, 18, (ctx) => {
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(9, 9, 7.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(9 - Math.cos(a) * 7, 9 - Math.sin(a) * 7);
    ctx.lineTo(9 + Math.cos(a) * 7, 9 + Math.sin(a) * 7);
    ctx.stroke();
  }
  circle(ctx, 9, 9, 2, '#3a2c1f');
});
frame('trough', 34, 12, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#5b5752');
  rect(ctx, 2, 2, w - 4, h - 4, '#6e8e9a');
  rect(ctx, 4, 3, w - 12, 2, 'rgba(255,255,255,0.4)');
});
frame('outhouse', 18, 18, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, WOOD[0]);
  rect(ctx, 1, 1, w - 2, h / 2 - 1, WOOD[3]);
  rect(ctx, 1, h / 2, w - 2, h / 2 - 1, WOOD[1]);
});
frame('skull', 16, 12, (ctx) => {
  ellipse(ctx, 8, 6, 4, 4.5, '#efe8d8');
  ellipse(ctx, 8, 8.5, 2.5, 3, '#e2d9c4');
  ctx.strokeStyle = '#efe8d8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(5, 3);
  ctx.quadraticCurveTo(1, 2, 1, 0);
  ctx.moveTo(11, 3);
  ctx.quadraticCurveTo(15, 2, 15, 0);
  ctx.stroke();
  circle(ctx, 6.5, 5, 1, '#3a3028');
  circle(ctx, 9.5, 5, 1, '#3a3028');
});

// Rusted-out old cars, half full of sand (facing right).
for (let v = 0; v < DESERT_VARIANTS.wreck; v++) {
  frame(`wreck-${v}`, 66, 30, (ctx, w, h) => {
    const rand = seeded(v * 53 + 21);
    ctx.fillStyle = RUST[1];
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 7);
    ctx.fill();
    ctx.fillStyle = v === 0 ? '#5f7f86' : '#8a6f4a';
    ctx.beginPath();
    ctx.roundRect(5, 4, w - 10, h - 8, 5);
    ctx.fill();
    for (let k = 0; k < 9; k++) ellipse(ctx, 6 + rand() * (w - 12), 5 + rand() * (h - 10), 3 + rand() * 7, 2 + rand() * 3, rand() < 0.5 ? RUST[2] : RUST[3]);
    // No glass: the dark inside, with sand drifted in.
    rect(ctx, w - 22, 6, 7, h - 12, '#2a1f17');
    rect(ctx, 16, 6, 24, h - 12, '#2a1f17');
    ellipse(ctx, 26, h / 2 + 2, 10, 4, '#d5bb8e');
  });
}

// The desert camp: an RV with its awning out, a jeep, folding chairs.
frame('rv', 96, 36, (ctx, w, h) => {
  ctx.fillStyle = '#f1ede4';
  ctx.beginPath();
  ctx.roundRect(0, 1, w, h - 2, 6);
  ctx.fill();
  rect(ctx, 0, 10, w - 14, 3, '#2a7f8f');
  rect(ctx, 0, 14, w - 14, 2, '#e07a3b');
  rect(ctx, 30, 9, 16, 18, '#d9d4c8'); // air conditioner
  rect(ctx, 33, 12, 10, 12, '#bdb7aa');
  rect(ctx, 60, 8, 12, 12, 'rgba(160,200,230,0.8)'); // skylight
  rect(ctx, w - 12, 4, 9, h - 8, '#9fd3ff'); // windscreen
});
frame('awning', 60, 26, (ctx, w, h) => {
  for (let x = 0; x < w; x += 10) rect(ctx, x, 0, 5, h, '#e07a3b');
  for (let x = 5; x < w; x += 10) rect(ctx, x, 0, 5, h, '#f3e6c8');
  rect(ctx, 0, h - 2, w, 2, 'rgba(0,0,0,0.2)');
});
frame('jeep', 52, 26, (ctx, w, h) => {
  ctx.fillStyle = '#a63d2b';
  ctx.beginPath();
  ctx.roundRect(1, 2, w - 2, h - 4, 4);
  ctx.fill();
  rect(ctx, 6, 5, 24, h - 10, '#2b2d31'); // open top, seats
  rect(ctx, 9, 7, 7, 5, '#5a3a28');
  rect(ctx, 9, h - 12, 7, 5, '#5a3a28');
  rect(ctx, 32, 4, 3, h - 8, '#9fd3ff');
  rect(ctx, 0, 6, 3, h - 12, '#3a3a3a'); // spare wheel
});
frame('chair', 9, 9, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#2a5f8f');
  rect(ctx, 0, 0, 2, h, '#1d4466');
});

/** People in the desert: hats and bright shirts. Sitting (legs out to the right) and walking (facing right, two strides). */
const SHIRTS = ['#e07a3b', '#2a7f8f', '#d9c34a', '#8f3a6b'];
const HATS = ['#c9a46a', '#f1ede4', '#3a2c1f', '#d7263d'];
for (let v = 0; v < DESERT_VARIANTS.people; v++) {
  frame(`sitter-${v}`, 14, 14, (ctx) => {
    rect(ctx, 7, 4.5, 6, 2, '#3b4a6b');
    rect(ctx, 7, 7.5, 6, 2, '#3b4a6b');
    ellipse(ctx, 6, 7, 3.5, 4.5, SHIRTS[v]);
    circle(ctx, 5.5, 7, 2.8, HATS[v]);
  });
  for (const f of [0, 1]) {
    frame(`walker-${v}-${f}`, 14, 14, (ctx) => {
      const stride = f === 0 ? 3 : -3;
      ellipse(ctx, 7 + stride, 4.8, 2.2, 1.2, '#3a2c1f');
      ellipse(ctx, 7 - stride, 9.2, 2.2, 1.2, '#3a2c1f');
      ellipse(ctx, 7, 7, 3, 4.2, SHIRTS[(v + 1) % SHIRTS.length]);
      circle(ctx, 7.5, 7, 2.6, HATS[(v + 2) % HATS.length]);
      ellipse(ctx, 4, 7, 1.6, 3, 'rgba(60,45,30,0.85)'); // backpack
    });
  }
}

// A dune buggy: a roll cage over two seats, fat tyres.
frame('buggy', 34, 22, (ctx, w, h) => {
  for (const [x, y] of [[4, 0], [4, h - 5], [w - 10, 1], [w - 10, h - 5]]) rect(ctx, x, y, 7, 5, '#1d1d1f');
  rect(ctx, 6, 4, w - 12, h - 8, '#f2a516');
  ctx.strokeStyle = '#2b2d31';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(9, 5, 14, h - 10);
  ctx.beginPath();
  ctx.moveTo(9, h / 2);
  ctx.lineTo(23, h / 2);
  ctx.stroke();
  circle(ctx, 13, 8, 2.2, '#d7263d');
  circle(ctx, 13, h - 8, 2.2, '#f1ede4');
});

// Land yachts: a three-wheeled frame with a long, bright sail (seen edge on from above, it's a slim wedge).
const SAILS = ['#d7263d', '#1d6fb8', '#f2a516'];
for (let v = 0; v < DESERT_VARIANTS.yacht; v++) {
  frame(`landyacht-${v}`, 40, 34, (ctx) => {
    ctx.strokeStyle = '#3d3a36';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(36, 17);
    ctx.lineTo(10, 17);
    ctx.moveTo(12, 6);
    ctx.lineTo(12, 28);
    ctx.stroke();
    for (const [x, y] of [[36, 17], [12, 6], [12, 28]]) rect(ctx, x - 3, y - 1.5, 6, 3, '#1d1d1f');
    // The sail, swung out to one side along its boom.
    ctx.fillStyle = SAILS[v];
    ctx.beginPath();
    ctx.moveTo(26, 17);
    ctx.lineTo(4, 9);
    ctx.lineTo(6, 13);
    ctx.closePath();
    ctx.fill();
    circle(ctx, 18, 17, 2.4, '#f1ede4');
  });
}

// A vulture soaring: broad dark wings with fingered tips (facing right).
frame('vulture', 44, 20, (ctx) => {
  ctx.fillStyle = '#2b2522';
  ctx.beginPath();
  ctx.moveTo(26, 10);
  ctx.lineTo(18, 0);
  ctx.lineTo(13, 0);
  ctx.lineTo(15, 10);
  ctx.lineTo(13, 20);
  ctx.lineTo(18, 20);
  ctx.closePath();
  ctx.fill();
  for (const s of [1, -1]) {
    for (let k = 0; k < 4; k++) rect(ctx, 12 + k * 2, s > 0 ? 0 : 18, 1.4, 2, '#1d1917');
  }
  ellipse(ctx, 20, 10, 9, 3.4, '#3a322d');
  rect(ctx, 6, 8, 8, 4, '#2b2522'); // tail
  circle(ctx, 30, 10, 2.2, '#c25a4a'); // bald red head
});

// A UFO: a silver saucer with a glass dome and a ring of lights (two frames, the lights chasing round).
for (const f of [0, 1]) {
  frame(`ufo-${f}`, 56, 56, (ctx) => {
    circle(ctx, 28, 28, 26, '#6d737b');
    circle(ctx, 28, 28, 24, '#b7bec6');
    circle(ctx, 25, 25, 18, '#d6dce2');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      circle(ctx, 28 + Math.cos(a) * 21, 28 + Math.sin(a) * 21, 2.2, (k + f) % 2 ? '#7cff6b' : '#ffe14d');
    }
    circle(ctx, 28, 28, 10, '#5fa8b8');
    circle(ctx, 26, 26, 6, '#a6e3ef');
    circle(ctx, 24, 24, 2.5, '#ffffff');
  });
}

// Wild horses, facing right: grazing, alert, and two galloping strides.
const HORSE = { body: '#7a4a2a', dark: '#2e1d12', light: '#a46d45' };
for (const pose of ['graze', 'alert', 'run-0', 'run-1'] as const) {
  frame(`horse-${pose}`, 52, 26, (ctx) => {
    const running = pose.startsWith('run');
    const stride = pose === 'run-0' ? 1 : -1;
    if (running) {
      ctx.strokeStyle = HORSE.dark;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (const [x, dy] of [[13, 1], [31, -1]]) {
        ctx.moveTo(x, 13 + dy * 3);
        ctx.lineTo(x + stride * 8, 13 + dy * 9);
        ctx.moveTo(x, 13 - dy * 3);
        ctx.lineTo(x - stride * 8, 13 - dy * 9);
      }
      ctx.stroke();
    }
    ellipse(ctx, 22, 13, running ? 16 : 14, 6.5, HORSE.body);
    ellipse(ctx, 22, 12, 10, 3, HORSE.light);
    // A long dark tail, and the mane down the neck.
    ellipse(ctx, 5, 13, 4, 2, HORSE.dark, running ? 0.2 * stride : 0);
    const headX = pose === 'graze' ? 43 : 41;
    ellipse(ctx, pose === 'graze' ? 36 : 35, 13, 5, 3.4, HORSE.body);
    rect(ctx, 30, 12, 9, 2, HORSE.dark);
    ellipse(ctx, headX, 13, 6, 3.4, HORSE.body);
    circle(ctx, headX + 5, 13, 1.5, HORSE.dark);
    if (pose !== 'graze') {
      ellipse(ctx, headX - 3, 10, 1.2, 2, HORSE.dark, 0.4);
      ellipse(ctx, headX - 3, 16, 1.2, 2, HORSE.dark, -0.4);
    }
  });
}

/** Makes (once) and returns the key of the desert floor: sand, gravel, pebbles and tufts of dry grass. */
export function desertTexture(scene: Phaser.Scene, location: Location): string {
  const key = `desert-${location.id}`;
  if (scene.textures.exists(key)) return key;
  const { base, stripe, tuft } = location.ground;
  const g = scene.make.graphics({}, false);
  const T = 256;
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle(base);
  g.fillRect(0, 0, T, T);
  // Patches of coarser, darker gravel and paler sand, kept away from the edges so it tiles.
  for (let k = 0; k < 9; k++) {
    const x = 40 + rand() * (T - 80);
    const y = 40 + rand() * (T - 80);
    g.fillStyle(k % 3 === 0 ? 0xf0e0c0 : stripe, 0.2);
    g.fillEllipse(x, y, 40 + rand() * 50, 20 + rand() * 30);
  }
  for (let k = 0; k < 260; k++) {
    g.fillStyle(rand() < 0.5 ? 0xa8875f : 0xefdcb8, 0.6);
    g.fillRect(rand() * T, rand() * T, 1.5, 1.5);
  }
  for (let k = 0; k < 20; k++) {
    g.fillStyle(rand() < 0.5 ? 0x8f6d4d : 0x9c8a74, 0.85);
    g.fillCircle(4 + rand() * (T - 8), 4 + rand() * (T - 8), 1.5 + rand() * 1.5);
  }
  // Tufts of dry grass and scrub.
  for (let k = 0; k < 14; k++) {
    const x = 10 + rand() * (T - 20);
    const y = 10 + rand() * (T - 20);
    for (let b = 0; b < 7; b++) {
      g.fillStyle(b % 2 ? tuft : 0xa39a6a, 0.8);
      g.fillCircle(x + (rand() - 0.5) * 8, y + (rand() - 0.5) * 8, 1.2 + rand() * 1.2);
    }
  }
  g.generateTexture(key, T, T);
  g.destroy();
  return key;
}
