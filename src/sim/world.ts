// Процедурный мир: рельеф, река, тайга, постройки. Слой 0 — видимый спектр, слой 1 — тепловизор.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, fbm, lerp, makeNoise2D, mulberry32, smoothstep } from "./noise";

export const THERMAL_LAYER = 1;

export interface Palette {
  groundA: number; groundB: number; shore: number;
  tree: number; treeVar: number; water: number;
  skyTop: number; skyBottom: number; fog: number; fogDensity: number;
  sun: number; sunIntensity: number; ambient: number; ambientIntensity: number;
  sunDir: [number, number, number];
  snow?: boolean;
}

export interface WorldCfg {
  seed: number;
  size: number;
  relief: number;
  river?: { z0: number; amp: number; wl: number; width: number };
  flats: { x: number; z: number; rx: number; rz: number }[];
  clearings: { x: number; z: number; r: number }[];
  corridors?: { x1: number; z1: number; x2: number; z2: number; w: number }[];
  forestDensity: number; // деревьев на 100 м²
  palette: Palette;
}

const TREE_CELL = 16;

export class World {
  scene = new THREE.Scene();
  cfg: WorldCfg;
  size: number;
  n = 257;
  cell: number;
  hf: Float32Array;
  waterLevel: number | null;
  treeX: Float32Array; treeZ: Float32Array; treeY: Float32Array; treeH: Float32Array; treeR: Float32Array;
  treeAlive: Uint8Array;
  treeCount = 0;
  treeMesh!: THREE.InstancedMesh;
  colliders: ((p: THREE.Vector3, r: number) => string | null)[] = [];
  private treeGrid = new Map<number, number[]>();
  private treeBase: THREE.Color[] = [];
  private disposables: { dispose(): void }[] = [];
  sky!: THREE.Mesh;

  constructor(cfg: WorldCfg) {
    this.cfg = cfg;
    this.size = cfg.size;
    this.cell = cfg.size / (this.n - 1);
    this.hf = new Float32Array(this.n * this.n);
    this.waterLevel = cfg.river ? 0 : null;
    this.treeX = new Float32Array(0); this.treeZ = new Float32Array(0); this.treeY = new Float32Array(0);
    this.treeH = new Float32Array(0); this.treeR = new Float32Array(0); this.treeAlive = new Uint8Array(0);
    this.buildHeights();
    this.buildTerrain();
    this.buildTrees();
    this.buildSky();
  }

  riverZ(x: number): number {
    const r = this.cfg.river!;
    return r.z0 + r.amp * Math.sin(x / r.wl) + r.amp * 0.35 * Math.sin(x / (r.wl * 0.37) + 1.7);
  }

  riverDist(x: number, z: number): number {
    return this.cfg.river ? Math.abs(z - this.riverZ(x)) : 1e9;
  }

  private buildHeights() {
    const { cfg, n, cell, size } = this;
    const noise = makeNoise2D(cfg.seed);
    const raw = (x: number, z: number) => {
      let h = 3.5 + cfg.relief * (fbm(noise, x / 260, z / 260, 4) * 0.5 + 0.5);
      h += 1.2 * fbm(noise, x / 38 + 40, z / 38 - 17, 2);
      if (cfg.river) {
        const d = this.riverDist(x, z), w = cfg.river.width;
        h += Math.min(d, 420) * 0.012;
        h = lerp(-2.6, h, smoothstep(w * 0.45, w * 2.4, d));
      }
      return h;
    };
    const centers = cfg.flats.map((f) => Math.max(1.6, raw(f.x, f.z)));
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -size / 2 + ix * cell, z = -size / 2 + iz * cell;
        let h = raw(x, z);
        cfg.flats.forEach((f, i) => {
          const d = Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz);
          if (d < 1.5) h = lerp(centers[i], h, smoothstep(1, 1.5, d));
        });
        this.hf[iz * n + ix] = h;
      }
    }
  }

  groundAt(x: number, z: number): number {
    const { n, cell, size, hf } = this;
    const fx = clamp((x + size / 2) / cell, 0, n - 1.001), fz = clamp((z + size / 2) / cell, 0, n - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const i = iz * n + ix;
    return (hf[i] * (1 - u) + hf[i + 1] * u) * (1 - v) + (hf[i + n] * (1 - u) + hf[i + n + 1] * u) * v;
  }

  isWater(x: number, z: number): boolean {
    return this.waterLevel !== null && this.groundAt(x, z) < this.waterLevel;
  }

  private own<T extends { dispose(): void }>(d: T): T { this.disposables.push(d); return d; }

  private buildTerrain() {
    const { cfg, n, size } = this;
    const pal = cfg.palette;
    const geo = this.own(new THREE.PlaneGeometry(size, size, n - 1, n - 1));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const heat = new Float32Array(pos.count * 3);
    const noise = makeNoise2D(cfg.seed + 7);
    const cA = new THREE.Color(pal.groundA), cB = new THREE.Color(pal.groundB), cS = new THREE.Color(pal.shore);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = this.hf[i];
      pos.setY(i, h);
      const x = pos.getX(i), z = pos.getZ(i);
      const t = fbm(noise, x / 70, z / 70, 3) * 0.5 + 0.5;
      c.copy(cA).lerp(cB, t);
      if (this.waterLevel !== null) c.lerp(cS, 1 - smoothstep(0.1, 1.4, h));
      c.multiplyScalar(0.9 + 0.2 * noise(x / 9, z / 9));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      const g = h < 0 ? 0.02 : 0.1 + 0.05 * t;
      heat[i * 3] = g; heat[i * 3 + 1] = g; heat[i * 3 + 2] = g;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const detail = this.own(noiseTexture(cfg.seed));
    detail.repeat.set(size / 7, size / 7);
    const mat = this.own(new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
    this.scene.add(new THREE.Mesh(geo, mat));

    const tgeo = this.own(new THREE.BufferGeometry());
    tgeo.setAttribute("position", pos);
    tgeo.setIndex(geo.index);
    tgeo.setAttribute("color", new THREE.BufferAttribute(heat, 3));
    const tm = new THREE.Mesh(tgeo, this.own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
    tm.layers.set(THERMAL_LAYER);
    this.scene.add(tm);

    if (this.waterLevel !== null) {
      const wg = this.own(new THREE.PlaneGeometry(size, size));
      wg.rotateX(-Math.PI / 2);
      const wm = this.own(new THREE.MeshPhongMaterial({
        color: pal.water, transparent: true, opacity: 0.86, shininess: 90, specular: 0x8899aa,
      }));
      const water = new THREE.Mesh(wg, wm);
      water.position.y = this.waterLevel;
      this.scene.add(water);
      this.addThermal(water, 0.03);
    }
  }

  private buildTrees() {
    const { cfg, size } = this;
    const rnd = mulberry32(cfg.seed * 31 + 5);
    const noise = makeNoise2D(cfg.seed + 99);
    const step = Math.sqrt(100 / Math.max(0.05, cfg.forestDensity));
    const xs: number[] = [], zs: number[] = [], hs: number[] = [], rs: number[] = [];
    const half = size / 2 - 20;
    for (let gz = -half; gz < half; gz += step) {
      for (let gx = -half; gx < half; gx += step) {
        const x = gx + rnd() * step, z = gz + rnd() * step;
        const hgt = 9 + rnd() * 13;
        if (fbm(noise, x / 120, z / 120, 2) < -0.22) continue;
        if (!this.treeAllowed(x, z)) continue;
        xs.push(x); zs.push(z); hs.push(hgt); rs.push(1.5 + hgt * 0.1 + rnd() * 0.8);
      }
    }
    const count = xs.length;
    this.treeCount = count;
    this.treeX = Float32Array.from(xs); this.treeZ = Float32Array.from(zs);
    this.treeH = Float32Array.from(hs); this.treeR = Float32Array.from(rs);
    this.treeY = new Float32Array(count);
    this.treeAlive = new Uint8Array(count).fill(1);

    const geo = this.own(spruceGeometry(!!cfg.palette.snow));
    const mat = this.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.count = count;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const base = new THREE.Color(cfg.palette.tree), alt = new THREE.Color(cfg.palette.treeVar);
    for (let i = 0; i < count; i++) {
      const y = this.groundAt(xs[i], zs[i]) - 0.2;
      this.treeY[i] = y;
      p.set(xs[i], y, zs[i]);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6.28);
      s.set(rs[i], hs[i], rs[i]);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      const col = base.clone().lerp(alt, rnd());
      this.treeBase.push(col);
      mesh.setColorAt(i, col);
      const key = this.gridKey(xs[i], zs[i]);
      let list = this.treeGrid.get(key);
      if (!list) this.treeGrid.set(key, (list = []));
      list.push(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.treeMesh = mesh;
    this.scene.add(mesh);
    this.disposables.push(mesh);

    const tmesh = new THREE.InstancedMesh(geo, this.own(new THREE.MeshBasicMaterial({ color: 0x242424, fog: false })), Math.max(1, count));
    tmesh.count = count;
    tmesh.instanceMatrix = mesh.instanceMatrix;
    tmesh.frustumCulled = false;
    tmesh.layers.set(THERMAL_LAYER);
    this.scene.add(tmesh);
  }

  private treeAllowed(x: number, z: number): boolean {
    const { cfg } = this;
    if (cfg.river && this.riverDist(x, z) < cfg.river.width * 1.5) return false;
    for (const f of cfg.flats) {
      if (Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz) < 1.25) return false;
    }
    for (const c of cfg.clearings) if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
    for (const s of cfg.corridors ?? []) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const t = clamp(((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.w) return false;
    }
    return this.groundAt(x, z) > 0.9;
  }

  private gridKey(x: number, z: number) {
    return Math.floor(x / TREE_CELL) * 4096 + Math.floor(z / TREE_CELL);
  }

  treesNear(x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / TREE_CELL), x1 = Math.floor((x + r) / TREE_CELL);
    const z0 = Math.floor((z - r) / TREE_CELL), z1 = Math.floor((z + r) / TREE_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.treeGrid.get(cx * 4096 + cz);
        if (list) for (const i of list) if (this.treeAlive[i]) out.push(i);
      }
    }
    return out;
  }

  private scratch: number[] = [];
  collide(p: THREE.Vector3, r: number): string | null {
    for (const i of this.treesNear(p.x, p.z, 6 + r, this.scratch)) {
      const rel = (p.y - this.treeY[i]) / this.treeH[i];
      if (rel < 0 || rel > 1) continue;
      const rad = rel < 0.18 ? 0.25 : this.treeR[i] * (1 - rel) * 0.85;
      if (Math.hypot(p.x - this.treeX[i], p.z - this.treeZ[i]) < rad + r * 0.6) return "Столкновение с деревом";
    }
    for (const c of this.colliders) {
      const hit = c(p, r);
      if (hit) return hit;
    }
    return null;
  }

  removeTree(i: number) {
    this.treeAlive[i] = 0;
    this.treeMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }

  /** k: 0 — исходный цвет, 1 — полностью обугленное. glow — отсвет пламени. */
  tintTree(i: number, k: number, glow: number) {
    const c = this.treeBase[i].clone().lerp(new THREE.Color(0x15110e), k);
    if (glow > 0) c.lerp(new THREE.Color(0xff6a10), glow * 0.7);
    this.treeMesh.setColorAt(i, c);
    if (this.treeMesh.instanceColor) this.treeMesh.instanceColor.needsUpdate = true;
  }

  /** Добавляет копию объекта в тепловой слой. heat 0..1 — яркость. */
  addThermal(obj: THREE.Object3D, heat: number) {
    const mat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(heat, heat, heat), fog: false }));
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.layers.mask === 1) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const t = new THREE.Mesh(m.geometry, mat);
      t.layers.set(THERMAL_LAYER);
      m.add(t);
    }
  }

  private buildSky() {
    const pal = this.cfg.palette;
    const geo = this.own(new THREE.SphereGeometry(3000, 24, 12));
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(pal.skyTop), bot = new THREE.Color(pal.skyBottom), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(bot).lerp(top, smoothstep(0, 0.45, pos.getY(i) / 3000));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    this.sky = new THREE.Mesh(geo, this.own(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    })));
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);
    this.scene.background = new THREE.Color(pal.fog);

    const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity);
    sun.position.set(...pal.sunDir).multiplyScalar(500);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(pal.ambient, pal.groundA, pal.ambientIntensity));
  }

  track<T extends { dispose(): void }>(d: T): T { return this.own(d); }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }
}

function noiseTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  const rnd = mulberry32(seed + 3);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 200 + Math.floor(rnd() * 55);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paint(g: THREE.BufferGeometry, color: THREE.Color, topColor?: THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
    c.copy(color);
    if (topColor) c.lerp(topColor, t);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}

/** Ель единичной высоты и единичного радиуса кроны. */
function spruceGeometry(snow: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.26, 5, 1, true);
  trunk.translate(0, 0.13, 0);
  parts.push(paint(trunk, new THREE.Color(0x4a3a2c)));
  const tiers: [number, number, number][] = [[0.16, 0.56, 1], [0.42, 0.8, 0.72], [0.66, 1, 0.45]];
  const dark = new THREE.Color(0.62, 0.62, 0.62), light = snow ? new THREE.Color(2.3, 2.4, 2.6) : new THREE.Color(1.15, 1.15, 1.1);
  for (const [y0, y1, r] of tiers) {
    const cone = new THREE.ConeGeometry(r, y1 - y0, 7, 1, true);
    cone.translate(0, (y0 + y1) / 2, 0);
    parts.push(paint(cone, dark, light));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

// ─────────────────────────── постройки и реквизит ───────────────────────────

export function lambert(color: number, extra: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  return m;
}

export function makeHelipad(label: string, color = "#ffd700"): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#2b2f36"; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = color; x.lineWidth = 14;
  x.beginPath(); x.arc(128, 128, 104, 0, 6.3); x.stroke();
  x.fillStyle = color; x.font = "bold 150px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(label, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.12, 28), [
    lambert(0x2b2f36), new THREE.MeshLambertMaterial({ map: tex }), lambert(0x2b2f36),
  ]);
  pad.position.y = 0.06;
  pad.rotation.y = Math.PI / 2;
  g.add(pad);
  return g;
}

export function makeBaseCamp(): THREE.Group {
  const g = new THREE.Group();
  g.add(makeHelipad("H"));
  const van = new THREE.Group();
  van.add(box(2.2, 1.9, 5.2, 0xd8dde3, 0, 1.25, 0), box(2.2, 0.5, 5.2, 0xc8102e, 0, 0.75, 0), box(2, 0.9, 1.3, 0x22303c, 0, 1.75, -1.9));
  van.position.set(-9, 0, 3);
  van.rotation.y = 0.5;
  g.add(van);
  const tent = new THREE.Mesh(new THREE.ConeGeometry(3, 2.6, 4), lambert(0x4d6b3c));
  tent.position.set(8.5, 1.3, 5);
  tent.rotation.y = Math.PI / 4;
  g.add(tent);
  const mast = box(0.1, 6, 0.1, 0xdddddd, 7, 3, -5);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 8), lambert(0xff5a1f));
  sock.name = "windsock";
  sock.position.set(7, 5.8, -5);
  g.add(mast, sock);
  return g;
}

export function makeHouse(rnd: () => number, snow: boolean): THREE.Group {
  const g = new THREE.Group();
  const w = 6 + rnd() * 3, d = 5 + rnd() * 3, h = 2.8;
  const walls = [0x7a5a3c, 0x8b6b48, 0x6b5138, 0x5f6f7a][Math.floor(rnd() * 4)];
  g.add(box(w, h, d, walls, 0, h / 2, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, d * 0.78, 2.2, 4, 1), lambert(snow ? 0xeef2f6 : 0x4a3530));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / d, 1, 1);
  roof.position.y = h + 1.1;
  g.add(roof);
  g.add(box(0.6, 1.4, 0.6, 0x55504c, w * 0.25, h + 1.4, 0));
  return g;
}

export function makePerson(jacket: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 3, 8), lambert(jacket));
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), lambert(0xe8b998));
  head.position.y = 1.72;
  g.add(body, head);
  return g;
}

export function makeAnimal(kind: "moose" | "bear"): THREE.Group {
  const g = new THREE.Group();
  const col = kind === "moose" ? 0x4a3526 : 0x2c211a;
  const L = kind === "moose" ? 2.3 : 1.7, H = kind === "moose" ? 1.5 : 0.9;
  g.add(box(0.75, 0.8, L, col, 0, H, 0), box(0.4, 0.45, 0.7, col, 0, H + 0.35, -L / 2 - 0.2));
  for (const sx of [-0.25, 0.25]) for (const sz of [-L / 2 + 0.2, L / 2 - 0.2]) g.add(box(0.16, H - 0.3, 0.16, col, sx, (H - 0.3) / 2, sz));
  return g;
}

export function makePylon(height: number, span: number): THREE.Group {
  const g = new THREE.Group();
  const steel = 0x9aa4ad;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.9, height, 4, 4, true),
    new THREE.MeshLambertMaterial({ color: steel, wireframe: true }));
  body.position.y = height / 2;
  body.rotation.y = Math.PI / 4;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.5, height, 4), lambert(steel));
  core.position.y = height / 2;
  g.add(body, core);
  g.add(box(span * 2, 0.3, 0.3, steel, 0, height - 4, 0));
  g.add(box(span * 1.3, 0.25, 0.25, steel, 0, height - 0.6, 0));
  for (const sx of [-span, span]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6), lambert(0x6b3b2a));
    ins.position.set(sx, height - 4.8, 0);
    g.add(ins);
  }
  return g;
}

export function makeRing(radius: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, 0.28, 8, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
}

export function makeBeam(color: number, height = 90, radius = 1.6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  m.position.y = height / 2;
  return m;
}
