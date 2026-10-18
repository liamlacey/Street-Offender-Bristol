import type { TrackDefinition } from './Track';

/**
 * Track layouts. Points are listed in driving order; the start/finish line is
 * at the first point. Adjust a layout here, then run `npm test`: the track
 * tests check every layout for overlapping road and corners too tight to draw.
 */
export const TRACKS: TrackDefinition[] = [
  {
    name: 'Docklands',
    width: 200,
    kerbWidth: 16,
    points: [
      [900, 2600], // start/finish, heading east down the main straight
      [2000, 2600],
      [2900, 2600],
      [3400, 2400], // fast left sweeper
      [3500, 1900],
      [3300, 1450],
      [2800, 1350],
      [2450, 1600], // dip south
      [2100, 1750],
      [1800, 1500],
      [1900, 1000],
      [2400, 800],
      [2850, 700],
      [3050, 450], // hairpin
      [2850, 200],
      [1700, 300],
      [1000, 450], // long back straight
      [600, 800],
      [500, 1400],
      [750, 1800], // chicane
      [500, 2200],
      [550, 2550],
    ],
  },
];
