// «Курс пилота»: упражнения по программам подготовки операторов БВС.
// Каждое отрабатывает отдельный навык: висение без GPS, точная посадка, полёт носом вперёд,
// восьмёрка, возврат при отказе навигации и проверка failsafe при потере связи.
import * as THREE from "three";
import { clamp } from "./noise";
import { Ctx, getMission, Mission, MapDraw, MissionDef, Objective } from "./missions";
import { makeBeam, makeHelipad, makeRing, Palette } from "./world";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const FIELD_PAL: Palette = {
  groundA: 0x4d5d2c, groundB: 0x6f6c3c, shore: 0x8a7d60, tree: 0x2a4628, treeVar: 0x3d5a2a, water: 0x1d3a4a,
  skyTop: 0x2f6db5, skyBottom: 0xb4cfe6, fog: 0xa9c3d8, fogDensity: 0.0008,
  sun: 0xfff1dc, sunIntensity: 3.2, ambient: 0xa8c4e8, ambientIntensity: 0.9, sunDir: [0.4, 0.72, 0.42],
  clouds: 0.35, exposure: 0.95, hdr: "rooitou_park_1k.hdr", grassTint: [0.86, 0.9, 0.74],
};

/** Квадрат-разметка на земле. */
function makeSquare(size: number, color: number) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const w = 0.35;
  for (const [x, z, sx, sz] of [[0, -size / 2, size, w], [0, size / 2, size, w], [-size / 2, 0, w, size], [size / 2, 0, w, size]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.06, sz), m);
    b.position.set(x, 0.05, z);
    g.add(b);
  }
  return g;
}

function makeCone(color = 0xff6a10) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  c.position.y = 0.65; c.castShadow = true;
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.36, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  s.position.y = 0.7;
  g.add(c, s);
  return g;
}

abstract class Exercise extends Mission {
  protected beam: THREE.Mesh | null = null;
  protected setBeam(x: number, z: number, color = 0xffd700) {
    if (!this.beam) { this.beam = makeBeam(color, 60, 1.2); this.ctx.world.scene.add(this.beam); }
    (this.beam.material as THREE.MeshBasicMaterial).color.set(color);
    this.beam.position.set(x, this.ctx.world.groundAt(x, z) + 30, z);
    this.beam.visible = true;
  }
  protected hideBeam() { if (this.beam) this.beam.visible = false; }
  protected hdist(x: number, z: number) { const p = this.ctx.drone.pos; return Math.hypot(p.x - x, p.z - z); }
}

// ── 1. Висение в квадрате (ATTI) ──
const HOVER = { x: 0, z: -30 };
class HoverExercise extends Exercise {
  private held = 0; private outside = 0; private sq: THREE.Group;
  constructor(ctx: Ctx) {
    super(ctx);
    this.sq = makeSquare(4, 0xffd700); this.place(this.sq, HOVER.x, HOVER.z);
    this.setBeam(HOVER.x, HOVER.z);
    ctx.say("Режим ATTI: GPS не держит точку, ветер сносит. Висите над квадратом 3–6 м, 30 секунд", "info");
  }
  update(dt: number) {
    this.time += dt;
    if (this.tasksDone) return;
    const r = this.hdist(HOVER.x, HOVER.z), h = this.agl();
    const inside = r < 2 && h > 3 && h < 6;
    const mat = (this.sq.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.color.set(inside ? 0x00ffaa : 0xffd700);
    if (inside) this.held += dt;
    else if (this.held > 0) this.outside += dt;
    if (this.held >= 30) { this.tasksDone = true; this.hideBeam(); this.ctx.say("Зачёт по висению! Садитесь на площадку H", "good"); }
  }
  objectives(): Objective[] {
    return [{ text: "Висеть над квадратом 2×2 м на высоте 3–6 м", done: this.tasksDone, progress: `${Math.floor(this.held)}/30 с` }];
  }
  summary() {
    return { score: clamp(100 - this.outside * 1.2, 30, 100), rows: [["В квадрате", `${Math.floor(this.held)} с`], ["Вне зоны", `${Math.round(this.outside)} с`], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { m.rect(HOVER.x - 2, HOVER.z - 2, HOVER.x + 2, HOVER.z + 2, "#ffd700"); }
}

// ── 2. Точная посадка ──
const PADS: [number, number][] = [[-40, -60], [55, -95], [25, 40]];
class LandingExercise extends Exercise {
  private next = 0; private miss: number[] = []; private calm = 0;
  constructor(ctx: Ctx) {
    super(ctx);
    PADS.forEach(([x, z], i) => this.place(makeHelipad(String(i + 1), "#00aaff"), x, z));
    this.setBeam(...PADS[0]);
    ctx.say("Посадите аппарат по очереди на площадки 1, 2, 3 — как можно ближе к центру", "info");
  }
  update(dt: number) {
    this.time += dt;
    const d = this.ctx.drone;
    if (this.next >= PADS.length) return;
    const [x, z] = PADS[this.next];
    const r = this.hdist(x, z);
    if (d.landed && r < 3.6) {
      this.calm += dt;
      if (this.calm > 1.2) {
        this.miss.push(r);
        this.next++; this.calm = 0;
        this.ctx.say(`Площадка ${this.next}: отклонение ${r.toFixed(2)} м${r < 0.5 ? " — отлично!" : ""}`, r < 1 ? "good" : "info");
        if (this.next >= PADS.length) { this.tasksDone = true; this.hideBeam(); this.ctx.say("Все площадки пройдены — возвращайтесь на H", "good"); }
        else this.setBeam(...PADS[this.next]);
      }
    } else this.calm = 0;
  }
  objectives(): Objective[] {
    return [{ text: `Посадка на площадку ${Math.min(this.next + 1, PADS.length)}`, done: this.tasksDone, progress: `${this.next}/${PADS.length}` }];
  }
  summary() {
    const avg = this.miss.length ? this.miss.reduce((a, b) => a + b, 0) / this.miss.length : 3;
    return { score: clamp(100 - avg * 28 - Math.max(0, this.time - 150) / 4, 25, 100),
      rows: [["Среднее отклонение", `${avg.toFixed(2)} м`], ...this.miss.map((m, i) => [`Площадка ${i + 1}`, `${m.toFixed(2)} м`]), ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { PADS.forEach(([x, z], i) => m.dot(x, z, i === this.next ? "#ffd700" : i < this.next ? "#00ffaa" : "#00aaff", 4)); }
}

// ── 3. Коробочка носом вперёд (ATTI) ──
const BOX: [number, number][] = [[-25, -25], [25, -25], [25, -75], [-25, -75]];
class BoxExercise extends Exercise {
  private next = 0; private laps = 0; private bad = 0; private moving = 0; private warnT = 0;
  private cones: THREE.Group[] = [];
  constructor(ctx: Ctx) {
    super(ctx);
    BOX.forEach(([x, z]) => { const c = makeCone(); this.place(c, x, z); this.cones.push(c); });
    this.setBeam(...BOX[0]);
    ctx.say("Облетите квадрат по конусам 2 раза в ATTI, нос всегда по направлению полёта. Высота 8–20 м", "info");
  }
  update(dt: number) {
    this.time += dt;
    if (this.tasksDone) return;
    const d = this.ctx.drone;
    const v = Math.hypot(d.vel.x, d.vel.z);
    if (v > 2.5 && !d.landed) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(d.quat);
      const cos = (fwd.x * d.vel.x + fwd.z * d.vel.z) / (Math.hypot(fwd.x, fwd.z) * v + 1e-6);
      this.moving += dt;
      if (cos < Math.cos((35 * Math.PI) / 180)) {
        this.bad += dt;
        if (this.time - this.warnT > 6) { this.warnT = this.time; this.ctx.say("Нос не по курсу — доверните рысканием", "info"); }
      }
    }
    const [x, z] = BOX[this.next];
    const h = this.agl();
    if (this.hdist(x, z) < 6 && h > 6 && h < 22) {
      this.next = (this.next + 1) % BOX.length;
      if (this.next === 0) {
        this.laps++;
        this.ctx.say(`Круг ${this.laps} из 2`, "good");
        if (this.laps >= 2) { this.tasksDone = true; this.hideBeam(); this.ctx.say("Коробочка выполнена — на посадку", "good"); return; }
      }
      this.setBeam(...BOX[this.next]);
    }
  }
  private noseShare() { return this.moving > 0 ? 1 - this.bad / this.moving : 1; }
  objectives(): Objective[] {
    return [
      { text: "Два круга по конусам, высота 8–20 м", done: this.tasksDone, progress: `${this.laps}/2 · конус ${this.next + 1}` },
      { text: "Нос по направлению полёта", done: false, progress: `${Math.round(this.noseShare() * 100)}%` },
    ];
  }
  summary() {
    const s = this.noseShare();
    return { score: clamp(s * 100 - Math.max(0, this.time - 140) / 4, 20, 100), rows: [["Нос по курсу", `${Math.round(s * 100)}% времени`], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { BOX.forEach(([x, z], i) => m.dot(x, z, i === this.next ? "#ffd700" : "#ff6a10", i === this.next ? 5 : 3)); }
}

// ── 4. Восьмёрка ──
const EIGHT_C = [{ x: -35, z: -60 }, { x: 35, z: -60 }];
const EIGHT: [number, number][] = (() => {
  // по часовой вокруг правой мачты, против часовой вокруг левой
  const p: [number, number][] = [];
  const R = 22;
  for (const a of [180, 90, 0, -90]) p.push([EIGHT_C[1].x + R * Math.cos((a * Math.PI) / 180), EIGHT_C[1].z + R * Math.sin((a * Math.PI) / 180)]);
  for (const a of [0, 90, 180, 270]) p.push([EIGHT_C[0].x + R * Math.cos((a * Math.PI) / 180), EIGHT_C[0].z + R * Math.sin((a * Math.PI) / 180)]);
  return p;
})();
class EightExercise extends Exercise {
  private next = 0; private laps = 0; private rings: THREE.Mesh[] = [];
  constructor(ctx: Ctx) {
    super(ctx);
    for (const c of EIGHT_C) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 14, 10), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }));
      mast.position.y = 7; mast.castShadow = true;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 1.6), new THREE.MeshStandardMaterial({ color: 0xff3b3b }));
      flag.position.set(0, 13.4, 0.8);
      const g = new THREE.Group(); g.add(mast, flag);
      this.place(g, c.x, c.z);
    }
    EIGHT.forEach(([x, z], i) => {
      const r = makeRing(4.2, 0x00aaff);
      const [nx, nz] = EIGHT[(i + 1) % EIGHT.length], [px, pz] = EIGHT[(i + EIGHT.length - 1) % EIGHT.length];
      r.position.set(x, ctx.world.groundAt(x, z) + 10, z);
      r.rotation.y = Math.atan2(nx - px, nz - pz);
      ctx.world.scene.add(r);
      this.rings.push(r);
    });
    this.paint();
    ctx.say("Восьмёрка вокруг двух мачт: пройдите кольца по порядку, 2 круга, без остановок", "info");
  }
  private paint() {
    this.rings.forEach((r, i) => {
      const m = r.material as THREE.MeshBasicMaterial;
      m.color.set(i === this.next ? 0xffd700 : 0x00aaff);
      m.opacity = i === this.next ? 0.95 : 0.4;
    });
  }
  update(dt: number) {
    this.time += dt;
    if (this.tasksDone) return;
    if (this.rings[this.next].position.distanceTo(this.ctx.drone.pos) < 4.6) {
      this.next = (this.next + 1) % EIGHT.length;
      if (this.next === 0) {
        this.laps++;
        this.ctx.say(`Восьмёрка ${this.laps} из 2`, "good");
        if (this.laps >= 2) { this.tasksDone = true; this.rings.forEach((r) => (r.visible = false)); this.ctx.say("Восьмёрка выполнена — на посадку", "good"); return; }
      }
      this.paint();
    }
  }
  objectives(): Objective[] {
    return [{ text: "Два круга восьмёркой через кольца", done: this.tasksDone, progress: `${this.laps}/2 · ${this.next + 1}/${EIGHT.length}` }];
  }
  summary() {
    return { score: clamp(100 - Math.max(0, this.time - 90) / 1.8, 25, 100), rows: [["Кругов", `${this.laps}/2`], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { this.rings.forEach((r, i) => m.dot(r.position.x, r.position.z, i === this.next ? "#ffd700" : "#00aaff", i === this.next ? 4 : 2)); }
}

// ── 5. Отказ GPS ──
const GPS_WP = { x: 260, z: -330 };
class GpsLossExercise extends Exercise {
  private stage = 0; private lostAt = 0;
  constructor(ctx: Ctx) {
    super(ctx);
    this.place(makeCone(0xffd700), GPS_WP.x, GPS_WP.z);
    this.setBeam(GPS_WP.x, GPS_WP.z);
    ctx.say("Долетите до точки осмотра (жёлтый луч). В пути возможен отказ навигации", "info");
  }
  update(dt: number) {
    this.time += dt;
    const d = this.ctx.drone;
    if (this.stage === 0 && this.hdist(GPS_WP.x, GPS_WP.z) < 25) {
      this.stage = 1; this.lostAt = this.time; this.hideBeam();
      this.ctx.fault?.("gps", 600);
      this.tasksDone = true;
    }
    if (this.stage === 1 && d.landed && Math.hypot(d.pos.x, d.pos.z) < 4.6) this.stage = 2;
  }
  objectives(): Objective[] {
    return [
      { text: "Долететь до точки осмотра", done: this.stage > 0, progress: this.stage === 0 ? `${Math.round(this.hdist(GPS_WP.x, GPS_WP.z))} м` : undefined },
      { text: "Без GPS вернуться вручную по карте и ориентирам", done: false, progress: this.stage ? `${Math.round(Math.hypot(this.ctx.drone.pos.x, this.ctx.drone.pos.z))} м до H` : undefined },
    ];
  }
  summary() {
    const back = this.time - this.lostAt;
    return { score: clamp(100 - Math.max(0, back - 70) / 1.5, 30, 100), rows: [["Возврат без GPS", fmtTime(back)], ["Общее время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { if (this.stage === 0) m.ring(GPS_WP.x, GPS_WP.z, 20, "#ffd700"); }
}

// ── 6. Потеря связи и failsafe ──
const LINK_WP = { x: -220, z: -300 };
class LinkLossExercise extends Exercise {
  private stage = 0; private fsSeen = false;
  constructor(ctx: Ctx) {
    super(ctx);
    this.place(makeCone(0xffd700), LINK_WP.x, LINK_WP.z);
    this.setBeam(LINK_WP.x, LINK_WP.z);
    ctx.say("Проверка failsafe: долетите до точки, там будет включено глушение пульта. Не паникуйте — следите за аппаратом", "info");
  }
  update(dt: number) {
    this.time += dt;
    const st = this.ctx.link?.();
    if (this.stage === 0 && this.hdist(LINK_WP.x, LINK_WP.z) < 25) {
      this.stage = 1; this.hideBeam();
      this.ctx.fault?.("link");
    }
    if (this.stage === 1 && st?.failsafe) { this.fsSeen = true; }
    if (this.stage === 1 && this.fsSeen && st && !st.lost) {
      this.stage = 2; this.tasksDone = true;
      this.ctx.say("Failsafe сработал штатно. Связь есть — перехватите управление и сядьте на H", "good");
    }
  }
  objectives(): Objective[] {
    return [
      { text: "Долететь до точки проверки", done: this.stage > 0 },
      { text: "Дождаться срабатывания failsafe", done: this.fsSeen },
      { text: "Перехватить управление после восстановления связи", done: this.stage > 1 },
    ];
  }
  summary() {
    return { score: clamp(100 - Math.max(0, this.time - 150) / 3, 40, 100), rows: [["Failsafe", this.fsSeen ? "сработал" : "—"], ["Время", fmtTime(this.time)]] as [string, string][] };
  }
  drawMap(m: MapDraw) { if (this.stage === 0) m.ring(LINK_WP.x, LINK_WP.z, 20, "#ffd700"); }
}

const world = (seed: number, clear: number[][], density = 0.35) => ({
  seed, size: 1400, relief: 6, river: { z0: 330, amp: 40, wl: 300, width: 12 },
  flats: [{ x: 0, z: 0, rx: 16, rz: 16 }, { x: 0, z: -50, rx: 70, rz: 60 }],
  clearings: [{ x: 0, z: -40, r: 95 }, ...clear.map(([x, z]) => ({ x, z, r: 30 }))], forestDensity: density, palette: FIELD_PAL,
});

const ex = (d: Omit<MissionDef, "icon" | "color" | "actionLabel" | "gimbalPitch" | "pip" | "payloadLabel" | "payloadUnit" | "place" | "recommended"> & Partial<MissionDef>): MissionDef => ({
  icon: "GraduationCap", color: "#7dd3fc", actionLabel: "—", gimbalPitch: -30, pip: false, payloadLabel: "Груз", payloadUnit: "",
  place: "Учебный аэродром, Сыктывдинский район", recommended: ["quad"], course: true, ...d,
});

export const COURSE: MissionDef[] = [
  ex({
    id: "c-hover", title: "1. Висение в ATTI", tagline: "Удержание точки без GPS", icon: "Crosshair", startMode: "ATTI",
    briefing: ["В режиме ATTI контроллер держит только горизонт и высоту — положение держит пилот.", "Ветер постоянно сносит аппарат: короткими движениями стика удерживайте его над квадратом 2×2 м, высота 3–6 м.", "Нужно набрать 30 секунд в зоне. Затем посадка на H."],
    world: world(301, [HOVER].map((p) => [p.x, p.z])), wind: { toDeg: 60, speed: 3.5, gust: 0.35 },
    create: (c) => new HoverExercise(c),
  }),
  ex({
    id: "c-land", title: "2. Точная посадка", tagline: "Три площадки, оценка по отклонению", icon: "CircleDot",
    briefing: ["Посадка — самый аварийный этап. Снижайтесь плавно, последние 2 м — медленно.", "Сядьте по очереди на площадки 1, 2 и 3 и замрите на секунду. Оценка — среднее отклонение от центра.", "Режим можно выбрать любой; для зачёта на «отлично» — меньше 0,5 м."],
    world: world(302, PADS), wind: { toDeg: 110, speed: 3, gust: 0.3 },
    create: (c) => new LandingExercise(c),
  }),
  ex({
    id: "c-box", title: "3. Коробочка носом вперёд", tagline: "Ориентация аппарата в ATTI", icon: "Route", startMode: "ATTI",
    briefing: ["Пилот должен уверенно управлять аппаратом при любом его курсе.", "Облетите квадрат 50×50 м по конусам два раза, разворачивая нос по направлению полёта рысканием.", "Высота 8–20 м. Оценка — доля времени, когда нос смотрел по курсу."],
    world: world(303, BOX), wind: { toDeg: 200, speed: 3, gust: 0.3 },
    create: (c) => new BoxExercise(c),
  }),
  ex({
    id: "c-eight", title: "4. Восьмёрка", tagline: "Координированные развороты", icon: "Infinity",
    briefing: ["Восьмёрка вокруг двух мачт учит координировать крен и рыскание в развороте.", "Пройдите кольца по порядку два круга без остановок. Чем быстрее и плавнее — тем выше оценка.", "Попробуйте режимы ANGLE или ACRO — так летают FPV-пилоты."],
    world: world(304, EIGHT_C.map((c) => [c.x, c.z])), wind: { toDeg: 30, speed: 2.5, gust: 0.25 },
    create: (c) => new EightExercise(c),
  }),
  ex({
    id: "c-gps", title: "5. Отказ GPS", tagline: "Возврат вручную без навигации", icon: "SatelliteDish",
    briefing: ["Помехи GPS на Севере — обычное дело: магнитные бури, РЭБ, высокие широты.", "Долетите до точки осмотра в 400 м. Там пропадёт навигация: аппарат перейдёт в ATTI, автовозврат будет недоступен.", "Вернитесь вручную, ориентируясь по карте, реке и площадке, и сядьте на H."],
    world: world(305, [[GPS_WP.x, GPS_WP.z]], 0.5), wind: { toDeg: 250, speed: 4.5, gust: 0.4 },
    create: (c) => new GpsLossExercise(c),
  }),
  ex({
    id: "c-link", title: "6. Потеря связи", tagline: "Проверка failsafe", icon: "WifiOff",
    briefing: ["При пропадании радиоканала контроллер выполняет действие failsafe — возврат, посадку или зависание (выбирается во вкладке «Управление»).", "Долетите до точки проверки — инструктор включит глушение пульта на 15 секунд. Убедитесь, что аппарат выполнил failsafe.", "Когда связь вернётся, отклоните стики, чтобы перехватить управление, и сядьте на H."],
    world: world(306, [[LINK_WP.x, LINK_WP.z]], 0.5), wind: { toDeg: 150, speed: 3, gust: 0.3 },
    create: (c) => new LinkLossExercise(c),
  }),
];

/** Миссия или упражнение курса по id. */
export const findMission = (id: string) => COURSE.find((m) => m.id === id) ?? getMission(id);
