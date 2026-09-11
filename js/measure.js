// In-browser facial landmark measurement (MediaPipe Tasks Vision FaceLandmarker).
// Same ratio definitions as the offline facemetrics pipeline (measure.py).
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

const IDX = {
  eye_outer_L: 33, eye_inner_L: 133, eye_inner_R: 362, eye_outer_R: 263,
  eye_top_L: 159, eye_bot_L: 145, eye_top_R: 386, eye_bot_R: 374,
  mouth_L: 61, mouth_R: 291, lip_top: 0, lip_bot: 17,
  nose_tip: 1, nostril_L: 98, nostril_R: 327,
  chin: 152, jaw_L: 172, jaw_R: 397,
  cheek_L: 234, cheek_R: 454, forehead: 10,
};

let landmarker = null;
let ready = false;
let failed = false;

// Extended landmark indices for the diagnostic metric set (same as the
// offline audit pipeline — telemetry_bank.py — so game measurements match
// the pair-validity numbers exactly).
const EXTRA = {
  brow_L: [70, 63, 105, 66, 107], brow_R: [300, 293, 334, 296, 336],
  brow_inner_L: 107, brow_inner_R: 336, brow_outer_L: 70, brow_outer_R: 300,
  mouth_inner_top: 13, mouth_inner_bot: 14,
};

export async function ensureLandmarker(onStatus) {
  if (landmarker || failed) return landmarker;
  try {
    onStatus && onStatus('loading landmark model…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
    });
    ready = true;
    onStatus && onStatus('landmarks ready');
  } catch (e) {
    // GPU delegate can fail on some devices; retry CPU
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      });
      ready = true;
      onStatus && onStatus('landmarks ready');
    } catch (e2) {
      failed = true;
      onStatus && onStatus('measurement unavailable');
    }
  }
  return landmarker;
}

export function measurementReady() { return ready; }

export const LANDMARK_IDX = IDX;

// Raw 468-landmark detection — the same detector the game uses.
// The telemetry lab builds its extended metric set on top of this.
export function detectLandmarks(img) {
  if (!landmarker) return null;
  try {
    const res = landmarker.detect(img);
    if (!res.faceLandmarks || !res.faceLandmarks.length) return null;
    return res.faceLandmarks[0];
  } catch (e) {
    return null;
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const meanp = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const angleAt = (a, b, c) => {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / m));
  return Math.acos(cos) * 180 / Math.PI;
};
// canthal tilt: signed elevation of outer corner above inner corner, |dx| convention (+ = outer higher)
const tiltOf = (inner, outer) => Math.atan2(-(outer.y - inner.y), Math.abs(outer.x - inner.x)) * 180 / Math.PI;
const perpDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
};

// img: HTMLImageElement (must be loaded). Returns ratios or null.
export function measureImage(img) {
  const lm = detectLandmarks(img);
  if (!lm) return null;
  const P = {};
  for (const [k, i] of Object.entries(IDX)) P[k] = lm[i];

  const cheek_w = dist(P.cheek_L, P.cheek_R);
  const face_h = dist(P.forehead, P.chin);
  const jaw_w = dist(P.jaw_L, P.jaw_R);
  const ipd = dist(mid(P.eye_outer_L, P.eye_inner_L), mid(P.eye_outer_R, P.eye_inner_R));
  const eye_w = (dist(P.eye_outer_L, P.eye_inner_L) + dist(P.eye_outer_R, P.eye_inner_R)) / 2;
  const eye_h = (dist(P.eye_top_L, P.eye_bot_L) + dist(P.eye_top_R, P.eye_bot_R)) / 2;
  const nose_w = dist(P.nostril_L, P.nostril_R);
  const mouth_w = dist(P.mouth_L, P.mouth_R);
  const lip_h = dist(P.lip_top, P.lip_bot);

  const x_mid = (P.forehead.x + P.chin.x) / 2;
  const pairs = [
    ['eye_outer_L', 'eye_outer_R'], ['eye_inner_L', 'eye_inner_R'],
    ['mouth_L', 'mouth_R'], ['jaw_L', 'jaw_R'],
    ['cheek_L', 'cheek_R'], ['nostril_L', 'nostril_R'],
  ];
  const asyms = pairs.map(([l, r]) => {
    const dL = Math.abs(P[l].x - x_mid), dR = Math.abs(P[r].x - x_mid);
    const denom = (dL + dR) / 2 || 1;
    return Math.abs(dL - dR) / denom;
  });

  // ---- diagnostic metric set (exact port of the offline audit pipeline) ----
  const gonL = angleAt(P.cheek_L, P.jaw_L, P.chin);
  const gonR = angleAt(P.cheek_R, P.jaw_R, P.chin);
  const tiltL = tiltOf(P.eye_inner_L, P.eye_outer_L);
  const tiltR = tiltOf(P.eye_inner_R, P.eye_outer_R);
  const browL = EXTRA.brow_L.map((i) => lm[i]);
  const browR = EXTRA.brow_R.map((i) => lm[i]);
  const boL = lm[EXTRA.brow_outer_L], biL = lm[EXTRA.brow_inner_L];
  const boR = lm[EXTRA.brow_outer_R], biR = lm[EXTRA.brow_inner_R];
  const archL = Math.max(...browL.map((p) => perpDist(p, boL, biL))) / eye_w;
  const archR = Math.max(...browR.map((p) => perpDist(p, boR, biR))) / eye_w;
  const browEye = (dist(meanp(browL), P.eye_top_L) + dist(meanp(browR), P.eye_top_R)) / 2 / face_h * 100;
  const innerTop = lm[EXTRA.mouth_inner_top], innerBot = lm[EXTRA.mouth_inner_bot];
  const asym9 = [...pairs.map(([l, r]) => [P[l], P[r]]), [biL, biR], [boL, boR], [P.eye_top_L, P.eye_top_R]]
    .map(([l, r]) => {
      const dL = Math.abs(l.x - x_mid), dR = Math.abs(r.x - x_mid);
      return Math.abs(dL - dR) / (((dL + dR) / 2) || 1);
    }).reduce((a, b) => a + b, 0) / 9;

  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    width_height_ratio: r3(cheek_w / face_h),
    jaw_to_cheek: r3(jaw_w / cheek_w),
    ipd_to_cheek: r3(ipd / cheek_w),
    eye_w_to_h: r3(eye_w / eye_h),
    nose_to_cheek: r3(nose_w / cheek_w),
    mouth_to_cheek: r3(mouth_w / cheek_w),
    lip_fullness: r3(lip_h / mouth_w),
    mean_asymmetry: r3(asyms.reduce((a, b) => a + b, 0) / asyms.length),
    gonial_angle_mean: r3((gonL + gonR) / 2),
    eye_spacing_widths: r3(ipd / eye_w),
    nose_w_to_intercanthal: r3(nose_w / dist(P.eye_inner_L, P.eye_inner_R)),
    brow_arch_mean: r3((archL + archR) / 2),
    canthal_tilt_mean: r3((tiltL + tiltR) / 2),
    brow_eye_dist_pct: r3(browEye),
    mouth_to_nose: r3(mouth_w / nose_w),
    upper_lower_lip: r3(dist(P.lip_top, innerTop) / (dist(innerBot, P.lip_bot) || 1)),
    asymmetry_9: r3(asym9),
  };
}

export const METRIC_LABELS = {
  width_height_ratio: 'w:h',
  jaw_to_cheek: 'jaw:chk',
  ipd_to_cheek: 'ipd:chk',
  eye_w_to_h: 'eye w:h',
  nose_to_cheek: 'nose:chk',
  mouth_to_cheek: 'mth:chk',
  lip_fullness: 'lip full',
  mean_asymmetry: 'asym',
  gonial_angle_mean: 'gonial°',
  eye_spacing_widths: 'eye spc',
  nose_w_to_intercanthal: 'nose:ic',
  brow_arch_mean: 'brow arch',
  canthal_tilt_mean: 'tilt',
  brow_eye_dist_pct: 'brw-eye%',
  mouth_to_nose: 'mth:nose',
  upper_lower_lip: 'u:l lip',
  asymmetry_9: 'asym9',
};

export function formatMetrics(m) {
  if (!m) return 'measuring…';
  return Object.entries(METRIC_LABELS).map(([k, l]) => `${l} ${m[k].toFixed(3)}`).join('\n');
}
