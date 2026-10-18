/**
 * Bristol's skyline for the title screen, drawn in code: the rows of
 * painted houses stepping up the hill (as at Totterdown and Cliftonwood),
 * and the Clifton Suspension Bridge across the gorge. Pure layout, so it can
 * be tested; TitleScene draws it.
 */

/** The painted houses' colours. */
export const HOUSE_COLOURS = [0xe8505b, 0xf2c94c, 0x6fcf97, 0x4fa3d1, 0xbb6bd9, 0xff8c42, 0xf2f2ec, 0x2a9d8f];

export interface House {
  x: number;
  /** Its ground level (houses step up the hill), and its height. */
  y: number;
  w: number;
  h: number;
  colour: number;
}

/** A terrace of houses across `width`, stepping up the hill from left to right, with its base at `ground`. */
export function terrace(width: number, ground: number, rand: () => number): House[] {
  const houses: House[] = [];
  for (let x = 0, k = 0; x < width; k++) {
    const w = 26 + Math.floor(rand() * 14);
    const step = (x / width) * 70;
    houses.push({ x, y: ground - step, w, h: 34 + Math.floor(rand() * 18), colour: HOUSE_COLOURS[k % HOUSE_COLOURS.length] });
    x += w;
  }
  return houses;
}

/** The suspension bridge: its two towers, and the chains between them sagging into a curve. */
export function bridge(x0: number, x1: number, deck: number): { towers: [number, number]; chain: { x: number; y: number }[] } {
  const towers: [number, number] = [x0 + (x1 - x0) * 0.12, x1 - (x1 - x0) * 0.12];
  const top = deck - 60;
  const chain = Array.from({ length: 41 }, (_, k) => {
    const t = k / 40;
    const x = towers[0] + (towers[1] - towers[0]) * t;
    return { x, y: top + Math.sin(Math.PI * t) * 52 };
  });
  return { towers, chain };
}
