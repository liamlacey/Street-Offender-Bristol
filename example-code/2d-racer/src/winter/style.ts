/** The props winter adds (drawn by WinterScenery). */
export type WinterPropKind = 'peak' | 'lake' | 'piste' | 'snowmen' | 'boulders';

/** Footprint of each, px: w along its length, h front to back. Peaks, lakes and pistes vary. */
export const WINTER_PROP_SIZE: Record<WinterPropKind, { w: number; h: number }> = {
  peak: { w: 800, h: 800 },
  lake: { w: 500, h: 300 },
  // Along the road, the run and its chairlift; away from it, the slope up the mountain.
  piste: { w: 230, h: 900 },
  snowmen: { w: 70, h: 50 },
  boulders: { w: 120, h: 120 },
};

export const WINTER_PROPS: ReadonlySet<string> = new Set(Object.keys(WINTER_PROP_SIZE));

/** Where the chairlift runs up the side of a piste, from its right-hand edge (as seen from the road), px. */
export const LIFT_INSET = 34;
