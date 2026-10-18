import { type Pose, type Track, poseAt } from '../track/Track';

/** Distance behind the start line of the front row. */
const FRONT_ROW = 110;
const ROW_GAP = 90;
/** Sideways distance of each column from the centre line. */
const COLUMN_OFFSET = 50;

/**
 * Starting positions, two abreast in staggered rows behind the start line.
 * Slot 0 is pole position (front left).
 */
export function gridSlots(track: Track, count: number): Pose[] {
  return Array.from({ length: count }, (_, slot) => {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? -1 : 1;
    // The right-hand column sits half a row back, like a real staggered grid.
    const along = -(FRONT_ROW + row * ROW_GAP + (side > 0 ? ROW_GAP / 2 : 0));
    const p = poseAt(track, along);
    const nx = -Math.sin(p.heading);
    const ny = Math.cos(p.heading);
    return { x: p.x + nx * COLUMN_OFFSET * side, y: p.y + ny * COLUMN_OFFSET * side, heading: p.heading };
  });
}
