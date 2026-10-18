# Notes for working on this game

Street Offender: Bristol: a top-down GTA 1-style game set in Bristol.

- The owner plays it on an iPhone (deployed by Vercel from `main`). Commit and push
  straight to `main`; no pull requests.
- Phone first: landscape, touch controls (thumb sticks and buttons), and it has to run
  smoothly on an iPhone. Check it at iPhone size (e.g. Playwright's "iPhone 13 landscape").
- All art is drawn in code (no image files), apart from the home-screen icons in
  `public/`. `npm test` runs the unit tests.
- `example-code/2d-racer/` is a complete copy of the owner's earlier game, 2D Racer (a
  top-down racer with a procedural city, and Tank World). It's there to borrow code and
  ideas from: copy what's useful into `src/` and adapt it there; don't import from it
  or change it. It isn't built or tested here. `example-code/README.md` says where
  things are.
- The map is real Bristol, from OpenStreetMap: see `src/map/README.md`. Keep the
  "© OpenStreetMap contributors" credit on screen.
