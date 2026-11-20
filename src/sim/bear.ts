// Бурый медведь: форма задаётся полем расстояний (SDF) и превращается в сетку марширующими кубами,
// затем «одевается» на свой скелет с процедурными анимациями: покой, шаг, бег.
// Пропорции — по бурому медведю: длина ~2,3 м, в холке ~1 м, горб над лопатками, морда короткая.
import * as THREE from "three";
import { edgeTable as ET, triTable as TT } from "three/examples/jsm/objects/MarchingCubes.js";
import { addMixer } from "./models";

// в типах three таблицы описаны неверно — это плоские Int32Array
const edgeTable = ET as unknown as Int32Array, triTable = TT as unknown as Int32Array;
type V3 = [number, number, number];
const len = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const sphere = (p: V3, c: V3, r: number) => len(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
const ellip = (p: V3, c: V3, r: V3) => {
  const k = len((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);
  return (k - 1) * Math.min(r[0], r[1], r[2]);
};
/** Капсула с разным радиусом на концах. */
const cone = (p: V3, a: V3, b: V3, ra: number, rb: number) => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const px = p[0] - a[0], py = p[1] - a[1], pz = p[2] - a[2];
  const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return len(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
};
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
};

function field(p: V3): number {
  // туловище с горбом над лопатками и тяжёлым задом
  let d = ellip(p, [0, 0.74, -0.05], [0.39, 0.38, 0.8]);
  d = smin(d, sphere(p, [0, 0.96, 0.3], 0.3), 0.18);
  d = smin(d, sphere(p, [0, 0.8, -0.52], 0.37), 0.18);
  d = smin(d, sphere(p, [0, 0.66, 0.36], 0.34), 0.16);
  // шея, голова, короткая морда, круглые уши
  d = smin(d, cone(p, [0, 0.86, 0.5], [0, 0.82, 0.86], 0.27, 0.2), 0.12);
  d = smin(d, ellip(p, [0, 0.8, 0.98], [0.2, 0.18, 0.19]), 0.08);
  d = smin(d, cone(p, [0, 0.76, 1.06], [0, 0.71, 1.28], 0.1, 0.065), 0.07);
  for (const s of [-1, 1]) d = smin(d, ellip(p, [s * 0.14, 0.97, 0.93], [0.06, 0.065, 0.035]), 0.03);
  d = smin(d, sphere(p, [0, 0.86, -0.9], 0.07), 0.06);
  // лапы: толстые, стопоходящие
  for (const s of [-1, 1]) {
    let leg = sphere(p, [s * 0.2, 0.6, 0.4], 0.2);
    leg = smin(leg, cone(p, [s * 0.21, 0.62, 0.42], [s * 0.22, 0.1, 0.47], 0.15, 0.12), 0.08);
    leg = smin(leg, ellip(p, [s * 0.22, 0.06, 0.53], [0.11, 0.065, 0.15]), 0.06);
    let hind = sphere(p, [s * 0.19, 0.64, -0.55], 0.27);
    hind = smin(hind, cone(p, [s * 0.21, 0.58, -0.6], [s * 0.22, 0.1, -0.6], 0.16, 0.12), 0.08);
    hind = smin(hind, ellip(p, [s * 0.22, 0.06, -0.52], [0.11, 0.065, 0.17]), 0.06);
    d = smin(d, smin(leg, hind, 0.02), 0.1);
  }
  return d;
}

/** Марширующие кубы по полю расстояний: общая сетка с общими вершинами на рёбрах. */
function polygonize(): THREE.BufferGeometry {
  const st = 0.028, x0 = -0.46, y0 = -0.03, z0 = -1.05;
  const nx = Math.ceil(0.92 / st) + 1, ny = Math.ceil(1.42 / st) + 1, nz = Math.ceil(2.42 / st) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    F[id(i, j, k)] = field([x0 + i * st, y0 + j * st, z0 + k * st]);
  }
  const corner = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const pos: number[] = [], idx: number[] = [], cache = new Map<number, number>();
  const ev = new Array<number>(12);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let ci = 0;
    for (let c = 0; c < 8; c++) if (F[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])] < 0) ci |= 1 << c;
    const em = edgeTable[ci];
    if (!em) continue;
    for (let e = 0; e < 12; e++) {
      if (!(em & (1 << e))) continue;
      const [a, b] = edges[e], A = corner[a], B = corner[b];
      const ia = id(i + A[0], j + A[1], k + A[2]), ib = id(i + B[0], j + B[1], k + B[2]);
      const key = Math.min(ia, ib) * 3 + (A[0] !== B[0] ? 0 : A[1] !== B[1] ? 1 : 2);
      let v = cache.get(key);
      if (v === undefined) {
        const fa = F[ia], fb = F[ib], t = fa / (fa - fb);
        pos.push(x0 + (i + A[0] + (B[0] - A[0]) * t) * st, y0 + (j + A[1] + (B[1] - A[1]) * t) * st, z0 + (k + A[2] + (B[2] - A[2]) * t) * st);
        v = pos.length / 3 - 1; cache.set(key, v);
      }
      ev[e] = v;
    }
    for (let t = ci * 16; triTable[t] !== -1; t += 3) idx.push(ev[triTable[t]], ev[triTable[t + 2]], ev[triTable[t + 1]]);
  }
  // сглаживание Таубина: убирает ступеньки сетки, не «сдувая» форму
  const P = new Float32Array(pos), n = P.length / 3, nb: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + ((e + 1) % 3)]; nb[a].push(b); nb[b].push(a); }
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < 6; it++) {
    const lam = it % 2 ? -0.53 : 0.5;
    for (let v = 0; v < n; v++) {
      const L = nb[v];
      let sx = 0, sy = 0, sz = 0;
      for (const u of L) { sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
      const c = L.length || 1;
      tmp[v * 3] = P[v * 3] + lam * (sx / c - P[v * 3]);
      tmp[v * 3 + 1] = P[v * 3 + 1] + lam * (sy / c - P[v * 3 + 1]);
      tmp[v * 3 + 2] = P[v * 3 + 2] + lam * (sz / c - P[v * 3 + 2]);
    }
    P.set(tmp);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── скелет ──
interface BoneDef { name: string; parent: string | null; at: V3; tip: V3 }
const BONES: BoneDef[] = [
  { name: "root", parent: null, at: [0, 0, 0], tip: [0, 0, 0] },
  { name: "hips", parent: "root", at: [0, 0.78, -0.2], tip: [0, 0.8, -0.95] },
  { name: "chest", parent: "hips", at: [0, 0.8, 0.1], tip: [0, 0.84, 0.55] },
  { name: "neck", parent: "chest", at: [0, 0.84, 0.55], tip: [0, 0.82, 0.84] },
  { name: "head", parent: "neck", at: [0, 0.82, 0.84], tip: [0, 0.72, 1.32] },
  { name: "flUp_L", parent: "chest", at: [0.21, 0.66, 0.41], tip: [0.22, 0.32, 0.45] },
  { name: "flLo_L", parent: "flUp_L", at: [0.22, 0.32, 0.45], tip: [0.22, 0.03, 0.6] },
  { name: "flUp_R", parent: "chest", at: [-0.21, 0.66, 0.41], tip: [-0.22, 0.32, 0.45] },
  { name: "flLo_R", parent: "flUp_R", at: [-0.22, 0.32, 0.45], tip: [-0.22, 0.03, 0.6] },
  { name: "hlUp_L", parent: "hips", at: [0.2, 0.68, -0.57], tip: [0.22, 0.34, -0.6] },
  { name: "hlLo_L", parent: "hlUp_L", at: [0.22, 0.34, -0.6], tip: [0.22, 0.03, -0.45] },
  { name: "hlUp_R", parent: "hips", at: [-0.2, 0.68, -0.57], tip: [-0.22, 0.34, -0.6] },
  { name: "hlLo_R", parent: "hlUp_R", at: [-0.22, 0.34, -0.6], tip: [-0.22, 0.03, -0.45] },
];

function segDist(p: V3, a: V3, b: V3) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], L2 = bx * bx + by * by + bz * bz;
  const h = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * bx + (p[1] - a[1]) * by + (p[2] - a[2]) * bz) / L2)) : 0;
  return len(p[0] - a[0] - bx * h, p[1] - a[1] - by * h, p[2] - a[2] - bz * h);
}

function skin(g: THREE.BufferGeometry) {
  const P = g.getAttribute("position") as THREE.BufferAttribute, n = P.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
  const base = new THREE.Color(0x26170d), dark = new THREE.Color(0x120b06), muzzle = new THREE.Color(0x56402a), tip = new THREE.Color(0x4a3524);
  const c = new THREE.Color();
  for (let v = 0; v < n; v++) {
    const p: V3 = [P.getX(v), P.getY(v), P.getZ(v)];
    const legZone = p[1] < 0.62 && Math.abs(p[0]) > 0.06;
    const cand: [number, number][] = [];
    BONES.forEach((b, i) => {
      if (i === 0) return;
      const leg = b.name.includes("Up") || b.name.includes("Lo");
      if (leg && Math.sign(b.at[0]) !== Math.sign(p[0] || 1)) return;
      if (leg && !legZone && b.name.includes("Lo")) return;
      let d = segDist(p, b.at, b.tip);
      if (!leg && legZone && p[1] < 0.45) d += 0.3; // нижняя часть лапы — только кости лапы
      cand.push([i, d]);
    });
    cand.sort((a, b) => a[1] - b[1]);
    let tot = 0;
    for (let k = 0; k < 4; k++) { const w = k < cand.length ? 1 / Math.pow(cand[k][1] + 0.02, 4) : 0; sw[v * 4 + k] = w; si[v * 4 + k] = k < cand.length ? cand[k][0] : 0; tot += w; }
    for (let k = 0; k < 4; k++) sw[v * 4 + k] /= tot;
    // окрас: тёмные лапы, светлая морда, «седина» на холке, лёгкая пестрота меха
    c.copy(base);
    if (p[1] < 0.45) c.lerp(dark, Math.min(1, (0.45 - p[1]) / 0.25));
    if (p[2] > 1.08) c.lerp(muzzle, Math.min(1, (p[2] - 1.08) / 0.12));
    if (p[1] > 0.95 && p[2] > 0) c.lerp(tip, Math.min(0.6, (p[1] - 0.95) * 3));
    const nz = 0.8 + 0.4 * Math.abs(Math.sin(p[0] * 61 + p[1] * 37) * Math.cos(p[2] * 53 - p[1] * 19));
    col[v * 3] = c.r * nz; col[v * 3 + 1] = c.g * nz; col[v * 3 + 2] = c.b * nz;
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
}

// ── процедурные анимации ──
function clips(): THREE.AnimationClip[] {
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const track = (bone: string, T: number, f: (ph: number) => [number, number, number]) => {
    const N = 24, times: number[] = [], vals: number[] = [];
    for (let i = 0; i <= N; i++) {
      const ph = i / N; times.push(ph * T);
      const [x, y, z] = f(ph); q.setFromEuler(e.set(x, y, z)); vals.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, vals);
  };
  const tau = Math.PI * 2;
  // шаг: латеральная последовательность ЗЛ → ПЛ → ЗП → ПП
  const gait = (name: string, T: number, amp: number, ph: Record<string, number>, flex: number, spine: number) => {
    const tr: THREE.KeyframeTrack[] = [];
    for (const [leg, off] of Object.entries(ph)) {
      const front = leg.startsWith("fl");
      tr.push(track(`${leg.slice(0, 2)}Up_${leg.slice(-1)}`, T, (p) => [Math.sin((p + off) * tau) * amp, 0, 0]));
      // в фазе переноса лапа сгибается: передняя — в запястье назад, задняя — в скакательном суставе
      tr.push(track(`${leg.slice(0, 2)}Lo_${leg.slice(-1)}`, T, (p) => {
        const s = Math.max(0, Math.sin((p + off) * tau + Math.PI / 2));
        return [(front ? 1 : -1) * s * flex, 0, 0];
      }));
    }
    tr.push(track("hips", T, (p) => [Math.sin(p * tau * 2) * spine * 0.5, Math.sin(p * tau) * 0.05, Math.sin(p * tau) * 0.04]));
    tr.push(track("chest", T, (p) => [-Math.sin(p * tau * 2) * spine, -Math.sin(p * tau) * 0.06, -Math.sin(p * tau) * 0.05]));
    tr.push(track("head", T, (p) => [0.1 + Math.sin(p * tau * 2 + 0.6) * 0.06, Math.sin(p * tau) * 0.08, 0]));
    tr.push(new THREE.VectorKeyframeTrack("root.position", [0, T / 4, T / 2, (3 * T) / 4, T], [0, 0, 0, 0, 0.025, 0, 0, 0, 0, 0, 0.025, 0, 0, 0, 0]));
    return new THREE.AnimationClip(name, T, tr);
  };
  const walk = gait("walk", 1.5, 0.32, { hlL: 0, flL: 0.25, hlR: 0.5, flR: 0.75 }, 0.7, 0.03);
  const run = gait("run", 0.62, 0.62, { flL: 0, flR: 0.1, hlL: 0.5, hlR: 0.6 }, 1.1, 0.14);
  // покой: обнюхивает землю, поводит головой
  const idle = new THREE.AnimationClip("idle", 6, [
    track("neck", 6, (p) => [0.25 + 0.25 * Math.sin(p * tau), 0, 0]),
    track("head", 6, (p) => [0.1 * Math.sin(p * tau * 2), 0.35 * Math.sin(p * tau), 0]),
    track("chest", 6, (p) => [0.02 * Math.sin(p * tau * 3), 0, 0]),
  ]);
  return [idle, walk, run];
}

let cached: { geo: THREE.BufferGeometry; clips: THREE.AnimationClip[] } | null = null;

export function makeBear(): THREE.Group {
  if (!cached) { const geo = polygonize(); skin(geo); cached = { geo, clips: clips() }; }
  const bones = new Map<string, THREE.Bone>();
  for (const b of BONES) {
    const bone = new THREE.Bone(); bone.name = b.name;
    const par = b.parent ? BONES.find((x) => x.name === b.parent)! : null;
    bone.position.set(b.at[0] - (par?.at[0] ?? 0), b.at[1] - (par?.at[1] ?? 0), b.at[2] - (par?.at[2] ?? 0));
    if (b.parent) bones.get(b.parent)!.add(bone);
    bones.set(b.name, bone);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.2 });
  const mesh = new THREE.SkinnedMesh(cached.geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const root = bones.get("root")!;
  mesh.add(root);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([...bones.values()]));
  // глаза и нос — на кости головы
  const head = bones.get("head")!, hp = BONES.find((b) => b.name === "head")!.at;
  const black = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.25 });
  const dot = (r: number, p: V3) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), black); m.position.set(p[0] - hp[0], p[1] - hp[1], p[2] - hp[2]); head.add(m); };
  dot(0.022, [0.085, 0.86, 1.12]); dot(0.022, [-0.085, 0.86, 1.12]);
  dot(0.042, [0, 0.725, 1.33]);

  const g = new THREE.Group();
  g.add(mesh);
  const mixer = new THREE.AnimationMixer(mesh);
  const byName = new Map(cached.clips.map((c) => [c.name, c]));
  let cur = mixer.clipAction(byName.get("idle")!), curName = "idle";
  cur.time = Math.random() * 6; cur.play();
  addMixer(mixer);
  g.userData.mixer = mixer;
  g.userData.kind = "bear";
  g.userData.play = (kind: string, speed = 1) => {
    const name = kind === "graze" ? "idle" : kind;
    if (name === curName) { cur.timeScale = speed; return; }
    const c = byName.get(name);
    if (!c) return;
    const next = mixer.clipAction(c);
    next.reset(); next.timeScale = speed; next.play();
    cur.crossFadeTo(next, 0.3, false);
    cur = next; curName = name;
  };
  return g;
}
