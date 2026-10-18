import * as Phaser from 'phaser';
import type { SegmentGrid } from '../physics/collisions';
import type { WallKind } from './damage';
import type { Perspective } from './perspective';
import type { Wall } from './world';

/** How tall each kind of wall stands, px, and its colours: its side, and its top. */
const LOOK: Record<WallKind, { height: number; side: number; top: number; width: number; open?: boolean }> = {
  wall: { height: 1.6 * 8, side: 0x857a6b, top: 0xb3a690, width: 4 },
  hedge: { height: 1.8 * 8, side: 0x2c5323, top: 0x417c31, width: 9 },
  fence: { height: 1.5 * 8, side: 0x5b4630, top: 0x86694a, width: 2 },
  railing: { height: 1.1 * 8, side: 0x2a2d31, top: 0x5a6068, width: 1.6 },
  gate: { height: 1.3 * 8, side: 0x33383e, top: 0x5a6068, width: 1.8 },
  // A car park's barrier: just its arm, red and white, across the way at waist height; and a chain, slung low.
  liftgate: { height: 1 * 8, side: 0xeeeeee, top: 0xd8312a, width: 1.6, open: true },
  chain: { height: 0.5 * 8, side: 0x444444, top: 0x6a6a6a, width: 0.8, open: true },
};

/**
 * The garden walls, hedges, fences and railings, standing up off the
 * ground (their side facing the middle of the view, and their top), drawn
 * every frame from what's left of them, so what's been knocked down is gone.
 */
export class WallLayer {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly grids: [SegmentGrid, SegmentGrid],
    /** The height of the ground (or the deck, on level 1) under a point, px. */
    private readonly base: (x: number, y: number, level: number) => number,
    depth: number,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const g = this.g.clear();
    const reach = Math.hypot(view.width, view.height) / 2 + 60;
    for (const grid of this.grids) {
      for (const seg of grid.near(view.centerX, view.centerY, reach) as Wall[]) {
        if (!seg.kind) continue;
        const look = LOOK[seg.kind];
        const z = (seg as Wall & { z?: number }).z ?? ((seg as Wall & { z?: number }).z = this.base((seg.ax + seg.bx) / 2, (seg.ay + seg.by) / 2, seg.level));
        const s0 = perspective.lift(z);
        const s1 = perspective.lift(z + look.height);
        const [a0x, a0y, b0x, b0y] = [perspective.x(seg.ax, s0), perspective.y(seg.ay, s0), perspective.x(seg.bx, s0), perspective.y(seg.by, s0)];
        const [a1x, a1y, b1x, b1y] = [perspective.x(seg.ax, s1), perspective.y(seg.ay, s1), perspective.x(seg.bx, s1), perspective.y(seg.by, s1)];
        // Its side, from its foot up to its top (just its posts at the ends, for an arm or a chain across the way).
        if (look.open) {
          g.lineStyle(1.6 * s1, look.side, 1);
          g.lineBetween(a0x, a0y, a1x, a1y);
          g.lineBetween(b0x, b0y, b1x, b1y);
        } else {
          g.fillStyle(look.side, 1);
          g.fillTriangle(a0x, a0y, b0x, b0y, b1x, b1y);
          g.fillTriangle(a0x, a0y, b1x, b1y, a1x, a1y);
        }
        // Its top.
        g.lineStyle(look.width * s1, look.top, 1);
        g.lineBetween(a1x, a1y, b1x, b1y);
        // Rounded at the ends, so the pieces of a thick one join up round its corners.
        if (look.width >= 4) {
          g.fillStyle(look.top, 1);
          g.fillCircle(a1x, a1y, (look.width * s1) / 2);
          g.fillCircle(b1x, b1y, (look.width * s1) / 2);
        }
      }
    }
  }
}
