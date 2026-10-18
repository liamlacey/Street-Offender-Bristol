/**
 * The art for the race circuit: drawn in code like the rest. Grandstands and
 * spectators (with cheering frames), fences and tape, the pits, advertising
 * boards, tyre stacks, marshals, flags, the start banner, and race day around
 * the track (parked cars, fans, stalls, big screens, marquees, gazebos, the
 * TV helicopter and a blimp) go on the scenery texture (decorationArt.ts
 * packs them); tyre walls and mown grass are textures of their own.
 */

import * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type Draw, type FrameSpec, circle, ellipse, pick, rect, seeded } from '../scenes/artKit';

/** How many looks each kind of picture comes in. */
export const CIRCUIT_VARIANTS = {
  stand: 4,
  crowd: 4,
  board: 6,
  flag: 4,
  tyres: 3,
  parked: 12,
  fan: 8,
  stall: 4,
  screen: 4,
  marquee: 2,
  gazebo: 3,
};

/** Grandstand rows: how far back each one starts, and how deep it is. */
export const STAND_ROWS = { first: 9, depth: 15, count: 4 };
export const CROWD_HEIGHT = 12;

const SHIRTS = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#e76f51', '#8338ec', '#fb5607', '#ffffff', '#1d3557', '#06d6a0', '#ef476f'];
const HAIR = ['#2b1d14', '#4a2f1d', '#111111', '#c9a227', '#8c5a2b', '#9a9a9a', '#e63946', '#1d3557'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const SEATS = ['#2f5fa7', '#c1272d', '#e0a100', '#2e8b57'];
/** Team colours, for the pits. */
const TEAMS = ['#e63946', '#1d3557', '#f4a261', '#2a9d8f', '#f1faee'];
const BRANDS: [string, string, string][] = [
  ['TURBO OIL', '#111111', '#ffd23f'],
  ['GRIPMAX', '#d7263d', '#ffffff'],
  ['TRACK FM', '#1d3557', '#a8dadc'],
  ['NITRO COLA', '#2b2d42', '#ef233c'],
  ['APEX TYRES', '#ffd23f', '#111111'],
  ['PADDOCK', '#ffffff', '#1d6fb8'],
];
const FLAGS = ['chequered', '#d7263d', '#1d6fb8', '#ffd23f'];

/**
 * A row of spectators seen from above, facing the top edge. `cheering`
 * draws the same people with their arms up (and some waving flags), so
 * swapping between the two frames animates them.
 */
function crowd(variant: number, cheering: boolean): Draw {
  return (ctx, w) => {
    const rand = seeded(variant * 7919 + 13);
    let x = 4 + rand() * 3;
    while (x < w - 4) {
      const empty = rand() < 0.12;
      const shirt = pick(SHIRTS, rand);
      const hair = pick(HAIR, rand);
      const skin = pick(SKIN, rand);
      const flag = rand() < 0.15 ? pick(SHIRTS, rand) : null;
      const jumps = rand() < 0.6;
      if (!empty) {
        const y = 7 - (cheering && jumps ? 1 : 0);
        if (cheering) {
          circle(ctx, x - 3.5, y - 4, 1.4, skin);
          circle(ctx, x + 3.5, y - 4, 1.4, skin);
          if (flag) rect(ctx, x + 3, y - 7.5, 5, 3, flag);
        }
        ctx.fillStyle = shirt;
        ctx.beginPath();
        ctx.ellipse(x, y, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        circle(ctx, x, y - 0.5, 2.2, hair);
      }
      x += 8 + rand() * 2.5;
    }
  };
}

/** What the start banner says. */
export const BANNER_TEXT = 'START';


export const CIRCUIT_FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => CIRCUIT_FRAMES.push({ name, w, h, draw });

for (let v = 0; v < CIRCUIT_VARIANTS.stand; v++) {
  CIRCUIT_FRAMES.push({
    name: `stand-${v}`,
    w: 240,
    h: 84,
    draw: (ctx, w, h) => {
      // Concrete steps, lighter towards the back, then the roof over the back.
      rect(ctx, 0, 0, w, h, '#7d828b');
      for (let r = 0; r < STAND_ROWS.count; r++) {
        const y = STAND_ROWS.first + r * STAND_ROWS.depth;
        rect(ctx, 0, y, w, STAND_ROWS.depth, ['#8d929b', '#979ca5', '#a1a6af', '#abb0b9'][r]);
        rect(ctx, 0, y + STAND_ROWS.depth - 1, w, 1, '#5f646c');
        for (let x = 3; x < w - 3; x += 8) rect(ctx, x, y + 3, 6, 6, SEATS[v]);
      }
      // Front wall with a painted stripe, and stairs up through the seats.
      rect(ctx, 0, 0, w, STAND_ROWS.first, '#f2f2f2');
      rect(ctx, 0, 3, w, 3, SEATS[(v + 1) % SEATS.length]);
      for (const x of [w / 3, (2 * w) / 3]) rect(ctx, x - 4, STAND_ROWS.first, 8, STAND_ROWS.depth * STAND_ROWS.count, '#c3c7cd');
      const roof = STAND_ROWS.first + STAND_ROWS.depth * STAND_ROWS.count;
      rect(ctx, 0, roof, w, h - roof, '#3d4148');
      rect(ctx, 0, roof, w, 2, '#e6e6e6');
      for (let x = 10; x < w; x += 20) rect(ctx, x, roof + 4, 1, h - roof - 6, '#4b5058');
      rect(ctx, 0, 0, 3, h, '#5f646c');
      rect(ctx, w - 3, 0, 3, h, '#5f646c');
    },
  });
}

for (let v = 0; v < CIRCUIT_VARIANTS.crowd; v++) {
  for (const cheering of [false, true]) {
    CIRCUIT_FRAMES.push({ name: `crowd-${v}-${cheering ? 1 : 0}`, w: 232, h: CROWD_HEIGHT, draw: crowd(v, cheering) });
    CIRCUIT_FRAMES.push({ name: `bank-${v}-${cheering ? 1 : 0}`, w: 196, h: CROWD_HEIGHT, draw: crowd(v + 10, cheering) });
  }
}

CIRCUIT_FRAMES.push({
  name: 'fence',
  w: 200,
  h: 4,
  draw: (ctx, w) => {
    rect(ctx, 0, 1, w, 2, 'rgba(220,224,230,0.85)');
    for (let x = 0; x <= w; x += 20) rect(ctx, Math.min(x, w - 3), 0, 3, 4, '#5f646c');
  },
});

CIRCUIT_FRAMES.push({
  name: 'pits',
  w: 480,
  h: 72,
  draw: (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#c9ccd1');
    const bays = 8;
    const bay = w / bays;
    for (let b = 0; b < bays; b++) {
      const x = b * bay;
      // Garage front: open door showing the dark inside, with the team's colour above.
      rect(ctx, x + 6, 0, bay - 12, 14, b % 3 === 0 ? '#9aa0a8' : '#22252a');
      rect(ctx, x + 2, 14, bay - 4, 4, TEAMS[b % TEAMS.length]);
      rect(ctx, x, 0, 2, h, '#9ea2a8');
    }
    rect(ctx, 0, 18, w, 2, '#9ea2a8');
    // Roof: plant, vents and a walkway.
    rect(ctx, 0, 44, w, 6, '#b3b7bd');
    for (let x = 30; x < w; x += 70) rect(ctx, x, 26, 22, 12, '#8f949b');
    for (let x = 60; x < w; x += 120) circle(ctx, x, 60, 5, '#8f949b');
    rect(ctx, w / 2 - 50, 22, 100, 16, '#1d3557');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIT LANE', w / 2, 30);
  },
});

for (let v = 0; v < CIRCUIT_VARIANTS.board; v++) {
  const [text, bg, fg] = BRANDS[v];
  CIRCUIT_FRAMES.push({
    name: `board-${v}`,
    w: 120,
    h: 10,
    draw: (ctx, w, h) => {
      rect(ctx, 0, 0, w, h, bg);
      ctx.fillStyle = fg;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 0.5);
    },
  });
}

for (let v = 0; v < CIRCUIT_VARIANTS.tyres; v++) {
  CIRCUIT_FRAMES.push({
    name: `tyres-${v}`,
    w: 40,
    h: 40,
    draw: (ctx) => {
      const spots = [
        [[12, 13], [28, 13], [20, 27]],
        [[11, 20], [29, 20]],
        [[13, 12], [27, 12], [13, 28], [27, 28]],
      ][v];
      for (const [x, y] of spots) {
        circle(ctx, x, y, 9, '#15171a');
        circle(ctx, x, y, 5, '#2c3036');
        circle(ctx, x, y, 2.5, '#15171a');
      }
    },
  });
}

CIRCUIT_FRAMES.push({
  name: 'marshal',
  w: 26,
  h: 26,
  draw: (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, '#f28c28');
    rect(ctx, 3, 3, w - 6, h - 6, '#f4f4f4');
    rect(ctx, 3, 3, w - 6, 4, '#d7263d');
  },
});

// A marshal waving a yellow flag, two poses.
for (const f of [0, 1]) {
  CIRCUIT_FRAMES.push({
    name: `marshal-${f}`,
    w: 22,
    h: 14,
    draw: (ctx) => {
      const flagX = f === 0 ? 2 : 14;
      rect(ctx, flagX, 1, 7, 5, '#ffd23f');
      ctx.fillStyle = '#f28c28';
      ctx.beginPath();
      ctx.ellipse(11, 9, 4.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      circle(ctx, f === 0 ? 7 : 15, 6, 1.5, '#f1c27d');
      circle(ctx, 11, 8.5, 2.3, '#f4f4f4'); // helmet
    },
  });
}

// Flags on poles, flapping: two frames of the cloth rippling.
for (let v = 0; v < CIRCUIT_VARIANTS.flag; v++) {
  for (const f of [0, 1]) {
    CIRCUIT_FRAMES.push({
      name: `flag-${v}-${f}`,
      w: 34,
      h: 16,
      draw: (ctx) => {
        const top = (x: number) => 3 + Math.sin(x / 5 + f * Math.PI) * 1.6;
        const cols = 8;
        for (let c = 0; c < cols; c++) {
          const x = 6 + c * 3.4;
          for (const r of [0, 1, 2]) {
            const color = FLAGS[v] === 'chequered' ? ((c + r) % 2 === 0 ? '#111111' : '#ffffff') : FLAGS[v];
            ctx.fillStyle = color;
            ctx.fillRect(x, top(x) + r * 3.4, 3.6, 3.6);
          }
          // Shading in the folds.
          ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.12 * Math.sin(x / 5 + f * Math.PI)})`;
          ctx.fillRect(x, top(x), 3.6, 10.2);
        }
        circle(ctx, 4, 8, 3, '#d9d9d9');
        circle(ctx, 4, 8, 1.5, '#7d828b');
      },
    });
  }
}

// Red and white tape on stakes, for spectators to stand behind.
frame('tape', 200, 4, (ctx, w) => {
  for (let x = 0; x < w; x += 10) rect(ctx, x, 1, 10, 2, (x / 10) % 2 === 0 ? '#d7263d' : '#f4f4f4');
  for (let x = 0; x <= w; x += 50) rect(ctx, Math.min(x, w - 3), 0, 3, 4, '#5b3d22');
});

frame('banner', 256, 20, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#b3261e');
  for (let k = 0; k < 4; k++) {
    for (const [x0, row] of [[0, 0], [w - 16, 0]]) {
      for (let c = 0; c < 2; c++) rect(ctx, x0 + c * 8, row + k * 5, 8, 5, (k + c) % 2 === 0 ? '#111' : '#fff');
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(BANNER_TEXT, w / 2, h / 2 + 1);
});


// --- Race day around the track ---------------------------------------------

// Fans' cars in the car parks, facing right.
const PARKED = ['#d7263d', '#1d3557', '#f1faee', '#2b2d42', '#9aa3ad', '#457b9d', '#e9c46a', '#2a9d8f', '#6d6875', '#e76f51', '#111111', '#c0c0c0'];
for (let v = 0; v < CIRCUIT_VARIANTS.parked; v++) {
  frame(`parked-${v}`, 40, 20, (ctx, w, h) => {
    for (const [x, y] of [[6, 0], [w - 13, 0], [6, h - 3], [w - 13, h - 3]]) rect(ctx, x, y, 7, 3, '#111111');
    ctx.fillStyle = PARKED[v];
    ctx.beginPath();
    ctx.roundRect(1, 2, w - 2, h - 4, 4);
    ctx.fill();
    rect(ctx, w - 14, 4.5, 5, h - 9, '#9fd3ff');
    rect(ctx, 7, 5, 4, h - 10, '#6fa8d6');
    rect(ctx, 12, 4.5, w - 27, h - 9, 'rgba(0,0,0,0.12)');
  });
}

// Fans facing right: standing, two strides of walking, and arms up cheering.
const FAN_SHIRTS = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#8338ec', '#fb5607', '#1d3557'];
for (let v = 0; v < CIRCUIT_VARIANTS.fan; v++) {
  for (const pose of ['s', '0', '1', 'c'] as const) {
    frame(`fan-${v}-${pose}`, 16, 16, (ctx) => {
      const stride = pose === '0' ? 3 : pose === '1' ? -3 : 0;
      const skin = SKIN[v % SKIN.length];
      if (pose === '0' || pose === '1') {
        ellipse(ctx, 8 + stride, 5, 2.2, 1.6, '#2b2b2b');
        ellipse(ctx, 8 - stride, 11, 2.2, 1.6, '#2b2b2b');
      }
      if (pose === 'c') {
        // Arms up, out in front.
        circle(ctx, 12, 3, 1.7, skin);
        circle(ctx, 12, 13, 1.7, skin);
      } else {
        circle(ctx, 8 - stride * 0.6, 3, 1.7, skin);
        circle(ctx, 8 + stride * 0.6, 13, 1.7, skin);
      }
      ellipse(ctx, 8, 8, 4.5, 6, FAN_SHIRTS[v]);
      circle(ctx, 8.5, 8, 3, HAIR[v % HAIR.length]);
      if (v % 3 === 0) {
        // A cap.
        circle(ctx, 8.5, 8, 3, FAN_SHIRTS[(v + 3) % FAN_SHIRTS.length]);
        rect(ctx, 10.5, 6.5, 2.5, 3, FAN_SHIRTS[(v + 3) % FAN_SHIRTS.length]);
      }
    });
  }
}

// Stalls: a striped awning over the counter (at the top, facing the queue).
const AWNINGS = [['#d7263d', '#f4f4f4'], ['#1d6fb8', '#f4f4f4'], ['#2a9d8f', '#ffd23f'], ['#f4a261', '#2b2d42']];
const STALL_SIGNS = ['BURGERS', 'COFFEE', 'MERCH', 'ICE CREAM'];
for (let v = 0; v < CIRCUIT_VARIANTS.stall; v++) {
  frame(`stall-${v}`, 64, 36, (ctx, w, h) => {
    rect(ctx, 0, 8, w, h - 8, '#c9ccd1');
    rect(ctx, 0, h - 4, w, 4, '#9ea2a8');
    for (let x = 0; x < w; x += 8) rect(ctx, x, 0, 8, 12, AWNINGS[v][(x / 8) % 2]);
    rect(ctx, 0, 12, w, 2, 'rgba(0,0,0,0.25)');
    rect(ctx, 8, 18, w - 16, 10, '#2b2d42');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STALL_SIGNS[v], w / 2, 23.5);
  });
}

// A big screen on its frame, and what it shows (the pictures change).
frame('screen', 100, 26, (ctx, w, h) => {
  rect(ctx, 8, h - 6, 6, 6, '#5f646c');
  rect(ctx, w - 14, h - 6, 6, 6, '#5f646c');
  rect(ctx, 0, 0, w, h - 4, '#1d1d1f');
  rect(ctx, 0, h - 6, w, 2, '#3d4148');
});
for (let v = 0; v < CIRCUIT_VARIANTS.screen; v++) {
  frame(`screen-${v}`, 92, 16, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, ['#1d6fb8', '#111111', '#d7263d', '#1d3557'][v]);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (v === 0) {
      // A car racing past.
      ctx.beginPath();
      ctx.roundRect(28, 4, 36, 9, 3);
      ctx.fill();
      rect(ctx, 30, 13, 6, 2, '#111111');
      rect(ctx, 54, 13, 6, 2, '#111111');
      rect(ctx, 8, 7, 14, 1.5, 'rgba(255,255,255,0.6)');
    } else if (v === 1) {
      for (let x = 0; x < w; x += 4) for (let y = 0; y < h; y += 4) if ((x + y) % 8 === 0) rect(ctx, x, y, 4, 4, '#ffffff');
    } else if (v === 2) {
      ctx.fillText('LIVE', w / 2, h / 2 + 1);
    } else {
      // The leaderboard.
      for (let r = 0; r < 3; r++) {
        rect(ctx, 6, 2 + r * 4.5, 8, 3.5, ['#ffd23f', '#c0c0c0', '#cd7f32'][r]);
        rect(ctx, 18, 2 + r * 4.5, 40 - r * 8, 3.5, '#f1faee');
      }
    }
  });
}

// Hospitality marquees: a white roof peaked along the middle, trimmed in team colours.
for (let v = 0; v < CIRCUIT_VARIANTS.marquee; v++) {
  frame(`marquee-${v}`, 96, 64, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h / 2, '#f4f4f4');
    rect(ctx, 0, h / 2, w, h / 2, '#dfe2e6');
    rect(ctx, 0, h / 2 - 1, w, 2, '#c3c7cd');
    for (let x = 16; x < w; x += 16) rect(ctx, x, 0, 1, h, 'rgba(0,0,0,0.06)');
    rect(ctx, 0, 0, w, 4, TEAMS[v * 2]);
    rect(ctx, 0, h - 4, w, 4, TEAMS[v * 2]);
  });
}

// Gazebos at the campsites: a square canopy pulled to a point in the middle.
const GAZEBOS = ['#1d6fb8', '#2a9d8f', '#d7263d'];
for (let v = 0; v < CIRCUIT_VARIANTS.gazebo; v++) {
  frame(`gazebo-${v}`, 40, 40, (ctx, w, h) => {
    const tri = (pts: number[][], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      ctx.fill();
    };
    const c = [w / 2, h / 2];
    tri([[0, 0], [w, 0], c], GAZEBOS[v]);
    tri([[w, 0], [w, h], c], '#f4f4f4');
    tri([[w, h], [0, h], c], GAZEBOS[v]);
    tri([[0, h], [0, 0], c], '#e6e6e6');
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  });
}

// The TV helicopter facing right, and its rotor (turned as it spins).
frame('heli', 56, 22, (ctx, _w, h) => {
  rect(ctx, 2, h / 2 - 1.5, 26, 3, '#2b2d42');
  rect(ctx, 0, h / 2 - 6, 4, 12, '#2b2d42');
  ellipse(ctx, 38, h / 2, 15, 8.5, '#1d6fb8');
  ellipse(ctx, 46, h / 2, 6, 6, '#9fd3ff');
  rect(ctx, 30, h / 2 - 1, 8, 2, '#f4f4f4');
  rect(ctx, 26, 1, 22, 2, '#3d4148');
  rect(ctx, 26, h - 3, 22, 2, '#3d4148');
});
frame('rotor', 64, 64, (ctx, w, h) => {
  ctx.strokeStyle = 'rgba(30,30,32,0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(2, h / 2);
  ctx.lineTo(w - 2, h / 2);
  ctx.moveTo(w / 2, 2);
  ctx.lineTo(w / 2, h - 2);
  ctx.stroke();
  circle(ctx, w / 2, h / 2, 3, '#1d1d1f');
});
// An advertising blimp, facing right.
frame('blimp', 170, 50, (ctx, w, h) => {
  for (const [y, sign] of [[4, -1], [h - 4, 1]]) {
    ctx.fillStyle = '#d7263d';
    ctx.beginPath();
    ctx.moveTo(12, h / 2 + sign * 6);
    ctx.lineTo(2, y);
    ctx.lineTo(24, h / 2 + sign * 8);
    ctx.fill();
  }
  ellipse(ctx, w / 2 + 4, h / 2, w / 2 - 8, h / 2 - 6, '#e6e8eb');
  ellipse(ctx, w / 2 + 4, h / 2 - 4, w / 2 - 16, h / 2 - 14, '#f7f8f9');
  rect(ctx, 40, h / 2 - 7, 96, 14, '#ffd23f');
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('APEX TYRES', 88, h / 2 + 1);
});

/** Texture keys of the circuit's own textures. */
export const CIRCUIT_TEX = { tyres: 'tyres' } as const;

/** Makes (once) the circuit's textures: a stack of tyres, for the tyre walls and loose tyres. */
export function createCircuitTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(CIRCUIT_TEX.tyres)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x15171a);
  g.fillCircle(16, 16, 16);
  g.fillStyle(0x2c3036);
  g.fillCircle(16, 16, 9);
  g.fillStyle(0x15171a);
  g.fillCircle(16, 16, 5);
  g.generateTexture(CIRCUIT_TEX.tyres, 32, 32);
  g.destroy();
}

/** Makes (once) and returns the key of a circuit's ground tile: mown grass stripes with darker tufts. */
export function mownGrassTexture(scene: Phaser.Scene, location: Location): string {
  const key = `mown-${location.id}`;
  if (scene.textures.exists(key)) return key;
  const { base, stripe, tuft } = location.ground;
  const g = scene.make.graphics({}, false);
  const T = 128;
  g.fillStyle(base);
  g.fillRect(0, 0, T, T);
  g.fillStyle(stripe);
  g.fillRect(0, 0, T / 2, T);
  g.fillStyle(tuft);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rand() * (T - 3)), Math.floor(rand() * (T - 3)), 3, 3);
  g.generateTexture(key, T, T);
  g.destroy();
  return key;
}
