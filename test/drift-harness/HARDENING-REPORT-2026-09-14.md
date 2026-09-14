# Telemetry Lab hardening report — 2026-09-14

Dan's mandate: "make this as good as it can possibly be." Scope: Telemetry
Lab only (`js/telemetry*.js`, `js/measure.js`, `telemetry.html`,
`test/drift-harness/`). Game, splash, Face Book, Body Metrics untouched.

## 1. Canthal-tilt sign bug — found by the new probe, fixed, proven

The synthetic-rotation battery (rotating frozen landmarks ±10° roll about
the facial midline) caught a sign error: the old code added `+roll` to both
eyes' tilts. Because the `|dx|` image-tilt convention moves the two eyes'
image tilts in **opposite** directions under roll, `+roll` corrected the
right eye but **doubled** roll contamination on the left (tiltL moved +10°
per +10° imposed roll).

Fix (`js/telemetry.js`): image-left eye `tilt − roll`, image-right eye
`tilt + roll`. Verified on three bank faces at −10°/0°/+10° imposed roll:
both eye tilts invariant to displayed precision. The drift audit was
re-run against the fixed code and confirms the correction is now symmetric:
tilt_mean drift vs the 2026-09-11 baseline is 0.012° (roll cancels exactly
in the mean), tiltL drift = −roll, tiltR drift = +roll, tilt_diff drift =
−2·roll. DRIFT-REPORT.md carries the addendum. The game's `measure.js`
tilt is uncorrected (pre-existing, not a bug — game out of scope).

## 2. Denominator-guard infrastructure

The same-face battery's `eye_w_to_h = 23.695` (blink/foreshortening drove
the denominator to zero; the old code fabricated a finite value via
`|| 1`) is now impossible to silently repeat:

- `computeTelemetry()` returns `{ metrics, metricFlags }`; `computeV3()`
  returns `{ metrics, flags }`. Flags: `denominator-collapse`,
  `non-finite`, `pose-suspect`, `pose-unreliable`.
- Narrow-feature floor: **0.03 × cheek width** (≈ half the bank minimum —
  eye height 0.0627, lower-lip height 0.0626, scleral fissure 0.0608–0.0633
  as fraction of cheek width, 155 frozen faces). Below the floor the raw
  value is preserved and flagged, never clamped or suppressed.
- Guards so far: `eye_w_to_h`, `upper_lower_lip`, V3 `scleral_show_L/R`
  (their `|| 1` fallbacks removed). Exact-midline asymmetry degeneracy now
  returns zero explicitly instead of `|| 1`.
- Flags flow into the metric table, A/B table, HUD summary, quality box,
  JSON export (`metric_flags` + legend), CSV export (`flags` column), and
  the copied summary.
- Regression test `denom-guard-test.mjs`: **9/9 pass**, including a
  synthetic fixture that reproduces the exact 23.695 geometry and asserts
  the flag fires and the raw value is preserved.

Remaining: the full denominator audit across every ratio (V1 thirds,
fWHR, canon-derived; V2; V3 brow/lip/asymmetry) and flag propagation into
derived canon metrics. The scaffolding is in place; the audit is mechanical.

## 3. Pose-contamination flags

`test/drift-harness/robustness.mjs` was rebuilt on causal synthetic slopes
(per-axis: yaw/roll/pitch SD-per-degree from rotating frozen landmarks)
instead of the old absurd empirical intercepts. Per-metric pose estimates
use the conservative linearized sum `yawSlope·|yaw| + rollSlope·|roll| +
pitchSlope·|pitch|`; ≥0.5 bank SD → `pose-suspect`, ≥1 bank SD →
`pose-unreliable`. Pose/output metrics excluded (circular); `asymmetry_9`
deliberately uncorrected and flagged honestly. Provisional ranking: 48
metrics, 25 fragile / 6 moderate / 16 robust / 1 unknown. 43 anatomy
metrics exported to `js/robustness.js`, wired into the live lab.

Caveats (not shipped as solved): the ranking currently covers the V1
vector, not all V2/V3 metrics; matrix pitch is shape-contaminated
(rejected from frontality 2026-09-14), so pitch-driven flags are
approximate warnings, not ground truth — the UI copy says exactly this.

## 4. Quality gate — warn-and-report, not suppression

Evaluated against the 7-capture same-face stress battery (zero of 60
metrics stable; all captures low quality). Suppression would have hidden
the evidence that produced the denominator-collapse finding. Decision:
values stay visible with explicit distrust (flags, confidence 25/100 on
fail, quality-box warnings). Method copy updated: "fail means the
instrument does not stand behind the numbers — they are still shown,
flagged, and exported, because weak values are labeled, never silently
suppressed." Full note: QUALITY-GATE-NOTE.md. The 2026-09-13 quality
snapshot (113 pass / 42 warn / 0 fail, bit-identical across two launches)
stands — `analyzeQuality` untouched by this pass.

## 5. Roundness rename — decision memo, no code change

The 2026-09-13/14 proof stands (re-run 2026-09-14, same numbers): four
distinct geometries, not one "roundness" construct. Memo at
ROUNDNESS-RENAME-MEMO.md proposes retiring "roundness" from analysis
vocabulary and one label edit (`fWHR (proxy)` → `cheek : midface height`).
**Awaiting Dan's decision — nothing renamed yet.**

## 6. UI hardening

- A/B compare checkboxes now explained inline ("tick up to two… ticking a
  third drops the oldest") — Dan had selected them without knowing what
  they did.
- Visible per-metric flag legend added to the method section (was
  tooltip-only).
- `telemetry.css` gained flag-chip styles (lab-only styling).

## 7. Gate reruns (2026-09-14)

- `node --check`: telemetry.js, telemetry2.js, telemetry3.js, robustness.js,
  measure.js, run.js, robustness.mjs, denom-guard-test.mjs — all pass.
- Drift audit re-run vs 2026-09-11 baseline: aspect-only pattern intact;
  tilt rows confirm the sign fix (§1).
- Roundness proof + pitch eval re-run: same conclusions (WHR slope 1.000,
  fWHR blind; pitch still rejected).
- denom-guard-test.mjs: 9/9 pass.
- Quality snapshot: stands (see §4).

## 8. Deployment

Scoped push (Telemetry Lab files only) via the API push script, then live
byte-verification. Files changed/added this pass:

- `js/telemetry.js` — tilt fix, denominator guards, flag plumbing, UI copy
- `js/telemetry3.js` — `{ metrics, flags }` API, scleral guards
- `js/robustness.js` — NEW: pose-sensitivity slopes
- `telemetry.html` — A/B hint
- `telemetry.css` — flag chips
- `test/drift-harness/` — robustness.mjs, denom-guard-test.mjs (NEW),
  DRIFT-REPORT.md, ROBUSTNESS-REPORT.md, ROUNDNESS-RENAME-MEMO.md (NEW),
  QUALITY-GATE-NOTE.md (NEW), HARDENING-REPORT-2026-09-14.md (this file),
  robustness.json, drift-report.json

Unchanged (not pushed): `js/telemetry2.js`, `js/measure.js`.
