// Вертолётный БАС одновинтовой схемы. Управление в режимах GPS/ATTI — как у коптера (ручки задают
// скорость или наклон, газ — вертикальную скорость), но физика своя:
//  • одна тяга несущего винта, наклоном «тарелки» (циклический шаг) создаётся горизонтальная сила;
//  • косая обдувка: на 15–40 км/ч винт тянет заметно лучше, чем на висении (меньше мощность);
//  • рулевой винт парирует реактивный момент; на скорости хвост работает как флюгер;
//  • отказ двигателя — авторотация: обороты держит набегающий снизу поток; у земли шагом «подрывают»,
//    гася скорость снижения запасённой энергией винта. В GPS/ATTI это делает автопилот, в ACRO — пилот.
import * as THREE from "three";
import type { Airframe } from "./airframes";
import { clamp } from "./noise";
import { DroneSim, Env, MANUAL_THROTTLE, Sticks } from "./physics";

const G = 9.81, RHO = 1.225;
const _w = new THREE.Vector3(), _va = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _e = new THREE.Euler();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class HeliSim extends DroneSim {
  pitch = 0; roll = 0; heading = 0;
  /** Обороты несущего винта (1 — номинал). */
  rpm = 1;
  engineOk = true;
  /** Шаг несущего винта 0…1. */
  coll = 0;
  event: string | null = null;
  /** Внешняя сила от груза на тросе, Н (задаёт миссия каждый кадр). */
  sling = new THREE.Vector3();
  private altH = 0; private holdingH = false; private holdP: THREE.Vector3 | null = null;
  private ivH = new THREE.Vector3(); private ivZ = 0;
  private tickH = 0;
  private safeH = new THREE.Vector3();

  constructor(af: Airframe) {
    super(af);
    this.gear = 0.48;
    this.radius = af.propR * 1.02;
  }

  reset(x: number, y: number, z: number, yaw: number) {
    super.reset(x, y, z, yaw);
    this.pitch = 0; this.roll = 0; this.heading = yaw; this.rpm = 1; this.engineOk = true; this.coll = 0;
    this.motorOk.fill(true);
    this.altH = this.pos.y; this.holdingH = false; this.holdP = null;
    this.applyAtt();
  }

  failMotor() {
    if (!this.engineOk) return;
    this.engineOk = false;
    this.event = "engine";
  }

  private applyAtt() {
    this.quat.setFromEuler(_e.set(this.pitch, this.heading, -this.roll, "YXZ"));
    this.yaw = this.heading;
  }

  step(dt: number, st: Sticks, env: Env) {
    if (this.crashed) return;
    const af = this.af, m = this.mass;
    this.time += dt;
    env.wind(this.pos, this.time, _w);
    this.windNow.copy(_w);
    const gh = env.groundAt(this.pos.x, this.pos.z), agl = this.pos.y - this.gear - gh;
    _va.copy(this.vel).sub(_w);
    const vh = Math.hypot(_va.x, _va.z);
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    const manual = MANUAL_THROTTLE[this.mode];
    const idle = this.landed && st.throttle <= 0.05 && this.engineOk;
    const dead = this.battery <= 0;
    if (dead && this.engineOk) { this.failMotor(); this.event = "fuel"; }

    // обороты: двигатель держит номинал; без двигателя — только поток снизу против нагрузки шага
    if (this.engineOk) this.rpm += ((idle ? 0.55 : 1) - this.rpm) * Math.min(1, dt * 1.2);
    else {
      const inflow = clamp(-_va.y / 19, 0, 1.3); // поток снизу раскручивает винт
      // тяжёлый винт хранит энергию: на подрывке обороты падают за 2–3 с, а не мгновенно
      this.rpm = clamp(this.rpm + (inflow * 0.85 - this.coll * 0.9 - 0.04) * dt * 0.35, 0, 1.12);
    }
    const etl = 1 + 0.14 * smooth(3, 11, vh) - 0.05 * smooth(18, 30, vh); // косая обдувка
    const Tmax = af.motorThrust * this.rpm * this.rpm * etl;

    // ── желаемое горизонтальное ускорение → наклон «тарелки» ──
    let ax = 0, az = 0;
    const tiltMax = Math.tan(af.maxTilt) * G;
    if (this.mode === "POS" && this.gpsOk) {
      let vx = 0, vz = 0;
      const sm = Math.hypot(st.roll, st.pitch);
      if (sm > 0.05) {
        const k = af.maxSpeed / Math.max(1, sm);
        vx = (fx * st.pitch + rx * st.roll) * k; vz = (fz * st.pitch + rz * st.roll) * k;
        this.holdP = null;
      } else {
        if (!this.holdP && Math.hypot(this.vel.x, this.vel.z) < 1.2) this.holdP = this.pos.clone();
        if (this.holdP) { vx = clamp(0.9 * (this.holdP.x - this.pos.x), -4, 4); vz = clamp(0.9 * (this.holdP.z - this.pos.z), -4, 4); }
      }
      const ex = vx - this.vel.x, ez = vz - this.vel.z;
      this.ivH.x = clamp(this.ivH.x + ex * dt * 0.5, -3, 3); this.ivH.z = clamp(this.ivH.z + ez * dt * 0.5, -3, 3);
      ax = 1.4 * ex + this.ivH.x; az = 1.4 * ez + this.ivH.z;
    } else if (this.mode !== "ACRO") {
      ax = (fx * st.pitch + rx * st.roll) * tiltMax; az = (fz * st.pitch + rz * st.roll) * tiltMax;
      this.holdP = null;
    }
    if (!this.engineOk && !manual && agl < 18) { ax = -1.1 * this.vel.x; az = -1.1 * this.vel.z; } // перед касанием гасим поступательную
    const am = Math.hypot(ax, az);
    if (am > tiltMax) { ax *= tiltMax / am; az *= tiltMax / am; }
    if (this.landed) { ax = 0; az = 0; this.ivH.set(0, 0, 0); }
    if (this.mode === "ACRO") {
      this.pitch += -st.pitch * 2.2 * dt; this.roll += st.roll * 2.6 * dt;
    } else {
      const aF = ax * fx + az * fz, aR = ax * rx + az * rz;
      const pT = -Math.atan(aF / G), rT = Math.atan(aR / G);
      // ротор отвечает быстро, фюзеляж — с запаздыванием
      this.pitch += (pT - this.pitch) * Math.min(1, dt * 4.5);
      this.roll += (rT - this.roll) * Math.min(1, dt * 5);
    }
    this.pitch = clamp(this.pitch, -0.8, 0.8); this.roll = clamp(this.roll, -0.9, 0.9);

    // рысканье: рулевой винт; без двигателя хвост слабее, на скорости — флюгер
    const flowH = Math.atan2(-_va.x, -_va.z);
    this.heading += -st.yaw * af.yawRate * dt * (this.engineOk ? 1 : 0.5) + wrap(flowH - this.heading) * dt * 0.35 * smooth(10, 25, vh);
    this.applyAtt();
    _up.set(0, 1, 0).applyQuaternion(this.quat);

    // ── вертикаль: шаг несущего винта ──
    let T: number;
    if (!this.engineOk && !manual) {
      // автоматическая авторотация: шаг вниз — держим обороты; у земли — подрывка
      if (agl > 10) this.coll = clamp(0.3 + (this.rpm - 0.98) * 2.5, 0.05, 0.7); // шагом держим обороты
      else {
        const want = -Math.max(1.3, agl * 0.8); // подрывка: гасим скорость к самому касанию
        const need = (m * (G + 3.5 * (want - this.vel.y))) / Math.max(0.5, _up.y);
        this.coll = clamp(need / Math.max(1, Tmax), 0, 1);
      }
      this.holdingH = false;
    } else if (manual) {
      this.coll = clamp((st.throttle + 1) / 2, 0, 1);
      this.holdingH = false;
    } else {
      let vz: number;
      if (Math.abs(st.throttle) > 0.05) {
        vz = st.throttle > 0 ? st.throttle * af.climb : st.throttle * af.climb * 0.8;
        vz = Math.max(vz, -Math.max(0.6, agl * 0.5)); // мягкая посадка
        this.holdingH = false;
      } else {
        if (!this.holdingH) { this.altH = this.pos.y + this.vel.y * 0.4; this.holdingH = true; }
        vz = clamp(1.4 * (this.altH - this.pos.y), -af.climb, af.climb);
      }
      const ez = vz - this.vel.y;
      this.ivZ = clamp(this.ivZ + ez * dt, -3, 3);
      const need = (m * (G + 3.2 * ez + this.ivZ) - this.sling.y) / Math.max(0.5, _up.y);
      this.coll = clamp(need / Math.max(1, Tmax), 0, 1);
    }
    T = this.coll * Tmax;
    if (idle) T = 0;
    this.thrust[0] += (T - this.thrust[0]) * Math.min(1, dt / af.motorTau);
    // рулевой винт крутится от трансмиссии и на авторотации
    this.thrust[1] = this.rpm > 0.2 ? this.thrust[0] * 0.08 + 20 * this.rpm : 0;

    // мощность: индуктивная с учётом косой обдувки + рулевой винт и трансмиссия
    const A = Math.PI * af.propR * af.propR;
    this.powerW = this.engineOk ? (Math.pow(this.thrust[0], 1.5) / Math.sqrt(2 * RHO * A) / af.efficiency / etl) * 1.15 + 300 : 0;
    this.battery = Math.max(0, this.battery - (this.powerW * this.drain * dt) / 3600);

    // силы
    const c2 = (m * G * Math.tan(af.maxTilt)) / (af.maxSpeed * af.maxSpeed);
    _f.copy(_up).multiplyScalar(this.thrust[0]);
    _f.y -= m * G;
    _f.addScaledVector(_va, -(0.05 * m + c2 * _va.length()));
    _f.add(this.sling);
    this.vel.addScaledVector(_f, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // земля, вода, препятствия
    const bottom = this.pos.y - this.gear;
    const wl = env.waterAt ? env.waterAt(this.pos.x, this.pos.z) : env.waterLevel;
    if (wl !== null && gh < wl && bottom < wl) { this.crashed = "Аппарат упал в воду"; return; }
    if (bottom <= gh) {
      const vs = -this.vel.y, hs = Math.hypot(this.vel.x, this.vel.z);
      if (vs > (this.engineOk ? 4.5 : 5.2) || hs > 7 || _up.y < 0.8) {
        this.pos.y = gh + this.gear * 0.5;
        this.crashed = !this.engineOk ? "Жёсткая посадка на авторотации — не хватило подрывки" : _up.y < 0.8 ? "Вертолёт опрокинулся при касании" : "Вертолёт разбит при посадке";
        return;
      }
      this.pos.y = gh + this.gear;
      if (this.vel.y < 0) this.vel.y = 0;
      const fr = Math.max(0, 1 - 8 * dt);
      this.vel.x *= fr; this.vel.z *= fr;
      if (this.thrust[0] < m * G * 0.95) {
        if (!this.landed && !this.engineOk) this.event = "autorot-ok";
        this.landed = true;
        this.pitch *= 0.8; this.roll *= 0.8;
        this.holdP = null; this.ivZ = 0; this.altH = this.pos.y;
      }
    } else if (bottom > gh + 0.08) this.landed = false;

    if (++this.tickH % 3 === 0) {
      const hit = env.collide(this.pos, this.radius);
      if (hit && this.vel.length() < 3 && this.safeH.lengthSq() > 0) {
        // лопасти задели ветки на малой скорости — отбросило назад
        this.pos.copy(this.safeH); this.vel.multiplyScalar(-0.3); this.bumps++;
      } else if (hit) this.crashed = `Несущий винт задел препятствие: ${hit.toLowerCase()}`;
      else this.safeH.copy(this.pos);
    }
  }
}
