import * as Phaser from 'phaser';
import { type BuildingLook, FLOOR, buildingLook } from './buildingLook';
import { pointInRing } from '../map/osm';
import type { Perspective } from './perspective';
import type { Terrain } from './terrain';
import type { World } from './world';

/** How far beyond the view a building is still drawn (its walls lean in from out there), px. */
const PAD = 60;

/**
 * Draws the buildings the old top-down way: each roof is lifted towards
 * the camera, so it's pushed out from the middle of the view by how tall
 * the building is, and the walls facing the middle are drawn between the
 * ground and the roof. As the view moves, the buildings seem to stand up
 * off the map. Each stands on the ground where it is, so a building up a
 * hill is nearer the camera than one down by the harbour. Redrawn every
 * frame, only those near the view.
 */
export class Buildings {
  /** Each building's look, and the height of the ground it stands on, px. */
  private readonly looks: (BuildingLook & { ground: number })[];
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, world: World, terrain: Terrain, depth: number) {
    const earcut = (data: number[], holes?: number[]) => Phaser.Geom.Polygon.Earcut(data, holes);
    this.looks = world.map.buildings
      .filter((b) => b.drawn)
      .map((b) => {
        // Its lowest corner, so it never floats above the ground on a slope.
        let ground = Infinity;
        const ring = b.rings[0];
        for (let i = 0; i < ring.length; i += 2) ground = Math.min(ground, terrain.at(ring[i], ring[i + 1]) * terrain.px);
        return { ...buildingLook(b, earcut), ground };
      })
      // Those whose roofs are highest drawn last, over the rest.
      .sort((a, b) => a.ground + a.b.top - (b.ground + b.b.top));
    this.g = scene.add.graphics().setDepth(depth);
  }

  /**
   * Call once a frame. A building the car's under (driving through an
   * archway), at (carX, carY), is drawn see-through, so the car can be seen.
   */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, carX: number, carY: number): void {
    const g = this.g;
    g.clear();
    const cx = view.centerX;
    const cy = view.centerY;
    const left = view.left - PAD;
    const right = view.right + PAD;
    const top = view.top - PAD;
    const bottom = view.bottom + PAD;
    for (const look of this.looks) {
      const { b } = look;
      // How much a point h px up the building is scaled out from the middle of the view.
      const lift = (h: number) => perspective.lift(look.ground + h);
      const sTop = lift(b.top);
      const sBase = lift(b.bottom);
      // The roof's box and the foot's, together.
      const [rx0, rx1, ry0, ry1] = [cx + (look.x0 - cx) * sTop, cx + (look.x1 - cx) * sTop, cy + (look.y0 - cy) * sTop, cy + (look.y1 - cy) * sTop];
      const [fx0, fx1, fy0, fy1] = [cx + (look.x0 - cx) * sBase, cx + (look.x1 - cx) * sBase, cy + (look.y0 - cy) * sBase, cy + (look.y1 - cy) * sBase];
      if (Math.max(fx1, rx1) < left || Math.min(fx0, rx0) > right) continue;
      if (Math.max(fy1, ry1) < top || Math.min(fy0, ry0) > bottom) continue;
      const over = carX > look.x0 && carX < look.x1 && carY > look.y0 && carY < look.y1 && pointInRing(carX, carY, b.rings[0]);
      const alpha = over ? 0.3 : 1;

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
          g.fillStyle(w.colour, alpha);
          quad(sBase, sTop);
          // A band of windows along each floor.
          if (look.windows !== null && Math.hypot(w.bx - w.ax, w.by - w.ay) > 12) {
            g.fillStyle(look.windows, 0.85 * alpha);
            for (let h = b.bottom + FLOOR * 0.35; h + FLOOR * 0.4 < b.top - 4; h += FLOOR) quad(lift(h), lift(h + FLOOR * 0.4));
          }
        }
      }

      // The roof.
      const tx = cx * (1 - sTop);
      const ty = cy * (1 - sTop);
      for (const f of look.facets) {
        g.fillStyle(f.colour, (look.canopy ? 0.9 : 1) * alpha);
        const t = f.tris;
        for (let i = 0; i + 5 < t.length; i += 6) {
          g.fillTriangle(tx + t[i] * sTop, ty + t[i + 1] * sTop, tx + t[i + 2] * sTop, ty + t[i + 3] * sTop, tx + t[i + 4] * sTop, ty + t[i + 5] * sTop);
        }
      }
      if (look.rim) {
        // A parapet round a flat roof.
        g.lineStyle(2 * sTop, look.rimColour, alpha);
        const r = look.rim;
        const n = r.length;
        for (let i = 0; i < n; i += 2) {
          const j = (i + 2) % n;
          g.lineBetween(tx + r[i] * sTop, ty + r[i + 1] * sTop, tx + r[j] * sTop, ty + r[j + 1] * sTop);
        }
      }
      if (look.ridge) {
        const [ax, ay, bx, by] = look.ridge;
        g.lineStyle(2 * sTop, look.ridgeColour, alpha);
        g.lineBetween(tx + ax * sTop, ty + ay * sTop, tx + bx * sTop, ty + by * sTop);
      }
      for (const [x, y, w, h] of look.boxes) {
        const px = tx + x * sTop;
        const py = ty + y * sTop;
        g.fillStyle(0x000000, 0.22 * alpha).fillRect(px + 2, py + 3, w * sTop, h * sTop);
        g.fillStyle(0xa4a7ab, alpha).fillRect(px, py, w * sTop, h * sTop);
        g.fillStyle(0xc4c7ca, alpha).fillRect(px + 1.5, py + 1.5, w * sTop - 3, h * sTop * 0.45);
      }
    }
  }
}
