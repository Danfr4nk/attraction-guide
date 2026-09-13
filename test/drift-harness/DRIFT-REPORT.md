# Telemetry Lab — JS drift audit (2026-09-13)

## Verdict

**One real bug found and fixed** (six `_px` metrics were double-scaled, reporting
~10⁶ px on the live lab). **All other drift is explained** by the three
intentional instrument changes (3D pose, roll-corrected tilt, pixel-space
geometry). **Zero unexplained drift.**

## Method

`test/drift-harness/run.js` (`node --import ./register.mjs run.js`) runs the
2026-09-11 lab code (snapshot at commit `ed6e4551c88e`, the last commit before
the Sep-12 instrument pass) and the current code on **identical recorded
landmark inputs** — one tasks-vision FaceLandmarker run (478 landmarks + 4×4
face matrix) per bank face, frozen in `landmarks.json`. The detector is not
part of the comparison; only the JS metric math.

Three comparisons per metric isolate *why* a number moved:

| id | comparison | isolates |
|----|-----------|----------|
| A | new (2D-proxy path) vs old @ real dims | total instrument drift |
| B | new (3D matrix) vs new (2D-proxy) @ real dims | 3D-pose wiring effect |
| C | new (2D-proxy) vs old @ square dims (w=h=1) | non-aspect changes |

155/155 bank faces measured, all with face matrices. z-drift = drift ÷ bank SD
of the current code's values. "Material" = max |z| > 0.05.

## Bug found: `_px` metrics double-scaled (FIXED)

The pixel-space refactor converted landmarks to pixels at the top of
`computeTelemetry`, but the six `_px` metrics still called `distPx()` — a
helper written for *normalized* points that multiplies by (w, h) again.
Result on the live lab: `face_width_px`, `face_height_px`, `ipd_px`,
`nose_w_px`, `nose_len_px`, `mouth_w_px` reported values ~w× too large
(mean drift vs 2026-09-11: **1,025,522 px** on face width; max 1,835,038 px).

Fix (`js/telemetry.js`): the six metrics now use `dist()` on the already-pixel
points; the dead `distPx` helper was removed. Post-fix drift vs 2026-09-11 on
all six: **exactly 0.000**. V2's `*_mm`/`iris_diam_*_px` metrics were inspected
and use single-scale `PX()` conversion — not affected.

## Explained drift

**3D pose wiring (B):** `roll_deg` B-max 4.39° (the 2D-proxy path itself is
stable: A-max 0.114°), `frontality` B-max 16.6 (proxy path A-max 0.6),
canthal-tilt B-max 4.39° (tilt correction now fed by 3D roll instead of the
proxy). Quality grade changes on 8/155 faces under 3D (5 up, 3 down) —
expected: frontality now uses true angles. `pitch_deg` is new (no baseline).

**Roll-corrected canthal tilt (C):** `canthal_tilt_L/R/mean` drift mean 1.16°,
max 2.23° — and C-max == A-max exactly, i.e. the *entire* 2D-path tilt drift is
the `+ roll` decontamination term. `yaw_proxy_deg`: zero drift (formula
unchanged). `asymmetry_9` / `mean_asymmetry`: zero drift (deliberately
untouched, per the standing rule).

**Pixel-space aspect fix (A only, C == 0.000 everywhere):** every other drifting
metric moves *only* on real (non-square) dims and is bit-identical on square
dims — it is the aspect correction, not a bug. Notable magnitudes, because
they show how distorted the old normalized math was on portrait images:

| metric | max \|drift\| | max \|z\| | worst face |
|---|---|---|---|
| width_height_ratio | 0.415 | 22.9 | p2-nose-wide |
| fwhr_proxy | 0.974 | 14.4 | p2-nose-wide |
| eye_w_to_h | 1.451 | 10.0 | p2-nose-wide |
| brow_arch_L/R/mean | 0.084 | 5.1 | p2-nose-wide |
| lip_fullness | 0.125 | 2.8 | p2-nose-wide |
| gonial_angle_L/R/mean | 3.2° | 2.2 | p2-nose-wide |
| brow_eye_dist_pct | 1.03 | 1.3 | p2-nose-wide |

The game path (`measureImage`) shows the same aspect-only pattern; its tilt
drift (max 1.88°) is pure aspect — the old game code already used the `|dx|`
tilt convention.

**New metrics with no 2026-09-11 baseline** (from the Sep-12 iris/mm pass and
the Sep-13 3D pass — listed, not compared): `pitch_deg`, `yaw_deg`,
`iris_diam_px/_L/_R`, `mm_per_px`, `scale_source`, all `*_mm`, `scleral_show_*`,
`eye_area_*`.

**V3:** zero drift on every metric (keys identical, all comparisons ~0).

## Not covered by this harness

- `analyzeQuality` (needs canvas pixel reads — browser-only).
- The `bootstrapCI` → `landmarkNoiseCI` rename and the 3D-interval suppression
  (statistical presentation, not metric values).
- Wilson/UI copy changes (no metric math involved).

## Provenance

- Baseline: repo files at `ed6e4551c88e` via the GitHub API, syntax-checked.
- Inputs: `landmarks.json`, dumped 2026-09-13 with mediapipe 1.0.1 tasks-vision
  FaceLandmarker (float16 bundle), `output_facial_transformation_matrixes=True`.
  Headless note: the mediapipe native lib dlopens `libEGL.so.1`/`libGLESv2.so.2`;
  on this box they were satisfied with generated stub shared objects exporting
  its 120 undefined GL/EGL symbols (CPU inference never calls them) —
  `/tmp/fakegl/`, `LD_LIBRARY_PATH=/tmp/fakegl`.
- Fix + harness committed as described in the deploy message; live page
  verified after push.
