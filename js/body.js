// body-metrics web engine — in-browser full-body measurement.
// MediaPipe Tasks Vision PoseLandmarker (IMAGE mode) → 33 landmarks →
// scale-invariant body ratios. Same ratio definitions as the offline
// body-metrics pipeline (bodylib.py), so web and CLI numbers agree.
//
// Models live in localStorage (key: bodymetrics.models.v1). No pixels or
// file bytes are ever stored — only ratio statistics, same as models/*.json.
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// MediaPipe Pose indices (same map as bodylib.py LANDMARKS)
export const LM = {
  nose: 0,
  l_shoulder: 11, r_shoulder: 12,
  l_elbow: 13, r_elbow: 14,
  l_wrist: 15, r_wrist: 16,
  l_hip: 23, r_hip: 24,
  l_knee: 25, r_knee: 26,
  l_ankle: 27, r_ankle: 28,
};
export const REQUIRED = Object.values(LM).sort((a, b) => a - b);
export const VISIBILITY_MIN = 0.5;
export const ZERO_STD_EPS = 5e-3;

export const RATIO_KEYS = [
  'shoulder', 'hip', 'torso', 'upper_leg', 'lower_leg', 'leg_total',
  'upper_arm', 'forearm', 'arm_total',
  'shoulder_hip', 'shoulder_torso', 'hip_torso', 'torso_leg',
  'upperleg_lowerleg', 'upperarm_forearm', 'arm_leg',
];
// Scale-invariant subset: pure ratios, unaffected by framing/distance.
// Default for matching (see bodylib.py INVARIANT_KEYS).
export const INVARIANT_KEYS = [
  'shoulder_hip', 'shoulder_torso', 'hip_torso', 'torso_leg',
  'upperleg_lowerleg', 'upperarm_forearm', 'arm_leg',
];

export const SKELETON = [
  [11, 12], [23, 24],
  [11, 23], [12, 24],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [0, 11], [0, 12],
];

const RATIO_LABELS = {
  shoulder: 'shoulder breadth', hip: 'hip breadth', torso: 'torso length',
  upper_leg: 'upper leg', lower_leg: 'lower leg', leg_total: 'leg total',
  upper_arm: 'upper arm', forearm: 'forearm', arm_total: 'arm total',
  shoulder_hip: 'shoulder ÷ hip', shoulder_torso: 'shoulder ÷ torso',
  hip_torso: 'hip ÷ torso', torso_leg: 'torso ÷ leg',
  upperleg_lowerleg: 'upper ÷ lower leg', upperarm_forearm: 'upper ÷ forearm',
  arm_leg: 'arm ÷ leg',
};
export const ratioLabel = (k) => RATIO_LABELS[k] || k;

// ---- pose landmarker ----
let landmarker = null, failed = false;

export async function ensurePose(onStatus) {
  if (landmarker || failed) return landmarker;
  const mk = async (delegate) => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      numPoses: 1,
    });
  };
  try {
    onStatus && onStatus('loading pose model…');
    landmarker = await mk('GPU');
    onStatus && onStatus('pose ready');
  } catch (e) {
    try { landmarker = await mk('CPU'); onStatus && onStatus('pose ready'); }
    catch (e2) { failed = true; onStatus && onStatus('measurement unavailable'); }
  }
  return landmarker;
}

// ---- math ----
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r3 = (v) => Math.round(v * 1000) / 1000;

export function computeRatios(pts) {
  // pts: Map idx -> {x, y} in normalized coords
  const P = (i) => pts.get(i);
  const mid = (a, b) => ({ x: (P(a).x + P(b).x) / 2, y: (P(a).y + P(b).y) / 2 });
  const avg = (...xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const shoulder = dist(P(11), P(12));
  const hip = dist(P(23), P(24));
  const torso = dist(mid(11, 12), mid(23, 24));
  const upper_leg = avg(dist(P(23), P(25)), dist(P(24), P(26)));
  const lower_leg = avg(dist(P(25), P(27)), dist(P(26), P(28)));
  const leg_total = upper_leg + lower_leg;
  const upper_arm = avg(dist(P(11), P(13)), dist(P(12), P(14)));
  const forearm = avg(dist(P(13), P(15)), dist(P(14), P(16)));
  const arm_total = upper_arm + forearm;
  const sd = (n, d) => Math.abs(d) > 1e-6 ? n / d : NaN;

  const raw = {
    shoulder, hip, torso, upper_leg, lower_leg, leg_total,
    upper_arm, forearm, arm_total,
    shoulder_hip: sd(shoulder, hip),
    shoulder_torso: sd(shoulder, torso),
    hip_torso: sd(hip, torso),
    torso_leg: sd(torso, leg_total),
    upperleg_lowerleg: sd(upper_leg, lower_leg),
    upperarm_forearm: sd(upper_arm, forearm),
    arm_leg: sd(arm_total, leg_total),
  };
  const out = {};
  for (const k of RATIO_KEYS) out[k] = r3(raw[k]);
  return out;
}

export async function measureImage(img) {
  // img: HTMLImageElement (fully loaded). Returns rec like measure.py.
  const rec = { ok: false, skip_reason: null, ratios: null, visibility: null, warnings: [] };
  const lm = await ensurePose();
  if (!lm) { rec.skip_reason = 'pose model failed to load'; return rec; }
  let res;
  try { res = lm.detect(img); }
  catch (e) { rec.skip_reason = 'detection error: ' + e.message; return rec; }
  const poses = res.landmarks || res.poseLandmarks || [];
  if (!poses.length || !poses[0].length) { rec.skip_reason = 'no pose landmarks detected'; return rec; }
  const L = poses[0];

  const vis = {};
  for (const i of REQUIRED) vis[i] = L[i].visibility ?? 0;
  const vals = Object.values(vis);
  const vmin = Math.min(...vals), vmean = vals.reduce((s, v) => s + v, 0) / vals.length;
  rec.visibility = {
    min: r3(vmin), mean: r3(vmean),
    per_landmark: Object.fromEntries(Object.entries(vis).map(([k, v]) => [k, r3(v)])),
  };
  const bad = Object.entries(vis).filter(([, v]) => v < VISIBILITY_MIN).map(([k]) => k);
  if (bad.length) {
    rec.skip_reason = `visibility gate failed (min 0.5) on landmark(s): ${bad.sort((a, b) => a - b).join(', ')}`;
    return rec;
  }
  if (vmin < 0.65) rec.warnings.push(`borderline visibility: min=${vmin.toFixed(2)} over required landmarks`);

  const seg = (a, b) => dist(L[a], L[b]);
  for (const [label, [p1, p2]] of Object.entries({
    upper_leg: [[23, 25], [24, 26]], lower_leg: [[25, 27], [26, 28]],
    upper_arm: [[11, 13], [12, 14]], forearm: [[13, 15], [14, 16]],
  })) {
    const l = seg(...p1), r = seg(...p2), den = Math.max(l, r);
    if (den > 1e-6 && Math.abs(l - r) / den > 0.35) {
      rec.warnings.push(`left/right asymmetry in ${label}: ${l.toFixed(3)} vs ${r.toFixed(3)} (possible foreshortening or side pose)`);
    }
  }

  const pts = new Map(REQUIRED.map((i) => [i, { x: L[i].x, y: L[i].y }]));
  rec.ratios = computeRatios(pts);
  rec.landmarks = L.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 }));
  if (Object.values(rec.ratios).some((v) => !isFinite(v))) {
    rec.ok = false; rec.ratios = null;
    rec.skip_reason = 'degenerate geometry (near-zero denominator)';
    return rec;
  }
  rec.ok = true;
  return rec;
}

// ---- models (localStorage) ----
const STORE_KEY = 'bodymetrics.models.v1';

export function loadModels() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}
export function saveModels(models) {
  localStorage.setItem(STORE_KEY, JSON.stringify(models));
}
export function deleteModel(name) {
  const m = loadModels(); delete m[name]; saveModels(m);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function buildModel(name, recs, { outlierReject = true } = {}) {
  // recs: array of ok measurement recs. Returns {model, kept, outliers, skipped}.
  const kept0 = recs.filter((r) => r.ok);
  let kept = kept0, outliers = [];
  if (outlierReject && kept.length >= 4) {
    // median + MAD per invariant key; drop photos with robust |z| > 3
    const worst = kept.map((r) => {
      let w = 0;
      for (const k of INVARIANT_KEYS) {
        const col = kept.map((q) => q.ratios[k]);
        const med = median(col);
        const mad = median(col.map((v) => Math.abs(v - med)));
        const rs = Math.max(1.4826 * mad, ZERO_STD_EPS);
        w = Math.max(w, Math.abs((r.ratios[k] - med) / rs));
      }
      return w;
    });
    const inliers = [], outs = [];
    kept.forEach((r, i) => (worst[i] > 3 ? outs : inliers).push(r));
    if (inliers.length >= 2) { kept = inliers; outliers = outs; }
  }
  const n = kept.length;
  const mean = {}, std = {};
  for (const k of RATIO_KEYS) {
    const col = kept.map((r) => r.ratios[k]);
    const m = col.reduce((s, v) => s + v, 0) / n;
    mean[k] = r3(m);
    std[k] = r3(Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / n));
  }
  const model = {
    person: name, n_photos: n, ratio_keys: RATIO_KEYS, mean, std,
    photos: kept.map((r) => ({ image: r.name || 'upload', ratios: r.ratios })),
    tool: 'body-metrics-web',
    note: 'ratio statistics only; no paths or pixel data stored',
  };
  return { model, kept, outliers, skipped: recs.length - kept0.length };
}

// ---- matching ----
export function zDistance(ratios, model, keys = INVARIANT_KEYS) {
  let sum = 0; const perKey = {}; let n = 0;
  for (const k of keys) {
    if (!(k in ratios) || !(k in model.mean)) continue;
    const s = Math.max(model.std[k] || 0, ZERO_STD_EPS);
    const z = (ratios[k] - model.mean[k]) / s;
    sum += z * z; perKey[k] = z; n++;
  }
  if (!n) return { distance: null, n: 0, perKey: {} };
  return { distance: Math.sqrt(sum), n, perKey };
}

export function rankModels(ratios, models, keys = INVARIANT_KEYS) {
  return Object.values(models)
    .map((m) => ({ person: m.person, ...zDistance(ratios, m, keys) }))
    .sort((a, b) => (a.distance === null) - (b.distance === null) || (a.distance ?? 1e9) - (b.distance ?? 1e9));
}

// ---- canvas overlay ----
export function drawSkeleton(canvas, img, landmarks, opts = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = img.naturalWidth || img.width;
  const h = canvas.height = img.naturalHeight || img.height;
  ctx.drawImage(img, 0, 0, w, h);
  if (!landmarks) return;
  const px = (i) => ({ x: landmarks[i].x * w, y: landmarks[i].y * h });
  ctx.lineWidth = Math.max(2, w / 300); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,255,0,0.9)';
  for (const [a, b] of SKELETON) {
    const A = px(a), B = px(b);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  ctx.font = `${Math.max(11, w / 70)}px monospace`;
  for (const i of REQUIRED) {
    const p = px(i), v = landmarks[i].visibility ?? 0;
    const ok = v >= VISIBILITY_MIN;
    ctx.fillStyle = ok ? '#0f0' : '#f00';
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, w / 160), 0, 7); ctx.fill();
    if (opts.labels !== false) {
      const t = String(i), tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(p.x + 6, p.y - 18, tw + 8, 18);
      ctx.fillStyle = '#fff'; ctx.fillText(t, p.x + 10, p.y - 4);
    }
  }
}
