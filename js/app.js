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

let BANK = [];
let STATS = null;   // { metrics: {k:{mean,std}}, axis_dir: {axis: -1|0|+1} }
let state = null;
let currentRound = null;
let rankOrder = [];
const measureCache = new Map();

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
function consistentCount(axis) {
  return state.axisTrials[axis].filter((t) => t.consistent).length;
}
function inferPhase2(axis, winner, loser) {
  const mw = measureCache.get(winner.id), ml = measureCache.get(loser.id);
  const target = AXIS_TARGET[axis];
  const dir = STATS ? STATS.axis_dir[axis] : 0;
  const trial = {
    n: state.p2Round, anchor: winner.anchor, shown: [winner.id, loser.id],
    winner: winner.id, loser: loser.id, targetMetric: target,
    targetDelta: null, targetZ: null, consistent: null, confound: false,
    confoundMetric: null, topDeltas: [], unmeasured: false,
  };
  let inf;
  if (mw && ml && STATS) {
    const sd = STATS.metrics;
    const dz = (k) => (mw[k] - ml[k]) / sd[k].std;
    const tz = dz(target);
    trial.targetDelta = +(mw[target] - ml[target]).toFixed(3);
    trial.targetZ = +tz.toFixed(2);
    trial.consistent = dir === 0
      ? winner.variant === PAIR_AXES[axis][0]
      : Math.sign(tz) === dir && Math.abs(tz) > 0.05;
    const ranked = STRUCT.filter((k) => isFinite(dz(k))).map((k) => ({ k, z: dz(k) }))
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    trial.topDeltas = ranked.slice(0, 3).map((o) => ({ k: o.k, z: +o.z.toFixed(2) }));
    const topConf = ranked.find((o) => o.k !== target);
    if (topConf && Math.abs(topConf.z) > Math.abs(tz)) {
      trial.confound = true;
      trial.confoundMetric = topConf.k;
    }
    const c = consistentCount(axis) + (trial.consistent ? 1 : 0);
    const [cls, label] = confidence(c);
    const dLabel = dir === 0
      ? (trial.consistent ? `${winner.variant} (label)` : `${loser.variant} (label)`)
      : `${target} ${tz >= 0 ? '+' : ''}${tz.toFixed(2)}σ`;
    inf = {
      text: `${axis} · ${winner.variant} > ${loser.variant} — ${dLabel}, target-consistent ${c}W — ${label}.` +
        (trial.confound ? ` ⚠ confound: ${METRIC_LABELS[trial.confoundMetric]} moved harder (${topConf.z.toFixed(2)}σ vs ${tz.toFixed(2)}σ).` : ''),
      cls: trial.confound ? 'weak' : cls,
    };
  } else {
    // measurement or stats unavailable: label fallback, flagged
    trial.unmeasured = true;
    const c = consistentCount(axis);
    const [cls, label] = confidence(c);
    inf = { text: `${axis} · ${winner.variant} > ${loser.variant} — unmeasured fallback (${label}).`, cls: 'weak' };
  }
  state.axisTrials[axis].push(trial);
  updateAxisStatus(axis);
  return { text: inf.text, cls: inf.cls, trial };
}
function updateAxisStatus(axis) {
  const t = state.axisTrials[axis];
  if (consistentCount(axis) >= CONFIRM_WINS) state.axisStatus[axis] = 'confirmed';
  else if (t.length >= MAX_TRIALS) state.axisStatus[axis] = 'unresolved';
}

// ---------- adaptive queue ----------
// Admission bar: the pair must ISOLATE its variable — target-family z must
// exceed every true-confound z (audit validity > 0). Strength (target z) is
// reported in the UI and drives pair preference, not admission.
function pairPool(axis) {
  const [v0, v1] = PAIR_AXES[axis];
  const byAnchor = {};
  for (const f of BANK) {
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
  const fresh = open.filter((a) => state.axisTrials[a].length === 0);
  if (fresh.length) return fresh[0]; // initial sweep, fixed axis order
  // adaptive: fewest target-consistent trials, then fewest trials total
  return open.slice().sort((a, b) =>
    consistentCount(a) - consistentCount(b) || state.axisTrials[a].length - state.axisTrials[b].length)[0];
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
  const pool = BANK.filter((f) => f.phase === 1);
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
  const rec = { n: r.n, phase: r.phase, axis: r.axis || null, anchor: r.anchor || null, shown: r.faces, ranking, inference: inf.text };
  if (trialRec) rec.trial = trialRec;
  state.rounds.push(rec);
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
  let html = '<table class="axes"><tr><th>axis</th><th>evidence</th><th>trials</th><th>confounds</th><th>status</th></tr>';
  for (const a of ARCHETYPES) {
    const w = state.archWins[a];
    const [cls, label] = confidence(w);
    html += `<tr><td>archetype</td><td>${ARCHETYPE_LABELS[a]}</td><td class="mono">${w}W</td><td class="mono">—</td><td><span class="conf ${cls}">${label}</span></td></tr>`;
  }
  for (const axis of Object.keys(PAIR_AXES)) {
    const trials = state.axisTrials[axis];
    const c = consistentCount(axis);
    const conf = trials.filter((t) => t.confound).length;
    const unm = trials.filter((t) => t.unmeasured).length;
    const [cls, label] = confidence(c);
    const st = state.axisStatus[axis];
    const pool = pairPool(axis).length;
    const statusLabel = st === 'open' && pool === 0 ? 'no valid pairs' : (AXIS_STATUS_LABEL[st] || st);
    const ev = `${AXIS_TARGET[axis]} ${c}W-consistent${unm ? ` (+${unm} unmeasured)` : ''}`;
    html += `<tr><td>${axis}</td><td class="mono">${ev}</td><td class="mono">${trials.length}</td>` +
      `<td class="mono">${conf ? `⚠${conf}` : '—'}</td>` +
      `<td><span class="conf ${st === 'confirmed' ? 'confirmed' : st === 'unresolved' ? 'weak' : 'leaning'}">${statusLabel}</span> <span class="hint">${label}</span></td></tr>`;
  }
  $('#profile-axes').innerHTML = html + '</table>';

  const winners = state.rounds.map((r) => r.ranking[0]).filter((id) => measureCache.has(id));
  if (!winners.length) { $('#profile-means').innerHTML = '<p class="hint">no measured winners yet</p>'; return; }
  const means = {};
  for (const k of DISPLAY_KEYS) means[k] = winners.reduce((s, id) => s + measureCache.get(id)[k], 0) / winners.length;
  $('#profile-means').innerHTML = '<div class="means-grid">' +
    DISPLAY_KEYS.map((k) => `<div class="mean-cell"><div class="k">${k}</div><div class="v">${means[k].toFixed(3)}</div></div>`).join('') + '</div>';
}
function summaryText() {
  const lines = ['attraction-guide run ' + state.startedAt + ' (adaptive v2)'];
  if (state.refVector) lines.push('round 0 (reference): ' + JSON.stringify(state.refVector));
  for (const a of ARCHETYPES) lines.push(`archetype ${ARCHETYPE_LABELS[a]}: ${state.archWins[a]}W [${confidence(state.archWins[a])[1]}]`);
  for (const axis of Object.keys(PAIR_AXES)) {
    const t = state.axisTrials[axis];
    const c = consistentCount(axis);
    const conf = t.filter((x) => x.confound).length;
    lines.push(`${axis} [${state.axisStatus[axis]}]: ${c} target-consistent / ${t.length} trials, ${conf} confounded, target=${AXIS_TARGET[axis]}`);
  }
  return lines.join('\n');
}

// ---------- log ----------
function renderLog() {
  if (!state) return;
  let html = '<table><tr><th>#</th><th>phase</th><th>shown</th><th>ranking</th><th>measured deltas</th><th>inference</th></tr>';
  if (state.refVector) html += `<tr><td>0</td><td>ref</td><td>—</td><td>—</td><td>—</td><td class="mono">${JSON.stringify(state.refVector)}</td></tr>`;
  for (const r of state.rounds) {
    const deltas = r.trial && r.trial.topDeltas.length
      ? r.trial.topDeltas.map((d) => `${d.k} ${d.z >= 0 ? '+' : ''}${d.z}σ`).join(', ') + (r.trial.confound ? ' ⚠' : '')
      : '—';
    html += `<tr><td>${r.n}</td><td>${r.phase}${r.axis ? ' · ' + r.axis : ''}</td><td class="mono">${r.shown.join(', ')}</td><td class="mono">${r.ranking.join(' > ')}</td><td class="mono">${deltas}</td><td>${r.inference}</td></tr>`;
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
  $('#start-btn').onclick = () => { showView('play'); if (!currentRound) nextRound(); else renderRound(); };
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
