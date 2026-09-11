// ESM loader: stubs the MediaPipe model download + landmark detection so the
// game runs headless on synthetic landmarks (img.__landmarks). Real measureImage
// math is untouched — only the data source is faked.


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
    // stub the model download: pretend landmarks are ready
    src = src.replace(
      /export async function ensureLandmarker\(onStatus\) \{[\s\S]*?\n\}\n\nexport function measurementReady\(\)/,
      `export async function ensureLandmarker(onStatus) { ready = true; onStatus && onStatus('landmarks ready'); return {}; }\n\nexport function measurementReady()`
    );
    // synthetic landmark injection point
    src = src.replace(
      'export function detectLandmarks(img) {\n  if (!landmarker) return null;',
      'export function detectLandmarks(img) {\n  if (img && img.__landmarks) return img.__landmarks;\n  if (!landmarker) return null;'
    );
    if (!src.includes('__landmarks') || !src.includes("return {}; }"))
      throw new Error('measure.js stub injection failed');
    return { format: res.format, source: src, shortCircuit: true };
  }
  return res;
}
