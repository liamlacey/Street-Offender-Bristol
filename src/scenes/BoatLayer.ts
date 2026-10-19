import type * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import type { Boat, Boats } from '../world/boats';
import { ART_SCALE } from './art';
import { boatShadow, boatTexture } from './boatArt';
import { forgetWreck, paintWreck } from './dentArt';

/** How often a moving boat's wake is marked, s, and how long it lasts. */
const WAKE_EVERY = 0.2;
const WAKE_FOR = 5;

/**
 * Draws the boats near the view, on the water (under the bridges): each one's
 * picture and shadow, rocking a little on the water, and the wake spreading
 * out behind the ones under way.
 */
export class BoatLayer {
  /** Each one in view: its picture and shadow, and which version of its damage the picture shows. */
  private readonly sprites = new Map<Boat, { body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; shown: number }>();
  /** Each moving boat's wake: where its stern was (x, y, which way it was going, how fast, when), newest last. */
  private readonly wakes = new Map<Boat, number[][]>();
  private readonly wakeGraphics: Phaser.GameObjects.Graphics;
  private lastMark = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly boats: Boats,
    /** The height of the ground (the water) under a point, px. */
    private readonly base: (x: number, y: number) => number,
    private readonly depth: number,
  ) {
    this.wakeGraphics = scene.add.graphics().setDepth(depth - 0.05);
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective, time: number): void {
    const pad = 200;
    const seen = new Set<Boat>();
    const mark = time - this.lastMark >= WAKE_EVERY;
    if (mark) this.lastMark = time;
    const g = this.wakeGraphics.clear();
    for (const b of this.boats.boats) {
      // A wake's kept up while it's moving, near or far (it's there when it comes into view).
      if (mark) this.markWake(b, time);
      if (b.x < view.left - pad || b.x > view.right + pad || b.y < view.top - pad || b.y > view.bottom + pad) continue;
      seen.add(b);
      let s = this.sprites.get(b);
      if (!s) {
        const shadow = this.scene.add.image(0, 0, boatShadow(this.scene, b.kind)).setScale(1 / ART_SCALE).setTint(0x000000).setAlpha(0.28).setDepth(this.depth - 0.02);
        const body = this.scene.add.image(0, 0, boatTexture(this.scene, b.kind, b.colour)).setScale(1 / ART_SCALE).setDepth(this.depth);
        s = { body, shadow, shown: 0 };
        this.sprites.set(b, s);
      }
      // Damaged: its own picture, with its dents and scratches.
      if (b.wreck && b.wreck.version !== s.shown) {
        s.shown = b.wreck.version;
        const key = `boat-dented-${b.id}`;
        paintWreck(this.scene, key, { base: boatTexture(this.scene, b.kind, b.colour), length: b.length, width: b.beam, mirror: 1e6 }, b.wreck);
        s.body.setTexture(key);
      }
      const lift = perspective.lift(this.base(b.x, b.y));
      // Rocking a little on the water (each in its own time), more when it's moving.
      const phase = time * (0.9 + (b.id % 7) * 0.07) + b.id;
      const rock = Math.sin(phase) * (b.speed > 4 ? 0.012 : 0.02) * (b.kind === 'dinghy' ? 2 : 1);
      const heave = Math.sin(phase * 1.3) * 0.4;
      const [x, y] = [perspective.x(b.x + Math.cos(b.angle + Math.PI / 2) * heave, lift), perspective.y(b.y + Math.sin(b.angle + Math.PI / 2) * heave, lift)];
      s.body.setPosition(x, y).setRotation(b.angle + rock);
      s.shadow.setPosition(x + 1.5, y + 2).setRotation(b.angle + rock);
      const wake = this.wakes.get(b);
      if (wake) this.drawWake(g, b, wake, perspective, lift, time);
    }
    for (const [b, s] of this.sprites) {
      if (seen.has(b)) continue;
      s.body.destroy();
      s.shadow.destroy();
      forgetWreck(this.scene, `boat-dented-${b.id}`);
      this.sprites.delete(b);
    }
  }

  private markWake(b: Boat, time: number): void {
    let wake = this.wakes.get(b);
    while (wake?.length && time - wake[0][4] > WAKE_FOR) wake.shift();
    if (b.speed < 3) {
      if (wake && !wake.length) this.wakes.delete(b);
      return;
    }
    if (!wake) this.wakes.set(b, (wake = []));
    const back = b.length * 0.48;
    wake.push([b.x - Math.cos(b.angle) * back, b.y - Math.sin(b.angle) * back, b.angle, b.speed, time]);
  }

  /** Its wake: two lines of foam spreading out behind it, fading, and the churned water straight behind. */
  private drawWake(g: Phaser.GameObjects.Graphics, b: Boat, wake: number[][], perspective: Perspective, lift: number, time: number): void {
    const px = (x: number) => perspective.x(x, lift);
    const py = (y: number) => perspective.y(y, lift);
    const back = b.length * 0.48;
    const stern: number[] = [b.x - Math.cos(b.angle) * back, b.y - Math.sin(b.angle) * back, b.angle, b.speed, time];
    const pts = [...wake, stern];
    for (const side of [1, -1]) {
      for (let k = pts.length - 1; k > 0; k--) {
        const [p, q] = [pts[k], pts[k - 1]];
        const [ap, aq] = [time - p[4], time - q[4]];
        const fade = 1 - aq / WAKE_FOR;
        if (fade <= 0) break;
        // Spreading out sideways as it ages.
        const spread = (a: number, s: number) => b.beam / 2 + a * (2 + s * 0.05);
        const end = (pt: number[], a: number) => [pt[0] - Math.sin(pt[2]) * spread(a, pt[3]) * side, pt[1] + Math.cos(pt[2]) * spread(a, pt[3]) * side];
        const [e0, e1] = [end(p, ap), end(q, aq)];
        g.lineStyle(1.8 * fade + 0.5, 0xeaf4f8, 0.7 * fade * Math.min(1, p[3] / 20));
        g.lineBetween(px(e0[0]), py(e0[1]), px(e1[0]), py(e1[1]));
      }
    }
    // The churned water behind it.
    for (let k = pts.length - 1; k > 0; k--) {
      const [p, q] = [pts[k], pts[k - 1]];
      const fade = 1 - (time - q[4]) / (WAKE_FOR * 0.6);
      if (fade <= 0) break;
      g.lineStyle(b.beam * 0.6 * (1 + (time - q[4]) * 0.4), 0xd8eaf0, 0.18 * fade);
      g.lineBetween(px(p[0]), py(p[1]), px(q[0]), py(q[1]));
    }
  }
}
