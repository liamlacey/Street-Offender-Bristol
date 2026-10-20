import * as Phaser from 'phaser';
import type { Ledges, LedgeSegment } from './ledges';
import type { Perspective } from './perspective';

/** The face of a drop (stone, earth), its top's coping, and the shadow at its foot. */
const FACE = 0x766b5c;
const TOP = 0xcdc2ab;

/**
 * The drops, drawn every frame near the view: the top's edge (a pale coping),
 * the face below it (from the edge, lifted through the perspective, to its
 * foot, a little out from it, as the old games showed walls from the side), and
 * a shadow beyond.
 */
export class LedgeLayer {
  private readonly g: Phaser.GameObjects.Graphics;
  /** The height of each one's foot, px, once worked out. */
  private readonly foot = new Map<LedgeSegment, number>();

  constructor(
    scene: Phaser.Scene,
    private readonly ledges: Ledges,
    /** The height of the ground under a point, px. */
    private readonly ground: (x: number, y: number) => number,
    depth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  update(view: Phaser.Geom.Rectangle, p: Perspective): void {
    const g = this.g.clear();
    const pad = 40;
    for (const s of this.ledges.near(view.centerX, view.centerY, Math.hypot(view.width, view.height) / 2 + pad)) {
      if (Math.max(s.ax, s.bx) < view.left - pad || Math.min(s.ax, s.bx) > view.right + pad || Math.max(s.ay, s.by) < view.top - pad || Math.min(s.ay, s.by) > view.bottom + pad) continue;
      let z0 = this.foot.get(s);
      if (z0 === undefined) {
        z0 = this.ground((s.ax + s.bx) / 2 + s.nx * 12, (s.ay + s.by) / 2 + s.ny * 12);
        this.foot.set(s, z0);
      }
      const [s0, s1] = [p.lift(z0), p.lift(z0 + s.drop)];
      const [a0x, a0y, b0x, b0y] = [p.x(s.ax, s0), p.y(s.ay, s0), p.x(s.bx, s0), p.y(s.by, s0)];
      const [a1x, a1y, b1x, b1y] = [p.x(s.ax, s1), p.y(s.ay, s1), p.x(s.bx, s1), p.y(s.by, s1)];
      // Its face, seen a little from the side as the old games drew walls: a band below the edge, as deep as about
      // a third of its drop, up to a metre or so (and more, through the perspective, where it faces the camera); a shadow beyond it.
      const face = Math.max(3, Math.min(10, s.drop * 0.3)) * s0;
      const shade = Math.max(3, Math.min(12, s.drop * 0.25)) * s0;
      const [c0x, c0y, d0x, d0y] = [a0x + s.nx * face, a0y + s.ny * face, b0x + s.nx * face, b0y + s.ny * face];
      g.fillStyle(0x000000, 0.2);
      quad(g, c0x, c0y, d0x, d0y, d0x + s.nx * shade, d0y + s.ny * shade, c0x + s.nx * shade, c0y + s.ny * shade);
      g.fillStyle(FACE, 1);
      quad(g, a1x, a1y, b1x, b1y, d0x, d0y, c0x, c0y);
      g.lineStyle(2.2 * s1, TOP, 1);
      g.lineBetween(a1x, a1y, b1x, b1y);
    }
  }
}

function quad(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
  g.fillTriangle(ax, ay, bx, by, cx, cy);
  g.fillTriangle(ax, ay, cx, cy, dx, dy);
}
