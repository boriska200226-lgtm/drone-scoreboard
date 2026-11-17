// Сценарии миссий. Каждая миссия описывает мир, погоду и правила выполнения.
import * as THREE from "three";
import { Airframe } from "./airframes";
import { FlameField, Particles } from "./effects";
import { clamp, mulberry32 } from "./noise";
import { DroneSim } from "./physics";
import {
  makeAnimal, makeBeam, makeHelipad, makeHouse, makePerson, makePylon, makeRing,
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

  constructor(ctx: Ctx) {
    super(ctx);
    this.nx = Math.round((FIELD.hx * 2) / this.cs); this.nz = Math.round((FIELD.hz * 2) / this.cs);
    this.dose = new Uint8Array(this.nx * this.nz);
    this.stamp = new Float32Array(this.nx * this.nz).fill(-100);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.nx * this.px; this.canvas.height = this.nz * this.px;
    this.g2 = this.canvas.getContext("2d")!;
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.paintCell(ix, iz);
    this.tex = ctx.world.track(new THREE.CanvasTexture(this.canvas));
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(FIELD.hx * 2, FIELD.hz * 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.95 }));
    mesh.receiveShadow = true;
    this.place(mesh, FIELD.x, FIELD.z, 0.12);
    ctx.world.addThermal(mesh, 0.14);
    this.capacity = ctx.af.payloadMax; this.amount = this.capacity;
    ctx.say(`Опрыскивание: ПРОБЕЛ. Высота 2–5 м, скорость ограничивается до 7 м/с, ширина захвата ${ctx.af.sprayWidth} м`, "info");
  }

  private paintCell(ix: number, iz: number) {
    const d = this.dose[iz * this.nx + ix], p = this.px, g = this.g2;
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
      const inField = Math.abs(cx - FIELD.x) < FIELD.hx + 1 && Math.abs(cz - FIELD.z) < FIELD.hz + 1;
      if (!inField || !ok) this.off += used;
      if (world.riverDist(cx, cz) < 32) {
        if (this.buffer === 0) this.ctx.say("НАРУШЕНИЕ: распыление в водоохранной зоне!", "warn");
        this.buffer += used;
      }
      if (ok) {
        const r = w / 2;
        const ix0 = Math.floor((cx - r - FIELD.x + FIELD.hx) / this.cs), ix1 = Math.floor((cx + r - FIELD.x + FIELD.hx) / this.cs);
        const iz0 = Math.floor((cz - r - FIELD.z + FIELD.hz) / this.cs), iz1 = Math.floor((cz + r - FIELD.z + FIELD.hz) / this.cs);
        for (let iz = Math.max(0, iz0); iz <= Math.min(this.nz - 1, iz1); iz++) {
          for (let ix = Math.max(0, ix0); ix <= Math.min(this.nx - 1, ix1); ix++) {
            const x = FIELD.x - FIELD.hx + (ix + 0.5) * this.cs, z = FIELD.z - FIELD.hz + (iz + 0.5) * this.cs;
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
    m.rect(FIELD.x - FIELD.hx, FIELD.z - FIELD.hz, FIELD.x + FIELD.hx, FIELD.z + FIELD.hz, "#9be05a");
    const step = 4;
    for (let iz = 0; iz < this.nz; iz += step) for (let ix = 0; ix < this.nx; ix += step) {
      let s = 0;
      for (let a = 0; a < step; a++) for (let b = 0; b < step; b++) s += this.dose[(iz + a) * this.nx + ix + b] > 0 ? 1 : 0;
      if (s > step * step * 0.5) {
        const x = FIELD.x - FIELD.hx + ix * this.cs, z = FIELD.z - FIELD.hz + iz * this.cs;
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
      else if (drone.vel.length() > 2.5) this.ctx.say("Смаз: зависните перед съёмкой", "warn");
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
];

export const getMission = (id: string) => MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
