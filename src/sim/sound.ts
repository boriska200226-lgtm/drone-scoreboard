// Музыка и звуки природы. Всё синтезируется через WebAudio — без звуковых файлов,
// поэтому одинаково работает в браузере, по ссылке и в настольной версии.

type AC = AudioContext;
let ctx: AC | null = null;
let noiseBuf: AudioBuffer | null = null;

export interface SoundPrefs { music: number; nature: number; muted: boolean }
const KEY = "bas-sim-audio";
export function loadSoundPrefs(): SoundPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { music: typeof v.music === "number" ? v.music : 0.6, nature: typeof v.nature === "number" ? v.nature : 0.8, muted: !!v.muted };
  } catch { return { music: 0.6, nature: 0.8, muted: false }; }
}
let prefs = loadSoundPrefs();
const listeners = new Set<(p: SoundPrefs) => void>();
export function getSoundPrefs() { return prefs; }
export function setSoundPrefs(p: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* приватный режим */ }
  music.applyVolume();
  listeners.forEach((f) => f(prefs));
}
export function onSoundPrefs(f: (p: SoundPrefs) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

function audio(): AC | null {
  if (ctx) return ctx;
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new C();
    const len = ctx.sampleRate * 3;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // браузер разрешает звук только после действия пользователя
    const resume = () => { ctx?.resume().catch(() => undefined); };
    for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, resume, { passive: true });
  } catch { ctx = null; }
  return ctx;
}

function noise(c: AC, loop = false) {
  const s = c.createBufferSource();
  s.buffer = noiseBuf; s.loop = loop;
  if (loop) s.loopStart = Math.random();
  return s;
}
function reverb(c: AC, sec = 2.4) {
  const len = Math.floor(c.sampleRate * sec), buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  const cv = c.createConvolver(); cv.buffer = buf; return cv;
}
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ───────────────────────────── Музыка ─────────────────────────────

/** Синтвейв-трек: бочка, бас «восьмушками» с откачкой, пэд, арпеджио с дилэем и лид-мотив. */
class Music {
  private c: AC | null = null;
  private master!: GainNode; private lp!: BiquadFilterNode;
  private pad!: GainNode; private pump!: GainNode; private rev!: ConvolverNode; private dly!: DelayNode;
  private timer = 0; private step = 0; private next = 0;
  private mode: "menu" | "flight" | "off" = "off";
  private motif: number[] = [];
  private readonly spb = 60 / 118;

  start(mode: "menu" | "flight") {
    this.mode = mode;
    const c = audio();
    if (!c) return;
    if (!this.c) this.build(c);
    this.applyVolume();
    if (!this.timer) {
      this.next = c.currentTime + 0.1;
      this.timer = window.setInterval(() => this.tick(), 25);
    }
  }
  stop() {
    this.mode = "off";
    this.applyVolume();
    window.clearInterval(this.timer); this.timer = 0;
  }
  applyVolume() {
    if (!this.c) return;
    const v = prefs.muted || this.mode === "off" ? 0 : prefs.music * (this.mode === "menu" ? 0.55 : 0.22);
    this.master.gain.setTargetAtTime(v, this.c.currentTime, 0.4);
    this.lp.frequency.setTargetAtTime(this.mode === "flight" ? 2600 : 14000, this.c.currentTime, 0.5);
  }

  private build(c: AC) {
    this.c = c;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master = c.createGain(); this.master.gain.value = 0;
    this.lp = c.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 14000;
    this.master.connect(this.lp).connect(comp).connect(c.destination);
    this.rev = reverb(c);
    const revG = c.createGain(); revG.gain.value = 0.35;
    this.rev.connect(revG).connect(this.master);
    this.dly = c.createDelay(1); this.dly.delayTime.value = this.spb * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2400;
    this.dly.connect(dlp).connect(fb).connect(this.dly);
    dlp.connect(this.master);
    this.pump = c.createGain(); this.pump.connect(this.master);
    this.pad = c.createGain(); this.pad.connect(this.pump); this.pad.connect(this.rev);
    // мотив лида на 4 такта — запоминается, потому что повторяется
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const rhythm = [1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0];
    for (let i = 0; i < 64; i++) this.motif.push(rhythm[i % 16] && Math.random() > 0.12 ? scale[Math.floor(Math.random() * scale.length)] : -1);
  }

  private tick() {
    const c = this.c;
    if (!c || c.state !== "running") { if (c) this.next = c.currentTime + 0.1; return; }
    while (this.next < c.currentTime + 0.15) {
      this.play(this.step, this.next);
      this.next += this.spb / 4; this.step++;
    }
  }

  private play(n: number, t: number) {
    const bar = Math.floor(n / 16) % 32, s = n % 16;
    const A = [[45, 0], [41, 1], [48, 1], [43, 1]], B = [[41, 1], [43, 1], [45, 0], [45, 0]];
    const [root, maj] = (bar < 16 ? A : B)[bar % 4];
    const tri = [0, maj ? 4 : 3, 7];
    const intro = bar < 4, brk = bar >= 24 && bar < 28, full = bar >= 16 && !brk;
    const flight = this.mode === "flight";
    if (s === 0) for (const k of tri) this.padNote(hz(root + 24 + k), t, this.spb * 4);
    // арпеджио по тонам аккорда
    const arp = [0, 1, 2, 1, 2, 0, 1, 2][s % 8], oct = s >= 8 ? 36 : 24;
    this.arp(hz(root + oct + tri[arp]), t, intro ? 0.4 + bar * 0.15 : 1);
    if (intro || brk) return;
    if (s % 4 === 0 || (s === 10 && bar % 2)) this.kick(t);
    if (s % 2 === 1) this.hat(t, 0.5);
    else if (full && !flight) this.hat(t, 0.18);
    if (s % 2 === 0) this.bass(hz(root + [0, 0, 12, 0, 0, 12, 0, 7][s / 2]), t);
    if (full && (s === 4 || s === 12 || (bar === 31 && s >= 12))) this.snare(t, bar === 31 && s > 12 ? 0.6 : 1);
    if (full && !flight) {
      const m = this.motif[(bar % 4) * 16 + s];
      if (m >= 0) this.lead(hz(69 + m), t, this.spb * (s % 4 === 0 ? 0.9 : 0.45));
    }
  }

  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private kick(t: number) {
    const c = this.c!, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    this.env(g, t, 0.9, 0.003, 0.32);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
    // «откачка» пэда и баса под бочку
    this.pump.gain.cancelScheduledValues(t);
    this.pump.gain.setValueAtTime(0.3, t); this.pump.gain.linearRampToValueAtTime(1, t + this.spb * 0.8);
  }
  private snare(t: number, v: number) {
    const c = this.c!, nz = noise(c), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.7;
    this.env(g, t, 0.32 * v, 0.002, 0.2);
    nz.connect(f).connect(g); g.connect(this.master); g.connect(this.rev);
    nz.start(t, Math.random()); nz.stop(t + 0.25);
    const o = c.createOscillator(), og = c.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(og, t, 0.25 * v, 0.002, 0.1);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.15);
  }
  private hat(t: number, v: number) {
    const c = this.c!, nz = noise(c), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "highpass"; f.frequency.value = 8000;
    this.env(g, t, 0.12 * v, 0.001, 0.045);
    nz.connect(f).connect(g).connect(this.master);
    nz.start(t, Math.random()); nz.stop(t + 0.08);
  }
  private bass(f: number, t: number) {
    const c = this.c!, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = "sawtooth"; o.frequency.value = f;
    lp.type = "lowpass"; lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    this.env(g, t, 0.22, 0.004, 0.22);
    o.connect(lp).connect(g).connect(this.pump); o.start(t); o.stop(t + 0.3);
  }
  private padNote(f: number, t: number, len: number) {
    const c = this.c!, lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = "lowpass"; lp.frequency.value = 1300;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.35);
    g.gain.setValueAtTime(0.045, t + len - 0.2); g.gain.linearRampToValueAtTime(0, t + len + 0.25);
    lp.connect(g).connect(this.pad);
    for (const dt of [-8, 8]) {
      const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = dt;
      o.connect(lp); o.start(t); o.stop(t + len + 0.3);
    }
  }
  private arp(f: number, t: number, v: number) {
    const c = this.c!, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = "square"; o.frequency.value = f;
    lp.type = "lowpass"; lp.frequency.value = 2600;
    this.env(g, t, 0.035 * v, 0.003, 0.12);
    o.connect(lp).connect(g); g.connect(this.master); g.connect(this.dly);
    o.start(t); o.stop(t + 0.18);
  }
  private lead(f: number, t: number, len: number) {
    const c = this.c!, o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 5.5; vg.gain.value = 6; vib.connect(vg).connect(o.detune); vg.connect(o2.detune);
    o.type = "sawtooth"; o2.type = "square"; o.frequency.value = f; o2.frequency.value = f; o2.detune.value = 7;
    lp.type = "lowpass"; lp.frequency.value = 3200;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.setValueAtTime(0.05, t + len * 0.8); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master); g.connect(this.rev); g.connect(this.dly);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + len + 0.05); }
  }
}
export const music = new Music();

// ───────────────────────────── Природа ─────────────────────────────

export interface AmbienceCfg {
  forest: number;       // плотность леса миссии
  night: boolean;
  winter: boolean;
  rain: boolean;
  river: boolean;
}
export interface AmbienceState {
  agl: number;          // высота над землёй
  speed: number;        // скорость дрона, м/с
  wind: number;         // ветер у дрона, м/с
  trees: number;        // 0..1 — сколько леса рядом
  water: number;        // 0..1 — близость реки
}

/** Ветер, шелест листвы, птицы (кукушка, дятел, зяблик, иволга), ночью — сова и сверчки, вода, дождь. */
export class Ambience {
  private c: AC | null;
  private out!: GainNode;
  private windG!: GainNode; private windF!: BiquadFilterNode;
  private leafG!: GainNode; private waterG!: GainNode; private rainG!: GainNode; private cricketG: GainNode | null = null;
  private srcs: AudioScheduledSourceNode[] = [];
  private nextCall = 2; private t = 0; private gust = 0; private st: AmbienceState = { agl: 0, speed: 0, wind: 0, trees: 0, water: 0 };
  muted = false;

  constructor(private cfg: AmbienceCfg) {
    this.c = audio();
    const c = this.c;
    if (!c) return;
    this.out = c.createGain(); this.out.gain.value = 0;
    this.out.connect(c.destination);
    this.out.gain.setTargetAtTime(prefs.nature, c.currentTime, 1.5);
    const loop = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const n = noise(c, true), f = c.createBiquadFilter(), g = c.createGain();
      f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
      n.connect(f).connect(g).connect(this.out); n.start();
      this.srcs.push(n);
      return { f, g };
    };
    ({ f: this.windF, g: this.windG } = loop("bandpass", 420, 0.6));
    const leaf = loop("highpass", 2800); this.leafG = leaf.g;
    const water = loop("lowpass", 650, 1.2); this.waterG = water.g;
    const rain = loop("highpass", 1200); this.rainG = rain.g;
    if (cfg.night && !cfg.winter) {
      // сверчки: тон 4,6 кГц с амплитудной модуляцией
      const o = c.createOscillator(), am = c.createOscillator(), amg = c.createGain(), g = c.createGain();
      o.frequency.value = 4600; am.frequency.value = 28; amg.gain.value = 0.5;
      g.gain.value = 0.5; am.connect(amg).connect(g.gain);
      this.cricketG = c.createGain(); this.cricketG.gain.value = 0;
      o.connect(g).connect(this.cricketG).connect(this.out); o.start(); am.start();
      this.srcs.push(o, am);
    }
  }

  update(dt: number, s: AmbienceState) {
    const c = this.c;
    if (!c) return;
    this.t += dt; this.st = s;
    const now = c.currentTime, ground = Math.max(0, 1 - s.agl / 90);
    this.gust += (Math.random() - 0.5) * dt * 1.6; this.gust *= 1 - dt * 0.35;
    const gust = Math.max(0, 1 + this.gust);
    this.out.gain.setTargetAtTime(this.muted || prefs.muted ? 0 : prefs.nature, now, 0.3);
    this.windG.gain.setTargetAtTime(Math.min(0.5, (0.02 + s.wind * 0.012 * gust + s.speed * 0.006) * (0.6 + Math.min(1, s.agl / 60) * 0.6)), now, 0.25);
    this.windF.frequency.setTargetAtTime(280 + s.wind * 40 * gust + s.speed * 18, now, 0.4);
    this.leafG.gain.setTargetAtTime(this.cfg.winter ? 0 : s.trees * ground * (0.012 + s.wind * 0.008 * gust), now, 0.2);
    this.waterG.gain.setTargetAtTime(this.cfg.river ? s.water * ground * 0.09 : 0, now, 0.5);
    this.rainG.gain.setTargetAtTime(this.cfg.rain ? 0.05 : 0, now, 0.5);
    this.cricketG?.gain.setTargetAtTime(0.012 * ground * (0.4 + s.trees), now, 0.5);

    this.nextCall -= dt;
    if (this.nextCall <= 0) {
      this.call();
      const life = this.cfg.winter ? 0.25 : this.cfg.night ? 0.3 : 0.25 + Math.min(1, this.cfg.forest) * 0.75;
      this.nextCall = (1.2 + Math.random() * 4) / Math.max(0.15, life * (0.3 + s.trees * 0.7) * (0.35 + ground * 0.65));
    }
  }

  /** Один «голос» леса со случайной стороны. */
  private call() {
    const c = this.c!, t = c.currentTime + 0.05;
    const pan = c.createStereoPanner(), g = c.createGain(), lp = c.createBiquadFilter();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    const far = 0.25 + Math.random() * 0.75;
    lp.type = "lowpass"; lp.frequency.value = 2500 + far * 7000;
    g.gain.value = far * (0.35 + Math.max(0, 1 - this.st.agl / 90) * 0.65);
    g.connect(lp).connect(pan).connect(this.out);
    const r = Math.random();
    if (this.cfg.night) { if (r < 0.7) this.owl(g, t); else this.chirps(g, t, 4); return; }
    if (this.cfg.winter) { if (r < 0.55) this.crow(g, t); else if (r < 0.8) this.tit(g, t); else this.woodpecker(g, t); return; }
    if (this.cfg.forest < 0.15) { if (r < 0.6) this.plover(g, t); else this.trill(g, t); return; }
    if (r < 0.18) this.cuckoo(g, t);
    else if (r < 0.32) this.woodpecker(g, t);
    else if (r < 0.55) this.trill(g, t);
    else if (r < 0.75) this.oriole(g, t);
    else if (r < 0.9) this.tit(g, t);
    else this.chirps(g, t, 3 + Math.floor(Math.random() * 4));
  }

  private tone(out: AudioNode, t: number, f0: number, f1: number, len: number, peak: number, type: OscillatorType = "sine") {
    const c = this.c!, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, len * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.02);
  }
  private cuckoo(o: AudioNode, t: number) {
    const n = 3 + Math.floor(Math.random() * 6), f = 640 + Math.random() * 80;
    for (let i = 0; i < n; i++) {
      const k = t + i * 0.85;
      this.tone(o, k, f, f * 0.97, 0.22, 0.09);
      this.tone(o, k + 0.27, f * 0.8, f * 0.78, 0.3, 0.08);
    }
  }
  private woodpecker(o: AudioNode, t: number) {
    const c = this.c!, n = 14 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) {
      const k = t + i * (0.05 + i * 0.0006), nz = noise(c), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "bandpass"; f.frequency.value = 1100; f.Q.value = 4;
      g.gain.setValueAtTime(0.25 * (1 - i / n * 0.6), k); g.gain.exponentialRampToValueAtTime(0.0001, k + 0.03);
      nz.connect(f).connect(g).connect(o); nz.start(k, Math.random()); nz.stop(k + 0.04);
    }
  }
  private trill(o: AudioNode, t: number) {
    const n = 6 + Math.floor(Math.random() * 10), f = 3800 + Math.random() * 2500;
    for (let i = 0; i < n; i++) this.tone(o, t + i * 0.055, f * (1 + 0.15 * Math.sin(i)), f * 0.85, 0.045, 0.05);
    // концовка зяблика — росчерк вниз
    this.tone(o, t + n * 0.055 + 0.03, f * 1.1, f * 0.5, 0.18, 0.06);
  }
  private oriole(o: AudioNode, t: number) {
    const base = 1300 + Math.random() * 500, notes = [1, 1.25, 0.9, 1.5];
    notes.forEach((m, i) => this.tone(o, t + i * 0.16, base * m, base * notes[(i + 1) % 4], 0.17, 0.07));
  }
  private tit(o: AudioNode, t: number) {
    const f = 5200 + Math.random() * 800;
    for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.3, f, f, 0.12, 0.04); this.tone(o, t + i * 0.3 + 0.14, f * 0.72, f * 0.7, 0.12, 0.04); }
  }
  private chirps(o: AudioNode, t: number, n: number) {
    for (let i = 0; i < n; i++) { const f = 3000 + Math.random() * 3000; this.tone(o, t + i * (0.12 + Math.random() * 0.15), f, f * (0.6 + Math.random() * 0.8), 0.07, 0.045); }
  }
  private plover(o: AudioNode, t: number) {
    const f = 2600 + Math.random() * 400;
    for (let i = 0; i < 2; i++) this.tone(o, t + i * 0.9, f, f * 0.8, 0.45, 0.05);
  }
  private owl(o: AudioNode, t: number) {
    const f = 380 + Math.random() * 40;
    this.tone(o, t, f, f * 0.95, 0.35, 0.1);
    this.tone(o, t + 0.55, f * 1.04, f * 0.92, 0.25, 0.07);
    this.tone(o, t + 0.85, f, f * 0.9, 0.7, 0.09);
  }
  private crow(o: AudioNode, t: number) {
    const c = this.c!, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const k = t + i * 0.45, bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1300; bp.Q.value = 2;
      bp.connect(o);
      this.tone(bp, k, 620, 480, 0.3, 0.35, "sawtooth");
    }
  }

  dispose() {
    this.srcs.forEach((s) => { try { s.stop(); } catch { /* уже остановлен */ } });
    this.out?.disconnect();
  }
}
