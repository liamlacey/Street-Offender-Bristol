/**
 * Tank World's pictures, drawn in code onto one texture: the tank and its
 * rocket, and everything on the island in each state it can be in (standing,
 * hurt, wrecked, burnt), plus the bits that fly off. Lit from the top left.
 * Things that face somewhere face right.
 */

import type * as Phaser from 'phaser';
import { type FrameSpec, circle, ellipse, rect, seeded } from '../scenes/artKit';

export const TANK_TEXTURE = 'tankworld';
const FRAMES: FrameSpec[] = [];
const frame = (name: string, w: number, h: number, draw: FrameSpec['draw']) => FRAMES.push({ name, w, h, draw });

export const VARIANTS = { oak: 3, pine: 3, palm: 2, bush: 3, rock: 3, boulder: 2, house: 4, car: 4, truck: 2, boat: 2, rubble: 2, ash: 2, shard: 3 };

type Ctx = CanvasRenderingContext2D;

/** A lumpy closed shape round (cx, cy). */
function blob(ctx: Ctx, cx: number, cy: number, r: number, color: string, rand: () => number, points = 10, rough = 0.25): void {
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

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// --- The tank ---------------------------------------------------------------------

frame('tank-hull', 62, 44, (ctx, w, h) => {
  // Tracks either side, with their links.
  for (const y of [0, h - 11]) {
    roundRect(ctx, 0, y, w, 11, 4, '#26282a');
    for (let x = 3; x < w - 2; x += 5) rect(ctx, x, y + 1, 2, 9, '#3d4044');
  }
  roundRect(ctx, 4, 9, w - 8, h - 18, 4, '#4f5d33');
  rect(ctx, 6, 11, w - 12, (h - 22) / 2, '#5f6f3d');
  // Engine deck at the back, and a light at the front.
  for (let x = 8; x < 20; x += 4) rect(ctx, x, 13, 2, h - 26, '#3b4626');
  rect(ctx, w - 8, h / 2 - 3, 3, 6, '#c9b458');
});
frame('tank-turret', 64, 28, (ctx, _w, h) => {
  // The barrel, then the turret over it (its pivot 22 px in from the left).
  rect(ctx, 30, h / 2 - 3, 32, 6, '#3d472a');
  rect(ctx, 30, h / 2 - 3, 32, 2, '#55613a');
  rect(ctx, 58, h / 2 - 4, 6, 8, '#2f3720');
  roundRect(ctx, 6, 2, 34, h - 4, 9, '#56653a');
  roundRect(ctx, 8, 4, 28, (h - 8) / 2, 7, '#6a7b47');
  circle(ctx, 18, h / 2 + 3, 4, '#3b4626');
  circle(ctx, 18, h / 2 + 3, 2, '#2a3119');
});
frame('rocket', 18, 8, (ctx, w, h) => {
  roundRect(ctx, 2, 1, w - 4, h - 2, 3, '#d9d4c4');
  rect(ctx, 2, 1, 4, h - 2, '#8f8a7c');
  rect(ctx, w - 6, 2, 4, h - 4, '#b5402a');
});

// --- Trees and bushes ------------------------------------------------------------------

const LEAVES = [
  ['#1f4a22', '#2c6330', '#3f7d3a', '#5a9a48'],
  ['#24481d', '#33612a', '#4a7c36', '#69994a'],
  ['#2a4f26', '#3a6833', '#548644', '#78a85a'],
];
for (let v = 0; v < VARIANTS.oak; v++) {
  frame(`oak-${v}`, 64, 64, (ctx) => {
    const rand = seeded(v * 97 + 3);
    LEAVES[v].forEach((color, layer) => {
      for (let k = 0; k < 7 - layer; k++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * (16 - layer * 3);
        blob(ctx, 32 + Math.cos(a) * r - layer * 2, 32 + Math.sin(a) * r - layer * 2, 13 - layer * 1.5, color, rand);
      }
    });
  });
}
for (let v = 0; v < VARIANTS.pine; v++) {
  frame(`pine-${v}`, 52, 52, (ctx) => {
    const greens = ['#123020', '#1c4029', '#285434', '#386b42'];
    greens.forEach((color, layer) => {
      const outer = 24 - layer * 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * Math.PI * 2 + v + layer * 0.4;
        const r = k % 2 === 0 ? outer : outer * 0.62;
        const x = 26 - layer * 1.2 + Math.cos(a) * r;
        const y = 26 - layer * 1.2 + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fill();
    });
  });
}
for (let v = 0; v < VARIANTS.palm; v++) {
  frame(`palm-${v}`, 58, 58, (ctx) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + v * 0.3;
      ctx.save();
      ctx.translate(29, 29);
      ctx.rotate(a);
      ctx.fillStyle = k % 2 ? '#3e7a32' : '#4f9440';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(14, -7, 27, 0);
      ctx.quadraticCurveTo(14, 5, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    circle(ctx, 29, 29, 4, '#6b4f2a');
  });
}
for (let v = 0; v < VARIANTS.bush; v++) {
  frame(`bush-${v}`, 28, 28, (ctx) => {
    const rand = seeded(v * 51 + 7);
    for (let k = 0; k < 9; k++) blob(ctx, 14 + (rand() - 0.5) * 10, 14 + (rand() - 0.5) * 10, 5 + rand() * 3, LEAVES[v][1 + (k % 3)], rand, 7);
  });
}
/** A tree brought down: its splintered stump, and the trunk and broken crown lying off to the right. */
for (const kind of ['oak', 'pine', 'palm'] as const) {
  frame(`fallen-${kind}`, 96, 64, (ctx) => {
    const rand = seeded(kind.length * 31);
    const crown = kind === 'oak' ? LEAVES[0] : kind === 'pine' ? ['#123020', '#1c4029', '#285434', '#386b42'] : ['#2f6527', '#3e7a32', '#4f9440', '#62a650'];
    rect(ctx, 22, 29, 50, 7, '#5a3f24');
    rect(ctx, 22, 29, 50, 2, '#7a5a36');
    // Its crown, crushed flat and broken where it hit the ground.
    for (let k = 0; k < 12; k++) blob(ctx, 74 + (rand() - 0.5) * 22, 32 + (rand() - 0.5) * 34, 6 + rand() * 6, crown[k % 4], rand, 8);
    // The stump, split.
    circle(ctx, 20, 32, 8, '#4a321c');
    circle(ctx, 20, 32, 6, '#c9a06a');
    ctx.strokeStyle = '#4a321c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(15, 28);
    ctx.lineTo(25, 37);
    ctx.stroke();
  });
}
/** Ash where something burnt away, with the charred stump in it. */
for (let v = 0; v < VARIANTS.ash; v++) {
  frame(`ash-${v}`, 60, 60, (ctx) => {
    const rand = seeded(v * 13 + 9);
    blob(ctx, 30, 30, 26, 'rgba(40,36,32,0.55)', rand, 12);
    blob(ctx, 30, 30, 18, 'rgba(70,66,60,0.75)', rand, 10);
    for (let k = 0; k < 14; k++) circle(ctx, 30 + (rand() - 0.5) * 34, 30 + (rand() - 0.5) * 34, 1 + rand() * 2, rand() < 0.5 ? '#9b958c' : '#1d1b19');
    circle(ctx, 30, 30, 6, '#1b1714');
    circle(ctx, 30, 30, 3.5, '#3a2a1e');
  });
}

// --- Stone ------------------------------------------------------------------------

const GREY = ['#55524d', '#6d6963', '#88837b', '#a39d93'];
const crack = (ctx: Ctx, x: number, y: number, len: number, rand: () => number) => {
  ctx.strokeStyle = '#2e2b28';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let px = x;
  let py = y;
  for (let k = 0; k < 4; k++) {
    px += (rand() - 0.3) * len;
    py += (rand() - 0.5) * len;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
};
for (const [kind, size, count] of [['rock', 34, VARIANTS.rock], ['boulder', 66, VARIANTS.boulder]] as const) {
  for (let v = 0; v < count; v++) {
    for (const cracked of [false, true]) {
      frame(`${kind}-${v}${cracked ? '-cracked' : ''}`, size, size, (ctx) => {
        const rand = seeded(v * 211 + size);
        const c = size / 2;
        blob(ctx, c + 1, c + 1, c - 1, GREY[0], rand, 9);
        blob(ctx, c, c, c - 3, GREY[1 + (v % 2)], rand, 9);
        blob(ctx, c - c * 0.25, c - c * 0.25, c * 0.45, GREY[3], rand, 8);
        if (cracked) {
          const crackRand = seeded(v * 7 + 1);
          for (let k = 0; k < 3; k++) crack(ctx, c + (crackRand() - 0.5) * c * 0.6, c + (crackRand() - 0.5) * c * 0.6, c * 0.4, crackRand);
        }
      });
    }
  }
}
/** Rubble: a heap of broken stone. */
for (let v = 0; v < VARIANTS.rubble; v++) {
  frame(`rubble-${v}`, 48, 48, (ctx) => {
    const rand = seeded(v * 77 + 5);
    for (let k = 0; k < 18; k++) blob(ctx, 24 + (rand() - 0.5) * 32, 24 + (rand() - 0.5) * 32, 3 + rand() * 5, GREY[Math.floor(rand() * 4)], rand, 6, 0.4);
  });
}
/** Bits flying off: stone, splinters of wood, bricks, scraps of metal. */
for (let v = 0; v < VARIANTS.shard; v++) {
  frame(`shard-${v}`, 12, 12, (ctx) => blob(ctx, 6, 6, 4 + v, GREY[1 + v], seeded(v + 1), 6, 0.45));
}
frame('plank', 16, 5, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#8a6640');
  rect(ctx, 0, 0, w, 1.5, '#a8845a');
});
frame('brick', 8, 5, (ctx, w, h) => rect(ctx, 0, 0, w, h, '#a24a32'));
frame('scrap', 10, 7, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#3a3c3f');
  rect(ctx, 1, 1, w - 4, 2, '#6d7175');
});
frame('straw', 8, 3, (ctx, w, h) => rect(ctx, 0, 0, w, h, '#d6b45a'));

// --- Buildings -----------------------------------------------------------------------

/** Roofs: red tiles, grey slate, thatch, and blue tin. */
const ROOFS: [string, string, string][] = [
  ['#b0472f', '#8c3524', '#c96446'],
  ['#5a6068', '#454a51', '#727a83'],
  ['#c9a55a', '#a5843f', '#dbbb73'],
  ['#4f6f8f', '#3c566f', '#6588ab'],
];
const roof = (ctx: Ctx, w: number, h: number, colors: [string, string, string], rows: number) => {
  const [lit, shade, edge] = colors;
  rect(ctx, 0, 0, w, h, shade);
  rect(ctx, 2, 2, w - 4, h / 2 - 2, lit);
  rect(ctx, 2, h / 2, w - 4, h / 2 - 2, shade);
  for (let y = 4; y < h - 2; y += h / rows) rect(ctx, 2, y, w - 4, 1, 'rgba(0,0,0,0.18)');
  rect(ctx, 0, h / 2 - 1, w, 2, edge);
};
const hole = (ctx: Ctx, x: number, y: number, r: number, rand: () => number) => {
  blob(ctx, x, y, r, '#2a1f18', rand, 9, 0.4);
  for (let k = 0; k < 4; k++) rect(ctx, x - r + rand() * r * 2, y - r + rand() * r * 2, 6, 2, '#6b4a2e');
};
for (let v = 0; v < VARIANTS.house; v++) {
  for (const damaged of [false, true]) {
    frame(`house-${v}${damaged ? '-damaged' : ''}`, 74, 58, (ctx, w, h) => {
      roof(ctx, w, h, ROOFS[v], 8);
      // A chimney.
      rect(ctx, w - 18, 8, 9, 9, '#7d6a5a');
      rect(ctx, w - 16, 10, 5, 5, '#2a2522');
      if (damaged) {
        const rand = seeded(v * 5 + 2);
        hole(ctx, w * 0.35, h * 0.4, 9, rand);
        hole(ctx, w * 0.6, h * 0.65, 6, rand);
      }
    });
  }
}
for (const damaged of [false, true]) {
  frame(`barn${damaged ? '-damaged' : ''}`, 108, 72, (ctx, w, h) => {
    roof(ctx, w, h, ['#9a3b2b', '#7a2c20', '#b35540'], 6);
    for (let x = 6; x < w - 4; x += 8) rect(ctx, x, 2, 1.5, h - 4, 'rgba(0,0,0,0.15)');
    if (damaged) {
      const rand = seeded(9);
      hole(ctx, w * 0.3, h * 0.35, 12, rand);
      hole(ctx, w * 0.7, h * 0.6, 9, rand);
    }
  });
}
/** A building brought down: a heap of bricks, beams and broken roof. */
for (let v = 0; v < VARIANTS.rubble; v++) {
  frame(`hrubble-${v}`, 84, 68, (ctx, w, h) => {
    const rand = seeded(v * 131 + 17);
    blob(ctx, w / 2, h / 2, Math.min(w, h) * 0.48, '#6d625a', rand, 12);
    for (let k = 0; k < 40; k++) {
      ctx.save();
      ctx.translate(8 + rand() * (w - 16), 8 + rand() * (h - 16));
      ctx.rotate(rand() * Math.PI);
      const r = rand();
      rect(ctx, -6, -2, r < 0.3 ? 14 : 7, r < 0.3 ? 3 : 4, r < 0.3 ? '#7a5a3a' : r < 0.6 ? '#a24a32' : r < 0.8 ? '#8d8a84' : ROOFS[v][0]);
      ctx.restore();
    }
  });
}

/** Town houses: a terraced pair under one roof, front (the top edge) on the street, with chimneys on the party wall. */
export const TOWN_VARIANTS = { townhouse: 4, shop: 3 };
const TOWN_ROOFS: [string, string, string][] = [
  ['#a8452e', '#843422', '#c25a40'],
  ['#5d636b', '#474c53', '#767e88'],
  ['#8a5a3a', '#6b4429', '#a5714d'],
  ['#9a3a3a', '#7a2b2b', '#b35050'],
];
for (let v = 0; v < TOWN_VARIANTS.townhouse; v++) {
  for (const damaged of [false, true]) {
    frame(`townhouse-${v}${damaged ? '-damaged' : ''}`, 64, 54, (ctx, w, h) => {
      roof(ctx, w, h, TOWN_ROOFS[v], 7);
      rect(ctx, w / 2 - 1, 2, 2, h - 4, 'rgba(0,0,0,0.25)');
      for (const x of [w / 2 - 6, w - 12]) {
        rect(ctx, x, h / 2 - 9, 8, 7, '#7d6a5a');
        rect(ctx, x + 2, h / 2 - 7, 4, 3, '#2a2522');
      }
      if (damaged) {
        const rand = seeded(v * 9 + 4);
        hole(ctx, w * 0.3, h * 0.35, 8, rand);
        hole(ctx, w * 0.7, h * 0.7, 6, rand);
      }
    });
  }
}
/** Shops: a flat roof with a skylight and plant, and a striped awning out over the pavement. */
const AWNINGS = [['#d7263d', '#f2f2f2'], ['#2a7f8f', '#f2f2f2'], ['#e0b33a', '#5a3a1e']];
for (let v = 0; v < TOWN_VARIANTS.shop; v++) {
  for (const damaged of [false, true]) {
    frame(`shop-${v}${damaged ? '-damaged' : ''}`, 62, 52, (ctx, w, h) => {
      rect(ctx, 0, 0, w, h, '#8d877d');
      rect(ctx, 2, 10, w - 4, h - 12, '#b3ab9e');
      rect(ctx, 8, 18, 14, 10, '#9fc4d6');
      rect(ctx, w - 20, h - 18, 10, 8, '#6d6a62');
      for (let x = 0; x < w; x += 8) rect(ctx, x, 0, 4, 10, AWNINGS[v][0]);
      for (let x = 4; x < w; x += 8) rect(ctx, x, 0, 4, 10, AWNINGS[v][1]);
      rect(ctx, 0, 9, w, 1.5, 'rgba(0,0,0,0.3)');
      if (damaged) {
        const rand = seeded(v * 5 + 11);
        hole(ctx, w * 0.45, h * 0.6, 9, rand);
      }
    });
  }
}
/** The church: a long nave and transepts under slate, and its tower at the front with a spire. */
for (const damaged of [false, true]) {
  frame(`church${damaged ? '-damaged' : ''}`, 116, 70, (ctx, w, h) => {
    const slate: [string, string, string] = ['#646a72', '#4c5158', '#7a828c'];
    ctx.save();
    ctx.translate(26, 0);
    roof(ctx, w - 26, h, slate, 8);
    ctx.restore();
    // Transepts.
    ctx.save();
    ctx.translate(62, -0);
    rect(ctx, 0, 0, 26, h, '#4c5158');
    rect(ctx, 2, 0, 22, h / 2, '#646a72');
    ctx.restore();
    // The tower and spire.
    rect(ctx, 2, h / 2 - 15, 30, 30, '#8a8478');
    ctx.fillStyle = '#5a5e64';
    ctx.beginPath();
    ctx.moveTo(4, h / 2 - 13);
    ctx.lineTo(30, h / 2 - 13);
    ctx.lineTo(17, h / 2);
    ctx.fill();
    ctx.fillStyle = '#767e88';
    ctx.beginPath();
    ctx.moveTo(4, h / 2 - 13);
    ctx.lineTo(17, h / 2);
    ctx.lineTo(4, h / 2 + 13);
    ctx.fill();
    circle(ctx, 17, h / 2, 2, '#d4b05a');
    if (damaged) {
      const rand = seeded(23);
      hole(ctx, 70, h * 0.35, 11, rand);
      hole(ctx, 95, h * 0.7, 8, rand);
    }
  });
}
/** The fountain in the square: a stone basin, water, and the jet in the middle. */
for (const cracked of [false, true]) {
  frame(`fountain${cracked ? '-cracked' : ''}`, 44, 44, (ctx) => {
    circle(ctx, 22, 22, 21, '#8d877d');
    circle(ctx, 22, 22, 18, '#5d9cb5');
    circle(ctx, 22, 22, 10, '#a39d93');
    circle(ctx, 22, 22, 6, '#7fbfd6');
    circle(ctx, 21, 21, 2.5, '#ffffff');
    if (cracked) crack(ctx, 8, 14, 9, seeded(2));
  });
}
/**
 * Bridges, drawn along their length (stretched to fit each crossing): a
 * wooden one, planks across between railings, and a stone one with
 * parapets; and each broken, the middle fallen into the river and only the
 * ends left.
 */
for (const broken of [false, true]) {
  frame(`bridge${broken ? '-broken' : ''}`, 128, 48, (ctx, w, h) => {
    const rand = seeded(broken ? 3 : 1);
    const deck = (x0: number, x1: number) => {
      for (let x = x0; x < x1; x += 6) rect(ctx, x, 6, 5, h - 12, rand() < 0.5 ? '#8a6640' : '#9c7650');
      for (const y of [3, h - 7]) rect(ctx, x0, y, x1 - x0, 4, '#5a3f24');
    };
    if (!broken) {
      deck(0, w);
      for (let x = 4; x < w; x += 20) for (const y of [1, h - 9]) rect(ctx, x, y, 5, 8, '#4a321c');
    } else {
      deck(0, 34);
      deck(w - 34, w);
      for (const x of [34, w - 40]) for (let k = 0; k < 4; k++) rect(ctx, x + rand() * 6, 8 + k * 9, 6, 3, '#6b4a2e');
    }
  });
  frame(`stonebridge${broken ? '-broken' : ''}`, 128, 56, (ctx, w, h) => {
    const rand = seeded(broken ? 7 : 5);
    const span = (x0: number, x1: number) => {
      rect(ctx, x0, 6, x1 - x0, h - 12, '#55585e');
      rect(ctx, x0, h / 2 - 1, x1 - x0, 2, 'rgba(255,255,255,0.15)');
      for (const y of [0, h - 6]) {
        rect(ctx, x0, y, x1 - x0, 6, '#a39d93');
        for (let x = x0; x < x1; x += 10) rect(ctx, x, y, 1, 6, '#7d786f');
      }
    };
    if (!broken) span(0, w);
    else {
      span(0, 36);
      span(w - 36, w);
      for (const x of [36, w - 44]) for (let k = 0; k < 5; k++) blob(ctx, x + 4 + rand() * 6, 8 + k * 10, 4, GREY[1 + (k % 3)], rand, 6);
    }
  });
}

// --- Vehicles ----------------------------------------------------------------------

const PAINT = ['#c0392b', '#2e6fb5', '#e0b33a', '#ecebe6'];
for (let v = 0; v < VARIANTS.car; v++) {
  frame(`car-${v}`, 46, 22, (ctx, w, h) => {
    roundRect(ctx, 0, 1, w, h - 2, 6, PAINT[v]);
    rect(ctx, 12, 3, 22, h - 6, 'rgba(0,0,0,0.12)');
    rect(ctx, w - 15, 3, 5, h - 6, '#9fd3ff');
    rect(ctx, 9, 3, 4, h - 6, '#9fd3ff');
    rect(ctx, w - 3, 3, 2, 4, '#fff6c0');
    rect(ctx, w - 3, h - 7, 2, 4, '#fff6c0');
  });
}
for (let v = 0; v < VARIANTS.truck; v++) {
  frame(`truck-${v}`, 66, 28, (ctx, _w, h) => {
    rect(ctx, 0, 1, 46, h - 2, v === 0 ? '#6b7b4a' : '#7d7f84');
    for (let x = 4; x < 44; x += 6) rect(ctx, x, 2, 1.5, h - 4, 'rgba(0,0,0,0.2)');
    roundRect(ctx, 47, 2, 19, h - 4, 4, v === 0 ? '#2e6fb5' : '#c0392b');
    rect(ctx, 58, 4, 4, h - 8, '#9fd3ff');
  });
}
frame('tractor', 42, 30, (ctx, w, h) => {
  rect(ctx, 2, 0, 14, 7, '#1d1d1f');
  rect(ctx, 2, h - 7, 14, 7, '#1d1d1f');
  rect(ctx, w - 12, 3, 9, 5, '#1d1d1f');
  rect(ctx, w - 12, h - 8, 9, 5, '#1d1d1f');
  roundRect(ctx, 4, 6, w - 6, h - 12, 3, '#3b8a3a');
  rect(ctx, 6, 8, 12, h - 16, '#2b2d31');
  rect(ctx, 22, 10, 16, h - 20, '#2f6e2e');
});
for (let v = 0; v < VARIANTS.boat; v++) {
  frame(`boat-${v}`, 48, 20, (ctx, w, h) => {
    ctx.fillStyle = v === 0 ? '#ecebe6' : '#2e6fb5';
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(w - 12, 1);
    ctx.quadraticCurveTo(w, h / 2, w - 12, h - 1);
    ctx.lineTo(0, h - 2);
    ctx.fill();
    rect(ctx, 6, 5, 22, h - 10, '#8a6640');
    rect(ctx, 14, 6, 8, h - 12, '#5a3f24');
  });
}
/** Burnt-out wrecks: charred, burst open. */
const char = (ctx: Ctx, w: number, h: number, rand: () => number) => {
  for (let k = 0; k < 10; k++) ellipse(ctx, rand() * w, rand() * h, 2 + rand() * 6, 1.5 + rand() * 3, rand() < 0.5 ? '#2a2420' : '#5a3a26');
};
frame('wreck-car', 46, 22, (ctx, w, h) => {
  roundRect(ctx, 0, 1, w, h - 2, 6, '#3a3532');
  rect(ctx, 9, 3, 28, h - 6, '#161412');
  char(ctx, w, h, seeded(3));
});
frame('wreck-truck', 66, 28, (ctx, w, h) => {
  rect(ctx, 0, 1, 46, h - 2, '#3b3733');
  rect(ctx, 4, 4, 38, h - 8, '#1d1a17');
  roundRect(ctx, 47, 2, 19, h - 4, 4, '#2f2b28');
  char(ctx, w, h, seeded(5));
});
frame('wreck-tractor', 42, 30, (ctx, w, h) => {
  rect(ctx, 2, 0, 14, 7, '#141414');
  rect(ctx, 2, h - 7, 14, 7, '#141414');
  roundRect(ctx, 4, 6, w - 6, h - 12, 3, '#34302c');
  char(ctx, w, h, seeded(7));
});
frame('wreck-boat', 48, 20, (ctx, w, h) => {
  ctx.fillStyle = '#2f2b28';
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(w - 12, 1);
  ctx.quadraticCurveTo(w, h / 2, w - 12, h - 1);
  ctx.lineTo(0, h - 2);
  ctx.fill();
  char(ctx, w, h, seeded(9));
});

// --- Farm and fuel -------------------------------------------------------------------

frame('haystack', 32, 32, (ctx) => {
  circle(ctx, 16, 16, 15, '#a8873e');
  circle(ctx, 15, 15, 13, '#d6b45a');
  ctx.strokeStyle = '#b8963f';
  ctx.lineWidth = 1;
  for (let r = 4; r < 13; r += 3) {
    ctx.beginPath();
    ctx.arc(15, 15, r, 0, Math.PI * 2);
    ctx.stroke();
  }
});
frame('fence', 40, 8, (ctx, w, h) => {
  rect(ctx, 0, 2, w, 1.8, '#8a6640');
  rect(ctx, 0, h - 3.8, w, 1.8, '#8a6640');
  for (const x of [1, w - 5]) rect(ctx, x, 0, 4, h, '#5a3f24');
});
frame('barrel', 20, 20, (ctx) => {
  circle(ctx, 10, 10, 9.5, '#7a1d14');
  circle(ctx, 10, 10, 8, '#c0392b');
  circle(ctx, 10, 10, 5, '#a8301f');
  circle(ctx, 13, 7, 1.6, '#f2f2f2');
});
frame('crate', 22, 22, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#7a5a36');
  rect(ctx, 2, 2, w - 4, h - 4, '#a8845a');
  ctx.strokeStyle = '#7a5a36';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(w - 2, h - 2);
  ctx.stroke();
});
frame('fueltank', 64, 64, (ctx) => {
  circle(ctx, 32, 32, 31, '#8d9398');
  circle(ctx, 32, 32, 28, '#d9dde0');
  circle(ctx, 27, 27, 16, '#eef0f2');
  circle(ctx, 32, 32, 5, '#8d9398');
  rect(ctx, 50, 30, 12, 4, '#c0392b');
});
frame('wreck-fueltank', 64, 64, (ctx) => {
  const rand = seeded(11);
  circle(ctx, 32, 32, 31, '#2a2622');
  blob(ctx, 32, 32, 24, '#14110f', rand, 12, 0.4);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.fillStyle = '#4a4440';
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20);
    ctx.lineTo(32 + Math.cos(a + 0.2) * 31, 32 + Math.sin(a + 0.2) * 31);
    ctx.lineTo(32 + Math.cos(a - 0.2) * 31, 32 + Math.sin(a - 0.2) * 31);
    ctx.fill();
  }
});

// --- Fields, beaches, campsites, forestry, the ski slopes ---------------------------------

/** Crops in rows (wheat, barley, green maize, rapeseed), long grass, and each flattened or burnt to stubble. */
export const FIELD_VARIANTS = { crop: 4, grass: 3 };
const CROPS: [string, string, string][] = [
  ['#c9a447', '#dcb85a', '#a8862f'],
  ['#c8b97a', '#ddd093', '#a89a5a'],
  ['#5f8a34', '#76a344', '#4a6e26'],
  ['#d8c22e', '#ead84a', '#8a9a30'],
];
for (let v = 0; v < FIELD_VARIANTS.crop; v++) {
  const [base, lit, dark] = CROPS[v];
  frame(`crop-${v}`, 48, 48, (ctx, w, h) => {
    const rand = seeded(v * 19 + 4);
    rect(ctx, 0, 0, w, h, base);
    // Rows running across (8 px apart, so they line up from patch to patch).
    for (let y = 0; y < h; y += 8) {
      rect(ctx, 0, y, w, 3, dark);
      for (let x = 0; x < w; x += 3) rect(ctx, x + rand() * 2, y + 3.5 + rand() * 2, 2, 2.2, lit);
    }
  });
  frame(`crop-flat-${v}`, 48, 48, (ctx, w, h) => {
    const rand = seeded(v * 23 + 8);
    rect(ctx, 0, 0, w, h, dark);
    ctx.strokeStyle = lit;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 40; k++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + rand() * 4, y + (rand() - 0.5) * 3);
      ctx.stroke();
    }
  });
}
const GRASS: [string, string, string][] = [
  ['#7d9a3e', '#9ab650', '#5f7a2c'],
  ['#8fa04a', '#b0bf62', '#6a7a32'],
  ['#a6a05a', '#c4bd74', '#827c3e'],
];
for (let v = 0; v < FIELD_VARIANTS.grass; v++) {
  const [base, lit, dark] = GRASS[v];
  frame(`grass-${v}`, 50, 50, (ctx, w, h) => {
    const rand = seeded(v * 37 + 2);
    blob(ctx, w / 2, h / 2, 24, base, rand, 14, 0.15);
    // Tufts, leaning with the wind.
    for (let k = 0; k < 46; k++) {
      const x = 5 + rand() * (w - 10);
      const y = 5 + rand() * (h - 10);
      if (Math.hypot(x - w / 2, y - h / 2) > 22) continue;
      ctx.strokeStyle = rand() < 0.5 ? lit : dark;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3 + rand() * 3, y - 3 - rand() * 3);
      ctx.stroke();
    }
  });
  frame(`grass-flat-${v}`, 50, 50, (ctx, w, h) => {
    const rand = seeded(v * 41 + 6);
    blob(ctx, w / 2, h / 2, 22, dark, rand, 14, 0.15);
    ctx.strokeStyle = base;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 30; k++) {
      const x = 8 + rand() * (w - 16);
      const y = 8 + rand() * (h - 16);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 7, y + (rand() - 0.5) * 2);
      ctx.stroke();
    }
  });
}
/** A burnt patch of a field of crops, square to the rows, and of long grass: black stubble and grey ash. */
frame('crop-burnt', 48, 48, (ctx, w, h) => {
  const rand = seeded(31);
  rect(ctx, 0, 0, w, h, '#2c2724');
  for (let y = 0; y < h; y += 8) rect(ctx, 0, y, w, 2, '#1a1715');
  for (let k = 0; k < 50; k++) circle(ctx, rand() * w, rand() * h, 0.8 + rand() * 1.2, rand() < 0.4 ? '#7a746c' : '#14110f');
});
frame('stubble', 50, 50, (ctx, w, h) => {
  const rand = seeded(29);
  blob(ctx, w / 2, h / 2, 24, '#2c2724', rand, 14, 0.15);
  for (let k = 0; k < 50; k++) circle(ctx, 4 + rand() * (w - 8), 4 + rand() * (h - 8), 0.8 + rand() * 1.4, rand() < 0.4 ? '#7a746c' : '#14110f');
});

/** Beach huts: painted wooden huts, door (and a little deck) facing right, to the sea. */
export const BEACH_VARIANTS = { beachhut: 6, parasol: 4, tent: 3 };
const HUT_PAINT = ['#e8505b', '#4fa3d1', '#f2c94c', '#6fcf97', '#f2f2ec', '#bb6bd9'];
for (let v = 0; v < BEACH_VARIANTS.beachhut; v++) {
  frame(`beachhut-${v}`, 36, 38, (ctx, w, h) => {
    rect(ctx, w - 8, 6, 8, h - 12, '#c9a06a');
    for (let y = 8; y < h - 6; y += 4) rect(ctx, w - 8, y, 8, 1, '#a8804a');
    // A pitched roof, ridge across, and the painted front edge.
    rect(ctx, 0, 0, w - 8, h, HUT_PAINT[v]);
    rect(ctx, 1, 1, w - 10, h / 2 - 1, '#f6f2ea');
    rect(ctx, 1, h / 2, w - 10, h / 2 - 1, '#d8d2c6');
    rect(ctx, 0, h / 2 - 1, w - 8, 2, HUT_PAINT[v]);
    rect(ctx, w - 10, 0, 2, h, HUT_PAINT[v]);
  });
}
/** Sunshades, with a towel laid out either side. */
const TOWELS = ['#e8505b', '#4fa3d1', '#f2c94c', '#6fcf97', '#ffffff', '#ff8c42'];
for (let v = 0; v < BEACH_VARIANTS.parasol; v++) {
  frame(`parasol-${v}`, 64, 44, (ctx, w, h) => {
    for (const [x, c] of [[4, TOWELS[v]], [w - 16, TOWELS[(v + 2) % TOWELS.length]]] as const) {
      roundRect(ctx, x, 6, 12, h - 12, 2, c);
      for (let y = 10; y < h - 8; y += 6) rect(ctx, x, y, 12, 2, 'rgba(255,255,255,0.45)');
    }
    // The shade: striped segments round the pole.
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#f6f2ea' : HUT_PAINT[v];
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, 15, (k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2);
      ctx.fill();
    }
    circle(ctx, w / 2, h / 2, 2, '#5a3f24');
  });
}
/** Tents from above: a ridge down the middle, the door flap to the right; and one flattened. */
const TENTS: [string, string][] = [
  ['#e86a2a', '#c4521c'],
  ['#3a8a5a', '#2c6e46'],
  ['#3b6fb5', '#2c5690'],
];
for (let v = 0; v < BEACH_VARIANTS.tent; v++) {
  const [lit, shade] = TENTS[v];
  frame(`tent-${v}`, 34, 30, (ctx, w, h) => {
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.lineTo(w - 6, 2);
    ctx.lineTo(w, h / 2);
    ctx.lineTo(w - 6, h - 2);
    ctx.lineTo(2, h - 2);
    ctx.fill();
    rect(ctx, 2, h / 2, w - 8, h / 2 - 2, shade);
    rect(ctx, 2, h / 2 - 1, w - 6, 2, '#f2f2ec');
    // The open door.
    ctx.fillStyle = '#2a2522';
    ctx.beginPath();
    ctx.moveTo(w - 6, h / 2 - 5);
    ctx.lineTo(w, h / 2);
    ctx.lineTo(w - 6, h / 2 + 5);
    ctx.fill();
  });
  frame(`tent-flat-${v}`, 34, 30, (ctx, w, h) => {
    const rand = seeded(v + 61);
    blob(ctx, w / 2, h / 2, 13, shade, rand, 10, 0.35);
    blob(ctx, w / 2 - 3, h / 2 - 2, 8, lit, rand, 8, 0.4);
    rect(ctx, 4, h / 2, w - 8, 1.5, '#d8d8d0');
  });
}
/** A ring of stones with the fire's embers in it (the flames are drawn live). */
frame('campfire', 24, 24, (ctx) => {
  circle(ctx, 12, 12, 9, '#3a2e26');
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    circle(ctx, 12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9, 2.6, GREY[1 + (k % 3)]);
  }
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(12, 12);
    ctx.rotate((k / 4) * Math.PI);
    rect(ctx, -6, -1, 12, 2.2, '#5a3f24');
    ctx.restore();
  }
  circle(ctx, 12, 12, 3, '#ff8a2a');
});
/** A tree's stump, a stack of felled logs, and the harvester that felled them. */
frame('stump', 20, 20, (ctx) => {
  circle(ctx, 10, 10, 8, '#5a3f24');
  circle(ctx, 10, 10, 6.5, '#d4ab72');
  ctx.strokeStyle = '#b08a56';
  ctx.lineWidth = 0.8;
  for (const r of [2, 4]) {
    ctx.beginPath();
    ctx.arc(10, 10, r, 0, Math.PI * 2);
    ctx.stroke();
  }
});
frame('logpile', 58, 34, (ctx, w) => {
  for (let row = 0; row < 4; row++) {
    const y = 2 + row * 7.6;
    rect(ctx, 4, y, w - 8, 7, row % 2 ? '#7a5a36' : '#8a6640');
    rect(ctx, 4, y, w - 8, 2, '#a8845a');
    circle(ctx, w - 4, y + 3.5, 3.4, '#d4ab72');
    circle(ctx, 4, y + 3.5, 3.4, '#c9a06a');
  }
});
const harvester = (ctx: Ctx, w: number, h: number, body: string, cab: string, glass: string) => {
  for (const y of [0, h - 7]) for (const x of [6, 22, 38]) roundRect(ctx, x, y, 12, 7, 3, '#1d1d1f');
  roundRect(ctx, 4, 5, 46, h - 10, 4, body);
  rect(ctx, 6, 8, 16, h - 16, '#3a3c3f');
  roundRect(ctx, 30, 7, 16, h - 14, 3, cab);
  rect(ctx, 40, 9, 5, h - 18, glass);
  // The boom reaching out, and its felling head.
  rect(ctx, 44, h / 2 - 2, 14, 4, '#d8a62a');
  roundRect(ctx, w - 8, h / 2 - 6, 8, 12, 2, '#3a3c3f');
};
frame('harvester', 64, 34, (ctx, w, h) => harvester(ctx, w, h, '#e0b33a', '#c99a22', '#9fd3ff'));
frame('wreck-harvester', 64, 34, (ctx, w, h) => {
  harvester(ctx, w, h, '#3a3532', '#2a2622', '#161412');
  char(ctx, w, h, seeded(13));
});
/** A ski lift's pylon (seen from above: its head, with the cable wheels), its stations, and a chalet. */
frame('lifttower', 16, 16, (ctx) => {
  rect(ctx, 5, 0, 6, 16, '#5d636b');
  rect(ctx, 6, 0, 2, 16, '#8d9398');
  for (const y of [2, 12]) circle(ctx, 8, y, 2.4, '#2b2d31');
});
frame('liftstation', 58, 44, (ctx, w, h) => {
  rect(ctx, 0, 0, w - 14, h, '#6b5a4a');
  rect(ctx, 2, 2, w - 18, h / 2 - 2, '#8a7660');
  rect(ctx, 2, h / 2, w - 18, h / 2 - 2, '#6e5d4c');
  // The bullwheel housing, out the front where the cable comes in.
  roundRect(ctx, w - 18, 4, 18, h - 8, 8, '#c0392b');
  circle(ctx, w - 9, h / 2, 5, '#3a3c3f');
});
frame('chalet', 66, 54, (ctx, w, h) => {
  roof(ctx, w, h, ['#6b4a2e', '#553a22', '#86603e'], 9);
  // Snow lying on the roof, thickest down by the eaves.
  for (const [y, height] of [[2, 10], [h - 12, 10]] as const) roundRect(ctx, 2, y, w - 4, height, 4, 'rgba(248,251,255,0.9)');
  rect(ctx, 4, h / 2 - 7, w - 8, 3, 'rgba(248,251,255,0.6)');
  rect(ctx, 4, h / 2 + 4, w - 8, 3, 'rgba(248,251,255,0.6)');
  rect(ctx, w - 16, 8, 8, 8, '#7d6a5a');
  rect(ctx, w - 14, 10, 4, 4, '#2a2522');
});

// --- Harbours ----------------------------------------------------------------------

/** A jetty: planks across, on posts, from the quay (left) out over the water; and one broken through in the middle. */
for (const broken of [false, true]) {
  frame(`jetty${broken ? '-broken' : ''}`, 128, 26, (ctx, w, h) => {
    const rand = seeded(broken ? 23 : 21);
    const span = (x0: number, x1: number) => {
      rect(ctx, x0, 3, x1 - x0, h - 6, '#8a6640');
      for (let x = x0; x < x1; x += 6) rect(ctx, x, 3, 1, h - 6, '#6b4c2e');
      for (let x = x0 + 4; x < x1; x += 24) for (const y of [1, h - 5]) rect(ctx, x, y, 4, 4, '#4a321c');
    };
    if (!broken) span(0, w);
    else {
      span(0, 44);
      span(w - 40, w);
      for (let k = 0; k < 6; k++) rect(ctx, 46 + rand() * 30, 4 + rand() * (h - 10), 10, 3, '#6b4c2e');
    }
  });
}
for (const damaged of [false, true]) {
  frame(`warehouse${damaged ? '-damaged' : ''}`, 96, 70, (ctx, w, h) => {
    // A corrugated roof, ridge along, and big doors to the quay (right).
    rect(ctx, 0, 0, w, h, '#5d6670');
    rect(ctx, 2, 2, w - 4, h / 2 - 2, '#7d8792');
    rect(ctx, 2, h / 2, w - 4, h / 2 - 2, '#646d77');
    for (let x = 4; x < w - 2; x += 5) rect(ctx, x, 2, 1.2, h - 4, 'rgba(0,0,0,0.16)');
    rect(ctx, 0, h / 2 - 1, w, 2, '#9aa3ad');
    rect(ctx, w - 4, h / 2 - 16, 4, 32, '#c0392b');
    if (damaged) {
      const rand = seeded(27);
      hole(ctx, w * 0.35, h * 0.4, 12, rand);
      hole(ctx, w * 0.65, h * 0.7, 9, rand);
    }
  });
}
/** A dock crane's base from above (its jib is drawn swinging, live), and its wreck. */
frame('crane', 38, 38, (ctx, w, h) => {
  rect(ctx, 2, 2, w - 4, h - 4, '#2b2d31');
  for (const [x, y] of [[2, 2], [w - 8, 2], [2, h - 8], [w - 8, h - 8]]) rect(ctx, x, y, 6, 6, '#e0b33a');
  roundRect(ctx, 9, 9, w - 18, h - 18, 4, '#e0b33a');
  rect(ctx, 13, 13, w - 26, h - 26, '#2b2d31');
});
frame('wreck-crane', 38, 38, (ctx, w, h) => {
  rect(ctx, 2, 2, w - 4, h - 4, '#1d1b19');
  roundRect(ctx, 9, 9, w - 18, h - 18, 4, '#4a4036');
  char(ctx, w, h, seeded(15));
});
frame('crane-jib', 130, 12, (ctx, w, h) => {
  // The cab over the pivot (left end), and the lattice arm out.
  roundRect(ctx, 0, 0, 22, h, 3, '#e0b33a');
  rect(ctx, 14, 3, 6, h - 6, '#9fd3ff');
  rect(ctx, 22, 3, w - 26, h - 6, '#d8a62a');
  for (let x = 24; x < w - 6; x += 8) {
    ctx.strokeStyle = '#8a6a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 3);
    ctx.lineTo(x + 4, h - 3);
    ctx.lineTo(x + 8, 3);
    ctx.stroke();
  }
  rect(ctx, w - 6, 2, 6, h - 4, '#2b2d31');
});
/** Shipping containers in a few liveries, and a burnt-out one. */
export const HARBOUR_VARIANTS = { container: 5, trawler: 2 };
const LIVERY = ['#c0392b', '#2e6fb5', '#2a9d8f', '#e07a2a', '#6b7b4a'];
for (let v = 0; v < HARBOUR_VARIANTS.container; v++) {
  frame(`container-${v}`, 54, 22, (ctx, w, h) => {
    rect(ctx, 0, 0, w, h, LIVERY[v]);
    for (let x = 3; x < w - 2; x += 4) rect(ctx, x, 1, 1.5, h - 2, 'rgba(0,0,0,0.2)');
    rect(ctx, 0, 0, w, 1.5, 'rgba(255,255,255,0.3)');
  });
}
frame('wreck-container', 54, 22, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#3a3532');
  for (let x = 3; x < w - 2; x += 4) rect(ctx, x, 1, 1.5, h - 2, 'rgba(0,0,0,0.3)');
  char(ctx, w, h, seeded(17));
});
/** A container hanging from the crane. */
frame('cargo', 30, 14, (ctx, w, h) => {
  rect(ctx, 0, 0, w, h, '#2e6fb5');
  for (let x = 2; x < w - 1; x += 3) rect(ctx, x, 1, 1, h - 2, 'rgba(0,0,0,0.2)');
});
/** Fishing trawlers: hull, wheelhouse forward, the deck and its gear aft. */
for (let v = 0; v < HARBOUR_VARIANTS.trawler; v++) {
  frame(`trawler-${v}`, 76, 26, (ctx, w, h) => {
    ctx.fillStyle = v === 0 ? '#1f4e79' : '#8c2a1e';
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(w - 18, 1);
    ctx.quadraticCurveTo(w, h / 2, w - 18, h - 1);
    ctx.lineTo(0, h - 3);
    ctx.fill();
    rect(ctx, 3, 5, w - 26, h - 10, '#b5a58a');
    roundRect(ctx, w - 34, 6, 16, h - 12, 2, '#f2f2ec');
    rect(ctx, w - 24, 8, 4, h - 16, '#9fd3ff');
    rect(ctx, 8, h / 2 - 1, 30, 2, '#5a4a3a');
    for (const x of [10, 24]) circle(ctx, x, h / 2, 3, '#e07a2a');
  });
}
frame('wreck-trawler', 76, 26, (ctx, w, h) => {
  ctx.fillStyle = '#2f2b28';
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(w - 18, 1);
  ctx.quadraticCurveTo(w, h / 2, w - 18, h - 1);
  ctx.lineTo(0, h - 3);
  ctx.fill();
  char(ctx, w, h, seeded(19));
});
frame('forklift', 30, 18, (ctx, _w, h) => {
  for (const [x, y] of [[3, 0], [3, h - 4], [16, 0], [16, h - 4]]) rect(ctx, x, y, 7, 4, '#1d1d1f');
  roundRect(ctx, 1, 2, 22, h - 4, 3, '#e0b33a');
  rect(ctx, 9, 4, 8, h - 8, '#2b2d31');
  rect(ctx, 23, 3, 2, h - 6, '#4a4a4a');
  rect(ctx, 25, 3, 5, 2, '#8d9398');
  rect(ctx, 25, h - 5, 5, 2, '#8d9398');
});
frame('wreck-forklift', 30, 18, (ctx, w, h) => {
  roundRect(ctx, 1, 2, 22, h - 4, 3, '#3a3532');
  rect(ctx, 23, 3, 2, h - 6, '#2a2622');
  char(ctx, w, h, seeded(21));
});

// --- The city -------------------------------------------------------------------------

/** Towers from above: a glass-and-steel roof with a helipad, a concrete one with its plant, and one with a roof garden. */
export const CITY_VARIANTS = { tower: 3, office: 3 };
for (let v = 0; v < CITY_VARIANTS.tower; v++) {
  for (const damaged of [false, true]) {
    frame(`tower-${v}${damaged ? '-damaged' : ''}`, 100, 100, (ctx, w, h) => {
      const rand = seeded(v * 71 + 5);
      rect(ctx, 0, 0, w, h, ['#5a6b7d', '#8d8a83', '#6d6560'][v]);
      rect(ctx, 4, 4, w - 8, h - 8, ['#7d93a8', '#a8a49b', '#8a817a'][v]);
      if (v === 0) {
        // Glass panels, and a helipad.
        for (let x = 6; x < w - 6; x += 9) rect(ctx, x, 6, 1, h - 12, 'rgba(255,255,255,0.18)');
        circle(ctx, w / 2, h / 2, 26, '#3a3c3f');
        circle(ctx, w / 2, h / 2, 23, '#4a4c50');
        ctx.strokeStyle = '#f2f2ec';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 19, 0, Math.PI * 2);
        ctx.stroke();
        rect(ctx, w / 2 - 8, h / 2 - 9, 3, 18, '#f2f2ec');
        rect(ctx, w / 2 + 5, h / 2 - 9, 3, 18, '#f2f2ec');
        rect(ctx, w / 2 - 6, h / 2 - 1.5, 12, 3, '#f2f2ec');
      } else if (v === 1) {
        // The plant on the roof: fans, ducts, a water tank, and the lift housing.
        for (let k = 0; k < 6; k++) {
          const x = 12 + (k % 3) * 26;
          const y = 14 + Math.floor(k / 3) * 26;
          rect(ctx, x, y, 18, 18, '#6d6963');
          circle(ctx, x + 9, y + 9, 7, '#4a4744');
          circle(ctx, x + 9, y + 9, 2, '#8d8a83');
        }
        rect(ctx, 14, h - 34, 40, 22, '#77736b');
        circle(ctx, w - 24, h - 24, 12, '#5a4a3a');
        circle(ctx, w - 24, h - 24, 9, '#7a6650');
      } else {
        // A roof garden: lawns, shrubs and a path.
        rect(ctx, 10, 10, w - 20, h - 20, '#5f9a44');
        rect(ctx, w / 2 - 4, 10, 8, h - 20, '#c9b98f');
        for (let k = 0; k < 12; k++) blob(ctx, 16 + rand() * (w - 32), 16 + rand() * (h - 32), 5 + rand() * 4, LEAVES[k % 3][2], rand, 8);
      }
      if (damaged) {
        const r = seeded(v + 77);
        hole(ctx, w * 0.3, h * 0.35, 14, r);
        hole(ctx, w * 0.7, h * 0.65, 11, r);
      }
    });
  }
}
/** Office blocks: long flat roofs with a rooftop unit or two. */
for (let v = 0; v < CITY_VARIANTS.office; v++) {
  for (const damaged of [false, true]) {
    frame(`office-${v}${damaged ? '-damaged' : ''}`, 60, 100, (ctx, w, h) => {
      rect(ctx, 0, 0, w, h, ['#6b7380', '#8a7f72', '#5d6b62'][v]);
      rect(ctx, 3, 3, w - 6, h - 6, ['#8e98a6', '#a69a8a', '#7d8c82'][v]);
      for (let y = 8; y < h - 6; y += 8) rect(ctx, 5, y, w - 10, 1, 'rgba(0,0,0,0.15)');
      rect(ctx, 12, 16 + v * 20, 20, 14, '#5d5a55');
      rect(ctx, w - 22, h - 30, 12, 18, '#5d5a55');
      if (damaged) hole(ctx, w * 0.5, h * 0.45, 12, seeded(v + 91));
    });
  }
}
frame('bench', 26, 10, (ctx, w, h) => {
  rect(ctx, 0, 1, w, 3, '#8a6640');
  rect(ctx, 0, 5, w, 3, '#8a6640');
  for (const x of [2, w - 4]) rect(ctx, x, 0, 2, h, '#2b2d31');
});
frame('bus', 74, 26, (ctx, w, h) => {
  roundRect(ctx, 0, 1, w, h - 2, 5, '#d7263d');
  rect(ctx, 4, 4, w - 12, h - 8, '#e8e8e2');
  for (let x = 8; x < w - 14; x += 10) rect(ctx, x, 5, 1.5, h - 10, '#b0aca4');
  rect(ctx, w - 6, 4, 4, h - 8, '#9fd3ff');
});
frame('wreck-bus', 74, 26, (ctx, w, h) => {
  roundRect(ctx, 0, 1, w, h - 2, 5, '#3a3532');
  rect(ctx, 4, 4, w - 12, h - 8, '#1d1a17');
  char(ctx, w, h, seeded(23));
});

// --- Farms ---------------------------------------------------------------------------

/** A grain silo from above (a domed steel top), and buckled. */
frame('silo', 32, 32, (ctx) => {
  circle(ctx, 16, 16, 15, '#8d9398');
  circle(ctx, 16, 16, 12, '#c4c9cd');
  circle(ctx, 13, 13, 6, '#e6e9eb');
  circle(ctx, 16, 16, 3, '#6d7175');
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    rect(ctx, 16 + Math.cos(a) * 13 - 0.5, 16 + Math.sin(a) * 13 - 0.5, 1.5, 1.5, '#6d7175');
  }
});
frame('wreck-silo', 32, 32, (ctx) => {
  const rand = seeded(29);
  blob(ctx, 16, 16, 15, '#5d6166', rand, 10, 0.45);
  blob(ctx, 16, 16, 9, '#3a3c3f', rand, 8, 0.4);
  for (let k = 0; k < 10; k++) circle(ctx, 4 + rand() * 24, 4 + rand() * 24, 1.6, '#d6b45a');
});
/** A combine harvester: the wide header out front (right), the cab, the grain tank and the unloading spout. */
const combine = (ctx: Ctx, w: number, h: number, body: string, header: string) => {
  rect(ctx, w - 12, 0, 10, h, header);
  for (let y = 2; y < h - 2; y += 4) rect(ctx, w - 12, y, 10, 1.5, 'rgba(0,0,0,0.25)');
  for (const y of [8, h - 16]) rect(ctx, 14, y, 18, 8, '#1d1d1f');
  roundRect(ctx, 4, 10, w - 18, h - 20, 4, body);
  rect(ctx, 8, 13, 22, h - 26, 'rgba(0,0,0,0.15)');
  roundRect(ctx, w - 30, 14, 12, h - 28, 2, '#2b2d31');
  rect(ctx, w - 24, 16, 4, h - 32, '#9fd3ff');
  rect(ctx, 0, h / 2 - 2, 10, 4, body);
};
frame('combine', 66, 46, (ctx, w, h) => combine(ctx, w, h, '#3b8a3a', '#e0b33a'));
frame('wreck-combine', 66, 46, (ctx, w, h) => {
  combine(ctx, w, h, '#34302c', '#2a2622');
  char(ctx, w, h, seeded(31));
});

// --- The railway and the police ----------------------------------------------------------

/** A locomotive (cab at the front, right) and a carriage (windows down each side), and burnt out. */
const loco = (ctx: Ctx, w: number, h: number, body: string, roof: string) => {
  roundRect(ctx, 0, 1, w, h - 2, 4, body);
  rect(ctx, 6, 4, w - 26, h - 8, roof);
  for (let x = 10; x < w - 26; x += 9) rect(ctx, x, 5, 4, h - 10, 'rgba(0,0,0,0.25)');
  roundRect(ctx, w - 18, 3, 14, h - 6, 3, '#f2c94c');
  rect(ctx, w - 10, 5, 4, h - 10, '#9fd3ff');
};
frame('loco', 72, 24, (ctx, w, h) => loco(ctx, w, h, '#1f4e79', '#2e6fb5'));
frame('wreck-loco', 72, 24, (ctx, w, h) => {
  loco(ctx, w, h, '#2f2b28', '#3a3532');
  char(ctx, w, h, seeded(37));
});
const carriage = (ctx: Ctx, w: number, h: number, body: string, glass: string) => {
  roundRect(ctx, 1, 1, w - 2, h - 2, 4, body);
  rect(ctx, 4, 4, w - 8, h - 8, '#d8d4cc');
  for (let x = 7; x < w - 8; x += 8) {
    rect(ctx, x, 2, 5, 2, glass);
    rect(ctx, x, h - 4, 5, 2, glass);
  }
};
frame('carriage', 68, 24, (ctx, w, h) => carriage(ctx, w, h, '#2e6fb5', '#9fd3ff'));
frame('wreck-carriage', 68, 24, (ctx, w, h) => {
  carriage(ctx, w, h, '#2f2b28', '#161412');
  char(ctx, w, h, seeded(39));
});
/** A station building: a long platform canopy roof, and its clock tower at one end. */
frame('station', 110, 50, (ctx, w, h) => {
  roof(ctx, w, h, ['#8c3524', '#6e2a1c', '#a8452e'], 6);
  rect(ctx, w - 26, 6, 20, h - 12, '#c9b98f');
  circle(ctx, w - 16, h / 2, 6, '#f2f2ec');
  rect(ctx, w - 16.5, h / 2 - 5, 1, 5, '#1d1d1f');
  rect(ctx, w - 16, h / 2 - 0.5, 4, 1, '#1d1d1f');
});
/** A stone railway bridge (rails along the top), and fallen in in the middle. */
for (const broken of [false, true]) {
  frame(`railbridge${broken ? '-broken' : ''}`, 128, 40, (ctx, w, h) => {
    const span = (x0: number, x1: number) => {
      rect(ctx, x0, 0, x1 - x0, h, '#8d8a83');
      rect(ctx, x0, 4, x1 - x0, h - 8, '#a39d93');
      for (let x = x0; x < x1; x += 7) rect(ctx, x, h / 2 - 9, 3, 18, '#6b4c2e');
      for (const y of [h / 2 - 6, h / 2 + 5]) rect(ctx, x0, y, x1 - x0, 1.5, '#d0d4d8');
    };
    if (!broken) span(0, w);
    else {
      span(0, 40);
      span(w - 40, w);
      const rand = seeded(41);
      for (let k = 0; k < 8; k++) blob(ctx, 44 + rand() * 40, 6 + rand() * (h - 12), 4, GREY[1 + (k % 3)], rand, 6);
    }
  });
}
/** Police cars and vans, their light bars blue one side then the other; and burnt out. */
const police = (ctx: Ctx, w: number, h: number, flash: number, van: boolean) => {
  roundRect(ctx, 0, 1, w, h - 2, van ? 4 : 6, '#f2f2ec');
  // The livery: a band of blue and yellow down each side.
  for (let x = 2; x < w - 2; x += 8) {
    rect(ctx, x, 1, 4, 2.5, '#1f4e79');
    rect(ctx, x + 4, 1, 4, 2.5, '#e0b33a');
    rect(ctx, x, h - 3.5, 4, 2.5, '#e0b33a');
    rect(ctx, x + 4, h - 3.5, 4, 2.5, '#1f4e79');
  }
  rect(ctx, w - (van ? 14 : 15), 4, 5, h - 8, '#9fd3ff');
  if (!van) rect(ctx, 9, 4, 4, h - 8, '#9fd3ff');
  const bar = van ? w - 24 : w / 2 - 2;
  rect(ctx, bar, 4, 4, h - 8, '#2b2d31');
  circle(ctx, bar + 2, 6.5, 2.4, flash ? '#4d8dff' : '#ff3b3b');
  circle(ctx, bar + 2, h - 6.5, 2.4, flash ? '#ff3b3b' : '#4d8dff');
  if (van) {
    ctx.font = 'bold 7px monospace';
    ctx.fillStyle = '#1f4e79';
    ctx.fillText('POLICE', 6, h / 2 + 2.5);
  }
};
for (const flash of [0, 1]) {
  frame(`police-${flash}`, 48, 22, (ctx, w, h) => police(ctx, w, h, flash, false));
  frame(`policevan-${flash}`, 62, 28, (ctx, w, h) => police(ctx, w, h, flash, true));
}
frame('wreck-police', 48, 22, (ctx, w, h) => {
  roundRect(ctx, 0, 1, w, h - 2, 6, '#3a3532');
  rect(ctx, 9, 3, 28, h - 6, '#161412');
  char(ctx, w, h, seeded(43));
});
frame('wreck-policevan', 62, 28, (ctx, w, h) => {
  roundRect(ctx, 0, 1, w, h - 2, 4, '#3a3532');
  rect(ctx, 4, 4, w - 18, h - 8, '#1d1a17');
  char(ctx, w, h, seeded(47));
});

// --- Life: people, animals, birds, and the water's movement ------------------------------

export const LIFE_VARIANTS = { person: 6, cow: 2 };
const SHIRTS = ['#d7263d', '#2e6fb5', '#e0b33a', '#2a9d8f', '#8338ec', '#f2f2f2'];
const HAIR = ['#3a2a1e', '#e0c070', '#1d1d1f', '#8a4a2a', '#c9b8a0', '#5a3a1e'];
/** People from above, facing right: standing, then a stride each way. */
for (let v = 0; v < LIFE_VARIANTS.person; v++) {
  for (const [f, stride] of [[0, 0], [1, 3], [2, -3]] as const) {
    frame(`person-${v}-${f}`, 16, 16, (ctx) => {
      ellipse(ctx, 8 + stride, 5, 2.4, 1.4, '#2b2d42');
      ellipse(ctx, 8 - stride, 11, 2.4, 1.4, '#2b2d42');
      ellipse(ctx, 8, 8, 3.4, 5, SHIRTS[v]);
      circle(ctx, 8.5, 8, 2.7, HAIR[v]);
    });
  }
}
/** Someone lying on their back sunbathing (head to the right), and someone sat down (facing right, knees up). */
const SKIN = ['#f1c9a5', '#d9a77c', '#a8714a', '#7a4e2e', '#e8b892', '#c08a5e'];
for (let v = 0; v < LIFE_VARIANTS.person; v++) {
  frame(`sunbather-${v}`, 16, 10, (ctx) => {
    ellipse(ctx, 3.5, 3.6, 3.2, 1.2, SKIN[v]);
    ellipse(ctx, 3.5, 6.4, 3.2, 1.2, SKIN[v]);
    ellipse(ctx, 8.5, 5, 3, 2.6, SHIRTS[(v + 3) % SHIRTS.length]);
    ellipse(ctx, 9, 2.2, 2.5, 0.9, SKIN[v]);
    ellipse(ctx, 9, 7.8, 2.5, 0.9, SKIN[v]);
    circle(ctx, 13, 5, 2.4, HAIR[v]);
  });
  frame(`sitter-${v}`, 16, 16, (ctx) => {
    ellipse(ctx, 11, 6.5, 3, 1.3, '#2b2d42');
    ellipse(ctx, 11, 9.5, 3, 1.3, '#2b2d42');
    ellipse(ctx, 6.5, 8, 3, 4.4, SHIRTS[v]);
    circle(ctx, 6.5, 8, 2.6, HAIR[v]);
  });
}
/** Forestry workers (hi-vis and a hard hat) and hikers (a rucksack), walking like everyone else. */
for (const [f, stride] of [[0, 0], [1, 3], [2, -3]] as const) {
  frame(`worker-${f}`, 16, 16, (ctx) => {
    ellipse(ctx, 8 + stride, 5, 2.4, 1.4, '#3a4a2a');
    ellipse(ctx, 8 - stride, 11, 2.4, 1.4, '#3a4a2a');
    ellipse(ctx, 8, 8, 3.4, 5, '#ff7a1a');
    rect(ctx, 7, 3.5, 2, 9, '#e8e84a');
    circle(ctx, 8.5, 8, 2.8, '#f2d22a');
  });
  for (let v = 0; v < 2; v++) {
    frame(`hiker-${v}-${f}`, 16, 16, (ctx) => {
      ellipse(ctx, 8 + stride, 5, 2.4, 1.4, '#4a4036');
      ellipse(ctx, 8 - stride, 11, 2.4, 1.4, '#4a4036');
      ellipse(ctx, 8, 8, 3.4, 5, v ? '#2e6fb5' : '#c0392b');
      roundRect(ctx, 3, 5, 4, 6, 1.5, v ? '#e0b33a' : '#3b5a3a');
      circle(ctx, 8.5, 8, 2.6, HAIR[v * 2]);
    });
  }
}
/** Farmers (green overalls and a straw hat), and hens (pecking: head down and up). */
for (const [f, stride] of [[0, 0], [1, 3], [2, -3]] as const) {
  frame(`farmer-${f}`, 16, 16, (ctx) => {
    ellipse(ctx, 8 + stride, 5, 2.4, 1.4, '#3a2a1e');
    ellipse(ctx, 8 - stride, 11, 2.4, 1.4, '#3a2a1e');
    ellipse(ctx, 8, 8, 3.4, 5, '#3f6e3a');
    circle(ctx, 8.5, 8, 3.6, '#d9c27a');
    circle(ctx, 8.5, 8, 1.8, '#c4aa5a');
  });
}
for (let v = 0; v < 2; v++) {
  const plumage = v ? '#a0522d' : '#f2efe6';
  for (const f of [0, 1]) {
    frame(`hen-${v}-${f}`, 10, 8, (ctx) => {
      ellipse(ctx, 4.5, 4, 3.6, 2.6, plumage);
      circle(ctx, f ? 8.6 : 7.6, 4, 1.6, plumage);
      rect(ctx, f ? 9.4 : 8.6, 3.6, 1, 0.8, '#e0b33a');
      circle(ctx, f ? 8.4 : 7.4, 3, 0.7, '#d7263d');
    });
  }
}
/** Kayakers (facing right, down the river): the boat, the paddler, and the paddle dipping one side then the other. */
for (let v = 0; v < 3; v++) {
  for (const f of [0, 1]) {
    frame(`kayak-${v}-${f}`, 34, 22, (ctx, w, h) => {
      ctx.fillStyle = ['#d7263d', '#e0b33a', '#2a9d8f'][v];
      ctx.beginPath();
      ctx.moveTo(2, h / 2);
      ctx.quadraticCurveTo(w / 2, h / 2 - 5, w - 2, h / 2);
      ctx.quadraticCurveTo(w / 2, h / 2 + 5, 2, h / 2);
      ctx.fill();
      ellipse(ctx, w / 2, h / 2, 3.4, 2.4, '#2b2d42');
      ctx.strokeStyle = '#1d1d1f';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 3 + (f ? 0 : 6), 2);
      ctx.lineTo(w / 2 + 3 - (f ? 0 : 6), h - 2);
      ctx.stroke();
      for (const [px, py] of [[w / 2 - 3 + (f ? 0 : 6), 2], [w / 2 + 3 - (f ? 0 : 6), h - 2]]) ellipse(ctx, px, py, 2.4, 1.2, '#f2c94c');
      circle(ctx, w / 2 + 0.5, h / 2, 2.2, '#e0b33a');
    });
  }
}
/** A swimmer's head and arms, strokes either way, with the splash. */
for (const f of [0, 1]) {
  frame(`swimmer-${f}`, 16, 16, (ctx) => {
    ellipse(ctx, 6, 8, 5, 4, 'rgba(255,255,255,0.55)');
    ellipse(ctx, 9, f ? 4 : 12, 3.4, 1.1, SKIN[f * 2]);
    ellipse(ctx, 6, f ? 12 : 4, 2.4, 1.1, SKIN[f * 2]);
    circle(ctx, 9, 8, 2.5, HAIR[f + 1]);
  });
}
/** Skiers (facing right, skis together), and a chairlift's chair, empty and with two on. */
for (let v = 0; v < LIFE_VARIANTS.person; v++) {
  frame(`skier-${v}`, 16, 16, (ctx) => {
    rect(ctx, 0, 5.5, 16, 1.4, '#1d1d1f');
    rect(ctx, 0, 9.5, 16, 1.4, '#1d1d1f');
    ellipse(ctx, 7, 8, 3.2, 4.4, SHIRTS[(v + 1) % SHIRTS.length]);
    circle(ctx, 7.5, 8, 2.5, v % 2 ? '#2b2d42' : '#e8e8e8');
  });
}
for (const riders of [0, 2]) {
  frame(`chair-${riders}`, 14, 18, (ctx, _w, h) => {
    rect(ctx, 6, 0, 2, h, '#3a3c3f');
    roundRect(ctx, 1, 2, 9, h - 4, 2, '#5d636b');
    for (let k = 0; k < riders; k++) {
      ellipse(ctx, 6, 5.5 + k * 7, 3, 3, SHIRTS[k * 3]);
      circle(ctx, 5, 5.5 + k * 7, 2.2, HAIR[k + 2]);
    }
  });
}
/** Sheep: a woolly back and a black face (down to the grass when grazing). */
for (const [f, graze] of [[0, false], [1, true]] as const) {
  frame(`sheep-${f}`, 24, 16, (ctx) => {
    const rand = seeded(5);
    for (let k = 0; k < 9; k++) circle(ctx, 9 + (rand() - 0.5) * 9, 8 + (rand() - 0.5) * 6, 3.2, k % 2 ? '#f2efe6' : '#e2ddd0');
    ellipse(ctx, graze ? 19.5 : 18, 8, 3, 2.2, '#2a2522');
  });
}
/** Cows: black and white, or brown; grazing with the head down. */
for (let v = 0; v < LIFE_VARIANTS.cow; v++) {
  for (const [f, graze] of [[0, false], [1, true]] as const) {
    frame(`cow-${v}-${f}`, 36, 20, (ctx) => {
      ellipse(ctx, 15, 10, 12, 7, v === 0 ? '#f2f2f0' : '#8a5a34');
      if (v === 0) {
        ellipse(ctx, 11, 7, 4, 3, '#1d1d1f');
        ellipse(ctx, 18, 12, 3.5, 2.5, '#1d1d1f');
      }
      ellipse(ctx, graze ? 30 : 28, 10, 4.5, 3.4, v === 0 ? '#1d1d1f' : '#6b4226');
      rect(ctx, 2, 9, 3, 2, '#2a2522');
    });
  }
}
/** Deer: grazing, and two strides of a bound. */
for (const pose of ['graze', 'run-0', 'run-1'] as const) {
  frame(`deer-${pose}`, 32, 16, (ctx) => {
    if (pose !== 'graze') {
      const s = pose === 'run-0' ? 1 : -1;
      ctx.strokeStyle = '#5e3b1b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(9, 8);
      ctx.lineTo(9 - s * 5, 8 + 5);
      ctx.moveTo(19, 8);
      ctx.lineTo(19 + s * 5, 8 - 5);
      ctx.stroke();
    }
    ellipse(ctx, 14, 8, 9, 4, '#8b5a2b');
    circle(ctx, 5, 8, 1.8, '#f2ece0');
    ellipse(ctx, pose === 'graze' ? 26 : 24, 8, 3.6, 2.4, '#8b5a2b');
  });
}
/** Birds, wings up and down (white, to be tinted: gulls by the sea, darker inland). */
for (const f of [0, 1]) {
  frame(`bird-${f}`, 18, 14, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, f === 0 ? 1 : 4);
    ctx.quadraticCurveTo(8, 6, 10, 7);
    ctx.quadraticCurveTo(8, 8, 4, f === 0 ? 13 : 10);
    ctx.stroke();
    ellipse(ctx, 10, 7, 4, 1.6, '#ffffff');
  });
}
/** A wave's crest, and the foam of one breaking on the shore. */
frame('wave', 30, 8, (ctx) => {
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 6);
  ctx.quadraticCurveTo(15, -1, 29, 6);
  ctx.stroke();
});
frame('foam', 44, 14, (ctx) => {
  const rand = seeded(17);
  for (let k = 0; k < 14; k++) ellipse(ctx, 4 + rand() * 36, 7 + Math.sin(k) * 2, 3 + rand() * 4, 1.5 + rand() * 1.5, 'rgba(255,255,255,0.85)');
});
frame('leaf', 6, 4, (ctx) => ellipse(ctx, 3, 2, 2.8, 1.6, '#4f8a3a'));

/** Draws every picture onto the texture (once per game). */
export function createTankTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TANK_TEXTURE)) return;
  const width = 1024;
  const pad = 2;
  const placed: { spec: FrameSpec; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const spec of [...FRAMES].sort((a, b) => b.h - a.h)) {
    if (x + spec.w > width) {
      x = 0;
      y += shelf + pad;
      shelf = 0;
    }
    placed.push({ spec, x, y });
    x += spec.w + pad;
    shelf = Math.max(shelf, spec.h);
  }
  const texture = scene.textures.createCanvas(TANK_TEXTURE, width, y + shelf)!;
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
