import * as Phaser from 'phaser';
import type { Perspective } from '../world/perspective';
import type { Terrain } from '../world/terrain';
import { TerrainSheet } from '../world/TerrainSheet';

/** World px covered by each skid-mark texture. */
const CHUNK = 512;
/** Texture px per world px: marks are soft anyway, and this keeps memory down on phones. */
const RESOLUTION = 0.5;
/**
 * The most chunks of marks kept (a quarter of a MB each): past this, the one longest out of sight is wiped and used again.
 * (Their textures are all made at the start: making one as you drive holds the frame up, while the GPU catches up.)
 */
const MOST = 64;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  alpha: number;
  width: number;
}

/**
 * Tyre marks that stay on the streets. Segments are drawn into textures
 * covering the world in chunks (only where there are marks), so marks build
 * up and drawing them costs the same however many there are. There are
 * MOST textures, made at the start: past that many chunks, the one longest
 * out of sight is wiped and used for the next (so a long game doesn't fill
 * the phone). They're thrown away when the game scene ends. (From 2D Racer.)
 */
export class SkidMarks {
  private pending: Segment[] = [];
  private readonly pen: Phaser.GameObjects.Graphics;
  /** The chunks with marks (by `i,j`): which texture each is in, the picture showing it, when it was last near the view (frames). */
  private readonly chunks = new Map<string, { i: number; j: number; key: string; sheet: TerrainSheet; seen: number }>();
  /** The textures not in use. */
  private readonly free: string[] = [];
  private frame = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private terrain: Terrain,
    private readonly depth: number,
  ) {
    this.pen = scene.make.graphics({}, false);
    for (let k = 0; k < MOST; k++) {
      const key = `skid:${k}`;
      if (!scene.textures.exists(key)) scene.textures.addDynamicTexture(key, CHUNK * RESOLUTION, CHUNK * RESOLUTION);
      this.free.push(key);
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** The next region's lie of the land (see streamer.ts). */
  use(terrain: Terrain): void {
    this.terrain = terrain;
  }

  add(x1: number, y1: number, x2: number, y2: number, color: number, alpha: number, width: number): void {
    this.pending.push({ x1, y1, x2, y2, color, alpha, width });
  }

  /** Draws everything added since the last flush into the chunk textures. Call once per frame. */
  flush(): void {
    if (this.pending.length === 0) return;
    const byChunk = new Map<string, Segment[]>();
    for (const s of this.pending) {
      const pad = s.width;
      for (let i = Math.floor((Math.min(s.x1, s.x2) - pad) / CHUNK); i <= Math.floor((Math.max(s.x1, s.x2) + pad) / CHUNK); i++) {
        for (let j = Math.floor((Math.min(s.y1, s.y2) - pad) / CHUNK); j <= Math.floor((Math.max(s.y1, s.y2) + pad) / CHUNK); j++) {
          const id = `${i},${j}`;
          const list = byChunk.get(id);
          if (list) list.push(s);
          else byChunk.set(id, [s]);
        }
      }
    }
    this.pending = [];

    for (const [id, segments] of byChunk) {
      const [i, j] = id.split(',').map(Number);
      const texture = this.chunkTexture(i, j);
      const ox = i * CHUNK;
      const oy = j * CHUNK;
      const pen = this.pen.clear();
      for (const s of segments) {
        pen.lineStyle(s.width * RESOLUTION, s.color, s.alpha);
        pen.lineBetween((s.x1 - ox) * RESOLUTION, (s.y1 - oy) * RESOLUTION, (s.x2 - ox) * RESOLUTION, (s.y2 - oy) * RESOLUTION);
      }
      texture.draw(pen, 0, 0).render();
    }
  }

  /** Lays the marks near the view over the hills (and hides the rest). Call once a frame. */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective): void {
    const pad = 320;
    this.frame++;
    for (const c of this.chunks.values()) {
      const near = (c.i + 1) * CHUNK > view.left - pad && c.i * CHUNK < view.right + pad && (c.j + 1) * CHUNK > view.top - pad && c.j * CHUNK < view.bottom + pad;
      c.sheet.setVisible(near);
      if (!near) continue;
      c.sheet.update(perspective);
      c.seen = this.frame;
    }
  }

  private chunkTexture(i: number, j: number): Phaser.Textures.DynamicTexture {
    const id = `${i},${j}`;
    let c = this.chunks.get(id);
    if (!c) {
      // A texture not in use; or, all in use, the one longest out of sight, wiped.
      let key = this.free.pop();
      if (!key) {
        let [oldest, when] = ['', Infinity];
        for (const [k, o] of this.chunks) if (o.seen < when) [oldest, when] = [k, o.seen];
        const o = this.chunks.get(oldest)!;
        o.sheet.destroy();
        this.chunks.delete(oldest);
        key = o.key;
        (this.scene.textures.get(key) as Phaser.Textures.DynamicTexture).clear();
      }
      c = { i, j, key, sheet: new TerrainSheet(this.scene, key, i * CHUNK, j * CHUNK, CHUNK, CHUNK, this.depth, (x, y) => this.terrain.at(x, y) * this.terrain.px), seen: this.frame };
      this.chunks.set(id, c);
    }
    return this.scene.textures.get(c.key) as Phaser.Textures.DynamicTexture;
  }

  /** Frees the textures (they belong to the game, not the scene, so they'd otherwise outlive it). */
  private destroy(): void {
    this.pen.destroy();
    for (const c of this.chunks.values()) c.sheet.destroy();
    for (let k = 0; k < MOST; k++) this.scene.textures.remove(`skid:${k}`);
    this.chunks.clear();
    this.free.length = 0;
  }
}
