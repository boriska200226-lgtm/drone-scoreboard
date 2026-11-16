// Настройки управления: клавиатура, геймпад или RC-пульт (EdgeTX/OpenTX по USB — это HID-джойстик).
import type { FlightMode } from "./physics";

export type StickChannel = "throttle" | "yaw" | "pitch" | "roll";
export const STICKS: StickChannel[] = ["throttle", "yaw", "pitch", "roll"];
export const STICK_LABEL: Record<StickChannel, string> = { throttle: "Газ", yaw: "Рыскание", pitch: "Тангаж", roll: "Крен" };

export interface AxisMap { axis: number; invert: boolean; min: number; max: number; center: number }
export interface Rates { rc: number; superRate: number; expo: number }

export interface InputConfig {
  device: "keyboard" | "gamepad";
  preset: string;
  axes: Record<StickChannel, AxisMap>;
  /** Тумблер на 3 положения, переключающий режимы полёта. */
  modeAxis: AxisMap | null;
  modeMap: [FlightMode, FlightMode, FlightMode];
  actionButton: number | null;
  actionAxis: number | null;
  /** Газ на пульте не самоцентрируется: центр хода = висение / удержание высоты. */
  deadband: number;
  rates: Rates;
  fpvTilt: number | null; // градусы; null — по режиму
  fpvFov: number;
}

const axis = (n: number, invert = false): AxisMap => ({ axis: n, invert, min: -1, max: 1, center: 0 });

export const PRESETS: Record<string, { label: string; hint: string; make: () => Partial<InputConfig> }> = {
  gamepad: {
    label: "Геймпад, Mode 2",
    hint: "Xbox / PlayStation: левый стик — газ и рыскание, правый — крен и тангаж",
    make: () => ({ axes: { yaw: axis(0), throttle: axis(1, true), roll: axis(2), pitch: axis(3, true) }, modeAxis: null, actionButton: 0, actionAxis: null }),
  },
  edgetx: {
    label: "Пульт EdgeTX / OpenTX (AETR)",
    hint: "RadioMaster, Jumper, FrSky в режиме USB-джойстика: CH1 крен, CH2 тангаж, CH3 газ, CH4 рыскание, CH5 — тумблер режима",
    make: () => ({ axes: { roll: axis(0), pitch: axis(1), throttle: axis(2), yaw: axis(3) }, modeAxis: axis(4), actionButton: null, actionAxis: 5 }),
  },
  taer: {
    label: "Пульт (TAER)",
    hint: "Порядок каналов Spektrum/старых прошивок: CH1 газ, CH2 крен, CH3 тангаж, CH4 рыскание",
    make: () => ({ axes: { throttle: axis(0), roll: axis(1), pitch: axis(2), yaw: axis(3) }, modeAxis: axis(4), actionButton: null, actionAxis: 5 }),
  },
};

export const DEFAULT_INPUT: InputConfig = {
  device: "keyboard",
  preset: "gamepad",
  axes: { yaw: axis(0), throttle: axis(1, true), roll: axis(2), pitch: axis(3, true) },
  modeAxis: null,
  modeMap: ["POS", "ANGLE", "ACRO"],
  actionButton: 0,
  actionAxis: null,
  deadband: 0.04,
  rates: { rc: 1.0, superRate: 0.7, expo: 0.0 },
  fpvTilt: null,
  fpvFov: 110,
};

const KEY = "bas-sim-input";
export function loadInput(): InputConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return { ...DEFAULT_INPUT, ...v, axes: { ...DEFAULT_INPUT.axes, ...v.axes }, rates: { ...DEFAULT_INPUT.rates, ...v.rates } };
    }
  } catch { /* повреждённые или недоступные данные */ }
  return structuredClone(DEFAULT_INPUT);
}
export function saveInput(c: InputConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* приватный режим */ }
}

export function firstPad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  for (const g of navigator.getGamepads()) if (g && g.connected && g.axes.length >= 4) return g;
  return null;
}

/** Нормализация сырого значения оси с учётом калибровки, инверсии и мёртвой зоны. */
export function readAxis(pad: Gamepad, m: AxisMap, deadband: number): number {
  const raw = pad.axes[m.axis] ?? 0;
  let v = raw >= m.center ? (raw - m.center) / Math.max(1e-3, m.max - m.center) : (raw - m.center) / Math.max(1e-3, m.center - m.min);
  if (m.invert) v = -v;
  v = Math.max(-1, Math.min(1, v));
  if (Math.abs(v) < deadband) return 0;
  return Math.sign(v) * (Math.abs(v) - deadband) / (1 - deadband);
}

/** Положение тумблера: 0, 1 или 2. */
export function switchPos(pad: Gamepad, m: AxisMap): number {
  const v = readAxis(pad, m, 0);
  return v < -0.33 ? 0 : v > 0.33 ? 2 : 1;
}

/** Кривая Betaflight «Actual/Betaflight rates»: стик −1..1 → угловая скорость, °/с. */
export function bfRate(x: number, r: Rates): number {
  const ax = Math.abs(x);
  let rc = r.rc;
  if (rc > 2) rc += 14.54 * (rc - 2);
  const e = x * ax * ax * ax * r.expo + x * (1 - r.expo);
  let rate = 200 * rc * e;
  if (r.superRate > 0) rate *= 1 / Math.max(0.01, 1 - ax * r.superRate);
  return rate;
}
