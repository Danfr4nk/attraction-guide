# Telemetry Lab improvement run — consolidated report (2026-09-14)

Three work items: (1) quantitative proof for the roundness-family metrics,
(2) headless-Chromium regression coverage for `analyzeQuality`,
(3) pitch-in-frontality evaluation. Code change made: pitch sign fix only.
No metric renamed, no frontality formula touched.

## 1. Roundness family — quantitative proof

Question: do `width_height_ratio`, `fwhr_proxy`, `jaw_to_cheek` (JS) and
`cheek_fullness`, `jaw_fullness` (Python adiposity) measure one thing
("roundness"), or different geometries?

Method: drive the REAL `computeTelemetry()` with synthetic landmark sets of
known geometry (`roundness-proof.mjs`), plus the Python adiposity metrics on
mirrored synthetic sets (`roundness-proof-py.py`), plus real-bank controls.

### 1a. Synthetic geometry — JS metrics

**S1 — face-height sweep (width fixed, height varies; WHR target 0.70→1.18):**

| metric | slope vs WHR target | verdict |
|---|---|---|
| `width_height_ratio` | 1.000, monotonic | tracks controlled WHR exactly |
| `fwhr_proxy` | 0.000, flat | blind to face height — denominator is mid-third length, not total height |
| `jaw_to_cheek` | 0.000, flat | width/width by construction, blind to height |

**S2 — jaw-width sweep (jaw/cheek 0.55→0.95, everything else fixed):**

| metric | slope | verdict |
|---|---|---|
| `jaw_to_cheek` | 1.000, monotonic | tracks jaw geometry exactly |
| `width_height_ratio`, `fwhr_proxy` | 0.000, flat | jaw width invisible to both |

**S3 — cheek-width sweep (cheek half-width 0.12→0.20):**

| metric | slope | theory | verdict |
|---|---|---|---|
| `width_height_ratio` | 5.88 | 2/H = 5.87 | matches analytic prediction |
| `fwhr_proxy` | 18.18 | 2/M = 18.18 | matches analytic prediction |
| `jaw_to_cheek` | falls as 1/C | — | moves opposite |

### 1b. Synthetic geometry — Python adiposity metrics

- `cheek_fullness` and `jaw_fullness` are FLAT across face-height and
  eccentricity sweeps: width/width ratios cannot see "short-wide" roundness.
- Jaw-width sweep: `jaw_fullness` slope 1.000 monotonic; `cheek_fullness`
  slope 0.047 (small interpolation leakage only).
- Midface-fullness sweep: `cheek_fullness` slope 0.2617 monotonic;
  `jaw_fullness` slope 0.000.

### 1c. Real-bank controls — 12 jaw-soft vs base pairs

| metric | positive moves | mean Δ (soft−base) |
|---|---|---|
| JS `width_height_ratio` | 0/12 | −0.0072 |
| JS `fwhr_proxy` | 3/12 | −0.0112 |
| JS `jaw_to_cheek` | 12/12 | +0.0043 |
| PY `cheek_fullness` | 12/12 | +0.0143 |
| PY `jaw_fullness` | 12/12 | +0.0044 |
| PY `jaw_to_cheek` | 12/12 | +0.0044 |

Softer jaws read narrower/lower on WHR and fWHR — the exact opposite of what
a "roundness" reading would predict — while every jaw-sensitive metric moves
the right way.

### 1d. Convergent validity — 155 faces

Python `cheek_fullness` vs JS `width_height_ratio`: Spearman **−0.371**,
Pearson **−0.341**. Two metrics both filed under "roundness" disagree more
than they agree. They are different geometries, not interchangeable measures.

### Verdicts and recommendations

Stop calling these one "roundness family." They measure five different things:

- `width_height_ratio` — global short-wide shape (the only one that tracks
  controlled WHR; slope 1.000).
- `fwhr_proxy` — cheek width relative to MIDFACE height (blind to total face
  height; slope 0.000 vs height sweep).
- `cheek_fullness` — midface-contour fullness (shape-sensitive, height-blind).
- `jaw_fullness` / `jaw_to_cheek` — lower-face width (slope 1.000 vs jaw sweep).
- None alone proves generic facial roundness; `jaw_to_cheek` moving on jaw
  morphs while WHR/fWHR sit flat is the cleanest demonstration.

Recommendations (no code changed yet — naming is a product decision):
rename the HUD group from "roundness" to the five specific labels above, or
at minimum split `jaw_to_cheek` out of any roundness aggregate. `asymmetry_9`
left uncorrected per standing rule.

## 2. Pitch in frontality — evaluated, REJECTED

Proposal was a term like `−|pitch|×k` in the frontality formula.

### The numbers (155 frozen faces, `pitch-eval.mjs` → `pitch-eval.json`)

- Pitch range (after sign fix, §2b): +3.37° … +11.14°, median +6.34°, p90 +8.28°.
- ALL 155 pitch values share the same sign — no face in the bank tilts the
  other way. Forehead z < chin z (forehead nearer camera) in 155/155 faces.
- Adding |pitch|×3 / ×4 / ×5 demotes 115 / 145 / 152 faces; zero move up.
- Extreme: `p1-heart-2` (pitch +11.14°) frontality 92 → 47.5 at k=4, high→low.
- corr(|pitch|, lower-third %) = −0.478, directionally consistent with
  vertical foreshortening.

### Why the case fails

1. **Sign convention was wrong.** The 2026-09-13 one-face anchor
   ("forehead-nearer ⇒ chin down, decomposition reads +3.2° ⇒ +pitch =
   chin down") does not replicate: 155/155 faces show the same
   forehead-nearer depth configuration with NEGATIVE unnegated pitch.
   The anchor's sign call is overturned, n=155.
2. **Shape artifact dominates.** Within identity-constant lineages
   (head pose fixed by construction), matrix pitch varies 4°+
   (p2a07: 4.3°→8.4° across jaw/brow morphs). The Procrustes fit absorbs
   vertical-proportion differences as pitch.
3. **The penalty would regrade the bank on a mislabeled signal.**
   145/155 faces demoted at k=4 by a value that is sign-unverified and
   substantially shape artifact. Not one-directional evidence — rejected.

### 2b. What WAS implemented: pitch sign fix (js/telemetry.js)

`poseFromMatrix` now negates pitch like yaw/roll, so `+pitch = chin down`
as the HUD documents. Verified: `p1-heart-2` pitch −11.14° → +11.14°,
frontality unchanged (92), roll/yaw untouched, full-bank range
[+3.37°, +11.14°]. Frontality formula untouched — pitch stays out of it.

## 3. `analyzeQuality` headless regression — DONE

The drift harness explicitly excluded quality ("needs canvas pixels —
browser-only"). Closed with `test/drift-harness/quality/run-quality.mjs`:

- Launches headless Chromium (`/opt/meta-chromium/chrome`; the Playwright
  CDN download kept failing at ~80%, the box's own Chromium 152 works),
  loads the REAL `js/telemetry2.js` in-page via file:// + import map
  (127.0.0.1 navigation is blocked by this build's Local Network Access
  checks — file:// with `--allow-file-access-from-files` works),
  runs the lab's actual `analyzeQuality(img, frozenLandmarks)` on all
  155 bank images. No reimplementation.
- `snapshot` mode writes `quality/snapshot.json`; `regress` mode re-runs
  and diffs (exact equality on sharpness/exposure/clipping/iid_px/
  illum_balance/verdict/notes), exit 1 on mismatch.
- **Determinism: two independent Chromium launches, 155/155 faces
  bit-identical.** Pinned as exact-equality regression.
- Snapshot stats: 113 pass / 42 warn / 0 fail. Sharpness 178–927
  (median 492), exposure 60–149, clipping 0–17.1%, IID 250–382px,
  illum_balance 0–0.17. Needs `npm i playwright-core` in `quality/`.

## Files

New/changed (scoped push):
`js/telemetry.js` (pitch sign fix),
`test/drift-harness/roundness-proof.mjs`, `roundness-proof.json`,
`roundness-proof-py.py`, `roundness-proof-py.json`, `bank-adiposity.json`,
`test/drift-harness/pitch-eval.mjs`, `pitch-eval.json`,
`test/drift-harness/verify-pitch-sign.mjs`,
`test/drift-harness/quality/run-quality.mjs`, `quality/snapshot.json`,
`test/drift-harness/IMPROVEMENT-REPORT.md` (this file),
`test/drift-harness/README.md` (runner order).

## Blocked / unverified

- Pitch-as-pose needs calibration against deliberately tilted captures
  before any frontality use; magnitude is shape-contaminated (see §2).
- The roundness rename is a product/labeling decision — not implemented.
- Spot-checking pitch movers visually was not done (geometry already rejects
  the term); eligible for a browser/image-review pass if wanted.
