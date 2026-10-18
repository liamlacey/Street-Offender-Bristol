import * as Phaser from 'phaser';

/** Size of a chunk of the world, px. */
const CHUNK = 1024;
/** How far things may stick out of their chunk (the biggest props), px. */
const OVERLAP = 320;

/**
 * Holds the scenery that never moves (barriers, props, trees) in layers by
 * area of the world and draw depth, and only draws the layers near the
 * camera. Big tracks have thousands of these; without this, every one would
 * be processed every frame, on screen or not.
 */
export class ChunkLayers {
  private readonly layers = new Map<string, { layer: Phaser.GameObjects.Layer; x: number; y: number }>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Moves a static game object into the layer for its place and depth. */
  add<T extends Phaser.GameObjects.GameObject & { x: number; y: number }>(object: T, depth: number): T {
    return this.addAt(object, depth, Math.floor(object.x / CHUNK), Math.floor(object.y / CHUNK));
  }

  /** Moves a static game object into the layer for a given chunk and depth. */
  addAt<T extends Phaser.GameObjects.GameObject>(object: T, depth: number, cx: number, cy: number): T {
    const key = `${depth}:${cx}:${cy}`;
    let entry = this.layers.get(key);
    if (!entry) {
      entry = { layer: this.scene.add.layer().setDepth(depth), x: cx * CHUNK, y: cy * CHUNK };
      this.layers.set(key, entry);
    }
    entry.layer.add(object);
    return object;
  }

  /** Call once a frame: shows the layers the camera can see, hides the rest. */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    for (const { layer, x, y } of this.layers.values()) {
      const visible =
        x - OVERLAP < view.right && x + CHUNK + OVERLAP > view.left && y - OVERLAP < view.bottom && y + CHUNK + OVERLAP > view.top;
      if (layer.visible !== visible) layer.setVisible(visible);
    }
  }
}

/**
 * Draws like a Graphics object, but splits what's drawn into one Graphics per
 * chunk of the world (by where each shape starts), held in the chunk layers
 * at the given depth. Phaser redraws a Graphics' shapes every frame, so for
 * the road, water and mud this means only the parts near the camera cost
 * anything.
 */
export class ChunkedGraphics {
  private readonly graphics = new Map<string, { g: Phaser.GameObjects.Graphics; color: number; alpha: number }>();
  private color = 0xffffff;
  private alpha = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly chunks: ChunkLayers,
    private readonly depth: number,
  ) {}

  fillStyle(color: number, alpha = 1): this {
    this.color = color;
    this.alpha = alpha;
    return this;
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this {
    this.at(x0, y0).fillTriangle(x0, y0, x1, y1, x2, y2);
    return this;
  }

  fillRect(x: number, y: number, w: number, h: number): this {
    this.at(x, y).fillRect(x, y, w, h);
    return this;
  }

  fillCircle(x: number, y: number, r: number): this {
    this.at(x, y).fillCircle(x, y, r);
    return this;
  }

  /** The Graphics for the chunk at (x, y), set to the current fill. */
  private at(x: number, y: number): Phaser.GameObjects.Graphics {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${cx}:${cy}`;
    let entry = this.graphics.get(key);
    if (!entry) {
      const g = this.scene.add.graphics();
      this.chunks.addAt(g, this.depth, cx, cy);
      entry = { g, color: -1, alpha: -1 };
      this.graphics.set(key, entry);
    }
    if (entry.color !== this.color || entry.alpha !== this.alpha) {
      entry.g.fillStyle(this.color, this.alpha);
      entry.color = this.color;
      entry.alpha = this.alpha;
    }
    return entry.g;
  }
}
