import * as Phaser from 'phaser';
import type { Perspective } from './perspective';

/** Grid points this far apart, px: the hills are smooth, so this follows them closely enough. */
const STEP = 32;
/** A square a ledge runs through is cut into this many each way (a metre each), so the ground steps down at its edge. */
const SPLIT = 4;

/**
 * A flat picture of a piece of the ground (the paving and roads, the tyre
 * marks) laid over the hills, or of a bridge's deck: a mesh of triangles
 * whose corners are moved every frame to where the perspective puts them.
 */
export class TerrainSheet {
  readonly mesh: Phaser.GameObjects.Mesh2D;
  /** Each grid point's place on the map and height, px: x, y, z, ... */
  private points: Float32Array;

  /**
   * `height` gives the surface's height (px) under each point: the ground's, or a deck's; `split` says whether a square
   * (from x, y, so many px across) has a ledge through it, to cut it finer. (Where the squares either side of a side
   * aren't both cut, no ledge crosses it, so the ground along it is the same straight line either way: no gaps.)
   */
  constructor(scene: Phaser.Scene, texture: string, x0: number, y0: number, w: number, h: number, depth: number, height: (x: number, y: number) => number, split?: (x: number, y: number, size: number) => boolean) {
    const cols = Math.ceil(w / STEP) + 1;
    const rows = Math.ceil(h / STEP) + 1;
    const vertices: number[] = [];
    this.points = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u = Math.min(1, (i * STEP) / w);
        const v = Math.min(1, (j * STEP) / h);
        const x = x0 + u * w;
        const y = y0 + v * h;
        const k = j * cols + i;
        this.points[k * 3] = x;
        this.points[k * 3 + 1] = y;
        this.points[k * 3 + 2] = height(x, y);
        vertices.push(x, y, u, v);
      }
    }
    const indices: number[] = [];
    const extra: number[] = [];
    const add = (x: number, y: number) => {
      vertices.push(x, y, (x - x0) / w, (y - y0) / h);
      extra.push(x, y, height(x, y));
      return vertices.length / 4 - 1;
    };
    // A square's corner, or a point a part of the way along one of its sides (the same everywhere it's worked out, so the same vertex).
    const at = (sx: number, sy: number, a: number, b: number): [number, number] => [sx + (a / SPLIT) * Math.min(STEP, x0 + w - sx), sy + (b / SPLIT) * Math.min(STEP, y0 + h - sy)];
    const isSplit = (sx: number, sy: number) => !!split?.(sx, sy, STEP);
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const [sx, sy] = [x0 + i * STEP, y0 + j * STEP];
        if (isSplit(sx, sy)) {
          // A metre a square, each corner at its own height (the ground's on its own side of the ledge).
          const first = vertices.length / 4;
          for (let b = 0; b <= SPLIT; b++) for (let a = 0; a <= SPLIT; a++) add(...at(sx, sy, a, b));
          for (let b = 0; b < SPLIT; b++) {
            for (let a = 0; a < SPLIT; a++) {
              const q = first + b * (SPLIT + 1) + a;
              indices.push(q, q + 1, q + SPLIT + 1, 0, q + 1, q + SPLIT + 2, q + SPLIT + 1, 0);
            }
          }
          continue;
        }
        const k = j * cols + i;
        // Beside a cut square: the points along the side they share too (a fan from the middle), or there'd be hairline gaps where they meet.
        const sides = [isSplit(sx, sy - STEP), isSplit(sx + STEP, sy), isSplit(sx, sy + STEP), isSplit(sx - STEP, sy)];
        if (!sides.some(Boolean)) {
          indices.push(k, k + 1, k + cols, 0, k + 1, k + cols + 1, k + cols, 0);
          continue;
        }
        const ring: number[] = [k];
        // Round it clockwise from its top-left corner: each side's points (if it's beside a cut square), then the next corner.
        const along = (side: number, to: number, point: (n: number) => [number, number]) => {
          if (sides[side]) for (let n = 1; n < SPLIT; n++) ring.push(add(...point(n)));
          if (to !== k) ring.push(to);
        };
        along(0, k + 1, (n) => at(sx, sy, n, 0));
        along(1, k + cols + 1, (n) => at(sx, sy, SPLIT, n));
        along(2, k + cols, (n) => at(sx, sy, SPLIT - n, SPLIT));
        along(3, k, (n) => at(sx, sy, 0, SPLIT - n));
        const middle = add(...at(sx, sy, SPLIT / 2, SPLIT / 2));
        for (let n = 0; n < ring.length; n++) indices.push(ring[n], ring[(n + 1) % ring.length], middle, 0);
      }
    }
    if (extra.length) {
      const all = new Float32Array(this.points.length + extra.length);
      all.set(this.points);
      all.set(extra, this.points.length);
      this.points = all;
    }
    // Texture coordinates here run top-down; GL's run bottom-up.
    this.mesh = scene.add.mesh2d(0, 0, texture, vertices, indices, true).setDepth(depth);
    // Drawn as quads: each triangle paired with the next where they share a side (as they're made here: each square's
    // two, and each pair round a fan), so half as many go to the GPU as drawing each triangle as a quad of its own.
    this.mesh.buildOrderedIndices(1, true);
  }

  /** Moves the grid's corners to where the perspective puts them. */
  update(view: Perspective): void {
    const v = this.mesh.vertices;
    const p = this.points;
    for (let k = 0, n = p.length / 3; k < n; k++) {
      const s = view.lift(p[k * 3 + 2]);
      v[k * 4] = view.x(p[k * 3], s);
      v[k * 4 + 1] = view.y(p[k * 3 + 1], s);
    }
  }

  setVisible(visible: boolean): void {
    if (this.mesh.visible !== visible) this.mesh.setVisible(visible);
  }

  destroy(): void {
    this.mesh.destroy();
  }
}
