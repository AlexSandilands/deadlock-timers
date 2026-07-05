# Deadlock Timers

A glanceable, filterable timer board for the game *Deadlock* — a match timeline (0:00–40:00)
with category toggles, a live match clock, and click-to-project respawns. Built as a
zero-build static site for use on a second monitor. Deployed at deadlocktimers.com.

## Stack & layout

Vanilla JS + SVG, no framework, no build step. Everything lives in `public/`:

- `public/index.html` — page shell and static markup.
- `public/data.js` — all timer data (camps, buffs, objectives, troopers) and categories.
  This is the file to edit when the game patches change timings. Times are in **decimal
  minutes** (1:25 → `1 + 25/60`); `mmss()` and `every()` helpers convert/generate.
- `public/app.js` — all behavior. Renders the SVG timeline (`renderTimeline`), filter
  toggles (`renderFilters`), reference cards (`renderCards`), and the match clock
  (`initClock` / `updateNow`). Filter state persists in localStorage.
- `public/styles.css` — styling, themed after the in-game UI.

`npm start` serves `public/` via `serve`.

## Running locally

No build — it's a static site:

```sh
npx serve public          # or: python -m http.server 8641 --directory public
```

## Conventions

- **Editing timings:** change values in `public/data.js` and bump `DATA_UPDATED`.
- **No dependencies beyond `serve`** — keep it a plain static site; don't introduce a
  build step or framework.
- **Verifying visual changes:** headless browsers are flaky in this environment. Ask the
  user to eyeball localhost rather than trying to screenshot it yourself.
