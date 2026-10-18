# Desert

Everything for the Desert location's own scenery: the Nevada desert. The
dusty road, red rock barriers, tumbleweeds and barrels, the sand blown across
the road and the wild horses come from the shared code, switched by the
location (`road.kind: 'desert'`, `decoration.desert`); the soft sand surface
is in `car/CarPhysics.ts` and `locationSurface` in `locations/locations.ts`.

- `style.ts`: the desert's prop kinds (mesas, dunes, dry lake beds, ghost
  towns, camps, wrecks, outcrops, cacti, windpumps), their sizes, and the way
  the wind blows.
- `plan.ts`: where they go (called from the scenery planner,
  `track/decoration.ts`: the big things before the camps and wrecks by the
  road, the cacti and scrub after).
- `art.ts`: the pictures (red rocks, tumbleweeds, cacti and Joshua trees,
  the ghost town's buildings, water tower and windpump, wrecks, the camp, the
  people, buggies, land yachts, vultures, a UFO, wild horses) and the sand
  on the ground.
- `DesertScenery.ts`: draws it all and keeps it moving: buttes leaning out
  from the middle of the view (as the city's towers do), buggies, land
  yachts, windpumps turning, campfires, tumbleweeds blowing about and
  fetching up against the rocks by the track, dust devils, vultures circling,
  and the odd UFO.

`npm test` checks the desert scenery appears in the Desert and nowhere else.
