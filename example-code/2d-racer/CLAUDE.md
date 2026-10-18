# Notes for working on this game

- The owner plays it on an iPhone (deployed by Vercel from `main`). Commit and push
  straight to `main`; no pull requests.
- Docklands, Woodlands, Downtown, Winter and Desert are natural environments, not race circuits. Don't add
  race-day things (grandstands, crowds, marshals, banners, start gantries, pits,
  advertising boards, painted kerbs and the like) to them, or to any new location,
  unless specifically asked. The Circuit location is the one that has them:
  everything for it lives in `src/circuit/` (see its README).
- Everything on the road must be loose (knockable); fixed things only go off it.
- Track changes during a race (skid marks, knocked obstacles) last the whole race and
  reset for each new race.
- Track difficulty shapes the track only; how good the AI is comes from AI difficulty.
- Tank World (`src/tank/`, TANK WORLD on the home menu) is a separate game: a
  procedural island to drive a tank round and blow up. See its README.
- All art is drawn in code (no image files). `npm test` runs the unit and AI race tests.
