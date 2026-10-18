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
The car starts at `start` in `areas.json`: on the nearest road, in its left-hand
lane, facing along it (downhill or uphill, if `facing` says). It's on College Green,
just up from its crossing, facing down towards the city centre, away from the hill.

## The rules

All in `osm.ts`, `enrich.ts`, `lidar.ts` and `osgb.ts` (pure, tested).

**Projection.** Flat, about the map's north-west corner: metres east and south,
**8 px to the metre** (`PX_PER_METRE`), north up. The car is 4.75 m long.

**Roads and paths** (`highway=*`; tunnels left out). Kind from `highway`; width
from `width`, else `lanes` × 3.3 m, else by kind (primary 10 m, secondary 9,
tertiary 8, streets 7, service 4.5, driveways 3.5, pedestrian streets 5, footways
2.4). One-way and bridges from their tags. **Pavements**, 2.4 m wide, along every
road but service roads and tracks: on both sides unless `sidewalk`,
`sidewalk:both`, `sidewalk:left` or `sidewalk:right` say otherwise (left and right
as the way runs); none on a side where it's `no` or `separate` (mapped as a footpath
of its own), or where a `footway=sidewalk` path runs alongside, within 4 m of the
kerb and roughly parallel, for at least half the road's length (it's that footpath
that's drawn). **Kerbs**: along both edges of every road; also any `barrier=kerb`
way, unless it's `kerb=lowered`, `flush` or `no`. Where a node says the kerb's
dropped (`kerb=lowered`, `flush` or `no`), and across every crossing (half the
road's width plus 3 m from its middle), there's no kerb to mount; anywhere else,
going up a kerb at speed takes 8% off it and coming down 4% (`src/world/kerbs.ts`). Dashed centre lines on
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

**Crossings** (`highway=crossing` nodes on roads): a **zebra** (`crossing=zebra`,
`crossing_ref=zebra`, or zebra `crossing:markings`) gets stripes, zig-zags along
both kerbs (following the road's line round its bends, for 10 m either side,
stopping where the road ends) and a flashing Belisha beacon on the pavement at each end; one with
**lights** (`crossing=traffic_signals`, or a pelican, puffin, toucan or pegasus
`crossing_ref`) gets two lines of studs and zig-zags, and is worked by the
nearest controller; any other (unmarked, a dropped kerb) has nothing painted.

**Traffic lights** (`highway=traffic_signals` nodes, and crossings with lights, on
roads; `signals.ts`). Each way into one (each road meeting it, as the traffic
heads, allowing for one-way streets and `traffic_signals:direction`) gets a stop
line across its own lanes (the left half of a two-way road, the whole of a
one-way one) and a pole on the kerb to its left, as in Britain. Traffic stops at
the point itself for lights on their own (OSM maps them at the stop line), 2.5 m
short of a crossing, and half the widest road plus 2 m short of a junction.
Lights within 40 m of each other are one controller; of several along the same
road one after another, the traffic stops only at the first. A controller's
ways in that line up (or face each other) go green together, as a group; groups
take turns (red and amber 2 s, green 12 s, amber 3 s, red all round 2 s), then,
where there's a crossing, people get 8 s with everything red (`src/world/lights.ts`).

**Levels.** The ground is level 0; every bridge's deck (`bridge=*`: road bridges,
footbridges, jetties) is level 1, above whatever's below it (the water, another
road: Park Street crosses Frog Lane on one). A deck runs straight from the
ground's height at one end to its height at the other, has parapets along both
sides, and you get on or off only within 8 m of an end that meets the ground
(`src/world/decks.ts`); driving under it in the middle you stay below, and it's
drawn over you. Each level has its own walls and posts (buildings stand on both;
garden walls, railings, lamps and the like belong to the deck when they're on
it, and trees to the ground), and its own surface (a deck's is tarmac for a road
bridge, paving for the rest). The ground under a bridge isn't raised to meet it.

**Bridge decks, measured.** A deck's height every 2 m along it is the LIDAR's
first-return surface there (the deck, not what's under it): the median of the
readings across it, a metre in from its edges. Readings more than 2.5 m above, or
1.5 m below, the straight line between the ground 8 m out beyond each end (or the
readings' median, at an end that meets another piece of the bridge) are thrown
out (trees over it, buildings at its ends, vans on it; the water or road below),
and the gaps filled from either side; then it's smoothed over 6 m. If over half
are thrown out, or it's still more than 2.5 m off that line anywhere, it's not
measured, and runs straight from the ground at one end to the ground at the other
(walkways between buildings' upper floors, ramps into car parks). The ground of
the road onto a measured deck is brought up or down to meet it over the last
12 m (and the 4 m under its end), and in the game the deck meets the ground at an
open end, any difference left taken up over the 8 m you get on in.

**Archways** (`tunnel=building_passage`: roads, lanes and footpaths through
buildings). The building's walls are cut open where the road passes through,
as wide as the road (at least 3.4 m, so a car fits), and the building is drawn
see-through while the car is under it.

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
readings round each point), gaps filled from their neighbours, and smoothed twice.
Stored as decimetres above the lowest point. (Bridges aren't in it: they're decks
above it.) What's under a bridge (between 4 m in from each of its ends, and to a
metre beyond its edges) is kept apart from the ground round it: readings, gap
filling and smoothing never mix the two, or the road would dip as it came to the
bridge (Park Street's did, by 2 m). Then the roads onto measured decks are brought
to meet them (above).

## Damage

What's on the map can be knocked down or broken by driving into it, except the
buildings, bridges and big structures (fountains), and what's broken stays
broken, where it fell, in the way, until the game is restarted. The rules are
in `src/world/damage.ts` (pure, tested); `src/scenes/Wreckage.ts` applies them.

Whatever stands (a tree, a lamp post, a traffic light, a Belisha beacon, a
bollard, a post box, a phone box) doesn't just appear fallen: it topples over
from its foot the way it was hit, slowly at first and then faster and faster,
in 0.4 × √(its height in metres) seconds (0.35 to 1.6 s: a bollard's over in
0.4 s, a lamp post takes about 0.9 s and a big tree 1.6 s). What it breaks into
lands, and what it leaves lying gets in the way, only when it hits the ground.

Whether something gives way depends on how fast the car is going *into* it
(its speed towards it, in px/s) times the vehicle's weight (a car is 1; vans
and buses to come), against the thing's strength; breaking through takes some
of the car's speed away (its "absorb"). Below its strength, it's a wall the car
bounces off.

| Thing (from OSM) | Material | Strength | What happens |
| --- | --- | --- | --- |
| Tree | wood | 140 + 12 × height in m (180 to 420) | Splits at the foot and topples the way it was hit (and away from the side it was hit on): a stump, the trunk lying along the ground (solid), the crown at its end; as it lands, leaves flying and clumps of them and broken branches strewn round it (more the bigger the tree); no shadow any more |
| Street lamp, Belisha beacon, traffic light | metal with electrics | 150, 110, 170 | Bends over at the foot and topples the way it was hit, its lamp (or head, or globe) swinging down, and lies there (a heavy pole: shoved, not thrown); goes out (a traffic light's head lies loose), its glass smashed and strewn where its lamp (or lenses) hit the ground, and sparks and fizzes for 5 s |
| Bollard | metal | 210 | Knocked flat, shoved along |
| Post box | iron | 300 | Knocked off its foot, a heavy lump |
| Phone box | glass | 170 | Goes over, its panes smashed and strewn round it |
| Bench | timber, in parts | 150 | Below: shoved. Above: smashed into planks, scattered the way the car was going |
| Garden wall (`barrier=wall`, …) | stone | 200 | Crumbles: a gap 2 m wide (up to 4 m, the harder it's hit) in rubble and bricks; the rest stands |
| Hedge | plant | 80 | Torn through (a 3 m gap, up to 6 m): leaves flying, and clumps of it and twigs strewn the way the car went |
| Fence | timber | 70 | Broken through (2.5 m, up to 5 m) into planks |
| Railings | metal | 130 | Broken through (2.5 m, up to 5 m), bent bars |

**Broken again.** What's been broken breaks up further, hit again, and much
more easily, being loose (nothing holds it to the ground any more) and smaller:
each piece is weaker than what it broke off, down to bits too small to break.
How fast counts as how fast the car's going *into* it, less however fast it's
already going the same way; and a piece can't be broken for half a second after
it's broken off (or one hit would break it right down at once).

| Lying there | Strength | Breaks into |
| --- | --- | --- |
| A fallen tree's trunk (solid) | 0.4 × the tree's, standing (at least 90) | Logs, end to end where it lay (2 to 5) |
| A fallen tree's crown (not solid) | driven through at 90 | Clumps of leaves and branches, strewn the way the car went |
| Log | 85 | Two short logs and splinters |
| Short log | 65 | Splinters |
| Bench (loose) | 150 | Planks |
| Plank | 110 | Splinters |
| Fallen lamp post | 120 | Two short poles |
| Short pole | 100 | Bent bits |
| Traffic light's head | 80 | Glass and a bent bracket |
| Fallen phone box | 120 | Glass and bent frame |

Rubble, bricks, glass, bollards, post boxes, clumps of leaves, twigs and
splinters just get kicked about.

The pieces are loose things like the rest (with their own weights), pushed by
the car and stopping on their own; walls and trunks left standing or lying
are solid. They're all part of the world's walls, posts and loose things, so
they're in the way of traffic and people too, when there are some.

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
