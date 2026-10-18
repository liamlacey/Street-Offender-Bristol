import * as Phaser from 'phaser';

/** Size of a chunk of the world, px. */
const CHUNK = 1024;
/** How far things may stick out of their chunk (the biggest props), px. */
const OVERLAP = 40;

/**
 * Holds the things that never move (lamp posts, bollards, phone boxes) in
 * layers by area of the map and draw depth, and only draws the layers near
 * the camera. There are hundreds of these; without this, every one would be
 * processed every frame, on screen or not. (From 2D Racer.)
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
