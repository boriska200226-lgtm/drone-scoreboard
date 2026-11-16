import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@/components/ui/icon";
import { AIRFRAMES, Airframe, getAirframe, hoverMinutes } from "@/sim/airframes";
import { CAM_LABEL, CamMode, CAMS, MODES } from "@/sim/engine";
import { InputConfig, saveInput } from "@/sim/input";
import { Difficulty, DIFFICULTY, getMission, MISSIONS } from "@/sim/missions";
import { FlightMode, MODE_HINT, MODE_LABEL } from "@/sim/physics";
import type { Quality } from "@/sim/world";
import ControlsSetup from "./ControlsSetup";
import Postcard from "./Postcard";

const HangarPreview = lazy(() => import("./HangarPreview"));

export interface LaunchSettings {
  mission: string; af: string; diff: Difficulty; quality: Quality; fmode: FlightMode; cam: CamMode; input: InputConfig;
}
export type Best = Record<string, { score: number; stars: number }>;

const ACCENT = "#00ffaa";
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const surface = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" };

export const QUALITY: Record<Quality, { label: string; hint: string }> = {
  high: { label: "Ультра", hint: "тени 4K, сглаживание MSAA, свечение, детальный лес до 230 м" },
  medium: { label: "Средняя", hint: "тени 2K, свечение, детальный лес до 150 м" },
  low: { label: "Низкая", hint: "без теней и постобработки — для ноутбуков и телефонов" },
};

const TABS = [
  { id: "missions", label: "Миссии", icon: "Map" },
  { id: "hangar", label: "Ангар", icon: "Warehouse" },
  { id: "controls", label: "Управление", icon: "Gamepad2" },
  { id: "graphics", label: "Графика", icon: "MonitorCog" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export const Stars = ({ n, size = 14 }: { n: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {[0, 1, 2].map((i) => <Icon key={i} name="Star" size={size} style={{ color: i < n ? "#ffd700" : "#3a3f48", fill: i < n ? "#ffd700" : "none" }} />)}
  </span>
);

function AirframeIcon({ af, size = 56 }: { af: Airframe; size?: number }) {
  const k = 34 / (af.arm + af.propR);
  const color = hex(af.color);
  return (
    <svg width={size} height={size} viewBox="-40 -40 80 80">
      {af.motors.map((m, i) => <line key={`l${i}`} x1={0} y1={0} x2={m.x * k} y2={m.z * k} stroke="#667" strokeWidth={2.5} />)}
      {af.motors.map((m, i) => (
        <circle key={i} cx={m.x * k} cy={m.z * k} r={af.propR * k} fill={`${color}22`} stroke={color} strokeWidth={m.y < 0 ? 0.6 : 1.4} strokeDasharray={m.y < 0 ? "2 2" : undefined} />
      ))}
      <rect x={-6} y={-8} width={12} height={16} rx={3} fill={color} />
      <path d="M0 -15 L4 -9 L-4 -9 Z" fill="#ff4444" />
    </svg>
  );
}

function Bar({ label, value, max, text, color }: { label: string; value: number; max: number; text: string; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-gray-400">{label}</span><span className="text-white font-semibold tabular-nums">{text}</span></div>
      <div className="h-1.5 rounded-full bg-white/10 mt-1"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} /></div>
    </div>
  );
}

const compass = (deg: number) => ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export default function Launcher({ initial, best, onStart }: { initial: LaunchSettings; best: Best; onStart: (s: LaunchSettings) => void }) {
  const [s, setS] = useState<LaunchSettings>(initial);
  const [tab, setTab] = useState<Tab>("missions");
  const set = (patch: Partial<LaunchSettings>) => {
    setS((prev) => {
      const nx = { ...prev, ...patch };
      if (patch.input) saveInput(patch.input);
      if (patch.quality) try { localStorage.setItem("bas-sim-quality", patch.quality); } catch { /* приватный режим */ }
      return nx;
    });
  };
  const mission = getMission(s.mission);
  const af = getAirframe(s.af);
  const afColor = hex(af.color);
  const w = mission.wind;
  const visibility = Math.round(Math.min(10, 2.3 / mission.world.palette.fogDensity / 1000) * 10) / 10;
  const twr = (af.motorThrust * af.motors.length) / ((af.mass + af.payloadMax) * 9.81);

  return (
    <div className="min-h-screen bg-background text-white grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)]" style={{ backgroundImage: "radial-gradient(1200px 600px at 80% -10%, rgba(0,170,255,0.08), transparent), radial-gradient(900px 500px at 0% 110%, rgba(0,255,170,0.06), transparent)" }}>
      {/* боковая панель */}
      <aside className="min-w-0 lg:sticky lg:top-0 lg:h-screen flex flex-col border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">
        <div className="px-5 pt-5 pb-4 flex items-center justify-between lg:block">
          <div>
            <div className="font-orbitron text-lg font-black tracking-[0.12em] flex items-center gap-2">
              <Icon name="Plane" size={18} style={{ color: ACCENT }} />БАС<span style={{ color: ACCENT }}>·</span>SIM
            </div>
            <div className="text-xs text-gray-500 mt-0.5">тренажёр операторов БВС · Республика Коми</div>
          </div>
          {!import.meta.env.VITE_STANDALONE && (
            <Link to="/" className="text-xs font-orbitron text-gray-500 hover:text-white flex items-center gap-1 lg:mt-3"><Icon name="ArrowLeft" size={12} />БАС_АРЕНА</Link>
          )}
        </div>
        <nav className="flex lg:flex-col gap-1 px-3 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg font-orbitron text-xs font-bold whitespace-nowrap transition-colors"
              style={{ background: tab === t.id ? `${ACCENT}14` : "transparent", color: tab === t.id ? ACCENT : "#9aa3b2" }}>
              <Icon name={t.icon} size={16} />{t.label.toUpperCase()}
            </button>
          ))}
        </nav>

        {/* предполётная сводка */}
        <div className="mt-auto p-4 hidden lg:block">
          <div className="rounded-xl overflow-hidden" style={surface}>
            <Postcard mission={mission} className="w-full h-20 block" />
            <div className="p-3 space-y-1.5 text-sm">
              <div className="font-orbitron text-xs font-bold" style={{ color: mission.color }}>{mission.title.toUpperCase()}</div>
              {[["Аппарат", af.name], ["Режим", MODE_LABEL[s.fmode]], ["Камера", CAM_LABEL[s.cam]],
                ["Управление", s.input.device === "gamepad" ? "пульт / геймпад" : "клавиатура"], ["Сложность", DIFFICULTY[s.diff].label]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="text-gray-200">{v}</span></div>
              ))}
            </div>
          </div>
          <button onClick={() => onStart(s)} className="mt-3 w-full py-4 rounded-xl font-orbitron font-black tracking-[0.2em] text-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: ACCENT, color: "#0a0d16", boxShadow: `0 0 28px ${ACCENT}55` }}>
            НА ВЗЛЁТ
          </button>
        </div>
      </aside>

      <main className="px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-8 min-w-0">
        {tab === "missions" && (
          <div className="grid xl:grid-cols-[1fr_380px] gap-6">
            <section className="min-w-0">
              <h1 className="font-orbitron text-xl font-black">МИССИИ</h1>
              <p className="text-gray-400 mt-1 mb-4">Задачи, которые реально решают расчёты БВС: лесоохрана, МЧС, сельское хозяйство, энергетики.</p>
              <div className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                {MISSIONS.map((m) => {
                  const on = m.id === s.mission;
                  return (
                    <button key={m.id} onClick={() => set({ mission: m.id, af: m.recommended[0] })} className="text-left rounded-xl overflow-hidden transition-all group"
                      style={{ border: `1px solid ${on ? m.color : "rgba(255,255,255,0.08)"}`, boxShadow: on ? `0 0 0 1px ${m.color}, 0 10px 30px ${m.color}22` : "none" }}>
                      <div className="relative">
                        <Postcard mission={m} className="w-full h-28 block" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(8,11,18,0.9))" }} />
                        <div className="absolute top-2 left-2 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(8,11,18,0.7)", border: `1px solid ${m.color}66` }}>
                          <Icon name={m.icon} size={16} style={{ color: m.color }} />
                        </div>
                        {best[m.id] && <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(8,11,18,0.7)" }}><Stars n={best[m.id].stars} size={12} /></div>}
                        <div className="absolute bottom-2 left-3 right-3 font-orbitron text-sm font-bold text-white">{m.title}</div>
                      </div>
                      <div className="p-3" style={{ background: on ? `${m.color}0d` : "rgba(255,255,255,0.02)" }}>
                        <div className="text-sm" style={{ color: m.color }}>{m.tagline}</div>
                        <div className="text-xs text-gray-500 mt-1.5 flex items-center gap-1"><Icon name="MapPin" size={11} />{m.place}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="space-y-4 min-w-0">
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${mission.color}44` }}>
                <Postcard mission={mission} className="w-full h-36 block" />
                <div className="p-5" style={{ background: `${mission.color}08` }}>
                  <div className="font-orbitron text-[11px] tracking-widest" style={{ color: mission.color }}>БРИФИНГ</div>
                  <div className="font-orbitron text-lg font-black mt-1">{mission.title}</div>
                  <div className="text-xs text-gray-500 mb-3">{mission.place}</div>
                  <div className="space-y-2 text-[15px] leading-snug text-gray-300">{mission.briefing.map((b) => <p key={b}>{b}</p>)}</div>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {[["ВЕТЕР", `${compass(w.toDeg + 180)}, ${Math.round(w.speed * DIFFICULTY[s.diff].wind)} м/с`], ["ПОРЫВЫ", `до ${Math.round(w.speed * DIFFICULTY[s.diff].wind * (1 + w.gust))} м/с`], ["ВИДИМОСТЬ", visibility >= 5 ? "> 5 км" : `${visibility} км`]].map(([k, v]) => (
                      <div key={k} className="rounded-lg p-2" style={surface}>
                        <div className="text-[10px] font-orbitron text-gray-500">{k}</div>
                        <div className="text-sm font-semibold">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mt-3">Рекомендуемые аппараты: {mission.recommended.map((id) => getAirframe(id).name).join(", ")}</div>
                </div>
              </div>
              <div>
                <div className="font-orbitron text-xs font-bold mb-2">СЛОЖНОСТЬ</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                    <button key={d} onClick={() => set({ diff: d })} className="rounded-lg py-2 px-1 transition-all"
                      style={{ background: s.diff === d ? "#bf5fff22" : surface.background, border: `1px solid ${s.diff === d ? "#bf5fff" : "rgba(255,255,255,0.08)"}` }}>
                      <div className="font-orbitron text-xs font-bold" style={{ color: s.diff === d ? "#bf5fff" : "#aaa" }}>{DIFFICULTY[d].label}</div>
                      <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{DIFFICULTY[d].hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}

        {tab === "hangar" && (
          <div className="grid xl:grid-cols-[1fr_360px] gap-6">
            <section className="min-w-0 space-y-4">
              <h1 className="font-orbitron text-xl font-black">АНГАР</h1>
              <div className="relative rounded-2xl overflow-hidden h-[300px] sm:h-[380px]" style={{ background: "radial-gradient(ellipse at 50% 70%, #1b2430, #090c12 70%)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Suspense fallback={null}><HangarPreview af={af} tank={mission.payloadUnit === "л"} /></Suspense>
                <div className="absolute left-5 top-4">
                  <div className="font-orbitron text-2xl font-black" style={{ color: afColor }}>{af.name}</div>
                  <div className="text-sm text-gray-400">{af.scheme} · {af.motors.length} моторов</div>
                </div>
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {AIRFRAMES.map((a) => {
                  const on = a.id === s.af, rec = mission.recommended.includes(a.id), c = hex(a.color);
                  return (
                    <button key={a.id} onClick={() => set({ af: a.id })} className="rounded-xl p-3 text-center relative transition-all"
                      style={{ background: on ? `${c}12` : surface.background, border: `1px solid ${on ? c : "rgba(255,255,255,0.08)"}` }}>
                      {rec && <span className="absolute top-2 right-2 text-[10px] font-orbitron px-1.5 py-0.5 rounded" style={{ background: `${ACCENT}22`, color: ACCENT }}>ДЛЯ МИССИИ</span>}
                      <div className="flex justify-center"><AirframeIcon af={a} /></div>
                      <div className="font-orbitron text-sm font-bold mt-1">{a.name}</div>
                      <div className="text-xs text-gray-500">{a.scheme}</div>
                    </button>
                  );
                })}
              </div>
            </section>
            <aside className="space-y-4 min-w-0">
              <div className="rounded-xl p-5 space-y-3" style={surface}>
                <p className="text-sm text-gray-300">{af.description}</p>
                <Bar label="Тяговооружённость с грузом" value={twr} max={3} text={`${twr.toFixed(1)}`} color={afColor} />
                <Bar label="Максимальная скорость" value={af.maxSpeed} max={20} text={`${af.maxSpeed} м/с`} color={afColor} />
                <Bar label="Полезная нагрузка" value={af.payloadMax} max={20} text={`${af.payloadMax} кг`} color={afColor} />
                <Bar label="Висение без груза" value={hoverMinutes(af, 0)} max={40} text={`${hoverMinutes(af, 0).toFixed(0)} мин`} color={afColor} />
                <Bar label="Висение с полным грузом" value={hoverMinutes(af, af.payloadMax)} max={40} text={`${hoverMinutes(af, af.payloadMax).toFixed(0)} мин`} color={afColor} />
                <div className="flex justify-between text-sm pt-1"><span className="text-gray-400">Взлётная масса</span><span>{af.mass + af.payloadMax} кг</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">Батарея</span><span>{af.batteryWh} Вт·ч</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">Резерв при отказе</span><span>{af.redundancy}</span></div>
              </div>
              <div className="rounded-xl p-4 space-y-3" style={surface}>
                <div className="font-orbitron text-xs font-bold">ПОЛЁТНЫЙ РЕЖИМ НА СТАРТЕ</div>
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((m) => (
                    <button key={m} onClick={() => set({ fmode: m })} className="rounded-lg p-2 text-left transition-all"
                      style={{ background: s.fmode === m ? "#ffd70018" : surface.background, border: `1px solid ${s.fmode === m ? "#ffd700" : "rgba(255,255,255,0.08)"}` }}>
                      <div className="font-orbitron text-xs font-bold" style={{ color: s.fmode === m ? "#ffd700" : "#ccc" }}>{MODE_LABEL[m]}</div>
                      <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{MODE_HINT[m]}</div>
                    </button>
                  ))}
                </div>
                <div className="font-orbitron text-xs font-bold pt-1">КАМЕРА НА СТАРТЕ</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CAMS.map((c) => (
                    <button key={c} onClick={() => set({ cam: c })} className="rounded-lg py-2 font-orbitron text-[11px] font-bold"
                      style={{ background: s.cam === c ? `${ACCENT}18` : surface.background, border: `1px solid ${s.cam === c ? ACCENT : "rgba(255,255,255,0.08)"}`, color: s.cam === c ? ACCENT : "#bbb" }}>
                      {CAM_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}

        {tab === "controls" && (
          <section className="max-w-4xl">
            <h1 className="font-orbitron text-xl font-black">УПРАВЛЕНИЕ</h1>
            <p className="text-gray-400 mt-1 mb-4">Клавиатура, геймпад или настоящий пульт по USB. Пульт на EdgeTX/OpenTX определяется как джойстик: выберите пресет или пройдите калибровку.</p>
            <ControlsSetup cfg={s.input} onChange={(input) => set({ input })} />
          </section>
        )}

        {tab === "graphics" && (
          <section className="max-w-3xl space-y-5">
            <h1 className="font-orbitron text-xl font-black">ГРАФИКА</h1>
            <div className="grid sm:grid-cols-3 gap-3">
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <button key={q} onClick={() => set({ quality: q })} className="rounded-xl p-4 text-left transition-all"
                  style={{ background: s.quality === q ? "#00aaff14" : surface.background, border: `1px solid ${s.quality === q ? "#00aaff" : "rgba(255,255,255,0.08)"}` }}>
                  <div className="font-orbitron text-sm font-bold" style={{ color: s.quality === q ? "#00aaff" : "#ddd" }}>{QUALITY[q].label}</div>
                  <div className="text-sm text-gray-500 mt-1 leading-snug">{QUALITY[q].hint}</div>
                </button>
              ))}
            </div>
            <div className="rounded-xl p-5 space-y-4" style={surface}>
              <div className="font-orbitron text-xs font-bold">FPV-КАМЕРА</div>
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
            </div>
          </section>
        )}
      </main>

      {/* мобильная нижняя панель */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 p-3 flex gap-3 items-center border-t border-white/10" style={{ background: "rgba(8,11,18,0.95)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex-1 min-w-0 text-xs">
          <div className="font-orbitron font-bold truncate" style={{ color: mission.color }}>{mission.title}</div>
          <div className="text-gray-400 truncate">{af.name} · {MODE_LABEL[s.fmode]} · {CAM_LABEL[s.cam]}</div>
        </div>
        <button onClick={() => onStart(s)} className="px-6 py-3 rounded-xl font-orbitron font-black text-sm tracking-widest" style={{ background: ACCENT, color: "#0a0d16" }}>НА ВЗЛЁТ</button>
      </div>
    </div>
  );
}
