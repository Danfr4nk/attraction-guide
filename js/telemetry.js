// telemetry lab — standalone precision facial measurement.
// Uses the SAME detector + landmark indices as the game (js/measure.js),
// but lives outside the game flow: upload → full telemetry vector → overlay.
import { ensureLandmarker, detectLandmarks, LANDMARK_IDX } from './measure.js';
import { analyzeQuality, computeV2, V2_METRIC_DEFS, V2_GROUPS, EYE_RING_L, EYE_RING_R, LIP_RING, IRIS } from './telemetry2.js';
import { computeV3, V3_METRIC_DEFS, V3_GROUPS, bootstrapCI } from './telemetry3.js';
// NOTE: V2 defs are appended AFTER the METRIC_DEFS / GROUPS declarations below
// (const arrays are in the temporal dead zone until their declaration executes).

const EXTRA = {
  brow_L: [70, 63, 105, 66, 107],   // outer → inner
  brow_R: [300, 293, 334, 296, 336], // outer → inner
  brow_inner_L: 107, brow_inner_R: 336,
  brow_outer_L: 70, brow_outer_R: 300,
  nasion: 168, subnasale: 2,
  mouth_inner_top: 13, mouth_inner_bot: 14,
};

// ---- math helpers (normalized landmark space; px variants multiply by dims) ----
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distPx = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const mean = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

function angleAt(a, b, c) { // degrees at vertex b
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  return Math.acos(clamp((v1x * v2x + v1y * v2y) / m, -1, 1)) * 180 / Math.PI;
}
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
}

// ---- metric catalogue ----
const f3 = (v) => v.toFixed(3), f1 = (v) => v.toFixed(1);
const deg = (v) => v.toFixed(1) + '°', pct1 = (v) => v.toFixed(1) + '%', pp = (v) => v.toFixed(1) + ' pp';
const px0 = (v) => Math.round(v) + ' px', i0 = (v) => String(Math.round(v));

export const GROUPS = [
  ['structure', 'structure'],
  ['eyes', 'eyes'],
  ['nose', 'nose'],
  ['mouth', 'mouth'],
  ['brows', 'brows'],
  ['pose', 'symmetry & pose'],
  ['canons', 'classical canons'],
];

export const METRIC_DEFS = [
  // structure
  { key: 'face_width_px', group: 'structure', label: 'face width', fmt: px0, hint: 'bizygomatic 234↔454' },
  { key: 'face_height_px', group: 'structure', label: 'face height', fmt: px0, hint: 'forehead 10 → chin 152' },
  { key: 'width_height_ratio', group: 'structure', label: 'width : height', fmt: f3, game: true },
  { key: 'fwhr_proxy', group: 'structure', label: 'fWHR (proxy)', fmt: f3, hint: 'cheek width ÷ glabella→subnasale' },
  { key: 'jaw_to_cheek', group: 'structure', label: 'jaw : cheek', fmt: f3, game: true },
  { key: 'gonial_angle_mean', group: 'structure', label: 'gonial angle', fmt: deg, hint: 'at jaw angle, cheek→chin' },
  { key: 'gonial_angle_L', group: 'structure', label: 'gonial angle L', fmt: deg },
  { key: 'gonial_angle_R', group: 'structure', label: 'gonial angle R', fmt: deg },
  { key: 'third_upper_pct', group: 'structure', label: 'upper third', fmt: pct1, hint: 'forehead→glabella' },
  { key: 'third_mid_pct', group: 'structure', label: 'mid third', fmt: pct1, hint: 'glabella→subnasale' },
  { key: 'third_lower_pct', group: 'structure', label: 'lower third', fmt: pct1, hint: 'subnasale→chin' },
  { key: 'chin_to_lower_third', group: 'structure', label: 'chin : lower third', fmt: f3, hint: 'lower-lip→chin ÷ lower third' },
  { key: 'philtrum_to_nose', group: 'structure', label: 'philtrum : nose len', fmt: f3, hint: 'subnasale→lip ÷ nasion→tip' },
  // eyes
  { key: 'ipd_px', group: 'eyes', label: 'interpupillary dist', fmt: px0, hint: 'eye-center ↔ eye-center' },
  { key: 'ipd_to_cheek', group: 'eyes', label: 'IPD : cheek', fmt: f3, game: true },
  { key: 'eye_spacing_widths', group: 'eyes', label: 'spacing (eye-widths)', fmt: f3, hint: 'IPD ÷ eye width · canon 2.0' },
  { key: 'eye_w_to_h', group: 'eyes', label: 'eye width : height', fmt: f3, game: true },
  { key: 'canthal_tilt_mean', group: 'eyes', label: 'canthal tilt', fmt: deg, hint: '+ = outer corner higher · face-frame (roll-corrected)' },
  { key: 'canthal_tilt_L', group: 'eyes', label: 'canthal tilt L', fmt: deg, hint: 'face-frame (roll-corrected)' },
  { key: 'canthal_tilt_R', group: 'eyes', label: 'canthal tilt R', fmt: deg, hint: 'face-frame (roll-corrected)' },
  { key: 'fifths', group: 'eyes', label: 'facial fifths', fmt: f3, hint: 'face width ÷ eye width · canon 5' },
  // nose
  { key: 'nose_w_px', group: 'nose', label: 'nose width', fmt: px0, hint: 'alar 98↔327' },
  { key: 'nose_len_px', group: 'nose', label: 'nose length', fmt: px0, hint: 'nasion 168 → tip 1' },
  { key: 'nose_to_cheek', group: 'nose', label: 'nose : cheek', fmt: f3, game: true },
  { key: 'nose_w_to_intercanthal', group: 'nose', label: 'nose : intercanthal', fmt: f3, hint: 'canon 1.0' },
  // mouth
  { key: 'mouth_w_px', group: 'mouth', label: 'mouth width', fmt: px0, hint: '61↔291' },
  { key: 'mouth_to_cheek', group: 'mouth', label: 'mouth : cheek', fmt: f3, game: true },
  { key: 'mouth_to_nose', group: 'mouth', label: 'mouth : nose', fmt: f3, hint: 'canon 1.5' },
  { key: 'lip_fullness', group: 'mouth', label: 'lip fullness', fmt: f3, game: true },
  { key: 'upper_lower_lip', group: 'mouth', label: 'upper : lower lip', fmt: f3, hint: 'vermilion heights' },
  // brows
  { key: 'brow_eye_dist_pct', group: 'brows', label: 'brow–eye distance', fmt: pct1, hint: 'brow centroid→eye top ÷ face height' },
  { key: 'brow_arch_mean', group: 'brows', label: 'brow arch', fmt: f3, hint: 'arch height ÷ eye width' },
  { key: 'brow_arch_L', group: 'brows', label: 'brow arch L', fmt: f3 },
  { key: 'brow_arch_R', group: 'brows', label: 'brow arch R', fmt: f3 },
  // symmetry & pose
  { key: 'mean_asymmetry', group: 'pose', label: 'asymmetry (game)', fmt: f3, game: true, hint: '6 landmark pairs' },
  { key: 'asymmetry_9', group: 'pose', label: 'asymmetry (9-pair)', fmt: f3, hint: '+ brow inner/outer, eye-top' },
  { key: 'canthal_tilt_diff', group: 'pose', label: 'canthal tilt |L−R|', fmt: deg },
  { key: 'gonial_diff', group: 'pose', label: 'gonial angle |L−R|', fmt: deg },
  { key: 'roll_deg', group: 'pose', label: 'head roll', fmt: deg, hint: 'eye-axis vs horizontal' },
  { key: 'yaw_proxy_deg', group: 'pose', label: 'head yaw (proxy)', fmt: deg, hint: 'from cheek foreshortening' },
  { key: 'frontality', group: 'pose', label: 'frontality score', fmt: i0, hint: '0–100 composite' },
  // classical canons (deviation from ideal)
  { key: 'canon_thirds', group: 'canons', label: 'thirds equality', fmt: pp, hint: 'max |third − 33.3%|' },
  { key: 'canon_fifths', group: 'canons', label: 'fifths = 5', fmt: pct1, hint: '|fifths−5| ÷ 5' },
  { key: 'canon_nose', group: 'canons', label: 'nose = intercanthal', fmt: pct1, hint: '|ratio−1| × 100' },
  { key: 'canon_mouth', group: 'canons', label: 'mouth = 1.5× nose', fmt: pct1, hint: '|ratio−1.5| ÷ 1.5' },
  { key: 'canon_spacing', group: 'canons', label: 'IPD = 2 eye widths', fmt: pct1, hint: '|ratio−2| ÷ 2 · corrected 2026-09-11 (was 1.0)' },
];

// v2 additions ship in telemetry2.js — merged here after both arrays exist
METRIC_DEFS.push(...V2_METRIC_DEFS, ...V3_METRIC_DEFS);
GROUPS.push(...V2_GROUPS, ...V3_GROUPS);

export const DEF_BY_KEY = Object.fromEntries(METRIC_DEFS.map(d => [d.key, d]));

// ---- the full telemetry computation ----
export function computeTelemetry(lm, w, h) {
  const P = {};
  for (const [k, i] of Object.entries(LANDMARK_IDX)) P[k] = lm[i];
  const browL = EXTRA.brow_L.map(i => lm[i]);
  const browR = EXTRA.brow_R.map(i => lm[i]);
  const browInnerL = lm[EXTRA.brow_inner_L], browInnerR = lm[EXTRA.brow_inner_R];
  const browOuterL = lm[EXTRA.brow_outer_L], browOuterR = lm[EXTRA.brow_outer_R];
  const nasion = lm[EXTRA.nasion], subnasale = lm[EXTRA.subnasale];
  const innerTop = lm[EXTRA.mouth_inner_top], innerBot = lm[EXTRA.mouth_inner_bot];
  const glabella = mid(browInnerL, browInnerR);

  const cheek_w = dist(P.cheek_L, P.cheek_R);
  const face_h = dist(P.forehead, P.chin);
  const jaw_w = dist(P.jaw_L, P.jaw_R);
  const eyeCL = mid(P.eye_outer_L, P.eye_inner_L), eyeCR = mid(P.eye_outer_R, P.eye_inner_R);
  const roll = Math.atan2(eyeCR.y - eyeCL.y, eyeCR.x - eyeCL.x) * 180 / Math.PI; // + = image-right side lower
  const ipd = dist(eyeCL, eyeCR);
  const eye_w = (dist(P.eye_outer_L, P.eye_inner_L) + dist(P.eye_outer_R, P.eye_inner_R)) / 2;
  const eye_h = (dist(P.eye_top_L, P.eye_bot_L) + dist(P.eye_top_R, P.eye_bot_R)) / 2;
  const nose_w = dist(P.nostril_L, P.nostril_R);
  const mouth_w = dist(P.mouth_L, P.mouth_R);
  const lip_h = dist(P.lip_top, P.lip_bot);

  // structure
  const tU = dist(P.forehead, glabella), tM = dist(glabella, subnasale), tL = dist(subnasale, P.chin);
  const tTot = tU + tM + tL;
  const gonL = angleAt(P.cheek_L, P.jaw_L, P.chin), gonR = angleAt(P.cheek_R, P.jaw_R, P.chin);
  const philtrum = dist(subnasale, P.lip_top), noseLen = dist(nasion, P.nose_tip);

  // eyes — canthal tilt: signed elevation of the outer corner above the inner
  // corner, in the FACE frame. Uses |dx| so both eyes share one convention
  // (+ = outer higher); adding roll removes head-roll contamination, so two
  // photos of one face at different rolls report the same anatomy.
  const tilt = (inner, outer) => Math.atan2(-(outer.y - inner.y), Math.abs(outer.x - inner.x)) * 180 / Math.PI;
  const tiltL = tilt(P.eye_inner_L, P.eye_outer_L) + roll, tiltR = tilt(P.eye_inner_R, P.eye_outer_R) + roll;

  // brows
  const arch = (pts, outer, inner) => Math.max(...pts.map(p => perpDist(p, outer, inner))) / eye_w;
  const browCentL = mean(browL), browCentR = mean(browR);
  const browEye = (dist(browCentL, P.eye_top_L) + dist(browCentR, P.eye_top_R)) / 2 / face_h * 100;

  // symmetry & pose
  const x_mid = (P.forehead.x + P.chin.x) / 2;
  const asymPair = (l, r) => {
    const dL = Math.abs(l.x - x_mid), dR = Math.abs(r.x - x_mid);
    return Math.abs(dL - dR) / (((dL + dR) / 2) || 1);
  };
  const pairs6 = [
    [P.eye_outer_L, P.eye_outer_R], [P.eye_inner_L, P.eye_inner_R],
    [P.mouth_L, P.mouth_R], [P.jaw_L, P.jaw_R],
    [P.cheek_L, P.cheek_R], [P.nostril_L, P.nostril_R],
  ];
  const pairs9 = pairs6.concat([
    [browInnerL, browInnerR], [browOuterL, browOuterR], [P.eye_top_L, P.eye_top_R],
  ]);
  const asym6 = pairs6.reduce((s, [l, r]) => s + asymPair(l, r), 0) / pairs6.length;
  const asym9 = pairs9.reduce((s, [l, r]) => s + asymPair(l, r), 0) / pairs9.length;
  const dYawL = dist(P.cheek_L, P.nose_tip), dYawR = dist(P.nose_tip, P.cheek_R);
  const yaw = Math.atan2(dYawR - dYawL, dYawR + dYawL) * 180 / Math.PI;
  const frontality = clamp(100 - (Math.abs(roll) * 5 + Math.abs(yaw) * 4 + asym9 * 150), 0, 100);

  const thirds = [tU / tTot * 100, tM / tTot * 100, tL / tTot * 100];
  const canonThirds = Math.max(...thirds.map(t => Math.abs(t - 100 / 3)));
  const fifths = cheek_w / eye_w;
  const noseIC = nose_w / dist(P.eye_inner_L, P.eye_inner_R);
  const mouthNose = mouth_w / nose_w;
  const spacing = ipd / eye_w;

  const m = {
    face_width_px: distPx(P.cheek_L, P.cheek_R, w, h),
    face_height_px: distPx(P.forehead, P.chin, w, h),
    width_height_ratio: r3(cheek_w / face_h),
    fwhr_proxy: r3(cheek_w / dist(glabella, subnasale)),
    jaw_to_cheek: r3(jaw_w / cheek_w),
    gonial_angle_L: r3(gonL), gonial_angle_R: r3(gonR), gonial_angle_mean: r3((gonL + gonR) / 2),
    third_upper_pct: r3(thirds[0]), third_mid_pct: r3(thirds[1]), third_lower_pct: r3(thirds[2]),
    chin_to_lower_third: r3(dist(P.lip_bot, P.chin) / tL),
    philtrum_to_nose: r3(philtrum / noseLen),
    ipd_px: distPx(eyeCL, eyeCR, w, h),
    ipd_to_cheek: r3(ipd / cheek_w),
    eye_spacing_widths: r3(spacing),
    eye_w_to_h: r3(eye_w / eye_h),
    canthal_tilt_L: r3(tiltL), canthal_tilt_R: r3(tiltR), canthal_tilt_mean: r3((tiltL + tiltR) / 2),
    fifths: r3(fifths),
    nose_w_px: distPx(P.nostril_L, P.nostril_R, w, h),
    nose_len_px: distPx(nasion, P.nose_tip, w, h),
    nose_to_cheek: r3(nose_w / cheek_w),
    nose_w_to_intercanthal: r3(noseIC),
    mouth_w_px: distPx(P.mouth_L, P.mouth_R, w, h),
    mouth_to_cheek: r3(mouth_w / cheek_w),
    mouth_to_nose: r3(mouthNose),
    lip_fullness: r3(lip_h / mouth_w),
    upper_lower_lip: r3(dist(P.lip_top, innerTop) / (dist(innerBot, P.lip_bot) || 1)),
    brow_eye_dist_pct: r3(browEye),
    brow_arch_L: r3(arch(browL, browOuterL, browInnerL)),
    brow_arch_R: r3(arch(browR, browOuterR, browInnerR)),
    brow_arch_mean: r3((arch(browL, browOuterL, browInnerL) + arch(browR, browOuterR, browInnerR)) / 2),
    mean_asymmetry: r3(asym6),
    asymmetry_9: r3(asym9),
    canthal_tilt_diff: r3(Math.abs(tiltL - tiltR)),
    gonial_diff: r3(Math.abs(gonL - gonR)),
    roll_deg: r3(roll),
    yaw_proxy_deg: r3(yaw),
    frontality: Math.round(frontality * 10) / 10,
    canon_thirds: r3(canonThirds),
    canon_fifths: r3(Math.abs(fifths - 5) / 5 * 100),
    canon_nose: r3(Math.abs(noseIC - 1) * 100),
    canon_mouth: r3(Math.abs(mouthNose - 1.5) / 1.5 * 100),
    canon_spacing: r3(Math.abs(spacing - 2) / 2 * 100),
  };
  return {
    metrics: m,
    quality: frontality >= 85 ? 'high' : frontality >= 60 ? 'medium' : 'low',
    anchors: { glabella, nasion, subnasale, eyeCL, eyeCR, browInnerL, browInnerR },
  };
}

// ---- app state ----
const state = { items: [], activeId: null, compare: [] };
let seq = 0;

const $ = (id) => document.getElementById(id);
const statusEl = $('modelStatus'), dropzone = $('dropzone'), fileInput = $('fileInput');
const historyEl = $('history'), viewerCard = $('viewerCard'), metricsCard = $('metricsCard');
const compareCard = $('compareCard'), exportCard = $('exportCard');
const overlay = $('overlay'), octx = overlay.getContext('2d');

function setStatus(t, ready) {
  statusEl.textContent = t;
  statusEl.classList.toggle('ready', !!ready);
}

// ---- full metric vector (v1 + v2 + v3) — the unit the bootstrap resamples ----
function computeAllMetrics(lm, w, h, calib) {
  const tel = computeTelemetry(lm, w, h);
  return { ...tel.metrics, ...computeV2(lm, w, h, calib), ...computeV3(lm, w, h) };
}

// ---- upload + analysis ----
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

function makeThumb(img) {
  const t = document.createElement('canvas');
  const s = Math.min(1, 216 / Math.max(img.naturalWidth, img.naturalHeight));
  t.width = Math.max(1, Math.round(img.naturalWidth * s));
  t.height = Math.max(1, Math.round(img.naturalHeight * s));
  t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.7);
}

async function analyzeFile(file) {
  const { img, url } = await loadImageFromFile(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  const lm = detectLandmarks(img);
  if (!lm) { URL.revokeObjectURL(url); throw new Error('no face detected'); }
  const calibRaw = parseFloat(($('calibIpd') || {}).value);
  const calib = Number.isFinite(calibRaw) && calibRaw > 0 ? calibRaw : null;
  const tel = computeTelemetry(lm, w, h);
  const metrics = { ...tel.metrics, ...computeV2(lm, w, h, calib), ...computeV3(lm, w, h) };
  // bootstrap confidence: jitter landmarks, resample the full vector
  const ci = bootstrapCI((jl, jw, jh) => computeAllMetrics(jl, jw, jh, calib), lm, w, h);
  const v2src = metrics.scale_source;
  // scale-robustness notes: the iris anchor is the weakest link in the mm chain
  const scaleNotes = [];
  if (metrics.scale_source === 'iris' && metrics.iris_diam_L_px && metrics.iris_diam_R_px) {
    const iMean = (metrics.iris_diam_L_px + metrics.iris_diam_R_px) / 2;
    const iRel = Math.abs(metrics.iris_diam_L_px - metrics.iris_diam_R_px) / (iMean || 1);
    if (iRel > 0.15) scaleNotes.push(`iris L/R disagree ${(iRel * 100).toFixed(0)}% — mm scale suspect`);
  }
  if (metrics.scale_source === 'iris' && Math.abs(metrics.yaw_proxy_deg) > 15)
    scaleNotes.push(`yaw ${Math.abs(metrics.yaw_proxy_deg).toFixed(0)}° foreshortens far iris — mm values carry extra error`);
  const quality = analyzeQuality(img, lm);
  // composite measurement confidence: pose quality × image quality
  const qScore = quality.verdict === 'pass' ? 100 : quality.verdict === 'warn' ? 65 : 25;
  const confidence = Math.round(0.55 * metrics.frontality + 0.45 * qScore);
  const item = {
    id: 't' + (++seq), name: file.name || ('upload ' + seq),
    url, thumb: makeThumb(img), img, w, h, lm,
    metrics, ci, confidence,
    quality: metrics.frontality >= 85 ? 'high' : metrics.frontality >= 60 ? 'medium' : 'low',
    anchors: tel.anchors, scaleNotes,
    qv: quality, scaleSource: v2src,
  };
  state.items.push(item);
  return item;
}

async function handleFiles(files) {
  const picked = [...files];
  // some sources (iOS Files app, share sheets) hand over files with an empty
  // MIME type — fall back to the extension so they aren't silently dropped
  const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;
  const isImg = (f) => (f.type && f.type.startsWith('image/')) || IMG_EXT.test(f.name || '');
  const list = picked.filter(isImg);
  const skipped = picked.length - list.length;
  if (!list.length) {
    setStatus(picked.length ? `nothing analyzable — ${skipped} file(s) skipped (not images)` : 'no files selected', true);
    fileInput.value = '';
    return;
  }
  // never report "no face detected" when the real problem is the model
  const lm = await ensureLandmarker((t) => setStatus(t, false));
  if (!lm) {
    setStatus('measurement unavailable — landmark model failed to load', true);
    fileInput.value = '';
    return;
  }
  setStatus('analyzing…', false);
  let ok = 0; const errs = {};
  for (const f of list) {
    try { await analyzeFile(f); ok++; }
    catch (e) { errs[e.message] = (errs[e.message] || 0) + 1; console.warn(f.name, e.message); }
  }
  fileInput.value = ''; // allow re-picking the same file
  const last = state.items[state.items.length - 1];
  if (last) state.activeId = last.id;
  renderHistory(); renderViewer(); renderMetrics(); renderCompare();
  exportCard.hidden = !state.items.length;
  const errTxt = Object.entries(errs).map(([m, n]) => `${n} failed (${m})`).join(' · ');
  setStatus(ok + ' analyzed' + (errTxt ? ' · ' + errTxt : '') +
    (skipped ? ` · ${skipped} skipped (not images)` : ''), true);
}

// ---- history strip ----
function renderHistory() {
  historyEl.innerHTML = '';
  for (const it of state.items) {
    const d = document.createElement('div');
    d.className = 'hist-item' + (it.id === state.activeId ? ' active' : '');
    d.innerHTML = `<img src="${it.thumb}" alt=""><span class="q ${it.qv.verdict}" title="image quality: ${it.qv.verdict} · frontality ${it.metrics.frontality.toFixed(0)}">c${it.confidence}</span><div class="nm">${it.name}</div>`;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'cmp'; cb.title = 'select for a/b compare';
    cb.checked = state.compare.includes(it.id);
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleCompare(it.id));
    d.prepend(cb);
    d.addEventListener('click', () => { state.activeId = it.id; renderHistory(); renderViewer(); renderMetrics(); });
    historyEl.appendChild(d);
  }
}

function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else { state.compare.push(id); if (state.compare.length > 2) state.compare.shift(); }
  renderHistory(); renderCompare();
}

function activeItem() { return state.items.find(i => i.id === state.activeId) || null; }

// ---- telestrator overlay ----
function seg(a, b, color, label) {
  octx.strokeStyle = color; octx.lineWidth = 2;
  octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
  for (const p of [a, b]) { octx.fillStyle = color; octx.beginPath(); octx.arc(p.x, p.y, 4, 0, 7); octx.fill(); }
  if (label) {
    octx.font = '11px ui-monospace, monospace'; octx.fillStyle = color;
    octx.fillText(label, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6);
  }
}

function renderViewer() {
  const it = activeItem();
  viewerCard.hidden = !it;
  if (!it) return;
  $('viewTitle').textContent = it.name;
  const scale = Math.min(1, 1100 / it.w);
  overlay.width = Math.round(it.w * scale);
  overlay.height = Math.round(it.h * scale);
  octx.drawImage(it.img, 0, 0, overlay.width, overlay.height);
  const X = (p) => ({ x: p.x * overlay.width, y: p.y * overlay.height });
  const I = LANDMARK_IDX, lm = it.lm, A = it.anchors;

  if ($('layerMesh').checked) {
    octx.fillStyle = 'rgba(45,212,191,.5)';
    for (const p of lm) octx.fillRect(p.x * overlay.width - 1, p.y * overlay.height - 1, 2, 2);
  }
  if ($('layerMetrics').checked) {
    seg(X(lm[I.cheek_L]), X(lm[I.cheek_R]), '#d8b4fe', 'cheek');
    seg(X(lm[I.jaw_L]), X(lm[I.jaw_R]), '#86efac', 'jaw');
    seg(X(A.eyeCL), X(A.eyeCR), '#7dd3fc', 'IPD');
    seg(X(lm[I.eye_outer_L]), X(lm[I.eye_inner_L]), '#7dd3fc');
    seg(X(lm[I.eye_inner_R]), X(lm[I.eye_outer_R]), '#7dd3fc');
    seg(X(lm[I.mouth_L]), X(lm[I.mouth_R]), '#fca5a5', 'mouth');
    seg(X(lm[I.nostril_L]), X(lm[I.nostril_R]), '#fcd34d', 'nose');
    seg(X(lm[I.lip_top]), X(lm[I.lip_bot]), '#fca5a5', 'lip');
    // contour rings (visual check of ring indices)
    octx.lineWidth = 1.5;
    for (const [ring, color] of [[EYE_RING_L, '#7dd3fc'], [EYE_RING_R, '#7dd3fc'], [LIP_RING, '#fca5a5']]) {
      octx.strokeStyle = color; octx.beginPath();
      ring.forEach((idx, j) => {
        const p = X(lm[idx]);
        j ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y);
      });
      octx.closePath(); octx.stroke();
    }
  }
  if ($('layerThirds').checked) {
    // dividers run perpendicular to the facial midline: rotate each by the
    // head roll around its own anchor, so tilted heads get anatomical thirds
    // instead of horizontal slices (the old horizontal lines mis-cut on roll).
    const rollRad = it.metrics.roll_deg * Math.PI / 180;
    const dx = Math.cos(rollRad), dy = Math.sin(rollRad);
    const halfSpan = Math.abs(X(lm[I.cheek_R]).x - X(lm[I.cheek_L]).x) / 2 + 20;
    const rows = [
      [X(lm[I.forehead]), '#f472b6', `U ${it.metrics.third_upper_pct.toFixed(1)}%`],
      [X(A.glabella), '#f472b6', ''],
      [X(A.subnasale), '#f472b6', `M ${it.metrics.third_mid_pct.toFixed(1)}%`],
      [X(lm[I.chin]), '#f472b6', `L ${it.metrics.third_lower_pct.toFixed(1)}%`],
    ];
    octx.font = '11px ui-monospace, monospace';
    for (const [a, c, lab] of rows) {
      octx.strokeStyle = c; octx.lineWidth = 1.5; octx.setLineDash([6, 4]);
      octx.beginPath();
      octx.moveTo(a.x - dx * halfSpan, a.y - dy * halfSpan);
      octx.lineTo(a.x + dx * halfSpan, a.y + dy * halfSpan);
      octx.stroke();
      octx.setLineDash([]);
      if (lab) { octx.fillStyle = c; octx.fillText(lab, a.x + dx * halfSpan + 6, a.y + dy * halfSpan + 4); }
    }
  }

  // ---- technical overlay suite (visual only — no metric changes) ----
  const rollR = it.metrics.roll_deg * Math.PI / 180;
  const rdx = Math.cos(rollR), rdy = Math.sin(rollR); // facial horizontal (eye axis)
  octx.font = '10px ui-monospace, monospace';

  if ($('layerMidline').checked) {
    const f = X(lm[I.forehead]), c = X(lm[I.chin]);
    const ex = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const a = ex(f, c, -0.3), b = ex(f, c, 1.3);
    octx.strokeStyle = 'rgba(45,212,191,.55)'; octx.lineWidth = 1; octx.setLineDash([4, 4]);
    octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
    octx.setLineDash([]);
    octx.fillStyle = 'rgba(45,212,191,.85)';
    octx.fillText('MIDLINE', b.x + 6, b.y + 3);
  }

  if ($('layerFifths').checked) {
    const cL = X(lm[I.cheek_L]), cR = X(lm[I.cheek_R]);
    const f = X(lm[I.forehead]), ch = X(lm[I.chin]);
    const vlen = Math.hypot(ch.x - f.x, ch.y - f.y) * 0.7;
    octx.strokeStyle = 'rgba(196,141,255,.4)'; octx.lineWidth = 1; octx.setLineDash([3, 5]);
    octx.beginPath();
    for (let k = 1; k < 5; k++) {
      const px = cL.x + (cR.x - cL.x) * k / 5, py = cL.y + (cR.y - cL.y) * k / 5;
      octx.moveTo(px + rdy * vlen, py - rdx * vlen);
      octx.lineTo(px - rdy * vlen, py + rdx * vlen);
    }
    octx.stroke();
    octx.setLineDash([]);
    octx.fillStyle = 'rgba(196,141,255,.75)';
    const top5 = { x: cL.x + (cR.x - cL.x) / 5, y: cL.y + (cR.y - cL.y) / 5 };
    octx.fillText('FIFTHS', top5.x + rdy * vlen + 4, top5.y - rdx * vlen);
  }

  if ($('layerIris').checked && it.metrics.iris_diam_px) {
    const s = overlay.width / it.w;
    const r = Math.max(3, it.metrics.iris_diam_px * s / 2);
    octx.strokeStyle = 'rgba(125,211,252,.9)'; octx.lineWidth = 1.5;
    for (const idx of [IRIS.center_L, IRIS.center_R]) {
      const p = X(lm[idx]);
      octx.beginPath(); octx.arc(p.x, p.y, r, 0, 7); octx.stroke();
      octx.beginPath();
      octx.moveTo(p.x - r - 6, p.y); octx.lineTo(p.x - r + 4, p.y);
      octx.moveTo(p.x + r - 4, p.y); octx.lineTo(p.x + r + 6, p.y);
      octx.moveTo(p.x, p.y - r - 6); octx.lineTo(p.x, p.y - r + 4);
      octx.moveTo(p.x, p.y + r - 4); octx.lineTo(p.x, p.y + r + 6);
      octx.stroke();
    }
    octx.fillStyle = 'rgba(125,211,252,.9)';
    const pc = X(lm[IRIS.center_R]);
    octx.fillText(`IRIS Ø${it.metrics.iris_diam_px.toFixed(0)}px`, pc.x + r + 8, pc.y - r - 6);
  }

  if ($('layerDims').checked) {
    const a = X(A.eyeCL), b = X(A.eyeCR);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = -Math.sin(ang), ny = Math.cos(ang), off = 30;
    const a2 = { x: a.x + nx * off, y: a.y + ny * off }, b2 = { x: b.x + nx * off, y: b.y + ny * off };
    octx.strokeStyle = 'rgba(252,211,77,.9)'; octx.lineWidth = 1.5;
    octx.beginPath();
    octx.moveTo(a.x + nx * 8, a.y + ny * 8); octx.lineTo(a2.x + nx * 8, a2.y + ny * 8);
    octx.moveTo(b.x + nx * 8, b.y + ny * 8); octx.lineTo(b2.x + nx * 8, b2.y + ny * 8);
    octx.moveTo(a2.x, a2.y); octx.lineTo(b2.x, b2.y);
    for (const p of [a2, b2]) {
      octx.moveTo(p.x - nx * 5 - Math.cos(ang) * 5, p.y - ny * 5 - Math.sin(ang) * 5);
      octx.lineTo(p.x + nx * 5 + Math.cos(ang) * 5, p.y + ny * 5 + Math.sin(ang) * 5);
    }
    octx.stroke();
    octx.fillStyle = 'rgba(252,211,77,.95)';
    const ipdTxt = it.metrics.ipd_mm ? `IPD ${it.metrics.ipd_mm.toFixed(1)}mm` : `IPD ${it.metrics.ipd_px.toFixed(0)}px`;
    octx.fillText(ipdTxt, (a2.x + b2.x) / 2 + 10, (a2.y + b2.y) / 2 - 6);
    const tiltArc = (innerLm, outerLm, tiltDeg) => {
      const o = X(outerLm), inn = X(innerLm);
      const s = Math.sign(o.x - inn.x) || 1; // outward, away from the nose
      const aRef = Math.atan2(s * rdy, s * rdx);
      const aAct = Math.atan2(inn.y - o.y, inn.x - o.x);
      let d = aAct - aRef;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      octx.strokeStyle = 'rgba(248,113,113,.9)'; octx.lineWidth = 1.5;
      octx.beginPath(); octx.arc(o.x, o.y, 17, aRef, aRef + d, d < 0); octx.stroke();
      octx.setLineDash([2, 3]);
      octx.beginPath();
      octx.moveTo(o.x, o.y); octx.lineTo(o.x + Math.cos(aRef) * 28, o.y + Math.sin(aRef) * 28);
      octx.stroke(); octx.setLineDash([]);
      octx.fillStyle = 'rgba(248,113,113,.9)';
      octx.fillText(tiltDeg.toFixed(1) + '°', o.x + Math.cos(aRef) * 32 - 10, o.y + Math.sin(aRef) * 32 + 3);
    };
    tiltArc(lm[I.eye_inner_L], lm[I.eye_outer_L], it.metrics.canthal_tilt_L);
    tiltArc(lm[I.eye_inner_R], lm[I.eye_outer_R], it.metrics.canthal_tilt_R);
  }

  if ($('layerGrid').checked) {
    const W = overlay.width, H = overlay.height, cx = W / 2, cy = H / 2;
    const step = 36, diag = Math.hypot(W, H);
    octx.strokeStyle = 'rgba(148,163,184,.12)'; octx.lineWidth = 1;
    octx.beginPath();
    for (let t = -diag; t <= diag; t += step) {
      octx.moveTo(cx - rdy * t - rdx * diag, cy + rdx * t - rdy * diag);
      octx.lineTo(cx - rdy * t + rdx * diag, cy + rdx * t + rdy * diag);
      octx.moveTo(cx + rdx * t + rdy * diag, cy + rdy * t - rdx * diag);
      octx.lineTo(cx + rdx * t - rdy * diag, cy + rdy * t + rdx * diag);
    }
    octx.stroke();
  }

  // ---- HUD frame: corner brackets + data block (always on) ----
  {
    const W = overlay.width, H = overlay.height, B = 16, L = 42;
    octx.strokeStyle = 'rgba(45,212,191,.8)'; octx.lineWidth = 2;
    octx.beginPath();
    for (const [cx, cy, sx, sy] of [[B, B, 1, 1], [W - B, B, -1, 1], [B, H - B, 1, -1], [W - B, H - B, -1, -1]]) {
      octx.moveTo(cx + sx * L, cy); octx.lineTo(cx, cy); octx.lineTo(cx, cy + sy * L);
    }
    octx.stroke();
    octx.fillStyle = 'rgba(45,212,191,.9)';
    const hud = [
      `FACELANDMARKER-${it.lm.length} · ${it.w}×${it.h}px · ${it.name.slice(0, 26)}`,
      `FRONT ${it.metrics.frontality.toFixed(0)} · ROLL ${it.metrics.roll_deg.toFixed(1)}° · YAW≈${it.metrics.yaw_proxy_deg.toFixed(1)}°`,
      `CONF ${it.confidence}/100 · ${it.qv.verdict.toUpperCase()} · ${it.scaleSource}${it.metrics.mm_per_px ? ' ' + it.metrics.mm_per_px.toFixed(4) + 'mm/px' : ''}`,
    ];
    hud.forEach((t, i) => octx.fillText(t, B + 10, B + 18 + i * 13));
  }

  const q = $('qualityBox');
  const qv = it.qv;
  q.innerHTML = `image quality <b class="${qv.verdict}">${qv.verdict}</b>` +
    ` &nbsp; sharp ${qv.sharpness.toFixed(0)} &nbsp; expos ${qv.exposure.toFixed(0)}` +
    ` &nbsp; clip ${qv.clipping_pct.toFixed(1)}% &nbsp; iid ${qv.iid_px.toFixed(0)}px` +
    ` &nbsp; light-bal ${qv.illum_balance.toFixed(2)}` +
    (qv.notes.length ? `<br>notes: ${qv.notes.join(' · ')}` : '') +
    `<br>scale: ${it.scaleSource}${it.metrics.mm_per_px ? ` (${it.metrics.mm_per_px.toFixed(4)} mm/px)` : ' — mm values unavailable'}` +
    (it.scaleNotes && it.scaleNotes.length ? `<br><span class="low">scale notes: ${it.scaleNotes.join(' · ')}</span>` : '') +
    `<br>frontality <b class="${it.quality}">${it.metrics.frontality.toFixed(0)} · ${it.quality}</b>` +
    ` &nbsp; roll ${it.metrics.roll_deg.toFixed(1)}° &nbsp; yaw≈ ${it.metrics.yaw_proxy_deg.toFixed(1)}°` +
    ` &nbsp; asym(9) ${it.metrics.asymmetry_9.toFixed(3)}` +
    `<br>measurement confidence <b>${it.confidence}</b>/100 <span class="conf" style="font-size:12px;color:var(--dim)">(pose 55% · image quality 45% · CIs bootstrapped, n=32)</span>` +
    (it.quality === 'low' ? ` &nbsp; <b class="low">⚠ pose may distort ratios</b>` : '');
}

// ---- metric tables ----
function relBar(v, sd) {
  // visual encoding of relative 95% CI width; bar half-width ∝ 1.96·sd/|v|, capped
  if (sd == null || !isFinite(sd) || typeof v !== 'number' || !isFinite(v) || v === 0) return '';
  const half = Math.max(2, Math.min(30, (1.96 * sd / Math.abs(v)) * 160));
  return `<div class="cibar" title="relative 95% CI width"><div class="ciw" style="left:${(32 - half).toFixed(1)}px;width:${(half * 2).toFixed(1)}px"></div><div class="cic"></div></div>`;
}
function renderMetrics() {
  const it = activeItem();
  metricsCard.hidden = !it;
  if (!it) return;
  $('vecCount').textContent = `· ${METRIC_DEFS.length} metrics`;
  const host = $('metricGroups');
  host.innerHTML = '';
  for (const [gkey, gname] of GROUPS) {
    const defs = METRIC_DEFS.filter(d => d.group === gkey);
    const det = document.createElement('details');
    det.className = 'metric-group';
    det.open = gkey !== 'canons';
    const sum = document.createElement('summary');
    sum.innerHTML = `${gname} <span class="cnt">${defs.length}</span>`;
    det.appendChild(sum);
    const tbl = document.createElement('table');
    const hr = document.createElement('tr');
    hr.innerHTML = `<th>metric</th><th>value</th><th>±95%</th><th>rel σ</th><th></th>`;
    tbl.appendChild(hr);
    for (const d of defs) {
      const tr = document.createElement('tr');
      const sd = it.ci && it.ci[d.key] ? it.ci[d.key].sd : null;
      const ciTxt = d.noCI || sd == null ? '—' : '±' + d.fmt(1.96 * sd);
      tr.innerHTML = `<td class="k">${d.label}${d.game ? '<span class="gametag">game</span>' : ''}</td>` +
        `<td class="v">${d.fmt(it.metrics[d.key])}</td><td class="ci">${ciTxt}</td><td class="bar">${relBar(it.metrics[d.key], sd)}</td><td class="n">${d.hint || ''}</td>`;
      tbl.appendChild(tr);
    }
    det.appendChild(tbl);
    host.appendChild(det);
  }
}

// ---- a/b compare ----
function renderCompare() {
  const [aId, bId] = state.compare;
  const a = state.items.find(i => i.id === aId), b = state.items.find(i => i.id === bId);
  compareCard.hidden = !(a && b);
  if (!(a && b)) return;
  $('colA').textContent = 'a · ' + a.name;
  $('colB').textContent = 'b · ' + b.name;
  $('compareNames').textContent = `Δ = b − a, with bootstrap 95% CI. violet rows are statistically significant (|Δ| exceeds combined CI).`;
  const tb = $('deltaTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const d of METRIC_DEFS) {
    const va = a.metrics[d.key], vb = b.metrics[d.key];
    const tr = document.createElement('tr');
    if (typeof va !== 'number' || typeof vb !== 'number' || !isFinite(va) || !isFinite(vb)) {
      tr.innerHTML = `<td>${d.label}</td><td>${d.fmt(va)}</td><td>${d.fmt(vb)}</td><td class="dv">—</td><td class="dv">—</td>`;
      tb.appendChild(tr);
      continue;
    }
    const dv = vb - va, pct = va !== 0 ? dv / Math.abs(va) * 100 : 0;
    const sdA = a.ci && a.ci[d.key] ? a.ci[d.key].sd : null;
    const sdB = b.ci && b.ci[d.key] ? b.ci[d.key].sd : null;
    const se = (sdA != null && sdB != null) ? Math.sqrt((1.96 * sdA) ** 2 + (1.96 * sdB) ** 2) : null;
    const sig = se != null && Math.abs(dv) > se;
    if (sig) tr.className = 'hot';
    const dvTxt = `${dv >= 0 ? '+' : '-'}${d.fmt(Math.abs(dv))}${se != null ? ' ± ' + d.fmt(se) : ''}`;
    const bw = Math.min(60, Math.abs(pct) / 25 * 60); // ±25% fills the bar
    const dbar = `<span class="dbar ${pct >= 0 ? 'pos' : 'neg'}"><i style="width:${bw.toFixed(1)}px"></i></span>`;
    tr.innerHTML = `<td>${d.label}</td><td>${d.fmt(va)}</td><td>${d.fmt(vb)}</td>` +
      `<td class="dv">${dvTxt}</td>` +
      `<td class="dv">${dbar}${dv >= 0 ? '+' : ''}${pct.toFixed(1)}%</td>`;
    tb.appendChild(tr);
  }
}

// ---- export ----
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportPayload() {
  return {
    generated: new Date().toISOString(),
    tool: 'telemetry lab v3 · MediaPipe FaceLandmarker (same detector as the game) · bootstrap CI n=32',
    images: state.items.map(it => ({
      name: it.name, quality: it.quality, confidence: it.confidence,
      scale_notes: it.scaleNotes || [],
      metrics: it.metrics,
      ci95: Object.fromEntries(Object.entries(it.ci || {}).map(([k, v]) => [k, v.sd == null ? null : Math.round(v.sd * 1.96 * 1e6) / 1e6])),
    })),
  };
}

$('btnJson').addEventListener('click', () => {
  download('telemetry.json', JSON.stringify(exportPayload(), null, 2), 'application/json');
});
$('btnCsv').addEventListener('click', () => {
  const rows = [['image', 'quality', 'confidence', 'metric', 'label', 'group', 'value', 'ci95_halfwidth']];
  for (const it of state.items)
    for (const d of METRIC_DEFS) {
      const sd = it.ci && it.ci[d.key] ? it.ci[d.key].sd : null;
      rows.push([it.name, it.quality, String(it.confidence), d.key, d.label, d.group,
        String(it.metrics[d.key]), sd == null ? '' : String(Math.round(sd * 1.96 * 1e6) / 1e6)]);
    }
  download('telemetry.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
});
$('btnCopy').addEventListener('click', async () => {
  const it = activeItem();
  if (!it) return;
  const lines = [`telemetry · ${it.name} · confidence ${it.confidence}/100 · frontality ${it.metrics.frontality.toFixed(0)} (${it.quality})`];
  for (const [gkey, gname] of GROUPS) {
    lines.push(`[${gname}]`);
    for (const d of METRIC_DEFS.filter(x => x.group === gkey))
      lines.push(`  ${d.label}: ${d.fmt(it.metrics[d.key])}`);
  }
  try { await navigator.clipboard.writeText(lines.join('\n')); setStatus('summary copied', true); }
  catch (e) { setStatus('copy blocked by browser', true); }
});

// ---- method documentation ----
function renderMethod() {
  const I = LANDMARK_IDX;
  const gameIdx = Object.entries(I).map(([k, v]) => `<tr><td>${v}</td><td>${k}</td></tr>`).join('');
  const extraIdx = [
    ['70 / 300', 'brow outer L / R'], ['63, 105, 66 / 293, 334, 296', 'brow mid L / R'],
    ['107 / 336', 'brow inner L / R → glabella = midpoint'], ['168', 'nasion (bridge top)'],
    ['2', 'subnasale (nose base)'], ['13 / 14', 'inner mouth top / bottom'],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  const formulas = METRIC_DEFS.map(d =>
    `<tr><td>${d.label}</td><td>${d.hint || (d.game ? 'same definition as the game' : '—')}</td></tr>`).join('');
  $('methodBody').innerHTML = `
    <h3>detector</h3>
    <p>MediaPipe Tasks Vision FaceLandmarker (468 landmarks, IMAGE mode, GPU→CPU fallback) —
    the identical model, weights, and running mode the game uses. Landmarks are subpixel floats;
    ratios are computed in normalized image space, px values in image pixels. Angles in degrees.</p>
    <h3>pose &amp; quality</h3>
    <p>roll = eye-axis angle vs horizontal. yaw = proxy from cheek↔nose-tip foreshortening
    (approximate — true yaw needs a 3D head model). frontality = 100 − (|roll|·5 + |yaw|·4 + asym₉·150),
    clamped 0–100. high ≥ 85 · medium ≥ 60 · low &lt; 60 (flagged: pose may distort ratios).
    Canthal tilt is reported in the face frame (image-frame tilt + roll), so head roll can't
    contaminate it; |L−R| remains the landmark-noise indicator. Telestrator thirds dividers are
    drawn perpendicular to the facial midline (roll-rotated), not horizontal.</p>
    <h3>game landmark indices (shared)</h3>
    <table>${gameIdx}</table>
    <h3>lab-only landmark indices</h3>
    <table>${extraIdx}</table>
    <h3>v2 — image quality (refusal gates)</h3>
    <p>sharpness = Laplacian variance on a 256px-wide grayscale copy (fail &lt; 60, warn &lt; 120).
    exposure = mean luma inside the landmark bbox (warn outside 50–205);
    clipping = % of bbox pixels near black/white (fail &gt; 25%, warn &gt; 10%).
    face size = interpupillary px (fail &lt; 40, warn &lt; 90).
    illumination balance = |left-half − right-half| ÷ mean (warn &gt; 0.25, harsh side light).
    verdict <b>fail</b> means the instrument will not stand behind the numbers.</p>
    <h3>v2 — physical scale</h3>
    <p>iris diameter = mean of horizontal/vertical axes across both irises
    (landmarks 469↔471, 470↔472, 474↔476, 475↔477; centers 468/473).
    mm/px = 11.7 ÷ iris px. Human iris ≈ 11.7mm ±5% biological variation, so mm
    values are estimates. Entering a known IPD overrides the anchor (scale source
    shows iris | calibrated | none). If the detector returns only 468 points, mm
    values are unavailable. Per-eye iris diameters are reported; L/R disagreement
    &gt;15% or |yaw| &gt;15° flags the mm scale as suspect in the quality box and export.</p>
    <h3>v2 — contour areas</h3>
    <p>shoelace area of full landmark rings: eye fissure 16-pt rings
    (L: 33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246;
    R: 362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398),
    lip vermilion 20-pt ring
    (61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185).
    Rings are drawn on the overlay — verify them visually.</p>
    <h3>v3 — bootstrap confidence intervals</h3>
    <p>Every metric ships with a 95% confidence interval. Procedure: all 468/478 landmarks
    are jittered with Gaussian noise (σ = 0.0005 in normalized image coords ≈ subpixel
    detector noise on a ~1000px face), the <b>entire</b> metric vector is recomputed, and
    this is repeated 32 times. The reported ± is 1.96 × the bootstrap standard deviation
    per metric. This captures <i>detector/landmark noise only</i> — not pose distortion,
    expression, or lens effects. In the a/b table, a row is violet (significant) when
    |Δ| exceeds the combined 95% CI, i.e. |Δ| &gt; √((1.96σ<sub>a</sub>)² + (1.96σ<sub>b</sub>)²) —
    replacing the old &gt;5% heuristic.</p>
    <h3>v3 — asymmetry decomposition &amp; fine detail</h3>
    <p>asymmetry is now decomposed by facial region (upper: brows+eyes 5 pairs; mid: nostrils+cheeks;
    lower: mouth+jaw) so a single number can't hide a lopsided jaw behind symmetric eyes.
    New: per-side brow–eye distance, brow arc length (polyline ÷ eye width), scleral show
    (iris-center height within the fissure, 0.5 = centered; needs 478-pt refined landmarks),
    nose-tip deviation from midline, lip-corner vertical asymmetry.</p>
    <h3>v3 — measurement confidence &amp; canon correction</h3>
    <p>Each image gets a 0–100 measurement confidence = 0.55 × frontality + 0.45 × image-quality
    score (pass 100 / warn 65 / fail 25), shown as the badge on each history thumbnail.
    Correction 2026-09-11: <b>canon_spacing was wrong.</b> The classical canon is
    intercanthal gap ≈ one eye width, which makes IPD ≈ <b>two</b> eye widths — the lab
    had been scoring deviation from 1.0. It now scores |ratio−2| ÷ 2. Historical exports
    using the old formula will read ~2× too deviant on this canon.</p>
    <h3>browser vs offline</h3>
    <p>This page implements everything above. True 3D head pose (solvePnP,
    yaw/pitch/roll + reprojection error) needs OpenCV and lives in the offline
    pipeline (<span style="color:var(--txt)">facial-preference-runs/telemetry_v2.py</span>);
    the page keeps the 2D roll/yaw proxies and the frontality score instead.</p>
    <h3>every metric</h3>
    <table>${formulas}</table>
    <p>◆ = also computed inside the game with the identical definition. canon deviations are
    descriptive distances from neoclassical ideals, not beauty scores.</p>`;
}

// ---- init ----
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault(); dropzone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
for (const id of ['layerMesh', 'layerMetrics', 'layerThirds', 'layerMidline', 'layerFifths', 'layerIris', 'layerDims', 'layerGrid'])
  $(id).addEventListener('change', renderViewer);

renderMethod();
ensureLandmarker((t) => setStatus(t, t === 'landmarks ready')).then(() => setStatus('landmarks ready — drop a portrait', true));
