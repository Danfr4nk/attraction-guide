// attraction-guide — game engine v2: adaptive drill-down on precision.
// Static, no backend. All state in localStorage.
//
// Phase 2 is an adaptive engine, not a fixed queue:
//  - every pick is scored on MEASURED metric deltas (winner − loser), z-scored
//    against bank-wide stats (js/bank-stats.json from the offline audit)
//  - evidence accrues per metric-direction, not per prompt label
//  - next pair = highest-uncertainty open axis; axes retire at 3 consistent
//    target-direction wins, or 6 inconclusive trials
//  - pairs carry their audit validity score; weak pairs are auto-excluded
import { ensureLandmarker, measureImage, METRIC_LABELS } from './measure.js';

const LS_KEY = 'attraction-guide-run-v2';
const ARCHETYPES = ['wide', 'long', 'heart', 'round'];
const ARCHETYPE_LABELS = { wide: 'wide-angular', long: 'long-narrow', heart: 'heart', round: 'round' };
const PAIR_AXES = {
  jaw: ['sharp', 'soft'],
  lips: ['full', 'thin'],
  eyes: ['wide', 'close'],
  brow: ['thick', 'thin'],
  nose: ['narrow', 'wide'],
};
// target metric per axis — evidence accrues on these, not on labels
const AXIS_TARGET = {
  jaw: 'gonial_angle_mean', lips: 'lip_fullness', eyes: 'eye_spacing_widths',
  brow: 'brow_arch_mean', nose: 'nose_w_to_intercanthal',
};
// metrics z-scored per trial (must match the offline audit's STRUCT set)
const STRUCT = ['gonial_angle_mean', 'jaw_to_cheek', 'width_height_ratio', 'fwhr_proxy',
  'ipd_to_cheek', 'eye_spacing_widths', 'eye_w_to_h', 'canthal_tilt_mean',
  'fifths', 'nose_to_cheek', 'nose_w_to_intercanthal', 'mouth_to_cheek',
  'mouth_to_nose', 'lip_fullness', 'upper_lower_lip', 'brow_arch_mean',
  'brow_eye_dist_pct', 'mean_asymmetry', 'asymmetry_9', 'third_upper_pct',
  'third_mid_pct', 'third_lower_pct', 'chin_to_lower_third', 'philtrum_to_nose'];
// card display subset (full vector still logged/exported)
const DISPLAY_KEYS = ['lip_fullness', 'gonial_angle_mean', 'eye_spacing_widths',
  'nose_w_to_intercanthal', 'brow_arch_mean', 'jaw_to_cheek', 'mean_asymmetry'];
const CONFIRM_WINS = 3, MAX_TRIALS = 6;
const P1_ROUNDS_BEFORE_ADVANCE = 3;
// feature picks: per-metric A/B choice on phase-2 pairs (|z| vs bank stats)
const FEATURE_Z_MIN = 0.5, FEATURE_MAX_ROWS = 6;
let currentFeaturePicks = {};
let currentFeatureRows = [];
let featuresFor = null;

let BANK = [];
let STATS = null;   // { metrics: {k:{mean,std}}, axis_dir: {axis: -1|0|+1} }
let state = null;
let currentRound = null;
let rankOrder = [];
const measureCache = new Map();

// ---------- pregame preferences ----------
// Which faces may appear. Two-level: group → subgroup. Neutral framing — the
// user picks which groups to evaluate; everything is selected by default.
// Stored in localStorage, separate from the run.
const PREFS_KEY = 'attraction-guide-prefs-v1';
const GROUP_TREE = {
  caucasian: { label: 'Caucasian', subs: {
    'northern-european': 'Northern European', 'southern-european': 'Southern European',
    'eastern-european': 'Eastern European' } },
  latina: { label: 'Latina', subs: {
    mestiza: 'Mestiza', norteno: 'Norteña (northern Mexican)', european: 'European-descended',
    'afro-latina': 'Afro-Latina' } },
  asian: { label: 'East / Southeast Asian', subs: {
    'east-asian': 'East Asian', 'southeast-asian': 'Southeast Asian' } },
  black: { label: 'Black', subs: {
    'west-african': 'West African', 'east-african': 'East African', caribbean: 'Caribbean' } },
  'south-asian': { label: 'South Asian', subs: {
    'north-indian': 'North Indian', 'south-indian': 'South Indian' } },
  'middle-eastern': { label: 'Middle Eastern', subs: {
    levantine: 'Levantine', gulf: 'Gulf Arab', persian: 'Persian' } },
  mixed: { label: 'Mixed / ambiguous', subs: { mixed: 'Mixed / ambiguous' } },
};
const subKey = (g, s) => g + ':' + s;
const faceKey = (f) => subKey(f.group || 'mixed', f.subgroup || 'mixed');
function allKeys() {
  const ks = [];
  for (const [g, t] of Object.entries(GROUP_TREE))
    for (const s of Object.keys(t.subs)) ks.push(subKey(g, s));
  return ks;
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && typeof p === 'object') return { sel: p.sel || null, sex: p.sex || 'female' };
  } catch (e) {}
  return { sel: null, sex: 'female' }; // sel null = everything selected
}
let prefs = loadPrefs();
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
function normSel(sel) { // full selection collapses back to null (= default)
  const all = allKeys();
  return sel.length >= all.length ? null : [...new Set(sel)];
}
// faces eligible under current prefs
function activeBank() {
  return BANK.filter((f) =>
    (f.sex || 'female') === prefs.sex &&
    (!prefs.sel || prefs.sel.includes(faceKey(f))));
}
// counts per group/sub among the current sex's bank faces
function treeCounts() {
  const t = {};
  for (const f of BANK.filter((f) => (f.sex || 'female') === prefs.sex)) {
    const g = f.group || 'mixed', s = f.subgroup || 'mixed';
    if (!GROUP_TREE[g]) continue;
    t[g] = t[g] || { total: 0, subs: {} };
    t[g].total++;
    t[g].subs[s] = (t[g].subs[s] || 0) + 1;
  }
  return t;
}
function prefsSummary(sel) {
  const parts = [];
  for (const [g, t] of Object.entries(GROUP_TREE)) {
    const on = Object.keys(t.subs).filter((s) => sel.includes(subKey(g, s)));
    if (!on.length) continue;
    parts.push(on.length === Object.keys(t.subs).length
      ? t.label
      : `${t.label} (${on.map((s) => t.subs[s]).join(', ')})`);
  }
  return parts.join(' · ');
}

const $ = (s) => document.querySelector(s);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const faceById = (id) => BANK.find((f) => f.id === id);
const fmtShort = (m) => DISPLAY_KEYS.map((k) => `${METRIC_LABELS[k]} ${m[k].toFixed(3)}`).join('\n');

// ---------- state ----------
function blankState() {
  return {
    startedAt: new Date().toISOString(),
    refVector: null,
    rounds: [],
    archWins: { wide: 0, long: 0, heart: 0, round: 0 },
    phase: 1,
    p1Round: 0,
    p1Used: [],
    p2Round: 0,
    axisTrials: { jaw: [], lips: [], eyes: [], brow: [], nose: [] },
    axisStatus: { jaw: 'open', lips: 'open', eyes: 'open', brow: 'open', nose: 'open' },
    recentAnchors: { jaw: [], lips: [], eyes: [], brow: [], nose: [] },
  };
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.rounds && s.axisTrials) return s; } catch (e) {}
  return null;
}

// ---------- measurement ----------
function measureStatusEl() { return $('#measure-status'); }
async function initMeasure() {
  const el = measureStatusEl();
  await ensureLandmarker((msg) => {
    el.textContent = msg;
    if (msg === 'landmarks ready') el.classList.add('ready');
  });
}
const pendingMeasures = [];
function kickMeasure(faceId, imgEl, statsEl) {
  if (measureCache.has(faceId)) { statsEl.textContent = fmtShort(measureCache.get(faceId)); return; }
  pendingMeasures.push({ faceId, imgEl, statsEl });
  flushMeasures();
}
function flushMeasures() {
  if (!window.__lmReady) return;
  while (pendingMeasures.length) {
    const { faceId, imgEl, statsEl } = pendingMeasures.shift();
    if (measureCache.has(faceId)) { statsEl.textContent = fmtShort(measureCache.get(faceId)); continue; }
    const m = measureImage(imgEl);
    if (m) { measureCache.set(faceId, m); statsEl.textContent = fmtShort(m); }
    else statsEl.textContent = 'no face detected';
  }
  renderFeatureRows();
}

// ---------- inference ----------
function confidence(wins) {
  if (wins >= 3) return ['confirmed', 'confirmed'];
  if (wins === 2) return ['leaning', 'leaning'];
  return ['weak', 'weak'];
}
function inferPhase1(winnerArch, shownArchs) {
  state.archWins[winnerArch]++;
  const w = state.archWins[winnerArch];
  const [cls, label] = confidence(w);
  const rejected = shownArchs.filter((a) => a !== winnerArch).map((a) => ARCHETYPE_LABELS[a]).join(', ');
  let s = `Round ${state.p1Round}: ${ARCHETYPE_LABELS[winnerArch]} takes it (${w}W) — ${label}. Rejected: ${rejected}.`;
  const lead = Object.entries(state.archWins).sort((a, b) => b[1] - a[1])[0];
  if (lead[0] !== winnerArch && lead[1] >= 2) s += ` Note: ${ARCHETYPE_LABELS[lead[0]]} led at ${lead[1]}W — lead change, treat as contested.`;
  return { text: s, cls };
}
// ---------- unified evidence ----------
// Every phase-2 trial yields evidence per axis. A direct feature pick overrides
// the holistic read for its metric; a confounded holistic read with no direct
// backup is dropped. Cross-axis picks count: judging B's jaw during a lips
// trial is jaw evidence. Evidence points drive retirement and the queue.
function axisEvidence(axis) {
  const target = AXIS_TARGET[axis];
  const dir = STATS ? STATS.axis_dir[axis] : 0;
  const ref = { v: dir !== 0 ? dir : null }; // dir=0 axes: first observation sets the reference
  const pts = [];
  for (const r of state.rounds) {
    if (r.phase !== 2) continue;
    const fps = (r.featurePicks || []).filter((p) => p.k === target && p.dz != null && isFinite(p.dz) && Math.abs(p.dz) > 0.05);
    if (fps.length) {
      const dz = fps[0].dz;
      if (ref.v === null) ref.v = Math.sign(dz);
      pts.push({ n: r.n, source: 'direct', consistent: Math.sign(dz) === ref.v });
      continue;
    }
    if (r.axis === axis && r.trial && r.trial.targetZ != null && isFinite(r.trial.targetZ) && Math.abs(r.trial.targetZ) > 0.05) {
      if (r.trial.confound) continue; // confounded holistic, no direct backup: dropped
      const tz = r.trial.targetZ;
      if (ref.v === null) ref.v = Math.sign(tz);
      pts.push({ n: r.n, source: 'holistic', consistent: Math.sign(tz) === ref.v });
    }
  }
  return pts;
}
function axisScore(axis) {
  const pts = axisEvidence(axis);
  return {
    c: pts.filter((p) => p.consistent).length,
    n: pts.length,
    direct: pts.filter((p) => p.source === 'direct').length,
  };
}
// Wilson score interval for small-n proportions — error bars instead of raw counts.
function wilson(x, n) {
  const z = 1.96;
  if (!n) return { lo: 0, hi: 1, center: 0.5 };
  const p = x / n, d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { lo: Math.max(0, center - h), hi: Math.min(1, center + h), center };
}
const pct = (v) => Math.round(v * 100) + '%';
const ciStr = (w) => `${pct(w.center)} [${pct(w.lo)}–${pct(w.hi)}]`;

// Per-metric marginal preference analysis from feature picks.
function metricAnalysis() {
  const per = {};
  for (const r of state.rounds) {
    if (r.phase !== 2) continue;
    for (const p of (r.featurePicks || [])) {
      const a = (per[p.k] = per[p.k] || { picks: [], noCalls: [] });
      if (p.winner) a.picks.push(p);
      else if (p.zAbs != null) a.noCalls.push(p.zAbs);
    }
  }
  const out = {};
  for (const [k, a] of Object.entries(per)) {
    const higher = a.picks.filter((p) => p.dz > 0.05);
    const lower = a.picks.filter((p) => p.dz < -0.05);
    const n = higher.length + lower.length;
    const meanAbsZ = a.picks.length ? a.picks.reduce((s, p) => s + Math.abs(p.dz), 0) / a.picks.length : null;
    const firstCall = a.picks.length ? Math.min(...a.picks.map((p) => Math.abs(p.dz))) : null;
    const maxNoCall = a.noCalls.length ? Math.max(...a.noCalls) : null;
    // shape: all-one-direction = monotonic; mixed with higher-picks-below-lower-picks = peaked
    let shape = '—';
    if (n >= 1 && lower.length === 0) shape = 'monotonic ↑';
    else if (n >= 1 && higher.length === 0) shape = 'monotonic ↓';
    else if (n >= 4) {
      const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
      const wzH = higher.map((p) => p.wz).filter((v) => v != null);
      const wzL = lower.map((p) => p.wz).filter((v) => v != null);
      shape = wzH.length && wzL.length && mean(wzH) < mean(wzL) ? 'peaked' : 'mixed';
    } else if (n >= 2) shape = 'mixed';
    const wzs = a.picks.map((p) => p.wz).filter((v) => v != null);
    const ideal = wzs.length ? wzs.reduce((s, v) => s + v, 0) / wzs.length : null;
    out[k] = { n, higher: higher.length, lower: lower.length, w: wilson(higher.length, n), meanAbsZ, firstCall, maxNoCall, shape, ideal };
  }
  return out;
}
// Configurality: does the holistic winner match the feature-majority winner?
// Low agreement = the whole beats its parts; marginal sums can't be trusted.
function configurality() {
  let agree = 0, total = 0, ties = 0;
  for (const r of state.rounds) {
    if (r.phase !== 2) continue;
    const picks = (r.featurePicks || []).filter((p) => p.winner);
    if (!picks.length) continue;
    const tally = {};
    for (const p of picks) tally[p.winner] = (tally[p.winner] || 0) + 1;
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (top.length > 1 && top[0][1] === top[1][1]) { ties++; continue; }
    total++;
    if (top[0][0] === r.ranking[0]) agree++;
  }
  return { agree, total, ties, rate: total ? agree / total : null };
}
function inferPhase2(axis, winner, loser) {
  const mw = measureCache.get(winner.id), ml = measureCache.get(loser.id);
  const target = AXIS_TARGET[axis];
  const dir = STATS ? STATS.axis_dir[axis] : 0;
  const trial = {
    n: state.p2Round, anchor: winner.anchor, shown: [winner.id, loser.id],
    winner: winner.id, loser: loser.id, targetMetric: target,
    targetDelta: null, targetZ: null, confound: false,
    confoundMetric: null, topDeltas: [], unmeasured: false,
  };
  let inf;
  if (mw && ml && STATS) {
    const sd = STATS.metrics;
    const dz = (k) => (mw[k] - ml[k]) / sd[k].std;
    const tz = dz(target);
    trial.targetDelta = +(mw[target] - ml[target]).toFixed(3);
    trial.targetZ = +tz.toFixed(2);
    const ranked = STRUCT.filter((k) => isFinite(dz(k))).map((k) => ({ k, z: dz(k) }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    trial.topDeltas = ranked.slice(0, 3).map((o) => ({ k: o.k, z: +o.z.toFixed(2) }));
    const topConf = ranked.find((o) => o.k !== target);
    if (topConf && Math.abs(topConf.z) > Math.abs(tz)) {
      trial.confound = true;
      trial.confoundMetric = topConf.k;
    }
    const dLabel = dir === 0
      ? `${winner.variant} (label)`
      : `${target} ${tz >= 0 ? '+' : ''}${tz.toFixed(2)}σ`;
    inf = {
      text: `${axis} · ${winner.variant} > ${loser.variant} — ${dLabel}` +
        (trial.confound ? ` ⚠ confound: ${METRIC_LABELS[trial.confoundMetric]} moved harder (${topConf.z.toFixed(2)}σ vs ${tz.toFixed(2)}σ).` : ''),
      cls: trial.confound ? 'weak' : 'leaning', // provisional; lockRanking refines from unified evidence
    };
  } else {
    // measurement or stats unavailable: holistic only, flagged
    trial.unmeasured = true;
    inf = { text: `${axis} · ${winner.variant} > ${loser.variant} — unmeasured, holistic only.`, cls: 'weak' };
  }
  state.axisTrials[axis].push(trial);
  return { text: inf.text, cls: inf.cls, trial };
}
function updateAxisStatus(axis) {
  const sc = axisScore(axis);
  if (sc.c >= CONFIRM_WINS) state.axisStatus[axis] = 'confirmed';
  else if (sc.n >= MAX_TRIALS) state.axisStatus[axis] = 'unresolved';
}

// ---------- adaptive queue ----------
// Admission bar: the pair must ISOLATE its variable — target-family z must
// exceed every true-confound z (audit validity > 0). Strength (target z) is
// reported in the UI and drives pair preference, not admission.
function pairPool(axis) {
  const [v0, v1] = PAIR_AXES[axis];
  const byAnchor = {};
  for (const f of activeBank()) {
    if (f.phase !== 2 || f.axis !== axis || !f.variant) continue;
    (byAnchor[f.anchor] = byAnchor[f.anchor] || {})[f.variant] = f;
  }
  return Object.entries(byAnchor)
    .filter(([, p]) => p[v0] && p[v1] && (p[v0].pair_validity ?? -1) > 0)
    .map(([anchor, p]) => ({ anchor, faces: shuffle([p[v0], p[v1]]), validity: p[v0].pair_validity, targetZ: p[v0].pair_target_z ?? 0 }));
}
function pickAxis() {
  const open = Object.keys(PAIR_AXES).filter((a) => state.axisStatus[a] === 'open' && pairPool(a).length > 0);
  if (!open.length) return null;
  // uncertainty-driven: fewest evidence points first, then highest uncertainty (rate nearest 0.5)
  const unc = (a) => { const s = axisScore(a); return s.n ? 1 - Math.abs(2 * (s.c / s.n) - 1) : 1; };
  return open.slice().sort((a, b) =>
    axisScore(a).n - axisScore(b).n || unc(b) - unc(a))[0];
}
function pickPair(axis) {
  const pool = pairPool(axis).sort((a, b) => b.targetZ - a.targetZ);
  const recent = state.recentAnchors[axis] || [];
  const pick = pool.find((p) => !recent.includes(p.anchor)) || pool[0];
  state.recentAnchors[axis] = [...recent, pick.anchor].slice(-2);
  return pick;
}

// ---------- rounds ----------
function p1Faces() {
  const pool = activeBank().filter((f) => f.phase === 1);
  const picked = [];
  for (const arch of shuffle(ARCHETYPES)) {
    const cands = shuffle(pool.filter((f) => f.archetype === arch && !state.p1Used.includes(f.id)));
    const src = cands.length ? cands : shuffle(pool.filter((f) => f.archetype === arch));
    picked.push(src[0]);
  }
  return picked;
}
function nextRound() {
  rankOrder = [];
  if (state.phase === 1) {
    state.p1Round++;
    const faces = p1Faces();
    state.p1Used.push(...faces.map((f) => f.id));
    currentRound = { phase: 1, n: state.p1Round, faces: faces.map((f) => f.id) };
  } else {
    const axis = pickAxis();
    if (!axis) { renderComplete(); return; }
    const pair = pickPair(axis);
    state.p2Round++;
    currentRound = { phase: 2, n: state.p2Round, faces: pair.faces.map((f) => f.id), axis, anchor: pair.anchor, validity: pair.validity, targetZ: pair.targetZ };
  }
  save();
  renderRound();
}
function faceLabel(f) {
  if (f.phase === 1) return `arch · ${ARCHETYPE_LABELS[f.archetype]}`;
  return `${f.axis} · ${f.variant}`;
}
function openAxesCount() {
  return Object.keys(PAIR_AXES).filter((a) => state.axisStatus[a] === 'open').length;
}

// ---------- rendering ----------
function renderRound() {
  const head = $('#round-head');
  const stage = $('#stage');
  stage.innerHTML = '';
  $('#inference').textContent = '';
  $('#round-stats').innerHTML = '';
  $('#feature-picks').innerHTML = '';
  featuresFor = null;
  currentFeaturePicks = {};
  $('#lock-btn').disabled = true;
  $('#lock-btn').textContent = 'Lock ranking';
  $('#next-btn')?.remove();

  const r = currentRound;
  head.textContent = r.phase === 1
    ? `phase 1 · round ${r.n} — structural archetypes (4-way)`
    : `phase 2 · pair ${r.n} — ${r.axis} (anchor ${r.anchor} · isol +${r.validity.toFixed(1)}σ · target ${r.targetZ.toFixed(1)}σ) · ${openAxesCount()} axes open`;

  if (r.phase === 1 && state.p1Round >= 2) {
    head.innerHTML += ` <button id="adv-btn" class="ghost" style="margin-left:12px">advance to phase 2 →</button>`;
    $('#adv-btn').onclick = () => { state.phase = 2; nextRound(); };
  }

  r.faces.forEach((fid) => {
    const f = faceById(fid);
    const card = document.createElement('div');
    card.className = 'face-card';
    card.dataset.fid = fid;
    card.innerHTML = `<div class="rank-badge" style="display:none"></div><img alt="${f.id}"><div class="tag">${faceLabel(f)}</div><div class="stats">measuring…</div>`;
    const img = card.querySelector('img');
    img.src = f.file;
    img.onload = () => kickMeasure(fid, img, card.querySelector('.stats'));
    card.onclick = () => toggleRank(fid, card);
    stage.appendChild(card);
  });
  updateRankUI();
  renderFeatureRows(); // no-op until both faces measured; flushMeasures re-triggers
}
// ---------- feature picks ----------
// Phase-2 pairs only: one row per metric where the pair actually differs
// (|z| >= FEATURE_Z_MIN vs bank stats, target metric always included).
// Optional — tap A/B per row, tap again to clear. Recorded on lock.
function renderFeatureRows() {
  const host = $('#feature-picks');
  const r = currentRound;
  if (!r || r.phase !== 2) { if (host) host.innerHTML = ''; return; }
  const key = r.phase + ':' + r.n + ':' + r.faces.join(',');
  if (featuresFor === key) return;
  const [fidA, fidB] = r.faces;
  const mA = measureCache.get(fidA), mB = measureCache.get(fidB);
  if (!mA || !mB || !STATS) return;
  featuresFor = key;
  currentFeaturePicks = {};
  const sd = STATS.metrics;
  const target = AXIS_TARGET[r.axis];
  const dz = (k) => (mA[k] - mB[k]) / sd[k].std;
  const rows = Object.keys(METRIC_LABELS)
    .filter((k) => sd[k] && isFinite(mA[k]) && isFinite(mB[k]) && isFinite(dz(k)))
    .map((k) => ({ k, z: dz(k) }))
    .filter((o) => o.k === target || Math.abs(o.z) >= FEATURE_Z_MIN)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, FEATURE_MAX_ROWS);
  currentFeatureRows = rows; // presented-but-uncalled rows feed threshold analysis
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'fp-head';
  head.innerHTML = `<b>feature picks</b> <span class="hint">optional · tap again to clear · <span id="fp-count">0</span> called</span>`;
  host.appendChild(head);
  const sub = document.createElement('div');
  sub.className = 'hint';
  sub.style.marginBottom = '8px';
  sub.textContent = 'For each measured difference: which face\u2019s version do you prefer? A = left, B = right.';
  host.appendChild(sub);
  for (const { k, z } of rows) {
    const row = document.createElement('div');
    row.className = 'fp-row';
    const hiTag = z >= 0 ? 'A▲' : 'B▲';
    row.innerHTML =
      `<span class="fp-k">${METRIC_LABELS[k]}${k === target ? ' <span class="target-tag">target</span>' : ''}</span>` +
      `<span class="fp-v">A ${mA[k].toFixed(3)} · B ${mB[k].toFixed(3)} <span class="hint">${z >= 0 ? '+' : ''}${z.toFixed(1)}σ · ${hiTag} higher</span></span>`;
    for (const side of ['A', 'B']) {
      const b = document.createElement('button');
      b.textContent = side;
      b.dataset.side = side;
      b.onclick = () => {
        currentFeaturePicks[k] = currentFeaturePicks[k] === side ? null : side;
        paintFpRow(row, k);
        updateFpCount();
      };
      row.appendChild(b);
    }
    host.appendChild(row);
  }
  updateFpCount();
}
function paintFpRow(row, k) {
  row.querySelectorAll('button[data-side]').forEach((b) =>
    b.classList.toggle('on', currentFeaturePicks[k] === b.dataset.side));
}
function updateFpCount() {
  const el = document.getElementById('fp-count');
  if (el) el.textContent = Object.values(currentFeaturePicks).filter(Boolean).length;
}
function renderComplete() {
  $('#round-head').textContent = 'phase 2 complete — all axes resolved';
  $('#stage').innerHTML = '<p class="hint">Every axis is confirmed or declared unresolved. See the profile tab.</p>';
  $('#lock-btn').disabled = true;
  $('#inference').textContent = summaryText();
  renderProfile();
}
function toggleRank(fid, card) {
  const i = rankOrder.indexOf(fid);
  if (i >= 0) rankOrder.splice(i, 1);
  else rankOrder.push(fid);
  updateRankUI();
}
function updateRankUI() {
  document.querySelectorAll('.face-card').forEach((card) => {
    const fid = card.dataset.fid;
    const i = rankOrder.indexOf(fid);
    const badge = card.querySelector('.rank-badge');
    if (i >= 0) { badge.style.display = 'flex'; badge.textContent = i + 1; card.classList.add('picked'); }
    else { badge.style.display = 'none'; card.classList.remove('picked'); }
  });
  const n = currentRound ? currentRound.faces.length : 0;
  $('#lock-btn').disabled = !(rankOrder.length === n && n > 0);
  $('#rank-hint').textContent = rankOrder.length === n
    ? 'ranking complete — lock it in'
    : `click faces in order of preference (${rankOrder.length}/${n})`;
}
function lockRanking() {
  const r = currentRound;
  const ranking = [...rankOrder];
  const winner = faceById(ranking[0]);
  let inf, trialRec = null;
  if (r.phase === 1) {
    inf = inferPhase1(winner.archetype, r.faces.map((id) => faceById(id).archetype));
  } else {
    const loser = faceById(ranking[1]);
    const res = inferPhase2(r.axis, winner, loser);
    inf = res; trialRec = res.trial;
  }
  // feature picks (phase 2): per-metric direct preferences. Winner stored as face id;
  // dz signed winner-minus-loser, wz the winner's bank z-score (revealed ideal point).
  // Uncalled presented rows are recorded too (winner null, zAbs set) for threshold analysis.
  let fp = [];
  if (r.phase === 2) {
    const [fidA, fidB] = r.faces;
    const mA = measureCache.get(fidA), mB = measureCache.get(fidB);
    const sd = STATS ? STATS.metrics : null;
    for (const { k, z } of currentFeatureRows) {
      const side = currentFeaturePicks[k];
      if (side) {
        const wfid = side === 'A' ? fidA : fidB;
        let dz = null, wz = null;
        if (mA && mB && sd && sd[k] && isFinite(mA[k]) && isFinite(mB[k])) {
          const wv = side === 'A' ? mA[k] : mB[k], lv = side === 'A' ? mB[k] : mA[k];
          dz = +((wv - lv) / sd[k].std).toFixed(2);
          wz = +((wv - sd[k].mean) / sd[k].std).toFixed(2);
        }
        fp.push({ k, winner: wfid, dz, wz });
      } else {
        fp.push({ k, winner: null, dz: null, wz: null, zAbs: +Math.abs(z).toFixed(2) });
      }
    }
  }
  const rec = { n: r.n, phase: r.phase, axis: r.axis || null, anchor: r.anchor || null, shown: r.faces, ranking, inference: '', featurePicks: fp };
  if (trialRec) { trialRec.featurePicks = fp; rec.trial = trialRec; }
  state.rounds.push(rec);
  if (r.phase === 2) {
    updateAxisStatus(r.axis);
    const sc = axisScore(r.axis);
    const [fcls, flabel] = confidence(sc.c);
    inf.text += ` — ${sc.c}/${sc.n} consistent${sc.direct ? ` (${sc.direct} direct)` : ''}, ${flabel}.`;
    inf.cls = fcls;
    const answered = fp.filter((p) => p.winner);
    if (answered.length) {
      const agree = answered.filter((p) => p.winner === ranking[0]).length;
      inf.text += ` Features: ${agree}/${answered.length} with holistic pick.`;
    }
  }
  rec.inference = inf.text;
  save();
  $('#inference').textContent = inf.text;
  renderRoundStats(ranking);
  const done = state.phase === 2 && openAxesCount() === 0;
  const nb = document.createElement('button');
  nb.id = 'next-btn'; nb.className = 'primary'; nb.style.marginLeft = '8px';
  nb.textContent = done ? 'See final profile →' : (r.phase === 1 && state.p1Round >= P1_ROUNDS_BEFORE_ADVANCE ? 'Start phase 2 →' : 'Next round →');
  nb.onclick = () => {
    if (done) { showView('profile'); return; }
    if (r.phase === 1 && state.p1Round >= P1_ROUNDS_BEFORE_ADVANCE) state.phase = 2;
    nextRound();
  };
  $('.stage-actions').appendChild(nb);
  $('#lock-btn').disabled = true;
  renderProfile(); renderLog();
}
function renderRoundStats(ranking) {
  const el = $('#round-stats');
  let html = '<table><tr><th>face</th>' + DISPLAY_KEYS.map((k) => `<th>${METRIC_LABELS[k]}</th>`).join('') + '</tr>';
  ranking.forEach((fid, i) => {
    const m = measureCache.get(fid);
    html += `<tr class="${i === 0 ? 'winner' : ''}"><td>#${i + 1} ${fid}</td>` +
      DISPLAY_KEYS.map((k) => `<td>${m ? m[k].toFixed(3) : '—'}</td>`).join('') + '</tr>';
  });
  el.innerHTML = html + '</table>';
}

// ---------- profile ----------
const AXIS_STATUS_LABEL = { open: 'open', confirmed: 'confirmed', unresolved: 'unresolved', 'no-pairs': 'no valid pairs' };
function renderProfile() {
  if (!state) return;
  let html = '<table class="axes"><tr><th>axis</th><th>evidence</th><th>consistency 95% CI</th><th>status</th></tr>';
  for (const a of ARCHETYPES) {
    const w = state.archWins[a];
    const [cls, label] = confidence(w);
    html += `<tr><td>archetype</td><td class="mono">${ARCHETYPE_LABELS[a]}</td><td class="mono">—</td><td><span class="conf ${cls}">${label}</span></td></tr>`;
  }
  for (const axis of Object.keys(PAIR_AXES)) {
    const sc = axisScore(axis);
    const w = wilson(sc.c, sc.n);
    const [cls, label] = confidence(sc.c);
    const st = state.axisStatus[axis];
    const pool = pairPool(axis).length;
    const statusLabel = st === 'open' && pool === 0 ? 'no valid pairs' : (AXIS_STATUS_LABEL[st] || st);
    const ev = `${sc.c}/${sc.n}` + (sc.direct ? ` <span class="hint">${sc.direct} direct</span>` : '');
    html += `<tr><td>${axis}</td><td class="mono">${ev}</td><td class="mono">${ciStr(w)}</td>` +
      `<td><span class="conf ${st === 'confirmed' ? 'confirmed' : st === 'unresolved' ? 'weak' : 'leaning'}">${statusLabel}</span> <span class="hint">${label}</span></td></tr>`;
  }
  $('#profile-axes').innerHTML = html + '</table>';

  // configurality: does the holistic winner match the feature-majority winner?
  const cf = configurality();
  let cfHtml;
  if (cf.total) {
    const verdict = cf.rate >= 0.8 ? 'marginals compose cleanly'
      : cf.rate >= 0.5 ? 'partially configural — some wholes beat their parts'
      : 'highly configural — do not trust marginal sums';
    cfHtml = `<p>configurality: holistic pick matched feature-majority <b class="mono">${cf.agree}/${cf.total}</b> (${pct(cf.rate)}) — ${verdict}</p>`;
  } else {
    cfHtml = `<p class="hint">${cf.ties ? 'feature picks so far are all split decisions' : 'no feature picks yet — they appear on phase-2 pairs'}</p>`;
  }
  // marginal preferences: direct per-metric evidence with error bars, ideals, thresholds, shape
  const maRows = Object.entries(metricAnalysis()).filter(([, v]) => v.n > 0).sort((a, b) => b[1].n - a[1].n);
  $('#profile-features').innerHTML = cfHtml + (maRows.length
    ? '<table><tr><th>metric</th><th>prefer higher</th><th>mean |z|</th><th>discrimination</th><th>shape</th><th>ideal z</th></tr>' +
      maRows.map(([k, v]) => {
        const disc = v.firstCall != null
          ? `calls from ${v.firstCall.toFixed(2)}σ${v.maxNoCall != null ? ` · silence to ${v.maxNoCall.toFixed(2)}σ` : ''}`
          : '—';
        const ideal = v.ideal != null ? `${v.ideal >= 0 ? '+' : ''}${v.ideal.toFixed(2)}σ` : '—';
        return `<tr><td>${METRIC_LABELS[k] || k}</td><td class="mono">${v.higher}/${v.n} · ${ciStr(v.w)}</td>` +
          `<td class="mono">${v.meanAbsZ != null ? v.meanAbsZ.toFixed(2) + 'σ' : '—'}</td>` +
          `<td class="mono">${disc}</td><td>${v.shape}</td><td class="mono">${ideal}</td></tr>`;
      }).join('') + '</table>'
    : '<p class="hint">no feature picks yet — they appear on phase-2 pairs</p>');

  const winners = state.rounds.map((r) => r.ranking[0]).filter((id) => measureCache.has(id));
  if (!winners.length) { $('#profile-means').innerHTML = '<p class="hint">no measured winners yet</p>'; return; }
  const means = {};
  for (const k of DISPLAY_KEYS) means[k] = winners.reduce((s, id) => s + measureCache.get(id)[k], 0) / winners.length;
  $('#profile-means').innerHTML = '<div class="means-grid">' +
    DISPLAY_KEYS.map((k) => `<div class="mean-cell"><div class="k">${k}</div><div class="v">${means[k].toFixed(3)}</div></div>`).join('') + '</div>';
}
function summaryText() {
  const lines = ['attraction-guide run ' + state.startedAt + ' (adaptive v2)'];
  if (state.prefs) lines.push('selection: presenting as ' + state.prefs.sex + ' · ' + prefsSummary(state.prefs.sel));
  if (state.refVector) lines.push('round 0 (reference): ' + JSON.stringify(state.refVector));
  for (const a of ARCHETYPES) lines.push(`archetype ${ARCHETYPE_LABELS[a]}: ${state.archWins[a]}W [${confidence(state.archWins[a])[1]}]`);
  for (const axis of Object.keys(PAIR_AXES)) {
    const sc = axisScore(axis);
    lines.push(`${axis} [${state.axisStatus[axis]}]: ${sc.c}/${sc.n} consistent (${sc.direct} direct), 95% CI ${ciStr(wilson(sc.c, sc.n))}, target=${AXIS_TARGET[axis]}`);
  }
  const cf = configurality();
  if (cf.total) lines.push(`configurality: ${cf.agree}/${cf.total} holistic=feature-majority`);
  for (const [k, v] of Object.entries(metricAnalysis()).filter(([, x]) => x.n > 0).sort((a, b) => b[1].n - a[1].n).slice(0, 8))
    lines.push(`feature ${k}: ${v.higher}/${v.n} higher (${ciStr(v.w)}), ideal ${v.ideal != null ? (v.ideal >= 0 ? '+' : '') + v.ideal.toFixed(2) + 'σ' : '—'}, ${v.shape}`);
  return lines.join('\n');
}

// ---------- log ----------
function renderLog() {
  if (!state) return;
  let html = '<table><tr><th>#</th><th>phase</th><th>shown</th><th>ranking</th><th>measured deltas</th><th>feature picks</th><th>inference</th></tr>';
  if (state.refVector) html += `<tr><td>0</td><td>ref</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="mono">${JSON.stringify(state.refVector)}</td></tr>`;
  for (const r of state.rounds) {
    const deltas = r.trial && r.trial.topDeltas.length
      ? r.trial.topDeltas.map((d) => `${d.k} ${d.z >= 0 ? '+' : ''}${d.z}σ`).join(', ') + (r.trial.confound ? ' ⚠' : '')
      : '—';
    const feats = (r.featurePicks || []).map((p) => {
      const side = p.winner == null ? '—' : p.winner === r.shown[0] ? 'A' : 'B';
      const dz = p.dz != null ? `(${p.dz > 0 ? '+' : ''}${p.dz})` : '';
      return `${METRIC_LABELS[p.k] || p.k}:${side}${dz}`;
    }).join(', ') || '—';
    html += `<tr><td>${r.n}</td><td>${r.phase}${r.axis ? ' · ' + r.axis : ''}</td><td class="mono">${r.shown.join(', ')}</td><td class="mono">${r.ranking.join(' > ')}</td><td class="mono">${deltas}</td><td class="mono">${feats}</td><td>${r.inference}</td></tr>`;
  }
  $('#log-table').innerHTML = html + '</table>';
}

// ---------- reference upload ----------
function initRefUpload() {
  $('#ref-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const m = measureImage(img);
      const txt = m ? JSON.stringify(m) : 'no face detected';
      $('#ref-result').textContent = 'round 0 vector: ' + txt;
      if (m) { state.refVector = m; save(); renderLog(); }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// ---------- pregame preferences UI ----------
function renderPrefs() {
  const host = $('#group-picks');
  host.innerHTML = '';
  const counts = treeCounts();
  const sel = prefs.sel || allKeys();
  for (const [g, t] of Object.entries(GROUP_TREE)) {
    const c = counts[g];
    if (!c) continue; // group absent from bank — don't render it
    const subKeys = Object.keys(t.subs).map((s) => subKey(g, s));
    const nOn = subKeys.filter((k) => sel.includes(k)).length;
    const sec = document.createElement('div');
    sec.className = 'gsec';
    const head = document.createElement('label');
    head.className = 'gpick' + (nOn === 0 ? ' off' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = nOn > 0;
    cb.indeterminate = nOn > 0 && nOn < subKeys.length;
    cb.addEventListener('change', () => onGroupToggle(g, cb.checked));
    head.append(cb, document.createTextNode(t.label + ' '));
    const cnt = document.createElement('span');
    cnt.className = 'cnt'; cnt.textContent = c.total;
    head.append(cnt);
    sec.appendChild(head);
    const subs = document.createElement('div');
    subs.className = 'gsubs';
    for (const [s, sl] of Object.entries(t.subs)) {
      const k = subKey(g, s);
      const n = c.subs[s] || 0;
      const chip = document.createElement('label');
      chip.className = 'gpick sub' + (sel.includes(k) ? '' : ' off');
      chip.title = n === 0 ? 'no faces in this subgroup yet' : '';
      const scb = document.createElement('input');
      scb.type = 'checkbox';
      scb.checked = sel.includes(k);
      scb.disabled = n === 0;
      scb.addEventListener('change', () => onSubToggle(k, scb.checked));
      chip.append(scb, document.createTextNode(sl + ' '));
      const cc = document.createElement('span');
      cc.className = 'cnt'; cc.textContent = n;
      chip.append(cc);
      subs.appendChild(chip);
    }
    sec.appendChild(subs);
    host.appendChild(sec);
  }
  const sf = $('#sex-f'), sm = $('#sex-m');
  sf.classList.toggle('active', prefs.sex === 'female');
  // male bank doesn't exist yet — the button stays disabled until it does
  sm.disabled = !BANK.some((f) => f.sex === 'male');
  sm.textContent = sm.disabled ? 'male · soon' : 'male';
  sm.classList.toggle('active', prefs.sex === 'male');
  sf.onclick = () => setSex('female');
  sm.onclick = () => { if (!sm.disabled) setSex('male'); };
  updatePrefsHint();
}
function confirmPrefsReset() {
  if (state && state.rounds.length && !confirm('Changing who appears will reset the current run. Continue?')) {
    renderPrefs(); return false;
  }
  if (state && state.rounds.length) { state = blankState(); currentRound = null; rankOrder = []; save(); }
  return true;
}
function onGroupToggle(g, on) {
  if (!confirmPrefsReset()) return;
  const sel = new Set(prefs.sel || allKeys());
  for (const s of Object.keys(GROUP_TREE[g].subs)) {
    const k = subKey(g, s);
    if (on) sel.add(k); else sel.delete(k);
  }
  prefs.sel = normSel([...sel]);
  savePrefs(); renderPrefs(); renderProfile(); renderLog();
}
function onSubToggle(k, on) {
  if (!confirmPrefsReset()) return;
  const sel = new Set(prefs.sel || allKeys());
  if (on) sel.add(k); else sel.delete(k);
  prefs.sel = normSel([...sel]);
  savePrefs(); renderPrefs(); renderProfile(); renderLog();
}
function setSex(s) {
  if (s === prefs.sex) return;
  if (!confirmPrefsReset()) return;
  prefs.sex = s;
  savePrefs(); renderPrefs(); renderProfile(); renderLog();
}
function updatePrefsHint() {
  const n1 = activeBank().filter((f) => f.phase === 1).length;
  const axes = Object.keys(PAIR_AXES).filter((a) => pairPool(a).length > 0).length;
  $('#prefs-hint').textContent =
    `${n1} archetype faces · ${axes}/5 drill-down axes have valid pairs under this selection`;
}
function prefsValid() {
  return activeBank().filter((f) => f.phase === 1).length >= 4;
}

// ---------- nav / boot ----------
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'profile') renderProfile();
  if (name === 'log') renderLog();
}
async function boot() {
  const res = await fetch('faces/faces.json');
  BANK = (await res.json()).faces;
  try {
    const sres = await fetch('js/bank-stats.json');
    STATS = await sres.json();
  } catch (e) { STATS = null; }
  state = load() || blankState();
  // axes with no qualifying pairs are dead on arrival — say so
  for (const axis of Object.keys(PAIR_AXES)) {
    if (state.axisStatus[axis] === 'open' && pairPool(axis).length === 0 && state.axisTrials[axis].length === 0)
      state.axisStatus[axis] = 'no-pairs';
  }
  save();

  document.querySelectorAll('nav button').forEach((b) => b.onclick = () => showView(b.dataset.view));
  renderPrefs();
  $('#start-btn').onclick = () => {
    if (!prefsValid()) {
      $('#prefs-hint').textContent = 'select enough groups to include at least 4 archetype faces';
      showView('setup');
      return;
    }
    state.prefs = { sex: prefs.sex, sel: prefs.sel || allKeys() };
    save();
    showView('play');
    if (!currentRound) nextRound(); else renderRound();
  };
  $('#reset-btn').onclick = () => { if (confirm('Reset the run? All picks are wiped.')) { state = blankState(); currentRound = null; rankOrder = []; save(); renderProfile(); renderLog(); showView('setup'); } };
  $('#lock-btn').onclick = lockRanking;
  $('#clear-rank').onclick = () => { rankOrder = []; updateRankUI(); };
  $('#export-json').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'attraction-guide-run.json'; a.click();
  };
  $('#copy-summary').onclick = () => navigator.clipboard.writeText(summaryText()).then(() => alert('summary copied'));

  initRefUpload();
  initMeasure().then(() => { window.__lmReady = true; flushMeasures(); });
  renderProfile(); renderLog();
}
boot();
