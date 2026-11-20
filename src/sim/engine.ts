// Игровой цикл: ввод → физика → миссия → рендер (основной вид + окно подвесной камеры).
import { WorldRecorder } from "./replay";
import { Ambience, music, playSplash, setSoundPrefs, getSoundPrefs } from "./sound";
import * as THREE from "three";
import { Airframe, isPlane } from "./airframes";
import { PlaneSim } from "./plane";
import { Particles, PrecipField } from "./effects";
import { Action, Ctx, Difficulty, DIFFICULTY, MapDraw, Mission, MissionDef, Objective, SayKind } from "./missions";
import { clamp, mulberry32 } from "./noise";
import { DroneSim, Env, FlightMode, MANUAL_THROTTLE, MODE_LABEL, Sticks } from "./physics";
import { makeBaseCamp, Quality, THERMAL_LAYER, World } from "./world";
import { buildDrone, DroneModel } from "./droneModel";
import { releaseModels, updateModels } from "./models";
import { GradeShader } from "./shaders";
import { DEFAULT_INPUT, firstPad, InputConfig, readAxis, switchPos } from "./input";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export interface Hud {
  agl: number; speed: number; vs: number; heading: number;
  battery: number; minutes: number; powerW: number;
  payloadLabel: string; payloadText: string; payloadFrac: number;
  wind: number; windFrom: number;
  mode: string; cam: string; thermal: boolean; thermalPal: string; zoom: number;
  replay: ReplayState | null;
  /** Падение в воду в FPV: 0..1 — насколько камера под водой; потом пропадает видеосигнал. */
  underwater: number; noSignal: boolean; pip: boolean; rth: boolean;
  distHome: number; time: number;
  objectives: Objective[]; motors: boolean[]; warnings: string[];
  pipRect: { right: number; top: number; w: number; h: number }; mapSize: number;
  modeId: FlightMode; camId: CamMode; manual: boolean; osd: Osd;
  gpsSats: number; link: number; failsafe: string | null; landing: boolean; gimbal: number;
  fps: number; res: number;
}

export interface FlightSample { t: number; x: number; z: number; agl: number; spd: number; soc: number }
export interface FlightLog {
  samples: FlightSample[]; remarks: [string, number][]; maxAgl: number; maxSpeed: number; distance: number;
  energyWh: number; over150: number; beyondVlos: number; hardLandings: number; base: { x: number; z: number };
}
/** Событие полёта для шкалы повтора. */
export interface ReplayEvent { t: number; text: string; kind: SayKind }
export interface ReplayState { t: number; t0: number; dur: number; playing: boolean; speed: number; events: ReplayEvent[] }
export interface SimResult {
  success: boolean; reason: string; score: number; stars: number; rows: [string, string][]; time: number;
  missionId: string; log: FlightLog;
}

export interface EngineOpts {
  canvas: HTMLCanvasElement;
  mapCanvas: HTMLCanvasElement;
  horizonCanvas: HTMLCanvasElement;
  mission: MissionDef;
  airframe: Airframe;
  difficulty: Difficulty;
  quality: Quality;
  flightMode?: FlightMode;
  input?: InputConfig;
  camMode?: CamMode;
  livery?: string;
  /** Случайные отказы во время полёта. */
  failures?: boolean;
  onHud(h: Hud): void;
  onSay(text: string, kind: SayKind): void;
  onEnd(r: SimResult): void;
}

export type Command = "cam" | "thermal" | "pip" | "gimbal" | "mode" | "rth" | "mute" | "land" | "palette" | "zoomIn" | "zoomOut";
/** Ступени зума камеры подвеса (оптика + цифра), как у промышленных дронов. */
export const ZOOMS = [1, 2, 4, 8];
/** Палитры тепловизора, как в настоящих камерах. */
export const THERMAL_PALETTES = ["Железо", "Белое — горячее", "Чёрное — горячее", "Радуга"] as const;
/** Отказы, которые вводит инструктор (или случайный сценарий). */
export type Fault = "motor" | "gps" | "link" | "gust" | "battery" | "clear";
export const CAMS = ["chase", "fpv", "los", "top"] as const;
export type CamMode = (typeof CAMS)[number];
export const CAM_LABEL: Record<CamMode, string> = { chase: "Сзади", fpv: "FPV", los: "С земли", top: "Сверху" };
export const MODES: FlightMode[] = ["POS", "ATTI", "ANGLE", "ACRO"];
/** Наклон FPV-камеры вверх, рад: для быстрого полёта камеру ставят круче. */
const FPV_TILT: Record<FlightMode, number> = { POS: 0.12, ATTI: 0.14, ANGLE: 0.3, ACRO: 0.47 };

export interface Osd {
  roll: number; pitch: number; throttle: number; volts: number; cells: number; armed: boolean;
  horizon: { x: number; y: number; angle: number } | null;
}
const STEP = 1 / 240;

export function layout(w: number, big = false) {
  const small = w < 760;
  const mapSize = small ? 108 : 176;
  // тепловизор — основной инструмент поиска, его окно крупнее
  const pw = big ? Math.round(Math.min(small ? 240 : 480, w * 0.38)) : small ? 168 : 264;
  return { mapSize, pipRect: { right: 12, top: 12 + mapSize + 8, w: pw, h: Math.round(pw * 0.735) } };
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

const THERMAL_SKY = new THREE.Color(0x010101);

/** Обработка теплового кадра: оптика слегка размывает, электроника подчёркивает контуры (ореол),
 *  у матрицы есть шум и полосы по столбцам; палитра «белое — горячее». */
function makeThermalPost() {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
  // уменьшенная копия кадра для автоусиления (по ней считаем диапазон температур в кадре)
  const small = new THREE.WebGLRenderTarget(32, 24, { type: THREE.HalfFloatType, depthBuffer: false });
  const sampleMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: "uniform sampler2D uTex; varying vec2 vUv; void main() { float t = texture2D(uTex, vUv).r; gl_FragColor = vec4(log(1. + max(t, 0.) * 40.) / log(41.), 0., 0., 1.); }",
    depthTest: false, depthWrite: false,
  });
  const sampleScene = new THREE.Scene();
  const sq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sampleMat);
  sq.frustumCulled = false;
  sampleScene.add(sq);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null }, uPx: { value: new THREE.Vector2() }, uTime: { value: 0 }, uPal: { value: 0 }, uLo: { value: 0 }, uHi: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `
      uniform sampler2D uTex; uniform vec2 uPx; uniform float uTime, uLo, uHi; uniform int uPal; varying vec2 vUv;
      // «железо» (ironbow): холодное — чёрно-синее, тёплое — фиолетово-красное, горячее — жёлто-белое
      vec3 iron(float v) {
        vec3 c = mix(vec3(0., 0., .04), vec3(.2, .02, .45), smoothstep(0., .3, v));
        c = mix(c, vec3(.75, .05, .35), smoothstep(.25, .55, v));
        c = mix(c, vec3(.95, .38, .02), smoothstep(.5, .75, v));
        c = mix(c, vec3(1., .85, .15), smoothstep(.72, .9, v));
        return mix(c, vec3(1.), smoothstep(.9, 1., v));
      }
      vec3 rainbow(float v) {
        vec3 c = mix(vec3(.05, 0., .25), vec3(0., .2, .9), smoothstep(0., .25, v));
        c = mix(c, vec3(0., .85, .6), smoothstep(.22, .45, v));
        c = mix(c, vec3(.9, .9, 0.), smoothstep(.45, .65, v));
        c = mix(c, vec3(1., .2, 0.), smoothstep(.65, .85, v));
        return mix(c, vec3(1., .95, .95), smoothstep(.9, 1., v));
      }
      float T(vec2 o) { return texture2D(uTex, vUv + o * uPx).r; }
      float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        float c = T(vec2(0.));
        float b1 = (T(vec2(1, 0)) + T(vec2(-1, 0)) + T(vec2(0, 1)) + T(vec2(0, -1))) * .25;
        float b3 = (T(vec2(3, 0)) + T(vec2(-3, 0)) + T(vec2(0, 3)) + T(vec2(0, -3)) + T(vec2(2, 2)) + T(vec2(-2, 2)) + T(vec2(2, -2)) + T(vec2(-2, -2))) * .125;
        float t = mix(c, b1, .55);           // оптика
        t += (t - b3) * .7;                  // подчёркивание контуров
        // автоусиление (AGC): диапазон кадра растягивается на всю палитру; самое горячее уходит в белое
        float v = log(1. + max(t, 0.) * 40.) / log(41.);
        v = (v - uLo) / max(.1, uHi - uLo);
        v += (h(gl_FragCoord.xy + uTime * 91.) - .5) * .05;     // шум матрицы
        v += (h(vec2(floor(gl_FragCoord.x), 7.)) - .5) * .025;  // полосы по столбцам
        vec2 d = vUv - .5; v *= 1. - dot(d, d) * .5;            // виньетка объектива
        v = clamp(v, 0., 1.);
        vec3 col = uPal == 0 ? iron(v) : uPal == 2 ? vec3(1. - v) : uPal == 3 ? rainbow(v) : vec3(v);
        gl_FragColor = vec4(col, 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return { rt, mat, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), small, sampleMat, sampleScene, buf: new Uint16Array(32 * 24 * 4), n: 0 };
}

const WATER_CRASH = "Аппарат упал в воду";

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
  private model!: DroneModel;
  private precip: PrecipField | null = null;
  // радиосвязь, навигация и защитные режимы
  private linkQ = 1; private linkLostT = 0; private jamUntil = -1; private linkAcc = 0;
  private failsafe: null | "rth" | "land" | "hover" = null; private hoverT = 0;
  private autoLand = false; private landReq = false; private lowBatHandled = false; private gpsUntil = -1;
  private gust = new THREE.Vector3();
  private faultPlan: { t: number; kind: Fault }[] = [];
  private nearTrees: number[] = [];
  private remarks = new Map<string, number>();
  private log: FlightLog = { samples: [], remarks: [], maxAgl: 0, maxSpeed: 0, distance: 0, energyWh: 0, over150: 0, beyondVlos: 0, hardLandings: 0, base: { x: 0, z: 0 } };
  private logAcc = 0;
  private wasAirborne = false;
  private lastVy = 0;
  private lastBumps = 0;
  private lowSec = 0; private highSec = 0;
  private swapWh = 0;
  private pr = 1;
  private maxPr = 1;
  private fpsAcc = 0;
  private fpsN = 0;
  private frameNo = 0;
  fps = 0;
  autoRes = true;
  /** Мир готов: текстуры и панорама освещения загружены. */
  get ready() { return this.world.ready; }
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private shadow: THREE.Mesh;
  private fx: Ctx["fx"];
  private audio: Audio;
  private amb: Ambience;
  private ambAcc = 0; private ambTrees = 0;
  private keys = new Set<string>();
  private sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private camMode: CamMode = "chase";
  /** Ракурс съёмки обложки: позиция, цель, угол обзора. */
  shotCam: { p: [number, number, number]; t: [number, number, number]; fov: number } | null = null;
  private input: InputConfig = DEFAULT_INPUT;
  private switchPrev = -1;
  padName = "";
  private thermal = false;
  private pip: boolean;
  private gimbalPitch: number;
  private rth = false;
  private actionPressed = false;
  private padPrev: boolean[] = [];
  private actionAxisPrev = false;
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
  private sink: { t: number; x: number; z: number; wl: number; rings: THREE.Mesh[] } | null = null;
  private thermalPost: ReturnType<typeof makeThermalPost> | null = null;
  private zoom = 1;
  // запись полёта для повтора: 20 кадров в секунду — время, позиция, ориентация, тяга
  private track: number[] = [];
  private trackAcc = 0;
  private recording = true;
  private events: ReplayEvent[] = [];
  private replay: { t: number; playing: boolean; speed: number; i: number } | null = null;
  private worldRec: WorldRecorder;
  /** Часы записи: идут и после аварии (физика тогда стоит). */
  private recT = 0;
  private crashAt: { t: number; water: boolean } | null = null;
  private thermalPal = (() => { try { return (+(localStorage.getItem("bas-sim-thermal-pal") ?? 0) || 0) % 4; } catch { return 0; } })();

  constructor(o: EngineOpts) {
    this.o = o;
    this.world = new World(o.mission.world, o.quality);
    this.drone = isPlane(o.airframe) ? new PlaneSim(o.airframe) : new DroneSim(o.airframe);
    this.pip = o.mission.pip;
    this.gimbalPitch = o.mission.gimbalPitch;

    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: o.quality !== "high", powerPreference: "high-performance" });
    // стартовое разрешение; дальше его подстраивает динамический масштаб под частоту кадров
    this.maxPr = Math.min(window.devicePixelRatio || 1, o.quality === "high" ? 2 : o.quality === "medium" ? 1.5 : 1);
    this.pr = Math.min(this.maxPr, o.quality === "high" ? 1.5 : this.maxPr);
    this.renderer.setPixelRatio(this.pr);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = o.mission.world.palette.exposure * 1.25;
    this.renderer.shadowMap.enabled = o.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.world.bakeEnvironment(this.renderer);
    this.pipCam.layers.set(0);

    const scene = this.world.scene;
    const camp = makeBaseCamp();
    camp.position.set(0, this.world.groundAt(0, 0), 0);
    scene.add(camp);
    this.world.addThermal(camp, 0.3);
    this.windsock = camp.getObjectByName("windsock") ?? null;

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = o.quality === "low";
    scene.add(this.shadow);

    const fog = scene.fog as THREE.FogExp2;
    const pal = o.mission.world.palette;
    const lightTint = new THREE.Color(pal.ambient).multiplyScalar(pal.ambientIntensity * 0.45)
      .add(new THREE.Color(pal.sun).multiplyScalar(pal.sunIntensity * (1 - pal.clouds * 0.6) * 0.32));
    const ground = (x: number, z: number) => Math.max(this.world.groundAt(x, z), this.world.waterLevel ?? -1e9);
    this.fx = {
      fire: new Particles(scene, { max: 3600, additive: true, thermal: true, fireRamp: true, fog }),
      smoke: new Particles(scene, { max: 2600, drag: 0.45, grow: 3.2, fog, tint: lightTint }),
      water: new Particles(scene, { max: 4000, gravity: 9.81, drag: 0.35, fog, tint: lightTint, ground, onHit: (x, z, m) => { if (!this.replay) this.mission.onWaterHit(x, z, m); } }),
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
      say: (t, k = "info") => this.say(t, k),
      thermal: () => this.thermal,
      camDir: () => this.camDirV,
      camPos: () => this.cam.position,
      zoom: () => this.zoom,
      fault: (k, dur) => this.instructor(k, false, dur),
      link: () => ({ lost: this.linkLostT > 1, failsafe: this.failsafe, q: this.linkQ }),
    };
    const before = new Set(scene.children);
    this.mission = o.mission.create(ctx);
    if (o.mission.precip) this.precip = new PrecipField(scene, o.mission.precip, o.quality === "low" ? 2500 : o.mission.precip === "rain" ? 9000 : 6000);
    if (o.mission.drain) this.drone.drain = o.mission.drain;
    if (o.failures) {
      const kinds: Fault[] = ["gps", "link", "gust", ...(o.airframe.motors.length > 4 ? ["motor" as Fault] : [])];
      for (let k = 0; k < 2; k++) this.faultPlan.push({ t: 35 + k * 70 + this.rnd() * 50, kind: kinds[Math.floor(this.rnd() * kinds.length)] });
    }
    if (o.flightMode) this.drone.mode = o.flightMode;
    if (o.mission.startMode) this.drone.mode = o.mission.startMode;
    this.input = o.input ?? DEFAULT_INPUT;
    this.drone.rates = this.input.rates;
    if (o.camMode) this.camMode = o.camMode;
    this.model = buildDrone(o.airframe, {
      tank: o.mission.payloadUnit === "л",
      boom: o.mission.id === "agro" || o.mission.id === "ticks" ? Math.min(o.airframe.sprayWidth * 0.35, o.airframe.arm * 2.6) : 0,
      livery: o.livery,
    });
    scene.add(this.model.group);
    before.add(this.model.group);
    this.worldRec = new WorldRecorder(scene, before);

    if (o.quality !== "low") {
      const size = new THREE.Vector2(o.canvas.clientWidth || window.innerWidth, o.canvas.clientHeight || window.innerHeight);
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: o.quality === "high" ? 4 : 2 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(scene, this.cam));
      this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.32, 0.55, 1.1);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
    }
    this.failAt = o.difficulty === "ace" ? 45 + this.rnd() * 60 : Infinity;
    this.audio = new Audio(150 / (0.6 + o.airframe.propR * 3));
    const apal = o.mission.world.palette;
    this.amb = new Ambience({
      forest: o.mission.world.forestDensity, night: !!apal.night || apal.sunIntensity < 0.6, winter: !!apal.snow || o.mission.precip === "snow",
      rain: o.mission.precip === "rain", river: !!o.mission.world.river,
    });
    music.start("flight");
    this.audio.muted = this.amb.muted = getSoundPrefs().muted;

    window.addEventListener("keydown", this.onKey);
    o.canvas.addEventListener("wheel", this.onWheel, { passive: true });
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
    const map: Record<string, Command> = { KeyC: "cam", KeyT: "thermal", KeyV: "pip", KeyG: "gimbal", KeyM: "mode", KeyH: "rth", KeyN: "mute", KeyL: "land", KeyP: "palette", KeyZ: "zoomIn", KeyX: "zoomOut" };
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
    else if (c === "zoomIn" || c === "zoomOut") {
      const i = clamp(ZOOMS.indexOf(this.zoom) + (c === "zoomIn" ? 1 : -1), 0, ZOOMS.length - 1);
      this.zoom = ZOOMS[i];
      if (!this.pip) this.pip = true;
    }
    else if (c === "palette") {
      this.thermalPal = (this.thermalPal + 1) % THERMAL_PALETTES.length;
      try { localStorage.setItem("bas-sim-thermal-pal", String(this.thermalPal)); } catch { /* приватный режим */ }
      if (!this.thermal) { this.thermal = true; this.pip = true; }
      this.say(`Палитра тепловизора: ${THERMAL_PALETTES[this.thermalPal]}`, "info");
    }
    else if (c === "pip") this.pip = !this.pip;
    else if (c === "gimbal") {
      // фиксированные положения подвеса: от надира до горизонта
      const steps = [-90, -60, -45, -30, -15, 0];
      const i = steps.findIndex((v) => v > this.gimbalPitch + 1);
      this.gimbalPitch = i < 0 ? steps[0] : steps[i];
      say(`Подвес: ${this.gimbalPitch === -90 ? "строго вниз" : this.gimbalPitch === 0 ? "по горизонту" : `${-this.gimbalPitch}° вниз`}`, "info");
    }
    else if (c === "mute") { this.audio.muted = !this.audio.muted; this.amb.muted = this.audio.muted; setSoundPrefs({ muted: this.audio.muted }); }
    else if (c === "mode") this.setMode(MODES[(MODES.indexOf(this.drone.mode) + 1) % MODES.length]);
    else if (c === "land" && this.plane) {
      if (this.plane.deployChute()) this.rth = false;
    }
    else if (c === "land") {
      if (this.drone.landed && !this.landReq) return;
      this.landReq = !this.landReq;
      if (this.landReq) this.rth = false;
      say(this.landReq ? "Автопосадка: аппарат снижается сам, стиками ведите его на площадку. Газ вверх — отмена" : "Автопосадка отменена", "info");
    }
    else if (c === "rth") {
      if (!this.rth && !this.drone.gpsOk) { say("Автовозврат недоступен без GPS", "warn"); return; }
      this.rth = !this.rth;
      if (this.rth) this.drone.mode = "POS";
      say(this.rth ? "Автовозврат на базу включён" : "Автовозврат отменён", "info");
    }
  }

  pressAction() { this.actionPressed = true; }

  setMode(m: FlightMode) {
    if (this.ended || this.drone.mode === m) return;
    this.drone.mode = m;
    this.rth = false;
    this.o.onSay(`Режим ${MODE_LABEL[m]}${MANUAL_THROTTLE[m] ? " — газ ручной: центр ≈ висение" : ""}`, "info");
    this.pushHud();
  }

  setCam(c: CamMode) {
    this.camMode = c;
    this.pushHud();
  }

  private readSticks(dt: number): { st: Sticks; held: boolean } {
    const k = this.keys;
    const ax = (pos: string, neg: string) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    const target = {
      roll: ax("ArrowRight", "ArrowLeft"), pitch: ax("ArrowUp", "ArrowDown"),
      yaw: ax("KeyD", "KeyA"), throttle: ax("KeyW", "KeyS"),
    };
    // с клавиатуры газ «вниз до упора» в ручных режимах — это свободное падение; ограничиваем плавным снижением
    if (MANUAL_THROTTLE[this.drone.mode] && target.throttle < 0) target.throttle = -0.45;
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

    const pad = firstPad();
    this.padName = pad ? pad.id : "";
    if (pad) {
      const c = this.input;
      const usePad = c.device === "gamepad";
      if (usePad) {
        // пульт/геймпад полностью заменяет клавиатуру по стикам, если клавиши не нажаты
        const g = {
          roll: readAxis(pad, c.axes.roll, c.deadband), pitch: readAxis(pad, c.axes.pitch, c.deadband),
          yaw: readAxis(pad, c.axes.yaw, c.deadband), throttle: readAxis(pad, c.axes.throttle, c.deadband),
        };
        (Object.keys(g) as (keyof Sticks)[]).forEach((a) => { if (target[a] === 0 && this.touch[a] === 0) out[a] = g[a]; });
        if (c.modeAxis && !this.rth) {
          const pos = switchPos(pad, c.modeAxis);
          if (pos !== this.switchPrev) {
            if (this.switchPrev !== -1 || this.drone.mode !== c.modeMap[pos]) this.setMode(c.modeMap[pos]);
            this.switchPrev = pos;
          }
        }
        if (c.actionAxis !== null && (pad.axes[c.actionAxis] ?? -1) > 0.5) {
          if (!this.actionAxisPrev) this.actionPressed = true;
          held = true;
          this.actionAxisPrev = true;
        } else this.actionAxisPrev = false;
      }
      const b = pad.buttons.map((x) => x.pressed);
      const edge = (i: number) => b[i] && !this.padPrev[i];
      const act = c.actionButton ?? -1;
      if (act >= 0 && edge(act)) this.actionPressed = true;
      if (act >= 0 && b[act]) held = true;
      if (c.preset === "gamepad" || c.device === "keyboard") {
        if (edge(1)) this.command("cam");
        if (edge(2)) this.command("thermal");
        if (edge(3)) this.command("mode");
        if (edge(9)) this.command("rth");
      }
      this.padPrev = b;
    }
    return { st: out, held };
  }

  /** Отказ или нештатная ситуация по команде инструктора. */
  instructor(kind: Fault, random = false, dur = 50) {
    if (this.ended) return;
    const d = this.drone, pre = random ? "Внезапно: " : "Инструктор: ";
    if (kind === "motor") {
      const ok = d.motorOk.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      if (ok.length) { const i = ok[Math.floor(this.rnd() * ok.length)]; d.failMotor(i); this.say(`${pre}ОТКАЗ МОТОРА №${i + 1}! ${d.af.redundancy === "нет" ? "Резерва нет" : "Аппарат держится — садитесь"}`, "warn"); }
    } else if (kind === "gps") {
      if (d.gpsOk) {
        d.gpsOk = false; this.gpsUntil = d.time + dur;
        if (this.rth) { this.rth = false; if (this.failsafe === "rth") this.failsafe = "land"; }
        this.say(`${pre}ПОТЕРЯ GPS! Режим ATTI — аппарат сносит ветром, держите его стиками. Автовозврат недоступен`, "warn");
      } else { d.gpsOk = true; this.gpsUntil = -1; this.say("GPS восстановлен", "good"); }
    } else if (kind === "link") {
      this.jamUntil = d.time + 15;
      if (!random) this.o.onSay("Инструктор: глушение канала управления на 15 с", "info");
    } else if (kind === "gust") {
      const a = this.rnd() * Math.PI * 2;
      this.gust.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(9 + this.rnd() * 4);
      this.say(`${pre}сильный порыв ветра!`, "warn");
    } else if (kind === "battery") {
      d.battery *= 0.5;
      this.say(`${pre}просадка напряжения: одна из банок АКБ деградировала, заряд упал вдвое`, "warn");
    } else {
      d.gpsOk = true; this.gpsUntil = -1; this.jamUntil = -1; this.gust.set(0, 0, 0);
      this.failsafe = null; this.autoLand = false;
      this.o.onSay("Инструктор: отказы сброшены", "info");
    }
  }

  /** Качество радиосвязи: дальность и прямая видимость между пилотом (у машины на базе) и дроном. */
  private updateLink(dt: number) {
    const d = this.drone;
    this.linkAcc += dt;
    if (this.linkAcc < 0.25) return;
    this.linkAcc = 0;
    const px = -5, pz = 6, py = this.world.groundAt(px, pz) + 1.7;
    const dist = Math.hypot(d.pos.x - px, d.pos.y - py, d.pos.z - pz);
    // запас по дальности как у ELRS/Crossfire: уверенно до ~4 км в прямой видимости
    let q = clamp(1 - Math.pow(dist / 5000, 2.4), 0, 1);
    // рельеф и лес на линии «пульт — дрон» ослабляют сигнал; рядом с пилотом лес не мешает (антенна выше)
    let hill = 0, wood = 0, n = 0;
    for (let k = 2; k < 15; k++) {
      const t = k / 15, x = px + (d.pos.x - px) * t, z = pz + (d.pos.z - pz) * t, y = py + (d.pos.y - py) * t;
      const gh = this.world.groundAt(x, z);
      n++;
      if (y < gh - 1) hill++;
      else if (dist > 300 && y < gh + 12 && this.world.treesNear(x, z, 3, this.nearTrees).length) wood++;
    }
    q *= 1 - 0.85 * Math.min(1, (hill / n) * 2.5); // холм между пилотом и дроном
    q *= 1 - 0.3 * (wood / n); // лес глушит умеренно
    if (d.time < this.jamUntil) q = 0;
    this.linkQ += (q - this.linkQ) * 0.6;
  }

  /** Автовозврат: набор безопасной высоты → полёт к базе → посадка. */
  private autopilot(st: Sticks): Sticks {
    const d = this.drone;
    if (this.linkLostT <= 1 && (Math.hypot(st.roll, st.pitch) > 0.3 || Math.abs(st.throttle) > 0.3)) {
      this.rth = false;
      if (this.failsafe) this.failsafe = null;
      this.o.onSay("Автовозврат отменён — управление у пилота", "info");
      return st;
    }
    const dist = Math.hypot(d.pos.x, d.pos.z);
    const agl = d.pos.y - d.gear - this.world.groundAt(d.pos.x, d.pos.z);
    if (!d.gpsOk) {
      this.rth = false;
      if (this.failsafe === "rth") this.failsafe = "land";
      this.say("Автовозврат невозможен без GPS — ведите аппарат вручную", "warn");
      return st;
    }
    const safe = this.world.groundAt(0, 0) + this.input.rthAlt;
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
    out.add(this.gust);
    this.mission.extraWind(p, out);
    return out;
  }

  // ───────────── цикл ─────────────

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.measure(raw);
    if (this.replay) this.replayStep(dt);
    else if (!this.paused) this.update(dt);
    this.render();
    this.hudAcc += dt;
    if (this.hudAcc > 0.12) { this.hudAcc = 0; this.pushHud(); }
  };

  /** Счётчик кадров и динамическое разрешение: при просадке FPS рендер становится чуть мягче, но плавным. */
  private measure(raw: number) {
    if (raw <= 0 || raw > 1) return;
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc < 1) return;
    this.fps = this.fpsN / this.fpsAcc;
    this.fpsAcc = 0; this.fpsN = 0;
    if (!this.autoRes || this.paused) return;
    // с гистерезисом: частая смена разрешения сама по себе выглядит как мерцание картинки
    let pr = this.pr;
    this.lowSec = this.fps < 40 ? this.lowSec + 1 : 0;
    this.highSec = this.fps > 58 ? this.highSec + 1 : 0;
    if (this.lowSec >= 2) { pr = Math.max(0.6, pr - (this.fps < 28 ? 0.2 : 0.1)); this.lowSec = 0; }
    else if (this.highSec >= 6 && pr < this.maxPr) { pr = Math.min(this.maxPr, pr + 0.1); this.highSec = 0; }
    if (Math.abs(pr - this.pr) > 0.01) {
      this.pr = pr;
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  private update(dt: number) {
    const d = this.drone;
    const input = this.readSticks(dt);
    let st = input.st;
    this.updateLink(dt);
    this.gust.multiplyScalar(Math.exp(-dt / 4));
    if (this.gpsUntil > 0 && d.time > this.gpsUntil) { d.gpsOk = true; this.gpsUntil = -1; this.say("GPS восстановлен", "good"); }
    for (const f of this.faultPlan) if (f.t > 0 && d.time > f.t && !d.landed) { f.t = -1; this.instructor(f.kind, true); }
    // потеря связи: команды пульта до дрона не доходят, через 3 с срабатывает failsafe
    if (this.linkQ < 0.08) this.linkLostT += dt;
    else if (this.linkLostT > 0) { if (this.linkLostT > 1) this.say("Связь восстановлена — отклоните стики, чтобы вернуть управление", "good"); this.linkLostT = 0; }
    const lost = this.linkLostT > 1;
    if (lost) {
      st = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      input.held = false; this.actionPressed = false;
      if (!this.failsafe && this.linkLostT > 3 && !d.landed) {
        this.failsafe = this.input.failsafe === "rth" && !d.gpsOk ? "land" : this.input.failsafe;
        this.hoverT = 0;
        this.say(`ПОТЕРЯ СВЯЗИ — failsafe: ${this.failsafe === "rth" ? "возврат на базу" : this.failsafe === "land" ? "посадка на месте" : "зависание"}`, "warn");
      }
    } else if (this.failsafe && this.failsafe !== "rth" && (Math.hypot(st.roll, st.pitch) > 0.3 || Math.abs(st.throttle) > 0.3)) {
      this.failsafe = null;
      this.o.onSay("Управление у пилота", "info");
    }
    // защита по заряду
    const homeDist = Math.hypot(d.pos.x, d.pos.z);
    if (d.soc < 0.2 && !this.lowBatHandled && this.input.lowBatRth && !d.landed && d.gpsOk && homeDist > 25) {
      this.lowBatHandled = true; this.rth = true;
      this.say("Заряд 20% — автоматический возврат на базу. Отменить — отклоните стики", "warn");
    }
    const pl = this.plane;
    if (d.soc < 0.07 && !d.landed && !this.autoLand) {
      this.autoLand = true; this.rth = false;
      if (pl) pl.deployChute();
      this.say(pl ? "КРИТИЧЕСКИЙ ЗАРЯД — выпущен парашют" : "КРИТИЧЕСКИЙ ЗАРЯД — принудительная посадка", "warn");
    }
    if (this.failsafe === "rth") this.rth = true;
    if (pl) {
      // у самолёта свой автопилот возврата: к базе и вираж над ней
      if (this.rth && this.linkLostT <= 1 && (Math.hypot(st.roll, st.pitch) > 0.3 || Math.abs(st.throttle) > 0.3)) {
        this.rth = false; if (this.failsafe) this.failsafe = null;
        this.o.onSay("Автовозврат отменён — управление у пилота", "info");
      }
      pl.autoHome = this.rth && pl.launched && !pl.chute;
    } else if (this.rth && !d.crashed) st = this.autopilot(st);
    if (this.landReq && st.throttle > 0.3) { this.landReq = false; this.o.onSay("Автопосадка отменена", "info"); }
    const needsAssist = !pl && (this.failsafe === "land" || this.failsafe === "hover" || this.autoLand || this.landReq);
    if (needsAssist && MANUAL_THROTTLE[d.mode]) d.mode = "ATTI"; // контроллер сам переходит в режим с удержанием высоты
    if (this.failsafe === "hover") { this.hoverT += dt; if (this.hoverT > 20) { this.failsafe = "land"; this.say("Связи нет 20 с — посадка на месте", "warn"); } }
    if (pl && (this.failsafe === "land" || this.failsafe === "hover")) { this.failsafe = "rth"; this.rth = true; } // самолёт не висит — только возврат
    if (!pl && (this.failsafe === "land" || this.autoLand)) { st = { ...st, throttle: Math.min(st.throttle, -0.55) }; }
    if (this.landReq) {
      // плавное снижение, у самой земли — медленно; горизонталь у пилота, но мягче
      const agl = d.pos.y - d.gear - this.world.groundAt(d.pos.x, d.pos.z);
      st = { ...st, roll: st.roll * 0.5, pitch: st.pitch * 0.5, throttle: agl > 8 ? -0.7 : agl > 2.5 ? -0.45 : -0.25 };
    }
    if (d.landed && (this.failsafe === "land" || this.failsafe === "hover")) this.failsafe = null;
    if (d.landed) { this.autoLand = false; if (this.landReq) { this.landReq = false; this.o.onSay("Посадка выполнена", "good"); } }
    const action: Action = { held: input.held, pressed: this.actionPressed };
    this.actionPressed = false;

    if (!this.ended || this.endTimer >= 0) {
      this.acc += dt;
      while (this.acc >= STEP) { d.step(STEP, st, this.env); this.acc -= STEP; }
      if (pl?.event) this.planeEvent(pl);
    }
    if (!this.ended) {
      this.mission.update(dt, action);
      if (d.time > this.failAt && !d.landed) {
        const i = Math.floor(this.rnd() * d.n);
        d.failMotor(i);
        this.failAt = Infinity;
        this.say(`ОТКАЗ МОТОРА №${i + 1}! ${d.af.redundancy === "нет" ? "Резерва нет" : "Аппарат держится — садитесь"}`, "warn");
      }
      this.rules(dt);
    } else if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) this.finish(false, d.crashed ?? "Миссия провалена");
    }

    updateModels(dt);
    const windNow = d.windNow;
    this.fx.fire.update(dt, windNow);
    this.fx.smoke.update(dt, windNow);
    this.fx.water.update(dt, windNow);
    if (!this.ended) this.record(dt);
    this.syncVisuals(dt);
    let avg = 0;
    for (let i = 0; i < d.n; i++) avg += d.thrust[i] / d.af.motorThrust;
    if (this.recording) {
      this.recT += dt;
      this.trackAcc += dt;
      if (this.trackAcc >= 0.05 || this.track.length === 0) {
        this.trackAcc = 0;
        // ориентация — как у модели на экране (с креном при аварии и погружении)
        const gq = this.model.group.quaternion;
        this.track.push(this.recT, d.pos.x, d.pos.y, d.pos.z, gq.x, gq.y, gq.z, gq.w, avg / d.n);
      }
      this.worldRec.record(this.recT, dt, () => this.mission.snapshot());
    }
    this.audio.set(avg / d.n, !d.crashed && !this.ended);
    this.ambAcc += dt;
    if (this.ambAcc > 0.25) {
      const W = this.world, x = d.pos.x, z = d.pos.z, agl = d.pos.y - W.groundAt(x, z);
      this.ambTrees = Math.min(1, W.treesNear(x, z, 45, this.nearTrees).length / 25);
      const rv = W.cfg.river ? Math.max(0, 1 - W.riverDist(x, z) / 140) : 0;
      this.amb.update(this.ambAcc, { agl, speed: d.vel.length(), wind: d.windNow.length(), trees: this.ambTrees, water: rv });
      this.ambAcc = 0;
    }
  }

  private rules(dt: number) {
    const d = this.drone, m = this.mission, say = (t: string, k: SayKind) => this.say(t, k), pl = this.plane;
    if (d.crashed && d.crashed === WATER_CRASH) {
      this.ended = true; this.endTimer = 3.4;
      this.crashAt = { t: this.recT, water: true };
      this.splashDown();
      say(d.crashed, "warn");
      return;
    }
    if (d.crashed) {
      this.ended = true; this.endTimer = 1.8;
      this.crashAt = { t: this.recT, water: false };
      for (let i = 0; i < 60; i++) {
        this.fx.fire.spawn(d.pos.x, d.pos.y, d.pos.z, (this.rnd() - 0.5) * 9, this.rnd() * 7, (this.rnd() - 0.5) * 9, 0.5 + this.rnd(), 1.5 + this.rnd() * 2, 1, 0.6, 0.15, 0.8);
      }
      say(d.crashed, "warn");
      return;
    }
    if (m.failed) { this.finish(false, m.failed); return; }
    const atBase = Math.hypot(d.pos.x, d.pos.z) < (pl ? 90 : 6);
    if (pl && pl.launched && d.landed && !atBase) {
      // самолёт без катапульты второй раз не взлетит: посадка вне базы — эвакуация наземной группой
      this.finish(m.tasksDone, m.tasksDone ? "Задача выполнена, но посадка вне базы — аппарат эвакуирован" : "Аппарат приземлился вне базы");
      return;
    }
    if (d.landed && atBase) {
      this.baseTimer += dt;
      if (m.tasksDone && this.baseTimer > 1) { this.finish(true, "Задача выполнена"); return; }
      if (!this.serviced && this.baseTimer > 2) {
        this.serviced = true;
        const swapped = d.battery < d.af.batteryWh * 0.97;
        if (swapped) this.swapWh += d.af.batteryWh - d.battery;
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

  /** Сообщение пилоту; предупреждения попадают в замечания разбора полёта. */
  private say(text: string, kind: SayKind) {
    if (this.recording && !this.replay) this.events.push({ t: this.recT, text, kind });
    if (kind === "warn") {
      // одинаковые по смыслу замечания группируем: убираем числа из текста
      const key = text.replace(/[0-9.,]+/g, "N").replace(/\s+/g, " ").trim();
      this.remarks.set(key, (this.remarks.get(key) ?? 0) + 1);
    }
    this.o.onSay(text, kind);
  }

  /** Бортовой журнал: раз в полсекунды точка трека и контроль правил полётов. */
  private record(dt: number) {
    const d = this.drone;
    if (d.landed && this.log.samples.length === 0) return;
    const gh = Math.max(this.world.groundAt(d.pos.x, d.pos.z), this.world.waterLevel ?? -1e9);
    const agl = Math.max(0, d.pos.y - d.gear - gh);
    const spd = Math.hypot(d.vel.x, d.vel.z);
    const L = this.log;
    L.maxAgl = Math.max(L.maxAgl, agl);
    L.maxSpeed = Math.max(L.maxSpeed, spd);
    L.distance += spd * dt;
    // ограничение высоты для БВС без разрешения на использование воздушного пространства — 150 м
    if (agl > 150 && !this.o.mission.airspace) { if (L.over150 === 0) this.say("Выше 150 м — нужен план полёта и разрешение на использование воздушного пространства", "warn"); L.over150 += dt; }
    // полёт за пределами прямой видимости (условно — дальше 2 км от пилота)
    if (Math.hypot(d.pos.x, d.pos.z) > 2000) L.beyondVlos += dt;
    if (d.landed && this.wasAirborne && this.lastVy < -2.5 && !this.plane) { L.hardLandings++; this.say("Жёсткая посадка — гасите вертикальную скорость у земли", "warn"); }
    if (d.bumps !== this.lastBumps) { this.lastBumps = d.bumps; this.say("Задели препятствие — аккуратнее", "warn"); }
    this.wasAirborne = !d.landed;
    this.lastVy = d.vel.y;
    this.logAcc += dt;
    if (this.logAcc >= 0.5) {
      this.logAcc = 0;
      L.samples.push({ t: +this.mission.time.toFixed(1), x: Math.round(d.pos.x), z: Math.round(d.pos.z), agl: +agl.toFixed(1), spd: +spd.toFixed(1), soc: +d.soc.toFixed(3) });
    }
  }

  private finish(success: boolean, reason: string) {
    if (this.ended && this.endTimer >= 0) return;
    this.ended = true; this.endTimer = -1;
    const sum = this.mission.summary();
    const score = success ? Math.round(sum.score) : 0;
    const rows: [string, string][] = [...sum.rows, ["Остаток АКБ", `${Math.round(this.drone.soc * 100)}%`]];
    this.audio.set(0, false);
    this.recording = false;
    this.o.onEnd({
      success, reason, score, stars: !success ? 0 : score >= 85 ? 3 : score >= 60 ? 2 : 1,
      rows: rows.filter((r, i) => rows.findIndex((x) => x[0] === r[0]) === i), time: this.mission.time,
      missionId: this.o.mission.id,
      log: {
        ...this.log, energyWh: +(this.drone.af.batteryWh * (1 - this.drone.soc) + this.swapWh).toFixed(1),
        remarks: [...this.remarks.entries()].sort((a, b) => b[1] - a[1]),
      },
    });
  }

  /** Падение в воду: брызги, туман из капель, кольца волн, звук; дальше аппарат тонет. */
  private splashDown() {
    const d = this.drone, wl = this.world.waterLevel ?? d.pos.y, r = this.rnd, sp = Math.hypot(d.vel.x, d.vel.z);
    this.sink = { t: 0, x: d.pos.x, z: d.pos.z, wl, rings: [] };
    for (let i = 0; i < 220; i++) {
      const a = r() * 6.283, h = 1.5 + r() * 4.5, up = 2.5 + r() * 7 * (1 - h / 8);
      this.fx.water.spawn(d.pos.x + Math.cos(a) * 0.3, wl + 0.1, d.pos.z + Math.sin(a) * 0.3,
        Math.cos(a) * h + d.vel.x * 0.35, up + Math.min(4, -d.vel.y * 0.4), Math.sin(a) * h + d.vel.z * 0.35,
        1.2 + r() * 0.8, 0.1 + r() * 0.25, 0.78, 0.88, 0.96, 0.95);
    }
    // столб брызг по центру и водяная пыль
    for (let i = 0; i < 30; i++) this.fx.water.spawn(d.pos.x, wl + 0.2, d.pos.z, (r() - 0.5) * 1.4, 4 + r() * 6 + sp * 0.2, (r() - 0.5) * 1.4, 1.5, 0.1 + r() * 0.16, 0.78, 0.88, 0.96, 0.9);
    for (let i = 0; i < 10; i++) this.fx.smoke.spawn(d.pos.x + (r() - 0.5) * 1.5, wl + 0.3 + r() * 0.8, d.pos.z + (r() - 0.5) * 1.5, (r() - 0.5) * 1.2, 0.4 + r() * 0.6, (r() - 0.5) * 1.2, 0.9 + r() * 0.5, 0.5 + r() * 0.5, 0.95, 0.97, 1, 0.18);
    const mat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 64), mat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.pos.x, wl + 0.03, d.pos.z);
      ring.visible = false;
      this.world.scene.add(ring);
      this.sink.rings.push(ring);
    }
    mat.dispose();
    playSplash(this.audio.muted);
  }

  private syncVisuals(dt: number) {
    const d = this.drone, g = this.model.group;
    if (this.sink) {
      // аппарат качается на волне, кренится и уходит под воду; поднимаются пузыри
      const s = this.sink;
      s.t += dt;
      const depth = Math.min(2.5, Math.max(0, s.t - 0.25) * 0.75);
      d.pos.set(s.x, s.wl + 0.05 - depth + 0.12 * Math.sin(s.t * 7) * Math.exp(-s.t * 1.5), s.z);
      s.rings.forEach((ring, k) => {
        const tt = s.t - k * 0.35;
        ring.visible = tt > 0;
        if (tt <= 0) return;
        ring.scale.setScalar(0.6 + tt * 2.6 - tt * tt * 0.12);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.55 - tt * 0.2);
      });
      if (s.t > 0.4 && s.t < 3 && this.rnd() < dt * 14) {
        this.fx.water.spawn(s.x + (this.rnd() - 0.5) * 0.8, s.wl + 0.02, s.z + (this.rnd() - 0.5) * 0.8, 0, 0.9, 0, 0.25, 0.1 + this.rnd() * 0.12, 1, 1, 1, 0.8);
      }
    }
    g.position.copy(d.pos);
    g.quaternion.copy(d.quat);
    if (this.sink) { g.rotation.z += Math.min(1.1, this.sink.t * 0.8); g.rotation.x += Math.min(0.5, this.sink.t * 0.3); }
    else if (d.crashed) g.rotation.z += 0.9;
    const frac = this.mission.capacity > 0 ? this.mission.amount / this.mission.capacity : 0;
    this.model.update(dt, d, frac, d.time);

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
      // камера жёстко закреплена на раме и наклонена вверх, как на гоночном дроне
      cam.position.copy(d.pos).addScaledVector(new THREE.Vector3(0, 0.06, -d.af.arm * 0.4).applyQuaternion(d.quat), 1);
      cam.quaternion.copy(d.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.fpvTilt()));
      cam.up.set(0, 1, 0);
      cam.fov = this.input.fpvFov;
    } else if (this.camMode === "los") {
      // пилот стоит у машины на базе и смотрит на аппарат глазами, с лёгким «зумом» вдали
      cam.position.set(-5, this.world.groundAt(-5, 6) + 1.7, 6);
      cam.up.set(0, 1, 0);
      const dist = cam.position.distanceTo(d.pos);
      cam.fov = clamp((2 * Math.atan(9 / Math.max(1, dist)) * 180) / Math.PI, 10, 65);
      cam.lookAt(d.pos);
    } else {
      cam.position.set(d.pos.x, d.pos.y + 75, d.pos.z + 0.01);
      cam.up.set(0, 0, -1);
      cam.fov = 55;
      cam.lookAt(d.pos);
    }
    cam.updateProjectionMatrix();
    this.world.update(dt, d.pos, cam.position);
    this.precip?.update(dt, cam.position, d.windNow);
    if (this.world.grass) {
      let thr = 0;
      for (let i = 0; i < d.n; i++) thr += d.thrust[i];
      // сила потока от винтов растёт с тягой и массой аппарата
      const wash = Math.min(1.4, (thr / (9.81 * 3)) ** 0.5 * 0.35);
      this.world.grass.update(cam.position, d.windNow, d.pos, wash);
    }

    this.pipCam.position.set(d.pos.x, d.pos.y - d.gear * 0.5, d.pos.z);
    // зум: плавно сужаем поле зрения; у тепловизора матрица меньше — поле уже
    const fov0 = 50 / this.zoom;
    if (Math.abs(this.pipCam.fov - fov0) > 0.01) { this.pipCam.fov += (fov0 - this.pipCam.fov) * Math.min(1, dt * 8); this.pipCam.updateProjectionMatrix(); }
    this.pipCam.rotation.set((this.gimbalPitch * Math.PI) / 180, d.yaw, 0, "YXZ");
    this.camDirV.set(0, 0, -1).applyQuaternion(this.pipCam.quaternion);
  }

  // ───────────── повтор полёта ─────────────
  private static readonly TS = 9;
  private trackDur() { const n = this.track.length / SimEngine.TS; return n > 1 ? this.track[(n - 1) * SimEngine.TS] - this.track[0] : 0; }

  /** Запускает повтор: мир остаётся в конечном состоянии, дрон летит по записанному треку. */
  startReplay() {
    if (this.track.length < SimEngine.TS * 2) return false;
    this.replay = { t: 0, playing: true, speed: 1, i: 0 };
    this.recording = false;
    this.paused = false;
    this.thermal = false;
    // мир (звери, грузы, огонь, брызги) проигрывается из записи; крен аварии — из записи ориентации
    this.drone.crashed = null;
    this.sink = null;
    this.worldRec.begin(this.track[0]);
    this.pushHud();
    return true;
  }
  private stallSaid = -10;
  private planeEvent(pl: PlaneSim) {
    const e = pl.event; pl.event = null;
    if (e === "launch") this.say("Старт с катапульты! Автопилот набирает высоту. Газ в центре — крейсерские 85 км/ч", "good");
    else if (e === "chute") this.say("Парашют выпущен: двигатель стоп, купол сносит по ветру", "info");
    else if (e === "stall" && this.drone.time - this.stallSaid > 4) { this.stallSaid = this.drone.time; this.say("СВАЛИВАНИЕ! Ручку от себя, газ вперёд — наберите скорость", "warn"); }
    else if (e === "touchdown") this.say("Приземление", "good");
    else if (e === "tree") this.say("Купол зацепился за деревья — аппарат повис на кроне", "warn");
  }

  /** Самолётный БАС (своя физика, катапульта, парашют). */
  private get plane(): PlaneSim | null { return this.drone instanceof PlaneSim ? this.drone : null; }

  get isReplaying() { return !!this.replay; }
  stopReplay() {
    // мир — в конечное состояние, как после миссии
    this.worldRec.seek(this.track[this.track.length - SimEngine.TS]);
    this.replay = null; this.audio.set(0, false); this.pushHud();
  }
  replayCtl(c: { play?: boolean; speed?: number; seek?: number; step?: number }) {
    const r = this.replay;
    if (!r) return;
    if (c.play !== undefined) { r.playing = c.play; if (c.play && r.t >= this.trackDur()) { r.t = 0; this.worldRec.seek(this.track[0]); } }
    if (c.speed) r.speed = c.speed;
    if (c.seek !== undefined) { r.t = clamp(c.seek, 0, this.trackDur()); r.i = 0; this.worldRec.seek(this.track[0] + r.t); }
    if (c.step) { r.t = clamp(r.t + c.step, 0, this.trackDur()); r.i = 0; this.worldRec.seek(this.track[0] + r.t); }
    this.pushHud();
  }

  private _qa = new THREE.Quaternion(); private _qb = new THREE.Quaternion(); private _pv = new THREE.Vector3();
  private replayStep(dt: number) {
    const r = this.replay!, T = this.track, S = SimEngine.TS, n = T.length / S, t0 = T[0], dur = this.trackDur();
    const prevT = r.t;
    if (r.playing) { r.t += dt * r.speed; if (r.t >= dur) { r.t = dur; r.playing = false; } }
    // всплеск звучит заново, когда повтор проходит момент падения
    if (this.crashAt?.water && prevT < this.crashAt.t - t0 && r.t >= this.crashAt.t - t0) playSplash(this.audio.muted);
    const tt = t0 + r.t;
    // ищем кадр записи (обычно — следующий за прошлым)
    if (r.i >= n - 1 || T[r.i * S] > tt) r.i = 0;
    while (r.i < n - 2 && T[(r.i + 1) * S] <= tt) r.i++;
    const a = r.i * S, b = Math.min(n - 1, r.i + 1) * S;
    const span = T[b] - T[a], k = span > 0 ? clamp((tt - T[a]) / span, 0, 1) : 0;
    const d = this.drone;
    this._pv.copy(d.pos);
    d.pos.set(T[a + 1] + (T[b + 1] - T[a + 1]) * k, T[a + 2] + (T[b + 2] - T[a + 2]) * k, T[a + 3] + (T[b + 3] - T[a + 3]) * k);
    this._qa.set(T[a + 4], T[a + 5], T[a + 6], T[a + 7]); this._qb.set(T[b + 4], T[b + 5], T[b + 6], T[b + 7]);
    d.quat.copy(this._qa).slerp(this._qb, k);
    const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(d.quat);
    d.yaw = Math.atan2(-fw.x, -fw.z);
    if (span > 0) d.vel.set(T[b + 1] - T[a + 1], T[b + 2] - T[a + 2], T[b + 3] - T[a + 3]).divideScalar(span);
    const thr = T[a + 8] + (T[b + 8] - T[a + 8]) * k;
    for (let i = 0; i < d.n; i++) d.thrust[i] = thr * d.af.motorThrust;
    d.landed = thr < 0.05;
    const pdt = r.playing ? dt * r.speed : 0;
    this.worldRec.apply(tt, pdt);
    const sn = this.worldRec.snapshotAt(tt);
    if (sn !== null) this.mission.restore(sn, pdt);
    updateModels(pdt);
    const wind = d.windNow;
    for (const ps of Particles.all) ps.update(pdt, wind);
    this.syncVisuals(r.playing ? dt * r.speed : 0);
    this.audio.set(thr, r.playing && !this.audio.muted);
  }

  /** Автоусиление: по уменьшенному кадру берём 3-й и 99,5-й процентили и плавно подстраиваем диапазон. */
  private thermalAgc(tp: ReturnType<typeof makeThermalPost>) {
    const r = this.renderer;
    tp.sampleMat.uniforms.uTex.value = tp.rt.texture;
    r.setRenderTarget(tp.small);
    r.render(tp.sampleScene, tp.cam);
    try { r.readRenderTargetPixels(tp.small, 0, 0, 32, 24, tp.buf); } catch { return; }
    const v: number[] = [];
    for (let i = 0; i < tp.buf.length; i += 4) v.push(THREE.DataUtils.fromHalfFloat(tp.buf[i]));
    v.sort((a, b) => a - b);
    // диапазон — по фону (2…96 %): мелкие горячие цели не «съедают» контраст и уходят в самые яркие цвета
    const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.96)];
    const u = tp.mat.uniforms;
    const hiC = Math.max(hi, lo + 0.1) + 0.1;
    u.uLo.value += (lo - 0.01 - u.uLo.value) * 0.35;
    u.uHi.value += (hiC - u.uHi.value) * 0.35;
  }

  /** Колесо мыши — зум камеры подвеса (когда открыто её окно). */
  private onWheel = (e: WheelEvent) => {
    if (!this.pip || this.paused) return;
    this.command(e.deltaY < 0 ? "zoomIn" : "zoomOut");
  };

  private resize = () => {
    const c = this.o.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  };

  private render() {
    const r = this.renderer, scene = this.world.scene;
    const c = this.o.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    const pr = r.getPixelRatio();
    const scale = (cam: THREE.PerspectiveCamera, px: number) => (px * pr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const setScale = (v: number) => { this.fx.fire.setScale(v); this.fx.smoke.setScale(v); this.fx.water.setScale(v); };

    // фиксированный ракурс для обложек миссий (задаётся скриптом съёмки)
    if (this.shotCam) {
      const sc = this.shotCam;
      this.cam.position.set(...sc.p); this.cam.up.set(0, 1, 0); this.cam.fov = sc.fov; this.cam.lookAt(...sc.t); this.cam.updateProjectionMatrix();
    }
    this.model.group.visible = this.camMode !== "fpv";
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    setScale(scale(this.cam, h));
    // тени пересчитываем через кадр: глазу незаметно, а нагрузка от теней падает вдвое
    this.frameNo++;
    if (this.frameNo % 2 === 0 || this.o.quality === "high" && this.fps > 55) r.shadowMap.needsUpdate = true;
    if (this.composer) {
      const u = this.grade!.uniforms, fpv = this.camMode === "fpv";
      u.uTime.value = (u.uTime.value + 0.017) % 100;
      u.uGrain.value = fpv ? Math.max(0, 0.45 - this.linkQ) * 0.6 : 0; // шум только как помехи при слабом сигнале
      u.uVignette.value = fpv ? 0.55 : 0.32;
      this.composer.render();
    } else r.render(scene, this.cam);

    if (this.pip) {
      const { pipRect: p } = layout(w, this.thermal);
      const x = w - p.right - p.w, y = h - p.top - p.h;
      this.model.group.visible = false;
      this.shadow.visible = false;
      const bg = scene.background;
      if (this.thermal) {
        this.pipCam.layers.set(THERMAL_LAYER);
        this.fogSaved = scene.fog as THREE.FogExp2;
        scene.fog = null;
        scene.background = THERMAL_SKY;
      } else this.pipCam.layers.set(0);
      this.pipCam.aspect = p.w / p.h;
      this.pipCam.updateProjectionMatrix();
      setScale(scale(this.pipCam, p.h));
      if (this.thermal) {
        // тепловой кадр: сначала «температура» сцены в текстуру, затем обработка как в матрице тепловизора
        const pr = r.getPixelRatio(), tw = Math.round(p.w * pr), th = Math.round(p.h * pr);
        const tp = this.thermalPost ??= makeThermalPost();
        if (tp.rt.width !== tw || tp.rt.height !== th) tp.rt.setSize(tw, th);
        r.setRenderTarget(tp.rt);
        r.render(scene, this.pipCam);
        if (tp.n++ % 6 === 0) this.thermalAgc(tp);
        r.setRenderTarget(null);
        tp.mat.uniforms.uTex.value = tp.rt.texture;
        tp.mat.uniforms.uPx.value.set(1 / tw, 1 / th);
        tp.mat.uniforms.uTime.value = (tp.mat.uniforms.uTime.value + 0.013) % 50;
        tp.mat.uniforms.uPal.value = this.thermalPal;
        r.setScissorTest(true);
        r.setScissor(x, y, p.w, p.h);
        r.setViewport(x, y, p.w, p.h);
        r.render(tp.scene, tp.cam);
      } else {
        r.setScissorTest(true);
        r.setScissor(x, y, p.w, p.h);
        r.setViewport(x, y, p.w, p.h);
        r.render(scene, this.pipCam);
      }
      r.setScissorTest(false);
      if (this.thermal) { scene.fog = this.fogSaved; scene.background = bg; }
      this.model.group.visible = true;
      this.shadow.visible = this.o.quality === "low";
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
      text: (x, z, label, color) => {
        g.font = "bold 9px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "rgba(0,0,0,0.6)"; g.fillText(label, X(x) + 1, Y(z) + 1);
        g.fillStyle = color; g.fillText(label, X(x), Y(z));
      },
      path: (pts, color, w, dash) => {
        if (pts.length < 2) return;
        g.save();
        g.strokeStyle = color; g.lineWidth = w ? Math.max(1.5, w * k) : 1.2; g.lineCap = "round"; g.lineJoin = "round";
        if (dash) g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(X(pts[0][0]), Y(pts[0][1]));
        for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]));
        g.stroke(); g.restore();
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

  private fpvTilt(): number {
    return this.input.fpvTilt === null ? FPV_TILT[this.drone.mode] : (this.input.fpvTilt * Math.PI) / 180;
  }

  /** Линия горизонта в кадре FPV: проекция двух далёких точек на уровне камеры. */
  private horizonLine(): Osd["horizon"] {
    if (this.camMode !== "fpv") return null;
    const c = this.cam, w = this.o.canvas.clientWidth, h = this.o.canvas.clientHeight;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    const az = Math.atan2(f.x, f.z);
    const pts = [-0.25, 0.25].map((da) => new THREE.Vector3(Math.sin(az + da), 0, Math.cos(az + da)).multiplyScalar(4000).add(c.position).project(c));
    if (pts.some((p) => p.z > 1)) return null;
    const [a, b] = pts.map((p) => ({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h }));
    // точка горизонта, ближайшая к центру кадра
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const t = ((w / 2 - a.x) * dx + (h / 2 - a.y) * dy) / (L * L);
    return { x: a.x + dx * t, y: a.y + dy * t, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }

  private osd(): Osd {
    const d = this.drone;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(d.quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(d.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(d.quat);
    const pitch = Math.asin(clamp(fwd.y, -1, 1)), roll = Math.atan2(-right.y, up.y);
    let thr = 0;
    for (let i = 0; i < d.n; i++) thr += d.thrust[i];
    const cells = d.af.batteryWh < 120 ? 4 : d.af.batteryWh < 500 ? 6 : 12;
    return {
      roll: (roll * 180) / Math.PI, pitch: (pitch * 180) / Math.PI,
      throttle: thr / (d.af.motorThrust * d.n), volts: cells * (3.45 + 0.75 * d.soc), cells, horizon: this.horizonLine(), armed: !d.landed || thr > 0.1 * d.mass * 9.81,
    };
  }

  private pushHud() {
    const d = this.drone, m = this.mission, def = this.o.mission;
    const gh = Math.max(this.world.groundAt(d.pos.x, d.pos.z), this.world.waterLevel ?? -1e9);
    const warnings: string[] = [];
    if (d.motorOk.some((x) => !x)) warnings.push("ОТКАЗ МОТОРА");
    if (d.soc < 0.2) warnings.push("НИЗКИЙ ЗАРЯД");
    if (d.windNow.length() > 9) warnings.push("СИЛЬНЫЙ ВЕТЕР");
    const aglW = d.pos.y - d.gear - gh;
    const pl = this.plane;
    if (pl) {
      if (pl.stall) warnings.push("СВАЛИВАНИЕ");
      else if (pl.launched && !pl.chute && !pl.landed && pl.airspeed < (pl.af.wing?.stall ?? 14) * 1.15) warnings.push("МАЛАЯ СКОРОСТЬ");
      if (pl.chute && !pl.landed) warnings.push("ПАРАШЮТ");
      else if (pl.lowAlt && pl.launched && !pl.landed) warnings.push("МАЛАЯ ВЫСОТА — АВТОПИЛОТ НАБИРАЕТ");
      if (!pl.launched) warnings.push("НА КАТАПУЛЬТЕ — ГАЗ ВВЕРХ ДЛЯ СТАРТА");
    } else if (!d.landed && aglW < 6 && d.vel.y < -3) warnings.push("БЫСТРОЕ СНИЖЕНИЕ У ЗЕМЛИ");
    if (!d.gpsOk) warnings.push("НЕТ GPS — РЕЖИМ ATTI");
    if (this.linkQ < 0.22 && this.linkLostT <= 1) warnings.push("СЛАБЫЙ СИГНАЛ ПУЛЬТА");
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
      mode: this.rth ? "Автовозврат" : this.landReq ? "Автопосадка" : MODE_LABEL[d.mode], cam: CAM_LABEL[this.camMode],
      modeId: d.mode, camId: this.camMode, manual: MANUAL_THROTTLE[d.mode], osd: this.osd(),
      fps: this.fps, res: this.pr,
      gpsSats: d.gpsOk ? 14 + Math.round(Math.sin(d.time * 0.05) * 2) : 0, link: this.linkQ,
      failsafe: this.linkLostT > 1 ? (this.failsafe === "rth" ? "НЕТ СВЯЗИ · ВОЗВРАТ" : this.failsafe === "land" ? "НЕТ СВЯЗИ · ПОСАДКА" : this.failsafe === "hover" ? "НЕТ СВЯЗИ · ЗАВИСАНИЕ" : "НЕТ СВЯЗИ")
        : this.autoLand ? "ПРИНУДИТЕЛЬНАЯ ПОСАДКА" : this.failsafe ? "FAILSAFE" : null,
      landing: this.landReq, gimbal: Math.round(this.gimbalPitch),
      thermal: this.thermal, thermalPal: THERMAL_PALETTES[this.thermalPal], zoom: this.zoom,
      replay: this.replay ? { t: this.replay.t, t0: this.track[0] ?? 0, dur: this.trackDur(), playing: this.replay.playing, speed: this.replay.speed, events: this.events } : null,
      underwater: this.sink && this.camMode === "fpv" ? clamp((this.sink.t - 0.3) * 1.6, 0, 1) : 0, noSignal: !!this.sink && this.camMode === "fpv" && this.sink.t > 1.5, pip: this.pip, rth: this.rth,
      distHome: Math.hypot(d.pos.x, d.pos.z), time: m.time, objectives, motors: [...d.motorOk], warnings,
      ...layout(w, this.thermal),
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    this.o.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("blur", this.onBlur);
    this.audio.dispose();
    this.worldRec.dispose();
    this.sink?.rings.forEach((r) => { r.geometry.dispose(); (r.material as THREE.Material).dispose(); });
    if (this.thermalPost) { this.thermalPost.rt.dispose(); this.thermalPost.mat.dispose(); this.thermalPost.small.dispose(); this.thermalPost.sampleMat.dispose(); }
    this.amb.dispose();
    this.precip?.dispose();
    releaseModels();
    this.mission.dispose();
    this.fx.fire.dispose(); this.fx.smoke.dispose(); this.fx.water.dispose();
    this.world.dispose();
    this.composer?.dispose();
    this.bloom?.dispose();
    this.renderer.dispose();
    const w = window as unknown as { __sim?: SimEngine };
    if (w.__sim === this) delete w.__sim;
  }
}
