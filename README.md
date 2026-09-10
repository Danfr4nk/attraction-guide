# attraction-guide

A facial-preference diagnostic game. Iterative A/B testing of synthetic faces to map
what you find attractive — in granular, numerically measured detail.

## How it works

- **Phase 1** — rank 1-of-4 structural archetypes: wide-angular, long-narrow, heart, round.
- **Phase 2** — infinite pairs, one micro-variable each: jaw, lips, eye spacing, brows, nose.
- **Round 0** — optional: upload a reference face; it gets landmark-measured as your baseline vector.
- **Eye color is pinned.** Every face in the bank is brown-eyed. It is never the deciding variable.
- **Every face is measured in-browser** with MediaPipe FaceMesh landmarks. Ratios, not adjectives:
  width:height, jaw:cheek, IPD:cheek, eye w:h, nose:cheek, mouth:cheek, lip fullness, symmetry.
- Confidence discipline: 1 pick = weak · 2 consistent = leaning · 3+ = confirmed.

## Run it

Static site, no backend. Served via GitHub Pages: https://danfr4nk.github.io/attraction-guide/

Or locally: `python3 -m http.server` in this dir (needs internet for the MediaPipe CDN).

## Face bank

`faces/` holds 18 synthetic portraits (AI-generated, not real people) + `faces.json` manifest.
To extend the bank, add webp files and matching manifest entries:

```json
{"id":"p2-cheek-high","file":"faces/p2-cheek-high.webp","phase":2,"axis":"cheeks","variant":"high"}
```

New phase-2 axes are picked up automatically (add labels in `js/app.js` `PAIR_AXES`).

## Files

- `index.html` — the app
- `styles.css`
- `js/app.js` — game engine: rounds, ranking, inference, profile, log, persistence
- `js/measure.js` — in-browser FaceLandmarker wrapper + ratio definitions
- `faces/` — the synthetic face bank

## v2 ideas

- On-demand face generation per round (generation backend) instead of a fixed bank
- Cross-run synthesis: diff preference vectors across runs
- More micro-variables: philtrum, forehead height, chin projection, cheekbone height

## v1.1 — telemetry lab (`telemetry.html`)

Standalone precision measurement instrument, outside the game flow. Same MediaPipe
FaceLandmarker detector and landmark indices as the game (`js/measure.js` exports
`detectLandmarks` + `LANDMARK_IDX`); the lab builds an extended ~40-metric telemetry
vector on top: gonial angles, facial thirds, fWHR proxy, canthal tilt, brow arch,
philtrum/nose, upper/lower lip, 9-pair asymmetry, roll/yaw pose proxies, a 0–100
frontality quality score, and deviations from five neoclassical canons. Features:
drag-and-drop multi-upload, telestrator overlay (mesh / metric lines / thirds dividers),
session history with pose-quality badges, two-image A/B delta table, JSON/CSV export,
copyable summary, and a method section documenting every formula and landmark index.
