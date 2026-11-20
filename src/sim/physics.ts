// Динамика мультикоптера: твёрдое тело 6 степеней свободы, тяга каждого мотора,
// каскадный регулятор (скорость → наклон → угловые скорости → микшер).
import * as THREE from "three";
import { Airframe } from "./airframes";
import { clamp } from "./noise";
import { bfRate, Rates } from "./input";

export type FlightMode = "POS" | "ATTI" | "ANGLE" | "ACRO";
export const MODE_LABEL: Record<FlightMode, string> = {
  POS: "GPS",
  ATTI: "ATTI",
  ANGLE: "Angle",
  ACRO: "Acro",
};
export const MODE_HINT: Record<FlightMode, string> = {
  POS: "держит точку и высоту, отпустил ручки — завис",
  ATTI: "держит только высоту, ветер сносит",
  ANGLE: "выравнивает горизонт, газ ручной",
  ACRO: "ручки задают скорость вращения, без выравнивания — флипы и роллы",
};
/** Режимы с ручным газом: ручка задаёт тягу, центр ≈ висение. */
export const MANUAL_THROTTLE: Record<FlightMode, boolean> = { POS: false, ATTI: false, ANGLE: true, ACRO: true };

export interface Sticks { roll: number; pitch: number; yaw: number; throttle: number }

export interface Env {
  groundAt(x: number, z: number): number;
  waterLevel: number | null;
  /** Уровень воды в точке (озёра — свой уровень); если нет — используется waterLevel. */
  waterAt?(x: number, z: number): number | null;
  wind(p: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3;
  collide(p: THREE.Vector3, r: number): string | null;
}

const G = 9.81;
const RHO = 1.225;

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wind = new THREE.Vector3();
const _vrel = new THREE.Vector3();
const _force = new THREE.Vector3();
const _b3 = new THREE.Vector3();
const _xc = new THREE.Vector3();
const _zb = new THREE.Vector3();
const _xb = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _qd = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _qlevel = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Обращение матрицы 4×4 методом Гаусса–Жордана. */
function invert4(m: number[][]): number[][] {
  const n = 4;
  const a = m.map((r, i) => [...r, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-9;
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((r) => r.slice(n));
}

export class DroneSim {
  readonly af: Airframe;
  readonly n: number;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  omega = new THREE.Vector3(); // в связанной СК
  thrust: Float32Array;
  motorOk: boolean[];
  payload = 0;
  battery: number; // Вт·ч
  mode: FlightMode = "POS";
  landed = true;
  crashed: string | null = null;
  time = 0;
  powerW = 0;
  yaw = 0;
  windNow = new THREE.Vector3();
  gear: number;
  rates: Rates = { rc: 1, superRate: 0.7, expo: 0 };
  speedLimit = Infinity;
  /** Радар рельефа (агродроны): в GPS/ATTI ниже 10 м держит высоту над землёй, а не над точкой взлёта. */
  radar = false;
  private radarAgl = 3;
  /** Есть ли спутниковая навигация: без неё режим GPS работает как ATTI (сносит ветром). */
  gpsOk = true;
  /** Множитель расхода энергии (погода: дождь, мороз). */
  drain = 1; // м/с, ограничение автопилота (например, при опрыскивании)
  radius: number;

  private yawSp = 0;
  private altSp = 0;
  private hold: THREE.Vector3 | null = null;
  private iH = new THREE.Vector3();
  private iZ = 0;
  private alloc: number[][] = [];
  private kq: number;
  private kP: number;
  private cmd: Float32Array;
  private dlt: Float32Array;
  private tick = 0;
  /** Последняя точка без касания препятствий: туда отбрасывает после лёгкого удара. */
  private safe = new THREE.Vector3();
  /** Счётчик лёгких касаний веток и построек (без разрушения). */
  bumps = 0;
  yawLost = false; // после отказа канал рыскания может стать неуправляемым
  private effN = 0; // моторов, реально создающих подъёмную силу

  constructor(af: Airframe) {
    this.af = af;
    this.n = af.motors.length;
    this.thrust = new Float32Array(this.n);
    this.cmd = new Float32Array(this.n);
    this.dlt = new Float32Array(this.n);
    this.motorOk = af.motors.map(() => true);
    this.battery = af.batteryWh;
    this.kq = af.propR * 0.11;
    this.kP = 1 / (Math.sqrt(2 * RHO * Math.PI * af.propR * af.propR) * af.efficiency);
    this.gear = 0.16 + af.arm * 0.28;
    this.radius = af.arm + af.propR;
    this.buildAllocation();
  }

  get mass() { return this.af.mass + this.payload; }
  get soc() { return clamp(this.battery / this.af.batteryWh, 0, 1); }

  reset(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y + this.gear, z);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.quat.setFromAxisAngle(Y_AXIS, yaw);
    this.yawSp = yaw;
    this.yaw = yaw;
    this.altSp = this.pos.y;
    this.landed = true;
    this.crashed = null;
    this.safe.set(0, 0, 0); this.bumps = 0;
    this.thrust.fill(0);
  }

  failMotor(i: number) {
    if (!this.motorOk[i]) return;
    this.motorOk[i] = false;
    this.buildAllocation();
  }

  /** Псевдообратная матрица распределения: [тяга, Mx, My, Mz] → тяги моторов. */
  private buildAllocation() {
    const B: number[][] = [[], [], [], []];
    this.af.motors.forEach((m, i) => {
      const k = this.motorOk[i] ? 1 : 0;
      B[0][i] = k;
      B[1][i] = -m.z * k;
      B[2][i] = m.dir * this.kq * k;
      B[3][i] = m.x * k;
    });
    const solve = (useYaw: boolean) => {
      const M: number[][] = [];
      for (let r = 0; r < 4; r++) {
        M[r] = [];
        for (let c = 0; c < 4; c++) {
          let s = 0;
          if (useYaw || (r !== 2 && c !== 2)) for (let i = 0; i < this.n; i++) s += B[r][i] * B[c][i];
          M[r][c] = s + (r === c ? (!useYaw && r === 2 ? 1 : 1e-7) : 0);
        }
      }
      const inv = invert4(M);
      const out: number[][] = [];
      for (let i = 0; i < this.n; i++) {
        out[i] = [0, 0, 0, 0];
        for (let c = 0; c < 4; c++) {
          if (!useYaw && c === 2) continue;
          let s = 0;
          for (let r = 0; r < 4; r++) if (useYaw || r !== 2) s += B[r][i] * inv[r][c];
          out[i][c] = s;
        }
      }
      return out;
    };
    this.alloc = solve(true);
    // Если исправный мотор не участвует в создании тяги (противоположный отказавшему у гексакоптера),
    // он не может отрабатывать моменты в обе стороны. Отключаем его и жертвуем каналом рыскания.
    const unused = this.alloc.map((a, i) => this.motorOk[i] && a[0] < 0.02);
    this.yawLost = this.n > 4 && unused.some(Boolean);
    if (this.yawLost) {
      unused.forEach((u, i) => { if (u) for (let r = 0; r < 4; r++) B[r][i] = 0; });
      this.alloc = solve(false);
    }
    this.effN = this.alloc.filter((a) => a[0] > 0.02).length;
  }

  step(dt: number, st: Sticks, env: Env) {
    if (this.crashed) return;
    const af = this.af;
    const m = this.mass;
    this.time += dt;

    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const yaw = Math.atan2(-_fwd.x, -_fwd.z);
    this.yaw = yaw;
    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const fMax = af.motorThrust * (0.82 + 0.18 * this.soc);
    const inertiaM = af.mass + this.payload * 0.3;
    const Ixz = inertiaM * (0.38 * af.arm) ** 2 + 0.01;
    const Iy = inertiaM * (0.52 * af.arm) ** 2 + 0.015;
    const idle = this.landed && st.throttle <= 0.05;
    const dead = this.battery <= 0;

    let T = 0, tx = 0, ty = 0, tz = 0;
    if (!idle && !dead) {
      let wx = 0, wy = 0, wz = 0;
      const manual = MANUAL_THROTTLE[this.mode];
      if (manual) {
        // ручной газ без компенсации наклона: накренился — теряешь высоту, как на настоящем FPV
        const hover = m * G, top = fMax * this.effN * 0.94;
        const t = st.throttle, curve = 0.3 * t + 0.7 * t * t * t; // экспо газа: точнее у висения
        T = t >= 0 ? hover + curve * (top - hover) : hover * (1 + curve * 0.65);
        this.altSp = this.pos.y; this.iZ = 0;
        // помощь у земли и в ручных режимах: ниже 4 м не даём снижаться быстрее ~2 м/с
        const aglM = this.pos.y - this.gear - env.groundAt(this.pos.x, this.pos.z);
        if (aglM < 4 && this.vel.y < -1.8 && _up.y > 0.5) T = Math.max(T, m * (G + (-1.8 - this.vel.y) * 4) / _up.y);
      }
      if (this.mode === "ACRO") {
        // рейты с экспо: мягко в центре, до ~400°/с у квадрокоптера на краю
        // рейты Betaflight; крупную раму инерция всё равно не даст раскрутить быстрее, чем позволяют моторы
        const k = (Math.PI / 180) * Math.min(1, Math.sqrt(0.3 / af.arm));
        wx = -bfRate(st.pitch, this.rates) * k; wy = -bfRate(st.yaw, this.rates) * k * 0.8; wz = -bfRate(st.roll, this.rates) * k;
        this.yawSp = yaw; this.hold = null;
      } else {
        // вертикальный канал: ручка задаёт скороподъёмность, в нейтрали — удержание высоты
        let vzDes = 0;
        if (manual) { /* тяга уже задана ручкой */ }
        else if (Math.abs(st.throttle) > 0.05) {
          vzDes = st.throttle > 0 ? st.throttle * af.climb : st.throttle * af.climb * 0.75;
          // помощь при посадке: у земли автопилот гасит вертикальную скорость
          const aglNow = this.pos.y - this.gear - env.groundAt(this.pos.x, this.pos.z);
          vzDes = Math.max(vzDes, -Math.max(0.6, aglNow * 0.55));
          this.altSp = this.pos.y + this.vel.y * 0.35;
        } else {
          const aglR = this.pos.y - this.gear - env.groundAt(this.pos.x, this.pos.z);
          if (this.radar && aglR < 10 && !this.landed) {
            // следуем рельефу: цель — та высота над землёй, на которой пилот отпустил газ
            vzDes = clamp(2.2 * (env.groundAt(this.pos.x, this.pos.z) + this.gear + this.radarAgl - this.pos.y), -af.climb * 0.75, af.climb);
            this.altSp = this.pos.y;
          } else vzDes = clamp(1.6 * (this.altSp - this.pos.y), -af.climb * 0.75, af.climb);
        }
        if (this.radar && Math.abs(st.throttle) > 0.05) this.radarAgl = clamp(this.pos.y - this.gear - env.groundAt(this.pos.x, this.pos.z), 1.5, 10);
        if (!manual) {
          const ez = vzDes - this.vel.y;
          this.iZ = clamp(this.iZ + ez * dt * 1.2, -3, 3);
          const ay = clamp(4.5 * ez + this.iZ, -6, 9);
          T = (m * (G + ay)) / Math.max(0.5, _up.y);
        }

        // горизонтальный канал
        // после отказа автопилот переходит в щадящий режим
        const degraded = this.effN < this.n;
        const aMax = G * Math.tan(af.maxTilt * (degraded ? 0.55 : 1));
        let ax = 0, az = 0;
        const sm = Math.hypot(st.roll, st.pitch);
        if (this.mode === "POS" && this.gpsOk) {
          let vx = 0, vz = 0;
          if (sm > 0.05) {
            const k = Math.min(af.maxSpeed * 0.9, this.speedLimit) / Math.max(1, sm);
            vx = (_fwd.x * st.pitch + _right.x * st.roll) * k;
            vz = (_fwd.z * st.pitch + _right.z * st.roll) * k;
            this.hold = null;
          } else {
            if (!this.hold && Math.hypot(this.vel.x, this.vel.z) < 1.5) this.hold = this.pos.clone();
            if (this.hold) {
              vx = clamp(1.1 * (this.hold.x - this.pos.x), -4, 4);
              vz = clamp(1.1 * (this.hold.z - this.pos.z), -4, 4);
            }
          }
          const ex = vx - this.vel.x, ezh = vz - this.vel.z;
          this.iH.x = clamp(this.iH.x + ex * dt * 0.7, -4, 4);
          this.iH.z = clamp(this.iH.z + ezh * dt * 0.7, -4, 4);
          ax = 2.0 * ex + this.iH.x; az = 2.0 * ezh + this.iH.z;
        } else {
          const k = aMax / Math.max(1, sm);
          ax = (_fwd.x * st.pitch + _right.x * st.roll) * k;
          az = (_fwd.z * st.pitch + _right.z * st.roll) * k;
          this.hold = null;
        }
        const am = Math.hypot(ax, az);
        if (am > aMax) { ax *= aMax / am; az *= aMax / am; }
        if (this.landed) { ax = 0; az = 0; this.iH.set(0, 0, 0); this.yawSp = yaw; }

        this.yawSp -= st.yaw * af.yawRate * dt;
        _b3.set(ax, G, az).normalize();
        _xc.set(Math.cos(this.yawSp), 0, -Math.sin(this.yawSp));
        _zb.crossVectors(_xc, _b3).normalize();
        _xb.crossVectors(_b3, _zb);
        _m4.makeBasis(_xb, _b3, _zb);
        _qd.setFromRotationMatrix(_m4);
        _qe.copy(this.quat).invert().multiply(_qd);
        const s = _qe.w < 0 ? -1 : 1;
        const kAtt = (degraded ? 0.14 : 0.27) / af.motorTau;
        wx = clamp(2 * kAtt * _qe.x * s, -4, 4);
        wz = clamp(2 * kAtt * _qe.z * s, -4, 4);
        wy = clamp(kAtt * _qe.y * s - st.yaw * af.yawRate, -2.6, 2.6);
      }
      const kr = 0.72 / af.motorTau;
      if (this.yawLost) { wy = 0; this.yawSp = yaw; }
      tx = Ixz * clamp(kr * (wx - this.omega.x), -60, 60);
      tz = Ixz * clamp(kr * (wz - this.omega.z), -60, 60);
      ty = Iy * clamp(kr * 0.45 * (wy - this.omega.y), -12, 12);
      // запас тяги оставляем на управление, особенно после отказа мотора
      T = clamp(T, 0.08 * fMax * this.n, fMax * this.effN * (this.effN < this.n ? 0.72 : 0.94));
    }

    // микшер: тяга имеет приоритет, моменты масштабируются так, чтобы ни один мотор не вышел за пределы
    let k = 1;
    for (let i = 0; i < this.n; i++) {
      const a = this.alloc[i];
      const base = a[0] * T, delta = a[1] * tx + a[2] * ty + a[3] * tz;
      this.cmd[i] = base;
      this.dlt[i] = delta;
      if (!this.motorOk[i] || idle || dead) continue;
      if (delta > 1e-6) k = Math.min(k, Math.max(0.25, (fMax - base) / delta));
    }
    let total = 0, power = 15;
    const lag = Math.min(1, dt / af.motorTau);
    for (let i = 0; i < this.n; i++) {
      let f = idle ? 0.04 * fMax : dead ? 0 : this.cmd[i] + k * this.dlt[i];
      f = this.motorOk[i] ? clamp(f, 0, fMax) : 0;
      this.thrust[i] += (f - this.thrust[i]) * lag;
      total += this.thrust[i];
      power += this.kP * Math.pow(this.thrust[i], 1.5);
    }
    this.powerW = power;
    this.battery = Math.max(0, this.battery - (power * this.drain * dt) / 3600);

    // моменты от реальных тяг
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < this.n; i++) {
      const mo = af.motors[i], f = this.thrust[i];
      mx += -mo.z * f; my += mo.dir * this.kq * f; mz += mo.x * f;
    }
    const o = this.omega;
    mx -= 0.02 * Ixz * o.x * 10; mz -= 0.02 * Ixz * o.z * 10; my -= 0.02 * Iy * o.y * 10;
    const ox = (mx - (Ixz - Iy) * o.y * o.z) / Ixz;
    const oy = my / Iy;
    const oz = (mz - (Iy - Ixz) * o.x * o.y) / Ixz;
    o.x += ox * dt; o.y += oy * dt; o.z += oz * dt;
    _dq.set(o.x * dt * 0.5, o.y * dt * 0.5, o.z * dt * 0.5, 1).normalize();
    this.quat.multiply(_dq).normalize();

    // силы
    env.wind(this.pos, this.time, _wind);
    this.windNow.copy(_wind);
    _vrel.copy(this.vel).sub(_wind);
    const refM = af.mass + af.payloadMax * 0.5;
    const c2 = (refM * G * Math.tan(af.maxTilt)) / (af.maxSpeed * af.maxSpeed);
    const sp = _vrel.length();
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _force.copy(_up).multiplyScalar(total);
    _force.y -= m * G;
    _force.addScaledVector(_vrel, -(0.08 * refM + c2 * sp));
    this.vel.addScaledVector(_force, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // земля, вода, препятствия
    const gh = env.groundAt(this.pos.x, this.pos.z);
    const bottom = this.pos.y - this.gear;
    const wl = env.waterAt ? env.waterAt(this.pos.x, this.pos.z) : env.waterLevel;
    if (wl !== null && gh < wl && bottom < wl) {
      this.crashed = "Аппарат упал в воду";
      return;
    }
    if (bottom <= gh) {
      const hs = Math.hypot(this.vel.x, this.vel.z), vs = -this.vel.y;
      // шасси и рама гасят удар: разрушение только при падении, кувырке на скорости или «посадке» на ходу
      if (vs > 8 || hs > 11 || (_up.y < 0.35 && vs + hs > 3)) {
        this.pos.y = gh + this.gear * 0.5;
        this.crashed = _up.y < 0.72 ? "Опрокидывание при касании земли" : "Жёсткое столкновение с землёй";
        return;
      }
      this.pos.y = gh + this.gear;
      // жёсткое касание — отскок, а не взрыв
      if (this.vel.y < 0) this.vel.y = vs > 3 ? vs * 0.22 : 0;
      const fr = Math.max(0, 1 - 9 * dt);
      this.vel.x *= fr; this.vel.z *= fr;
      if (total < m * G) {
        this.landed = true;
        _qlevel.setFromAxisAngle(Y_AXIS, this.yaw);
        this.quat.slerp(_qlevel, Math.min(1, 12 * dt));
        o.multiplyScalar(0.6);
        this.iZ = 0;
        this.altSp = this.pos.y;
      }
    } else if (bottom > gh + 0.08) this.landed = false;

    if (++this.tick % 4 === 0) {
      const hit = env.collide(this.pos, this.radius);
      const sp = this.vel.length();
      if (hit && sp < 4.5 && this.safe.lengthSq() > 0) {
        // задели ветку или стену на малой скорости — отбрасывает назад
        this.pos.copy(this.safe);
        this.vel.multiplyScalar(-0.35);
        this.omega.multiplyScalar(0.3);
        this.bumps++;
      } else if (hit) this.crashed = hit;
      else this.safe.copy(this.pos);
    }
  }
}
