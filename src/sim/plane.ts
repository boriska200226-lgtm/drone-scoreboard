// Самолётный БАС: подъёмная сила крыла зависит от скорости и угла атаки, ниже скорости сваливания
// крыло срывается. Автопилот (как у серийных разведчиков) держит крен, скорость и высоту:
//   крен — ручкой вбок (до 45°), набор/снижение — ручкой на себя/от себя (в центре — держит высоту),
//   газ — заданная скорость (в центре — крейсерская). В ACRO ручки задают угловые скорости, газ — тягу.
// Старт — с катапульты (газ вверх), посадка — на парашюте (L).
import * as THREE from "three";
import type { Airframe } from "./airframes";
import { clamp } from "./noise";
import { DroneSim, Env, Sticks } from "./physics";

const G = 9.81, RHO = 1.225;
const CL0 = 0.32, CLA = 5.2, CD0 = 0.034, KI = 0.055;
const _w = new THREE.Vector3(), _va = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3();
const _lift = new THREE.Vector3(), _f = new THREE.Vector3(), _e = new THREE.Euler();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class PlaneSim extends DroneSim {
  /** Углы ориентации: курс (как yaw у коптера), тангаж (+ нос вверх), крен (+ правое крыло вниз). */
  pitch = 0; roll = 0; heading = 0;
  launched = false;
  chute = false;
  stall = false;
  /** Сработала защита от земли (ниже 35 м в режиме стабилизации). */
  lowAlt = false;
  airspeed = 0;
  /** Автопилот возврата: летит к базе и кружит над ней на 120 м. */
  autoHome = false;
  /** Событие для движка: катапульта, парашют, сваливание. */
  event: string | null = null;
  private altHold = 0;
  private holding = false;
  private thrCmd = 0;
  private iV = 0;
  private hitTick = 0;

  constructor(af: Airframe) {
    super(af);
    this.gear = 0.22;
    this.radius = (af.wing?.span ?? 3) * 0.32;
  }

  reset(x: number, y: number, z: number, yaw: number) {
    super.reset(x, y, z, yaw);
    // на рельсе катапульты: нос вверх на 10°, высота направляющей ~1,3 м
    this.heading = yaw; this.pitch = 0.17; this.roll = 0;
    this.pos.set(x, y + 1.3, z);
    this.launched = false; this.chute = false; this.stall = false; this.autoHome = false;
    this.applyAttitude();
  }

  deployChute() {
    if (this.chute || this.landed || !this.launched) return false;
    this.chute = true; this.autoHome = false;
    this.event = "chute";
    return true;
  }

  private applyAttitude() {
    this.quat.setFromEuler(_e.set(this.pitch, this.heading, -this.roll, "YXZ"));
    this.yaw = this.heading;
  }

  step(dt: number, st: Sticks, env: Env) {
    if (this.crashed) return;
    const af = this.af, w = af.wing!, m = this.mass;
    this.time += dt;
    env.wind(this.pos, this.time, _w);
    this.windNow.copy(_w);
    const gh = env.groundAt(this.pos.x, this.pos.z);

    // ── на катапульте ──
    if (!this.launched) {
      this.thrust[0] = 0;
      this.landed = true;
      if (st.throttle > 0.5 && this.battery > 0) {
        this.launched = true; this.landed = false;
        _fw.set(0, 0, -1).applyQuaternion(this.quat);
        this.vel.copy(_fw).multiplyScalar(w.cruise * 0.9);
        // после схода с катапульты автопилот набирает 100 м над местностью
        this.altHold = gh + 100;
        this.holding = true;
        this.thrCmd = 1;
        this.event = "launch";
      }
      return;
    }

    // ── под парашютом: купол сносит ветром, вертикальная ~4,5 м/с ──
    if (this.chute) {
      this.thrust[0] += (0 - this.thrust[0]) * Math.min(1, dt * 3);
      const k = Math.min(1, dt * 1.6);
      this.vel.x += (_w.x * 0.9 - this.vel.x) * k;
      this.vel.z += (_w.z * 0.9 - this.vel.z) * k;
      this.vel.y += (-4.5 - this.vel.y) * k;
      this.pitch += (0 - this.pitch) * k; this.roll += (Math.sin(this.time * 1.3) * 0.08 - this.roll) * k;
      this.applyAttitude();
      if (!this.landed) this.pos.addScaledVector(this.vel, dt);
      this.airspeed = 0; this.stall = false;
      const wl0 = env.waterAt ? env.waterAt(this.pos.x, this.pos.z) : env.waterLevel;
      if (wl0 !== null && gh < wl0 && this.pos.y - this.gear < wl0) { this.crashed = "Аппарат упал в воду"; return; }
      if (this.pos.y - this.gear <= gh) {
        this.pos.y = gh + this.gear; this.vel.set(0, 0, 0);
        if (!this.landed) this.event = "touchdown";
        this.landed = true;
        this.pitch = 0; this.roll = 0.35; // лёг на крыло
        this.applyAttitude();
      }
      // посадка на кроны — аппарат повис на дереве
      if (!this.landed && (++this.hitTick % 6 === 0) && env.collide(this.pos, this.radius * 0.6)) {
        this.vel.set(0, 0, 0); this.landed = true; this.event = "tree";
      }
      return;
    }

    // ── полёт ──
    _va.copy(this.vel).sub(_w);
    const V = Math.max(0.1, _va.length());
    this.airspeed = V;
    const ctrl = clamp(V / (w.cruise * 0.8), 0.15, 1.3); // рули действуют сильнее на скорости
    const acro = this.mode === "ACRO";
    const gamma = Math.asin(clamp(_va.y / V, -1, 1));

    if (this.autoHome) {
      // к базе на 120 м, над ней — вираж
      const dist = Math.hypot(this.pos.x, this.pos.z);
      const want = Math.atan2(this.pos.x, this.pos.z); // курс «на базу»
      const err = wrap(want - this.heading);
      const rollCmd = dist < 170 ? 0.5 : clamp(-err * 1.4, -0.75, 0.75);
      const alt = gh + 120;
      st = { roll: rollCmd / 0.75, pitch: -clamp((alt - this.pos.y) * 0.04, -1, 1), throttle: 0, yaw: 0 };
      this.holding = false;
    }

    let rollT: number, pitchT: number;
    if (acro) {
      this.roll += st.roll * 2.2 * ctrl * dt;
      this.pitch += -st.pitch * 1.3 * ctrl * dt;
      rollT = this.roll; pitchT = this.pitch;
    } else {
      rollT = st.roll * af.maxTilt;
      // ручка тангажа — вертикальная скорость; отпущена — держим высоту
      let vz: number;
      if (Math.abs(st.pitch) > 0.05) { vz = -st.pitch * af.climb; this.holding = false; }
      else {
        if (!this.holding) { this.altHold = this.pos.y + this.vel.y * 0.8; this.holding = true; }
        vz = clamp(0.6 * (this.altHold - this.pos.y), -af.climb, af.climb);
      }
      // защита от земли: ниже 35 м над рельефом автопилот уводит вверх
      const agl = this.pos.y - gh;
      this.lowAlt = agl < 35;
      if (agl < 35) { vz = Math.max(vz, (35 - agl) * 0.35); if (this.holding) this.altHold = Math.max(this.altHold, gh + 36); }
      // на крене часть подъёмной силы уходит в разворот — автопилот добирает тангажем
      const trim = Math.max(0, (m * G) / (0.5 * RHO * V * V * w.area * Math.max(0.3, Math.cos(this.roll))) - CL0) / CLA;
      pitchT = clamp(Math.asin(clamp(vz / Math.max(V, 8), -0.6, 0.6)) + clamp(trim, -0.05, 0.22), -0.4, 0.45);
      this.roll += clamp((rollT - this.roll) * 2.4, -1.2, 1.2) * ctrl * dt;
      this.pitch += clamp((pitchT - this.pitch) * 2.2, -0.7, 0.7) * ctrl * dt;
    }
    this.roll = clamp(this.roll, -1.3, 1.3);
    this.pitch = clamp(this.pitch, -1.1, 1.1);

    // угол атаки и срыв
    const alpha = this.pitch - gamma;
    const aStall = 0.21;
    let CL = CL0 + CLA * alpha;
    this.stall = alpha > aStall || V < af.wing!.stall * 0.85;
    if (alpha > aStall) CL = CL0 + CLA * aStall - (alpha - aStall) * 4;
    if (this.stall) {
      // срыв: нос опускается, крыло валится — так самолёт сам набирает скорость
      this.pitch -= 0.9 * dt;
      this.roll += Math.sin(this.time * 2.1) * 0.6 * dt;
      if (!this.event) this.event = "stall";
    }
    CL = clamp(CL, -0.6, 1.45);
    const q = 0.5 * RHO * V * V * w.area;

    // тяга: автомат скорости (газ в центре — крейсерская) или прямой газ в ACRO
    const fMax = af.motorThrust * (this.battery > 0 ? 1 : 0);
    if (acro) this.thrCmd = clamp((st.throttle + 1) / 2, 0, 1);
    else {
      const vT = this.autoHome ? w.cruise : w.cruise + st.throttle * (st.throttle > 0 ? af.maxSpeed - w.cruise : w.cruise - w.stall * 1.15);
      const ev = vT - V;
      this.iV = clamp(this.iV + ev * dt * 0.08, -0.4, 0.6);
      this.thrCmd = clamp(0.35 + ev * 0.12 + this.iV - (this.pos.y - this.altHold) * 0.004, 0, 1);
    }
    const T = this.thrCmd * fMax;
    this.thrust[0] += (T - this.thrust[0]) * Math.min(1, dt / af.motorTau);
    this.powerW = 40 + (this.thrust[0] * Math.max(V, 10)) / af.efficiency;
    this.battery = Math.max(0, this.battery - (this.powerW * this.drain * dt) / 3600);

    // разворот: нос идёт за воздушным потоком (флюгерная устойчивость) + руль направления
    const flowHeading = Math.atan2(-_va.x, -_va.z);
    this.heading += wrap(flowHeading - this.heading) * Math.min(1, dt * 3.5) - st.yaw * 0.25 * ctrl * dt;
    this.applyAttitude();

    // силы
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _fw.set(0, 0, -1).applyQuaternion(this.quat);
    const vh = _va.clone().divideScalar(V);
    _lift.copy(_up).addScaledVector(vh, -_up.dot(vh)).normalize().multiplyScalar(q * CL);
    _f.copy(_lift).addScaledVector(vh, -q * (CD0 + KI * CL * CL)).addScaledVector(_fw, this.thrust[0]);
    _f.y -= m * G;
    this.vel.addScaledVector(_f, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // земля, вода, деревья
    const bottom = this.pos.y - this.gear;
    const wl = env.waterAt ? env.waterAt(this.pos.x, this.pos.z) : env.waterLevel;
    if (wl !== null && gh < wl && bottom < wl) { this.crashed = "Аппарат упал в воду"; return; }
    if (bottom <= gh) {
      const vs = -this.vel.y, hs = Math.hypot(this.vel.x, this.vel.z);
      if (vs > 2.5 || hs > 22 || Math.abs(this.roll) > 0.5) { this.pos.y = gh + this.gear; this.crashed = "Самолёт разбился о землю — садитесь на парашюте (L)"; return; }
      // посадка «на брюхо» на малой скорости
      this.pos.y = gh + this.gear; this.vel.y = 0;
      this.vel.x *= Math.max(0, 1 - 2 * dt); this.vel.z *= Math.max(0, 1 - 2 * dt);
      if (hs < 1) { this.landed = true; this.vel.set(0, 0, 0); this.event = "touchdown"; }
    }
    if (++this.hitTick % 3 === 0) {
      const hit = env.collide(this.pos, this.radius);
      if (hit) this.crashed = `Столкновение: ${hit.toLowerCase()}`;
    }
  }
}
