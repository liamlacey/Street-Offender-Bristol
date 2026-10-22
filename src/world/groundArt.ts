/**
 * The ground's textures, drawn in code as small tiles that repeat: paving
 * slabs, setts, tarmac, mown grass, soil and flowers, water, decking. Each
 * is anchored to the map, so they line up from one piece of ground to the next.
 */

import type { AreaKind } from '../map/osm';
import { newCanvas } from './canvas';
import type { Palette } from './ground';

type Ctx = CanvasRenderingContext2D;

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function tile(size: number, draw: (ctx: Ctx, rand: () => number) => void, seed = 7): HTMLCanvasElement {
  const canvas = newCanvas(size, size);
  draw(canvas.getContext('2d')!, seeded(seed));
  return canvas;
}

/** Specks of lighter and darker over a tile, for grit and wear. */
function speckle(ctx: Ctx, rand: () => number, size: number, count: number, colours: string[], r = 0.8): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[i % colours.length];
    ctx.fillRect(rand() * size, rand() * size, r + rand() * r, r + rand() * r);
  }
}

/** Square slabs with joints between, each a slightly different shade. */
function slabs(base: [number, number, number], slab: number, size: number, joint: string, seed: number): HTMLCanvasElement {
  return tile(
    size,
    (ctx, rand) => {
      for (let y = 0; y < size; y += slab) {
        for (let x = 0; x < size; x += slab) {
          const v = (rand() - 0.5) * 6;
          ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v})`;
          ctx.fillRect(x, y, slab, slab);
        }
      }
      speckle(ctx, rand, size, size * 1.5, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.07)']);
      ctx.fillStyle = joint;
      for (let k = 0; k < size; k += slab) {
        ctx.fillRect(k, 0, 1, size);
        ctx.fillRect(0, k, size, 1);
      }
    },
    seed,
  );
}

/** Small stone setts in rows, each row offset by half. */
function setts(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#4f4c48';
    ctx.fillRect(0, 0, size, size);
    // Tiles seamlessly: whole setts across, and an even number of rows down.
    const w = 6;
    const h = 4;
    for (let row = 0; row * h < size; row++) {
      for (let x = row % 2 ? -w / 2 : 0; x < size; x += w) {
        const v = (rand() - 0.5) * 22;
        ctx.fillStyle = `rgb(${118 + v},${114 + v},${108 + v})`;
        ctx.fillRect(x + 0.5, row * h + 0.5, w - 1, h - 1);
      }
    }
  }, 11);
}

/** Packed gravel and earth: a path through the park. */
function gravel(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#a8977a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 6, ['#8f7e63', '#bfae90', '#776a55', '#c9bda4'], 1);
  }, 21);
}

/** A railway's ballast: grey-brown stones, packed close. */
function ballast(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#7a746a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 9, ['#5d5850', '#958e83', '#6a655d', '#a69f93', '#4e4a44'], 1.1);
  }, 29);
}

function asphalt(size: number, base: string, seed: number): HTMLCanvasElement {
  return tile(
    size,
    (ctx, rand) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      speckle(ctx, rand, size, size * 5, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.03)'], 0.7);
      // The odd patch and crack.
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(rand() * size, rand() * size, 8 + rand() * 18, 6 + rand() * 12);
      }
    },
    seed,
  );
}

function grass(size: number, base: string, dark: string, light: string, stripes: boolean, seed: number): HTMLCanvasElement {
  return tile(
    size,
    (ctx, rand) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      if (stripes) {
        // Mown in stripes.
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 16, size);
      }
      speckle(ctx, rand, size, size * 4, [dark, light], 1.1);
      for (let i = 0; i < size / 6; i++) {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(4 + rand() * (size - 8), 4 + rand() * (size - 8), 1.5 + rand() * 3, 0, Math.PI * 2);
        ctx.globalAlpha = 0.4;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    },
    seed,
  );
}

/** A field of crops, in rows a metre apart, over its earth. */
function field(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#7c6a44';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 2, ['#6a5a38', '#8e7c54'], 1.2);
    for (let y = 2; y < size; y += 8) {
      ctx.fillStyle = 'rgba(112,140,58,0.9)';
      ctx.fillRect(0, y, size, 4);
      ctx.fillStyle = 'rgba(150,170,80,0.5)';
      for (let x = 0; x < size; x += 3) if (rand() < 0.5) ctx.fillRect(x, y + rand() * 3, 2, 1.5);
    }
  }, 61);
}

/** Allotments: plots side by side, each of rows of vegetables, bare soil or grass; a shed or two; grass paths between. */
function allotments(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#5c8a3e';
    ctx.fillRect(0, 0, size, size);
    const [w, h] = [size / 4, size / 2];
    for (let px = 0; px < size; px += w) {
      for (let py = 0; py < size; py += h) {
        const [x, y] = [px + 2, py + 2];
        const kind = rand();
        ctx.fillStyle = kind < 0.25 ? '#6b8f45' : '#6e5638';
        ctx.fillRect(x, y, w - 4, h - 4);
        if (kind >= 0.25) {
          // Rows of something growing.
          const green = rand() < 0.5 ? '#4f7f34' : '#7da848';
          for (let k = y + 3; k < y + h - 6; k += 5) {
            ctx.fillStyle = green;
            for (let q = x + 2; q < x + w - 6; q += 3) if (rand() < 0.8) ctx.fillRect(q, k, 2, 2);
          }
        }
        // A shed, now and then.
        if (rand() < 0.3) {
          ctx.fillStyle = rand() < 0.5 ? '#7a6a58' : '#5d6b4c';
          ctx.fillRect(x + w - 14, y + h - 14, 9, 8);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x + w - 14, y + h - 6, 9, 2);
        }
      }
    }
  }, 67);
}

function flowerbed(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#4e3a2a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 3, ['#3e2d20', '#62493a'], 1);
    const flowers = ['#e8505b', '#f2c94c', '#bb6bd9', '#ffffff', '#ff8c42'];
    for (let i = 0; i < size / 2; i++) {
      const x = 3 + rand() * (size - 6);
      const y = 3 + rand() * (size - 6);
      ctx.fillStyle = '#3f6b2c';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flowers[Math.floor(rand() * flowers.length)];
      ctx.beginPath();
      ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 5);
}

function water(size: number, base: string, crest: string, seed: number): HTMLCanvasElement {
  return tile(
    size,
    (ctx, rand) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = crest;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < size / 5; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const w = 4 + rand() * 8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
        ctx.stroke();
      }
    },
    seed,
  );
}

function planks(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#6e5238';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 4) {
      const v = (rand() - 0.5) * 20;
      ctx.fillStyle = `rgb(${128 + v},${98 + v},${68 + v})`;
      ctx.fillRect(0, y, size, 3.2);
    }
    speckle(ctx, rand, size, size, ['rgba(0,0,0,0.15)'], 0.8);
  }, 9);
}

/** A pontoon's composite decking: grey-brown boards with gaps between, a little weathered. */
function composite(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#4f4a44';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 4) {
      const v = (rand() - 0.5) * 14;
      ctx.fillStyle = `rgb(${132 + v},${124 + v},${112 + v})`;
      ctx.fillRect(0, y, size, 3.4);
    }
    speckle(ctx, rand, size, size, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.08)'], 0.8);
  }, 21);
}

function rubber(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#9a4d3a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 4, ['#7f3d2e', '#b0604a', '#3f7a5a'], 0.8);
  }, 3);
}

function soil(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#86704f';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 4, ['#6f5a3d', '#9c8662', '#5d4a32'], 1.4);
  }, 13);
}

/** Brownfield: rough ground, left: patchy, rank grass and weeds over bare earth, gravel and bits of rubble. */
function wasteland(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#7e7a52';
    ctx.fillRect(0, 0, size, size);
    // Bare patches of earth and hardcore.
    for (let i = 0; i < size / 10; i++) {
      ctx.fillStyle = rand() < 0.6 ? 'rgba(134,112,79,0.75)' : 'rgba(150,146,134,0.6)';
      ctx.beginPath();
      ctx.ellipse(rand() * size, rand() * size, 4 + rand() * 10, 3 + rand() * 7, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, rand, size, size * 3, ['#5f5c38', '#9a9468', '#6f5a3d', '#a8a49a'], 1.3);
    // Clumps of weeds and long grass.
    for (let i = 0; i < size / 4; i++) {
      const [x, y, r] = [rand() * size, rand() * size, 1.5 + rand() * 3.5];
      ctx.fillStyle = rand() < 0.5 ? 'rgba(74,98,44,0.8)' : 'rgba(110,122,62,0.8)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bits of brick and concrete.
    for (let i = 0; i < size / 8; i++) {
      ctx.fillStyle = rand() < 0.5 ? '#9a5a42' : '#b4b0a6';
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand());
    }
  }, 29);
}

/**
 * People's gardens and yards, behind and between the houses: lawns, a little
 * rougher and darker than a park's, with beds of soil and the odd shrub (their
 * patios and drives are drawn over them: see homes.ts).
 */
function gardens(size: number): HTMLCanvasElement {
  return tile(size, (ctx, rand) => {
    ctx.fillStyle = '#517f3a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, rand, size, size * 4, ['rgba(40,75,28,0.6)', 'rgba(140,180,90,0.35)'], 1.1);
    // Beds of soil, and shrubs.
    for (let i = 0; i < size / 32; i++) {
      ctx.fillStyle = 'rgba(94,72,48,0.8)';
      ctx.fillRect(rand() * size, rand() * size, 12 + rand() * 16, 3 + rand() * 3);
    }
    for (let i = 0; i < size / 10; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(46,86,34,0.9)' : 'rgba(64,104,42,0.9)';
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 1.5 + rand() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 53);
}

/** The ground's look, with patterns made for the given context. */
export function artPalette(ctx: Ctx): Palette {
  const pattern = (canvas: HTMLCanvasElement) => ctx.createPattern(canvas, 'repeat')!;
  const pavement = pattern(slabs([150, 146, 139], 16, 64, 'rgba(60,56,50,0.16)', 1));
  const lawn = pattern(grass(128, '#4c8a37', 'rgba(40,80,30,0.6)', 'rgba(140,190,90,0.35)', true, 2));
  const area: Record<AreaKind, CanvasPattern | string> = {
    grass: lawn,
    park: lawn,
    garden: pattern(grass(96, '#4f8d3d', 'rgba(40,80,30,0.6)', 'rgba(150,200,100,0.35)', false, 4)),
    gardens: pattern(gardens(160)),
    // A school's playground: tarmac, paler than a road's; its courts, darker (their lines painted on: see paint.ts).
    schoolyard: pattern(asphalt(96, '#6b6c6e', 83)),
    court: pattern(asphalt(64, '#545a5e', 89)),
    // An industrial estate's yard: big concrete panels, stained.
    works: pattern(slabs([142, 140, 134], 40, 80, 'rgba(50,50,46,0.28)', 97)),
    // A patio: big slabs, buff; a drive: block paving.
    patio: pattern(slabs([176, 164, 140], 20, 80, 'rgba(70,60,45,0.3)', 59)),
    drive: pattern(slabs([138, 112, 98], 6, 48, 'rgba(50,35,30,0.35)', 71)),
    field: pattern(field(128)),
    allotments: pattern(allotments(128)),
    flowerbed: pattern(flowerbed(64)),
    wood: pattern(grass(96, '#3a6a2c', 'rgba(25,55,20,0.7)', 'rgba(110,150,70,0.3)', false, 6)),
    pitch: pattern(grass(128, '#4f9a3c', 'rgba(40,90,30,0.5)', 'rgba(150,210,100,0.3)', true, 8)),
    play: pattern(rubber(64)),
    plaza: pattern(slabs([182, 172, 156], 24, 96, 'rgba(70,62,50,0.3)', 3)),
    parking: pattern(asphalt(64, '#56585b', 10)),
    dirt: pattern(soil(64)),
    brownfield: pattern(wasteland(128)),
    water: pattern(water(128, '#2b5c78', 'rgba(150,200,225,0.35)', 12)),
    pool: pattern(water(64, '#4c9fc4', 'rgba(220,245,255,0.5)', 14)),
    pier: pattern(planks(64)),
    pontoon: pattern(composite(64)),
    forecourt: pattern(asphalt(64, '#4f5053', 25)),
    // A bus station's yard: big concrete panels, worn darker where the buses drive.
    yard: pattern(slabs([128, 127, 123], 48, 48, 'rgba(45,45,42,0.3)', 41)),
    slipway: pattern(slabs([164, 160, 152], 64, 64, 'rgba(70,68,62,0.18)', 23)),
    island: pavement,
    // A platform: long concrete slabs (its edges are drawn over: see ground.ts).
    platform: pattern(slabs([170, 166, 158], 32, 48, 'rgba(70,66,58,0.22)', 47)),
  };
  return {
    surface: false,
    base: pavement,
    area,
    pavement,
    path: pattern(slabs([168, 162, 152], 12, 48, 'rgba(60,56,50,0.3)', 15)),
    plaza: area.plaza,
    cycleway: pattern(asphalt(64, '#7a5049', 16)),
    steps: '#b3aa9a',
    track: pattern(soil(64)),
    ballast: pattern(ballast(64)),
    kerb: '#c2bfb6',
    parapet: '#7c7366',
    asphalt: pattern(asphalt(128, '#48494c', 17)),
    paving: {
      asphalt: pattern(asphalt(64, '#5d5e60', 18)),
      paving: pattern(slabs([168, 162, 152], 12, 48, 'rgba(60,56,50,0.3)', 15)),
      sett: pattern(setts(48)),
      concrete: pattern(slabs([176, 174, 168], 32, 64, 'rgba(70,70,66,0.25)', 19)),
      gravel: pattern(gravel(64)),
      wood: pattern(planks(64)),
      grass: lawn,
    },
    marking: 'rgba(236,233,220,0.9)',
    quay: '#bdb3a0',
    pool: '#d6d1c4',
  };
}
