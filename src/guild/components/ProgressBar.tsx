import { useState } from "react";

import Icon from "@/components/ui/icon";

import type { BarColor } from "../types";

const TRACK_COLORS: Record<BarColor, { fill: string; glow: string; label: string }> = {
  green: { fill: "#3ddc97", glow: "rgba(61,220,151,0.45)", label: "🟢" },
  yellow: { fill: "#e8c56a", glow: "rgba(232,197,106,0.45)", label: "🟡" },
  red: { fill: "#e2603f", glow: "rgba(226,96,63,0.45)", label: "🔴" },
};

export interface ProgressBarProps {
  label: string;
  value: number;
  max: number;
  color: BarColor;
  /** Подпись под шкалой — раскрывается по тапу на телефоне. */
  hint?: string;
  /** Иконка достигнутого бонуса, справа от шкалы. */
  bonusIcon?: string;
  bonusTitle?: string;
  /** Броня на нуле: «истекает кровью» — красная рамка вокруг всей шкалы. */
  bleeding?: boolean;
  /** Мигание в зоне 65–75%. */
  blink?: boolean;
  /** Сколько клеток рисовать. По умолчанию — 14, как в макете ТЗ. */
  cells?: number;
}

/**
 * Шкала Карты героя.
 *
 * Нарочно клеточная, а не гладкая: ребёнку важно видеть, что до следующего
 * деления осталось «два квадратика», а не «семь процентов».
 */
export function ProgressBar({
  label, value, max, color, hint, bonusIcon, bonusTitle,
  bleeding = false, blink = false, cells,
}: ProgressBarProps) {
  const [open, setOpen] = useState(false);
  const safeMax = Math.max(1, max);
  const clamped = Math.max(0, Math.min(value, safeMax));
  // Шкалы на 5 и 10 делений рисуем один-в-один; длинные ужимаем до 14 клеток.
  const total = cells ?? (safeMax <= 14 ? safeMax : 14);
  const filled = Math.round((clamped / safeMax) * total);
  const tone = TRACK_COLORS[color];
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div
      className="rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: bleeding ? "2px solid #e2603f" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: bleeding ? "0 0 18px rgba(226,96,63,0.35)" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left"
      >
        <span
          className="font-orbitron text-[10px] tracking-[0.16em] shrink-0 w-[78px]"
          style={{ color: "#9db3a6" }}
        >
          {label}
        </span>

        <span className={`flex gap-[3px] flex-1 ${blink ? "guild-blink" : ""}`} aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className="h-3 flex-1 rounded-[2px] transition-all duration-500"
              style={{
                background: i < filled ? tone.fill : "rgba(255,255,255,0.08)",
                boxShadow: i < filled ? `0 0 6px ${tone.glow}` : "none",
              }}
            />
          ))}
        </span>

        <span
          className="font-orbitron text-[11px] tabular-nums shrink-0 w-[58px] text-right"
          style={{ color: tone.fill }}
        >
          {clamped}/{safeMax}
        </span>

        {bonusIcon && (
          <span title={bonusTitle} className="shrink-0">
            <Icon name={bonusIcon} size={14} style={{ color: "#e8c56a" }} />
          </span>
        )}
      </button>

      {hint && (
        <div
          className="overflow-hidden transition-all duration-200 font-rajdhani text-xs"
          style={{
            maxHeight: open ? 60 : 0,
            opacity: open ? 1 : 0,
            color: "#7f9488",
            marginTop: open ? 6 : 0,
          }}
        >
          {hint} · {percent}% {tone.label}
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
