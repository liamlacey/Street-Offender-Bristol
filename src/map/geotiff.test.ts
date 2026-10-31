import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { mosaic, rasterText, readTiff } from './geotiff';
import { parseWcsText, sample } from './lidar';

/** A little GeoTIFF as Wales's tiles are: floats, a strip a row, deflated, a tie point, a metre a cell, nodata -9999. */
function tiff(cols: number, rows: number, values: number[], e: number, n: number): Uint8Array {
  const strips = Array.from({ length: rows }, (_, r) => {
    const b = new Uint8Array(cols * 4);
    const v = new DataView(b.buffer);
    for (let c = 0; c < cols; c++) v.setFloat32(c * 4, values[r * cols + c], true);
    return new Uint8Array(deflateSync(b));
  });
  // Tags: [tag, type, values]; types 3 short, 4 long, 12 double, 2 ascii.
  const tags: [number, number, number[]][] = [
    [256, 3, [cols]],
    [257, 3, [rows]],
    [258, 3, [32]],
    [259, 3, [8]],
    [273, 4, []], // (filled in)
    [277, 3, [1]],
    [278, 3, [1]],
    [279, 4, strips.map((s) => s.length)],
    [339, 3, [3]],
    [33550, 12, [1, 1, 0]],
    [33922, 12, [0, 0, 0, e, n, 0]],
    [42113, 2, [...'-9999'].map((ch) => ch.charCodeAt(0)).concat(0)],
  ];
  const size = (t: number) => (t === 3 ? 2 : t === 4 ? 4 : t === 12 ? 8 : 1);
  const ifdAt = 8;
  const ifdLen = 2 + tags.length * 12 + 4;
  // Out-of-line values, then the strips.
  let at = ifdAt + ifdLen;
  const outOfLine = new Map<number, number>();
  for (const [tag, type, vals] of tags) {
    const len = (tag === 273 ? rows : vals.length) * size(type);
    if (len > 4) {
      outOfLine.set(tag, at);
      at += len;
    }
  }
  const offsets: number[] = [];
  for (const s of strips) {
    offsets.push(at);
    at += s.length;
  }
  tags[4][2] = offsets;
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdAt, true);
  v.setUint16(ifdAt, tags.length, true);
  tags.forEach(([tag, type, vals], i) => {
    const p = ifdAt + 2 + i * 12;
    v.setUint16(p, tag, true);
    v.setUint16(p + 2, type, true);
    v.setUint32(p + 4, vals.length, true);
    const where = outOfLine.get(tag) ?? p + 8;
    vals.forEach((x, k) => {
      const q = where + k * size(type);
      if (type === 3) v.setUint16(q, x, true);
      else if (type === 4) v.setUint32(q, x, true);
      else if (type === 12) v.setFloat64(q, x, true);
      else out[q] = x;
    });
    if (outOfLine.has(tag)) v.setUint32(p + 8, where, true);
  });
  strips.forEach((s, k) => out.set(s, offsets[k]));
  return out;
}

const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));

describe('readTiff', () => {
  it('reads the heights, where they are, and no reading as NaN', () => {
    const t = readTiff(tiff(3, 2, [1, 2, 3, 4, -9999, 6.5], 295000, 285000), inflate);
    expect(t).toMatchObject({ e: 295000, n: 285000, cols: 3, rows: 2 });
    expect([...t.data].slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(t.data[4]).toBeNaN();
    expect(t.data[5]).toBe(6.5);
  });
});

describe('mosaic and rasterText', () => {
  it('puts tiles side by side, and comes back the same through parseWcsText', () => {
    const west = readTiff(tiff(2, 2, [1, 2, 3, 4], 100, 202), inflate);
    const east = readTiff(tiff(2, 2, [5, 6, 7, 8], 102, 202), inflate);
    const r = mosaic([west, east], 101, 199, 104, 202);
    expect(r).toMatchObject({ e0: 101.5, n0: 201.5, cols: 3, rows: 3 });
    expect([...r.data].slice(0, 6)).toEqual([2, 5, 6, 4, 7, 8]);
    expect(r.data[6]).toBeNaN();
    const back = parseWcsText(rasterText(r));
    expect(back).toMatchObject({ e0: 101.5, n0: 201.5, cols: 3, rows: 3 });
    expect(sample(back, 102.5, 200.5)).toBe(7);
    expect(back.data[8]).toBeNaN();
  });
});
