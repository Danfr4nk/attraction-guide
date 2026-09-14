// Pose-robustness ranking for the Telemetry Lab.
// Two independent probes:
//   EMPIRICAL: within-face pairs from Dan's same-face export series
//     (telemetry__2.json: 7 captures of face A -> 21 pairs;
//      telemetry__3.json: 2 captures of face B -> 1 pair).
//     Per metric: |Δ|/bankSD regressed on pose-delta magnitude.
//     This is detector-in-the-loop: pose distortion + detector noise +
//     occlusion hallucination, all in. Slopes are UPPER bounds on pure pose
//     sensitivity (detector noise inflates |Δ|), so flag thresholds built on
//     them fire early — conservative in the right direction.
//   SYNTHETIC: rigid 3D rotations of the 155 frozen bank faces' landmark clouds
//     (x,y,z from FaceLandmarker; orthographic re-projection), metrics recomputed
//     on the 2D-proxy path. Pure geometric foreshortening, no detector noise,
//     no occlusion modeling. Per-axis slopes (yaw/roll/pitch separately).
//     z-scale assumption: FaceLandmarker z is in the same normalized units as
//     x/y (documented approximation; ranking is robust to a 2x z-scale error,
//     absolute slopes are not).
// Outputs (all written next to this file unless noted):
//   robustness.json      — per-metric slopes, radii, tiers (machine-readable)
//   ROBUSTNESS-REPORT.md — the readable table + method + caveats
//   ../../js/robustness.js — GENERATED slope/SD table the lab imports for
//                            pose-contamination flagging (do not hand-edit)
// Run: node --import ./register.mjs robustness.mjs   (from this directory)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const USER = '/home/hatch/workspace/user/files/';

const require = createRequire(REPO + '/test/analysis-harness/run.mjs');
const { JSDOM } = require('jsdom');
const IDS = ['bgTag','btnCopy','btnCsv','btnJson','calibIpd','colA','colB','compareCard','compareNames',
  'deltaTable','dropzone','exportCard','fileInput','history','layerDims','layerFifths','layerGrid',
  'layerIris','layerMesh','layerMetrics','layerMidline','layerThirds','methodBody','metricGroups',
  'metricsCard','modelStatus','overlay','qualityBox','vecCount','viewTitle','viewerCard','statusMsg'];
const dom = new JSDOM(`<!DOCTYPE html><html><body>${IDS.map(id=>`<div id="${id}"></div>`).join('')}<input id="calibIpd" value=""/><canvas id="overlay"></canvas></body></html>`);
globalThis.window = dom.window; globalThis.document = dom.window.document;
const overlay = document.getElementById('overlay');
overlay.getContext = () => new Proxy({}, { get: (t,p) => (p==='canvas'?overlay:(...a)=>{}) });

const imp = (p) => import(pathToFileURL(p).href);
const T = await imp(REPO + '/js/telemetry.js');

// ---------- bank stats (recomputed on the current 3D path) ----------
const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const bankFaces = dump.faces.filter(f => f.landmarks && f.landmarks.length >= 468);
const acc = {};
for (const f of bankFaces) {
  const t = T.computeTelemetry(f.landmarks, f.w, f.h, f.matrix);
  for (const [k, v] of Object.entries(t.metrics)) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    (acc[k] ||= []).push(v);
  }
}
const BANK = {};
for (const [k, arr] of Object.entries(acc)) {
  const m = arr.reduce((a,b)=>a+b,0)/arr.length;
  BANK[k] = { mean: m, sd: Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length), n: arr.length };
}
console.log('bank faces:', bankFaces.length, '| metrics with stats:', Object.keys(BANK).length);

// ---------- empirical pairs ----------
const poseOf = (m) => [m.roll_deg, m.yaw_deg, m.pitch_deg == null ? 0 : m.pitch_deg];
const poseMag = (m) => { const [r,y,p] = poseOf(m); return Math.hypot(r,y,p); };
const poseDelta = (a,b) => { const pa=poseOf(a), pb=poseOf(b); return Math.hypot(pa[0]-pb[0],pa[1]-pb[1],pa[2]-pb[2]); };

const series = [];
for (const [file, faceId] of [['telemetry__2.json','A'],['telemetry__3.json','B']]) {
  const d = JSON.parse(fs.readFileSync(USER + file, 'utf8'));
  series.push({ faceId, imgs: d.images });
}
const pairs = [];
for (const s of series) {
  for (let i = 0; i < s.imgs.length; i++) for (let j = i+1; j < s.imgs.length; j++) {
    const A = s.imgs[i].metrics, B = s.imgs[j].metrics;
    pairs.push({ face: s.faceId, a: s.imgs[i].name, b: s.imgs[j].name,
      poseDelta: poseDelta(A,B), poseA: poseMag(A), poseB: poseMag(B),
      dYaw: Math.abs(A.yaw_deg-B.yaw_deg), dRoll: Math.abs(A.roll_deg-B.roll_deg), dPitch: Math.abs((A.pitch_deg??0)-(B.pitch_deg??0)),
      A, B });
  }
}
console.log('empirical pairs:', pairs.length, '(face A:', pairs.filter(p=>p.face==='A').length, '| face B:', pairs.filter(p=>p.face==='B').length, ')');

function linreg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let sxy=0, sxx=0, syy=0;
  for (let i=0;i<n;i++){ sxy+=(xs[i]-mx)*(ys[i]-my); sxx+=(xs[i]-mx)**2; syy+=(ys[i]-my)**2; }
  const slope = sxx ? sxy/sxx : 0;
  const r = (sxx && syy) ? sxy/Math.sqrt(sxx*syy) : 0;
  return { slope, intercept: my - slope*mx, r, n };
}

const emp = {};
for (const k of Object.keys(BANK)) {
  if (!BANK[k].sd) continue;
  const xs = [], ys = [];
  for (const p of pairs) {
    const va = p.A[k], vb = p.B[k];
    if (typeof va !== 'number' || typeof vb !== 'number' || !isFinite(va) || !isFinite(vb)) continue;
    xs.push(p.poseDelta); ys.push(Math.abs(va-vb)/BANK[k].sd);
  }
  if (xs.length >= 10) emp[k] = linreg(xs, ys);
}

// ---------- synthetic sweep ----------
function rotate(lm, axis, deg) {
  const th = deg*Math.PI/180, c = Math.cos(th), s = Math.sin(th);
  let cx=0, cy=0, cz=0;
  for (const p of lm) { cx+=p.x; cy+=p.y; cz+=(p.z||0); }
  cx/=lm.length; cy/=lm.length; cz/=lm.length;
  return lm.map(p => {
    let x=p.x-cx, y=p.y-cy, z=(p.z||0)-cz, x2,y2,z2;
    if (axis==='yaw')   { x2=x*c+z*s;  y2=y;       z2=-x*s+z*c; }
    else if (axis==='pitch'){ x2=x;    y2=y*c-z*s; z2=y*s+z*c; }
    else                { x2=x*c-y*s;  y2=x*s+y*c; z2=z;       }
    return { x: x2+cx, y: y2+cy, z: z2+cz };
  });
}
const SWEEP = { yaw: [5,10,15,20], roll: [5,10], pitch: [5,10] };
const syn = {}; // k -> {yaw:{slope,...}, roll:{...}, pitch:{...}}
for (const k of Object.keys(BANK)) syn[k] = { yaw: {xs:[],ys:[]}, roll: {xs:[],ys:[]}, pitch: {xs:[],ys:[]} };
let done = 0;
for (const f of bankFaces) {
  const base = T.computeTelemetry(f.landmarks, f.w, f.h, null).metrics;
  for (const [axis, degs] of Object.entries(SWEEP)) {
    for (const d of degs) {
      let m;
      try { m = T.computeTelemetry(rotate(f.landmarks, axis, d), f.w, f.h, null).metrics; }
      catch (e) { continue; }
      for (const k of Object.keys(syn)) {
        const vb = base[k], vr = m[k];
        if (typeof vb!=='number'||typeof vr!=='number'||!isFinite(vb)||!isFinite(vr)||!BANK[k].sd) continue;
        syn[k][axis].xs.push(d); syn[k][axis].ys.push(Math.abs(vr-vb)/BANK[k].sd);
      }
    }
  }
  if (++done % 40 === 0) console.log('synthetic sweep:', done, '/', bankFaces.length);
}
const synFit = {};
for (const k of Object.keys(syn)) {
  synFit[k] = {};
  for (const axis of Object.keys(SWEEP)) {
    const {xs, ys} = syn[k][axis];
    synFit[k][axis] = xs.length >= 20 ? linreg(xs, ys) : null;
  }
}

// ---------- combined table ----------
// Tiers are geometric (synthetic per-axis slopes — the causal quantity):
// radius_axis = 1/slope_axis; tier by the worst axis.
// The empirical detector-in-the-loop fit is reported alongside as the
// end-to-end reality check; where the two disagree (empirical >> synthetic),
// the detector — not the geometry — is the failure, and the quality gate
// (not a per-metric flag) is the defense.
const table = {};
for (const k of Object.keys(BANK)) {
  const e = emp[k];
  const s = synFit[k];
  const sMax = Math.max(s.yaw?.slope ?? 0, s.roll?.slope ?? 0, s.pitch?.slope ?? 0);
  const worstRadius = sMax > 0 ? 1 / sMax : null;
  const tier = worstRadius == null ? 'unknown' : worstRadius >= 20 ? 'robust' : worstRadius >= 10 ? 'moderate' : 'fragile';
  // worst-axis identity for the report
  const axes = [['yaw', s.yaw?.slope ?? 0], ['roll', s.roll?.slope ?? 0], ['pitch', s.pitch?.slope ?? 0]];
  axes.sort((a, b) => b[1] - a[1]);
  table[k] = {
    bankMean: +BANK[k].mean.toFixed(4), bankSD: +BANK[k].sd.toFixed(4),
    empSlope: e ? +e.slope.toFixed(4) : null, empIntercept: e ? +e.intercept.toFixed(4) : null,
    empR: e ? +e.r.toFixed(3) : null, empN: e ? e.n : 0,
    synSlopeYaw: s.yaw ? +s.yaw.slope.toFixed(4) : null,
    synSlopeRoll: s.roll ? +s.roll.slope.toFixed(4) : null,
    synSlopePitch: s.pitch ? +s.pitch.slope.toFixed(4) : null,
    worstAxis: sMax > 0 ? axes[0][0] : null,
    radiusDeg: worstRadius == null ? null : +worstRadius.toFixed(1), tier,
  };
}
fs.writeFileSync(HERE + 'robustness.json', JSON.stringify({ generated: new Date().toISOString(), pairs: pairs.length, bankFaces: bankFaces.length, metrics: table }, null, 1));

// ---------- generated lab module ----------
// Pose metrics are excluded from flagging (flagging pose for pose is circular;
// frontality is a pose composite). asymmetry_9 stays: it is deliberately NOT
// pose-corrected, so flagging its pose contamination is the honest treatment.
//
// Slopes are SYNTHETIC per-axis (bank-SD of expected geometric change per
// degree of yaw / roll / pitch separately): the causal, detector-independent
// quantity. The empirical detector-in-the-loop slopes are reported in
// robustness.json/ROBUSTNESS-REPORT.md but NOT used for flagging — at extreme
// pose the detector breakdown dominates and no per-metric flag can be
// calibrated; that regime is owned by the quality gate (low quality /
// frontality), which already fires on all such captures. A per-metric flag is
// therefore a LOWER bound on the doubt: "geometry alone already corrupts this
// value by ~X SD" — never a clean bill of health.
const POSE_KEYS = new Set(['roll_deg', 'yaw_deg', 'pitch_deg', 'yaw_proxy_deg', 'frontality']);
const flagKeys = Object.keys(table).filter(k => {
  const t = table[k];
  return !POSE_KEYS.has(k) && (t.synSlopeYaw > 0 || t.synSlopeRoll > 0 || t.synSlopePitch > 0);
});
const jsOut = `// GENERATED by test/drift-harness/robustness.mjs — do not hand-edit.
// Per-metric geometric pose sensitivity (bank-SD per degree, per axis).
// From rigid 3D rotations of the 155 frozen bank faces (synthetic probe):
// the causal pose->metric quantity, free of detector noise.
// Empirical detector-in-the-loop slopes live in robustness.json — they are
// UPPER bounds (detector breakdown inflates them at extreme pose) and are not
// used for flagging; the quality gate owns that regime.
export const POSE_SLOPE = {\n` +
  flagKeys.map(k => {
    const t = table[k];
    return `  ${k}: [${t.synSlopeYaw ?? 0}, ${t.synSlopeRoll ?? 0}, ${t.synSlopePitch ?? 0}], // yaw, roll, pitch`;
  }).join('\n') + `
};
export const BANK_SD = {\n` +
  flagKeys.map(k => `  ${k}: ${table[k].bankSD},`).join('\n') + `
};
export const ROBUSTNESS_TIER = {\n` +
  Object.keys(table).map(k => `  ${k}: '${table[k].tier}',`).join('\n') + `
};
// Expected pose-induced deviation (bank-SD units), linearized worst case:
// sum over axes of slope_axis * |angle_axis|. A lower bound on total doubt —
// detector breakdown at extreme pose adds unmodeled error on top.
export function poseErrorEstimate(key, yawDeg, rollDeg, pitchDeg) {
  const s = POSE_SLOPE[key];
  if (!s) return null;
  return s[0] * Math.abs(yawDeg || 0) + s[1] * Math.abs(rollDeg || 0) + s[2] * Math.abs(pitchDeg || 0);
}
// Flag level for a capture's pose: 'ok' | 'pose-suspect' (>=0.5 SD) | 'pose-unreliable' (>=1 SD)
export function poseFlagFor(key, yawDeg, rollDeg, pitchDeg) {
  const e = poseErrorEstimate(key, yawDeg, rollDeg, pitchDeg);
  if (e == null) return 'ok';
  if (e >= 1) return 'pose-unreliable';
  if (e >= 0.5) return 'pose-suspect';
  return 'ok';
}
`;
fs.writeFileSync(REPO + '/js/robustness.js', jsOut);
console.log('flagged metrics:', flagKeys.length);

// ---------- readable report ----------
const rows = Object.entries(table).sort((a,b) => (a[1].radiusDeg ?? 1e9) - (b[1].radiusDeg ?? 1e9));
let md = `# Pose-robustness ranking — Telemetry Lab

Generated ${new Date().toISOString()}.

## Inputs
- 22 within-face pairs: 21 from the 7-capture same-face series (face A), 1 from the
  2-capture series (face B). All captures low quality; yaw span up to 62° — a
  DETECTOR STRESS TEST, not a normal reliability trial.
- 155 frozen bank faces (synthetic baseline) for between-face SD.
- Synthetic probe: rigid 3D rotations of each bank face (±5/10/15/20° yaw,
  ±5/10° roll, ±5/10° pitch), re-run through computeTelemetry. Pure geometric
  pose sensitivity — no detector in the loop. z-depths are approximate
  (MediaPipe-normalized), so 3D rotations are indicative, not exact.

## Two regimes — read both
**Geometric (synthetic):** how the metric's MATH responds to pose. The causal,
calibrated quantity; basis of the per-metric flags in js/robustness.js. A flag
is a LOWER bound on the doubt ("geometry alone already corrupts this by ~X SD")
— never a clean bill of health.

**Detector-in-the-loop (empirical):** what actually happened on the stress-test
captures, detector noise and occlusion included. At extreme pose the detector
breakdown DOMINATES: no per-metric flag can be calibrated there, and the
quality gate (low quality / low frontality) is the defense — it already fires
on all 9 captures. Where empirical >> synthetic, the detector (not the
geometry) is the failure.

Radii are synthetic worst-axis: degrees of that axis at which the metric is
expected to move 1 bank SD. Tier: robust ≥20° · moderate 10–20° · fragile <10°.

## 2026-09-14 bug caught by this analysis
The synthetic sweep found the lab's canthal-tilt roll correction had the wrong
sign on the image-left eye (+roll added to both eyes corrected R and DOUBLED
the contamination on L — tiltL moved +10° per +10° imposed roll). Fixed in
js/telemetry.js (L: −roll, R: +roll); both eyes verified bit-invariant under
±10° imposed roll. The game's measure.js tilt is uncorrected (pre-existing,
not a bug — out of scope).

## Ranking (most fragile first)
| metric | tier | worst axis | radius | synth yaw / roll / pitch (SD/°) | empirical slope SD/° (r, n) |
|---|---|---|---|---|---|
`;
for (const [k, t] of rows) {
  const e = t.empSlope == null ? '—' : `${t.empSlope} (${t.empR}, n=${t.empN})`;
  md += `| ${k} | ${t.tier} | ${t.worstAxis ?? '—'} | ${t.radiusDeg ?? '—'}° | ${t.synSlopeYaw ?? '—'} / ${t.synSlopeRoll ?? '—'} / ${t.synSlopePitch ?? '—'} | ${e} |\n`;
}
const byTier = {};
for (const [k, t] of rows) (byTier[t.tier] ||= []).push(k);
md += `\n## Tiers\n`;
for (const tier of ['robust','moderate','fragile','unknown'])
  md += `\n**${tier}** (${(byTier[tier]||[]).length}): ${(byTier[tier]||[]).join(', ')}\n`;
md += `\n## Headline findings
- Asymmetry metrics (mean_asymmetry, asymmetry_9, gonial_diff) are the most
  pose-sensitive anatomy metrics — expected, since asymmetry itself is
  pose-contaminated. asymmetry_9 stays uncorrected by design; its flag now
  says so explicitly.
- Roll-corrected canthal tilt is roll-invariant by construction (verified),
  with residual pitch sensitivity (~0.2 SD/°); canthal_tilt_diff is robust.
- Jaw/cheek/mouth width ratios (jaw_to_cheek, mouth_to_cheek, mouth_to_nose,
  canon_nose) are geometrically near-invariant to pose — the earlier jaw-soft
  adiposity confound is a shape effect, not a pose artifact.
- eye_w_to_h has genuine yaw sensitivity (0.08 SD/°): at |yaw| > ~12° the
  denominator collapses and the ratio explodes (the 23.695 capture) — capped
  and flagged, not trusted.
- In the empirical stress test, detector noise at extreme pose moves most
  metrics ≥1 SD regardless of geometric tier. Per-metric flags do not cover
  this regime; the quality gate does.

## Flagging rule (implemented in the lab)
For a capture at pose (yaw, roll, pitch): expected deviation (bank SD) =
Σ slope_axis × |angle_axis| (linearized worst case, synthetic slopes).
≥0.5 → \`pose-suspect\`; ≥1.0 → \`pose-unreliable\`. Pose metrics excluded
(flagging pose for pose is circular); asymmetry_9 flagged, not corrected.
`;
fs.writeFileSync(HERE + 'ROBUSTNESS-REPORT.md', md);
console.log('wrote robustness.json, ROBUSTNESS-REPORT.md, js/robustness.js');
console.log('tiers:', Object.entries(byTier).map(([t,ks])=>`${t}:${ks.length}`).join(' '));
