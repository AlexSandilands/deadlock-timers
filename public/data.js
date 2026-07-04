/* ============================================================
   Deadlock timer data — sourced from Deathy's timer guide
   https://www.youtube.com/watch?v=YHc-NMmPjHg
   All times are minutes (decimal). 1:25 -> 1 + 25/60.
   ============================================================ */

const T_MAX = 40;   // width of the visible timeline window in minutes
const GEN_MAX = 120; // how far out to generate clock-based spawns (long games scroll)

// bump this whenever patch changes move the numbers
const DATA_UPDATED = 'July 4, 2026';

const mmss = (min) => {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// repeating clock-based spawns: start, then every `step`, out to GEN_MAX
const every = (start, step, tmax = GEN_MAX) => {
  const out = [];
  for (let t = start; t <= tmax; t += step) out.push(t);
  return out;
};

/* ---------- categories (filter toggles) ---------- */

const CATEGORIES = {
  jungle: {
    name: 'Jungle',
    color: '#199e70',
    blurb: 'Boxes, statues & neutral camps',
  },
  powerups: {
    name: 'Powerups',
    color: '#c98500',
    blurb: 'Bridge buffs & golden statue tiers',
  },
  objectives: {
    name: 'Guardians & Walkers',
    color: '#d95926',
    blurb: 'Damage-resistance windows',
  },
  urn: {
    name: 'Urn',
    color: '#9085e9',
    blurb: 'Soul Urn spawns & sides',
  },
  rift: {
    name: 'Rift',
    color: '#3987e5',
    blurb: 'Spawn window & respawn',
  },
  midboss: {
    name: 'Mid Boss',
    color: '#d55181',
    blurb: 'Respawns & Rejuvenator',
  },
  troopers: {
    name: 'Troopers',
    color: '#e66767',
    blurb: 'Wave cadence & scaling',
  },
};

const CATEGORY_ORDER = ['jungle', 'powerups', 'objectives', 'urn', 'rift', 'midboss', 'troopers'];

/* ---------- timeline rows ----------
   Row features the renderer understands:
   - marks:    [{t, kind:'spawn'|'break', label?, sub?, tip:[...]}]
   - washes:   [{from, to}]              translucent uptime bar (buff duration)
   - segments: [{from, to, label}]       labelled band (trooper cadence, statue tiers)
   - window:   {from, to, label}         hatched spawn window (rift)
   - gradient: {from, to, stops:[{t,label}]}  resistance ramp, red -> neutral -> green
   - cadence:  string                    "respawns ..." chip shown by the lane label
   - tip:      [...]                     fallback lane tooltip lines
--------------------------------------------------- */

const ROWS = [
  /* ---- Jungle (ordered by first spawn) ---- */
  {
    id: 'camps', cat: 'jungle', name: 'Camps',
    cadence: '↻ T1 1:25 · T2 4:50 · T3 5:35',
    marks: [
      {
        t: 2, kind: 'spawn', label: '2:00', sub: 'T1',
        tip: [
          'Tier 1 camps first spawn at 2:00.',
          'Respawn 1:25 after the camp is FULLY cleared — kill it right at 2:00 and it’s back ~3:25.',
          'Leave even one creature alive and the respawn timer never starts.',
        ],
      },
      {
        t: 5, kind: 'spawn', label: '5:00', sub: 'T2',
        tip: [
          'Tier 2 camps first spawn at 5:00. Respawn 4:50 after a full clear.',
          'Mixed camps always use the HIGHER tier’s spawn & respawn timing.',
        ],
      },
      {
        t: 8, kind: 'spawn', label: '8:00', sub: 'T3',
        tip: [
          'Tier 3 camps first spawn at 8:00. Respawn 5:35 after a full clear.',
          'A camp with even one tier-3 creature counts as tier 3 — it spawns at 8:00 and respawns every 5:35.',
        ],
      },
    ],
    tip: ['Neutral camps. T1 at 2:00 (↻ 1:25), T2 at 5:00 (↻ 4:50), T3 at 8:00 (↻ 5:35) — all after a full clear.'],
  },
  {
    id: 'boxes', cat: 'jungle', name: 'Boxes & statues',
    cadence: '↻ 3:00 after broken',
    marks: [
      {
        t: 3, kind: 'spawn', label: '3:00', sub: 'MAP',
        tip: [
          'All boxes across the map — including the golden statues — spawn at 3:00.',
          'Each respawns 3:00 after it’s broken (clear-based, not on the game clock).',
        ],
      },
      {
        t: 10, kind: 'spawn', label: '10:00', sub: 'MID',
        tip: [
          'The mid boxes appear later than the rest — first spawn at 10:00, then respawn every 3:00 after broken.',
          'On average they pay MORE than a Sinner’s Sacrifice. If you’re mid with nothing to do, hit them every 3 minutes.',
        ],
      },
    ],
    tip: ['Boxes & golden statues at 3:00, mid boxes at 10:00 — all respawn 3:00 after broken.'],
  },
  {
    id: 'sinners', cat: 'jungle', name: "Sinner's Sacrifice",
    cadence: '↻ 5:00 after clear',
    marks: [
      {
        t: 8, kind: 'spawn', label: '8:00',
        tip: [
          'Sinners spawn at 8:00 and respawn 5:00 after a FULL clear.',
          'At the double sinners, the little neutral counts too — leave it alive and the respawn timer never starts.',
          'Clearing enemy sinners? Leave the small neutral to delay their respawn.',
        ],
      },
      {
        t: 50, kind: 'break', label: '50:00', sub: '♥', title: 'A message from the jungle',
        tip: [
          'I’m so sorry if you’re in game and reading this. It will be okay.',
          'Probably.',
        ],
      },
      {
        t: 60, kind: 'break', label: '60:00', sub: 'GRASS', title: 'Mandatory self-care',
        tip: [
          'Please take a 5-minute break after this one — for your mental health.',
          'Touch a bit of grass. Drink a cup of tea. The souls will still be there tomorrow.',
        ],
      },
    ],
    tip: ['Spawn 8:00, respawn 5:00 after a full clear (small neutral included).'],
  },
  /* ---- Powerups ---- */
  {
    id: 'bridgebuffs', cat: 'powerups', name: 'Bridge buffs',
    cadence: 'on the clock · every 5:00',
    marks: every(5, 5).map((t) => ({
      t, kind: 'spawn', label: mmss(t),
      tip: [
        `Bridge buff spawns at ${mmss(t)} — on the game clock, whether or not the previous one was taken.`,
        'Buff lasts 160s (2:40), shown by the bar — slightly over 50% uptime if you take it off cooldown.',
        'It may or may not still be running for the first Rift fight, depending on where in the 11:00–13:00 window the Rift lands.',
      ],
    })),
    washes: every(5, 5).map((t) => ({ from: t, to: t + 160 / 60 })),
    tip: ['Spawn 5:00, then every 5:00 on the clock. Buff lasts 2:40.'],
  },
  {
    id: 'statues', cat: 'powerups', name: 'Statue buff tiers',
    cadence: 'upgrades on the clock',
    segments: [
      { from: 0, to: 10, label: 'Tier 0' },
      { from: 10, to: 30, label: 'Tier 1' },
      { from: 30, to: Infinity, label: 'Tier 2' },
    ],
    marks: [
      {
        t: 10, kind: 'break', label: '10:00',
        tip: [
          'Golden statue buffs upgrade at 10:00 (e.g. the HP buff: 15 → 20).',
          'This is an on/off breakpoint, not gradual — which is why people pop the egg at exactly 10:00.',
        ],
      },
      {
        t: 30, kind: 'break', label: '30:00',
        tip: [
          'Second upgrade at 30:00 (HP buff: 20 → 30).',
          'Holding the egg to 30:00 gives very strong buffs — a little troll, but funny.',
        ],
      },
    ],
    tip: ['Statue buffs upgrade at 10:00 and 30:00 (HP example: 15 → 20 → 30).'],
  },

  /* ---- Guardians & Walkers ---- */
  {
    id: 'guardians', cat: 'objectives', name: 'Guardians',
    cadence: 'resist scales 0:00 → 12:00',
    gradient: {
      from: 0, to: 12,
      stops: [
        { t: 0, label: '50% resist' },
        { t: 3, label: '25%' },
        { t: 6, label: '0%' },
        { t: 9, label: '+25% dmg' },
        { t: 12, label: '+50% dmg' },
      ],
    },
    tip: [
      'Guardians are up from 0:00, but their damage resistance scales continuously: 50% resist at 0:00 → −50% (they take +50% damage) at 12:00.',
      'Breakpoints: 3:00 = 25%, 6:00 = 0% (the game expects guardian kills to start here), 9:00 = +25% damage taken.',
      'The early resistance can’t be bypassed. Past 12:00, guardians are a complete joke.',
    ],
  },
  {
    id: 'walkers', cat: 'objectives', name: 'Walkers',
    cadence: 'resist scales 0:00 → 18:00',
    gradient: {
      from: 0, to: 18,
      stops: [
        { t: 0, label: '65% resist' },
        { t: 9, label: '0%' },
        { t: 18, label: '+65% dmg' },
      ],
    },
    tip: [
      'Walkers scale from 65% resist at 0:00 to −65% at 18:00 (continuous). 0% lands around 9:00 — the first realistic window; past 12:00 they’re easy with a strong wave.',
      'On top of that, walkers always have 35% bullet resist and 0% spirit resist.',
      'Sustained spirit damage (Seven, Sinclair bolts) shreds walkers.',
    ],
  },

  /* ---- Urn ---- */
  {
    id: 'urn', cat: 'urn', name: 'Soul Urn',
    cadence: 'on the clock · every 5:00',
    marks: every(10, 5).map((t) => {
      const yellow = (t / 5) % 2 === 0; // 10, 20, 30, 40 = yellow; 15, 25, 35 = green
      return {
        t, kind: 'spawn', label: mmss(t), sub: yellow ? 'YLW' : 'GRN',
        tip: [
          `Urn spawns at ${mmss(t)} on the ${yellow ? 'YELLOW' : 'GREEN'} side.`,
          'Respawns every 5:00 on the clock, done or not. Only exception: if someone is holding the urn at spawn time, that spawn is skipped.',
          'Pattern: first urn yellow, then alternating. Even tens (10, 20, 30) = yellow, odd fives (15, 25, 35) = green — a skipped spawn breaks the pattern.',
        ],
      };
    }),
    tip: ['Spawns 10:00, then every 5:00 on the clock. Yellow/green alternating.'],
  },

  /* ---- Rift ---- */
  {
    id: 'rift', cat: 'rift', name: 'Rift',
    cadence: '↻ ~7:00 after clear',
    shiftable: {
      steps: [7],
      hint: 'Click when the Rift dies → projects the next spawn (+7:00). Alt-click to reset.',
    },
    window: { from: 11, to: 13, label: 'spawn window' },
    marks: [{
      t: 12, kind: 'spawn', label: '12:00 ± 1:00',
      tip: [
        'The Rift spawns at 12:00 ± 1:00 — anywhere between 11:00 and 13:00.',
        'Respawns ~7:00 after being cleared (believed to be exactly 7:00, still being verified).',
        'First side is random; later spawns appear to alternate sides (not 100% confirmed).',
      ],
    }],
    tip: ['Spawns between 11:00 and 13:00, respawns ~7:00 after clear.'],
  },

  /* ---- Mid Boss ---- */
  {
    id: 'midboss', cat: 'midboss', name: 'Mid Boss',
    cadence: '↻ 7:00 → 6:00 → 5:00 per kill',
    shiftable: {
      steps: [7, 6, 5],
      hint: 'Click when Mid Boss dies → projects the respawn (7:00 / 6:00 / 5:00 by your team’s kill count) and starts the 3:00 Rejuvenator bar. Alt-click to reset.',
    },
    marks: [{
      t: 0, kind: 'spawn', label: '0:00',
      tip: [
        'Mid Boss is up immediately at 0:00 — a recent change; it used to spawn at 10:00.',
        'Respawn shortens per kill (per team): after your 1st kill → 7:00, after your 2nd → 6:00, 3rd and beyond → 5:00 (never faster).',
      ],
    }],
    tip: ['Up at 0:00. Respawns 7:00 / 6:00 / 5:00 after your 1st / 2nd / 3rd+ kill.'],
  },
  {
    id: 'rejuv', cat: 'midboss', name: 'Rejuvenator',
    cadence: 'buff lasts 3:00',
    ruler: { len: 3, label: '3:00 from pickup' },
    tip: [
      'The Rejuvenator buff lasts 3:00 from pickup — recently reduced from 4:00.',
      '(Bar shows duration, not a clock time.)',
    ],
  },

  /* ---- Troopers ---- */
  {
    id: 'troopers', cat: 'troopers', name: 'Trooper waves',
    cadence: 'cadence shifts at 20:00 & 35:00',
    segments: [
      { from: 0, to: 20, label: 'every 30s' },
      { from: 20, to: 35, label: 'every 25s' },
      { from: 35, to: Infinity, label: 'every 20s' },
    ],
    marks: [
      {
        t: 20, kind: 'break', label: '20:00',
        tip: [
          'From 20:00, trooper waves spawn every 25s (was 30s).',
          'Trooper spirit resist also scales with time: ~20% at 20:00, up to 70% by 50:00.',
        ],
      },
      {
        t: 35, kind: 'break', label: '35:00',
        tip: [
          'From 35:00, waves spawn every 20s — the game wants this over.',
          'At exactly 35:00 every trooper instantly gets +50% HP and a bigger model. This one is on/off, not gradual.',
        ],
      },
    ],
    tip: ['Waves every 30s → 25s (20:00) → 20s (35:00). +50% HP at 35:00.'],
  },
];

/* ---------- reference cards (the always-readable table view) ---------- */

const CARDS = {
  jungle: [
    { name: 'Tier 1 camps', stats: [['Spawn', '2:00'], ['Respawn', '1:25 after clear']], notes: ['Camp must be fully cleared or the respawn timer never starts.'] },
    { name: 'Boxes & golden statues', stats: [['Spawn', '3:00'], ['Respawn', '3:00 after broken']], notes: [] },
    { name: 'Tier 2 camps', stats: [['Spawn', '5:00'], ['Respawn', '4:50 after clear']], notes: ['Mixed camps use the higher tier’s timing.'] },
    { name: 'Tier 3 camps', stats: [['Spawn', '8:00'], ['Respawn', '5:35 after clear']], notes: ['One tier-3 creature makes the whole camp tier 3.'] },
    { name: 'Sinner’s Sacrifice', stats: [['Spawn', '8:00'], ['Respawn', '5:00 after clear']], notes: ['At double sinners, kill the small neutral too — or nothing respawns.', 'Taking enemy sinners? Leave their neutral alive to delay the respawn.'] },
    { name: 'Mid boxes', stats: [['Spawn', '10:00'], ['Respawn', '3:00 after broken']], notes: ['Pay more than a sinner sacrifice on average — do them every 3 minutes.'] },
  ],
  powerups: [
    { name: 'Bridge buffs', stats: [['Spawn', '5:00'], ['Respawn', 'every 5:00 (clock)'], ['Duration', '2:40 (160s)']], notes: ['Respawns whether or not the previous buff was taken — 5, 10, 15, 20…', '~50%+ uptime if taken off cooldown.', 'May or may not last into the first Rift fight, depending on where the Rift lands in its window.'] },
    { name: 'Golden statue buffs', stats: [['Tier 0', '0:00'], ['Tier 1', '10:00'], ['Tier 2', '30:00']], notes: ['Upgrades are on/off breakpoints (HP buff: 15 → 20 → 30).', 'Standard: pop the egg at 10:00. Holding to 30:00 is greedy but huge.'] },
  ],
  objectives: [
    { name: 'Guardians', stats: [['0:00', '50% resist'], ['3:00', '25% resist'], ['6:00', '0% — full damage'], ['9:00', '+25% dmg taken'], ['12:00', '+50% dmg taken']], notes: ['Scales continuously every second — these are just breakpoints.', 'The early resistance cannot be bypassed.'] },
    { name: 'Walkers', stats: [['0:00', '65% resist'], ['~9:00', '0% — full damage'], ['18:00', '+65% dmg taken']], notes: ['Always 35% bullet resist, 0% spirit resist.', 'Sustained spirit damage (Seven, Sinclair) shreds them.', 'Past 12:00 they fall fast with a strong wave.'] },
  ],
  urn: [
    { name: 'Soul Urn', stats: [['Spawn', '10:00'], ['Respawn', 'every 5:00 (clock)'], ['Sides', 'yellow → green, alternating']], notes: ['Respawns done or not. Skipped only if someone is holding it at spawn time.', 'Even tens (10, 20, 30) = yellow · odd fives (15, 25, 35) = green.', 'A skipped spawn breaks the color pattern.'] },
  ],
  rift: [
    { name: 'Rift', stats: [['Spawn', '12:00 ± 1:00'], ['Window', '11:00 – 13:00'], ['Respawn', '~7:00 after clear']], notes: ['Respawn believed to be exactly 7:00 (still being verified).', 'First side random; later spawns appear to alternate sides.'] },
  ],
  midboss: [
    { name: 'Mid Boss', stats: [['Spawn', '0:00 (up at start)'], ['After 1st kill', '7:00'], ['After 2nd kill', '6:00'], ['3rd kill onward', '5:00']], notes: ['Up at 0:00 is a recent change — it used to spawn at 10:00 (verified vs the wiki).', 'Respawn time is per team kill count and never drops below 5:00.'] },
    { name: 'Rejuvenator', stats: [['Duration', '3:00']], notes: ['Recently reduced from 4:00.'] },
  ],
  troopers: [
    { name: 'Wave cadence', stats: [['0:00 – 20:00', 'every 30s'], ['20:00 – 35:00', 'every 25s'], ['35:00+', 'every 20s']], notes: [] },
    { name: 'Trooper scaling', stats: [['Spirit resist', '~20% @ 20:00 → 70% @ 50:00'], ['35:00', '+50% HP, instantly']], notes: ['The HP jump is on/off at exactly 35:00 (they grow in size too); spirit resist scales gradually.'] },
  ],
};
