# Pose-robustness ranking — Telemetry Lab

Generated 2026-09-14T03:42:49.052Z.

## Inputs
- 22 within-face pairs: 21 from the 7-capture same-face series (face A), 1 from the
  2-capture series (face B). All captures low quality; yaw span up to 62° — a
  DETECTOR STRESS TEST, not a normal reliability trial.
- 155 frozen bank faces (synthetic baseline) for between-face SD.
- Synthetic probe: rigid 3D rotations of each bank face (±5/10/15/20° yaw,
  ±5/10° roll, ±5/10° pitch), re-run through computeTelemetry. Pure geometric
  pose sensitivity — no detector in the loop. z-depths are approximate
  (MediaPipe-normalized), so 3D rotations are indicative, not exact.

## Two regimes — read both
**Geometric (synthetic):** how the metric's MATH responds to pose. The causal,
calibrated quantity; basis of the per-metric flags in js/robustness.js. A flag
is a LOWER bound on the doubt ("geometry alone already corrupts this by ~X SD")
— never a clean bill of health.

**Detector-in-the-loop (empirical):** what actually happened on the stress-test
captures, detector noise and occlusion included. At extreme pose the detector
breakdown DOMINATES: no per-metric flag can be calibrated there, and the
quality gate (low quality / low frontality) is the defense — it already fires
on all 9 captures. Where empirical >> synthetic, the detector (not the
geometry) is the failure.

Radii are synthetic worst-axis: degrees of that axis at which the metric is
expected to move 1 bank SD. Tier: robust ≥20° · moderate 10–20° · fragile <10°.

## 2026-09-14 bug caught by this analysis
The synthetic sweep found the lab's canthal-tilt roll correction had the wrong
sign on the image-left eye (+roll added to both eyes corrected R and DOUBLED
the contamination on L — tiltL moved +10° per +10° imposed roll). Fixed in
js/telemetry.js (L: −roll, R: +roll); both eyes verified bit-invariant under
±10° imposed roll. The game's measure.js tilt is uncorrected (pre-existing,
not a bug — out of scope).

## Ranking (most fragile first)
| metric | tier | worst axis | radius | synth yaw / roll / pitch (SD/°) | empirical slope SD/° (r, n) |
|---|---|---|---|---|---|
| asymmetry_9 | fragile | roll | 0.4° | 1.0515 / 2.5321 / 0 | 0.3276 (0.401, n=22) |
| roll_deg | fragile | roll | 0.4° | 0.0134 / 2.5862 / 0.064 | 0.481 (0.3, n=22) |
| mean_asymmetry | fragile | roll | 0.5° | 1.1461 / 2.0686 / 0 | 0.5229 (0.649, n=22) |
| frontality | fragile | roll | 0.7° | 0.4602 / 1.4505 / 0.0301 | -0.0171 (-0.251, n=22) |
| yaw_deg | fragile | yaw | 0.8° | 1.2879 / 0.0019 / 0.0262 | 1.1287 (0.905, n=22) |
| yaw_proxy_deg | fragile | yaw | 1.2° | 0.8181 / 0.0012 / 0.0167 | 0.4447 (0.831, n=22) |
| gonial_diff | fragile | yaw | 2.1° | 0.4754 / 0.0081 / 0.0441 | 0.6902 (0.77, n=22) |
| brow_arch_R | fragile | pitch | 3.2° | 0.0469 / 0.0006 / 0.309 | 0.2279 (0.739, n=22) |
| brow_arch_mean | fragile | pitch | 3.3° | 0.0767 / 0.0005 / 0.3073 | 0.1812 (0.693, n=22) |
| brow_arch_L | fragile | pitch | 3.4° | 0.1001 / 0.0004 / 0.2979 | 0.1408 (0.682, n=22) |
| gonial_angle_L | fragile | pitch | 3.5° | 0.2345 / 0.0019 / 0.2847 | 0.1762 (0.665, n=22) |
| upper_lower_lip | fragile | pitch | 3.5° | 0.0582 / 0 / 0.2844 | 0.1506 (0.767, n=22) |
| gonial_angle_mean | fragile | pitch | 3.6° | 0.1012 / 0.0004 / 0.2764 | -0.0088 (-0.072, n=22) |
| width_height_ratio | fragile | pitch | 4° | 0.1917 / 0.0011 / 0.2489 | 0.0599 (0.55, n=22) |
| canthal_tilt_mean | fragile | pitch | 4° | 0.0367 / 0.0003 / 0.2471 | 0.1737 (0.201, n=22) |
| gonial_angle_R | fragile | pitch | 4.2° | 0.0333 / 0.0024 / 0.2405 | 0.276 (0.846, n=22) |
| third_lower_pct | fragile | pitch | 4.2° | 0.0241 / 0 / 0.2397 | -0.0101 (-0.078, n=22) |
| canthal_tilt_R | fragile | pitch | 5.8° | -0.0003 / 0.0001 / 0.1724 | 0.0951 (0.698, n=22) |
| canthal_tilt_L | fragile | pitch | 6.3° | 0.0472 / 0.0002 / 0.1577 | 0.2614 (0.237, n=22) |
| third_mid_pct | fragile | pitch | 6.4° | 0.0189 / 0 / 0.1555 | 0.0507 (0.54, n=22) |
| eye_w_to_h | fragile | pitch | 7.9° | 0.0823 / 0.0005 / 0.1266 | -0.2071 (-0.205, n=22) |
| fwhr_proxy | fragile | yaw | 8.4° | 0.1192 / 0.0007 / 0.0796 | 0.0111 (0.195, n=22) |
| philtrum_to_nose | fragile | pitch | 9.1° | 0.0067 / 0 / 0.1098 | 0.0146 (0.177, n=22) |
| third_upper_pct | fragile | pitch | 9.8° | 0.0075 / 0 / 0.102 | -0.0233 (-0.28, n=22) |
| canon_thirds | fragile | pitch | 9.8° | 0.0075 / 0 / 0.102 | -0.0233 (-0.28, n=22) |
| chin_to_lower_third | moderate | pitch | 11.5° | 0.0189 / 0 / 0.0871 | -0.0234 (-0.214, n=22) |
| face_height_px | moderate | pitch | 14.1° | 0.0021 / 0.0001 / 0.0708 | -0.0578 (-0.219, n=22) |
| lip_fullness | moderate | pitch | 14.9° | 0.0406 / 0.0002 / 0.067 | -0.0284 (-0.221, n=22) |
| nose_len_px | moderate | pitch | 15.9° | 0.007 / 0.0001 / 0.063 | -0.0561 (-0.188, n=22) |
| mouth_w_px | moderate | yaw | 18.7° | 0.0536 / 0.0003 / 0.0001 | -0.0553 (-0.233, n=22) |
| ipd_px | moderate | yaw | 19.4° | 0.0514 / 0.0003 / 0.0001 | -0.0411 (-0.175, n=22) |
| face_width_px | robust | yaw | 21° | 0.0477 / 0.0003 / 0.0001 | -0.0365 (-0.17, n=22) |
| nose_w_px | robust | yaw | 22.1° | 0.0451 / 0.0002 / 0 | -0.0422 (-0.186, n=22) |
| brow_eye_dist_pct | robust | pitch | 36.4° | 0.0016 / 0 / 0.0275 | -0.0177 (-0.466, n=22) |
| canthal_tilt_diff | robust | yaw | 40.2° | 0.0249 / 0.0001 / 0.0033 | 0.0543 (0.123, n=22) |
| fifths | robust | pitch | 46.7° | 0.006 / 0 / 0.0214 | 0.1512 (0.606, n=22) |
| canon_fifths | robust | pitch | 47.1° | 0.006 / 0 / 0.0212 | 0.0891 (0.656, n=22) |
| canon_spacing | robust | pitch | 48.5° | 0.0056 / 0 / 0.0206 | 0.0068 (0.073, n=22) |
| eye_spacing_widths | robust | pitch | 49.1° | 0.0056 / 0 / 0.0204 | 0.0069 (0.074, n=22) |
| canon_nose | robust | yaw | 315.2° | 0.0032 / 0 / 0.0001 | 0.0149 (0.204, n=22) |
| canon_mouth | robust | yaw | 330.4° | 0.003 / 0 / 0.0001 | 0.0682 (0.515, n=22) |
| mouth_to_nose | robust | yaw | 345.4° | 0.0029 / 0 / 0.0001 | 0.0509 (0.345, n=22) |
| nose_w_to_intercanthal | robust | yaw | 351.3° | 0.0028 / 0 / 0.0002 | 0.0469 (0.491, n=22) |
| jaw_to_cheek | robust | yaw | 733.3° | 0.0014 / 0 / 0 | -0.0018 (-0.043, n=22) |
| nose_to_cheek | robust | yaw | 787.3° | 0.0013 / 0 / 0.0002 | 0.0769 (0.702, n=22) |
| ipd_to_cheek | robust | yaw | 1024.7° | 0.001 / 0 / 0 | 0.1104 (0.742, n=22) |
| mouth_to_cheek | robust | yaw | 1148.4° | 0.0009 / 0 / 0.0001 | -0.0076 (-0.05, n=22) |
| pitch_deg | unknown | — | —° | — / — / — | 0.1572 (0.581, n=22) |

## Tiers

**robust** (16): face_width_px, nose_w_px, brow_eye_dist_pct, canthal_tilt_diff, fifths, canon_fifths, canon_spacing, eye_spacing_widths, canon_nose, canon_mouth, mouth_to_nose, nose_w_to_intercanthal, jaw_to_cheek, nose_to_cheek, ipd_to_cheek, mouth_to_cheek

**moderate** (6): chin_to_lower_third, face_height_px, lip_fullness, nose_len_px, mouth_w_px, ipd_px

**fragile** (25): asymmetry_9, roll_deg, mean_asymmetry, frontality, yaw_deg, yaw_proxy_deg, gonial_diff, brow_arch_R, brow_arch_mean, brow_arch_L, gonial_angle_L, upper_lower_lip, gonial_angle_mean, width_height_ratio, canthal_tilt_mean, gonial_angle_R, third_lower_pct, canthal_tilt_R, canthal_tilt_L, third_mid_pct, eye_w_to_h, fwhr_proxy, philtrum_to_nose, third_upper_pct, canon_thirds

**unknown** (1): pitch_deg

## Headline findings
- Asymmetry metrics (mean_asymmetry, asymmetry_9, gonial_diff) are the most
  pose-sensitive anatomy metrics — expected, since asymmetry itself is
  pose-contaminated. asymmetry_9 stays uncorrected by design; its flag now
  says so explicitly.
- Roll-corrected canthal tilt is roll-invariant by construction (verified),
  with residual pitch sensitivity (~0.2 SD/°); canthal_tilt_diff is robust.
- Jaw/cheek/mouth width ratios (jaw_to_cheek, mouth_to_cheek, mouth_to_nose,
  canon_nose) are geometrically near-invariant to pose — the earlier jaw-soft
  adiposity confound is a shape effect, not a pose artifact.
- eye_w_to_h has genuine yaw sensitivity (0.08 SD/°): at |yaw| > ~12° the
  denominator collapses and the ratio explodes (the 23.695 capture) — capped
  and flagged, not trusted.
- In the empirical stress test, detector noise at extreme pose moves most
  metrics ≥1 SD regardless of geometric tier. Per-metric flags do not cover
  this regime; the quality gate does.

## Flagging rule (implemented in the lab)
For a capture at pose (yaw, roll, pitch): expected deviation (bank SD) =
Σ slope_axis × |angle_axis| (linearized worst case, synthetic slopes).
≥0.5 → `pose-suspect`; ≥1.0 → `pose-unreliable`. Pose metrics excluded
(flagging pose for pose is circular); asymmetry_9 flagged, not corrected.
