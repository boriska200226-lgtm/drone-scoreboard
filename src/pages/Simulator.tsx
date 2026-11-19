import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import { Airframe, getAirframe } from "@/sim/airframes";
import { CAM_LABEL, CamMode, CAMS, Command, Fault, Hud, MODES, SimEngine, SimResult } from "@/sim/engine";
import { findMission } from "@/sim/course";
import { InputConfig, loadInput } from "@/sim/input";
import { loadModels } from "@/sim/models";
import { FlightMode, MODE_HINT, MODE_LABEL } from "@/sim/physics";
import { Difficulty, DIFFICULTY, MissionDef, SayKind, withWeather } from "@/sim/missions";
import type { Quality } from "@/sim/world";
import Launcher, { Best, LaunchSettings, Stars } from "./sim/Launcher";
import Debrief from "./sim/Debrief";
import { BAS_API, loadAuth } from "./arena/constants";

function loadQuality(): Quality {
  try {
    const q = localStorage.getItem("bas-sim-quality");
    if (q === "high" || q === "medium" || q === "low") return q;
  } catch { /* приватный режим */ }
  return window.matchMedia("(pointer: coarse)").matches ? "low" : "high";
}

// ─────────────────────────── хранение рекордов ───────────────────────────

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

function Segmented({ label, keyHint, items, value, color, onPick }: {
  label: string; keyHint: string; items: [string, string][]; value: string; color: string; onPick: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-orbitron tracking-wider text-gray-400 mb-1">{label} <span className="opacity-60">· {keyHint}</span></div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(([id, text]) => (
          <button key={id} onClick={() => onPick(id)} className="pointer-events-auto rounded py-1 text-[11px] font-orbitron font-bold truncate transition-colors"
            style={{ background: value === id ? `${color}26` : "#ffffff0d", color: value === id ? color : "#aaa", border: `1px solid ${value === id ? `${color}99` : "transparent"}` }}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Экранное меню FPV-очков в стиле полётного контроллера. */
function FpvOsd({ hud }: { hud: Hud }) {
  const o = hud.osd;
  const t = (text: string, style: React.CSSProperties) => (
    <div className="absolute font-mono text-[15px] font-bold text-white whitespace-nowrap" style={{ textShadow: "0 0 2px #000, 0 0 4px #000", ...style }}>{text}</div>
  );
  const lowV = o.volts / o.cells < 3.6;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {o.horizon && (
        <div className="absolute flex items-center gap-[18vw]" style={{ left: o.horizon.x, top: o.horizon.y, transform: `translate(-50%, -50%) rotate(${o.horizon.angle}deg)` }}>
          <div className="h-[2px] w-[16vw] bg-white" style={{ boxShadow: "0 0 3px #000" }} />
          <div className="h-[2px] w-[16vw] bg-white" style={{ boxShadow: "0 0 3px #000" }} />
        </div>
      )}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1">
        <div className="w-5 h-[2px] bg-white" style={{ boxShadow: "0 0 3px #000" }} />
        <div className="w-1.5 h-1.5 rounded-full border-2 border-white" />
        <div className="w-5 h-[2px] bg-white" style={{ boxShadow: "0 0 3px #000" }} />
      </div>
      {t(`${hud.agl.toFixed(1)}m`, { left: "62%", top: "50%", transform: "translateY(-50%)" })}
      {t(`${(hud.speed * 3.6).toFixed(0)}km/h`, { right: "62%", top: "50%", transform: "translateY(-50%)" })}
      {t(o.armed ? (hud.rth ? "RTH" : hud.modeId === "POS" ? "GPS" : hud.modeId) : "DISARMED", { left: "50%", top: "22%", transform: "translateX(-50%)", color: o.armed ? "#fff" : "#ff5555" })}
      {t(`${o.volts.toFixed(1)}V`, { left: "18%", bottom: "16%", color: lowV ? "#ff5555" : "#fff" })}
      {t(`THR ${Math.round(o.throttle * 100)}%`, { right: "18%", bottom: "16%" })}
      {t(fmt(hud.time), { right: "18%", bottom: "11%" })}
      {t(`H ${hud.distHome.toFixed(0)}m`, { left: "18%", bottom: "11%" })}
      {t(`${Math.round(hud.heading)}°`, { left: "50%", top: "17%", transform: "translateX(-50%)" })}
      {t(`LQ ${Math.round(hud.link * 100)}`, { left: "18%", top: "16%", color: hud.link < 0.3 ? "#ff5555" : "#fff" })}
      {t(hud.gpsSats ? `SAT ${hud.gpsSats}` : "NO GPS", { right: "18%", top: "16%", color: hud.gpsSats ? "#fff" : "#ff5555" })}
      {hud.failsafe && t(hud.failsafe.startsWith("НЕТ") ? "FAILSAFE" : "LAND", { left: "50%", top: "30%", transform: "translateX(-50%)", color: "#ff5555", fontSize: 26 })}
      {hud.payloadText !== "—" && t(`${hud.payloadLabel.toUpperCase()} ${hud.payloadText}`, { left: "50%", bottom: "11%", transform: "translateX(-50%)" })}
    </div>
  );
}

interface Toast { id: number; text: string; kind: SayKind }
const TOAST_COLOR: Record<SayKind, string> = { info: "#00aaff", good: "#00ffaa", warn: "#ff8800" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const TIPS = [
  "Над очагом пожара мощные восходящие потоки: заходите на сброс с наветренной стороны на высоте от 15 м.",
  "В режиме Acro аппарат не выравнивается сам — сначала потренируйтесь в Angle на полигоне.",
  "Пульт EdgeTX подключите по USB и выберите «USB Joystick (HID)», затем пройдите калибровку во вкладке «Управление».",
  "Тепловизор видит людей сквозь туман и дым на 100 м, глазом — только на 30 м.",
  "При отказе мотора у гексакоптера пропадает управление рысканием, но он долетит до базы на автовозврате (H).",
  "Обратный путь против ветра съедает заметно больше батареи — держите запас не меньше 30%.",
  "Камера «С земли» — так пилотируют в визуальной видимости: научитесь понимать ориентацию аппарата издалека.",
];

function Loading({ mission }: { mission: MissionDef }) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 p-6 text-center" style={{ background: "radial-gradient(ellipse at 50% 40%, #142030, #07090e 70%)" }}>
      <div className="font-orbitron text-xs tracking-[0.3em]" style={{ color: mission.color }}>{mission.place.toUpperCase()}</div>
      <div className="font-orbitron text-3xl font-black text-white">{mission.title}</div>
      <div className="w-64 h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-1 w-1/3 rounded-full animate-[loadbar_1.2s_ease-in-out_infinite]" style={{ background: mission.color }} /></div>
      <div className="text-sm text-gray-400">Генерация местности, леса и погоды…</div>
      <div className="max-w-md text-[15px] text-gray-300 leading-snug"><span className="font-orbitron text-[11px] mr-2" style={{ color: mission.color }}>СОВЕТ</span>{tip}</div>
      <style>{"@keyframes loadbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}

/** Отправка результата в БАС Арену: опыт начисляет сервер (только ученику и только за улучшение результата за день). */
async function sendResult(r: SimResult, title: string): Promise<{ ok: boolean; text: string } | null> {
  if (import.meta.env.VITE_STANDALONE) return null;
  const user = loadAuth();
  if (!user) return { ok: false, text: "Войдите в БАС Арену учеником — выполненные миссии будут приносить XP" };
  if (user.role !== "student") return null;
  try {
    const res = await fetch(`${BAS_API}?action=sim`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Token": user.token },
      body: JSON.stringify({ mission_id: r.missionId, mission_title: title, success: r.success, score: r.score, stars: r.stars, duration_sec: Math.round(r.time) }),
    });
    const d = await res.json();
    if (!res.ok) return { ok: false, text: d.error ?? "Не удалось отправить результат в БАС Арену" };
    if (!d.improved) return { ok: false, text: "Результат записан в журнал. XP — только за улучшение лучшего результата за день" };
    return { ok: true, text: `+${d.xp_earned + (d.bonus_xp ?? 0)} XP в БАС Арене${d.new_achievements?.length ? " · новое достижение!" : ""}` };
  } catch {
    return { ok: false, text: "Нет связи с БАС Ареной — результат не отправлен" };
  }
}

const FAULTS: { id: Fault; label: string; icon: string; key: string }[] = [
  { id: "motor", label: "Отказ мотора", icon: "Fan", key: "1" },
  { id: "gps", label: "Потеря GPS", icon: "SatelliteDish", key: "2" },
  { id: "link", label: "Глушение пульта 15 с", icon: "WifiOff", key: "3" },
  { id: "gust", label: "Порыв ветра", icon: "Wind", key: "4" },
  { id: "battery", label: "Просадка АКБ", icon: "BatteryWarning", key: "5" },
  { id: "clear", label: "Сбросить отказы", icon: "RotateCcw", key: "0" },
];

/** Индикатор качества радиоканала: четыре столбика. */
function LinkBars({ q }: { q: number }) {
  const n = q > 0.75 ? 4 : q > 0.5 ? 3 : q > 0.3 ? 2 : q > 0.08 ? 1 : 0;
  const c = n >= 3 ? "#00ffaa" : n === 2 ? "#ffd700" : "#ff4444";
  return (
    <span className="inline-flex items-end gap-[2px] h-3">
      {[0, 1, 2, 3].map((i) => <span key={i} className="w-[3px] rounded-sm" style={{ height: 4 + i * 2.5, background: i < n ? c : "rgba(255,255,255,0.18)" }} />)}
    </span>
  );
}

function Flight({ mission, af, difficulty, quality, flightMode, camMode, input, livery, failures, onExit, onRestart }: {
  mission: MissionDef; af: Airframe; difficulty: Difficulty; quality: Quality; flightMode: FlightMode; camMode: CamMode; input: InputConfig; livery: string; failures: boolean;
  onExit: () => void; onRestart: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const horizon = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SimEngine | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [xpNote, setXpNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const [instr, setInstr] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const toastId = useRef(0);
  const submitToArena = (r: SimResult) => { sendResult(r, mission.title).then(setXpNote); };

  useEffect(() => {
    let e: SimEngine | null = null, alive = true;
    // даём экрану загрузки отрисоваться, потом строим мир (это занимает пару секунд)
    const timer = setTimeout(async () => {
     // 3D-модели (люди, дома, техника) грузим до постройки мира; их отсутствие не мешает полёту
     await loadModels().catch(() => undefined);
     if (!alive) return;
     try {
      e = new SimEngine({
        canvas: canvas.current!, mapCanvas: map.current!, horizonCanvas: horizon.current!, mission, airframe: af, difficulty, quality, flightMode, camMode, input, livery, failures,
        onHud: setHud,
        onSay: (text, kind) => {
          const id = ++toastId.current;
          setToasts((t) => [...t.slice(-2), { id, text, kind }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
        },
        onEnd: (r) => { if (r.success) { saveBest(mission.id, r); submitToArena(r); } setResult(r); },
      });
     } catch (err) {
      setError(err instanceof Error ? err.message : "WebGL недоступен");
      setLoading(false);
      return;
     }
     engine.current = e;
     // экран загрузки держим, пока не придут текстуры и HDR (но не дольше 15 с)
     Promise.race([e.ready, new Promise((r) => setTimeout(r, 15000))]).then(() => { if (alive) setLoading(false); });
    }, 80);
    return () => { alive = false; clearTimeout(timer); e?.dispose(); engine.current = null; };
    // режим и камера нужны только при старте, дальше ими управляет движок
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, af, difficulty, quality]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === "Escape") setPaused((p) => !p);
      if (ev.code === "KeyI") setInstr((v) => !v);
      if (ev.shiftKey && /^Digit[0-5]$/.test(ev.code)) {
        const f = FAULTS.find((x) => x.key === ev.code.slice(5));
        if (f) engine.current?.instructor(f.id);
      }
    };
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
      {loading && <Loading mission={mission} />}
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
          {hud && (
            <div className="mt-3 pt-3 space-y-2 border-t border-white/10">
              <Segmented label="КАМЕРА" keyHint="C" items={CAMS.map((c) => [c, CAM_LABEL[c]])} value={hud.camId} color="#00ffaa"
                onPick={(c) => engine.current?.setCam(c as CamMode)} />
              <Segmented label="РЕЖИМ" keyHint="M" items={MODES.map((m) => [m, MODE_LABEL[m]])} value={hud.rth ? "" : hud.modeId} color="#ffd700"
                onPick={(m) => engine.current?.setMode(m as FlightMode)} />
              <div className="text-[11px] leading-tight text-gray-400">
                {hud.rth ? "Автовозврат: ручки отменяют" : MODE_HINT[hud.modeId]}
                {hud.manual && !hud.rth && <span className="block text-[#ffd700]">Газ ручной: W/S, отпустил — тяга висения</span>}
              </div>
            </div>
          )}
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

        {/* счётчик кадров и текущее разрешение рендера */}
        {hud && hud.fps > 0 && (
          <div className="absolute font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ top: 12 + hud.mapSize + 2, right: 14, background: "rgba(0,0,0,0.45)",
            color: hud.fps >= 50 ? "#00ffaa" : hud.fps >= 30 ? "#ffd700" : "#ff5555", transform: hud.pip ? `translateY(${hud.pipRect.h + 10}px)` : undefined }}>
            {Math.round(hud.fps)} FPS · {Math.round(hud.res * 100)}%
          </div>
        )}
        {hud && (
          <div className="absolute font-mono text-[11px] px-1.5 py-0.5 rounded flex items-center gap-2" style={{ top: 12 + hud.mapSize + 22, right: 14, background: "rgba(0,0,0,0.45)",
            transform: hud.pip ? `translateY(${hud.pipRect.h + 10}px)` : undefined }}>
            <span className="flex items-center gap-1" style={{ color: hud.gpsSats ? "#c8ced8" : "#ff5555" }}><Icon name="Satellite" size={11} />{hud.gpsSats ? hud.gpsSats : "НЕТ"}</span>
            <span className="flex items-center gap-1 text-[#c8ced8]">RC <LinkBars q={hud.link} /></span>
          </div>
        )}

        {/* failsafe */}
        {hud?.failsafe && (
          <div className="absolute left-1/2 top-[30%] -translate-x-1/2 font-orbitron font-black text-lg sm:text-2xl px-5 py-2 rounded-lg animate-pulse text-center"
            style={{ background: "rgba(120,0,0,0.55)", border: "2px solid #ff4444", color: "#ffdddd" }}>
            {hud.failsafe}
          </div>
        )}

        {/* панель инструктора */}
        <div className="absolute pointer-events-auto" style={touch ? { bottom: 158, right: 64 } : { bottom: 62, right: 12 }}>
          {instr ? (
            <div className="rounded-xl p-2.5 w-[220px]" style={panel}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-orbitron text-[11px] font-bold text-[#ffd166]">ИНСТРУКТОР</span>
                <button onClick={() => setInstr(false)} className="text-gray-400 hover:text-white" aria-label="Закрыть панель инструктора"><Icon name="X" size={14} /></button>
              </div>
              <div className="space-y-1">
                {FAULTS.map((f) => (
                  <button key={f.id} onClick={() => engine.current?.instructor(f.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-white/10"
                    style={{ color: f.id === "clear" ? "#9ee7c9" : "#e5e7eb", background: "rgba(255,255,255,0.04)" }}>
                    <Icon name={f.icon} size={14} />
                    <span className="flex-1">{f.label}</span>
                    {!touch && <span className="text-[10px] font-mono text-gray-500">⇧{f.key}</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button onClick={() => setInstr(true)} title="Панель инструктора (I)" className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-orbitron font-bold text-[#ffd166]" style={panel}>
              <Icon name="ClipboardList" size={14} />{touch ? "" : "ИНСТРУКТОР · I"}
            </button>
          )}
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
          {btn("Тепловизор (T)", "Thermometer", "thermal", hud?.thermal)}
          {btn("Окно камеры (V)", "PictureInPicture2", "pip", hud?.pip)}
          {btn("Автовозврат (H)", "Home", "rth", hud?.rth)}
          {btn("Звук (N)", "Volume2", "mute")}
        </div>

        {hud?.camId === "fpv" && <FpvOsd hud={hud} />}

        {/* телеметрия */}
        <div className={`absolute left-1/2${hud?.camId === "fpv" ? " hidden" : ""} -translate-x-1/2 rounded-xl flex items-center py-1.5 px-2 max-w-[calc(100vw-16px)]`}
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
        <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto" style={{ background: "rgba(0,0,0,0.65)" }}>
          <div className="rounded-2xl p-6 w-[920px] max-w-full my-auto text-center animate-fade-in grid lg:grid-cols-[300px_minmax(0,1fr)] gap-6" style={{ ...panel, background: "rgba(10,13,22,0.96)", borderColor: result.success ? "#00ffaa66" : "#ff444466" }}>
           <div>
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
            {xpNote && <div className="mt-3 text-sm rounded-lg px-3 py-2" style={{ background: xpNote.ok ? "#00ffaa14" : "#ffffff0a", color: xpNote.ok ? "#00ffaa" : "#9aa3b2" }}>{xpNote.text}</div>}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={onRestart} className="py-3 rounded-lg font-orbitron font-bold text-sm" style={{ background: "#00ffaa", color: "#0a0d16" }}>ЕЩЁ РАЗ</button>
              <button onClick={onExit} className="py-3 rounded-lg font-orbitron text-sm text-white" style={{ background: "#ffffff14" }}>МИССИИ</button>
            </div>
           </div>
           <div className="min-w-0">
            <div className="font-orbitron text-xs text-gray-400 mb-3 text-left">РАЗБОР ПОЛЁТА</div>
            <Debrief log={result.log} time={result.time} />
           </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── страница ───────────────────────────

export default function Simulator() {
  const [settings, setSettings] = useState<LaunchSettings>(() => ({
    mission: "training", af: "quad", diff: "pilot", quality: loadQuality(), fmode: "POS", cam: "chase", input: loadInput(), livery: "auto", weather: "scenario", failures: false,
  }));
  const [run, setRun] = useState(0);
  const [best, setBest] = useState<Best>(loadBest);
  useEffect(() => { document.title = "БАС Симулятор — миссии беспилотников"; }, []);
  const mission = useMemo(() => withWeather(findMission(settings.mission), settings.weather), [settings.mission, settings.weather]);
  if (!run) return <Launcher initial={settings} best={best} onStart={(st) => { setSettings(st); setRun(1); }} />;
  return (
    <Flight key={run} mission={mission} af={getAirframe(settings.af)} difficulty={settings.diff} quality={settings.quality}
      flightMode={settings.fmode} camMode={settings.cam} input={settings.input} livery={settings.livery} failures={settings.failures}
      onExit={() => { setBest(loadBest()); setRun(0); }} onRestart={() => setRun(run + 1)} />
  );
}
