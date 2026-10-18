# Example code

`2d-racer/` is a complete copy of 2D Racer (github.com/liamlacey/2D-racer-web-game),
taken when this game was started, to borrow code and ideas from. It isn't built or
tested as part of this project: copy what's useful into `src/` and adapt it there.

Where to look, for a GTA 1-style game in a city:

- **The city** (the Downtown race location), `2d-racer/src/downtown/` (see its README):
  a street grid (`grid.ts`), city blocks with buildings, plazas and street furniture
  (`plan.ts`, `city.ts`, `CityScenery.ts`, `art.ts`), streets with pavements, markings
  and junctions (`street.ts`, `road.ts`, `StreetScenery.ts`), and traffic and
  pedestrians that drive and walk them (`traffic.ts`).
- **Driving**: `2d-racer/src/car/CarPhysics.ts` (grip, drift, surfaces),
  `2d-racer/src/physics/collisions.ts` (cars hitting each other and things, knocking
  loose things about), `2d-racer/src/scenes/CarEffects.ts` and `SkidMarks.ts`
  (smoke, sparks, skid marks).
- **Touch controls and the HUD**: `2d-racer/src/scenes/HudScene.ts`, and the thumb
  sticks in `2d-racer/src/tank/TankHudScene.ts`.
- **Sound**, all synthesised: `2d-racer/src/audio/RaceAudio.ts` (engines, tyres,
  crashes), `2d-racer/src/tank/TankAudio.ts` (explosions, fire, a police siren).
- **Drawing in code**: `2d-racer/src/scenes/artKit.ts` (helpers) and the art files
  (`*Art.ts`, `art.ts`) packed onto texture atlases; `2d-racer/src/scenes/ChunkLayers.ts`
  (only drawing what's near the camera); `CloudShadows.ts`.
- **Tank World**, `2d-racer/src/tank/` (see its README), a big open world, which has
  a lot that fits a GTA-style game:
  - `police.ts`: police cars that come after you, more the more you destroy, and race
    to cut you off; with the flashing lights and siren in `TankScene.ts`.
  - `world.ts`: things that take damage by what they're made of, explode, catch fire
    and burn, with fire spreading and chain reactions.
  - `traffic.ts`: vehicles driving the roads (stopping for the player, turning back,
    drivers bailing out when hit); `life.ts`: people walking about, scattering from
    explosions and getting out of the way.
  - `train.ts`: trains going round a railway, stopping at stations.
  - `island.ts`: procedural roads found round obstacles and joined into a network with
    proper junctions, towns, a city with avenues, towers and parks, harbours.
  - `Terrain.ts`: drawing a huge map in pieces as the camera nears them;
    `TankScene.ts`: drawing things area by area as they come into view, for maps with
    tens of thousands of things.
  - `savedIslands.ts` and the menu: saving and loading.
- **Settings and storage**: `2d-racer/src/settings.ts`; the name dialog in
  `2d-racer/src/ui/nameDialog.ts`.
- **Tests**: most of the logic is pure (no Phaser) and tested with Vitest alongside it
  (`*.test.ts`), a pattern worth keeping.
