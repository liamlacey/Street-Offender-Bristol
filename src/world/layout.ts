/**
 * What's laid out over a region's map, worked out from the map alone: the gardens (homes.ts), what's round the places and on
 * the pitches (places.ts, sports.ts), the building sites (sites.ts), the street life (streetLife.ts), the parks (parkLife.ts)
 * the playgrounds (playgrounds.ts) and the big shops' trolleys (parking.ts). The most of making a region ready: so it's done in a worker (layoutWorker.ts),
 * alongside the game rather than in its frames, and handed over; the region's then made (region.ts) with it taken as worked
 * out (each module keeps what it's been given for the map, as if it had worked it out itself).
 *
 * The same order as making the world (world.ts): the gardens and the places, then their ground put down with the map's own
 * areas (what's laid out after sees it), then the rest. So it comes out the same either way.
 */

import type { GameMap } from '../map/osm';
import { type Homes, homesWork, primeHomes } from './homes';
import { type ParkLife, parkLifeWork, primeParkLife } from './parkLife';
import { type PlaceLife, placesWork, primePlaces } from './places';
import { type TrolleyRow, primeTrolleys, trolleyRows } from './parking';
import { type PlayThing, playgroundsWork, primePlaygrounds } from './playgrounds';
import { type SiteLife, primeSites, siteLifeWork } from './sites';
import { type StreetLife, primeStreetLife, streetLifeWork } from './streetLife';
import { layDown } from './world';
import { drain } from './work.ts';

export interface Layout {
  homes: Homes;
  places: PlaceLife;
  sites: SiteLife;
  street: StreetLife;
  park: ParkLife;
  plays: PlayThing[];
  trolleys: TrolleyRow[][];
}

/** Lays a map out (its ground from the gardens and places put down on it, as making its world would). */
export function layOut(map: GameMap): Layout {
  const homes = drain(homesWork(map));
  const places = drain(placesWork(map));
  layDown(map, homes, places);
  return { homes, places, sites: drain(siteLifeWork(map)), street: drain(streetLifeWork(map)), park: drain(parkLifeWork(map)), plays: drain(playgroundsWork(map)), trolleys: trolleyRows(map) };
}

/** A layout worked out elsewhere (from the same map), taken for this one. */
export function useLayout(map: GameMap, layout: Layout): void {
  primeHomes(map, layout.homes);
  primePlaces(map, layout.places);
  primeSites(map, layout.sites);
  primeStreetLife(map, layout.street);
  primeParkLife(map, layout.park);
  primePlaygrounds(map, layout.plays);
  primeTrolleys(map, layout.trolleys);
}
