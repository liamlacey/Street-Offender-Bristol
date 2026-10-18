import * as Phaser from 'phaser';
import { type BuildingLook, FLOOR, buildingLook } from './buildingLook';
import type { World } from './world';

/** How far beyond the view a building is still drawn (its walls lean in from out there), px. */
const PAD = 60;

/**
 * Draws the buildings the old top-down way: each roof is lifted towards
 * the camera, so it's pushed out from the middle of the view by how tall
 * the building is, and the walls facing the middle are drawn between the
 * ground and the roof. As the view moves, the buildings seem to stand up
 * off the map. Redrawn every frame, only those near the view.
 */
export class Buildings {
  private readonly looks: BuildingLook[];
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, world: World, depth: number) {
    const earcut = (data: number[], holes?: number[]) => Phaser.Geom.Polygon.Earcut(data, holes);
    // Already in height order, lowest first, so taller ones are drawn over them.
    this.looks = world.map.buildings.filter((b) => b.drawn).map((b) => buildingLook(b, earcut));
    this.g = scene.add.graphics().setDepth(depth);
  }

  /**
   * Call once a frame. `height` is how high the camera is, px: the lower it
   * is, the more the buildings lean.
   */
  update(view: Phaser.Geom.Rectangle, height: number): void {
    const g = this.g;
    g.clear();
    const cx = view.centerX;
    const cy = view.centerY;
    const left = view.left - PAD;
    const right = view.right + PAD;
    const top = view.top - PAD;
    const bottom = view.bottom + PAD;
    // How much a point at height h is scaled out from the middle of the view.
    const lift = (h: number) => 1 + Math.min(h, height * 0.8) / (height - Math.min(h, height * 0.8));

    for (const look of this.looks) {
      const { b } = look;
      const sTop = lift(b.top);
      // The roof's box and the footprint's, together.
      const rx0 = cx + (look.x0 - cx) * sTop;
      const rx1 = cx + (look.x1 - cx) * sTop;
      const ry0 = cy + (look.y0 - cy) * sTop;
      const ry1 = cy + (look.y1 - cy) * sTop;
      if (Math.max(look.x1, rx1) < left || Math.min(look.x0, rx0) > right) continue;
      if (Math.max(look.y1, ry1) < top || Math.min(look.y0, ry0) > bottom) continue;
      const sBase = lift(b.bottom);

      if (!look.canopy) {
        for (const w of look.walls) {
          // Only the walls facing the middle of the view show.
          if (w.nx * (cx - (w.ax + w.bx) / 2) + w.ny * (cy - (w.ay + w.by) / 2) <= 0) continue;
          const ax = w.ax - cx;
          const ay = w.ay - cy;
          const bx = w.bx - cx;
          const by = w.by - cy;
          const quad = (s0: number, s1: number) => {
            const a0x = cx + ax * s0;
            const a0y = cy + ay * s0;
            const b0x = cx + bx * s0;
            const b0y = cy + by * s0;
            const a1x = cx + ax * s1;
            const a1y = cy + ay * s1;
            const b1x = cx + bx * s1;
            const b1y = cy + by * s1;
            g.fillTriangle(a0x, a0y, b0x, b0y, b1x, b1y);
            g.fillTriangle(a0x, a0y, b1x, b1y, a1x, a1y);
          };
          g.fillStyle(w.colour);
          quad(sBase, sTop);
          // A band of windows along each floor.
          if (look.windows !== null && Math.hypot(w.bx - w.ax, w.by - w.ay) > 12) {
            g.fillStyle(look.windows, 0.85);
            for (let h = b.bottom + FLOOR * 0.35; h + FLOOR * 0.4 < b.top - 4; h += FLOOR) quad(lift(h), lift(h + FLOOR * 0.4));
          }
        }
      }

      // The roof.
      const tx = cx * (1 - sTop);
      const ty = cy * (1 - sTop);
      for (const f of look.facets) {
        g.fillStyle(f.colour, look.canopy ? 0.9 : 1);
        const t = f.tris;
        for (let i = 0; i + 5 < t.length; i += 6) {
          g.fillTriangle(tx + t[i] * sTop, ty + t[i + 1] * sTop, tx + t[i + 2] * sTop, ty + t[i + 3] * sTop, tx + t[i + 4] * sTop, ty + t[i + 5] * sTop);
        }
      }
      if (look.rim) {
        // A parapet round a flat roof.
        g.lineStyle(2 * sTop, look.rimColour, 1);
        const r = look.rim;
        const n = r.length;
        for (let i = 0; i < n; i += 2) {
          const j = (i + 2) % n;
          g.lineBetween(tx + r[i] * sTop, ty + r[i + 1] * sTop, tx + r[j] * sTop, ty + r[j + 1] * sTop);
        }
      }
      if (look.ridge) {
        const [ax, ay, bx, by] = look.ridge;
        g.lineStyle(2 * sTop, look.ridgeColour, 1);
        g.lineBetween(tx + ax * sTop, ty + ay * sTop, tx + bx * sTop, ty + by * sTop);
      }
      for (const [x, y, w, h] of look.boxes) {
        const px = tx + x * sTop;
        const py = ty + y * sTop;
        g.fillStyle(0x000000, 0.22).fillRect(px + 2, py + 3, w * sTop, h * sTop);
        g.fillStyle(0xa4a7ab).fillRect(px, py, w * sTop, h * sTop);
        g.fillStyle(0xc4c7ca).fillRect(px + 1.5, py + 1.5, w * sTop - 3, h * sTop * 0.45);
      }
    }
  }
}
