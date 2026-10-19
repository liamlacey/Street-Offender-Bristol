# How the map is made

This is the record of exactly how the game's Bristol is built, from which data,
by which rules. Growing the map must follow it, so new streets come out the same
as the old. If the method changes, change this file in the same commit.

## Sources (and only these)

| What | Source | Licence | Used for |
| --- | --- | --- | --- |
| Streets, paths, ground, water, buildings, trees, street furniture | [OpenStreetMap](https://www.openstreetmap.org), the API's `map` call (`api.openstreetmap.org/api/0.6/map?bbox=…`), plus `relation/<id>/full` for multipolygons only partly in the area | ODbL: credit "© OpenStreetMap contributors" | Everything that's on the map |
| Heights of roofs and treetops | Environment Agency, **LIDAR Composite First Return DSM, 1 m** (WCS, coverage `…__Lidar_Composite_Elevation_FZ_DSM_1m`) | Open Government Licence v3.0 | Building heights, roof shapes, trees' heights, finding trees, walls' and hedges' heights, finding bus shelters |
| Height of the bare ground | Environment Agency, **LIDAR Composite DTM, 1 m** (WCS, coverage `…__Lidar_Composite_Elevation_DTM_1m`) | Open Government Licence v3.0 | Heights above ground (with the DSM), the hills, retaining walls' heights, counting steps, steep banks |
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

**Roads and paths** (`highway=*`; tunnels left out; one being built or mended,
`highway=construction`, as what it'll be, `construction=*`: Pero's Bridge is shut
for repairs in OSM, and is a footbridge here). Kind from `highway`; width
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

**Road markings** (`osm.ts` reads them, `src/world/paint.ts` paints them). As in
Britain, the traffic on a two-way road keeps to the left half (as the way runs:
the left side's traffic goes the way's way, the right side's against it).
- **Bus lanes** (`lanes:psv`, `lanes:bus`, and their `:forward`/`:backward`): red,
  at the kerb on their traffic's side (one-way: the left), a lane wide (3.2 m at
  most), a thick white line along them, BUS LANE at the start; a single bus lane on a
  two-way road that doesn't say which way isn't drawn. Bikes painted in them where
  they share them (`cycleway*=share_busway`).
- **Cycle lanes** (`cycleway`, `cycleway:left/right/both` `=lane`): 1.5 m at the
  kerb, a dashed line (`:lane=advisory`) or solid one (`exclusive`), a bike every
  40 m; `shared_lane` (and `:lane=pictogram`) gets just the bikes, in the traffic's
  lane near the kerb.
- **Parking bays** (`parking:lane:*=parallel/perpendicular/diagonal`, or
  `parking:*=lane` with `:orientation`; not `street_side`, `on_kerb` or `shoulder`):
  along the kerb, 8 m in from the road's ends; parallel bays 2 m deep with a line
  every 6 m, end-on ones 5 m deep a line every 2.5 m; LOADING ONLY where
  `parking:*:restriction=loading_only`.
- Bus lanes, cycle lanes and parking bays are painted only along stretches clear of
  junctions (6 m either side of a node where three or more ways out of it meet: not
  where a street's just mapped in pieces), crossings with stripes or lights (3 m
  either side), and bends sharper than 40° (3 m either side); they end at a traffic
  light's stop line; stretches left under 10 m aren't painted. A lane's name is
  painted 6 m into its first stretch, unless it carries on from the same lane on the
  road before.
- **Lane arrows** (`turn:lanes`, `:forward`, `:backward`): in the middle of each lane
  (between the lane lines), left to right as the driver sees them, a stem with a
  branch curving off for each turn, 15 m before the way's end (and 35 m, if it's over 60 m
  long; its middle, if it's under 30 m).
- **Speed humps** (`traffic_calming=table`, `bump`/`hump`, `cushion`, on roads):
  a raised table 6 m long across the road in red block paving, a round-topped hump
  3.7 m long, or a cushion 1.9 m wide and 3 m long in the middle of each lane; white
  triangles up each ramp. Going over one fast jolts the car, takes speed off (above
  90 px/s for a table, 60 a hump, 70 a cushion: a 1,200th of the speed over that, up
  to 18%, 32% and 25%) and gives it a little hop; between cushions there's nothing
  (`src/world/humps.ts`).
- **Car parks** (`amenity=parking`): bays 2.5 m wide and 5 m deep along both sides
  of each aisle mapped through one (`service=parking_aisle`); where none's mapped,
  double rows of them with 6 m aisles between, lined up with its longest side. Only
  bays wholly inside its outline, and none out on a road through it.
- **Lane lines**: the centre line of a two-way road, and a dashed line between each
  lane each way where `lanes`, `lanes:forward` or `lanes:backward` say there's more
  than one (a one-way road wide enough for two and untagged gets one line); none
  inside a bus lane.
- **Give way** (`highway=give_way`): two dashed lines across the lanes coming in
  (the way `direction` says, or towards the nearer junction), and a triangle in the
  middle of each lane coming in, 9 m back along the road from them (following its
  bends, onto the piece of road before if it's mapped in pieces; as near as 5 m
  where there's no more room), long and thin, as wide as fits in the lane; on the
  same kind of way as the lines (a road's, or a cycle path's); **stop** (`highway=stop`): a solid line and STOP; a **mini-roundabout**
  (`highway=mini_roundabout`): a white circle 4 m across.
- **Cycle boxes** (`cycleway=asl`): terracotta red (as Bristol's are), 4.5 m deep,
  behind a line across the lanes coming in, a big white bike filling them (side on, as the driver sees it: wheels across the lane).
- **Bus stops** (`public_transport=stop_position`): a rectangular bay 3 m deep along
  the kerb, on the side of the stop's sign or platform within 30 m (or the left,
  one-way), surfaced red with a dashed yellow edge, BUS STOP in big yellow letters.
  Only where the road allows: 22 m long, or 18, 15 or 12, whichever's the longest
  stretch round the stop where the road keeps within half a metre of a straight line,
  has no junction, and is wide enough on that side. Where the road won't take a bay
  (a bend, a junction, too narrow), the box is just a yellow outline, 12 m long,
  lined up with the road at the stop and open on the kerb's side, BUS STOP in it.
  Two stops mapped for one make one box, and no BUS LANE is painted over one.
- **Tactile paving** (`tactile_paving=yes/partial`, on a crossing or a kerb within
  4 m of one): a 2.4 × 1.2 m slab of blister paving at each kerb, red at a crossing
  with lights, buff at the rest.

Words are painted long (stretched 2.5 times along the way), read as you come up to
them, the first word nearest.

All the markings (lines, words, arrows, bikes, the red and the tactile paving) are
worn: painted on a layer of their own, then a little of it taken away all over
(16%), more in soft patches and scuffs, and pitted with tiny bare spots, from a 12 m
tile of wear pinned to the map (so it runs on from one piece of ground to the next,
the same every time), before it's laid on the road (`src/world/ground.ts`).

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
churches and flat for the rest. What a roof's made of (`roof:material`) gives its
colour where `roof:colour` doesn't (metal, zinc, copper, lead, tiles, slate, felt,
glass, concrete, gravel, grass, thatch, stone: `ROOF_MATERIALS` in `osm.ts`), and
its texture: seams down the slopes of a metal roof, courses of tiles or slates
along them, glazing bars both ways on glass (`src/world/buildingLook.ts`). A
chimney (`man_made=chimney`) is brick with a sooty top, a ship's funnel
(`man_made=funnel`) buff with a black top, where their colours aren't tagged.
Solar panels on roofs (`generator:source=solar`, `location=roof`): a dark blue
array on the roof of the building they're on, as big as their panels
(`generator:solar:modules`, 1.7 m² each; 12 if not said), along its long side.

**Trees' species** (`genus`, `taxon`, `species`, their English names, or
`leaf_type=needleleaved`): London planes, sweet gums, limes, maples, oaks,
hawthorns, birches, cherries and conifers each have their own crown (colours, how
lumpy, any touch of other colour: a plane's pale patches, a sweet gum's dark red,
haws); the rest are one of four greens.

**The harbour.** Cranes (`man_made=crane`): a cab on the quay, solid and never
knocked down, and a lattice jib up at the crane's height (`height`, or 15 m)
reaching out 1.25 times that over the biggest water within 60 m. Ladders
(`man_made=ladder`): drawn from the quay's edge down into the nearest water. Moving
bridges (`bridge=movable`: Prince Street Bridge, Pero's Bridge) are bridges like the
rest: they don't open. Pontoons (`man_made=pier` with `floating=yes`): floating jetties,
in grey composite decking, a black rubber fender round the edge, a mooring cleat
every 6 m along it, and their shadow on the water; driven on like the piers.
Quays boats moor at (`man_made=quay` with `mooring`, not `no`): an iron mooring
bollard every 10 m along the edge, 0.8 m in from the water (where the water's within
5 m), solid, and only a big hit knocks one over. Slipways (`leisure=slipway`): a
grooved concrete ramp 4 m wide down into the water (a point: from 5 m up the bank to
7 m out; a line: along it, 4 m on into the water; an outline: that), its lower end
under the water, driven on (and off its end, into the harbour).

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
A road bridge's pavements (worked out as for any road's: see Pavements) are decks of
their own alongside it, 2.4 m wide and as high as it, paved; the parapets stand
along their outsides (not between the road and its pavement).

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

**Bus shelters**: a bus stop (`highway=bus_stop` or `public_transport=platform`
node) with `shelter=yes` gets a shelter, 4 m long along the nearest road (within
20 m), set 1 m back from the stop away from the road; then moved onto what the
LIDAR sees there (below). Glass, so it can be smashed. **Kiosks** (`shop=kiosk`
or `amenity=kiosk` points not on a building) are made buildings 2.5 m square and
2.6 m tall.

**Steps** (`highway=steps`): each step's edge is drawn across the flight, spread
evenly along it (never closer than 0.3 m), when it's known how many there are:
`step_count`, or counted from the LIDAR (below). Unknown, a pattern as if a step
every 0.6 m. Driven down (or up), each step's a small jolt: above 50 px/s, the
speed lost grows with the speed, up to 5% a step.

**Petrol stations** (`amenity=fuel`), however they're mapped:
- a forecourt (an outline): its tarmac (driven on like a road); any canopy
  (`building=roof`) standing on it is the station's;
- a canopy tagged as the station itself: that's its canopy;
- the station as a point, or its shop building tagged as it: the nearest canopy
  within 40 m is its canopy.

The station's canopy is white with a red fascia round its edge (no brand's colours or
logo). A canopy with no forecourt mapped gets one: tarmac 5 m out all round it. OSM
doesn't map the pumps, so they're made: under the canopy, a raised island every 6 m
along its long side, square to it, 4 m long and 1.2 m wide, with a pump at each end;
dashed lanes painted between the islands. A forecourt with no canopy mapped (over
300 m²) gets its islands in its middle, along its longest side, over half its
length. A station mapped only as a point with no canopy near is left as it is.

**Arcades and colonnades** (`covered=arcade` or `colonnade` on a path): the walk
under a building's front, open along its side. The building's walls are taken out
wherever they're within 2 m of the path's edge (along it, not just where it crosses
them), and the building's drawn see-through while the car's under it.

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
- Garden walls, hedges and fences, unless tagged with a `height` (0.2 to 8 m): the
  median, along each (a reading every metre), of the highest reading on it and
  0.7 m either side; needs 3 or more, and kept only if it's believable (walls 0.5
  to 4 m, hedges 0.6 to 5 m, fences 0.8 to 3 m), the usual for its kind otherwise.
  A retaining wall (`barrier=retaining_wall`) is as high as the bare ground drops
  across it (1.5 m either side). Fences are often too thin for the survey to see.
- Bus shelters: the cluster of readings 2 to 3.8 m up (3 to 24 square metres,
  not in a building, the water or a carriageway) nearest the stop, within 8 m:
  the shelter's moved to its middle, turned along it if it's longer one way, and
  made as tall as its 90th percentile (2.2 to 3.5 m). None found, it stays put.
- Steps with no `step_count`: how far the bare ground rises from one end to the
  other (the median of the 9 readings round each end), a step every 0.17 m (at
  least 2); flights rising less than 0.3 m are left uncounted.
- Steep banks (embankments, cuttings): every 2 m, where the bare ground falls
  0.45 m a metre or more across 3 m (both the slope and the drop downhill), with
  3 of the 8 points round it falling the same way (within 45°); not within 2 m
  of a building (3 m in all), the water, a carriageway, a wall or the quay. Drawn
  as hachures, short strokes down the slope; you can drive over them.

**The hills.** The bare ground's height every 4 m (the average of the 16 one-metre
readings round each point), gaps filled from their neighbours, and smoothed twice.
Stored as decimetres above the lowest point. (Bridges aren't in it: they're decks
above it.) What's under a bridge (between 4 m in from each of its ends, and to a
metre beyond its edges) is kept apart from the ground round it: readings, gap
filling and smoothing never mix the two, or the road would dip as it came to the
bridge (Park Street's did, by 2 m). Then the roads onto measured decks are brought
to meet them (above).

## Traffic

**How busy each road is** (`activity`, worked out when the map's built): the places
people go to within 30 m of it (beyond its kerb), per 100 m of road (a road shorter
than 50 m counted as 50 m): shops (`shop=*`, not vacant), cafés, restaurants, pubs,
bars, takeaways, banks, chemists, cinemas, theatres, surgeries, colleges and the like
(`amenity=*`, listed in `BUSY_AMENITIES` in `osm.ts`), offices (`office=*`), workshops
(`craft=*`), hotels and museums (`tourism=*`), gyms; as points or outlines (their
middle). Park Street, with 30 to 47, is the busiest.

**The roads it drives on** (`src/world/traffic.ts`): trunk to residential streets, not
service roads (car parks, driveways, yards), tracks or paths. Each road is cut where
it meets another into edges, each with its lanes (`lanes:forward/backward`, or one each
way; a one-way road 7.5 m or wider, two), on the left of the way they go, inside any
bus, cycle or parking lane painted along that side. Lanes stop short of a junction
(where three or more edges meet) by half the widest road there plus 1.2 m; a smooth
curve takes each lane on to the next across it. Where two roads leave a junction at a
sharp angle (under 80°), their carriageways overlap for a way out from it, so the lanes
stop beyond that too (half their widths together ÷ the tangent of the angle, at most
25 m). One-way streets are only driven one way.

**Driving, by the law:**
- Speed: the road's (trunk 13.4 m/s, primary 12.5, secondary 12, tertiary 11.5,
  streets 10.5: up to 30 mph on the main roads, and never over 30 mph), slower along a busy street (0.5% per point of
  activity, at most 15%) or where its lanes are under 2.9 m wide (12%). Each driver
  has their own pace (0.8 to 1.2 of it, most near the middle; one in ten 12% quicker
  still), vans 7% and lorries 15% slower; and no one holds a steady speed: it swells
  and eases (6% over 6 to 14 s, 3.5% over 2.5 to 5 s). Now and then (0.3% a second,
  plus 0.15% per point of activity) a driver dawdles 2 to 5 s at 55 to 80% (looking
  for a shop, or somewhere to park). Up a hill it slows (by the grade times 0.5 to
  0.8 for a car, 1.3 for a van, 3 for a lorry; never below 45%) and pulls away less
  briskly; down one it's up to 5% quicker. Slower round bends and turns: no more sideways pull than
  3 m/s², the sharpness measured every 2 m over 8 m either side along a lane (so a
  kink in the road's line is the gentle bend it is) and 1.5 to 4 m on a turn; it
  slows in time, braking at 3.4 m/s², and is slowest at the sharpest part.
- Driven like people drive in town: pulling away briskly (up to 3.4 m/s², less as
  it gets up to speed; some drivers keener than others, 0.8 to 1.3 times), braking
  late and firmly (3.4 m/s² times that, as it plans to; up to 9 when it must), quick
  on and off the pedals but never all at once (6 and 12 m/s³), closing 2.2 of the
  difference to the speed it wants a second, and rolling the last bit up to a stop
  (no faster than 1.3 m/s per metre left). It takes 0.25 to 0.75 s to move off when
  it can, so a queue at the lights moves off one after another.
- Keeps 2 m plus 1.3 s behind whatever's in its way ahead (another vehicle, a parked
  car knocked out into the road, you), looking ahead 14 m plus 3 s of travel (at
  most 70 m). Never drives into you on purpose; held up by you for 2.5 s, it honks.
- Stops at the stop line on red, and red and amber; on amber, if it can stop
  comfortably. A knocked-down light is ignored.
- Gives way at the end of a road onto a more major one (trunk > primary > secondary >
  tertiary > street), or where a give way line's painted (`highway=give_way`):
  waits until nothing coming (looking up to 70 m) will reach the junction within
  3.2 s, and nothing's in it.
- Two turning into the same lane from different ways: within 25 m of it, the one
  further off lets the other in first (if the nearer one's on its way in, not waiting
  at a line).
- Not into a junction (where three or more roads meet) with no room on the far side:
  it waits at the end of its lane until there's room for it beyond (nothing stopped,
  or nearly, within its length and 3 m of the lane's start, or in the turn).
- Waiting to pull out, it takes a smaller gap the longer it's waited (the 3.2 s down
  to 1.4 s over 30 s), and traffic crawling under 2 m/s lets it out.
- Oncoming, two squeeze past each other (needing only 80% of their widths between
  them); on a narrow two-way street they keep over to the kerb (no nearer it than
  1.1 m). Nose to nose in a knot, the one with less right of way backs off (1.2 m/s
  for 3 s, if there's room behind it; if not, after 10 s it edges past). Oncoming
  along another road (two one-way roads drawn close where they join) isn't in the way.
- Lane changes, where a road has two or more lanes each way: into the lane for the
  turn ahead (the kerb lane to turn left, the one nearest the middle to turn right),
  between 150 m and 10 m before it; and out from behind something slow (going under
  60% of its speed) or stopped in the road into the lane beside, if that's moving
  better (nothing within the gap it has now plus 8 m), not within 25 m of a junction.
  Only into a gap: nothing alongside, nor closing from behind within 2 m plus 2 s of
  the difference in speed, nor just ahead. It moves over at 2 m/s, indicating, turning
  a little the way it's going, and not again for 3 to 6 s.
- Overtaking, on a two-way road with a lane each way: past something stuck in the
  road (a bus at a stop, a broken-down or knocked car, one stood still for no reason
  for 2 s), within 18 m of it, out into the other lane when nothing's coming that'd
  reach it before it's past (and 25 m clear of the junction ahead); back in once past
  and clear alongside. Something coming before it's alongside: it pulls back in.
- Queueing anyway (under 3 m/s, or close behind a car going under 2 m/s), seven drivers
  in ten stop short of a side road where someone's been waiting more than 4 s to pull
  out, and let them out.
- Badly damaged (any side's taken more than 75, see Damage), it limps along at 55% of
  its speed with its hazards on, smoking if it's the front; wrecked (more than 150),
  it's broken down where it is, smoking, hazards flashing, and others go round it.
  Your car smokes too, its front wrecked. A parked car knocked hard enough (15) sets its
  alarm off for 12 s: beeping, its hazards flashing.
- A road off the map's edge: driven on to its end, and gone.
- Standing still 25 s, not for a red light or behind you (anywhere along the queue it's
  in): a knot; out of sight, it's taken off the road.
- What's on a bridge isn't in the way of what's under it, and the other way round:
  each point it looks at ahead is on the level of the road there.
- At each junction it turns onto another road (never back the way it came unless the
  road ends), mostly the more major roads, mostly straight on; left from the kerb lane,
  right from the lane nearest the middle; indicating 30 m before.
- Two waiting for each other: the one already in the junction goes, then the one on
  the more major road. Still knotted after 6 s (each waiting on the next, round in a
  loop: not just a queue), one edges past.

**What drives:** small cars, hatchbacks, saloons, estates, SUVs, vans (18, 26, 14, 8,
15, 14%) and, on secondary roads and bigger, lorries (5%); in the colours of Britain's
cars (grey, black, white, blue, silver, red the most), vans mostly white. Each lane
carries trunk 3.6, primary 3.2, secondary 2.6, tertiary 2.1, streets 1 vehicles per
100 m, times 1 + activity ÷ 15 (at most 3 times). Up to 55 at once, within the view
plus 30 m; new ones out of sight (at least 7 m from any other, no faster than it can
follow the one ahead at), and they go 40 m beyond that.

**Buses** run the real bus routes (OSM's `route=bus` relations, as the `map` call
returns them: every route with a way in the area). When the map's built, each route's
ways become legs, in order: the map's road, and which way along it (towards the next
way, or on from the one before); a gap where the route leaves the map's driveable
roads (off the map, or along a way only buses use). Old-style routes mapped both ways
in one relation (ways marked `forward` and `backward`) are left out: they can't be
followed in order. Its stops are its `stop` members (where buses stop, on the road),
or failing those its `platform` members (where people wait). Its number (`ref`) and
colour (`colour`) are kept.
- In the game a bus follows its route at each junction: onto the next road on it if
  it's there (a road often runs on past where a route turns off it), or on along the
  same road; where the route's broken, it looks up to four legs ahead. Off its route
  for good (off the map), it drives on like anyone, and goes once out of sight.
- At each stop on its way (within half the road's width and 7 m of its lane) it pulls
  in, its front 4 m past the stop, and waits 5 to 12 s; it indicates left pulling in
  and right pulling out.
- It drives in the bus lane where there is one (over by 85% of its width; other
  traffic passes it), and pulls 0.7 m in to the kerb at a stop. It moves back out
  only when there's nothing alongside, easing off to let it by.
- About one bus for every 250 m of route round you (counting a road once however many
  routes share it: the square root of the length, times two), at most 8. Single-deckers
  (12 m) and double-deckers (10.6 m), 45% and 55%; in the route's colour (blue if it
  hasn't one), its number on its roof. A bus is 9 to 11 times your car's weight, and
  three times as sturdy.

**Parked cars:** in the car parks' bays (65% of them taken) and in the parking lanes'
bays (55%, plus 1.2% per point of the street's activity, at most 92%; loading bays
25%), not at bus stops (the bays aren't painted there either). Parallel bays face the
way the traffic on that side goes; end-on ones either way round. No lorries.

**Knocked about:** your car hits a vehicle as the heavier or lighter thing it is (a
small car 0.8 of yours, a van 1.5, a lorry 4): it slides to a stop (skidding sideways
more than rolling), bumping into the walls, posts and other vehicles (and knocking
them about too), waits 1.6 s, then drives gently back into its lane (reversing first if
it's pointing the wrong way) and carries on. A parked car stays where it ends up.

## People

**Where they go** (worked out when the map's built: `venues`): the businesses counted for
the traffic (shops, cafés, bars and the like: each one's node, or its outline's middle),
and the sights (`tourism=attraction/museum/gallery/viewpoint/artwork/aquarium/zoo/
theme_park`, `historic=monument/memorial/ship/castle/ruins/archaeological_site/building/
church`, `amenity=theatre/arts_centre/fountain`).

**In the game** (`src/world/people.ts`), on the ground and on the bridges: everywhere
but the water and the buildings.

- **Levels**: as for the cars, a bridge's deck is level 1. A walk along a bridge (a
  footbridge, a road bridge's pavement) is on level 1, cut only by the carriageways on
  that level; one under it (Frogmore Street's pavements) on the ground. Anyone on foot
  steps up onto a deck only where it's level with the ground they're on (within 0.6 m:
  at its ends, not from under it), and down off it once they're off it; a deck's
  parapets keep them on it. Only what's on their level hits them, scares them, or is
  stepped round.

- **Where they walk**: the footways, steps, cycleways and pedestrian streets, and the
  pavements along the roads that have them (down the middle of each, 1.2 m in from the
  kerb), each cut wherever it runs onto a carriageway (within 0.1 m of its edge): people
  keep off the roads. At the end of one, on along another that starts within 6 m (if the
  way there keeps off the roads), or back.
- **How many**: along each walk, for every 10 m, 1 on a quiet pavement, more on busier
  streets (0.7 + 0.25 × the road's `activity`, at most 4), 2.5 on a pedestrian street,
  0.9 on a footway, 0.3 on a cycleway; and the spots where they stand (below). Round the
  view (30 m beyond it) there are 0.5 people for each of those (at most 160), coming into
  being out of sight, gone 55 m beyond it.
- **Where they stand** (in groups of 2 to 5, facing in, or on their own facing the way the
  spot faces, for half a minute to two and a half): outside each business, on the nearest
  walk within 16 m, a little towards it (weight 1.6, a quarter of them in groups); at each
  sight, on the nearest walk within 30 m (4, always in groups); by the water, 1.5 m back
  from each mooring bollard and life ring, looking out over it (0.7); and in the parks,
  gardens, lawns, pitches, playgrounds and squares (at least 150 m²), one spot per 500 m²
  (up to 30; 1.6 in a square, 0.8 elsewhere), half in groups, and many of those not in a
  group wander about it instead (to somewhere 5 to 30 m away in it, a while there, on).
- **Crossing**: walking past a crossing's kerb (on the pavement either side of it), half
  the time they cross: at one with lights, when all the traffic lights by it (within
  30 m, its controller's) show red; at a zebra or a plain crossing, when there's a gap
  (nothing within 6 m, and nothing coming that would get there within 2 s, 3.5 s at a plain
  one); and give up after 40 s. Across at a little faster than they walk; the traffic
  stops for anyone in the road (crossing, running, diving or down there).
- **Buses**: 1 to 3 wait at each bus stop near the view (on the walk nearest it); when a
  bus is waiting at the stop (within 20 m), they walk to its door (front, kerb side) and
  get on; 0 to 3 get off each bus at each stop.
- **Danger**: only close by: you going over 8 m/s within 3.5 m of them, or driving along a
  pavement (over 5 m/s, within 5 m): they run (4.2 m/s) away from you, roads or not (but
  not into the water or a wall), for 4 to 7 s, then go back to walking. A crash (or
  someone knocked down) sends everyone within 12 m (8 m) running.
- **Jumping out of the way**: a car coming straight at them (over 4 m/s, getting there in
  0.15 to 0.9 s, its path within 1.2 m of them): each frame there's a 12% chance they see
  it, and dive sideways (6 m/s) away from it, then run.
- **Knocked down**: they're heavy (a car's about 15 times their weight), not skittles. A
  vehicle going into them faster than 1.2 m/s (slower, they're nudged aside) knocks them
  flat on the ground, there and then, where they were standing (not thrown), and loses
  a good part of its speed to it (12% plus 16% for every 40 m/s, at most 30%). Your car
  feels it: its front's dented where they were hit (as by any knock, by 2.5 × the speed
  it lost), it's twisted round towards the side they were hit on (the speed lost there,
  off its middle), and there's a thump and a jolt. Then it goes on over them (below). Faster than 6.7 m/s (15 mph) and they stay down;
  slower, they're up in 2.5 to 4.5 s and on their way.
- **Driven over**: someone lying there isn't knocked again: the vehicle goes over them,
  each axle (a third of its length in from each end) bumping over them as it reaches
  them: a thud and a lurch (as a speed hump), and 2% of its speed lost, up to 10% the
  faster it's going. They're barely moved (a little the way it's going, and out to the
  side), and hurt if it was going over 4 m/s.
- **Stepping round each other**: walking, anyone within 2 m ahead and 0.8 m to the side
  is stepped round (to the side away from them, up to 1.05 m off the middle of the walk,
  easing over at 1.6 m/s; head on, each keeps to their left). Behind someone slower going
  the same way (within 1.2 m), they slow to their pace, and step round if there's room.
- **Benches and picnic tables** (`amenity=bench`, `leisure=picnic_table`, the loose
  objects on the ground): people sit on them, 1 or 2 to a bench, 2 to 4 round a picnic
  table (weight 0.9 each), for 20 s to 2 minutes; knocked off if it's shoved hard (over
  3 m/s), up and on their way if it's moved or broken.
- **Picnics**: at about a third of the park, garden and lawn spots (not under a tree), 2 to 5
  sit in a ring on a blanket, facing in, for one to four minutes, then pack up and go.


**Ships moored for good, mapped as buildings** (`building=ship` or `boat`: the Thekla, the
Balmoral, Under the Stars) stay buildings (their outline and measured height), with a deck
painted on the roof (see `src/world/buildingLook.ts`); nothing moors where they lie, and the
boats under way go round them.

**Berths** (worked out when the map's built, `berths.ts`): along the quays mapped as
moorings (`man_made=quay` with `mooring`, not `no`) and round the edges of the
pontoons (`man_made=pier` with `floating=yes`, unless `mooring=no`). Along each
edge, on whichever side the water's on (water areas, not a pontoon or a pier), a
berth every boat's length, 0.6 m in from the edge's start and 0.8–2.6 m apart, the
boat lying alongside 0.4 m off the edge; only where the whole hull's on the water
and clear (by 0.5 m) of every other berth. What's moored goes by the mooring (and
is the same every time, by where it is): `permit` (people living aboard)
narrowboats, Dutch barges, cruisers and yachts; `guest` cruisers, yachts and
narrowboats; `private` yachts, cruisers and dinghies; `commercial` the old tugs and
barges; a pontoon whose `operator` is a ferry company, its spare ferries; anything
else, a mix with dinghies. Where the edge left is too short for the kind picked,
one that fits. Sizes (length × beam): narrowboat 17 × 2.1 m, barge 19 × 4, cruiser
9 × 3, yacht 10 × 3.3, dinghy 4.2 × 1.7, tug 21 × 5.5, ferry 13 × 3.8.

**Ferries:** each `route=ferry` relation (not disused) calls at its stops (members
with a `stop` role, or nodes tagged `amenity=ferry_terminal`) in order; a ferry
crossing mapped only as a `route=ferry` way runs between the terminals within 30 m
of its ends. Only terminals that are on the map and not disused (a disused one's
tag is `disused:amenity`) count, and a route needs two. Each stop's put alongside
the nearest edge (water's or a pontoon's) within 40 m that a ferry fits against,
clear of the other stops; a route with the same stops as one already kept (the
other way, say) isn't kept twice. Berths overlapping a stop (within 2 m) are dropped.

**In the game** (`src/world/boats.ts`): about 80% of the berths have a boat (the
tugs and spare ferries always), and one ferry runs each route, waiting 25 s at each
stop and going back along it from the end. About every 18 s one of the moored boats
(not a tug or ferry) casts off for a free berth its size (or bigger) at least 80 m
away, up to 5 at once. Where they can go is a grid over the water, 2 m a cell: the
water areas less the pontoons, piers, and every berth and ferry stop (half a metre
round). Bridges aren't in it: they're over the water, and the boats go under
them (drawn under the decks). A way is found through it with A* (weighted 1.6, for
speed), keeping 2 cells (about 3 m) from anything and costing more within 6 cells
of it, so they keep to the middle; then pulled straight where the line's clear.
Under way, a boat steers for a point 7 m ahead along its way, turning slower the
longer it is and when it's barely moving, slowing for bends and as it gets there;
it slows behind a boat ahead and keeps to starboard of one coming the other way.
Speeds: narrowboats and barges 2.2 m/s, cruisers and yachts 2.9, dinghies 3.6,
ferries 3.4 (each ±10%), about walking pace to a jog. It casts off and comes
alongside along a smooth curve, out ahead and away from the side it's moored on.
Its wake (two spreading lines of foam and churned water, 5 s long) is drawn behind
it, and every boat rocks a little on the water.

**Knocked about:** the boats are solid, like the traffic (a long hull is a row of
circles, as many as it takes to leave no gaps). Your car (on the ground, not up on
a bridge), a car knocked into one, or another boat adrift: the hit knocks it adrift
if it shifts it 3 px/s or more (weights against your car: dinghy 0.15, yacht 4,
cruiser 4.5, narrowboat and ferry 11, barge 23, tug 90). Adrift, it slows on the
water slowly along its length and quicker sideways (drag 0.25 and 0.7 a second;
spin 1), bouncing off the edge of the water (the water areas less the pontoons and
piers, a metre a cell) and knocking into other boats. Still for 1.6 s, it motors back
to its berth or stop (or on to where it was going): straight in alongside if it's
within 25 m with only water between, otherwise a way's found round. It's dented and
scratched like the cars (dents.ts), how badly by its kind: dinghy 0.7, cruiser 1.1,
yacht 1.2, ferry 2, narrowboat 2.4, barge 3, tug 4; but nothing comes off it, and it
splashes when hit hard. Past 75 on any side it limps along at half speed, smoking;
past 150 it's wrecked, left adrift (smoking), and its berth's free for another.

## Damage

What's on the map can be knocked down or broken by driving into it, except the
buildings (and a bridge's deck itself), and what's broken stays
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
| Mooring bollard (on a quay) | iron | 380 | Knocked off its base, a heavy lump |
| Post box | iron | 300 | Knocked off its foot, a heavy lump |
| Phone box | glass | 170 | Goes over, its panes smashed and strewn round it |
| Parking ticket machine (`vending=parking_tickets`) | metal with electrics | 160 | Topples, its screen smashed, sparks |
| Petrol pump (made, on a station's islands) | metal with electrics | 180 | Topples off its island, its screen smashed, sparks |
| Street clock (`amenity=clock`, not on a building or a sundial) | metal with electrics | 170 | Topples on its pole; its face comes off, its glass smashed |
| Life ring on its post (`emergency=life_ring`) | timber | 110 | The post snaps, the ring's thrown off |
| Bike stands (`amenity=bicycle_parking`) | metal | 140 | Bent over, flat |
| Gate across a road or path (`barrier=gate`, `swing_gate`) | metal | 150 | Gives way all at once, into bent bars |
| Car park barrier (`barrier=lift_gate`) | plastic | 60 | Its arm snaps off, in pieces |
| Chain across a way (`barrier=chain`) | metal | 50 | Gives way |
| Statue or sculpture (`artwork_type=statue/sculpture`, `historic=monument`, `memorial=statue`) | stone | 290 | Knocked off its plinth: it goes over and lands in pieces (rubble, stone) |
| Fountain (the big stone ones) | stone | 310 | Smashed: rubble and stone scattered the way the car went |
| Harbour crane | iron | 330 | Goes over, its jib with it: girders and bent bars lying where it fell |
| A bridge's parapet | stone | 260 | Knocked through (2.5 m, up to 5 m): the gap's gone from the deck, and beyond it the drop (into the water, or onto the road below). Where a pavement or cycleway is mapped as its own bridge alongside a road's, there's no parapet between them |
| Bench | timber, in parts | 150 | Below: shoved. Above: smashed into planks, scattered the way the car was going |
| Garden wall (`barrier=wall`, …) | stone | 200 | Crumbles: a gap 2 m wide (up to 4 m, the harder it's hit) in rubble and bricks; the rest stands |
| Bus shelter | glass | 140 | Smashed through (a gap up to its whole length): glass strewn, bent bars |
| Hedge | plant | 80 | Torn through (a 3 m gap, up to 6 m): leaves flying, and clumps of it and twigs strewn the way the car went |
| Fence | timber | 70 | Broken through (2.5 m, up to 5 m) into planks |
| Railings | metal | 130 | Broken through (2.5 m, up to 5 m), bent bars |

**Vehicles** (yours, the traffic, the parked cars; `src/car/dents.ts`, painted by
`src/scenes/dentArt.ts`) are damaged where they're hit, by how hard: the impulse of the
hit (it grows with the speed they came together at and the weight of what hit them;
the same for both), divided by how sturdy the vehicle is (a small car 0.9, a car 1,
an SUV or van 1.3, a lorry 2.2; yours is built tougher, 2). Hitting a wall or a post is a hit as hard as you
bounce; what gives way (a lamp post, a wall, a bench) is a hit on the front as hard as
the speed it takes off you. Each hit lands on the side of the body nearest where they
touched:

| How hard | What it does there |
| --- | --- |
| 7 or more | Scratches along the edge (bare metal and primer), more and longer the harder |
| 16 | Paint chipped off |
| 28 | Dented (shaded in), bigger the harder |
| 75 | Crumpled: the outline pushed in, its folds; from the front, the windscreen cracks |
| 30, at a corner of an end | That light's smashed: its glass (and a rear light's red lens) on the road |
| 22, from the side by the windscreen | The wing mirror comes off |
| 45, from the side by a wheel | Half the time, its hubcap comes off |
| An end that's taken 160 in all | Its bumper falls off |

It all adds up, hit after hit (the bumper's off once its end has had enough), and stays (RESET repairs your car).
A car pressed against something is hit once, not over and over: hits within 0.15 s count
only if half as hard again. A bumper on the road breaks into bits run over hard
enough (90); a mirror smashes (50).

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
| Picnic table (loose) | 150 | Planks |
| Grit bin (loose) | 150 | Bits of yellow plastic (and its grit) |
| Planter (loose, heavy) | 230 | Rubble and its plants |
| Concrete block (loose, very heavy: shoved, hardly moved) | 300 | Rubble |
| Plank | 110 | Splinters |
| Fallen lamp post | 120 | Two short poles |
| Short pole | 100 | Bent bits |
| Traffic light's head | 80 | Glass and a bent bracket |
| Fallen phone box | 120 | Glass and bent frame |

Gates and barriers stand across the road or path they're on (OSM maps them as a
point on it), as wide as it is; one on a wall or fence is just part of it. What's
indoors, on a roof or gone (`indoor=yes`, `location=indoor/roof`, `disused=yes`:
the Colston statue's in M Shed) isn't put out. Fire hydrants are left out: all of
Bristol's here are underground (`fire_hydrant:type=underground`).

Rubble, bricks, glass, bollards, post boxes, clumps of leaves, twigs and
splinters just get kicked about.

The pieces are loose things like the rest (with their own weights), pushed by
the car and stopping on their own; walls and trunks left standing or lying
are solid. They're all part of the world's walls, posts and loose things, so
they're in the way of traffic and people too, when there are some.

## The files

- `osm.ts`: reads OSM's XML and makes the map (`buildMap`): projection, roads,
  ground, lines, buildings, trees, props, crossings, surfaces. Tested in `osm.test.ts`.
- `berths.ts`: where boats moor, and the ferry routes and stops.
- `landmarks.ts`: landmarks' colours (and heights, roof shapes), and streets' looks.
- `enrich.ts`, `lidar.ts`, `osgb.ts`: the LIDAR and the terrain. Tested in `lidar.test.ts`.
- `bristol.json`: the map the game loads.
- `../../tools/build-map.ts`: downloads, keeps and puts it all together.
- `../../map-sources/`: the kept downloads, and the list of areas.

In the game (`src/world/`): `world.ts` (what you hit, what's loose, an index of
what's where), `ground.ts` and `groundArt.ts` (painting the ground in 512 px
pieces, and the surface grid that says what's underfoot), `GroundLayer.ts`
(painting pieces as they come into view, shading the hills: in a worker,
`groundWorker.ts` with `groundPiece.ts`, so painting never holds up a frame), `terrain.ts`,
`perspective.ts` and `TerrainSheet.ts` (the hills, and the old games'
perspective: higher than the car is nearer the camera, so drawn pushed out from
the middle of the view), `buildingLook.ts` and `Buildings.ts` (the buildings),
`traffic.ts` (the traffic and the parked cars; tested in `traffic.test.ts`) and
`parking.ts` (where the bays are, painted and parked in); the traffic's drawn by
`src/scenes/TrafficLayer.ts` and `vehicleArt.ts`; `boats.ts` (the boats; tested in
`boats.test.ts`, with `src/map/berths.ts`), drawn by `src/scenes/BoatLayer.ts` and
`boatArt.ts`.
The car feels the gradient in `src/car/CarPhysics.ts`.
