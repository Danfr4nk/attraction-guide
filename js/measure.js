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
};

export function formatMetrics(m) {
  if (!m) return 'measuring…';
  return Object.entries(METRIC_LABELS).map(([k, l]) => `${l} ${m[k].toFixed(3)}`).join('\n');
}
