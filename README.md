# Street Offender: Bristol

A top-down, GTA 1-style game set in Bristol, for the browser (and made to play on a
phone). Built with [Phaser](https://phaser.io), TypeScript and Vite.

Right now it's a car to drive round the middle of Bristol: about three kilometres
square, from Clifton, Cotham and Stokes Croft in the north, through the University,
Park Street, the cathedral, Broadmead and Old Market, across the Floating Harbour to
Hotwells, Spike Island, Redcliffe and Temple Meads, and down to Ashton Gate,
Southville and Bedminster in the south, built from real map data, hills and all. Drive on the
roads, pavements and grass (up Park Street's hill slower, down it faster), crash into buildings, walls, lamp posts and trees, knock
benches and bins flying, and drive into the harbour if you like (the car sinks, and
you're put back on the road).

Get out (stopped, or nearly) and walk about, and get into anything you're beside:
a parked car, your own car where you left it, a bike lying on the ground, or a car,
van, lorry, bus or bike going past (its driver's pulled out, and runs). Each drives
as it would: a bus is slow to get going and to turn, a bike's quick off the mark but
tops out at a cyclist's speed (hit something hard on one and you come off). What
you get out of is left where it is, damage and all (the traffic goes round it).

Controls: on a phone, the left thumb steers (from wherever it lands) and the right
has GAS, BRAKE (hold it to reverse), H/BRAKE, and GET OUT / GET IN (lit when there's
something to get into within reach). On foot, steering turns you, GAS runs and BRAKE
steps back. On a computer, arrows or WASD, SPACE for the handbrake, F (or E) to get
out or in, R to reset.

```sh
npm install
npm run dev      # play it locally
npm test         # unit tests
npm run build    # production build into dist/
npm run map      # rebuild the map from OpenStreetMap (see src/map/README.md)
```

`example-code/` holds the code of an earlier game to borrow from (see its README).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database Licence. Heights and trees from the Environment
Agency's LIDAR: contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
