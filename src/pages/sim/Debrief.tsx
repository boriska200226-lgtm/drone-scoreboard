import Icon from "@/components/ui/icon";
import type { FlightLog, FlightSample } from "@/sim/engine";

const ACCENT = "#00ffaa";
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Трек полёта сверху: цвет линии — высота (низко — бирюзовый, высоко — жёлтый, выше 150 м — красный). */
function TrackMap({ log }: { log: FlightLog }) {
  const pts = log.samples;
  if (pts.length < 2) return <div className="h-full flex items-center justify-center text-sm text-gray-500">Трек слишком короткий</div>;
  let x0 = Math.min(log.base.x, ...pts.map((p) => p.x)), x1 = Math.max(log.base.x, ...pts.map((p) => p.x));
  let z0 = Math.min(log.base.z, ...pts.map((p) => p.z)), z1 = Math.max(log.base.z, ...pts.map((p) => p.z));
  const span = Math.max(60, x1 - x0, z1 - z0) * 1.12;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  x0 = cx - span / 2; x1 = cx + span / 2; z0 = cz - span / 2; z1 = cz + span / 2;
  const S = 260;
  const X = (x: number) => ((x - x0) / (x1 - x0)) * S, Y = (z: number) => ((z - z0) / (z1 - z0)) * S;
  const col = (a: number) => (a > 150 ? "#ff4d4d" : a > 60 ? "#ffd166" : a > 20 ? "#7dd3fc" : ACCENT);
  // масштабная линейка: круглое число метров ~ четверть карты
  const raw = span / 4, pow = 10 ** Math.floor(Math.log10(raw)), bar = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= raw * 0.7) ?? raw;
  return (
    <svg viewBox={`-6 -6 ${S + 12} ${S + 12}`} className="w-full h-full" role="img" aria-label="Трек полёта">
      <rect x={-6} y={-6} width={S + 12} height={S + 12} rx={10} fill="rgba(255,255,255,0.03)" />
      {[0.25, 0.5, 0.75].map((f) => (
        <g key={f} stroke="rgba(255,255,255,0.06)">
          <line x1={f * S} x2={f * S} y1={0} y2={S} /><line y1={f * S} y2={f * S} x1={0} x2={S} />
        </g>
      ))}
      {pts.slice(1).map((p, i) => (
        <line key={i} x1={X(pts[i].x)} y1={Y(pts[i].z)} x2={X(p.x)} y2={Y(p.z)} stroke={col(p.agl)} strokeWidth={2.4} strokeLinecap="round" />
      ))}
      <circle cx={X(log.base.x)} cy={Y(log.base.z)} r={7} fill="#fff" />
      <text x={X(log.base.x)} y={Y(log.base.z) + 3.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#0a0d16">H</text>
      <circle cx={X(pts[pts.length - 1].x)} cy={Y(pts[pts.length - 1].z)} r={4} fill="none" stroke="#fff" strokeWidth={2} />
      <line x1={8} x2={8 + (bar / span) * S} y1={S - 8} y2={S - 8} stroke="#c8ced8" strokeWidth={2} />
      <text x={8} y={S - 13} fontSize={9} fill="#c8ced8">{bar >= 1000 ? `${bar / 1000} км` : `${bar} м`}</text>
      <text x={S / 2} y={10} fontSize={9} fill="#8a93a3" textAnchor="middle">С</text>
    </svg>
  );
}

/** Мини-график одной величины по времени с подписью максимума. */
function Spark({ label, unit, pts, get, color, max, warnAt }: {
  label: string; unit: string; pts: FlightSample[]; get: (p: FlightSample) => number; color: string; max?: number; warnAt?: number;
}) {
  const W = 300, H = 56;
  const vals = pts.map(get);
  const top = max ?? Math.max(1, ...vals) * 1.1;
  const T = Math.max(1, pts[pts.length - 1]?.t ?? 1);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${((p.t / T) * W).toFixed(1)},${(H - (vals[i] / top) * H).toFixed(1)}`).join(" ");
  const last = vals[vals.length - 1] ?? 0, peak = vals.length ? Math.max(...vals) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-gray-400">{label}</span>
        <span className="text-gray-300 tabular-nums">макс. {peak.toFixed(unit === "%" ? 0 : 1)} {unit} · сейчас {last.toFixed(unit === "%" ? 0 : 1)} {unit}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 mt-0.5" preserveAspectRatio="none" role="img" aria-label={label}>
        <rect width={W} height={H} rx={4} fill="rgba(255,255,255,0.03)" />
        {warnAt !== undefined && warnAt < top && <line x1={0} x2={W} y1={H - (warnAt / top) * H} y2={H - (warnAt / top) * H} stroke="#ff4d4d" strokeDasharray="4 3" strokeWidth={1} />}
        {path && <path d={`${path} L${W},${H} L0,${H} Z`} fill={`${color}22`} />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

export default function Debrief({ log, time }: { log: FlightLog; time: number }) {
  const stats: [string, string, boolean][] = [
    ["Налёт", fmt(time), false],
    ["Дистанция", log.distance > 1000 ? `${(log.distance / 1000).toFixed(2)} км` : `${Math.round(log.distance)} м`, false],
    ["Макс. высота", `${Math.round(log.maxAgl)} м`, log.maxAgl > 150],
    ["Макс. скорость", `${(log.maxSpeed * 3.6).toFixed(0)} км/ч`, false],
    ["Энергия", `${log.energyWh} Вт·ч`, false],
    ["Жёсткие посадки", String(log.hardLandings), log.hardLandings > 0],
  ];
  const rules = [
    { ok: log.over150 === 0, text: log.over150 ? `Выше 150 м без разрешения: ${Math.round(log.over150)} с` : "Высота не выше 150 м" },
    { ok: log.beyondVlos === 0, text: log.beyondVlos ? `Дальше 2 км от пилота (вне прямой видимости): ${Math.round(log.beyondVlos)} с` : "В пределах прямой видимости" },
    { ok: log.hardLandings === 0, text: log.hardLandings ? `Жёстких посадок: ${log.hardLandings}` : "Посадки мягкие" },
  ];
  return (
    <div className="grid md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-4 text-left">
      <div className="aspect-square w-full max-w-[260px] mx-auto"><TrackMap log={log} /></div>
      <div className="space-y-2 min-w-0">
        <Spark label="Высота над землёй" unit="м" pts={log.samples} get={(p) => p.agl} color="#7dd3fc" warnAt={150} />
        <Spark label="Скорость" unit="км/ч" pts={log.samples} get={(p) => p.spd * 3.6} color="#ffd166" />
        <Spark label="Заряд батареи" unit="%" pts={log.samples} get={(p) => p.soc * 100} color={ACCENT} max={100} warnAt={20} />
      </div>
      <div className="md:col-span-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {stats.map(([k, v, bad]) => (
          <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${bad ? "#ff4d4d66" : "transparent"}` }}>
            <div className="text-[10px] font-orbitron text-gray-500 leading-tight">{k.toUpperCase()}</div>
            <div className="text-sm font-semibold tabular-nums" style={{ color: bad ? "#ff8080" : "#fff" }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="md:col-span-2 grid sm:grid-cols-2 gap-3">
        <div>
          <div className="font-orbitron text-[11px] text-gray-400 mb-1">ПРАВИЛА ПОЛЁТОВ</div>
          {rules.map((r) => (
            <div key={r.text} className="flex items-start gap-1.5 text-sm" style={{ color: r.ok ? "#9ee7c9" : "#ff9a9a" }}>
              <Icon name={r.ok ? "CheckCircle2" : "AlertTriangle"} size={14} className="mt-0.5 shrink-0" />{r.text}
            </div>
          ))}
        </div>
        <div>
          <div className="font-orbitron text-[11px] text-gray-400 mb-1">ЗАМЕЧАНИЯ ИНСТРУКТОРА</div>
          {log.remarks.length === 0 && <div className="text-sm text-gray-400">Замечаний нет — чистый полёт.</div>}
          {log.remarks.slice(0, 5).map(([t, n]) => (
            <div key={t} className="text-sm text-gray-300 leading-snug">
              <span className="text-[#ffd166] font-semibold tabular-nums">{n > 1 ? `×${n} ` : "• "}</span>{t.replace(/N/g, "…")}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
