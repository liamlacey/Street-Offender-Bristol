# Winter

Everything for the Winter location's own scenery: snowy mountains. The road,
snowbanks, snowmen, frozen water, snowy forest and falling snow come from the
shared code, switched by the location (`road.kind: 'snow'`,
`decoration.winter`); the snow, ice and drift surfaces are in
`car/CarPhysics.ts` and `locationSurface` in `locations/locations.ts`.

- `style.ts`: Winter's prop kinds (peaks, lakes, pistes, snowmen, boulders)
  and their sizes.
- `plan.ts`: where they go (called from the scenery planner,
  `track/decoration.ts`, before the forest, so the trees leave room).
- `art.ts`: the pictures (snowy pines, chalets, snowbanks, rocks, snowmen,
  ice blocks, skiers, snowboarders, skaters, lift towers, stations and
  chairs, the ice-fishing hut) and the snow ground texture.
- `WinterScenery.ts`: draws it all and keeps it moving: mountains leaning out
  from the middle of the view (as the city's towers do), frozen lakes with
  skaters, ski runs with chairlifts carrying skiers and snowboarders up to
  carve back down, snowmen and boulders.

`npm test` checks the winter scenery appears in Winter and nowhere else.
