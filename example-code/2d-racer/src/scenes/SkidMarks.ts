import * as Phaser from 'phaser';

/** World px covered by each skid-mark texture. */
const CHUNK = 1024;
/** Texture px per world px: marks are soft anyway, and this keeps memory down on phones. */
const RESOLUTION = 0.5;

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
 * Tyre marks that last for the whole race. Segments are drawn into textures
 * covering the world in chunks (only where there are marks), so marks build
 * up lap after lap and drawing them costs the same however many there are.
 * The textures are thrown away when the race ends, so each race starts clean.
 */
export class SkidMarks {
  private pending: Segment[] = [];
  private readonly pen: Phaser.GameObjects.Graphics;
  /** Chunk textures created this race, and the images showing them. */
  private readonly chunks = new Map<string, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.pen = scene.make.graphics({}, false);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
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

  private key(i: number, j: number): string {
    return `skid:${i},${j}`;
  }

  private chunkTexture(i: number, j: number): Phaser.Textures.DynamicTexture {
    const key = this.key(i, j);
    if (!this.chunks.has(key)) {
      this.scene.textures.addDynamicTexture(key, CHUNK * RESOLUTION, CHUNK * RESOLUTION);
      const image = this.scene.add
        .image(i * CHUNK, j * CHUNK, key)
        .setOrigin(0, 0)
        .setScale(1 / RESOLUTION)
        .setDepth(this.depth);
      this.chunks.set(key, image);
    }
    return this.scene.textures.get(key) as Phaser.Textures.DynamicTexture;
  }

  /** Frees the textures (they belong to the game, not the scene, so they'd otherwise outlive the race). */
  private destroy(): void {
    this.pen.destroy();
    for (const [key, image] of this.chunks) {
      image.destroy();
      this.scene.textures.remove(key);
    }
    this.chunks.clear();
  }
}
