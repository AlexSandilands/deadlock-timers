/* ============================================================
   Deadlock Timers — timeline renderer, filters, match clock
   ============================================================ */

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (sel, el = document) => el.querySelector(sel);

const STORE_FILTERS = 'dl-timers.filters.v1';
const STORE_HINT = 'dl-timers.hint-dismissed.v1';
const STORE_AUDIO = 'dl-timers.audio.v1';

/* ---------------- state ---------------- */

const state = {
  filters: loadFilters(),
  audio: loadAudio(),
  clock: { running: false, anchor: 0, offset: 0 }, // offset in seconds
  shifts: {}, // per shiftable row: { count, t } — click-projected respawns
  rejuvFrom: null, // set when Mid Boss is clicked: rejuvenator pickup time (minutes)
  viewStart: 0, // left edge of the 40-min viewport; steps forward in long games
  scrubbing: false,
};

function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_FILTERS));
    if (saved && typeof saved === 'object') {
      const out = {};
      for (const id of CATEGORY_ORDER) out[id] = saved[id] !== false;
      return out;
    }
  } catch (_) { /* fresh visit */ }
  return Object.fromEntries(CATEGORY_ORDER.map((id) => [id, true]));
}
function saveFilters() {
  localStorage.setItem(STORE_FILTERS, JSON.stringify(state.filters));
}

/* ---------------- audio cues ---------------- */

function loadAudio() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_AUDIO));
    if (s && typeof s === 'object') {
      return {
        muted: !!s.muted,
        volume: typeof s.volume === 'number' ? Math.min(2, Math.max(0, s.volume)) : 1,
        lanes: (s.lanes && typeof s.lanes === 'object') ? s.lanes : {},
        custom: Array.isArray(s.custom) ? s.custom : [],
      };
    }
  } catch (_) { /* fresh visit */ }
  return { muted: false, volume: 1, lanes: {}, custom: [] };
}
function saveAudio() { localStorage.setItem(STORE_AUDIO, JSON.stringify(state.audio)); }

/* a lane's cue flags — absent means all off */
function laneCues(id) {
  return state.audio.lanes[id] || { pre: false, count: false, start: false };
}
function cuesAnyOn(c) { return !!(c && (c.pre || c.count || c.start)); }

/* -- Web Audio: synthesize tones so we ship no audio assets -- */
let audioCtx = null;
function audioUnlock() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, ms, { type = 'sine', peak = 0.18, glideTo = null, delay = 0 } = {}) {
  const ctx = audioUnlock();
  if (!ctx) return;
  const vol = state.audio.volume == null ? 1 : state.audio.volume;
  const level = peak * vol;
  if (level < 0.0005) return; // silent — also avoids an exponential ramp to 0
  const t0 = ctx.currentTime + delay;
  const dur = ms / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(level, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}
/* three distinct cues */
function cuePre() { tone(430, 320, { type: 'sine', peak: 0.16, glideTo: 560 }); }   // rising "get ready"
function cueBlip() { tone(620, 110, { type: 'triangle', peak: 0.15 }); }             // tick · tick · tick
function cueStart() {                                                                // bright two-note ding
  tone(880, 150, { type: 'sine', peak: 0.2 });
  tone(1245, 300, { type: 'sine', peak: 0.2, delay: 0.11 });
}
const CUE_SOUND = { pre: cuePre, count: cueBlip, start: cueStart };

/* -- event times per lane, straight from the data (independent of filters) -- */
function laneEventTimes(row) {
  const shift = row.shiftable ? state.shifts[row.id] : null;
  if (shift && shift.count > 0 && shift.t != null) return [shift.t]; // follow the projection
  const out = [];
  if (row.marks) for (const m of row.marks) out.push(m.t);
  if (row.gradient) for (const s of row.gradient.stops) out.push(s.t);
  return out;
}
function audioEvents() {
  const evs = [];
  for (const row of ROWS) {
    const c = state.audio.lanes[row.id];
    if (!cuesAnyOn(c)) continue;
    for (const t of laneEventTimes(row)) evs.push({ sec: t * 60, cues: c });
  }
  for (const node of state.audio.custom) {
    if (!cuesAnyOn(node.cues)) continue;
    evs.push({ sec: node.t * 60, cues: node.cues });
  }
  return evs;
}

/* -- firing tick: sound once as the running clock crosses each cue time.
      Scrub/nudge jumps the clock, so only fire on small forward steps —
      otherwise silently re-baseline so a seek never machine-guns the cues. -- */
let lastAudioSec = null;
function audioTick() {
  const c = state.clock;
  if (!c.running || state.audio.muted) { lastAudioSec = null; return; }
  const now = clockSeconds();
  if (lastAudioSec == null || now < lastAudioSec || now - lastAudioSec > 1.5) {
    lastAudioSec = now;
    return;
  }
  const lo = lastAudioSec;
  const crossed = (target) => target > lo && target <= now;
  for (const ev of audioEvents()) {
    if (ev.cues.pre && crossed(ev.sec - 30)) cuePre();
    if (ev.cues.count) for (let k = 5; k >= 1; k--) if (crossed(ev.sec - k)) cueBlip();
    if (ev.cues.start && crossed(ev.sec)) cueStart();
  }
  lastAudioSec = now;
}

/* -- cue-config popover (shared by lanes and, later, custom nodes) -- */
const CUE_META = [
  ['pre', 'Pre-event ding', '−30s'],
  ['count', 'Countdown beeps', '−5s'],
  ['start', 'Start ding', 'on time'],
];
const audioPop = document.createElement('div');
audioPop.className = 'audio-pop';
document.body.appendChild(audioPop);
let audioPopOpen = false;

function onPopDismiss(e) {
  if (e.type === 'keydown') { if (e.key === 'Escape') closeCuePopover(); return; }
  if (!audioPop.contains(e.target)) closeCuePopover();
}
function closeCuePopover() {
  if (!audioPopOpen) return;
  audioPopOpen = false;
  audioPop.classList.remove('show');
  document.removeEventListener('pointerdown', onPopDismiss, true);
  document.removeEventListener('keydown', onPopDismiss, true);
}
function openCuePopover(anchorRect, opts) {
  // opts: { title, cues, onToggle(cue, on), footer? }
  audioUnlock(); // prime audio on the gesture that opened this
  audioPop.replaceChildren();

  const head = document.createElement('div');
  head.className = 'ap-head';
  head.textContent = opts.title;
  audioPop.appendChild(head);

  for (const [cue, label, when] of CUE_META) {
    const row = document.createElement('label');
    row.className = 'ap-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!opts.cues[cue];
    cb.addEventListener('change', () => {
      opts.onToggle(cue, cb.checked);
      if (cb.checked) CUE_SOUND[cue](); // preview the sound you just armed
    });
    const txt = document.createElement('span');
    txt.textContent = label;
    const em = document.createElement('em');
    em.textContent = when;
    row.append(cb, txt, em);
    audioPop.appendChild(row);
  }
  if (opts.footer) audioPop.appendChild(opts.footer);

  audioPop.classList.add('show');
  const r = audioPop.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  if (left + r.width > innerWidth - 8) left = innerWidth - 8 - r.width;
  if (top + r.height > innerHeight - 8) top = anchorRect.top - r.height - 6;
  audioPop.style.left = `${Math.max(8, left)}px`;
  audioPop.style.top = `${Math.max(8, top)}px`;

  audioPopOpen = true;
  // defer listener attach so the opening click doesn't immediately dismiss it
  setTimeout(() => {
    document.addEventListener('pointerdown', onPopDismiss, true);
    document.addEventListener('keydown', onPopDismiss, true);
  }, 0);
}

function openLanePopover(row, glyph, anchorRect) {
  openCuePopover(anchorRect, {
    title: row.name,
    cues: laneCues(row.id),
    onToggle: (cue, on) => {
      const c = state.audio.lanes[row.id]
        || (state.audio.lanes[row.id] = { pre: false, count: false, start: false });
      c[cue] = on;
      if (!cuesAnyOn(c)) delete state.audio.lanes[row.id];
      saveAudio();
      glyph.classList.toggle('on', cuesAnyOn(state.audio.lanes[row.id]));
    },
  });
}

/* small speaker icon drawn in the timeline gutter, one per lane */
function speakerGlyph(parent, gx, gy, on) {
  const g = svgEl('g', {
    class: `lane-audio${on ? ' on' : ''}`, transform: `translate(${gx},${gy})`,
    tabindex: '0', role: 'button',
  }, parent);
  svgEl('path', { d: 'M1 5 H4 L9 1 V13 L4 9 H1 Z', class: 'spk-body' }, g);
  // both states are drawn; CSS shows the sound waves when armed, the cross when off
  svgEl('path', { d: 'M11 4 Q13.4 7 11 10', class: 'spk-wave', fill: 'none' }, g);
  svgEl('path', { d: 'M13.6 2 Q17.8 7 13.6 12', class: 'spk-wave', fill: 'none' }, g);
  svgEl('line', { x1: 11, y1: 4, x2: 16, y2: 10, class: 'spk-x' }, g);
  svgEl('line', { x1: 16, y1: 4, x2: 11, y2: 10, class: 'spk-x' }, g);
  svgEl('rect', { x: -4, y: -4, width: 26, height: 22, fill: 'transparent' }, g); // hit target
  return g;
}

/* header mute button */
const ICON_SOUND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.7 6a8 8 0 0 1 0 12"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

function initAudio() {
  const btn = $('#audio-mute');
  const paint = () => {
    btn.innerHTML = state.audio.muted ? ICON_MUTED : ICON_SOUND;
    btn.setAttribute('aria-pressed', String(!state.audio.muted));
    btn.title = state.audio.muted ? 'Audio cues muted — click to enable' : 'Audio cues on — click to mute';
    btn.classList.toggle('muted', state.audio.muted);
  };
  btn.addEventListener('click', () => {
    state.audio.muted = !state.audio.muted;
    saveAudio();
    if (!state.audio.muted) audioUnlock();
    paint();
  });
  paint();

  const slider = $('#vol-slider'); // slider 0–100, volume 0–2 (50 = the old ceiling)
  slider.value = String(Math.round(state.audio.volume * 50));
  slider.addEventListener('input', () => {
    state.audio.volume = Number(slider.value) / 50;
    saveAudio();
  });
  slider.addEventListener('change', () => { audioUnlock(); cueBlip(); }); // preview level on release
}

/* ---------------- tooltip ---------------- */

const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
tooltip.setAttribute('role', 'tooltip');
document.body.appendChild(tooltip);

function tooltipShow({ title, color, time, lines }, x, y) {
  tooltip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tt-head';
  const key = document.createElement('span');
  key.className = 'key';
  key.style.background = color;
  head.appendChild(key);
  head.appendChild(document.createTextNode(title));
  if (time) {
    const t = document.createElement('span');
    t.className = 'tt-time';
    t.textContent = time;
    head.appendChild(t);
  }
  tooltip.appendChild(head);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    tooltip.appendChild(p);
  }
  if (arguments[0].action) {
    const a = document.createElement('p');
    a.className = 'tt-action';
    a.textContent = arguments[0].action;
    tooltip.appendChild(a);
  }
  tooltip.classList.add('show');
  tooltipMove(x, y);
}
function tooltipMove(x, y) {
  const pad = 14;
  const r = tooltip.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > innerWidth - 8) left = x - r.width - pad;
  if (top + r.height > innerHeight - 8) top = y - r.height - pad;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}
function tooltipHide() { tooltip.classList.remove('show'); }

/* ---------------- svg helpers ---------------- */

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
function svgText(parent, x, y, cls, str, anchor) {
  const el = svgEl('text', { x, y, class: cls }, parent);
  if (anchor) el.setAttribute('text-anchor', anchor);
  el.textContent = str;
  return el;
}
function diamondPath(cx, cy, r) {
  return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
}

/* attach tooltip behaviour to a hit target */
function bindTip(hit, content) {
  hit.classList.add('hit');
  hit.setAttribute('tabindex', '0');
  hit.setAttribute('role', 'img');
  hit.setAttribute('aria-label', `${content.title}${content.time ? ` — ${content.time}` : ''}. ${content.lines.join(' ')}${content.action ? ` ${content.action}` : ''}`);
  hit.addEventListener('pointerenter', (e) => tooltipShow(content, e.clientX, e.clientY));
  hit.addEventListener('pointermove', (e) => tooltipMove(e.clientX, e.clientY));
  hit.addEventListener('pointerleave', tooltipHide);
  hit.addEventListener('focus', () => {
    const r = hit.getBoundingClientRect();
    tooltipShow(content, r.left + r.width / 2, r.bottom);
  });
  hit.addEventListener('blur', tooltipHide);
}

/* ---------------- timeline ---------------- */

const PAD_L = 236;
const PAD_R = 36;
const AXIS_H = 38;
const CAT_H = 36;
const ROW_H = 52;
const BAR_H = 15;

/* click-to-project respawns (rift, mid boss) */
function doShift(row, e) {
  const shift = (state.shifts[row.id] ||= { count: 0, t: null });
  if (e.altKey) {
    shift.count = 0;
    shift.t = null;
    if (row.id === 'midboss') state.rejuvFrom = null;
  } else {
    const steps = row.shiftable.steps;
    const step = steps[Math.min(shift.count, steps.length - 1)];
    const clockActive = state.clock.running || state.clock.offset > 0;
    const base = clockActive ? clockSeconds() / 60 : (shift.t ?? row.marks[0].t);
    shift.t = base + step;
    shift.count += 1;
    if (row.id === 'midboss') state.rejuvFrom = base; // boss died now → buff runs 3:00 from here
  }
  tooltipHide();
  renderTimeline();
}

let clockMarks = []; // [{t, el, rowName, catId, sub}] for now-line highlighting / next-up

function renderTimeline() {
  const host = $('#timeline-host');
  const svg = $('#timeline');
  svg.replaceChildren();
  tooltipHide();
  closeCuePopover();
  clockMarks = [];

  const visibleCats = CATEGORY_ORDER.filter((c) => state.filters[c]);
  $('#timeline-empty').style.display = visibleCats.length ? 'none' : 'block';
  svg.style.display = visibleCats.length ? 'block' : 'none';
  if (!visibleCats.length) return;

  // On phones/narrow screens the plot can't usefully squeeze into ~350px, so we
  // render it at a readable fixed width and let #timeline-host scroll horizontally.
  const compact = innerWidth < 900;
  const width = compact ? Math.max(1180, host.clientWidth) : Math.max(760, host.clientWidth);
  const plotW = width - PAD_L - PAD_R;
  const viewStart = state.viewStart;
  const viewEnd = viewStart + T_MAX;
  const x = (t) => PAD_L + ((t - viewStart) / T_MAX) * plotW;
  const inView = (t, pad = 0.5) => t >= viewStart - pad && t <= viewEnd + pad;

  // assemble drawing order: category header + its rows
  const layout = [];
  let y = AXIS_H;
  for (const catId of visibleCats) {
    layout.push({ kind: 'cat', catId, y });
    y += CAT_H;
    for (const row of ROWS.filter((r) => r.cat === catId)) {
      layout.push({ kind: 'row', row, y });
      y += ROW_H;
    }
  }
  const height = y + 14;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const defs = svgEl('defs', {}, svg);
  const clip = svgEl('clipPath', { id: 'plotclip' }, defs);
  svgEl('rect', { x: PAD_L - 8, y: 0, width: width - PAD_L + 8, height }, clip);

  /* grid + axis */
  const grid = svgEl('g', {}, svg);
  for (let t = Math.ceil(viewStart); t <= viewEnd; t += 1) {
    const major = t % 5 === 0;
    if (major) {
      svgEl('line', {
        x1: x(t), x2: x(t), y1: AXIS_H - 6, y2: height - 10,
        class: 'grid major',
      }, grid);
      svgText(grid, x(t), AXIS_H - 12, 'axis-tick', `${t}:00`, 'middle');
    } else {
      svgEl('line', { x1: x(t), x2: x(t), y1: AXIS_H - 4, y2: AXIS_H, class: 'grid' }, grid);
    }
  }

  /* rows */
  for (const item of layout) {
    if (item.kind === 'cat') {
      const cat = CATEGORIES[item.catId];
      const g = svgEl('g', {}, svg);
      svgEl('rect', {
        x: 16, y: item.y + CAT_H - 14, width: 18, height: 4, rx: 2, fill: cat.color,
      }, g);
      svgText(g, 42, item.y + CAT_H - 9, 'cat-label', cat.name.toUpperCase());
      continue;
    }

    const { row } = item;
    const cat = CATEGORIES[row.cat];
    const color = cat.color;
    const top = item.y;
    const cy = top + 21;
    const g = svgEl('g', {}, svg);

    const shift = row.shiftable ? (state.shifts[row.id] ||= { count: 0, t: null }) : null;
    const shifted = !!(shift && shift.count > 0);
    const action = row.shiftable ? row.shiftable.hint : null;
    const makeClickable = (hit) => {
      if (!row.shiftable) return;
      hit.classList.add('clickable');
      hit.addEventListener('click', (e) => doShift(row, e));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doShift(row, e); }
      });
    };

    // alternating row wash + separator
    svgEl('rect', { x: 0, y: top, width, height: ROW_H, class: 'rowband', fill: 'transparent' }, g);
    svgEl('line', { x1: 12, x2: width - 12, y1: top, y2: top, class: 'grid' }, g);

    // lane label + cadence chip
    svgText(g, 16, cy + 1, 'row-label', row.name);
    if (row.cadence) svgText(g, 16, cy + 17, 'row-cadence', row.cadence);

    // per-lane audio cue toggle, in the gutter to the right of the label
    const spk = speakerGlyph(g, PAD_L - 26, top + 8, cuesAnyOn(state.audio.lanes[row.id]));
    spk.setAttribute('aria-label', `Audio cues for ${row.name}`);
    const openSpk = () => openLanePopover(row, spk, spk.getBoundingClientRect());
    spk.addEventListener('click', (e) => { e.stopPropagation(); openSpk(); });
    spk.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSpk(); }
    });

    // everything time-positioned renders clipped to the plot area (viewport can scroll)
    const plot = svgEl('g', { 'clip-path': 'url(#plotclip)' }, g);

    const laneTip = {
      title: row.name, color, time: null, lines: row.tip || [], action,
    };

    // shiftable lanes (rift, mid boss) are clickable anywhere along the lane,
    // so the target still exists when the mark has scrolled out of view
    if (row.shiftable) {
      const laneHit = svgEl('rect', {
        x: PAD_L, y: top + 2, width: plotW, height: ROW_H - 4, fill: 'transparent',
      }, g);
      bindTip(laneHit, laneTip);
      makeClickable(laneHit);
    }

    /* -- gradient resistance ramp -- */
    if (row.gradient) {
      const gr = row.gradient;
      const gid = `grad-${row.id}`;
      const lg = svgEl('linearGradient', { id: gid, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
      // red (resistant) -> neutral (0%) -> green (weak)
      const zero = gr.stops.find((s) => s.label.startsWith('0%'));
      const zeroPos = zero ? (zero.t - gr.from) / (gr.to - gr.from) : 0.5;
      svgEl('stop', { offset: '0%', 'stop-color': '#c2504a' }, lg);
      svgEl('stop', { offset: `${zeroPos * 100}%`, 'stop-color': '#3a3d38' }, lg);
      svgEl('stop', { offset: '100%', 'stop-color': '#3e9e57' }, lg);

      svgEl('rect', {
        x: x(gr.from), y: cy - BAR_H / 2,
        width: x(gr.to) - x(gr.from), height: BAR_H, rx: 3,
        fill: `url(#${gid})`, opacity: 0.85,
      }, plot);
      // fade tail: still weak after the ramp ends
      svgEl('rect', {
        x: x(gr.to), y: cy - BAR_H / 2,
        width: Math.max(0, x(viewEnd) - x(gr.to)), height: BAR_H, rx: 3,
        fill: '#3e9e57', opacity: 0.16,
      }, plot);

      for (const [i, s] of gr.stops.entries()) {
        svgEl('line', {
          x1: x(s.t), x2: x(s.t), y1: cy - BAR_H / 2 - 3, y2: cy + BAR_H / 2 + 3,
          stroke: 'var(--bg-1)', 'stroke-width': 2,
        }, plot);
        const anchor = i === 0 ? 'start' : i === gr.stops.length - 1 ? 'end' : 'middle';
        svgText(plot, x(s.t), cy + BAR_H / 2 + 15, 'grad-label', s.label, anchor);
      }

      const hit = svgEl('rect', {
        x: PAD_L, y: top + 2, width: plotW, height: ROW_H - 4, fill: 'transparent',
      }, g);
      bindTip(hit, laneTip);
    }

    /* -- labelled segments (trooper cadence, statue tiers) -- */
    if (row.segments) {
      for (const seg of row.segments) {
        const segTo = seg.to === Infinity ? viewEnd : seg.to;
        if (segTo < viewStart || seg.from > viewEnd) continue;
        const sx = x(seg.from) + 1;
        const sw = x(segTo) - x(seg.from) - 2; // 2px surface gap between segments
        svgEl('rect', {
          x: sx, y: cy - BAR_H / 2, width: sw, height: BAR_H, rx: 3,
          fill: color, opacity: 0.18,
        }, plot);
        svgEl('rect', {
          x: sx, y: cy - BAR_H / 2, width: sw, height: 2.5, rx: 1,
          fill: color, opacity: 0.8,
        }, plot);
        // label centred on the *visible* part of the segment
        const vx1 = Math.max(sx, PAD_L);
        const vx2 = Math.min(x(segTo), width - PAD_R);
        if (vx2 - vx1 > 64) svgText(plot, (vx1 + vx2) / 2, cy + BAR_H / 2 + 15, 'seg-label', seg.label, 'middle');
        const hit = svgEl('rect', {
          x: vx1, y: top + 2, width: Math.max(0, vx2 - vx1), height: ROW_H - 4, fill: 'transparent',
        }, g);
        bindTip(hit, {
          title: `${row.name} — ${seg.label}`, color, time: `${mmss(seg.from)}–${seg.to === Infinity ? '' : mmss(seg.to)}`,
          lines: row.tip || [],
        });
      }
    }

    /* -- hatched spawn window (rift) -- */
    if (row.window) {
      const w = row.window;
      const pid = `hatch-${row.id}`;
      const pat = svgEl('pattern', {
        id: pid, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
      }, defs);
      svgEl('rect', { width: 7, height: 7, fill: color, opacity: 0.10 }, pat);
      svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: color, 'stroke-width': 2, opacity: 0.45 }, pat);

      const wg = svgEl('g', { opacity: shifted ? 0.3 : 1 }, plot);
      svgEl('rect', {
        x: x(w.from), y: cy - BAR_H / 2, width: x(w.to) - x(w.from), height: BAR_H, rx: 3,
        fill: `url(#${pid})`,
      }, wg);
      svgText(wg, x(w.to) + 8, cy + 4, 'mark-label', w.label);

    }

    /* -- duration washes (bridge buff uptime) -- */
    if (row.washes) {
      for (const wash of row.washes) {
        if (!inView(wash.from, 3) && !inView(wash.to, 3)) continue;
        svgEl('rect', {
          x: x(wash.from), y: cy - BAR_H / 2 + 2, width: x(wash.to) - x(wash.from), height: BAR_H - 4, rx: 2,
          fill: color, opacity: 0.22,
        }, plot);
      }
    }

    /* -- relative-duration ruler (rejuvenator) -- */
    if (row.ruler) {
      const live = row.id === 'rejuv' && state.rejuvFrom != null;
      const from = live ? state.rejuvFrom : viewStart;
      const until = from + row.ruler.len;
      const rw = x(until) - x(from);
      svgEl('rect', {
        x: x(from), y: cy - BAR_H / 2, width: rw, height: BAR_H, rx: 3,
        fill: 'none', stroke: color, 'stroke-width': 1.5,
        'stroke-dasharray': live ? 'none' : '5 4', opacity: live ? 0.95 : 0.75,
      }, plot);
      svgEl('rect', {
        x: x(from), y: cy - BAR_H / 2, width: rw, height: BAR_H, rx: 3,
        fill: color, opacity: live ? 0.2 : 0.08,
      }, plot);
      const label = live ? `until ${mmss(until)}` : row.ruler.label;
      if (x(until) + 110 < width) svgText(plot, x(until) + 8, cy + 4, 'mark-label', label);
      else svgText(plot, x(from) - 8, cy + 4, 'mark-label', label, 'end');

      const tip = live ? {
        title: `${row.name} — active`, color, time: `${mmss(from)}–${mmss(until)}`,
        lines: [
          `Picked up when Mid Boss was cleared at ${mmss(from)} — the buff runs out at ${mmss(until)}.`,
          'Alt-click the Mid Boss lane to reset.',
        ],
      } : laneTip;
      const hx = Math.max(x(from), PAD_L);
      const hw = Math.min(x(until) + 120, width) - hx;
      if (hw > 0) {
        const hit = svgEl('rect', {
          x: hx, y: top + 2, width: hw, height: ROW_H - 4, fill: 'transparent',
        }, g);
        bindTip(hit, tip);
      }
    }

    /* -- markers -- */
    let marks = row.marks;
    if (shifted) {
      const steps = row.shiftable.steps;
      const nextStep = steps[Math.min(shift.count, steps.length - 1)];
      marks = [{
        t: shift.t, kind: 'spawn', label: mmss(shift.t), sub: 'NEXT',
        tip: [
          `Projected respawn at ${mmss(shift.t)}${row.id === 'midboss' ? ` — after your team’s kill #${shift.count}` : ''}.`,
          `Click again on the next clear to add another ${mmss(nextStep)}.`,
        ],
      }];
    }
    if (marks) {
      for (const mark of marks) {
        if (!inView(mark.t)) {
          clockMarks.push({ t: mark.t, el: null, rowName: mark.title || row.name, catId: row.cat, sub: mark.sub });
          continue;
        }
        const mx = x(mark.t);
        const mg = svgEl('g', { color }, plot);
        svgEl('path', {
          d: diamondPath(mx, cy, mark.kind === 'break' ? 6.5 : 7.5),
          class: 'mark-shape',
          fill: mark.kind === 'break' ? 'var(--bg-1)' : color,
          stroke: mark.kind === 'break' ? color : 'var(--bg-1)',
          'stroke-width': 2,
        }, mg);
        if (mark.label) {
          const lbl = svgText(mg, mx, cy + BAR_H / 2 + 16, 'mark-label', mark.label, 'middle');
          if (mark.sub) {
            const ts = document.createElementNS(SVGNS, 'tspan');
            ts.setAttribute('class', 'mark-sub');
            ts.setAttribute('dx', 5);
            ts.textContent = mark.sub;
            lbl.appendChild(ts);
          }
        }

        const hit = svgEl('rect', {
          x: mx - 14, y: top + 2, width: 28, height: ROW_H - 4, fill: 'transparent',
        }, mg);
        bindTip(hit, {
          title: mark.title || row.name, color, time: mmss(mark.t), lines: mark.tip || row.tip || [], action,
        });
        makeClickable(hit);
        clockMarks.push({ t: mark.t, el: mg, rowName: mark.title || row.name, catId: row.cat, sub: mark.sub });
      }
    }
  }

  /* now line (drawn last, above everything) — draggable to scrub the clock */
  const nowG = svgEl('g', { id: 'now-group', visibility: 'hidden' }, svg);
  svgEl('line', { id: 'now-line', class: 'now-line', y1: AXIS_H - 6, y2: height - 10 }, nowG);
  const nowHit = svgEl('rect', {
    id: 'now-hit', class: 'now-hit', y: AXIS_H - 6, width: 18, height: height - AXIS_H, fill: 'transparent',
  }, nowG);
  nowHit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    nowHit.setPointerCapture(e.pointerId);
    svg.classList.add('scrubbing');
    state.scrubbing = true;
    const scrub = (ev) => {
      const left = svg.getBoundingClientRect().left;
      const raw = viewStart + ((ev.clientX - left) - PAD_L) / plotW * T_MAX;
      const t = Math.min(viewEnd, Math.max(Math.max(0, viewStart), raw));
      state.clock.offset = t * 60;
      state.clock.anchor = performance.now();
      clockRender();
    };
    scrub(e);
    nowHit.onpointermove = scrub;
    nowHit.onpointerup = nowHit.onpointercancel = () => {
      nowHit.onpointermove = nowHit.onpointerup = nowHit.onpointercancel = null;
      svg.classList.remove('scrubbing');
      state.scrubbing = false;
      clockRender(); // apply any viewport shift the scrub calls skipped
    };
  });
  svg.dataset.plotW = plotW;

  updateNow(); // reposition after re-render
}

/* ---------------- filters ---------------- */

function renderFilters() {
  const host = $('#filter-toggles');
  host.replaceChildren();
  for (const catId of CATEGORY_ORDER) {
    const cat = CATEGORIES[catId];
    const btn = document.createElement('button');
    btn.className = 'toggle';
    btn.style.setProperty('--c', cat.color);
    btn.setAttribute('aria-pressed', String(state.filters[catId]));
    btn.title = cat.blurb;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const track = document.createElement('span');
    track.className = 'track';
    const knob = document.createElement('span');
    knob.className = 'knob';
    knob.innerHTML = '<svg viewBox="0 0 12 12" fill="none"><path d="M2 6.5 5 9.5 10 2.5" stroke="#0c1410" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    track.appendChild(knob);

    btn.append(swatch, document.createTextNode(cat.name), track);
    btn.addEventListener('click', () => {
      state.filters[catId] = !state.filters[catId];
      btn.setAttribute('aria-pressed', String(state.filters[catId]));
      saveFilters();
      renderTimeline();
      renderCards();
    });
    host.appendChild(btn);
  }
}

function setAll(on) {
  for (const id of CATEGORY_ORDER) state.filters[id] = on;
  saveFilters();
  renderFilters();
  renderTimeline();
  renderCards();
}

/* ---------------- reference cards ---------------- */

function renderCards() {
  const host = $('#cards');
  host.replaceChildren();
  for (const catId of CATEGORY_ORDER) {
    if (!state.filters[catId]) continue;
    const cat = CATEGORIES[catId];
    const card = document.createElement('section');
    card.className = 'panel cat-card';

    const head = document.createElement('div');
    head.className = 'cat-head';
    const key = document.createElement('span');
    key.className = 'key';
    key.style.background = cat.color;
    const h3 = document.createElement('h3');
    h3.textContent = cat.name;
    const blurb = document.createElement('span');
    blurb.className = 'blurb';
    blurb.textContent = cat.blurb;
    head.append(key, h3, blurb);
    card.appendChild(head);

    for (const entry of CARDS[catId] || []) {
      const div = document.createElement('div');
      div.className = 'entry';
      const h4 = document.createElement('h4');
      h4.textContent = entry.name;
      div.appendChild(h4);

      const stats = document.createElement('div');
      stats.className = 'stats';
      for (const [k, v] of entry.stats) {
        const stat = document.createElement('span');
        stat.className = 'stat';
        const kk = document.createElement('span');
        kk.className = 'k';
        kk.textContent = k;
        const vv = document.createElement('span');
        vv.className = 'v';
        vv.textContent = v;
        stat.append(kk, vv);
        stats.appendChild(stat);
      }
      div.appendChild(stats);

      if (entry.notes.length) {
        const ul = document.createElement('ul');
        for (const note of entry.notes) {
          const li = document.createElement('li');
          li.textContent = note;
          ul.appendChild(li);
        }
        div.appendChild(ul);
      }
      card.appendChild(div);
    }
    host.appendChild(card);
  }
}

/* ---------------- match clock ---------------- */

function clockSeconds() {
  const c = state.clock;
  return c.running ? c.offset + (performance.now() - c.anchor) / 1000 : c.offset;
}

/* keep NOW ~30 min into the viewport in long games; step one whole minute at a time
   so the board stays hoverable between shifts */
function adjustView() {
  if (state.scrubbing) return;
  const active = state.clock.running || state.clock.offset > 0;
  const t = clockSeconds() / 60;
  let vs = state.viewStart;
  if (!active) vs = 0;
  else if (t > state.viewStart + 31) vs = Math.floor(t - 30);
  else if (t < state.viewStart) vs = Math.max(0, Math.floor(t - 30));
  if (vs !== state.viewStart) {
    state.viewStart = vs;
    renderTimeline();
  }
}

function clockRender() {
  adjustView();
  const sec = Math.max(0, clockSeconds());
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  $('#clock-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
  $('#clock-wrap').classList.toggle('running', state.clock.running);
  $('#clock-start').textContent = state.clock.running ? 'Pause' : 'Start';
  updateNow();
}

function updateNow() {
  const svg = $('#timeline');
  const nowG = $('#now-group');
  if (!nowG) return;
  const sec = clockSeconds();
  const active = state.clock.running || state.clock.offset > 0;
  const tMin = sec / 60;
  const viewStart = state.viewStart;
  const viewEnd = viewStart + T_MAX;

  if (!active || tMin < viewStart - 0.01 || tMin > viewEnd + 0.01) {
    nowG.setAttribute('visibility', 'hidden');
  } else {
    const plotW = Number(svg.dataset.plotW);
    const nx = PAD_L + ((tMin - viewStart) / T_MAX) * plotW;
    nowG.setAttribute('visibility', 'visible');
    const line = $('#now-line');
    line.setAttribute('x1', nx);
    line.setAttribute('x2', nx);
    $('#now-hit').setAttribute('x', nx - 9);
  }

  // pulse markers coming up in the next 45s; list the next two in the header
  const soonFrom = tMin;
  const soonTo = tMin + 45 / 60;
  const upcoming = [];
  for (const m of clockMarks) {
    const soon = active && m.t >= soonFrom && m.t <= soonTo;
    if (m.el) m.el.classList.toggle('soon', soon);
    if (active && m.t >= tMin) upcoming.push(m);
  }
  const nextHost = $('#clock-next-list');
  nextHost.replaceChildren();
  if (active) {
    upcoming.sort((a, b) => a.t - b.t);
    for (const m of upcoming.slice(0, 2)) {
      const div = document.createElement('div');
      div.className = 'evt';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = CATEGORIES[m.catId].color;
      const time = document.createElement('strong');
      time.textContent = mmss(m.t);
      div.append(dot, time, document.createTextNode(` ${m.rowName}${m.sub ? ` (${m.sub})` : ''}`));
      nextHost.appendChild(div);
    }
    if (!upcoming.length) {
      const div = document.createElement('div');
      div.className = 'evt';
      div.textContent = 'no clock spawns left on the board';
      nextHost.appendChild(div);
    }
  } else {
    const div = document.createElement('div');
    div.className = 'evt';
    div.textContent = 'start the clock at horn';
    nextHost.appendChild(div);
  }
}

function initClock() {
  $('#clock-start').addEventListener('click', () => {
    const c = state.clock;
    if (c.running) {
      c.offset = clockSeconds();
      c.running = false;
    } else {
      c.anchor = performance.now();
      c.running = true;
    }
    clockRender();
  });
  $('#clock-reset').addEventListener('click', () => {
    state.clock = { running: false, anchor: 0, offset: 0 };
    clockRender();
  });
  for (const [id, delta] of [['#clock-back', -5], ['#clock-back1', -1], ['#clock-fwd1', 1], ['#clock-fwd', 5]]) {
    $(id).addEventListener('click', () => {
      state.clock.offset = Math.max(0, clockSeconds() + delta);
      if (state.clock.running) state.clock.anchor = performance.now();
      clockRender();
    });
  }
  setInterval(() => { if (state.clock.running) clockRender(); }, 500);
}

/* ---------------- hint + help ---------------- */

function initHelp() {
  const hint = $('#hint');
  if (localStorage.getItem(STORE_HINT)) hint.remove();
  else {
    $('#hint .close').addEventListener('click', () => {
      localStorage.setItem(STORE_HINT, '1');
      hint.remove();
    });
  }
  const dialog = $('#help');
  $('#help-open').addEventListener('click', () => dialog.showModal());
  $('#help-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

/* ---------------- boot ---------------- */

renderFilters();
renderTimeline();
renderCards();
initClock();
initHelp();
initAudio();
clockRender();

setInterval(audioTick, 200);

$('#filters-all').addEventListener('click', () => setAll(true));
$('#filters-none').addEventListener('click', () => setAll(false));
$('#updated').textContent = `Numbers last updated ${DATA_UPDATED}.`;

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTimeline, 120);
}).observe($('#timeline-host'));
