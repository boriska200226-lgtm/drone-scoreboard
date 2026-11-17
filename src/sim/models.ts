// Библиотека 3D-моделей (glTF/GLB): дома, люди, техника, животные.
// Список лежит в public/sim/models/manifest.json — модель, которой нет, заменяется процедурной.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

export type Role = "house" | "person" | "van" | "moose" | "bear" | "tractor";

export interface ModelSpec {
  url: string;
  /** Высота объекта в метрах (люди, техника, животные). */
  height?: number;
  /** Наибольший размер в плане, м (дома). */
  footprint?: number;
  rotY?: number; // поворот, градусы
  anim?: string; // имя анимации по умолчанию
  credit?: string;
}

interface Loaded { scene: THREE.Object3D; clips: THREE.AnimationClip[]; spec: ModelSpec; scale: number; offset: THREE.Vector3 }

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
            const scale = spec.height ? spec.height / Math.max(1e-3, size.y) : spec.footprint ? spec.footprint / Math.max(1e-3, size.x, size.z) : 1;
            const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
            (lib[role] ??= []).push({ scene, clips: gltf.animations, spec, scale, offset });
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
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(m.scale);
  inner.rotation.y = ((m.spec.rotY ?? 0) * Math.PI) / 180;
  inner.add(obj);
  g.add(inner);
  const clip = m.clips.find((c) => c.name === m.spec.anim) ?? m.clips[0];
  if (clip && m.spec.anim !== "none") {
    const mixer = new THREE.AnimationMixer(obj);
    const a = mixer.clipAction(clip);
    a.time = Math.random() * clip.duration;
    a.play();
    mixers.add(mixer);
    g.userData.mixer = mixer;
  }
  return g;
}

export function updateModels(dt: number) { for (const m of mixers) m.update(dt); }
export function releaseModels() { for (const m of mixers) m.stopAllAction(); mixers.clear(); }

/** Подписи источников загруженных моделей — для экрана «Об авторах». */
export function modelCredits(): string[] {
  return Object.values(lib).flat().map((m) => m!.spec.credit).filter((c): c is string => !!c);
}
