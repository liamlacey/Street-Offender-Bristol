# Tank World

The other game: a procedurally generated island to drive a tank round, where
everything can be blown up. It shares nothing with the racing but the menu,
the art helpers (`scenes/artKit.ts`), the puff and spark textures, the
chunked drawing (`scenes/ChunkLayers.ts`) and the sound switch.

- `noise.ts`: seeded random numbers and smooth noise.
- `island.ts`: builds an island from a seed (pure, tested). Height from noise,
  falling away to the sea at the edges, with ridged noise for mountain chains;
  biomes from height and wetness (sea, shallows, beach, grass, forest, hills,
  rock, snow); rivers traced downhill from springs in the hills to the sea and
  cut into the land (with their banks smoothed); the city (a town with
  `city` set: more blocks, avenues for its main streets, towers and offices
  in the middle, `parks`) and the towns on flat
  land, a grid of streets with houses and shops along them, a church and a
  square; villages on flat dry land on the main landmass; paved roads out of
  the towns' main streets and dirt tracks to the villages, found round the
  water and up the easiest ground, never across a town (each is laid onto
  the roads already there where it runs along one, `Network.snap`, and
  marked straight away so the next shares it; `junctions` are where they
  meet, for the drawing), and to the harbours' gates: a harbour is
  a stretch of coast with flat land behind and open water in front, its yard
  kept clear of roads); bridges where they cross the rivers; then
  the houses, farms and depot, the harbours (warehouses, cranes, containers,
  jetties, moored boats: `harbourPoint` finds your way round one), fields of
  crops round the villages and the working farms by them (`farms`, with
  their `fields`), boats,
  beach huts and sunshades, campsites and forestry clearings in the woods,
  ski lifts from just below the snow up to the peaks (`lifts`), access
  tracks out to the nearest road from each farm, campsite, forestry
  clearing, beach and lift (round anything standing; trees are
  kept off the clearings and pistes), footpaths (`trails`, found like the
  roads but by what's easy to walk) from the campsites, villages and chalets
  up to the tops round about and through the woods, meadows of long grass,
  and trees,
  bushes and rocks by what grows where. Crops and grass are laid as patches
  edge to edge, so fire can run from one to the next. Islands are 40,960 px
  across, with some 95,000 things on them: the path searches reuse their
  working space, and where trees can go is looked up from a coarse map of
  the villages, towns, clearings and paths, to keep the building quick.
  It's the same island every time for the same seed. It's
  built a step at a time (`islandSteps`), so TankScene can show a progress
  bar while it's made.
- `island.ts` also lays the `railway`: a loop round the towns in the
  shortest order (nearest neighbour, then 2-opt), found the low, level way
  round the towns and mountains, smoothed into long curves, with a station
  beside each town (`railPose` finds a point along it), kept clear of things
  (`rails`), and stone bridges where it crosses a river.
- `train.ts`: the trains (pure, tested): a locomotive and carriages along the
  line, braking for each station and standing there, stopping for the tank
  or a bridge down ahead, and stopped for good when hit.
- `police.ts`: the police (pure, tested): how many there should be for how
  much has been destroyed, where one arrives (out of sight, on a road if
  there's one), and driving to cut the tank off and stop in its way,
  steering round things and backing out when boxed in.
- `kinds.ts`: everything there is to shoot, and what it's made of: its size,
  hit points, whether it stops the tank, how long it burns, how big a blast
  it makes.
- `world.ts`: what happens when things are hit (pure, tested). Each
  material's response (stone cracks then crumbles; trees split, burn and turn
  to ash; buildings are holed, collapse and burn; vehicles and fuel explode,
  setting each other off; straw (haystacks, tents, crops, long grass) burns;
  wood splinters; what the tank flattens is marked `flattened` and can't
  burn), fire spreading from
  thing to thing (no more than `MAX_FIRES` at once), and the events the scene
  shows.
- `life.ts`: the people and animals (pure, tested): villagers, townsfolk,
  beach walkers, sunbathers and campers (a `role` that keeps them in their
  spot, lying or sat, till they're scared off it), forestry workers and
  dockers, hikers (who can go up on the snow; those with a `route` walk a
  footpath end to end and back), swimmers (who keep to the shallows), sheep,
  cows and deer; where they live, wandering
  near home and standing a while, running from explosions and the tank, and
  stepping out from under it. Nobody can be hurt.
- `traffic.ts`: vehicles driving the tracks (busier in the city, with buses,
  in both lanes of the avenues), the farms' combine harvesters working the
  rows and tractors going out to the fields, boats sailing offshore, fishing
  boats putting out from the harbours and back, and forklifts going up and
  down the harbour yards (pure, tested). They're World things (moved with `World.move`), so they can be
  hit; a hit one stops for good and its driver bails out.
- `IslandLife.ts`: draws the people and animals, the waves and surf, flocks
  of birds, chimney and campfire smoke, the campfires' flames, blowing
  leaves, and the ski lifts (cable, chairs going round, skiers riding up and
  skiing down; stopped for good if a pylon or station is destroyed), and
  the harbour cranes' jibs swinging containers from the boats to the quay,
  and kayakers paddling down the rivers (and starting again upstream).
  People's sprites are only made once they're first near the view. (The trees' sway, the traffic's
  sprites and the cloud shadows are in TankScene.)
- `tank.ts`: driving the tank (wading slowly across the rivers, quickly over
  the bridges, out along the jetties; smashing
  through what it drives into, slowed by it), the turret, firing and the
  rockets (pure, tested).
- `Terrain.ts`: draws the ground in pieces as the view nears them, lit by the
  slopes, with the tracks, roads, streets and avenues (verges first, then
  the surfaces, then the markings, then the junctions paved over so no
  lines cross them), the city's parks, footpaths and harbour yards, and keeps the scorch marks, craters, tank tracks
  and settled debris painted into it.
- `art.ts`: the pictures, drawn in code, in every state (standing, damaged,
  wrecked, burnt).
- `TankScene.ts`: runs it all: the tank and camera, rockets, and the fire,
  smoke, dust, debris and explosions for what happens. Things are drawn an
  area at a time as the view comes near (`drawNear`; there are far too many
  to draw them all), picking up whatever's happened to them meanwhile.
- `TankHudScene.ts`: the map (with the police and trains on it), the
  destroyed count, how many police are after the tank, NEW ISLAND, MENU,
  the GUN and POLICE switches, SAVE ISLAND, and the thumb sticks.
- `savedIslands.ts`: the islands the player's saved (a name and the seed),
  in the browser's storage; the menu's TANK WORLD page lists them.
- `TankAudio.ts`: the diesel, tracks, rockets, explosions, crumbling,
  splintering, collapsing and the crackle of fire, synthesised.
