import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import {
  AxisMap, bfRate, firstPad, InputConfig, PRESETS, readAxis, STICK_LABEL, StickChannel, STICKS, switchPos,
} from "@/sim/input";
import { FlightMode, MODE_LABEL } from "@/sim/physics";
import { MODES } from "@/sim/engine";

const ACCENT = "#00ffaa";
const box = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" };

/** Опрос геймпада ~30 раз в секунду для живых индикаторов. */
function usePad() {
  const [pad, setPad] = useState<{ id: string; axes: number[]; buttons: boolean[] } | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      try {
        const p = firstPad();
        setPad(p ? { id: p.id, axes: [...p.axes], buttons: p.buttons.map((b) => b.pressed) } : null);
      } catch {
        setBlocked(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { pad, blocked };
}

function StickBox({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-28 h-28 rounded-xl" style={{ ...box, background: "rgba(0,0,0,0.35)" }}>
        <div className="absolute left-1/2 top-2 bottom-2 w-px bg-white/10" />
        <div className="absolute top-1/2 left-2 right-2 h-px bg-white/10" />
        <div className="absolute w-4 h-4 rounded-full -ml-2 -mt-2" style={{
          left: `${50 + x * 42}%`, top: `${50 - y * 42}%`, background: ACCENT, boxShadow: `0 0 12px ${ACCENT}`,
        }} />
      </div>
      <div className="text-[11px] font-orbitron text-gray-400">{label}</div>
    </div>
  );
}

type Step =
  | { kind: "center" }
  | { kind: "axis"; ch: StickChannel }
  | { kind: "range" }
  | { kind: "recenter" }
  | { kind: "switch" }
  | { kind: "action" };

const STEP_TEXT: Record<StickChannel, string> = {
  throttle: "Газ: плавно двиньте стик газа ВВЕРХ до упора и держите",
  yaw: "Рыскание: двиньте стик рыскания ВПРАВО до упора и держите",
  pitch: "Тангаж: двиньте стик тангажа ВВЕРХ (от себя) до упора и держите",
  roll: "Крен: двиньте стик крена ВПРАВО до упора и держите",
};

/** Мастер назначения осей и калибровки пульта — как в FPV-симуляторах. */
function Wizard({ cfg, onDone, onCancel }: { cfg: InputConfig; onDone: (c: InputConfig) => void; onCancel: () => void }) {
  const steps: Step[] = [
    { kind: "center" }, ...STICKS.map((ch) => ({ kind: "axis", ch }) as Step), { kind: "range" }, { kind: "recenter" }, { kind: "switch" }, { kind: "action" },
  ];
  const [i, setI] = useState(0);
  const [hint, setHint] = useState("");
  const work = useRef<{ base: number[]; axes: Partial<Record<StickChannel, AxisMap>>; min: number[]; max: number[]; hold: number; cand: number; mode: AxisMap | null; act: { b: number | null; a: number | null } }>(
    { base: [], axes: {}, min: [], max: [], hold: 0, cand: -1, mode: null, act: { b: null, a: null } });
  const step = steps[i];
  const next = () => { work.current.hold = 0; work.current.cand = -1; setHint(""); setI((v) => v + 1); };

  useEffect(() => {
    if (i >= steps.length) {
      const w = work.current;
      const axes = { ...cfg.axes };
      for (const ch of STICKS) {
        const a = w.axes[ch];
        if (a) axes[ch] = a;
      }
      onDone({ ...cfg, device: "gamepad", preset: "custom", axes, modeAxis: w.mode, actionButton: w.act.b, actionAxis: w.act.a });
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = firstPad();
      if (!p) { setHint("Пульт не найден: подключите его по USB и пошевелите стиками"); return; }
      const w = work.current, ax = [...p.axes];
      const used = new Set(Object.values(w.axes).map((a) => a!.axis));
      if (step.kind === "axis" || step.kind === "switch") {
        let best = -1, bd = 0;
        ax.forEach((v, k) => {
          if (used.has(k)) return;
          const d = Math.abs(v - (w.base[k] ?? 0));
          if (d > bd) { bd = d; best = k; }
        });
        if (bd > 0.45) {
          w.hold = w.cand === best ? w.hold + 1 : 0;
          w.cand = best;
          setHint(`Обнаружена ось ${best + 1} — держите…`);
          if (w.hold > 25) {
            const inv = ax[best] - (w.base[best] ?? 0) < 0;
            const m: AxisMap = { axis: best, invert: inv, min: -1, max: 1, center: 0 };
            if (step.kind === "axis") w.axes[step.ch] = m;
            else w.mode = { ...m, invert: false };
            next();
          }
        } else { w.hold = 0; setHint(step.kind === "switch" ? "Ждём переключения тумблера…" : "Ждём движения стика…"); }
      } else if (step.kind === "range") {
        ax.forEach((v, k) => { w.min[k] = Math.min(w.min[k] ?? v, v); w.max[k] = Math.max(w.max[k] ?? v, v); });
        const spans = STICKS.map((ch) => { const a = w.axes[ch]!; return (w.max[a.axis] ?? 0) - (w.min[a.axis] ?? 0); });
        setHint(`Ход осей: ${spans.map((s, k) => `${STICK_LABEL[STICKS[k]]} ${Math.round(s * 50)}%`).join(" · ")}`);
      } else if (step.kind === "action") {
        const b = p.buttons.findIndex((x) => x.pressed);
        if (b >= 0) { w.act = { b, a: null }; next(); return; }
        const usedAll = new Set([...used, ...(w.mode ? [w.mode.axis] : [])]);
        const k = ax.findIndex((v, kk) => !usedAll.has(kk) && Math.abs(v - (w.base[kk] ?? 0)) > 0.6);
        if (k >= 0) { w.act = { b: null, a: k }; next(); return; }
        setHint("Ждём нажатия кнопки или тумблера…");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // шаг мастера — единственная зависимость, остальное хранится в ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const capture = () => {
    const p = firstPad();
    if (!p) { setHint("Пульт не найден"); return; }
    const w = work.current;
    if (step.kind === "center") w.base = [...p.axes];
    if (step.kind === "recenter") {
      for (const ch of STICKS) {
        const a = w.axes[ch]!;
        a.min = w.min[a.axis] ?? -1; a.max = w.max[a.axis] ?? 1;
        // газ не самоцентрируется: центр — середина хода
        a.center = ch === "throttle" ? (a.min + a.max) / 2 : p.axes[a.axis];
      }
    }
    next();
  };

  if (!step) return null;
  const title = step.kind === "center" ? "Стики в центр, газ — в середину хода"
    : step.kind === "axis" ? STEP_TEXT[step.ch]
    : step.kind === "range" ? "Покрутите оба стика по кругу до упоров несколько раз"
    : step.kind === "recenter" ? "Отпустите стики в центр, газ — в середину"
    : step.kind === "switch" ? "Переключите тумблер режимов полёта (если есть)"
    : "Нажмите кнопку или тумблер для сброса воды и снимков (если есть)";
  const manual = step.kind === "center" || step.kind === "range" || step.kind === "recenter";
  const skippable = step.kind === "switch" || step.kind === "action";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-[480px] max-w-full rounded-2xl p-6" style={{ background: "#0d121b", border: `1px solid ${ACCENT}55` }}>
        <div className="flex justify-between items-center">
          <div className="font-orbitron text-xs" style={{ color: ACCENT }}>КАЛИБРОВКА · ШАГ {i + 1}/{steps.length}</div>
          <button onClick={onCancel} className="text-gray-400 hover:text-white"><Icon name="X" size={18} /></button>
        </div>
        <div className="h-1 rounded bg-white/10 mt-3"><div className="h-1 rounded" style={{ width: `${(i / steps.length) * 100}%`, background: ACCENT }} /></div>
        <div className="font-rajdhani text-xl text-white mt-5 leading-snug">{title}</div>
        <div className="text-sm text-gray-400 mt-2 min-h-[20px]">{hint}</div>
        <div className="flex gap-2 mt-6 justify-end">
          {skippable && <button onClick={next} className="px-4 py-2 rounded-lg font-orbitron text-xs text-gray-300" style={{ background: "#ffffff10" }}>ПРОПУСТИТЬ</button>}
          {manual && <button onClick={capture} className="px-5 py-2 rounded-lg font-orbitron text-xs font-bold" style={{ background: ACCENT, color: "#0a0d16" }}>ДАЛЕЕ</button>}
        </div>
      </div>
    </div>
  );
}

function RateCurve({ rates }: { rates: InputConfig["rates"] }) {
  const pts: string[] = [];
  const max = bfRate(1, rates);
  const top = Math.max(400, Math.ceil(max / 200) * 200);
  for (let k = 0; k <= 40; k++) {
    const x = k / 40;
    pts.push(`${(x * 200).toFixed(1)},${(120 - (bfRate(x, rates) / top) * 110).toFixed(1)}`);
  }
  return (
    <svg viewBox="-34 -4 244 140" className="w-full" style={{ maxWidth: 320 }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={0} x2={200} y1={120 - f * 110} y2={120 - f * 110} stroke="rgba(255,255,255,0.08)" />
          <text x={-6} y={124 - f * 110} fill="#8a93a3" fontSize={10} textAnchor="end">{Math.round(top * f)}</text>
        </g>
      ))}
      <polyline points={pts.join(" ")} fill="none" stroke={ACCENT} strokeWidth={2.5} />
      <text x={100} y={136} fill="#8a93a3" fontSize={10} textAnchor="middle">отклонение стика → °/с (Acro)</text>
    </svg>
  );
}

function Slider({ id, label, value, min, max, step, onChange, fmt }: {
  id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <label htmlFor={id} className="block">
      <div className="flex justify-between text-sm"><span className="text-gray-300">{label}</span><span className="text-white font-semibold tabular-nums">{fmt ? fmt(value) : value.toFixed(2)}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[#00ffaa]" />
    </label>
  );
}

export default function ControlsSetup({ cfg, onChange }: { cfg: InputConfig; onChange: (c: InputConfig) => void }) {
  const { pad, blocked } = usePad();
  const [wizard, setWizard] = useState(false);
  const live = (() => {
    const p = firstPad();
    if (!p || cfg.device !== "gamepad") return null;
    const r = (ch: StickChannel) => readAxis(p, cfg.axes[ch], cfg.deadband);
    return { t: r("throttle"), y: r("yaw"), p: r("pitch"), r: r("roll"), sw: cfg.modeAxis ? switchPos(p, cfg.modeAxis) : -1 };
  })();
  void pad; // перерисовка по опросу геймпада
  const set = (patch: Partial<InputConfig>) => onChange({ ...cfg, ...patch });
  const setAxis = (ch: StickChannel, patch: Partial<AxisMap>) => set({ axes: { ...cfg.axes, [ch]: { ...cfg.axes[ch], ...patch } } });
  const axisCount = Math.max(6, pad?.axes.length ?? 0);

  return (
    <div className="space-y-5">
      {wizard && <Wizard cfg={cfg} onCancel={() => setWizard(false)} onDone={(c) => { onChange(c); setWizard(false); }} />}

      <div className="grid sm:grid-cols-2 gap-3">
        {([["keyboard", "Keyboard", "Клавиатура", "W/S газ, A/D рыскание, стрелки — крен и тангаж"],
          ["gamepad", "Gamepad2", "Пульт или геймпад", "RC-пульт по USB (EdgeTX, OpenTX), Xbox, PlayStation"]] as const).map(([id, icon, title, hint]) => (
          <button key={id} onClick={() => set({ device: id })} className="rounded-xl p-4 text-left transition-all flex gap-3"
            style={{ ...box, borderColor: cfg.device === id ? ACCENT : "rgba(255,255,255,0.08)", background: cfg.device === id ? `${ACCENT}10` : box.background }}>
            <Icon name={icon} size={26} style={{ color: cfg.device === id ? ACCENT : "#888" }} />
            <div>
              <div className="font-orbitron text-sm font-bold text-white">{title}</div>
              <div className="text-sm text-gray-400 leading-snug">{hint}</div>
            </div>
          </button>
        ))}
      </div>

      {cfg.device === "gamepad" && (
        <>
          <div className="rounded-xl p-4 flex flex-wrap gap-4 items-center" style={box}>
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: pad ? ACCENT : "#ff4444", boxShadow: pad ? `0 0 8px ${ACCENT}` : "none" }} />
                <span className="text-white font-semibold">{pad ? "Устройство подключено" : "Устройство не найдено"}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1 break-all">
                {pad ? pad.id : blocked ? "Браузер не дал доступ к джойстикам на этой странице. Откройте симулятор на сайте целиком." : "Подключите пульт по USB (на пульте выберите «USB Joystick / HID») и пошевелите стиками."}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(PRESETS).map(([id, p]) => (
                  <button key={id} title={p.hint} onClick={() => set({ ...p.make(), preset: id })}
                    className="px-3 py-1.5 rounded-lg font-orbitron text-[11px] font-bold transition-colors"
                    style={{ background: cfg.preset === id ? `${ACCENT}22` : "#ffffff0d", color: cfg.preset === id ? ACCENT : "#bbb", border: `1px solid ${cfg.preset === id ? ACCENT : "transparent"}` }}>
                    {p.label}
                  </button>
                ))}
                <button onClick={() => setWizard(true)} disabled={!pad} className="px-3 py-1.5 rounded-lg font-orbitron text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"
                  style={{ background: ACCENT, color: "#0a0d16" }}>
                  <Icon name="Crosshair" size={12} />МАСТЕР КАЛИБРОВКИ
                </button>
              </div>
              {cfg.preset !== "custom" && PRESETS[cfg.preset] && <div className="text-xs text-gray-500 mt-2">{PRESETS[cfg.preset].hint}</div>}
            </div>
            <div className="flex gap-4">
              <StickBox x={live?.y ?? 0} y={live?.t ?? 0} label="ГАЗ · РЫСКАНИЕ" />
              <StickBox x={live?.r ?? 0} y={live?.p ?? 0} label="ТАНГАЖ · КРЕН" />
            </div>
          </div>

          <div className="rounded-xl p-4 overflow-x-auto" style={box}>
            <div className="font-orbitron text-xs font-bold text-white mb-3">НАЗНАЧЕНИЕ ОСЕЙ</div>
            <table className="w-full text-sm min-w-[460px]">
              <thead><tr className="text-gray-500 text-xs text-left"><th className="pb-2 font-normal">Канал</th><th className="font-normal">Ось</th><th className="font-normal">Инверсия</th><th className="font-normal w-[40%]">Сигнал</th></tr></thead>
              <tbody>
                {STICKS.map((ch) => {
                  const v = live ? { throttle: live.t, yaw: live.y, pitch: live.p, roll: live.r }[ch] : 0;
                  return (
                    <tr key={ch} className="border-t border-white/5">
                      <td className="py-2 text-white">{STICK_LABEL[ch]}</td>
                      <td>
                        <select id={`axis-${ch}`} value={cfg.axes[ch].axis} onChange={(e) => setAxis(ch, { axis: +e.target.value, min: -1, max: 1, center: 0 })}
                          className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white">
                          {Array.from({ length: axisCount }, (_, k) => <option key={k} value={k}>Ось {k + 1}</option>)}
                        </select>
                      </td>
                      <td><input id={`inv-${ch}`} type="checkbox" checked={cfg.axes[ch].invert} onChange={(e) => setAxis(ch, { invert: e.target.checked })} className="accent-[#00ffaa] w-4 h-4" /></td>
                      <td>
                        <div className="relative h-2 rounded bg-white/10">
                          <div className="absolute top-0 h-2 rounded" style={{ left: v < 0 ? `${50 + v * 50}%` : "50%", width: `${Math.abs(v) * 50}%`, background: ACCENT }} />
                          <div className="absolute left-1/2 -top-1 w-px h-4 bg-white/30" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-sm text-gray-300 mb-1">Тумблер режимов</div>
                <select id="mode-axis" value={cfg.modeAxis ? cfg.modeAxis.axis : -1}
                  onChange={(e) => set({ modeAxis: +e.target.value < 0 ? null : { axis: +e.target.value, invert: false, min: -1, max: 1, center: 0 } })}
                  className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-sm">
                  <option value={-1}>не используется</option>
                  {Array.from({ length: axisCount }, (_, k) => <option key={k} value={k}>Ось {k + 1}</option>)}
                </select>
                {cfg.modeAxis && (
                  <div className="grid grid-cols-3 gap-1.5 mt-2">
                    {[0, 1, 2].map((pos) => (
                      <select key={pos} id={`mode-pos-${pos}`} value={cfg.modeMap[pos]}
                        onChange={(e) => { const m = [...cfg.modeMap] as InputConfig["modeMap"]; m[pos] = e.target.value as FlightMode; set({ modeMap: m }); }}
                        className="rounded px-1 py-1 text-xs text-white border"
                        style={{ background: live?.sw === pos ? `${ACCENT}22` : "rgba(0,0,0,0.4)", borderColor: live?.sw === pos ? ACCENT : "rgba(255,255,255,0.1)" }}>
                        {MODES.map((m) => <option key={m} value={m}>{["Вниз", "Центр", "Вверх"][pos]}: {MODE_LABEL[m]}</option>)}
                      </select>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-300 mb-1">Сброс / снимок</div>
                <div className="text-sm text-white">
                  {cfg.actionButton !== null ? `Кнопка ${cfg.actionButton + 1}` : cfg.actionAxis !== null ? `Тумблер на оси ${cfg.actionAxis + 1}` : "Пробел на клавиатуре"}
                </div>
                <div className="text-xs text-gray-500 mt-1">Назначается в мастере калибровки</div>
              </div>
            </div>
            <div className="mt-4 max-w-sm">
              <Slider id="deadband" label="Мёртвая зона стиков" value={cfg.deadband} min={0} max={0.15} step={0.01} onChange={(v) => set({ deadband: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl p-4 grid md:grid-cols-[1fr_auto] gap-6 items-center" style={box}>
        <div className="space-y-3">
          <div className="font-orbitron text-xs font-bold text-white">РЕЙТЫ ACRO <span className="text-gray-500 font-normal">· как в Betaflight</span></div>
          <Slider id="rc-rate" label="RC Rate" value={cfg.rates.rc} min={0.3} max={2.5} step={0.05} onChange={(v) => set({ rates: { ...cfg.rates, rc: v } })} />
          <Slider id="super-rate" label="Super Rate" value={cfg.rates.superRate} min={0} max={0.95} step={0.01} onChange={(v) => set({ rates: { ...cfg.rates, superRate: v } })} />
          <Slider id="expo" label="RC Expo" value={cfg.rates.expo} min={0} max={1} step={0.01} onChange={(v) => set({ rates: { ...cfg.rates, expo: v } })} />
          <div className="text-sm text-gray-400">Максимум: <span className="text-white font-semibold">{Math.round(bfRate(1, cfg.rates))}°/с</span>. Тяжёлые рамы физически крутятся медленнее.</div>
        </div>
        <RateCurve rates={cfg.rates} />
      </div>

      <div className="rounded-xl p-4 space-y-3" style={box}>
        <div className="font-orbitron text-xs font-bold text-white">ЗАЩИТНЫЕ РЕЖИМЫ <span className="text-gray-500 font-normal">· failsafe</span></div>
        <div>
          <div className="text-sm text-gray-300 mb-1.5">При потере связи с пультом дольше 3 с</div>
          <div className="grid grid-cols-3 gap-2">
            {([["rth", "Возврат на базу", "набор высоты возврата и посадка на H; без GPS — посадка"], ["land", "Посадка", "плавное снижение на месте"], ["hover", "Зависание", "20 с ожидания связи, затем посадка"]] as const).map(([id, label, hint]) => (
              <button key={id} onClick={() => set({ failsafe: id })} className="rounded-lg p-2 text-left"
                style={{ background: cfg.failsafe === id ? "#00ffaa14" : "rgba(255,255,255,0.03)", border: `1px solid ${cfg.failsafe === id ? "#00ffaa" : "rgba(255,255,255,0.08)"}` }}>
                <div className="font-orbitron text-xs font-bold" style={{ color: cfg.failsafe === id ? "#00ffaa" : "#ddd" }}>{label}</div>
                <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{hint}</div>
              </button>
            ))}
          </div>
        </div>
        <label htmlFor="lowbat" className="flex items-center gap-2 text-sm text-gray-300">
          <input id="lowbat" type="checkbox" className="accent-[#00ffaa] w-4 h-4" checked={cfg.lowBatRth} onChange={(e) => set({ lowBatRth: e.target.checked })} />
          Автовозврат при заряде 20% (при 7% — принудительная посадка всегда)
        </label>
        <div className="max-w-sm">
          <Slider id="rth-alt" label="Высота возврата" value={cfg.rthAlt} min={20} max={120} step={5} onChange={(v) => set({ rthAlt: v })} fmt={(v) => `${v} м`} />
        </div>
        <div className="text-xs text-gray-500">Дальность связи зависит от расстояния и прямой видимости: холмы и лес между пилотом и аппаратом ослабляют сигнал.</div>
      </div>

      <div className="rounded-xl p-4" style={box}>
        <div className="font-orbitron text-xs font-bold text-white mb-3">КЛАВИАТУРА</div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-gray-400">
          {[["W / S", "газ / набор и снижение"], ["A / D", "рыскание"], ["↑ ↓ ← →", "тангаж и крен"], ["Пробел", "сброс воды, набора, снимок"],
            ["C", "камера: сзади / FPV / с земли / сверху"], ["M", "режим: GPS / ATTI / Angle / Acro"], ["T", "тепловизор"], ["V / G", "окно подвеса / наклон подвеса"],
            ["H", "автовозврат на базу"], ["L", "автопосадка (стиками — на площадку)"], ["N", "звук"], ["I", "панель инструктора"], ["Shift + 1…5", "ввести отказ (0 — сброс)"], ["Esc", "пауза"]].map(([k, v]) => (
            <div key={k} className="flex gap-3"><kbd className="px-1.5 rounded text-white text-xs font-mono shrink-0 text-center" style={{ background: "#ffffff14", minWidth: 70, lineHeight: "20px" }}>{k}</kbd><span>{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
