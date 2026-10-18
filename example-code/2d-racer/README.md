# 2D Racer

A top-down arcade racer for the browser, inspired by Micro Machines and the original GTA.
It also has a second game, **Tank World**: an island to drive a tank round and blow up.

Built with [Phaser 4](https://github.com/phaserjs/phaser), TypeScript and Vite.

## Running it

Requires Node.js 20+.

```sh
npm install
npm run dev       # dev server with hot reload, open the printed URL
npm test          # unit tests (Vitest)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Playing online

The game is hosted on [Vercel](https://vercel.com), connected to this GitHub repo.
Every push to `main` updates the live site, and every branch and pull request gets
its own preview link (posted on the PR), which is handy for testing on a phone.
Vercel detects Vite automatically: build command `npm run build`, output `dist`.

GitHub Actions (`.github/workflows/ci.yml`) runs the tests and build on every PR.

## Controls

| Key | Action |
| --- | --- |
| Up / W | Accelerate |
| Down / S | Brake, then reverse |
| Left/Right / A/D | Steer |
| Space | Handbrake (drift) |
| R | Back on track |
| Esc / P | Pause |
| Enter | Start a race (menu), resume (paused), race again (results) |

### On an iPhone

Open the game in Safari, tap the Share button, then **Add to Home Screen**. It then
launches full screen like an app, without Safari's toolbars.

On phones and tablets, on-screen buttons appear instead (steer on the left; gas,
brake and drift on the right). Landscape gives the best view.

## Project layout

```
src/
  main.ts               Phaser game config
  car/CarPhysics.ts       Car handling model and surface grip (pure TS, unit tested)
  track/Track.ts          Track geometry: centre line, surfaces, positions (pure TS, unit tested)
  track/generate.ts       Procedural track generator (pure TS, unit tested)
  track/tracks.ts         The hand-made "Docklands Classic" layout
  locations/locations.ts  Locations: road, ground, barrier, obstacle and car styles
  race/savedTracks.ts     Saved tracks, kept in the browser
  ui/nameDialog.ts        The "name this track" box (HTML over the game)
  track/barriers.ts       Tyre barriers and cone positions, generated from the track
  track/decoration.ts     Where the scenery goes: forest, water, mud, the docks and their work... (pure TS, unit tested)
  track/water.ts          Streams and rivers in the woods, and where they cross the road (pure TS)
  track/port.ts           The docks: verge, yards and dock water, quays, lanes, tugboat runs (pure TS)
  physics/collisions.ts   Car/barrier/cone collisions (pure TS, unit tested)
  race/LapTracker.ts      Checkpoints and lap timing (pure TS, unit tested)
  race/WrongWayDetector.ts  "Wrong way" warning
  race/bestLaps.ts        Best lap per track, saved in the browser
  input/TouchControls.ts  On-screen multi-touch buttons for phones
  ai/racingLine.ts        Racing line and target speeds for the AI (pure TS)
  ai/AiDriver.ts          AI driver: steers, brakes, overtakes, recovers (pure TS)
  ai/drivers.ts           The AI field (up to 20) and how fast each driver is
  race/grid.ts            Starting grid positions
  race/standings.ts       Race order
  settings.ts             Remembered choices: difficulty, laps, length, sound
  scenes/MenuScene.ts     Menus: play, choose/new track, race setup
  scenes/RaceScene.ts     World, camera, input, race flow, fixed-timestep physics loop
  scenes/HudScene.ts      Screen-space overlay (speed, minimap, touch buttons)
  scenes/Minimap.ts       Track overview with the car's position
  scenes/SkidMarks.ts     Tyre marks that last the whole race, drawn into chunked textures
  scenes/CarEffects.ts    Tyre marks, smoke, dust and sparks
  audio/RaceAudio.ts      All sound, synthesised with Web Audio (no audio files)
  scenes/drawTrack.ts     Draws road, kerbs and start line
  scenes/Decorations.ts   Draws the scenery and brings it to life (deer, campfires, cloud shadows...)
  scenes/WoodsScenery.ts  Water, fords, bridges, mud and puddles, and the woods' leaves, birds and smoke
  scenes/PortScenery.ts   The docks: water, quays, lanes and railway, and their work (cranes, lorries, dockers, gulls...)
  scenes/ForestryScenery.ts Forestry in the woods: the loader, timber lorries, harvester and chainsaw crews
  scenes/ChunkLayers.ts   Keeps the static scenery in chunks and only draws what's near the camera
  circuit/                The race circuit: its planning, art and animation
  downtown/               The city: its street grid, buildings, traffic, people and parked cars
  winter/                 The snowy mountains: peaks, frozen lakes, ski runs and lifts
  desert/                 The desert: mesas, dunes, ghost towns, camps and what blows about
  tank/                   Tank World, the other game: the island, the tank, and what happens to what it hits
  scenes/decorationArt.ts The decoration's art, drawn in code onto one texture (and woodsArt.ts, portArt.ts)
  scenes/textures.ts      Placeholder art generated at startup
```

### Tuning the handling

All handling numbers live in `DEFAULT_TUNING` in `src/car/CarPhysics.ts`. The most
important ones for feel:

- `grip`: how quickly sideways sliding is killed. Lower = more drifty.
- `handbrakeGrip`: grip while Space is held.
- `maxTurnRate` / `fullSteerSpeed`: how sharply the car turns, and at what speed full steering kicks in.
- `engineAccel` / `maxForwardSpeed`: punch and top speed.

### Tracks and locations

Tracks are generated: PLAY → NEW TRACK → pick a location, a length (short ~30s,
medium ~45s, long ~70s laps) and a track difficulty → set up the
race (race or time trial, AI difficulty, laps, 1-20 opponents) → GENERATE & PLAY. From the pause menu
or the results screen you can save the track with a name; it then appears in the track
list (with its own best lap). Saved tracks store their actual shape, so they never
change even if the generator does.

The generator (`src/track/generate.ts`) builds circuits from the convex hull of random
points (straights), keeps splitting the longest edge with a bend until it has the
difficulty's number of corners per length of track, scales to the chosen length, rounds
the corners and smooths the result. Harder tracks have more and tighter corners (fewer
straights), a road that narrows and widens, loose obstacles on the road (cone lines,
and on hard, heavier loose drums or bales; nothing fixed is ever on the road) and less run-off
before the barriers. Track difficulty only shapes the track: how fast and brave the AI
is comes from AI difficulty alone. The AI's racing line is
planned round the obstacles and width changes. Every candidate must pass the same layout checks
as a hand-made track (`layoutProblem` in `Track.ts`: no overlapping road, no corner too
tight) or it's thrown away. `npm test` checks many generated tracks per location and
length, has the AI lap some cleanly, and runs full AI races on them.

There are six locations:

- **Docklands**: through a working port. There's no road: the way through is the
  dock's concrete itself, marked out by concrete jersey barriers, with cones and oil
  drums to knock about. Around it, the dock water with quay walls and bollards, cargo
  ships being unloaded by quay cranes, boats bobbing at their moorings and along
  pontoons, container stacks worked by yard gantry cranes, rows of containers lining
  the barriers, crates, cable reels, drums, steel coils, site offices and parked vans
  all about the yards, warehouses with lorries at
  their loading bays and forklifts shuttling pallets, tank farms, painted lanes and
  markings, a railway siding with a shunting train, and street lamps. Lorries haul
  containers and straddle carriers lift them along the lanes, dockers in hi-vis walk
  about and stand chatting, tugboats cross the harbour leaving wakes, gulls wheel over
  the water (and the ones sitting by the track scatter as you pass, coming back later),
  and the water shimmers.
- **Woodlands**: a narrower, twistier dirt road through the forest that's looser than
  tarmac (the cars slide more, and kick up dust). There's mud that bogs you down and
  puddles that splash and drag (more of both on harder tracks), streams you ford and
  rivers you cross on wooden bridges (their water flows), dense forest either side
  behind a wall of logs (boulders where it crosses water), solid log piles in the
  run-off, and clearings with cabins, campers round a campfire, and deer that bolt when
  a car comes by. Foresters are at work: at worksites cut into the trees a loader swings
  timber onto lorries that back in down a logging track and pull away loaded, a
  harvester fells at the treeline, and crews with chainsaws throw up sawdust. Leaves drift down and birds fly over. The cars are off-roaders, and
  the loose things to knock about are straw bales.

- **Circuit**: a classic motor racing circuit. Tarmac with red and white kerbs and a
  dashed centre line, tyre walls, gravel traps on the outside of the corners, and a
  start gantry over the grid. The cars are touring racers. Around it, grandstands and
  spectators lining the fences who cheer as the cars come past, marshals waving flags,
  advertising boards, the pits with the paddock behind (team motorhomes, hospitality
  marquees and transporters), big screens, food stalls with queues, car parks full of
  fans' cars, campsites of tents, camper vans and gazebos with flags flying, fans
  walking about, a TV helicopter following the race and an advertising blimp drifting
  over.

- **Downtown**: a race round the blocks of an American city centre. The tracks follow
  the street grid, turning at its junctions, with the barriers guiding you round each
  square corner: four lanes of tarmac with a double yellow line, parking lanes, kerbs
  and pavements, zebra crossings and traffic lights at every junction. Side streets are closed off where they meet the race, with
  the city's own traffic queueing at the lights and turning round. Everything on the
  street is loose: cars parked along the kerbs (knock one and its hazard lights flash
  and its alarm goes off), people walking the pavements and crossing when the lights
  say so (they jump out of the way, and if you hit one they go down, then get up and
  carry on), hydrants that gush water once knocked over, bins and newspaper boxes. All
  around, high-rises lean out from the middle of the view like the old top-down games,
  with helipads, water tanks and roof gardens, casting long shadows over the streets;
  parks with fountains, plazas, car parks, a building site with a tower crane swinging
  round, and steam rising from the manholes. Harder tracks have smaller blocks and more
  turns, and road works narrowing the street.

- **Winter**: snowy mountain roads. Packed snow with wheel ruts and icy patches, walled
  in by snowbanks (rocks where it crosses water). Snow is slipperier than dirt, ice
  barely grips at all and the snow drifts bog you down; the cars are rally cars
  kicking up snow, and the loose things to knock about are snowmen and blocks of ice.
  Snow falls all race. Around it, snow-laden conifers, frozen streams and rivers, frozen
  lakes with skaters looping and an ice-fishing hut, mountains leaning out from the
  middle of the view, boulders, wooden chalets with smoking chimneys, and ski runs
  where skiers and snowboarders carve down the piste, then ride the chairlift back up.

- **Desert**: dusty dirt tracks through the Nevada desert, lined with red rocks, with
  sand blown in over the edges and drifted across the road (soft sand bogs you down, and
  sprays up behind you). The loose things to knock about are tumbleweeds and old wooden
  barrels. Around it, buttes and mesas of banded red rock leaning out from the middle of
  the view, crescent sand dunes with buggies tearing round them, dry lake beds of cracked
  clay with land yachts sailing up and down, ghost towns of weathered wooden buildings
  (some fallen in) along a dusty main street with a water tower and a windpump turning,
  desert camps with an RV, tents and people sat round a campfire, rusting wrecks with
  vultures circling overhead, herds of wild horses that bolt as you pass, Joshua trees,
  saguaros, prickly pears and sagebrush. Tumbleweeds blow across the desert and fetch up
  against the rocks along the track, dust devils wander about, and every so often a UFO
  streaks over.

Docklands, Woodlands, Downtown, Winter and Desert are natural places, not race circuits: there are no
grandstands, crowds, marshals, banners, start gantries, pits or advertising there.
All of that belongs to the Circuit, and lives in `src/circuit/` (see its README).

In both, cloud shadows drift slowly over everything. Every track is dressed from its
shape (`src/track/decoration.ts`), so generated and saved tracks get all of this. It's the
same every time for the same
track, and nothing fixed is ever on the road. The AI drives the same conditions as you
(it takes corners slower on dirt), and `npm test` has it lap and race woodland tracks
through the mud and water and past the log piles.

To add a location, add an entry to `src/locations/locations.ts` with its road, ground,
decoration and layout settings (plus any new barrier/obstacle/car styles it needs).

## Tank World

TANK WORLD on the home menu starts the other game. Its page has NEW ISLAND, for a new
island made from a random seed, and below it the islands you've saved: tap one to play it
again (built fresh, before anything was blown up), or DEL then SURE? to delete it. In the
game, SAVE ISLAND names the island and keeps it (in the browser, like the saved tracks);
NEW ISLAND makes another. Islands are huge (about 41,000 px across: some twenty towns,
a couple of hundred villages, a dozen or so harbours and dozens of rivers), so building one
takes several seconds, with a progress bar; things are only drawn as you get near them. It has sea all round, beaches with palms and
boats pulled up in the shallows, meadows and forest, hills, rocky mountains with snow on
top, lakes, and rivers running down from the hills to the sea, with kayakers paddling
down them. Somewhere on it is one big city: a wide grid of streets crossed by two
four-lane avenues, towers (with helipads, rooftop plant or roof gardens) and office blocks
in the middle casting long shadows, shops all along the avenues, parks with trees, paths,
benches and fountains, buses and busy traffic in both lanes, and crowds on the streets.
There are towns
laid out on a grid of streets with pavements: terraced houses and shops facing the
streets, a church, and a paved square with a fountain and cars parked round it. Paved
roads run out of the towns, and dirt tracks wind on to the villages, which have houses
round a green, parked cars, a farm with a barn, haystacks, a tractor and a fenced
paddock, and in one of them a fuel depot. Where a road crosses a river there's a bridge:
stone on the paved roads, wooden on the tracks. Roads that meet join at a proper
junction, and where two would run side by side they're laid as one. Out from the villages
are working farms: a farmhouse, a barn, grain silos and haystacks round the yard, hens
pecking about, farmers at work, a tractor going out to the fields, and a combine harvester
working up and down the rows of crops (wheat, barley, maize, rapeseed), cutting them as it
goes. Out in the open are meadows of long grass. Every farm, campsite, forestry clearing,
beach and ski lift has a track out to the nearest road (with a wooden bridge where it
crosses a river).
The beaches have rows of painted beach huts, sunshades with towels laid out, people
sunbathing and swimmers in the shallows. In the woods there are campsites (tents round a
campfire, with the campers sat round it) and forestry clearings (a harvester, stacks of
logs, stumps, a truck, and workers in hi-vis). Up the snowy peaks run ski lifts, with a
station at each end, pylons, a chalet at the bottom, chairs going round, and skiers
riding up and skiing down the piste beside them. Footpaths wind through the woods and up
from the campsites, villages and chalets to the tops of the hills and mountains, with
hikers and walkers out along them (and more up in the hills and on the snow).

A railway runs in a loop round the island through every town and the city, laid low and
level round the mountains, over stone bridges where it crosses a river and over the roads
at level crossings. Each town has a station with a platform, benches and people waiting,
and trains (a locomotive and its carriages) go round, pulling up at every station. A
train stops for the tank on the line, and short of a bridge that's been blown up; hit it
and it's stopped for good.

Round the coast are harbours, each with a road in: a paved yard behind a stone quay, with
warehouses, stacks of shipping containers, crates and barrels, dock cranes swinging
containers off the boats and round onto the quay, forklifts running up and down, dockers
at work, and wooden jetties out over the water with fishing boats and trawlers tied up
alongside, while others put out to sea and come back in. The tank can drive out along a
jetty; shoot one and it falls into the water.

You drive a tank round it. On a phone, the left thumb stick drives (push the way you want
to go: the tank turns and drives off that way) and the right one aims the turret and fires
while it's pushed out. With a keyboard: WASD or the arrows drive, the mouse aims, and
click or Space fires. The GUN button switches the gun between AIMED (as above) and
FORWARD, where it always points the way the tank is going: then the right stick is just a
FIRE button (and on a computer the mouse doesn't aim). The choice is remembered. The tank is quicker on the tracks and slower in sand, shallow water
and up in the rocks; it can't go into deep water, and wades slowly across the rivers
(throwing up spray) unless there's a bridge. It rolls over bushes, fences, crates,
haystacks, tents, sunshades and crops and flattens them, and it smashes
through anything else it drives into, slowing as it does (more for something tough like a
church or a boulder): trees go down, rocks crumble, houses collapse, vehicles go up, and
burnt-out wrecks are flattened.

With POLICE on (the switch is in the game, and it's remembered), the police come after
the tank once it starts destroying things: police cars and vans, lights flashing and
sirens wailing louder as they close in, arriving from out of sight and racing to get in
front of it and stop there in its way. The more that's destroyed, the more of them there
are (up to fourteen), shown as stars under the map and as blue dots on it. They can be
shot or smashed like anything else; when one's hit, its officer jumps out and runs, and
another comes. Switching POLICE off sends them away.

Everything can be destroyed, and how it goes depends on what it's made of:

- **Rock** cracks, then crumbles into rubble, throwing out stones and dust.
- **Trees** split and come down away from the blast, catch fire, and burn to ash. Fire
  spreads through the trees round them, so a forest can go up.
- **Houses and barns** are holed and may catch fire, then collapse into rubble in a cloud
  of dust and bricks, burn, and leave a blackened ruin. A burning building comes down by
  itself.
- **Vehicles and boats** explode (setting off whatever's near: barrels, other cars, the
  fuel depot), then burn out as charred wrecks. Boats sink.
- **Fuel barrels and tanks** go up in a big blast and chain reaction.
- **Haystacks**, **tents** and **crops and long grass** go up in flames. One shot into a
  field or meadow starts a wildfire that runs right across it, and on into the woods if
  they're near, leaving it black (crops the tank has flattened don't burn).
- **Fences, crates, sunshades and log piles** splinter.
- **Ski lift** pylons and stations come down; then the cable falls and the lift stops.
- **Bridges** crack, then fall into the river with a splash (wooden ones also burn
  through). Once one's down, the tank can't cross there and the traffic turns back.

Craters, scorch marks, the tank's tracks and the debris that lands stay on the ground.

The island is alive: waves roll across the sea and surf breaks on the beaches; the trees
sway in the wind, harder in the gusts, and lose the odd leaf; cloud shadows drift over;
smoke rises from the chimneys; flocks of birds fly over (gulls by the sea) and burst out
of the trees when something goes off; campfires flicker and smoke. Villagers walk between
the houses and stop to chat, people stroll on the beaches, sunbathers get up off their
towels and run (and come back and lie down again once it's quiet), sheep and cows graze
round the farms and deer in the woods.
They all scatter from explosions and from the tank, and step out of its way; nobody gets
hurt (rockets fly over them). Cars, trucks and tractors drive the tracks, slowing for the
tank and each other and turning back at the end of the road or when it's blocked, and
boats sail up and down off the coast. They can be blown up like anything else; when one
is hit, the driver jumps out and runs.

`src/tank/README.md` has the details.

## Roadmap

1. ~~One car with drifty handling~~ (done)
2. ~~A track with kerbs, grass that slows you down, and a minimap~~ (done)
3. ~~Checkpoints, laps, lap timer, best lap, wrong-way warning~~ (done)
4. ~~Tyre barriers, collisions with spin and camera shake, knockable cones~~ (done)
5. ~~AI opponents, car-to-car collisions, 3-lap races with grid, countdown, positions and results; time trial mode~~ (done)
6. ~~Polish: skid marks, smoke, sparks, shadows, start lights, sound, start menu, difficulty, pause, Add to Home Screen~~ (done)
7. ~~Procedural tracks: locations, short/medium/long, race setup, saving tracks~~ (done)
8. ~~Locations: Docklands, Woodlands, Downtown, Winter and Desert, natural places with animated scenery, and a race Circuit~~ (done)
9. ~~Tank World: a procedural island to drive a tank round and destroy~~ (done)
10. More locations, car selection, pickups, split-screen
