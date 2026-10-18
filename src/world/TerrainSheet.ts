import * as Phaser from 'phaser';
import type { Perspective } from './perspective';
import type { Terrain } from './terrain';

/** Grid points this far apart, px: the hills are smooth, so this follows them closely enough. */
const STEP = 32;

/**
 * A flat picture of a piece of the ground (the paving and roads, the tyre
 * marks) laid over the hills: a mesh of triangles whose corners are moved
 * every frame to where the perspective puts the ground under them.
 */
export class TerrainSheet {
  readonly mesh: Phaser.GameObjects.Mesh2D;
  /** Each grid point's place on the map and height, px: x, y, z, ... */
  private readonly points: Float32Array;

  constructor(scene: Phaser.Scene, texture: string, x0: number, y0: number, w: number, h: number, depth: number, terrain: Terrain) {
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
        this.points[k * 3 + 2] = terrain.at(x, y) * terrain.px;
        vertices.push(x, y, u, v);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const a = j * cols + i;
        indices.push(a, a + 1, a + cols, 0, a + 1, a + cols + 1, a + cols, 0);
      }
    }
    // Texture coordinates here run top-down; GL's run bottom-up.
    this.mesh = scene.add.mesh2d(0, 0, texture, vertices, indices, true).setDepth(depth);
    this.mesh.buildOrderedIndices(0, true);
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
