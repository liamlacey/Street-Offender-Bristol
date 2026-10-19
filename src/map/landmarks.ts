/**
 * What OpenStreetMap doesn't say about how central Bristol looks: the
 * colours of its landmarks (and of their parts, where they're mapped in
 * pieces), and the look of whole streets. Colours from OSM's own tags win
 * over a street's look, but not over a landmark's here.
 */

export interface Look {
  wall?: string;
  roof?: string;
  roofShape?: string;
  /** Height in metres, where neither OSM nor the LIDAR has a good one. */
  height?: number;
}

/** By OSM element (`way/…` or `relation/…`). */
export const LANDMARKS: Record<string, Look> = {
  // Weathered limestone, and grey lead roofs.
  'way/48937931': { wall: '#b3a68a', roof: '#6d7577', height: 24 }, // Bristol Cathedral (its nave and choir; the towers are its parts)
  'way/94482854': { wall: '#a99c80', roof: '#6d7577' }, // Lord Mayor's Chapel
  'way/1465369352': { wall: '#a99c80', roof: '#6d7577' }, // St John the Baptist, on the old city wall
  'way/123976000': { wall: '#d3c29a', roof: '#6b6f73' }, // St Mary on the Quay: Bath stone
  'way/4309554': { wall: '#9b5440', roof: '#5f6b66' }, // City Hall: red brick
  'relation/2623669': { wall: '#cdd3d8', roof: '#cdd3d8', roofShape: 'dome' }, // the planetarium's mirrored ball
  'way/376275103': { wall: '#cdbf98', roof: '#6b6f73' }, // the Corn Exchange: Bath stone
  'way/123975995': { wall: '#cbbd9c' }, // the Commercial Rooms
  'way/127045365': { wall: '#c9b48c' }, // Lloyds' buildings on Canon's Marsh
};

/** Streets with a look of their own: walls and roofs to pick from. */
export const STREETS: Record<string, { walls: string[]; roofs: string[] }> = {
  // Georgian red brick, with slate roofs.
  'Queen Square': { walls: ['#8d4a36', '#9a5540', '#844232'], roofs: ['#55595f', '#5d6168'] },
  // Georgian terraces, rendered and painted in pale colours.
  'Park Street': { walls: ['#e3dccb', '#d8cdb3', '#e6e1d6', '#cfc3a6', '#dcd2bd', '#c9d1cc'], roofs: ['#55595f', '#5d6168', '#62666b'] },
  'Great George Street': { walls: ['#d6c9a6', '#dcd2bd', '#cfc3a6'], roofs: ['#55595f', '#5d6168'] },
  'Berkeley Square': { walls: ['#e3dccb', '#d8cdb3', '#dcd2bd'], roofs: ['#55595f', '#5d6168'] },
  // Victorian banks and offices in pale stone.
  'Corn Street': { walls: ['#cdbf98', '#c4b48e', '#d4c8a8'], roofs: ['#6b6f73', '#5d6168'] },
  'Broad Street': { walls: ['#cdbf98', '#c4b48e', '#d4c8a8'], roofs: ['#6b6f73', '#5d6168'] },
  // Old warehouses and timber-framed inns.
  'King Street': { walls: ['#8d4a36', '#e6e1d6', '#7a4434', '#d8cdb3'], roofs: ['#55595f', '#5d6168'] },
};

/**
 * What's different on the ground from what OSM has (yet), from the owner's own
 * knowledge of the streets (never from Google Maps): tags put on an OSM
 * element (`way/…`) over its own; and for a street made pedestrian, bollards
 * across it where the roads meet it (`bollards`), and the pubs' and bars'
 * tables out along both sides in front of them, a way clear down the middle
 * (`seating`).
 */
export interface Correction {
  tags: Record<string, string>;
  bollards?: boolean;
  seating?: boolean;
}

export const CORRECTIONS: Record<string, Correction> = {
  // King Street: pedestrianised (OSM still has it as a one-way street), its whole width (the old carriageway and pavements) paved; the streets across it are open.
  'way/191322143': { tags: { highway: 'pedestrian', oneway: 'no', width: '11' }, bollards: true, seating: true },
};
