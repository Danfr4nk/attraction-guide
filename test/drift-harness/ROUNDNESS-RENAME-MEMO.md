# Roundness rename — decision memo (2026-09-14)

## The finding (no new data; recap of the 2026-09-13/14 proof)

The "roundness family" is not one construct. Five measured quantities, four
distinct geometries — and they disagree with each other:

- Controlled WHR sweep: `width_height_ratio` tracks with slope **1.000**;
  `fwhr_proxy` is **flat (slope 0.000)** vs face height — blind to the height
  dimension by construction (its denominator is mid-third length).
- Controlled jaw-width sweep: `jaw_to_cheek` tracks with slope **1.000**;
  `width_height_ratio` and `fwhr_proxy` sit flat — jaw width is invisible
  to them.
- 12 real jaw-soft/base pairs: WHR positive **0/12** (mean Δ −0.0072),
  fWHR positive **3/12** (mean Δ −0.0112), `jaw_to_cheek` positive **12/12**
  (mean Δ +0.0043). Softer jaws read *narrower* on WHR/fWHR — the opposite
  of what "roundness" predicts — while every jaw-sensitive metric moves
  the right way.
- `cheek_fullness` (Python) vs `width_height_ratio` (JS), 155 faces:
  Spearman **−0.371**. Two metrics both filed under "roundness" disagree
  more than they agree.

## The five quantities → four geometries

| # | quantity (code key) | geometry | proposed display name |
|---|---|---|---|
| 1 | `width_height_ratio` | global short-wide shape — the only one that tracks controlled WHR | **face width : height** (unchanged) |
| 2 | `fwhr_proxy` | cheek width ÷ midface height — blind to total face height | **cheek : midface height** (drop "fWHR") |
| 3 | `cheek_fullness` (PY) | midface-contour fullness — shape-sensitive, height-blind | **midface contour fullness** |
| 4a | `jaw_to_cheek` (JS) | lower-face width ÷ cheek width | **jaw : cheek width** (unchanged) |
| 4b | `jaw_fullness` (PY) | same geometry as 4a, second implementation (12/12, +0.0044 — identical verdicts) | **lower-face fullness** |

4a/4b are one geometry in two implementations — the honest count is four
distinct geometries, five code quantities.

## What "rename" would actually touch

**Nothing in the shipped UI today.** There is no "roundness" string in the
lab or the game — no group, no label, no hint. The "roundness family" exists
only in analysis/report language (IMPROVEMENT-REPORT.md, this memo series)
and the Python-side metric names. So this decision is about vocabulary
going forward, not a code rename:

1. **Report/wiki language**: retire "roundness"/"roundness family" as a
   category; refer to the four geometries by the proposed display names.
2. **Lab metric labels** (exact UI-copy changes if adopted):
   - `fWHR (proxy)` → **cheek : midface height**. This is the most
     misleading label in the set: it borrows the authority of the
     published fWHR construct while measuring something fWHR is blind to
     (midface-relative, not face-relative). Hint stays
     ("cheek width ÷ glabella→subnasale") — the hint was always honest,
     the label wasn't.
   - `width : height`, `jaw : cheek`, `facial fifths` — already specific,
     no change.
3. **Any future lab "face shape" group**: if these are ever grouped in the
   UI, group them under the four geometry names above — never under one
   "roundness" header.
4. **Game**: `width_height_ratio` / `jaw_to_cheek` / `eye_w_to_h` carry
   `game: true` tags in the lab; the game itself has no roundness
   grouping. Out of scope for the lab pass, noted for completeness.

## Recommendation

Adopt the vocabulary change (items 1–3). It costs one label edit
(`fWHR (proxy)` → `cheek : midface height`) and prevents the specific
misreading the proof caught: treating a flat fWHR as evidence about
jaw-driven roundness when the metric cannot see jaw width at all.

## Decision needed from Dan

- [ ] Approve the vocabulary + the single label edit, or
- [ ] Keep "fWHR (proxy)" as-is (accepting the documented misreading risk), or
- [ ] Alternative naming.

No code changes ship until you decide.
