"""Python side of the roundness proof: cheek_fullness / jaw_fullness /
jaw_to_cheek from facial-preference-runs/adiposity.py on parametric ovals.

The metric math is imported verbatim (measure()); only the landmark inputs
are synthetic. Geometry: smooth face outline with explicit half-width
profile h(y); bizygomatic half-width a fixed; stepped:
  H = forehead->chin height (eccentricity / roundness-as-short-wide)
  J = jaw half-width / a   (jaw squareness)
  F = midface fullness      (width at mouth-corner height)
"""
import sys, json, math
sys.path.insert(0, '/home/hatch/workspace/facial-preference-runs')
from adiposity import measure, OVAL, MOUTH_L, MOUTH_R, JAW_L, JAW_R
from types import SimpleNamespace

W = H_IMG = 1000

def pt(x, y):
    return SimpleNamespace(x=x, y=y)

def build_oval(a=0.14, H=0.36, J=0.75, F=0.5):
    cx, y_cheek = 0.5, 0.50
    y_top = y_cheek - 0.42 * H
    y_chin = y_cheek + 0.58 * H
    y_mouth = y_cheek + 0.16 * H
    y_jaw = y_cheek + 0.38 * H
    # half-width profile at control levels
    ctrl = [(y_top, 0.62 * a), (y_cheek, a), (y_mouth, a * (0.70 + 0.30 * F)),
            (y_jaw, a * J), (y_chin, 0.18 * a)]
    def hw(y):
        if y <= ctrl[0][0]: return ctrl[0][1]
        for (y0, w0), (y1, w1) in zip(ctrl, ctrl[1:]):
            if y0 <= y <= y1:
                t = (y - y0) / (y1 - y0)
                s = (1 - math.cos(t * math.pi)) / 2
                return w0 + s * (w1 - w0)
        return ctrl[-1][1]
    lm = {}
    per_side = len(OVAL) // 2
    ys = [y_top + (y_chin - y_top) * i / (per_side - 1) for i in range(per_side)]
    for s, idxs in ((-1, OVAL[:per_side]), (1, OVAL[per_side:])):
        for i, y in zip(idxs, ys):
            lm[i] = pt(cx + s * hw(y), y)
    lm[MOUTH_L] = pt(cx - 0.42 * a, y_mouth); lm[MOUTH_R] = pt(cx + 0.42 * a, y_mouth)
    lm[JAW_L] = pt(cx - a * J, y_jaw);       lm[JAW_R] = pt(cx + a * J, y_jaw)
    # anatomical landmarks must be pinned exactly — several of these indices
    # (234, 454, 172) also occur in OVAL and would otherwise sit at grid
    # positions instead of their anatomical positions (bizygo bug, 2026-09-13)
    lm[234] = pt(cx - a, y_cheek); lm[454] = pt(cx + a, y_cheek)  # CHEEK_L/R
    return lm

def slope(xs, ys):
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    return cov / vx if vx else 0.0

def mono(ys, d):
    return all((ys[i] - ys[i-1]) * d >= -1e-12 for i in range(1, len(ys)))

KEYS = ['cheek_fullness', 'jaw_fullness', 'jaw_to_cheek']
out = {'sweeps': {}, 'verdicts': []}

def sweep(name, param_vals, mk):
    rows = []
    for v in param_vals:
        r = measure(mk(v), W, H_IMG)
        rows.append({k: r[k] for k in KEYS})
    rec = {'param_values': param_vals}
    for k in KEYS:
        ys = [r[k] for r in rows]
        rec[k] = {'values': [round(y, 4) for y in ys],
                  'slope': round(slope(param_vals, ys), 4),
                  'mono_inc': mono(ys, 1), 'mono_dec': mono(ys, -1)}
    out['sweeps'][name] = rec
    return rec

# G1: eccentricity — H stepped, J/F fixed
g1 = sweep('G1_eccentricity_H', [0.30, 0.34, 0.38, 0.42, 0.46],
           lambda H: build_oval(H=H, J=0.75, F=0.5))
# G2: jaw width — J stepped
g2 = sweep('G2_jaw_J', [0.55, 0.65, 0.75, 0.85, 0.95],
           lambda J: build_oval(H=0.36, J=J, F=0.5))
# G3: midface fullness — F stepped
g3 = sweep('G3_midface_F', [0.0, 0.25, 0.5, 0.75, 1.0],
           lambda F: build_oval(H=0.36, J=0.75, F=F))

V = out['verdicts']
V.append('G1 (face height, a.k.a. roundness-as-short-wide): cheek_fullness slope '
         f"{g1['cheek_fullness']['slope']}, jaw_fullness slope {g1['jaw_fullness']['slope']} — "
         + ('BOTH FLAT: width/width ratios cannot see the height dimension of roundness.'
            if abs(g1['cheek_fullness']['slope']) < 0.05 and abs(g1['jaw_fullness']['slope']) < 0.05
            else 'UNEXPECTED height response — investigate.'))
V.append('G2 (jaw width): jaw_fullness ' +
         ('monotonic, slope %.2f (identity=1.0)' % g2['jaw_fullness']['slope']
          if g2['jaw_fullness']['mono_inc'] else 'NON-MONOTONIC ***') +
         '; cheek_fullness slope %.3f' % g2['cheek_fullness']['slope'] +
         (' (leaks jaw width into the PRIMARY metric)' if abs(g2['cheek_fullness']['slope']) > 0.05 else ' (clean separation)'))
V.append('G3 (midface fullness): cheek_fullness ' +
         ('monotonic, slope %.3f' % g3['cheek_fullness']['slope']
          if g3['cheek_fullness']['mono_inc'] else 'NON-MONOTONIC ***') +
         '; jaw_fullness slope %.3f' % g3['jaw_fullness']['slope'] +
         (' (leaks midface into jaw metric)' if abs(g3['jaw_fullness']['slope']) > 0.05 else ' (clean separation)'))

# ---- bank: frozen landmarks through the real measure() ----
dump = json.load(open('/home/hatch/workspace/attraction-guide/test/drift-harness/landmarks.json'))
faces = dump['faces']
def as_lm(f):
    return {i: pt(p['x'], p['y']) for i, p in enumerate(f['landmarks'])}
bank = {}
for f in faces:
    try:
        r = measure(as_lm(f), f['w'], f['h'])
        bank[f['id']] = {k: r[k] for k in KEYS}
    except Exception as e:
        bank[f['id']] = {'err': str(e)[:60]}

# controls: jaw-soft (positive) vs base vs jaw-sharp (negative)
trios = {}
for lin in ['p2a04', 'p2a05', 'p2a07', 'p2a09']:
    trios[lin] = {t: bank.get(lin + s) for t, s in
                  [('soft', '-jaw-soft'), ('base', ''), ('sharp', '-jaw-sharp')]}
soft_base = []
for f in faces:
    i = f['id']
    if i.endswith('-jaw-soft'):
        b = bank.get(i[:-9]); s = bank.get(i)
        if b and s and 'err' not in b and 'err' not in s:
            soft_base.append((i, {k: round(s[k] - b[k], 4) for k in KEYS}))
out['bank_controls'] = {'trios': trios,
                        'soft_vs_base': [{'id': i, 'd': d} for i, d in soft_base]}
for k in KEYS:
    ds = [d[k] for _, d in soft_base]
    npos = sum(1 for d in ds if d > 0)
    V.append(f'bank PY: jaw-soft vs base on {k}: {npos}/{len(ds)} positive, mean Δ {sum(ds)/len(ds):+.4f}.')

# convergent validity: PY cheek_fullness vs JS width_height_ratio, rank correlation
js = json.load(open('/home/hatch/workspace/attraction-guide/test/drift-harness/drift-report.json'))
# drift-report has no per-face metric values; recompute JS WHR quickly via node? -> use roundness-proof.json bank? not stored.
# fallback: rank correlation computed in the JS proof step instead. Record here that it is pending.
out['convergent_validity'] = 'pending: rank corr(cheek_fullness_PY, width_height_ratio_JS) over 155 — computed in JS step'

json.dump(out, open('/home/hatch/workspace/attraction-guide/test/drift-harness/roundness-proof-py.json', 'w'), indent=1)
json.dump({i: m for i, m in bank.items() if 'err' not in m},
          open('/home/hatch/workspace/attraction-guide/test/drift-harness/bank-adiposity.json', 'w'))
print('wrote roundness-proof-py.json + bank-adiposity.json')
for v in V: print('-', v)
print('\ntrio sample (p2a05):')
for t, m in trios['p2a05'].items():
    print(' ', t, {k: m[k] for k in KEYS} if m and 'err' not in m else m)
