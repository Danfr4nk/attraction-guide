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
const dom = new JSDOM(`<!DOCTYPE html><html><body>${IDS.map(id => `<div id="${id}"></div>`).join('')}<input id="calibIpd" value=""/><canvas id="overlay"></canvas></body></html>`);
globalThis.window = dom.window; globalThis.document = dom.window.document;
document.getElementById('overlay').getContext = () => new Proxy({}, { get: (t, p) => (p === 'canvas' ? document.getElementById('overlay') : (...a) => {}) });
const { computeTelemetry, poseFromMatrix } = await import(pathToFileURL(REPO + '/js/telemetry.js').href);
const dump = JSON.parse(fs.readFileSync(HERE + 'landmarks.json', 'utf8'));
const f = dump.faces.find(x => x.id === 'p1-heart-2');
console.log('poseFromMatrix:', JSON.stringify(poseFromMatrix(f.matrix)));
const t = computeTelemetry(f.landmarks, f.w, f.h, f.matrix);
console.log('pitch_deg:', t.metrics.pitch_deg, '| frontality:', t.metrics.frontality,
  '| roll:', t.metrics.roll_deg, '| yaw:', t.metrics.yaw_deg, '| source:', t.poseSource);
// full-bank: confirm sign flip is the ONLY change vs pre-fix (frontality untouched)
let bad = 0;
for (const g of dump.faces) {
  const a = computeTelemetry(g.landmarks, g.w, g.h, g.matrix);
  if (a.metrics.pitch_deg != null && a.metrics.pitch_deg >= 0) { /* now + = chin down */ }
  if (g.matrix && (a.metrics.pitch_deg === 0)) bad++;
}
console.log('faces with pitch_deg==0 (degenerate):', bad);
const ps = dump.faces.map(g => computeTelemetry(g.landmarks, g.w, g.h, g.matrix).metrics.pitch_deg);
console.log('pitch range now: [%.2f, %.2f] (was [-11.14, -3.37])'.replace('%.2f', Math.min(...ps).toFixed(2)).replace('%.2f', Math.max(...ps).toFixed(2)));
