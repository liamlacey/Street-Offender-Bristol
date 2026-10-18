# Race circuit

Everything for the Circuit location (`circuit` in `locations/locations.ts`).
Docklands and Woodlands are natural places and never use any of it.

- `style.ts`: `CircuitStyle` (what a circuit has) and `FULL_CIRCUIT`, with
  everything on, which the Circuit uses.
- `plan.ts`: where things go: gravel traps on the outside of corners,
  grandstands, spectator banks, marshals at corners, advertising boards, the
  pits, spare tyres and the start gantry (or banner); and race day around the
  track: the paddock behind the pits, big screens, walkways, fans milling
  about, food stalls, car parks and campsites.
- `art.ts`: the pictures (grandstands and cheering crowds, fences and tape,
  pits, boards, tyre stacks, marshals, flags, the start banner, parked cars,
  fans, stalls, screens, marquees, gazebos, the TV helicopter and a blimp),
  the tyre texture for tyre walls and loose tyres, and mown grass.
- `CircuitScenery.ts`: draws them and brings them to life (crowds and fans
  cheer as cars pass, marshals wave, flags flap, fans walk about and queue,
  screens change picture, the helicopter follows the race, the blimp drifts
  over).
- `road.ts`: tarmac with kerbs and painted lines.

The scenery planner, the race scene and the road drawing pick it all up from
a location's `circuit` style. `npm test` checks the Circuit's scenery
(`track/decoration.test.ts`) and races AI cars round circuit tracks
(`ai/race.integration.test.ts`).
