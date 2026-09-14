// denom-guard-test.mjs — regression tests for denominator-collapse flags.
//
// The 2026-09-14 capture (IMG_4770, telemetry__3.json) reported eye_w_to_h =
// 23.695 at yaw −16°: the eye-height denominator foreshortened toward zero and
// the ratio exploded, uncapped and unflagged. These tests assert:
//   1. no false positives: the 155 frozen bank faces produce zero
//      denominator-collapse flags on the guarded metrics;
//   2. true positives: synthetically collapsing a denominator (eye height,
//      lower-lip height, V3 scleral fissure) fires 'denominator-collapse'
//      while PRESERVING the raw measured value (no silent clamp, no || 1);
//   3. the 23.695 geometry specifically: an eye_w/eye_h ratio of 23.695 is
//      flagged, not trusted.
//
// Run: node --import ./register.mjs denom-guard-test.mjs   (from test/drift-harness)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const HERE = new URL('./', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;
process.chdir(HERE);
const require = createRequire(REPO + 'test/analysis-harness/run.mjs');
const { JSDOM } = require('jsdom');
const IDS = ['bgTag','btnCopy','btnCsv','btnJson','calibIpd','colA','colB','compareCard','compareNames','deltaTable','dropzone','exportCard','fileInput','history','layerDims','layerFifths','layerGrid','layerIris','layerMesh','layerMetrics','layerMidline','layerThirds','methodBody','metricGroups','metricsCard','modelStatus','overlay','qualityBox','vecCount','viewTitle','viewerCard','statusMsg'];
const dom = new JSDOM(`<!DOCTYPE html><html><body>${IDS.map(id=>`<div id="${id}"></div>`).join('')}<input id="calibIpd" value=""/><canvas id="overlay"></canvas></body></html>`);
globalThis.window = dom.window; globalThis.document = dom.window.document;
document.getElementById('overlay').getContext = () => new Proxy({}, { get: (t,p) => (p==='canvas'?document.getElementById('overlay'):(...a)=>{}) });

const T = await import(pathToFileURL(REPO + 'js/telemetry.js').href);
const T3 = await import(pathToFileURL(REPO + 'js/telemetry3.js').href);
const M = await import(pathToFileURL(REPO + 'js/measure.js').href);
const I = M.LANDMARK_IDX;

const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const faces = dump.faces.filter(f => f.landmarks && f.landmarks.length >= 468);

let pass = 0, fail = 0;
const check = (name, cond, extra='') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${name} ${extra}`); }
};
const hasFlag = (flags, key, f) => (flags[key] || []).includes(f);

// ---- 1. no false positives on the bank ----
let fp = 0;
for (const f of faces) {
  const t = T.computeTelemetry(f.landmarks, f.w, f.h, f.matrix || null);
  for (const k of ['eye_w_to_h', 'upper_lower_lip'])
    if (hasFlag(t.metricFlags, k, 'denominator-collapse')) { fp++; break; }
  const v3 = T3.computeV3(f.landmarks, f.w, f.h);
  for (const k of ['scleral_show_L', 'scleral_show_R'])
    if (hasFlag(v3.flags, k, 'denominator-collapse')) { fp++; break; }
}
check('bank: zero denominator-collapse flags on 155 faces', fp === 0, `(${fp} faces flagged)`);

// ---- 2a. collapse the eye height (blink / extreme yaw foreshortening) ----
// NOTE: eye_h is a Euclidean distance — the collapse must bring top AND bot
// to the same point, not just squeeze y.
{
  const f = faces[0];
  const lm = f.landmarks.map(p => ({...p}));
  for (const [top, bot, outer, inner] of [[I.eye_top_L, I.eye_bot_L, I.eye_outer_L, I.eye_inner_L],[I.eye_top_R, I.eye_bot_R, I.eye_outer_R, I.eye_inner_R]]) {
    const c = { x: (lm[outer].x + lm[inner].x)/2, y: (lm[outer].y + lm[inner].y)/2 };
    lm[top] = {...lm[top], x: c.x, y: c.y}; lm[bot] = {...lm[bot], x: c.x, y: c.y};
  }
  const t = T.computeTelemetry(lm, f.w, f.h, f.matrix || null);
  check('collapsed eye_h → denominator-collapse flagged', hasFlag(t.metricFlags, 'eye_w_to_h', 'denominator-collapse'));
  check('collapsed eye_h → raw value preserved (not clamped)',
        !isFinite(t.metrics.eye_w_to_h) || t.metrics.eye_w_to_h > 100,
        `(value=${t.metrics.eye_w_to_h})`);
}

// ---- 2b. the 23.695 geometry: eye_w/eye_h exactly 23.695 must be flagged ----
{
  const f = faces[3];
  const lm = f.landmarks.map(p => ({...p}));
  // force Euclidean eye_h = eye_w / 23.695 on both eyes (top/bot separated
  // horizontally — geometrically arbitrary, arithmetically exact)
  for (const [top, bot, outer, inner] of [[I.eye_top_L, I.eye_bot_L, I.eye_outer_L, I.eye_inner_L],[I.eye_top_R, I.eye_bot_R, I.eye_outer_R, I.eye_inner_R]]) {
    const ew = Math.hypot(lm[outer].x - lm[inner].x, lm[outer].y - lm[inner].y);
    const targetH = ew / 23.695;
    const c = { x: (lm[outer].x + lm[inner].x)/2, y: (lm[outer].y + lm[inner].y)/2 };
    lm[top] = {...lm[top], x: c.x - targetH/2, y: c.y};
    lm[bot] = {...lm[bot], x: c.x + targetH/2, y: c.y};
  }
  const t = T.computeTelemetry(lm, f.w, f.h, f.matrix || null);
  check('eye_w_to_h ≈ 23.695 flagged denominator-collapse',
        hasFlag(t.metricFlags, 'eye_w_to_h', 'denominator-collapse') && Math.abs(t.metrics.eye_w_to_h - 23.695) < 0.5,
        `(value=${t.metrics.eye_w_to_h})`);
}

// ---- 2c. collapse the lower-lip height (upper_lower_lip's old || 1) ----
{
  const f = faces[7];
  const lm = f.landmarks.map(p => ({...p}));
  lm[14] = {...lm[I.lip_bot]}; // mouth_inner_bot → lip_bot: lower-lip height → 0
  const t = T.computeTelemetry(lm, f.w, f.h, f.matrix || null);
  check('collapsed lower-lip → denominator-collapse flagged', hasFlag(t.metricFlags, 'upper_lower_lip', 'denominator-collapse'));
  check('collapsed lower-lip → no silent || 1 fabrication',
        !isFinite(t.metrics.upper_lower_lip) || t.metrics.upper_lower_lip > 50,
        `(value=${t.metrics.upper_lower_lip})`);
}

// ---- 2d. V3 scleral fissure collapse ----
// The frozen bank is 468 points; scleral_show needs the refined 478-pt iris
// landmarks, so synthesize the 10 iris points (indices 468–477) first.
{
  const f = faces[11];
  const lm = f.landmarks.map(p => ({...p}));
  while (lm.length < 478) lm.push({...lm[1]});
  lm[468] = { x: (lm[159].x + lm[145].x)/2, y: (lm[159].y + lm[145].y)/2, z: 0 }; // iris center L
  lm[473] = { x: (lm[386].x + lm[374].x)/2, y: (lm[386].y + lm[374].y)/2, z: 0 }; // iris center R
  lm[145] = {...lm[159]}; lm[374] = {...lm[386]}; // fissure height → 0
  const v3 = T3.computeV3(lm, f.w, f.h);
  check('collapsed fissure → scleral_show_L flagged', hasFlag(v3.flags, 'scleral_show_L', 'denominator-collapse'));
  check('collapsed fissure → scleral_show_R flagged', hasFlag(v3.flags, 'scleral_show_R', 'denominator-collapse'));
  // and the unsullied synthetic-iris control stays clean
  const lm2 = f.landmarks.map(p => ({...p}));
  while (lm2.length < 478) lm2.push({...lm2[1]});
  lm2[468] = { x: (lm2[159].x + lm2[145].x)/2, y: (lm2[159].y + lm2[145].y)/2, z: 0 };
  lm2[473] = { x: (lm2[386].x + lm2[374].x)/2, y: (lm2[386].y + lm2[374].y)/2, z: 0 };
  const v3b = T3.computeV3(lm2, f.w, f.h);
  check('open fissure → no scleral flags',
        !hasFlag(v3b.flags, 'scleral_show_L', 'denominator-collapse') && !hasFlag(v3b.flags, 'scleral_show_R', 'denominator-collapse'));
}

console.log(`\ndemon-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
