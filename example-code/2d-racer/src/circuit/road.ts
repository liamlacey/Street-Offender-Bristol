import type * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import type { Track, Vec2 } from '../track/Track';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';

/**
 * Draws a race circuit's road: tarmac
 * with kerbs in the location's kerb colours, and the circuit's painted lines.
 * Kerbs, road and lines go at three steps of `depth`, in chunks.
 */
export function drawCircuitRoad(scene: Phaser.Scene, track: Track, location: Location, chunks: ChunkLayers, depth: number): void {
  const { points, normals, halfWidths, kerbWidth } = track;
  const n = points.length;
  let g = new ChunkedGraphics(scene, chunks, depth);
  const offset = (i: number, px: number): Vec2 => ({ x: points[i].x + normals[i].x * px, y: points[i].y + normals[i].y * px });
  const quad = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
  };
  const { surface, kerbColors } = location.road;
  const { centreLine, edgeLines } = location.circuit?.road ?? { centreLine: false, edgeLines: false };
  const edge = (i: number, d: number, extra = 0): Vec2 => offset(i, d * halfWidths[i] + Math.sign(d) * extra);
  // Kerbs first: the road is drawn over their inner edge, which hides overlaps on tight corners.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.fillStyle(kerbColors[i % 2]);
    quad(edge(i, 1, -2), edge(j, 1, -2), edge(j, 1, kerbWidth), edge(i, 1, kerbWidth));
    quad(edge(i, -1, -2), edge(j, -1, -2), edge(j, -1, kerbWidth), edge(i, -1, kerbWidth));
  }
  g = new ChunkedGraphics(scene, chunks, depth + 0.01);
  g.fillStyle(surface);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(edge(i, -1), edge(j, -1), edge(j, 1), edge(i, 1));
  }
  g = new ChunkedGraphics(scene, chunks, depth + 0.02);
  g.fillStyle(0xffffff, 0.3);
  for (let i = 0; centreLine && i < n; i += 3) {
    const j = (i + 1) % n;
    quad(offset(i, -2), offset(j, -2), offset(j, 2), offset(i, 2));
  }
  // Solid white lines a little in from each edge.
  g.fillStyle(0xffffff, 0.55);
  for (let i = 0; edgeLines && i < n; i++) {
    const j = (i + 1) % n;
    for (const side of [1, -1]) {
      const a = halfWidths[i] - 9;
      const b = halfWidths[j] - 9;
      quad(offset(i, side * a), offset(j, side * b), offset(j, side * (b - 3)), offset(i, side * (a - 3)));
    }
  }
}
