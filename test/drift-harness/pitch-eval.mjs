// Frontality pitch evaluation: should frontality penalize |pitch|?
// frontality = 100 - (|roll|*5 + |yaw|*4 + asym9*150), quality: >=85 high, >=60 medium.
// Tests F(k) = 100 - (|roll|*5 + |yaw|*4 + |pitch|*k + asym9*150) for k in {3,4,5}
// on the 155 frozen faces (all have 3D matrices -> true pitch).
// Run: node --import ./register.mjs pitch-eval.mjs   (from this dir)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
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
document.getElementById('overlay').getContext = () => new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : (...a) => {}) });

const imp = (p) => import(pathToFileURL(p).href);
const { computeTelemetry } = await imp(REPO + '/js/telemetry.js');

const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const faces = dump.faces.filter(f => f.landmarks && f.matrix);

const grade = (f) => f >= 85 ? 'high' : f >= 60 ? 'medium' : 'low';
const rows = [];
for (const f of faces) {
  const t = computeTelemetry(f.landmarks, f.w, f.h, f.matrix);
  const m = t.metrics;
  rows.push({ id: f.id, file: f.file, roll: m.roll_deg, yaw: m.yaw_deg, pitch: m.pitch_deg,
    asym9: m.asymmetry_9, frontality: m.frontality, quality: t.quality,
    poseSource: t.poseSource });
}
const pitched = rows.filter(r => r.pitch != null);
const ap = pitched.map(r => Math.abs(r.pitch)).sort((a, b) => a - b);
console.log(`faces: ${rows.length}, with 3D pitch: ${pitched.length}`);
console.log(`|pitch| dist: min ${ap[0].toFixed(2)} p50 ${ap[Math.floor(ap.length/2)].toFixed(2)} p90 ${ap[Math.floor(ap.length*0.9)].toFixed(2)} max ${ap[ap.length-1].toFixed(2)}`);

const out = { n: rows.length, pitch_dist: { min: +ap[0].toFixed(2), p50: +ap[Math.floor(ap.length/2)].toFixed(2), p90: +ap[Math.floor(ap.length*0.9)].toFixed(2), max: +ap[ap.length-1].toFixed(2) }, variants: {} };
for (const k of [3, 4, 5]) {
  const key = `k${k}`;
  let changed = 0, up = 0, down = 0;
  const movers = [];
  for (const r of rows) {
    const f1 = Math.max(0, Math.min(100, 100 - (Math.abs(r.roll) * 5 + Math.abs(r.yaw) * 4 + Math.abs(r.pitch ?? 0) * k + r.asym9 * 150)));
    const g0 = grade(r.frontality), g1 = grade(f1);
    if (g0 !== g1) {
      const order = { high: 0, medium: 1, low: 2 };
      changed++; if (order[g1] > order[g0]) down++; else up++;
      movers.push({ id: r.id, file: r.file, pitch: +r.pitch.toFixed(2), roll: r.roll, yaw: r.yaw,
        asym9: r.asym9, f0: +r.frontality.toFixed(1), f1: +f1.toFixed(1), g0, g1 });
    }
  }
  // pitch-attribution: how much of the f0->f1 drop is the pitch term?
  for (const m of movers) m.pitchShare = +((Math.abs(m.pitch) * k) / Math.max(1e-9, (m.f0 - m.f1))).toFixed(2);
  out.variants[key] = { changed, up, down, movers: movers.sort((a, b) => Math.abs(b.pitch) - Math.abs(a.pitch)) };
  console.log(`\nk=${k}: grade changes ${changed} (up ${up}, down ${down})`);
  for (const m of out.variants[key].movers.slice(0, 12))
    console.log(`  ${m.id} pitch=${m.pitch} f ${m.f0}->${m.f1} ${m.g0}->${m.g1} pitchShare=${m.pitchShare}`);
}

// vertical-foreshortening sanity: does |pitch| predict thirds distortion?
// (no ground truth per face; report correlation of |pitch| with lower-third share)
{
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  for (const f of faces) {
    const t = computeTelemetry(f.landmarks, f.w, f.h, f.matrix);
    const x = Math.abs(t.metrics.pitch_deg ?? 0), y = t.metrics.third_lower_pct;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; n++;
  }
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  out.pitch_vs_lower_third_r = +r.toFixed(3);
  console.log(`\ncorr(|pitch|, third_lower_pct) = ${r.toFixed(3)} (chin-down foreshortening should shrink the lower third -> negative)`);
}

fs.writeFileSync(HERE + 'pitch-eval.json', JSON.stringify(out, null, 1));
console.log('\nwrote pitch-eval.json');
