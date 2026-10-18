# Street Offender: Bristol

A top-down, GTA 1-style game set in Bristol, for the browser (and made to play on a
phone). Built with [Phaser](https://phaser.io), TypeScript and Vite.

Right now it's a car to drive round the middle of Bristol: about a kilometre square
centred on Bristol Cathedral, from Brandon Hill and Park Street down to the Floating
Harbour, Queen Square and Wapping Wharf, built from real map data. Drive on the
roads, pavements and grass, crash into buildings, walls, lamp posts and trees, knock
benches and bins flying, and drive into the harbour if you like (the car sinks, and
you're put back on the road).

Controls: on a phone, the left thumb steers (from wherever it lands) and the right
has GAS, BRAKE (hold it to reverse) and H/BRAKE. On a computer, arrows or WASD,
SPACE for the handbrake, R to reset.

```sh
npm install
npm run dev      # play it locally
npm test         # unit tests
npm run build    # production build into dist/
npm run map      # rebuild the map from OpenStreetMap (see src/map/README.md)
```

`example-code/` holds the code of an earlier game to borrow from (see its README).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database Licence.
