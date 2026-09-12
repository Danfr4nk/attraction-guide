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
    "index.html",
    "game.html",
    "styles.css",
    "scenario.html",
    "scenario-rate.html",
    "telemetry.html",
    "face-book.html",
    "README.md",
    ".gitignore",
    "test/push-via-api.py",
    "test/analysis-harness/README.md",
    "test/analysis-harness/loader.mjs",
    "test/analysis-harness/register.mjs",
    "test/analysis-harness/run.mjs",
    "test/analysis-harness/stubs/mediapipe.mjs",
]

DEFAULT_MESSAGE = """UX refresh + analysis fixes to complement the new system

- Play HUD: per-axis evidence dots (filled=consistent, hollow=inconsistent,
  ringed=direct pick), status pills, retirement progress, and a "queue:"
  line explaining why the adaptive engine picked the current pair
  (fewest evidence / max uncertainty).
- Profile redesign: axis cards with Wilson CI bars, evidence dots and
  retirement progress; configurality gauge with agreement-rate CI and an
  n<4 provisional qualifier; per-metric cards with CI bars, discrimination
  thresholds, shape badges, and a chosen-mean/revealed-ideal sigma rail
  ("revealed ideal" only labeled when the shape is peaked with bracketing
  evidence). Retired axes collapse into a details section.
- Explicit "can't tell" (Ø) control on feature rows: genuine
  discrimination failure, recorded as noTell. Untouched rows are now
  skipped — missing, not evidence — so silence no longer feeds the
  discrimination threshold. Log marks no-tell rows with Ø.
- Cross-axis retirement: updateAxisStatus now runs for every axis after
  each phase-2 lock, so direct cross-axis picks can confirm axes that
  were never the trial axis.
- Harness: 53/53 green, covering no-tell semantics, HUD dots/pills,
  queue rationale, and cross-axis retirement."""

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
