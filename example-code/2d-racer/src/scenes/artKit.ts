/** Small helpers for drawing the game's art in code, onto a 2D canvas. */

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** One picture on a texture atlas. */
export interface FrameSpec {
  name: string;
  w: number;
  h: number;
  draw: Draw;
}

/** Small seeded generator so the pictures come out the same every time. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rotation = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}
