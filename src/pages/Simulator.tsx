import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "@/components/ui/icon";
import { AIRFRAMES, Airframe, getAirframe, hoverMinutes } from "@/sim/airframes";
import { Command, Hud, SimEngine, SimResult } from "@/sim/engine";
import { Difficulty, DIFFICULTY, getMission, MissionDef, MISSIONS, SayKind } from "@/sim/missions";
import type { Quality } from "@/sim/world";

const QUALITY: Record<Quality, { label: string; hint: string }> = {
  high: { label: "Ультра", hint: "тени 4K, MSAA, bloom" },
  medium: { label: "Средняя", hint: "тени, bloom" },
  low: { label: "Низкая", hint: "для слабых устройств" },
};
const Q_KEY = "bas-sim-quality";
function loadQuality(): Quality {
  try {
    const q = localStorage.getItem(Q_KEY);
    if (q === "high" || q === "medium" || q === "low") return q;
  } catch { /* приватный режим */ }
  return window.matchMedia("(pointer: coarse)").matches ? "low" : "high";
}

// ─────────────────────────── хранение рекордов ───────────────────────────

type Best = Record<string, { score: number; stars: number }>;
const BEST_KEY = "bas-sim-best";
function loadBest(): Best {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch { return {}; }
}
function saveBest(id: string, r: SimResult) {
  const b = loadBest();
  if (!b[id] || r.score > b[id].score) {
    b[id] = { score: r.score, stars: r.stars };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* приватный режим */ }
  }
}

const panel = { background: "rgba(8,12,20,0.78)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(6px)" };
const Stars = ({ n, size = 14 }: { n: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {[0, 1, 2].map((i) => <Icon key={i} name="Star" size={size} style={{ color: i < n ? "#ffd700" : "#333", fill: i < n ? "#ffd700" : "none" }} />)}
  </span>
);

// ─────────────────────────── схема аппарата (вид сверху) ───────────────────────────

function AirframeIcon({ af, size = 64 }: { af: Airframe; size?: number }) {
  const k = 34 / (af.arm + af.propR);
  const color = `#${af.color.toString(16).padStart(6, "0")}`;
  return (
    <svg width={size} height={size} viewBox="-40 -40 80 80">
      {af.motors.map((m, i) => <line key={`l${i}`} x1={0} y1={0} x2={m.x * k} y2={m.z * k} stroke="#667" strokeWidth={2.5} />)}
      {af.motors.map((m, i) => (
        <circle key={i} cx={m.x * k} cy={m.z * k} r={af.propR * k} fill={`${color}22`} stroke={color} strokeWidth={m.y < 0 ? 0.6 : 1.4}
          strokeDasharray={m.y < 0 ? "2 2" : undefined} />
      ))}
      <rect x={-6} y={-8} width={12} height={16} rx={3} fill={color} />
      <path d="M0 -15 L4 -9 L-4 -9 Z" fill="#ff4444" />
    </svg>
  );
}

// ─────────────────────────── меню ───────────────────────────

function Menu({ onStart }: { onStart: (m: string, a: string, d: Difficulty, q: Quality) => void }) {
  const [missionId, setMissionId] = useState(MISSIONS[0].id);
  const [afId, setAfId] = useState(MISSIONS[0].recommended[0]);
  const [diff, setDiff] = useState<Difficulty>("pilot");
  const [quality, setQuality] = useState<Quality>(loadQuality);
  const pickQuality = (q: Quality) => { setQuality(q); try { localStorage.setItem(Q_KEY, q); } catch { /* приватный режим */ } };
  const [best] = useState(loadBest);
  const mission = getMission(missionId);
  const af = getAirframe(afId);

  const pick = (m: MissionDef) => { setMissionId(m.id); setAfId(m.recommended[0]); };
  const stat = (label: string, value: string) => (
    <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-white font-semibold">{value}</span></div>
  );

  return (
    <div className="min-h-screen bg-background grid-bg">
      <header className="border-b border-white/5" style={{ background: "rgba(10,13,22,0.92)" }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-orbitron text-sm font-bold text-white flex items-center gap-2" style={{ letterSpacing: "0.1em" }}>
            <Icon name="Plane" size={16} style={{ color: "#00ffaa" }} />БАС<span style={{ color: "#00ffaa" }}>_</span>СИМУЛЯТОР
          </span>
          {!import.meta.env.VITE_STANDALONE && (
            <Link to="/" className="flex items-center gap-2 text-xs font-orbitron text-muted-foreground hover:text-white transition-colors">
              <Icon name="ArrowLeft" size={14} />БАС_АРЕНА
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_380px] gap-6">
        <section>
          <h1 className="font-orbitron text-xl font-black text-white mb-1">ВЫБОР МИССИИ</h1>
          <p className="text-muted-foreground mb-4">Реальные задачи беспилотной авиации в Республике Коми. Физика каждого мотора, ветер, батарея и отказы — как в жизни.</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {MISSIONS.map((m) => {
              const on = m.id === missionId;
              return (
                <button key={m.id} onClick={() => pick(m)} className="text-left rounded-xl p-4 transition-all duration-200"
                  style={{ background: on ? `${m.color}14` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? m.color : "rgba(255,255,255,0.08)"}`, boxShadow: on ? `0 0 24px ${m.color}22` : "none" }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${m.color}20`, border: `1px solid ${m.color}44` }}>
                      <Icon name={m.icon} size={20} style={{ color: m.color }} />
                    </div>
                    {best[m.id] && <div className="text-right"><Stars n={best[m.id].stars} /><div className="text-xs text-muted-foreground">{best[m.id].score} очк.</div></div>}
                  </div>
                  <div className="font-orbitron text-sm font-bold text-white">{m.title}</div>
                  <div className="text-sm mt-1" style={{ color: m.color }}>{m.tagline}</div>
                  <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Icon name="MapPin" size={11} />{m.place}</div>
                </button>
              );
            })}
          </div>

          <h2 className="font-orbitron text-base font-bold text-white mt-7 mb-3">АППАРАТ</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {AIRFRAMES.map((a) => {
              const on = a.id === afId, rec = mission.recommended.includes(a.id);
              const color = `#${a.color.toString(16).padStart(6, "0")}`;
              return (
                <button key={a.id} onClick={() => setAfId(a.id)} className="rounded-xl p-3 text-center transition-all duration-200 relative"
                  style={{ background: on ? `${color}14` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color : "rgba(255,255,255,0.08)"}` }}>
                  {rec && <span className="absolute top-2 right-2 text-[10px] font-orbitron px-1.5 py-0.5 rounded" style={{ background: "#00ffaa22", color: "#00ffaa" }}>СОВЕТ</span>}
                  <div className="flex justify-center"><AirframeIcon af={a} /></div>
                  <div className="font-orbitron text-sm font-bold text-white mt-1">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.scheme}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl p-4 mt-6 text-sm" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-orbitron text-xs font-bold text-white mb-3">УПРАВЛЕНИЕ</div>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-muted-foreground">
              {[["W / S", "вверх / вниз"], ["A / D", "поворот (рыскание)"], ["Стрелки", "вперёд, назад, влево, вправо"], ["Пробел", "целевая нагрузка (сброс, снимок)"],
                ["C", "камера: сзади / FPV / сверху"], ["T", "тепловизор"], ["V / G", "окно камеры / наклон подвеса"], ["M", "режим полёта"],
                ["H", "автовозврат на базу"], ["Esc", "пауза"]].map(([k, v]) => (
                <div key={k} className="flex gap-3"><kbd className="px-1.5 rounded text-white text-xs font-mono shrink-0" style={{ background: "#ffffff14", minWidth: 62, textAlign: "center", lineHeight: "20px" }}>{k}</kbd><span>{v}</span></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">Поддерживаются геймпад и сенсорные стики на телефоне (левый — газ и рыскание, правый — крен и тангаж).</p>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="rounded-xl p-5" style={{ background: `${mission.color}0d`, border: `1px solid ${mission.color}44` }}>
            <div className="font-orbitron text-xs mb-1" style={{ color: mission.color }}>БРИФИНГ</div>
            <div className="font-orbitron text-lg font-black text-white">{mission.title}</div>
            <div className="text-xs text-muted-foreground mb-3">{mission.place}</div>
            <div className="space-y-2 text-[15px] leading-snug text-gray-300">{mission.briefing.map((b) => <p key={b}>{b}</p>)}</div>
          </div>

          <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-orbitron text-sm font-bold text-white">{af.name} <span className="text-muted-foreground font-normal">· {af.scheme}</span></div>
            <p className="text-sm text-muted-foreground mt-1 mb-3">{af.description}</p>
            <div className="space-y-1">
              {stat("Взлётная масса", `${af.mass} кг + ${af.payloadMax} кг груза`)}
              {stat("Моторов", String(af.motors.length))}
              {stat("Тяговооружённость", `${((af.motorThrust * af.motors.length) / ((af.mass + af.payloadMax) * 9.81)).toFixed(1)} с грузом`)}
              {stat("Скорость", `до ${af.maxSpeed} м/с`)}
              {stat("Висение", `${hoverMinutes(af, af.payloadMax).toFixed(0)}–${hoverMinutes(af, 0).toFixed(0)} мин`)}
              {stat("Резерв при отказе", af.redundancy)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button key={d} onClick={() => setDiff(d)} className="rounded-lg py-2 px-1 transition-all"
                style={{ background: diff === d ? "#bf5fff22" : "rgba(255,255,255,0.03)", border: `1px solid ${diff === d ? "#bf5fff" : "rgba(255,255,255,0.08)"}` }}>
                <div className="font-orbitron text-xs font-bold" style={{ color: diff === d ? "#bf5fff" : "#aaa" }}>{DIFFICULTY[d].label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{DIFFICULTY[d].hint}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(QUALITY) as Quality[]).map((q) => (
              <button key={q} onClick={() => pickQuality(q)} className="rounded-lg py-2 px-1 transition-all"
                style={{ background: quality === q ? "#00aaff22" : "rgba(255,255,255,0.03)", border: `1px solid ${quality === q ? "#00aaff" : "rgba(255,255,255,0.08)"}` }}>
                <div className="font-orbitron text-xs font-bold flex items-center justify-center gap-1" style={{ color: quality === q ? "#00aaff" : "#aaa" }}>
                  <Icon name="MonitorCog" size={12} />{QUALITY[q].label}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{QUALITY[q].hint}</div>
              </button>
            ))}
          </div>

          <button onClick={() => onStart(missionId, afId, diff, quality)}
            className="w-full py-4 rounded-xl font-orbitron font-black text-base tracking-widest transition-transform hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "#00ffaa", color: "#0a0d16", boxShadow: "0 0 30px #00ffaa55" }}>
            НА ВЗЛЁТ
          </button>
        </aside>
      </main>
    </div>
  );
}

// ─────────────────────────── сенсорный стик ───────────────────────────

function Stick({ side, onMove }: { side: "left" | "right"; onMove: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    setKnob({ x, y });
    onMove(x, -y);
  };
  const end = () => { id.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div ref={ref} className="absolute bottom-4 rounded-full select-none"
      style={{ [side]: 16, width: 132, height: 132, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.22)", touchAction: "none" }}
      onPointerDown={(e) => { id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (id.current === e.pointerId) move(e); }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="absolute rounded-full" style={{ width: 52, height: 52, left: 40 + knob.x * 40, top: 40 + knob.y * 40, background: "rgba(0,255,170,0.55)", border: "1px solid #00ffaa" }} />
    </div>
  );
}

// ─────────────────────────── полёт ───────────────────────────

interface Toast { id: number; text: string; kind: SayKind }
const TOAST_COLOR: Record<SayKind, string> = { info: "#00aaff", good: "#00ffaa", warn: "#ff8800" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Flight({ mission, af, difficulty, quality, onExit, onRestart }: {
  mission: MissionDef; af: Airframe; difficulty: Difficulty; quality: Quality; onExit: () => void; onRestart: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const horizon = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SimEngine | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const toastId = useRef(0);

  useEffect(() => {
    let e: SimEngine;
    try {
      e = new SimEngine({
        canvas: canvas.current!, mapCanvas: map.current!, horizonCanvas: horizon.current!, mission, airframe: af, difficulty, quality,
        onHud: setHud,
        onSay: (text, kind) => {
          const id = ++toastId.current;
          setToasts((t) => [...t.slice(-2), { id, text, kind }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
        },
        onEnd: (r) => { if (r.success) saveBest(mission.id, r); setResult(r); },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebGL недоступен");
      return;
    }
    engine.current = e;
    return () => { e.dispose(); engine.current = null; };
  }, [mission, af, difficulty, quality]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.code === "Escape") setPaused((p) => !p); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (engine.current) engine.current.paused = paused; }, [paused]);

  const cmd = useCallback((c: Command) => engine.current?.command(c), []);
  const btn = (label: string, icon: string, c: Command, active = false) => (
    <button key={c} onClick={() => cmd(c)} title={label} className="w-10 h-10 rounded-lg flex items-center justify-center pointer-events-auto"
      style={{ ...panel, color: active ? "#00ffaa" : "#ccc", borderColor: active ? "#00ffaa88" : "rgba(255,255,255,0.12)" }}>
      <Icon name={icon} size={18} />
    </button>
  );
  const cell = (label: string, value: string, color = "#fff") => (
    <div className="px-2.5 text-center min-w-[64px]">
      <div className="text-[10px] text-gray-400 font-orbitron tracking-wider">{label}</div>
      <div className="text-lg font-bold leading-tight tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
  const batColor = !hud ? "#fff" : hud.battery > 0.4 ? "#00ffaa" : hud.battery > 0.2 ? "#ffd700" : "#ff4444";

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none" style={{ touchAction: "none" }}>
      <canvas ref={canvas} className="absolute inset-0 w-full h-full block" />
      {error && <div className="absolute inset-0 flex items-center justify-center text-center p-6 text-white">Не удалось запустить 3D-графику: {error}.<br />Обновите браузер или включите аппаратное ускорение.</div>}

      <div className="absolute inset-0 pointer-events-none font-rajdhani">
        {/* задачи */}
        <div className="absolute top-3 left-3 rounded-xl p-3 w-[min(300px,calc(100vw-150px))]" style={panel}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-orbitron text-xs font-bold truncate" style={{ color: mission.color }}>{mission.title.toUpperCase()}</div>
            <div className="font-orbitron text-xs text-white tabular-nums">{fmt(hud?.time ?? 0)}</div>
          </div>
          <div className="mt-2 space-y-1">
            {hud?.objectives.map((o) => (
              <div key={o.text} className="flex items-start gap-2 text-sm leading-tight" style={{ color: o.done ? "#00ffaa" : "#ddd" }}>
                <Icon name={o.done ? "CheckSquare" : "Square"} size={14} className="mt-0.5 shrink-0" />
                <span className="flex-1">{o.text}</span>
                {o.progress && <span className="text-xs text-gray-400 whitespace-nowrap">{o.progress}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-3">
            <button onClick={() => setPaused(true)} className="pointer-events-auto text-xs font-orbitron px-2 py-1 rounded flex items-center gap-1 text-gray-300" style={{ background: "#ffffff12" }}>
              <Icon name="Pause" size={12} />ПАУЗА
            </button>
            <span className="text-xs text-gray-400 self-center ml-1">{af.name} · {DIFFICULTY[difficulty].label}</span>
          </div>
        </div>

        {/* сообщения */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[min(520px,calc(100vw-24px))] space-y-1.5 flex flex-col items-center" style={{ marginTop: touch ? 132 : 0 }}>
          {hud?.warnings.map((w) => (
            <div key={w} className="font-orbitron text-xs font-bold px-3 py-1 rounded animate-pulse" style={{ background: "#ff444433", border: "1px solid #ff4444", color: "#ff6666" }}>{w}</div>
          ))}
          {toasts.map((t) => (
            <div key={t.id} className="px-3 py-1.5 rounded-lg text-[15px] text-white text-center animate-fade-in" style={{ ...panel, borderColor: `${TOAST_COLOR[t.kind]}88` }}>
              <span style={{ color: TOAST_COLOR[t.kind] }}>● </span>{t.text}
            </div>
          ))}
        </div>

        {/* карта и окно камеры */}
        <canvas ref={map} className="absolute rounded-xl" style={{ top: 12, right: 12, width: hud?.mapSize ?? 176, height: hud?.mapSize ?? 176, border: "1px solid rgba(255,255,255,0.14)" }} />
        {hud?.pip && (
          <div className="absolute rounded" style={{ top: hud.pipRect.top, right: hud.pipRect.right, width: hud.pipRect.w, height: hud.pipRect.h, border: `1px solid ${hud.thermal ? "#ff8800" : "rgba(255,255,255,0.35)"}` }}>
            <span className="absolute top-1 left-1.5 font-orbitron text-[10px] px-1 rounded" style={{ background: "rgba(0,0,0,0.55)", color: hud.thermal ? "#ff8800" : "#fff" }}>
              {hud.thermal ? "ТЕПЛОВИЗОР" : "КАМЕРА ПОДВЕСА"}
            </span>
            <span className="absolute left-1/2 top-1/2 w-4 h-4 -ml-2 -mt-2 rounded-full" style={{ border: "1px solid rgba(255,255,255,0.7)" }} />
          </div>
        )}

        {/* кнопки */}
        <div className="absolute flex gap-1.5" style={touch ? { bottom: 158, right: 12, flexDirection: "column" } : { bottom: 12, right: 12 }}>
          {btn("Камера (C)", "Video", "cam")}
          {btn("Тепловизор (T)", "Thermometer", "thermal", hud?.thermal)}
          {btn("Окно камеры (V)", "PictureInPicture2", "pip", hud?.pip)}
          {btn("Режим полёта (M)", "SlidersHorizontal", "mode")}
          {btn("Автовозврат (H)", "Home", "rth", hud?.rth)}
          {btn("Звук (N)", "Volume2", "mute")}
        </div>

        {/* телеметрия */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-xl flex items-center py-1.5 px-2 max-w-[calc(100vw-16px)]"
          style={{ ...panel, bottom: touch ? 158 : 12, transform: `translateX(-50%) scale(${touch ? 0.82 : 1})`, transformOrigin: "bottom center" }}>
          <canvas ref={horizon} style={{ width: 58, height: 58 }} className="shrink-0 mr-1" />
          {hud && <>
            {cell("ВЫСОТА", `${hud.agl.toFixed(1)} м`)}
            {cell("СКОРОСТЬ", `${hud.speed.toFixed(1)}`)}
            {cell("ВЕРТ.", `${hud.vs >= 0 ? "+" : ""}${hud.vs.toFixed(1)}`)}
            <div className="px-2.5 min-w-[92px]">
              <div className="text-[10px] text-gray-400 font-orbitron tracking-wider flex justify-between"><span>АКБ</span><span>{hud.minutes < 90 ? `~${hud.minutes.toFixed(0)} мин` : ""}</span></div>
              <div className="text-lg font-bold leading-tight tabular-nums" style={{ color: batColor }}>{(hud.battery * 100).toFixed(0)}%</div>
              <div className="h-1 rounded bg-white/10"><div className="h-1 rounded" style={{ width: `${hud.battery * 100}%`, background: batColor }} /></div>
            </div>
            {hud.payloadText !== "—" && (
              <div className="px-2.5 min-w-[84px]">
                <div className="text-[10px] text-gray-400 font-orbitron tracking-wider">{hud.payloadLabel.toUpperCase()}</div>
                <div className="text-lg font-bold leading-tight tabular-nums text-white whitespace-nowrap">{hud.payloadText}</div>
                <div className="h-1 rounded bg-white/10"><div className="h-1 rounded" style={{ width: `${hud.payloadFrac * 100}%`, background: "#00aaff" }} /></div>
              </div>
            )}
            <div className="px-2.5 text-center min-w-[64px]">
              <div className="text-[10px] text-gray-400 font-orbitron tracking-wider">ВЕТЕР</div>
              <div className="text-lg font-bold leading-tight tabular-nums text-white flex items-center justify-center gap-1">
                <Icon name="ArrowUp" size={14} style={{ transform: `rotate(${hud.windFrom + 180 - hud.heading}deg)`, color: "#00aaff" }} />{hud.wind.toFixed(0)}
              </div>
            </div>
            {cell("БАЗА", `${hud.distHome.toFixed(0)} м`)}
            <div className="px-2.5 text-center hidden sm:block">
              <div className="text-[10px] text-gray-400 font-orbitron tracking-wider">РЕЖИМ</div>
              <div className="text-sm font-bold leading-tight whitespace-nowrap" style={{ color: hud.rth ? "#ffd700" : "#00ffaa" }}>{hud.mode}</div>
              <div className="flex gap-0.5 justify-center mt-1">
                {hud.motors.map((ok, i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? "#00ffaa" : "#ff4444" }} />)}
              </div>
            </div>
          </>}
        </div>

        {touch && !result && <>
          <div className="pointer-events-auto"><Stick side="left" onMove={(x, y) => { const t = engine.current?.touch; if (t) { t.yaw = x; t.throttle = y; } }} /></div>
          <div className="pointer-events-auto"><Stick side="right" onMove={(x, y) => { const t = engine.current?.touch; if (t) { t.roll = x; t.pitch = y; } }} /></div>
          {mission.actionLabel !== "—" && (
            <button className="absolute pointer-events-auto rounded-full font-orbitron text-[11px] font-bold"
              style={{ bottom: 156, left: 16, width: 76, height: 76, background: `${mission.color}33`, border: `2px solid ${mission.color}`, color: "#fff", touchAction: "none" }}
              onPointerDown={() => { const e = engine.current; if (e) { e.touchAction = true; e.pressAction(); } }}
              onPointerUp={() => { if (engine.current) engine.current.touchAction = false; }}
              onPointerCancel={() => { if (engine.current) engine.current.touchAction = false; }}>
              {mission.actionLabel}
            </button>
          )}
        </>}
      </div>

      {/* пауза */}
      {paused && !result && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="rounded-2xl p-6 w-[320px] space-y-3 text-center" style={{ ...panel, background: "rgba(10,13,22,0.95)" }}>
            <div className="font-orbitron text-lg font-black text-white">ПАУЗА</div>
            <button onClick={() => setPaused(false)} className="w-full py-3 rounded-lg font-orbitron font-bold text-sm" style={{ background: "#00ffaa", color: "#0a0d16" }}>ПРОДОЛЖИТЬ</button>
            <button onClick={onRestart} className="w-full py-3 rounded-lg font-orbitron text-sm text-white" style={{ background: "#ffffff14" }}>НАЧАТЬ ЗАНОВО</button>
            <button onClick={onExit} className="w-full py-3 rounded-lg font-orbitron text-sm text-gray-300" style={{ background: "#ffffff0a" }}>К ВЫБОРУ МИССИИ</button>
          </div>
        </div>
      )}

      {/* итог */}
      {result && (
        <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }}>
          <div className="rounded-2xl p-6 w-[380px] max-w-full text-center animate-fade-in" style={{ ...panel, background: "rgba(10,13,22,0.96)", borderColor: result.success ? "#00ffaa66" : "#ff444466" }}>
            <div className="font-orbitron text-xs" style={{ color: mission.color }}>{mission.title.toUpperCase()}</div>
            <div className="font-orbitron text-2xl font-black mt-1" style={{ color: result.success ? "#00ffaa" : "#ff4444" }}>
              {result.success ? "МИССИЯ ВЫПОЛНЕНА" : "МИССИЯ ПРОВАЛЕНА"}
            </div>
            <div className="text-gray-300 mt-1">{result.reason}</div>
            {result.success && <div className="mt-3"><Stars n={result.stars} size={30} /><div className="font-orbitron text-3xl font-black text-white mt-1">{result.score}<span className="text-sm text-gray-400"> / 100</span></div></div>}
            <div className="mt-4 space-y-1 text-left">
              {result.rows.map(([k, v]) => (
                <div key={k} className="flex justify-between text-[15px] border-b border-white/5 py-0.5"><span className="text-gray-400">{k}</span><span className="text-white font-semibold">{v}</span></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={onRestart} className="py-3 rounded-lg font-orbitron font-bold text-sm" style={{ background: "#00ffaa", color: "#0a0d16" }}>ЕЩЁ РАЗ</button>
              <button onClick={onExit} className="py-3 rounded-lg font-orbitron text-sm text-white" style={{ background: "#ffffff14" }}>МИССИИ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── страница ───────────────────────────

export default function Simulator() {
  const [run, setRun] = useState<{ mission: string; af: string; diff: Difficulty; quality: Quality; key: number } | null>(null);
  useEffect(() => { document.title = "БАС Симулятор — миссии беспилотников"; }, []);
  if (!run) return <Menu onStart={(mission, af, diff, quality) => setRun({ mission, af, diff, quality, key: 1 })} />;
  return (
    <Flight key={run.key} mission={getMission(run.mission)} af={getAirframe(run.af)} difficulty={run.diff} quality={run.quality}
      onExit={() => setRun(null)} onRestart={() => setRun({ ...run, key: run.key + 1 })} />
  );
}
