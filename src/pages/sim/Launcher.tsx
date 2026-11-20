import { CSSProperties, lazy, ReactNode, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@/components/ui/icon";
import { AIRFRAMES, Airframe, getAirframe } from "@/sim/airframes";
import { assemble, DroneBuild, partOf, PARTS, perf, saveBuilds, SLOTS, STOCK } from "@/sim/build";
import { CAM_LABEL, CamMode, CAMS, MODES } from "@/sim/engine";
import { LIVERIES, liveryFor } from "@/sim/droneModel";
import { InputConfig, saveInput } from "@/sim/input";
import { Difficulty, DIFFICULTY, MISSIONS, Weather, WEATHER } from "@/sim/missions";
import { COURSE, findMission } from "@/sim/course";
import { FlightMode, MODE_HINT, MODE_LABEL } from "@/sim/physics";
import type { Quality } from "@/sim/world";
import { getSoundPrefs, music, onSoundPrefs, setSoundPrefs } from "@/sim/sound";
import ControlsSetup from "./ControlsSetup";
import Postcard from "./Postcard";
import "./sport.css";

const HangarPreview = lazy(() => import("./HangarPreview"));

export interface LaunchSettings {
  mission: string; af: string; diff: Difficulty; quality: Quality; fmode: FlightMode; cam: CamMode; input: InputConfig;
  livery: string; // "auto" — штатная окраска аппарата
  weather: Weather;
  /** Случайные отказы в полёте. */
  failures: boolean;
  /** Сборки из конструктора по каждому аппарату. */
  builds: Record<string, DroneBuild>;
}
export type Best = Record<string, { score: number; stars: number }>;

const ACCENT = "#00ffaa";
const BLUE = "#00aaff";
const GOLD = "#ffd700";
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const TIER = { 1: "#8a93a3", 2: BLUE, 3: "#ff3d8b" } as const;

export const QUALITY: Record<Quality, { label: string; hint: string }> = {
  high: { label: "Ультра", hint: "тени 4K, сглаживание MSAA, свечение, детальный лес до 230 м" },
  medium: { label: "Средняя", hint: "тени 2K, сглаживание MSAA 2×, свечение, детальный лес до 150 м" },
  low: { label: "Низкая", hint: "без теней и постобработки — для ноутбуков и телефонов" },
};

const TABS = [
  { id: "missions", label: "Миссии", icon: "Map" },
  { id: "course", label: "Курс пилота", icon: "GraduationCap" },
  { id: "hangar", label: "Конструктор", icon: "Wrench" },
  { id: "controls", label: "Управление", icon: "Gamepad2" },
  { id: "graphics", label: "Графика и звук", icon: "MonitorCog" },
  { id: "about", label: "Об игре", icon: "Info" },
] as const;

/** Автор проекта — показывается в «Об игре», в сертификате курса и в свойствах программы. */
export const AUTHOR = { name: "Борисова Анастасия Александровна", role: "автор проекта, учитель, педагог" };
const LOGO = (f: string) => `${import.meta.env.BASE_URL}sim/${f}`;
type Tab = (typeof TABS)[number]["id"];

const RANKS = ["Курсант", "Пилот 3 класса", "Пилот 2 класса", "Пилот 1 класса", "Инструктор", "Ас Севера"];

// ─────────────────────────── примитивы стиля ───────────────────────────

const cut = (c = 12): CSSProperties => ({ clipPath: `polygon(${c}px 0,100% 0,100% calc(100% - ${c}px),calc(100% - ${c}px) 100%,0 100%,0 ${c}px)` });

/** Панель со срезанными углами и тонкой цветной рамкой. */
function Cut({ children, border = "rgba(255,255,255,0.09)", bg = "rgba(13,17,25,0.92)", c = 12, className = "", inner = "", style }: {
  children: ReactNode; border?: string; bg?: string; c?: number; className?: string; inner?: string; style?: CSSProperties;
}) {
  return (
    <div className={`p-px ${className}`} style={{ ...cut(c), background: border, ...style }}>
      <div className={`h-full ${inner}`} style={{ ...cut(c), background: bg }}>{children}</div>
    </div>
  );
}

function Heading({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="sp-label flex items-center gap-2" style={{ color: ACCENT }}>
        <span className="w-6 h-[3px] sp-skew" style={{ background: ACCENT }} />{kicker}
      </div>
      <h1 className="sp-title text-3xl sm:text-4xl mt-2">{title}</h1>
      {sub && <p className="text-gray-400 mt-2 max-w-3xl text-[15px]">{sub}</p>}
    </div>
  );
}

/** Переключатель-«чип» в спортивном стиле. */
function Chip({ on, color = ACCENT, onClick, children, title, className = "" }: {
  on: boolean; color?: string; onClick: () => void; children: ReactNode; title?: string; className?: string;
}) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on} className={`sp-card text-left ${className}`}
      style={{ ...cut(8), background: on ? `${color}` : "rgba(255,255,255,0.09)", padding: 1 }}>
      <div className="h-full px-3 py-2" style={{ ...cut(8), background: on ? `linear-gradient(135deg, ${color}2e, ${color}0d), #0d1119` : "#0d1119" }}>
        {children}
      </div>
    </button>
  );
}

export const Stars = ({ n, size = 14 }: { n: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {[0, 1, 2].map((i) => <Icon key={i} name="Star" size={size} style={{ color: i < n ? GOLD : "#3a3f48", fill: i < n ? GOLD : "none" }} />)}
  </span>
);

function AirframeIcon({ af, size = 56 }: { af: Airframe; size?: number }) {
  const k = 34 / (af.arm + af.propR);
  const color = hex(af.color);
  return (
    <svg width={size} height={size} viewBox="-40 -40 80 80" aria-hidden>
      {af.motors.map((m, i) => <line key={`l${i}`} x1={0} y1={0} x2={m.x * k} y2={m.z * k} stroke="#667" strokeWidth={2.5} />)}
      {af.motors.map((m, i) => (
        <circle key={i} cx={m.x * k} cy={m.z * k} r={af.propR * k} fill={`${color}22`} stroke={color} strokeWidth={m.y < 0 ? 0.6 : 1.4} strokeDasharray={m.y < 0 ? "2 2" : undefined} />
      ))}
      <rect x={-6} y={-8} width={12} height={16} rx={3} fill={color} />
      <path d="M0 -15 L4 -9 L-4 -9 Z" fill="#ff4444" />
    </svg>
  );
}

/** Сегментная шкала характеристики (как в гоночных играх) с отметкой заводского значения. */
function SegBar({ label, value, base, max, text, color }: { label: string; value: number; base: number; max: number; text: string; color: string }) {
  const N = 14;
  const v = Math.min(N, (value / max) * N), b = Math.min(N, (base / max) * N);
  const delta = value - base, rel = base ? delta / base : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="sp-label text-gray-400 !text-[10px]">{label}</span>
        <span className="flex items-baseline gap-2">
          {Math.abs(rel) > 0.005 && <span className="text-xs font-bold tabular-nums" style={{ color: delta > 0 ? ACCENT : "#ff5c7a" }}>{delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(rel * 100))}%</span>}
          <span className="sp-title text-lg tabular-nums">{text}</span>
        </span>
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {Array.from({ length: N }, (_, i) => {
          const fill = Math.max(0, Math.min(1, v - i)), inBase = i < b;
          const up = !inBase && fill > 0, lost = inBase && fill < 1 && i >= Math.floor(v);
          return (
            <div key={i} className="flex-1 h-2.5 sp-skew relative overflow-hidden" style={{ background: lost ? "#ff5c7a33" : "rgba(255,255,255,0.07)" }}>
              <div className="absolute inset-y-0 left-0" style={{ width: `${fill * 100}%`, background: up ? ACCENT : color, boxShadow: fill ? `0 0 8px ${up ? ACCENT : color}88` : undefined }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const compass = (deg: number) => ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Кнопка старта: скошенная, с бегущим бликом. */
function Launch({ onClick, label = "НА ВЗЛЁТ", color = ACCENT, className = "" }: { onClick: () => void; label?: string; color?: string; className?: string }) {
  return (
    <button onClick={onClick} className={`sp-shine sp-card w-full py-4 ${className}`}
      style={{ ...cut(14), background: `linear-gradient(100deg, ${color}, ${color === ACCENT ? "#00d4ff" : color})`, color: "#05070b", boxShadow: `0 8px 30px ${color}44` }}>
      <span className="sp-title text-lg flex items-center justify-center gap-2">{label}<Icon name="ChevronsRight" size={20} /></span>
    </button>
  );
}

// ─────────────────────────── лаунчер ───────────────────────────

export default function Launcher({ initial, best, onStart }: { initial: LaunchSettings; best: Best; onStart: (s: LaunchSettings) => void }) {
  const [s, setS] = useState<LaunchSettings>(initial);
  const [tab, setTab] = useState<Tab>("missions");
  const [snd, setSnd] = useState(getSoundPrefs);
  useEffect(() => { music.start("menu"); return onSoundPrefs(setSnd); }, []);
  const set = (patch: Partial<LaunchSettings>) => {
    setS((prev) => {
      const nx = { ...prev, ...patch };
      if (patch.input) saveInput(patch.input);
      if (patch.builds) saveBuilds(patch.builds);
      if (patch.quality) try { localStorage.setItem("bas-sim-quality", patch.quality); } catch { /* приватный режим */ }
      return nx;
    });
  };
  const mission = findMission(s.mission);
  const build = s.builds[s.af] ?? STOCK;
  const af = assemble(s.af, build);
  const afColor = hex(af.color);
  const w = mission.wind;
  const visibility = Math.round(Math.min(10, 2.3 / mission.world.palette.fogDensity / 1000) * 10) / 10;
  const custom = SLOTS.some((sl) => build[sl.id] !== "std");

  // ранг пилота по сумме звёзд
  const totalStars = Object.values(best).reduce((a, b) => a + b.stars, 0);
  const maxStars = (MISSIONS.length + COURSE.length) * 3;
  const per = Math.ceil(maxStars / RANKS.length);
  const lvl = Math.min(RANKS.length - 1, Math.floor(totalStars / per));
  const lvlFrac = lvl === RANKS.length - 1 ? 1 : (totalStars - lvl * per) / per;

  return (
    <div className="sp-root min-h-screen text-white grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)] font-rajdhani">
      {/* боковая панель */}
      <aside className="min-w-0 lg:sticky lg:top-0 lg:h-screen flex flex-col border-b lg:border-b-0 lg:border-r border-white/5 bg-black/40 backdrop-blur-sm">
        <div className="px-5 pt-5 pb-4 flex items-center justify-between lg:block">
          <div>
            <div className="sp-title text-[22px] flex items-center gap-2.5 leading-none">
              <img src={LOGO("logo-mark-light.svg")} alt="" className="w-10 h-10 shrink-0" />
              <span>СЕВЕРНЫЙ<br /><span style={{ color: "#f07a1a" }}>ДРОН</span></span>
            </div>
            <div className="text-xs text-gray-500 mt-1.5">тренажёр операторов БВС · Республика Коми</div>
          </div>
          <button type="button" onClick={() => setSoundPrefs({ muted: !snd.muted })} title={snd.muted ? "Включить звук" : "Выключить звук"}
            className="lg:mt-3 w-8 h-8 flex items-center justify-center sp-skew border transition-colors"
            style={{ borderColor: snd.muted ? "rgba(255,255,255,0.15)" : `${ACCENT}88`, background: snd.muted ? "transparent" : `${ACCENT}18` }}>
            <Icon name={snd.muted ? "VolumeX" : "Music"} size={15} className="sp-unskew" style={{ color: snd.muted ? "#6b7280" : ACCENT }} />
          </button>
          {!import.meta.env.VITE_STANDALONE && (
            <Link to="/" className="sp-label !text-[10px] text-gray-500 hover:text-white flex items-center gap-1 lg:mt-3"><Icon name="ArrowLeft" size={12} />БАС_АРЕНА</Link>
          )}
        </div>

        {/* ранг пилота */}
        <div className="px-4 pb-4 hidden lg:block">
          <Cut border={`${GOLD}55`} bg="linear-gradient(135deg, rgba(255,215,0,0.10), rgba(13,17,25,0.95) 60%)" c={10} inner="p-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 flex items-center justify-center shrink-0 sp-skew" style={{ background: `${GOLD}22`, border: `1px solid ${GOLD}88` }}>
                <span className="sp-unskew sp-title text-xl" style={{ color: GOLD }}>{lvl + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="sp-label !text-[9px] text-gray-400">РАНГ ПИЛОТА</div>
                <div className="sp-title text-[15px] truncate">{RANKS[lvl]}</div>
                <div className="h-1.5 mt-1.5 bg-white/10 sp-skew"><div className="h-full" style={{ width: `${lvlFrac * 100}%`, background: `linear-gradient(90deg, ${GOLD}, #ff9d00)` }} /></div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-2"><span className="flex items-center gap-1"><Icon name="Star" size={12} style={{ color: GOLD, fill: GOLD }} />{totalStars} / {maxStars}</span>
              {lvl < RANKS.length - 1 && <span>до «{RANKS[lvl + 1]}»: {per * (lvl + 1) - totalStars}★</span>}</div>
          </Cut>
        </div>

        <nav className="flex lg:flex-col gap-1.5 px-3 overflow-x-auto pb-2 lg:pb-0">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className="relative flex items-center gap-3 px-4 py-3 whitespace-nowrap transition-colors"
                style={{ ...cut(8), background: on ? `linear-gradient(90deg, ${ACCENT}26, transparent)` : "transparent", color: on ? "#fff" : "#8a93a3" }}>
                {on && <span className="absolute left-0 top-1 bottom-1 w-[3px]" style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}` }} />}
                <Icon name={t.icon} size={17} style={{ color: on ? ACCENT : undefined }} />
                <span className="sp-label !text-[12px]">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* предполётная сводка */}
        <div className="mt-auto p-4 hidden lg:block">
          <Cut border={`${mission.color}55`} c={12}>
            <div className="relative">
              <Postcard mission={mission} className="w-full h-20 block" />
              <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, rgba(13,17,25,0.95))" }} />
              <div className="absolute left-3 bottom-1.5 right-3 sp-title text-sm truncate" style={{ color: mission.color }}>{mission.title}</div>
            </div>
            <div className="px-3 pb-3 pt-1 space-y-1 text-sm">
              {[["Аппарат", `${af.name}${custom ? " · тюнинг" : ""}`], ["Режим", MODE_LABEL[s.fmode]], ["Камера", CAM_LABEL[s.cam]],
                ["Погода", WEATHER.find((x) => x.id === s.weather)?.label ?? ""], ["Сложность", DIFFICULTY[s.diff].label]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="text-gray-100 font-semibold truncate">{v}</span></div>
              ))}
            </div>
          </Cut>
          <Launch onClick={() => onStart(s)} className="mt-3" />
        </div>
      </aside>

      <main className="px-4 sm:px-6 lg:px-10 py-7 pb-28 lg:pb-10 min-w-0">
        {tab === "missions" && (
          <div className="grid xl:grid-cols-[1fr_390px] gap-7">
            <section className="min-w-0">
              <Heading kicker="Выбор задачи" title="Миссии" sub="Задачи, которые реально решают расчёты БВС: лесоохрана, МЧС, сельское хозяйство, энергетики, северные службы." />
              <div className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-4">
                {MISSIONS.map((m, i) => {
                  const on = m.id === s.mission;
                  return (
                    <button key={m.id} onClick={() => set({ mission: m.id, af: m.recommended[0] })} className="sp-card text-left"
                      style={{ ...cut(14), padding: on ? 2 : 1, background: on ? `linear-gradient(135deg, ${m.color}, ${m.color}55)` : "rgba(255,255,255,0.08)", filter: on ? `drop-shadow(0 8px 24px ${m.color}44)` : undefined }}>
                      <div style={{ ...cut(14), background: "#0c1018" }}>
                        <div className="relative sp-scan">
                          <Postcard mission={m} className="w-full h-32 block" />
                          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(12,16,24,0.35) 0%, transparent 30%, transparent 55%, #0c1018 100%)` }} />
                          <div className="absolute top-2 left-3 sp-title text-3xl" style={{ color: `${m.color}`, opacity: 0.85, textShadow: "0 2px 8px #000" }}>{String(i + 1).padStart(2, "0")}</div>
                          <div className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center sp-skew" style={{ background: "rgba(8,11,18,0.75)", border: `1px solid ${m.color}88` }}>
                            <Icon name={m.icon} size={15} className="sp-unskew" style={{ color: m.color }} />
                          </div>
                          {best[m.id] && <div className="absolute bottom-2 right-2.5 z-[2]"><Stars n={best[m.id].stars} size={12} /></div>}
                          <div className="absolute bottom-2 left-3 right-16 sp-title text-[15px] text-white z-[2] truncate">{m.title}</div>
                        </div>
                        <div className="px-3 pb-3 pt-1">
                          <div className="text-[15px] font-semibold leading-snug" style={{ color: m.color }}>{m.tagline}</div>
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1 truncate"><Icon name="MapPin" size={11} />{m.place}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="space-y-5 min-w-0">
              <Cut border={`${mission.color}66`} c={16}>
                <div className="relative sp-scan">
                  <Postcard mission={mission} className="w-full h-40 block" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 55%, rgba(13,17,25,1))" }} />
                  <div className="absolute left-5 bottom-3 right-5 z-[2]">
                    <div className="sp-label" style={{ color: mission.color }}>БРИФИНГ</div>
                    <div className="sp-title text-2xl mt-1">{mission.title}</div>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <div className="text-xs text-gray-500 mb-3 flex items-center gap-1"><Icon name="MapPin" size={11} />{mission.place}</div>
                  <div className="space-y-2 text-[15px] leading-snug text-gray-300">{mission.briefing.map((b) => <p key={b}>{b}</p>)}</div>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {[["Ветер", `${compass(w.toDeg + 180)} ${Math.round(w.speed * DIFFICULTY[s.diff].wind)} м/с`, "Wind"], ["Порывы", `до ${Math.round(w.speed * DIFFICULTY[s.diff].wind * (1 + w.gust))} м/с`, "Tornado"], ["Видимость", visibility >= 5 ? "> 5 км" : `${visibility} км`, "Eye"]].map(([k, v, ic]) => (
                      <Cut key={k} c={8} inner="p-2">
                        <div className="sp-label !text-[9px] text-gray-500 flex items-center gap-1"><Icon name={ic} size={10} />{k}</div>
                        <div className="text-sm font-bold mt-0.5">{v}</div>
                      </Cut>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mt-3">Рекомендуемые аппараты: <span className="text-gray-300">{mission.recommended.map((id) => getAirframe(id).name).join(", ")}</span></div>
                </div>
              </Cut>
              <div>
                <div className="sp-label text-gray-300 mb-2">Погода и время суток</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {WEATHER.map((x) => (
                    <Chip key={x.id} on={s.weather === x.id} color={BLUE} onClick={() => set({ weather: x.id })} title={x.hint}>
                      <div className="flex flex-col items-center gap-1 py-0.5">
                        <Icon name={x.icon} size={16} style={{ color: s.weather === x.id ? BLUE : "#9aa3b2" }} />
                        <span className="text-[11px] font-bold leading-tight text-center" style={{ color: s.weather === x.id ? "#fff" : "#aab" }}>{x.label}</span>
                      </div>
                    </Chip>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-1.5">{WEATHER.find((x) => x.id === s.weather)?.hint}</div>
              </div>
              <div>
                <div className="sp-label text-gray-300 mb-2">Сложность</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(DIFFICULTY) as Difficulty[]).map((d, i) => (
                    <Chip key={d} on={s.diff === d} color="#bf5fff" onClick={() => set({ diff: d })}>
                      <div className="flex gap-0.5 mb-1">{[0, 1, 2].map((k) => <span key={k} className="w-3 h-1.5 sp-skew" style={{ background: k <= i ? "#bf5fff" : "rgba(255,255,255,0.12)" }} />)}</div>
                      <div className="sp-title text-sm">{DIFFICULTY[d].label}</div>
                      <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{DIFFICULTY[d].hint}</div>
                    </Chip>
                  ))}
                </div>
              </div>
              <Chip on={s.failures} color="#ff6a10" onClick={() => set({ failures: !s.failures })} className="w-full">
                <div className="flex items-start gap-3">
                  <Icon name={s.failures ? "ToggleRight" : "ToggleLeft"} size={26} style={{ color: s.failures ? "#ff6a10" : "#667" }} className="shrink-0" />
                  <span>
                    <span className="sp-title text-sm block">Случайные отказы</span>
                    <span className="text-xs text-gray-400 leading-snug block mt-0.5">GPS, связь с пультом, порывы, отказ мотора — без предупреждения. Вручную — панель инструктора (I).</span>
                  </span>
                </div>
              </Chip>
            </aside>
          </div>
        )}

        {tab === "course" && <CourseTab s={s} best={best} set={set} onStart={onStart} />}

        {tab === "hangar" && <Constructor s={s} set={set} af={af} build={build} color={afColor} tank={mission.payloadUnit === "л"} />}

        {tab === "controls" && (
          <section className="max-w-4xl">
            <Heading kicker="Настройка" title="Управление" sub="Клавиатура, геймпад или настоящий пульт по USB. Пульт на EdgeTX/OpenTX определяется как джойстик: выберите пресет или пройдите калибровку." />
            <ControlsSetup cfg={s.input} onChange={(input) => set({ input })} />
          </section>
        )}

        {tab === "about" && (
          <section className="max-w-3xl space-y-5">
            <Heading kicker="О программе" title="Северный дрон" sub="Тренажёр операторов беспилотных воздушных судов: мирные задачи в Республике Коми — поиск людей, тушение пожаров, доставка, мониторинг." />
            <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-5 items-start">
              <div className="p-4 flex items-center justify-center" style={{ ...cut(14), background: "#f7f7f5" }}>
                <img src={LOGO("logo.svg")} alt="Логотип «Северный дрон»" className="w-full max-w-[200px]" />
              </div>
              <Cut inner="p-5 space-y-4">
                <div>
                  <div className="sp-label text-gray-400">Автор проекта</div>
                  <div className="sp-title text-xl mt-1">{AUTHOR.name}</div>
                  <div className="text-gray-300">{AUTHOR.role}</div>
                </div>
                <div className="text-sm text-gray-300 leading-relaxed">
                  18 миссий, курс пилота, конструктор дронов, тепловизор, повтор полёта с разбором ошибок. Управление с клавиатуры, геймпада или настоящего пульта.
                </div>
                <div>
                  <div className="sp-label text-gray-400 mb-1">Использованы открытые материалы</div>
                  <ul className="text-sm text-gray-400 space-y-0.5 list-disc pl-5">
                    <li>three.js — 3D-движок (MIT)</li>
                    <li>Quaternius — модели оленя и лося (CC0)</li>
                    <li>ez-tree, Daniel Greenheck — деревья (MIT); texturecan.com — текстуры коры (CC0)</li>
                    <li>Poly Haven — HDR-панорамы освещения (CC0)</li>
                    <li>Шрифты Russo One, Orbitron, Rajdhani (SIL OFL)</li>
                  </ul>
                  <a href={LOGO("CREDITS.txt")} target="_blank" rel="noreferrer" className="inline-block mt-2 text-sm underline text-[#7dd3fc]">Полный список источников</a>
                </div>
              </Cut>
            </div>
          </section>
        )}

        {tab === "graphics" && (
          <section className="max-w-3xl space-y-5">
            <Heading kicker="Настройка" title="Графика и звук" sub="Качество можно понизить, если симулятор подтормаживает: разрешение рендера подстраивается автоматически." />
            <div className="grid sm:grid-cols-3 gap-3">
              {(Object.keys(QUALITY) as Quality[]).map((q, i) => (
                <Chip key={q} on={s.quality === q} color={BLUE} onClick={() => set({ quality: q })}>
                  <div className="py-1">
                    <div className="flex gap-0.5 mb-2">{[0, 1, 2].map((k) => <span key={k} className="w-4 h-1.5 sp-skew" style={{ background: k >= i ? BLUE : "rgba(255,255,255,0.12)" }} />)}</div>
                    <div className="sp-title text-lg">{QUALITY[q].label}</div>
                    <div className="text-sm text-gray-400 mt-1 leading-snug">{QUALITY[q].hint}</div>
                  </div>
                </Chip>
              ))}
            </div>
            <Cut inner="p-5 space-y-4">
              <div className="sp-label text-gray-300">FPV-камера</div>
              <label htmlFor="fpv-auto" className="flex items-center gap-2 text-sm text-gray-300">
                <input id="fpv-auto" type="checkbox" className="accent-[#00ffaa] w-4 h-4" checked={s.input.fpvTilt === null}
                  onChange={(e) => set({ input: { ...s.input, fpvTilt: e.target.checked ? null : 25 } })} />
                Наклон по режиму (GPS 7°, Angle 17°, Acro 27°)
              </label>
              {s.input.fpvTilt !== null && (
                <label htmlFor="fpv-tilt" className="block">
                  <div className="flex justify-between text-sm"><span className="text-gray-300">Наклон камеры вверх</span><span className="font-semibold tabular-nums">{s.input.fpvTilt}°</span></div>
                  <input id="fpv-tilt" type="range" min={0} max={50} step={1} value={s.input.fpvTilt} onChange={(e) => set({ input: { ...s.input, fpvTilt: +e.target.value } })} className="w-full accent-[#00ffaa]" />
                </label>
              )}
              <label htmlFor="fpv-fov" className="block">
                <div className="flex justify-between text-sm"><span className="text-gray-300">Угол обзора</span><span className="font-semibold tabular-nums">{s.input.fpvFov}°</span></div>
                <input id="fpv-fov" type="range" min={80} max={130} step={1} value={s.input.fpvFov} onChange={(e) => set({ input: { ...s.input, fpvFov: +e.target.value } })} className="w-full accent-[#00ffaa]" />
              </label>
            </Cut>
            <Cut inner="p-5 space-y-4">
              <div className="sp-label text-gray-300">Звук</div>
              <label htmlFor="snd-mute" className="flex items-center gap-2 text-sm text-gray-300">
                <input id="snd-mute" type="checkbox" className="accent-[#00ffaa] w-4 h-4" checked={!snd.muted} onChange={(e) => setSoundPrefs({ muted: !e.target.checked })} />
                Звук включён (в полёте — клавиша N)
              </label>
              {([["music", "Музыка", "в меню громче, в полёте — тихим фоном"], ["nature", "Звуки природы", "ветер, лес, птицы, река, дождь — по месту миссии"]] as const).map(([k, label, hint]) => (
                <label key={k} htmlFor={`snd-${k}`} className="block">
                  <div className="flex justify-between text-sm"><span className="text-gray-300">{label} <span className="text-gray-500">· {hint}</span></span><span className="font-semibold tabular-nums">{Math.round(snd[k] * 100)}%</span></div>
                  <input id={`snd-${k}`} type="range" min={0} max={1} step={0.05} value={snd[k]} onChange={(e) => setSoundPrefs({ [k]: +e.target.value })} className="w-full accent-[#00ffaa]" />
                </label>
              ))}
            </Cut>
          </section>
        )}
      </main>

      {/* мобильная нижняя панель */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 p-3 flex gap-3 items-center border-t border-white/10" style={{ background: "rgba(7,9,14,0.96)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex-1 min-w-0 text-xs">
          <div className="sp-title text-sm truncate" style={{ color: mission.color }}>{mission.title}</div>
          <div className="text-gray-400 truncate">{af.name} · {MODE_LABEL[s.fmode]} · {CAM_LABEL[s.cam]}</div>
        </div>
        <div className="w-40"><Launch onClick={() => onStart(s)} /></div>
      </div>
    </div>
  );
}

// ─────────────────────────── конструктор ───────────────────────────

function Constructor({ s, set, af, build, color, tank }: {
  s: LaunchSettings; set: (p: Partial<LaunchSettings>) => void; af: Airframe; build: DroneBuild; color: string; tank: boolean;
}) {
  const stock = assemble(s.af);
  const p = perf(af), b = perf(stock);
  const setPart = (slot: keyof DroneBuild, id: string) => set({ builds: { ...s.builds, [s.af]: { ...build, [slot]: id } } });
  const idx = AIRFRAMES.findIndex((a) => a.id === s.af);
  const custom = SLOTS.some((sl) => build[sl.id] !== "std");
  const cls = af.motors.length <= 4 ? "ЛЁГКИЙ" : af.mass < 12 ? "СРЕДНИЙ" : af.mass < 20 ? "ТЯЖЁЛЫЙ" : "СВЕРХТЯЖ.";
  return (
    <div className="space-y-6">
      <Heading kicker="Ангар" title="Конструктор" sub="Соберите аппарат под задачу: моторы, винты, батарея и прошивка меняют реальные параметры полёта — тягу, массу, время в воздухе и отклик." />
      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <section className="min-w-0 space-y-4">
          {/* шоурум */}
          <Cut border={`${color}66`} bg="radial-gradient(ellipse at 50% 75%, #1a2433, #07090e 72%)" c={18}>
            <div className="relative h-[340px] sm:h-[440px] overflow-hidden">
              <Suspense fallback={null}><HangarPreview af={af} tank={tank} livery={s.livery} /></Suspense>
              <div className="absolute -left-2 top-3 sp-title text-[96px] sm:text-[140px] leading-none pointer-events-none select-none" style={{ color: `${color}12` }}>{String(idx + 1).padStart(2, "0")}</div>
              <div className="absolute left-5 top-5 pointer-events-none">
                <div className="flex gap-1.5">
                  <span className="sp-label !text-[10px] px-2 py-0.5 sp-skew" style={{ background: color, color: "#05070b" }}><span className="sp-unskew">{cls}</span></span>
                  {custom && <span className="sp-label !text-[10px] px-2 py-0.5 sp-skew" style={{ background: "#ff3d8b", color: "#fff" }}><span className="sp-unskew">ТЮНИНГ</span></span>}
                </div>
                <div className="sp-title text-4xl sm:text-5xl mt-2" style={{ textShadow: `0 0 30px ${color}55` }}>{af.name}</div>
                <div className="text-gray-300 mt-1">{af.scheme} · {af.motors.length} моторов · {af.mass.toFixed(1)} кг</div>
              </div>
              <div className="absolute right-4 top-4 hidden sm:flex flex-col items-end gap-1 pointer-events-none">
                <span className="sp-label !text-[9px] text-gray-500">ТЯГА / ВЕС</span>
                <span className="sp-title text-3xl" style={{ color }}>{p.twr.toFixed(2)}</span>
              </div>
              <div className="absolute left-0 right-0 bottom-0 p-4 flex flex-wrap gap-1.5 items-center" style={{ background: "linear-gradient(0deg, rgba(7,9,14,0.9), transparent)" }}>
                <span className="sp-label !text-[10px] text-gray-400 mr-1">ОКРАСКА</span>
                {[{ id: "auto", label: "Штатная" }, ...LIVERIES].map((l) => {
                  const lv = liveryFor(af.id, l.id), on = s.livery === l.id;
                  return (
                    <button key={l.id} onClick={() => set({ livery: l.id })} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold transition-colors"
                      style={{ ...cut(6), background: on ? `${ACCENT}2a` : "rgba(8,11,18,0.8)", color: on ? ACCENT : "#c8ced8", boxShadow: on ? `inset 0 -2px 0 ${ACCENT}` : undefined }}>
                      <span className="w-3.5 h-3.5 sp-skew" style={{ background: `linear-gradient(135deg, ${hex(lv.primary)} 50%, ${hex(lv.secondary)} 50%)` }} />
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Cut>

          {/* выбор рамы */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {AIRFRAMES.map((a, i) => {
              const on = a.id === s.af, c = hex(a.color), pa = perf(assemble(a.id, s.builds[a.id]));
              return (
                <button key={a.id} onClick={() => set({ af: a.id })} className="sp-card text-left"
                  style={{ ...cut(12), padding: on ? 2 : 1, background: on ? c : "rgba(255,255,255,0.08)", filter: on ? `drop-shadow(0 6px 18px ${c}55)` : undefined }}>
                  <div className="relative p-3 h-full" style={{ ...cut(12), background: on ? `linear-gradient(160deg, ${c}26, #0c1018 70%), #0c1018` : "#0c1018" }}>
                    <span className="absolute right-2.5 top-1.5 sp-title text-2xl" style={{ color: `${c}44` }}>{String(i + 1).padStart(2, "0")}</span>
                    <AirframeIcon af={a} size={52} />
                    <div className="sp-title text-[15px] mt-1">{a.name}</div>
                    <div className="text-xs text-gray-400">{a.scheme}</div>
                    <div className="flex gap-3 mt-2 text-xs text-gray-300 tabular-nums">
                      <span title="Полезная нагрузка"><Icon name="Package" size={11} className="inline -mt-0.5 mr-0.5" />{pa.payload.toFixed(0)} кг</span>
                      <span title="Висение без груза"><Icon name="Timer" size={11} className="inline -mt-0.5 mr-0.5" />{pa.hover.toFixed(0)} мин</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4 min-w-0">
          {/* характеристики */}
          <Cut inner="p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="sp-label text-gray-300">Характеристики</div>
              <div className="text-xs text-gray-500 flex items-center gap-1.5"><span className="w-2.5 h-2.5 sp-skew" style={{ background: ACCENT }} />прирост от тюнинга</div>
            </div>
            <SegBar label="Тяговооружённость с грузом" value={p.twr} base={b.twr} max={3} text={p.twr.toFixed(2)} color={color} />
            <SegBar label="Максимальная скорость" value={p.speed} base={b.speed} max={24} text={`${Math.round(p.speed * 3.6)} км/ч`} color={color} />
            <SegBar label="Висение без груза" value={p.hover} base={b.hover} max={50} text={`${p.hover.toFixed(0)} мин`} color={color} />
            <SegBar label="Висение с полным грузом" value={p.hoverFull} base={b.hoverFull} max={30} text={`${p.hoverFull.toFixed(0)} мин`} color={color} />
            <SegBar label="Полезная нагрузка" value={p.payload} base={b.payload} max={26} text={`${p.payload.toFixed(1)} кг`} color={color} />
            <SegBar label="Манёвренность" value={p.agility} base={b.agility} max={11} text={p.agility.toFixed(1)} color={color} />
            <div className="grid grid-cols-3 gap-2 pt-1 text-sm">
              {[["МАССА", `${af.mass.toFixed(1)} кг`], ["АКБ", `${Math.round(af.batteryWh)} Вт·ч`], ["РЕЗЕРВ", af.redundancy]].map(([k, v]) => (
                <div key={k} className="min-w-0"><div className="sp-label !text-[9px] text-gray-500">{k}</div><div className="font-bold truncate" title={v}>{v}</div></div>
              ))}
            </div>
          </Cut>

          {/* комплектующие */}
          <Cut inner="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="sp-label text-gray-300">Комплектующие</div>
              {custom && (
                <button onClick={() => set({ builds: { ...s.builds, [s.af]: STOCK } })} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                  <Icon name="RotateCcw" size={12} />заводская сборка
                </button>
              )}
            </div>
            {SLOTS.map((sl) => {
              const cur = partOf(sl.id, build[sl.id]);
              return (
                <div key={sl.id}>
                  <div className="flex items-center gap-2 text-sm text-gray-300 mb-1.5"><Icon name={sl.icon} size={14} style={{ color }} />{sl.label}
                    <span className="ml-auto text-xs text-gray-500 truncate">{cur.hint}</span></div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PARTS[sl.id].map((pt) => {
                      const on = pt.id === cur.id, tc = TIER[pt.tier];
                      return (
                        <button key={pt.id} onClick={() => setPart(sl.id, pt.id)} title={pt.hint} aria-pressed={on} className="sp-card"
                          style={{ ...cut(7), padding: 1, background: on ? tc : "rgba(255,255,255,0.08)" }}>
                          <div className="relative px-2 pt-2.5 pb-1.5 h-full" style={{ ...cut(7), background: on ? `linear-gradient(160deg, ${tc}33, #0c1018), #0c1018` : "#0c1018" }}>
                            <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: tc, opacity: on ? 1 : 0.5 }} />
                            <div className="text-[13px] font-bold leading-tight" style={{ color: on ? "#fff" : "#b8bfcc" }}>{pt.name}</div>
                            <div className="flex gap-0.5 mt-1">{[1, 2, 3].map((k) => <span key={k} className="w-2 h-1 sp-skew" style={{ background: k <= pt.tier ? tc : "rgba(255,255,255,0.12)" }} />)}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Cut>

          {/* старт */}
          <Cut inner="p-5 space-y-3">
            <div className="sp-label text-gray-300">Режим на старте</div>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <Chip key={m} on={s.fmode === m} color={GOLD} onClick={() => set({ fmode: m })}>
                  <div className="sp-title text-sm" style={{ color: s.fmode === m ? GOLD : "#ddd" }}>{MODE_LABEL[m]}</div>
                  <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{MODE_HINT[m]}</div>
                </Chip>
              ))}
            </div>
            <div className="sp-label text-gray-300 pt-1">Камера на старте</div>
            <div className="grid grid-cols-4 gap-1.5">
              {CAMS.map((c) => (
                <Chip key={c} on={s.cam === c} onClick={() => set({ cam: c })}>
                  <div className="text-center text-xs font-bold" style={{ color: s.cam === c ? ACCENT : "#bbb" }}>{CAM_LABEL[c]}</div>
                </Chip>
              ))}
            </div>
          </Cut>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────── курс пилота ───────────────────────────

function CourseTab({ s, best, set, onStart }: { s: LaunchSettings; best: Best; set: (p: Partial<LaunchSettings>) => void; onStart: (s: LaunchSettings) => void }) {
  const C = "#7dd3fc";
  const passed = COURSE.filter((c) => best[c.id]);
  const avg = passed.length ? Math.round(passed.reduce((a, c) => a + best[c.id].score, 0) / passed.length) : 0;
  const stars = passed.reduce((a, c) => a + best[c.id].stars, 0);
  const done = passed.length === COURSE.length;
  const cur = COURSE.find((c) => c.id === s.mission) ?? COURSE[0];
  return (
    <div className="grid xl:grid-cols-[1fr_390px] gap-7">
      <section className="min-w-0">
        <Heading kicker="Подготовка" title="Курс пилота" sub="Шесть упражнений по программе подготовки внешних пилотов БВС: от висения без GPS до действий при потере связи. Зачёт — выполнение с посадкой на H." />
        <Cut inner="p-4 flex items-center gap-5" className="mb-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-2"><span className="sp-label text-gray-400 !text-[10px]">Прогресс</span><span className="sp-title tabular-nums">{passed.length} / {COURSE.length}</span></div>
            <div className="flex gap-1">{COURSE.map((c) => <div key={c.id} className="flex-1 h-2.5 sp-skew" style={{ background: best[c.id] ? C : "rgba(255,255,255,0.08)", boxShadow: best[c.id] ? `0 0 8px ${C}88` : undefined }} />)}</div>
          </div>
          <div className="text-center"><div className="sp-label !text-[9px] text-gray-500">СР. БАЛЛ</div><div className="sp-title text-xl tabular-nums">{avg || "—"}</div></div>
          <div className="text-center"><div className="sp-label !text-[9px] text-gray-500">ЗВЁЗДЫ</div><div className="sp-title text-xl tabular-nums">{stars}<span className="text-gray-500 text-sm">/{COURSE.length * 3}</span></div></div>
        </Cut>
        <div className="space-y-2.5">
          {COURSE.map((c, i) => {
            const on = c.id === cur.id, b = best[c.id], open = i === 0 || best[COURSE[i - 1].id] || b;
            return (
              <button key={c.id} onClick={() => set({ mission: c.id })} className="sp-card w-full text-left"
                style={{ ...cut(12), padding: on ? 2 : 1, background: on ? C : "rgba(255,255,255,0.08)", opacity: open ? 1 : 0.55 }}>
                <div className="p-3 flex items-center gap-4" style={{ ...cut(12), background: on ? `linear-gradient(90deg, ${C}22, #0c1018 60%), #0c1018` : "#0c1018" }}>
                  <span className="sp-title text-3xl w-10 text-center" style={{ color: b ? ACCENT : `${C}88` }}>{i + 1}</span>
                  <div className="w-10 h-10 flex items-center justify-center shrink-0 sp-skew" style={{ background: b ? `${ACCENT}1f` : "rgba(255,255,255,0.05)", border: `1px solid ${b ? ACCENT : C}55` }}>
                    <Icon name={b ? "Check" : open ? c.icon : "Lock"} size={18} className="sp-unskew" style={{ color: b ? ACCENT : C }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="sp-title text-[15px]">{c.title.replace(/^\d+\.\s*/, "")}</div>
                    <div className="text-sm text-gray-400 truncate">{c.tagline}{c.startMode ? ` · режим ${MODE_LABEL[c.startMode]}` : ""}</div>
                  </div>
                  {b ? <div className="text-right"><Stars n={b.stars} size={13} /><div className="text-xs text-gray-400 tabular-nums">{Math.round(b.score)} баллов</div></div>
                    : !open && <span className="text-[11px] text-gray-500">после упр. {i}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <aside className="space-y-5 min-w-0">
        <Cut border={`${C}66`} bg={`linear-gradient(160deg, ${C}14, rgba(13,17,25,0.95) 50%)`} c={16} inner="p-5">
          <div className="sp-label" style={{ color: C }}>Упражнение {COURSE.indexOf(cur) + 1}</div>
          <div className="sp-title text-2xl mt-1.5">{cur.title.replace(/^\d+\.\s*/, "")}</div>
          <div className="space-y-2 text-[15px] leading-snug text-gray-300 mt-3">{cur.briefing.map((x) => <p key={x}>{x}</p>)}</div>
          <Launch onClick={() => onStart({ ...s, mission: cur.id, weather: "scenario" })} label="НАЧАТЬ" color={C} className="mt-5" />
        </Cut>
        <Cut border={done ? `${GOLD}aa` : "rgba(255,255,255,0.09)"} bg={done ? "linear-gradient(135deg, #2c2508, #0d1119 70%)" : "rgba(13,17,25,0.92)"} c={16} inner="p-5 relative overflow-hidden">
          <div className="absolute -right-12 -top-12 w-24 h-24 sp-stripes opacity-10" style={{ ["--sp-c" as string]: GOLD }} />
          <div className="sp-label flex items-center gap-2" style={{ color: done ? GOLD : "#9aa3b2" }}><Icon name="Award" size={16} />Удостоверение пилота</div>
          {done ? (
            <>
              <div className="sp-title text-2xl mt-3">Курс пройден</div>
              <div className="text-sm text-gray-300 mt-1">Внешний пилот БВС · базовый уровень</div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div><div className="sp-label !text-[9px] text-gray-500">СРЕДНИЙ БАЛЛ</div><div className="sp-title text-xl">{avg}</div></div>
                <div><div className="sp-label !text-[9px] text-gray-500">ЗВЁЗДЫ</div><div className="sp-title text-xl">{stars} / {COURSE.length * 3}</div></div>
              </div>
              <div className="text-xs text-gray-500 mt-3">«Северный дрон», Республика Коми · {new Date().toLocaleDateString("ru-RU")}</div>
              <button onClick={() => window.print()} className="mt-3 text-xs font-bold px-3 py-1.5 flex items-center gap-1.5" style={{ ...cut(6), background: `${GOLD}22`, color: GOLD }}>
                <Icon name="Printer" size={12} />РАСПЕЧАТАТЬ
              </button>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Выполните все упражнения курса — осталось {COURSE.length - passed.length}. Удостоверение подтвердит навыки пилотирования без GPS и действия в нештатных ситуациях.</div>
          )}
        </Cut>
      </aside>
    </div>
  );
}
