# Deadlock Timers — design brief

## What this is

A single-page fan tool that puts **every Deadlock game timer on one glanceable board**:
jungle boxes/camps, bridge buffs and statue tiers, guardian/walker resistance windows,
urn, rift, mid boss, and trooper wave cadence. It lives on a second monitor during
matches, so it is optimized for **at-a-glance reading from a distance** on a dark screen.

Because the amount of information is overwhelming, the core interaction is **category
toggles**: players start with one category (usually Jungle), memorize it, then layer
more on. The site copy explicitly tells players to build up over time.

## The feel

**"Just another page inside the game."** Everything is derived from Deadlock's own UI
(see `references/` for in-game screenshots and `references/site-screenshot.png` for the
current build):

- Near-black, slightly green charcoal backdrop with soft radial washes of smoky green
  (and a faint rust-red counterweight), overlaid with a very faint compass-web /
  map-ring line pattern and film grain.
- **Bone/cream ink** (`#ece5d4`) — never pure white. Muted warm grays for secondary text.
- One hero accent: **glowing mint green** (`#86efab`) with a soft outer glow
  (text-shadow / box-shadow at ~45% alpha). Used for page titles, the running match
  clock, active toggle knobs, primary buttons, focus rings, and the NOW line.
- Headers are **condensed uppercase** (Oswald; the game uses a grungy condensed display
  face) with generous letter-spacing. Body text is a warm humanist sans (Alegreya Sans).
- Panels are translucent warm-gray cards (`rgba(46,47,40,.55)`) with 1px cream hairline
  borders at ~16% alpha, 10–12px radii, and a whisper of noise texture on top.
- Controls mimic the game: pill toggle switches whose round knob carries a check glyph
  and glows when on; rounded buttons with hairline borders that pick up a mint glow on
  hover; small uppercase stat chips on near-black wells.

## Data colors (validated)

Categorical, one hue per timer category, validated for CVD separation and ≥3:1 contrast
on the `#111512` chart surface (dark band, OKLCH L 0.48–0.67). Category identity is
never color-alone — every lane and card carries a text label.

| Category | Hex |
|---|---|
| Jungle | `#199e70` |
| Powerups | `#c98500` |
| Guardians & Walkers | `#d95926` |
| Urn | `#9085e9` |
| Rift | `#3987e5` |
| Mid Boss | `#d55181` |
| Troopers | `#e66767` |

Resistance ramps are a diverging red→neutral→green gradient (`#c2504a` → `#3a3d38` →
`#3e9e57`): red = "it resists you", green = "it melts". These are polarity colors, not
category colors.

## Page anatomy

1. **Header** — glowing mint title, one-line subtitle, match clock (Start/Pause, ±5s
   nudge, Reset, "next up" readout), round `?` help button.
2. **Hint banner** (dismissible) — tells new users to toggle everything off and build up.
3. **Filter row** — one row of game-style toggle switches, one per category, each tinted
   with its category hue; All/None at the right. State persists in localStorage.
4. **Match Timeline panel** — SVG swimlanes, 0:00–40:00 axis. Solid diamonds = spawns,
   hollow diamonds = breakpoints, translucent bars = durations/phases, hatched band =
   the rift's random spawn window, gradients = resistance ramps. Everything is hoverable
   and keyboard-focusable with a rich tooltip; a mint NOW line tracks the match clock and
   upcoming spawns pulse.
5. **Reference cards** — per-category panels with every number as text (the no-hover
   table view), filtered by the same toggles.
6. **Footer** — credits (Deathy's guide, Deadlock Wiki), Valve disclaimer.

## Rules of thumb

- Dark only. No light mode — the game doesn't have one.
- Text wears ink tokens, never category hues; colored marks sit *beside* text.
- Glow is reserved for the mint accent and interactive feedback; data marks stay matte.
- Never block information behind hover: tooltips elaborate, cards state.
