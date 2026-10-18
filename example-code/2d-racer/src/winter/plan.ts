/**
 * Planning winter's big things round a track, before the forest fills in
 * round them: ski runs cut up through the trees from beside the road, each
 * with a chairlift, frozen lakes out in the open, and the mountains beyond.
 * The scenery planner (track/decoration.ts) calls this when a location has
 * winter.
 */

import type { Placer } from '../track/decoration';
import { WINTER_PROP_SIZE } from './style';

export function planWinter(kit: Placer): void {
  pistes(kit);
  lakes(kit);
  peaks(kit);
  boulders(kit);
}

/** Rocks poking up through the snow, in clusters. */
function boulders(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const area = (maxX - minX) * (maxY - minY);
  const tries = Math.round(area / 250_000);
  for (let k = 0; k < tries; k++) {
    const size = 70 + kit.int(110);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    kit.add(kit.prop('boulders', x, y, 0, size, size, kit.int(1_000_000)), kit.beyond + 30, 20);
  }
}

/** Ski runs starting just back from the road (where the skiers finish) and climbing away up the hill. */
function pistes(kit: Placer): void {
  const { w } = WINTER_PROP_SIZE.piste;
  const count = Math.max(1, Math.round((0.45 * kit.track.length) / 10_000));
  for (let placed = 0, tries = 0; placed < count && tries < count * 20; tries++) {
    const i = kit.int(kit.n);
    if (kit.radii[i] < 600) continue;
    const length = 650 + kit.int(500);
    if (kit.facing('piste', i, kit.sides()[0], w, length, 30, kit.int(1000), [0, 40])) placed++;
  }
}

/** Frozen lakes in the open, back from the road. */
function lakes(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const area = (maxX - minX) * (maxY - minY);
  const count = Math.max(1, Math.round(area / 9_000_000));
  for (let placed = 0, tries = 0; placed < count && tries < count * 30; tries++) {
    const w = 320 + kit.int(360);
    const h = 200 + kit.int(200);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    if (kit.add(kit.prop('lake', x, y, kit.rng() * Math.PI, w, h, kit.int(1000)), kit.beyond + 60, 30)) placed++;
  }
}

/** Mountains, out past the trees. */
function peaks(kit: Placer): void {
  const { minX, minY, maxX, maxY } = kit.bounds;
  const area = (maxX - minX) * (maxY - minY);
  const tries = Math.round(area / 200_000);
  for (let k = 0; k < tries; k++) {
    const size = 450 + kit.int(650);
    const x = minX + kit.rng() * (maxX - minX);
    const y = minY + kit.rng() * (maxY - minY);
    kit.add(kit.prop('peak', x, y, 0, size, size, kit.int(1_000_000)), kit.beyond + 380, 40);
  }
}
