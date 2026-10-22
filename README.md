# Street Offender: Bristol

A top-down, GTA 1-style game set in Bristol, for the browser (and made to play on a
phone). Built with [Phaser](https://phaser.io), TypeScript and Vite.

Right now it's an armoured truck to drive round the middle of Bristol: about three kilometres
square, from Clifton, Cotham and Stokes Croft in the north, through the University,
Park Street, the cathedral, Broadmead and Old Market, across the Floating Harbour to
Hotwells, Spike Island, Redcliffe and Temple Meads, and down to Ashton Gate,
Southville and Bedminster in the south, built from real map data, hills and all. Drive on the
roads, pavements and grass (the truck takes grass, dirt and mud almost as easily as the road; up Park Street's hill slower, down it faster), crash into buildings, walls, lamp posts and trees, knock
benches and bins flying, and drive into the harbour if you like (it sinks, and
you're put back on the road). The drops are real, measured from the survey: drive
off a quay, a retaining wall, the side of the Bear Pit or a bridge (once you've
knocked its parapet down) and you fall, and land with a thump (or a splash); come
at one from below and it's a wall. The truck's heavy and armour-plated: it goes through
walls, fences, lamp posts and trees, shoves cars out of its way, and takes a lot to
dent.

Get out (stopped, or nearly) and walk about, and get into anything you're beside:
a parked car, your truck where you left it, a bike lying on the ground, or a car,
van, lorry, bus or bike going past (its driver's pulled out, and runs). Each drives
as it would: a bus is slow to get going and to turn, a bike's quick off the mark but
tops out at a cyclist's speed (hit something hard on one and you come off). What
you get out of is left where it is, damage and all (the traffic goes round it).

Controls: on a phone, the left thumb steers (from wherever it lands) and the right
has GAS, BRAKE (hold it to reverse), H/BRAKE, and GET OUT / GET IN (lit when there's
something to get into within reach). On foot, steering turns you, GAS runs and BRAKE
steps back. On a computer, arrows or WASD, SPACE for the handbrake, F (or E) to get
out or in, R to reset.

Pause (the II button at the top left, or P or ESC) to stop everything: RESUME, or
MAP, a map of the whole of Bristol showing where you are. Drag it about, pinch (or
scroll, or + and −) to zoom, tap where you want to be, and GO: you're put down on
the road there, in whatever you're driving (or on foot).

```sh
npm install
npm run dev      # play it locally
npm test         # unit tests
npm run build    # production build into dist/
npm run map      # rebuild the map from OpenStreetMap (see src/map/README.md)
```

Add `?perf` to the address (e.g. `…/?perf`) for a read-out over the game of how smoothly it's
running: frames a second, the longest frame in the last second and how many were over 25 ms,
and the slowest parts of each frame (physics, traffic, people, trains, ground, buildings,
props, sprites, Phaser's own step and rendering), each one's average and longest, ms.

`example-code/` holds the code of an earlier game to borrow from (see its README).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database Licence. Heights and trees from the Environment
Agency's LIDAR: contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
