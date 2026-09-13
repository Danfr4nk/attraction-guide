// ESM loader for the drift harness.
// 1. Stubs '@mediapipe/tasks-vision' (import must resolve in node; the detector
//    is never called — the harness feeds recorded landmarks straight into the
//    metric math).
// 2. Injects a synthetic-landmark path into measure.js so measureImage() can
//    run headless on a fake img ({__landmarks, naturalWidth, naturalHeight}).
//    Handles BOTH the current variant (detectFace) and the 2026-09-11 variant
//    (detectLandmarks).

const MEDIAPIPE_STUB = new URL('./stubs/mediapipe.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@mediapipe/tasks-vision')
    return { url: MEDIAPIPE_STUB, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  const res = await next(url, context);
  if (url.endsWith('/js/measure.js') && res.source) {
    let src = res.source.toString();
    let patched = 0;
    // never attempt the model download headless: pretend landmarks are ready.
    // (the harness feeds recorded landmarks; the detector is out of scope)
    const ENS_RE = /export async function ensureLandmarker\(onStatus\) \{[\s\S]*?\n\}\n\nexport function measurementReady\(\)/;
    if (ENS_RE.test(src)) {
      src = src.replace(ENS_RE,
        `export async function ensureLandmarker(onStatus) { ready = true; onStatus && onStatus('landmarks ready'); return {}; }\n\nexport function measurementReady()`);
      patched++;
    }
    // current variant: detectFace returns {landmarks, matrix}
    if (src.includes('export function detectFace(img) {\n  if (!landmarker) return null;')) {
      src = src.replace(
        'export function detectFace(img) {\n  if (!landmarker) return null;',
        'export function detectFace(img) {\n' +
        '  if (img && img.__landmarks) return { landmarks: img.__landmarks, matrix: img.__matrix || null };\n' +
        '  if (!landmarker) return null;'
      );
      patched++;
    }
    // 2026-09-11 variant: detectLandmarks returns the raw array
    if (src.includes('export function detectLandmarks(img) {\n  if (!landmarker) return null;')) {
      src = src.replace(
        'export function detectLandmarks(img) {\n  if (!landmarker) return null;',
        'export function detectLandmarks(img) {\n' +
        '  if (img && img.__landmarks) return img.__landmarks;\n' +
        '  if (!landmarker) return null;'
      );
      patched++;
    }
    if (!patched) throw new Error('measure.js landmark injection failed for ' + url);
    return { format: res.format, source: src, shortCircuit: true };
  }
  return res;
}
