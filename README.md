# Deadlock Timers

Every Deadlock game timer on one glanceable board — built for a second monitor while
you play. Jungle boxes & camps, bridge buffs & statue tiers, guardian/walker
resistance windows, urn, rift, mid boss, and trooper wave cadence.

Because that's a *lot*, the board is filterable: toggle categories on one at a time
as you memorize them (start with Jungle, layer the rest in later). Toggles persist
between visits. There's also a match clock — hit Start at the horn and the board
shows a NOW line, pulses anything spawning in the next 45 seconds, and lists what's
coming up.

## Run locally

No build step — it's a static site.

```sh
npx serve public          # or: python -m http.server 8641 --directory public
```

## Deploy on Railway

The repo is Railway-ready: Nixpacks detects `package.json` and runs `npm start`,
which serves `public/` on `$PORT`.

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** and pick it.
3. Done — no variables or config needed.

## Project layout

```
public/           the site (index.html, styles.css, app.js, data.js)
design/           design-system bundle, synced to the "Deadlock Timers"
                  project on claude.ai/design (brief, tokens, component previews)
assets/           in-game UI screenshots used as design references
deathy-transcript.txt   source for all timer numbers
```

## Data sources

Timings from [Deathy's timer guide](https://www.youtube.com/watch?v=YHc-NMmPjHg) and
the Deadlock Wiki. Valve moves numbers between patches — update `public/data.js`
(everything is data-driven: marks, segments, gradients, windows, and the reference
cards all live there).

Deadlock is a trademark of Valve Corporation. Unofficial fan tool; not affiliated
with or endorsed by Valve.
