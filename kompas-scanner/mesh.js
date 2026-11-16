// 3D-скан → КОМПАС: чтение сеток (STL/OBJ/PLY/GLB), выравнивание, масштаб,
// поиск уступов, сечения и их аппроксимация отрезками/дугами.
import { fitLoop } from './core.js';

// ───────────────────────── Чтение форматов ─────────────────────────

/** Возвращает {pos: Float64Array(3n), idx: Uint32Array(3m)} — индексированная сетка со сваренными вершинами. */
export function parseMesh(buf, name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512)));
  let raw;
  if (ext === 'glb' || head.startsWith('glTF')) raw = parseGLB(buf);
  else if (ext === 'ply' || head.startsWith('ply')) raw = parsePLY(buf);
  else if (ext === 'obj') raw = parseOBJ(new TextDecoder().decode(buf));
  else if (ext === 'stl' || /^solid/.test(head) || buf.byteLength > 84) raw = parseSTL(buf);
  else throw new Error('Формат не распознан. Нужен STL, OBJ, PLY или GLB.');
  if (!raw.idx.length) throw new Error('В файле нет треугольников.');
  return weld(raw.pos, raw.idx);
}

function parseSTL(buf) {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (buf.byteLength === 84 + n * 50 && n > 0) {
    const pos = new Float64Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    return { pos, idx: seq(n * 3) };
  }
  const txt = new TextDecoder().decode(buf), pts = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(txt))) pts.push(+m[1], +m[2], +m[3]);
  return { pos: Float64Array.from(pts), idx: seq(pts.length / 3) };
}
const seq = (n) => { const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };

function parseOBJ(txt) {
  const v = [], f = [];
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map(t => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? v.length / 3 + i : i - 1;
      });
      for (let k = 1; k < p.length - 1; k++) f.push(p[0], p[k], p[k + 1]);
    }
  }
  return { pos: Float64Array.from(v), idx: Uint32Array.from(f) };
}

function parsePLY(buf) {
  const bytes = new Uint8Array(buf);
  let hEnd = 0;
  const marker = 'end_header';
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    if (bytes[i] === 101 && new TextDecoder().decode(bytes.subarray(i, i + marker.length)) === marker) {
      hEnd = i + marker.length; while (bytes[hEnd] === 13 || bytes[hEnd] === 10) { hEnd++; if (bytes[hEnd - 1] === 10) break; }
      break;
    }
  }
  const header = new TextDecoder().decode(bytes.subarray(0, hEnd)).split(/\r?\n/);
  const format = (header.find(l => l.startsWith('format')) || '').split(/\s+/)[1];
  const elems = [];
  for (const l of header) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element') elems.push({ name: p[1], count: +p[2], props: [] });
    else if (p[0] === 'property') elems[elems.length - 1].props.push(p[1] === 'list' ? { list: true, ct: p[2], it: p[3], name: p[4] } : { t: p[1], name: p[2] });
  }
  const size = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const pos = [], idx = [];
  if (format === 'ascii') {
    const toks = new TextDecoder().decode(bytes.subarray(hEnd)).trim().split(/\s+/);
    let t = 0;
    for (const e of elems) for (let i = 0; i < e.count; i++) {
      const vals = {};
      for (const pr of e.props) {
        if (pr.list) { const n = +toks[t++]; const l = []; for (let k = 0; k < n; k++) l.push(+toks[t++]); vals[pr.name] = l; }
        else vals[pr.name] = +toks[t++];
      }
      if (e.name === 'vertex') pos.push(vals.x, vals.y, vals.z);
      if (e.name === 'face') { const l = vals.vertex_indices || vals.vertex_index; for (let k = 1; k < l.length - 1; k++) idx.push(l[0], l[k], l[k + 1]); }
    }
  } else {
    const le = format === 'binary_little_endian', dv = new DataView(buf);
    let o = hEnd;
    const rd = (t) => {
      let v;
      switch (t) {
        case 'char': case 'int8': v = dv.getInt8(o); break;
        case 'uchar': case 'uint8': v = dv.getUint8(o); break;
        case 'short': case 'int16': v = dv.getInt16(o, le); break;
        case 'ushort': case 'uint16': v = dv.getUint16(o, le); break;
        case 'int': case 'int32': v = dv.getInt32(o, le); break;
        case 'uint': case 'uint32': v = dv.getUint32(o, le); break;
        case 'float': case 'float32': v = dv.getFloat32(o, le); break;
        default: v = dv.getFloat64(o, le);
      }
      o += size[t]; return v;
    };
    for (const e of elems) for (let i = 0; i < e.count; i++) {
      let x, y, z, l = null;
      for (const pr of e.props) {
        if (pr.list) { const n = rd(pr.ct); const a = []; for (let k = 0; k < n; k++) a.push(rd(pr.it)); if (pr.name.startsWith('vertex_ind')) l = a; }
        else { const v = rd(pr.t); if (pr.name === 'x') x = v; else if (pr.name === 'y') y = v; else if (pr.name === 'z') z = v; }
      }
      if (e.name === 'vertex') pos.push(x, y, z);
      if (e.name === 'face' && l) for (let k = 1; k < l.length - 1; k++) idx.push(l[0], l[k], l[k + 1]);
    }
  }
  return { pos: Float64Array.from(pos), idx: Uint32Array.from(idx) };
}

function parseGLB(buf) {
  const dv = new DataView(buf);
  let o = 12, json = null, bin = null;
  while (o < buf.byteLength) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
    else if (type === 0x004E4942) bin = new Uint8Array(buf, o + 8, len);
    o += 8 + len;
  }
  if (!json) throw new Error('Повреждённый GLB');
  if ((json.extensionsUsed || []).includes('KHR_draco_mesh_compression')) throw new Error('GLB сжат Draco — экспортируйте в OBJ или STL.');
  const comp = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const read = (ai) => {
    const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
    const [cs, fn] = comp[a.componentType], nc = ncomp[a.type];
    const stride = bv.byteStride || cs * nc, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const d = new DataView(bin.buffer, bin.byteOffset);
    const out = new Float64Array(a.count * nc);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = d[fn](base + i * stride + k * cs, true);
    return out;
  };
  const pos = [], idx = [];
  const matMul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
  const nodeMat = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1];
  };
  const visit = (ni, parent) => {
    const n = json.nodes[ni], M = matMul(parent, nodeMat(n));
    if (n.mesh != null) for (const pr of json.meshes[n.mesh].primitives) {
      if (pr.mode != null && pr.mode !== 4) continue;
      const P = read(pr.attributes.POSITION), base = pos.length / 3;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        pos.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
      }
      if (pr.indices != null) for (const v of read(pr.indices)) idx.push(base + v);
      else for (let i = 0; i < P.length / 3; i++) idx.push(base + i);
    }
    for (const c of n.children || []) visit(c, M);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
  for (const ni of scene.nodes) visit(ni, I);
  return { pos: Float64Array.from(pos), idx: Uint32Array.from(idx) };
}

/** Сварка совпадающих вершин (нужно для связности сечений). */
export function weld(pos, idx) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const q = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 1e-7 || 1e-9;
  const map = new Map(), remap = new Uint32Array(pos.length / 3), out = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = Math.round(pos[i * 3] / q) + ',' + Math.round(pos[i * 3 + 1] / q) + ',' + Math.round(pos[i * 3 + 2] / q);
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const nidx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) nidx.push(a, b, c);
  }
  return { pos: Float64Array.from(out), idx: Uint32Array.from(nidx) };
}

// ───────────────────────── Геометрия сетки ─────────────────────────

export function bounds(m) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

export function faceNormal(m, f) {
  const P = m.pos, a = m.idx[f * 3] * 3, b = m.idx[f * 3 + 1] * 3, c = m.idx[f * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], L = Math.hypot(...n) || 1;
  return n.map(v => v / L);
}

/** Применить линейное преобразование 3x3 (построчно) и сдвиг. */
export function transform(m, R, t = [0, 0, 0]) {
  const P = m.pos;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    P[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
    P[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    P[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  }
  if (R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]) < 0) {
    for (let t2 = 0; t2 < m.idx.length; t2 += 3) { const s = m.idx[t2 + 1]; m.idx[t2 + 1] = m.idx[t2 + 2]; m.idx[t2 + 2] = s; }
  }
}

function jacobiEigen(A) {
  const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]) };
}

/** Главные оси по поверхности (с весом площади): самая длинная → X, средняя → Y, короткая → Z. */
export function alignPCA(m) {
  const P = m.pos, I = m.idx;
  let A = 0, c = [0, 0, 0];
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const g = [(P[a] + P[b] + P[d]) / 3, (P[a + 1] + P[b + 1] + P[d + 1]) / 3, (P[a + 2] + P[b + 2] + P[d + 2]) / 3];
    tris.push(ar, g); A += ar; for (let k = 0; k < 3; k++) c[k] += ar * g[k];
  }
  c = c.map(v => v / A);
  for (let i = 0; i < tris.length; i += 2) {
    const ar = tris[i], g = tris[i + 1];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r][s] += ar * (g[r] - c[r]) * (g[s] - c[s]);
  }
  const { vals, vecs } = jacobiEigen(cov);
  const ord = [0, 1, 2].sort((x, y) => vals[y] - vals[x]);
  const ex = vecs[ord[0]], ey = vecs[ord[1]];
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  transform(m, [...ex, ...ey, ...ez], [-dot(ex, c), -dot(ey, c), -dot(ez, c)]);
  autoUp(m);
  placeOnBase(m);
}

/** Низ — та сторона по Z, где больше плоских горизонтальных граней (деталь «стоит» на ней). */
export function autoUp(m) {
  const P = m.pos, I = m.idx, b = bounds(m), band = (b.max[2] - b.min[2]) * 0.04;
  let lo = 0, hi = 0;
  for (let t = 0; t < I.length; t += 3) {
    const n = faceNormal(m, t / 3);
    if (Math.abs(n[2]) < 0.95) continue;
    const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3;
    const z = (P[a + 2] + P[bb + 2] + P[c + 2]) / 3;
    const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1];
    const ar = Math.abs(ux * vy - uy * vx) / 2;
    if (z - b.min[2] < band) lo += ar; else if (b.max[2] - z < band) hi += ar;
  }
  if (hi > lo * 1.2) transform(m, [1, 0, 0, 0, -1, 0, 0, 0, -1]);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Повернуть так, чтобы нормаль n (наружу от основания) смотрела вниз (−Z). */
export function alignBase(m, n, face = -1) {
  const target = [0, 0, -1];
  const ax = [n[1] * target[2] - n[2] * target[1], n[2] * target[0] - n[0] * target[2], n[0] * target[1] - n[1] * target[0]];
  const s = Math.hypot(...ax), c = dot(n, target);
  let R;
  if (s < 1e-9) R = c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  else {
    const k = ax.map(v => v / s), [x, y, z] = k, C = 1 - c;
    R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
      y * x * C + z * s, c + y * y * C, y * z * C - x * s,
      z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  transform(m, R);
  if (face >= 0) {
    // нормали в сканах бывают вывернуты: выбранная грань должна оказаться внизу
    const P = m.pos, I = m.idx, zc = (P[I[face * 3] * 3 + 2] + P[I[face * 3 + 1] * 3 + 2] + P[I[face * 3 + 2] * 3 + 2]) / 3, b = bounds(m);
    if (zc - b.min[2] > b.max[2] - zc) transform(m, [1, 0, 0, 0, -1, 0, 0, 0, -1]);
  }
  alignInPlane(m);
}

/** Поворот вокруг Z: главные оси проекции на XY → X (длинная) и Y. */
export function alignInPlane(m) {
  const P = m.pos;
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < P.length; i += 3) { mx += P[i]; my += P[i + 1]; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < P.length; i += 3) { const dx = P[i] - mx, dy = P[i + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(-a), s = Math.sin(-a);
  transform(m, [c, -s, 0, s, c, 0, 0, 0, 1]);
  placeOnBase(m);
}

/** Центр по XY, низ на Z=0. */
export function placeOnBase(m) {
  const b = bounds(m);
  transform(m, [1, 0, 0, 0, 1, 0, 0, 0, 1], [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
}

export function rotate90(m, axis) {
  const R = { x: [1, 0, 0, 0, 0, -1, 0, 1, 0], y: [0, 0, 1, 0, 1, 0, -1, 0, 0], z: [0, -1, 0, 1, 0, 0, 0, 0, 1] }[axis];
  transform(m, R); placeOnBase(m);
}

export function scaleMesh(m, s) { transform(m, [s, 0, 0, 0, s, 0, 0, 0, s]); placeOnBase(m); }

// ───────────────────────── Уступы (горизонтальные плоскости) ─────────────────────────

/** Высоты плоских горизонтальных граней (уступов), по площади. Возвращает отсортированный список {z, area}. */
export function detectLevels(m, { minFrac = 0.02, cosTol = 0.985, binMm = 0.25 } = {}) {
  const P = m.pos, I = m.idx, bins = new Map();
  let total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const n = faceNormal(m, t / 3);
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (Math.abs(n[2]) < cosTol) continue;
    const z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3, k = Math.round(z / binMm);
    const e = bins.get(k) || { a: 0, z: 0 }; e.a += ar; e.z += ar * z; bins.set(k, e); total += ar;
  }
  // слить соседние корзины в кластеры
  const keys = [...bins.keys()].sort((a, b) => a - b), clusters = [];
  for (const k of keys) {
    const e = bins.get(k), last = clusters[clusters.length - 1];
    if (last && k - last.k <= 2) { last.a += e.a; last.z += e.z; last.k = k; }
    else clusters.push({ k, a: e.a, z: e.z });
  }
  return clusters.filter(c => c.a >= total * minFrac).map(c => ({ z: c.z / c.a, area: c.a })).sort((a, b) => a.z - b.z);
}

// ───────────────────────── Сечения ─────────────────────────

/** Сечение плоскостью Z = h. Возвращает замкнутые петли [[x,y],...] и число незамкнутых обрывков. */
export function sliceZ(m, h) {
  const P = m.pos, I = m.idx;
  const z = (v) => { const d = P[v * 3 + 2] - h; return d === 0 ? 1e-12 : d; };
  const nb = new Map(), ptOf = new Map();
  const ekey = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
  const ept = (a, b, key) => {
    if (!ptOf.has(key)) {
      const da = z(a), db = z(b), t = da / (da - db);
      ptOf.set(key, [P[a * 3] + t * (P[b * 3] - P[a * 3]), P[a * 3 + 1] + t * (P[b * 3 + 1] - P[a * 3 + 1])]);
    }
  };
  const link = (k1, k2) => {
    let a = nb.get(k1); if (!a) { a = []; nb.set(k1, a); } a.push(k2);
    let b = nb.get(k2); if (!b) { b = []; nb.set(k2, b); } b.push(k1);
  };
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]], s = v.map(z);
    const cross = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if ((s[e] > 0) !== (s[(e + 1) % 3] > 0)) { const k = ekey(a, b); ept(a, b, k); cross.push(k); }
    }
    if (cross.length === 2) link(cross[0], cross[1]);
  }
  const seen = new Set(), loops = [], open = [];
  // сначала цепочки от концов (вершины степени 1) — это обрывы в незамкнутой сетке
  const walk = (start) => {
    const out = []; let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); out.push(ptOf.get(cur));
      const n = nb.get(cur); const nx = n.find(x => x !== prev && !seen.has(x));
      prev = cur; cur = nx;
    }
    return out;
  };
  for (const [k, n] of nb) if (n.length === 1 && !seen.has(k)) open.push(walk(k));
  for (const k of nb.keys()) if (!seen.has(k)) { const l = walk(k); if (l.length >= 3) loops.push(l); }
  // залатать обрывы: соединить ближайшие концы
  const joined = joinOpen(open, m);
  return { loops: loops.concat(joined.loops), openCount: joined.left };
}

function joinOpen(chains, m) {
  const gap = Math.max(...bounds(m).size) * 0.03;
  const out = [];
  const pool = chains.filter(c => c.length >= 2);
  while (pool.length) {
    let cur = pool.shift();
    for (;;) {
      const end = cur[cur.length - 1], start = cur[0];
      const closeD = Math.hypot(end[0] - start[0], end[1] - start[1]);
      let bi = -1, bd = Math.min(gap, cur.length > 4 ? closeD : gap), rev = false;
      pool.forEach((c, i) => {
        const d0 = Math.hypot(c[0][0] - end[0], c[0][1] - end[1]), d1 = Math.hypot(c[c.length - 1][0] - end[0], c[c.length - 1][1] - end[1]);
        if (d0 < bd) { bd = d0; bi = i; rev = false; }
        if (d1 < bd) { bd = d1; bi = i; rev = true; }
      });
      if (bi < 0) break;
      const c = pool.splice(bi, 1)[0];
      cur = cur.concat(rev ? c.slice().reverse() : c);
    }
    const e = cur[cur.length - 1], st = cur[0];
    if (cur.length > 4 && Math.hypot(e[0] - st[0], e[1] - st[1]) < gap) out.push(cur);
  }
  return { loops: out, left: chains.length - out.length > 0 && chains.length ? chains.length : 0 };
}
const near = (c, p) => Math.min(Math.hypot(c[0][0] - p[0], c[0][1] - p[1]), Math.hypot(c[c.length - 1][0] - p[0], c[c.length - 1][1] - p[1]));

function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function pointInPoly(pt, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** Равномерная передискретизация замкнутой петли с шагом step. */
export function resample(loop, step) {
  const n = loop.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n], m = Math.max(12, Math.round(L / step)), out = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = k * L / m;
    while (cum[j + 1] < s) j++;
    const a = loop[j], b = loop[(j + 1) % n], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return out;
}

/** Сечение → фигуры из отрезков/дуг/окружностей (как в core.buildShapes). */
export function sectionShapes(loops, { tol = 0.2, minAreaRel = 2e-4, snapDia = 0 } = {}) {
  const maxA = Math.max(0, ...loops.map(l => Math.abs(polyArea(l))));
  const L = loops.filter(l => Math.abs(polyArea(l)) >= maxA * minAreaRel);
  return L.map((pts, i) => {
    let depth = 0;
    for (let j = 0; j < L.length; j++) if (j !== i && pointInPoly(pts[0], L[j])) depth++;
    const rs = resample(pts, Math.max(0.05, tol / 2));
    return { hole: depth % 2 === 1, pts: rs, ents: fitLoop(rs, tol, { snapDia }) };
  }).sort((a, b) => a.hole - b.hole);
}

// ───────────────────────── План построения ─────────────────────────

/**
 * Для «ступенчатой» детали: слои между уступами. Каждый слой = одно сечение посередине + высота выдавливания.
 */
export function layerPlan(m, levels, { minThick = 0.4 } = {}) {
  const b = bounds(m);
  const zs = [b.min[2], ...levels.map(l => l.z), b.max[2]].sort((a, c) => a - c);
  const uniq = [];
  for (const z of zs) if (!uniq.length || z - uniq[uniq.length - 1] > minThick) uniq.push(z); else uniq[uniq.length - 1] = Math.max(uniq[uniq.length - 1], z);
  // низ/верх — по найденным плоскостям, если они есть у краёв (крайние точки скана зашумлены)
  const snap = Math.max(1, (b.max[2] - b.min[2]) * 0.03);
  const lo = levels.find(l => l.z - b.min[2] < snap), hi = [...levels].reverse().find(l => b.max[2] - l.z < snap);
  uniq[0] = lo ? lo.z : b.min[2]; uniq[uniq.length - 1] = hi ? hi.z : b.max[2];
  const plan = [];
  for (let i = 0; i < uniq.length - 1; i++) plan.push({ z0: uniq[i], z1: uniq[i + 1], zc: (uniq[i] + uniq[i + 1]) / 2 });
  return plan;
}

// ───────────────────────── Экспорт сетки ─────────────────────────

export function toSTL(m) {
  const n = m.idx.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const hdr = 'kompas-scanner, mm';
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, n, true);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50, nn = faceNormal(m, f);
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, nn[k], true);
    for (let v = 0; v < 3; v++) { const p = m.idx[f * 3 + v] * 3; for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + v * 12 + k * 4, m.pos[p + k], true); }
  }
  return new Uint8Array(buf);
}

/**
 * Нормаль плоской области вокруг точки касания: МНК-плоскость по треугольникам в радиусе r,
 * чья нормаль близка к средней. Устойчиво к шуму скана (одна грань может «смотреть» куда угодно).
 */
export function regionNormal(m, f, rRel = 0.06) {
  const P = m.pos, I = m.idx, b = bounds(m), r = Math.max(...b.size) * rRel;
  const cen = (t) => { const a = I[t * 3] * 3, bb = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; return [(P[a] + P[bb] + P[c]) / 3, (P[a + 1] + P[bb + 1] + P[c + 1]) / 3, (P[a + 2] + P[bb + 2] + P[c + 2]) / 3]; };
  const area = (t) => { const a = I[t * 3] * 3, bb = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; };
  const c0 = cen(f), near = [];
  for (let t = 0; t < I.length / 3; t++) { const c = cen(t); if (Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]) < r) near.push(t); }
  // направление с наибольшей «поддержкой» по площади (граней с почти той же нормалью),
  // предпочитая близкие к касанию; затем МНК-плоскость
  const fn = near.map(t => faceNormal(m, t)), ar = near.map(area), seed = faceNormal(m, f);
  let n = seed, best = -1;
  const step = Math.max(1, Math.floor(near.length / 300));
  for (let i = 0; i < near.length; i += step) {
    let sup = 0;
    for (let j = 0; j < near.length; j++) if (dot(fn[i], fn[j]) > 0.95) sup += ar[j];
    sup *= 1 + 0.5 * Math.max(0, dot(fn[i], seed));
    if (sup > best) { best = sup; n = fn[i]; }
  }
  n = n.slice();
  { let acc = [0, 0, 0]; for (let j = 0; j < near.length; j++) if (dot(fn[j], n) > 0.95) acc = acc.map((v, k) => v + ar[j] * fn[j][k]); n = acc; }
  let sel = near;
  for (let it = 0; it < 3; it++) {
    const L = Math.hypot(...n) || 1; n = n.map(v => v / L);
    sel = near.filter(t => dot(faceNormal(m, t), n) > 0.8);
    if (!sel.length) break;
    const pts = [];
    for (const t of sel) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; pts.push([P[v], P[v + 1], P[v + 2]]); }
    const mc = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - mc[i]) * (p[j] - mc[j]);
    const { vals, vecs } = jacobiEigen(cov);
    const k = [0, 1, 2].sort((x, y) => vals[x] - vals[y])[0];
    let nn = vecs[k]; if (dot(nn, n) < 0) nn = nn.map(v => -v);
    n = nn;
  }
  return n;
}
