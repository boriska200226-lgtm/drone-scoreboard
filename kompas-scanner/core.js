// Ядро обработки: геометрия, распознавание листа, контуров, аппроксимация
// линиями/дугами и экспорт в DXF/SVG. Без зависимостей, работает и в браузере, и в Node.

// ───────────────────────── Линейная алгебра ─────────────────────────

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('Вырожденная система');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      if (k === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Гомография 3x3 (массив из 9, построчно), переводящая src[i] → dst[i]. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ───────────────────────── Изображение ─────────────────────────

export function rgbaToGray(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4)
    g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

export function otsu(values, mask) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    hist[Math.max(0, Math.min(255, Math.round(values[i])))]++; n++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th + 0.5;
}

function sampleBilinear(g, w, h, x, y) {
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

function downscale(g, w, h, maxSide) {
  const s = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const dw = Math.floor(w / s), dh = Math.floor(h / s);
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      for (let yy = 0; yy < s; yy++) {
        const row = (y * s + yy) * w + x * s;
        for (let xx = 0; xx < s; xx++) acc += g[row + xx];
      }
      out[y * dw + x] = acc / (s * s);
    }
  return { data: out, w: dw, h: dh, s };
}

// ───────────────────────── Поиск листа ─────────────────────────

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Четырёхугольник максимальной площади на выпуклой оболочке (поворотные «калиперы», упрощённо). */
function maxAreaQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  const step = Math.max(1, Math.floor(n / 60));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  const area = (a, b, c, d) => {
    const P = [hull[a], hull[b], hull[c], hull[d]];
    let s = 0;
    for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4]; s += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(s) / 2;
  };
  let best = -1, bq = null;
  const m = idx.length;
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++)
      for (let c = b + 1; c < m; c++)
        for (let d = c + 1; d < m; d++) {
          const s = area(idx[a], idx[b], idx[c], idx[d]);
          if (s > best) { best = s; bq = [idx[a], idx[b], idx[c], idx[d]]; }
        }
  // локальное уточнение по всем точкам оболочки
  let improved = true;
  while (improved) {
    improved = false;
    for (let k = 0; k < 4; k++)
      for (const dlt of [-1, 1]) {
        const q = bq.slice(); q[k] = (q[k] + dlt + n) % n;
        const s = area(...q);
        if (s > best + 1e-9) { best = s; bq = q; improved = true; }
      }
  }
  return bq.map(i => hull[i]);
}

/** Упорядочить углы: по часовой (в координатах экрана), начиная с верхнего левого. */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const s = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0;
  for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
  return [0, 1, 2, 3].map(i => s[(k + i) % 4]);
}

/** Автоматический поиск светлого листа бумаги. Возвращает 4 угла в пикселях исходного фото или null. */
export function detectSheet(gray, w, h) {
  const d = downscale(gray, w, h, 900);
  const { data, w: dw, h: dh, s } = d;
  const th = otsu(data);
  const mask = new Uint8Array(dw * dh);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i] > th ? 1 : 0;
  // крупнейшая 4-связная светлая область
  const lab = new Int32Array(dw * dh);
  let bestL = 0, bestA = 0, L = 0;
  const stack = new Int32Array(dw * dh);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i]) continue;
    L++; let sp = 0, a = 0; stack[sp++] = i; lab[i] = L;
    while (sp) {
      const p = stack[--sp]; a++;
      const x = p % dw, y = (p / dw) | 0;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = L; stack[sp++] = p - 1; }
      if (x < dw - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = L; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - dw] && !lab[p - dw]) { lab[p - dw] = L; stack[sp++] = p - dw; }
      if (y < dh - 1 && mask[p + dw] && !lab[p + dw]) { lab[p + dw] = L; stack[sp++] = p + dw; }
    }
    if (a > bestA) { bestA = a; bestL = L; }
  }
  if (bestA < dw * dh * 0.05) return null;
  const pts = [];
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const p = y * dw + x;
      if (lab[p] !== bestL) continue;
      if (x === 0 || y === 0 || x === dw - 1 || y === dh - 1 ||
        lab[p - 1] !== bestL || lab[p + 1] !== bestL || lab[p - dw] !== bestL || lab[p + dw] !== bestL)
        pts.push([x + 0.5, y + 0.5]);
    }
  const hull = convexHull(pts);
  const q = maxAreaQuad(hull);
  if (!q) return null;
  const corners = orderCorners(q.map(([x, y]) => [x * s, y * s]));
  return refineCorners(gray, w, h, corners) || corners;
}

function fitLineTLS(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  return { p: [mx, my], d: [dx, dy], n: [-dy, dx] };
}

function intersectLines(l1, l2) {
  const [x1, y1] = l1.p, [dx1, dy1] = l1.d, [x2, y2] = l2.p, [dx2, dy2] = l2.d;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
  return [x1 + t * dx1, y1 + t * dy1];
}

/**
 * Субпиксельное уточнение углов листа: по каждой стороне ищем перепад яркости
 * вдоль нормали, вписываем прямую и пересекаем соседние прямые.
 */
export function refineCorners(gray, w, h, corners) {
  const cx = corners.reduce((s, p) => s + p[0], 0) / 4, cy = corners.reduce((s, p) => s + p[1], 0) / 4;
  const lines = [];
  let resid = 0, nres = 0;
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) % 4];
    const len = dist(a, b);
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    let nx = -dy, ny = dx;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((cx - mid[0]) * nx + (cy - mid[1]) * ny < 0) { nx = -nx; ny = -ny; } // нормаль внутрь листа
    const R = Math.max(10, len * 0.02);
    const found = [];
    const N = 60;
    for (let i = 0; i < N; i++) {
      const t = 0.1 + 0.8 * i / (N - 1);
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      const prof = [];
      for (let s = -R; s <= R; s += 0.5) prof.push(sampleBilinear(gray, w, h, px + nx * s, py + ny * s));
      const q = Math.max(3, Math.floor(prof.length / 5));
      const outside = prof.slice(0, q).sort((u, v) => u - v)[q >> 1];
      const inside = prof.slice(-q).sort((u, v) => u - v)[q >> 1];
      if (inside - outside < 25) continue;
      const lvl = (inside + outside) / 2;
      // ближайшее к центру профиля пересечение уровня
      let bestS = null, bestD = Infinity;
      for (let j = 0; j < prof.length - 1; j++) {
        if ((prof[j] - lvl) * (prof[j + 1] - lvl) <= 0 && prof[j + 1] !== prof[j]) {
          const sj = -R + 0.5 * (j + (lvl - prof[j]) / (prof[j + 1] - prof[j]));
          if (Math.abs(sj) < bestD) { bestD = Math.abs(sj); bestS = sj; }
        }
      }
      if (bestS !== null) found.push([px + nx * bestS, py + ny * bestS]);
    }
    if (found.length < 10) return null;
    let L = fitLineTLS(found);
    for (let it = 0; it < 2; it++) {
      const r = found.map(p => Math.abs((p[0] - L.p[0]) * L.n[0] + (p[1] - L.p[1]) * L.n[1]));
      const sorted = r.slice().sort((u, v) => u - v);
      const lim = Math.max(0.7, 3 * sorted[sorted.length >> 1]);
      const inl = found.filter((_, i) => r[i] <= lim);
      if (inl.length < 8) break;
      L = fitLineTLS(inl);
      if (it === 1) { for (const p of inl) { resid += ((p[0] - L.p[0]) * L.n[0] + (p[1] - L.p[1]) * L.n[1]) ** 2; nres++; } }
    }
    lines.push(L);
  }
  const out = [];
  for (let k = 0; k < 4; k++) {
    const p = intersectLines(lines[(k + 3) % 4], lines[k]);
    if (!p || dist(p, corners[k]) > Math.max(w, h) * 0.05) return null;
    out.push(p);
  }
  out.rms = nres ? Math.sqrt(resid / nres) : null;
  return out;
}

/** Определить, какая сторона листа длинная, и вернуть размеры в порядке (ширина вдоль TL→TR, высота вдоль TR→BR). */
export function sheetSizeForCorners(corners, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const s1 = dist(corners[0], corners[1]) + dist(corners[2], corners[3]);
  const s2 = dist(corners[1], corners[2]) + dist(corners[3], corners[0]);
  return s1 >= s2 ? { W: hi, H: lo } : { W: lo, H: hi };
}

// ───────────────────────── Положение камеры и параллакс ─────────────────────────

/** Оценка фокусного (в пикселях) по гомографии при известной главной точке. null, если сьёмка почти фронтальная. */
export function estimateFocal(H, cx, cy) {
  const T = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const M = mul3(T, H);
  const h11 = M[0], h12 = M[1], h21 = M[3], h22 = M[4], h31 = M[6], h32 = M[7];
  const eqs = [
    [h11 * h12 + h21 * h22, h31 * h32],
    [h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22, h31 * h31 - h32 * h32],
  ];
  let num = 0, den = 0;
  for (const [a, b] of eqs) { num += a * b; den += b * b; }
  if (den < 1e-20) return null;
  const f2 = -num / den;
  return f2 > 0 ? Math.sqrt(f2) : null;
}

/** Положение камеры относительно листа. H: мм листа → пиксели. */
export function cameraPose(H, f, cx, cy) {
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1];
  const M = mul3(inv3(K), H);
  const c0 = [M[0], M[3], M[6]], c1 = [M[1], M[4], M[7]], c2 = [M[2], M[5], M[8]];
  const n0 = Math.hypot(...c0), n1 = Math.hypot(...c1);
  let lam = 2 / (n0 + n1);
  if (c2[2] * lam < 0) lam = -lam;
  const r1 = c0.map(v => v * lam), r2 = c1.map(v => v * lam), t = c2.map(v => v * lam);
  let r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const n3 = Math.hypot(...r3); r3 = r3.map(v => v / n3);
  // C = -Rᵀ t
  const C = [
    -(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]),
    -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]),
    -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]),
  ];
  const tilt = Math.acos(Math.min(1, Math.abs(r3[2]))) * 180 / Math.PI;
  return { K, r1, r2, r3, t, C, nadir: [C[0], C[1]], distance: Math.abs(C[2]), tilt };
}

/** Преобразование координат (мм) на плоскости листа в координаты (мм) на плоскости, поднятой на h. */
export function heightCorrection(H, pose, h) {
  if (!h) return null;
  const { K, r1, r2, r3, t, C } = pose;
  const s = Math.sign(C[2]) || 1;
  const c3 = [0, 1, 2].map(i => s * h * r3[i] + t[i]);
  const Hh = mul3(K, [r1[0], r2[0], c3[0], r1[1], r2[1], c3[1], r1[2], r2[2], c3[2]]);
  return mul3(inv3(Hh), H);
}

// ───────────────────────── Выпрямление листа ─────────────────────────

/** Ортофото листа: ppm пикселей на мм. Hmm2img: мм листа → пиксели фото. */
export function rectify(gray, w, h, Hmm2img, Wmm, Hmm, ppm) {
  const rw = Math.round(Wmm * ppm), rh = Math.round(Hmm * ppm);
  const out = new Uint8ClampedArray(rw * rh);
  const H = Hmm2img;
  for (let j = 0; j < rh; j++) {
    const Y = (j + 0.5) / ppm;
    for (let i = 0; i < rw; i++) {
      const X = (i + 0.5) / ppm;
      const wq = H[6] * X + H[7] * Y + H[8];
      const x = (H[0] * X + H[1] * Y + H[2]) / wq, y = (H[3] * X + H[4] * Y + H[5]) / wq;
      out[j * rw + i] = sampleBilinear(gray, w, h, x, y);
    }
  }
  return { data: out, w: rw, h: rh, ppm };
}

// ───────────────────────── Контуры ─────────────────────────

function blur3(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i;
      tmp[i] = (src[l] + 2 * src[i] + src[r]) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, u = y > 0 ? i - w : i, d = y < h - 1 ? i + w : i;
      out[i] = (tmp[u] + 2 * tmp[i] + tmp[d]) / 4;
    }
  return out;
}

function morph(mask, w, h, r, dilate) {
  // квадратное окно (2r+1)², раздельно по осям
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const m = xx < 0 || xx >= w ? 0 : mask[y * w + xx];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const m = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  return out;
}

function labelComponents(mask, w, h, value, conn8) {
  const lab = new Int32Array(w * h), areas = [0], touches = [false];
  const stack = new Int32Array(w * h);
  let L = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== value || lab[i]) continue;
    L++; let sp = 0, a = 0, t = false; stack[sp++] = i; lab[i] = L;
    while (sp) {
      const p = stack[--sp]; a++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) t = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!conn8 && dx && dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (mask[q] === value && !lab[q]) { lab[q] = L; stack[sp++] = q; }
        }
    }
    areas.push(a); touches.push(t);
  }
  return { lab, areas, touches };
}

function polyArea(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Поиск контуров деталей на ортофото листа (тёмная деталь на светлом листе).
 * Возвращает петли в мм (координаты листа) и порог.
 */
export function extractContours(rect, opts = {}) {
  const { data, w, h, ppm } = rect;
  const marginPx = Math.round((opts.marginMm ?? 4) * ppm);
  const minAreaPx = (opts.minAreaMm2 ?? 15) * ppm * ppm;
  const minHolePx = (opts.minHoleMm2 ?? 0.8) * ppm * ppm;
  const invert = !!opts.lightObject;
  const g = blur3(data, w, h);
  if (invert) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  const inner = new Uint8Array(w * h);
  for (let y = marginPx; y < h - marginPx; y++) for (let x = marginPx; x < w - marginPx; x++) inner[y * w + x] = 1;
  const T = opts.threshold ?? otsu(g, inner);

  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = inner[i] && g[i] < T ? 1 : 0;
  mask = morph(morph(mask, w, h, 1, false), w, h, 1, true); // открытие — убрать крошки
  mask = morph(morph(mask, w, h, 1, true), w, h, 1, false); // закрытие — залатать щели
  for (let i = 0; i < mask.length; i++) mask[i] &= inner[i];

  const fg = labelComponents(mask, w, h, 1, true);
  for (let i = 0; i < mask.length; i++) if (mask[i] && fg.areas[fg.lab[i]] < minAreaPx) mask[i] = 0;
  const bg = labelComponents(mask, w, h, 0, false);
  for (let i = 0; i < mask.length; i++) {
    const l = bg.lab[i];
    if (!mask[i] && !bg.touches[l] && bg.areas[l] < minHolePx) mask[i] = 1;
  }

  // поле для изолиний: в полосе у границы — реальная яркость (субпиксель), вне — насыщено
  const dil = morph(mask, w, h, 2, true), ero = morph(mask, w, h, 2, false);
  const W2 = w + 2, H2 = h + 2;
  const F = new Float32Array(W2 * H2).fill(255);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v;
      if (!inner[i]) v = 255;
      else if (ero[i]) v = 0;
      else if (dil[i]) v = g[i];
      else v = 255;
      F[(y + 1) * W2 + x + 1] = v;
    }

  const loops = marchingSquares(F, W2, H2, T).map(l => l.map(([x, y]) => [x / ppm, y / ppm]));
  // пиксель (x+1) поля соответствует пикселю x ортофото с центром (x+0.5)/ppm → сдвиг -0.5/ppm
  for (const l of loops) for (const p of l) { p[0] -= 0.5 / ppm; p[1] -= 0.5 / ppm; }

  const minLoopArea = Math.min(minAreaPx, minHolePx) / (ppm * ppm) * 0.5;
  const kept = loops.filter(l => l.length >= 8 && Math.abs(polyArea(l)) >= minLoopArea);
  const res = kept.map((pts, i) => {
    let depth = 0;
    for (let j = 0; j < kept.length; j++) if (j !== i && pointInPoly(pts[0], kept[j])) depth++;
    return { pts, hole: depth % 2 === 1, area: Math.abs(polyArea(pts)) };
  });
  return { loops: res, threshold: T, mask, w, h };
}

/** Изолинии уровня T на сетке (замкнутые, т.к. граница поля = фон). */
export function marchingSquares(F, w, h, T) {
  const nb = new Map(); // ключ ребра → {p, n:[]}
  const keyH = (x, y) => (y * w + x) * 2;     // ребро (x,y)-(x+1,y)
  const keyV = (x, y) => (y * w + x) * 2 + 1; // ребро (x,y)-(x,y+1)
  const pt = (k) => {
    const e = k & 1, c = k >> 1, x = c % w, y = (c / w) | 0;
    const a = F[c], b = e ? F[c + w] : F[c + 1];
    const t = (T - a) / (b - a);
    return e ? [x, y + t] : [x + t, y];
  };
  const link = (k1, k2) => {
    let a = nb.get(k1); if (!a) { a = []; nb.set(k1, a); } a.push(k2);
    let b = nb.get(k2); if (!b) { b = []; nb.set(k2, b); } b.push(k1);
  };
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const tl = F[i] < T, tr = F[i + 1] < T, bl = F[i + w] < T, br = F[i + w + 1] < T;
      if (tl === tr && tl === bl && tl === br) continue;
      const top = keyH(x, y), bot = keyH(x, y + 1), left = keyV(x, y), right = keyV(x + 1, y);
      if (tl === br && tr === bl && tl !== tr) {
        const centerIn = (F[i] + F[i + 1] + F[i + w] + F[i + w + 1]) / 4 < T;
        if (centerIn === tl) { link(top, right); link(bot, left); }
        else { link(left, top); link(right, bot); }
        continue;
      }
      const e = [];
      if (tl !== tr) e.push(top);
      if (tr !== br) e.push(right);
      if (bl !== br) e.push(bot);
      if (tl !== bl) e.push(left);
      link(e[0], e[1]);
    }
  const seen = new Set(), loops = [];
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur); loop.push(pt(cur));
      const n = nb.get(cur);
      const next = n[0] !== prev ? n[0] : n[1];
      prev = cur; cur = next;
      if (cur === undefined) break;
    }
    // убрать вырожденные (совпадающие) точки
    const clean = loop.filter((p, j) => j === 0 || dist(p, loop[j - 1]) > 1e-6);
    if (clean.length >= 3) loops.push(clean);
  }
  return loops;
}

// ───────────────────────── Аппроксимация: отрезки, дуги, окружности ─────────────────────────

export function fitCircle(pts) {
  // алгебраический метод Каса + уточнение Гаусса–Ньютона
  let sx = 0, sy = 0, n = pts.length;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  let cx = (b1 * svv - b2 * suv) / det + mx, cy = (suu * b2 - suv * b1) / det + my;
  let r = 0;
  for (let it = 0; it < 10; it++) {
    let rs = 0;
    const ds = pts.map(p => { const d = Math.hypot(p[0] - cx, p[1] - cy); rs += d; return d; });
    r = rs / n;
    let gx = 0, gy = 0;
    for (let k = 0; k < n; k++) {
      const p = pts[k], d = ds[k] || 1e-9;
      gx += (p[0] - cx) / d; gy += (p[1] - cy) / d;
    }
    const ncx = mx - r * gx / n, ncy = my - r * gy / n;
    const moved = Math.hypot(ncx - cx, ncy - cy);
    cx = ncx; cy = ncy;
    if (moved < 1e-7) break;
  }
  r = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r));
  return { c: [cx, cy], r, maxDev };
}

function smoothLoop(p, iters = 1) {
  let a = p;
  for (let k = 0; k < iters; k++) {
    const n = a.length;
    a = a.map((q, i) => {
      const u = a[(i - 1 + n) % n], v = a[(i + 1) % n];
      return [(u[0] + 2 * q[0] + v[0]) / 4, (u[1] + 2 * q[1] + v[1]) / 4];
    });
  }
  return a;
}

/** Окружность через a и b, центр на серединном перпендикуляре; МНК по точкам pts[i..j]. */
function fitArcThrough(P, i, j) {
  const a = P[i], b = P[j];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const ch = dist(a, b);
  if (ch < 1e-9) return null;
  const ux = -(b[1] - a[1]) / ch, uy = (b[0] - a[0]) / ch;
  // начальное приближение — по средней точке
  const m = P[(i + j) >> 1];
  const c3 = circle3(a, m, b);
  if (!c3) return null;
  let s = (c3[0] - mx) * ux + (c3[1] - my) * uy;
  const E = (s) => {
    const cx = mx + s * ux, cy = my + s * uy, r = Math.hypot(a[0] - cx, a[1] - cy);
    let e = 0;
    for (let k = i + 1; k < j; k++) { const d = Math.hypot(P[k][0] - cx, P[k][1] - cy) - r; e += d * d; }
    return e;
  };
  // одномерная оптимизация (Ньютон с численными производными)
  for (let it = 0; it < 20; it++) {
    const hs = Math.max(1e-4, Math.abs(s) * 1e-4);
    const e0 = E(s), e1 = E(s + hs), e2 = E(s - hs);
    const d1 = (e1 - e2) / (2 * hs), d2 = (e1 - 2 * e0 + e2) / (hs * hs);
    if (!(d2 > 0)) break;
    const step = -d1 / d2;
    s += step;
    if (Math.abs(step) < 1e-7) break;
  }
  const cx = mx + s * ux, cy = my + s * uy, r = Math.hypot(a[0] - cx, a[1] - cy);
  return { c: [cx, cy], r };
}

function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
  (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

/** Упрощение Дугласа–Пекера (индексы опорных точек незамкнутой ломаной). */
function rdpIdx(P, i0, i1, eps, out) {
  const a = P[i0], b = P[i1], L = dist(a, b) || 1e-12;
  let md = -1, mi = -1;
  for (let k = i0 + 1; k < i1; k++) {
    const d = Math.abs((P[k][0] - a[0]) * (b[1] - a[1]) - (P[k][1] - a[1]) * (b[0] - a[0])) / L;
    if (d > md) { md = d; mi = k; }
  }
  if (md > eps) { rdpIdx(P, i0, mi, eps, out); out.push(mi); rdpIdx(P, mi, i1, eps, out); }
}

function lineFromPts(P, i, j) {
  const pts = P.slice(i, j + 1);
  return fitLineTLS(pts);
}
const lineDist = (L, p) => (p[0] - L.p[0]) * L.n[0] + (p[1] - L.p[1]) * L.n[1];
const footOnLine = (L, p) => { const d = lineDist(L, p); return [p[0] - d * L.n[0], p[1] - d * L.n[1]]; };

function lineCircle(L, c, r) {
  const f = footOnLine(L, c), d = dist(f, c);
  if (d > r) return [];
  const h = Math.sqrt(r * r - d * d);
  return [[f[0] + h * L.d[0], f[1] + h * L.d[1]], [f[0] - h * L.d[0], f[1] - h * L.d[1]]];
}
function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ex = (c2[0] - c1[0]) / d, ey = (c2[1] - c1[1]) / d;
  const mx = c1[0] + a * ex, my = c1[1] + a * ey;
  return [[mx - h * ey, my + h * ex], [mx + h * ey, my - h * ex]];
}
const nearest = (cands, p) => cands.reduce((b, q) => (!b || dist(q, p) < dist(b, p) ? q : b), null);

/**
 * Аппроксимация замкнутого контура отрезками и дугами с допуском tol (мм):
 *  1) оптимальное разбиение (динамическое программирование: минимум элементов, затем минимум ошибки);
 *  2) уточнение каждого элемента МНК по «внутренним» точкам;
 *  3) пересчёт стыков (пересечения / точки касания, скругления касаются обеих сторон).
 * Соседние элементы имеют общие концевые точки → контур остаётся замкнутым в КОМПАС.
 */
export function fitLoop(rawPts, tol = 0.1, opts = {}) {
  const pts = smoothLoop(rawPts, 1);
  const n = pts.length;

  const circ = fitCircle(pts);
  if (circ && circ.maxDev <= tol && circ.r < 2000) {
    let r = circ.r;
    if (opts.snapDia) r = Math.round(r * 2 / opts.snapDia) * opts.snapDia / 2;
    return [{ type: 'circle', c: circ.c, r }];
  }

  // старт — в самом остром углу
  const wdw = 4;
  let start = 0, bestTurn = 0;
  for (let k = 0; k < n; k++) {
    const a = pts[(k - wdw + n) % n], b = pts[k], c = pts[(k + wdw) % n];
    const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    const turn = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y));
    if (turn > bestTurn) { bestTurn = turn; start = k; }
  }
  let res = segmentLoop(pts, start, tol);
  if (res.segs.length > 1) {
    // повторить, начав с настоящего стыка элементов (а не с середины скругления)
    const s2 = (start + res.segs[0].j) % n;
    res = segmentLoop(pts, s2, tol);
  }
  return refineSegments(res.P, res.segs, tol);
}

function segmentLoop(pts, start, tol) {
  const P = pts.slice(start).concat(pts.slice(0, start));
  P.push(P[0]);
  const end = P.length - 1;

  // кандидаты в точки разбиения
  let eps = tol / 3, cand;
  for (let it = 0; it < 6; it++) {
    const idx = [];
    let far = 1;
    for (let k = 1; k < end; k++) if (dist(P[k], P[0]) > dist(P[far], P[0])) far = k;
    rdpIdx(P, 0, far, eps, idx); idx.push(far); rdpIdx(P, far, end, eps, idx);
    cand = [0, ...idx, end];
    if (cand.length <= 400) break;
    eps *= 1.6;
  }

  const lineFit = (i, j) => {
    const a = P[i], b = P[j], L = dist(a, b);
    if (L < 1e-9) return null;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, dx = ny, dy = -nx;
    let ss = 0;
    for (let k = i + 1; k < j; k++) {
      const px = P[k][0] - a[0], py = P[k][1] - a[1];
      const d = px * nx + py * ny;
      if (Math.abs(d) > tol) return null;
      const t = px * dx + py * dy;
      if (t < -tol || t > L + tol) return null;
      ss += d * d;
    }
    return { rms: Math.sqrt(ss / Math.max(1, j - i - 1)) };
  };
  const arcFit = (i, j) => {
    if (j - i < 8) return null;
    const arc = fitArcThrough(P, i, j);
    if (!arc || arc.r > 5000) return null;
    const { c, r } = arc;
    let sweep = 0, prevA = Math.atan2(P[i][1] - c[1], P[i][0] - c[0]), back = 0, ss = 0;
    for (let k = i + 1; k <= j; k++) {
      const dv = Math.hypot(P[k][0] - c[0], P[k][1] - c[1]) - r;
      if (Math.abs(dv) > tol) return null;
      ss += dv * dv;
      const ang = Math.atan2(P[k][1] - c[1], P[k][0] - c[0]);
      let d = ang - prevA;
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      sweep += d; prevA = ang;
      if (sweep * d < 0) back += Math.abs(d);
    }
    if (Math.abs(sweep) > 2 * Math.PI - 0.05 || back > 0.2 * Math.abs(sweep) + 0.02) return null;
    if (r * (1 - Math.cos(Math.abs(sweep) / 2)) < tol || Math.abs(sweep) < 0.15) return null; // почти прямая — это отрезок // стрела прогиба меньше допуска — это отрезок
    return { rms: Math.sqrt(ss / (j - i)), c, r, sweep };
  };

  // ДП по кандидатам
  const m = cand.length;
  const cost = new Float64Array(m).fill(Infinity), from = new Int32Array(m).fill(-1), kind = new Array(m);
  cost[0] = 0;
  for (let b = 1; b < m; b++) {
    let fails = 0;
    for (let a = b - 1; a >= 0; a--) {
      if (cost[a] === Infinity) continue;
      const i = cand[a], j = cand[b];
      let f = lineFit(i, j), t = 'line';
      if (!f) { f = arcFit(i, j); t = 'arc'; }
      if (!f) { if (++fails > 6) break; continue; }
      fails = 0;
      const cst = cost[a] + 1 + 0.3 * f.rms / tol;
      if (cst < cost[b]) { cost[b] = cst; from[b] = a; kind[b] = t; }
    }
    if (cost[b] === Infinity) { // страховка: всегда можно соединить соседние кандидаты отрезком
      cost[b] = cost[b - 1] + 1 + 1; from[b] = b - 1; kind[b] = 'line';
    }
  }
  const segs = [];
  for (let b = m - 1; b > 0; b = from[b]) segs.push({ type: kind[b], i: cand[from[b]], j: cand[b] });
  segs.reverse();
  return { P, segs };
}

function refineSegments(P, segs, tol) {

  // уточнение элементов по внутренним точкам
  for (const s of segs) {
    const len = s.j - s.i, trim = Math.min(Math.floor(len * 0.15), 6);
    const i0 = s.i + trim, i1 = s.j - trim;
    if (s.type === 'line') {
      s.L = i1 - i0 >= 2 ? lineFromPts(P, i0, i1) : lineFromPts(P, s.i, s.j);
    } else {
      const cf = i1 - i0 >= 6 ? fitCircle(P.slice(i0, i1 + 1)) : null;
      const base = fitArcThrough(P, s.i, s.j);
      s.c = cf && cf.r < 5000 ? cf.c : base.c; s.r = cf && cf.r < 5000 ? cf.r : base.r;
    }
  }
  // микро-фаски в острых углах (следствие размытия) — убрать, угол восстановится пересечением
  for (let k = 0; segs.length > 3 && k < segs.length; k++) {
    const s = segs[k];
    if (s.type !== 'line' || dist(P[s.i], P[s.j]) > Math.max(4 * tol, 0.4)) continue;
    const A = segs[(k - 1 + segs.length) % segs.length], B = segs[(k + 1) % segs.length];
    if (A.type !== 'line' || B.type !== 'line') continue;
    const q = intersectLines(A.L, B.L);
    if (!q || dist(q, P[s.i]) > 1 || dist(q, P[s.j]) > 1) continue;
    A.j = s.j;
    segs.splice(k, 1); k--;
  }
  const N = segs.length;
  const tolT = (r) => Math.max(2 * tol, 0.03 * r);
  const tangentTo = (arc, line) => Math.abs(Math.abs(lineDist(line.L, arc.c)) - arc.r) <= tolT(arc.r);
  // скругления: центр так, чтобы дуга касалась соседних отрезков
  for (let k = 0; k < N; k++) {
    const s = segs[k];
    if (s.type !== 'arc') continue;
    const pv = segs[(k - 1 + N) % N], nx = segs[(k + 1) % N];
    const tp = N > 1 && pv.type === 'line' && tangentTo(s, pv), tn = N > 1 && nx.type === 'line' && tangentTo(s, nx);
    const offset = (L) => {
      const sd = Math.sign(lineDist(L, s.c)) || 1;
      return { p: [L.p[0] + sd * s.r * L.n[0], L.p[1] + sd * s.r * L.n[1]], d: L.d, n: L.n };
    };
    if (tp && tn) {
      const c = intersectLines(offset(pv.L), offset(nx.L));
      if (c && dist(c, s.c) < 3 * tolT(s.r)) s.c = c;
    } else if (tp || tn) {
      const L = (tp ? pv : nx).L, d = lineDist(L, s.c), sd = Math.sign(d) || 1;
      s.c = [s.c[0] + (sd * s.r - d) * L.n[0], s.c[1] + (sd * s.r - d) * L.n[1]];
    }
  }
  // стыки
  const J = new Array(N);
  for (let k = 0; k < N; k++) {
    const A = segs[k], B = segs[(k + 1) % N], pb = P[A.j];
    let q = null, lim = 4 * tol + 0.3;
    if (A.type === 'line' && B.type === 'line') q = intersectLines(A.L, B.L);
    else if (A.type === 'arc' && B.type === 'arc') q = nearest(circleCircle(A.c, A.r, B.c, B.r), pb);
    else {
      const arc = A.type === 'arc' ? A : B, ln = A.type === 'arc' ? B : A;
      if (tangentTo(arc, ln)) { q = footOnLine(ln.L, arc.c); lim = Math.max(2, arc.r * 0.6); } // место касания вдоль касательной неопределённо
      else q = nearest(lineCircle(ln.L, arc.c, arc.r), pb);
    }
    if (!q || dist(q, pb) > lim) {
      // нет надёжного пересечения — ближайшая точка к фактическому стыку
      q = A.type === 'line' ? footOnLine(A.L, pb) : pb;
    }
    J[k] = q; // конец A = начало B
  }
  const ents = [];
  for (let k = 0; k < N; k++) {
    const s = segs[k], a = J[(k - 1 + N) % N], b = J[k];
    if (dist(a, b) < 1e-6) continue;
    if (s.type === 'line') { ents.push({ type: 'line', a, b }); continue; }
    // дуга точно через стыки: центр — проекция уточнённого центра на серединный перпендикуляр
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ch = dist(a, b);
    const ux = -(b[1] - a[1]) / ch, uy = (b[0] - a[0]) / ch;
    const sP = (s.c[0] - mx) * ux + (s.c[1] - my) * uy;
    const c = [mx + sP * ux, my + sP * uy], r = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const mid = P[(s.i + s.j) >> 1];
    const e = { type: 'arc', c, r, a, b, ccwScreen: true };
    const am = Math.atan2(mid[1] - c[1], mid[0] - c[0]), a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const sw = sweepOf(e);
    let dm = am - a0; while (dm < 0) dm += 2 * Math.PI;
    e.ccwScreen = dm <= sw; // середина лежит на дуге, идущей «по возрастанию угла»
    ents.push(e);
  }
  return ents;
}

// ───────────────────────── Сборка результата ─────────────────────────

export function transformPoint(G, p) { return G ? applyH(G, p[0], p[1]) : p; }

/**
 * Полный расчёт геометрии из петель: коррекция высоты, масштаб калибровки, аппроксимация.
 * Возвращает список фигур в мм в системе листа (Y вниз).
 */
export function buildShapes(loops, { G = null, scale = 1, tol = 0.1, snapDia = 0 } = {}) {
  const shapes = [];
  for (const l of loops) {
    const pts = l.pts.map(p => { const q = transformPoint(G, p); return [q[0] * scale, q[1] * scale]; });
    const ents = fitLoop(pts, tol, { snapDia });
    shapes.push({ hole: l.hole, ents, pts });
  }
  return shapes;
}

export function shapesBBox(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const s of shapes)
    for (const e of s.ents) {
      if (e.type === 'circle') { add([e.c[0] - e.r, e.c[1] - e.r]); add([e.c[0] + e.r, e.c[1] + e.r]); }
      else { add(e.a); add(e.b); if (e.type === 'arc') for (const p of arcSample(e, 32)) add(p); }
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function arcSample(e, n) {
  const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]);
  let a1 = Math.atan2(e.b[1] - e.c[1], e.b[0] - e.c[0]);
  if (e.ccwScreen) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  const out = [];
  for (let k = 0; k <= n; k++) { const t = a0 + (a1 - a0) * k / n; out.push([e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]); }
  return out;
}

// ───────────────────────── Экспорт DXF (R12, мм) ─────────────────────────

const f6 = (v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);

/**
 * DXF R12 (AC1009) — максимально совместимый с КОМПАС-3D формат. Единицы — мм, масштаб 1:1.
 * Начало координат — левый нижний угол габарита; ось Y вверх.
 */
export function toDXF(shapes, { origin = 'bbox', yUp = false } = {}) {
  const bb = shapesBBox(shapes);
  // yUp=false: координаты фото (Y вниз) — переворачиваем; yUp=true: координаты модели, без переворота
  const ox = origin === 'bbox' ? bb.x0 : 0, oy = origin === 'bbox' ? (yUp ? bb.y0 : bb.y1) : 0;
  const T = yUp ? (p) => [p[0] - ox, p[1] - oy] : (p) => [p[0] - ox, oy - p[1]];
  const L = [];
  const g = (code, val) => L.push(String(code), String(val));
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSBASE'); g(10, f6(0)); g(20, f6(0)); g(30, f6(0));
  const e0 = T([bb.x0, yUp ? bb.y0 : bb.y1]), e1 = T([bb.x1, yUp ? bb.y1 : bb.y0]);
  g(9, '$EXTMIN'); g(10, f6(e0[0])); g(20, f6(e0[1])); g(30, f6(0));
  g(9, '$EXTMAX'); g(10, f6(e1[0])); g(20, f6(e1[1])); g(30, f6(0));
  g(9, '$LIMMIN'); g(10, f6(0)); g(20, f6(0));
  g(9, '$LIMMAX'); g(10, f6(bb.w)); g(20, f6(bb.h));
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, f6(0));
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, 2);
  for (const [name, col] of [['CONTOUR', 7], ['HOLES', 1]]) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, col); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const s of shapes) {
    const layer = s.hole ? 'HOLES' : 'CONTOUR';
    for (const e of s.ents) {
      if (e.type === 'line') {
        const a = T(e.a), b = T(e.b);
        g(0, 'LINE'); g(8, layer); g(10, f6(a[0])); g(20, f6(a[1])); g(30, f6(0)); g(11, f6(b[0])); g(21, f6(b[1])); g(31, f6(0));
      } else if (e.type === 'circle') {
        const c = T(e.c);
        g(0, 'CIRCLE'); g(8, layer); g(10, f6(c[0])); g(20, f6(c[1])); g(30, f6(0)); g(40, f6(e.r));
      } else {
        const c = T(e.c), a = T(e.a), b = T(e.b);
        const angA = Math.atan2(a[1] - c[1], a[0] - c[0]) * 180 / Math.PI;
        const angB = Math.atan2(b[1] - c[1], b[0] - c[0]) * 180 / Math.PI;
        // В экранных координатах (Y вниз) «ccwScreen» = по часовой в DXF (Y вверх)
        const [s0, s1] = (e.ccwScreen !== yUp) ? [angB, angA] : [angA, angB];
        const norm = (v) => ((v % 360) + 360) % 360;
        g(0, 'ARC'); g(8, layer); g(10, f6(c[0])); g(20, f6(c[1])); g(30, f6(0)); g(40, f6(e.r));
        g(50, f6(norm(s0))); g(51, f6(norm(s1)));
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}

export function toSVG(shapes, { stroke = '#000' } = {}) {
  const bb = shapesBBox(shapes);
  const m = 2;
  const T = (p) => [p[0] - bb.x0 + m, p[1] - bb.y0 + m];
  const parts = [];
  for (const s of shapes) {
    let d = '';
    for (const e of s.ents) {
      if (e.type === 'circle') {
        const c = T(e.c);
        parts.push(`<circle cx="${c[0].toFixed(4)}" cy="${c[1].toFixed(4)}" r="${e.r.toFixed(4)}"/>`);
        continue;
      }
      const a = T(e.a), b = T(e.b);
      if (!d) d += `M${a[0].toFixed(4)} ${a[1].toFixed(4)}`;
      if (e.type === 'line') d += ` L${b[0].toFixed(4)} ${b[1].toFixed(4)}`;
      else {
        const sw = sweepOf(e);
        d += ` A${e.r.toFixed(4)} ${e.r.toFixed(4)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${e.ccwScreen ? 1 : 0} ${b[0].toFixed(4)} ${b[1].toFixed(4)}`;
      }
    }
    if (d) parts.push(`<path d="${d} Z"/>`);
  }
  const W = bb.w + 2 * m, H = bb.h + 2 * m;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm" viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}">\n<g fill="none" stroke="${stroke}" stroke-width="0.1">\n${parts.join('\n')}\n</g>\n</svg>\n`;
}

export function sweepOf(e) {
  const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]);
  let a1 = Math.atan2(e.b[1] - e.c[1], e.b[0] - e.c[0]);
  if (e.ccwScreen) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return a1 - a0;
}

// ───────────────────────── EXIF (фокусное расстояние) ─────────────────────────

/** Достаёт из JPEG фокусное в 35-мм эквиваленте (или null). */
export function readExifFocal35(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
        const t = off + 10;
        const le = v.getUint16(t) === 0x4949;
        const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
        const readIFD = (o) => {
          const n = u16(o), tags = {};
          for (let k = 0; k < n; k++) {
            const e = o + 2 + k * 12, tag = u16(e), type = u16(e + 2);
            if (type === 3) tags[tag] = u16(e + 8);
            else if (type === 4) tags[tag] = u32(e + 8);
            else if (type === 5) { const p = u32(e + 8); tags[tag] = u32(p) / u32(p + 4); }
          }
          return tags;
        };
        const ifd0 = readIFD(u32(4));
        if (!ifd0[0x8769]) return null;
        const ex = readIFD(ifd0[0x8769]);
        if (ex[0xA405]) return ex[0xA405];
        return null;
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  } catch { /* нет EXIF */ }
  return null;
}

// ───────────────────────── ZIP (без сжатия) ─────────────────────────

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** files: [[имя, строка|Uint8Array], ...] → Uint8Array zip-архива */
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), db = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(db);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, db.length, true);
    lh.setUint32(22, db.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, db);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, db.length, true); ch.setUint32(24, db.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + db.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
