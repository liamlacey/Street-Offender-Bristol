/**
 * Art for the woods, drawn in code: tree tops, log piles and timber stacks,
 * cabins, camps, deer, straw bales, rocks, and the little
 * things that animate (water ripples, leaves, birds, campfire flames).
 * Packed onto the same texture as the rest of the decoration (see
 * decorationArt.ts). Things that face the track have their front along the
 * top edge; animals and birds face right.
 */

import { type FrameSpec, circle, ellipse, pick, rect, seeded } from './artKit';

export const WOODS_VARIANTS = {
  canopy: 6,
  logs: 3,
  logstack: 2,
  cabin: 2,
  tent: 3,
  camper: 3,
  logend: 3,
  rock: 3,
  leaf: 4,
};

/** Campfire flame frames. */
export const FIRE_FRAMES = 3;

const BARK = ['#5b3d22', '#6b4a2b', '#4e341d'];
const WOOD = '#c9a26a';
const RINGS = '#a57c45';

export const WOODS_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => WOODS_FRAMES.push({ name, w, h, draw });

// Tree tops, seen from above: broadleaf clumps (one autumnal), and pines.
const BROADLEAF = [
  ['#1f4a1d', '#2e6629', '#46863a', '#6aa84f'],
  ['#2a4a1c', '#3d6627', '#567f34', '#7d9f45'],
  ['#5a3a17', '#8a5a1f', '#c07a26', '#e3a83b'],
];
const PINE = ['#163020', '#21432b', '#2f5a37', '#4b7a4a'];
for (let v = 0; v < 6; v++) {
  frame(`canopy-${v}`, 128, 128, (ctx) => {
    const rand = seeded(v * 7919 + 101);
    if (v < 3) {
      const [dark, mid, light, top] = BROADLEAF[v];
      const crowns = Array.from({ length: 4 + Math.floor(rand() * 3) }, () => {
        const a = rand() * Math.PI * 2;
        const r = rand() * 28;
        return { x: 64 + Math.cos(a) * r, y: 64 + Math.sin(a) * r, r: 22 + rand() * 12 };
      });
      // Lumpy outlines in the darkest green, then lighter leaves towards the light (top left).
      for (const c of crowns) {
        circle(ctx, c.x, c.y, c.r, dark);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + rand();
          circle(ctx, c.x + Math.cos(a) * c.r * 0.8, c.y + Math.sin(a) * c.r * 0.8, c.r * 0.35, dark);
        }
      }
      for (const c of crowns) circle(ctx, c.x - c.r * 0.12, c.y - c.r * 0.12, c.r * 0.78, mid);
      for (const c of crowns) {
        for (let k = 0; k < 5; k++) {
          const a = rand() * Math.PI * 2;
          const r = rand() * c.r * 0.5;
          circle(ctx, c.x - c.r * 0.25 + Math.cos(a) * r, c.y - c.r * 0.25 + Math.sin(a) * r, c.r * 0.28, light);
        }
        circle(ctx, c.x - c.r * 0.4, c.y - c.r * 0.4, c.r * 0.14, top);
      }
    } else {
      // Pines: layered stars of needles.
      const trees = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => {
        const a = rand() * Math.PI * 2;
        const r = rand() * 26;
        return { x: 64 + Math.cos(a) * r, y: 64 + Math.sin(a) * r, r: 26 + rand() * 10, turn: rand() };
      });
      for (const [layer, color] of PINE.entries()) {
        for (const t of trees) {
          const spikes = 12;
          const outer = t.r * (1 - layer * 0.24);
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let k = 0; k < spikes * 2; k++) {
            const a = (k / (spikes * 2)) * Math.PI * 2 + t.turn + layer * 0.3;
            const r = k % 2 === 0 ? outer : outer * 0.62;
            const x = t.x - layer * 1.5 + Math.cos(a) * r;
            const y = t.y - layer * 1.5 + Math.sin(a) * r;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      for (const t of trees) circle(ctx, t.x - 5, t.y - 5, 2.5, '#6b8f5a');
    }
  });
}

/** A log lying along x, from x0 to x1, centred on y, with a cut end on the right. */
function log(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, r: number, bark: string): void {
  ctx.fillStyle = bark;
  ctx.fillRect(x0, y - r, x1 - x0, r * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x0, y + r * 0.35, x1 - x0, r * 0.65);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x0, y - r, x1 - x0, r * 0.4);
  ellipse(ctx, x1, y, r * 0.55, r, WOOD);
  ctx.strokeStyle = RINGS;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(x1, y, r * 0.3, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
}

for (let v = 0; v < WOODS_VARIANTS.logs; v++) {
  frame(`logs-${v}`, 76, 26, (ctx, w) => {
    const rand = seeded(v * 31 + 7);
    // A bottom layer of three and two on top, slightly uneven.
    for (const y of [5, 13, 21]) log(ctx, 2 + rand() * 4, w - 4 - rand() * 4, y, 4.5, pick(BARK, rand));
    for (const y of [9, 17]) log(ctx, 8 + rand() * 6, w - 8 - rand() * 6, y, 4.5, pick(BARK, rand));
  });
}

for (let v = 0; v < WOODS_VARIANTS.logstack; v++) {
  frame(`logstack-${v}`, 130, 46, (ctx, w) => {
    const rand = seeded(v * 97 + 3);
    for (let row = 0; row < 5; row++) log(ctx, 3 + rand() * 6, w - 6 - rand() * 4, 5 + row * 9, 5, pick(BARK, rand));
    // Posts holding the stack in place.
    for (const x of [24, w - 30]) rect(ctx, x, 0, 4, 46, '#3b2a18');
  });
}

for (let v = 0; v < WOODS_VARIANTS.cabin; v++) {
  frame(`cabin-${v}`, 96, 72, (ctx, w, h) => {
    const [front, back] = v === 0 ? ['#7b5a3a', '#5e432a'] : ['#5f6b4e', '#46523a'];
    rect(ctx, 0, 0, w, h / 2, front);
    rect(ctx, 0, h / 2, w, h / 2, back);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 4; x < w; x += 8) ctx.fillRect(x, 0, 1.5, h);
    rect(ctx, 0, h / 2 - 1.5, w, 3, '#3b2a18');
    // Moss, and a stone chimney.
    ctx.fillStyle = 'rgba(80,120,50,0.6)';
    for (const [x, y] of [[12, 8], [70, 50], [40, 58]]) ctx.fillRect(x, y, 10, 5);
    rect(ctx, w - 26, h / 2 + 6, 14, 14, '#7d7a72');
    rect(ctx, w - 23, h / 2 + 9, 8, 8, '#2a2725');
  });
}

const TENTS = [['#e76f51', '#c4512f'], ['#2a9d8f', '#1f7a6f'], ['#e9c46a', '#c9a24a']];
for (let v = 0; v < WOODS_VARIANTS.tent; v++) {
  frame(`tent-${v}`, 44, 44, (ctx, w, h) => {
    const [light, dark] = TENTS[v];
    ctx.strokeStyle = 'rgba(220,220,220,0.7)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const [x, y] of [[2, 2], [w - 2, 2], [2, h - 2], [w - 2, h - 2]]) {
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(w - 8, 8);
    ctx.lineTo(w - 8, h / 2);
    ctx.lineTo(8, h / 2);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(8, h / 2, w - 16, h / 2 - 8);
    rect(ctx, 8, h / 2 - 1, w - 16, 2, '#333');
  });
}

for (let f = 0; f < FIRE_FRAMES; f++) {
  frame(`campfire-${f}`, 30, 30, (ctx) => {
    const rand = seeded(f * 13 + 5);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      circle(ctx, 15 + Math.cos(a) * 11, 15 + Math.sin(a) * 11, 3, k % 2 ? '#8a8780' : '#6d6a63');
    }
    circle(ctx, 15, 15, 8, '#2b2420');
    for (let k = 0; k < 6; k++) circle(ctx, 15 + (rand() - 0.5) * 8, 15 + (rand() - 0.5) * 8, 2.5 + rand() * 2.5, '#ff7b00');
    for (let k = 0; k < 4; k++) circle(ctx, 15 + (rand() - 0.5) * 6, 15 + (rand() - 0.5) * 6, 1.5 + rand() * 1.5, '#ffd23f');
  });
}

const CAMPERS = ['#f1faee', '#a8dadc', '#e9c46a'];
for (let v = 0; v < WOODS_VARIANTS.camper; v++) {
  frame(`camper-${v}`, 78, 34, (ctx, w, h) => {
    rect(ctx, 0, 2, w, h - 4, CAMPERS[v]);
    rect(ctx, w - 14, 4, 10, h - 8, '#9fd3ff'); // windscreen
    rect(ctx, 10, 6, 40, h - 12, 'rgba(0,0,0,0.12)'); // roof rack
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    for (let x = 12; x < 50; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h - 6);
      ctx.stroke();
    }
    rect(ctx, 54, 9, 8, 8, '#cfe8ff');
  });
}

for (let v = 0; v < WOODS_VARIANTS.logend; v++) {
  frame(`logend-${v}`, 32, 32, (ctx) => {
    circle(ctx, 16, 16, 15, BARK[v]);
    circle(ctx, 16, 16, 12, WOOD);
    ctx.strokeStyle = RINGS;
    ctx.lineWidth = 1;
    for (const r of [3, 6, 9]) {
      ctx.beginPath();
      ctx.arc(16 + v * 0.5, 16, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    rect(ctx, 16, 5, 1, 9, 'rgba(60,40,20,0.6)'); // a crack
  });
}

for (let v = 0; v < WOODS_VARIANTS.rock; v++) {
  frame(`rock-${v}`, 32, 32, (ctx) => {
    const rand = seeded(v * 211 + 9);
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
    shape(15, 0, '#5d605f');
    shape(11, -2, '#7a7d7b');
    shape(5, -5, '#9a9d9a');
  });
}

frame('bale', 18, 18, (ctx) => {
  rect(ctx, 1, 2, 16, 14, '#d8b85a');
  ctx.fillStyle = 'rgba(150,110,40,0.5)';
  for (let y = 4; y < 16; y += 3) ctx.fillRect(1, y, 16, 1);
  rect(ctx, 5, 2, 1.5, 14, '#8a5a2b');
  rect(ctx, 12, 2, 1.5, 14, '#8a5a2b');
});

frame('roundbale', 32, 32, (ctx) => {
  circle(ctx, 16, 16, 15, '#c9a648');
  ctx.strokeStyle = 'rgba(130,95,35,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 7; a += 0.2) {
    const r = 1 + a * 0.62;
    const x = 16 + Math.cos(a) * r;
    const y = 16 + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
});

// Deer, facing right: grazing (head down), alert (head up, ears out), and two running strides.
const DEER = { body: '#8b5a2b', dark: '#5e3b1b', belly: '#c79a6b' };
for (const pose of ['graze', 'alert', 'run-0', 'run-1'] as const) {
  frame(`deer-${pose}`, 48, 26, (ctx) => {
    const running = pose.startsWith('run');
    const stride = pose === 'run-0' ? 1 : -1;
    if (running) {
      ctx.strokeStyle = DEER.dark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [x, dy] of [[12, 1], [28, -1]]) {
        ctx.moveTo(x, 13 + dy * 3);
        ctx.lineTo(x + stride * 7, 13 + dy * 8);
        ctx.moveTo(x, 13 - dy * 3);
        ctx.lineTo(x - stride * 7, 13 - dy * 8);
      }
      ctx.stroke();
    }
    ellipse(ctx, 21, 13, running ? 15 : 13, 6, DEER.body);
    ellipse(ctx, 21, 14, 9, 3, DEER.belly);
    circle(ctx, 7, 13, 2.5, '#f2ece0'); // tail
    const headX = pose === 'graze' ? 39 : 37;
    ellipse(ctx, pose === 'graze' ? 33 : 32, 13, 4, 3, DEER.body); // neck
    ellipse(ctx, headX, 13, 5, 3.2, DEER.body);
    circle(ctx, headX + 4, 13, 1.3, '#2a1a0e'); // nose
    if (pose !== 'graze') {
      ellipse(ctx, headX - 2, 9, 1.6, 3, DEER.dark, 0.5);
      ellipse(ctx, headX - 2, 17, 1.6, 3, DEER.dark, -0.5);
    }
  });
}

// Bits that move: ripples carried along by the water, glints on puddles, leaves, birds.
frame('ripple', 18, 6, (ctx) => {
  ctx.strokeStyle = 'rgba(235,245,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(1, 4);
  ctx.quadraticCurveTo(9, 0, 17, 4);
  ctx.stroke();
});
frame('glint', 12, 5, (ctx) => ellipse(ctx, 6, 2.5, 5.5, 2, 'rgba(255,255,255,0.8)'));
const LEAVES = ['#d98e2b', '#c2551f', '#e3c04a', '#7c9a3a'];
for (let v = 0; v < WOODS_VARIANTS.leaf; v++) {
  frame(`leaf-${v}`, 10, 7, (ctx) => {
    ellipse(ctx, 5, 3.5, 4.5, 2.6, LEAVES[v], 0.3);
    rect(ctx, 1, 3, 8, 0.8, 'rgba(0,0,0,0.25)');
  });
}
for (const f of [0, 1]) {
  frame(`bird-${f}`, 22, 14, (ctx) => {
    ctx.strokeStyle = '#1d1d1f';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Seen from above, flying right: wings swept forward then back.
    const tip = f === 0 ? 1 : 4;
    ctx.moveTo(12 - tip, 1);
    ctx.quadraticCurveTo(10, 5, 12, 7);
    ctx.quadraticCurveTo(10, 9, 12 - tip, 13);
    ctx.stroke();
    ellipse(ctx, 12, 7, 6, 2, '#1d1d1f');
  });
}

// --- Forestry ---------------------------------------------------------------
// Worksites in the trees: the cleared ground and logging tracks, the timber
// lorry and its loads, the loader that fills it, a harvester, felled trunks,
// and the sawdust the crews throw up. Machines face right.

const DIRT = ['#7a5f3d', '#6d5434', '#86694a'];
const SAWDUST = '#d8b77e';
const HI_VIS = '#e8a21a';

/** Churned ground with soft edges, stumps and sawdust: stretched over a clearing. */
frame('clearing', 160, 106, (ctx, w, h) => {
  const rand = seeded(4111);
  // Blobs, thinner towards the edges, so it fades into the forest floor.
  for (let k = 0; k < 420; k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = w / 2 + Math.cos(a) * r * (w / 2 - 6);
    const y = h / 2 + Math.sin(a) * r * (h / 2 - 6);
    ctx.globalAlpha = 0.9 * (1 - r ** 3);
    ellipse(ctx, x, y, 4 + rand() * 7, 3 + rand() * 5, pick(DIRT, rand), rand() * 3);
  }
  ctx.globalAlpha = 0.5;
  for (let k = 0; k < 60; k++) {
    const r = Math.sqrt(rand()) * 0.8;
    const a = rand() * Math.PI * 2;
    circle(ctx, w / 2 + Math.cos(a) * r * w * 0.5, h / 2 + Math.sin(a) * r * h * 0.5, 0.6 + rand() * 1.2, SAWDUST);
  }
  ctx.globalAlpha = 1;
  // Stumps of the trees that were here.
  for (const [x, y] of [[22, 30], [138, 24], [30, 84], [70, 96], [146, 80], [112, 14], [12, 58]]) {
    circle(ctx, x, y, 4.2, '#4e341d');
    circle(ctx, x, y, 3.2, WOOD);
    circle(ctx, x, y, 1.4, RINGS);
  }
});

/** A logging track: two ruts with a strip of weeds between, soft at the sides. Stretched along its length. */
frame('trail', 64, 34, (ctx, w, h) => {
  const across = ctx.createLinearGradient(0, 0, 0, h);
  across.addColorStop(0, 'rgba(109,84,52,0)');
  across.addColorStop(0.18, 'rgba(109,84,52,0.85)');
  across.addColorStop(0.82, 'rgba(109,84,52,0.85)');
  across.addColorStop(1, 'rgba(109,84,52,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, w, h);
  rect(ctx, 0, 8, w, 5, 'rgba(70,52,30,0.7)');
  rect(ctx, 0, h - 13, w, 5, 'rgba(70,52,30,0.7)');
  rect(ctx, 0, h / 2 - 2, w, 4, 'rgba(74,92,44,0.6)');
});
/** The far end of a logging track, fading out into the forest. */
frame('trail-end', 40, 34, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(109,84,52,0.85)');
  g.addColorStop(1, 'rgba(109,84,52,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 5, w, h - 10);
});

// A timber lorry facing right: the cab at the front, a flat bed with stakes behind.
frame('logtruck', 96, 26, (ctx, _w, h) => {
  rect(ctx, 2, 3, 74, h - 6, '#3d4148');
  for (let x = 6; x < 74; x += 17) {
    rect(ctx, x, 1, 3, 4, '#2b2b2b');
    rect(ctx, x, h - 5, 3, 4, '#2b2b2b');
  }
  rect(ctx, 76, 4, 4, h - 8, '#2b2b2b');
  rect(ctx, 80, 2, 15, h - 4, '#b5332a');
  rect(ctx, 84, 4, 6, h - 8, '#2b2d42');
  rect(ctx, 81, 3, 2, h - 6, 'rgba(255,255,255,0.25)');
});
// What's on the bed, a third of a load at a time.
for (let stage = 1; stage <= 3; stage++) {
  frame(`timber-${stage}`, 72, 22, (ctx, w) => {
    const rand = seeded(stage * 53 + 1);
    const rows = [[7, 15], [4, 11, 18], [5, 10, 14, 18]][stage - 1];
    for (const y of rows) log(ctx, rand() * 3, w - rand() * 4, y, 3.6, pick(BARK, rand));
  });
}

// The loader: tracks, and the cab and boom that turn on them (the pivot is in the cab).
frame('loader-tracks', 44, 40, (ctx, w, h) => {
  for (const y of [1, h - 11]) {
    rect(ctx, 0, y, w, 10, '#2b2b2b');
    for (let x = 2; x < w; x += 5) rect(ctx, x, y + 1, 2, 8, '#4a4e55');
  }
  rect(ctx, 6, 11, w - 12, h - 22, '#3d4148');
});
export const LOADER_BOOM = { pivot: 15, reach: 70 };
frame('loader-top', 88, 30, (ctx, _w, h) => {
  rect(ctx, LOADER_BOOM.pivot + 4, h / 2 - 3.5, LOADER_BOOM.reach - 4, 7, HI_VIS);
  rect(ctx, LOADER_BOOM.pivot + 4, h / 2 - 1, LOADER_BOOM.reach - 4, 2, 'rgba(0,0,0,0.25)');
  circle(ctx, LOADER_BOOM.pivot + LOADER_BOOM.reach, h / 2, 3, '#2b2b2b');
  rect(ctx, 1, 2, 26, h - 4, HI_VIS);
  rect(ctx, 1, 2, 7, h - 4, '#5f646c');
  rect(ctx, 12, 5, 12, 9, '#2b2d42');
  rect(ctx, 13, 6, 10, 3, '#9fd3ff');
});
frame('grapple', 16, 16, (ctx) => {
  rect(ctx, 2, 3, 12, 3, '#3d4148');
  rect(ctx, 2, 10, 12, 3, '#3d4148');
  circle(ctx, 8, 8, 3, '#2b2b2b');
});
frame('grapple-logs', 18, 46, (ctx, w, h) => {
  const rand = seeded(77);
  for (const x of [5, 9, 13]) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(Math.PI / 2);
    log(ctx, 2 + rand() * 3, h - 2 - rand() * 3, 0, 3.4, pick(BARK, rand));
    ctx.restore();
  }
  rect(ctx, 1, h / 2 - 3, w - 2, 6, '#3d4148');
});

// A harvester facing right: eight wheels, the body and cab, and its arm with the felling head.
frame('harvester', 60, 34, (ctx, w, h) => {
  for (const x of [6, 18, 36, 48]) {
    rect(ctx, x, 0, 9, 6, '#1d1d1f');
    rect(ctx, x, h - 6, 9, 6, '#1d1d1f');
  }
  rect(ctx, 2, 5, w - 6, h - 10, '#3f7a3a');
  rect(ctx, 2, 5, 18, h - 10, '#2f5a2c');
  rect(ctx, 34, 6, 18, h - 12, '#2b2d42');
  rect(ctx, 36, 8, 14, 5, '#9fd3ff');
  rect(ctx, 26, h / 2 - 1, 8, 2, '#1d1d1f');
});
export const HARVESTER_ARM = { pivot: 4, reach: 46 };
frame('harvester-arm', 52, 8, (ctx, _w, h) => {
  rect(ctx, HARVESTER_ARM.pivot, h / 2 - 3, HARVESTER_ARM.reach, 6, '#e3c04a');
  rect(ctx, HARVESTER_ARM.pivot, h / 2, HARVESTER_ARM.reach, 1.5, 'rgba(0,0,0,0.3)');
  circle(ctx, HARVESTER_ARM.pivot, h / 2, 3.5, '#3d4148');
});
frame('harvester-head', 18, 18, (ctx) => {
  rect(ctx, 3, 2, 12, 14, '#e3c04a');
  rect(ctx, 6, 0, 6, 18, '#3d4148');
  rect(ctx, 14, 6, 4, 6, '#7b8089');
});

// A felled trunk lying where it fell, its crown at the right.
for (let v = 0; v < 2; v++) {
  frame(`felled-${v}`, 112, 30, (ctx, _w, h) => {
    const rand = seeded(v * 211 + 9);
    const greens = v === 0 ? PINE : BROADLEAF[0];
    for (let k = 0; k < 26; k++) {
      const x = 68 + rand() * 40;
      const y = h / 2 + (rand() - 0.5) * (h - 8) * ((x - 60) / 50);
      circle(ctx, x, y, 3 + rand() * 4, pick(greens.slice(0, 3), rand));
    }
    log(ctx, 6, 74, h / 2, 5, pick(BARK, rand));
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.scale(-1, 1);
    ellipse(ctx, 0, 0, 2.6, 5, WOOD);
    ctx.restore();
  });
}
// A chainsaw, held out in front.
frame('chainsaw', 14, 6, (ctx, w, h) => {
  rect(ctx, 0, 0, 6, h, '#e8661a');
  rect(ctx, 6, 1.5, w - 6, h - 3, '#9aa3ad');
});
// A chip of sawdust.
frame('chip', 4, 3, (ctx) => ellipse(ctx, 2, 1.5, 2, 1.2, SAWDUST));
