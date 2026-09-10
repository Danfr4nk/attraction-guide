// attraction-guide — game engine. Static, no backend. All state in localStorage.
import { ensureLandmarker, measureImage, formatMetrics, METRIC_LABELS } from './measure.js';

const LS_KEY = 'attraction-guide-run-v1';
const ARCHETYPES = ['wide', 'long', 'heart', 'round'];
const ARCHETYPE_LABELS = { wide: 'wide-angular', long: 'long-narrow', heart: 'heart', round: 'round' };
const PAIR_AXES = {
  jaw: ['sharp', 'soft'],
  lips: ['full', 'thin'],
  eyes: ['wide', 'close'],
  brow: ['thick', 'thin'],
  nose: ['narrow', 'wide'],
};
const P1_ROUNDS_BEFORE_ADVANCE = 3;

let BANK = [];
let state = null;
let currentRound = null;   // {phase, faces:[faceIds], axis?}
let rankOrder = [];        // faceIds in click order
const measureCache = new Map();

const $ = (s) => document.querySelector(s);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const faceById = (id) => BANK.find((f) => f.id === id);

// ---------- state ----------
function blankState() {
  return {
    startedAt: new Date().toISOString(),
    refVector: null,
    rounds: [],
    archWins: { wide: 0, long: 0, heart: 0, round: 0 },
    pairWins: { jaw: { sharp: 0, soft: 0 }, lips: { full: 0, thin: 0 }, eyes: { wide: 0, close: 0 }, brow: { thick: 0, thin: 0 }, nose: { narrow: 0, wide: 0 } },
    phase: 1,
    p1Round: 0,
    p1Used: [],
    p2Queue: [],
  };
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.rounds) return s; } catch (e) {}
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
  if (measureCache.has(faceId)) { statsEl.textContent = formatMetrics(measureCache.get(faceId)); return; }
  pendingMeasures.push({ faceId, imgEl, statsEl });
  flushMeasures();
}
function flushMeasures() {
  if (!window.__lmReady) return;
  while (pendingMeasures.length) {
    const { faceId, imgEl, statsEl } = pendingMeasures.shift();
    if (measureCache.has(faceId)) { statsEl.textContent = formatMetrics(measureCache.get(faceId)); continue; }
    const m = measureImage(imgEl);
    if (m) { measureCache.set(faceId, m); statsEl.textContent = formatMetrics(m); }
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
  // contradiction: previous leader displaced
  const lead = Object.entries(state.archWins).sort((a, b) => b[1] - a[1])[0];
  if (lead[0] !== winnerArch && lead[1] >= 2) s += ` Note: ${ARCHETYPE_LABELS[lead[0]]} led at ${lead[1]}W — lead change, treat as contested.`;
  return { text: s, cls };
}
function inferPhase2(axis, winnerVar, loserVar) {
  const w = state.pairWins[axis];
  w[winnerVar]++;
  const [cls, label] = confidence(w[winnerVar]);
  return { text: `${winnerVar} > ${loserVar} on ${axis} (${w[winnerVar]}W–${w[loserVar]}L) — ${label}.`, cls };
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
function refillP2Queue() {
  const q = [];
  for (const [axis, vars] of Object.entries(PAIR_AXES)) {
    const a = BANK.find((f) => f.phase === 2 && f.axis === axis && f.variant === vars[0]);
    const b = BANK.find((f) => f.phase === 2 && f.axis === axis && f.variant === vars[1]);
    if (a && b) q.push({ axis, pair: shuffle([a.id, b.id]) });
  }
  state.p2Queue = shuffle(q);
}
function nextRound() {
  rankOrder = [];
  if (state.phase === 1) {
    state.p1Round++;
    const faces = p1Faces();
    state.p1Used.push(...faces.map((f) => f.id));
    currentRound = { phase: 1, n: state.p1Round, faces: faces.map((f) => f.id) };
  } else {
    if (!state.p2Queue.length) refillP2Queue();
    const { axis, pair } = state.p2Queue.pop();
    state.p2Round = (state.p2Round || 0) + 1;
    currentRound = { phase: 2, n: state.p2Round, faces: pair, axis };
  }
  save();
  renderRound();
}
function faceLabel(f) {
  if (f.phase === 1) return `arch · ${ARCHETYPE_LABELS[f.archetype]}`;
  return `${f.axis} · ${f.variant}`;
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
    : `phase 2 · pair ${r.n} — one variable: ${r.axis}`;

  if (r.phase === 1 && state.p1Round >= 2) {
    head.innerHTML += ` <button id="adv-btn" class="ghost" style="margin-left:12px">advance to phase 2 →</button>`;
    $('#adv-btn').onclick = () => { state.phase = 2; refillP2Queue(); nextRound(); };
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
  let inf;
  if (r.phase === 1) {
    inf = inferPhase1(winner.archetype, r.faces.map((id) => faceById(id).archetype));
  } else {
    const loser = faceById(ranking[1]);
    inf = inferPhase2(r.axis, winner.variant, loser.variant);
  }
  state.rounds.push({ n: r.n, phase: r.phase, axis: r.axis || null, shown: r.faces, ranking, inference: inf.text });
  save();
  $('#inference').textContent = inf.text;
  renderRoundStats(ranking);
  const nb = document.createElement('button');
  nb.id = 'next-btn'; nb.className = 'primary'; nb.style.marginLeft = '8px';
  nb.textContent = r.phase === 1 && state.p1Round >= P1_ROUNDS_BEFORE_ADVANCE ? 'Start phase 2 →' : 'Next round →';
  nb.onclick = () => {
    if (r.phase === 1 && state.p1Round >= P1_ROUNDS_BEFORE_ADVANCE) { state.phase = 2; refillP2Queue(); }
    nextRound();
  };
  $('.stage-actions').appendChild(nb);
  $('#lock-btn').disabled = true;
  renderProfile(); renderLog();
}
function renderRoundStats(ranking) {
  const el = $('#round-stats');
  const keys = Object.keys(METRIC_LABELS);
  let html = '<table><tr><th>face</th>' + keys.map((k) => `<th>${METRIC_LABELS[k]}</th>`).join('') + '</tr>';
  ranking.forEach((fid, i) => {
    const m = measureCache.get(fid);
    html += `<tr class="${i === 0 ? 'winner' : ''}"><td>#${i + 1} ${fid}</td>` +
      keys.map((k) => `<td>${m ? m[k].toFixed(3) : '—'}</td>`).join('') + '</tr>';
  });
  el.innerHTML = html + '</table>';
}

// ---------- profile ----------
function renderProfile() {
  if (!state) return;
  let html = '<table class="axes"><tr><th>axis</th><th>variant</th><th>record</th><th>confidence</th></tr>';
  for (const a of ARCHETYPES) {
    const w = state.archWins[a];
    const [cls, label] = confidence(w);
    html += `<tr><td>archetype</td><td>${ARCHETYPE_LABELS[a]}</td><td class="mono">${w}W</td><td><span class="conf ${cls}">${label}</span></td></tr>`;
  }
  for (const [axis, vars] of Object.entries(PAIR_AXES)) {
    for (const v of vars) {
      const w = state.pairWins[axis][v], l = state.pairWins[axis][vars.find((x) => x !== v)];
      const [cls, label] = confidence(w);
      html += `<tr><td>${axis}</td><td>${v}</td><td class="mono">${w}W–${l}L</td><td><span class="conf ${cls}">${label}</span></td></tr>`;
    }
  }
  $('#profile-axes').innerHTML = html + '</table>';

  // winner means
  const winners = state.rounds.map((r) => r.ranking[0]).filter((id) => measureCache.has(id));
  if (!winners.length) { $('#profile-means').innerHTML = '<p class="hint">no measured winners yet</p>'; return; }
  const keys = Object.keys(METRIC_LABELS);
  const means = {};
  for (const k of keys) means[k] = winners.reduce((s, id) => s + measureCache.get(id)[k], 0) / winners.length;
  $('#profile-means').innerHTML = '<div class="means-grid">' +
    keys.map((k) => `<div class="mean-cell"><div class="k">${k}</div><div class="v">${means[k].toFixed(3)}</div></div>`).join('') + '</div>';
}
function summaryText() {
  const lines = ['attraction-guide run ' + state.startedAt];
  if (state.refVector) lines.push('round 0 (reference): ' + JSON.stringify(state.refVector));
  for (const a of ARCHETYPES) lines.push(`archetype ${ARCHETYPE_LABELS[a]}: ${state.archWins[a]}W [${confidence(state.archWins[a])[1]}]`);
  for (const [axis, vars] of Object.entries(PAIR_AXES)) {
    const w = state.pairWins[axis];
    lines.push(`${axis}: ${vars[0]} ${w[vars[0]]}W – ${vars[1]} ${w[vars[1]]}W`);
  }
  return lines.join('\n');
}

// ---------- log ----------
function renderLog() {
  if (!state) return;
  let html = '<table><tr><th>#</th><th>phase</th><th>shown</th><th>ranking</th><th>inference</th></tr>';
  if (state.refVector) html += `<tr><td>0</td><td>ref</td><td>—</td><td>—</td><td class="mono">${JSON.stringify(state.refVector)}</td></tr>`;
  for (const r of state.rounds) {
    html += `<tr><td>${r.n}</td><td>${r.phase}${r.axis ? ' · ' + r.axis : ''}</td><td class="mono">${r.shown.join(', ')}</td><td class="mono">${r.ranking.join(' > ')}</td><td>${r.inference}</td></tr>`;
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
  state = load() || blankState();
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
