// Drift harness — JS-side drift audit for the Telemetry Lab.
// Compares the 2026-09-11 lab code (baseline-2026-09-11/, fetched from the
// repo at commit ed6e4551c88e = end-of-day 2026-09-11) against the current
// working copy, on IDENTICAL recorded landmark inputs (landmarks.json).
// The detector is not part of the comparison; only the JS metric math.
//
// Three-way attribution per metric:
//   A: new(2D-proxy) vs old @ real image dims  = total instrument drift
//   B: new(3D)      vs new(2D-proxy) @ real     = 3D-pose wiring effect
//   C: new(2D-proxy) vs old @ square (w=h=1)    = non-aspect changes
//        (roll-corrected canthal tilt, or a bug — tilt aside, C must be ~0)
// A drift that appears in A but not C is the pixel-space aspect fix.
//
// Run:  node --import ./register.mjs run.js
// from this directory. Writes drift-report.json next to run.js.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

// jsdom lives in the sibling analysis-harness (gitignored node_modules)
const require = createRequire(REPO + '/test/analysis-harness/run.mjs');
const { JSDOM } = require('jsdom');

// ---------- DOM bootstrap (both telemetry.js versions query these at import) ----------
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

// ---------- module imports ----------
const imp = (p) => import(pathToFileURL(p).href);
const OLD  = await imp(HERE + 'baseline-2026-09-11/js/telemetry.js');
const OLD2 = await imp(HERE + 'baseline-2026-09-11/js/telemetry2.js');
const OLD3 = await imp(HERE + 'baseline-2026-09-11/js/telemetry3.js');
const OLDM = await imp(HERE + 'baseline-2026-09-11/js/measure.js');
const NEW  = await imp(REPO + '/js/telemetry.js');
const NEW2 = await imp(REPO + '/js/telemetry2.js');
const NEW3 = await imp(REPO + '/js/telemetry3.js');
const NEWM = await imp(REPO + '/js/measure.js');

// ---------- inputs ----------
const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const faces = dump.faces.filter(f => f.landmarks && f.landmarks.length >= 468);
const noFace = dump.faces.filter(f => !f.landmarks);
console.log(`faces with landmarks: ${faces.length}, no-face: ${noFace.length}`);

// ---------- run one face through every path ----------
function vec(lm, w, h, matrix, T, T2, T3) {
  const t = T.computeTelemetry(lm, w, h, matrix);
  return {
    ...t.metrics,
    poseSource: t.poseSource, quality: t.quality,
    ...T2.computeV2(lm, w, h, null),
    ...T3.computeV3(lm, w, h),
  };
}
const fakeImg = (lm, w, h, matrix) => ({ __landmarks: lm, __matrix: matrix, naturalWidth: w, naturalHeight: h });

const rows = [];
for (const f of faces) {
  const { landmarks: lm, w, h, matrix } = f;
  const old    = vec(lm, w, h, undefined, OLD, OLD2, OLD3);
  const nProxy = vec(lm, w, h, null, NEW, NEW2, NEW3);
  const n3d    = matrix ? vec(lm, w, h, matrix, NEW, NEW2, NEW3) : null;
  const oldSq  = vec(lm, 1, 1, undefined, OLD, OLD2, OLD3);
  const newSq  = vec(lm, 1, 1, null, NEW, NEW2, NEW3);
  let oldG = null, newG = null;
  try { oldG = OLDM.measureImage(fakeImg(lm, w, h)); } catch (e) { oldG = { __err: String(e).slice(0, 80) }; }
  try { newG = NEWM.measureImage(fakeImg(lm, w, h, matrix)); } catch (e) { newG = { __err: String(e).slice(0, 80) }; }
  rows.push({ id: f.id, w, h, hasMatrix: !!matrix, old, nProxy, n3d, oldSq, newSq, oldG, newG });
}

// ---------- stats ----------
const EPS = 0.0005; // below half an r3 tick = rounding noise
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
const allKeys = [...new Set(rows.flatMap(r => Object.keys(r.nProxy)))].sort();

const sdOf = (key) => {
  const vs = rows.map(r => num(r.nProxy[key])).filter(v => v !== null);
  if (vs.length < 3) return 0;
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  return Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length);
};

function driftStats(key, getA, getB) {
  const ds = [];
  for (const r of rows) {
    const a = num(getA(r)?.[key]), b = num(getB(r)?.[key]);
    if (a === null || b === null) continue;
    const d = b - a;
    if (Math.abs(d) >= EPS) ds.push({ d, id: r.id });
    else ds.push({ d: 0, id: r.id });
  }
  if (!ds.length) return null;
  const sd = sdOf(key);
  const ad = ds.map(x => Math.abs(x.d));
  const max = ds.reduce((m, x) => Math.abs(x.d) > Math.abs(m.d) ? x : m, ds[0]);
  return {
    n: ds.length,
    meanAbs: ad.reduce((a, b) => a + b, 0) / ad.length,
    maxAbs: Math.max(...ad),
    maxFace: max.id, maxSigned: max.d,
    meanAbsZ: sd > 0 ? ad.reduce((a, b) => a + b / sd, 0) / ad.length : null,
    maxAbsZ: sd > 0 ? Math.max(...ad) / sd : null,
    sd: sd > 0 ? sd : null,
  };
}

const report = { date: '2026-09-13', baseline: 'ed6e4551c88e (2026-09-11 EOD)',
  faces: faces.length, noFace: noFace.map(f => f.id), comparisons: {} };

for (const key of allKeys) {
  if (key === 'poseSource' || key === 'quality') continue;
  report.comparisons[key] = {
    A_newProxy_vs_old: driftStats(key, r => r.nProxy, r => r.old),
    C_newProxy_vs_old_square: driftStats(key, r => r.newSq, r => r.oldSq),
    B_new3D_vs_newProxy: driftStats(key, r => r.n3d, r => r.nProxy),
  };
}
// game path (measureImage keys)
const gKeys = [...new Set(rows.flatMap(r => Object.keys(r.newG || {}).filter(k => !k.startsWith('__'))))].sort();
report.game = {};
for (const key of gKeys) {
  report.game[key] = {
    A_new_vs_old: driftStats(key, r => r.newG, r => r.oldG),
    C_new_vs_old_square: null, // game always uses real dims; aspect attribution via lab
  };
}
// categorical: poseSource / quality distributions
for (const key of ['poseSource', 'quality']) {
  const dist = {};
  for (const r of rows) {
    const o = r.old[key], p = r.nProxy[key], t = r.n3d?.[key];
    const k = `${o}|${p}|${t ?? '—'}`;
    dist[k] = (dist[k] || 0) + 1;
  }
  report[key + '_dist'] = dist;
}

fs.writeFileSync(HERE + 'drift-report.json', JSON.stringify(report, null, 1));
console.log('wrote drift-report.json');

// metrics with no baseline (new in the current code)
const noBase = allKeys.filter(k => {
  if (k === 'poseSource' || k === 'quality') return false;
  const c = report.comparisons[k];
  return !c.A_newProxy_vs_old && !c.C_newProxy_vs_old_square && !c.B_new3D_vs_newProxy;
});
const noBaseG = gKeys.filter(k => !report.game[k].A_new_vs_old);
console.log('\nnew metrics with no 2026-09-11 baseline:', JSON.stringify(noBase));
console.log('new game metrics with no baseline:', JSON.stringify(noBaseG));

// ---------- console summary ----------
const f3 = (v) => v == null ? '—' : (+v).toFixed(3);
console.log('\nkey                        A:mean|d|  A:max|d|   A:maxZ  face        C:sq max|d|  B:3D max|d|');
for (const key of allKeys) {
  if (key === 'poseSource' || key === 'quality') continue;
  const c = report.comparisons[key];
  const A = c.A_newProxy_vs_old, C = c.C_newProxy_vs_old_square, B = c.B_new3D_vs_newProxy;
  if (!A) continue;
  const interesting = (A.maxAbsZ ?? 0) > 0.05 || (C?.maxAbs ?? 0) > EPS || (B?.maxAbs ?? 0) > EPS;
  if (!interesting) continue;
  console.log(`${key.padEnd(26)} ${f3(A.meanAbs).padStart(9)} ${f3(A.maxAbs).padStart(9)} ${f3(A.maxAbsZ).padStart(8)}  ${(A.maxFace || '').padEnd(10)} ${f3(C?.maxAbs).padStart(10)} ${f3(B?.maxAbs).padStart(11)}`);
}
console.log('\ngame (measureImage):');
for (const key of gKeys) {
  const A = report.game[key].A_new_vs_old;
  if (!A || (A.maxAbsZ ?? 0) <= 0.05) continue;
  console.log(`${key.padEnd(26)} ${f3(A.meanAbs).padStart(9)} ${f3(A.maxAbs).padStart(9)} ${f3(A.maxAbsZ).padStart(8)}  ${A.maxFace}`);
}
console.log('\nposeSource dist (old|newProxy|new3D):', JSON.stringify(report.poseSource_dist));
console.log('quality dist (old|newProxy|new3D):', JSON.stringify(report.quality_dist));
