import type * as Phaser from 'phaser';
import { type Bird, type Gather, LOOKS, type People, type Person, type Picnic } from '../world/people';
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
function person(ctx: Ctx, look: number, pose: Pose): void {
  const { top, bottom, hair, skin } = clothes(look);
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
}

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
function pigeonTexture(scene: Phaser.Scene, pose: 'stand' | 'peck' | 'fly0' | 'fly1'): string {
  const key = `pigeon-${pose}`;
  canvasTexture(scene, key, 6, 6, (ctx) => {
    const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    if (pose === 'fly0' || pose === 'fly1') {
      const spread = pose === 'fly0' ? 2.6 : 1.6;
      ellipse(2.8, 3 - spread * 0.7, 0.9, spread * 0.55, '#7d8590');
      ellipse(2.8, 3 + spread * 0.7, 0.9, spread * 0.55, '#7d8590');
    } else ellipse(3.2, 3.3, 1.3, 0.75, 'rgba(0,0,0,0.2)');
    // Tail, body, the sheen on its neck, its head and beak.
    ellipse(1.3, 3, 0.8, 0.5, '#5d6570');
    ellipse(2.8, 3, 1.3, 0.85, '#8a929c');
    const hx = pose === 'peck' ? 4.6 : 4.1;
    ellipse(hx - 0.5, 3, 0.5, 0.55, '#6a7d74');
    ellipse(hx, 3, 0.45, 0.45, '#5a6068');
    ellipse(hx + 0.5, 3, 0.25, 0.15, '#d9a080');
  });
  return key;
}

export function personTexture(scene: Phaser.Scene, look: number, pose: Pose): string {
  const key = `person-${look % LOOKS}-${pose}`;
  if (pose === 'down') canvasTexture(scene, key, 16, 8, (ctx) => person(ctx, look, pose));
  else canvasTexture(scene, key, 10, 10, (ctx) => person(ctx, look, pose));
  return key;
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
      const key = act ? performerTexture(this.scene, p.look, act, Math.floor(p.step * ACT_FRAMES[act]) % ACT_FRAMES[act]) : personTexture(this.scene, p.look, pose);
      let s = this.sprites.get(p);
      if (!s) {
        s = this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE);
        this.sprites.set(p, s);
      } else if (s.texture.key !== key) s.setTexture(key);
      // Head height (lying down, the ground), and how high they've been thrown: up over the car, and a little bigger.
      const lift = perspective.lift(this.base(p.x, p.y, p.level) + (p.mode === 'down' ? 0.2 : p.mode === 'sit' ? 0.8 : 1.2) * 8);
      s.setPosition(perspective.x(p.x, lift), perspective.y(p.y, lift))
        .setRotation(p.angle)
        .setDepth(p.level === 1 ? this.deckDepth(p.x, p.y) : this.depths.ground);
    }
    for (const [p, s] of this.sprites) {
      if (seen.has(p)) continue;
      s.destroy();
      this.sprites.delete(p);
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
        const key = pigeonTexture(this.scene, pose);
        let im = this.birds.get(b);
        if (!im) {
          im = this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE);
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
