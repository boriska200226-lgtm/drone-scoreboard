/**
 * Свисток и вибрация.
 *
 * Браузер не даст зазвучать до первого касания экрана, поэтому контекст
 * создаётся заранее и разблокируется на первом же клике — иначе первый
 * свисток учителя ушёл бы в тишину.
 */
let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function unlockAudio(): void {
  const ac = audioContext();
  if (ac && ac.state === "suspended") void ac.resume();
}

export function audioReady(): boolean {
  return ctx?.state === "running";
}

/** Один свист: две гармоники плюс «трель» — узнаваемый судейский свисток. */
function blast(ac: AudioContext, startAt: number, duration = 0.34): void {
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.5, startAt + 0.02);
  gain.gain.setValueAtTime(0.5, startAt + duration - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  // Трель: горошина внутри свистка даёт быструю модуляцию частоты.
  const warble = ac.createOscillator();
  const warbleGain = ac.createGain();
  warble.frequency.setValueAtTime(28, startAt);
  warbleGain.gain.setValueAtTime(70, startAt);
  warble.connect(warbleGain);

  [2350, 3520].forEach((freq, index) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, startAt);
    warbleGain.connect(osc.frequency);
    const partial = ac.createGain();
    partial.gain.setValueAtTime(index === 0 ? 1 : 0.45, startAt);
    osc.connect(partial).connect(gain);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  });

  warble.start(startAt);
  warble.stop(startAt + duration + 0.02);
}

/** Глухой удар — дебафф «мат». Звучит иначе, чтобы не путали со свистком. */
function thud(ac: AudioContext, startAt: number): void {
  const gain = ac.createGain();
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.55);

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(220, startAt);
  osc.frequency.exponentialRampToValueAtTime(60, startAt + 0.5);
  osc.connect(gain);
  osc.start(startAt);
  osc.stop(startAt + 0.56);
}

export function playWhistle(blasts = 1): void {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  const now = ac.currentTime + 0.01;
  for (let i = 0; i < blasts; i += 1) blast(ac, now + i * 0.45);
}

export function playDebuff(): void {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  thud(ac, ac.currentTime + 0.01);
}

export function vibrate(pattern: number[]): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // На десктопе и в части браузеров вибрации нет — это не ошибка.
  }
}

/** Сигнал целиком: звук + вибрация 100 мс, как требует §7 ТЗ. */
export function alarm(sound: "whistle" | "debuff" | undefined, blasts = 1,
                      pattern: number[] = [100]): void {
  if (sound === "whistle") playWhistle(blasts);
  else if (sound === "debuff") playDebuff();
  vibrate(pattern);
}
