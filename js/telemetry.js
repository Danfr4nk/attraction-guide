// telemetry lab — standalone precision facial measurement.
// Uses the SAME detector + landmark indices as the game (js/measure.js),
// but lives outside the game flow: upload → full telemetry vector → overlay.
import { ensureLandmarker, detectLandmarks, LANDMARK_IDX } from './measure.js';
import { analyzeQuality, computeV2, V2_METRIC_DEFS, V2_GROUPS, EYE_RING_L, EYE_RING_R, LIP_RING } from './telemetry2.js';
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
  { key: 'eye_spacing_widths', group: 'eyes', label: 'spacing (eye-widths)', fmt: f3, hint: 'IPD ÷ eye width · canon 1.0' },
  { key: 'eye_w_to_h', group: 'eyes', label: 'eye width : height', fmt: f3, game: true },
  { key: 'canthal_tilt_mean', group: 'eyes', label: 'canthal tilt', fmt: deg, hint: '+ = outer corner higher' },
  { key: 'canthal_tilt_L', group: 'eyes', label: 'canthal tilt L', fmt: deg },
  { key: 'canthal_tilt_R', group: 'eyes', label: 'canthal tilt R', fmt: deg },
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
  { key: 'canon_spacing', group: 'canons', label: 'IPD = 1 eye width', fmt: pct1, hint: '|ratio−1| × 100' },
];

// v2 additions ship in telemetry2.js — merged here after both arrays exist
METRIC_DEFS.push(...V2_METRIC_DEFS);
GROUPS.push(...V2_GROUPS);

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
  // corner. Uses |dx| so both eyes share one convention (+ = outer higher).
  const tilt = (inner, outer) => Math.atan2(-(outer.y - inner.y), Math.abs(outer.x - inner.x)) * 180 / Math.PI;
  const tiltL = tilt(P.eye_inner_L, P.eye_outer_L), tiltR = tilt(P.eye_inner_R, P.eye_outer_R);

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
  const roll = Math.atan2(eyeCR.y - eyeCL.y, eyeCR.x - eyeCL.x) * 180 / Math.PI;
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
    canon_spacing: r3(Math.abs(spacing - 1) * 100),
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
  const tel = computeTelemetry(lm, w, h);
  const calibRaw = parseFloat(($('calibIpd') || {}).value);
  const calib = Number.isFinite(calibRaw) && calibRaw > 0 ? calibRaw : null;
  const v2 = computeV2(lm, w, h, calib);
  const quality = analyzeQuality(img, lm);
  const item = {
    id: 't' + (++seq), name: file.name || ('upload ' + seq),
    url, thumb: makeThumb(img), img, w, h, lm,
    metrics: { ...tel.metrics, ...v2 }, quality: tel.quality, anchors: tel.anchors,
    qv: quality, scaleSource: v2.scale_source,
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
    d.innerHTML = `<img src="${it.thumb}" alt=""><span class="q ${it.qv.verdict}">${it.qv.verdict}</span><div class="nm">${it.name}</div>`;
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
    const x0 = X(lm[I.cheek_L]).x, x1 = X(lm[I.cheek_R]).x;
    const rows = [
      [X(lm[I.forehead]).y, '#f472b6', `U ${it.metrics.third_upper_pct.toFixed(1)}%`],
      [X(A.glabella).y, '#f472b6', ''],
      [X(A.subnasale).y, '#f472b6', `M ${it.metrics.third_mid_pct.toFixed(1)}%`],
      [X(lm[I.chin]).y, '#f472b6', `L ${it.metrics.third_lower_pct.toFixed(1)}%`],
    ];
    octx.font = '11px ui-monospace, monospace';
    for (const [y, c, lab] of rows) {
      octx.strokeStyle = c; octx.lineWidth = 1.5; octx.setLineDash([6, 4]);
      octx.beginPath(); octx.moveTo(x0 - 20, y); octx.lineTo(x1 + 20, y); octx.stroke();
      octx.setLineDash([]);
      if (lab) { octx.fillStyle = c; octx.fillText(lab, x1 + 26, y + 4); }
    }
  }

  const q = $('qualityBox');
  const qv = it.qv;
  q.innerHTML = `image quality <b class="${qv.verdict}">${qv.verdict}</b>` +
    ` &nbsp; sharp ${qv.sharpness.toFixed(0)} &nbsp; expos ${qv.exposure.toFixed(0)}` +
    ` &nbsp; clip ${qv.clipping_pct.toFixed(1)}% &nbsp; iid ${qv.iid_px.toFixed(0)}px` +
    ` &nbsp; light-bal ${qv.illum_balance.toFixed(2)}` +
    (qv.notes.length ? `<br>notes: ${qv.notes.join(' · ')}` : '') +
    `<br>scale: ${it.scaleSource}${it.metrics.mm_per_px ? ` (${it.metrics.mm_per_px.toFixed(4)} mm/px)` : ' — mm values unavailable'}` +
    `<br>frontality <b class="${it.quality}">${it.metrics.frontality.toFixed(0)} · ${it.quality}</b>` +
    ` &nbsp; roll ${it.metrics.roll_deg.toFixed(1)}° &nbsp; yaw≈ ${it.metrics.yaw_proxy_deg.toFixed(1)}°` +
    ` &nbsp; asym(9) ${it.metrics.asymmetry_9.toFixed(3)}` +
    (it.quality === 'low' ? ` &nbsp; <b class="low">⚠ pose may distort ratios</b>` : '');
}

// ---- metric tables ----
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
    for (const d of defs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="k">${d.label}${d.game ? '<span class="gametag">game</span>' : ''}</td>` +
        `<td class="v">${d.fmt(it.metrics[d.key])}</td><td class="n">${d.hint || ''}</td>`;
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
  $('compareNames').textContent = `Δ = b − a. rows in violet move more than 5%.`;
  const tb = $('deltaTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const d of METRIC_DEFS) {
    const va = a.metrics[d.key], vb = b.metrics[d.key];
    const dv = vb - va, pct = va !== 0 ? dv / Math.abs(va) * 100 : 0;
    const hot = Math.abs(pct) > 5;
    const tr = document.createElement('tr');
    if (hot) tr.className = 'hot';
    tr.innerHTML = `<td>${d.label}</td><td>${d.fmt(va)}</td><td>${d.fmt(vb)}</td>` +
      `<td class="dv">${dv >= 0 ? '+' : ''}${d.fmt(dv).replace(/ ?(px|°|%| pp)$/, '')}</td>` +
      `<td class="dv">${dv >= 0 ? '+' : ''}${pct.toFixed(1)}%</td>`;
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
    tool: 'telemetry lab v1.1 · MediaPipe FaceLandmarker (same detector as the game)',
    images: state.items.map(it => ({
      name: it.name, quality: it.quality, metrics: it.metrics,
    })),
  };
}

$('btnJson').addEventListener('click', () => {
  download('telemetry.json', JSON.stringify(exportPayload(), null, 2), 'application/json');
});
$('btnCsv').addEventListener('click', () => {
  const rows = [['image', 'quality', 'metric', 'label', 'group', 'value']];
  for (const it of state.items)
    for (const d of METRIC_DEFS)
      rows.push([it.name, it.quality, d.key, d.label, d.group, String(it.metrics[d.key])]);
  download('telemetry.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
});
$('btnCopy').addEventListener('click', async () => {
  const it = activeItem();
  if (!it) return;
  const lines = [`telemetry · ${it.name} · frontality ${it.metrics.frontality.toFixed(0)} (${it.quality})`];
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
    clamped 0–100. high ≥ 85 · medium ≥ 60 · low &lt; 60 (flagged: pose may distort ratios).</p>
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
    values are unavailable.</p>
    <h3>v2 — contour areas</h3>
    <p>shoelace area of full landmark rings: eye fissure 16-pt rings
    (L: 33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246;
    R: 362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398),
    lip vermilion 20-pt ring
    (61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185).
    Rings are drawn on the overlay — verify them visually.</p>
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
for (const id of ['layerMesh', 'layerMetrics', 'layerThirds'])
  $(id).addEventListener('change', renderViewer);

renderMethod();
ensureLandmarker((t) => setStatus(t, t === 'landmarks ready')).then(() => setStatus('landmarks ready — drop a portrait', true));
