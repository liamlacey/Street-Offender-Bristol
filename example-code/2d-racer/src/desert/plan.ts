/**
 * Planning the desert round a track: ghost towns beside the road, red rock
 * buttes and mesas out in the distance, sand dunes, dry lake beds, outcrops
 * of red rock and windpumps (called from the scenery planner,
 * track/decoration.ts, before the camps and wrecks by the road), then cacti,
 * Joshua trees and sagebrush scattered over what's left (after them).
 */

import type { Placer } from '../track/decoration';
import { CACTI, DESERT_PROP_SIZE, WIND } from './style';

export function planDesert(kit: Placer): void {
  towns(kit);
  playas(kit);
  mesas(kit);
  dunes(kit);
  scattered(kit, 'outcrop', 260_000, 80, 200, 30);
  scattered(kit, 'windpump', 3_000_000, 70, 70, 60);
}

/** Cacti, Joshua trees and sagebrush, scattered thinly everywhere else. */
export function planScrub(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const tries = Math.min(1400, Math.round(((maxX - minX) * (maxY - minY)) / 22_000));
  for (let k = 0; k < tries; k++) {
    const variant = kit.int(CACTI.length);
    const kind = CACTI[variant];
    const size = kind === 'joshua' ? 56 + kit.int(30) : kind === 'saguaro' ? 40 + kit.int(20) : kind === 'barrelcactus' ? 18 + kit.int(8) : 26 + kit.int(16);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    kit.add(kit.prop('cactus', x, y, kit.rng() * Math.PI * 2, size, size, variant), kit.beyond + 20, 12);
  }
}

/** Ghost towns along the straighter stretches, their main street running beside the road. */
function towns(kit: Placer): void {
  const { w, h } = DESERT_PROP_SIZE.town;
  const count = Math.max(1, Math.round((0.35 * kit.track.length) / 10_000));
  for (let placed = 0, tries = 0; placed < count && tries < count * 30; tries++) {
    const i = kit.int(kit.n);
    if (kit.radii[i] < 900) continue;
    if (kit.facing('town', i, kit.sides()[0], w, h, 40, kit.int(1000), [0, 40, 90])) placed++;
  }
}

/** Dry lake beds out in the open. */
function playas(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const count = Math.max(1, Math.round(((maxX - minX) * (maxY - minY)) / 14_000_000));
  for (let placed = 0, tries = 0; placed < count && tries < count * 30; tries++) {
    const w = 600 + kit.int(500);
    const h = 320 + kit.int(260);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    if (kit.add(kit.prop('playa', x, y, kit.rng() * Math.PI, w, h, kit.int(1000)), kit.beyond + 80, 40)) placed++;
  }
}

/** Buttes and mesas of red rock, standing well back from the road. */
function mesas(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const tries = Math.round(((maxX - minX) * (maxY - minY)) / 260_000);
  for (let k = 0; k < tries; k++) {
    const size = 280 + kit.int(620);
    // Some long and flat (mesas), some squat (buttes).
    const stretch = 1 + kit.rng() * 0.8;
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    kit.add(kit.prop('mesa', x, y, kit.rng() * Math.PI, size * stretch, size, kit.int(1_000_000)), kit.beyond + 260, 40);
  }
}

/** Sand dunes, all lying the same way to the wind. */
function dunes(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const tries = Math.round(((maxX - minX) * (maxY - minY)) / 320_000);
  for (let k = 0; k < tries; k++) {
    const across = 220 + kit.int(360);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    // Along the wind (w) shorter than across it (h): a crescent with its horns downwind.
    kit.add(kit.prop('dune', x, y, WIND, across * 0.65, across, kit.int(1_000_000)), kit.beyond + 60, 20);
  }
}

/** Something of a size somewhere in the open, about one per `per` px² of world. */
function scattered(kit: Placer, kind: 'outcrop' | 'windpump', per: number, min: number, max: number, gap: number): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const tries = Math.max(1, Math.round(((maxX - minX) * (maxY - minY)) / per));
  for (let k = 0; k < tries; k++) {
    const size = min + kit.int(max - min + 1);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    kit.add(kit.prop(kind, x, y, kit.rng() * Math.PI * 2, size, size, kit.int(1_000_000)), kit.beyond + gap, 20);
  }
}
