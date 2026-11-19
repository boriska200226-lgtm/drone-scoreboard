// Сценарии миссий. Каждая миссия описывает мир, погоду и правила выполнения.
import * as THREE from "three";
import { Airframe } from "./airframes";
import { FlameField, Particles } from "./effects";
import { clamp, mulberry32 } from "./noise";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DroneSim, FlightMode } from "./physics";
import { instanceModel } from "./models";
import type { Fault } from "./engine";
import {
  makeAnimal, makeBeam, makeHelipad, makeHouse, makePerson, makePylon, makeRing, makeVan,
  Palette, THERMAL_LAYER, World, WorldCfg,
} from "./world";

export type Difficulty = "cadet" | "pilot" | "ace";
export const DIFFICULTY: Record<Difficulty, { label: string; hint: string; wind: number }> = {
  cadet: { label: "Курсант", hint: "слабый ветер", wind: 0.45 },
  pilot: { label: "Пилот", hint: "штатная погода", wind: 1 },
  ace: { label: "Ас", hint: "шторм и отказ мотора в полёте", wind: 1.35 },
};

export interface Objective { text: string; done: boolean; progress?: string }
export type SayKind = "info" | "good" | "warn";

export interface MapDraw {
  dot(x: number, z: number, color: string, r?: number): void;
  ring(x: number, z: number, radius: number, color: string): void;
  rect(x0: number, z0: number, x1: number, z1: number, color: string, fill?: boolean): void;
}

export interface Ctx {
  world: World;
  drone: DroneSim;
  af: Airframe;
  difficulty: Difficulty;
  rnd: () => number;
  fx: { fire: Particles; smoke: Particles; water: Particles };
  say(text: string, kind?: SayKind): void;
  thermal(): boolean;
  camDir(): THREE.Vector3;
  camPos(): THREE.Vector3;
  /** Ввести отказ (для упражнений курса). */
  fault?(kind: Fault, dur?: number): void;
  /** Состояние радиоканала. */
  link?(): { lost: boolean; failsafe: string | null; q: number };
}

export interface Action { held: boolean; pressed: boolean }

export abstract class Mission {
  tasksDone = false;
  failed: string | null = null;
  amount = 0;
  capacity = 0;
  time = 0;
  protected ctx: Ctx;
  constructor(ctx: Ctx) { this.ctx = ctx; }
  abstract update(dt: number, action: Action): void;
  abstract objectives(): Objective[];
  abstract summary(): { score: number; rows: [string, string][] };
  drawMap(_m: MapDraw): void { /* по умолчанию нечего рисовать */ }
  extraWind(_p: THREE.Vector3, _out: THREE.Vector3): void { /* нет локальных потоков */ }
  onWaterHit(_x: number, _z: number, _mass: number): void { /* вода ни на что не влияет */ }
  refill(): boolean {
    if (this.amount >= this.capacity) return false;
    this.amount = this.capacity;
    return true;
  }
  dispose(): void { /* нет собственных ресурсов */ }

  protected agl(): number {
    const d = this.ctx.drone;
    return d.pos.y - d.gear - Math.max(this.ctx.world.groundAt(d.pos.x, d.pos.z), this.ctx.world.waterLevel ?? -1e9);
  }
  protected hSpeed(): number {
    return Math.hypot(this.ctx.drone.vel.x, this.ctx.drone.vel.z);
  }
  protected place(obj: THREE.Object3D, x: number, z: number, dy = 0) {
    obj.position.set(x, this.ctx.world.groundAt(x, z) + dy, z);
    this.ctx.world.scene.add(obj);
    return obj;
  }
}

export interface MissionDef {
  id: string;
  title: string;
  place: string;
  tagline: string;
  icon: string;
  color: string;
  briefing: string[];
  actionLabel: string;
  recommended: string[];
  world: WorldCfg;
  wind: { toDeg: number; speed: number; gust: number };
  gimbalPitch: number;
  pip: boolean;
  payloadLabel: string;
  payloadUnit: string;
  /** Осадки (задаются выбором погоды). */
  precip?: "rain" | "snow";
  /** Множитель расхода батареи: в дождь и мороз аккумулятор садится быстрее. */
  drain?: number;
  /** Упражнение «Курса пилота». */
  course?: boolean;
  /** Режим полёта, в котором начинается упражнение. */
  startMode?: FlightMode;
  create(ctx: Ctx): Mission;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const BASE_FLAT = { x: 0, z: 0, rx: 16, rz: 16 };

const SUMMER: Palette = {
  groundA: 0x4a5a2a, groundB: 0x6e6b3a, shore: 0x8a7d60, tree: 0x2a4628, treeVar: 0x3d5a2a, water: 0x1d3a4a,
  skyTop: 0x2f6db5, skyBottom: 0xb4cfe6, fog: 0xa9c3d8, fogDensity: 0.0009,
  sun: 0xfff1dc, sunIntensity: 3.2, ambient: 0xa8c4e8, ambientIntensity: 0.9, sunDir: [0.45, 0.75, 0.35],
  clouds: 0.42, exposure: 0.95, hdr: "rooitou_park_1k.hdr", grassTint: [0.86, 0.9, 0.74],
};
const HAZE: Palette = {
  ...SUMMER, groundB: 0x7a6a3c, skyTop: 0x7a8aa0, skyBottom: 0xd2a77a, fog: 0xb99a7a, fogDensity: 0.0018,
  sun: 0xffb070, sunIntensity: 2.8, ambient: 0xc8a888, ambientIntensity: 0.8, sunDir: [-0.55, 0.42, 0.4],
  clouds: 0.25, exposure: 1.0, hdr: "venice_sunset_1k.hdr", grassTint: [1.0, 0.9, 0.6],
};
const DUSK_FOG: Palette = {
  groundA: 0x34452a, groundB: 0x464a30, shore: 0x6d6a58, tree: 0x1f3a28, treeVar: 0x2a4028, water: 0x18303c,
  skyTop: 0x3c4652, skyBottom: 0x7d8790, fog: 0x6f7880, fogDensity: 0.0066,
  sun: 0xffc89a, sunIntensity: 1.0, ambient: 0x8a96a8, ambientIntensity: 1.0, sunDir: [0.6, 0.14, -0.5],
  clouds: 0.85, exposure: 1.25, hdr: "kiara_1_dawn_1k.hdr", grassTint: [0.72, 0.8, 0.66],
};
const WINTER: Palette = {
  groundA: 0xdfe6ee, groundB: 0xc6d2df, shore: 0x9aa6b2, tree: 0x1f3a2e, treeVar: 0x2a4636, water: 0x16262f,
  skyTop: 0x6d86a3, skyBottom: 0xd3dde8, fog: 0xc8d3df, fogDensity: 0.0024,
  sun: 0xfff4e8, sunIntensity: 2.4, ambient: 0xc8d8f0, ambientIntensity: 1.0, sunDir: [0.3, 0.28, 0.65],
  clouds: 0.7, exposure: 0.82, snow: true, hdr: "forest_slope_1k.hdr",
};
const OVERCAST: Palette = {
  ...SUMMER, skyTop: 0x6f7f90, skyBottom: 0xbcc5ce, fog: 0xb0bac4, fogDensity: 0.0014,
  sun: 0xf2f2f2, sunIntensity: 2.6, ambient: 0xc0cad6, ambientIntensity: 1.1, sunDir: [-0.3, 0.75, -0.25],
  clouds: 0.88, exposure: 1.05, hdr: "forest_slope_1k.hdr", grassTint: [0.8, 0.86, 0.72],
};

// ───────────────────────────── 1. Учебный полигон ─────────────────────────────

const GATES: [number, number, number][] = [
  [0, 10, -55], [45, 16, -125], [115, 24, -150], [165, 14, -75], [115, 9, 0], [45, 8, 35],
];

class TrainingMission extends Mission {
  private rings: THREE.Mesh[] = [];
  private next = 0;
  constructor(ctx: Ctx) {
    super(ctx);
    GATES.forEach(([x, h, z], i) => {
      const ring = makeRing(5, 0x00aaff);
      const [nx, , nz] = GATES[Math.min(i + 1, GATES.length - 1)];
      const [px, , pz] = i > 0 ? GATES[i - 1] : [0, 0, 0];
      ring.position.set(x, ctx.world.groundAt(x, z) + h, z);
      ring.rotation.y = Math.atan2(nx - px, nz - pz);
      ctx.world.scene.add(ring);
      this.rings.push(ring);
    });
    this.paint();
    ctx.say("Взлёт: W. Пройдите кольца по порядку — следующее подсвечено жёлтым", "info");
  }
  private paint() {
    this.rings.forEach((r, i) => {
      const m = r.material as THREE.MeshBasicMaterial;
      m.color.set(i === this.next ? 0xffd700 : 0x00aaff);
      m.opacity = i < this.next ? 0.12 : i === this.next ? 0.95 : 0.45;
    });
  }
  update(dt: number) {
    this.time += dt;
    const ring = this.rings[this.next];
    if (ring && ring.position.distanceTo(this.ctx.drone.pos) < 5.2) {
      this.next++;
      this.paint();
      if (this.next >= this.rings.length) {
        this.tasksDone = true;
        this.ctx.say("Маршрут пройден! Возвращайтесь на площадку", "good");
      } else this.ctx.say(`Кольцо ${this.next} из ${this.rings.length}`, "good");
    }
  }
  objectives(): Objective[] {
    return [{ text: "Пройти контрольные кольца", done: this.tasksDone, progress: `${this.next}/${this.rings.length}` }];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 110) / 2.5, 20, 100),
      rows: [["Колец пройдено", `${this.next}/${this.rings.length}`], ["Время", fmtTime(this.time)]] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    this.rings.forEach((r, i) => { if (i >= this.next) m.dot(r.position.x, r.position.z, i === this.next ? "#ffd700" : "#00aaff", i === this.next ? 5 : 3); });
  }
}

// ───────────────────────────── 2. Лесной пожар ─────────────────────────────

const VILLAGE = { x: 250, z: -430 };

class FireMission extends Mission {
  private cs = 14; private nx = 40; private nz = 28; private x0 = -120; private z0 = -620;
  private state: Uint8Array; // 0 пусто, 1 лес, 2 горит, 3 выгорело, 4 потушено
  private inten: Float32Array; private age: Float32Array; private life: Float32Array; private wet: Float32Array;
  private cellTrees: number[][] = [];
  private acc = 0; private heat = 0; private burning = 0; private lost = 0; private dropped = 0;
  private spread: number; private pumpSaid = 0;
  private glow: THREE.PointLight;
  private flames: FlameField;
  private curtain: THREE.Mesh;
  private curtainTex: THREE.CanvasTexture;
  private smolder: Float32Array;
  private hitMass = 0; private hitSaid = -10; private outSaid = -10;

  constructor(ctx: Ctx) {
    super(ctx);
    const n = this.nx * this.nz;
    this.smolder = new Float32Array(n);
    this.state = new Uint8Array(n); this.inten = new Float32Array(n); this.age = new Float32Array(n);
    this.life = new Float32Array(n); this.wet = new Float32Array(n);
    for (let i = 0; i < n; i++) this.cellTrees.push([]);
    const w = ctx.world;
    for (let i = 0; i < w.treeCount; i++) {
      const c = this.cellAt(w.treeX[i], w.treeZ[i]);
      if (c >= 0) { this.cellTrees[c].push(i); this.state[c] = 1; }
    }
    this.spread = { cadet: 0.7, pilot: 1, ace: 1.3 }[ctx.difficulty];
    const fuel: number[] = [];
    for (let c = 0; c < n; c++) if (this.state[c] === 1) fuel.push(c);
    fuel.sort((p, q) => Math.hypot(this.cx(p) - 40, this.cz(p) + 420) - Math.hypot(this.cx(q) - 40, this.cz(q) + 420));
    for (const c of fuel.slice(0, 6)) this.ignite(c, 0.9);
    this.burning = 6;
    // завеса падающей воды: конус с бегущими вниз струями
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 256;
    const g2 = cv.getContext("2d")!;
    const r2 = mulberry32(5);
    for (let i = 0; i < 140; i++) {
      const x = r2() * 128, y = r2() * 256, len = 20 + r2() * 70;
      const gr = g2.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, `rgba(235,245,255,${0.35 + r2() * 0.5})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      g2.fillStyle = gr; g2.fillRect(x, y, 1 + r2() * 2.5, len);
      if (y + len > 256) g2.fillRect(x, y - 256, 1.5, len);
    }
    this.curtainTex = ctx.world.track(new THREE.CanvasTexture(cv));
    this.curtainTex.wrapS = this.curtainTex.wrapT = THREE.RepeatWrapping;
    this.curtainTex.repeat.set(3, 1);
    const cg = new THREE.CylinderGeometry(0.22, 1, 1, 24, 1, true);
    cg.translate(0, -0.5, 0);
    this.curtain = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
      map: this.curtainTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xdfeeff, opacity: 0.9,
    }));
    this.curtain.visible = false;
    this.curtain.renderOrder = 4;
    ctx.world.scene.add(this.curtain);
    this.flames = new FlameField(ctx.world.scene, this.nx * this.nz * 8);
    this.glow = new THREE.PointLight(0xff7a2a, 0, 110, 1.6);
    this.glow.position.set(40, ctx.world.groundAt(40, -420) + 8, -420);
    ctx.world.scene.add(this.glow);
    this.capacity = ctx.af.payloadMax;
    this.amount = this.capacity;

    const rnd = mulberry32(8);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28, r = 16 + rnd() * 22;
      const h = makeHouse(rnd, false);
      h.rotation.y = rnd() * 3;
      this.place(h, VILLAGE.x + Math.cos(a) * r, VILLAGE.z + Math.sin(a) * r);
      w.addThermal(h, 0.2);
    }
    ctx.say("Очаг — на севере за рекой. Сброс воды: ПРОБЕЛ. Забор воды: зависните низко над рекой", "info");
  }

  private cellAt(x: number, z: number): number {
    const ix = Math.floor((x - this.x0) / this.cs), iz = Math.floor((z - this.z0) / this.cs);
    return ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ? -1 : iz * this.nx + ix;
  }
  private cx(c: number) { return this.x0 + ((c % this.nx) + 0.5) * this.cs; }
  private cz(c: number) { return this.z0 + (Math.floor(c / this.nx) + 0.5) * this.cs; }

  private ignite(c: number, inten = 0.25) {
    if (this.state[c] !== 1) return;
    this.state[c] = 2; this.inten[c] = inten; this.age[c] = 0;
    this.life[c] = 85 + this.ctx.rnd() * 50;
    for (const t of this.cellTrees[c]) this.ctx.world.tintTree(t, 0.35, 1);
  }

  /** Белый пар/брызги: цвет делится на освещённость системы частиц, иначе в закатном свете он рыжий. */
  private white(p: Particles, k: number): [number, number, number] {
    const t = p.tint;
    return [k / Math.max(0.25, t.r), k / Math.max(0.25, t.g), k / Math.max(0.25, t.b)];
  }

  private steam(x: number, z: number, n: number, big: number) {
    const { fx, world, rnd } = this.ctx;
    const [r, g, b] = this.white(fx.smoke, 0.92);
    const y = world.groundAt(x, z);
    for (let i = 0; i < n; i++) {
      fx.smoke.spawn(x + (rnd() - 0.5) * 6, y + 1 + rnd() * 3, z + (rnd() - 0.5) * 6,
        (rnd() - 0.5) * 2.5, 4 + rnd() * 5 * big, (rnd() - 0.5) * 2.5, 2.5 + rnd() * 3 * big, (2.5 + rnd() * 3) * big, r, g, b, 0.6);
    }
  }

  private splash(x: number, z: number, mass: number) {
    const c = this.cellAt(x, z);
    const { fx, world, rnd } = this.ctx;
    if (c >= 0 && this.state[c] === 2) {
      // вода на огне: шипящий пар, пламя слабеет
      this.inten[c] -= mass / 2.2;
      this.hitMass += mass;
      if (rnd() < 0.55) this.steam(x, z, 1, 1);
      if (this.time - this.hitSaid > 5) { this.hitSaid = this.time; this.ctx.say("Попадание! Пламя сбивается", "good"); }
      if (this.inten[c] <= 0) {
        this.state[c] = 4; this.inten[c] = 0; this.smolder[c] = 30;
        for (const t of this.cellTrees[c]) world.tintTree(t, 0.6, 0);
        world.scorch(this.cx(c), this.cz(c), this.cs * 0.6, 0.5);
        this.steam(this.cx(c), this.cz(c), 14, 1.6);
        const left = this.state.reduce((a, v) => a + (v === 2 ? 1 : 0), 0);
        if (left > 0 && this.time - this.outSaid > 3) { this.outSaid = this.time; this.ctx.say(`Квадрат потушен, горит ещё ${left}`, "good"); }
      }
      return;
    }
    if (c >= 0 && this.state[c] === 1) this.wet[c] = Math.min(1.6, this.wet[c] + mass / 2);
    // брызги о землю/кроны
    if (rnd() < 0.3) {
      const [r, g, b] = this.white(fx.water, 0.95);
      const y = Math.max(world.groundAt(x, z), world.waterLevel ?? -1e9);
      for (let i = 0; i < 3; i++) fx.water.spawn(x, y + 0.3, z, (rnd() - 0.5) * 5, 2 + rnd() * 3, (rnd() - 0.5) * 5, 0.7, 0.6 + rnd() * 0.6, r, g, b, 0.55);
    }
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone, world, fx, af } = this.ctx;
    const windTo = Math.atan2(drone.windNow.x, -drone.windNow.z);
    const wx = Math.sin(windTo), wz = -Math.cos(windTo);

    // распространение
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.acc -= 0.5;
      let burning = 0, lost = 0, threat = false;
      for (let c = 0; c < this.state.length; c++) {
        const s = this.state[c];
        if (this.wet[c] > 0) this.wet[c] = Math.max(0, this.wet[c] - 0.5 / 100);
        if (s >= 2) lost++;
        if (s !== 2) continue;
        burning++;
        this.age[c] += 0.5;
        this.inten[c] = Math.min(1, this.inten[c] + 0.03);
        if (this.age[c] > this.life[c]) {
          this.state[c] = 3; this.inten[c] = 0;
          for (const t of this.cellTrees[c]) world.tintTree(t, 1, 0);
          world.scorch(this.cx(c), this.cz(c), this.cs * 0.75, 0.85);
          continue;
        }
        if (Math.hypot(this.cx(c) - VILLAGE.x, this.cz(c) - VILLAGE.z) < 64) threat = true;
        const ix = c % this.nx, iz = Math.floor(c / this.nx);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          const j = jz * this.nx + jx;
          if (this.state[j] !== 1) continue;
          const len = Math.hypot(dx, dz);
          const dot = (dx * wx + dz * wz) / len;
          const p = (0.5 / 180) * this.spread * this.inten[c] * Math.exp(1.0 * dot) * (len > 1 ? 0.55 : 1) * Math.max(0, 1 - this.wet[j]);
          if (this.ctx.rnd() < p) this.ignite(j);
        }
      }
      this.burning = burning; this.lost = lost;
      if (threat) this.failed = "Огонь дошёл до посёлка";
      else if (lost > 150) this.failed = "Пожар вышел из-под контроля";
      else if (burning === 0 && !this.tasksDone) {
        this.tasksDone = true;
        this.ctx.say("Пожар ликвидирован! Возвращайтесь на базу", "good");
      }
    }

    // отсвет пламени: свет в центре горящей кромки, мерцает
    let gx = 0, gz = 0, gi = 0;
    for (let c = 0; c < this.state.length; c++) if (this.state[c] === 2) { gx += this.cx(c) * this.inten[c]; gz += this.cz(c) * this.inten[c]; gi += this.inten[c]; }
    if (gi > 0) {
      gx /= gi; gz /= gi;
      this.glow.position.x += (gx - this.glow.position.x) * Math.min(1, dt);
      this.glow.position.z += (gz - this.glow.position.z) * Math.min(1, dt);
      this.glow.position.y = world.groundAt(this.glow.position.x, this.glow.position.z) + 9;
    }
    this.glow.intensity = Math.min(1, gi / 8) * 120 * (0.85 + 0.15 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3));

    // пламя и дым
    this.flames.begin();
    for (let c = 0; c < this.state.length; c++) {
      if (this.state[c] !== 2) continue;
      const I = this.inten[c];
      // низовой огонь: языки пламени на постоянных местах клетки, их высота дышит и зависит от силы горения
      for (let k = 0; k < 5; k++) {
        const h1 = Math.sin(c * 12.9898 + k * 78.233) * 43758.5453, r1 = h1 - Math.floor(h1);
        const h2 = Math.sin(c * 39.346 + k * 11.135) * 24634.6345, r2 = h2 - Math.floor(h2);
        const x = this.cx(c) + (r1 - 0.5) * this.cs * 0.9, z = this.cz(c) + (r2 - 0.5) * this.cs * 0.9;
        const breath = 0.8 + 0.2 * Math.sin(this.time * (2 + r1 * 3) + k);
        this.flames.add(x, world.groundAt(x, z) - 0.2, z, (2.5 + r2 * 2.5) * (0.5 + 0.5 * I), (2.5 + r1 * 4) * (0.3 + 0.7 * I) * breath, I);
      }
      // верховой огонь: горящие кроны деревьев
      const trees = this.cellTrees[c];
      for (let k = 0; k < Math.min(3, trees.length); k++) {
        const t = trees[(k * 7) % trees.length];
        if (!world.treeAlive[t] || I < 0.35) continue;
        const h = world.treeH[t];
        this.flames.add(world.treeX[t], world.treeY[t] + h * 0.15, world.treeZ[t], h * 0.35 * I + 1.5, h * (0.75 + 0.15 * Math.sin(this.time * 3 + t)) * I, I);
      }
      // искры и горящие хлопья, которые уносит потоком
      if (this.ctx.rnd() < I * 9 * dt) {
        const x = this.cx(c) + (this.ctx.rnd() - 0.5) * this.cs, z = this.cz(c) + (this.ctx.rnd() - 0.5) * this.cs;
        fx.fire.spawn(x, world.groundAt(x, z) + 2 + this.ctx.rnd() * 8 * I, z, wx * 2 + (this.ctx.rnd() - 0.5) * 3, 5 + this.ctx.rnd() * 7, wz * 2 + (this.ctx.rnd() - 0.5) * 3,
          1.2 + this.ctx.rnd() * 1.4, 0.25 + this.ctx.rnd() * 0.35, 1, 1, 1, 0.9);
      }
      if (this.ctx.rnd() < I * 2.6 * dt) {
        const x = this.cx(c) + (this.ctx.rnd() - 0.5) * this.cs, z = this.cz(c) + (this.ctx.rnd() - 0.5) * this.cs;
        const g = 0.16 + this.ctx.rnd() * 0.22;
        fx.smoke.spawn(x, world.groundAt(x, z) + 8, z, 0, 4 + this.ctx.rnd() * 2, 0, 12 + this.ctx.rnd() * 6, 9 + this.ctx.rnd() * 5, g * 1.05, g, g * 0.92, 0.42);
      }
    }

    this.flames.end(dt, this.ctx.camPos());

    // тлеющие потушенные квадраты: тонкий светлый дымок
    for (let c = 0; c < this.state.length; c++) {
      if (this.smolder[c] <= 0) continue;
      this.smolder[c] -= dt;
      if (this.ctx.rnd() < 1.2 * dt * (this.smolder[c] / 30)) {
        const x = this.cx(c) + (this.ctx.rnd() - 0.5) * this.cs, z = this.cz(c) + (this.ctx.rnd() - 0.5) * this.cs;
        const g = 0.45 + this.ctx.rnd() * 0.2;
        fx.smoke.spawn(x, world.groundAt(x, z) + 1, z, 0, 1.5 + this.ctx.rnd(), 0, 8, 2.5, g, g, g, 0.3);
      }
    }

    // сброс и забор воды
    const dropping = action.held && this.amount > 0 && !drone.landed;
    this.curtain.visible = dropping;
    if (dropping) {
      const top = drone.pos.y - drone.gear * 0.7;
      const len = Math.max(1, top - Math.max(world.groundAt(drone.pos.x, drone.pos.z), world.waterLevel ?? -1e9));
      // конус расширяется книзу и сносится скоростью аппарата и ветром
      const tilt = new THREE.Vector3(drone.vel.x * 0.5 + drone.windNow.x * 0.3, -len, drone.vel.z * 0.5 + drone.windNow.z * 0.3);
      this.curtain.position.set(drone.pos.x, top, drone.pos.z);
      this.curtain.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tilt.clone().normalize());
      const spread = 0.35 + af.arm * 0.5;
      this.curtain.scale.set(spread * 2 + len * 0.1, tilt.length(), spread * 2 + len * 0.1);
      this.curtainTex.offset.y = (this.curtainTex.offset.y + dt * 2.2) % 1;
    }
    if (dropping) {
      const rate = af.pumpRate * 1.2;
      const dm = Math.min(this.amount, rate * dt);
      this.amount -= dm; this.dropped += dm;
      // плотная струя из сливного клапана, которая ниже рассыпается на капли
      const k = Math.max(3, Math.round(260 * dt));
      const [r, g, b] = this.white(fx.water, 0.9);
      const spread = 0.6 + af.arm * 0.6;
      for (let i = 0; i < k; i++) {
        const a = this.ctx.rnd() * 6.283, rr = Math.sqrt(this.ctx.rnd()) * spread;
        fx.water.spawn(drone.pos.x + Math.cos(a) * rr * 0.4, drone.pos.y - drone.gear * 0.7, drone.pos.z + Math.sin(a) * rr * 0.4,
          drone.vel.x + Math.cos(a) * rr * 2.2, drone.vel.y - 3 - this.ctx.rnd() * 2, drone.vel.z + Math.sin(a) * rr * 2.2,
          10, 0.8 + this.ctx.rnd() * 1.0, r, g, b, 0.9, dm / k);
      }
    } else if (action.pressed && this.amount <= 0) this.ctx.say("Бак пуст — заберите воду из реки или сядьте на базу", "warn");

    if (world.isWater(drone.pos.x, drone.pos.z) && this.agl() < 5.5 && this.hSpeed() < 4 && this.amount < this.capacity) {
      this.amount = Math.min(this.capacity, this.amount + af.pumpRate * dt);
      if (this.time - this.pumpSaid > 6) { this.ctx.say("Забор воды…", "info"); this.pumpSaid = this.time; }
      // бурун от заборного шланга
      const [r, g, b] = this.white(fx.water, 0.95);
      const wl = world.waterLevel ?? 0;
      for (let i = 0; i < Math.round(40 * dt) + 1; i++) {
        const a = this.ctx.rnd() * 6.283;
        fx.water.spawn(drone.pos.x, wl + 0.2, drone.pos.z, Math.cos(a) * 3, 1.5 + this.ctx.rnd() * 2, Math.sin(a) * 3, 0.6, 0.5 + this.ctx.rnd() * 0.5, r, g, b, 0.6);
      }
      if (this.amount >= this.capacity) this.ctx.say("Бак полон", "good");
    }
    drone.payload = this.amount;

    // перегрев над очагом
    const c = this.cellAt(drone.pos.x, drone.pos.z);
    if (c >= 0 && this.state[c] === 2 && this.inten[c] > 0.35 && this.agl() < 11) {
      if (this.heat === 0) this.ctx.say("ПЕРЕГРЕВ! Набирайте высоту — над огнём ниже 12 м нельзя", "warn");
      this.heat += dt;
      if (this.heat > 3.5) drone.crashed = "Аппарат сгорел над очагом";
    } else this.heat = Math.max(0, this.heat - dt * 2);
  }

  // брызги и пар несут нулевую массу — они не тушат и не порождают новых брызг
  onWaterHit(x: number, z: number, mass: number) { if (mass > 0) this.splash(x, z, mass); }

  dispose() { this.flames.dispose(); }

  extraWind(p: THREE.Vector3, out: THREE.Vector3) {
    const c = this.cellAt(p.x, p.z);
    if (c < 0 || this.state[c] !== 2) return;
    const h = p.y - this.ctx.world.groundAt(p.x, p.z);
    if (h > 60) return;
    const I = this.inten[c] * (1 - h / 60);
    out.y += 4 * I;
    out.x += Math.sin(this.time * 6.1) * 1.8 * I;
    out.z += Math.cos(this.time * 4.7) * 1.8 * I;
  }

  objectives(): Objective[] {
    return [
      { text: "Потушить все очаги", done: this.tasksDone, progress: `горит ${this.burning} кв.` },
      { text: "Не допустить огонь к посёлку", done: this.tasksDone },
    ];
  }
  summary() {
    const ha = (this.lost * this.cs * this.cs) / 10000;
    return {
      score: clamp(100 - Math.max(0, this.lost - 8) * 0.75 - Math.max(0, this.time - 300) / 15, 10, 100),
      rows: [
        ["Пройдено огнём", `${ha.toFixed(1)} га`], ["Сброшено воды", `${this.dropped.toFixed(0)} л`],
        ["Попаданий по огню", `${this.dropped > 0 ? Math.min(100, Math.round((this.hitMass / this.dropped) * 100)) : 0}%`], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    const h = this.cs / 2;
    for (let c = 0; c < this.state.length; c++) {
      const s = this.state[c];
      if (s < 2) continue;
      const x = this.cx(c), z = this.cz(c);
      m.rect(x - h, z - h, x + h, z + h, s === 2 ? "#ff6a10" : s === 3 ? "#3a2f2a" : "#4f7d99", true);
    }
    m.ring(VILLAGE.x, VILLAGE.z, 45, "#ffd700");
    m.dot(VILLAGE.x, VILLAGE.z, "#ffd700", 4);
  }
}

// ───────────────────────────── 3. Поиск людей ─────────────────────────────

interface Target { x: number; z: number; y: number; seen: number; found: boolean; supplied: boolean; hx: number; hz: number; label: string }

class SearchMission extends Mission {
  private people: Target[] = [];
  private decoys: Target[] = [];
  private parcels: { mesh: THREE.Group; vel: THREE.Vector3 }[] = [];
  private wasted = 0;
  private scratch: number[] = [];

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    const spot = (a0: number, a1: number, d0: number, d1: number): [number, number] => {
      for (let k = 0; k < 40; k++) {
        const a = ((a0 + rnd() * (a1 - a0)) * Math.PI) / 180, d = d0 + rnd() * (d1 - d0);
        const x = d * Math.sin(a), z = -d * Math.cos(a);
        if (world.groundAt(x, z) > 1.2) return [x, z];
      }
      return [0, -d0];
    };
    const clear = (x: number, z: number, r: number) => {
      for (const i of world.treesNear(x, z, r, this.scratch)) {
        if (Math.hypot(world.treeX[i] - x, world.treeZ[i] - z) < r) world.removeTree(i);
      }
    };
    const jackets = [0xd94a2b, 0x2b6fd9, 0xd9b02b];
    for (let i = 0; i < 3; i++) {
      const [x, z] = spot(-72 + i * 48, -72 + (i + 1) * 48, 240, 480);
      clear(x, z, 3.5);
      const p = makePerson(jackets[i]);
      if (i === 1) { p.rotation.z = Math.PI / 2; p.position.y = 0.3; }
      this.place(p, x, z, i === 1 ? 0.3 : 0);
      world.addThermal(p, 1);
      const ha = rnd() * 6.28, hd = rnd() * 70;
      this.people.push({ x, z, y: p.position.y, seen: 0, found: false, supplied: false, hx: x + Math.cos(ha) * hd, hz: z + Math.sin(ha) * hd, label: `Человек ${i + 1}` });
    }
    const kinds: ("moose" | "bear")[] = ["moose", "bear", "moose"];
    kinds.forEach((kind) => {
      const [x, z] = spot(-80, 80, 150, 520);
      clear(x, z, 4);
      const a = makeAnimal(kind);
      a.rotation.y = rnd() * 6;
      this.place(a, x, z);
      world.addThermal(a, 0.85);
      this.decoys.push({ x, z, y: a.position.y, seen: 0, found: false, supplied: false, hx: 0, hz: 0, label: kind === "moose" ? "лось" : "медведь" });
    });
    const [fx, fz] = spot(-60, 60, 200, 420);
    clear(fx, fz, 5);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a22 }));
    this.place(ember, fx, fz, 0.2);
    world.addThermal(ember, 1);
    this.decoys.push({ x: fx, z: fz, y: ember.position.y, seen: 0, found: false, supplied: false, hx: 0, hz: 0, label: "брошенное кострище" });

    this.capacity = 4; this.amount = 4;
    ctx.say("Тепловизор: T. Ищите людей в жёлтых секторах, затем сбросьте набор: ПРОБЕЛ", "info");
  }

  private scan(t: Target, dt: number, dir: THREE.Vector3): boolean {
    if (t.found) return false;
    const d = this.ctx.drone.pos;
    const dx = t.x - d.x, dy = t.y + 1 - d.y, dz = t.z - d.z;
    const dist = Math.hypot(dx, dy, dz);
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(1, dist);
    const visible = cos > 0.93 && (this.ctx.thermal() ? dist < 100 : dist < 32);
    t.seen = visible ? t.seen + dt : Math.max(0, t.seen - dt);
    if (t.seen > 1.2) { t.found = true; return true; }
    return false;
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone, world } = this.ctx;
    const dir = this.ctx.camDir();
    for (const p of this.people) {
      if (this.scan(p, dt, dir)) {
        this.ctx.say(`${p.label} обнаружен! Сбросьте аварийный набор рядом`, "good");
        const beam = makeBeam(0x00ffaa, 70, 1.2);
        beam.position.set(p.x, p.y + 35, p.z);
        world.scene.add(beam);
      }
    }
    for (const a of this.decoys) if (this.scan(a, dt, dir)) this.ctx.say(`Ложная цель: ${a.label}`, "warn");

    if (action.pressed && !drone.landed) {
      if (this.amount <= 0) this.ctx.say("Наборы закончились — пополните на базе", "warn");
      else {
        this.amount--;
        const g = new THREE.Group();
        const boxM = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 }));
        const chute = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.6, 10, 1, true),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
        chute.position.y = 1.3;
        g.add(boxM, chute);
        g.position.copy(drone.pos).y -= 0.5;
        world.scene.add(g);
        this.parcels.push({ mesh: g, vel: drone.vel.clone() });
      }
    }
    for (let i = this.parcels.length - 1; i >= 0; i--) {
      const p = this.parcels[i];
      p.vel.x += (drone.windNow.x * 0.6 - p.vel.x) * Math.min(1, 1.5 * dt);
      p.vel.z += (drone.windNow.z * 0.6 - p.vel.z) * Math.min(1, 1.5 * dt);
      p.vel.y += (-4.5 - p.vel.y) * Math.min(1, 2 * dt);
      p.mesh.position.addScaledVector(p.vel, dt);
      const gh = world.groundAt(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y <= gh + 0.15) {
        p.mesh.position.y = gh + 0.15;
        p.mesh.children[1].visible = false;
        this.parcels.splice(i, 1);
        let best: Target | null = null, bd = 1e9;
        for (const t of this.people) {
          const d = Math.hypot(t.x - p.mesh.position.x, t.z - p.mesh.position.z);
          if (!t.supplied && d < bd) { bd = d; best = t; }
        }
        if (best && bd < 15) {
          best.supplied = true; best.found = true;
          this.ctx.say(`${best.label}: набор доставлен (${bd.toFixed(0)} м). Координаты переданы спасателям`, "good");
        } else {
          this.wasted++;
          this.ctx.say(best && bd < 80 ? `Мимо: до человека ${bd.toFixed(0)} м` : "Набор сброшен впустую", "warn");
        }
      }
    }
    drone.payload = this.amount * 0.4;
    if (!this.tasksDone && this.people.every((p) => p.supplied)) {
      this.tasksDone = true;
      this.ctx.say("Все найдены! Возвращайтесь на базу", "good");
    }
  }

  objectives(): Objective[] {
    const found = this.people.filter((p) => p.found).length, sup = this.people.filter((p) => p.supplied).length;
    return [
      { text: "Обнаружить пропавших", done: found === 3, progress: `${found}/3` },
      { text: "Сбросить аварийные наборы", done: sup === 3, progress: `${sup}/3` },
    ];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 330) / 7 - this.wasted * 8, 10, 100),
      rows: [
        ["Найдено людей", `${this.people.filter((p) => p.found).length}/3`],
        ["Наборов сброшено мимо", String(this.wasted)], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    for (const p of this.people) {
      if (p.supplied) m.dot(p.x, p.z, "#00ffaa", 4);
      else if (p.found) { m.dot(p.x, p.z, "#ff4444", 5); m.ring(p.x, p.z, 15, "#ff4444"); }
      else m.ring(p.hx, p.hz, 110, "#ffd700");
    }
    for (const a of this.decoys) if (a.found) m.dot(a.x, a.z, "#888888", 3);
  }
}

// ───────────────────────────── 4. Агромиссия ─────────────────────────────

const FIELD = { x: 0, z: -150, hx: 70, hz: 40 };

class AgroMission extends Mission {
  private cs = 2.5; private nx: number; private nz: number;
  private dose: Uint8Array; private stamp: Float32Array;
  private canvas: HTMLCanvasElement; private g2: CanvasRenderingContext2D; private tex: THREE.CanvasTexture;
  private dirty = false; private texAcc = 0;
  private covered = 0; private over = 0; private off = 0; private buffer = 0; private used = 0; private warnT = -10;
  private px = 8;
  protected F: { x: number; z: number; hx: number; hz: number };
  protected crop: boolean;

  constructor(ctx: Ctx, area = FIELD, crop = true) {
    super(ctx);
    this.F = area; this.crop = crop;
    this.nx = Math.round((this.F.hx * 2) / this.cs); this.nz = Math.round((this.F.hz * 2) / this.cs);
    this.dose = new Uint8Array(this.nx * this.nz);
    this.stamp = new Float32Array(this.nx * this.nz).fill(-100);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.nx * this.px; this.canvas.height = this.nz * this.px;
    this.g2 = this.canvas.getContext("2d")!;
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.paintCell(ix, iz);
    this.tex = ctx.world.track(new THREE.CanvasTexture(this.canvas));
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(this.F.hx * 2, this.F.hz * 2);
    geo.rotateX(-Math.PI / 2);
    // поле — посевы на текстуре; без посевов (лужайки, тропы) — полупрозрачная карта обработки поверх травы
    const mesh = new THREE.Mesh(geo, this.crop
      ? new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.receiveShadow = true;
    this.place(mesh, this.F.x, this.F.z, 0.12);
    ctx.world.addThermal(mesh, 0.14);
    this.capacity = ctx.af.payloadMax; this.amount = this.capacity;
    ctx.say(`Опрыскивание: ПРОБЕЛ. Высота 2–5 м, скорость ограничивается до 7 м/с, ширина захвата ${ctx.af.sprayWidth} м`, "info");
  }

  private paintCell(ix: number, iz: number) {
    const d = this.dose[iz * this.nx + ix], p = this.px, g = this.g2;
    if (!this.crop) {
      g.clearRect(ix * p, iz * p, p, p);
      if (d > 0) { g.fillStyle = d === 1 ? "rgba(70,140,220,0.32)" : "rgba(220,90,40,0.42)"; g.fillRect(ix * p, iz * p, p, p); }
      return;
    }
    // междурядья — земля, ряды — ботва; обработанная ботва темнее и блестит, передоз — желтеет
    g.fillStyle = "#4a3a28";
    g.fillRect(ix * p, iz * p, p, p);
    const leaf = d === 0 ? ["#5d7a2c", "#6f8a34"] : d === 1 ? ["#2f5a2c", "#3f6e38"] : ["#8a7a2c", "#a08c3a"];
    g.fillStyle = leaf[0]; g.fillRect(ix * p, iz * p + 1, p, 3);
    g.fillStyle = leaf[1]; g.fillRect(ix * p + ((ix * 7 + iz * 3) % 3), iz * p + 1, 3, 2);
    g.fillStyle = leaf[0]; g.fillRect(ix * p, iz * p + 5, p, 2);
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone, world, af, fx } = this.ctx;
    if (action.pressed && this.amount <= 0) this.ctx.say("Бак пуст — сядьте на базу для заправки", "warn");
    // при включённых форсунках автопилот держит рабочую скорость
    drone.speedLimit = action.held && this.amount > 0 ? 7 : Infinity;
    if (action.held && this.amount > 0 && !drone.landed) {
      const agl = this.agl(), sp = this.hSpeed(), w = af.sprayWidth;
      const flow = 0.001 * w * Math.max(sp, 1.5);
      const used = Math.min(this.amount, flow * dt);
      this.amount -= used; this.used += used;
      const tf = Math.sqrt(Math.max(0, 2 * agl) / 9.81) * 1.5;
      const cx = drone.pos.x + drone.windNow.x * tf * 0.6, cz = drone.pos.z + drone.windNow.z * tf * 0.6;
      const rx = Math.cos(drone.yaw), rz = -Math.sin(drone.yaw);
      for (let i = 0; i < 6; i++) {
        const o = (this.ctx.rnd() - 0.5) * w;
        fx.water.spawn(drone.pos.x + rx * o, drone.pos.y - 0.3, drone.pos.z + rz * o, drone.vel.x * 0.5, -2.5, drone.vel.z * 0.5, 1.6, 0.9, 0.85, 0.95, 1, 0.4, 0);
      }
      const ok = agl <= 6.5 && sp <= 11;
      if (!ok && this.time - this.warnT > 4) {
        this.ctx.say(agl > 6.5 ? "Слишком высоко — препарат сносит ветром" : "Слишком быстро — пропуски в обработке", "warn");
        this.warnT = this.time;
      }
      const inField = Math.abs(cx - this.F.x) < this.F.hx + 1 && Math.abs(cz - this.F.z) < this.F.hz + 1;
      if (!inField || !ok) this.off += used;
      if (world.riverDist(cx, cz) < 32) {
        if (this.buffer === 0) this.ctx.say("НАРУШЕНИЕ: распыление в водоохранной зоне!", "warn");
        this.buffer += used;
      }
      if (ok) {
        const r = w / 2;
        const ix0 = Math.floor((cx - r - this.F.x + this.F.hx) / this.cs), ix1 = Math.floor((cx + r - this.F.x + this.F.hx) / this.cs);
        const iz0 = Math.floor((cz - r - this.F.z + this.F.hz) / this.cs), iz1 = Math.floor((cz + r - this.F.z + this.F.hz) / this.cs);
        for (let iz = Math.max(0, iz0); iz <= Math.min(this.nz - 1, iz1); iz++) {
          for (let ix = Math.max(0, ix0); ix <= Math.min(this.nx - 1, ix1); ix++) {
            const x = this.F.x - this.F.hx + (ix + 0.5) * this.cs, z = this.F.z - this.F.hz + (iz + 0.5) * this.cs;
            if (Math.hypot(x - cx, z - cz) > r) continue;
            const c = iz * this.nx + ix;
            if (this.time - this.stamp[c] > 4 && this.dose[c] < 3) {
              this.dose[c]++;
              if (this.dose[c] === 1) this.covered++;
              if (this.dose[c] === 2) this.over++;
              this.paintCell(ix, iz);
              this.dirty = true;
            }
            this.stamp[c] = this.time;
          }
        }
      }
    }
    this.texAcc += dt;
    if (this.dirty && this.texAcc > 0.2) { this.tex.needsUpdate = true; this.dirty = false; this.texAcc = 0; }
    drone.payload = this.amount;
    if (!this.tasksDone && this.coverage() >= 0.9) {
      this.tasksDone = true;
      this.ctx.say("Поле обработано на 90%! Возвращайтесь на базу", "good");
    }
  }
  private coverage() { return this.covered / this.dose.length; }

  objectives(): Objective[] {
    return [
      { text: "Обработать не менее 90% поля", done: this.tasksDone, progress: `${(this.coverage() * 100).toFixed(0)}%` },
      { text: "Без передозировки и сноса", done: this.over / this.dose.length < 0.1 && this.buffer === 0, progress: `перекрытия ${((this.over / this.dose.length) * 100).toFixed(0)}%` },
    ];
  }
  summary() {
    const overPct = (this.over / this.dose.length) * 100;
    return {
      score: clamp(100 - overPct * 0.9 - this.off * 5 - this.buffer * 25 - Math.max(0, this.time - 420) / 10, 10, 100),
      rows: [
        ["Покрытие", `${(this.coverage() * 100).toFixed(0)}%`], ["Двойная доза", `${overPct.toFixed(0)}%`],
        ["Расход препарата", `${this.used.toFixed(1)} л`], ["Мимо поля", `${this.off.toFixed(1)} л`],
        ["В водоохранной зоне", `${this.buffer.toFixed(2)} л`], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    m.rect(this.F.x - this.F.hx, this.F.z - this.F.hz, this.F.x + this.F.hx, this.F.z + this.F.hz, "#9be05a");
    const step = 4;
    for (let iz = 0; iz < this.nz; iz += step) for (let ix = 0; ix < this.nx; ix += step) {
      let s = 0;
      for (let a = 0; a < step; a++) for (let b = 0; b < step; b++) s += this.dose[(iz + a) * this.nx + ix + b] > 0 ? 1 : 0;
      if (s > step * step * 0.5) {
        const x = this.F.x - this.F.hx + ix * this.cs, z = this.F.z - this.F.hz + iz * this.cs;
        m.rect(x, z, x + step * this.cs, z + step * this.cs, "rgba(47,200,160,0.7)", true);
      }
    }
  }
}

// ───────────────────────────── 5. Доставка медикаментов ─────────────────────────────

const HAMLET = { x: 140, z: -640 };

class DeliveryMission extends Mission {
  private delivered = false; private precision = 0; private timer = 0; private hintT = -10;
  private snow: Particles;
  constructor(ctx: Ctx) {
    super(ctx);
    const pad = makeHelipad("+", "#ff4444");
    this.place(pad, HAMLET.x, HAMLET.z);
    ctx.world.addThermal(pad, 0.3);
    const beam = makeBeam(0xff4444, 120, 2);
    beam.position.set(HAMLET.x, ctx.world.groundAt(HAMLET.x, HAMLET.z) + 60, HAMLET.z);
    beam.name = "beam";
    ctx.world.scene.add(beam);
    const rnd = mulberry32(5);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.28 + 0.3, r = 20 + rnd() * 24;
      const h = makeHouse(rnd, true);
      h.rotation.y = rnd() * 3;
      this.place(h, HAMLET.x + Math.cos(a) * r, HAMLET.z + Math.sin(a) * r);
      ctx.world.addThermal(h, 0.45);
    }
    this.snow = new Particles(ctx.world.scene, { max: 1400, drag: 2.5 });
    this.capacity = 1; this.amount = 1;
    ctx.say("Деревня — 650 м на север за рекой, красный маяк. Сядьте на площадку с крестом", "info");
  }
  update(dt: number) {
    this.time += dt;
    const { drone } = this.ctx;
    drone.payload = this.delivered ? 0 : 1.5;
    const p = drone.pos;
    for (let i = 0; i < Math.round(170 * dt); i++) {
      this.snow.spawn(p.x + (this.ctx.rnd() - 0.5) * 90, p.y + (this.ctx.rnd() - 0.3) * 40, p.z + (this.ctx.rnd() - 0.5) * 90,
        0, -1.6, 0, 7, 0.28, 1, 1, 1, 0.8);
    }
    this.snow.update(dt, drone.windNow);
    if (this.delivered) return;
    const d = Math.hypot(p.x - HAMLET.x, p.z - HAMLET.z);
    if (drone.landed && d < 3.4) {
      this.timer += dt;
      if (this.timer > 1.5) {
        this.delivered = true; this.tasksDone = true; this.amount = 0; this.precision = d;
        const beam = this.ctx.world.scene.getObjectByName("beam");
        if (beam) beam.visible = false;
        this.ctx.say(`Груз передан фельдшеру. Точность посадки ${d.toFixed(1)} м. Возвращайтесь на базу`, "good");
      }
    } else {
      this.timer = 0;
      if (drone.landed && d < 60 && this.time - this.hintT > 5) {
        this.ctx.say(`До центра площадки ${d.toFixed(0)} м — перелетите ближе`, "warn");
        this.hintT = this.time;
      }
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [{ text: "Сесть на площадку ФАП и передать груз", done: this.delivered }];
  }
  summary() {
    return {
      score: clamp(100 - this.precision * 10 - Math.max(0, this.time - 210) / 5, 10, 100),
      rows: [
        ["Точность посадки", this.delivered ? `${this.precision.toFixed(1)} м` : "—"],
        ["Остаток АКБ", `${(this.ctx.drone.soc * 100).toFixed(0)}%`], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) { m.dot(HAMLET.x, HAMLET.z, "#ff4444", 5); m.ring(HAMLET.x, HAMLET.z, 40, "#ff4444"); }
  dispose() { this.snow.dispose(); }
}

// ───────────────────────────── 6. Обследование ЛЭП ─────────────────────────────

const PYLONS: [number, number][] = [0, 1, 2, 3, 4, 5].map((k) => [-90 + 88 * k, -100 - 92 * k + 22 * Math.sin(k * 1.3)]);
const PYLON_H = 26;

class PowerlineMission extends Mission {
  private tops: THREE.Vector3[] = [];
  private shot: boolean[] = PYLONS.map(() => false);
  private defect: number; private defectFound = false; private near = false;
  private segs: Float32Array;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world } = ctx;
    this.defect = 1 + Math.floor(ctx.rnd() * 4);
    const attach: THREE.Vector3[][] = [];
    PYLONS.forEach(([x, z], k) => {
      const [ax, az] = PYLONS[Math.max(0, k - 1)], [bx, bz] = PYLONS[Math.min(PYLONS.length - 1, k + 1)];
      const len = Math.hypot(bx - ax, bz - az);
      const lx = (bz - az) / len, lz = -(bx - ax) / len;
      const py = makePylon(PYLON_H, 4.2);
      py.rotation.y = Math.atan2(-lz, lx);
      this.place(py, x, z);
      world.addThermal(py, 0.2);
      const gy = py.position.y;
      this.tops.push(new THREE.Vector3(x, gy + PYLON_H - 4, z));
      attach.push([-4.2, 0, 4.2].map((o) => new THREE.Vector3(x + lx * o, gy + (o === 0 ? PYLON_H : PYLON_H - 5.5), z + lz * o)));
      for (const o of [-4.2, 4.2]) {
        const hot = k === this.defect && o > 0;
        const s = new THREE.Mesh(new THREE.SphereGeometry(hot ? 0.75 : 0.35, 8, 6),
          new THREE.MeshBasicMaterial({ color: hot ? 0xffffff : 0x5a5a5a, fog: false }));
        s.position.set(x + lx * o, gy + PYLON_H - 4.9, z + lz * o);
        s.layers.set(THERMAL_LAYER);
        world.scene.add(s);
      }
    });
    const pts: number[] = [];
    const SUB = 8;
    for (let k = 0; k < attach.length - 1; k++) {
      for (let w = 0; w < 3; w++) {
        const a = attach[k][w], b = attach[k + 1][w];
        for (let s = 0; s < SUB; s++) {
          for (const t of [s / SUB, (s + 1) / SUB]) {
            pts.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 4 * 2.4 * t * (1 - t), a.z + (b.z - a.z) * t);
          }
        }
      }
    }
    this.segs = Float32Array.from(pts);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.segs, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
    lines.frustumCulled = false;
    world.scene.add(lines);
    const tl = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x555555, fog: false }));
    tl.layers.set(THERMAL_LAYER);
    tl.frustumCulled = false;
    world.scene.add(tl);

    world.colliders.push((p, r) => {
      for (let k = 0; k < PYLONS.length; k++) {
        if (Math.hypot(p.x - PYLONS[k][0], p.z - PYLONS[k][1]) < 1.5 + r * 0.5 && p.y < this.tops[k].y + 4.5) return "Столкновение с опорой ЛЭП";
      }
      const d = this.wireDist(p);
      if (d < 0.3 + r * 0.5) return "Столкновение с проводом ЛЭП";
      if (d < 2.5 && !this.near) { this.near = true; this.ctx.say("Опасное сближение с проводами! Держите дистанцию от 5 м", "warn"); }
      return null;
    });
    ctx.say("Снимок: ПРОБЕЛ (опора в кадре, 5–22 м, зависание). Дефект ищите тепловизором: T", "info");
  }

  private wireDist(p: THREE.Vector3): number {
    const s = this.segs;
    let best = 1e9;
    for (let i = 0; i < s.length; i += 6) {
      const ax = s[i], ay = s[i + 1], az = s[i + 2];
      const dx = s[i + 3] - ax, dy = s[i + 4] - ay, dz = s[i + 5] - az;
      if (Math.abs(p.x - ax) > 30 || Math.abs(p.z - az) > 30) continue;
      const t = clamp(((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
      const d = Math.hypot(p.x - ax - dx * t, p.y - ay - dy * t, p.z - az - dz * t);
      if (d < best) best = d;
    }
    return best;
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone } = this.ctx;
    if (action.pressed && !drone.landed) {
      let k = 0, bd = 1e9;
      this.tops.forEach((t, i) => { const d = t.distanceTo(drone.pos); if (d < bd) { bd = d; k = i; } });
      const dir = this.ctx.camDir();
      const to = this.tops[k].clone().sub(drone.pos).normalize();
      if (bd > 22) this.ctx.say(`Далеко: до опоры ${bd.toFixed(0)} м (нужно 5–22 м)`, "warn");
      else if (bd < 5) this.ctx.say("Слишком близко к опоре", "warn");
      else if (to.dot(dir) < 0.9) this.ctx.say("Опора не в кадре — разверните нос на траверсу", "warn");
      else if (blurred(this.ctx, bd)) this.ctx.say("Смаз: притормозите перед съёмкой", "warn");
      else {
        const first = !this.shot[k];
        this.shot[k] = true;
        if (this.ctx.thermal()) {
          if (k === this.defect) {
            if (!this.defectFound) this.ctx.say(`Опора №${k + 1}: ПЕРЕГРЕВ контактного соединения! Дефект зафиксирован`, "good");
            this.defectFound = true;
          } else this.ctx.say(`Опора №${k + 1}: термограмма в норме`, first ? "good" : "info");
        } else this.ctx.say(`Опора №${k + 1}: ${first ? "снимок сохранён" : "повторный снимок"}`, first ? "good" : "info");
        if (!this.tasksDone && this.defectFound && this.shot.every(Boolean)) {
          this.tasksDone = true;
          this.ctx.say("Обследование завершено! Возвращайтесь на базу", "good");
        }
      }
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    const n = this.shot.filter(Boolean).length;
    return [
      { text: "Сфотографировать траверсы всех опор", done: n === PYLONS.length, progress: `${n}/${PYLONS.length}` },
      { text: "Найти перегрев тепловизором", done: this.defectFound },
    ];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 320) / 6 - (this.near ? 12 : 0), 10, 100),
      rows: [
        ["Опор обследовано", `${this.shot.filter(Boolean).length}/${PYLONS.length}`],
        ["Дефект", this.defectFound ? `опора №${this.defect + 1}` : "не найден"],
        ["Опасные сближения", this.near ? "были" : "нет"], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    PYLONS.forEach(([x, z], i) => m.dot(x, z, this.shot[i] ? "#00ffaa" : "#ffd700", 4));
  }
}

// ───────────────────────────── каталог ─────────────────────────────

// ───────────────────────────── 7. Утечка на нефтепроводе ─────────────────────────────

const TUNDRA: Palette = {
  groundA: 0x5d5a3a, groundB: 0x6f6544, shore: 0x7d7562, tree: 0x2f4630, treeVar: 0x445a34, water: 0x1f3440,
  skyTop: 0x5f7590, skyBottom: 0xc4ccd4, fog: 0xb5bec8, fogDensity: 0.0012,
  sun: 0xfff0dc, sunIntensity: 2.6, ambient: 0xc0cad8, ambientIntensity: 1.0, sunDir: [0.5, 0.42, 0.45],
  clouds: 0.6, exposure: 1.0, hdr: "forest_slope_1k.hdr", grassTint: [0.98, 0.86, 0.6],
};
const WINTER_EVENING: Palette = {
  ...WINTER, skyTop: 0x2b3b58, skyBottom: 0xb6a9b2, fog: 0x9da0b3, fogDensity: 0.0019,
  sun: 0xffc8a0, sunIntensity: 1.3, ambient: 0xaeb8d8, ambientIntensity: 0.9, sunDir: [-0.7, 0.12, 0.3],
  clouds: 0.35, exposure: 1.05,
};

// трасса нефтепровода: от базы на северо-восток с поворотами
const PIPE: [number, number][] = [[30, -30], [90, -160], [70, -300], [160, -420], [230, -560], [210, -690]];
const pipeCorridor = PIPE.slice(0, -1).map(([x, z], i) => ({ x1: x, z1: z, x2: PIPE[i + 1][0], z2: PIPE[i + 1][1], w: 11 }));

/** Ближайшая точка ломаной: расстояние и параметр «вдоль трассы» в метрах. */
function nearestOnPath(path: [number, number][], x: number, z: number) {
  let best = 1e9, at = 0, run = 0, px = 0, pz = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (L * L), 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; at = run + t * L; px = ax + dx * t; pz = az + dz * t; }
    run += L;
  }
  return { d: best, at, x: px, z: pz };
}

interface GasSource { x: number; z: number; q: number; oil: boolean; checked: boolean }

/** Концентрация метана от одного источника: факел, сносимый ветром, слабеет с высотой. */
function plumePpm(s: GasSource, p: THREE.Vector3, wind: THREE.Vector3, agl: number) {
  const wl = Math.hypot(wind.x, wind.z);
  const dx = p.x - s.x, dz = p.z - s.z;
  let along: number, cross: number;
  if (wl < 0.3) { along = Math.hypot(dx, dz); cross = 0; } // штиль: газ расходится во все стороны
  else {
    const ux = wind.x / wl, uz = wind.z / wl;
    along = dx * ux + dz * uz; cross = -dx * uz + dz * ux;
  }
  const sig = 6 + Math.max(0, along) * 0.28;
  const up = along < 0 ? Math.exp(-(along * along) / (2 * 12 * 12)) : 1;
  // концентрация быстро падает с удалением: на 300 м по ветру от порыва — десятки ppm, а не тысячи
  const fall = 1 + Math.pow(Math.max(0, along) / 25, 1.6) + Math.pow(Math.max(0, -along) / 12, 2);
  return (s.q * up * Math.exp(-(cross * cross) / (2 * sig * sig)) * Math.exp(-agl / 22)) / fall;
}

class OilLeakMission extends Mission {
  private sources: GasSource[] = [];
  private leak!: GasSource;
  private ppm = 2;
  private peak = 2;
  private falseReports = 0;
  private spillArea = 0;
  private found = false;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    // надземная прокладка на опорах: так тянут трубы по вечной мерзлоте
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8c8f8a, roughness: 0.55, metalness: 0.6 });
    const supMat = new THREE.MeshStandardMaterial({ color: 0x5a5c5e, roughness: 0.8, metalness: 0.4 });
    for (let i = 0; i < PIPE.length - 1; i++) {
      const [ax, az] = PIPE[i], [bx, bz] = PIPE[i + 1];
      const L = Math.hypot(bx - ax, bz - az), steps = Math.ceil(L / 14);
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = world.groundAt(x0, z0) + 1.4, y1 = world.groundAt(x1, z1) + 1.4;
        const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, a.distanceTo(b) + 0.05, 14, 1), pipeMat);
        seg.position.copy(a).add(b).multiplyScalar(0.5);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        seg.castShadow = true; seg.receiveShadow = true;
        world.scene.add(seg);
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 1.2), supMat);
        sup.position.set(x0, y0 - 0.95, z0);
        sup.rotation.y = Math.atan2(bx - ax, bz - az);
        sup.castShadow = true;
        world.scene.add(sup);
        world.addThermal(seg, 0.32); // нефть в трубе тёплая
      }
    }
    // место порыва — во второй половине трассы
    // место порыва — во второй половине трассы, на ровном месте и не у самой реки
    let lx = 0, lz = 0;
    for (let tries = 0; tries < 40; tries++) {
      const segI = 2 + Math.floor(rnd() * (PIPE.length - 3));
      const t = 0.15 + rnd() * 0.7;
      const [ax, az] = PIPE[segI], [bx, bz] = PIPE[segI + 1];
      lx = ax + (bx - ax) * t; lz = az + (bz - az) * t;
      const slope = Math.abs(world.groundAt(lx + 8, lz) - world.groundAt(lx - 8, lz)) + Math.abs(world.groundAt(lx, lz + 8) - world.groundAt(lx, lz - 8));
      if (world.riverDist(lx, lz) > 60 && slope < 1.2) break;
    }
    this.leak = { x: lx, z: lz, q: 4800, oil: true, checked: false };
    this.sources.push(this.leak);
    // болотный газ: слабые естественные источники метана в стороне от трассы
    for (let k = 0, tries = 0; k < 3 && tries < 60; tries++) {
      const p = PIPE[1 + Math.floor(rnd() * (PIPE.length - 2))];
      const a = rnd() * 6.283, d = 70 + rnd() * 120;
      const x = p[0] + Math.cos(a) * d, z = p[1] + Math.sin(a) * d;
      // болото не должно лежать рядом с порывом или с базой, иначе задача становится нечестной
      if (Math.hypot(x - this.leak.x, z - this.leak.z) < 120 || Math.hypot(x, z) < 120) continue;
      this.sources.push({ x, z, q: 260 + rnd() * 220, oil: false, checked: false });
      k++;
    }
    // пятно разлива: плавный неровный контур, вытянутый в сторону растекания, сетка из колец ложится на рельеф
    const R = 10 + rnd() * 5, seg = 72, rings = 6;
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28], flow = rnd() * 6.28;
    const edge = (ang: number) => R * (1 + 0.22 * Math.sin(3 * ang + ph[0]) + 0.12 * Math.sin(5 * ang + ph[1]) + 0.06 * Math.sin(9 * ang + ph[2]))
      * (1 + 0.6 * Math.max(0, Math.cos(ang - flow)) ** 2);
    const pos: number[] = [], idx: number[] = [];
    pos.push(this.leak.x, world.groundAt(this.leak.x, this.leak.z) + 0.07, this.leak.z);
    let area = 0;
    for (let r = 1; r <= rings; r++) {
      for (let i = 0; i < seg; i++) {
        const ang = (i / seg) * 6.283, rr = edge(ang) * (r / rings);
        const x = this.leak.x + Math.cos(ang) * rr, z = this.leak.z + Math.sin(ang) * rr;
        pos.push(x, world.groundAt(x, z) + 0.07, z);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 6.283, b = ((i + 1) / seg) * 6.283;
      area += 0.5 * edge(a) * edge(b) * Math.sin(b - a);
      idx.push(0, 1 + i, 1 + ((i + 1) % seg));
      for (let r = 1; r < rings; r++) {
        const o = 1 + (r - 1) * seg, n = 1 + r * seg;
        idx.push(o + i, n + i, n + ((i + 1) % seg), o + i, n + ((i + 1) % seg), o + ((i + 1) % seg));
      }
    }
    this.spillArea = area;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // сырая нефть: почти чёрная, с мягким маслянистым отливом, без зеркального блеска
    const spill = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x070605, roughness: 0.3, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
    }));
    spill.receiveShadow = true;
    world.scene.add(spill);
    world.addThermal(spill, 0.5);
    ctx.say("Газоанализатор включён. Идите вдоль трубы и ищите рост концентрации метана", "info");
  }

  private plume(src: GasSource, p: THREE.Vector3, wind: THREE.Vector3, agl: number) { return plumePpm(src, p, wind, agl); }


  update(dt: number, action: Action) {
    this.time += dt;
    const { drone } = this.ctx;
    const agl = this.agl();
    let c = 1.9;
    for (const s of this.sources) c += this.plume(s, drone.pos, drone.windNow, agl);
    // шум датчика и инерция измерения
    this.ppm += (c * (0.95 + Math.random() * 0.1) - this.ppm) * Math.min(1, dt * 2.5);
    this.peak = Math.max(this.peak, this.ppm);

    if (action.pressed && !drone.landed) {
      const dir = this.ctx.camDir();
      let near: GasSource | null = null, nd = 1e9;
      for (const s of this.sources) {
        const d = Math.hypot(s.x - drone.pos.x, s.z - drone.pos.z);
        if (d < nd) { nd = d; near = s; }
      }
      if (dir.y > -0.6) this.ctx.say("Наведите камеру вниз (G) — снимаем пятно сверху", "warn");
      else if (agl > 70) this.ctx.say("Слишком высоко для фиксации — спуститесь ниже 70 м", "warn");
      else if (!near || nd > 35) this.ctx.say(`Здесь ничего нет. Газоанализатор: ${Math.round(this.ppm)} ppm`, "info");
      else if (!near.oil) {
        if (!near.checked) { this.falseReports++; near.checked = true; }
        this.ctx.say("Нефти нет — это болотный газ, естественный метан. Ищите дальше вдоль трубы", "warn");
      } else if (!this.found) {
        this.found = true; this.tasksDone = true;
        const km = (nearestOnPath(PIPE, this.leak.x, this.leak.z).at / 1000).toFixed(2);
        this.ctx.say(`Порыв зафиксирован: км ${km} трассы, пятно ≈ ${Math.round(this.spillArea)} м². Координаты переданы аварийной бригаде`, "good");
      }
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [
      { text: "Найти утечку по газоанализатору", done: this.found, progress: `CH₄ ${Math.round(this.ppm)} ppm` },
      { text: "Снять разлив сверху (камера вниз)", done: this.found },
    ];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 240) / 5 - this.falseReports * 12, 10, 100),
      rows: [
        ["Площадь разлива", this.found ? `${Math.round(this.spillArea)} м²` : "—"],
        ["Пик концентрации", `${Math.round(this.peak)} ppm`], ["Ложные вызовы (болотный газ)", String(this.falseReports)],
        ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    for (let i = 0; i < PIPE.length - 1; i++) {
      const [ax, az] = PIPE[i], [bx, bz] = PIPE[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 18);
      for (let k = 0; k <= n; k++) m.dot(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, "#9aa3ab", 1.5);
    }
    for (const s of this.sources) if (s.checked) m.dot(s.x, s.z, "#888888", 3);
    if (this.found) { m.dot(this.leak.x, this.leak.z, "#111111", 6); m.ring(this.leak.x, this.leak.z, 20, "#ff4444"); }
  }
}

// ───────────────────────────── 8. Учёт оленей ─────────────────────────────

function deerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    g.rotateX(rx); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(new THREE.CapsuleGeometry(0.28, 0.85, 4, 10), 0, 1.0, 0, Math.PI / 2);
  add(new THREE.CapsuleGeometry(0.12, 0.42, 3, 8), 0, 1.32, -0.62, -0.7);
  add(new THREE.CapsuleGeometry(0.1, 0.28, 3, 8), 0, 1.52, -0.86, Math.PI / 2 - 0.3);
  for (const sx of [-0.15, 0.15]) for (const sz of [-0.42, 0.42]) add(new THREE.CylinderGeometry(0.05, 0.04, 0.82, 6), sx, 0.42, sz);
  for (const sx of [-1, 1]) {
    const a = new THREE.CylinderGeometry(0.025, 0.035, 0.6, 5);
    a.rotateZ(sx * 0.5); a.rotateX(-0.4);
    add(a, sx * 0.14, 1.85, -0.78);
  }
  const all = parts.map((g) => { const ng = g; ng.deleteAttribute("uv"); return ng; });
  const merged = mergeGeometries(all)!;
  all.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

class ReindeerMission extends Mission {
  private n: number;
  private pos: Float32Array; private head: Float32Array; private speed: Float32Array;
  private counted: Uint8Array;
  private center = new THREE.Vector2();
  private drift = 0;
  private herd: THREE.InstancedMesh | null = null;
  /** Анимированные модели оленей (если загружены). */
  private deer: THREE.Group[] = [];
  private scared = 0;
  private scareSaid = -20;
  private photos = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    this.n = 38 + Math.floor(rnd() * 30);
    const a0 = rnd() * 1.4 - 0.7, d0 = 330 + rnd() * 160;
    this.center.set(Math.sin(a0) * d0, -Math.cos(a0) * d0);
    this.drift = rnd() * 6.283;
    this.pos = new Float32Array(this.n * 2); this.head = new Float32Array(this.n); this.speed = new Float32Array(this.n);
    this.counted = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 28;
      this.pos[i * 2] = this.center.x + Math.cos(a) * r; this.pos[i * 2 + 1] = this.center.y + Math.sin(a) * r;
      this.head[i] = rnd() * 6.283;
    }
    for (let i = 0; i < this.n; i++) {
      const d = instanceModel("reindeer", rnd());
      if (!d) break;
      d.scale.setScalar(0.85 + rnd() * 0.3); // телята и крупные быки
      world.scene.add(d);
      world.addThermal(d, 0.85);
      this.deer.push(d);
    }
    if (!this.deer.length) {
      const geo = world.track(deerGeometry());
      const herd = new THREE.InstancedMesh(geo, world.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })), this.n);
      const col = new THREE.Color();
      for (let i = 0; i < this.n; i++) {
        // северные олени: от бурых до почти белых
        const w = rnd();
        herd.setColorAt(i, w > 0.85 ? col.setRGB(0.82, 0.8, 0.76) : col.setRGB(0.36 + w * 0.12, 0.31 + w * 0.1, 0.26 + w * 0.08));
      }
      herd.castShadow = true; herd.receiveShadow = true;
      herd.frustumCulled = false;
      world.scene.add(herd);
      const th = new THREE.InstancedMesh(geo, world.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.85, 0.85), fog: false, toneMapped: false })), this.n);
      th.instanceMatrix = herd.instanceMatrix;
      th.frustumCulled = false;
      th.layers.set(THERMAL_LAYER);
      world.scene.add(th);
      this.herd = herd;
    }
    this.sync();
    ctx.say("Стадо пасётся в 300–500 м к северу. Снимайте сверху с высоты 30–120 м, камера вниз", "info");
  }

  private sync() {
    const w = this.ctx.world, s = new THREE.Vector3(1, 1, 1);
    if (this.deer.length) {
      for (let i = 0; i < this.deer.length; i++) {
        const d = this.deer[i], x = this.pos[i * 2], z = this.pos[i * 2 + 1], sp = this.speed[i];
        d.position.set(x, w.groundAt(x, z), z);
        d.rotation.y = this.head[i];
        const play = d.userData.play as ((k: string, s?: number) => void) | undefined;
        if (play) {
          if (sp > 3.5) play("run", sp / 6);
          else if (sp > 0.7) play("walk", sp / 1.3);
          else play(i % 5 === 0 ? "idle" : "graze");
        }
      }
      return;
    }
    if (!this.herd) return;
    for (let i = 0; i < this.n; i++) {
      const x = this.pos[i * 2], z = this.pos[i * 2 + 1];
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.head[i] + Math.PI);
      this.herd.setMatrixAt(i, this.m4.compose(new THREE.Vector3(x, w.groundAt(x, z), z), this.q, s));
    }
    this.herd.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.deer.forEach((d) => d.removeFromParent()); }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone, rnd } = this.ctx;
    const agl = this.agl();
    // стадо медленно дрейфует, олени пасутся вокруг центра
    this.drift += (rnd() - 0.5) * 0.2 * dt;
    this.center.x += Math.sin(this.drift) * 0.35 * dt;
    this.center.y += -Math.cos(this.drift) * 0.35 * dt;
    let disturbed = false;
    for (let i = 0; i < this.n; i++) {
      const j = i * 2;
      const dx = this.pos[j] - drone.pos.x, dz = this.pos[j + 1] - drone.pos.z;
      const dd = Math.hypot(dx, dz);
      let target = 0.25 + 0.25 * Math.sin(this.time * 0.3 + i);
      // низкий дрон пугает оленей — они бегут прочь
      if (agl < 30 && dd < 45 && !drone.landed) {
        disturbed = true;
        const away = Math.atan2(dx, dz);
        this.head[i] += Math.atan2(Math.sin(away - this.head[i]), Math.cos(away - this.head[i])) * Math.min(1, dt * 4);
        target = 7;
      } else {
        const cx = this.center.x - this.pos[j], cz = this.center.y - this.pos[j + 1];
        if (Math.hypot(cx, cz) > 24) {
          const to = Math.atan2(cx, cz);
          this.head[i] += Math.atan2(Math.sin(to - this.head[i]), Math.cos(to - this.head[i])) * Math.min(1, dt);
          target = 1.2;
        } else this.head[i] += (rnd() - 0.5) * dt;
      }
      this.speed[i] += (target - this.speed[i]) * Math.min(1, dt * 2);
      this.pos[j] += Math.sin(this.head[i]) * this.speed[i] * dt;
      this.pos[j + 1] += Math.cos(this.head[i]) * this.speed[i] * dt;
    }
    if (disturbed) {
      this.scared += dt;
      if (this.time - this.scareSaid > 6) { this.scareSaid = this.time; this.ctx.say("Стадо пугается дрона! Поднимитесь выше 30 м", "warn"); }
    }
    this.sync();

    if (action.pressed && !drone.landed) {
      const dir = this.ctx.camDir();
      if (dir.y > -0.9) this.ctx.say("Для учёта камера смотрит строго вниз (G)", "warn");
      else if (agl < 25 || agl > 130) this.ctx.say(`Высота ${agl.toFixed(0)} м: снимайте с 25–130 м`, "warn");
      else if (blurred(this.ctx, agl)) this.ctx.say("Смаз: замедлитесь перед кадром", "warn");
      else {
        // кадр камеры подвеса: прямоугольник на земле, повёрнутый по курсу
        const hx = agl * 0.634, hz = agl * 0.466;
        const c = Math.cos(drone.yaw), sn = Math.sin(drone.yaw);
        let fresh = 0, inFrame = 0;
        for (let i = 0; i < this.n; i++) {
          const dx = this.pos[i * 2] - drone.pos.x, dz = this.pos[i * 2 + 1] - drone.pos.z;
          const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
          if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
            inFrame++;
            if (!this.counted[i]) { this.counted[i] = 1; fresh++; }
          }
        }
        this.photos++;
        const total = this.counted.reduce((a, v) => a + v, 0);
        this.ctx.say(inFrame ? `Кадр ${this.photos}: в кадре ${inFrame}, новых ${fresh}. Учтено ${total}` : `Кадр ${this.photos}: оленей нет`, fresh ? "good" : "info");
        if (!this.tasksDone && total >= Math.ceil(this.n * 0.95)) {
          this.tasksDone = true;
          this.ctx.say("Стадо учтено! Возвращайтесь на базу", "good");
        }
      }
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    const total = this.counted.reduce((a, v) => a + v, 0);
    return [
      { text: "Сфотографировать всё стадо сверху", done: this.tasksDone, progress: `учтено ${total}` },
      { text: "Не тревожить животных (выше 30 м)", done: this.scared === 0, progress: this.scared ? `${this.scared.toFixed(0)} с` : undefined },
    ];
  }
  summary() {
    const total = this.counted.reduce((a, v) => a + v, 0);
    return {
      score: clamp(100 * (total / this.n) - this.scared * 1.5 - Math.max(0, this.time - 300) / 8, 10, 100),
      rows: [
        ["Учтено оленей", `${total} из ${this.n}`], ["Точность учёта", `${Math.round((total / this.n) * 100)}%`],
        ["Кадров", String(this.photos)], ["Стадо тревожилось", `${this.scared.toFixed(0)} с`], ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    m.ring(this.center.x, this.center.y, 40, "#ffd700");
    for (let i = 0; i < this.n; i += 2) m.dot(this.pos[i * 2], this.pos[i * 2 + 1], this.counted[i] ? "#00ffaa" : "#c8a070", 1.6);
  }
}

// ───────────────────────────── 9. Тепловизионный аудит домов ─────────────────────────────

const BLOCK = { x: 0, z: -230 };

interface AuditHouse { obj: THREE.Object3D; c: THREE.Vector3; top: number; defect: string | null; shot: boolean; thermal: boolean }

class HeatAuditMission extends Mission {
  private houses: AuditHouse[] = [];
  private smokeAcc = 0;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    const defects = ["теплопотери через кровлю", "промерзание угла сруба", "утечка тепла через окна", "прорыв теплотрассы у фундамента"];
    const pick = new Set<number>();
    while (pick.size < 4) pick.add(Math.floor(rnd() * 12));
    const hot = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
    world.track(hot);
    for (let k = 0; k < 12; k++) {
      const gx = (k % 4) - 1.5, gz = Math.floor(k / 4) - 1;
      const x = BLOCK.x + gx * 34 + (rnd() - 0.5) * 4, z = BLOCK.z + gz * 36 + (rnd() - 0.5) * 4;
      const h = makeHouse(rnd, true);
      h.rotation.y = (Math.floor(rnd() * 4) * Math.PI) / 2;
      this.place(h, x, z);
      h.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(h);
      const defect = pick.has(k) ? defects[Math.floor(rnd() * defects.length)] : null;
      world.addThermal(h, defect ? 0.42 : 0.28);
      if (defect) {
        // горячее пятно видно только в тепловизоре
        const sz = box.getSize(new THREE.Vector3());
        const spot = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 0.5, 0.6, sz.z * 0.5), hot);
        const y = defect.includes("кровл") ? box.max.y - 1.2 : defect.includes("фундам") ? box.min.y + 0.3 : box.min.y + 1.6;
        spot.position.set((box.min.x + box.max.x) / 2 + (defect.includes("угла") ? sz.x * 0.3 : 0), y, (box.min.z + box.max.z) / 2);
        spot.layers.set(THERMAL_LAYER);
        world.scene.add(spot);
        if (defect.includes("фундам")) {
          const pipe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 30), hot);
          pipe.position.set(spot.position.x, world.groundAt(spot.position.x, spot.position.z) + 0.1, spot.position.z + 15);
          pipe.layers.set(THERMAL_LAYER);
          world.scene.add(pipe);
        }
      }
      this.houses.push({ obj: h, c: box.getCenter(new THREE.Vector3()), top: box.max.y, defect, shot: false, thermal: false });
    }
    ctx.say("Квартал из 12 домов в 230 м к северу. Снимайте каждый дом в тепловизоре (T) с 10–45 м", "info");
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone, fx, rnd } = this.ctx;
    // дымы из печных труб — зимний вечер
    this.smokeAcc += dt;
    if (this.smokeAcc > 0.25) {
      this.smokeAcc = 0;
      const h = this.houses[Math.floor(rnd() * this.houses.length)];
      const g = 0.75 + rnd() * 0.15;
      fx.smoke.spawn(h.c.x + (rnd() - 0.5) * 2, h.top + 0.5, h.c.z + (rnd() - 0.5) * 2, 0, 1.2, 0, 7, 1.5, g, g, g, 0.35);
    }
    if (!action.pressed || drone.landed) return;
    const dir = this.ctx.camDir();
    let best: AuditHouse | null = null, bd = 1e9;
    for (const h of this.houses) {
      const d = h.c.distanceTo(drone.pos);
      const to = h.c.clone().sub(drone.pos).normalize();
      if (to.dot(dir) > 0.8 && d < bd) { bd = d; best = h; }
    }
    if (!best) { this.ctx.say("Дом не в кадре: наведите нос и камеру подвеса (G) на дом", "warn"); return; }
    if (bd > 45) { this.ctx.say(`Далеко: ${bd.toFixed(0)} м до дома (нужно 10–45 м)`, "warn"); return; }
    if (bd < 10) { this.ctx.say("Слишком близко — дом не помещается в кадр", "warn"); return; }
    const n = this.houses.indexOf(best) + 1;
    if (!this.ctx.thermal()) {
      this.ctx.say(`Дом №${n}: обычный снимок. Для энергоаудита включите тепловизор (T)`, "info");
      return;
    }
    const first = !best.thermal;
    best.shot = true; best.thermal = true;
    if (best.defect) this.ctx.say(`Дом №${n}: ${best.defect}! Термограмма отправлена в управляющую компанию`, "good");
    else this.ctx.say(`Дом №${n}: термограмма в норме`, first ? "good" : "info");
    if (!this.tasksDone && this.houses.every((h) => h.thermal)) {
      this.tasksDone = true;
      this.ctx.say("Квартал обследован! Возвращайтесь на базу", "good");
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    const n = this.houses.filter((h) => h.thermal).length;
    const f = this.houses.filter((h) => h.thermal && h.defect).length;
    return [
      { text: "Снять каждый дом в тепловизоре", done: n === this.houses.length, progress: `${n}/${this.houses.length}` },
      { text: "Выявить дома с теплопотерями", done: this.tasksDone, progress: `найдено ${f}` },
    ];
  }
  summary() {
    const n = this.houses.filter((h) => h.thermal).length;
    const f = this.houses.filter((h) => h.thermal && h.defect).length;
    return {
      score: clamp((n / this.houses.length) * 100 - Math.max(0, this.time - 300) / 6, 10, 100),
      rows: [
        ["Обследовано домов", `${n} из ${this.houses.length}`], ["Найдено дефектов", `${f} из ${this.houses.filter((h) => h.defect).length}`],
        ["Время", fmtTime(this.time)],
      ] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    for (const h of this.houses) m.dot(h.c.x, h.c.z, h.thermal ? (h.defect ? "#ff4444" : "#00ffaa") : "#9aa3ab", 3.5);
  }
}

// ═════════════════════════════ Общие помощники для миссий 10–18 ═════════════════════════════

/** Проверка кадра: цель в поле зрения камеры подвеса, на нужной дистанции, без смаза. Возвращает текст ошибки или null. */
/**
 * Смаз кадра: при выдержке ~1/250 с важна не скорость дрона, а то, как быстро цель «плывёт» в кадре —
 * угловая скорость (скорость / дистанция) и вращение самого аппарата.
 */
function blurred(ctx: Ctx, dist: number): boolean {
  const d = ctx.drone;
  return d.vel.length() / Math.max(5, dist) > 0.45 || d.omega.length() > 1.2;
}

function frameCheck(ctx: Ctx, target: THREE.Vector3, minD: number, maxD: number, what: string): string | null {
  const d = ctx.drone.pos.distanceTo(target);
  if (d > maxD) return `Далеко: до цели «${what}» ${d.toFixed(0)} м (нужно ${minD}–${maxD} м)`;
  if (d < minD) return `Слишком близко к цели «${what}» — не помещается в кадр`;
  const to = target.clone().sub(ctx.drone.pos).normalize();
  if (to.dot(ctx.camDir()) < 0.82) return `«${what}» не в кадре — разверните нос, наклон подвеса — G`;
  if (blurred(ctx, d)) return "Смаз: аппарат движется слишком быстро — притормозите перед снимком";
  return null;
}

const std = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function boxMesh(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function wheel(r: number, w: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), std(0x111111, 0.95));
  m.rotation.z = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true;
  return m;
}

/** Легковушка. */
function makeCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const paint = std(color, 0.35, 0.4), glass = std(0x0b0f14, 0.05, 0.6);
  g.add(boxMesh(1.8, 0.7, 4.3, paint, 0, 0.65, 0), boxMesh(1.6, 0.6, 2.2, paint, 0, 1.25, 0.2), boxMesh(1.62, 0.45, 2.0, glass, 0, 1.27, 0.2));
  for (const sx of [-0.85, 0.85]) for (const sz of [-1.35, 1.35]) g.add(wheel(0.33, 0.24, sx, 0.33, sz));
  return g;
}

/** Лесовоз-форвардер с гидроманипулятором и пачкой брёвен. */
function makeForwarder(): THREE.Group {
  const g = new THREE.Group();
  const yel = std(0xd8a21c, 0.5, 0.2), dark = std(0x2a2c2e, 0.7, 0.3), wood = std(0x8a6a48, 0.9);
  g.add(boxMesh(2.4, 1.6, 2.4, yel, 0, 1.7, -3.2), boxMesh(2.2, 1.2, 1.9, std(0x101418, 0.1, 0.5), 0, 2.6, -3.3));
  g.add(boxMesh(2.6, 0.5, 6.5, dark, 0, 1.2, 0.8));
  for (const sz of [-3.2, -0.6, 1.8, 4.0]) for (const sx of [-1.25, 1.25]) g.add(wheel(0.7, 0.6, sx, 0.7, sz));
  for (let i = 0; i < 9; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.6, 8), wood);
    log.rotation.x = Math.PI / 2; log.position.set(-0.8 + (i % 3) * 0.8, 1.75 + Math.floor(i / 3) * 0.38, 1.6); log.castShadow = true;
    g.add(log);
  }
  const boom = boxMesh(0.3, 0.3, 4.2, yel, 0.6, 3.4, -0.8); boom.rotation.x = -0.35;
  g.add(boom);
  return g;
}

function makeStump(rnd: () => number): THREE.Mesh {
  const r = 0.18 + rnd() * 0.22;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, 0.35 + rnd() * 0.3, 9),
    [std(0x5a4636, 0.95), std(0xd8b98a, 0.8), std(0x5a4636, 0.95)] as unknown as THREE.Material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function makeLogPile(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const mat = std(0x7a5a40, 0.9), end = std(0xcaa678, 0.85);
  for (let i = 0; i < 14; i++) {
    const r = 0.16 + rnd() * 0.08;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 5 + rnd(), 9), [mat, end, end] as unknown as THREE.Material);
    log.rotation.z = Math.PI / 2;
    log.position.set(0, 0.2 + Math.floor(i / 5) * 0.34, (i % 5) * 0.38 - 0.8 + (Math.floor(i / 5) % 2) * 0.19);
    log.castShadow = true;
    g.add(log);
  }
  return g;
}

/** Щит-аншлаг с надписью (лесосека, гидропост и т. п.). */
function makeSign(lines: string[], color = "#f2f2ee"): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = color; x.fillRect(0, 0, 512, 256);
  x.strokeStyle = "#1c3d24"; x.lineWidth = 10; x.strokeRect(5, 5, 502, 246);
  x.fillStyle = "#1c3d24"; x.font = "bold 40px sans-serif"; x.textAlign = "center";
  lines.forEach((l, i) => x.fillText(l, 256, 70 + i * 56));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const post = std(0x6a5038, 0.9);
  g.add(boxMesh(0.12, 2.6, 0.12, post, -0.9, 1.3, 0), boxMesh(0.12, 2.6, 0.12, post, 0.9, 1.3, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  board.position.y = 2.2;
  g.add(board);
  return g;
}

/** Гидропост: полосатая рейка с делениями по 10 см. */
function makeGauge(): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 1024;
  const x = c.getContext("2d")!;
  for (let i = 0; i < 80; i++) { x.fillStyle = i % 2 ? "#ffffff" : (Math.floor(i / 10) % 2 ? "#d22" : "#111"); x.fillRect(0, i * 12.8, 64, 12.8); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8, 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  rail.position.y = 4; rail.castShadow = true;
  g.add(rail, boxMesh(0.15, 8, 0.15, std(0x555a5e, 0.5, 0.6), 0, 4, -0.12));
  return g;
}

function makeLifebuoy(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.11, 10, 20), std(0xff5a1f, 0.5));
  ring.rotation.x = Math.PI / 2;
  for (let k = 0; k < 4; k++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.115, 10, 3, 0.3), std(0xf4f4f4, 0.5));
    band.rotation.set(Math.PI / 2, 0, (k * Math.PI) / 2);
    g.add(band);
  }
  g.add(ring);
  const chute = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  chute.position.y = 1.3; chute.name = "chute";
  g.add(chute);
  return g;
}

/** Сброс грузов на парашюте с учётом ветра; по приземлению вызывает onLand. */
class Drops {
  private list: { g: THREE.Group; v: THREE.Vector3 }[] = [];
  constructor(private ctx: Ctx, private make: () => THREE.Group, private ground: (x: number, z: number) => number, private onLand: (p: THREE.Vector3, g: THREE.Group) => void) {}
  drop() {
    const d = this.ctx.drone;
    const g = this.make();
    g.position.copy(d.pos).y -= 0.6;
    this.ctx.world.scene.add(g);
    this.list.push({ g, v: d.vel.clone() });
  }
  update(dt: number) {
    const w = this.ctx.drone.windNow;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.v.x += (w.x * 0.6 - p.v.x) * Math.min(1, 1.5 * dt);
      p.v.z += (w.z * 0.6 - p.v.z) * Math.min(1, 1.5 * dt);
      p.v.y += (-4.5 - p.v.y) * Math.min(1, 2 * dt);
      p.g.position.addScaledVector(p.v, dt);
      const gh = this.ground(p.g.position.x, p.g.position.z);
      if (p.g.position.y <= gh + 0.12) {
        p.g.position.y = gh + 0.12;
        const ch = p.g.getObjectByName("chute");
        if (ch) ch.visible = false;
        this.list.splice(i, 1);
        this.onLand(p.g.position.clone(), p.g);
      }
    }
  }
}

/** Лента дороги по рельефу (асфальт с разметкой) и очищенная от леса просека. */
function makeRoad(world: World, path: [number, number][], width: number): { mesh: THREE.Mesh; length: number; at: (s: number) => THREE.Vector3; dirAt: (s: number) => number } {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector3(ax + ((bx - ax) * k) / n, 0, az + ((bz - az) * k) / n));
  }
  pts.push(new THREE.Vector3(path[path.length - 1][0], 0, path[path.length - 1][1]));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    for (const side of [-1, 1]) {
      const x = p.x + nx * side * width / 2, z = p.z + nz * side * width / 2;
      pos.push(x, world.groundAt(x, z) + 0.06, z);
      uv.push(side < 0 ? 0 : 1, cum[i] / 8);
    }
    if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  });
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#3a3c3e"; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 2500; i++) { const v = 40 + Math.random() * 40; x.fillStyle = `rgb(${v},${v},${v + 2})`; x.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  x.fillStyle = "#e8e4d8"; x.fillRect(61, 0, 6, 150);
  x.fillRect(4, 0, 4, 256); x.fillRect(120, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  world.scene.add(mesh);
  const at = (s: number) => {
    s = clamp(s, 0, cum[cum.length - 1]);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const p = pts[i - 1].clone().lerp(pts[i], t);
    p.y = world.groundAt(p.x, p.z);
    return p;
  };
  const dirAt = (s: number) => { const a = at(s - 2), b = at(s + 2); return Math.atan2(b.x - a.x, b.z - a.z); };
  return { mesh, length: cum[cum.length - 1], at, dirAt };
}

const pathCorridor = (path: [number, number][], w: number) => path.slice(0, -1).map(([x, z], i) => ({ x1: x, z1: z, x2: path[i + 1][0], z2: path[i + 1][1], w }));

const SPRING: Palette = {
  ...OVERCAST, groundA: 0x5a5a3c, groundB: 0x6f6448, skyTop: 0x6c7c90, skyBottom: 0xc2c8cf, fog: 0xb4bcc6, fogDensity: 0.0017,
  sunIntensity: 2.2, clouds: 0.8, grassTint: [0.86, 0.78, 0.56], hdr: "forest_slope_1k.hdr",
};
const NIGHT: Palette = {
  ...SUMMER, skyTop: 0x060a18, skyBottom: 0x1d2638, fog: 0x141b28, fogDensity: 0.0024,
  sun: 0x9fb4ff, sunIntensity: 0.55, ambient: 0x3a4870, ambientIntensity: 0.55, sunDir: [-0.3, 0.55, -0.6],
  clouds: 0.3, exposure: 2.3, hdr: "kiara_1_dawn_1k.hdr", grassTint: [0.6, 0.68, 0.62],
};

// ───────────────────────────── 10. Ледоход и затор на Печоре ─────────────────────────────

const ICE_RIVER = { z0: -260, amp: 45, wl: 240, width: 40 };

class IceJamMission extends Mission {
  private floes: THREE.InstancedMesh;
  private fx: Float32Array; private fz: Float32Array; private fs: Float32Array; private fr: Float32Array; private stuck: Uint8Array;
  private jamX: number;
  private jamN = 0;
  private gauges: { p: THREE.Vector3; level: number; read: boolean }[] = [];
  private village: THREE.Vector3;
  private jamShot = false; private villageShot = false;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    this.jamX = 120 + rnd() * 160;
    const n = 260;
    this.fx = new Float32Array(n); this.fz = new Float32Array(n); this.fs = new Float32Array(n); this.fr = new Float32Array(n); this.stuck = new Uint8Array(n);
    for (let i = 0; i < n; i++) { this.fx[i] = -650 + rnd() * (this.jamX + 600); this.fz[i] = (rnd() - 0.5) * ICE_RIVER.width * 0.8; this.fs[i] = 2 + rnd() * 5; this.fr[i] = rnd() * 6.28; }
    const geo = new THREE.CylinderGeometry(1, 1, 0.5, 7);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) { const h = Math.sin(p.getX(k) * 9.1 + p.getZ(k) * 5.3) * 0.5 + 0.5; p.setX(k, p.getX(k) * (0.8 + h * 0.35)); p.setZ(k, p.getZ(k) * (0.75 + h * 0.4)); }
    geo.computeVertexNormals();
    this.floes = new THREE.InstancedMesh(world.track(geo), world.track(new THREE.MeshStandardMaterial({ color: 0xe6eef4, roughness: 0.55 })), n);
    this.floes.castShadow = true; this.floes.receiveShadow = true; this.floes.frustumCulled = false;
    world.scene.add(this.floes);
    const th = new THREE.InstancedMesh(geo, world.track(new THREE.MeshBasicMaterial({ color: 0x080808, fog: false, toneMapped: false })), n);
    th.instanceMatrix = this.floes.instanceMatrix; th.frustumCulled = false; th.layers.set(THERMAL_LAYER);
    world.scene.add(th);
    // подтопленная деревня у затора: вода выше бровки берега
    const vx = this.jamX - 40, vz = world.riverZ(vx) + ICE_RIVER.width / 2 + 34;
    this.village = new THREE.Vector3(vx, world.groundAt(vx, vz), vz);
    const flood = new THREE.Mesh(new THREE.CircleGeometry(48, 40), world.track(new THREE.MeshStandardMaterial({ color: 0x3d4d52, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 })));
    flood.rotation.x = -Math.PI / 2;
    flood.position.set(vx, world.groundAt(vx, vz) + 0.7, vz);
    world.scene.add(flood);
    const r2 = mulberry32(7);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28, r = 14 + r2() * 22;
      const h = makeHouse(r2, false);
      h.rotation.y = r2() * 3;
      this.place(h, vx + Math.cos(a) * r, vz + Math.sin(a) * r, -0.4);
      world.addThermal(h, 0.3);
    }
    // гидропосты: выше затора уровень поднимается
    for (const gx of [-300, this.jamX - 90, this.jamX + 120]) {
      const gz = world.riverZ(gx) - ICE_RIVER.width / 2 + 2;
      const g = makeGauge();
      g.position.set(gx, -1.5, gz);
      world.scene.add(g);
      const level = gx < this.jamX ? 5.2 + (gx > this.jamX - 200 ? 2.4 : 0.6) + rnd() * 0.4 : 3.1 + rnd() * 0.3;
      this.gauges.push({ p: new THREE.Vector3(gx, 3, gz), level, read: false });
    }
    ctx.say("Весенний ледоход. Найдите затор, снимите подтопленную деревню и считайте три гидропоста", "info");
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { world, rnd } = this.ctx;
    const s1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.fx.length; i++) {
      if (!this.stuck[i]) {
        this.fx[i] += (1.4 + (i % 5) * 0.12) * dt;
        this.fr[i] += 0.05 * dt;
        if (this.fx[i] > this.jamX - 55 - Math.min(140, this.jamN * 0.6)) {
          // льдина упирается в затор: торосится, встаёт ребром
          this.stuck[i] = 1; this.jamN++;
        }
      }
      if (this.stuck[i] && this.jamN > 200 && rnd() < 0.0005) { this.stuck[i] = 0; this.jamN--; this.fx[i] = -650; }
      const x = this.fx[i], z = world.riverZ(x) + this.fz[i];
      const st = this.stuck[i];
      this.e.set(st ? Math.sin(i * 7.1) * 0.6 : 0, this.fr[i], st ? Math.cos(i * 3.3) * 0.5 : 0);
      this.q.setFromEuler(this.e);
      s1.set(this.fs[i], st ? 1.4 : 1, this.fs[i]);
      this.floes.setMatrixAt(i, this.m4.compose(new THREE.Vector3(x, (world.waterLevel ?? 0) + (st ? 0.4 + Math.sin(i) * 0.5 : 0.05), z), this.q, s1));
    }
    this.floes.instanceMatrix.needsUpdate = true;
    if (!action.pressed || this.ctx.drone.landed) return;
    const jamC = new THREE.Vector3(this.jamX - 50, 1, world.riverZ(this.jamX - 50));
    const cands: [string, () => void, string | null][] = [
      ["затор", () => { if (!this.jamShot) this.ctx.say(`Затор зафиксирован: торосы на ${Math.round(55 + Math.min(140, this.jamN * 0.6))} м, русло перекрыто`, "good"); this.jamShot = true; }, frameCheck(this.ctx, jamC, 25, 140, "затор")],
      ["деревня", () => { if (!this.villageShot) this.ctx.say("Подтопленная деревня снята: вода у окон 7 домов. Данные переданы МЧС", "good"); this.villageShot = true; }, frameCheck(this.ctx, this.village, 20, 110, "деревня")],
      ...this.gauges.map((g, k): [string, () => void, string | null] => [`гидропост ${k + 1}`, () => {
        if (!g.read) this.ctx.say(`Гидропост №${k + 1}: уровень ${g.level.toFixed(2)} м${g.level > 6 ? " — выше опасной отметки!" : ""}`, g.level > 6 ? "warn" : "good");
        g.read = true;
      }, frameCheck(this.ctx, g.p, 6, 35, `гидропост №${k + 1}`)]),
    ];
    // засчитываем все цели, попавшие в кадр
    const ok = cands.filter((c) => c[2] === null);
    if (ok.length) ok.forEach((c) => c[1]());
    else {
      // подсказываем про ближайшую цель
      let best = cands[0], bd = 1e9;
      for (const c of cands) { const d = c[0] === "затор" ? this.ctx.drone.pos.distanceTo(jamC) : c[0] === "деревня" ? this.ctx.drone.pos.distanceTo(this.village) : this.ctx.drone.pos.distanceTo(this.gauges[+c[0].slice(-1) - 1].p); if (d < bd) { bd = d; best = c; } }
      this.ctx.say(best[2]!, "warn");
    }
    if (!this.tasksDone && this.jamShot && this.villageShot && this.gauges.every((g) => g.read)) {
      this.tasksDone = true;
      this.ctx.say("Обследование паводка завершено! Возвращайтесь на базу", "good");
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    const n = this.gauges.filter((g) => g.read).length;
    return [
      { text: "Найти и снять ледовый затор", done: this.jamShot },
      { text: "Снять подтопленную деревню", done: this.villageShot },
      { text: "Считать гидропосты", done: n === 3, progress: `${n}/3` },
    ];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 300) / 5, 10, 100),
      rows: [["Длина затора", `${Math.round(55 + Math.min(140, this.jamN * 0.6))} м`], ...this.gauges.map((g, k): [string, string] => [`Гидропост №${k + 1}`, g.read ? `${g.level.toFixed(2)} м` : "—"]), ["Время", fmtTime(this.time)]] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    this.gauges.forEach((g) => m.dot(g.p.x, g.p.z, g.read ? "#00ffaa" : "#ffd700", 3.5));
    if (this.jamShot) m.ring(this.jamX - 50, this.ctx.world.riverZ(this.jamX - 50), 60, "#ffffff");
    if (this.villageShot) m.dot(this.village.x, this.village.z, "#00aaff", 5);
  }
}

// ───────────────────────────── 11. Незаконная рубка ─────────────────────────────

class LoggingMission extends Mission {
  private cut!: THREE.Vector3; private legal!: THREE.Vector3; private machine!: THREE.Vector3;
  private cutShot = false; private machineShot = false; private legalChecked = false;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    const spot = (a0: number, d0: number) => {
      const a = a0 + (rnd() - 0.5) * 0.9, d = d0 + rnd() * 120;
      return new THREE.Vector3(Math.sin(a) * d, 0, -Math.cos(a) * d);
    };
    this.cut = spot(rnd() < 0.5 ? -0.6 : 0.6, 360);
    this.legal = spot(rnd() < 0.5 ? 2.2 : -2.2, 280);
    const near: number[] = [];
    const clear = (c: THREE.Vector3, r: number, stumps: boolean) => {
      for (const i of world.treesNear(c.x, c.z, r, near)) {
        if (Math.hypot(world.treeX[i] - c.x, world.treeZ[i] - c.z) > r) continue;
        world.removeTree(i);
        if (stumps) {
          const st = makeStump(rnd);
          this.place(st, world.treeX[i], world.treeZ[i], 0.15);
        }
      }
    };
    clear(this.cut, 30, true);
    clear(this.legal, 26, true);
    for (const c of [this.cut, this.legal]) c.y = world.groundAt(c.x, c.z) + 2;
    for (let k = 0; k < 3; k++) {
      const pile = makeLogPile(rnd);
      pile.rotation.y = rnd() * 3;
      this.place(pile, this.cut.x + (rnd() - 0.5) * 30, this.cut.z + (rnd() - 0.5) * 30);
    }
    const fw = makeForwarder();
    fw.rotation.y = rnd() * 6.28;
    const mx = this.cut.x + 8, mz = this.cut.z - 6;
    this.place(fw, mx, mz);
    world.addThermal(fw, 0.65); // тёплый двигатель — видно в тепловизоре
    this.machine = new THREE.Vector3(mx, world.groundAt(mx, mz) + 2, mz);
    const sign = makeSign(["ЛЕСОСЕКА № 14", "Лесорубочный билет", "№ 11-26/0387 до 31.12"]);
    sign.rotation.y = rnd() * 6.28;
    this.place(sign, this.legal.x + 20, this.legal.z);
    ctx.say("Жалоба на рубку в квадрате к северу. Ищите свежую вырубку, проверьте законность, снимите технику", "info");
  }

  update(dt: number, action: Action) {
    this.time += dt;
    if (!action.pressed || this.ctx.drone.landed) return;
    const d = this.ctx.drone, dir = this.ctx.camDir();
    const over = (c: THREE.Vector3) => Math.hypot(d.pos.x - c.x, d.pos.z - c.z) < 40 && dir.y < -0.6 && this.agl() > 20 && this.agl() < 100;
    if (over(this.legal)) {
      this.legalChecked = true;
      this.ctx.say("Эта рубка законная: аншлаг, визиры по границе, билет действителен. Ищите дальше", "info");
      return;
    }
    if (over(this.cut)) {
      if (!this.cutShot) this.ctx.say("Вырубка снята сверху: около 0,3 га, аншлага и клеймения нет — незаконная рубка!", "good");
      this.cutShot = true;
    } else {
      const err = frameCheck(this.ctx, this.machine, 8, 45, "лесовоз");
      if (err === null) {
        if (!this.machineShot) this.ctx.say("Техника снята: номер и марка форвардера зафиксированы для полиции", "good");
        this.machineShot = true;
      } else if (Math.hypot(d.pos.x - this.cut.x, d.pos.z - this.cut.z) < 90) this.ctx.say(dir.y > -0.6 ? err : "Для съёмки вырубки зависните над ней на 20–100 м, камера вниз", "warn");
      else this.ctx.say("Здесь рубки нет. Вырубку хорошо видно сверху и по тёплой технике в тепловизоре", "info");
    }
    if (!this.tasksDone && this.cutShot && this.machineShot) {
      this.tasksDone = true;
      this.ctx.say("Материалы для лесничества и полиции собраны! Возвращайтесь на базу", "good");
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [
      { text: "Найти незаконную вырубку и снять сверху", done: this.cutShot },
      { text: "Снять технику нарушителей", done: this.machineShot },
    ];
  }
  summary() {
    return {
      score: clamp(100 - Math.max(0, this.time - 280) / 5, 10, 100),
      rows: [["Незаконная вырубка", this.cutShot ? "зафиксирована" : "не найдена"], ["Законная лесосека проверена", this.legalChecked ? "да" : "нет"], ["Время", fmtTime(this.time)]] as [string, string][],
    };
  }
  drawMap(m: MapDraw) {
    m.ring(0, -420, 230, "#ffd700");
    if (this.cutShot) m.ring(this.cut.x, this.cut.z, 30, "#ff4444");
    if (this.legalChecked) m.ring(this.legal.x, this.legal.z, 26, "#00ffaa");
  }
}

// ───────────────────────────── 12. Газовый промысел (Вуктыл) ─────────────────────────────

const PADS: [number, number][] = [[60, -260], [-140, -420], [170, -520]];
const GAS_PIPE: [number, number][] = [[0, -40], [60, -260], [-140, -420], [60, -260], [170, -520]];

class GasFieldMission extends Mission {
  private leak: GasSource;
  private flareTop: THREE.Vector3;
  private flames: FlameField;
  private ppm = 2; private peak = 2;
  private flareShot = false; private found = false; private heat = 0;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    const steel = std(0x9ba1a6, 0.45, 0.7), red = std(0xb8282a, 0.5, 0.3);
    for (let i = 0; i < GAS_PIPE.length - 1; i++) {
      const [ax, az] = GAS_PIPE[i], [bx, bz] = GAS_PIPE[i + 1];
      const a = new THREE.Vector3(ax, world.groundAt(ax, az) + 1.2, az), b = new THREE.Vector3(bx, world.groundAt(bx, bz) + 1.2, bz);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, a.distanceTo(b), 10), steel);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.castShadow = true;
      world.scene.add(seg);
    }
    // кусты скважин: фонтанная арматура «ёлка», ограждение
    PADS.forEach(([x, z]) => {
      for (let k = 0; k < 3; k++) {
        const g = new THREE.Group();
        g.add(boxMesh(0.6, 1.2, 0.6, red, 0, 0.6, 0), boxMesh(0.25, 2.4, 0.25, steel, 0, 2.2, 0), boxMesh(1.4, 0.25, 0.25, red, 0, 2.2, 0), boxMesh(0.25, 0.25, 1.2, red, 0, 2.9, 0));
        this.place(g, x - 10 + k * 10, z);
        world.addThermal(g, 0.35);
      }
    });
    // факельная установка
    const [fx, fz] = [PADS[0][0] + 45, PADS[0][1] - 30];
    const gy = world.groundAt(fx, fz);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 26, 12), std(0x8a8f94, 0.5, 0.6));
    stack.position.set(fx, gy + 13, fz); stack.castShadow = true;
    world.scene.add(stack);
    this.flareTop = new THREE.Vector3(fx, gy + 26, fz);
    this.flames = new FlameField(world.scene, 12);
    // утечка — на одном из кустов или на шлейфе между ними
    const pi = Math.floor(rnd() * PADS.length);
    this.leak = { x: PADS[pi][0] + (rnd() - 0.5) * 24, z: PADS[pi][1] + (rnd() - 0.5) * 10, q: 4200, oil: false, checked: false };
    ctx.say("Проверка промысла: снимите горение факела с 40–150 м и найдите утечку газа по анализатору", "info");
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone } = this.ctx;
    this.flames.begin();
    for (let k = 0; k < 4; k++) this.flames.add(this.flareTop.x + Math.sin(this.time * 2 + k) * 0.6, this.flareTop.y - 0.5, this.flareTop.z + Math.cos(this.time * 1.7 + k) * 0.6, 4 + k, 11 + Math.sin(this.time * 4 + k) * 2, 1);
    this.flames.end(dt, this.ctx.camPos());
    const agl = this.agl();
    const c = 1.9 + plumePpm(this.leak, drone.pos, drone.windNow, agl);
    this.ppm += (c * (0.95 + Math.random() * 0.1) - this.ppm) * Math.min(1, dt * 2.5);
    this.peak = Math.max(this.peak, this.ppm);
    // тепловое излучение факела
    const df = drone.pos.distanceTo(this.flareTop.clone().setY(this.flareTop.y + 6));
    if (df < 22) {
      if (this.heat === 0) this.ctx.say("ОПАСНО: тепловое излучение факела! Отходите дальше 25 м", "warn");
      this.heat += dt;
      if (this.heat > 3) drone.crashed = "Аппарат перегрелся у факела";
    } else this.heat = Math.max(0, this.heat - dt);
    if (!action.pressed || drone.landed) return;
    const err = frameCheck(this.ctx, this.flareTop.clone().setY(this.flareTop.y + 5), 40, 150, "факел");
    if (err === null) {
      if (!this.flareShot) this.ctx.say("Факел снят: горение устойчивое, без сажи — сжигание в норме", "good");
      this.flareShot = true;
    } else if (Math.hypot(drone.pos.x - this.leak.x, drone.pos.z - this.leak.z) < 14 && agl < 25) {
      if (!this.found) this.ctx.say(`Утечка найдена: негерметичный фланец, ${Math.round(this.ppm)} ppm. Бригада вызвана`, "good");
      this.found = true;
    } else this.ctx.say(this.ppm > 60 ? `Газ рядом (${Math.round(this.ppm)} ppm) — снижайтесь до 25 м и ищите источник` : err, "warn");
    if (!this.tasksDone && this.flareShot && this.found) {
      this.tasksDone = true;
      this.ctx.say("Обследование промысла завершено! Возвращайтесь на базу", "good");
    }
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [
      { text: "Снять горение факела", done: this.flareShot },
      { text: "Найти утечку газа", done: this.found, progress: `CH₄ ${Math.round(this.ppm)} ppm` },
    ];
  }
  summary() {
    return { score: clamp(100 - Math.max(0, this.time - 300) / 5, 10, 100), rows: [["Пик концентрации", `${Math.round(this.peak)} ppm`], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) {
    PADS.forEach(([x, z]) => m.rect(x - 18, z - 8, x + 18, z + 8, "#9aa3ab"));
    m.dot(this.flareTop.x, this.flareTop.z, "#ff8800", 4);
    if (this.found) m.dot(this.leak.x, this.leak.z, "#ff4444", 5);
  }
  dispose() { this.flames.dispose(); }
}

// ───────────────────────────── 13. Рыбаки на льдине ─────────────────────────────

class FloeRescueMission extends Mission {
  private floe: THREE.Group;
  private s = -420;
  private r = 9;
  private drops: Drops;
  private ok = 0; private lost = 0; private found = false;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world } = ctx;
    this.floe = new THREE.Group();
    const ice = new THREE.Mesh(new THREE.CylinderGeometry(this.r, this.r * 0.95, 0.6, 9), std(0xe8f0f6, 0.5));
    ice.castShadow = true; ice.receiveShadow = true;
    this.floe.add(ice);
    for (let k = 0; k < 2; k++) {
      const p = makePerson(k ? 0x2b6fd9 : 0x6b8e23);
      p.position.set(k * 2 - 1, 0.3, 1);
      this.floe.add(p);
    }
    const sled = boxMesh(0.7, 0.3, 1.6, std(0x9a3a2a, 0.7), 2.5, 0.45, -2);
    this.floe.add(sled, boxMesh(0.05, 0.9, 0.05, std(0x333333), -2, 0.75, -1));
    world.scene.add(this.floe);
    world.addThermal(this.floe, 0.05);
    this.floe.traverse((o) => { if (o.parent && o.parent !== this.floe && (o as THREE.Mesh).isMesh) world.addThermal(o, 0.95); });
    this.drops = new Drops(ctx, makeLifebuoy, (x, z) => {
      const c = this.floe.position;
      return Math.hypot(x - c.x, z - c.z) < this.r ? c.y + 0.3 : (world.waterLevel ?? 0);
    }, (p, g) => {
      const c = this.floe.position, d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < this.r) {
        this.ok++;
        this.floe.attach(g);
        this.ctx.say(this.ok === 1 ? "Круг и рация на льдине! Рыбаки на связи" : "Второй комплект у рыбаков. МЧС выдвигается на катере", "good");
      } else { this.lost++; this.ctx.say(`Мимо: ${(d - this.r).toFixed(1)} м от кромки, комплект унесло течением`, "warn"); }
    });
    this.capacity = 3; this.amount = 3;
    ctx.say("Рыбаков унесло на льдине вниз по Вычегде. Найдите их и сбросьте спасательные комплекты на лёд", "info");
  }

  update(dt: number, action: Action) {
    this.time += dt;
    const { world, drone } = this.ctx;
    this.s += 0.55 * dt;
    const x = this.s, z = world.riverZ(x) + Math.sin(this.time * 0.05) * 6;
    this.floe.position.set(x, (world.waterLevel ?? 0) + 0.05, z);
    this.floe.rotation.y += 0.02 * dt;
    if (!this.found && drone.pos.distanceTo(this.floe.position) < 70 && this.ctx.camDir().dot(this.floe.position.clone().sub(drone.pos).normalize()) > 0.85) {
      this.found = true;
      this.ctx.say("Вижу льдину с двумя рыбаками! Зайдите против ветра и сбрасывайте (ПРОБЕЛ)", "good");
    }
    if (action.pressed && !drone.landed) {
      if (this.amount <= 0) this.ctx.say("Комплекты закончились — пополните на базе", "warn");
      else { this.amount--; this.drops.drop(); }
    }
    this.drops.update(dt);
    drone.payload = this.amount * 1.2;
    if (!this.tasksDone && this.ok >= 2) { this.tasksDone = true; this.ctx.say("Рыбаки обеспечены. Сопровождение передано катеру МЧС — возвращайтесь", "good"); }
    if (this.s > 520 && !this.tasksDone) this.failed = "Льдину вынесло на перекат раньше, чем рыбаки получили помощь";
  }
  objectives(): Objective[] {
    return [
      { text: "Найти рыбаков на льдине", done: this.found },
      { text: "Сбросить два комплекта на льдину", done: this.ok >= 2, progress: `${this.ok}/2` },
    ];
  }
  summary() {
    return { score: clamp(100 - this.lost * 12 - Math.max(0, this.time - 240) / 4, 10, 100), rows: [["Комплектов на льду", String(this.ok)], ["Мимо", String(this.lost)], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { if (this.found) m.dot(this.floe.position.x, this.floe.position.z, "#ff4444", 5); else m.ring(-250, this.ctx.world.riverZ(-250), 220, "#ffd700"); }
}

// ───────────────────────────── 14. ДТП на трассе: дефибриллятор ─────────────────────────────

const HIGHWAY: [number, number][] = [[-650, 60], [-300, -40], [0, -120], [260, -260], [420, -520], [520, -760]];

class AedMission extends Mission {
  private road!: ReturnType<typeof makeRoad>;
  private crashS: number; private crash!: THREE.Vector3;
  private amb!: THREE.Group; private ambS = 0;
  private delivered = false; private ambArrived = false; private timer = 0; private margin = 0;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    this.road = makeRoad(world, HIGHWAY, 8);
    this.crashS = this.road.length * (0.66 + rnd() * 0.12);
    this.crash = this.road.at(this.crashS);
    const dir = this.road.dirAt(this.crashS);
    const c1 = makeCar(0x8a1a1a); c1.rotation.set(0.25, dir + 0.9, 0.35);
    this.place(c1, this.crash.x + Math.cos(dir) * 5, this.crash.z - Math.sin(dir) * 5, 0.2);
    const c2 = makeCar(0x2a4a8a); c2.rotation.y = dir + 0.3;
    this.place(c2, this.crash.x - Math.cos(dir) * 1.5, this.crash.z + Math.sin(dir) * 1.5);
    for (const k of [0, 1]) { const p = makePerson(k ? 0xd9b02b : 0x333333); this.place(p, this.crash.x + 2 + k, this.crash.z + 3); world.addThermal(p, 1); }
    world.addThermal(c1, 0.55); world.addThermal(c2, 0.5);
    const beam = makeBeam(0xff4444, 110, 2);
    beam.position.set(this.crash.x, this.crash.y + 55, this.crash.z);
    world.scene.add(beam);
    this.amb = makeVan();
    world.scene.add(this.amb);
    this.capacity = 1; this.amount = 1;
    const eta = this.crashS / 15;
    ctx.say(`ДТП на трассе Сыктывкар — Ухта, остановка сердца. Скорая будет через ${Math.round(eta / 60)} мин. Доставьте дефибриллятор: посадка рядом с машинами`, "info");
  }

  update(dt: number) {
    this.time += dt;
    const { drone } = this.ctx;
    // скорая едет по трассе со средней скоростью 54 км/ч
    if (!this.ambArrived) {
      this.ambS = Math.min(this.crashS - 12, this.ambS + 15 * dt);
      if (this.ambS >= this.crashS - 12) { this.ambArrived = true; this.ctx.say(this.delivered ? "Скорая прибыла, дефибриллятор уже был на месте" : "Скорая прибыла раньше дрона", this.delivered ? "good" : "warn"); }
    }
    const p = this.road.at(Math.max(0, this.ambS));
    this.amb.position.copy(p);
    this.amb.rotation.y = this.road.dirAt(this.ambS) + Math.PI;
    drone.payload = this.delivered ? 0 : 1.2;
    if (this.delivered) return;
    const d = Math.hypot(drone.pos.x - this.crash.x, drone.pos.z - this.crash.z);
    if (drone.landed && d < 12) {
      this.timer += dt;
      if (this.timer > 1) {
        this.delivered = true; this.tasksDone = true; this.amount = 0;
        this.margin = (this.crashS - 12 - this.ambS) / 15;
        this.ctx.say(this.margin > 0 ? `Дефибриллятор у очевидцев за ${Math.round(this.margin)} с до скорой — каждая минута повышает шанс на выживание` : "Дефибриллятор доставлен", "good");
      }
    } else this.timer = 0;
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [{ text: "Доставить дефибриллятор раньше скорой", done: this.delivered, progress: this.delivered ? undefined : `скорая через ${Math.max(0, Math.round((this.crashS - 12 - this.ambS) / 15))} с` }];
  }
  summary() {
    return { score: this.delivered ? clamp(40 + this.margin / 3, 10, 100) : 10, rows: [["Выигрыш у скорой", this.delivered ? `${Math.round(this.margin)} с` : "—"], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) {
    for (let s = 0; s < this.road.length; s += 25) { const p = this.road.at(s); m.dot(p.x, p.z, "#666a70", 1.4); }
    m.dot(this.crash.x, this.crash.z, "#ff4444", 5);
    m.dot(this.amb.position.x, this.amb.position.z, "#ffffff", 3.5);
  }
}

// ───────────────────────────── 15. Почта по сёлам ─────────────────────────────

const STOPS: { x: number; z: number; name: string }[] = [
  { x: -380, z: -300, name: "Чукчино" }, { x: 120, z: -560, name: "Окунев Нос" }, { x: 430, z: -250, name: "Загривочная" }, { x: 300, z: 230, name: "Филипповская" },
];

class PostMission extends Mission {
  private done: boolean[] = STOPS.map(() => false);
  private timer = 0; private swaps = 0; private wasAway = false;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world } = ctx;
    STOPS.forEach((s, i) => {
      const pad = makeHelipad(String(i + 1), "#3aa0ff");
      this.place(pad, s.x, s.z);
      const beam = makeBeam(0x3aa0ff, 90, 1.6);
      beam.position.set(s.x, world.groundAt(s.x, s.z) + 45, s.z);
      beam.name = `beam${i}`;
      world.scene.add(beam);
      const r = mulberry32(31 + i);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * 6.28 + 0.5, d = 18 + r() * 14;
        const h = makeHouse(r, false);
        h.rotation.y = r() * 3;
        this.place(h, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d);
        world.addThermal(h, 0.3);
      }
    });
    this.capacity = 4; this.amount = 4;
    ctx.say("Почта Усть-Цилемского района: 4 посылки в 4 села. Порядок облёта — на ваше усмотрение, следите за батареей", "info");
  }

  update(dt: number) {
    this.time += dt;
    const { drone, world } = this.ctx;
    drone.payload = this.amount * 0.9;
    if (Math.hypot(drone.pos.x, drone.pos.z) > 30) this.wasAway = true;
    if (drone.landed && Math.hypot(drone.pos.x, drone.pos.z) < 5 && this.wasAway && drone.soc > 0.97) { this.swaps++; this.wasAway = false; }
    if (!drone.landed) { this.timer = 0; return; }
    STOPS.forEach((s, i) => {
      if (this.done[i] || Math.hypot(drone.pos.x - s.x, drone.pos.z - s.z) > 4) return;
      this.timer += dt;
      if (this.timer > 1.5) {
        this.done[i] = true; this.amount--; this.timer = 0;
        const b = world.scene.getObjectByName(`beam${i}`);
        if (b) b.visible = false;
        const left = this.done.filter((v) => !v).length;
        this.ctx.say(`${s.name}: посылка вручена${left ? `, осталось ${left}` : ". Все доставлены — возвращайтесь"}`, "good");
        if (!left) this.tasksDone = true;
      }
    });
  }
  refill() { return false; }
  objectives(): Objective[] {
    const n = this.done.filter(Boolean).length;
    return [{ text: "Доставить посылки во все сёла", done: n === STOPS.length, progress: `${n}/${STOPS.length}` }];
  }
  summary() {
    return { score: clamp(100 - Math.max(0, this.time - 420) / 6 - this.swaps * 6, 10, 100), rows: [["Доставлено", `${this.done.filter(Boolean).length}/${STOPS.length}`], ["Замен батареи", String(this.swaps)], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { STOPS.forEach((s, i) => m.dot(s.x, s.z, this.done[i] ? "#00ffaa" : "#3aa0ff", 5)); }
}

// ───────────────────────────── 16. Аэрофотосъёмка для кадастра ─────────────────────────────

const AREA = { x: 0, z: -260, hx: 110, hz: 80 };

class MappingMission extends Mission {
  private cs = 4; private nx: number; private nz: number;
  private hits: Uint8Array;
  private lastShot = new THREE.Vector3(1e9, 0, 0);
  private shots = 0; private rejected = 0; private warnT = -10;

  constructor(ctx: Ctx) {
    super(ctx);
    const r = mulberry32(19);
    for (let k = 0; k < 14; k++) {
      const h = makeHouse(r, false);
      h.rotation.y = Math.floor(r() * 4) * Math.PI / 2;
      this.place(h, AREA.x - 80 + (k % 5) * 40 + (r() - 0.5) * 8, AREA.z - 50 + Math.floor(k / 5) * 50 + (r() - 0.5) * 8);
      ctx.world.addThermal(h, 0.3);
    }
    this.nx = Math.round((AREA.hx * 2) / this.cs); this.nz = Math.round((AREA.hz * 2) / this.cs);
    this.hits = new Uint8Array(this.nx * this.nz);
    ctx.say("Ортофотоплан села: держите ПРОБЕЛ — автоспуск каждые 15 м. Высота 50–100 м, камера вниз, галсы с перекрытием", "info");
  }

  private coverage() { let n = 0; for (const h of this.hits) if (h >= 2) n++; return n / this.hits.length; }

  update(dt: number, action: Action) {
    this.time += dt;
    const { drone } = this.ctx;
    if (!action.held || drone.landed) return;
    if (drone.pos.distanceTo(this.lastShot) < 15) return;
    const agl = this.agl(), dir = this.ctx.camDir();
    if (agl < 50 || agl > 100 || dir.y > -0.9 || Math.abs(drone.vel.y) > 2) {
      this.rejected++;
      this.lastShot.copy(drone.pos);
      if (this.time - this.warnT > 4) { this.warnT = this.time; this.ctx.say(dir.y > -0.9 ? "Камера должна смотреть вниз (G)" : `Кадр отбракован: высота ${agl.toFixed(0)} м, нужно 50–100 м ровно`, "warn"); }
      return;
    }
    this.lastShot.copy(drone.pos); this.shots++;
    const hx = agl * 0.634, hz = agl * 0.466, c = Math.cos(drone.yaw), s = Math.sin(drone.yaw);
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const x = AREA.x - AREA.hx + (ix + 0.5) * this.cs - drone.pos.x, z = AREA.z - AREA.hz + (iz + 0.5) * this.cs - drone.pos.z;
      const lx = x * c - z * s, lz = x * s + z * c;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) { const k = iz * this.nx + ix; if (this.hits[k] < 9) this.hits[k]++; }
    }
    if (!this.tasksDone && this.coverage() >= 0.9) { this.tasksDone = true; this.ctx.say("Покрытие 90% с перекрытием — ортофотоплан соберётся. Возвращайтесь", "good"); }
  }
  refill() { return false; }
  objectives(): Objective[] {
    return [{ text: "Покрыть село снимками с перекрытием ×2", done: this.tasksDone, progress: `${Math.round(this.coverage() * 100)}%` }];
  }
  summary() {
    return { score: clamp(this.coverage() * 100 - this.rejected * 0.5 - Math.max(0, this.time - 420) / 8, 10, 100), rows: [["Покрытие", `${Math.round(this.coverage() * 100)}%`], ["Кадров", String(this.shots)], ["Отбраковано", String(this.rejected)], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) {
    m.rect(AREA.x - AREA.hx, AREA.z - AREA.hz, AREA.x + AREA.hx, AREA.z + AREA.hz, "#ffd700");
    const st = 3;
    for (let iz = 0; iz < this.nz; iz += st) for (let ix = 0; ix < this.nx; ix += st) {
      const h = this.hits[iz * this.nx + ix];
      if (!h) continue;
      const x = AREA.x - AREA.hx + ix * this.cs, z = AREA.z - AREA.hz + iz * this.cs;
      m.rect(x, z, x + st * this.cs, z + st * this.cs, h >= 2 ? "rgba(0,255,170,0.55)" : "rgba(255,215,0,0.4)", true);
    }
  }
}

// ───────────────────────────── 17. Обработка от клещей ─────────────────────────────

const CAMP = { x: 0, z: -170, hx: 50, hz: 32 };

class TickMission extends AgroMission {
  constructor(ctx: Ctx) {
    super(ctx, CAMP, false);
    const r = mulberry32(23);
    for (const [x, z] of [[-70, -150], [70, -190], [-20, -230], [40, -120]]) {
      const h = makeHouse(r, false);
      h.rotation.y = r() * 3;
      this.place(h, x, z);
      ctx.world.addThermal(h, 0.3);
    }
    const sign = makeSign(["БАЗА ОТДЫХА «ПАРМА»", "акарицидная обработка", "вход до 3 суток запрещён"], "#fff7d6");
    this.place(sign, CAMP.x - CAMP.hx - 4, CAMP.z + CAMP.hz);
    ctx.say("Обработка территории базы отдыха от клещей. Между деревьями — осторожно, высота 2–5 м", "info");
  }
}

// ───────────────────────────── 18. Медведь у посёлка ─────────────────────────────

const SETTLE = { x: 0, z: -230 };

class BearMission extends Mission {
  private bear: THREE.Group;
  private head: number;
  private found = false; private tracked = 0; private seen = 0;

  constructor(ctx: Ctx) {
    super(ctx);
    const { world, rnd } = ctx;
    const r = mulberry32(41);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * 6.28, d = 18 + r() * 26;
      const h = makeHouse(r, false);
      h.rotation.y = r() * 3;
      this.place(h, SETTLE.x + Math.cos(a) * d, SETTLE.z + Math.sin(a) * d);
      world.addThermal(h, 0.4);
    }
    // уличные фонари — тёплые пятна света
    for (let k = 0; k < 4; k++) {
      const l = new THREE.PointLight(0xffc27a, 40, 40, 1.6);
      l.position.set(SETTLE.x - 30 + k * 20, world.groundAt(SETTLE.x - 30 + k * 20, SETTLE.z) + 6, SETTLE.z + 4);
      world.scene.add(l);
    }
    const a = rnd() * 6.28;
    this.bear = makeAnimal("bear");
    this.place(this.bear, SETTLE.x + Math.cos(a) * 230, SETTLE.z + Math.sin(a) * 230);
    world.addThermal(this.bear, 1);
    this.head = Math.atan2(SETTLE.x - this.bear.position.x, SETTLE.z - this.bear.position.z);
    ctx.say("Ночь. Жители видели медведя у окраины. Найдите его тепловизором (T) и отгоните от домов, держите в кадре", "info");
  }

  update(dt: number) {
    this.time += dt;
    const { drone, world } = this.ctx;
    const b = this.bear.position;
    const dx = b.x - drone.pos.x, dz = b.z - drone.pos.z, dh = Math.hypot(dx, dz);
    const toVillage = Math.atan2(SETTLE.x - b.x, SETTLE.z - b.z);
    const agl = this.agl();
    // гул винтов на малой высоте отпугивает зверя
    const hazing = dh < 40 && agl < 35 && !drone.landed;
    const want = hazing ? Math.atan2(dx, dz) : toVillage + Math.sin(this.time * 0.2) * 0.8;
    this.head += Math.atan2(Math.sin(want - this.head), Math.cos(want - this.head)) * Math.min(1, dt * (hazing ? 2 : 0.4));
    const sp = hazing ? 4.5 : 0.9;
    b.x += Math.sin(this.head) * sp * dt; b.z += Math.cos(this.head) * sp * dt;
    const play = this.bear.userData.play as ((k: string, s?: number) => void) | undefined;
    if (play) { play(hazing ? "run" : "walk", hazing ? 0.9 : 0.7); b.y = world.groundAt(b.x, b.z); }
    else b.y = world.groundAt(b.x, b.z) + Math.abs(Math.sin(this.time * sp * 2)) * 0.05;
    this.bear.rotation.y = this.head;
    if (dh < 4 && agl < 3) drone.crashed = "Медведь сбил аппарат лапой";
    const inFrame = dh < 80 && this.ctx.camDir().dot(new THREE.Vector3(b.x, b.y + 0.8, b.z).sub(drone.pos).normalize()) > 0.85;
    if (inFrame && this.ctx.thermal()) {
      this.seen += dt;
      if (!this.found && this.seen > 1.5) { this.found = true; this.ctx.say("Медведь обнаружен! Подойдите на 30 м выше крон — гул винтов отпугнёт его в лес", "good"); }
    }
    if (this.found && inFrame) this.tracked += dt;
    const dv = Math.hypot(b.x - SETTLE.x, b.z - SETTLE.z);
    if (dv < 30) this.failed = "Медведь вышел к домам";
    if (!this.tasksDone && this.found && dv > 330 && this.tracked > 40) { this.tasksDone = true; this.ctx.say("Медведь ушёл в лес. Охотнадзор уведомлён — возвращайтесь", "good"); }
  }
  refill() { return false; }
  objectives(): Objective[] {
    const dv = Math.hypot(this.bear.position.x - SETTLE.x, this.bear.position.z - SETTLE.z);
    return [
      { text: "Найти медведя тепловизором", done: this.found },
      { text: "Отогнать от посёлка на 330 м", done: this.tasksDone, progress: `${Math.round(dv)} м` },
      { text: "Держать зверя в кадре", done: this.tracked > 40, progress: `${Math.round(this.tracked)}/40 с` },
    ];
  }
  summary() {
    return { score: clamp(100 - Math.max(0, this.time - 300) / 5, 10, 100), rows: [["Сопровождение", `${Math.round(this.tracked)} с`], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) {
    m.ring(SETTLE.x, SETTLE.z, 30, "#ffd700");
    if (this.found) m.dot(this.bear.position.x, this.bear.position.z, "#ff4444", 5);
  }
}

const corridor = PYLONS.slice(0, -1).map(([x, z], i) => ({ x1: x, z1: z, x2: PYLONS[i + 1][0], z2: PYLONS[i + 1][1], w: 17 }));

export const MISSIONS: MissionDef[] = [
  {
    id: "training", title: "Учебный полигон", place: "Сыктывдинский район, Республика Коми",
    tagline: "Взлёт, проход колец, посадка", icon: "GraduationCap", color: "#00ffaa",
    briefing: [
      "Отработка базового пилотирования перед боевыми выездами.",
      "Пройдите шесть колец на разных высотах и посадите аппарат на площадку «H».",
      "Попробуйте разные схемы: квадрокоптер резвый, октокоптер инертный — разница чувствуется сразу.",
    ],
    actionLabel: "—", recommended: ["quad"],
    world: {
      seed: 11, size: 1400, relief: 9, river: { z0: 270, amp: 50, wl: 230, width: 14 }, flats: [BASE_FLAT],
      clearings: GATES.map(([x, , z]) => ({ x, z, r: 26 })), forestDensity: 0.4, palette: SUMMER,
    },
    wind: { toDeg: 70, speed: 3, gust: 0.3 }, gimbalPitch: -90, pip: false, payloadLabel: "Груз", payloadUnit: "",
    create: (c) => new TrainingMission(c),
  },
  {
    id: "fire", title: "Лесной пожар", place: "Троицко-Печорский район, Республика Коми",
    tagline: "Тушение очага в тайге до подхода к посёлку", icon: "Flame", color: "#ff6a10",
    briefing: [
      "Сухая гроза подожгла ельник в 400 м к северу от лагеря. Ветер западный — огонь идёт на посёлок лесозаготовителей.",
      "Сбрасывайте воду на кромку пожара с подветренной стороны, воду забирайте зависанием над рекой (ниже 5 м).",
      "Над очагом мощные восходящие потоки, ниже 12 м аппарат перегревается. Дым тепловизору не помеха.",
    ],
    actionLabel: "Сброс воды", recommended: ["octo", "coax"],
    world: {
      seed: 23, size: 1400, relief: 13, river: { z0: -170, amp: 42, wl: 240, width: 16 },
      flats: [BASE_FLAT, { x: VILLAGE.x, z: VILLAGE.z, rx: 46, rz: 42 }], clearings: [], forestDensity: 0.85, palette: HAZE,
    },
    wind: { toDeg: 95, speed: 5, gust: 0.35 }, gimbalPitch: -90, pip: false, payloadLabel: "Вода", payloadUnit: "л",
    create: (c) => new FireMission(c),
  },
  {
    id: "search", title: "Поиск людей в тайге", place: "Окрестности Ухты, Республика Коми",
    tagline: "Трое грибников не вышли на связь", icon: "ScanSearch", color: "#00aaff",
    briefing: [
      "Вечер, туман, видимость 150 м. По биллингу телефонов известны три сектора вероятного нахождения.",
      "Включите тепловизор и прочёсывайте секторы с высоты 40–60 м. В лесу есть лоси и медведь — не перепутайте.",
      "Над найденным человеком сбросьте аварийный набор с рацией: он должен лечь не дальше 15 м.",
    ],
    actionLabel: "Сброс набора", recommended: ["hexa", "quad"],
    world: {
      seed: 37, size: 1400, relief: 15, river: { z0: 280, amp: 45, wl: 210, width: 13 }, flats: [BASE_FLAT],
      clearings: [], forestDensity: 0.95, palette: DUSK_FOG,
    },
    wind: { toDeg: 200, speed: 3, gust: 0.3 }, gimbalPitch: -90, pip: true, payloadLabel: "Наборы", payloadUnit: "шт",
    create: (c) => new SearchMission(c),
  },
  {
    id: "agro", title: "Агромиссия", place: "Сысольский район, Республика Коми",
    tagline: "Опрыскивание 1,1 га посевов", icon: "Sprout", color: "#9be05a",
    briefing: [
      "Поле 140×80 м нужно обработать от фитофтороза. Норма — 10 л/га, расход регулируется автоматически по скорости.",
      "Летите параллельными галсами на высоте 2–5 м. Пропуски и двойные перекрытия снижают оценку.",
      "К северу река: в 30-метровой водоохранной зоне распылять запрещено. Заправка бака — посадкой на базу.",
    ],
    actionLabel: "Опрыскивание", recommended: ["octo", "coax", "hexa"],
    world: {
      seed: 41, size: 1400, relief: 5, river: { z0: -265, amp: 12, wl: 200, width: 12 },
      flats: [BASE_FLAT, { x: FIELD.x, z: FIELD.z, rx: FIELD.hx + 8, rz: FIELD.hz + 8 }],
      clearings: [{ x: 0, z: -60, r: 60 }], forestDensity: 0.3, palette: SUMMER,
    },
    wind: { toDeg: 20, speed: 2.5, gust: 0.3 }, gimbalPitch: -90, pip: false, payloadLabel: "Препарат", payloadUnit: "л",
    create: (c) => new AgroMission(c),
  },
  {
    id: "delivery", title: "Санитарная доставка", place: "Усть-Цилемский район, Республика Коми",
    tagline: "Медикаменты в деревню, отрезанную ледоходом", icon: "HeartPulse", color: "#ff4444",
    briefing: [
      "Переправу через Печору снесло, вертолёт не поднять по погоде. В фельдшерском пункте ждут 1,5 кг препаратов.",
      "650 м через реку при порывистом северо-западном ветре. Сядьте на площадку с красным крестом — груз заберут.",
      "Следите за батареей: обратно лететь против ветра. Оценка зависит от точности посадки.",
    ],
    actionLabel: "—", recommended: ["quad", "coax"],
    world: {
      seed: 53, size: 1700, relief: 16, river: { z0: -330, amp: 55, wl: 230, width: 30 },
      flats: [BASE_FLAT, { x: HAMLET.x, z: HAMLET.z, rx: 52, rz: 48 }], clearings: [], forestDensity: 0.65, palette: WINTER,
    },
    wind: { toDeg: 135, speed: 7, gust: 0.5 }, gimbalPitch: -90, pip: false, payloadLabel: "Груз", payloadUnit: "",
    create: (c) => new DeliveryMission(c),
  },
  {
    id: "powerline", title: "Обследование ЛЭП", place: "ВЛ 110 кВ, район Сосногорска, Республика Коми",
    tagline: "Фотофиксация опор и поиск перегрева", icon: "Zap", color: "#ffd700",
    briefing: [
      "После ледяного дождя участок линии даёт потери. Нужно снять траверсы шести опор и найти греющийся контакт.",
      "Подлетайте к верхушке опоры на 5–22 м, наведите нос и зависните. Один из снимков должен быть в тепловизоре.",
      "Провода почти не видны — держитесь сбоку от линии и не пролетайте между опорами ниже 30 м.",
    ],
    actionLabel: "Снимок", recommended: ["quad", "hexa"],
    world: {
      seed: 67, size: 1400, relief: 11, river: { z0: 330, amp: 40, wl: 220, width: 13 },
      flats: [BASE_FLAT, ...PYLONS.map(([x, z]) => ({ x, z, rx: 6, rz: 6 }))],
      clearings: [], corridors: corridor, forestDensity: 0.8, palette: OVERCAST,
    },
    wind: { toDeg: 250, speed: 4, gust: 0.4 }, gimbalPitch: -6, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new PowerlineMission(c),
  },
  {
    id: "oil", title: "Утечка на нефтепроводе", place: "Усинский район, Республика Коми",
    tagline: "Поиск порыва по газоанализатору", icon: "Droplets", color: "#c084fc",
    briefing: [
      "Диспетчер видит падение давления на участке промыслового нефтепровода. Где порыв — неизвестно, трасса идёт через болота.",
      "На дроне газоанализатор метана. Летите низко (до 20 м) вдоль трубы и следите за ppm: рост концентрации — вы в шлейфе. Шлейф сносит ветром, идите против него к источнику.",
      "Не путайте с болотным газом: там метан есть, а нефти нет. Найдя пятно, наведите камеру вниз и сделайте снимок — координаты уйдут аварийной бригаде.",
    ],
    actionLabel: "Снимок", recommended: ["hexa", "quad"],
    world: {
      seed: 83, size: 1500, relief: 6, river: { z0: -480, amp: 50, wl: 200, width: 12 }, flats: [BASE_FLAT],
      clearings: [], corridors: pipeCorridor, forestDensity: 0.22, palette: TUNDRA,
    },
    wind: { toDeg: 60, speed: 4, gust: 0.35 }, gimbalPitch: -90, pip: true, payloadLabel: "Датчик", payloadUnit: "",
    create: (c) => new OilLeakMission(c),
  },
  {
    id: "reindeer", title: "Учёт оленей", place: "Тундра под Интой, Республика Коми",
    tagline: "Аэрофотоучёт стада без беспокойства животных", icon: "Binoculars", color: "#f5c27a",
    briefing: [
      "Оленеводческий кооператив просит пересчитать стадо после летнего выпаса: часть оленей могла отбиться.",
      "Снимайте стадо сверху, камера строго вниз, высота 25–130 м. Олени в кадре засчитываются; чем выше — тем шире кадр, но тем легче пропустить отставших.",
      "Ниже 30 м над стадом олени пугаются и разбегаются — это вред хозяйству и штраф к оценке.",
    ],
    actionLabel: "Кадр", recommended: ["quad", "hexa"],
    world: {
      seed: 97, size: 1500, relief: 7, river: { z0: 520, amp: 40, wl: 230, width: 10 }, flats: [BASE_FLAT],
      clearings: [], forestDensity: 0.06, palette: TUNDRA,
    },
    wind: { toDeg: 200, speed: 6, gust: 0.4 }, gimbalPitch: -90, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new ReindeerMission(c),
  },
  {
    id: "heat", title: "Тепловизионный аудит", place: "Эжва, Сыктывкар, Республика Коми",
    tagline: "Поиск теплопотерь в частном секторе", icon: "ThermometerSnowflake", color: "#ff7a59",
    briefing: [
      "Управляющая компания проверяет квартал частных домов перед морозами: где уходит тепло — через кровлю, окна, промёрзшие углы, где течёт теплотрасса.",
      "Морозный вечер, −27 °C: в тепловизоре (T) тёплые места светятся. Снимите каждый из 12 домов с 10–45 м, дом должен быть в кадре.",
      "Над крышами печные дымы — не задерживайтесь в них, а провода и антенны во дворах держите в поле зрения.",
    ],
    actionLabel: "Снимок", recommended: ["quad", "hexa"],
    world: {
      seed: 101, size: 1400, relief: 5, river: { z0: 360, amp: 30, wl: 240, width: 18 },
      flats: [BASE_FLAT, { x: BLOCK.x, z: BLOCK.z, rx: 80, rz: 66 }], clearings: [], forestDensity: 0.5, palette: WINTER_EVENING,
    },
    wind: { toDeg: 110, speed: 3, gust: 0.3 }, gimbalPitch: -25, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new HeatAuditMission(c),
  },
  {
    id: "icejam", title: "Ледоход на Печоре", place: "Усть-Цилемский район, Республика Коми",
    tagline: "Затор, гидропосты и подтопленная деревня", icon: "Waves", color: "#7dd3fc",
    briefing: [
      "Начался ледоход. Ниже по течению льдины встали затором — вода быстро поднимается, деревня на низком берегу уже в воде.",
      "Найдите затор и снимите его с 25–140 м, снимите подтопленную деревню и считайте показания трёх гидропостов (рейки у берега, 6–35 м).",
      "Вдоль реки дует порывистый ветер, над ледяным полем тянет холодом — следите за батареей.",
    ],
    actionLabel: "Снимок", recommended: ["quad", "hexa"],
    world: { seed: 113, size: 1500, relief: 8, river: ICE_RIVER, flats: [BASE_FLAT], clearings: [], forestDensity: 0.55, palette: SPRING },
    wind: { toDeg: 80, speed: 6, gust: 0.45 }, gimbalPitch: -25, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new IceJamMission(c),
  },
  {
    id: "logging", title: "Незаконная рубка", place: "Корткеросский район, Республика Коми",
    tagline: "Поиск вырубки и фиксация техники", icon: "Axe", color: "#a3e635",
    briefing: [
      "В лесничество пришла жалоба: в квадрате к северу слышали работу техники. Разрешена там только одна лесосека.",
      "Найдите свежую вырубку (сверху её видно как светлую поляну с пнями, в тепловизоре — по тёплому двигателю), снимите её сверху и технику — сбоку.",
      "Не перепутайте с законной лесосекой: у неё аншлаг с номером лесорубочного билета.",
    ],
    actionLabel: "Снимок", recommended: ["quad", "hexa"],
    world: { seed: 127, size: 1400, relief: 12, river: { z0: 320, amp: 40, wl: 220, width: 13 }, flats: [BASE_FLAT], clearings: [], forestDensity: 0.95, palette: OVERCAST },
    wind: { toDeg: 150, speed: 3, gust: 0.3 }, gimbalPitch: -90, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new LoggingMission(c),
  },
  {
    id: "gas", title: "Газовый промысел", place: "Вуктыльское месторождение, Республика Коми",
    tagline: "Факел и поиск утечки газа", icon: "Factory", color: "#fb923c",
    briefing: [
      "Плановый облёт кустов газовых скважин: проверить горение факела и найти утечку — операторы видят падение давления на шлейфе.",
      "Факел снимайте с 40–150 м; ближе 25 м тепловое излучение опасно для дрона.",
      "Утечку ищите газоанализатором на высоте до 25 м: шлейф метана сносит ветром.",
    ],
    actionLabel: "Снимок", recommended: ["hexa", "quad"],
    world: {
      seed: 131, size: 1400, relief: 10, river: { z0: 340, amp: 40, wl: 220, width: 14 },
      flats: [BASE_FLAT, ...PADS.map(([x, z]) => ({ x, z, rx: 24, rz: 14 })), { x: PADS[0][0] + 45, z: PADS[0][1] - 30, rx: 10, rz: 10 }],
      clearings: [], corridors: pathCorridor(GAS_PIPE, 9), forestDensity: 0.6, palette: OVERCAST,
    },
    wind: { toDeg: 30, speed: 4, gust: 0.35 }, gimbalPitch: -20, pip: true, payloadLabel: "Датчик", payloadUnit: "",
    create: (c) => new GasFieldMission(c),
  },
  {
    id: "floe", title: "Рыбаки на льдине", place: "Вычегда у Сыктывкара, Республика Коми",
    tagline: "Сброс спасательных комплектов на дрейфующий лёд", icon: "LifeBuoy", color: "#38bdf8",
    briefing: [
      "Весенний лёд оторвался от берега, двух рыбаков уносит вниз по реке. Катер МЧС выйдет через 15 минут, связи с рыбаками нет.",
      "Найдите льдину и сбросьте на неё два комплекта: спасательный круг и рацию. Комплект на парашюте сносит ветром — делайте поправку.",
      "Если льдину вынесет на перекат раньше, чем рыбаки получат помощь, — задача провалена.",
    ],
    actionLabel: "Сброс", recommended: ["hexa", "coax"],
    world: { seed: 137, size: 1500, relief: 7, river: { z0: -150, amp: 40, wl: 240, width: 44 }, flats: [BASE_FLAT], clearings: [], forestDensity: 0.6, palette: SPRING },
    wind: { toDeg: 100, speed: 5, gust: 0.4 }, gimbalPitch: -45, pip: true, payloadLabel: "Комплекты", payloadUnit: "шт",
    create: (c) => new FloeRescueMission(c),
  },
  {
    id: "aed", title: "Дефибриллятор к ДТП", place: "Трасса Сыктывкар — Ухта, Республика Коми",
    tagline: "Обогнать скорую с АНД на борту", icon: "Siren", color: "#f43f5e",
    briefing: [
      "ДТП на трассе, у водителя остановка сердца. Скорая выехала, но ей ехать больше 10 км по разбитой дороге.",
      "Доставьте автоматический дефибриллятор: посадка у машин (до 12 м), очевидцы заберут его и начнут реанимацию.",
      "Над трассой нет леса — летите напрямую, но помните про ветер и запас батареи.",
    ],
    actionLabel: "—", recommended: ["quad"],
    world: { seed: 149, size: 1600, relief: 10, flats: [BASE_FLAT], clearings: [], corridors: pathCorridor(HIGHWAY, 15), forestDensity: 0.75, palette: SUMMER },
    wind: { toDeg: 240, speed: 4, gust: 0.4 }, gimbalPitch: -30, pip: false, payloadLabel: "Груз", payloadUnit: "",
    create: (c) => new AedMission(c),
  },
  {
    id: "post", title: "Почта по сёлам", place: "Усть-Цилемский район, Республика Коми",
    tagline: "Маршрут на четыре села с одной зарядки", icon: "Mail", color: "#3aa0ff",
    briefing: [
      "Дороги размыло, почту в отдалённые сёла везёт дрон. Четыре посылки — в Чукчино, Окунев Нос, Загривочную и Филипповскую.",
      "Садитесь на площадку с номером села (до 4 м) и ждите выгрузки. Порядок облёта выбирайте сами: с каждой посылкой аппарат легчает.",
      "Каждая замена батареи на базе снижает оценку — планируйте маршрут.",
    ],
    actionLabel: "—", recommended: ["hexa", "quad"],
    world: {
      seed: 151, size: 1500, relief: 9, river: { z0: -80, amp: 60, wl: 240, width: 22 },
      flats: [BASE_FLAT, ...STOPS.map((s) => ({ x: s.x, z: s.z, rx: 30, rz: 30 }))], clearings: [], forestDensity: 0.6, palette: SUMMER,
    },
    wind: { toDeg: 300, speed: 5, gust: 0.4 }, gimbalPitch: -30, pip: false, payloadLabel: "Посылки", payloadUnit: "шт",
    create: (c) => new PostMission(c),
  },
  {
    id: "mapping", title: "Ортофотоплан села", place: "Сысольский район, Республика Коми",
    tagline: "Аэрофотосъёмка для кадастра", icon: "Grid3x3", color: "#facc15",
    briefing: [
      "Администрации нужен свежий ортофотоплан села для уточнения границ участков.",
      "Держите ПРОБЕЛ — камера снимает каждые 15 м. Высота строго 50–100 м, камера вниз, без резких наборов.",
      "Каждая точка должна попасть минимум в два кадра (перекрытие). Летайте параллельными галсами — так и снимают настоящие планы.",
    ],
    actionLabel: "Съёмка", recommended: ["quad", "hexa"],
    world: {
      seed: 157, size: 1400, relief: 6, river: { z0: 260, amp: 30, wl: 220, width: 14 },
      flats: [BASE_FLAT, { x: AREA.x, z: AREA.z, rx: AREA.hx + 10, rz: AREA.hz + 10 }], clearings: [], forestDensity: 0.5, palette: SUMMER,
    },
    wind: { toDeg: 200, speed: 4, gust: 0.35 }, gimbalPitch: -90, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new MappingMission(c),
  },
  {
    id: "ticks", title: "Обработка от клещей", place: "База отдыха под Сыктывкаром, Республика Коми",
    tagline: "Акарицидная обработка среди деревьев", icon: "Bug", color: "#4ade80",
    briefing: [
      "Перед сезоном базу отдыха нужно обработать от клещей: 0,6 га лужаек и троп между корпусами.",
      "Здесь растут деревья — летите на 2–5 м и обходите стволы. Скорость автоматически ограничивается 7 м/с при включённых форсунках.",
      "Пропуски и двойные дозы снижают оценку, заправка — на базе.",
    ],
    actionLabel: "Опрыскивание", recommended: ["hexa", "coax"],
    world: {
      seed: 163, size: 1400, relief: 5, flats: [BASE_FLAT],
      // лужайки между корпусами; деревья остаются группами по краям и между полянами
      clearings: [{ x: -28, z: -170, r: 38 }, { x: 28, z: -170, r: 38 }, { x: 0, z: -170, r: 30 }], forestDensity: 0.32, palette: SUMMER,
    },
    wind: { toDeg: 70, speed: 2, gust: 0.3 }, gimbalPitch: -90, pip: false, payloadLabel: "Препарат", payloadUnit: "л",
    create: (c) => new TickMission(c),
  },
  {
    id: "bear", title: "Медведь у посёлка", place: "Посёлок Едва, Удорский район, Республика Коми",
    tagline: "Ночной поиск с тепловизором и отпугивание", icon: "PawPrint", color: "#d6a35c",
    briefing: [
      "Ночь, жители видели медведя у окраины. Охотнадзор приедет утром, задача — увести зверя от домов без вреда.",
      "Найдите его тепловизором (T): в темноте глазом не видно. Держитесь над зверем ниже 35 м (но выше крон) — гул винтов отпугнёт его в лес.",
      "Держите зверя в кадре, пока он не уйдёт на 330 м от посёлка. Не опускайтесь ниже 3 м рядом с ним.",
    ],
    actionLabel: "—", recommended: ["quad", "hexa"],
    world: { seed: 167, size: 1400, relief: 9, flats: [BASE_FLAT, { x: SETTLE.x, z: SETTLE.z, rx: 55, rz: 55 }], clearings: [], forestDensity: 0.75, palette: NIGHT },
    wind: { toDeg: 120, speed: 2, gust: 0.3 }, gimbalPitch: -35, pip: true, payloadLabel: "Камера", payloadUnit: "",
    create: (c) => new BearMission(c),
  },
];

export const getMission = (id: string) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];

// ───────────────────────────── погода и время суток ─────────────────────────────

export type Weather = "scenario" | "clear" | "overcast" | "rain" | "snow" | "fog" | "dusk" | "night";
export const WEATHER: { id: Weather; label: string; hint: string; icon: string }[] = [
  { id: "scenario", label: "По сценарию", hint: "как в брифинге", icon: "BookOpen" },
  { id: "clear", label: "Ясно", hint: "солнце, лёгкая дымка", icon: "Sun" },
  { id: "overcast", label: "Пасмурно", hint: "рассеянный свет", icon: "Cloud" },
  { id: "rain", label: "Дождь", hint: "видимость ↓, ветер ↑, батарея −10%", icon: "CloudRain" },
  { id: "snow", label: "Снегопад", hint: "снег на земле, мороз: батарея −20%", icon: "CloudSnow" },
  { id: "fog", label: "Туман", hint: "видимость 200–300 м", icon: "CloudFog" },
  { id: "dusk", label: "Сумерки", hint: "низкое солнце, длинные тени", icon: "Sunset" },
  { id: "night", label: "Ночь", hint: "нужен тепловизор", icon: "Moon" },
];

/** Миссия с выбранной погодой: меняются небо, свет, туман, ветер, осадки и расход батареи. */
export function withWeather(def: MissionDef, w: Weather): MissionDef {
  if (w === "scenario") return def;
  const p = def.world.palette;
  let palette: Palette = p, wind = def.wind.speed, precip: MissionDef["precip"], drain = 1;
  switch (w) {
    case "clear": palette = { ...p, clouds: 0.18, fogDensity: p.fogDensity * 0.55, sunIntensity: Math.max(p.sunIntensity, 3), sunDir: [0.45, 0.75, 0.35], skyTop: 0x2f6db5, skyBottom: 0xb4cfe6, fog: 0xa9c3d8, exposure: 0.95, snow: p.snow }; break;
    case "overcast": palette = { ...p, ...OVERCAST, groundA: p.groundA, groundB: p.groundB, tree: p.tree, treeVar: p.treeVar, water: p.water, snow: p.snow, grassTint: p.grassTint }; break;
    case "rain":
      palette = { ...p, skyTop: 0x4e5a66, skyBottom: 0x8d969e, fog: 0x868f98, fogDensity: Math.max(0.0034, p.fogDensity * 1.6), sun: 0xdde4ea, sunIntensity: 1.3, ambient: 0xaab4c0, ambientIntensity: 1.05, clouds: 0.97, exposure: 1.2, hdr: "forest_slope_1k.hdr", snow: false };
      wind *= 1.35; precip = "rain"; drain = 1.1; break;
    case "snow":
      palette = { ...p, ...WINTER, fog: 0xc5ceda, fogDensity: 0.0034, clouds: 0.95, sunIntensity: 1.6, exposure: 0.9, snow: true };
      precip = "snow"; drain = 1.2; break;
    case "fog": palette = { ...p, fog: 0xa7afb6, skyBottom: 0xa7afb6, skyTop: 0x8d97a2, fogDensity: 0.0072, clouds: 0.9, sunIntensity: 1.2, exposure: 1.2, hdr: "kiara_1_dawn_1k.hdr" }; wind *= 0.5; break;
    case "dusk": palette = { ...p, sunDir: [0.75, 0.09, 0.3], sun: 0xff9a5a, sunIntensity: 2.2, skyTop: 0x2c3d66, skyBottom: 0xf0a070, fog: 0xc89278, fogDensity: p.fogDensity * 1.1, ambient: 0x9a8cb0, ambientIntensity: 0.8, clouds: 0.35, exposure: 1.2, hdr: "venice_sunset_1k.hdr" }; break;
    case "night": palette = { ...p, ...NIGHT, groundA: p.groundA, groundB: p.groundB, tree: p.tree, treeVar: p.treeVar, water: p.water, snow: p.snow, grassTint: [0.6, 0.68, 0.62] }; break;
  }
  return { ...def, world: { ...def.world, palette }, wind: { ...def.wind, speed: wind }, precip, drain };
}
