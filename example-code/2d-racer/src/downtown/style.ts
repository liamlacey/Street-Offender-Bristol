/** The props a downtown adds (drawn by CityScenery). */
export type CityPropKind = 'building' | 'parked' | 'fountain' | 'towercrane' | 'digger' | 'bench';

/** Footprint of each, px: w along its length, h front to back. Buildings vary. */
export const CITY_PROP_SIZE: Record<CityPropKind, { w: number; h: number }> = {
  building: { w: 200, h: 200 },
  parked: { w: 40, h: 20 },
  fountain: { w: 64, h: 64 },
  // Just the mast: its jib swings overhead.
  towercrane: { w: 26, h: 26 },
  digger: { w: 56, h: 30 },
  bench: { w: 30, h: 10 },
};

export const CITY_PROPS: ReadonlySet<string> = new Set(Object.keys(CITY_PROP_SIZE));
