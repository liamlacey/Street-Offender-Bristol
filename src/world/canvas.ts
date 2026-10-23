/**
 * A canvas to draw on: an ordinary one on the page, or (in a worker, where
 * there's no page) an OffscreenCanvas, which draws just the same. Typed as
 * the ordinary kind, as the drawing code is written for it.
 */
export function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : (new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A texture to draw on, kept in ordinary memory (not on the GPU), so sending it to the GPU (`refresh`) is a plain copy. (Phaser's
 * own, `textures.createCanvas`, come from a pool that first opens each canvas as a GPU one, and that sticks: then each refresh
 * has the GPU finish everything it's doing and copy the picture back, holding the frame up, as much as a second or more.)
 * Smoothing off, as Phaser's are.
 */
export function softTexture(scene: Phaser.Scene, key: string, width: number, height: number): Phaser.Textures.CanvasTexture {
  const canvas = newCanvas(width, height);
  canvas.getContext('2d', { willReadFrequently: true })!.imageSmoothingEnabled = false;
  return scene.textures.addCanvas(key, canvas)!;
}
