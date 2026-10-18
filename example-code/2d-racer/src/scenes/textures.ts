import * as Phaser from 'phaser';
import { CAR_LENGTH, CAR_WIDTH } from '../car/CarPhysics';
import type { Location } from '../locations/locations';

/**
 * Placeholder art drawn in code, so the game needs no image files.
 * Swap these for real sprites (e.g. Kenney's racing pack) later.
 */
export const TEX = {
  cone: 'cone',
  /** Soft white blob for smoke and dust (tinted). */
  puff: 'puff',
  spark: 'spark',
  carShadow: 'car-shadow',
} as const;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);

  // Traffic cone.
  g.fillStyle(0xff7a00);
  g.fillCircle(9, 9, 9);
  g.fillStyle(0xffffff);
  g.fillCircle(9, 9, 5);
  g.fillStyle(0xff7a00);
  g.fillCircle(9, 9, 3);
  g.generateTexture(TEX.cone, 18, 18);
  g.clear();

  // Puff: stacked translucent circles give a soft edge.
  for (let r = 16; r >= 2; r -= 2) {
    g.fillStyle(0xffffff, 0.09);
    g.fillCircle(16, 16, r);
  }
  g.generateTexture(TEX.puff, 32, 32);
  g.clear();

  g.fillStyle(0xffffff);
  g.fillCircle(3, 3, 3);
  g.generateTexture(TEX.spark, 6, 6);
  g.clear();

  // Drawn solid; the shadow image is made translucent.
  g.fillStyle(0x000000);
  g.fillRoundedRect(0, 0, CAR_LENGTH, CAR_WIDTH - 4, 6);
  g.generateTexture(TEX.carShadow, CAR_LENGTH, CAR_WIDTH - 4);

  g.destroy();
}

/**
 * Makes (once) and returns the texture key for a location's ground tile: the
 * forest floor, with enough in it that you can see how fast you're moving
 * off-road. (A race circuit's mown grass is in circuit/art.ts.)
 */
export function groundTexture(scene: Phaser.Scene, location: Location): string {
  const key = `ground-${location.id}`;
  if (scene.textures.exists(key)) return key;
  const { base, stripe, tuft } = location.ground;
  const g = scene.make.graphics({}, false);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Forest floor: moss and fallen leaves, twigs and the odd fern, with no
  // pattern you'd notice repeating. Drawn away from the edges so it tiles.
  const T = 256;
  g.fillStyle(base);
  g.fillRect(0, 0, T, T);
  const dot = (color: number, alpha: number, size: number, count: number) => {
    g.fillStyle(color, alpha);
    for (let i = 0; i < count; i++) g.fillCircle(size + rand() * (T - size * 2), size + rand() * (T - size * 2), size * (0.5 + rand() * 0.5));
  };
  dot(stripe, 1, 14, 30);
  dot(0x263d1e, 0.7, 10, 30);
  dot(tuft, 0.8, 3, 140);
  dot(0x7a5a2a, 0.7, 2, 90);
  dot(0x9c6b2c, 0.6, 2, 50);
  // Twigs.
  g.fillStyle(0x4a3824, 0.8);
  for (let i = 0; i < 18; i++) {
    const x = 10 + rand() * (T - 30);
    const y = 10 + rand() * (T - 30);
    const a = rand() * Math.PI;
    const len = 6 + rand() * 10;
    g.fillTriangle(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, x + 1.5, y + 1.5);
  }
  // Ferns: little green stars.
  for (let i = 0; i < 10; i++) {
    const x = 14 + rand() * (T - 28);
    const y = 14 + rand() * (T - 28);
    g.fillStyle(i % 2 ? 0x3f6b2c : 0x4d7a33, 0.9);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rand();
      g.fillTriangle(x, y, x + Math.cos(a) * 11, y + Math.sin(a) * 11, x + Math.cos(a + 0.4) * 5, y + Math.sin(a + 0.4) * 5);
    }
  }
  g.generateTexture(key, T, T);
  g.destroy();
  return key;
}

/**
 * Makes (once) and returns the texture key for a car in the given body colour,
 * drawn facing right: a saloon, an off-roader with a light pod, roof vent
 * and mud flaps, or a touring race car with stripes, a number roundel and a
 * rear wing.
 */
export function carTexture(scene: Phaser.Scene, color: number, style: 'saloon' | 'rally' | 'racer' = 'saloon'): string {
  const key = `car-${style}-${color.toString(16).padStart(6, '0')}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  const L = CAR_LENGTH;
  const W = CAR_WIDTH;
  g.fillStyle(0x111111);
  for (const [x, y] of [[6, 0], [L - 14, 0], [6, W - 4], [L - 14, W - 4]]) {
    g.fillRect(x, y, 9, 4); // tyres
  }
  g.fillStyle(color);
  g.fillRoundedRect(1, 3, L - 2, W - 6, 5);
  g.fillStyle(0x9fd3ff);
  g.fillRect(L - 18, 6, 7, W - 12); // windscreen
  g.fillStyle(0x6fa8d6);
  g.fillRect(9, 7, 5, W - 14); // rear window
  g.fillStyle(0xfff3b0);
  g.fillRect(L - 3, 5, 2, 4); // headlights
  g.fillRect(L - 3, W - 9, 2, 4);
  if (style === 'rally') {
    // Bonnet light pod, roof vent and mud flaps behind the wheels.
    g.fillStyle(0x111111);
    g.fillRect(L - 9, 5, 3, W - 10);
    g.fillStyle(0xfff3b0);
    for (const y of [6, 10, 14]) g.fillRect(L - 9, y, 3, 3);
    g.fillStyle(0x2b2b2b);
    g.fillRect(17, W / 2 - 2, 5, 4);
    g.fillStyle(0x222222);
    g.fillRect(2, 1, 2, 3);
    g.fillRect(2, W - 4, 2, 3);
  }
  if (style === 'racer') {
    // Twin stripes nose to tail, a white roundel on the roof, and a wing across the back.
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(2, W / 2 - 3.5, L - 4, 2);
    g.fillRect(2, W / 2 + 1.5, L - 4, 2);
    g.fillStyle(0xffffff);
    g.fillCircle(22, W / 2, 4.5);
    g.fillStyle(0x111111);
    g.fillRect(21, W / 2 - 2.5, 2, 5);
    g.fillStyle(0x1d1d1f);
    g.fillRect(0, 2, 4, W - 4);
  }
  g.generateTexture(key, L, W);
  g.destroy();
  return key;
}
