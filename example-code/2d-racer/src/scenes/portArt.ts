/**
 * Art for the docks, drawn in code: ships and boats, quay cranes and their
 * trolleys, fuel tanks, straddle carriers, a little freight train, gulls and
 * cloud shadows. Packed onto the decoration texture (see decorationArt.ts).
 * Boats, vehicles and birds face right; a crane's boom points up (its front).
 */

import * as Phaser from 'phaser';
import { BOAT_SIZES } from '../track/decoration';
import { type FrameSpec, circle, ellipse, pick, rect, seeded } from './artKit';

export const PORT_VARIANTS = { ship: 3, crane: 2, tank: 2, wagon: 3, cloud: 2 };
/** How far a crane's boom reaches out past its legs, px. */
export const CRANE_BOOM = 150;

export const PORT_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => PORT_FRAMES.push({ name, w, h, draw });

const CONTAINERS = ['#a63d2b', '#1f5f99', '#2f7d4a', '#d9822b', '#7b8089', '#1d8a8a', '#c9b037'];
const HULLS = [
  ['#1d3557', '#a3262a'],
  ['#2b2d42', '#c4512f'],
  ['#3d5a40', '#7a2d22'],
];

/** A hull pointing right: bow at the right, square stern on the left. */
function hull(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, bow = 0.22): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.1);
  ctx.lineTo(x + w * (1 - bow), y);
  ctx.quadraticCurveTo(x + w, y + h / 2, x + w * (1 - bow), y + h);
  ctx.lineTo(x, y + h * 0.9);
  ctx.closePath();
  ctx.fill();
}

for (let v = 0; v < PORT_VARIANTS.ship; v++) {
  frame(`ship-${v}`, 360, 72, (ctx, w, h) => {
    const rand = seeded(v * 37 + 11);
    const [body, waterline] = HULLS[v];
    hull(ctx, 0, 0, w, h, waterline, 0.16);
    hull(ctx, 3, 3, w - 6, h - 6, body, 0.16);
    rect(ctx, 6, 6, w * 0.78, h - 12, '#4a4e55'); // deck
    // Rows of containers, stacked unevenly.
    for (let x = 70; x < w * 0.8; x += 32) {
      for (let y = 9; y < h - 12; y += 13) {
        if (rand() < 0.12) continue;
        rect(ctx, x, y, 30, 12, pick(CONTAINERS, rand));
        rect(ctx, x, y + 11, 30, 1, 'rgba(0,0,0,0.3)');
      }
    }
    // The bridge and accommodation at the stern, with the funnel.
    rect(ctx, 12, 10, 44, h - 20, '#f1f1f1');
    rect(ctx, 50, 12, 6, h - 24, '#9fd3ff');
    rect(ctx, 22, h / 2 - 7, 14, 14, '#2b2d42');
    rect(ctx, 22, h / 2 - 7, 14, 4, '#d7263d');
  });
}

const BOATS = [
  { hull: '#2b2d42', deck: '#d7263d', cabin: '#f1f1f1' }, // tug
  { hull: '#1f5f99', deck: '#c9b98f', cabin: '#f1f1f1' }, // fishing boat
  { hull: '#f4f4f4', deck: '#d9c8a5', cabin: '#9fd3ff' }, // yacht
  { hull: '#e9c46a', deck: '#6b5a40', cabin: '#3b3b3b' }, // launch
];
BOAT_SIZES.forEach(({ w, h }, v) => {
  frame(`boat-${v}`, w, h, (ctx) => {
    const c = BOATS[v];
    hull(ctx, 0, 0, w, h, c.hull, v === 2 ? 0.35 : 0.25);
    hull(ctx, 3, 3, w - 6, h - 6, c.deck, v === 2 ? 0.35 : 0.25);
    if (v === 0) {
      // A tug: a cabin amidships, a funnel, and a fat rope fender at the bow.
      rect(ctx, w * 0.3, h * 0.25, w * 0.32, h * 0.5, c.cabin);
      rect(ctx, w * 0.2, h * 0.36, 6, h * 0.28, '#111');
      ellipse(ctx, w - 4, h / 2, 3, h * 0.3, '#3b2a18');
    } else if (v === 2) {
      // A yacht: a mast and boom.
      rect(ctx, w * 0.25, h * 0.3, w * 0.25, h * 0.4, c.cabin);
      circle(ctx, w * 0.55, h / 2, 2, '#888');
      rect(ctx, w * 0.2, h / 2 - 0.5, w * 0.35, 1, '#888');
    } else {
      rect(ctx, w * 0.12, h * 0.25, w * 0.28, h * 0.5, c.cabin);
      if (v === 1) for (let k = 0; k < 3; k++) rect(ctx, w * 0.5 + k * 7, h * 0.3, 5, h * 0.4, '#3d7a8a'); // nets
    }
  });
});

const CRANES = ['#c4402f', '#2f6db3'];
for (let v = 0; v < PORT_VARIANTS.crane; v++) {
  frame(`crane-${v}`, 56, 60 + CRANE_BOOM, (ctx, w, h) => {
    const color = CRANES[v];
    // The boom: two girders reaching out over the water, braced across.
    rect(ctx, 14, 0, 6, h - 30, color);
    rect(ctx, w - 20, 0, 6, h - 30, color);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = 4; y < h - 40; y += 16) {
      ctx.moveTo(17, y);
      ctx.lineTo(w - 17, y + 16);
      ctx.moveTo(w - 17, y);
      ctx.lineTo(17, y + 16);
    }
    ctx.stroke();
    // The portal frame on its four legs, and the machinery house at the back.
    rect(ctx, 0, h - 60, w, 8, color);
    rect(ctx, 0, h - 8, w, 8, color);
    for (const x of [0, w - 8]) rect(ctx, x, h - 60, 8, 60, color);
    rect(ctx, 10, h - 40, w - 20, 26, '#e6e6e6');
    rect(ctx, 10, h - 40, w - 20, 4, '#9aa0a8');
  });
}
frame('trolley', 30, 22, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#2b2d42');
  rect(ctx, 4, 4, w - 8, h - 8, '#ffd23f');
  rect(ctx, 8, 8, w - 16, h - 16, '#2b2d42');
});

for (let v = 0; v < PORT_VARIANTS.tank; v++) {
  frame(`tank-${v}`, 96, 96, (ctx) => {
    circle(ctx, 48, 48, 47, '#8a8f98');
    circle(ctx, 48, 48, 44, v === 0 ? '#e9ecef' : '#d8dcd0');
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.moveTo(48, 48);
      ctx.lineTo(48 + Math.cos(a) * 44, 48 + Math.sin(a) * 44);
    }
    ctx.stroke();
    circle(ctx, 48, 48, 7, '#9aa0a8');
    rect(ctx, 88, 40, 6, 16, '#5f646c'); // stairs up the side
    if (v === 1) {
      ctx.fillStyle = '#2f6db3';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DOCK', 48, 32);
    }
  });
}

// A straddle carrier: a tall yellow frame that drives over a container to lift it.
frame('straddle', 64, 44, (ctx, w, h) => {
  rect(ctx, 0, 0, w, 7, '#e0a100');
  rect(ctx, 0, h - 7, w, 7, '#e0a100');
  rect(ctx, 0, 0, 7, h, '#c98f00');
  rect(ctx, w - 7, 0, 7, h, '#c98f00');
  rect(ctx, w - 16, 0, 12, 10, '#2b2d42'); // cab
  rect(ctx, w - 14, 2, 8, 4, '#9fd3ff');
});

frame('loco', 70, 26, (ctx, w, h) => {
  rect(ctx, 0, 2, w, h - 4, '#d9822b');
  rect(ctx, 6, 5, w - 30, h - 10, '#b5651d');
  rect(ctx, w - 20, 4, 14, h - 8, '#2b2d42');
  rect(ctx, w - 18, 6, 10, h - 12, '#9fd3ff');
  rect(ctx, 0, h / 2 - 1, w, 2, '#ffd23f');
});
const WAGONS: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void)[] = [
  (ctx, w, h) => {
    rect(ctx, 0, 3, w, h - 6, '#4a4e55');
    rect(ctx, 4, 2, w - 8, h - 4, '#1f5f99');
    rect(ctx, 4, h - 4, w - 8, 2, 'rgba(0,0,0,0.3)');
  },
  (ctx, w, h) => {
    rect(ctx, 0, 3, w, h - 6, '#4a4e55');
    ellipse(ctx, w / 2, h / 2, w / 2 - 3, h / 2 - 2, '#c9ccd1');
    circle(ctx, w / 2, h / 2, 3, '#7b8089');
  },
  (ctx, w, h) => {
    rect(ctx, 0, 3, w, h - 6, '#4a4e55');
    rect(ctx, 4, 2, w - 8, h - 4, '#6b4a2b');
    for (let x = 10; x < w - 6; x += 12) rect(ctx, x, 4, 8, h - 8, '#3b2a18');
  },
];
WAGONS.forEach((draw, v) => frame(`wagon-${v}`, 76, 24, draw));

// Gulls: sitting (from above, a white body and grey back), and two wingbeats in flight.
frame('gull-sit', 16, 10, (ctx) => {
  ellipse(ctx, 8, 5, 6.5, 3.6, '#f4f4f4');
  ellipse(ctx, 7, 5, 4.5, 2.6, '#a9b1ba');
  circle(ctx, 13.5, 5, 2.2, '#f4f4f4');
  rect(ctx, 15, 4.5, 1.5, 1, '#f2b134');
});
for (const f of [0, 1]) {
  frame(`gull-${f}`, 28, 18, (ctx) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    const tip = f === 0 ? 1 : 5;
    // Wings swept back from the body, grey tips.
    ctx.moveTo(15, 9);
    ctx.quadraticCurveTo(12, 4, 9 - tip, tip - 0.5);
    ctx.lineTo(13, 7);
    ctx.moveTo(15, 9);
    ctx.quadraticCurveTo(12, 14, 9 - tip, 18.5 - tip);
    ctx.lineTo(13, 11);
    ctx.fill();
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15, 9);
    ctx.quadraticCurveTo(12, 4, 9 - tip, tip);
    ctx.moveTo(15, 9);
    ctx.quadraticCurveTo(12, 14, 9 - tip, 18 - tip);
    ctx.stroke();
    circle(ctx, 9 - tip, tip + 0.5, 1.6, '#5f646c');
    circle(ctx, 9 - tip, 17.5 - tip, 1.6, '#5f646c');
    ellipse(ctx, 14, 9, 7, 2.6, '#ffffff');
    circle(ctx, 21, 9, 2, '#ffffff');
    rect(ctx, 22.5, 8.5, 2, 1, '#f2b134');
  });
}

// Soft blobs for cloud shadows (tinted dark at runtime).
for (let v = 0; v < PORT_VARIANTS.cloud; v++) {
  frame(`cloud-${v}`, 256, 160, (ctx) => {
    const rand = seeded(v * 53 + 2);
    for (let k = 0; k < 7; k++) {
      const x = 60 + rand() * 136;
      const y = 50 + rand() * 60;
      const r = 36 + rand() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

// A yard gantry crane seen from above: two beams spanning the container stacks
// (top to bottom), on legs at the corners, with the cab on one side. Stretched to the yard's width.
export const RTG_COLOURS = 2;
for (let v = 0; v < RTG_COLOURS; v++) {
  frame(`rtg-${v}`, 34, 128, (ctx, w, h) => {
    const color = ['#e0a100', '#2f6db3'][v];
    rect(ctx, 2, 0, 7, h, color);
    rect(ctx, w - 9, 0, 7, h, color);
    rect(ctx, 0, 0, w, 9, color);
    rect(ctx, 0, h - 9, w, 9, color);
    for (const y of [2, h - 7]) for (const x of [1, w - 6]) rect(ctx, x, y, 5, 5, '#2b2b2b');
    rect(ctx, w - 12, 12, 10, 12, '#2b2d42');
    rect(ctx, w - 10, 14, 6, 5, '#9fd3ff');
  });
}

// A forklift facing right: forks out front, the driver's cage, a counterweight behind.
frame('forklift', 36, 20, (ctx) => {
  rect(ctx, 26, 4, 10, 2.5, '#7b8089');
  rect(ctx, 26, 13.5, 10, 2.5, '#7b8089');
  rect(ctx, 23, 2, 3, 16, '#3d4148');
  rect(ctx, 2, 2, 22, 16, '#e0a100');
  rect(ctx, 2, 2, 7, 16, '#5f646c');
  rect(ctx, 11, 5, 10, 10, '#2b2d42');
  circle(ctx, 16, 10, 2.6, '#f1c27d');
});
// What it carries: a pallet of boxes.
frame('pallet-load', 18, 16, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#a8834f');
  rect(ctx, 1.5, 1.5, w - 3, h - 3, '#c7a368');
  rect(ctx, 1.5, h / 2 - 0.5, w - 3, 1, '#8a6a3c');
});
for (let v = 0; v < 2; v++) {
  frame(`pallets-${v}`, 30, 30, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#8a6a3c');
    const wrap = v === 0 ? '#c7a368' : '#d8dee4';
    rect(ctx, 2, 2, w / 2 - 3, h / 2 - 3, wrap);
    rect(ctx, w / 2 + 1, 2, w / 2 - 3, h / 2 - 3, wrap);
    rect(ctx, 2, h / 2 + 1, w / 2 - 3, h / 2 - 3, wrap);
    rect(ctx, w / 2 + 1, h / 2 + 1, w / 2 - 3, h / 2 - 3, v === 0 ? '#b8935a' : wrap);
  });
}

// Dockers in hi-vis and hard hats, facing right: standing, and two strides of walking.
export const DOCKER_VESTS = 3;
const VESTS = ['#ff7b00', '#e8e83a', '#9be03a'];
const HATS = ['#f4f4f4', '#ffd23f', '#f4f4f4'];
for (let v = 0; v < DOCKER_VESTS; v++) {
  for (const pose of ['s', '0', '1'] as const) {
    frame(`docker-${v}-${pose}`, 16, 16, (ctx) => {
      const stride = pose === '0' ? 3 : pose === '1' ? -3 : 0;
      // Feet showing ahead and behind as they walk.
      if (pose !== 's') {
        ellipse(ctx, 8 + stride, 5, 2.2, 1.6, '#2b2b2b');
        ellipse(ctx, 8 - stride, 11, 2.2, 1.6, '#2b2b2b');
      }
      // Arms swinging the other way to the feet.
      circle(ctx, 8 - stride * 0.6, 3, 1.7, '#3d4148');
      circle(ctx, 8 + stride * 0.6, 13, 1.7, '#3d4148');
      ellipse(ctx, 8, 8, 5, 6.5, '#2b2b2b');
      ellipse(ctx, 8, 8, 4, 5.5, VESTS[v]);
      rect(ctx, 6.5, 3, 1.2, 10, 'rgba(255,255,255,0.7)');
      circle(ctx, 8.5, 8, 3.4, '#2b2b2b');
      circle(ctx, 8.5, 8, 2.8, HATS[v]);
      rect(ctx, 10.5, 7, 2, 2, HATS[v]);
    });
  }
}

// Concrete jersey barriers lining the road (one in three painted with warning chevrons).
for (let v = 0; v < 3; v++) {
  frame(`jersey-${v}`, 30, 18, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#5f5c56');
    rect(ctx, 1, 2, w - 2, h - 4, '#8c8981');
    rect(ctx, 1, h / 2 - 2.5, w - 2, 5, '#b3b0a8');
    if (v === 2) {
      ctx.fillStyle = '#e0a100';
      for (let x = -h; x < w; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, h - 3);
        ctx.lineTo(x + 5, h - 3);
        ctx.lineTo(x + 5 + h - 6, 3);
        ctx.lineTo(x + h - 6, 3);
        ctx.fill();
      }
      rect(ctx, 1, h / 2 - 2.5, w - 2, 5, '#b3b0a8');
    }
    rect(ctx, 0, 0, 1.5, h, '#4a4843');
  });
}

// Oil drums: knocked about on the road, heavier than cones.
const DRUMS = ['#1f5f99', '#a63d2b', '#e0a100'];
DRUMS.forEach((color, v) => {
  frame(`drum-${v}`, 30, 30, (ctx) => {
    circle(ctx, 15, 15, 14.5, '#2b2b2b');
    circle(ctx, 15, 15, 13, color);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(15, 15, 9.5, 0, Math.PI * 2);
    ctx.stroke();
    circle(ctx, 20, 11, 2.2, '#cfcfcf');
    ellipse(ctx, 10, 10, 4, 2.5, 'rgba(255,255,255,0.25)', -0.6);
  });
});

// Clutter about the yards. Wooden crates stacked on a pallet.
for (let v = 0; v < 2; v++) {
  frame(`crates-${v}`, 36, 36, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#6b5130');
    const wood = v === 0 ? ['#b8935a', '#a8834f'] : ['#9c7a46', '#c7a368'];
    const boxes = v === 0 ? [[2, 2, 15, 15], [19, 2, 15, 15], [2, 19, 32, 15]] : [[2, 2, 32, 15], [2, 19, 15, 15], [19, 19, 15, 15]];
    boxes.forEach(([x, y, bw, bh], k) => {
      rect(ctx, x, y, bw, bh, wood[k % 2]);
      ctx.strokeStyle = 'rgba(60,40,20,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      ctx.beginPath();
      ctx.moveTo(x + 1.5, y + 1.5);
      ctx.lineTo(x + bw - 1.5, y + bh - 1.5);
      ctx.stroke();
    });
  });
}
// Cable reels on their sides, seen from above as drums of wound cable.
for (let v = 0; v < 2; v++) {
  frame(`reels-${v}`, 30, 30, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#8a6a3c');
    rect(ctx, 4, 2, w - 8, h - 4, v === 0 ? '#2b2b2b' : '#a63d2b');
    for (let y = 4; y < h - 3; y += 3) rect(ctx, 4, y, w - 8, 1, 'rgba(255,255,255,0.18)');
    rect(ctx, 0, 0, 4, h, '#a8834f');
    rect(ctx, w - 4, 0, 4, h, '#a8834f');
    rect(ctx, 0, h / 2 - 2, w, 4, '#5e4528');
  });
}
// A cluster of oil drums on a pallet.
frame('drums-0', 40, 40, (ctx, w, h) => {
  rect(ctx, 1, 1, w - 2, h - 2, '#8a6a3c');
  [[11, 11, 0], [29, 11, 1], [11, 29, 2], [29, 29, 0]].forEach(([x, y, c]) => {
    circle(ctx, x, y, 9, '#2b2b2b');
    circle(ctx, x, y, 8, DRUMS[c]);
    circle(ctx, x + 3, y - 3, 1.5, '#cfcfcf');
    ellipse(ctx, x - 3, y - 3, 3, 1.8, 'rgba(255,255,255,0.25)', -0.6);
  });
});
// Site offices: a portacabin's ribbed roof, with an air-con unit on top.
for (let v = 0; v < 2; v++) {
  frame(`portacabin-${v}`, 72, 30, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#4a4e55');
    rect(ctx, 1.5, 1.5, w - 3, h - 3, v === 0 ? '#c9ccd1' : '#2f6db3');
    for (let x = 6; x < w - 3; x += 6) rect(ctx, x, 2, 1, h - 4, 'rgba(0,0,0,0.15)');
    rect(ctx, 10, 9, 12, 12, '#7b8089');
    circle(ctx, 16, 15, 4.5, '#3d4148');
  });
}
// Steel coils lying in a row in their cradles.
frame('coils-0', 56, 24, (ctx, w, h) => {
  rect(ctx, 0, 2, w, 3, '#5e4528');
  rect(ctx, 0, h - 5, w, 3, '#5e4528');
  for (let k = 0; k < 3; k++) {
    const x = 2 + k * 18;
    rect(ctx, x, 0, 16, h, '#9aa3ad');
    for (let y = 2; y < h - 1; y += 3) rect(ctx, x, y, 16, 1, 'rgba(255,255,255,0.3)');
    rect(ctx, x + 6, 0, 4, h, '#5f646c');
  }
});
// Works vans facing right: a bonnet, the windscreen and a long roof.
const VANS = ['#f4f4f4', '#e0a100', '#1f5f99'];
VANS.forEach((color, v) => {
  frame(`van-${v}`, 50, 22, (ctx, w, h) => {
    rect(ctx, 1, 1, w - 2, h - 2, '#2b2b2b');
    rect(ctx, 2, 2, w - 4, h - 4, color);
    rect(ctx, w - 15, 3, 5, h - 6, '#2b2d42');
    rect(ctx, w - 9, 3, 6, h - 6, color);
    rect(ctx, 6, 5, w - 24, h - 10, 'rgba(0,0,0,0.08)');
    if (v === 1) rect(ctx, w - 18, h / 2 - 2, 3, 4, '#ff7b00');
  });
});

// A street lamp seen from above: the post at the bottom, its arm reaching forward to the lamp.
export const LAMP_POST = 38;
frame('lamp', 14, 46, (ctx) => {
  rect(ctx, 5.5, 8, 3, LAMP_POST - 8, '#5f646c');
  circle(ctx, 7, LAMP_POST, 5, '#4a4e55');
  circle(ctx, 7, LAMP_POST, 2.5, '#7b8089');
  rect(ctx, 1, 1, 12, 11, '#3d4148');
  rect(ctx, 3, 3, 8, 7, '#fff3b0');
});

// A wooden pontoon: planks across it, on floats, with a cleat at each corner.
frame('pontoon-0', 26, 120, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#5e4528');
  for (let y = 1; y < h - 1; y += 6) rect(ctx, 1, y, w - 2, 4.5, y % 12 === 1 ? '#8a6a45' : '#7d5f3c');
  for (const [x, y] of [[3, 4], [w - 3, 4], [3, h - 4], [w - 3, h - 4], [3, h / 2], [w - 3, h / 2]]) circle(ctx, x, y, 2, '#2b2b2b');
});

// Paint on the yards: parking bays, a hatched no-parking box, and a SLOW arrow.
frame('marking-0', 128, 128, (ctx) => {
  ctx.strokeStyle = 'rgba(224,181,42,0.7)';
  ctx.lineWidth = 3;
  for (let x = 14; x <= 114; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, 70);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(14, 20);
  ctx.lineTo(114, 20);
  ctx.stroke();
});
frame('marking-1', 128, 128, (ctx) => {
  ctx.strokeStyle = 'rgba(224,181,42,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, 80, 80);
  ctx.save();
  ctx.beginPath();
  ctx.rect(24, 24, 80, 80);
  ctx.clip();
  ctx.lineWidth = 2.5;
  for (let k = -80; k < 80; k += 14) {
    ctx.beginPath();
    ctx.moveTo(24 + k, 104);
    ctx.lineTo(104 + k, 24);
    ctx.stroke();
  }
  ctx.restore();
});
frame('marking-2', 128, 128, (ctx) => {
  ctx.fillStyle = 'rgba(240,240,240,0.65)';
  ctx.beginPath();
  ctx.moveTo(64, 14);
  ctx.lineTo(84, 40);
  ctx.lineTo(71, 40);
  ctx.lineTo(71, 70);
  ctx.lineTo(57, 70);
  ctx.lineTo(57, 40);
  ctx.lineTo(44, 40);
  ctx.fill();
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SLOW', 64, 100);
});
export const MARKINGS = 3;

// Dock water, one plot's worth, in four shimmers: the same swells, with ripples
// catching the light in different places. Nothing crosses the edges, so plots tile.
export const WATER_FRAMES = 4;
for (let f = 0; f < WATER_FRAMES; f++) {
  frame(`water-${f}`, 128, 128, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#2a5a6e');
    const swells = seeded(97);
    for (let k = 0; k < 7; k++) {
      const r = 14 + swells() * 18;
      const x = r + swells() * (w - r * 2);
      const y = r * 0.4 + swells() * (h - r * 0.8);
      ellipse(ctx, x, y, r, r * 0.4, 'rgba(20,60,75,0.35)');
    }
    const ripples = seeded(31);
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 18; k++) {
      const len = 8 + ripples() * 12;
      const x = 2 + ripples() * (w - len - 4);
      const y = 4 + ripples() * (h - 8);
      // Each ripple brightens and fades in turn across the frames.
      const lit = (k + f) % WATER_FRAMES;
      ctx.strokeStyle = `rgba(190,225,235,${[0.45, 0.25, 0.12, 0.25][lit]})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y - 2.5, x + len, y);
      ctx.stroke();
    }
  });
}

/** The concrete yards, as a tiling texture under everything: slabs of slightly different shades, with their joints. */
export const CONCRETE_TEXTURE = 'harbour-concrete';

export function createConcreteTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CONCRETE_TEXTURE)) return;
  const T = 256;
  const texture = scene.textures.createCanvas(CONCRETE_TEXTURE, T, T)!;
  const ctx = texture.getContext();
  const shades = ['#b4b1a8', '#bab7ae', '#aeaba2', '#b7b4ab'];
  for (let k = 0; k < 4; k++) rect(ctx, (k % 2) * 128, Math.floor(k / 2) * 128, 128, 128, shades[k]);
  for (const at of [0, 128]) {
    rect(ctx, 0, at, T, 1.5, '#9a978f');
    rect(ctx, at, 0, 1.5, T, '#9a978f');
  }
  for (const at of [64, 192]) {
    rect(ctx, 0, at, T, 1, 'rgba(154,151,143,0.5)');
    rect(ctx, at, 0, 1, T, 'rgba(154,151,143,0.5)');
  }
  texture.refresh();
}
