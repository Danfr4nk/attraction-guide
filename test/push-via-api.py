#!/usr/bin/env python3
"""Push working-tree files to Danfr4nk/attraction-guide via the Git Data API."""
import base64
import json
import subprocess
import sys

REPO = "Danfr4nk/attraction-guide"
BRANCH = "main"
GH = "/home/hatch/workspace/skills/github/bin/gh-api"
APP = "/home/hatch/workspace/attraction-guide"

FILES = [
    "js/app.js",
    "js/measure.js",
    "js/telemetry.js",
    "js/telemetry2.js",
    "js/telemetry3.js",
    "index.html",
    "game.html",
    "styles.css",
    "scenario.html",
    "scenario-rate.html",
    "telemetry.html",
    "telemetry.css",
    "face-book.html",
    "frame-describe.html",
    "README.md",
    ".gitignore",
    "test/push-via-api.py",
    "test/analysis-harness/README.md",
    "test/analysis-harness/loader.mjs",
    "test/analysis-harness/register.mjs",
    "test/analysis-harness/run.mjs",
    "test/analysis-harness/stubs/mediapipe.mjs",
]

DEFAULT_MESSAGE = """Instrument-correctness pass: MediaPipe 3D pose, aspect-true geometry, honest statistics

- Telemetry Lab: MediaPipe facial-transformation-matrix 3D pose (roll/yaw/pitch,
  lab-conformed sign conventions) with labeled 2D-proxy fallback; yaw/pitch/roll
  metrics, pose_source in HUD/exports; matrix is a model fit, not ground truth.
- All landmark geometry (telemetry, game) moved to pixel coordinates — fixes the
  non-square aspect distortion on every distance/angle/ratio; canthal tilt shared
  definition with roll correction, mirrored for selfies.
- Statistics renamed honestly: landmark-noise 95% intervals (not bootstrap);
  Wilson display shows observed p with Wilson bounds; n=0 renders "no data";
  configurality n<4 shows "insufficient data", no verdict.
- Telemetry Lab: optional background tag (bank taxonomy) preserved on items and
  in JSON/CSV; face-book: labeled background selector synced with group chips.
- Deploy manifest now includes js/measure.js, js/telemetry3.js, telemetry.css
  (previously omitted; live telemetry3.js was corrupted). body-metrics excluded
  from this push.
"""


MESSAGE = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MESSAGE


def api(method, path, body=None):
    cmd = [GH, method, f"/repos/{REPO}{path}"]
    inp = json.dumps(body).encode() if body is not None else None
    p = subprocess.run(cmd, input=inp, capture_output=True)
    if p.returncode != 0:
        print(f"API FAILED: {method} {path}", file=sys.stderr)
        print(p.stderr.decode()[:2000], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout.decode())


def main():
    ref = api("GET", f"/git/ref/heads/{BRANCH}")
    head_sha = ref["object"]["sha"]
    print("head:", head_sha[:12])

    tree_entries = []
    for f in FILES:
        with open(f"{APP}/{f}", "rb") as fh:
            content = base64.b64encode(fh.read()).decode()
        blob = api("POST", "/git/blobs", {"content": content, "encoding": "base64"})
        tree_entries.append({"path": f, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("blob:", f, blob["sha"][:12])

    head_commit = api("GET", f"/git/commits/{head_sha}")
    new_tree = api("POST", "/git/trees", {"base_tree": head_commit["tree"]["sha"], "tree": tree_entries})
    print("tree:", new_tree["sha"][:12])

    commit = api("POST", "/git/commits", {
        "message": MESSAGE, "tree": new_tree["sha"], "parents": [head_sha]})
    print("commit:", commit["sha"])

    api("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"]})
    print("pushed", commit["sha"], "to", BRANCH)


main()
