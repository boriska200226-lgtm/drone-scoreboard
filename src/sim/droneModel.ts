// Детальные PBR-модели мультикоптеров. У каждого аппарата своя конструкция по реальному классу техники:
// компактный складной квадрокоптер для съёмки, промышленный гексакоптер, соосный X8 и тяжёлый агродрон.
// Общее: лопасти с сужением и круткой, моторы с рёбрами охлаждения, карбон, навигационные огни, ливреи с бортовыми надписями.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Airframe } from "./airframes";
import { DroneSim } from "./physics";

export interface DroneModel {
  group: THREE.Group;
  update(dt: number, sim: DroneSim, payloadFrac: number, time: number): void;
}

export interface Livery { id: string; label: string; primary: number; secondary: number; accent: number; text: string }

export const LIVERIES: Livery[] = [
  { id: "rescue", label: "Спасательная", primary: 0xf2f3f4, secondary: 0xd7262e, accent: 0x1d4fa3, text: "#d7262e" },
  { id: "forest", label: "Лесоохрана", primary: 0x4f6b3a, secondary: 0xe7d36a, accent: 0x2b3a22, text: "#e7d36a" },
  { id: "agro", label: "Агро", primary: 0xf4f4f0, secondary: 0xf07a1a, accent: 0x2b2d30, text: "#f07a1a" },
  { id: "tactical", label: "Тактическая", primary: 0x3a3f45, secondary: 0x6b737c, accent: 0x1c1f22, text: "#c9d0d6" },
  { id: "science", label: "Научная", primary: 0xf2c21b, secondary: 0x1c1d20, accent: 0x1c1d20, text: "#1c1d20" },
];
const DEFAULT_LIVERY: Record<string, string> = { quad: "science", hexa: "rescue", coax: "forest", octo: "agro" };
export const liveryFor = (afId: string, id?: string) => LIVERIES.find((l) => l.id === (id && id !== "auto" ? id : DEFAULT_LIVERY[afId])) ?? LIVERIES[0];

// ─────────────────────────── материалы и текстуры ───────────────────────────

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

let carbonTex: THREE.CanvasTexture | null = null;
/** Карбон 2×2 твил: чередующиеся диагональные полосы с бликом по волокну. */
function carbon(): THREE.CanvasTexture {
  if (carbonTex) return carbonTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const n = 8, s = 128 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const along = (x + y) % 4 < 2;
    const gr = along ? g.createLinearGradient(x * s, y * s, x * s + s, y * s) : g.createLinearGradient(x * s, y * s, x * s, y * s + s);
    gr.addColorStop(0, "#151618"); gr.addColorStop(0.5, "#3a3d42"); gr.addColorStop(1, "#151618");
    g.fillStyle = gr; g.fillRect(x * s, y * s, s, s);
  }
  carbonTex = new THREE.CanvasTexture(c);
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  carbonTex.anisotropy = 8;
  return carbonTex;
}

/** Бортовая роспись: основной цвет, полосы, название и регистрационный номер. */
function decal(l: Livery, name: string, reg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = css(l.primary); g.fillRect(0, 0, 512, 256);
  // лёгкая потёртость и пыль
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 512, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  g.fillStyle = css(l.secondary); g.fillRect(0, 150, 512, 34);
  g.fillStyle = css(l.accent); g.fillRect(0, 188, 512, 12);
  g.fillStyle = l.text; g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.fillText(name.toUpperCase(), 256, 100);
  g.fillStyle = l.id === "science" ? "#1c1d20" : "#f4f4f4"; g.font = "bold 26px monospace"; g.fillText(reg, 256, 176);
  // предупреждающая наклейка «осторожно, винты»
  g.fillStyle = "#ffd400"; g.beginPath(); g.moveTo(450, 60); g.lineTo(490, 120); g.lineTo(410, 120); g.closePath(); g.fill();
  g.fillStyle = "#111"; g.font = "bold 40px sans-serif"; g.fillText("!", 450, 114);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

interface Kit {
  carbon: THREE.MeshPhysicalMaterial; shell: THREE.MeshPhysicalMaterial; shell2: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial;
  decal: THREE.MeshPhysicalMaterial; alu: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial; blade: THREE.MeshStandardMaterial; tank: THREE.MeshPhysicalMaterial;
}

function kit(af: Airframe, l: Livery): Kit {
  const reg = `RA-${(0x1000 + af.id.charCodeAt(0) * 97 + af.motors.length * 311).toString().slice(-5)}`;
  return {
    carbon: new THREE.MeshPhysicalMaterial({ map: carbon(), color: 0xffffff, roughness: 0.42, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    shell: new THREE.MeshPhysicalMaterial({ color: l.primary, roughness: 0.38, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    shell2: new THREE.MeshStandardMaterial({ color: l.secondary, roughness: 0.45, metalness: 0.05 }),
    accent: new THREE.MeshStandardMaterial({ color: l.accent, roughness: 0.5, metalness: 0.1 }),
    decal: new THREE.MeshPhysicalMaterial({ map: decal(l, af.name, reg), roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.28, metalness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.55, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x06080b, roughness: 0.04, metalness: 0.9 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide, transparent: true }),
    tank: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f6, roughness: 0.35, transmission: 0.45, thickness: 0.04, transparent: true, opacity: 0.7 }),
  };
}

// ─────────────────────────── детали ───────────────────────────

/** Лопасть: сужение к концу, крутка, тонкий изогнутый профиль, скруглённая законцовка. */
function bladeGeometry(R: number, rootChord: number, tipChord: number, twistDeg: number, dir: number): THREE.BufferGeometry {
  const span = 10, chord = 4;
  const pos: number[] = [], idx: number[] = [];
  const r0 = R * 0.14;
  for (let i = 0; i <= span; i++) {
    const t = i / span, r = r0 + (R - r0) * t;
    // законцовка: хорда быстро уменьшается на последних 8 %
    const tipK = t > 0.92 ? Math.sqrt(Math.max(0, 1 - ((t - 0.92) / 0.08) ** 2)) : 1;
    const c = (rootChord + (tipChord - rootChord) * t) * Math.max(0.15, tipK) * (t < 0.15 ? 0.6 + t * 2.6 : 1);
    const tw = ((twistDeg * (1 - t) + 6) * Math.PI) / 180;
    for (let j = 0; j <= chord; j++) {
      const u = j / chord - 0.5;
      const camber = 0.06 * c * (1 - 4 * u * u);
      const z = u * c, y = camber;
      // поворот сечения на угол крутки вокруг оси лопасти
      pos.push(r, y * Math.cos(tw) + z * Math.sin(tw) * dir, z * Math.cos(tw) - y * Math.sin(tw) * dir);
    }
  }
  for (let i = 0; i < span; i++) for (let j = 0; j < chord; j++) {
    const a = i * (chord + 1) + j, b = a + chord + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let blurTex: THREE.CanvasTexture | null = null;
function blurTexture(): THREE.CanvasTexture {
  if (blurTex) return blurTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, "rgba(20,20,20,0)"); gr.addColorStop(0.15, "rgba(20,20,20,0.5)");
  gr.addColorStop(0.8, "rgba(30,30,30,0.3)"); gr.addColorStop(0.94, "rgba(235,235,235,0.5)"); gr.addColorStop(1, "rgba(30,30,30,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  blurTex = new THREE.CanvasTexture(c);
  return blurTex;
}

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
};
const tube = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 12) => {
  const m = mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg), mat, parent);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Мотор: статорное основание, колокол с рёбрами охлаждения, цветная крышка. */
function motor(parent: THREE.Object3D, k: Kit, r: number, h: number, up: number) {
  const g = new THREE.Group();
  parent.add(g);
  mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.15, h * 0.35, 20), k.dark, g, 0, (h * 0.17) * up);
  mesh(new THREE.CylinderGeometry(r, r, h * 0.6, 24, 1, true), k.alu, g, 0, h * 0.6 * up);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const fin = mesh(new THREE.BoxGeometry(r * 0.08, h * 0.5, r * 0.25), k.dark, g, Math.cos(a) * r * 0.98, h * 0.6 * up, Math.sin(a) * r * 0.98);
    fin.rotation.y = -a;
  }
  mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.14, 24), k.shell2, g, 0, h * 0.95 * up);
  return g;
}

interface Rotor { spin: THREE.Group; disc: THREE.MeshBasicMaterial; blades: THREE.MeshStandardMaterial; angle: number; dir: number }

/** Винт с двумя (или тремя) лопастями, коком и диском размытия. */
function rotor(parent: THREE.Object3D, k: Kit, R: number, dir: number, blades: number, chordK: number): Rotor {
  const spin = new THREE.Group();
  parent.add(spin);
  const bladeMat = k.blade.clone();
  const geo = bladeGeometry(R, R * 0.17 * chordK, R * 0.07 * chordK, 16, dir);
  for (let i = 0; i < blades; i++) {
    const b = mesh(geo, bladeMat, spin);
    b.rotation.y = (i / blades) * Math.PI * 2;
  }
  mesh(new THREE.CylinderGeometry(R * 0.06, R * 0.11, R * 0.07, 14), k.alu, spin);
  mesh(new THREE.SphereGeometry(R * 0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.shell2, spin, 0, R * 0.035);
  const discMat = new THREE.MeshBasicMaterial({ map: blurTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 32), discMat);
  disc.rotation.x = -Math.PI / 2;
  spin.add(disc);
  return { spin, disc: discMat, blades: bladeMat, angle: Math.random() * 6, dir };
}

/** Навигационный огонь: светится сам по себе, подхватывается свечением (bloom). */
function navLight(parent: THREE.Object3D, color: number, r: number, x: number, y: number, z: number) {
  return mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 6, toneMapped: false }), parent, x, y, z);
}

/** Подвес камеры: две оси с моторчиками, корпус камеры, объективы (обычный и тепловизор у промышленных). */
function gimbal(parent: THREE.Object3D, k: Kit, s: number, dual: boolean) {
  const g = new THREE.Group();
  parent.add(g);
  mesh(new THREE.CylinderGeometry(s * 0.25, s * 0.25, s * 0.18, 14), k.dark, g, 0, 0, 0);
  const yoke = new THREE.Group();
  yoke.position.y = -s * 0.35;
  g.add(yoke);
  mesh(new THREE.BoxGeometry(s * 0.12, s * 0.55, s * 0.12), k.dark, yoke, -s * 0.48, 0, 0);
  mesh(new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.1, 14), k.alu, yoke, -s * 0.48, -s * 0.15, 0).rotation.z = Math.PI / 2;
  const body = mesh(new RoundedBoxGeometry(s * 0.85, s * 0.6, s * 0.6, 3, s * 0.12), k.dark, yoke, 0, -s * 0.15, 0);
  const lens = (x: number, r: number, mat: THREE.Material) => {
    const L = mesh(new THREE.CylinderGeometry(r, r * 1.1, s * 0.16, 18), k.dark, yoke, x, -s * 0.15, -s * 0.33);
    L.rotation.x = Math.PI / 2;
    const G = mesh(new THREE.CircleGeometry(r * 0.85, 18), mat, yoke, x, -s * 0.15, -s * 0.415);
    G.rotation.y = Math.PI;
  };
  if (dual) {
    lens(-s * 0.18, s * 0.15, k.glass);
    lens(s * 0.2, s * 0.11, new THREE.MeshStandardMaterial({ color: 0x2a2a1a, roughness: 0.1, metalness: 0.7 })); // германиевое стекло тепловизора
  } else lens(0, s * 0.18, k.glass);
  void body;
  return g;
}

// ─────────────────────────── аппараты ───────────────────────────

interface Built { group: THREE.Group; rotors: Rotor[]; liquid: THREE.Mesh | null; strobe: THREE.Mesh }

/** Позиция мотора и куда смотрит винт (вверх или вниз у нижнего соосного). */
function motorFrames(af: Airframe) {
  return af.motors.map((m) => ({ x: m.x, z: m.z, y: m.y, up: m.y < 0 ? -1 : 1, dir: m.dir }));
}

/** «Стриж-4»: компактный складной квадрокоптер для съёмки. Обтекаемый корпус, плоские лучи, передний подвес. */
function buildQuad(af: Airframe, k: Kit, gearH: number): Built {
  const g = new THREE.Group();
  const s = af.arm;
  // корпус: вытянутая капля с росписью сверху и тёмным «брюхом»
  const top = mesh(new RoundedBoxGeometry(s * 0.62, s * 0.26, s * 1.25, 5, s * 0.12), k.decal, g, 0, s * 0.02, 0);
  top.scale.set(1, 1, 1);
  mesh(new RoundedBoxGeometry(s * 0.56, s * 0.12, s * 1.1, 4, s * 0.05), k.dark, g, 0, -s * 0.12, 0.02);
  mesh(new RoundedBoxGeometry(s * 0.5, s * 0.16, s * 0.5, 4, s * 0.06), k.accent, g, 0, s * 0.15, s * 0.18); // батарея
  // датчики препятствий: пары «глаз» спереди и сзади
  for (const z of [-1, 1]) for (const x of [-1, 1]) mesh(new THREE.CircleGeometry(s * 0.04, 12), k.glass, g, x * s * 0.12, s * 0.02, z * s * 0.63).rotation.y = z > 0 ? 0 : Math.PI;
  const rotors: Rotor[] = [];
  for (const m of motorFrames(af)) {
    // плоский луч с изгибом вниз к мотору
    const arm = new THREE.Shape();
    const len = Math.hypot(m.x, m.z);
    arm.moveTo(0, -s * 0.05); arm.lineTo(len, -s * 0.035); arm.lineTo(len, s * 0.035); arm.lineTo(0, s * 0.06);
    const ag = new THREE.ExtrudeGeometry(arm, { depth: s * 0.05, bevelEnabled: true, bevelSize: s * 0.012, bevelThickness: s * 0.012, bevelSegments: 2 });
    ag.translate(0, 0, -s * 0.025);
    ag.rotateX(Math.PI / 2);
    const am = mesh(ag, k.dark, g, 0, -s * 0.02, 0);
    am.rotation.y = -Math.atan2(m.z, m.x);
    const mg = new THREE.Group(); mg.position.set(m.x, s * 0.02, m.z); g.add(mg);
    motor(mg, k, af.propR * 0.17, s * 0.13, 1);
    const r = rotor(mg, k, af.propR, m.dir, 2, 0.85);
    r.spin.position.y = s * 0.15;
    rotors.push(r);
    // складная ножка под передними лучами
    // складная ножка под передними лучами: широкая, разведена наружу
    if (m.z < 0) { tube(g, V(m.x * 0.8, -s * 0.03, m.z * 0.8), V(m.x * 1.05, -gearH + 0.015, m.z * 1.0), s * 0.045, k.dark, 10); mesh(new THREE.SphereGeometry(s * 0.06, 10, 8), k.rubber, g, m.x * 1.05, -gearH + 0.02, m.z * 1.0); }
    navLight(g, m.z < 0 ? (m.x < 0 ? 0xff2020 : 0x20ff40) : 0xffffff, s * 0.03, m.x, -s * 0.06, m.z);
  }
  // задние ножки — у батарейного отсека
  for (const x of [-1, 1]) { tube(g, V(x * s * 0.2, -s * 0.12, s * 0.45), V(x * s * 0.42, -gearH + 0.015, s * 0.62), s * 0.045, k.dark, 10); mesh(new THREE.SphereGeometry(s * 0.06, 10, 8), k.rubber, g, x * s * 0.42, -gearH + 0.02, s * 0.62); }
  const gb = gimbal(g, k, s * 0.32, false);
  gb.position.set(0, -s * 0.12, -s * 0.55);
  const strobe = navLight(g, 0xffffff, s * 0.025, 0, s * 0.18, s * 0.6);
  return { group: g, rotors, liquid: null, strobe };
}

/** Общая рама из двух карбоновых пластин и трубчатых лучей (гекса, окта). */
function tubularFrame(g: THREE.Group, af: Airframe, k: Kit, plateR: number, armR: number, foldHinge: boolean) {
  const rotors: Rotor[] = [];
  mesh(new THREE.CylinderGeometry(plateR, plateR, 0.012, 24), k.carbon, g, 0, 0.035, 0);
  mesh(new THREE.CylinderGeometry(plateR, plateR, 0.012, 24), k.carbon, g, 0, -0.035, 0);
  const seen = new Set<string>();
  for (const m of motorFrames(af)) {
    const key = `${m.x.toFixed(2)},${m.z.toFixed(2)}`;
    const len = Math.hypot(m.x, m.z), ux = m.x / len, uz = m.z / len;
    if (!seen.has(key)) {
      seen.add(key);
      tube(g, V(ux * plateR * 0.6, 0, uz * plateR * 0.6), V(m.x, 0, m.z), armR, k.carbon);
      // хомут у пластин и шарнир складывания
      mesh(new THREE.BoxGeometry(armR * 3.4, armR * 3, armR * 3.4), k.dark, g, ux * plateR, 0, uz * plateR);
      if (foldHinge) {
        const h = mesh(new THREE.CylinderGeometry(armR * 1.9, armR * 1.9, armR * 3.6, 14), k.shell2, g, ux * (plateR + armR * 6), 0, uz * (plateR + armR * 6));
        h.rotation.z = Math.PI / 2; h.rotation.y = -Math.atan2(uz, ux);
      }
      // крепление мотора
      mesh(new THREE.BoxGeometry(armR * 3.2, armR * 2.4, armR * 3.2), k.dark, g, m.x, 0, m.z);
    }
    const mg = new THREE.Group(); mg.position.set(m.x, m.up > 0 ? armR * 1.2 : -armR * 1.2, m.z); g.add(mg);
    motor(mg, k, af.propR * 0.16, 0.03 + af.propR * 0.1, m.up);
    const r = rotor(mg, k, af.propR, m.dir, af.motors.length >= 8 && m.y === 0 ? 2 : 2, 1);
    r.spin.position.y = m.up * (0.05 + af.propR * 0.12);
    rotors.push(r);
  }
  return rotors;
}

function skids(g: THREE.Group, k: Kit, s: number, gearH: number, width: number, length: number, r: number) {
  for (const sx of [-1, 1]) {
    const fx = sx * width / 2;
    tube(g, V(sx * s * 0.16, -0.04, -length * 0.25), V(fx, -gearH + r, -length * 0.3), r, k.carbon);
    tube(g, V(sx * s * 0.16, -0.04, length * 0.25), V(fx, -gearH + r, length * 0.3), r, k.carbon);
    tube(g, V(fx, -gearH + r, -length / 2), V(fx, -gearH + r, length / 2), r, k.carbon);
    for (const sz of [-1, 1]) {
      const p = mesh(new THREE.CylinderGeometry(r * 1.8, r * 1.8, length * 0.18, 12), k.rubber, g, fx, -gearH + r, sz * length * 0.36);
      p.rotation.x = Math.PI / 2;
    }
  }
}

/** «Сапсан-6»: промышленный гексакоптер — купол, GPS-мачта, двойная камера (обычная + тепловизор). */
function buildHexa(af: Airframe, k: Kit, gearH: number): Built {
  const g = new THREE.Group();
  const s = af.arm, plateR = s * 0.36;
  const rotors = tubularFrame(g, af, k, plateR, 0.018 + s * 0.012, true);
  // купол с росписью
  const dome = mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), k.decal, g, 0, 0.04, 0);
  dome.scale.set(plateR * 0.95, s * 0.22, plateR * 0.95);
  dome.rotation.y = Math.PI / 2;
  mesh(new THREE.TorusGeometry(plateR * 0.95, 0.008, 6, 40), k.shell2, g, 0, 0.042, 0).rotation.x = Math.PI / 2;
  // батарея с ручкой снизу
  mesh(new RoundedBoxGeometry(s * 0.32, s * 0.14, s * 0.44, 3, 0.01), k.dark, g, 0, -0.09, 0);
  mesh(new THREE.TorusGeometry(s * 0.06, 0.008, 6, 16, Math.PI), k.accent, g, 0, -0.03, s * 0.24);
  // GPS-мачта с «грибом» и две антенны радиолинка
  tube(g, V(0, 0.1, s * 0.28), V(0, 0.1 + s * 0.3, s * 0.28), 0.007 + s * 0.005, k.carbon, 8);
  mesh(new THREE.CylinderGeometry(s * 0.09, s * 0.09, 0.025, 20), k.shell, g, 0, 0.12 + s * 0.3, s * 0.28);
  for (const sx of [-1, 1]) tube(g, V(sx * s * 0.18, -0.06, s * 0.3), V(sx * s * 0.26, -0.2 - s * 0.1, s * 0.4), 0.006, k.rubber, 6);
  skids(g, k, s, gearH, s * 0.95, s * 1.15, 0.01 + s * 0.012);
  const gb = gimbal(g, k, s * 0.3, true);
  gb.position.set(0, -0.1, -s * 0.36);
  for (const m of af.motors) if (Math.abs(m.z) > s * 0.4) navLight(g, m.z < 0 ? (m.x < 0 ? 0xff2020 : 0x20ff40) : 0xffffff, 0.012 + s * 0.012, m.x * 0.82, -0.03, m.z * 0.82);
  const strobe = navLight(g, 0xffffff, 0.015, 0, 0.12 + s * 0.3 + 0.03, s * 0.28);
  return { group: g, rotors, liquid: null, strobe };
}

/** «Тайга-X8»: соосная схема — квадратная рама, по два мотора на луче, лебёдка с крюком. */
function buildCoax(af: Airframe, k: Kit, gearH: number): Built {
  const g = new THREE.Group();
  const s = af.arm;
  const rotors = tubularFrame(g, af, k, s * 0.3, 0.025 + s * 0.012, false);
  mesh(new RoundedBoxGeometry(s * 0.55, s * 0.24, s * 0.55, 4, s * 0.05), k.decal, g, 0, 0.09, 0);
  mesh(new RoundedBoxGeometry(s * 0.45, s * 0.12, s * 0.5, 3, 0.02), k.accent, g, 0, -0.1, 0);
  // лебёдка с тросом и крюком
  const winch = mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.07, s * 0.18, 16), k.alu, g, 0, -0.18, s * 0.1);
  winch.rotation.z = Math.PI / 2;
  tube(g, V(0, -0.22, s * 0.1), V(0, -gearH * 0.85, s * 0.1), 0.004, k.dark, 6);
  mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI * 1.5), k.alu, g, 0, -gearH * 0.88, s * 0.1);
  skids(g, k, s, gearH, s * 0.9, s * 1.0, 0.012 + s * 0.012);
  const gb = gimbal(g, k, s * 0.26, true);
  gb.position.set(0, -0.08, -s * 0.33);
  for (const m of af.motors) if (m.y > 0) navLight(g, m.z < 0 ? (m.x < 0 ? 0xff2020 : 0x20ff40) : 0xffffff, 0.015 + s * 0.01, m.x * 0.7, -0.03, m.z * 0.7);
  const strobe = navLight(g, 0xffffff, 0.018, 0, 0.24, 0);
  return { group: g, rotors, liquid: null, strobe };
}

/** «Беркут-8»: тяжёлый агродрон — бак, форсунки под моторами, радары рельефа, складные лучи. */
function buildOcto(af: Airframe, k: Kit, gearH: number, tank: boolean): Built {
  const g = new THREE.Group();
  const s = af.arm, plateR = s * 0.3;
  const rotors = tubularFrame(g, af, k, plateR, 0.024 + s * 0.012, true);
  // фюзеляж с росписью и носовой обтекатель
  mesh(new RoundedBoxGeometry(s * 0.55, s * 0.2, s * 0.8, 4, s * 0.06), k.decal, g, 0, 0.1, 0);
  mesh(new RoundedBoxGeometry(s * 0.4, s * 0.14, s * 0.25, 4, s * 0.05), k.shell2, g, 0, 0.1, -s * 0.48);
  // радары рельефа спереди и сзади
  for (const z of [-1, 1]) mesh(new RoundedBoxGeometry(s * 0.18, s * 0.1, s * 0.06, 3, 0.01), k.dark, g, 0, -0.02, z * s * 0.52);
  // бак
  let liquid: THREE.Mesh | null = null;
  const tankH = Math.min(gearH * 0.7, s * 0.5);
  if (tank) {
    mesh(new RoundedBoxGeometry(s * 0.5, tankH, s * 0.5, 4, s * 0.08), k.tank, g, 0, -0.06 - tankH / 2, 0);
    liquid = mesh(new RoundedBoxGeometry(s * 0.46, tankH * 0.92, s * 0.46, 3, s * 0.06), new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.2, transparent: true, opacity: 0.85 }), g, 0, -0.06 - tankH / 2, 0);
    mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.07, 0.03, 16), k.shell2, g, 0, -0.04, 0); // крышка заливной горловины
  } else mesh(new RoundedBoxGeometry(s * 0.42, tankH * 0.6, s * 0.42, 3, 0.02), k.dark, g, 0, -0.08 - tankH * 0.3, 0);
  // шланги и форсунки под каждым мотором
  for (const m of af.motors) {
    tube(g, V(0, -0.1, 0), V(m.x * 0.95, -0.05, m.z * 0.95), 0.006, k.dark, 6);
    const n = mesh(new THREE.ConeGeometry(0.02 + s * 0.012, 0.06, 10), k.shell2, g, m.x * 0.95, -0.1, m.z * 0.95);
    n.rotation.x = Math.PI;
  }
  // мощные шасси-дуги
  skids(g, k, s, gearH, s * 0.85, s * 0.95, 0.016 + s * 0.012);
  const gb = gimbal(g, k, s * 0.18, false);
  gb.position.set(0, 0.02, -s * 0.58);
  for (const m of af.motors) navLight(g, m.z < 0 ? (m.x < 0 ? 0xff2020 : 0x20ff40) : 0xffffff, 0.015 + s * 0.01, m.x * 0.85, -0.05, m.z * 0.85);
  const strobe = navLight(g, 0xffffff, 0.02, 0, 0.22, s * 0.3);
  return { group: g, rotors, liquid, strobe };
}

export function buildDrone(af: Airframe, opts: { tank: boolean; boom: number; livery?: string }): DroneModel {
  const k = kit(af, liveryFor(af.id, opts.livery));
  const gearH = 0.16 + af.arm * 0.28;
  const b = af.id === "quad" ? buildQuad(af, k, gearH)
    : af.id === "hexa" ? buildHexa(af, k, gearH)
    : af.id === "coax" ? buildCoax(af, k, gearH)
    : buildOcto(af, k, gearH, opts.tank);
  // штанга опрыскивателя для агромиссий
  if (opts.boom > 0) {
    tube(b.group, V(-opts.boom / 2, -gearH * 0.75, af.arm * 0.2), V(opts.boom / 2, -gearH * 0.75, af.arm * 0.2), 0.012, k.alu);
    for (let i = 0; i <= 6; i++) mesh(new THREE.ConeGeometry(0.025, 0.06, 8), k.shell2, b.group, -opts.boom / 2 + (opts.boom * i) / 6, -gearH * 0.75 - 0.04, af.arm * 0.2).rotation.x = Math.PI;
  }
  return {
    group: b.group,
    update(dt, sim, payloadFrac, time) {
      b.rotors.forEach((r, i) => {
        const kk = sim.motorOk[i] ? Math.sqrt(Math.max(0, sim.thrust[i] / af.motorThrust)) : 0;
        const rpm = kk * 110;
        r.angle += r.dir * rpm * dt;
        r.spin.rotation.y = r.angle;
        const blur = THREE.MathUtils.smoothstep(rpm, 8, 30);
        r.disc.opacity = blur * 0.5;
        r.blades.opacity = 1 - blur * 0.85;
      });
      if (b.liquid) {
        const base = b.liquid.userData.baseY ??= b.liquid.position.y;
        const h = (b.liquid.geometry as THREE.BufferGeometry & { parameters: { height: number } }).parameters.height;
        b.liquid.visible = payloadFrac > 0.02;
        b.liquid.scale.y = Math.max(0.05, payloadFrac);
        b.liquid.position.y = base - (h * (1 - b.liquid.scale.y)) / 2;
      }
      b.strobe.visible = time % 1.2 < 0.08;
    },
  };
}
