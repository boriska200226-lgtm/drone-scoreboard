// Конструктор аппарата: сборка из базовой рамы и комплектующих.
// Каждая деталь меняет реальные параметры физической модели — тягу, массу, ёмкость, отклик.
import { Airframe, getAirframe, hoverMinutes } from "./airframes";

export type Slot = "motors" | "props" | "battery" | "fc";
export interface Part {
  id: string;
  name: string;
  hint: string;
  tier: 1 | 2 | 3;
  apply: (a: Airframe) => void;
}

export const SLOTS: { id: Slot; label: string; icon: string }[] = [
  { id: "motors", label: "Моторы", icon: "Cog" },
  { id: "props", label: "Винты", icon: "Fan" },
  { id: "battery", label: "Аккумулятор", icon: "BatteryCharging" },
  { id: "fc", label: "Прошивка ПК", icon: "Cpu" },
];

/** Масса АКБ при удельной энергии ~200 Вт·ч/кг. */
const batKg = (wh: number) => wh / 200;

export const PARTS: Record<Slot, Part[]> = {
  motors: [
    { id: "std", name: "Штатные", hint: "Баланс тяги и ресурса", tier: 1, apply: () => {} },
    { id: "sport", name: "Спорт KV+", hint: "+18% тяги, быстрее отклик, жрут больше", tier: 2,
      apply: (a) => { a.motorThrust *= 1.18; a.motorTau *= 0.75; a.mass *= 1.04; a.efficiency *= 0.94; a.climb *= 1.2; } },
    { id: "torque", name: "Тяговые", hint: "+30% тяги, грузоподъёмность, тяжелее", tier: 3,
      apply: (a) => { a.motorThrust *= 1.3; a.motorTau *= 1.2; a.mass *= 1.1; a.payloadMax *= 1.25; } },
  ],
  props: [
    { id: "std", name: "Пластик", hint: "Штатные винты", tier: 1, apply: () => {} },
    { id: "carbon", name: "Карбон", hint: "Жёстче и легче: отклик ↑, КПД +3%", tier: 2,
      apply: (a) => { a.motorTau *= 0.85; a.efficiency *= 1.03; a.mass *= 0.99; } },
    { id: "wide", name: "Малошумные", hint: "КПД +7%, но скорость −8%", tier: 2,
      apply: (a) => { a.efficiency *= 1.07; a.maxSpeed *= 0.92; a.motorTau *= 1.1; } },
  ],
  battery: [
    { id: "std", name: "Штатная", hint: "Номинальная ёмкость", tier: 1, apply: () => {} },
    { id: "ext", name: "Увеличенная", hint: "+40% ёмкости, но тяжелее", tier: 2,
      apply: (a) => { const d = a.batteryWh * 0.4; a.batteryWh += d; a.mass += batKg(d) * 1.1; } },
    { id: "race", name: "Облегчённая", hint: "−35% ёмкости, −масса: резвее", tier: 2,
      apply: (a) => { const d = a.batteryWh * 0.35; a.batteryWh -= d; a.mass -= batKg(d) * 0.9; } },
  ],
  fc: [
    { id: "std", name: "Стандарт", hint: "Заводская настройка", tier: 1, apply: () => {} },
    { id: "smooth", name: "Кино", hint: "Мягкие наклоны для съёмки", tier: 1,
      apply: (a) => { a.maxTilt *= 0.8; a.yawRate *= 0.7; a.maxSpeed *= 0.85; } },
    { id: "sport", name: "Спорт", hint: "Наклон +20%, скорость и рыскание ↑", tier: 3,
      apply: (a) => { a.maxTilt = Math.min(0.85, a.maxTilt * 1.2); a.yawRate *= 1.35; a.maxSpeed *= 1.15; a.climb *= 1.15; } },
  ],
};

export type DroneBuild = Record<Slot, string>;
export const STOCK: DroneBuild = { motors: "std", props: "std", battery: "std", fc: "std" };

export function partOf(slot: Slot, id: string): Part {
  return PARTS[slot].find((p) => p.id === id) ?? PARTS[slot][0];
}

/** Аппарат с установленными деталями (новая копия, каталог не меняется). */
export function assemble(id: string, b: DroneBuild = STOCK): Airframe {
  const a: Airframe = { ...getAirframe(id), motors: getAirframe(id).motors.map((m) => ({ ...m })) };
  if (a.kind === "plane" || a.kind === "heli") return a; // у самолёта и вертолёта заводская комплектация
  for (const s of SLOTS) partOf(s.id, b[s.id]).apply(a);
  return a;
}

export interface Perf { twr: number; speed: number; hover: number; hoverFull: number; payload: number; agility: number; mass: number }
export function perf(a: Airframe): Perf {
  return {
    twr: (a.motorThrust * a.motors.length) / ((a.mass + a.payloadMax) * 9.81),
    speed: a.maxSpeed,
    hover: hoverMinutes(a, 0),
    hoverFull: hoverMinutes(a, a.payloadMax),
    payload: a.payloadMax,
    // ловкость: тяговооружённость пустого, быстрота ВМГ и рыскания
    agility: ((a.motorThrust * a.motors.length) / (a.mass * 9.81)) * (0.05 / a.motorTau) * a.yawRate * a.maxTilt,
    mass: a.mass,
  };
}

const KEY = "bas-sim-builds";
export function loadBuilds(): Record<string, DroneBuild> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function saveBuilds(b: Record<string, DroneBuild>) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* приватный режим */ }
}
