#!/usr/bin/env python3
"""Подбор мест для миссий: просматривает окрестности точки по ESA WorldCover (с обзорных уровней COG)
и печатает лучший квадрат под требования миссии. Результат вносится в SITES в fetch_komi.py."""
import math, sys
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

# id: (широта, долгота, сторона карты м, требования {класс: (мин, макс)})
F, SH, GR, CR, BU, WA, BOG, MOSS = 10, 20, 30, 40, 50, 80, 90, 100
REQ = {
    "training": (61.83, 50.62, 1400, {F: (0.35, 0.8), WA: (0, 0.04), BU: (0, 0.05)}),
    "fire": (62.72, 56.10, 1400, {F: (0.85, 1), WA: (0, 0.03)}),
    "search": (63.66, 53.62, 1400, {F: (0.85, 1), WA: (0, 0.03), BOG: (0.0, 0.15)}),
    "agro": (61.09, 50.08, 1400, {CR: (0.25, 1), F: (0.1, 0.6), WA: (0, 0.03)}),
    "delivery": (65.44, 52.10, 1700, {F: (0.4, 0.85), BOG: (0.05, 0.4), WA: (0, 0.05)}),
    "powerline": (63.57, 53.95, 1400, {F: (0.6, 0.95), WA: (0, 0.03), BU: (0, 0.05)}),
    "oil": (66.05, 57.45, 1500, {BOG: (0.3, 0.8), F: (0.1, 0.5), WA: (0, 0.06)}),
    "reindeer": (66.30, 60.30, 1500, {F: (0, 0.12), WA: (0, 0.07), BOG: (0, 0.6)}),
    "heat": (61.80, 50.92, 1400, {BU: (0.3, 1), WA: (0, 0.05)}),
    "icejam": (65.40, 52.30, 1500, {F: (0.3, 0.85), WA: (0, 0.06)}),
    "logging": (61.85, 51.85, 1400, {F: (0.9, 1), WA: (0, 0.02)}),
    "gas": (63.88, 57.25, 1400, {F: (0.6, 0.95), BOG: (0.02, 0.3), WA: (0, 0.03)}),
    "floe": (61.70, 50.73, 1500, {F: (0.3, 0.85), WA: (0, 0.06), BU: (0, 0.05)}),
    "aed": (62.55, 50.90, 1600, {F: (0.6, 0.95), WA: (0, 0.03)}),
    "post": (65.28, 52.05, 1500, {F: (0.3, 0.8), GR: (0.05, 0.5), WA: (0, 0.05)}),
    "mapping": (61.20, 50.32, 1400, {CR: (0.1, 0.7), GR: (0.05, 0.7), WA: (0, 0.03)}),
    "ticks": (61.62, 50.66, 1400, {F: (0.6, 0.95), WA: (0, 0.03), BU: (0, 0.08)}),
    "bear": (62.40, 50.95, 1400, {F: (0.6, 0.95), WA: (0, 0.03)}),
    "patrol": (61.70, 53.70, 3600, {F: (0.8, 1), WA: (0, 0.03), BOG: (0.0, 0.12)}),
    "sling": (66.12, 57.85, 4400, {BOG: (0.2, 0.7), F: (0.1, 0.6), WA: (0, 0.05)}),
}


def read_region(la0, la1, lo0, lo1, res=40.0):
    """Классы на сетке ~res м в прямоугольнике (несколько тайлов 3°×3°)."""
    H = int((la1 - la0) * 110574 / res); W = int((lo1 - lo0) * 111320 * math.cos(math.radians((la0 + la1) / 2)) / res)
    out = np.zeros((H, W), np.uint8)
    lat = la1 - (np.arange(H) + 0.5) / H * (la1 - la0)
    lon = lo0 + (np.arange(W) + 0.5) / W * (lo1 - lo0)
    LON, LAT = np.meshgrid(lon, lat)
    for tla in range(int(la0 // 3 * 3), int(la1 // 3 * 3) + 1, 3):
        for tlo in range(int(lo0 // 3 * 3), int(lo1 // 3 * 3) + 1, 3):
            m = (LAT >= tla) & (LAT < tla + 3) & (LON >= tlo) & (LON < tlo + 3)
            if not m.any():
                continue
            url = f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{tla:02d}E{tlo:03d}_Map.tif"
            with rasterio.open(url) as ds:
                b = (max(lo0, tlo), max(la0, tla), min(lo1, tlo + 3), min(la1, tla + 3))
                w = from_bounds(*b, ds.transform).round_offsets().round_lengths()
                h = max(1, int(w.height * 10 / res)); ww = max(1, int(w.width * 10 / res))
                a = ds.read(1, window=w, out_shape=(h, ww), resampling=Resampling.nearest)
            col = np.clip(((LON[m] - b[0]) / (b[2] - b[0]) * ww).astype(int), 0, ww - 1)
            row = np.clip(((b[3] - LAT[m]) / (b[3] - b[1]) * h).astype(int), 0, h - 1)
            out[m] = a[row, col]
    return out, lat, lon


def scan(mid):
    lat0, lon0, size, req = REQ[mid]
    dla, dlo = 0.12, 0.25
    cls, lat, lon = read_region(lat0 - dla, lat0 + dla, lon0 - dlo, lon0 + dlo)
    res = 40.0
    win = int(size * 1.5 / res)
    best = None
    for i in range(0, cls.shape[0] - win, max(1, win // 4)):
        for j in range(0, cls.shape[1] - win, max(1, win // 4)):
            c = cls[i:i + win, j:j + win]
            fr = {k: float((c == k).mean()) for k in req}
            # штраф: насколько доля выходит за требования; бонус за близость к исходной точке
            pen = sum(max(0, lo - fr[k]) + max(0, fr[k] - hi) for k, (lo, hi) in req.items())
            la, lo = lat[i + win // 2], lon[j + win // 2]
            pen += 0.02 * math.hypot(la - lat0, (lo - lon0) * 0.45) / 0.1
            if best is None or pen < best[0]:
                best = (pen, la, lo, fr)
    pen, la, lo, fr = best
    print(f'    "{mid}": ({la:.3f}, {lo:.3f}),  # штраф {pen:.3f}', {k: round(v, 2) for k, v in fr.items()}, flush=True)


if __name__ == "__main__":
    for mid in sys.argv[1:] or REQ:
        scan(mid)
