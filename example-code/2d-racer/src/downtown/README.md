# Downtown

Everything for the Downtown location: a race round the blocks of a city.

- `grid.ts`: the street grid, and the track: the outline of a random patch of
  blocks, grown from rectangles of blocks until it's the right length with the
  right number of corners for the difficulty. The grid is kept in the track's
  definition (`grid`), so saved tracks keep their city.
- `city.ts`: the city's junctions, streets (the race's own, as wide as the
  track, and side streets) and blocks, the race's route round the grid
  corner by corner (the barriers follow it, square round each turn: see
  `track/barriers.ts`), and each junction's stretch of track.
- `plan.ts`: what fills the blocks (buildings, parks, plazas, car parks,
  building sites), the traffic lights and street lamps (called from the
  scenery planner, `track/decoration.ts`).
- `street.ts`: the loose life of the race's streets (parked cars, people,
  hydrants, bins, newspaper boxes), the traffic light cycle, and how people
  walk, cross, dodge and get knocked over.
- `traffic.ts`: the city's own traffic on the side streets.
- `road.ts`: drawing the streets, the race's and the side streets alike, so
  the race runs on the grid itself: kerbs, square junctions, lanes, zebra
  crossings and stop lines.
- `art.ts`: the pictures, and the pavement texture.
- `CityScenery.ts`: draws the city (the buildings lean out from the middle of
  the view, the old top-down way) and runs its traffic, lights, crane and
  steam.
- `StreetScenery.ts`: the race's loose street life on screen (people's poses,
  hazard lights, gushing hydrants).

`npm test` checks the grid, the street life, the traffic and the scenery, and
races AI cars round downtown tracks with everything in the way.
