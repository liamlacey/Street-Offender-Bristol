import * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type Track, type Vec2, locateOnTrack, poseAt } from '../track/Track';
import { RUN_OFF } from '../track/barriers';
import { drawCircuitRoad } from '../circuit/road';
import { drawStreets } from '../downtown/road';
import type { Decoration } from '../track/decoration';
import { type ChunkLayers, ChunkedGraphics } from './ChunkLayers';

/**
 * Draws the road and the start/finish line in the location's style, in chunks
 * so only the bits near the camera are drawn each frame. A dirt road has a
 * grassy verge, a mottled surface with wheel ruts worn into it, and loose
 * stones (verge, road and markings at three steps of `depth`). Paved ground
 * has no road at all: the way through is the ground itself, between the
 * barriers, with just the start line painted across it. (A race circuit's
 * tarmac and kerbs are drawn by circuit/road.ts, and a city's streets by
 * downtown/road.ts.)
 */
export function drawTrack(
  scene: Phaser.Scene,
  track: Track,
  location: Location,
  decoration: Decoration,
  chunks: ChunkLayers,
  depth: number,
): void {
  const { points, normals } = track;
  const n = points.length;
  const { halfWidths, kerbWidth } = track;
  let g = new ChunkedGraphics(scene, chunks, depth);
  const offset = (i: number, px: number): Vec2 => ({
    x: points[i].x + normals[i].x * px,
    y: points[i].y + normals[i].y * px,
  });
  const quad = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
  };

  if (location.road.kind === 'street' && decoration.downtown) {
    // The race runs on the city's own streets: all of them drawn alike.
    drawStreets(scene, decoration.downtown.city, location, chunks, depth);
    g = new ChunkedGraphics(scene, chunks, depth + 0.02);
  } else if (location.road.kind === 'snow') {
    const { surface, kerbColors } = location.road;
    const edge = (i: number, d: number, extra = 0): Vec2 => offset(i, d * halfWidths[i] + Math.sign(d) * extra);
    // Snow ploughed up along the edges, lumpy on its outer side.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const lump = (k: number) => kerbWidth + 3 * Math.sin(k * 1.7) + 2 * Math.sin(k * 0.6);
      g.fillStyle(kerbColors[i % 2]);
      quad(edge(i, 1, -2), edge(j, 1, -2), edge(j, 1, lump(j)), edge(i, 1, lump(i)));
      quad(edge(i, -1, -2), edge(j, -1, -2), edge(j, -1, lump(j + 7)), edge(i, -1, lump(i + 7)));
    }
    g = new ChunkedGraphics(scene, chunks, depth + 0.01);
    const tone = Phaser.Display.Color.IntegerToColor(surface);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const shade = Math.sin(i * 0.31) * 0.5 + Math.sin(i * 0.13 + 2) * 0.5;
      g.fillStyle(Phaser.Display.Color.GetColor(tone.red + shade * 6, tone.green + shade * 6, tone.blue + shade * 5));
      quad(edge(i, -1), edge(j, -1), edge(j, 1), edge(i, 1));
    }
    g = new ChunkedGraphics(scene, chunks, depth + 0.02);
    // Wheel tracks worn grey into the snow, and polished ice between them here and there.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.fillStyle(0x6f7f8c, 0.22);
      for (const at of [-0.58, -0.32, 0.32, 0.58]) {
        quad(offset(i, at * halfWidths[i] - 6), offset(j, at * halfWidths[j] - 6), offset(j, at * halfWidths[j] + 6), offset(i, at * halfWidths[i] + 6));
      }
      if (Math.sin(i * 0.23) > 0.6) {
        g.fillStyle(0xbfe0f0, 0.35);
        quad(offset(i, -halfWidths[i] * 0.2), offset(j, -halfWidths[j] * 0.2), offset(j, halfWidths[j] * 0.2), offset(i, halfWidths[i] * 0.2));
      }
    }
    let seed = 17;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) {
        const p = offset(i, (rand() * 2 - 1) * halfWidths[i] * 0.95);
        g.fillStyle(k === 0 ? 0x8c8f91 : 0xffffff, 0.8);
        g.fillRect(p.x + rand() * track.spacing - 1, p.y + rand() * 6 - 1, 2.5, 2.5);
      }
    }
  } else if (location.road.kind === 'tarmac' || location.road.kind === 'street') {
    // A race circuit's road, with kerbs and painted lines.
    drawCircuitRoad(scene, track, location, chunks, depth);
    g = new ChunkedGraphics(scene, chunks, depth + 0.02);
  } else if (location.road.kind === 'dirt' || location.road.kind === 'desert') {
    const { surface, kerbColors } = location.road;
    const desert = location.road.kind === 'desert';
    /** A point `d` road-widths out from sample i (d = 1: the road edge), plus `extra` px. */
    const edge = (i: number, d: number, extra = 0): Vec2 => offset(i, d * halfWidths[i] + Math.sign(d) * extra);
    // The verge first: the road is drawn over its inner edge, which hides overlaps on tight corners.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.fillStyle(kerbColors[i % 2]);
      quad(edge(i, 1, -2), edge(j, 1, -2), edge(j, 1, kerbWidth), edge(i, 1, kerbWidth));
      quad(edge(i, -1, -2), edge(j, -1, -2), edge(j, -1, kerbWidth), edge(i, -1, kerbWidth));
    }
    g = new ChunkedGraphics(scene, chunks, depth + 0.01);
    const mottle = Phaser.Display.Color.IntegerToColor(surface);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Slow light and dark swells along the road, so it doesn't look painted on.
      const shade = Math.sin(i * 0.37) * 0.5 + Math.sin(i * 0.11 + 1) * 0.5;
      g.fillStyle(Phaser.Display.Color.GetColor(mottle.red + shade * 9, mottle.green + shade * 8, mottle.blue + shade * 6));
      quad(edge(i, -1), edge(j, -1), edge(j, 1), edge(i, 1));
    }
    g = new ChunkedGraphics(scene, chunks, depth + 0.02);
    // Wheel ruts, a paler hump down the middle, and stones.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.fillStyle(0x000000, 0.12);
      for (const at of [-0.55, -0.3, 0.3, 0.55]) {
        quad(offset(i, at * halfWidths[i] - 5), offset(j, at * halfWidths[j] - 5), offset(j, at * halfWidths[j] + 5), offset(i, at * halfWidths[i] + 5));
      }
      g.fillStyle(0xffffff, 0.06);
      quad(offset(i, -halfWidths[i] * 0.12), offset(j, -halfWidths[j] * 0.12), offset(j, halfWidths[j] * 0.12), offset(i, halfWidths[i] * 0.12));
    }
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const p = offset(i, (rand() * 2 - 1) * halfWidths[i] * 0.95);
        g.fillStyle(desert ? (k === 0 ? 0xe3cfa8 : 0x7d5a3a) : k === 0 ? 0xb39a74 : 0x5e4a30, 0.9);
        g.fillRect(p.x + rand() * track.spacing - 1.5, p.y + rand() * 6 - 1.5, 3, 3);
      }
    }
    if (desert) {
      // Tongues of sand blown in over the edges.
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        for (const side of [1, -1]) {
          const reach = Math.max(0, Math.sin(i * 0.21 + (side > 0 ? 0 : 2.4)) * 0.5 + Math.sin(i * 0.53 + side) * 0.25) * 0.45;
          if (reach <= 0.02) continue;
          const rj = Math.max(0, Math.sin(j * 0.21 + (side > 0 ? 0 : 2.4)) * 0.5 + Math.sin(j * 0.53 + side) * 0.25) * 0.45;
          g.fillStyle(kerbColors[0], 0.85);
          quad(edge(i, side), edge(j, side), edge(j, side * (1 - rj)), edge(i, side * (1 - reach)));
        }
      }
    }
  } else {
    g = new ChunkedGraphics(scene, chunks, depth + 0.02);
  }

  // Chequered start/finish line across the way, at the first sample: across the
  // road, or where there's no road, from barrier to barrier.
  const p = points[0];
  const nrm = normals[0];
  const tan = { x: nrm.y, y: -nrm.x };
  const half = location.road.kind === 'paved' ? halfWidths[0] + kerbWidth + (track.runOff ?? RUN_OFF) : halfWidths[0];
  const cols = Math.round(half / 20) * 2;
  const sq = (half * 2) / cols;
  const at = (across: number, along: number): Vec2 => ({
    x: p.x + nrm.x * across + tan.x * along,
    y: p.y + nrm.y * across + tan.y * along,
  });
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      g.fillStyle((c + r) % 2 === 0 ? 0xffffff : 0x111111, 0.85);
      const a0 = -half + c * sq;
      const b0 = (r - 1) * sq;
      quad(at(a0, b0), at(a0 + sq, b0), at(a0 + sq, b0 + sq), at(a0, b0 + sq));
    }
  }
}

/**
 * Draws a dashed yellow gate across the road at a distance along the track,
 * marking a checkpoint the player has to go back for. Clears `g` first.
 */
export function drawCheckpointGate(g: Phaser.GameObjects.Graphics, track: Track, along: number): void {
  const p = poseAt(track, along);
  const nrm = { x: -Math.sin(p.heading), y: Math.cos(p.heading) };
  const tan = { x: Math.cos(p.heading), y: Math.sin(p.heading) };
  const at = locateOnTrack(track, p.x, p.y);
  const half = at.halfWidth + track.kerbWidth;
  const dashes = 9;
  const dash = (half * 2) / dashes;
  const thickness = 20;
  g.clear();
  for (let i = 0; i < dashes; i += 2) {
    const a = -half + i * dash;
    const corners = [
      [a, -thickness / 2],
      [a + dash, -thickness / 2],
      [a + dash, thickness / 2],
      [a, thickness / 2],
    ].map(([across, ahead]) => ({
      x: p.x + nrm.x * across + tan.x * ahead,
      y: p.y + nrm.y * across + tan.y * ahead,
    }));
    g.fillStyle(0xffd23f);
    g.fillTriangle(corners[0].x, corners[0].y, corners[1].x, corners[1].y, corners[2].x, corners[2].y);
    g.fillTriangle(corners[0].x, corners[0].y, corners[2].x, corners[2].y, corners[3].x, corners[3].y);
  }
}
