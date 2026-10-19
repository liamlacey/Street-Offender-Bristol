import type * as Phaser from 'phaser';
import { LOOKS, type People, type Person, type Picnic } from '../world/people';
import type { Perspective } from '../world/perspective';
import { ART_SCALE, canvasTexture } from './art';

type Ctx = CanvasRenderingContext2D;

/** Drawn a little bigger than life, so they can be made out on a phone. */
const SIZE = 1.5;

/** Their clothes (a top, and trousers or a skirt), their hair; and skin. */
const TOPS = ['#2f4a7a', '#8a2b2b', '#2e5d3c', '#d8d2c2', '#1f1f22', '#c4762f', '#6b4c8a', '#3d7f8c', '#b8a43a', '#9c9c9c', '#d06a8a', '#4a5a2e'];
const BOTTOMS = ['#22293a', '#3a3a3a', '#5a4a36', '#2a3f5f'];
const HAIR = ['#1c1410', '#4a2e1a', '#8a6a3a', '#c9b07a', '#6e6e6e', '#a8452a'];
const SKIN = ['#e6c2a2', '#c99a74', '#8d5e3c', '#5c3b25'];

/** A person from above, facing right: `pose` is standing, a step (one foot forward, then the other), or lying down. */
function person(ctx: Ctx, look: number, pose: Pose): void {
  const top = TOPS[look % TOPS.length];
  const bottom = BOTTOMS[Math.floor(look / 3) % BOTTOMS.length];
  const hair = HAIR[Math.floor(look / 5) % HAIR.length];
  const skin = SKIN[Math.floor(look / 7) % SKIN.length];
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

type Pose = 'stand' | 'step0' | 'step1' | 'down' | 'sit';

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

function texture(scene: Phaser.Scene, look: number, pose: Pose): string {
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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly people: People,
    /** The height of what's underfoot at a point on a level (the ground, a bridge's deck), px. */
    private readonly base: (x: number, y: number, level: number) => number,
    /** Drawn on the ground (under the bridges), up on the decks, and thrown up over a car (over the cars). */
    private readonly depths: { ground: number; deck: number; air: number },
  ) {}

  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const pad = 20;
    const seen = new Set<Person>();
    for (const p of this.people.people) {
      if (p.x < view.left - pad || p.x > view.right + pad || p.y < view.top - pad || p.y > view.bottom + pad) continue;
      seen.add(p);
      const pose: Pose = p.mode === 'down' ? 'down' : p.mode === 'sit' ? 'sit' : p.speed < 2 ? 'stand' : p.step < 0.5 ? 'step0' : 'step1';
      const key = texture(this.scene, p.look, pose);
      let s = this.sprites.get(p);
      if (!s) {
        s = this.scene.add.image(0, 0, key).setScale(SIZE / ART_SCALE);
        this.sprites.set(p, s);
      } else if (s.texture.key !== key) s.setTexture(key);
      // Head height (lying down, the ground), and how high they've been thrown: up over the car, and a little bigger.
      const lift = perspective.lift(this.base(p.x, p.y, p.level) + (p.mode === 'down' ? 0.2 : p.mode === 'sit' ? 0.8 : 1.2) * 8 + p.z);
      // Knocked down: head over heels in the air (seen from above, shortening and flipping end over end),
      // or rolling over on the ground (lying across the way they're rolling, flipping side over side).
      const size = (SIZE / ART_SCALE) * (1 + p.z / 160);
      const flip = (a: number) => (Math.cos(a) < 0 ? -1 : 1) * Math.max(0.3, Math.abs(Math.cos(a)));
      const [fx, fy] = pose !== 'down' ? [1, 1] : p.z > 0 ? [flip(p.tumble), 1] : [1, flip(p.roll)];
      s.setPosition(perspective.x(p.x, lift), perspective.y(p.y, lift))
        .setRotation(p.angle)
        .setScale(size * fx, size * fy)
        .setDepth(p.level === 1 ? this.depths.deck + (p.z > 0 ? 0.02 : 0) : p.z > 0 ? this.depths.air : this.depths.ground);
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
  }
}
