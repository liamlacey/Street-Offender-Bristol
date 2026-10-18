/** The props the desert adds (drawn by DesertScenery). */
export type DesertPropKind = 'mesa' | 'dune' | 'playa' | 'town' | 'campsite' | 'wreck' | 'outcrop' | 'cactus' | 'windpump';

/** Footprint of each, px: w along its length, h front to back. Mesas, dunes, playas, outcrops and cacti vary. */
export const DESERT_PROP_SIZE: Record<DesertPropKind, { w: number; h: number }> = {
  mesa: { w: 700, h: 700 },
  dune: { w: 500, h: 300 },
  playa: { w: 900, h: 500 },
  // Along the road, its main street; away from it, the buildings either side and the yards behind.
  town: { w: 620, h: 300 },
  campsite: { w: 230, h: 150 },
  wreck: { w: 90, h: 60 },
  outcrop: { w: 140, h: 140 },
  cactus: { w: 50, h: 50 },
  windpump: { w: 70, h: 70 },
};

export const DESERT_PROPS: ReadonlySet<string> = new Set(Object.keys(DESERT_PROP_SIZE));

/** The way the wind blows (the dunes' horns, the tumbleweeds and the windpumps' vanes all follow it), radians. */
export const WIND = 0.4;

/** Cactus kinds by variant: Joshua trees, saguaros, barrel cacti, prickly pears and sagebrush (the commonest). */
export const CACTI = ['joshua', 'joshua', 'joshua', 'saguaro', 'saguaro', 'barrelcactus', 'pricklypear', 'pricklypear', 'sage', 'sage', 'sage', 'sage'] as const;
