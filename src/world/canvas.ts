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
