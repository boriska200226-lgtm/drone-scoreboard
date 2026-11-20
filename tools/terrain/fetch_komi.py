#!/usr/bin/env python3
"""Готовит реальную местность Республики Коми для миссий «Северного дрона».

Для каждой миссии берётся настоящее место (широта/долгота) и квадрат вокруг него
в 1,5 раза больше карты миссии (в игре окно каждый вылет немного сдвигается внутри).

Источники (открытые данные):
  • рельеф — Terrain Tiles (AWS Open Data, формат terrarium; SRTM, GMTED, ETOPO и др.);
  • типы поверхности — ESA WorldCover 10 m 2021 v200 (CC BY 4.0).

Результат: public/sim/terrain/<id>.bin.gz
  'KOMI', u16 G, f32 сторона (м), f32 шаг высоты (м), затем G*G u16 высот (от нижнего уровня)
  и G*G u8 классов: 0 нет данных, 1 лес, 2 кустарник, 3 луг, 4 поле, 5 застройка, 6 голый грунт,
  7 снег, 8 вода, 9 болото, 10 мангры, 11 мох/лишайник (тундра).

Запуск: CURL_CA_BUNDLE=/path/ca.crt python3 tools/terrain/fetch_komi.py [id ...]
"""
import gzip, io, math, os, ssl, struct, sys, urllib.request
import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import from_bounds

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "sim", "terrain")
# id: (широта, долгота, сторона карты миссии в метрах, место)
SITES = {
    "training": (61.837, 50.648, 1400, "Сыктывдинский район, окрестности Выльгорта"),
    "fire": (62.722, 56.095, 1400, "Троицко-Печорский район"),
    "search": (63.662, 53.623, 1400, "окрестности Ухты"),
    "agro": (61.087, 50.121, 1400, "Сысольский район, поля у Визинги"),
    "delivery": (65.429, 52.072, 1700, "Усть-Цилемский район"),
    "powerline": (63.563, 53.931, 1400, "окрестности Сосногорска"),
    "oil": (66.048, 57.449, 1500, "Усинский район, болота"),
    "reindeer": (66.303, 60.364, 1500, "тундра под Интой"),
    "heat": (61.797, 50.750, 1400, "Эжва, Сыктывкар"),
    "icejam": (65.398, 52.304, 1500, "Печора у Усть-Цильмы"),
    "logging": (61.852, 51.838, 1400, "Корткеросский район"),
    "gas": (63.877, 57.255, 1400, "Вуктыльское месторождение"),
    "floe": (61.698, 50.757, 1500, "Вычегда у Сыктывкара"),
    "aed": (62.550, 50.896, 1600, "трасса Сыктывкар — Ухта"),
    "post": (65.258, 52.029, 1500, "сёла Усть-Цилемского района"),
    "mapping": (61.169, 50.313, 1400, "Сысольский район"),
    "ticks": (61.613, 50.686, 1400, "сосновый бор под Сыктывкаром"),
    "bear": (62.430, 50.922, 1400, "окрестности посёлка Едва"),
    "patrol": (61.712, 53.752, 3600, "Усть-Куломский район"),
    "sling": (66.032, 58.001, 4400, "Усинский район, месторождения"),
}
WC_CLASS = {10: 1, 20: 2, 30: 3, 40: 4, 50: 5, 60: 6, 70: 7, 80: 8, 90: 9, 95: 10, 100: 11}

ctx = ssl.create_default_context(cafile=os.environ.get("CURL_CA_BUNDLE"))
tile_cache = {}


def get_tile(z, x, y):
    k = (z, x, y)
    if k not in tile_cache:
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
        with urllib.request.urlopen(url, context=ctx, timeout=60) as r:
            im = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB")).astype(np.float64)
        tile_cache[k] = im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
    return tile_cache[k]


def elevation(lat, lon, z):
    """Высота в точках (массивы lat/lon), билинейно по тайлам terrarium."""
    n = 2 ** z
    xf = (lon + 180) / 360 * n * 256
    lr = np.radians(lat)
    yf = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n * 256
    out = np.zeros_like(lat)
    x0, y0 = np.floor(xf - 0.5).astype(int), np.floor(yf - 0.5).astype(int)
    fx, fy = xf - 0.5 - x0, yf - 0.5 - y0

    def px(X, Y):
        r = np.zeros(X.shape)
        tx, ty = X // 256, Y // 256
        for key in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
            m = (tx == key[0]) & (ty == key[1])
            t = get_tile(z, key[0], key[1])
            r[m] = t[Y[m] - key[1] * 256, X[m] - key[0] * 256]
        return r

    out = (px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy)
           + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy)
    return out


def landcover(lat, lon):
    """Класс поверхности ESA WorldCover в точках (ближайший пиксель 10 м)."""
    out = np.zeros(lat.shape, np.uint8)
    la0, la1, lo0, lo1 = lat.min(), lat.max(), lon.min(), lon.max()
    for tla in range(int(math.floor(la0 / 3) * 3), int(math.floor(la1 / 3) * 3) + 1, 3):
        for tlo in range(int(math.floor(lo0 / 3) * 3), int(math.floor(lo1 / 3) * 3) + 1, 3):
            name = f"ESA_WorldCover_10m_2021_v200_N{tla:02d}E{tlo:03d}_Map.tif"
            url = f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{name}"
            m = (lat >= tla) & (lat < tla + 3) & (lon >= tlo) & (lon < tlo + 3)
            if not m.any():
                continue
            with rasterio.open(url) as ds:
                w = from_bounds(max(lo0, tlo) - 0.001, max(la0, tla) - 0.001, min(lo1, tlo + 3) + 0.001, min(la1, tla + 3) + 0.001, ds.transform)
                w = w.round_offsets().round_lengths()
                a = ds.read(1, window=w)
                tr = ds.window_transform(w)
            col = np.clip(((lon[m] - tr.c) / tr.a).astype(int), 0, a.shape[1] - 1)
            row = np.clip(((lat[m] - tr.f) / tr.e).astype(int), 0, a.shape[0] - 1)
            out[m] = a[row, col]
    return np.vectorize(lambda c: WC_CLASS.get(int(c), 0), otypes=[np.uint8])(out)


def build(mid):
    lat0, lon0, size, place = SITES[mid]
    side = size * 1.5
    G = 384 if size <= 1800 else 512
    s = (np.arange(G) / (G - 1) - 0.5) * side  # метры от центра
    X, Z = np.meshgrid(s, s)  # X — на восток, Z — на юг (как в игре: север = −Z)
    lat = lat0 - Z / 110574.0
    lon = lon0 + X / (111320.0 * math.cos(math.radians(lat0)))
    zoom = 14 if side / G < 7 else 13
    h = elevation(lat, lon, zoom)
    cls = landcover(lat, lon)
    lo = np.percentile(h, 1)
    step = 0.05
    hq = np.clip((h - lo) / step, 0, 65535).astype("<u2")
    os.makedirs(OUT, exist_ok=True)
    buf = b"KOMI" + struct.pack("<Hff", G, side, step) + hq.tobytes() + cls.astype(np.uint8).tobytes()
    with gzip.open(os.path.join(OUT, f"{mid}.bin.gz"), "wb", compresslevel=9) as f:
        f.write(buf)
    hist = {k: round(float((cls == v).mean()) * 100, 1) for k, v in [("лес", 1), ("кусты", 2), ("луг", 3), ("поле", 4), ("застр", 5), ("вода", 8), ("болото", 9), ("тундра", 11)]}
    print(f"{mid:10s} {place}: перепад {h.max() - lo:.0f} м, сетка {G}, {hist}", flush=True)


if __name__ == "__main__":
    for mid in sys.argv[1:] or SITES:
        build(mid)
