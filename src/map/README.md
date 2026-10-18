# The map

Bristol comes from [OpenStreetMap](https://www.openstreetmap.org) (© OpenStreetMap
contributors, ODbL), made truer to life with the Environment Agency's LIDAR survey
(Open Government Licence). The game must keep crediting both, as it does at the
bottom of the screen. Google Maps' data can't be used: its terms don't allow it.

- `tools/build-map.ts` (`npm run map`) downloads the area from the OSM API into
  `.osm-cache/` (not committed), plus any multipolygons only partly in it, and the
  LIDAR's 1 m first-return surface and bare-ground heights from the Environment
  Agency's WCS service, and writes `bristol.json`. The area (`BOUNDS`) and where the car starts (`START`) are
  set at its top: to grow the map, widen `BOUNDS` and run it again.
- `osm.ts` does the work (pure, tested in `osm.test.ts`): reads the XML; projects
  it flat, 8 px to the metre, north up; and sorts out the roads (kind, width from
  lanes or tags, one-way, bridges, pavements, where the lane markings stop short of
  junctions), the ground (grass, parks, flowerbeds, squares, car parks, water,
  pools, piers, traffic islands), walls, fences, hedges, quays and railway lines,
  the buildings (outlines and their 3D parts, heights from `height` or
  `building:levels`, colours and roof shapes where tagged; where an outline has
  parts, the parts are drawn and are what you hit), trees, street furniture and
  crossings; and what roads, paths and squares are surfaced with (tarmac, paving,
  cobbles, concrete, gravel, decking), which is drawn and changes the grip.
- `landmarks.ts`: colours (and a height or roof shape) for landmarks OSM doesn't
  colour (the Cathedral and its parts, City Hall, the planetarium's ball…), and
  the look of whole streets (Queen Square's red brick, Park Street's painted
  terraces…). Add to it to make places look more like themselves.
- `enrich.ts`, `lidar.ts` and `osgb.ts`: the LIDAR. Lines it up with the
  buildings (shifting it up to 8 m), then measures each building whose height OSM
  doesn't tag (the top of most of its roof), decides whether its roof is pitched
  (it falls away from a ridge, along or across the building) or flat, measures
  OSM's trees, and finds the trees OSM hasn't got (rough-topped blobs 4 m or more
  high, away from buildings, water and roads).
- `bristol.json` is the result, which the game loads.

The game's side of it is in `src/world/`: `world.ts` (what you hit, what's loose,
an index of what's where), `ground.ts` and `groundArt.ts` (painting the ground in
512 px pieces, and the surface grid that says what's underfoot), `GroundLayer.ts`
(painting pieces as they come into view), `buildingLook.ts` and `Buildings.ts`
(the buildings, leaning out from the middle of the view the old top-down way).
