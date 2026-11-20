// Лес: настоящие деревья с ветвлением (ez-tree) вблизи и «запечённые» с них импосторы вдали.
import * as THREE from "three";
import { Tree, TreePreset } from "./eztree/index.js";
import { NOISE_GLSL } from "./shaders";

export const SPRUCE = 0, PINE = 1, BIRCH = 2;
export type Species = typeof SPRUCE | typeof PINE | typeof BIRCH;

export interface TreeVariant {
  species: Species;
  branches: THREE.BufferGeometry; // нормировано к единичной высоте
  leaves: THREE.BufferGeometry | null;
  crown: number; // радиус кроны / высота
  impostor: THREE.BufferGeometry;
  tile: number;
}

const TILE_W = 256, SIDE_H = 512, TOP_H = 256;
const ATLAS_W = TILE_W * 8, ATLAS_H = SIDE_H + TOP_H;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Параметры пород: ель — плотный конус до земли, сосна — голый ствол и крона вверху, берёза — светлая кора. */
function speciesJson(species: Species, seed: number, snow: boolean, detailed: boolean): Json {
  const base = species === BIRCH ? "Aspen Medium" : species === PINE ? "Pine Medium" : "Pine Small";
  const j: Json = structuredClone(TreePreset[base]);
  j.seed = seed;
  const br = j.branch;
  // упрощаем сетку: деревьев тысячи, а не одно
  br.sections = { 0: detailed ? 9 : 6, 1: detailed ? 4 : 3, 2: 3, 3: 2 };
  br.segments = { 0: detailed ? 7 : 5, 1: 3, 2: 3, 3: 3 };
  if (species === SPRUCE) {
    br.children = { ...br.children, 0: detailed ? 70 : 45 };
    br.length = { ...br.length, 1: br.length[1] * 0.72 };
    br.start = { ...br.start, 1: 0.12 };
    j.leaves.count = detailed ? 20 : 14;
    j.leaves.size *= 2.0;
    j.leaves.tint = 0x7e9a7c;
  } else if (species === PINE) {
    br.children = { ...br.children, 0: detailed ? 34 : 24 };
    br.start = { ...br.start, 1: 0.6 };
    br.angle = { ...br.angle, 1: 78 };
    br.length = { ...br.length, 1: br.length[1] * 0.5 };
    br.gnarliness = { ...br.gnarliness, 1: 0.18 };
    j.leaves.start = 0.35;
    j.leaves.count = detailed ? 26 : 18;
    j.leaves.size *= 2.5;
    j.leaves.tint = 0xa8b98e;
  } else {
    j.bark.type = "birch";
    br.children = { ...br.children, 0: detailed ? 9 : 7, 1: detailed ? 5 : 4 };
    j.leaves.count = snow ? 0 : detailed ? 22 : 15;
    j.leaves.size *= 1.35;
    j.leaves.tint = 0xe4ecd2;
  }
  return j;
}

interface Built { branches: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null; crown: number; barkMap: THREE.Texture[]; leafMap: THREE.Texture | null }

function buildTree(species: Species, seed: number, snow: boolean): Built {
  const t = new Tree();
  t.loadFromJson(speciesJson(species, seed, snow, true));
  const branches = t.branchesMesh.geometry.clone();
  const leavesSrc = t.leavesMesh.geometry;
  const leaves = leavesSrc.index && leavesSrc.index.count > 0 ? leavesSrc.clone() : null;
  branches.computeBoundingBox();
  let top = branches.boundingBox!.max.y, rad = 0;
  if (leaves) { leaves.computeBoundingBox(); top = Math.max(top, leaves.boundingBox!.max.y); }
  for (const g of [branches, leaves]) {
    if (!g) continue;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) rad = Math.max(rad, Math.hypot(p.getX(i), p.getZ(i)));
  }
  const s = 1 / top;
  branches.scale(s, s, s);
  if (leaves) {
    leaves.scale(s, s, s);
    // нормали «от оси кроны»: мягкая объёмная светотень вместо плоских бликов от каждой карточки
    const p = leaves.attributes.position, n = leaves.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), (p.getY(i) - 0.62) * 0.6 + 0.25, p.getZ(i)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    n.needsUpdate = true;
  }
  const bm = t.branchesMesh.material as THREE.MeshPhongMaterial & { roughnessMap?: THREE.Texture };
  const lm = t.leavesMesh.material as THREE.MeshPhongMaterial;
  const out: Built = {
    branches, leaves, crown: rad * s,
    barkMap: [bm.map!, bm.normalMap!, bm.aoMap!, bm.roughnessMap!].filter(Boolean),
    leafMap: lm.map ?? null,
  };
  t.branchesMesh.geometry.dispose(); t.leavesMesh.geometry.dispose();
  return out;
}

function waitImages(texs: THREE.Texture[]): Promise<void> {
  return new Promise((res) => {
    const start = performance.now();
    const tick = () => {
      const ok = texs.every((t) => {
        const img = t.image as HTMLImageElement | undefined;
        return img && (img.complete === undefined || (img.complete && img.naturalWidth > 0));
      });
      if (ok || performance.now() - start > 15000) res();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

export class ForestKit {
  variants: TreeVariant[] = [];
  bySpecies: number[][] = [[], [], []];
  barkMats: Record<"pine" | "birch", THREE.MeshStandardMaterial>;
  leafMats: (THREE.MeshStandardMaterial | null)[] = [null, null, null];
  impostorMat: THREE.MeshStandardMaterial;
  thermalMat: THREE.MeshBasicMaterial;
  atlas: THREE.WebGLRenderTarget;
  ready: Promise<void>;
  private textures: THREE.Texture[] = [];
  private disposables: { dispose(): void }[] = [];
  private tiles: { halfW: number; crown: number }[] = [];

  constructor(opts: { snow: boolean; time: { value: number }; a2c: boolean; variantsPerSpecies: number; leafTint: THREE.Color }) {
    const seeds = [1337, 4242, 9001, 271, 828];
    let barkPine: Built | null = null, barkBirch: Built | null = null;
    const leafMaps: (THREE.Texture | null)[] = [null, null, null];
    for (const sp of [SPRUCE, PINE, BIRCH] as Species[]) {
      for (let k = 0; k < opts.variantsPerSpecies; k++) {
        const b = buildTree(sp, seeds[k] + sp * 17, opts.snow);
        if (sp === BIRCH) barkBirch ??= b; else barkPine ??= b;
        leafMaps[sp] ??= b.leafMap;
        this.textures.push(...b.barkMap, ...(b.leafMap ? [b.leafMap] : []));
        const tile = this.variants.length;
        const halfW = Math.max(b.crown * 1.06, 0.26);
        this.tiles.push({ halfW, crown: b.crown });
        this.variants.push({ species: sp, branches: b.branches, leaves: b.leaves, crown: b.crown, impostor: impostorGeometry(tile, halfW, b.crown), tile });
        this.bySpecies[sp].push(tile);
        this.disposables.push(b.branches, ...(b.leaves ? [b.leaves] : []));
      }
    }

    const bark = (b: Built | null) => {
      const [map, normalMap, aoMap, roughnessMap] = b?.barkMap ?? [];
      const m = new THREE.MeshStandardMaterial({ map, normalMap, aoMap, roughnessMap, roughness: 1, metalness: 0, aoMapIntensity: 0.8 });
      this.disposables.push(m);
      return m;
    };
    this.barkMats = { pine: bark(barkPine), birch: bark(barkBirch) };
    for (const sp of [SPRUCE, PINE, BIRCH] as Species[]) {
      const map = leafMaps[sp];
      if (!map) continue;
      const tint = sp === SPRUCE ? new THREE.Color(0x7e9a7c) : sp === PINE ? new THREE.Color(0xa8b98e) : new THREE.Color(0xe4ecd2);
      this.leafMats[sp] = leafMaterial(map, tint.multiply(opts.leafTint), opts.time, opts.snow && sp !== BIRCH, opts.a2c);
      this.disposables.push(this.leafMats[sp]!);
    }

    this.atlas = new THREE.WebGLRenderTarget(ATLAS_W, ATLAS_H, {
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 4,
    });
    this.disposables.push(this.atlas);
    this.impostorMat = new THREE.MeshStandardMaterial({
      map: this.atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, alphaToCoverage: opts.a2c,
    });
    this.impostorMat.onBeforeCompile = (sh) => {
      // вид кроны сверху виден только сверху, боковые снимки — только сбоку; иначе плоские карточки
      // видны ребром — тёмные «полоски» в воздухе
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aTop; varying vec3 vIW; varying float vTop; varying vec3 vWP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTop = aTop;\n#ifdef USE_INSTANCING\nvIW = instanceMatrix[3].xyz;\n#else\nvIW = vec3(0.);\n#endif")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvec4 wpI = vec4(transformed, 1.);\n#ifdef USE_INSTANCING\nwpI = instanceMatrix * wpI;\n#endif\nvWP = (modelMatrix * wpI).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vIW; varying float vTop; varying vec3 vWP;\n${NOISE_GLSL}`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb *= .85 + .3 * hash12(vIW.xz);
          float up = abs(normalize(cameraPosition - vWP).y);
          float keep = vTop > .5 ? smoothstep(.45, .8, up) : 1. - smoothstep(.9, .99, up);
          // плавное исчезновение — дизерингом, чтобы работало с alphaTest
          if (keep < hash12(gl_FragCoord.xy)) discard;`);
    };
    this.thermalMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x0d0d0d, fog: false, toneMapped: false });
    this.thermalMat.onBeforeCompile = (sh) => {
      // в тепловизоре крона чуть теплее земли и неоднородна: яркость атласа даёт фактуру ветвей
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>",
        "vec4 tx = texture2D(map, vMapUv); diffuseColor.a *= tx.a; diffuseColor.rgb = vec3(0.03 + 0.03 * dot(tx.rgb, vec3(.3, .59, .11)));");
    };
    this.disposables.push(this.impostorMat, this.thermalMat);
    this.ready = waitImages(this.textures);
  }

  /** Снимает каждое дерево сбоку и сверху в атлас — из этих снимков строятся дальние деревья. */
  async bake(renderer: THREE.WebGLRenderer) {
    await this.ready;
    const scene = new THREE.Scene();
    const basic = (m: THREE.MeshStandardMaterial | null, fallback: number) =>
      new THREE.MeshBasicMaterial({ map: m?.map ?? null, color: m ? m.color : fallback, alphaTest: 0.5, side: THREE.DoubleSide });
    const barkB = { pine: basic(this.barkMats.pine, 0x6a5040), birch: basic(this.barkMats.birch, 0xdddddd) };
    const leafB = this.leafMats.map((m) => (m ? basic(m, 0x445533) : null));
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevTM = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(this.atlas);
    // фон — средний цвет хвои с нулевой прозрачностью: на дальних мипах не будет тёмной каймы
    renderer.setClearColor(new THREE.Color(0.08, 0.11, 0.07), 0);
    this.atlas.scissorTest = false;
    renderer.clear();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    this.variants.forEach((v, i) => {
      scene.clear();
      const bm = new THREE.Mesh(v.branches, v.species === BIRCH ? barkB.birch : barkB.pine);
      scene.add(bm);
      const lb = leafB[v.species];
      if (v.leaves && lb) scene.add(new THREE.Mesh(v.leaves, lb));
      const { halfW, crown } = this.tiles[i];
      // вид сбоку
      cam.left = -halfW; cam.right = halfW; cam.top = 2 * halfW * (SIDE_H / TILE_W) - 0.02; cam.bottom = -0.02;
      cam.position.set(0, 0.5, 5); cam.lookAt(0, 0.5, 0); cam.updateProjectionMatrix();
      this.atlas.viewport.set(i * TILE_W, TOP_H, TILE_W, SIDE_H);
      this.atlas.scissor.set(i * TILE_W, TOP_H, TILE_W, SIDE_H);
      this.atlas.scissorTest = true;
      renderer.setRenderTarget(this.atlas);
      renderer.render(scene, cam);
      // вид сверху
      const r = crown * 1.06;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.position.set(0, 3, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.up.set(0, 1, 0); cam.updateProjectionMatrix();
      this.atlas.viewport.set(i * TILE_W, 0, TILE_W, TOP_H);
      this.atlas.scissor.set(i * TILE_W, 0, TILE_W, TOP_H);
      renderer.setRenderTarget(this.atlas);
      renderer.render(scene, cam);
    });
    this.atlas.scissorTest = false;
    this.atlas.viewport.set(0, 0, ATLAS_W, ATLAS_H);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTM;
    [...Object.values(barkB), ...leafB].forEach((m) => m?.dispose());
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.variants.forEach((v) => v.impostor.dispose());
  }
}

/** Импостор: три вертикальные плоскости под 60° со снимком сбоку и горизонтальная со снимком сверху. */
function impostorGeometry(tile: number, halfW: number, crown: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], isTop: number[] = [];
  const top = 2 * halfW * (SIDE_H / TILE_W) - 0.02;
  const u0 = (tile * TILE_W + 1) / ATLAS_W, u1 = ((tile + 1) * TILE_W - 1) / ATLAS_W;
  const vS0 = TOP_H / ATLAS_H, vS1 = 1;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z); nor.push(nx / l, ny / l, nz / l); uv.push(u, v); isTop.push(0);
  };
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3, cx = Math.cos(a), sz = Math.sin(a);
    // три колонки вершин: края смотрят в стороны, середина — к зрителю, так свет ложится объёмно
    const cols = [-1, 0, 1].map((t) => ({ x: cx * halfW * t, z: sz * halfW * t, u: u0 + (u1 - u0) * (t * 0.5 + 0.5), nx: cx * t, nz: sz * t }));
    for (let c = 0; c < 2; c++) {
      const A = cols[c], B = cols[c + 1];
      const quad: [typeof A, number][] = [[A, -0.02], [B, -0.02], [B, top], [A, -0.02], [B, top], [A, top]];
      for (const [p, y] of quad) {
        const v = vS0 + (vS1 - vS0) * ((y + 0.02) / (top + 0.02));
        push(p.x, y, p.z, p.nx - sz * (1 - Math.abs(p.nx) - Math.abs(p.nz)) * 0.3, 0.45 + (y / top) * 0.4, p.nz + cx * (1 - Math.abs(p.nx) - Math.abs(p.nz)) * 0.3, p.u, v);
      }
    }
  }
  const r = crown * 1.06, y = 0.58, vT0 = 0, vT1 = TOP_H / ATLAS_H;
  const corners: [number, number, number, number][] = [[-r, -r, u0, vT1], [r, -r, u1, vT1], [r, r, u1, vT0], [-r, r, u0, vT0]];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const [x, z, u, v] = corners[k];
    push(x, y, z, x * 0.4, 1, z * 0.4, u, v);
    isTop[isTop.length - 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aTop", new THREE.Float32BufferAttribute(isTop, 1));
  g.computeBoundingSphere();
  return g;
}

/** Хвоя/листва вблизи: фото-текстура ez-tree, покачивание на ветру в мировых координатах, снег на верхних лапах. */
function leafMaterial(map: THREE.Texture, tint: THREE.Color, time: { value: number }, snow: boolean, a2c: boolean) {
  const m = new THREE.MeshStandardMaterial({ map, color: tint, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, alphaToCoverage: a2c });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; varying float vUp;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * .13 + ip.z * .17;
          float k = position.y * position.y * .02;
          transformed.x += (sin(uTime * 1.3 + ph + position.y * 3.) + .4 * sin(uTime * 3.1 + ph * 2.)) * k;
          transformed.z += (cos(uTime * 1.1 + ph * 1.3) + .4 * sin(uTime * 2.7 + ph)) * k * .7;
        #endif
        vUp = normal.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vUp;")
      .replace("#include <normal_fragment_begin>", "float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;")
      .replace("#include <color_fragment>", snow
        ? "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92, .95, 1.), smoothstep(.15, .7, vUp) * .75);"
        : "#include <color_fragment>");
  };
  return m;
}
