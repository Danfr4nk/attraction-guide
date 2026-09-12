// telemetry v2 — web-feasible precision upgrades.
// Imports from measure.js only (no cycle with telemetry.js).
// solvePnP 3D pose stays in the offline pipeline (no cv2 in browser);
// the lab documents that split in its method section.
import { LANDMARK_IDX } from './measure.js';

export const IRIS = {
  center_L: 468, center_R: 473,
  L_axes: [[469, 471], [470, 472]], R_axes: [[474, 476], [475, 477]],
};
export const EYE_RING_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const EYE_RING_R = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
export const LIP_RING = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const IRIS_MM = 11.7; // mean human iris diameter; ~±5% biological variation

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const PX = (p, w, h) => [p.x * w, p.y * h];

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// ---- image quality module (canvas; same thresholds as the offline pipeline) ----
export function analyzeQuality(img, lm) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const sw = 256, sh = Math.max(1, Math.round(256 * h / w));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const g = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++)
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // Laplacian variance
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    const i = y * sw + x;
    const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - sw] - g[i + sw];
    n++; const delta = lap - mean; mean += delta / n; m2 += delta * (lap - mean);
  }
  const sharpness = m2 / Math.max(1, n - 1);
  // face bbox in small coords
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of lm) {
    const X = p.x * sw, Y = p.y * sh;
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  x0 = Math.max(0, Math.floor(x0 * 0.95)); x1 = Math.min(sw, Math.ceil(x1 * 1.05));
  y0 = Math.max(0, Math.floor(y0 * 0.95)); y1 = Math.min(sh, Math.ceil(y1 * 1.05));
  let sum = 0, cnt = 0, clip = 0, sumL = 0, cntL = 0, sumR = 0, cntR = 0;
  const mx = (x0 + x1) / 2;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = g[y * sw + x];
    sum += v; cnt++; if (v < 8 || v > 247) clip++;
    if (x < mx) { sumL += v; cntL++; } else { sumR += v; cntR++; }
  }
  const exposure = sum / Math.max(1, cnt);
  const clipping = clip / Math.max(1, cnt) * 100;
  const illum = Math.abs(sumL / Math.max(1, cntL) - sumR / Math.max(1, cntR)) / (exposure || 1);
  const I = LANDMARK_IDX;
  const eL = mid(PX(lm[I.eye_outer_L], w, h), PX(lm[I.eye_inner_L], w, h));
  const eR = mid(PX(lm[I.eye_outer_R], w, h), PX(lm[I.eye_inner_R], w, h));
  const iidPx = dist(eL, eR);
  const notes = []; let fails = 0, warns = 0;
  if (sharpness < 60) { fails++; notes.push(`sharpness ${sharpness.toFixed(0)} < 60: blurry`); }
  else if (sharpness < 120) { warns++; notes.push(`sharpness ${sharpness.toFixed(0)} < 120: soft`); }
  if (iidPx < 40) { fails++; notes.push(`face too small (iid ${iidPx.toFixed(0)}px)`); }
  else if (iidPx < 90) { warns++; notes.push(`small face (iid ${iidPx.toFixed(0)}px < 90)`); }
  if (clipping > 25) { fails++; notes.push(`clipping ${clipping.toFixed(1)}% > 25%`); }
  else if (clipping > 10) { warns++; notes.push(`clipping ${clipping.toFixed(1)}% > 10%`); }
  if (exposure < 50 || exposure > 205) { warns++; notes.push(`exposure ${exposure.toFixed(0)} out of 50–205`); }
  if (illum > 0.25) { warns++; notes.push(`harsh side light (balance ${illum.toFixed(2)})`); }
  return {
    sharpness: r3(sharpness), exposure: r3(exposure), clipping_pct: r3(clipping),
    iid_px: r3(iidPx), illum_balance: r3(illum),
    verdict: fails ? 'fail' : warns ? 'warn' : 'pass', notes,
  };
}

// ---- v2 extras: iris scale, mm duals, contour areas, shape ----
export function computeV2(lm, w, h, calibIpDmm) {
  const I = LANDMARK_IDX;
  const P = {};
  for (const [k, i] of Object.entries(I)) P[k] = PX(lm[i], w, h);
  const ex = {};
  let irisPx = null, irisL = null, irisR = null;
  if (lm.length >= 478) {
    const dia = (axes) => {
      const ds = axes.map(([a, b]) => dist(PX(lm[a], w, h), PX(lm[b], w, h)));
      return ds.reduce((s, v) => s + v, 0) / ds.length;
    };
    irisL = dia(IRIS.L_axes); irisR = dia(IRIS.R_axes);
    irisPx = (irisL + irisR) / 2;
  }
  const eL = mid(P.eye_outer_L, P.eye_inner_L), eR = mid(P.eye_outer_R, P.eye_inner_R);
  let mmpp = null, src = 'none';
  if (calibIpDmm && calibIpDmm > 0) { mmpp = calibIpDmm / dist(eL, eR); src = 'calibrated'; }
  else if (irisPx) { mmpp = IRIS_MM / irisPx; src = 'iris'; }
  ex.iris_diam_px = irisPx ? r3(irisPx) : null;
  ex.iris_diam_L_px = irisL ? r3(irisL) : null;
  ex.iris_diam_R_px = irisR ? r3(irisR) : null;
  ex.mm_per_px = mmpp ? Math.round(mmpp * 10000) / 10000 : null;
  ex.scale_source = src;
  const mm = (px) => mmpp ? r3(px * mmpp) : null;
  const glabella = mid(PX(lm[107], w, h), PX(lm[336], w, h));
  const subnasale = PX(lm[2], w, h), nasion = PX(lm[168], w, h);
  const innerTop = PX(lm[13], w, h), innerBot = PX(lm[14], w, h);
  ex.face_width_mm = mm(dist(P.cheek_L, P.cheek_R));
  ex.face_height_mm = mm(dist(P.forehead, P.chin));
  ex.ipd_mm = mm(dist(eL, eR));
  ex.jaw_width_mm = mm(dist(P.jaw_L, P.jaw_R));
  ex.nose_w_mm = mm(dist(P.nostril_L, P.nostril_R));
  ex.nose_len_mm = mm(dist(nasion, P.nose_tip));
  ex.mouth_w_mm = mm(dist(P.mouth_L, P.mouth_R));
  ex.eye_w_L_mm = mm(dist(P.eye_outer_L, P.eye_inner_L));
  ex.eye_w_R_mm = mm(dist(P.eye_outer_R, P.eye_inner_R));
  ex.eye_w_mean_mm = mm((dist(P.eye_outer_L, P.eye_inner_L) + dist(P.eye_outer_R, P.eye_inner_R)) / 2);
  ex.upper_lip_mm = mm(dist(P.lip_top, innerTop));
  ex.lower_lip_mm = mm(dist(innerBot, P.lip_bot));
  ex.chin_height_mm = mm(dist(P.lip_bot, P.chin));
  ex.philtrum_mm = mm(dist(subnasale, P.lip_top));
  ex.forehead_height_mm = mm(dist(P.forehead, glabella));
  const aL = polygonArea(EYE_RING_L.map(i => PX(lm[i], w, h)));
  const aR = polygonArea(EYE_RING_R.map(i => PX(lm[i], w, h)));
  const aLip = polygonArea(LIP_RING.map(i => PX(lm[i], w, h)));
  const k2 = mmpp ? mmpp * mmpp : null;
  ex.eye_area_L_mm2 = k2 ? r3(aL * k2) : null;
  ex.eye_area_R_mm2 = k2 ? r3(aR * k2) : null;
  ex.eye_area_mean_mm2 = k2 ? r3((aL + aR) / 2 * k2) : null;
  ex.eye_area_asym = (aL + aR) ? r3(Math.abs(aL - aR) / ((aL + aR) / 2)) : null;
  ex.lip_area_mm2 = k2 ? r3(aLip * k2) : null;
  const mouthW = dist(P.mouth_L, P.mouth_R);
  ex.mouth_corner_drop = r3(((P.mouth_L[1] + P.mouth_R[1]) / 2 - innerTop[1]) / mouthW);
  const apexAngle = (ids, oI, iI) => {
    const pts = ids.map(i => PX(lm[i], w, h));
    const apex = pts.reduce((a, p) => p[1] < a[1] ? p : a);
    const o = PX(lm[oI], w, h), ii = PX(lm[iI], w, h);
    const v1 = [o[0] - apex[0], o[1] - apex[1]], v2 = [ii[0] - apex[0], ii[1] - apex[1]];
    const m = Math.hypot(...v1) * Math.hypot(...v2) || 1;
    return Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / m, -1, 1)) * 180 / Math.PI;
  };
  const apL = apexAngle([70, 63, 105, 66, 107], 70, 107);
  const apR = apexAngle([300, 293, 334, 296, 336], 300, 336);
  ex.brow_apex_angle_L = r3(apL); ex.brow_apex_angle_R = r3(apR);
  ex.brow_apex_angle_mean = r3((apL + apR) / 2);
  return ex;
}

const mm1 = (v) => v == null ? '—' : v.toFixed(1) + ' mm';
const mm2 = (v) => v == null ? '—' : v.toFixed(1) + ' mm²';
const pct = (v) => (v * 100).toFixed(1) + '%';
const txt = (v) => String(v);

export const V2_GROUPS = [
  ['physical', 'physical scale (mm)'],
  ['contours', 'contour areas'],
  ['shape', 'shape descriptors'],
];

export const V2_METRIC_DEFS = [
  { key: 'iris_diam_px', group: 'physical', label: 'iris diameter', fmt: (v) => v == null ? '—' : Math.round(v) + ' px', hint: '4 axes, both eyes' },
  { key: 'iris_diam_L_px', group: 'physical', label: 'iris diameter L', fmt: (v) => v == null ? '—' : Math.round(v) + ' px', hint: '2 axes, left eye' },
  { key: 'iris_diam_R_px', group: 'physical', label: 'iris diameter R', fmt: (v) => v == null ? '—' : Math.round(v) + ' px', hint: '2 axes, right eye' },
  { key: 'mm_per_px', group: 'physical', label: 'mm per px', fmt: (v) => v == null ? '—' : v.toFixed(4), hint: '11.7mm iris anchor' },
  { key: 'scale_source', group: 'physical', label: 'scale source', fmt: txt, hint: 'iris | calibrated | none', noCI: true },
  { key: 'face_width_mm', group: 'physical', label: 'face width', fmt: mm1 },
  { key: 'face_height_mm', group: 'physical', label: 'face height', fmt: mm1 },
  { key: 'ipd_mm', group: 'physical', label: 'IPD', fmt: mm1 },
  { key: 'jaw_width_mm', group: 'physical', label: 'jaw width', fmt: mm1 },
  { key: 'eye_w_L_mm', group: 'physical', label: 'eye width L', fmt: mm1 },
  { key: 'eye_w_R_mm', group: 'physical', label: 'eye width R', fmt: mm1 },
  { key: 'eye_w_mean_mm', group: 'physical', label: 'eye width mean', fmt: mm1 },
  { key: 'nose_w_mm', group: 'physical', label: 'nose width', fmt: mm1 },
  { key: 'nose_len_mm', group: 'physical', label: 'nose length', fmt: mm1 },
  { key: 'mouth_w_mm', group: 'physical', label: 'mouth width', fmt: mm1 },
  { key: 'upper_lip_mm', group: 'physical', label: 'upper lip height', fmt: mm1 },
  { key: 'lower_lip_mm', group: 'physical', label: 'lower lip height', fmt: mm1 },
  { key: 'chin_height_mm', group: 'physical', label: 'chin height', fmt: mm1 },
  { key: 'philtrum_mm', group: 'physical', label: 'philtrum', fmt: mm1 },
  { key: 'forehead_height_mm', group: 'physical', label: 'forehead height', fmt: mm1 },
  { key: 'eye_area_L_mm2', group: 'contours', label: 'eye fissure area L', fmt: mm2, hint: '16-pt ring' },
  { key: 'eye_area_R_mm2', group: 'contours', label: 'eye fissure area R', fmt: mm2 },
  { key: 'eye_area_mean_mm2', group: 'contours', label: 'eye fissure area mean', fmt: mm2 },
  { key: 'eye_area_asym', group: 'contours', label: 'eye area asymmetry', fmt: (v) => v == null ? '—' : v.toFixed(3) },
  { key: 'lip_area_mm2', group: 'contours', label: 'lip vermilion area', fmt: mm2, hint: '20-pt ring' },
  { key: 'mouth_corner_drop', group: 'shape', label: 'mouth corner drop', fmt: pct, hint: '+ = downturned, ÷ mouth width' },
  { key: 'brow_apex_angle_L', group: 'shape', label: 'brow apex angle L', fmt: (v) => v.toFixed(1) + '°', hint: 'at brow apex, outer↔inner' },
  { key: 'brow_apex_angle_R', group: 'shape', label: 'brow apex angle R', fmt: (v) => v.toFixed(1) + '°' },
  { key: 'brow_apex_angle_mean', group: 'shape', label: 'brow apex angle mean', fmt: (v) => v.toFixed(1) + '°' },
];
