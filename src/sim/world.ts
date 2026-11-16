// Процедурный мир: рельеф, река, тайга, постройки. Слой 0 — видимый спектр, слой 1 — тепловизор.
import * as THREE from "three";
import { clamp, fbm, lerp, makeNoise2D, mulberry32, smoothstep } from "./noise";
import { makeFoliageMaterial, makeSkyMaterial, makeTerrainMaterial, makeWaterMaterial, SkyParams } from "./shaders";

export const THERMAL_LAYER = 1;
export type Quality = "high" | "medium" | "low";

export interface Palette {
  groundA: number; groundB: number; shore: number;
  tree: number; treeVar: number; water: number;
  skyTop: number; skyBottom: number; fog: number; fogDensity: number;
  sun: number; sunIntensity: number; ambient: number; ambientIntensity: number;
  sunDir: [number, number, number];
  clouds: number; // 0 — ясно, 1 — сплошная облачность
  exposure: number;
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
const CHUNK = 128;
const SPRUCE = 0, PINE = 1;

interface TreeRef { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; th: THREE.InstancedMesh; idx: number }
interface Chunk { x: number; z: number; hi: THREE.InstancedMesh; lo: THREE.InstancedMesh }

export class World {
  scene = new THREE.Scene();
  cfg: WorldCfg;
  quality: Quality;
  size: number;
  n = 257;
  cell: number;
  hf: Float32Array;
  waterLevel: number | null;
  treeX: Float32Array; treeZ: Float32Array; treeY: Float32Array; treeH: Float32Array; treeR: Float32Array;
  treeKind: Uint8Array;
  treeAlive: Uint8Array;
  treeCount = 0;
  colliders: ((p: THREE.Vector3, r: number) => string | null)[] = [];
  sky!: THREE.Mesh;
  sun!: THREE.DirectionalLight;
  time = { value: 0 };
  skyParams!: SkyParams;
  private treeGrid = new Map<number, number[]>();
  private treeTint: number[] = [];
  private refs: TreeRef[] = [];
  private chunks: Chunk[] = [];
  private disposables: { dispose(): void }[] = [];
  private terrainColors!: THREE.BufferAttribute;
  private lodAcc = 1;
  private atlas!: THREE.Texture;
  private spruceLo!: THREE.BufferGeometry;

  constructor(cfg: WorldCfg, quality: Quality) {
    this.cfg = cfg;
    this.quality = quality;
    this.size = cfg.size;
    this.cell = cfg.size / (this.n - 1);
    this.hf = new Float32Array(this.n * this.n);
    this.waterLevel = cfg.river ? 0 : null;
    this.treeX = new Float32Array(0); this.treeZ = new Float32Array(0); this.treeY = new Float32Array(0);
    this.treeH = new Float32Array(0); this.treeR = new Float32Array(0);
    this.treeKind = new Uint8Array(0); this.treeAlive = new Uint8Array(0);
    this.buildHeights();
    this.buildSky();
    this.buildTerrain();
    this.buildTrees();
    this.buildGroundCover();
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
  track<T extends { dispose(): void }>(d: T): T { return this.own(d); }

  // ───────────── небо и свет ─────────────

  private buildSky() {
    const pal = this.cfg.palette;
    const sunDir = new THREE.Vector3(...pal.sunDir).normalize();
    const horizon = new THREE.Color(pal.skyBottom);
    this.skyParams = {
      zenith: new THREE.Color(pal.skyTop), horizon, sunDir,
      sunColor: new THREE.Color(pal.sun).multiplyScalar(pal.sunIntensity * (1 - pal.clouds * 0.75)),
      cover: pal.clouds,
      cloudLit: new THREE.Color(pal.sun).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(0.95 - pal.clouds * 0.3),
      cloudDark: new THREE.Color(pal.skyBottom).multiplyScalar(0.62),
    };
    const geo = this.own(new THREE.SphereGeometry(1, 32, 16));
    this.sky = new THREE.Mesh(geo, this.own(makeSkyMaterial(this.skyParams, this.time)));
    this.sky.scale.setScalar(3500);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);
    this.scene.background = new THREE.Color(pal.fog);

    const sun = new THREE.DirectionalLight(pal.sun, pal.sunIntensity * (1 - pal.clouds * 0.6));
    sun.position.copy(sunDir).multiplyScalar(400);
    if (this.quality !== "low") {
      sun.castShadow = true;
      const s = this.quality === "high" ? 4096 : 2048, r = this.quality === "high" ? 170 : 120;
      sun.shadow.mapSize.set(s, s);
      const c = sun.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 50; c.far = 900;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
    }
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(pal.ambient, new THREE.Color(pal.groundA).multiplyScalar(0.6), pal.ambientIntensity));
  }

  /** Карта окружения для PBR-отражений строится из самого неба. */
  bakeEnvironment(renderer: THREE.WebGLRenderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const sky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    sky.scale.setScalar(100);
    s.add(sky);
    const rt = pm.fromScene(s, 0, 1, 1000);
    this.own(rt);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  /** Каждый кадр: тени следуют за аппаратом, деревья переключают уровень детализации. */
  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3) {
    this.time.value += dt;
    this.sky.position.copy(camPos);
    if (this.sun.castShadow) {
      const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x * 4;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, this.groundAt(fx, fz), fz);
      this.sun.position.copy(this.sun.target.position).addScaledVector(this.skyParams.sunDir, 420);
    }
    this.lodAcc += dt;
    if (this.lodAcc > 0.3) {
      this.lodAcc = 0;
      const far = this.quality === "high" ? 230 : this.quality === "medium" ? 150 : -1;
      for (const c of this.chunks) {
        const near = Math.hypot(c.x - camPos.x, c.z - camPos.z) < far;
        c.hi.visible = near; c.lo.visible = !near;
      }
    }
  }

  // ───────────── рельеф и вода ─────────────

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
      const t = fbm(noise, x / 90, z / 90, 3) * 0.5 + 0.5;
      c.copy(cA).lerp(cB, smoothstep(0.3, 0.7, t));
      if (this.waterLevel !== null) c.lerp(cS, 1 - smoothstep(0.1, 1.5, h));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      const g = h < 0 ? 0.004 : 0.02 + 0.02 * t;
      heat[i * 3] = g; heat[i * 3 + 1] = g; heat[i * 3 + 2] = g;
    }
    this.terrainColors = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute("color", this.terrainColors);
    geo.computeVertexNormals();

    const mat = this.own(pal.snow
      ? makeTerrainMaterial(new THREE.Color(0.86, 0.9, 1), new THREE.Color(0.62, 0.7, 0.82), new THREE.Color(0x6f7780), 0.5, 0.7)
      : makeTerrainMaterial(new THREE.Color(0.62, 0.8, 0.55), new THREE.Color(0x4d3f2a), new THREE.Color(0x6a655c), 1.5, 0.96));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const tgeo = this.own(new THREE.BufferGeometry());
    tgeo.setAttribute("position", pos);
    tgeo.setIndex(geo.index);
    tgeo.setAttribute("color", new THREE.BufferAttribute(heat, 3));
    const tm = new THREE.Mesh(tgeo, this.own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false })));
    tm.layers.set(THERMAL_LAYER);
    this.scene.add(tm);

    if (this.waterLevel !== null) {
      const wg = this.own(new THREE.PlaneGeometry(size * 2.5, size * 2.5));
      wg.rotateX(-Math.PI / 2);
      const normals = this.own(new THREE.TextureLoader().load("/sim/waternormals.jpg"));
      normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
      const wm = this.own(makeWaterMaterial(this.skyParams, new THREE.Color(pal.water).multiplyScalar(0.55), normals, this.scene.fog as THREE.FogExp2, this.time));
      const water = new THREE.Mesh(wg, wm);
      water.position.y = this.waterLevel;
      this.scene.add(water);
      this.addThermal(water, 0.004);
    }
  }

  /** Затемняет грунт в круге (гарь). */
  scorch(x: number, z: number, r: number, k: number) {
    const { n, cell, size } = this;
    const a = this.terrainColors;
    const i0 = Math.max(0, Math.floor((x - r + size / 2) / cell)), i1 = Math.min(n - 1, Math.ceil((x + r + size / 2) / cell));
    const j0 = Math.max(0, Math.floor((z - r + size / 2) / cell)), j1 = Math.min(n - 1, Math.ceil((z + r + size / 2) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const idx = j * n + i;
      a.setXYZ(idx, lerp(a.getX(idx), 0.035, k), lerp(a.getY(idx), 0.03, k), lerp(a.getZ(idx), 0.028, k));
    }
    a.needsUpdate = true;
  }

  // ───────────── лес ─────────────

  private buildTrees() {
    const { cfg, size } = this;
    const pal = cfg.palette;
    const rnd = mulberry32(cfg.seed * 31 + 5);
    const noise = makeNoise2D(cfg.seed + 99);
    const step = Math.sqrt(100 / Math.max(0.05, cfg.forestDensity));
    const xs: number[] = [], zs: number[] = [], hs: number[] = [], rs: number[] = [], kinds: number[] = [];
    const half = size / 2 - 20;
    for (let gz = -half; gz < half; gz += step) {
      for (let gx = -half; gx < half; gx += step) {
        const x = gx + rnd() * step, z = gz + rnd() * step;
        const u = rnd(), v = rnd(), w = rnd();
        if (fbm(noise, x / 120, z / 120, 2) < -0.22) continue;
        if (!this.treeAllowed(x, z)) continue;
        // сосны — на сухих гривах, ели — в низинах
        const pine = fbm(noise, x / 210 + 31, z / 210 - 12, 2) + (this.groundAt(x, z) - 8) * 0.02 > 0.12 ? v < 0.8 : v < 0.12;
        const hgt = pine ? 15 + u * 11 : 9 + u * 15;
        xs.push(x); zs.push(z); hs.push(hgt); kinds.push(pine ? PINE : SPRUCE);
        rs.push(pine ? 2.2 + hgt * 0.06 + w * 0.8 : 1.5 + hgt * 0.1 + w * 0.8);
      }
    }
    const count = xs.length;
    this.treeCount = count;
    this.treeX = Float32Array.from(xs); this.treeZ = Float32Array.from(zs);
    this.treeH = Float32Array.from(hs); this.treeR = Float32Array.from(rs);
    this.treeKind = Uint8Array.from(kinds);
    this.treeY = new Float32Array(count);
    this.treeAlive = new Uint8Array(count).fill(1);

    const base = new THREE.Color(pal.tree), alt = new THREE.Color(pal.treeVar);
    const snow = !!pal.snow;
    const atlas = this.own(conifersAtlas(base, alt, snow));
    this.atlas = atlas;
    const geos = [
      { hi: this.own(spruceGeometry(mulberry32(3), snow, true)), lo: this.own(spruceGeometry(mulberry32(3), snow, false)) },
      { hi: this.own(pineGeometry(mulberry32(4), snow, true)), lo: this.own(pineGeometry(mulberry32(4), snow, false)) },
    ];
    this.spruceLo = geos[0].lo;
    const foliage = this.own(makeFoliageMaterial(this.time, 0.012, atlas, this.quality === "high"));
    const thermalMat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.05, 0.05), fog: false, toneMapped: false }));

    const buckets = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
      const key = `${Math.floor(xs[i] / CHUNK)},${Math.floor(zs[i] / CHUNK)},${kinds[i]}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
      const gk = this.gridKey(xs[i], zs[i]);
      let list = this.treeGrid.get(gk);
      if (!list) this.treeGrid.set(gk, (list = []));
      list.push(i);
    }
    this.refs = new Array(count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, list] of buckets) {
      const [cx, cz, kind] = key.split(",").map(Number);
      const g = geos[kind];
      const hi = new THREE.InstancedMesh(g.hi, foliage, list.length);
      const lo = new THREE.InstancedMesh(g.lo, foliage, list.length);
      const th = new THREE.InstancedMesh(g.lo, thermalMat, list.length);
      list.forEach((i, k) => {
        const y = this.groundAt(xs[i], zs[i]) - 0.25;
        this.treeY[i] = y;
        p.set(xs[i], y, zs[i]);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6.28);
        s.set(rs[i], hs[i], rs[i]);
        hi.setMatrixAt(k, m4.compose(p, q, s));
        const tint = 0.72 + rnd() * 0.5;
        this.treeTint[i] = tint;
        col.setScalar(tint);
        hi.setColorAt(k, col);
        this.refs[i] = { hi, lo, th, idx: k };
      });
      lo.instanceMatrix = hi.instanceMatrix;
      th.instanceMatrix = hi.instanceMatrix;
      lo.instanceColor = hi.instanceColor;
      for (const m of [hi, lo, th]) { m.computeBoundingSphere(); this.scene.add(m); this.disposables.push(m); }
      hi.castShadow = true; hi.receiveShadow = true; lo.receiveShadow = true;
      hi.visible = false;
      th.layers.set(THERMAL_LAYER);
      this.chunks.push({ x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, hi, lo });
    }
  }

  private buildGroundCover() {
    if (this.quality === "low") return;
    const { cfg, size } = this;
    const snow = !!cfg.palette.snow;
    const rnd = mulberry32(cfg.seed * 7 + 1);
    const half = size / 2 - 30;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();
    const scatter = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, size0: number, size1: number, squash: number, sink: number, shade: [number, number], tilt = 0.5) => {
      const mesh = new THREE.InstancedMesh(this.own(geo), this.own(mat), count);
      let k = 0;
      for (let tries = 0; tries < count * 4 && k < count; tries++) {
        const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
        const h = this.groundAt(x, z);
        if (h < 0.5 || this.inFlat(x, z, 1.05)) continue;
        const sc = size0 + rnd() * (size1 - size0);
        p.set(x, h - sc * sink, z);
        q.setFromEuler(e.set((rnd() - 0.5) * tilt, rnd() * 6.28, (rnd() - 0.5) * tilt));
        s.set(sc * (0.7 + rnd() * 0.6), sc * squash * (0.7 + rnd() * 0.6), sc * (0.7 + rnd() * 0.6));
        mesh.setMatrixAt(k, m4.compose(p, q, s));
        mesh.setColorAt(k, col.setScalar(shade[0] + rnd() * (shade[1] - shade[0])));
        k++;
      }
      mesh.count = k;
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.disposables.push(mesh);
    };
    // подрост: молодые ёлочки 1–3 м
    const saplings = this.quality === "high" ? 4000 : 1500;
    scatter(this.spruceLo.clone(), makeFoliageMaterial(this.time, 0.02, this.atlas, this.quality === "high"), saplings, 0.45, 1.3, 2.4, 0.05, [0.7, 1.2], 0.08);
    scatter(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: snow ? 0xb8c0c8 : 0x77736b, roughness: 0.95, flatShading: true }),
      1400, 0.3, 1.6, 0.6, 0.35, [0.7, 1.15]);
    const log = new THREE.CylinderGeometry(0.16, 0.2, 1, 7);
    log.rotateZ(Math.PI / 2);
    scatter(log, new THREE.MeshStandardMaterial({ color: snow ? 0x8a8478 : 0x4a3a2c, roughness: 1 }), 500, 4, 9, 1, 0.02, [0.7, 1.1]);
  }

  private inFlat(x: number, z: number, k: number): boolean {
    for (const f of this.cfg.flats) if (Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz) < k) return true;
    return false;
  }

  private treeAllowed(x: number, z: number): boolean {
    const { cfg } = this;
    if (cfg.river && this.riverDist(x, z) < cfg.river.width * 1.5) return false;
    if (this.inFlat(x, z, 1.25)) return false;
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
      let rad: number;
      if (this.treeKind[i] === PINE) rad = rel < 0.55 ? 0.3 : this.treeR[i] * 0.8;
      else rad = rel < 0.14 ? 0.25 : this.treeR[i] * (1 - rel) * 0.85;
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
    const ref = this.refs[i];
    ref.hi.setMatrixAt(ref.idx, new THREE.Matrix4().makeScale(0, 0, 0));
    ref.hi.instanceMatrix.needsUpdate = true;
  }

  /** k: 0 — живое дерево, 1 — полностью обугленное. glow — отсвет пламени. */
  tintTree(i: number, k: number, glow: number) {
    const ref = this.refs[i];
    const t = this.treeTint[i];
    const c = new THREE.Color(t, t, t).lerp(new THREE.Color(0.1, 0.08, 0.07), k);
    if (glow > 0) c.lerp(new THREE.Color(2.2, 0.7, 0.15), glow * 0.55);
    ref.hi.setColorAt(ref.idx, c);
    ref.hi.instanceColor!.needsUpdate = true;
  }

  /** Добавляет копию объекта в тепловой слой. heat 0..1 — яркость. */
  addThermal(obj: THREE.Object3D, heat: number) {
    const mat = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(heat, heat, heat), fog: false, toneMapped: false }));
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.layers.mask === 1) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const t = new THREE.Mesh(m.geometry, mat);
      t.layers.set(THERMAL_LAYER);
      m.add(t);
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        mat.dispose();
      }
    });
  }
}

// ─────────────────────────── геометрия деревьев ───────────────────────────

// Атлас 1024×512: верх — ветвь ели, низ слева — ветвь сосны, справа внизу — сплошной тёмный участок для «сердцевины» кроны.
const SOLID_UV: [number, number] = [0.97, 0.03];
const BARK_UV: [number, number] = [0.97, 0.09];
const PINE_BARK_UV: [number, number] = [0.97, 0.15];
const SPRUCE_V: [number, number] = [0.5, 1];
const PINE_V: [number, number] = [0, 0.5];
const PINE_U = 0.88;

function conifersAtlas(spruce: THREE.Color, pine: THREE.Color, snow: boolean): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(911);
  const css = (col: THREE.Color, k: number, a = 1) => {
    const t = col.clone().convertLinearToSRGB();
    return `rgba(${Math.min(255, t.r * 255 * k) | 0},${Math.min(255, t.g * 255 * k) | 0},${Math.min(255, t.b * 255 * k) | 0},${a})`;
  };
  const bark = "rgba(70,52,38,1)";

  // ветвь ели: стебель, боковые побеги, короткая густая хвоя
  const y0 = 0, h0 = H / 2;
  const twig = (x0: number, yA: number, x1: number, yB: number, w: number) => {
    g.strokeStyle = bark; g.lineWidth = w; g.beginPath(); g.moveTo(x0, yA); g.lineTo(x1, yB); g.stroke();
  };
  const needles = (x0: number, yA: number, x1: number, yB: number, len: number, density: number, col: THREE.Color, tipBoost: number) => {
    const n = Math.hypot(x1 - x0, yB - yA) * density;
    for (let i = 0; i < n; i++) {
      const t = rnd(), x = x0 + (x1 - x0) * t, y = yA + (yB - yA) * t;
      const ang = Math.atan2(yB - yA, x1 - x0) + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7);
      const L = len * (0.6 + rnd() * 0.6) * (1 - t * 0.35);
      const k = 1.0 + rnd() * 0.7 + t * tipBoost;
      g.strokeStyle = css(col, k);
      g.lineWidth = 2.6 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L); g.stroke();
    }
  };
  const cy = y0 + h0 / 2;
  // плотная «подложка» побега, чтобы ветвь не рассыпалась на дальних мип-уровнях
  const body = (x0: number, yA: number, x1: number, yB: number, w: number, col: THREE.Color) => {
    g.strokeStyle = css(col, 0.75); g.lineCap = "round"; g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, yA); g.lineTo(x1, yB); g.stroke();
    g.lineCap = "butt";
  };
  twig(4, cy, W - 20, cy + 6, 6);
  for (let k = 0; k < 9; k++) {
    const t = 0.08 + k * 0.1, x = 4 + (W - 30) * t;
    for (const side of [-1, 1]) {
      const len = (h0 * 0.42) * (1 - t * 0.55) * (0.8 + rnd() * 0.3);
      const ex = x + len * 0.9, ey = cy + side * len * 0.75;
      body(x, cy, ex, ey, 15, spruce);
      twig(x, cy, ex, ey, 3);
      needles(x, cy, ex, ey, 24, 2.6, spruce, 0.6);
    }
  }
  body(10, cy, W - 40, cy + 6, 26, spruce);
  needles(4, cy, W - 20, cy + 6, 30, 2.2, spruce, 0.5);
  if (snow) {
    for (let i = 0; i < 260; i++) {
      const x = 20 + rnd() * (W - 60), y = cy + (rnd() - 0.5) * h0 * 0.7;
      const r = 4 + rnd() * 12;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(245,248,255,0.95)"); gr.addColorStop(1, "rgba(235,240,250,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
    }
  }

  // ветвь сосны: голый сучок и пучки длинной хвои на концах
  const py = H * 0.75, pw = W * PINE_U;
  twig(4, py, pw - 40, py - 8, 7);
  const tufts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const t = 0.25 + k * 0.075, x = 4 + (pw - 50) * t;
    for (const side of [-1, 1]) {
      if (rnd() < 0.15) continue;
      const len = h0 * 0.3 * (0.7 + rnd() * 0.4);
      const ex = x + len * 0.6, ey = py - 4 + side * len * 0.8;
      twig(x, py - 4, ex, ey, 3);
      tufts.push([ex, ey]);
    }
  }
  tufts.push([pw - 40, py - 8], [pw - 90, py - 6]);
  for (const [x, y] of tufts) {
    g.fillStyle = css(pine, 0.7);
    g.beginPath(); g.ellipse(x, y, 40, 30, 0, 0, 6.3); g.fill();
    for (let i = 0; i < 90; i++) {
      const ang = rnd() * 6.283, L = 20 + rnd() * 30;
      g.strokeStyle = css(pine, 1.0 + rnd() * 0.7); g.lineWidth = 2.4 + rnd() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L * 0.8); g.stroke();
    }
    if (snow && rnd() < 0.7) {
      const gr = g.createRadialGradient(x, y - 6, 0, x, y - 6, 22);
      gr.addColorStop(0, "rgba(245,248,255,0.95)"); gr.addColorStop(1, "rgba(235,240,250,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y - 6, 22, 0, 6.3); g.fill();
    }
  }
  // сплошной участок
  g.fillStyle = css(spruce, 0.75);
  g.fillRect(W * 0.94, H * 0.94, W * 0.06, H * 0.06);
  g.fillStyle = "rgb(78,62,50)";
  g.fillRect(W * 0.94, H * 0.88, W * 0.06, H * 0.06);
  g.fillStyle = "rgb(168,96,52)";
  g.fillRect(W * 0.94, H * 0.82, W * 0.06, H * 0.06);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

class CardSoup {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, shade: number) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(shade, shade, shade);
  }
  /** Ветвь-карточка: от ствола на высоте y под углом ang, длиной len, с провисанием droop и наклоном tilt вокруг своей оси. */
  segs = 2;
  branch(y: number, ang: number, len: number, width: number, droop: number, tilt: number, v: [number, number], u1: number, shade: number, rise = 0) {
    const seg = this.segs;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const rows: THREE.Vector3[][] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const c = dir.clone().multiplyScalar(len * t).setY(y + rise * t - droop * t * t);
      const w = width * (0.55 + 0.45 * Math.sin(Math.min(1, t * 1.6 + 0.15) * Math.PI * 0.85));
      const off = side.clone().multiplyScalar(ct * w / 2).setY(st * w / 2 * 0.25);
      rows.push([c.clone().sub(off), c.clone().add(off)]);
    }
    const n = new THREE.Vector3();
    for (let i = 0; i < seg; i++) {
      const a = rows[i], b = rows[i + 1];
      const ua = (i / seg) * u1, ub = ((i + 1) / seg) * u1;
      const quad: [THREE.Vector3, number, number][] = [[a[0], ua, v[0]], [b[0], ub, v[0]], [b[1], ub, v[1]], [a[0], ua, v[0]], [b[1], ub, v[1]], [a[1], ua, v[1]]];
      for (const [p, u, vv] of quad) {
        // нормали «наружу от ствола» — классический приём для мягкого освещения кроны
        n.set(p.x, (p.y - y) * 0.5 + 0.55 * Math.hypot(p.x, p.z), p.z).normalize();
        this.vert(p, n, u, vv, shade * (0.7 + 0.3 * Math.min(1, Math.hypot(p.x, p.z) / Math.max(0.05, len))));
      }
    }
  }
  /** Сплошная «сердцевина» кроны из атласного участка. */
  solid(geo: THREE.BufferGeometry, shade: number, uv: [number, number] = SOLID_UV) {
    const ng = geo.index ? geo.toNonIndexed() : geo;
    ng.computeVertexNormals();
    const p = ng.attributes.position, nn = ng.attributes.normal;
    const a = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(p, i); n.fromBufferAttribute(nn, i);
      this.vert(a, n, uv[0], uv[1], shade);
    }
    if (ng !== geo) ng.dispose();
    geo.dispose();
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function trunkInto(soup: CardSoup, y0: number, y1: number, r0: number, r1: number, segs: number, shade: number, uv = BARK_UV) {
  const t = new THREE.CylinderGeometry(r1, r0, y1 - y0, segs, 1, true);
  t.translate(0, (y0 + y1) / 2, 0);
  soup.solid(t, shade, uv);
}

/** Ель единичной высоты и радиуса: мутовки провисающих лап, густеющие к вершине. */
function spruceGeometry(rnd: () => number, snow: boolean, detailed: boolean): THREE.BufferGeometry {
  const soup = new CardSoup();
  soup.segs = detailed ? 2 : 1;
  trunkInto(soup, 0, 0.92, 0.055, 0.01, detailed ? 6 : 4, 0.9);
  const core = new THREE.ConeGeometry(detailed ? 0.26 : 0.4, 0.8, detailed ? 8 : 5, 1, true);
  core.translate(0, 0.54, 0);
  soup.solid(core, detailed ? 0.6 : 0.8);
  const tiers = detailed ? 13 : 6, per = detailed ? 7 : 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = 0.1 + 0.86 * t;
    const len = (Math.pow(1 - t, 0.85) * 0.95 + 0.07) * (detailed ? 1 : 1.08);
    const rot = rnd() * 6.28;
    const shade = 0.55 + 0.55 * t + (snow ? 0.1 : 0);
    for (let k = 0; k < per; k++) {
      const ang = rot + (k / per) * 6.283 + (rnd() - 0.5) * 0.5;
      const L = len * (0.8 + rnd() * 0.35);
      soup.branch(y, ang, L, L * 0.55 + 0.05, 0.05 + L * 0.06, (rnd() - 0.5) * 1.2, SPRUCE_V, 0.96, shade * (0.85 + rnd() * 0.3));
    }
  }
  // макушка
  for (let k = 0; k < 3; k++) soup.branch(0.93, k * 2.1, 0.08, 0.06, -0.06, 1.2, SPRUCE_V, 0.5, 1.2, 0.07);
  return soup.build();
}

/** Сосна: длинный голый ствол, крона из восходящих сучьев с пучками хвои в верхней трети. */
function pineGeometry(rnd: () => number, snow: boolean, detailed: boolean): THREE.BufferGeometry {
  const soup = new CardSoup();
  soup.segs = detailed ? 2 : 1;
  trunkInto(soup, 0, 0.45, 0.065, 0.045, detailed ? 7 : 4, 0.9);
  trunkInto(soup, 0.45, 0.97, 0.045, 0.016, detailed ? 7 : 4, 1, PINE_BARK_UV);
  const whorls = detailed ? 8 : 4, per = detailed ? 7 : 5;
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1);
    const y = 0.6 + 0.36 * t;
    const len = (0.95 - 0.5 * t) * (0.75 + rnd() * 0.35);
    const rot = rnd() * 6.28;
    for (let k = 0; k < per; k++) {
      const ang = rot + (k / per) * 6.283 + (rnd() - 0.5) * 0.7;
      const L = len * (0.6 + rnd() * 0.5);
      soup.branch(y, ang, L, L * 0.75 + 0.08, -0.01, (rnd() - 0.5) * 1.6, PINE_V, PINE_U, (0.8 + 0.4 * t) * (snow ? 1.1 : 1), 0.04 + rnd() * 0.05);
    }
  }
  return soup.build();
}

// ─────────────────────────── постройки и реквизит ───────────────────────────

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, mulberry32(w * 7 + h));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, dark: number, light: number) {
  for (let i = 0; i < n; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${dark * rnd()})` : `rgba(255,255,255,${light * rnd()})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
  }
}

export function std(color: number, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => part(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

export function makeHelipad(label: string, color = "#f2c230"): THREE.Group {
  const g = new THREE.Group();
  const tex = canvasTex(512, 512, (x, rnd) => {
    x.fillStyle = "#6f7275"; x.fillRect(0, 0, 512, 512);
    speckle(x, rnd, 512, 512, 9000, 0.25, 0.12);
    x.strokeStyle = "rgba(40,40,40,0.5)"; x.lineWidth = 2;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 512); x.moveTo(0, i * 128); x.lineTo(512, i * 128); x.stroke(); }
    x.strokeStyle = color; x.lineWidth = 26;
    x.beginPath(); x.arc(256, 256, 205, 0, 6.3); x.stroke();
    x.fillStyle = color; x.font = "bold 300px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(label, 256, 276);
    x.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; x.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 9, 1 + rnd() * 3); }
    x.globalCompositeOperation = "destination-over";
    x.fillStyle = "#6f7275"; x.fillRect(0, 0, 512, 512);
  });
  const side = std(0x5d6063, 0.95);
  const pad = part(new THREE.CylinderGeometry(3.5, 3.6, 0.14, 40), [side, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), side] as unknown as THREE.Material, 0, 0.07, 0);
  pad.rotation.y = Math.PI / 2;
  pad.castShadow = false;
  g.add(pad);
  return g;
}

function makeVan(): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xe4e7ea, 0.45, 0.1), red = std(0xc8102e, 0.5, 0.1), glass = std(0x10161c, 0.08, 0.6), tire = std(0x111111, 0.95);
  g.add(box(2.1, 1.75, 3.7, white, 0, 1.45, 0.8), box(2.1, 0.32, 3.7, red, 0, 1.0, 0.8));
  g.add(box(2.1, 0.95, 1.5, white, 0, 1.05, -1.8), box(1.95, 0.75, 1.1, white, 0, 1.85, -1.5));
  const wind = box(1.85, 0.62, 0.05, glass, 0, 1.87, -2.08);
  wind.rotation.x = -0.22;
  g.add(wind, box(2.12, 0.5, 0.75, glass, 0, 1.88, -1.5), box(2.14, 0.22, 5.2, std(0x22262a, 0.8), 0, 0.5, -0.05));
  for (const sx of [-1, 1]) for (const sz of [-1.75, 1.55]) {
    const w = part(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16), tire, sx * 0.98, 0.42, sz);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  const bar = box(1.2, 0.12, 0.25, std(0x2244ff, 0.3, 0, { emissive: 0x1133ff, emissiveIntensity: 1.5 }), 0, 2.3, -1.5);
  g.add(bar);
  return g;
}

export function makeBaseCamp(): THREE.Group {
  const g = new THREE.Group();
  g.add(makeHelipad("H"));
  const van = makeVan();
  van.position.set(-9, 0, 3);
  van.rotation.y = 0.5;
  g.add(van);
  // армейская палатка
  const canvasMat = std(0x56683f, 0.95, 0, { side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(-2.4, 0); shape.lineTo(-2.4, 1.3); shape.lineTo(0, 2.6); shape.lineTo(2.4, 1.3); shape.lineTo(2.4, 0); shape.closePath();
  const tent = part(new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }), canvasMat, 8.5, 0, 2.5);
  g.add(tent);
  // кейсы и генератор
  g.add(box(1.2, 0.5, 0.8, std(0x2a2d31, 0.6), 5, 0.25, -3), box(1.0, 0.45, 0.7, std(0xe0a020, 0.6), 5.1, 0.72, -3), box(0.9, 0.7, 0.6, std(0xb03020, 0.5, 0.2), -5, 0.35, -4));
  // мачта с ветроуказателем
  const mast = part(new THREE.CylinderGeometry(0.04, 0.06, 6, 8), std(0xd8d8d8, 0.4, 0.7), 7, 3, -5);
  const sockTex = canvasTex(64, 16, (x) => { for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? "#f4f4f4" : "#ff5a1f"; x.fillRect(i * 16, 0, 16, 16); } });
  sockTex.rotation = Math.PI / 2; sockTex.center.set(0.5, 0.5);
  const sock = part(new THREE.CylinderGeometry(0.12, 0.34, 1.7, 12, 1, true), new THREE.MeshStandardMaterial({ map: sockTex, roughness: 0.9, side: THREE.DoubleSide }));
  sock.geometry.translate(0, -0.85, 0);
  sock.name = "windsock";
  sock.position.set(7, 5.9, -5);
  g.add(mast, sock);
  return g;
}

let houseMats: { logs: THREE.Texture; planks: THREE.Texture; roof: THREE.Texture; win: THREE.Texture } | null = null;
function houseTextures() {
  if (houseMats) return houseMats;
  const logs = canvasTex(256, 256, (x, rnd) => {
    for (let i = 0; i < 8; i++) {
      const gr = x.createLinearGradient(0, i * 32, 0, i * 32 + 32);
      const b = 0.8 + rnd() * 0.3;
      gr.addColorStop(0, `rgb(${40 * b},${28 * b},${18 * b})`); gr.addColorStop(0.45, `rgb(${150 * b},${108 * b},${70 * b})`); gr.addColorStop(1, `rgb(${52 * b},${36 * b},${24 * b})`);
      x.fillStyle = gr; x.fillRect(0, i * 32, 256, 32);
    }
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(30,18,8,${rnd() * 0.3})`; x.fillRect(rnd() * 256, rnd() * 256, 8 + rnd() * 40, 1); }
  }, true);
  const planks = canvasTex(256, 256, (x, rnd) => {
    for (let i = 0; i < 12; i++) { const b = 0.75 + rnd() * 0.4; x.fillStyle = `rgb(${128 * b},${96 * b},${66 * b})`; x.fillRect(i * 21.4, 0, 20.4, 256); }
    for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(30,18,8,${rnd() * 0.25})`; x.fillRect(rnd() * 256, rnd() * 256, 1, 6 + rnd() * 30); }
  }, true);
  const roof = canvasTex(256, 256, (x, rnd) => {
    x.fillStyle = "#5a3a34"; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) {
      const gr = x.createLinearGradient(i * 16, 0, i * 16 + 16, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.35)"); gr.addColorStop(0.5, "rgba(255,255,255,0.14)"); gr.addColorStop(1, "rgba(0,0,0,0.35)");
      x.fillStyle = gr; x.fillRect(i * 16, 0, 16, 256);
    }
    speckle(x, rnd, 256, 256, 1500, 0.3, 0.08);
  }, true);
  const win = canvasTex(64, 64, (x) => {
    x.fillStyle = "#f2f2ee"; x.fillRect(0, 0, 64, 64);
    const gr = x.createLinearGradient(0, 0, 64, 64);
    gr.addColorStop(0, "#ffd58a"); gr.addColorStop(1, "#c98a3a");
    x.fillStyle = gr;
    for (const [a, b] of [[6, 6], [35, 6], [6, 35], [35, 35]]) x.fillRect(a, b, 23, 23);
  });
  houseMats = { logs, planks, roof, win };
  return houseMats;
}

export function makeHouse(rnd: () => number, snow: boolean): THREE.Group {
  const g = new THREE.Group();
  const t = houseTextures();
  const w = 6.5 + rnd() * 3, d = 5.5 + rnd() * 2.5, h = 2.9, rh = 2 + rnd() * 0.6, ov = 0.5;
  const logs = t.logs.clone(); logs.repeat.set(w / 3, h / 3.2); logs.needsUpdate = true;
  const tint = [0xffffff, 0xd8c8b0, 0xb8a890, 0xc8d4dc][Math.floor(rnd() * 4)];
  g.add(box(w, h, d, new THREE.MeshStandardMaterial({ map: logs, color: tint, roughness: 0.9 }), 0, h / 2 + 0.25, 0));
  g.add(box(w + 0.3, 0.3, d + 0.3, std(0x6a6763, 0.95), 0, 0.15, 0));
  // двускатная крыша
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - ov, 0); shape.lineTo(0, rh); shape.lineTo(d / 2 + ov, 0); shape.lineTo(d / 2 + ov, -0.12); shape.lineTo(0, rh - 0.14); shape.lineTo(-d / 2 - ov, -0.12); shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: w + ov * 2, bevelEnabled: false });
  const roofMat = snow ? std(0xf2f5f8, 0.75) : new THREE.MeshStandardMaterial({ map: t.roof, roughness: 0.55, metalness: 0.35, color: [0xffffff, 0x9fb0a0, 0xa8a8b8][Math.floor(rnd() * 3)] });
  const roof = part(roofGeo, roofMat, -w / 2 - ov, h + 0.25, 0);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0); gable.lineTo(0, rh * (d / (d + ov * 2))); gable.lineTo(d / 2, 0); gable.closePath();
  const planks = new THREE.MeshStandardMaterial({ map: t.planks, roughness: 0.9, color: tint, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const gm = part(new THREE.ShapeGeometry(gable), planks, sx * (w / 2 - 0.01), h + 0.25, 0);
    gm.rotation.y = Math.PI / 2;
    const uv = gm.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    g.add(gm);
  }
  const winMat = new THREE.MeshStandardMaterial({ map: t.win, emissiveMap: t.win, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.3 });
  for (const sz of [-1, 1]) for (const k of [-0.28, 0.28]) g.add(box(1.0, 1.1, 0.08, winMat, w * k, h * 0.55 + 0.25, sz * (d / 2 + 0.02)));
  g.add(box(0.08, 1.9, 0.95, std(0x3a2a1e, 0.8), w / 2 + 0.02, 1.2, d * 0.15));
  g.add(box(0.55, 1.5, 0.55, std(0x7a3f32, 0.95), w * 0.22, h + rh * 0.75, 0));
  // забор
  const fence = std(snow ? 0x8a8478 : 0x6f5a44, 0.95);
  for (let i = 0; i < 9; i++) g.add(box(0.1, 1.1, 0.1, fence, -w / 2 - 2 + i * ((w + 4) / 8), 0.55, d / 2 + 3));
  g.add(box(w + 4, 0.1, 0.05, fence, 0, 0.9, d / 2 + 3), box(w + 4, 0.1, 0.05, fence, 0, 0.5, d / 2 + 3));
  return g;
}

export function makePerson(jacket: number): THREE.Group {
  const g = new THREE.Group();
  const cloth = std(jacket, 0.85), pants = std(0x2c3340, 0.9), skin = std(0xd9a888, 0.7);
  g.add(part(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), cloth, 0, 1.18, 0));
  for (const sx of [-1, 1]) {
    g.add(part(new THREE.CapsuleGeometry(0.085, 0.66, 3, 8), pants, sx * 0.1, 0.45, 0));
    const arm = part(new THREE.CapsuleGeometry(0.065, 0.5, 3, 8), cloth, sx * 0.29, 1.15, 0);
    arm.rotation.z = sx * 0.18;
    g.add(arm);
  }
  g.add(part(new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 1.68, 0));
  g.add(part(new THREE.SphereGeometry(0.14, 12, 6, 0, 6.3, 0, 1.6), std(0x30343a, 0.9), 0, 1.71, 0));
  g.add(box(0.3, 0.42, 0.16, std(0x4a5a3a, 0.9), 0, 1.22, 0.2));
  return g;
}

export function makeAnimal(kind: "moose" | "bear"): THREE.Group {
  const g = new THREE.Group();
  const fur = std(kind === "moose" ? 0x4a3526 : 0x2a1f18, 1);
  const L = kind === "moose" ? 2.2 : 1.6, H = kind === "moose" ? 1.45 : 0.85, R = kind === "moose" ? 0.42 : 0.46;
  const body = part(new THREE.CapsuleGeometry(R, L - R * 2, 6, 12), fur, 0, H, 0);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hump = part(new THREE.SphereGeometry(R * 0.9, 10, 8), fur, 0, H + R * 0.45, -L * 0.28);
  const neck = part(new THREE.CapsuleGeometry(R * 0.45, 0.5, 4, 8), fur, 0, H + 0.25, -L / 2 - 0.1);
  neck.rotation.x = -0.9;
  const head = part(new THREE.CapsuleGeometry(R * 0.38, 0.45, 4, 8), fur, 0, H + 0.35, -L / 2 - 0.55);
  head.rotation.x = Math.PI / 2 - 0.3;
  g.add(hump, neck, head);
  for (const sx of [-1, 1]) for (const sz of [-L / 2 + 0.3, L / 2 - 0.3]) g.add(part(new THREE.CylinderGeometry(0.09, 0.07, H - 0.1, 7), fur, sx * R * 0.6, (H - 0.1) / 2, sz));
  if (kind === "moose") for (const sx of [-1, 1]) {
    const antler = part(new THREE.BoxGeometry(0.75, 0.05, 0.35), std(0xb8a888, 0.9), sx * 0.5, H + 0.75, -L / 2 - 0.4);
    antler.rotation.z = sx * 0.35;
    g.add(antler);
  }
  return g;
}

/** Решётчатая опора: четыре пояса, раскосы по граням, две траверсы, гирлянды изоляторов. */
export function makePylon(height: number, span: number): THREE.Group {
  const g = new THREE.Group();
  const steel = std(0x9aa3ab, 0.55, 0.75);
  const geos: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), mid = new THREE.Vector3(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  const beam = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
    dir.subVectors(b, a);
    const len = dir.length();
    const bg = new THREE.BoxGeometry(t, len, t);
    q.setFromUnitVectors(up, dir.normalize());
    bg.applyMatrix4(m4.compose(mid.addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    geos.push(bg);
  };
  const half = (y: number) => 2.1 - 1.75 * Math.min(1, y / (height - 6)) ;
  const corner = (y: number, i: number) => { const hw = half(y); return new THREE.Vector3((i & 1 ? 1 : -1) * hw, y, (i & 2 ? 1 : -1) * hw); };
  const levels: number[] = [];
  for (let y = 0; y < height - 0.1; y += Math.max(2.2, half(y) * 2.1)) levels.push(y);
  levels.push(height);
  const order = [0, 1, 3, 2];
  for (let l = 0; l < levels.length - 1; l++) {
    const y0 = levels[l], y1 = levels[l + 1];
    for (let k = 0; k < 4; k++) {
      const a = order[k], b = order[(k + 1) % 4];
      beam(corner(y0, a), corner(y1, a), 0.14);
      beam(corner(y0, a), corner(y1, b), 0.07);
      beam(corner(y0, b), corner(y1, a), 0.07);
      beam(corner(y1, a), corner(y1, b), 0.07);
    }
  }
  const arm = (y: number, len: number) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const root = new THREE.Vector3(sx * half(y), y, sz * half(y)), rootTop = new THREE.Vector3(sx * half(y + 1.4), y + 1.4, sz * half(y + 1.4));
      const tip = new THREE.Vector3(sx * len, y, 0);
      beam(root, tip, 0.09); beam(rootTop, tip, 0.07);
    }
  };
  arm(height - 5.4, span + 0.3);
  arm(height - 1.6, span * 0.55);
  const lattice = part(mergeBoxes(geos), steel);
  g.add(lattice);
  const glassMat = std(0x7a4a36, 0.25, 0.1);
  for (const sx of [-span, span]) for (let i = 0; i < 7; i++) {
    g.add(part(new THREE.CylinderGeometry(0.17, 0.12, 0.09, 10), glassMat, sx, height - 5.55 - i * 0.16, 0));
  }
  g.add(box(2.6, 0.5, 2.6, std(0x8a8a86, 0.95), -1.1, 0.1, -1.1), box(2.6, 0.5, 2.6, std(0x8a8a86, 0.95), 1.1, 0.1, 1.1));
  return g;
}

function mergeBoxes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g of geos) {
    const n = g.toNonIndexed();
    pos.push(...(n.attributes.position.array as Float32Array));
    nor.push(...(n.attributes.normal.array as Float32Array));
    n.dispose(); g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export function makeRing(radius: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, 0.22, 10, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
}

export function makeBeam(color: number, height = 90, radius = 1.6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  m.position.y = height / 2;
  return m;
}
