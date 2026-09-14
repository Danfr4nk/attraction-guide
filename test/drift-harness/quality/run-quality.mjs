// analyzeQuality headless regression — closes the one gap in the drift
// harness (quality needs real canvas pixels, so it runs in headless
// Chromium against the REAL images + frozen landmarks).
//
// snapshot.mjs : runs the lab's actual analyzeQuality() (imported from
//   js/telemetry2.js in-page, no reimplementation) on all 155 bank faces
//   and writes quality/snapshot.json.
// regress.mjs  : re-runs and diffs against the snapshot; exits 1 on mismatch.
//
// Both: node quality/snapshot.mjs / node quality/regress.mjs  (from the
// drift-harness dir). Needs: npm i playwright-core (see quality/package.json)
// and a Playwright chromium download (~/.cache/ms-playwright).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MODE = process.argv[2] || 'snapshot'; // snapshot | regress | selftest

const require = createRequire(HERE + '/package.json');
const { chromium } = require('playwright-core');

// ---------- static server for the repo (module scripts need http) ----------
// NOTE: Chromium 152 on this box enforces Local Network Access checks on
// top-level navigations to 127.0.0.1 with no working kill-switch, so we
// serve over file:// instead (needs --allow-file-access-from-files).
import { pathToFileURL } from 'node:url';
const BASE = pathToFileURL(REPO).href.replace(/\/$/, '');
const server = { close() {} };

// ---------- browser ----------
const exe = process.env.CHROMIUM_EXE; // path to headless_shell
const browser = await chromium.launch({ executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.goto(BASE + '/index.html');
await page.addScriptTag({ type: 'importmap', content: JSON.stringify({
  imports: { '@mediapipe/tasks-vision': BASE + '/test/drift-harness/stubs/mediapipe.mjs' } }) });
await page.addScriptTag({ type: 'module', content: `
  import { analyzeQuality } from '${BASE}/js/telemetry2.js';
  window.__q = async (file, lm) => {
    const img = new Image();
    img.src = '${BASE}/' + file;
    await img.decode();
    const q = analyzeQuality(img, lm);
    return { ...q, imgW: img.naturalWidth, imgH: img.naturalHeight };
  };
` });
await page.waitForFunction(() => !!window.__q);

// ---------- run ----------
const dump = JSON.parse(fs.readFileSync(HERE + '../landmarks.json', 'utf8'));
const faces = dump.faces.filter(f => f.landmarks);
const out = [];
for (const f of faces) {
  const q = await page.evaluate(([file, lm]) => window.__q(file, lm), [f.file, f.landmarks]);
  out.push({ id: f.id, ...q });
  if (out.length % 40 === 0) console.log(`  ${out.length}/${faces.length}`);
}
await browser.close();
server.close();

const snapPath = HERE + '/snapshot.json';
if (MODE === 'snapshot') {
  fs.writeFileSync(snapPath, JSON.stringify({ date: new Date().toISOString().slice(0, 10),
    n: out.length, faces: out }, null, 1));
  console.log(`wrote snapshot.json (${out.length} faces)`);
} else {
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const byId = Object.fromEntries(snap.faces.map(r => [r.id, r]));
  let mism = 0;
  const numKeys = ['sharpness', 'exposure', 'clipping_pct', 'iid_px', 'illum_balance'];
  for (const r of out) {
    const e = byId[r.id];
    if (!e) { console.log(`MISSING snapshot for ${r.id}`); mism++; continue; }
    const diffs = [];
    for (const k of numKeys) if (e[k] !== r[k]) diffs.push(`${k}: ${e[k]} -> ${r[k]}`);
    if (e.verdict !== r.verdict) diffs.push(`verdict: ${e.verdict} -> ${r.verdict}`);
    if (JSON.stringify(e.notes) !== JSON.stringify(r.notes)) diffs.push('notes differ');
    if (diffs.length) { mism++; console.log(`${r.id}: ${diffs.join('; ')}`); }
  }
  console.log(mism ? `\nREGRESSION: ${mism} faces differ` : `\nCLEAN: all ${out.length} faces match snapshot`);
  process.exit(mism ? 1 : 0);
}
