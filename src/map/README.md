# How the map is made

This is the record of exactly how the game's Bristol is built, from which data,
by which rules. Growing the map must follow it, so new streets come out the same
as the old. If the method changes, change this file in the same commit.

## Sources (and only these)

| What | Source | Licence | Used for |
| --- | --- | --- | --- |
| Streets, paths, ground, water, buildings, trees, street furniture | [OpenStreetMap](https://www.openstreetmap.org), the API's `map` call (`api.openstreetmap.org/api/0.6/map?bbox=…`), plus `relation/<id>/full` for multipolygons only partly in the area | ODbL: credit "© OpenStreetMap contributors" | Everything that's on the map |
| Heights of roofs and treetops | Environment Agency, **LIDAR Composite First Return DSM, 1 m** (WCS, coverage `…__Lidar_Composite_Elevation_FZ_DSM_1m`) | Open Government Licence v3.0 | Building heights, roof shapes, trees' heights, finding trees |
| Height of the bare ground | Environment Agency, **LIDAR Composite DTM, 1 m** (WCS, coverage `…__Lidar_Composite_Elevation_DTM_1m`) | Open Government Licence v3.0 | Heights above ground (with the DSM), the hills |
| Landmarks' and streets' colours | Written by hand in `landmarks.ts` | Ours | What OSM doesn't say about how places look |

The full URLs are in `tools/build-map.ts`. The game credits both at the bottom of
the screen ("© OpenStreetMap contributors · LIDAR © Environment Agency (OGL)"), and
the README does too: keep both. **Google Maps (2D, satellite or 3D) must not be
used**: its terms forbid taking data from it, even with an API key. Aerial
imagery is only ever looked at, never traced, unless its licence allows (Bing and
Esri imagery may be used for editing OSM itself, in OSM's own editors).

## The data is kept

`npm run map` (`tools/build-map.ts`) builds `bristol.json` from the **areas** in
`map-sources/areas.json`. Each area's downloads are kept, gzipped, in
`map-sources/<area>/` (committed), with the date they were fetched and the newest
OSM edit in them, so rebuilding gives exactly the same map. OSM is edited every
day and the LIDAR composite is updated now and then, so nothing is ever
downloaded again unless asked for (`npm run map -- --refresh <area>`).

Each area's LIDAR alignment (`lidarShift`, metres east and south) is worked out
the first time it's built (see "Lining up" below) and then kept in `areas.json`.
The `cathedral` area's is −0.5 m east, 0 m south.

## Growing the map

1. Add a new area to the end of `map-sources/areas.json`: a `name`, an `about`,
   and its `bounds` (latitude and longitude), touching or overlapping the areas
   there. Keep each area to about a kilometre square: the OSM API won't give
   more than 50,000 nodes at a time.
2. `npm run map`. The new area's OSM data and LIDAR are downloaded and kept, and
   its LIDAR is lined up and the shift recorded.
3. Where areas overlap, the **older** area's data wins (OSM elements and LIDAR
   readings alike), so the streets already in the game don't change.
4. Look at it (zoomed out, and driving round at iPhone size) and check the
   numbers the tool prints. Add any landmarks or street looks to `landmarks.ts`.
5. Commit `map-sources/`, `bristol.json` and any changes together.

The map's origin is the north-west corner of all the areas together, so adding
an area to the north or west moves every coordinate, but nothing on the ground.
The car starts at `start` in `areas.json`, on the nearest road.

## The rules

All in `osm.ts`, `enrich.ts`, `lidar.ts` and `osgb.ts` (pure, tested).

**Projection.** Flat, about the map's north-west corner: metres east and south,
**8 px to the metre** (`PX_PER_METRE`), north up. The car is 4.75 m long.

**Roads and paths** (`highway=*`; tunnels left out). Kind from `highway`; width
from `width`, else `lanes` × 3.3 m, else by kind (primary 10 m, secondary 9,
tertiary 8, streets 7, service 4.5, driveways 3.5, pedestrian streets 5, footways
2.4). One-way, bridges and pavements (2.4 m either side of every road but service
roads and tracks, unless `sidewalk=no`) from their tags. Dashed centre lines on
roads 6 m or wider (not service roads or tracks), stopping 9 m short of each junction, and not on cobbles. The
surface (`surface=*`) is sorted into tarmac, paving, setts (cobbles), concrete,
gravel, decking or grass, and drawn as that and driven on as that.

**The ground** (`natural`, `landuse`, `leisure`, `amenity`, `area:highway`, …,
closed ways and multipolygons): grass, parks, gardens, woods, pitches, play areas,
flowerbeds, squares and plazas, car parks, building sites, water (the harbour:
too deep to drive in), pools and fountains (shallow), piers (decking) and traffic
islands. Everything else is paving: it's a city centre.

**Buildings** (`building=*`, `building:part=*`). Height: OSM's `height`, else
measured by the LIDAR (below), else `building:levels` × 3.2 m (+ roof levels),
else by kind (`BUILDING_HEIGHT`). An outline whose parts cover more than half of
it isn't drawn: its parts are, and they're what you crash into. Colours: a
landmark's from `landmarks.ts` first, then OSM's `building:colour`,
`roof:colour` and `building:material`, then the street's look from
`landmarks.ts`, then one picked for the kind of building (the same every time).
Roof shape: `roof:shape`, else what the LIDAR shows, else pitched for houses and
churches and flat for the rest.

**Lining up the LIDAR.** OSM is in latitude and longitude (WGS84); the LIDAR is
on the Ordnance Survey's National Grid. `osgb.ts` converts (Helmert transform to
OSGB36, then the National Grid's transverse Mercator: good to a few metres), and
`alignLidar` takes out what's left: it tries every shift up to 8 m in half-metre
steps and keeps the one that puts the most building interiors high (over 2.5 m)
and road centre lines low (under 1.5 m).

**Measured by the LIDAR** (height above ground = first-return surface − bare
ground):
- A building's height, unless OSM tags it: the 90th percentile of the readings
  more than 1.5 m inside its walls (or all of them, for one too small for that;
  needs 4 or more; a result under 2.5 m is ignored).
- Its roof shape, unless OSM tags it (and it's under 1,500 m², with 8 or more readings): **flat** if 80% of
  its readings are within 0.6 m; **pitched** if its height falls away from a
  ridge down the middle (along or across the building) by more than 1.5 m with
  the fit's R² over 0.45; otherwise left to its kind.
- Trees: the highest point within 2 m, 4 to 35 m above the ground, whose crown
  (what's at least half as high within 7 m) covers 7 m² or more, is rough
  (leaves are; roofs aren't), and isn't in a building (or a metre round one), the
  water or a carriageway. Within 5 m of an OSM tree, it's that tree, measured;
  otherwise it's a new tree. Trees closer than their crowns are merged.

**The hills.** The bare ground's height every 4 m (the average of the 16 one-metre
readings round each point), gaps filled from their neighbours, smoothed twice,
and each bridge's deck laid straight from one end to the other over what it
spans. Stored as decimetres above the lowest point.

## The files

- `osm.ts`: reads OSM's XML and makes the map (`buildMap`): projection, roads,
  ground, lines, buildings, trees, props, crossings, surfaces. Tested in `osm.test.ts`.
- `landmarks.ts`: landmarks' colours (and heights, roof shapes), and streets' looks.
- `enrich.ts`, `lidar.ts`, `osgb.ts`: the LIDAR and the terrain. Tested in `lidar.test.ts`.
- `bristol.json`: the map the game loads.
- `../../tools/build-map.ts`: downloads, keeps and puts it all together.
- `../../map-sources/`: the kept downloads, and the list of areas.

In the game (`src/world/`): `world.ts` (what you hit, what's loose, an index of
what's where), `ground.ts` and `groundArt.ts` (painting the ground in 512 px
pieces, and the surface grid that says what's underfoot), `GroundLayer.ts`
(painting pieces as they come into view, shading the hills), `terrain.ts`,
`perspective.ts` and `TerrainSheet.ts` (the hills, and the old games'
perspective: higher than the car is nearer the camera, so drawn pushed out from
the middle of the view), `buildingLook.ts` and `Buildings.ts` (the buildings).
The car feels the gradient in `src/car/CarPhysics.ts`.
