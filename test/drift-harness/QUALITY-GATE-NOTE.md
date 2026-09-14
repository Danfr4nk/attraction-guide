# Quality-gate calibration — warn-and-report, not suppression (2026-09-14)

## The question

When image quality or pose is bad, should the lab **suppress** the metric
values (refuse to show them) or **warn-and-report** (show them with explicit
distrust annotations)?

## Evidence

`telemetry__2.json` — seven captures of one face, all low quality
(confidence 33–51, yaw −50°…+13°, frontality 0–23.4). Across 60 comparable
metrics, **zero** met the stability criterion (within-face SD / bank SD ≤
0.3); every metric's within-face variability was ≥ 0.74× bank SD, many
2–34×. This is a detector stress test, not a population trial — and the
existing gate correctly labeled all seven captures low quality.

Under a suppression policy, all seven captures would show *nothing* —
hiding the exact evidence that reveals which metrics collapse under pose
(and by how much). Under warn-and-report, the same seven captures produced
the denominator-collapse finding (`eye_w_to_h = 23.695`) that drove the
guard infrastructure in this pass. The finding required the bad values to
be visible.

## Decision: warn-and-report

Low-quality and extreme-pose values stay visible, with stronger warnings:

- `fail` image-quality verdict → confidence 25/100, badge on thumbnail,
  quality box labels it — values still computed, shown, exported.
- `denominator-collapse` / `non-finite` → raw value shown (or
  "unmeasurable" for Infinity/NaN), never silently clamped.
- `pose-suspect` / `pose-unreliable` → annotated in the table, HUD, and
  exports — never hidden.
- Rationale: (1) suppression hides the evidence needed to judge the
  instrument's own limits; (2) the flags carry distrust explicitly, in the
  table next to the number; (3) "low quality" is a spectrum, not a cliff —
  a suppressed value can't be compared across captures; (4) the method
  copy now states the policy plainly (method §v2): "fail means the
  instrument does not stand behind the numbers — they are still shown,
  flagged, and exported, because weak values are labeled, never silently
  suppressed."

## Regression status

The quality harness (`quality/run-quality.mjs`) exercises only
`analyzeQuality()` in telemetry2.js — untouched by this pass (all changes
were in telemetry.js/telemetry3.js). The 2026-09-13 snapshot stands:
113 pass / 42 warn / 0 fail, bit-identical across two independent launches.
No regen required; rerun when analyzeQuality next changes.
