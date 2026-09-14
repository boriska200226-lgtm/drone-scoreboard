import { useState } from "react";

import Icon from "@/components/ui/icon";

import { BAR_COLOR } from "../theme";
import type { BarColor } from "../types";
import { useCountUp, usePrevious } from "../useCountUp";

export interface ProgressBarProps {
  label: string;
  value: number;
  max: number;
  color: BarColor;
  /** Подпись — раскрывается по тапу на телефоне. */
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
  icon?: string;
}

/**
 * Шкала Карты героя.
 *
 * Нарочно клеточная, а не гладкая: ребёнку важно видеть, что до следующего
 * деления осталось «два квадратика», а не «семь процентов». Клетки, которые
 * только что зажглись, коротко подпрыгивают — это и есть награда.
 */
export function ProgressBar({
  label, value, max, color, hint, bonusIcon, bonusTitle,
  bleeding = false, blink = false, cells, icon,
}: ProgressBarProps) {
  const [open, setOpen] = useState(false);
  const safeMax = Math.max(1, max);
  const clamped = Math.max(0, Math.min(value, safeMax));
  // Шкалы на 5 и 10 делений рисуем один-в-один; длинные ужимаем до 14 клеток.
  const total = cells ?? (safeMax <= 14 ? safeMax : 14);
  const filled = Math.round((clamped / safeMax) * total);
  const previousFilled = usePrevious(filled) ?? filled;
  const shown = useCountUp(clamped);
  const tone = BAR_COLOR[color];
  const percent = Math.round((clamped / safeMax) * 100);
  const full = percent >= 80;

  return (
    <div
      className="rounded-xl px-3 py-2.5 transition-all duration-300"
      style={{
        background: bleeding
          ? "linear-gradient(100deg, rgba(255,59,48,0.14), rgba(255,255,255,0.03))"
          : "rgba(255,255,255,0.035)",
        border: bleeding ? "1.5px solid #ff3b30" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: bleeding ? "0 0 22px rgba(255,59,48,0.28)" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 text-left"
      >
        {icon && (
          <Icon name={icon} size={14} style={{ color: tone, flexShrink: 0 }} />
        )}
        <span
          className="font-orbitron text-[10px] tracking-[0.14em] shrink-0"
          style={{ color: "#93ab9f", width: icon ? 64 : 78 }}
        >
          {label}
        </span>

        <span className={`flex gap-[3px] flex-1 min-w-0 ${blink ? "guild-blink" : ""}`} aria-hidden>
          {Array.from({ length: total }, (_, i) => {
            const lit = i < filled;
            const justLit = lit && i >= previousFilled;
            return (
              <span
                key={i}
                className={`relative h-3.5 flex-1 rounded-[3px] overflow-hidden transition-all duration-500 ${
                  justLit ? "guild-cell-new" : ""
                } ${full && lit ? "guild-sheen" : ""}`}
                style={{
                  background: lit
                    ? `linear-gradient(180deg, ${tone}, ${tone}bb)`
                    : "rgba(255,255,255,0.07)",
                  boxShadow: lit ? `0 0 8px ${tone}66, inset 0 1px 0 rgba(255,255,255,0.4)` : "none",
                  animationDelay: justLit ? `${(i - previousFilled) * 60}ms` : undefined,
                }}
              />
            );
          })}
        </span>

        <span
          className="font-orbitron text-[11px] tabular-nums shrink-0 text-right"
          style={{ color: tone, width: 56 }}
        >
          {shown}<span style={{ opacity: 0.45 }}>/{safeMax}</span>
        </span>

        {bonusIcon && (
          <span title={bonusTitle} className="shrink-0 rounded-full p-1 guild-halo"
                style={{ background: "rgba(240,198,97,0.14)" }}>
            <Icon name={bonusIcon} size={13} style={{ color: "#f0c661" }} />
          </span>
        )}
      </button>

      {hint && (
        <div
          className="overflow-hidden transition-all duration-300 font-rajdhani text-xs"
          style={{
            maxHeight: open ? 60 : 0,
            opacity: open ? 1 : 0,
            color: "#7f9488",
            marginTop: open ? 6 : 0,
          }}
        >
          {hint} · {percent}%
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
