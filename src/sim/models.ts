// Библиотека 3D-моделей (glTF/GLB): дома, люди, техника, животные.
// Список лежит в public/sim/models/manifest.json — модель, которой нет, заменяется процедурной.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Role = "house" | "person" | "van" | "moose" | "bear" | "reindeer" | "tractor";

export interface ModelSpec {
  url: string;
  /** Высота объекта в метрах (люди, техника, животные). */
  height?: number;
  /** Наибольший размер в плане, м (дома). */
  footprint?: number;
  rotY?: number; // поворот, градусы
  anim?: string; // имя анимации по умолчанию
  credit?: string;
  /** Анимации по смыслу: idle, walk, run, graze → имя клипа. */
  anims?: Record<string, string>;
  /** Варианты окраски: имя материала → цвет. Экземпляр берёт случайный. */
  palettes?: Record<string, string>[];
  /** Масштаб костей (пропорции зверя): имя кости → [x, y, z]. */
  bones?: Record<string, [number, number, number]>;
  /** Масштаб отдельных частей (например, рогов): имя меша → [x, y, z]. */
  meshes?: Record<string, [number, number, number]>;
  /** Неравномерный масштаб всей модели [ширина, высота, длина]. */
  shape?: [number, number, number];
  /** Сгладить гранёную low-poly модель. */
  smooth?: boolean;
}

/** Гладкие нормали для гранёной модели: склеиваем вершины и пересчитываем освещение. */
function smoothGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  for (const [name, a] of Object.entries(src.attributes)) {
    if (name === "normal") continue;
    // квантованные (meshopt) атрибуты переводим во float, иначе склейка не работает
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const out = mergeVertices(g, 1e-4);
  out.computeVertexNormals();
  return out;
}

interface Loaded { scene: THREE.Object3D; clips: THREE.AnimationClip[]; spec: ModelSpec; scale: number; offset: THREE.Vector3; palettes: Map<string, THREE.Material>[] }

const lib: Partial<Record<Role, Loaded[]>> = {};
const mixers = new Set<THREE.AnimationMixer>();
let loading: Promise<void> | null = null;

const base = () => `${import.meta.env.BASE_URL}sim/models/`;

/** Бинарный файл: на сайте — как есть, в автономной сборке хостинг не отдаёт .glb, поэтому рядом лежит base64. */
export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  if (import.meta.env.VITE_PACKED_ASSETS) {
    const b64 = (await (await fetch(`${url}.txt`)).text()).trim();
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export function loadModels(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    let manifest: Partial<Record<Role, ModelSpec[]>> = {};
    try {
      const r = await fetch(`${base()}manifest.json`);
      if (r.ok) manifest = await r.json();
    } catch { /* без манифеста — только процедурные модели */ }
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const jobs: Promise<void>[] = [];
    for (const [role, specs] of Object.entries(manifest) as [Role, ModelSpec[]][]) {
      for (const spec of specs ?? []) {
        jobs.push((async () => {
          try {
            const buf = await fetchBinary(base() + spec.url);
            const gltf = await loader.parseAsync(buf, base());
            const scene = gltf.scene;
            scene.traverse((o) => {
              const m = o as THREE.Mesh;
              if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
            });
            scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(scene);
            const size = box.getSize(new THREE.Vector3());
            const sy = spec.shape?.[1] ?? 1;
            const scale = spec.height ? spec.height / Math.max(1e-3, size.y * sy) : spec.footprint ? spec.footprint / Math.max(1e-3, size.x, size.z) : 1;
            const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
            if (spec.smooth) scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.geometry = smoothGeometry(m.geometry); });
            // заранее готовим материалы под каждую окраску
            const palettes = (spec.palettes ?? []).map((pal) => {
              const map = new Map<string, THREE.Material>();
              scene.traverse((o) => {
                const m = o as THREE.Mesh;
                if (!m.isMesh) return;
                const src = m.material as THREE.MeshStandardMaterial;
                if (map.has(src.name)) return;
                // чистый матовый материал: у исходного бывают блики и оттенки, которые розовят шерсть
                const mat = new THREE.MeshStandardMaterial({ name: src.name, color: pal[src.name] ?? src.color, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
                map.set(src.name, mat);
              });
              return map;
            });
            (lib[role] ??= []).push({ scene, clips: gltf.animations, spec, scale, offset, palettes });
          } catch (e) {
            console.warn("Модель не загружена:", spec.url, e);
          }
        })());
      }
    }
    await Promise.all(jobs);
  })();
  return loading;
}

export const hasModel = (role: Role) => (lib[role]?.length ?? 0) > 0;

/** Копия модели: стоит на земле в начале координат, нужного размера, с запущенной анимацией. */
export function instanceModel(role: Role, pick = Math.random()): THREE.Group | null {
  const list = lib[role];
  if (!list?.length) return null;
  const m = list[Math.floor(pick * list.length) % list.length];
  const obj = SkeletonUtils.clone(m.scene);
  obj.position.copy(m.offset);
  if (m.palettes.length) {
    const pal = m.palettes[Math.floor(Math.random() * m.palettes.length)];
    obj.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.material = pal.get((me.material as THREE.Material).name) ?? me.material; });
  }
  if (m.spec.meshes) {
    obj.traverse((o) => { const k = m.spec.meshes![o.name]; if (k) o.scale.multiply(new THREE.Vector3(...k)); });
  }
  if (m.spec.bones) {
    obj.traverse((o) => { const b = m.spec.bones![o.name]; if ((o as THREE.Bone).isBone && b) o.scale.set(...b); });
  }
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(m.scale);
  if (m.spec.shape) inner.scale.multiply(new THREE.Vector3(...m.spec.shape));
  inner.rotation.y = ((m.spec.rotY ?? 0) * Math.PI) / 180;
  inner.add(obj);
  g.add(inner);
  const clip = m.clips.find((c) => c.name === m.spec.anim) ?? m.clips[0];
  if (clip && m.spec.anim !== "none") {
    const mixer = new THREE.AnimationMixer(obj);
    let cur = mixer.clipAction(clip);
    cur.time = Math.random() * clip.duration;
    cur.play();
    mixers.add(mixer);
    g.userData.mixer = mixer;
    // переключение анимации по смыслу (idle/walk/run/graze) с плавным переходом
    let curName = "";
    g.userData.play = (kind: string, speed = 1) => {
      const name = m.spec.anims?.[kind] ?? kind;
      if (name === curName) { cur.timeScale = speed; return; }
      const c = m.clips.find((x) => x.name === name);
      if (!c) return;
      const next = mixer.clipAction(c);
      next.reset(); next.timeScale = speed; next.play();
      cur.crossFadeTo(next, 0.35, false);
      cur = next; curName = name;
    };
  }
  return g;
}

export function updateModels(dt: number) { for (const m of mixers) m.update(dt); }
export function releaseModels() { for (const m of mixers) m.stopAllAction(); mixers.clear(); }

/** Подписи источников загруженных моделей — для экрана «Об авторах». */
export function modelCredits(): string[] {
  return Object.values(lib).flat().map((m) => m!.spec.credit).filter((c): c is string => !!c);
}
