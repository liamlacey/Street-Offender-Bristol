# The map

Bristol comes from [OpenStreetMap](https://www.openstreetmap.org) (© OpenStreetMap
contributors, ODbL: the game must keep crediting them, as it does at the bottom of
the screen). Google Maps' data can't be used: its terms don't allow it.

- `tools/build-map.ts` (`npm run map`) downloads the area from the OSM API into
  `.osm-cache/` (not committed), plus any multipolygons only partly in it, and
  writes `bristol.json`. The area (`BOUNDS`) and where the car starts (`START`) are
  set at its top: to grow the map, widen `BOUNDS` and run it again.
- `osm.ts` does the work (pure, tested in `osm.test.ts`): reads the XML; projects
  it flat, 8 px to the metre, north up; and sorts out the roads (kind, width from
  lanes or tags, one-way, bridges, pavements, where the lane markings stop short of
  junctions), the ground (grass, parks, flowerbeds, squares, car parks, water,
  pools, piers, traffic islands), walls, fences, hedges, quays and railway lines,
  the buildings (outlines and their 3D parts, heights from `height` or
  `building:levels`, colours and roof shapes where tagged; where an outline has
  parts, the parts are drawn and are what you hit), trees, street furniture and
  crossings. `KNOWN_HEIGHTS` fills in heights OSM doesn't have.
- `bristol.json` is the result, which the game loads.

The game's side of it is in `src/world/`: `world.ts` (what you hit, what's loose,
an index of what's where), `ground.ts` and `groundArt.ts` (painting the ground in
512 px pieces, and the surface grid that says what's underfoot), `GroundLayer.ts`
(painting pieces as they come into view), `buildingLook.ts` and `Buildings.ts`
(the buildings, leaning out from the middle of the view the old top-down way).
