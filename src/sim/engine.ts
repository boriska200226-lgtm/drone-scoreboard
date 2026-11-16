// Игровой цикл: ввод → физика → миссия → рендер (основной вид + окно подвесной камеры).
import * as THREE from "three";
import { Airframe } from "./airframes";
import { Particles } from "./effects";
import { Action, Ctx, Difficulty, DIFFICULTY, MapDraw, Mission, MissionDef, Objective, SayKind } from "./missions";
import { clamp, mulberry32 } from "./noise";
import { DroneSim, Env, FlightMode, MODE_LABEL, Sticks } from "./physics";
import { makeBaseCamp, THERMAL_LAYER, World } from "./world";

export interface Hud {
  agl: number; speed: number; vs: number; heading: number;
  battery: number; minutes: number; powerW: number;
  payloadLabel: string; payloadText: string; payloadFrac: number;
  wind: number; windFrom: number;
  mode: string; cam: string; thermal: boolean; pip: boolean; rth: boolean;
  distHome: number; time: number;
  objectives: Objective[]; motors: boolean[]; warnings: string[];
  pipRect: { right: number; top: number; w: number; h: number }; mapSize: number;
}

export interface SimResult {
  success: boolean; reason: string; score: number; stars: number; rows: [string, string][]; time: number;
}

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  mapCanvas: HTMLCanvasElement;
  horizonCanvas: HTMLCanvasElement;
  mission: MissionDef;
  airframe: Airframe;
  difficulty: Difficulty;
  onHud(h: Hud): void;
  onSay(text: string, kind: SayKind): void;
  onEnd(r: SimResult): void;
}

export type Command = "cam" | "thermal" | "pip" | "gimbal" | "mode" | "rth" | "mute";
const CAMS = ["chase", "fpv", "top"] as const;
const CAM_LABEL = { chase: "Сзади", fpv: "FPV", top: "Сверху" };
const MODES: FlightMode[] = ["POS", "ANGLE", "ACRO"];
const STEP = 1 / 240;

export function layout(w: number) {
  const small = w < 760;
  const mapSize = small ? 108 : 176;
  return { mapSize, pipRect: { right: 12, top: 12 + mapSize + 8, w: small ? 168 : 264, h: small ? 124 : 194 } };
}

function buildDrone(af: Airframe) {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x22262c });
  const accent = new THREE.MeshLambertMaterial({ color: af.color });
  const red = new THREE.MeshLambertMaterial({ color: 0xff3333 });
  const s = af.arm;
  const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 0.2, s * 0.85), dark);
  const top = new THREE.Mesh(new THREE.BoxGeometry(s * 0.42, s * 0.12, s * 0.5), accent);
  top.position.y = s * 0.15;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, s * 0.1, s * 0.12), red);
  nose.position.set(0, 0, -s * 0.46);
  group.add(body, top, nose);
  const gearH = 0.16 + af.arm * 0.28;
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03 + s * 0.03, gearH, 0.03 + s * 0.03), dark);
    leg.position.set(sx * s * 0.3, -gearH / 2, 0);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.03 + s * 0.03, 0.03, s * 0.9), dark);
    skid.position.set(sx * s * 0.3, -gearH + 0.015, 0);
    group.add(leg, skid);
  }
  const tank = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, gearH * 0.55, s * 0.6),
    new THREE.MeshLambertMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.85 }));
  tank.position.y = -gearH * 0.45;
  group.add(tank);

  const props: THREE.Group[] = [];
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const seen = new Set<string>();
  af.motors.forEach((m) => {
    const key = `${m.x.toFixed(2)},${m.z.toFixed(2)}`;
    if (!seen.has(key)) {
      seen.add(key);
      const len = Math.hypot(m.x, m.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025 + s * 0.04, 0.025 + s * 0.04, len), m.z < 0 ? red : dark);
      arm.position.set(m.x / 2, 0, m.z / 2);
      arm.rotation.y = Math.atan2(m.x, m.z);
      group.add(arm);
    }
    const mot = new THREE.Mesh(new THREE.CylinderGeometry(af.propR * 0.2, af.propR * 0.2, 0.07, 10), dark);
    mot.position.set(m.x, m.y * 1.2, m.z);
    group.add(mot);
    const prop = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(af.propR, 18), discMat);
    disc.rotation.x = -Math.PI / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(af.propR * 2, 0.012, af.propR * 0.16), dark);
    prop.add(disc, blade);
    prop.position.set(m.x, m.y * 1.2 + (m.y < 0 ? -0.05 : 0.05), m.z);
    group.add(prop);
    props.push(prop);
  });
  return { group, props, tank };
}

class Audio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode[] = [];
  private gain: GainNode | null = null;
  muted = false;
  constructor(private base: number) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 900;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      filter.connect(this.gain).connect(this.ctx.destination);
      for (const type of ["sawtooth", "triangle"] as OscillatorType[]) {
        const o = this.ctx.createOscillator();
        o.type = type; o.connect(filter); o.start();
        this.osc.push(o);
      }
    } catch { this.ctx = null; }
  }
  set(throttle: number, on: boolean) {
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    const f = this.base * (0.55 + throttle * 1.1);
    this.osc[0].frequency.setTargetAtTime(f, t, 0.05);
    this.osc[1].frequency.setTargetAtTime(f * 2.02, t, 0.05);
    this.gain.gain.setTargetAtTime(on && !this.muted ? 0.035 + throttle * 0.05 : 0, t, 0.08);
  }
  dispose() { this.ctx?.close().catch(() => undefined); }
}

export class SimEngine {
  readonly drone: DroneSim;
  readonly world: World;
  readonly mission: Mission;
  touch: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  touchAction = false;
  paused = false;

  private o: EngineOpts;
  private renderer: THREE.WebGLRenderer;
  private cam = new THREE.PerspectiveCamera(62, 1, 0.15, 5000);
  private pipCam = new THREE.PerspectiveCamera(50, 1.36, 0.3, 3000);
  private model: ReturnType<typeof buildDrone>;
  private shadow: THREE.Mesh;
  private fx: Ctx["fx"];
  private audio: Audio;
  private keys = new Set<string>();
  private sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private camMode: (typeof CAMS)[number] = "chase";
  private thermal = false;
  private pip: boolean;
  private gimbalPitch: number;
  private rth = false;
  private actionPressed = false;
  private padPrev: boolean[] = [];
  private raf = 0;
  private last = 0;
  private acc = 0;
  private hudAcc = 0;
  private ended = false;
  private endTimer = -1;
  private baseTimer = 0;
  private serviced = true;
  private lowBatSaid = 0;
  private failAt: number;
  private rnd = mulberry32((Date.now() & 0xffffff) + 17);
  private camDirV = new THREE.Vector3(0, -1, 0);
  private env: Env;
  private windsock: THREE.Object3D | null = null;
  private fogSaved: THREE.FogExp2 | null = null;

  constructor(o: EngineOpts) {
    this.o = o;
    this.world = new World(o.mission.world);
    this.drone = new DroneSim(o.airframe);
    this.pip = o.mission.pip;
    this.gimbalPitch = o.mission.gimbalPitch;

    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.pipCam.layers.set(0);

    const scene = this.world.scene;
    const camp = makeBaseCamp();
    camp.position.set(0, this.world.groundAt(0, 0), 0);
    scene.add(camp);
    this.world.addThermal(camp, 0.3);
    this.windsock = camp.getObjectByName("windsock") ?? null;

    this.model = buildDrone(o.airframe);
    scene.add(this.model.group);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    const ground = (x: number, z: number) => Math.max(this.world.groundAt(x, z), this.world.waterLevel ?? -1e9);
    this.fx = {
      fire: new Particles(scene, { max: 3200, additive: true, thermal: true }),
      smoke: new Particles(scene, { max: 1800, drag: 0.5, grow: 2.6 }),
      water: new Particles(scene, { max: 1400, gravity: 9.81, drag: 0.35, ground, onHit: (x, z, m) => this.mission.onWaterHit(x, z, m) }),
    };

    this.env = {
      groundAt: (x, z) => this.world.groundAt(x, z),
      waterLevel: this.world.waterLevel,
      wind: (p, t, out) => this.windAt(p, t, out),
      collide: (p, r) => this.world.collide(p, r),
    };
    this.drone.reset(0, this.world.groundAt(0, 0) + 0.12, 0, 0);

    const ctx: Ctx = {
      world: this.world, drone: this.drone, af: o.airframe, difficulty: o.difficulty, rnd: this.rnd, fx: this.fx,
      say: (t, k = "info") => o.onSay(t, k),
      thermal: () => this.thermal,
      camDir: () => this.camDirV,
    };
    this.mission = o.mission.create(ctx);
    this.failAt = o.difficulty === "ace" ? 45 + this.rnd() * 60 : Infinity;
    this.audio = new Audio(150 / (0.6 + o.airframe.propR * 3));

    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    window.addEventListener("blur", this.onBlur);
    this.resize();
    this.cam.position.set(0, this.drone.pos.y + 3, 8);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __sim?: SimEngine }).__sim = this;
  }

  // ───────────── ввод ─────────────

  private onKey = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    const map: Record<string, Command> = { KeyC: "cam", KeyT: "thermal", KeyV: "pip", KeyG: "gimbal", KeyM: "mode", KeyH: "rth", KeyN: "mute" };
    if (e.code === "Space") this.actionPressed = true;
    else if (map[e.code]) this.command(map[e.code]);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onBlur = () => { this.keys.clear(); };

  command(c: Command) {
    if (this.ended) return;
    const say = this.o.onSay;
    if (c === "cam") this.camMode = CAMS[(CAMS.indexOf(this.camMode) + 1) % CAMS.length];
    else if (c === "thermal") { this.thermal = !this.thermal; if (this.thermal) this.pip = true; }
    else if (c === "pip") this.pip = !this.pip;
    else if (c === "gimbal") this.gimbalPitch = this.gimbalPitch < -45 ? -6 : -90;
    else if (c === "mute") this.audio.muted = !this.audio.muted;
    else if (c === "mode") {
      this.drone.mode = MODES[(MODES.indexOf(this.drone.mode) + 1) % MODES.length];
      this.rth = false;
      say(`Режим: ${MODE_LABEL[this.drone.mode]}`, "info");
    } else if (c === "rth") {
      this.rth = !this.rth;
      if (this.rth) this.drone.mode = "POS";
      say(this.rth ? "Автовозврат на базу включён" : "Автовозврат отменён", "info");
    }
  }

  pressAction() { this.actionPressed = true; }

  private readSticks(dt: number): { st: Sticks; held: boolean } {
    const k = this.keys;
    const ax = (pos: string, neg: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    const target = {
      roll: ax("ArrowRight", "ArrowLeft"), pitch: ax("ArrowUp", "ArrowDown"),
      yaw: ax("KeyD", "KeyA"), throttle: ax("KeyW", "KeyS"),
    };
    const s = this.sticks;
    (Object.keys(target) as (keyof Sticks)[]).forEach((a) => {
      const rate = target[a] === 0 ? 7 : 4.5;
      s[a] += clamp(target[a] - s[a], -rate * dt, rate * dt);
    });
    const out: Sticks = {
      roll: clamp(s.roll + this.touch.roll, -1, 1), pitch: clamp(s.pitch + this.touch.pitch, -1, 1),
      yaw: clamp(s.yaw + this.touch.yaw, -1, 1), throttle: clamp(s.throttle + this.touch.throttle, -1, 1),
    };
    let held = k.has("Space") || this.touchAction;

    const pad = navigator.getGamepads ? Array.from(navigator.getGamepads()).find((g) => g && g.connected && g.axes.length >= 4) : null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      const g = { yaw: dz(pad.axes[0]), throttle: -dz(pad.axes[1]), roll: dz(pad.axes[2]), pitch: -dz(pad.axes[3]) };
      (Object.keys(g) as (keyof Sticks)[]).forEach((a) => { if (g[a] !== 0) out[a] = g[a]; });
      const b = pad.buttons.map((x) => x.pressed);
      const edge = (i: number) => b[i] && !this.padPrev[i];
      if (edge(0)) this.actionPressed = true;
      if (edge(1)) this.command("cam");
      if (edge(2)) this.command("thermal");
      if (edge(3)) this.command("mode");
      if (edge(9)) this.command("rth");
      held = held || !!b[0];
      this.padPrev = b;
    }
    return { st: out, held };
  }

  /** Автовозврат: набор безопасной высоты → полёт к базе → посадка. */
  private autopilot(st: Sticks): Sticks {
    const d = this.drone;
    if (Math.hypot(st.roll, st.pitch) > 0.3 || Math.abs(st.throttle) > 0.3) {
      this.rth = false;
      this.o.onSay("Автовозврат отменён — управление у пилота", "info");
      return st;
    }
    const dist = Math.hypot(d.pos.x, d.pos.z);
    const agl = d.pos.y - d.gear - this.world.groundAt(d.pos.x, d.pos.z);
    const safe = this.world.groundAt(0, 0) + 45;
    const out: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
    if (d.landed && dist < 4) { this.rth = false; return out; }
    if (dist > 2.5) {
      if (d.pos.y < safe - 2 && dist > 25) { out.throttle = 1; if (d.pos.y < safe - 12) return out; }
      const v = Math.min(d.af.maxSpeed * 0.75, 0.5 + dist * 0.28) / (d.af.maxSpeed * 0.9);
      const dx = -d.pos.x / dist, dz = -d.pos.z / dist;
      const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
      out.pitch = (dx * fx + dz * fz) * v;
      out.roll = (dx * rx + dz * rz) * v;
      if (dist < 25 && agl > 12) out.throttle = -0.6;
    } else out.throttle = agl > 6 ? -0.7 : -0.3;
    return out;
  }

  private windAt(p: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
    const w = this.o.mission.wind;
    const s = w.speed * DIFFICULTY[this.o.difficulty].wind;
    const gust = 1 + (w.gust / 1.3) * (0.6 * Math.sin(0.31 * t) + 0.4 * Math.sin(0.83 * t + 1.3) + 0.3 * Math.sin(1.9 * t + p.x * 0.02));
    const ang = (w.toDeg * Math.PI) / 180 + 0.25 * Math.sin(0.11 * t);
    const agl = p.y - this.world.groundAt(p.x, p.z);
    const hf = clamp(0.35 + (0.65 * agl) / 25, 0.3, 1.15);
    out.set(Math.sin(ang) * s * gust * hf, 0, -Math.cos(ang) * s * gust * hf);
    this.mission.extraWind(p, out);
    return out;
  }

  // ───────────── цикл ─────────────

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
    this.hudAcc += dt;
    if (this.hudAcc > 0.12) { this.hudAcc = 0; this.pushHud(); }
  };

  private update(dt: number) {
    const d = this.drone;
    const input = this.readSticks(dt);
    let st = input.st;
    if (this.rth && !d.crashed) st = this.autopilot(st);
    const action: Action = { held: input.held, pressed: this.actionPressed };
    this.actionPressed = false;

    if (!this.ended || this.endTimer >= 0) {
      this.acc += dt;
      while (this.acc >= STEP) { d.step(STEP, st, this.env); this.acc -= STEP; }
    }
    if (!this.ended) {
      this.mission.update(dt, action);
      if (d.time > this.failAt && !d.landed) {
        const i = Math.floor(this.rnd() * d.n);
        d.failMotor(i);
        this.failAt = Infinity;
        this.o.onSay(`ОТКАЗ МОТОРА №${i + 1}! ${d.af.redundancy === "нет" ? "Резерва нет" : "Аппарат держится — садитесь"}`, "warn");
      }
      this.rules(dt);
    } else if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) this.finish(false, d.crashed ?? "Миссия провалена");
    }

    const windNow = d.windNow;
    this.fx.fire.update(dt, windNow);
    this.fx.smoke.update(dt, windNow);
    this.fx.water.update(dt, windNow);
    this.syncVisuals(dt);
    let avg = 0;
    for (let i = 0; i < d.n; i++) avg += d.thrust[i] / d.af.motorThrust;
    this.audio.set(avg / d.n, !d.crashed && !this.ended);
  }

  private rules(dt: number) {
    const d = this.drone, m = this.mission, say = this.o.onSay;
    if (d.crashed) {
      this.ended = true; this.endTimer = 1.8;
      for (let i = 0; i < 60; i++) {
        this.fx.fire.spawn(d.pos.x, d.pos.y, d.pos.z, (this.rnd() - 0.5) * 9, this.rnd() * 7, (this.rnd() - 0.5) * 9, 0.5 + this.rnd(), 1.5 + this.rnd() * 2, 1, 0.6, 0.15, 0.8);
      }
      say(d.crashed, "warn");
      return;
    }
    if (m.failed) { this.finish(false, m.failed); return; }
    const atBase = Math.hypot(d.pos.x, d.pos.z) < 4.6;
    if (d.landed && atBase) {
      this.baseTimer += dt;
      if (m.tasksDone && this.baseTimer > 1) { this.finish(true, "Задача выполнена"); return; }
      if (!this.serviced && this.baseTimer > 2) {
        this.serviced = true;
        const swapped = d.battery < d.af.batteryWh * 0.97;
        d.battery = d.af.batteryWh;
        const filled = m.refill();
        if (swapped || filled) say(filled ? "Техник: АКБ заменена, бак заправлен" : "Техник: АКБ заменена", "good");
      }
    } else {
      this.baseTimer = 0;
      if (!d.landed) this.serviced = false;
    }
    if (d.battery <= 0 && d.landed && !atBase) { this.finish(false, "Батарея разряжена вдали от базы"); return; }
    if (d.soc < 0.2 && d.time - this.lowBatSaid > 25) {
      this.lowBatSaid = d.time;
      say(d.soc < 0.08 ? "КРИТИЧЕСКИЙ ЗАРЯД — немедленная посадка!" : "Низкий заряд АКБ — возвращайтесь (H — автовозврат)", "warn");
    }
  }

  private finish(success: boolean, reason: string) {
    if (this.ended && this.endTimer >= 0) return;
    this.ended = true; this.endTimer = -1;
    const sum = this.mission.summary();
    const score = success ? Math.round(sum.score) : 0;
    const rows: [string, string][] = [...sum.rows, ["Остаток АКБ", `${Math.round(this.drone.soc * 100)}%`]];
    this.audio.set(0, false);
    this.o.onEnd({
      success, reason, score, stars: !success ? 0 : score >= 85 ? 3 : score >= 60 ? 2 : 1,
      rows: rows.filter((r, i) => rows.findIndex((x) => x[0] === r[0]) === i), time: this.mission.time,
    });
  }

  private syncVisuals(dt: number) {
    const d = this.drone, g = this.model.group;
    g.position.copy(d.pos);
    g.quaternion.copy(d.quat);
    if (d.crashed) g.rotation.z += 0.9;
    this.model.props.forEach((p, i) => {
      const k = d.thrust[i] / d.af.motorThrust;
      p.rotation.y += d.af.motors[i].dir * (d.motorOk[i] ? 18 + 70 * k : 0) * dt;
      p.children[0].visible = d.motorOk[i] && k > 0.02;
    });
    const frac = this.mission.capacity > 0 ? this.mission.amount / this.mission.capacity : 0;
    this.model.tank.visible = this.mission.capacity > 1;
    this.model.tank.scale.y = 0.25 + 0.75 * frac;

    const gh = Math.max(this.world.groundAt(d.pos.x, d.pos.z), this.world.waterLevel ?? -1e9);
    const agl = d.pos.y - gh;
    this.shadow.position.set(d.pos.x, gh + 0.08, d.pos.z);
    this.shadow.scale.setScalar(d.radius * (1 + agl * 0.03));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = clamp(0.45 - agl * 0.006, 0.08, 0.45);
    if (this.windsock) {
      this.windsock.rotation.set(0, 0, 0);
      this.windsock.rotateY(Math.atan2(-d.windNow.x, -d.windNow.z));
      this.windsock.rotateX(-Math.PI / 2 + clamp(0.9 - d.windNow.length() * 0.12, 0, 0.9));
    }

    // камеры
    const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw);
    const cam = this.cam;
    if (this.camMode === "chase") {
      const dist = 3 + d.radius * 4.2, h = 1.1 + d.radius * 1.7;
      const tx = d.pos.x - fx * dist, tz = d.pos.z - fz * dist;
      const ty = Math.max(d.pos.y + h, this.world.groundAt(tx, tz) + 0.7);
      const k = 1 - Math.exp(-7 * dt);
      cam.position.x += (tx - cam.position.x) * k;
      cam.position.y += (ty - cam.position.y) * k;
      cam.position.z += (tz - cam.position.z) * k;
      cam.up.set(0, 1, 0);
      cam.fov = 62;
      cam.lookAt(d.pos.x + fx * 3, d.pos.y + 0.2, d.pos.z + fz * 3);
    } else if (this.camMode === "fpv") {
      cam.position.copy(d.pos);
      cam.quaternion.copy(d.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.14));
      cam.fov = 95;
    } else {
      cam.position.set(d.pos.x, d.pos.y + 75, d.pos.z + 0.01);
      cam.up.set(0, 0, -1);
      cam.fov = 55;
      cam.lookAt(d.pos);
    }
    cam.updateProjectionMatrix();
    this.world.sky.position.copy(cam.position);

    this.pipCam.position.set(d.pos.x, d.pos.y - d.gear * 0.5, d.pos.z);
    this.pipCam.rotation.set((this.gimbalPitch * Math.PI) / 180, d.yaw, 0, "YXZ");
    this.camDirV.set(0, 0, -1).applyQuaternion(this.pipCam.quaternion);
  }

  private resize = () => {
    const c = this.o.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  };

  private render() {
    const r = this.renderer, scene = this.world.scene;
    const c = this.o.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    const pr = r.getPixelRatio();
    const scale = (cam: THREE.PerspectiveCamera, px: number) => (px * pr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const setScale = (v: number) => { this.fx.fire.setScale(v); this.fx.smoke.setScale(v); this.fx.water.setScale(v); };

    this.model.group.visible = this.camMode !== "fpv";
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    setScale(scale(this.cam, h));
    r.render(scene, this.cam);

    if (this.pip) {
      const { pipRect: p } = layout(w);
      const x = w - p.right - p.w, y = h - p.top - p.h;
      this.model.group.visible = false;
      this.shadow.visible = false;
      const bg = scene.background;
      if (this.thermal) {
        this.pipCam.layers.set(THERMAL_LAYER);
        this.fogSaved = scene.fog as THREE.FogExp2;
        scene.fog = null;
        scene.background = new THREE.Color(0x050505);
      } else this.pipCam.layers.set(0);
      this.pipCam.aspect = p.w / p.h;
      this.pipCam.updateProjectionMatrix();
      r.setScissorTest(true);
      r.setScissor(x, y, p.w, p.h);
      r.setViewport(x, y, p.w, p.h);
      setScale(scale(this.pipCam, p.h));
      r.render(scene, this.pipCam);
      r.setScissorTest(false);
      if (this.thermal) { scene.fog = this.fogSaved; scene.background = bg; }
      this.model.group.visible = true;
      this.shadow.visible = true;
    }
    this.drawMap();
    this.drawHorizon();
  }

  // ───────────── приборы ─────────────

  private fit(cv: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return null;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext("2d");
    if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  private drawMap() {
    const cv = this.o.mapCanvas;
    const g = this.fit(cv);
    if (!g) return;
    const S = cv.clientWidth, R = 400, k = S / (2 * R), d = this.drone;
    const X = (x: number) => S / 2 + (x - d.pos.x) * k, Y = (z: number) => S / 2 + (z - d.pos.z) * k;
    const edge = (v: number) => clamp(v, 5, S - 5);
    g.clearRect(0, 0, S, S);
    g.fillStyle = "rgba(8,14,20,0.82)";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.arc(S / 2, S / 2, (S / 8) * i, 0, 6.3); g.stroke(); }
    const river = this.world.cfg.river;
    if (river) {
      g.strokeStyle = "rgba(60,140,210,0.75)"; g.lineWidth = Math.max(2, river.width * k);
      g.beginPath();
      for (let x = d.pos.x - R; x <= d.pos.x + R; x += 20) {
        const px = X(x), py = Y(this.world.riverZ(x));
        if (x === d.pos.x - R) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
    const draw: MapDraw = {
      dot: (x, z, color, r = 3) => { g.fillStyle = color; g.beginPath(); g.arc(edge(X(x)), edge(Y(z)), r, 0, 6.3); g.fill(); },
      ring: (x, z, radius, color) => { g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath(); g.arc(X(x), Y(z), radius * k, 0, 6.3); g.stroke(); },
      rect: (x0, z0, x1, z1, color, fill) => {
        if (fill) { g.fillStyle = color; g.fillRect(X(x0), Y(z0), (x1 - x0) * k + 0.5, (z1 - z0) * k + 0.5); }
        else { g.strokeStyle = color; g.lineWidth = 1.2; g.strokeRect(X(x0), Y(z0), (x1 - x0) * k, (z1 - z0) * k); }
      },
    };
    this.mission.drawMap(draw);
    g.fillStyle = "#ffffff"; g.font = "bold 10px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const bx = edge(X(0)), by = edge(Y(0));
    g.beginPath(); g.arc(bx, by, 6, 0, 6.3); g.fill();
    g.fillStyle = "#0a0d16"; g.fillText("H", bx, by + 0.5);
    g.save();
    g.translate(S / 2, S / 2); g.rotate(-d.yaw);
    g.fillStyle = "#00ffaa";
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.6)"; g.fillText("С", S / 2, 8);
  }

  private drawHorizon() {
    const cv = this.o.horizonCanvas;
    const g = this.fit(cv);
    if (!g) return;
    const S = cv.clientWidth, d = this.drone;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(d.quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(d.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(d.quat);
    const pitch = Math.asin(clamp(fwd.y, -1, 1)), roll = Math.atan2(-right.y, up.y);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 6.3); g.clip();
    g.translate(S / 2, S / 2); g.rotate(-roll); g.translate(0, pitch * S * 0.9);
    g.fillStyle = "#2f6fb5"; g.fillRect(-S, -S * 2, S * 2, S * 2);
    g.fillStyle = "#6b4a2b"; g.fillRect(-S, 0, S * 2, S * 2);
    g.strokeStyle = "#fff"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-S, 0); g.lineTo(S, 0); g.stroke();
    g.restore();
    g.strokeStyle = "#ffd700"; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(S * 0.2, S / 2); g.lineTo(S * 0.4, S / 2); g.moveTo(S * 0.6, S / 2); g.lineTo(S * 0.8, S / 2); g.stroke();
    g.fillStyle = "#ffd700"; g.beginPath(); g.arc(S / 2, S / 2, 2.5, 0, 6.3); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 6.3); g.stroke();
  }

  private pushHud() {
    const d = this.drone, m = this.mission, def = this.o.mission;
    const gh = Math.max(this.world.groundAt(d.pos.x, d.pos.z), this.world.waterLevel ?? -1e9);
    const warnings: string[] = [];
    if (d.motorOk.some((x) => !x)) warnings.push("ОТКАЗ МОТОРА");
    if (d.soc < 0.2) warnings.push("НИЗКИЙ ЗАРЯД");
    if (d.windNow.length() > 9) warnings.push("СИЛЬНЫЙ ВЕТЕР");
    const objectives = [...m.objectives(), { text: "Вернуться и сесть на площадку базы", done: false }];
    const heading = ((-d.yaw * 180) / Math.PI + 360) % 360;
    const windFrom = ((Math.atan2(-d.windNow.x, d.windNow.z) * 180) / Math.PI + 360) % 360;
    const w = this.o.canvas.clientWidth;
    this.o.onHud({
      agl: Math.max(0, d.pos.y - d.gear - gh), speed: Math.hypot(d.vel.x, d.vel.z), vs: d.vel.y, heading,
      battery: d.soc, minutes: d.powerW > 30 ? (d.battery / d.powerW) * 60 : 99, powerW: d.powerW,
      payloadLabel: def.payloadLabel,
      payloadText: m.capacity > 1 ? `${m.amount.toFixed(def.payloadUnit === "шт" ? 0 : 1)} ${def.payloadUnit}` : m.capacity === 1 ? (m.amount > 0 ? "на борту" : "доставлен") : "—",
      payloadFrac: m.capacity > 0 ? m.amount / m.capacity : 0,
      wind: d.windNow.length(), windFrom,
      mode: this.rth ? "Автовозврат" : MODE_LABEL[d.mode], cam: CAM_LABEL[this.camMode],
      thermal: this.thermal, pip: this.pip, rth: this.rth,
      distHome: Math.hypot(d.pos.x, d.pos.z), time: m.time, objectives, motors: [...d.motorOk], warnings,
      ...layout(w),
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.onBlur);
    this.audio.dispose();
    this.mission.dispose();
    this.fx.fire.dispose(); this.fx.smoke.dispose(); this.fx.water.dispose();
    this.world.dispose();
    this.renderer.dispose();
    const w = window as unknown as { __sim?: SimEngine };
    if (w.__sim === this) delete w.__sim;
  }
}
