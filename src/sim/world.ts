// Процедурный мир: рельеф, река, тайга, постройки. Слой 0 — видимый спектр, слой 1 — тепловизор.
import { getTerrain, LC, TerrainSampler } from "./terrain";
import { makeBear } from "./bear";
import * as THREE from "three";
import { clamp, fbm, lerp, makeNoise2D, mulberry32, smoothstep } from "./noise";
import { installAtmosphere, makeSkyMaterial, makeTerrainMaterial, makeWaterMaterial, SkyParams, TerrainTextures } from "./shaders";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { GrassField } from "./grass";
import { BIRCH, ForestKit, PINE, SPRUCE } from "./forest";
import { instanceModel } from "./models";

const _sr = new THREE.Vector3(), _su = new THREE.Vector3();
const ASSET = (p: string) => `${import.meta.env.BASE_URL}sim/${p}`;

export const THERMAL_LAYER = 1;

/** Материал для тепловой копии объекта: к краям (под скользящим углом) излучение слабее —
 *  тело выглядит объёмным, как в настоящем тепловизоре. Работает со скелетом и инстансами. */
export function heatMaterial(heat: number): THREE.Material {
  const m = new THREE.MeshNormalMaterial();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHeat = { value: heat };
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", "uniform float uHeat;\nvoid main() {")
      .replace("gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );",
        "float ct = clamp(abs(normal.z), 0.0, 1.0);\ngl_FragColor = vec4(vec3(uHeat * (0.22 + 0.78 * ct * ct)), 1.0);");
  };
  m.customProgramCacheKey = () => "heat";
  return m;
}
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
  /** Ночь: звёзды и луна, тёмные облака, без дневной HDR-панорамы. */
  night?: boolean;
  grassTint?: [number, number, number];
  hdr?: string; // HDR-панорама для освещения (Poly Haven, CC0)
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
  /** Реальная местность Коми: данные миссии и сдвиг окна (м). */
  real?: { id: string; offX: number; offZ: number };
}

const TREE_CELL = 16;
const CHUNK = 64;

interface TreeRef { far: THREE.InstancedMesh; idx: number }
interface Chunk { x: number; z: number; near: THREE.InstancedMesh[]; far: THREE.InstancedMesh }

export class World {
  scene = new THREE.Scene();
  cfg: WorldCfg;
  quality: Quality;
  size: number;
  n = 257;
  /** Реальная местность (если есть данные для миссии). */
  real: TerrainSampler | null = null;
  /** Уровень воды озера в узле сетки (NaN — не озеро). */
  private lake: Float32Array | null = null;
  /** Подложка мини-карты: лес, болота, поля, вода. */
  mapImage: HTMLCanvasElement | null = null;
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
  private loader = new THREE.LoadingManager();
  ready: Promise<void>;
  grass: GrassField | null = null;
  private water: Water | null = null;
  private hemi!: THREE.HemisphereLight;
  private splat!: THREE.BufferAttribute;
  private envRT: THREE.WebGLRenderTarget | null = null;
  kit!: ForestKit;
  private bakeDone!: () => void;
  private forestBaked = new Promise<void>((r) => { this.bakeDone = r; });

  constructor(cfg: WorldCfg, quality: Quality) {
    this.cfg = cfg;
    this.quality = quality;
    this.size = cfg.size;
    // большие районы (самолётные миссии) — сетка рельефа гуще, чтобы клетка оставалась ~9 м
    if (cfg.size > 2200) this.n = 385;
    this.cell = cfg.size / (this.n - 1);
    this.hf = new Float32Array(this.n * this.n);
    this.waterLevel = cfg.river ? 0 : null;
    this.treeX = new Float32Array(0); this.treeZ = new Float32Array(0); this.treeY = new Float32Array(0);
    this.treeH = new Float32Array(0); this.treeR = new Float32Array(0);
    this.treeKind = new Uint8Array(0); this.treeAlive = new Uint8Array(0);
    const assets = new Promise<void>((res) => { this.loader.onLoad = () => res(); this.loader.onError = () => res(); });
    this.ready = Promise.all([assets, this.forestBaked]).then(() => undefined);
    this.buildHeights();
    this.buildSky();
    this.buildTerrain();
    this.buildTrees();
    this.paintSplat();
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
    const t = cfg.real ? getTerrain(cfg.real.id) : null;
    const rs = t ? new TerrainSampler(t, cfg.real!.offX, cfg.real!.offZ) : null;
    this.real = rs;
    const raw = (x: number, z: number) => {
      let h: number;
      if (rs) {
        // настоящий рельеф; у реки миссии — долина: склоны плавно сходят к воде
        const fade = cfg.river ? smoothstep(40, 380, this.riverDist(x, z)) : 1;
        h = 3.5 + rs.height(x, z) * fade + 0.5 * fbm(noise, x / 38 + 40, z / 38 - 17, 2);
      } else {
        h = 3.5 + cfg.relief * (fbm(noise, x / 260, z / 260, 4) * 0.5 + 0.5);
        h += 1.2 * fbm(noise, x / 38 + 40, z / 38 - 17, 2);
      }
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
    if (rs) this.buildLakes(rs);
  }

  /** Настоящие озёра и протоки: каждое — со своим уровнем воды, дно и берега опущены. */
  private buildLakes(rs: TerrainSampler) {
    const { n, cell, size, cfg, hf } = this;
    const node = (i: number) => [-size / 2 + (i % n) * cell, -size / 2 + Math.floor(i / n) * cell];
    const isW = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const [x, z] = node(i);
      if (cfg.river && this.riverDist(x, z) < cfg.river.width * 2.5) continue;
      if (cfg.flats.some((f) => Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz) < 1.4)) continue;
      if (rs.cls(x, z) === LC.water) isW[i] = 1;
    }
    const lake = new Float32Array(n * n).fill(NaN);
    const seen = new Uint8Array(n * n);
    let any = false;
    for (let s0 = 0; s0 < n * n; s0++) {
      if (!isW[s0] || seen[s0]) continue;
      const comp: number[] = [s0]; seen[s0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const i = comp[q], ix = i % n, iz = (i - ix) / n;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
          const j = jz * n + jx;
          if (isW[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
        }
      }
      if (comp.length < 3) continue; // отдельные пиксели — шум классификации
      const hs = comp.map((i) => hf[i]).sort((a, b) => a - b);
      const level = hs[Math.floor(hs.length * 0.3)];
      for (const i of comp) lake[i] = level;
      any = true;
    }
    if (!any) return;
    this.lake = lake;
    // дно и берег: в воде — на 1,6 м ниже зеркала, вокруг — пологий склон к урезу
    for (let i = 0; i < n * n; i++) {
      if (!isNaN(lake[i])) { hf[i] = lake[i] - 1.6; continue; }
      const ix = i % n, iz = (i - ix) / n;
      let best = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const L = lake[jz * n + jx];
        if (!isNaN(L)) best = Math.min(best, L + 0.35 + Math.hypot(dx, dz) * cell * 0.12);
      }
      if (best < hf[i]) hf[i] = best;
    }
  }

  /** Уровень воды в точке: озеро (свой уровень), река миссии (0) или нет воды. */
  waterAt(x: number, z: number): number | null {
    if (this.lake) {
      const { n, cell, size } = this;
      const ix = Math.round((x + size / 2) / cell), iz = Math.round((z + size / 2) / cell);
      if (ix >= 0 && iz >= 0 && ix < n && iz < n) { const L = this.lake[iz * n + ix]; if (!isNaN(L)) return L; }
    }
    return this.waterLevel;
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
    const wl = this.waterAt(x, z);
    return wl !== null && this.groundAt(x, z) < wl;
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
      cloudLit: pal.night ? new THREE.Color(0x1b2130) : new THREE.Color(pal.sun).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(0.95 - pal.clouds * 0.3),
      cloudDark: pal.night ? new THREE.Color(0x05070c) : new THREE.Color(pal.skyBottom).multiplyScalar(0.62),
      night: !!pal.night,
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
    this.hemi = new THREE.HemisphereLight(pal.ambient, new THREE.Color(pal.groundA).multiplyScalar(0.6), pal.ambientIntensity);
    this.scene.add(this.hemi);
    // дымка в низинах и подсвеченный солнцем туман
    installAtmosphere(sunDir, new THREE.Color(pal.sun).multiplyScalar(1.1).lerp(new THREE.Color(pal.fog), 0.35), pal.fogDensity * 1.4, 1 / 35);
  }

  /** Карта окружения для PBR-отражений строится из самого неба. */
  bakeEnvironment(renderer: THREE.WebGLRenderer) {
    // дальние деревья — снимки настоящих, снимаем их, когда загрузятся текстуры коры и хвои
    this.kit.bake(renderer).then(this.bakeDone, this.bakeDone);
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const sky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    sky.scale.setScalar(100);
    s.add(sky);
    const rt = pm.fromScene(s, 0, 1, 1000);
    this.own(rt);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    const hdr = this.cfg.palette.hdr;
    if (hdr && this.quality !== "low" && !this.cfg.palette.night) {
      // настоящая панорама неба и леса даёт фотографичное рассеянное освещение и отражения
      const apply = (eq: THREE.DataTexture) => {
        const pm2 = new THREE.PMREMGenerator(renderer);
        this.envRT = pm2.fromEquirectangular(eq);
        this.own(this.envRT);
        eq.dispose(); pm2.dispose();
        this.scene.environment = this.envRT.texture;
        this.scene.environmentIntensity = 0.75;
        this.scene.environmentRotation.y = Math.atan2(this.skyParams.sunDir.x, this.skyParams.sunDir.z);
        this.hemi.intensity *= 0.45;
      };
      if (import.meta.env.VITE_PACKED_ASSETS) {
        // хостинг страницы не отдаёт .hdr — в автономной сборке панорама лежит рядом в base64
        this.loader.itemStart(hdr);
        fetch(ASSET(`${hdr}.txt`)).then((r) => r.text()).then((b64) => {
          const bin = atob(b64.trim()), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes]));
          new RGBELoader().load(url, (eq) => { apply(eq); URL.revokeObjectURL(url); this.loader.itemEnd(hdr); },
            undefined, () => this.loader.itemEnd(hdr));
        }).catch(() => this.loader.itemEnd(hdr));
      } else new RGBELoader(this.loader).load(ASSET(hdr), apply);
    }
    pm.dispose();
  }

  /** Каждый кадр: тени следуют за аппаратом, деревья переключают уровень детализации. */
  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3) {
    this.time.value += dt;
    if (this.water) (this.water.material as THREE.ShaderMaterial).uniforms.time.value += dt * 0.6;
    this.sky.position.copy(camPos);
    if (this.sun.castShadow) {
      // привязка теневой камеры к сетке текселей в пространстве света — тени не дрожат при движении
      const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
      const L = this.skyParams.sunDir;
      const right = _sr.set(0, 1, 0).cross(L).normalize(), up = _su.copy(L).cross(right).normalize();
      const a = Math.round(focus.dot(right) / texel) * texel, b = Math.round(focus.dot(up) / texel) * texel, c = focus.dot(L);
      const tgt = this.sun.target.position.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(L, c);
      this.sun.position.copy(tgt).addScaledVector(L, 420);
    }
    this.lodAcc += dt;
    if (this.lodAcc > 0.3) {
      this.lodAcc = 0;
      // на высоком качестве объёмные деревья дальше — меньше «картонных» вблизи
      const far = this.quality === "high" ? 165 : this.quality === "medium" ? 95 : -1;
      for (const c of this.chunks) {
        const near = Math.hypot(c.x - camPos.x, c.z - camPos.z) < far + CHUNK * 0.7;
        for (const m of c.near) m.visible = near;
        c.far.visible = !near;
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
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = this.hf[i];
      pos.setY(i, h);
      const x = pos.getX(i), z = pos.getZ(i);
      const t = fbm(noise, x / 90, z / 90, 3) * 0.5 + 0.5;
      // вершинный цвет — только макровариации яркости и будущая гарь; цвет даёт фото-текстура
      const v = 0.88 + 0.22 * t;
      c.setRGB(v, v, v);
      if (this.real) {
        // оттенок по типу поверхности: рыжий сфагнум болот, светлый лишайник тундры и боров, жёлтые поля
        const k = this.real.cls(x, z);
        let tint = k === LC.bog ? [1.0, 0.74, 0.42] : k === LC.moss ? [1.3, 1.26, 1.08] : k === LC.grass ? [1.02, 1.08, 0.82]
          : k === LC.crop ? [1.18, 1.05, 0.62] : k === LC.built ? [0.9, 0.88, 0.86] : k === LC.bare ? [1.2, 1.05, 0.8] : k === LC.shrub ? [0.92, 0.96, 0.78]
          : k === LC.forest ? [0.88, 0.9, 0.86] : null;
        if (k === LC.bog) {
          // мочажины — тёмные окна воды между кочками, гряды — посветлее
          const p = fbm(noise, x / 9 + 13, z / 9 - 5, 3);
          if (p > 0.28) tint = [0.42, 0.46, 0.44];
          else if (p < -0.2) tint = [1.12, 0.9, 0.55];
        }
        if (tint) c.setRGB(v * tint[0], v * tint[1], v * tint[2]);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      // тепловой фон: вода холодная, по земле — пятна (влажность, кочки, мох)
      const g = h < 0 ? 0.005 : 0.016 + 0.02 * t + 0.012 * (fbm(noise, x / 14, z / 14, 2) * 0.5 + 0.5);
      heat[i * 3] = g; heat[i * 3 + 1] = g; heat[i * 3 + 2] = g;
    }
    this.terrainColors = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute("color", this.terrainColors);
    geo.computeVertexNormals();

    this.splat = new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4);
    geo.setAttribute("splat", this.splat);
    const tl = new THREE.TextureLoader(this.loader);
    const load = (f: string, srgb: boolean) => {
      const t = this.own(tl.load(ASSET(`tex/${f}`)));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const tex: TerrainTextures = {
      grass: load("grass.jpg", true), grassN: load("grass_n.jpg", false), meadow: load("meadow.jpg", true),
      dirt: load("dirt.jpg", true), dirtN: load("dirt_n.jpg", false), rock: load("rock.jpg", true), rockN: load("rock_n.jpg", false),
      sand: load("sand.jpg", true),
    };
    const gt = pal.grassTint ?? [0.82, 0.86, 0.72];
    const mat = this.own(makeTerrainMaterial(tex, { snow: !!pal.snow, grassTint: new THREE.Color(...gt) }));
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
      const normals = this.own(new THREE.TextureLoader(this.loader).load(ASSET("waternormals.jpg")));
      normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
      let water: THREE.Mesh;
      if (this.quality === "high") {
        // зеркальная вода: настоящие отражения леса, неба и аппарата
        const w = new Water(wg, {
          textureWidth: 512, textureHeight: 512, waterNormals: normals,
          sunDirection: this.skyParams.sunDir.clone(), sunColor: new THREE.Color(pal.sun),
          waterColor: new THREE.Color(pal.water).multiplyScalar(0.6), distortionScale: 1.6, fog: true,
        });
        (w.material as THREE.ShaderMaterial).uniforms.size.value = 2.2;
        this.water = w;
        water = w;
      } else {
        const wm = this.own(makeWaterMaterial(this.skyParams, new THREE.Color(pal.water).multiplyScalar(0.55), normals, this.scene.fog as THREE.FogExp2, this.time));
        water = new THREE.Mesh(wg, wm);
      }
      water.position.y = this.waterLevel;
      this.scene.add(water);
      this.addThermal(water, 0.004);
    }
    if (this.lake) this.buildLakeWater();
    if (this.real) this.buildMapImage();
  }

  /** Зеркала озёр: по квадрату сетки на уровне своего озера (чуть шире берега — их прячет рельеф). */
  private buildLakeWater() {
    const { n, cell, size } = this, L = this.lake!;
    const pos: number[] = [];
    for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
      let lv = NaN;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = L[(iz + dz) * n + ix + dx]; if (!isNaN(v)) { lv = v; break; } }
      if (isNaN(lv)) continue;
      const x0 = -size / 2 + ix * cell - cell * 0.5, z0 = -size / 2 + iz * cell - cell * 0.5, x1 = x0 + cell * 2, z1 = z0 + cell * 2;
      pos.push(x0, lv, z0, x0, lv, z1, x1, lv, z1, x0, lv, z0, x1, lv, z1, x1, lv, z0);
    }
    const g = this.own(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const pal = this.cfg.palette;
    const normals = this.own(new THREE.TextureLoader(this.loader).load(ASSET("waternormals.jpg")));
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(g, this.own(makeWaterMaterial(this.skyParams, new THREE.Color(pal.water).multiplyScalar(0.5), normals, this.scene.fog as THREE.FogExp2, this.time)));
    m.renderOrder = 1;
    this.scene.add(m);
    this.addThermal(m, 0.004);
  }

  /** Подложка мини-карты по реальным типам поверхности. */
  private buildMapImage() {
    const N = 192, cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const g = cv.getContext("2d")!, img = g.createImageData(N, N), { size } = this;
    const col: Record<number, [number, number, number]> = {
      [LC.forest]: [24, 52, 34], [LC.shrub]: [52, 72, 44], [LC.grass]: [70, 92, 52], [LC.crop]: [96, 92, 52], [LC.built]: [78, 78, 82],
      [LC.bare]: [96, 86, 66], [LC.water]: [40, 96, 150], [LC.bog]: [82, 74, 48], [LC.moss]: [96, 100, 82], [LC.snow]: [200, 205, 210],
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -size / 2 + ((i + 0.5) / N) * size, z = -size / 2 + ((j + 0.5) / N) * size;
      const k = this.waterAt(x, z) !== null && this.groundAt(x, z) < (this.waterAt(x, z) ?? 0) ? LC.water : this.real!.cls(x, z);
      const c = col[k] ?? [30, 40, 34], o = (j * N + i) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapImage = cv;
  }

  /** Веса слоёв грунта: лесная подстилка под кронами, песок у воды, грунт на площадках, луг на открытых местах. */
  private paintSplat() {
    const { n, cell, size, cfg } = this;
    const sp = this.splat.array as Float32Array;
    const dens = new Float32Array(n * n);
    const near: number[] = [];
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix, x = -size / 2 + ix * cell, z = -size / 2 + iz * cell, h = this.hf[i];
      let forest = 0;
      for (const t of this.treesNear(x, z, 9, near)) {
        const d = Math.hypot(this.treeX[t] - x, this.treeZ[t] - z);
        forest += Math.max(0, 1 - d / 9) * 0.55;
      }
      forest = Math.min(1, forest);
      let dirt = 0, onFlat = false;
      for (const f of cfg.flats) {
        const d = Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz);
        dirt = Math.max(dirt, smoothstep(1.3, 0.6, d) * (f.rx > 20 ? 0.45 : 0.85));
        if (d < 1.1) onFlat = true;
      }
      const sand = this.waterLevel !== null ? 1 - smoothstep(0.2, 1.6, h) : 0;
      const meadow = (1 - forest) * (1 - dirt);
      sp[i * 4] = forest; sp[i * 4 + 1] = dirt; sp[i * 4 + 2] = sand; sp[i * 4 + 3] = meadow;
      // трава: густо на лугу, редко в лесу, нет на площадках, у воды и в воде
      dens[i] = h < 0.6 || onFlat ? 0 : clamp(meadow * 0.95 + forest * 0.25 - dirt - sand, 0, 1);
    }
    this.splat.needsUpdate = true;
    if (this.quality !== "low" && !cfg.palette.snow) {
      const gt = cfg.palette.grassTint ?? [0.82, 0.86, 0.72];
      this.grass = new GrassField({
        size: this.quality === "high" ? 70 : 50, count: this.quality === "high" ? 20000 : 9000,
        heights: this.hf, n, worldSize: size, density: dens,
        tint: new THREE.Color(0x5f7a2c).multiply(new THREE.Color(...gt)).multiplyScalar(1.25), time: this.time,
      });
      this.scene.add(this.grass.mesh);
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
    const snow = !!pal.snow;
    const rnd = mulberry32(cfg.seed * 31 + 5);
    const noise = makeNoise2D(cfg.seed + 99);
    const kit = new ForestKit({
      snow, time: this.time, a2c: this.quality !== "low", variantsPerSpecies: this.quality === "low" ? 2 : 3,
      leafTint: new THREE.Color(...(pal.grassTint ?? [0.86, 0.9, 0.74])).lerp(new THREE.Color(1, 1, 1), 0.5),
    });
    this.kit = kit;
    // на реальной местности тайга густая там, где по карте лес (на больших картах — как задано, ради скорости)
    const density = this.real && cfg.size <= 2000 ? Math.max(cfg.forestDensity, 0.75) : cfg.forestDensity;
    const step = Math.sqrt(100 / Math.max(0.05, density));
    const xs: number[] = [], zs: number[] = [], hs: number[] = [], rs: number[] = [], kinds: number[] = [], vars: number[] = [];
    const half = size / 2 - 20;
    for (let gz = -half; gz < half; gz += step) {
      for (let gx = -half; gx < half; gx += step) {
        const x = gx + rnd() * step, z = gz + rnd() * step;
        const u = rnd(), v = rnd(), w = rnd();
        // реальная местность: где лес по спутниковой карте — там и лес; иначе — процедурные поляны
        const lc = this.real ? this.real.cls(x, z) : LC.forest;
        const keep = !this.real ? 1 : lc === LC.forest ? 1 : lc === LC.bog ? 0.22 : lc === LC.moss ? 0.12 : lc === LC.shrub ? 0.3 : lc === LC.grass ? 0.05 : lc === LC.bare ? 0.02 : 0;
        if (this.real ? (w + u * 0.37) % 1 > keep : fbm(noise, x / 120, z / 120, 2) < -0.22) continue;
        if (!this.treeAllowed(x, z)) continue;
        // сосна — на сухих гривах, ель — в низинах, берёза — пятнами на опушках и вырубках
        const dry = fbm(noise, x / 210 + 31, z / 210 - 12, 2) + (this.groundAt(x, z) - 8) * 0.02 > 0.12;
        const birchy = fbm(noise, x / 90 - 7, z / 90 + 5, 2) > 0.18;
        let kind = dry ? (v < 0.78 ? PINE : v < 0.9 ? BIRCH : SPRUCE) : birchy && v < 0.55 ? BIRCH : v < 0.1 ? PINE : SPRUCE;
        // болото — чахлые сосенки и берёзки; тундра, мхи и кустарник — карликовая берёза
        let stunt = 1;
        if (lc === LC.bog) { kind = v < 0.7 ? PINE : BIRCH; stunt = 0.35 + u * 0.25; }
        else if (lc === LC.moss || lc === LC.shrub) { kind = BIRCH; stunt = 0.22 + u * 0.18; }
        else if (lc === LC.grass || lc === LC.bare) { kind = v < 0.6 ? BIRCH : PINE; stunt = 0.7; }
        const hgt = (kind === PINE ? 16 + u * 11 : kind === BIRCH ? 11 + u * 9 : 10 + u * 15) * stunt;
        const list = kit.bySpecies[kind];
        const vi = list[Math.floor(w * list.length) % list.length];
        xs.push(x); zs.push(z); hs.push(hgt); kinds.push(kind); vars.push(vi);
        rs.push(kit.variants[vi].crown * hgt * 0.9);
      }
    }
    const count = xs.length;
    this.treeCount = count;
    this.treeX = Float32Array.from(xs); this.treeZ = Float32Array.from(zs);
    this.treeH = Float32Array.from(hs); this.treeR = Float32Array.from(rs);
    this.treeKind = Uint8Array.from(kinds);
    this.treeY = new Float32Array(count);
    this.treeAlive = new Uint8Array(count).fill(1);

    const buckets = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
      const key = `${Math.floor(xs[i] / CHUNK)},${Math.floor(zs[i] / CHUNK)},${vars[i]}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
      const gk = this.gridKey(xs[i], zs[i]);
      let list = this.treeGrid.get(gk);
      if (!list) this.treeGrid.set(gk, (list = []));
      list.push(i);
    }
    this.refs = new Array(count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, list] of buckets) {
      const [cx, cz, vi] = key.split(",").map(Number);
      const v = kit.variants[vi];
      const far = new THREE.InstancedMesh(v.impostor, kit.impostorMat, list.length);
      list.forEach((i, k) => {
        const y = this.groundAt(xs[i], zs[i]) - 0.2;
        this.treeY[i] = y;
        p.set(xs[i], y, zs[i]);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6.28);
        sc.setScalar(hs[i]);
        far.setMatrixAt(k, m4.compose(p, q, sc));
        const tint = 0.8 + rnd() * 0.35;
        this.treeTint[i] = tint;
        far.setColorAt(k, col.setScalar(tint));
        this.refs[i] = { far, idx: k };
      });
      const near: THREE.InstancedMesh[] = [];
      if (this.quality !== "low") {
        near.push(new THREE.InstancedMesh(v.branches, v.species === BIRCH ? kit.barkMats.birch : kit.barkMats.pine, list.length));
        const lm = kit.leafMats[v.species];
        if (v.leaves && lm) near.push(new THREE.InstancedMesh(v.leaves, lm, list.length));
      }
      const th = new THREE.InstancedMesh(v.impostor, kit.thermalMat, list.length);
      for (const m of [...near, th]) { m.instanceMatrix = far.instanceMatrix; m.instanceColor = far.instanceColor; }
      for (const m of [far, ...near, th]) { m.computeBoundingSphere(); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
      th.castShadow = false;
      th.layers.set(THERMAL_LAYER);
      for (const m of near) m.visible = false;
      this.chunks.push({ x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, near, far });
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
    const sap = this.kit.variants[this.kit.bySpecies[SPRUCE][0]];
    scatter(sap.impostor.clone(), this.kit.impostorMat, saplings, 1.0, 3.2, 1, 0.05, [0.75, 1.15], 0.08);
    // валуны: фото-текстура камня с картой нормалей, слегка «сплющенные» и утопленные в грунт
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rp = rockGeo.attributes.position;
    for (let k = 0; k < rp.count; k++) {
      const hh = Math.sin(rp.getX(k) * 7.3 + rp.getZ(k) * 3.1) * 0.5 + 0.5;
      rp.setXYZ(k, rp.getX(k) * (0.85 + hh * 0.25), rp.getY(k) * (0.8 + hh * 0.3), rp.getZ(k) * (0.85 + hh * 0.25));
    }
    rockGeo.computeVertexNormals();
    const tl = new THREE.TextureLoader(this.loader);
    const rMap = this.own(tl.load(ASSET("tex/rock.jpg"))), rN = this.own(tl.load(ASSET("tex/rock_n.jpg")));
    rMap.colorSpace = THREE.SRGBColorSpace;
    rMap.wrapS = rMap.wrapT = rN.wrapS = rN.wrapT = THREE.RepeatWrapping;
    scatter(rockGeo, new THREE.MeshStandardMaterial({ map: rMap, normalMap: rN, roughness: 0.85, color: snow ? 0xc8ccd2 : 0x9a968c }),
      1100, 0.3, 1.4, 0.6, 0.4, [0.75, 1.1]);
  }

  private inFlat(x: number, z: number, k: number): boolean {
    for (const f of this.cfg.flats) if (Math.max(Math.abs(x - f.x) / f.rx, Math.abs(z - f.z) / f.rz) < k) return true;
    return false;
  }

  private treeAllowed(x: number, z: number): boolean {
    const { cfg } = this;
    const wl = this.waterAt(x, z);
    if (wl !== null && this.groundAt(x, z) < wl + 0.6) return false;
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
      const kind = this.treeKind[i];
      if (kind === PINE) rad = rel < 0.58 ? 0.3 : this.treeR[i] * 0.8;
      else if (kind === BIRCH) rad = rel < 0.35 ? 0.2 : this.treeR[i] * 0.75;
      else rad = rel < 0.1 ? 0.25 : this.treeR[i] * (1 - rel) * 1.05;
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
    ref.far.setMatrixAt(ref.idx, new THREE.Matrix4().makeScale(0, 0, 0));
    ref.far.instanceMatrix.needsUpdate = true;
  }

  /** k: 0 — живое дерево, 1 — полностью обугленное. glow — отсвет пламени. */
  tintTree(i: number, k: number, glow: number) {
    const ref = this.refs[i];
    const t = this.treeTint[i];
    const c = new THREE.Color(t, t, t).lerp(new THREE.Color(0.1, 0.08, 0.07), k);
    if (glow > 0) c.lerp(new THREE.Color(2.2, 0.7, 0.15), glow * 0.55);
    ref.far.setColorAt(ref.idx, c);
    ref.far.instanceColor!.needsUpdate = true;
  }

  /** Добавляет копию объекта в тепловой слой. heat 0..1 — яркость. */
  addThermal(obj: THREE.Object3D, heat: number) {
    const mat = this.own(heatMaterial(heat));
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.layers.mask === 1) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      let t: THREE.Mesh;
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        // анимированная модель: тепловая копия двигается вместе со скелетом
        const ts = new THREE.SkinnedMesh(sk.geometry, mat);
        ts.bind(sk.skeleton, sk.bindMatrix);
        ts.bindMode = sk.bindMode;
        ts.frustumCulled = false;
        t = ts;
        sk.parent!.add(t);
        t.position.copy(sk.position); t.quaternion.copy(sk.quaternion); t.scale.copy(sk.scale);
      } else {
        t = new THREE.Mesh(m.geometry, mat);
        m.add(t);
      }
      t.layers.set(THERMAL_LAYER);
    }
  }

  dispose() {
    this.grass?.dispose();
    this.kit?.dispose();
    if (this.water) (this.water.material as THREE.Material).dispose();
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

export function makeVan(): THREE.Group {
  const model = instanceModel("van");
  if (model) return model;
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
  const model = instanceModel("house", rnd());
  if (model) return model;
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
  const model = instanceModel("person");
  if (model) return model;
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
  if (kind === "bear") return makeBear();
  const model = instanceModel(kind);
  if (model) { model.userData.kind = kind; return model; }
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
