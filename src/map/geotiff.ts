/**
 * Reading a LIDAR tile that comes as a GeoTIFF (Wales's: see src/map/README.md's sources), and putting tiles together into an
 * area's raster, written out as the Environment Agency's coverages are (`parseWcsText` reads it back), so it's kept and used
 * the same way. Only what those tiles are: one band of 32-bit floats, in strips, deflated (or not), British National Grid, a
 * metre a cell. Pure: the inflating's handed in.
 */

import type { Raster } from './lidar.ts';

/** A tile's heights: the corner of its top-left cell (easting, northing, metres), its size, its cells (NaN where there's no reading). */
export interface Tile {
  e: number;
  n: number;
  cols: number;
  rows: number;
  data: Float32Array;
}

/** A GeoTIFF's heights (`inflate` undoes deflate: zlib's). */
export function readTiff(bytes: Uint8Array, inflate: (b: Uint8Array) => Uint8Array): Tile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) throw new Error('Not a TIFF (or a BigTIFF, which is not read)');
  const ifd = u32(4);
  const tags = new Map<number, number[]>();
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const at = ifd + 2 + i * 12;
    const [tag, type, count] = [u16(at), u16(at + 2), u32(at + 4)];
    const size = type === 3 ? 2 : type === 4 ? 4 : type === 12 ? 8 : 1;
    const from = count * size <= 4 ? at + 8 : u32(at + 8);
    const values: number[] = [];
    for (let k = 0; k < count; k++) {
      const p = from + k * size;
      values.push(type === 3 ? u16(p) : type === 4 ? u32(p) : type === 12 ? view.getFloat64(p, little) : bytes[p]);
    }
    tags.set(tag, values);
  }
  const one = (tag: number, otherwise?: number) => tags.get(tag)?.[0] ?? otherwise;
  const cols = one(256)!;
  const rows = one(257)!;
  if (one(258) !== 32 || one(339) !== 3) throw new Error('Only 32-bit float heights are read');
  if ((one(317, 1) ?? 1) !== 1) throw new Error('A predictor: not read');
  const compression = one(259, 1);
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new Error(`Compression ${compression}: not read`);
  const offsets = tags.get(273)!;
  const counts = tags.get(279)!;
  const perStrip = one(278, rows)!;
  // Where it is: the tie point (cell 0, 0 at easting, northing), a metre a cell.
  const tie = tags.get(33922)!;
  const scale = tags.get(33550)!;
  if (Math.abs(scale[0] - 1) > 1e-9 || Math.abs(scale[1] - 1) > 1e-9) throw new Error('Only a metre a cell is read');
  // What stands for no reading (an ASCII number).
  const nodataBytes = tags.get(42113);
  const nodata = nodataBytes ? parseFloat(String.fromCharCode(...nodataBytes.filter((c) => c))) : NaN;
  const data = new Float32Array(cols * rows);
  for (let s = 0; s < offsets.length; s++) {
    const raw = bytes.subarray(offsets[s], offsets[s] + counts[s]);
    const plain = compression === 1 ? raw : inflate(raw);
    const strip = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const first = s * perStrip * cols;
    const n = Math.min(plain.byteLength / 4, data.length - first);
    for (let k = 0; k < n; k++) {
      const v = strip.getFloat32(k * 4, little);
      data[first + k] = v === nodata || v < -1000 || v > 10000 ? NaN : v;
    }
  }
  return { e: tie[3] - tie[0], n: tie[4] + tie[1], cols, rows, data };
}

/** The tiles put together over (e0, n0) to (e1, n1) (metres: whole ones), a metre a cell; NaN where none of them reads. */
export function mosaic(tiles: Tile[], e0: number, n0: number, e1: number, n1: number): Raster {
  const [cols, rows] = [e1 - e0, n1 - n0];
  const data = new Float32Array(cols * rows).fill(NaN);
  for (const t of tiles) {
    for (let r = 0; r < t.rows; r++) {
      const row = n1 - (t.n - r);
      if (row < 0 || row >= rows) continue;
      for (let c = 0; c < t.cols; c++) {
        const col = t.e + c - e0;
        if (col < 0 || col >= cols) continue;
        const v = t.data[r * t.cols + c];
        if (!Number.isNaN(v)) data[row * cols + col] = v;
      }
    }
  }
  // (The middle of the top-left cell, as the coverages give it.)
  return { e0: e0 + 0.5, n0: n1 - 0.5, cols, rows, data };
}

/** A raster written out as the Environment Agency's coverages are (as much of it as `parseWcsText` reads), heights to the mm. */
export function rasterText(r: Raster): string {
  const head = [
    `Grid bounds: GeneralBounds[(${r.e0 - 0.5}, ${r.n0 + 0.5 - r.rows}), (${r.e0 - 0.5 + r.cols}, ${r.n0 + 0.5})]`,
    `Grid range: GridEnvelope2D[0..${r.cols - 1}, 0..${r.rows - 1}]`,
    `  PARAMETER["elt_0_2", ${r.e0}], `,
    `  PARAMETER["elt_1_2", ${r.n0}]]`,
    'Band 0:',
  ];
  const lines: string[] = [];
  for (let row = 0; row < r.rows; row++) {
    const cells: string[] = [];
    for (let c = 0; c < r.cols; c++) {
      const v = r.data[row * r.cols + c];
      cells.push(Number.isNaN(v) ? '-9999' : String(Math.round(v * 1000) / 1000));
    }
    lines.push(cells.join(' '));
  }
  return `${head.join('\n')}\n${lines.join('\n')}\n`;
}
