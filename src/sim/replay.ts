// Запись и воспроизведение мира для повтора полёта: движение объектов миссии (звери, льдина, грузы,
// водяная завеса…), смена их анимаций, рождение частиц (огонь, дым, брызги) и снимки состояния миссии.
import * as THREE from "three";
import { Particles } from "./effects";

const K = 12; // pos3 quat4 scale3 visible opacity

/** Растущий Float32Array — компактно для десятков тысяч кадров. */
class Buf {
  a = new Float32Array(256); n = 0;
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    for (const x of v) this.a[this.n++] = x;
  }
}

interface ObjTrack { t: Buf; d: Buf; parents: THREE.Object3D[]; last: Float32Array; lastParent: THREE.Object3D | null }
interface AnimLog { t: number[]; k: string[]; s: number[]; applied: number }

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _q2 = new THREE.Quaternion();

function opacityOf(o: THREE.Object3D): number {
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  return m && !Array.isArray(m) && m.transparent ? m.opacity : 1;
}

export class WorldRecorder {
  private objs = new Map<THREE.Object3D, ObjTrack>();
  private anims = new Map<THREE.Object3D, AnimLog>();
  private spawns = new Map<Particles, { b: Buf; ptr: number }>();
  private snaps: { t: number; s: unknown }[] = [];
  private acc = 0; private snapAcc = 1;
  private on = true;
  private lastT = 0;

  constructor(private scene: THREE.Scene, private skip: Set<THREE.Object3D>) {
    Particles.onSpawn = (p, a) => {
      if (!this.on) return;
      let s = this.spawns.get(p);
      if (!s) { s = { b: new Buf(), ptr: 0 }; this.spawns.set(p, s); }
      s.b.push(this.lastT, ...a);
    };
  }

  /** Каждый кадр полёта. t — время полёта. */
  record(t: number, dt: number, snapshot: () => unknown) {
    if (!this.on) return;
    this.lastT = t;
    this.acc += dt; this.snapAcc += dt;
    if (this.snapAcc >= 1) {
      this.snapAcc = 0;
      const s = snapshot();
      if (s !== null && s !== undefined) this.snaps.push({ t, s });
    }
    if (this.acc < 0.1 && this.objs.size) return;
    this.acc = 0;
    for (const o of this.scene.children) if (!this.objs.has(o)) this.track(o);
    for (const [o, tr] of this.objs) this.sample(o, tr, t);
  }

  private track(o: THREE.Object3D) {
    if (this.skip.has(o) || (o as THREE.Points).isPoints || o.userData.noReplay) return;
    this.objs.set(o, { t: new Buf(), d: new Buf(), parents: [], last: new Float32Array(K).fill(NaN), lastParent: null });
    // смена анимации зверя записывается вместе со временем
    const play = o.userData.play as ((k: string, s?: number) => void) | undefined;
    if (play && !o.userData.playOrig) {
      const log: AnimLog = { t: [], k: [], s: [], applied: -1 };
      this.anims.set(o, log);
      o.userData.playOrig = play;
      o.userData.play = (k: string, s = 1) => {
        const n = log.k.length;
        if (this.on && (n === 0 || log.k[n - 1] !== k || Math.abs(log.s[n - 1] - s) > 0.15)) { log.t.push(this.lastT); log.k.push(k); log.s.push(s); }
        play(k, s);
      };
    }
  }

  private sample(o: THREE.Object3D, tr: ObjTrack, t: number) {
    const v = [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w,
      o.scale.x, o.scale.y, o.scale.z, o.parent && o.visible ? 1 : 0, opacityOf(o)];
    let changed = tr.lastParent !== o.parent;
    for (let i = 0; i < K && !changed; i++) if (!(Math.abs(v[i] - tr.last[i]) < 0.004)) changed = true;
    if (!changed) return;
    tr.t.push(t); tr.d.push(...v); tr.parents.push(o.parent ?? this.scene);
    tr.last.set(v); tr.lastParent = o.parent;
  }

  stop() { this.on = false; Particles.onSpawn = null; }

  /** Начало повтора: все записанные объекты возвращаются в мир, частицы гаснут. */
  begin(t: number) {
    this.stop();
    for (const p of Particles.all) p.clear();
    this.seek(t);
  }

  seek(t: number) {
    for (const p of Particles.all) p.clear();
    for (const [, s] of this.spawns) { s.ptr = 0; while (s.ptr < s.b.n && s.b.a[s.ptr] <= t) s.ptr += 14; }
    for (const [, a] of this.anims) a.applied = -1;
    this.apply(t, 0);
  }

  /** Состояние мира на момент t; при проигрывании рождаем частицы, появившиеся с прошлого кадра. */
  apply(t: number, dtPlay: number) {
    for (const [o, tr] of this.objs) {
      const n = tr.t.n;
      if (!n) continue;
      const T = tr.t.a, D = tr.d.a;
      if (t < T[0]) { o.visible = false; continue; } // объекта ещё не было
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; }
      const i = lo, j = Math.min(n - 1, i + 1), a = i * K;
      const par = tr.parents[i];
      if (o.parent !== par) par.add(o);
      _p.set(D[a], D[a + 1], D[a + 2]); _q.set(D[a + 3], D[a + 4], D[a + 5], D[a + 6]); _s.set(D[a + 7], D[a + 8], D[a + 9]);
      // плавно между соседними записями, если объект двигался непрерывно
      if (j > i && T[j] - T[i] < 0.35 && tr.parents[j] === par) {
        const k = (t - T[i]) / (T[j] - T[i]), b = j * K;
        _p.lerp(_s.clone().set(D[b], D[b + 1], D[b + 2]), k);
        _q.slerp(_q2.set(D[b + 3], D[b + 4], D[b + 5], D[b + 6]), k);
        _s.set(D[a + 7], D[a + 8], D[a + 9]);
      }
      o.position.copy(_p); o.quaternion.copy(_q); o.scale.copy(_s);
      o.visible = D[a + 10] > 0.5;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m) && m.transparent) m.opacity = D[a + 11];
    }
    for (const [o, log] of this.anims) {
      let i = -1;
      for (let k = 0; k < log.t.length && log.t[k] <= t; k++) i = k;
      if (i >= 0 && i !== log.applied) { (o.userData.playOrig as (k: string, s?: number) => void)(log.k[i], log.s[i]); log.applied = i; }
    }
    if (dtPlay > 0) {
      for (const [p, s] of this.spawns) {
        const A = s.b.a;
        while (s.ptr < s.b.n && A[s.ptr] <= t) {
          const q = s.ptr + 1;
          p.spawn(A[q], A[q + 1], A[q + 2], A[q + 3], A[q + 4], A[q + 5], A[q + 6], A[q + 7], A[q + 8], A[q + 9], A[q + 10], A[q + 11], A[q + 12]);
          s.ptr += 14;
        }
      }
    }
  }

  /** Последний снимок состояния миссии не позже t. */
  snapshotAt(t: number): unknown {
    let lo = 0, hi = this.snaps.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.snaps[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r >= 0 ? this.snaps[r].s : null;
  }

  dispose() { if (Particles.onSpawn) Particles.onSpawn = null; }
}
