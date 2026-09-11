// Analysis-layer harness: unified evidence, Wilson CIs, marginal preferences,
// configurality, discrimination thresholds. Synthetic landmarks, real measureImage math.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const LS_KEY = 'attraction-guide-run-v2';

// ---------- synthetic landmarks ----------
function synthLM(over = {}) {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const base = {
    33: [0.35, 0.4], 133: [0.42, 0.4], 362: [0.58, 0.4], 263: [0.65, 0.4],
    159: [0.385, 0.39], 145: [0.385, 0.41], 386: [0.615, 0.39], 374: [0.615, 0.41],
    61: [0.4, 0.7], 291: [0.6, 0.7], 0: [0.5, 0.69], 17: [0.5, 0.71],
    1: [0.5, 0.58], 98: [0.47, 0.6], 327: [0.53, 0.6],
    152: [0.5, 0.9], 172: [0.35, 0.75], 397: [0.65, 0.75],
    234: [0.3, 0.5], 454: [0.7, 0.5], 10: [0.5, 0.1],
    13: [0.5, 0.695], 14: [0.5, 0.705],
  };
  for (const [i, [x, y]] of Object.entries(base)) lm[i] = { x, y, z: 0 };
  for (const [i, [x, y]] of Object.entries(over)) lm[i] = { x, y, z: 0 };
  return lm;
}
// A: thin lips (0.10), sharp gonial (~146.3°). B: full lips (0.15), wide gonial (~131.3°).
const LM = {
  lipA: synthLM(),
  lipB: synthLM({ 0: [0.5, 0.685], 17: [0.5, 0.715], 172: [0.33, 0.78], 397: [0.67, 0.78] }),
  p1w: synthLM(), p1l: synthLM(), p1h: synthLM(), p1r: synthLM(),
};

// ---------- fake bank + stats ----------
const FACES_JSON = {
  faces: [
    { id: 'p1w', file: 'faces/p1w.png', phase: 1, archetype: 'wide' },
    { id: 'p1l', file: 'faces/p1l.png', phase: 1, archetype: 'long' },
    { id: 'p1h', file: 'faces/p1h.png', phase: 1, archetype: 'heart' },
    { id: 'p1r', file: 'faces/p1r.png', phase: 1, archetype: 'round' },
    { id: 'lipA', file: 'faces/lipA.png', phase: 2, axis: 'lips', variant: 'full', anchor: 'lip-pair', pair_validity: 2.5, pair_target_z: 2.5 },
    { id: 'lipB', file: 'faces/lipB.png', phase: 2, axis: 'lips', variant: 'thin', anchor: 'lip-pair', pair_validity: 2.5, pair_target_z: 2.5 },
  ],
};
const STRUCT = ['gonial_angle_mean', 'jaw_to_cheek', 'width_height_ratio', 'fwhr_proxy',
  'ipd_to_cheek', 'eye_spacing_widths', 'eye_w_to_h', 'canthal_tilt_mean',
  'fifths', 'nose_to_cheek', 'nose_w_to_intercanthal', 'mouth_to_cheek',
  'mouth_to_nose', 'lip_fullness', 'upper_lower_lip', 'brow_arch_mean',
  'brow_eye_dist_pct', 'mean_asymmetry', 'asymmetry_9', 'third_upper_pct',
  'third_mid_pct', 'third_lower_pct', 'chin_to_lower_third', 'philtrum_to_nose'];
const BSTATS = { metrics: {}, axis_dir: { jaw: -1, lips: 1, eyes: 0, brow: 0, nose: 0 } };
for (const k of STRUCT) BSTATS.metrics[k] = { mean: 0, std: 1000 };
BSTATS.metrics.lip_fullness = { mean: 0.1, std: 0.02 };   // B z=+2.5
BSTATS.metrics.gonial_angle_mean = { mean: 140, std: 3 };  // A z=+2.1, B z=-2.9

// ---------- jsdom ----------
const html = fs.readFileSync(APP + '/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/' });
for (const k of ['window', 'document', 'localStorage', 'Image', 'Blob', 'URL'])
  globalThis[k] = dom.window[k];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.confirm = () => true;
globalThis.fetch = async (url) => {
  if (url === 'faces/faces.json') return { json: async () => FACES_JSON };
  if (url === 'js/bank-stats.json') return { json: async () => BSTATS };
  throw new Error('unexpected fetch: ' + url);
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const getState = () => JSON.parse(localStorage.getItem(LS_KEY));

// ---------- results ----------
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra: cond ? '' : String(extra).slice(0, 300) });
  if (!cond) console.log('FAIL:', name, String(extra).slice(0, 300));
};

// ---------- boot ----------
await import(APP + '/js/app.js');
for (let i = 0; i < 200 && !window.__lmReady; i++) await tick(25);
ok('boot: landmarks ready', !!window.__lmReady);

// ---------- helpers ----------
function attachLandmarks() {
  for (const card of $$('.face-card')) {
    const img = card.querySelector('img');
    img.__landmarks = LM[card.dataset.fid];
    img.onload();
  }
}
function clickCard(fid) { $(`.face-card[data-fid="${fid}"]`).click(); }
async function lockAndNext() {
  $('#lock-btn').click();
  await tick();
  $('#next-btn').click();
  await tick();
}
function fpRows() { return $$('#feature-picks .fp-row'); }
function rowInfo(row) {
  const t = row.innerHTML;
  const m = t.match(/A ([\d.]+) · B ([\d.]+)/);
  const key = t.includes('lip full') ? 'lip_fullness' : t.includes('gonial°') ? 'gonial_angle_mean' : '?';
  return { key, aVal: +m[1], bVal: +m[2], row };
}
function clickFp(row, side) {
  [...row.querySelectorAll('button[data-side]')].find((b) => b.dataset.side === side).click();
}

// ---------- phase 1: 3 rounds ----------
$('#start-btn').click();
await tick();
for (let rnd = 0; rnd < 3; rnd++) {
  attachLandmarks();
  await tick();
  for (const card of $$('.face-card')) card.click();
  ok(`p1 round ${rnd + 1}: lock enabled after full ranking`, !$('#lock-btn').disabled);
  await lockAndNext();
}
ok('advanced to phase 2', $('#round-head').textContent.includes('phase 2'));
ok('phase-2 axis is lips', $('#round-head').textContent.includes('lips'));

// ---------- trial 1: toggle behavior, confounded holistic with no direct backup ----------
attachLandmarks();
await tick();
let rows = fpRows();
ok('trial1: 2 feature rows (lip target + gonial)', rows.length === 2, rows.length);
const lipRow1 = rows.map(rowInfo).find((r) => r.key === 'lip_fullness');
ok('trial1: target row present', !!lipRow1);
// toggle: pick A, then A again -> cleared
clickFp(lipRow1.row, 'A');
ok('trial1: fp-count 1 after pick', $('#fp-count').textContent === '1');
clickFp(lipRow1.row, 'A');
ok('trial1: toggle clears pick', $('#fp-count').textContent === '0');
// holistic only: rank lipA first, lock
clickCard('lipA'); clickCard('lipB');
$('#lock-btn').click();
await tick();
let st = getState();
let t1 = st.rounds[st.rounds.length - 1];
ok('trial1: confound flagged (gonial moved harder than lip target)', t1.trial.confound === true, JSON.stringify(t1.trial.topDeltas));
ok('trial1: inference names confound', $('#inference').textContent.includes('confound'));
ok('trial1: evidence shows 0/0 (confounded holistic dropped)', $('#inference').textContent.includes('0/0 consistent'));
ok('trial1: uncalled rows recorded with zAbs (skipped, not threshold evidence)', t1.featurePicks.length === 2 && t1.featurePicks.every((p) => p.winner === null && p.zAbs > 0 && !p.noTell),
  JSON.stringify(t1.featurePicks.map((p) => p.zAbs)));
{
  const axes = $('#profile-axes').innerHTML;
  ok('trial1: profile lips card shows 0/0 evidence', /<b>lips<\/b>[\s\S]*?0\/0 evidence/.test(axes), axes.slice(0, 300));
  ok('trial1: HUD chip for lips exists with no dots', $('#hud .hud-chip[data-axis="lips"]') && !$('#hud .hud-chip[data-axis="lips"] .dot'), $('#hud').innerHTML.slice(0, 300));
  ok('trial1: queue rationale says fewest evidence', $('#hud .hud-why').textContent.includes('fewest'), $('#hud .hud-why').textContent);
}

// ---------- trial 2: direct picks override + cross-axis evidence ----------
$('#next-btn').click();
await tick();
attachLandmarks();
await tick();
rows = fpRows();
ok('trial2: same pair re-shown (2 rows)', rows.length === 2, rows.length);
const infos = rows.map(rowInfo);
// lip -> HIGHER value (consistent w/ dir=+1); gonial -> LOWER value (consistent w/ dir=-1)
for (const info of infos) {
  const wantHigher = info.key === 'lip_fullness';
  const side = (wantHigher === (info.aVal > info.bVal)) ? 'A' : 'B';
  clickFp(info.row, side);
}
ok('trial2: fp-count 2', $('#fp-count').textContent === '2');
// holistic winner = lipB (both feature picks land on lipB)
clickCard('lipB'); clickCard('lipA');
$('#lock-btn').click();
await tick();
st = getState();
const t2 = st.rounds[st.rounds.length - 1];
const lipPick = t2.featurePicks.find((p) => p.k === 'lip_fullness');
const gonPick = t2.featurePicks.find((p) => p.k === 'gonial_angle_mean');
ok('trial2: lip pick dz signed winner-minus-loser (+2.5)', Math.abs(lipPick.dz - 2.5) < 0.01, JSON.stringify(lipPick));
ok('trial2: gonial pick dz negative (~-5)', gonPick.dz < -4, JSON.stringify(gonPick));
ok('trial2: lip pick stores winner bank z (wz=+2.5)', Math.abs(lipPick.wz - 2.5) < 0.01, JSON.stringify(lipPick));
ok('trial2: both picks on lipB', lipPick.winner === 'lipB' && gonPick.winner === 'lipB');
{
  const inf = $('#inference').textContent;
  ok('trial2: inference shows direct evidence count', inf.includes('1/1 consistent (1 direct)'), inf);
  ok('trial2: feature/holistic agreement 2/2', inf.includes('Features: 2/2 with holistic pick.'), inf);
}
{
  const axes = $('#profile-axes').innerHTML;
  ok('trial2: lips card 1/1 evidence (1 direct)', /<b>lips<\/b>[\s\S]*?1\/1 evidence \(1 direct\)/.test(axes), axes.slice(0, 500));
  ok('trial2: jaw card 1/1 via cross-axis direct pick', /<b>jaw<\/b>[\s\S]*?1\/1 evidence \(1 direct\)/.test(axes), axes.slice(0, 500));
  ok('trial2: Wilson CI rendered on axes', axes.includes('[21%–100%]'), axes.slice(0, 600));
  ok('trial2: HUD lips chip has 1 filled dot', $('#hud .hud-chip[data-axis="lips"] .dot.c') !== null);
  ok('trial2: HUD jaw chip has 1 ringed direct dot', $('#hud .hud-chip[data-axis="jaw"] .dot.c.d') !== null);
}
{
  const feat = $('#profile-features').innerHTML;
  ok('trial2: configurality 1/1', feat.includes('configurality') && feat.includes('1/1'), feat.slice(0, 300));
  ok('trial2: marginal lip 1/1 higher with CI', feat.includes('1/1 · 60% [21%–100%]'), feat.slice(0, 800));
  ok('trial2: marginal gonial 0/1 higher with CI', feat.includes('0/1 · 40% [0%–79%]'), feat.slice(0, 800));
  ok('trial2: lip shape monotonic up', feat.includes('monotonic ↑'), feat.slice(0, 1200));
  ok('trial2: gonial shape monotonic down', feat.includes('monotonic ↓'), feat.slice(0, 1200));
  ok('trial2: lip ideal +2.50σ', feat.includes('+2.50σ'), feat.slice(0, 1200));
  ok('trial2: discrimination shows calls-from, no silence-as-evidence', feat.includes('calls from 2.50σ') && !feat.includes('silence to'), feat.slice(0, 1200));
  ok('trial2: skipped rows noted', feat.includes('skipped'), feat.slice(0, 1200));
}
{
  const log = $('#log-table').innerHTML;
  ok('trial2: log feature cell shows signed dz', /lip full:[AB]\(/.test(log), log.slice(-400));
}

// ---------- trial 3: explicit can't-tell ----------
$('#next-btn').click();
await tick();
attachLandmarks();
await tick();
rows = fpRows();
function clickNt(row) {
  [...row.querySelectorAll('button[data-side]')].find((b) => b.dataset.side === 'NT').click();
}
for (const r of rows) clickNt(r);
ok('trial3: fp-notell 2 after Ø picks', $('#fp-notell').textContent === '2', $('#fp-notell').textContent);
ok('trial3: fp-count still 0', $('#fp-count').textContent === '0');
// toggle: Ø again -> cleared
clickNt(rows[0]);
ok('trial3: toggle clears Ø pick', $('#fp-notell').textContent === '1');
clickNt(rows[0]);
ok('trial3: Ø re-applied', $('#fp-notell').textContent === '2');
clickCard('lipA'); clickCard('lipB');
$('#lock-btn').click();
await tick();
st = getState();
const t3 = st.rounds[st.rounds.length - 1];
ok('trial3: both rows stored noTell', t3.featurePicks.length === 2 && t3.featurePicks.every((p) => p.noTell === true && p.winner === null), JSON.stringify(t3.featurePicks));
ok('trial3: lips still 1/1 (no-tell adds no evidence)', $('#inference').textContent.includes('1/1 consistent'), $('#inference').textContent);
{
  const feat = $('#profile-features').innerHTML;
  ok('trial3: discrimination shows can\'t-tell threshold', feat.includes("can't-tell up to 2.50σ"), feat.slice(0, 1200));
  ok('trial3: log marks no-tell rows with Ø', $('#log-table').innerHTML.includes(':Ø'), $('#log-table').innerHTML.slice(-300));
}

// ---------- trials 4+5: cross-axis retirement via direct picks ----------
async function trialDirect() {
  $('#next-btn').click();
  await tick();
  attachLandmarks();
  await tick();
  for (const info of fpRows().map(rowInfo)) {
    const wantHigher = info.key === 'lip_fullness';
    clickFp(info.row, (wantHigher === (info.aVal > info.bVal)) ? 'A' : 'B');
  }
  clickCard('lipB'); clickCard('lipA');
  $('#lock-btn').click();
  await tick();
  return getState();
}
await trialDirect(); // lips 2/2, jaw 2/2
st = await trialDirect(); // lips 3/3 confirmed, jaw 3/3 confirmed (cross-axis)
ok('trial5: lips status confirmed', st.axisStatus.lips === 'confirmed', JSON.stringify(st.axisStatus));
ok('trial5: jaw confirmed WITHOUT ever being the trial axis (cross-axis retirement)', st.axisStatus.jaw === 'confirmed', JSON.stringify(st.axisStatus));
{
  const lipsPill = $('#hud .hud-chip[data-axis="lips"] .conf').textContent;
  const jawPill = $('#hud .hud-chip[data-axis="jaw"] .conf').textContent;
  ok('trial5: HUD lips chip confirmed', lipsPill.includes('confirmed'), lipsPill);
  ok('trial5: HUD jaw chip confirmed', jawPill.includes('confirmed'), jawPill);
  ok('trial5: retired section includes confirmed + no-pairs axes', $('#profile-axes').innerHTML.includes('retired axes (5)'), $('#profile-axes').innerHTML.slice(0, 400));
}
ok('trial5: next button goes to final profile', $('#next-btn').textContent.includes('final profile'), $('#next-btn').textContent);

// ---------- report ----------
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} assertions passed`);
for (const r of results.filter((r) => !r.pass)) console.log('FAILED:', r.name, r.extra);
process.exit(passed === results.length ? 0 : 1);
