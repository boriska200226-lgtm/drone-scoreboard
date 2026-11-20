// Каталог аппаратов. Все величины в СИ: кг, м, Н, Вт·ч.

export interface MotorDef {
  x: number; // вправо
  z: number; // назад (нос смотрит в -Z)
  y: number; // смещение по высоте (соосные схемы)
  dir: 1 | -1; // направление вращения
}

export interface Airframe {
  id: string;
  name: string;
  scheme: string;
  description: string;
  motors: MotorDef[];
  arm: number; // длина луча
  propR: number; // радиус винта
  mass: number; // снаряжённая масса с АКБ
  payloadMax: number;
  motorThrust: number; // макс. тяга одного мотора, Н
  motorTau: number; // постоянная времени ВМГ, с
  batteryWh: number;
  efficiency: number; // FM винта × КПД схемы
  maxTilt: number; // рад, в режимах стабилизации
  maxSpeed: number; // м/с на макс. наклоне
  climb: number; // м/с
  yawRate: number; // рад/с
  sprayWidth: number; // м, ширина захвата штанги
  pumpRate: number; // кг/с, сброс/забор жидкости
  redundancy: string;
  color: number;
  /** Тип: мультикоптер (по умолчанию) или самолёт. */
  kind?: "multi" | "plane";
  /** Самолёт: площадь крыла м², размах м, крейсерская и скорость сваливания м/с. */
  wing?: { area: number; span: number; cruise: number; stall: number };
}

function ring(n: number, arm: number, offsetDeg: number): MotorDef[] {
  const out: MotorDef[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((offsetDeg + (360 / n) * i) * Math.PI) / 180;
    out.push({ x: arm * Math.sin(a), z: -arm * Math.cos(a), y: 0, dir: i % 2 === 0 ? 1 : -1 });
  }
  return out;
}

function coax(arm: number): MotorDef[] {
  const out: MotorDef[] = [];
  for (let i = 0; i < 4; i++) {
    const a = ((45 + 90 * i) * Math.PI) / 180;
    const d = i % 2 === 0 ? 1 : -1;
    out.push({ x: arm * Math.sin(a), z: -arm * Math.cos(a), y: 0.06, dir: d as 1 | -1 });
    out.push({ x: arm * Math.sin(a), z: -arm * Math.cos(a), y: -0.06, dir: -d as 1 | -1 });
  }
  return out;
}

export const AIRFRAMES: Airframe[] = [
  {
    id: "quad",
    name: "Стриж-4",
    scheme: "Квадрокоптер X4",
    description: "Лёгкий и манёвренный. Быстро летит, мало несёт. Отказ любого мотора — потеря аппарата.",
    motors: ring(4, 0.25, 45),
    arm: 0.25, propR: 0.19, mass: 2.6, payloadMax: 2, motorThrust: 22, motorTau: 0.04,
    batteryWh: 90, efficiency: 0.6, maxTilt: 0.61, maxSpeed: 19, climb: 6, yawRate: 2.2,
    sprayWidth: 3, pumpRate: 0.6, redundancy: "нет", color: 0x00ffaa,
  },
  {
    id: "hexa",
    name: "Сапсан-6",
    scheme: "Гексакоптер X6",
    description: "Рабочая лошадка МЧС и лесоохраны. Держится в воздухе при отказе одного мотора.",
    motors: ring(6, 0.55, 30),
    arm: 0.55, propR: 0.28, mass: 9.5, payloadMax: 8, motorThrust: 56, motorTau: 0.06,
    batteryWh: 400, efficiency: 0.6, maxTilt: 0.56, maxSpeed: 16, climb: 5, yawRate: 1.6,
    sprayWidth: 5, pumpRate: 1.6, redundancy: "1 мотор", color: 0x00aaff,
  },
  {
    id: "coax",
    name: "Тайга-X8",
    scheme: "Соосный октокоптер X8",
    description: "Восемь моторов на четырёх лучах: компактный, устойчив к ветру, но соосная схема съедает ~15% КПД.",
    motors: coax(0.62),
    arm: 0.62, propR: 0.33, mass: 14, payloadMax: 12, motorThrust: 63, motorTau: 0.07,
    batteryWh: 700, efficiency: 0.51, maxTilt: 0.56, maxSpeed: 15, climb: 5, yawRate: 1.5,
    sprayWidth: 6, pumpRate: 2.2, redundancy: "до 4 моторов (по одному на луч)", color: 0xffd700,
  },
  {
    id: "octo",
    name: "Беркут-8",
    scheme: "Октокоптер X8 (плоский)",
    description: "Тяжёлый носитель: 20 кг воды или химикатов. Инертный, зато переживает отказ двух моторов.",
    motors: ring(8, 0.95, 22.5),
    arm: 0.95, propR: 0.36, mass: 24, payloadMax: 20, motorThrust: 106, motorTau: 0.09,
    batteryWh: 1200, efficiency: 0.6, maxTilt: 0.5, maxSpeed: 14, climb: 4, yawRate: 1.2,
    sprayWidth: 8, pumpRate: 3, redundancy: "1–2 мотора", color: 0xff8800,
  },
];

/** Самолётные БАС: держатся в воздухе за счёт скорости, взлёт с катапульты, посадка на парашюте. */
export const PLANES: Airframe[] = [
  {
    id: "krechet",
    name: "Кречет",
    scheme: "Самолёт, толкающий винт, V-хвост",
    description: "Разведчик лесоохраны: 3 часа в воздухе, 90 км/ч, камера и тепловизор на подвесе. Не умеет висеть: ниже 55 км/ч сваливается. Старт с катапульты, посадка на парашюте.",
    motors: [{ x: 0, z: 0.62, y: 0.05, dir: 1 }],
    arm: 1.55, propR: 0.22, mass: 14, payloadMax: 1.5, motorThrust: 62, motorTau: 0.35,
    batteryWh: 1500, efficiency: 0.55, maxTilt: 0.75, maxSpeed: 36, climb: 5, yawRate: 0.5,
    sprayWidth: 0, pumpRate: 0, redundancy: "парашют", color: 0x7dd3fc,
    kind: "plane", wing: { area: 0.85, span: 3.1, cruise: 24, stall: 14.5 },
  },
];

export const isPlane = (a: Airframe) => a.kind === "plane";
export const getAirframe = (id: string) => AIRFRAMES.find((a) => a.id === id) ?? PLANES.find((a) => a.id === id) ?? AIRFRAMES[0];

/** Расчётное время висения, мин. */
export function hoverMinutes(af: Airframe, payload: number): number {
  // самолёт не висит: время в воздухе на крейсерской скорости
  if (af.kind === "plane") return (af.batteryWh / 560) * 60;
  const m = af.mass + payload;
  const t = (m * 9.81) / af.motors.length;
  const area = Math.PI * af.propR * af.propR;
  const p = (af.motors.length * Math.pow(t, 1.5)) / (Math.sqrt(2 * 1.225 * area) * af.efficiency) + 15;
  return (af.batteryWh / p) * 60;
}
