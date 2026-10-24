import type * as Phaser from 'phaser';
import { AIR, type Bird, type Dog, type Gather, type Kickabout, LOOKS, type People, type Person, type Picnic } from '../world/people';
import type { Drill } from '../world/places';
import type { Act } from '../world/streetLife';
import type { Perspective } from '../world/perspective';
import { ART_SCALE, canvasTexture } from './art';

type Ctx = CanvasRenderingContext2D;

/** Drawn a little bigger than life, so they can be made out on a phone. */
export const SIZE = 1.5;

/** Their clothes (a top, and trousers or a skirt), their hair; and skin. */
const TOPS = ['#2f4a7a', '#8a2b2b', '#2e5d3c', '#d8d2c2', '#1f1f22', '#c4762f', '#6b4c8a', '#3d7f8c', '#b8a43a', '#9c9c9c', '#d06a8a', '#4a5a2e'];
const BOTTOMS = ['#22293a', '#3a3a3a', '#5a4a36', '#2a3f5f'];
const HAIR = ['#1c1410', '#4a2e1a', '#8a6a3a', '#c9b07a', '#6e6e6e', '#a8452a'];
const SKIN = ['#e6c2a2', '#c99a74', '#8d5e3c', '#5c3b25'];

/** One of the looks' clothes, hair and skin. */
export function clothes(look: number): { top: string; bottom: string; hair: string; skin: string } {
  return { top: TOPS[look % TOPS.length], bottom: BOTTOMS[Math.floor(look / 3) % BOTTOMS.length], hair: HAIR[Math.floor(look / 5) % HAIR.length], skin: SKIN[Math.floor(look / 7) % SKIN.length] };
}

/** A person from above, facing right: `pose` is standing, a step (one foot forward, then the other), or lying down. */
function person(ctx: Ctx, look: number, pose: Pose, uniform?: Uniform): void {
  const own = clothes(look);
  // (A prisoner: their orange jumpsuit, top and bottom; a soldier: camouflage, and a beret for their hair.)
  const [top, bottom] = uniform === 'inmate' ? [JUMPSUIT, shadeOf(JUMPSUIT)] : uniform === 'soldier' ? [CAMO, shadeOf(CAMO)] : [own.top, own.bottom];
  const hair = uniform === 'soldier' ? BERET[look % BERET.length] : own.hair;
  const { skin } = own;
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (pose === 'down') {
    // Lying flat: legs, body, arms out, head.
    const [cx, cy] = [8, 4];
    ellipse(cx + 0.6, cy + 0.8, 7, 2.6, 'rgba(0,0,0,0.25)');
    ellipse(cx - 3.8, cy - 1, 2.6, 0.9, bottom);
    ellipse(cx - 3.6, cy + 1.1, 2.6, 0.9, bottom);
    ellipse(cx + 1, cy, 2.6, 2.1, top);
    ellipse(cx + 1.6, cy - 2.6, 1.6, 0.7, top);
    ellipse(cx + 0.6, cy + 2.7, 1.6, 0.7, top);
    ellipse(cx + 4.8, cy, 1.25, 1.2, hair);
    ellipse(cx + 5.6, cy, 0.5, 0.75, skin);
    return;
  }
  const [cx, cy] = [5, 5];
  ellipse(cx + 0.7, cy + 1, 2.2, 3.1, 'rgba(0,0,0,0.25)');
  if (pose === 'sit') {
    // Sitting: their legs out in front of them (thighs, then shins down out of sight), hands in their lap.
    ellipse(cx + 1.9, cy - 1, 1.6, 0.75, bottom);
    ellipse(cx + 1.9, cy + 1, 1.6, 0.75, bottom);
    ellipse(cx, cy, 1.5, 2.8, top);
    ellipse(cx - 0.2, cy, 1.15, 2.2, shadeOf(top));
    ellipse(cx + 1.2, cy - 1.9, 0.8, 0.55, top);
    ellipse(cx + 1.2, cy + 1.9, 0.8, 0.55, top);
    ellipse(cx + 0.1, cy, 1.2, 1.15, hair);
    ellipse(cx + 1.05, cy, 0.4, 0.75, skin);
    return;
  }
  // Feet (one forward, one back, as they walk) and their legs' colour peeking out; arms swinging the other way.
  const stride = pose === 'stand' ? 0 : pose === 'step0' ? 1 : -1;
  ellipse(cx + 1.6 * stride, cy - 1.1, 1.1, 0.7, bottom);
  ellipse(cx - 1.6 * stride, cy + 1.1, 1.1, 0.7, bottom);
  ellipse(cx - 1 * stride, cy - 2.9, 0.9, 0.65, top);
  ellipse(cx + 1 * stride, cy + 2.9, 0.9, 0.65, top);
  // Shoulders, and the head on top.
  ellipse(cx, cy, 1.5, 2.8, top);
  ellipse(cx - 0.2, cy, 1.15, 2.2, shadeOf(top));
  ellipse(cx + 0.2, cy, 1.2, 1.15, hair);
  ellipse(cx + 1.15, cy, 0.4, 0.75, skin);
  if (uniform === 'soldier') {
    // Camouflage blotches on their back.
    ellipse(cx - 0.6, cy - 1.1, 0.55, 0.45, '#3d4529');
    ellipse(cx + 0.1, cy + 1.4, 0.5, 0.4, '#6b6a45');
  }
}

/** What someone's in, if it's not their own clothes: a prisoner's jumpsuit, a soldier's camouflage. */
export type Uniform = 'inmate' | 'soldier';
/** A soldier's camouflage (its main colour), and their berets (the regiments'). */
const CAMO = '#5b6340';
const BERET = ['#3f2a3d', '#2c4a2a', '#2d3a5c', '#7a2230'];

function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c * 0.88 + 255 * 0.04);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export type Pose = 'stand' | 'step0' | 'step1' | 'down' | 'sit';

/** Picnic blankets: red and white check, blue and white check, a tartan, a plain green. */
const BLANKETS: [string, string][] = [['#c8372d', '#f2ece0'], ['#2f5f9a', '#eef0f2'], ['#7a2a2a', '#2b4a2e'], ['#5f8a4a', '#5f8a4a']];

function blanket(scene: Phaser.Scene, pattern: number): string {
  const key = `blanket-${pattern}`;
  const [a, b] = BLANKETS[pattern % BLANKETS.length];
  canvasTexture(scene, key, 16, 12, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0.8, 0.8, 15, 11);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 15, 11);
    ctx.fillStyle = a;
    for (let x = 0; x < 15; x += 3) for (let y = 0; y < 11; y += 3) if (((x + y) / 3) % 2 === 0) ctx.fillRect(x, y, 1.5, 1.5);
    ctx.globalAlpha = 0.5;
    for (let x = 0; x < 15; x += 3) ctx.fillRect(x, 0, 1.5, 11);
    ctx.globalAlpha = 1;
    // A basket, and something to eat.
    ctx.fillStyle = '#9a7040';
    ctx.fillRect(9, 3.5, 3, 2.4);
    ctx.fillStyle = '#e8d8b0';
    ctx.beginPath();
    ctx.arc(5, 6.5, 1.1, 0, Math.PI * 2);
    ctx.fill();
  });
  return key;
}

/**
 * A performer, from above, facing right (the crowd's way), in one of a few
 * frames: strumming a guitar, bowing a violin, beating a drum, juggling
 * three balls; or a living statue on a box, painted all over silver.
 */
export function performerTexture(scene: Phaser.Scene, look: number, act: Act, frame: number): string {
  const key = `performer-${act}-${look % LOOKS}-${frame}`;
  canvasTexture(scene, key, 12, 12, (ctx) => {
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const line = (ax: number, ay: number, bx: number, by: number, width: number, stroke: string) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    if (act === 'statue') {
      // The box they stand on.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(2.4, 2.4, 8, 8);
      ctx.fillStyle = '#4a4d52';
      ctx.fillRect(2, 2, 7.6, 7.6);
    }
    ctx.save();
    ctx.translate(1, 1);
    person(ctx, look, 'stand');
    ctx.restore();
    if (act === 'charity' || act === 'bigissue') {
      // A tabard over their top (a charity's bright colour; the Big Issue's red), and a clipboard or the magazine held out.
      const tabard = act === 'bigissue' ? '#d71920' : ['#1e9be0', '#7ac143', '#e6007e', '#f39200'][look % 4];
      ellipse(6, 6, 1.35, 2.5, tabard);
      ellipse(6.2, 6, 1.2, 1.15, clothes(look).hair);
      ellipse(7.15, 6, 0.4, 0.75, clothes(look).skin);
      if (act === 'charity') {
        ctx.fillStyle = '#5a4a3a';
        ctx.fillRect(7.4, 6.6, 1.6, 2.1);
        ctx.fillStyle = '#f4f4f0';
        ctx.fillRect(7.6, 6.9, 1.2, 1.6);
      } else {
        ctx.fillStyle = '#d71920';
        ctx.fillRect(7.5, 4.2, 1.5, 1.9);
        ctx.fillStyle = '#f4f4f0';
        ctx.fillRect(7.7, 4.4, 1.1, 0.5);
      }
      return;
    }
    if (act === 'statue') {
      // Painted all over: silver.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(196,202,208,0.88)';
      ctx.fillRect(2.2, 2.2, 7.2, 7.2);
      ctx.globalCompositeOperation = 'source-over';
      ellipse(6.6, 6, 0.6, 0.6, 'rgba(255,255,255,0.6)');
      return;
    }
    const [cx, cy] = [6, 6];
    if (act === 'guitar') {
      // Its body at their hip, its neck out to their left; the strumming hand.
      line(cx + 0.8, cy + 0.6, cx + 2.2, cy - 3.4, 0.7, '#4a2e16');
      ellipse(cx + 0.9, cy + 1.3, 1.5, 1.1, '#b06a2a');
      ellipse(cx + 0.9, cy + 1.2, 0.45, 0.45, '#2a1a0e');
      ellipse(cx + 1.5 + (frame ? 0.5 : -0.3), cy + 1.9, 0.55, 0.5, '#e6c2a2');
    } else if (act === 'violin') {
      // Under their chin, the bow across it, to and fro.
      ellipse(cx + 0.9, cy - 1.4, 1.1, 0.6, '#8a4a1e');
      line(cx + 2.6 - frame * 1.2, cy - 2.6, cx - 0.2 - frame * 1.2, cy + 0.4, 0.35, '#d8cfb8');
    } else if (act === 'drums') {
      // A drum in front of them, the sticks up and down.
      ellipse(cx + 2.4, cy, 1.9, 1.9, '#b33a2e');
      ellipse(cx + 2.4, cy, 1.5, 1.5, '#e8e4da');
      line(cx + 0.6, cy - 1.2, cx + (frame ? 2.4 : 1.6), cy - (frame ? 0.6 : 1.6), 0.35, '#c9a46a');
      line(cx + 0.6, cy + 1.2, cx + (frame ? 1.6 : 2.4), cy + (frame ? 1.6 : 0.6), 0.35, '#c9a46a');
    } else {
      // Three balls up in the air in front of them, round and round.
      ['#e0412c', '#f2c21a', '#2f6fd0'].forEach((c, i) => {
        const a = ((frame / 3 + i / 3) * Math.PI * 2);
        ellipse(cx + 2.4 + Math.cos(a) * 1.2, cy + Math.sin(a) * 2, 0.55, 0.55, c);
      });
    }
  });
  return key;
}

/** How many frames each act has. */
export const ACT_FRAMES: Record<Act, number> = { guitar: 2, violin: 2, drums: 2, juggler: 3, statue: 1, charity: 1, bigissue: 1 };

/** What's on the ground in front of a performer: an open guitar case (with coins in it), or a hat. */
function takings(scene: Phaser.Scene, act: Act): string {
  const key = act === 'guitar' || act === 'violin' ? 'takings-case' : 'takings-hat';
  if (key === 'takings-case')
    canvasTexture(scene, key, 6, 3, (ctx) => {
      ctx.fillStyle = '#2a1e16';
      ctx.fillRect(0, 0, 6, 3);
      ctx.fillStyle = '#8a2234';
      ctx.fillRect(0.4, 0.4, 5.2, 2.2);
      ctx.fillStyle = '#e8c45a';
      for (const [x, y] of [[1.4, 1], [2.8, 1.8], [4.2, 1.2], [3.4, 0.9]]) ctx.fillRect(x, y, 0.6, 0.6);
    });
  else
    canvasTexture(scene, key, 3, 3, (ctx) => {
      ctx.fillStyle = '#2b2b30';
      ctx.beginPath();
      ctx.arc(1.5, 1.5, 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141416';
      ctx.beginPath();
      ctx.arc(1.5, 1.5, 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c45a';
      ctx.fillRect(1.2, 1.2, 0.6, 0.6);
    });
  return key;
}

/** A pigeon from above, facing right: standing, pecking (head down), or flying (wings up, wings down). */
function pigeonTexture(scene: Phaser.Scene, pose: 'stand' | 'peck' | 'fly0' | 'fly1', gull = false): string {
  const key = `${gull ? 'gull' : 'pigeon'}-${pose}`;
  // (A gull: white, its wings grey, its beak yellow.)
  const [wing, tail, body, neck, head, beak] = gull ? ['#a9b0b6', '#2a2c2e', '#f2f2ee', '#e8e8e4', '#f6f6f2', '#e8c22a'] : ['#7d8590', '#5d6570', '#8a929c', '#6a7d74', '#5a6068', '#d9a080'];
  canvasTexture(scene, key, 6, 6, (ctx) => {
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    if (pose === 'fly0' || pose === 'fly1') {
      const spread = pose === 'fly0' ? 2.6 : 1.6;
      ellipse(2.8, 3 - spread * 0.7, 0.9, spread * 0.55, wing);
      ellipse(2.8, 3 + spread * 0.7, 0.9, spread * 0.55, wing);
    } else ellipse(3.2, 3.3, 1.3, 0.75, 'rgba(0,0,0,0.2)');
    // Tail, body, the sheen on its neck, its head and beak.
    ellipse(1.3, 3, 0.8, 0.5, tail);
    ellipse(2.8, 3, 1.3, 0.85, body);
    const hx = pose === 'peck' ? 4.6 : 4.1;
    ellipse(hx - 0.5, 3, 0.5, 0.55, neck);
    ellipse(hx, 3, 0.45, 0.45, head);
    ellipse(hx + 0.5, 3, 0.25, 0.15, beak);
  });
  return key;
}

/** The dogs: a black Lab, a golden retriever, a border collie, a Jack Russell (smaller). From above, facing right, its legs one way then the other. */
const DOGS: { body: string; patch: string; size: number }[] = [
  { body: '#1e1b18', patch: '#2c2824', size: 1 },
  { body: '#d9a45a', patch: '#e8be7a', size: 1 },
  { body: '#232120', patch: '#f2efe8', size: 0.95 },
  { body: '#f2efe8', patch: '#8a5a2e', size: 0.7 },
];

function dogTexture(scene: Phaser.Scene, look: number, frame: number): string {
  const key = `dog-${look}-${frame}`;
  canvasTexture(scene, key, 9, 6, (ctx) => {
    const { body, patch, size } = DOGS[look % DOGS.length];
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(4.5 + (x - 4.5) * size, 3 + (y - 3) * size, rx * size, ry * size, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    ellipse(4.8, 3.6, 3, 1.3, 'rgba(0,0,0,0.22)');
    // Legs (paws peeking out), stepping.
    const s = frame ? 0.5 : -0.5;
    for (const [x, y] of [[6 + s, 1.7], [6 - s, 4.3], [2.8 - s, 1.8], [2.8 + s, 4.2]]) ellipse(x, y, 0.5, 0.4, body);
    // Tail, body (a patch on its back), head and ears, nose.
    ellipse(0.9, 3 + s * 0.6, 0.9, 0.3, body);
    ellipse(4.2, 3, 2.7, 1.25, body);
    ellipse(3.8, 3, 1.2, 0.8, patch);
    ellipse(7.3, 3, 1.05, 0.95, body);
    ellipse(6.9, 2.1, 0.5, 0.35, look === 1 ? '#c48a42' : body);
    ellipse(6.9, 3.9, 0.5, 0.35, look === 1 ? '#c48a42' : body);
    ellipse(8.3, 3, 0.35, 0.3, '#111');
  });
  return key;
}

/**
 * A game's ball: a football (white, its black panels), a frisbee (bright plastic); on a pitch or a court, its own (a tennis ball,
 * a basketball, a rugby ball, a cricket ball, a bowl, ...).
 */
const BALLS: Record<Kickabout['kind'], { colour: string; r: number; inner?: string; ir?: number; oval?: boolean }> = {
  football: { colour: '#f4f4f0', r: 1.1, inner: '#1d1d1f', ir: 0.45 },
  frisbee: { colour: '#ff5a1f', r: 1.6, inner: 'rgba(255,255,255,0.45)', ir: 1 },
  tennis: { colour: '#d8ec3a', r: 0.6 },
  padel: { colour: '#e9f04a', r: 0.6 },
  pingpong: { colour: '#fbfbf6', r: 0.4 },
  basketball: { colour: '#d9692a', r: 1.3, inner: 'rgba(40,20,10,0.6)', ir: 0.25 },
  netball: { colour: '#f3efe0', r: 1.2, inner: '#3a6fc0', ir: 0.4 },
  hockey: { colour: '#f8f8f4', r: 0.55 },
  rugby: { colour: '#8a5a32', r: 1.2, inner: '#f2f0e6', ir: 0.2, oval: true },
  cricket: { colour: '#b0232a', r: 0.6 },
  bowls: { colour: '#3a2a20', r: 0.9, inner: '#c8b98a', ir: 0.25 },
  croquet: { colour: '#2d58b8', r: 0.8 },
};

function ballTexture(scene: Phaser.Scene, kind: Kickabout['kind']): string {
  const key = `ball-${kind}`;
  const look = BALLS[kind];
  canvasTexture(scene, key, 4, 4, (ctx) => {
    ctx.fillStyle = look.colour;
    ctx.beginPath();
    if (look.oval) ctx.ellipse(2, 2, look.r * 1.4, look.r, 0, 0, Math.PI * 2);
    else ctx.arc(2, 2, look.r, 0, Math.PI * 2);
    ctx.fill();
    if (look.inner) {
      ctx.fillStyle = look.inner;
      ctx.beginPath();
      ctx.arc(2, 2, look.ir ?? 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'frisbee') {
      ctx.fillStyle = '#ff5a1f';
      ctx.beginPath();
      ctx.arc(2, 2, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return key;
}

export function personTexture(scene: Phaser.Scene, look: number, pose: Pose, hivis = false, lollipop = false, uniform?: Uniform): string {
  const key = `person-${look % LOOKS}-${pose}${hivis ? '-hivis' : ''}${lollipop ? '-lollipop' : ''}${uniform ? `-${uniform}` : ''}`;
  const draw = (ctx: Ctx) => {
    person(ctx, look, pose, uniform);
    if (hivis) hiVis(ctx, pose);
    if (lollipop) lollipopLady(ctx, pose);
  };
  if (pose === 'down') canvasTexture(scene, key, 16, 8, draw);
  else canvasTexture(scene, key, 10, 10, draw);
  return key;
}

/** A prisoner's jumpsuit. */
const JUMPSUIT = '#f2711c';
const SUIT = JUMPSUIT;

/**
 * A skater on their board, from above (riding right): the board under them (its deck, its wheels at the ends), them stood
 * side on across it, feet at its ends, arms out for balance.
 */
export function skaterTexture(scene: Phaser.Scene, look: number): string {
  const key = `skater-${look % LOOKS}`;
  canvasTexture(scene, key, 12, 10, (ctx) => {
    const { top, bottom, hair, skin } = clothes(look);
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const [cx, cy] = [6, 5];
    ellipse(cx + 0.8, cy + 1, 4.2, 2.4, 'rgba(0,0,0,0.25)');
    // The board: its deck, its wheels.
    ctx.fillStyle = '#e9e6dc';
    for (const x of [cx - 3.2, cx + 2.6]) {
      ctx.fillRect(x, cy - 1.1, 0.6, 0.5);
      ctx.fillRect(x, cy + 0.6, 0.6, 0.5);
    }
    ellipse(cx, cy, 4.1, 0.95, ['#2b2b2e', '#b4232a', '#2d5aa0', '#d0a020'][look % 4]);
    // Side on: their feet at the board's ends, their shoulders along it, arms out; their head turned the way they're going.
    ellipse(cx - 2.3, cy, 0.9, 0.6, bottom);
    ellipse(cx + 2.3, cy, 0.9, 0.6, bottom);
    ellipse(cx - 2.6, cy - 1.7, 0.9, 0.55, top);
    ellipse(cx + 2.6, cy + 1.7, 0.9, 0.55, top);
    ellipse(cx, cy, 2.6, 1.4, top);
    ellipse(cx, cy - 0.2, 2.1, 1.05, shadeOf(top));
    ellipse(cx, cy, 1.2, 1.15, hair);
    ellipse(cx + 0.8, cy, 0.6, 0.45, skin);
  });
  return key;
}

/**
 * A prisoner at it, in the yard, from above (facing right; two frames, in turn): fighting (a punch thrown, one fist then the
 * other, the other up guarding), on the weight bench (lying on it, the bar down to the chest, then pressed up: arms bent out, then
 * straight), on the pull-up bar (hanging, then pulled up: nearer, so bigger, their shadow further off), press-ups (down, then up).
 */
export function drillTexture(scene: Phaser.Scene, look: number, drill: Drill, frame: number, uniform: Uniform = 'inmate'): string {
  const key = `drill-${drill}-${look % LOOKS}-${frame}-${uniform}`;
  canvasTexture(scene, key, 16, 12, (ctx) => {
    const { skin } = clothes(look);
    const hair = uniform === 'soldier' ? BERET[look % BERET.length] : clothes(look).hair;
    const JUMPSUIT = uniform === 'soldier' ? CAMO : SUIT;
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const [cx, cy] = [8, 6];
    const suit = shadeOf(JUMPSUIT);
    if (drill === 'fight') {
      ellipse(cx + 0.7, cy + 1, 2.2, 3.1, 'rgba(0,0,0,0.25)');
      // Feet planted apart, one forward.
      ellipse(cx + 1.2, cy - 1.2, 1.1, 0.7, suit);
      ellipse(cx - 1.4, cy + 1.2, 1.1, 0.7, suit);
      // The punching arm straight out, its fist; the other bent up, guarding the face.
      const side = frame ? 1 : -1;
      ellipse(cx + 2.4, cy + 1.6 * side, 1.9, 0.6, JUMPSUIT);
      ellipse(cx + 4.3, cy + 1.6 * side, 0.6, 0.6, skin);
      ellipse(cx + 1.5, cy - 1.5 * side, 0.9, 0.6, JUMPSUIT);
      ellipse(cx + 2.4, cy - 1.1 * side, 0.55, 0.55, skin);
      ellipse(cx, cy, 1.5, 2.8, JUMPSUIT);
      ellipse(cx - 0.2, cy, 1.15, 2.2, suit);
      ellipse(cx + 0.4, cy, 1.2, 1.15, hair);
      ellipse(cx + 1.35, cy, 0.4, 0.75, skin);
      return;
    }
    if (drill === 'pullup') {
      // Up: bigger (nearer), and their shadow further off.
      const up = frame ? 1.12 : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(up, up);
      ellipse(1.2 * up, 1.6 * up, 2.2, 3.1, 'rgba(0,0,0,0.22)');
      // Arms up to the bar in front of them, hands on it.
      ellipse(1.6, -1.6, 1.6, 0.55, JUMPSUIT);
      ellipse(1.6, 1.6, 1.6, 0.55, JUMPSUIT);
      ellipse(3.1, -1.7, 0.5, 0.5, skin);
      ellipse(3.1, 1.7, 0.5, 0.5, skin);
      ellipse(0, 0, 1.5, 2.8, JUMPSUIT);
      ellipse(-0.2, 0, 1.15, 2.2, suit);
      ellipse(0.2, 0, 1.2, 1.15, hair);
      ctx.restore();
      return;
    }
    // Lying along it: on their back on the bench (head to the rack); face down for press-ups.
    const lift = drill === 'lift';
    const up = !lift && frame ? 0.7 : 0;
    ellipse(cx + 0.6 + up, cy + 0.8 + up, 6.6, 2.4, 'rgba(0,0,0,0.25)');
    ellipse(cx - 3.8, cy - 0.9, 2.6, 0.85, suit);
    ellipse(cx - 3.6, cy + 0.9, 2.6, 0.85, suit);
    ellipse(cx + 0.8, cy, 2.5, 2, JUMPSUIT);
    if (lift) {
      // Arms bent out to the bar at the chest, then straight up (shorter, from above).
      const out = frame ? 1.4 : 2.6;
      ellipse(cx + 1.6, cy - out / 2 - 0.9, 0.6, out / 2 + 0.3, JUMPSUIT);
      ellipse(cx + 1.6, cy + out / 2 + 0.9, 0.6, out / 2 + 0.3, JUMPSUIT);
      // The bar across, its plates.
      ctx.fillStyle = '#b9bdc2';
      ctx.fillRect(cx + 1.4, cy - 5.6, 0.5, 11.2);
      ctx.fillStyle = '#1d1d20';
      ctx.fillRect(cx + 0.9, cy - 5.8, 1.5, 1.2);
      ctx.fillRect(cx + 0.9, cy + 4.6, 1.5, 1.2);
    } else {
      // Hands flat by the shoulders.
      ellipse(cx + 1.6, cy - 2.6, 0.9, 0.55, JUMPSUIT);
      ellipse(cx + 1.6, cy + 2.6, 0.9, 0.55, JUMPSUIT);
      ellipse(cx + 2.4, cy - 2.7, 0.45, 0.45, skin);
      ellipse(cx + 2.4, cy + 2.7, 0.45, 0.45, skin);
    }
    ellipse(cx + 4.4, cy, 1.25, 1.2, hair);
    if (lift) ellipse(cx + 4.9, cy, 0.55, 0.8, skin);
  });
  return key;
}

/** A building site worker's hi-vis vest (orange, a silver band) over their top, and a white hard hat. */
function hiVis(ctx: Ctx, pose: Pose): void {
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // (Where the shoulders and head are: lying down, or on their feet.)
  const [cx, cy, hx] = pose === 'down' ? [9, 4, 12.8] : [5, 5, 5.2];
  ellipse(cx, cy, 1.4, 2.6, '#f28a1a');
  ctx.fillStyle = '#d8dde0';
  ctx.fillRect(cx - 0.3, cy - 2.4, 0.6, 4.8);
  ellipse(hx, cy, 1.35, 1.3, '#f4f4f0');
  ellipse(hx + 0.3, cy, 0.5, 1, '#dcdcd6');
}

/** A lollipop lady: her long white coat (a yellow band), her peaked cap, and her sign held out on its pole, its round face. */
function lollipopLady(ctx: Ctx, pose: Pose): void {
  if (pose === 'down') return;
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  ellipse(5, 5, 1.6, 2.8, '#f2f1e8');
  ctx.fillStyle = '#e8d23a';
  ctx.fillRect(4.4, 2.4, 0.6, 5.2);
  ellipse(5.3, 5, 1.2, 1.2, '#f2f1e8');
  ellipse(6.4, 5, 0.6, 1.1, '#1d1d1f');
  // The pole, out in front; the sign at its top, white with its red ring (STOP: children).
  ctx.fillStyle = '#d8dadc';
  ctx.fillRect(6, 6.6, 3, 0.4);
  ellipse(8.8, 6.8, 1.1, 1.1, '#d8312a');
  ellipse(8.8, 6.8, 0.75, 0.75, '#f4f4f0');
}

/**
 * Draws the people near the view: each on their feet (stepping as they walk,
 * faster as they run) or lying where they fell, standing up off the ground a
 * little in the perspective, under the buildings and trees (and the cars).
 */
export class PeopleLayer {
  private readonly sprites = new Map<Person, Phaser.GameObjects.Image>();
  private readonly blankets = new Map<Picnic, Phaser.GameObjects.Image>();
  private readonly pitches = new Map<Gather, Phaser.GameObjects.Image>();
  private readonly birds = new Map<Bird, Phaser.GameObjects.Image>();
  private readonly dogs = new Map<Dog, { dog: Phaser.GameObjects.Image; lead: Phaser.GameObjects.Image }>();
  private readonly balls = new Map<Kickabout, { ball: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }>();

  constructor(
    private readonly scene: Phaser.Scene,
    private people: People,
    /** The height of what's underfoot at a point on a level (the ground, a bridge's deck), px. */
    private readonly base: (x: number, y: number, level: number) => number,
    /** Drawn on the ground (under the bridges), and up on the decks (a function: at (x, y), under a higher deck there, or not). */
    private readonly depths: { ground: number; deck: number | ((x: number, y: number) => number) },
  ) {}

  /** How deep someone on a deck at (x, y) is drawn. */
  private deckDepth(x: number, y: number): number {
    const d = this.depths.deck;
    return typeof d === 'number' ? d : d(x, y);
  }

  /** The next region's people (see streamer.ts): those carried over keep their pictures. */
  use(people: People): void {
    this.people = people;
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const pad = 20;
    const seen = new Set<Person>();
    for (const p of this.people.people) {
      if (p.x < view.left - pad || p.x > view.right + pad || p.y < view.top - pad || p.y > view.bottom + pad) continue;
      seen.add(p);
      const pose: Pose = p.mode === 'down' ? 'down' : p.mode === 'sit' ? 'sit' : p.speed < 2 ? 'stand' : p.step < 0.5 ? 'step0' : 'step1';
      const act = p.mode === 'perform' && p.act && p.act !== 'vendor' ? p.act : null;
      // (A prisoner at it: fighting, at the weights, the pull-up bar, press-ups.)
      // (A soldier at PT.)
      const uniform = p.inmate ? 'inmate' : p.soldier ? 'soldier' : undefined;
      const drill = p.mode === 'fight' ? 'fight' : p.mode === 'exercise' ? p.drill : undefined;
      const skating = p.mode === 'skate' && !!p.ride;
      const key = act
        ? performerTexture(this.scene, p.look, act, Math.floor(p.step * ACT_FRAMES[act]) % ACT_FRAMES[act])
        : skating
          ? skaterTexture(this.scene, p.look)
          : drill
            ? drillTexture(this.scene, p.look, drill, Math.floor(p.step * 2) % 2, uniform)
            : personTexture(this.scene, p.look, pose, p.hivis, p.lollipop, uniform);
      let s = this.sprites.get(p);
      if (!s) {
        // (A child, smaller.)
        s = this.scene.add.image(0, 0, key).setScale((SIZE * (p.child ?? 1)) / ART_SCALE);
        this.sprites.set(p, s);
      } else if (s.texture.key !== key) s.setTexture(key);
      // Head height (lying down, the ground), and how high they've been thrown: up over the car, and a little bigger.
      // (A skater doing a trick: up in the air, spinning round once.)
      const air = skating && p.ride!.air > 0 ? 1 - p.ride!.air / AIR : 0;
      const hop = air ? Math.sin(air * Math.PI) * 1.4 : 0;
      const lift = perspective.lift(this.base(p.x, p.y, p.level) + ((p.mode === 'down' ? 0.2 : p.mode === 'sit' ? 0.8 : 1.2) + hop) * 8);
      if (skating) s.setScale((SIZE * (1 + hop * 0.15)) / ART_SCALE);
      s.setPosition(perspective.x(p.x, lift), perspective.y(p.y, lift))
        .setRotation(p.angle + air * Math.PI * 2)
        .setDepth(p.level === 1 ? this.deckDepth(p.x, p.y) : this.depths.ground);
    }
    for (const [p, s] of this.sprites) {
      if (seen.has(p)) continue;
      s.destroy();
      this.sprites.delete(p);
    }
    // The dogs, on their leads (from the hand of whoever has them).
    const walked = new Set<Dog>();
    for (const p of seen) {
      const d = p.dog;
      if (!d) continue;
      walked.add(d);
      const key = dogTexture(this.scene, d.look, d.speed > 2 && d.step < 0.5 ? 1 : 0);
      let im = this.dogs.get(d);
      if (!im) {
        canvasTexture(this.scene, 'lead', 2, 2, (ctx) => {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, 2, 2);
        });
        im = { dog: this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE), lead: this.scene.add.image(0, 0, 'lead').setOrigin(0, 0.5).setTint(0x2a2a2a) };
        this.dogs.set(d, im);
      } else if (im.dog.texture.key !== key) im.dog.setTexture(key);
      const depth = p.level === 1 ? this.deckDepth(p.x, p.y) : this.depths.ground;
      const low = perspective.lift(this.base(d.x, d.y, p.level) + 0.4 * 8);
      const [dx, dy] = [perspective.x(d.x, low), perspective.y(d.y, low)];
      im.dog.setPosition(dx, dy).setRotation(d.angle).setDepth(depth - 0.001);
      const hand = perspective.lift(this.base(p.x, p.y, p.level) + 0.9 * 8);
      const [hx, hy] = [perspective.x(p.x, hand), perspective.y(p.y, hand)];
      // (To its collar, just behind its head.)
      const [cx, cy] = [dx + Math.cos(d.angle) * 2.2, dy + Math.sin(d.angle) * 2.2];
      im.lead.setPosition(hx, hy).setRotation(Math.atan2(cy - hy, cx - hx)).setDisplaySize(Math.max(0.1, Math.hypot(cx - hx, cy - hy)), 0.35).setDepth(depth - 0.0005);
    }
    for (const [d, im] of this.dogs) {
      if (walked.has(d)) continue;
      im.dog.destroy();
      im.lead.destroy();
      this.dogs.delete(d);
    }
    // The games' balls and frisbees: in the air (their shadows on the grass under them), or on the ground.
    const played = new Set<Kickabout>();
    for (const g of this.people.games) {
      const b = g.ball;
      if (b.x < view.left - pad || b.x > view.right + pad || b.y < view.top - pad || b.y > view.bottom + pad) continue;
      if (!b.holder && !b.target && b.dur === 0 && !this.people.people.some((p) => p.game === g)) continue;
      played.add(g);
      let im = this.balls.get(g);
      if (!im) {
        const key = ballTexture(this.scene, g.kind);
        im = { ball: this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE), shadow: this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE).setTint(0x000000).setAlpha(0.25) };
        this.balls.set(g, im);
      }
      const ground = perspective.lift(this.base(b.x, b.y, 0) + 0.15 * 8);
      const up = perspective.lift(this.base(b.x, b.y, 0) + 0.15 * 8 + b.z);
      im.shadow.setPosition(perspective.x(b.x, ground) + b.z * 0.2, perspective.y(b.y, ground) + b.z * 0.25).setDepth(this.depths.ground - 0.002);
      im.ball.setPosition(perspective.x(b.x, up), perspective.y(b.y, up)).setDepth(this.depths.ground + (b.z > 4 ? 0.001 : -0.001));
    }
    for (const [g, im] of this.balls) {
      if (played.has(g)) continue;
      im.ball.destroy();
      im.shadow.destroy();
      this.balls.delete(g);
    }
    // The picnics' blankets, on the grass under them.
    const spread = new Set<Picnic>();
    for (const c of this.people.picnics) {
      if (c.gone || c.x < view.left - pad || c.x > view.right + pad || c.y < view.top - pad || c.y > view.bottom + pad) continue;
      spread.add(c);
      let b = this.blankets.get(c);
      if (!b) {
        b = this.scene.add.image(0, 0, blanket(this.scene, c.pattern)).setScale(1 / ART_SCALE).setDepth(this.depths.ground - 0.01);
        this.blankets.set(c, b);
      }
      const lift = perspective.lift(this.base(c.x, c.y, 0));
      b.setPosition(perspective.x(c.x, lift), perspective.y(c.y, lift)).setRotation(c.angle);
    }
    for (const [c, b] of this.blankets) {
      if (spread.has(c)) continue;
      b.destroy();
      this.blankets.delete(c);
    }
    // The performers' takings, on the ground in front of them.
    const out = new Set<Gather>();
    for (const g of this.people.pitches) {
      if (!g.host || g.host.mode !== 'perform' || !g.act || g.act === 'charity' || g.act === 'bigissue' || g.x < view.left - pad || g.x > view.right + pad || g.y < view.top - pad || g.y > view.bottom + pad) continue;
      out.add(g);
      let t = this.pitches.get(g);
      if (!t) {
        t = this.scene.add.image(0, 0, takings(this.scene, g.act)).setScale(SIZE / ART_SCALE).setDepth(this.depths.ground - 0.01);
        this.pitches.set(g, t);
      }
      const [x, y] = [g.x + Math.cos(g.angle) * 1.1 * 8, g.y + Math.sin(g.angle) * 1.1 * 8];
      const lift = perspective.lift(this.base(x, y, 0));
      t.setPosition(perspective.x(x, lift), perspective.y(y, lift)).setRotation(g.angle + Math.PI / 2);
    }
    for (const [g, t] of this.pitches) {
      if (out.has(g)) continue;
      t.destroy();
      this.pitches.delete(g);
    }
    // The pigeons, pecking about, or flying off (up over everything, flapping).
    const flying = new Set<Bird>();
    const now = this.scene.time.now;
    for (const f of this.people.flocks) {
      if (!f.birds.length || f.x < view.left - 60 || f.x > view.right + 60 || f.y < view.top - 60 || f.y > view.bottom + 60) continue;
      for (const b of f.birds) {
        flying.add(b);
        const pose = b.flying ? (Math.floor(now / 90 + b.angle * 3) % 2 ? 'fly0' : 'fly1') : b.peck && Math.floor(now / 250 + b.angle * 5) % 2 ? 'peck' : 'stand';
        const key = pigeonTexture(this.scene, pose, f.gull);
        let im = this.birds.get(b);
        if (!im) {
          im = this.scene.add.image(0, 0, key).setScale(((f.gull ? 1.3 : 1) * SIZE) / ART_SCALE);
          this.birds.set(b, im);
        } else if (im.texture.key !== key) im.setTexture(key);
        const lift = perspective.lift(this.base(b.x, b.y, 0) + 0.2 * 8 + b.z);
        im.setPosition(perspective.x(b.x, lift), perspective.y(b.y, lift))
          .setRotation(b.angle)
          .setDepth(b.flying ? this.deckDepth(b.x, b.y) + 1 : this.depths.ground);
      }
    }
    for (const [b, im] of this.birds) {
      if (flying.has(b)) continue;
      im.destroy();
      this.birds.delete(b);
    }
  }
}
