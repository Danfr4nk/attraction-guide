// Quantitative roundness proof — do the lab's roundness-family metrics
// actually measure roundness?
//
// Method: parametric synthetic landmark sets with KNOWN geometry, run through
// the lab's real computeTelemetry (no reimplementation). Carrier = p2a05's
// frozen landmarks; only the structural indices are overridden.
//
// Sweeps (all in normalized coords, w=h=1000):
//   S1 eccentricity: cheek width fixed, face height stepped -> width:height
//      ratio targets 0.70..1.18. Mid-third fixed so fwhr_proxy's denominator
//      is constant.
//   S2 jaw width: face height fixed, jaw_w/cheek_w stepped 0.55..0.95.
//   S3 cheek width: face height fixed, cheek half-width stepped.
//
// Then: bank controls (jaw-soft vs base vs jaw-sharp on frozen landmarks).
//
// Run: node --import ./register.mjs roundness-proof.mjs   (from this dir)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

// DOM bootstrap first: telemetry.js queries document at module top level
// (same block as run.js)
const require = createRequire(REPO + '/test/analysis-harness/run.mjs');
const { JSDOM } = require('jsdom');
const IDS = ['bgTag','btnCopy','btnCsv','btnJson','calibIpd','colA','colB','compareCard','compareNames',
  'deltaTable','dropzone','exportCard','fileInput','history','layerDims','layerFifths','layerGrid',
  'layerIris','layerMesh','layerMetrics','layerMidline','layerThirds','methodBody','metricGroups',
  'metricsCard','modelStatus','overlay','qualityBox','vecCount','viewTitle','viewerCard','statusMsg'];
const dom = new JSDOM(`<!DOCTYPE html><html><body>${
  IDS.map(id => `<div id="${id}"></div>`).join('')
}<input id="calibIpd" value=""/><canvas id="overlay"></canvas></body></html>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const overlay = document.getElementById('overlay');
overlay.getContext = () => new Proxy({}, { get: (t, p) => (p === 'canvas' ? overlay : (...a) => {}) });

const imp = (p) => import(pathToFileURL(p).href);
const { computeTelemetry } = await imp(REPO + '/js/telemetry.js');

const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const faces = dump.faces.filter(f => f.landmarks && f.landmarks.length >= 468);
const byId = Object.fromEntries(faces.map(f => [f.id, f]));
const carrier = byId['p2a05'].landmarks;

// structural indices we override
const I = { cheek_L: 234, cheek_R: 454, jaw_L: 172, jaw_R: 397,
  forehead: 10, chin: 152, browInL: 107, browInR: 336, subnasale: 2,
  mouth_L: 61, mouth_R: 291 };

function synth({ C = 0.16, H = 0.34, J = 0.75, M = 0.11, UL = 0.5 } = {}) {
  // C: cheek half-width; H: forehead->chin; J: jaw_w/cheek_w; M: mid-third len;
  // UL: fraction of (H-M) allotted to upper third (rest = lower).
  const lm = carrier.map(p => ({ x: p.x, y: p.y, z: p.z }));
  const set = (i, x, y) => { lm[i] = { x, y, z: 0 }; };
  const gy = 0.42;                 // glabella y
  const sy = gy + M;               // subnasale y
  const U = (H - M) * UL, L = (H - M) * (1 - UL);
  const yF = gy - U, yC = sy + L;  // forehead, chin
  const yCheek = 0.50, yJaw = sy + 0.55 * L, yMouth = sy + 0.28 * L;
  set(I.forehead, 0.5, yF);
  set(I.chin, 0.5, yC);
  set(I.cheek_L, 0.5 - C, yCheek); set(I.cheek_R, 0.5 + C, yCheek);
  set(I.jaw_L, 0.5 - C * J, yJaw); set(I.jaw_R, 0.5 + C * J, yJaw);
  set(I.browInL, 0.5 - 0.035, gy); set(I.browInR, 0.5 + 0.035, gy);
  set(I.subnasale, 0.5, sy);
  set(I.mouth_L, 0.5 - 0.42 * C, yMouth); set(I.mouth_R, 0.5 + 0.42 * C, yMouth);
  return { lm, expect: { WHR: (2 * C) / H, J } };
}

const KEYS = ['width_height_ratio', 'fwhr_proxy', 'jaw_to_cheek'];
const run = (params) => {
  const { lm, expect } = synth(params);
  const t = computeTelemetry(lm, 1000, 1000, null);
  const o = { expect };
  for (const k of KEYS) o[k] = t.metrics[k];
  return o;
};

const slope = (xs, ys) => { // least-squares d(metric)/d(param)
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return vx ? cov / vx : 0;
};
const mono = (ys, dir) => ys.every((y, i) => i === 0 || (dir > 0 ? y >= ys[i - 1] - 1e-9 : y <= ys[i - 1] + 1e-9));

const out = { sweeps: {}, verdicts: [] };
const f4 = (v) => +v.toFixed(4);

// ---- S1: eccentricity (height) sweep ----
{
  const targets = [0.70, 0.78, 0.86, 0.94, 1.02, 1.10, 1.18];
  const rows = targets.map(t => run({ H: 0.32 / t, J: 0.75 }));
  const rec = { param: 'face_height (WHR target)', targets };
  for (const k of KEYS) {
    const ys = rows.map(r => r[k]);
    rec[k] = { values: ys.map(f4), slope_vs_WHRtarget: +slope(targets, ys).toFixed(4),
      monotonic_inc: mono(ys, 1), monotonic_dec: mono(ys, -1) };
  }
  out.sweeps.S1_eccentricity = rec;
  out.verdicts.push('S1: width_height_ratio tracks the WHR target ' +
    (rec.width_height_ratio.monotonic_inc ? 'monotonically' : 'NON-MONOTONIC ***') +
    ` (slope ${rec.width_height_ratio.slope_vs_WHRtarget}/WHR-unit; identity would be 1.0).`);
  out.verdicts.push('S1: fwhr_proxy vs face height: slope ' +
    `${rec.fwhr_proxy.slope_vs_WHRtarget} — ` +
    (Math.abs(rec.fwhr_proxy.slope_vs_WHRtarget) < 0.05
      ? 'FLAT: blind to the height dimension of roundness by construction (denominator is mid-third length).'
      : 'RESPONDS to height — unexpected, investigate.'));
  out.verdicts.push('S1: jaw_to_cheek vs face height: slope ' +
    `${rec.jaw_to_cheek.slope_vs_WHRtarget} — ` +
    (Math.abs(rec.jaw_to_cheek.slope_vs_WHRtarget) < 0.05 ? 'flat as designed (width/width).' : 'MOVES with height — bug.'));
}

// ---- S2: jaw-width sweep ----
{
  const js = [0.55, 0.65, 0.75, 0.85, 0.95];
  const rows = js.map(J => run({ H: 0.32 / 0.94, J }));
  const rec = { param: 'jaw_w/cheek_w', targets: js };
  for (const k of KEYS) {
    const ys = rows.map(r => r[k]);
    rec[k] = { values: ys.map(f4), slope_vs_J: +slope(js, ys).toFixed(4),
      monotonic_inc: mono(ys, 1), monotonic_dec: mono(ys, -1) };
  }
  out.sweeps.S2_jaw = rec;
  out.verdicts.push('S2: jaw_to_cheek tracks J ' +
    (rec.jaw_to_cheek.monotonic_inc ? 'monotonically' : 'NON-MONOTONIC ***') +
    ` (slope ${rec.jaw_to_cheek.slope_vs_J}; identity = 1.0).`);
  const othersFlat = ['width_height_ratio', 'fwhr_proxy'].every(k => Math.abs(rec[k].slope_vs_J) < 0.05);
  out.verdicts.push('S2: width_height_ratio & fwhr_proxy vs jaw width: ' +
    (othersFlat ? 'flat — jaw width is invisible to them.' : 'LEAK: jaw width moves them.'));
}

// ---- S3: cheek-width sweep ----
{
  const cs = [0.12, 0.14, 0.16, 0.18, 0.20];
  const rows = cs.map(C => run({ C, H: 0.32 / 0.94, J: 0.75 }));
  const rec = { param: 'cheek_halfwidth', targets: cs };
  for (const k of KEYS) {
    const ys = rows.map(r => r[k]);
    rec[k] = { values: ys.map(f4), slope_vs_C: +slope(cs, ys).toFixed(2),
      monotonic_inc: mono(ys, 1), monotonic_dec: mono(ys, -1) };
  }
  out.sweeps.S3_cheek = rec;
  out.verdicts.push(`S3: width_height_ratio slope vs cheek half-width ${rec.width_height_ratio.slope_vs_C} ` +
    `(theory 2/H = ${(2 / (0.32 / 0.94)).toFixed(2)}); fwhr_proxy slope ${rec.fwhr_proxy.slope_vs_C} ` +
    `(theory 2/M = ${(2 / 0.11).toFixed(2)}); jaw_to_cheek ${rec.jaw_to_cheek.monotonic_dec ? 'falls' : 'NON-MONOTONIC'} as 1/C.`);
}

// ---- bank controls: jaw-soft (positive) vs base vs jaw-sharp (negative) ----
{
  const trios = ['p2a04', 'p2a05', 'p2a07', 'p2a09'];
  const rec = [];
  for (const lin of trios) {
    const row = { lineage: lin };
    for (const [tag, id] of [['soft', lin + '-jaw-soft'], ['base', lin], ['sharp', lin + '-jaw-sharp']]) {
      const f = byId[id];
      const t = computeTelemetry(f.landmarks, f.w, f.h, null);
      row[tag] = Object.fromEntries(KEYS.map(k => [k, t.metrics[k]]));
    }
    rec.push(row);
  }
  // all soft vs their base (13 lineages)
  const softVsBase = [];
  for (const id of Object.keys(byId).filter(k => k.endsWith('-jaw-soft'))) {
    const base = id.replace(/-jaw-soft$/, '');
    if (!byId[base]) continue;
    const s = computeTelemetry(byId[id].landmarks, byId[id].w, byId[id].h, null).metrics;
    const b = computeTelemetry(byId[base].landmarks, byId[base].w, byId[base].h, null).metrics;
    softVsBase.push({ id, d: Object.fromEntries(KEYS.map(k => [k, +(s[k] - b[k]).toFixed(4)])) });
  }
  out.bank_controls = { trios: rec, soft_vs_base: softVsBase };
  const n = softVsBase.length;
  for (const k of KEYS) {
    const ds = softVsBase.map(r => r.d[k]);
    const pos = ds.filter(d => d > 0).length;
    out.verdicts.push(`bank: jaw-soft vs base on ${k}: ${pos}/${n} positive, mean Δ ${(ds.reduce((a, b) => a + b, 0) / n).toFixed(4)}.`);
  }
}

fs.writeFileSync(HERE + 'roundness-proof.json', JSON.stringify(out, null, 1));

// ---- convergent validity: PY cheek_fullness vs JS width_height_ratio, 155 faces ----
{
  const py = JSON.parse(fs.readFileSync(HERE + 'bank-adiposity.json', 'utf8'));
  const pairs = [];
  for (const f of faces) {
    if (!py[f.id]) continue;
    const t = computeTelemetry(f.landmarks, f.w, f.h, null);
    pairs.push([py[f.id].cheek_fullness, t.metrics.width_height_ratio, f.id]);
  }
  const rank = (arr) => {
    const s = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    s.forEach(([v, i], pos) => { r[i] = pos; });
    return r;
  };
  const rx = rank(pairs.map(p => p[0])), ry = rank(pairs.map(p => p[1]));
  const n = pairs.length, mx = (n - 1) / 2;
  const cov = rx.reduce((s, x, i) => s + (x - mx) * (ry[i] - mx), 0);
  const vx = rx.reduce((s, x) => s + (x - mx) ** 2, 0);
  const spearman = cov / vx;
  // Pearson too
  const ax = pairs.map(p => p[0]), ay = pairs.map(p => p[1]);
  const px = ax.reduce((a, b) => a + b, 0) / n, py2 = ay.reduce((a, b) => a + b, 0) / n;
  const pcov = ax.reduce((s, x, i) => s + (x - px) * (ay[i] - py2), 0);
  const pearson = pcov / Math.sqrt(ax.reduce((s, x) => s + (x - px) ** 2, 0) * ay.reduce((s, y) => s + (y - py2) ** 2, 0));
  // biggest rank disagreements
  const dis = pairs.map((p, i) => ({ id: p[2], cf: p[0], whr: p[1], d: Math.abs(rx[i] - ry[i]) }))
    .sort((a, b) => b.d - a.d).slice(0, 5);
  out.convergent_validity = { n, spearman: +spearman.toFixed(3), pearson: +pearson.toFixed(3), top_disagreements: dis };
  fs.writeFileSync(HERE + 'roundness-proof.json', JSON.stringify(out, null, 1));
  console.log(`\nconvergent validity (PY cheek_fullness vs JS width_height_ratio, n=${n}): Spearman ${spearman.toFixed(3)}, Pearson ${pearson.toFixed(3)}`);
  console.log('top rank disagreements:', JSON.stringify(dis.map(d => d.id)));
}
console.log('\nwrote roundness-proof.json\n');
for (const v of out.verdicts) console.log('- ' + v);
