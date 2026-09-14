# drift-harness

Headless drift audit for the Telemetry Lab's JS metric math.

## Run order (one command each, from this dir)

```bash
python3 roundness-proof-py.py        # 1. Python adiposity proof (cheek/jaw fullness)
node --import ./register.mjs roundness-proof.mjs   # 2. JS roundness proof (real computeTelemetry, synthetic landmarks)
node --import ./register.mjs pitch-eval.mjs        # 3. pitch-in-frontality evaluation
node --import ./register.mjs run.js                # 4. metric drift audit (baseline 2026-09-11 vs working copy)
CHROMIUM_EXE=/opt/meta-chromium/chrome node quality/run-quality.mjs snapshot  # 5a. quality snapshot (headless Chromium, real pixels)
CHROMIUM_EXE=/opt/meta-chromium/chrome node quality/run-quality.mjs regress   # 5b. quality regression vs snapshot
```

Quality (5) needs `npm i playwright-core` once inside `quality/`. All five are
deterministic: 4 compares frozen landmark inputs, 5 re-ran 155/155 faces
bit-identical across two independent Chromium launches.

## What it does

Compares the lab's metric computation at two code snapshots on **identical
recorded landmark inputs**:

- `baseline-2026-09-11/js/` — the lab as of end-of-day 2026-09-11, fetched from
  the repo at commit `ed6e4551c88e` (the last commit before the Sep-12
  instrument pass).
- `../../js/` — the current working copy.

The detector is deliberately out of scope: `landmarks.json` freezes one
tasks-vision FaceLandmarker run (landmarks + 4×4 face matrix) per bank face,
so the audit measures drift in the *math*, not in detection.

## Layout

- `run.js` — the audit. Run: `node --import ./register.mjs run.js` from this dir.
  Writes `drift-report.json`.
- `register.mjs` / `loader.mjs` / `stubs/mediapipe.mjs` — ESM hooks: stub
  `@mediapipe/tasks-vision`, stub the model download, inject synthetic
  landmarks (`img.__landmarks`) into both `measure.js` variants so the game's
  `measureImage()` runs headless.
- `landmarks.json` — frozen detector outputs for the 155-face bank
  (`{id, file, phase, axis, variant, w, h, landmarks[468], matrix|null}`).
  Regenerate with `/tmp/dump_landmarks.py` (needs the faceenv venv + the model
  bundle at `~/workspace/.scratch-mp/face_landmarker.task`; on this headless box
  the mediapipe native lib needs stub `libEGL.so.1`/`libGLESv2.so.2` on
  `LD_LIBRARY_PATH` — see the report).
- `drift-report.json` — machine-readable per-metric drift stats.
- `DRIFT-REPORT.md` — the human audit report.

## Attribution design

Three comparisons per metric isolate *why* a number moved:

| id | comparison | isolates |
|----|-----------|----------|
| A | new (2D-proxy path) vs old @ real image dims | total instrument drift |
| B | new (3D matrix) vs new (2D-proxy) @ real dims | 3D-pose wiring effect |
| C | new (2D-proxy) vs old @ square dims (w=h=1) | non-aspect changes |

Reading the table: a drift in A but not C is the pixel-space aspect fix
(expected on non-square images). A drift in C on `canthal_tilt_*` is the roll
correction (expected). A drift in C on anything else is unexplained — a bug.
B quantifies what the 3D matrix changes vs the old 2D proxies.

Stats per metric: n, mean/max absolute drift (with the worst face id), and
z-drift = drift ÷ bank SD of the current code's values. New metrics with no
2026-09-11 baseline (`pitch_deg`, `yaw_deg`, `iris_diam_*_px`) are listed, not
compared.
