// telemetry v3 — decomposition metrics + landmark-noise intervals.
// Imports from measure.js only (no cycle with telemetry.js).

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

const BROW_L = [70, 63, 105, 66, 107];
const BROW_R = [300, 293, 334, 296, 336];

// Gaussian noise (Box-Muller)
export function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Landmark-noise 95% intervals for the full metric vector. NOT a bootstrap and
 * NOT a population CI: there is no resampling of faces here. All landmarks are
 * jittered with Gaussian noise (σ in normalized image coords; default 0.0005 ≈
 * subpixel detector noise on a ~1000px face), the full vector is recomputed, and
 * this is repeated 32 times. Returns { key: { sd, n } } — sd is the standard
 * deviation across the 32 noise runs; the reported 95% half-width is 1.96 × sd.
 * This captures detector/landmark noise ONLY — not pose distortion, expression,
 * or lens effects. Never read it as statistical significance about people.
 */
export function landmarkNoiseCI(computeAll, lm, w, h, iters = 32, sigma = 0.0005) {
  let keys;
  try { keys = Object.keys(computeAll(lm, w, h)); }
  catch (e) { return {}; }
  const sums = {}, sums2 = {}, counts = {};
  for (const k of keys) { sums[k] = 0; sums2[k] = 0; counts[k] = 0; }
  for (let i = 0; i < iters; i++) {
    const jl = lm.map(p => ({ x: p.x + gauss() * sigma, y: p.y + gauss() * sigma, z: p.z }));
    let m;
    try { m = computeAll(jl, w, h); } catch (e) { continue; }
    for (const k of keys) {
      const v = m[k];
      if (typeof v === 'number' && isFinite(v)) { sums[k] += v; sums2[k] += v * v; counts[k]++; }
    }
  }
  const ci = {};
  for (const k of keys) {
    const n = counts[k];
    if (n > 1) {
      const mean = sums[k] / n;
      ci[k] = { sd: r4(Math.sqrt(Math.max(0, sums2[k] / n - mean * mean))), n };
    } else ci[k] = { sd: null, n };
  }
  return ci;
}

export function computeV3(lm, w, h) {
  // pixel-correct geometry (aspect-safe): distances/angles in pixel space.
  lm = lm.map(p => ({ x: p.x * w, y: p.y * h, z: p.z }));
  const g = (i) => lm[i];
  const x_mid = (g(10).x + g(152).x) / 2; // forehead ↔ chin midline
  // flags annotate, never hide (same contract as computeTelemetry's
  // metricFlags): 'denominator-collapse' when a ratio's denominator falls
  // below a bank-calibrated floor (0.5 × bank minimum as a fraction of
  // cheek_w — see js/telemetry.js), 'non-finite' as a safety net.
  const flags = {};
  const flag = (key, f) => { (flags[key] ||= []).push(f); };
  const cheek_w = dist(g(234), g(454));
  const gdiv = (key, num, den, floorFrac) => {
    if (!(Math.abs(den) >= floorFrac * cheek_w)) flag(key, 'denominator-collapse');
    return num / den;
  };
  const asymPair = (l, r) => {
    const dL = Math.abs(l.x - x_mid), dR = Math.abs(r.x - x_mid);
    const den = (dL + dR) / 2;
    if (!(den > 0)) return 0; // both on the midline: symmetric, not unmeasurable
    return Math.abs(dL - dR) / den;
  };
  const eye_w = (dist(g(33), g(133)) + dist(g(362), g(263))) / 2;
  const face_h = dist(g(10), g(152));
  const nose_w = dist(g(98), g(327));
  const mouth_w = dist(g(61), g(291));

  // asymmetry by facial region
  const upperPairs = [[g(107), g(336)], [g(70), g(300)], [g(33), g(263)], [g(133), g(362)], [g(159), g(386)]];
  const midPairs = [[g(98), g(327)], [g(234), g(454)]];
  const lowerPairs = [[g(61), g(291)], [g(172), g(397)]];
  const avg = (arr) => arr.reduce((s, [l, r]) => s + asymPair(l, r), 0) / arr.length;

  // per-side brow–eye distance (% face height)
  const browCentL = { x: 0, y: 0 }, browCentR = { x: 0, y: 0 };
  for (const i of BROW_L) { browCentL.x += g(i).x / 5; browCentL.y += g(i).y / 5; }
  for (const i of BROW_R) { browCentR.x += g(i).x / 5; browCentR.y += g(i).y / 5; }

  // brow arc length (polyline) ÷ eye width
  const arcLen = (ids) => { let s = 0; for (let i = 1; i < ids.length; i++) s += dist(g(ids[i - 1]), g(ids[i])); return s; };
  const browLen = (arcLen(BROW_L) + arcLen(BROW_R)) / 2 / eye_w;

  // scleral show: iris-center height within the fissure (needs refined 478-pt landmarks)
  // The fissure-height denominators collapse on blink/extreme yaw — the old
  // `|| 1` silently fabricated a finite value; now flagged instead.
  let scL = null, scR = null;
  if (lm.length >= 478) {
    const fL = gdiv('scleral_show_L', g(468).y - g(159).y, g(145).y - g(159).y, 0.03);
    const fR = gdiv('scleral_show_R', g(473).y - g(386).y, g(374).y - g(386).y, 0.03);
    scL = r3(fL); scR = r3(fR);
  }

  const metrics = {
    asym_upper: r3(avg(upperPairs)),
    asym_mid: r3(avg(midPairs)),
    asym_lower: r3(avg(lowerPairs)),
    brow_eye_L: r3(dist(browCentL, g(159)) / face_h * 100),
    brow_eye_R: r3(dist(browCentR, g(386)) / face_h * 100),
    brow_len_mean: r3(browLen),
    scleral_show_L: scL,
    scleral_show_R: scR,
    nose_tip_deviation: r3(Math.abs(g(1).x - x_mid) / (nose_w || 1)),
    lip_corner_asym: r3(Math.abs(g(61).y - g(291).y) / (mouth_w || 1)),
  };
  for (const [k, v] of Object.entries(metrics))
    if (typeof v === 'number' && !isFinite(v)) flag(k, 'non-finite');
  return { metrics, flags };
}

const f3 = (v) => v.toFixed(3);
const deg = (v) => v.toFixed(1) + '°';
const pct1 = (v) => v.toFixed(1) + '%';

export const V3_GROUPS = [
  ['decomp', 'asymmetry decomposition'],
  ['detail', 'fine detail'],
];

export const V3_METRIC_DEFS = [
  { key: 'asym_upper', group: 'decomp', label: 'asymmetry · upper face', fmt: f3, hint: 'brows + eyes, 5 pairs' },
  { key: 'asym_mid', group: 'decomp', label: 'asymmetry · midface', fmt: f3, hint: 'nostrils + cheeks, 2 pairs' },
  { key: 'asym_lower', group: 'decomp', label: 'asymmetry · lower face', fmt: f3, hint: 'mouth + jaw, 2 pairs' },
  { key: 'brow_eye_L', group: 'decomp', label: 'brow–eye distance L', fmt: pct1, hint: '% face height' },
  { key: 'brow_eye_R', group: 'decomp', label: 'brow–eye distance R', fmt: pct1, hint: '% face height' },
  { key: 'brow_len_mean', group: 'decomp', label: 'brow arc length', fmt: f3, hint: 'polyline ÷ eye width' },
  { key: 'scleral_show_L', group: 'detail', label: 'scleral show L', fmt: (v) => v == null ? '—' : v.toFixed(2), hint: 'iris height in fissure · 0.5 centered' },
  { key: 'scleral_show_R', group: 'detail', label: 'scleral show R', fmt: (v) => v == null ? '—' : v.toFixed(2) },
  { key: 'nose_tip_deviation', group: 'detail', label: 'nose tip deviation', fmt: f3, hint: '|tip − midline| ÷ nose width' },
  { key: 'lip_corner_asym', group: 'detail', label: 'lip corner asymmetry', fmt: f3, hint: '|corner Δy| ÷ mouth width' },
];
