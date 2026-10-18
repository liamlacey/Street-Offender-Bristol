/**
 * What a race circuit location has, beyond what every location has (see the
 * Circuit in locations/locations.ts).
 */

export interface CircuitStyle {
  /** Gravel traps in the run-off on the outside of corners, and their colours (null = none). */
  gravel: { base: number; light: number; dark: number } | null;
  /** Roughly how many grandstands per 10,000 px of track. */
  standsPer10k: number;
  /** Pit garages and team trucks behind the grid. */
  pits: boolean;
  /** Advertising boards behind the barriers. */
  boards: boolean;
  /** Spare tyres stacked behind the barriers. */
  tyreStacks: boolean;
  /** Spectators and marshals at corners; what the spectators stand behind. */
  cornerCrowds: 'fence' | 'tape' | null;
  /** What's over the start line: a gantry, a banner, or nothing (just the line painted across). */
  start: 'gantry' | 'arch' | 'line';
  /** Painted lines on the tarmac (its kerbs take the location's kerb colours). */
  road: { centreLine: boolean; edgeLines: boolean };
  /** Spectator banks lining the fences (crowds behind a fence), per 10,000 px of track. */
  banksPer10k: number;
  /**
   * The rest of a race day around the track: the paddock behind the pits,
   * big screens, food stalls, car parks and campsites full of fans.
   */
  venue: boolean;
  /** A TV helicopter following the race, and an advertising blimp drifting over. */
  sky: boolean;
}

/** The props a race circuit adds. */
export type CircuitPropKind =
  | 'grandstand'
  | 'crowd'
  | 'marshal'
  | 'board'
  | 'pits'
  | 'tyres'
  | 'flag'
  | 'carpark'
  | 'stall'
  | 'screen'
  | 'marquee'
  | 'gazebo'
  | 'fans';

/** Footprint of each, px: w along its length, h front to back. */
export const CIRCUIT_PROP_SIZE: Record<CircuitPropKind, { w: number; h: number }> = {
  grandstand: { w: 240, h: 84 },
  crowd: { w: 200, h: 22 },
  marshal: { w: 26, h: 26 },
  board: { w: 120, h: 10 },
  pits: { w: 480, h: 72 },
  tyres: { w: 40, h: 40 },
  flag: { w: 10, h: 10 },
  // A car park's size depends how many cars it has (see CARPARK).
  carpark: { w: 0, h: 0 },
  // The stall at the back, its queue in front.
  stall: { w: 64, h: 76 },
  screen: { w: 100, h: 26 },
  marquee: { w: 96, h: 64 },
  gazebo: { w: 40, h: 40 },
  fans: { w: 36, h: 36 },
};

/** Car parks: bays across the rows (px wide), how deep a row is, and the aisles between. */
export const CARPARK = { bay: 26, row: 46, aisle: 34 };

export const CIRCUIT_PROPS: ReadonlySet<string> = new Set(Object.keys(CIRCUIT_PROP_SIZE));

/** A typical circuit: everything on. */
export const FULL_CIRCUIT: CircuitStyle = {
  gravel: { base: 0xcdb683, light: 0xe2d2a6, dark: 0xa8915f },
  standsPer10k: 4,
  pits: true,
  boards: true,
  tyreStacks: true,
  cornerCrowds: 'fence',
  start: 'gantry',
  road: { centreLine: true, edgeLines: false },
  banksPer10k: 9,
  venue: true,
  sky: true,
};
