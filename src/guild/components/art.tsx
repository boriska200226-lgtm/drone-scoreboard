import { useId } from "react";

import type { BranchId, Shield } from "../types";
import { BRANCH_THEME, MEDALS, SHIELD_THEME, avatarOf, rankOf } from "../theme";

/**
 * Рисованная часть «Гильдии».
 *
 * Всё здесь — inline-SVG, а не картинки и не эмодзи: герб должен краситься
 * в цвет своей ветки, щит — показывать реальный запас Брони, а Древо —
 * расти вместе с классом. Ни одного файла с диска по дороге не грузится.
 */


/** Кронштейны по углам панели — самый дешёвый способ сказать «это HUD». */
export function HudCorners() {
  return (
    <>
      <span className="guild-corner guild-corner-tl" aria-hidden />
      <span className="guild-corner guild-corner-tr" aria-hidden />
      <span className="guild-corner guild-corner-bl" aria-hidden />
      <span className="guild-corner guild-corner-br" aria-hidden />
    </>
  );
}

/**
 * Радиальная шкала.
 *
 * Полоска говорит «сколько», кольцо — «насколько близко». Для Древа нужен
 * второй вариант: цифра в центре кольца читается через весь класс.
 */
export function RadialGauge({ percent, color, size = 132, thickness = 9, ticks = 24, children }: {
  percent: number;
  color: string;
  size?: number;
  thickness?: number;
  ticks?: number;
  children?: React.ReactNode;
}) {
  const id = useId();
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - thickness) / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const dash = (p / 100) * circumference;

  return (
    <span className="relative inline-flex items-center justify-center shrink-0"
          style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="45%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* Насечки по кругу — шкала прибора, а не просто кольцо */}
        <g stroke="rgba(143,163,200,0.28)" strokeWidth="1.5" strokeLinecap="round">
          {Array.from({ length: ticks }, (_, i) => {
            const a = (i / ticks) * Math.PI * 2;
            const inner = r + thickness / 2 + 2;
            const outer = inner + (i % 6 === 0 ? 6 : 3);
            const cx = size / 2;
            const cy = size / 2;
            const lit = (i / ticks) * 100 <= p;
            return (
              <line key={i}
                    x1={cx + Math.cos(a) * inner} y1={cy + Math.sin(a) * inner}
                    x2={cx + Math.cos(a) * outer} y2={cy + Math.sin(a) * outer}
                    stroke={lit ? color : "rgba(143,163,200,0.22)"}
                    opacity={lit ? 0.85 : 1} />
            );
          })}
        </g>

        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="rgba(143,163,200,0.16)" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={`url(#${id}-g)`} strokeWidth={thickness} strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference}`}
                style={{ filter: `drop-shadow(0 0 10px ${color})`,
                         transition: "stroke-dasharray 1s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <span className="relative flex flex-col items-center justify-center leading-none">
        {children}
      </span>
    </span>
  );
}

// ─── Гербы веток ──────────────────────────────────────────────────────────────
function TacticsSigil() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
       strokeLinejoin="round">
      <path d="M5.5 4.5 L17 16" />
      <path d="M18.5 4.5 L7 16" />
      <path d="M4.5 17.5 L7.8 14.2" />
      <path d="M19.5 17.5 L16.2 14.2" />
      <circle cx="17.6" cy="18.6" r="1.5" />
      <circle cx="6.4" cy="18.6" r="1.5" />
    </g>
  );
}

function DiplomacySigil() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
       strokeLinejoin="round">
      <path d="M4 20 C 9 17.5, 14.5 12.5, 19 4" />
      <path d="M8.4 15.6 C 7 13.6, 8 11.4, 10.4 11.2 C 10.8 13.4, 10.2 15.2, 8.4 15.6 Z" />
      <path d="M12.4 11.2 C 11.4 9, 12.8 6.9, 15.2 7 C 15.2 9.3, 14.3 10.9, 12.4 11.2 Z" />
      <path d="M11.6 16.2 C 12.6 14.6, 14.8 14.4, 16.2 15.6 C 14.9 17.2, 13.1 17.4, 11.6 16.2 Z" />
    </g>
  );
}

function KeeperSigil() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
       strokeLinejoin="round">
      <path d="M12 3 L19 6 v5.2 C 19 15.8, 16 19.2, 12 21 C 8 19.2, 5 15.8, 5 11.2 V6 Z" />
      <path d="M12 8.2 v6" />
      <path d="M9.4 10.6 h5.2" />
    </g>
  );
}

const SIGILS: Record<BranchId, () => JSX.Element> = {
  tactics: TacticsSigil,
  diplomacy: DiplomacySigil,
  keeper: KeeperSigil,
};

export function BranchSigil({ branch, size = 20, color }: {
  branch: BranchId;
  size?: number;
  color?: string;
}) {
  const Sigil = SIGILS[branch];
  const tone = color ?? BRANCH_THEME[branch].color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden
         style={{ color: tone, flexShrink: 0, filter: `drop-shadow(0 0 5px ${tone})` }}>
      <Sigil />
    </svg>
  );
}

// ─── Щит Брони ────────────────────────────────────────────────────────────────
const SHIELD_PATH = "M12 2.5 L20 6 v5.6 C20 16.6 16.6 20.4 12 22.4 C7.4 20.4 4 16.6 4 11.6 V6 Z";

/** Щит, залитый снизу вверх на долю оставшейся Брони. */
export function ShieldBadge({ shield, armor, max = 10, size = 26 }: {
  shield: Shield;
  armor: number;
  max?: number;
  size?: number;
}) {
  const id = useId();
  const tone = SHIELD_THEME[shield];
  const ratio = Math.max(0, Math.min(1, armor / Math.max(1, max)));
  const fillTop = 22.4 - 19.9 * ratio;

  return (
    <svg width={size} height={size} viewBox="0 0 24 25" role="img"
         aria-label={`${tone.label}: ${armor} из ${max}`}>
      <defs>
        <clipPath id={`${id}-body`}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <path d={SHIELD_PATH} fill="rgba(255,255,255,0.06)" />
      <rect x="0" y={fillTop} width="24" height="25" fill={tone.color} opacity="0.85"
            clipPath={`url(#${id}-body)`}
            style={{ transition: "y 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
      <path d={SHIELD_PATH} fill="none" stroke={tone.color} strokeWidth="1.6"
            strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${tone.color})` }} />
      {shield === "bleeding" && (
        // Трещина: Броня пробита, и это должно быть видно без подписи.
        <path d="M12 6 l-2.4 5 3 1.2 -2.2 5.4" fill="none" stroke="#fff" strokeWidth="1.3"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      )}
    </svg>
  );
}

// ─── Знак ранга ───────────────────────────────────────────────────────────────
export function RankBadge({ level, size = 34 }: { level: number; size?: number }) {
  const id = useId();
  const rank = rankOf(level);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img"
         aria-label={`Уровень ${level}, ${rank.title}`}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rank.metal[0]} />
          <stop offset="100%" stopColor={rank.metal[1]} />
        </linearGradient>
      </defs>
      <path d="M20 2 L34 10 v20 L20 38 L6 30 V10 Z" fill={`url(#${id}-metal)`} opacity="0.22" />
      <path d="M20 2 L34 10 v20 L20 38 L6 30 V10 Z" fill="none"
            stroke={`url(#${id}-metal)`} strokeWidth="2" strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 6px ${rank.color})` }} />
      <text x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700"
            fontFamily="Orbitron, monospace" fill={rank.color}
            style={{ filter: `drop-shadow(0 0 5px ${rank.color})` }}>
        {level}
      </text>
    </svg>
  );
}

// ─── Медаль первой тройки ─────────────────────────────────────────────────────
export function Medal({ place, size = 26 }: { place: number; size?: number }) {
  const id = useId();
  const medal = MEDALS[place];
  if (!medal) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${place} место`}>
      <defs>
        <linearGradient id={`${id}-m`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={medal.metal[0]} />
          <stop offset="100%" stopColor={medal.metal[1]} />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9.5" fill={`url(#${id}-m)`} />
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <text x="12" y="16.4" textAnchor="middle" fontSize="11" fontWeight="700"
            fontFamily="Orbitron, monospace" fill="rgba(10,20,14,0.8)">
        {place}
      </text>
    </svg>
  );
}

// ─── Облик героя ──────────────────────────────────────────────────────────────
export function HeroAvatar({ avatar, nickname, branch, size = 44, dimmed = false }: {
  avatar: string;
  nickname: string;
  branch: BranchId;
  size?: number;
  dimmed?: boolean;
}) {
  const tone = BRANCH_THEME[branch];
  return (
    <span
      className="hud-hex relative inline-block shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: dimmed
          ? "rgba(143,163,200,0.35)"
          : `linear-gradient(155deg, ${tone.color}, ${tone.color}55 60%, ${tone.color})`,
        filter: dimmed ? "grayscale(0.7)" : `drop-shadow(0 0 10px ${tone.glow})`,
      }}
      aria-hidden
    >
      {/* Внутренняя ячейка отступает на 2px — так «рамка» получается
          шестигранной; обычный border по гексагону не пройдёт. */}
      <span
        className="hud-hex absolute flex items-center justify-center"
        style={{
          inset: 2,
          fontSize: size * 0.46,
          lineHeight: 1,
          background: `radial-gradient(circle at 32% 24%, ${tone.soft}, #070b1c 75%)`,
        }}
      >
        {avatarOf(avatar, nickname)}
      </span>
    </span>
  );
}

// ─── Древо гильдии ────────────────────────────────────────────────────────────
/**
 * Крона одним замкнутым контуром с фестонами по краю.
 *
 * Пересекающиеся круги дали бы внутренние дуги на обводке — призрачный
 * силуэт от этого превращается в каракули. Один путь обводится чисто.
 */
function canopyPath(lobes = 11, cx = 100, cy = 80, rx = 64, ry = 54, bulge = 0.17): string {
  const points: [number, number][] = [];
  for (let i = 0; i < lobes; i += 1) {
    const a = (i / lobes) * Math.PI * 2 - Math.PI / 2;
    points.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < lobes; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % lobes];
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // Контрольная точка выдвинута наружу от центра — получается лепесток листвы
    const qx = cx + (mx - cx) * (1 + bulge * 2.4);
    const qy = cy + (my - cy) * (1 + bulge * 2.4);
    d += ` Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return `${d} Z`;
}

const CANOPY = canopyPath();
const TRUNK = "M91 120 C 89 150, 87 176, 82 206 L118 206 C 113 176, 111 150, 109 120 Z";
const LIMBS = ["M100 146 C 93 136, 82 130, 70 127", "M100 164 C 108 152, 120 145, 133 141"];
const ROOTS = ["M82 206 C 68 208, 60 212, 50 216", "M118 206 C 132 208, 140 212, 150 216"];
// Листья-блики внутри кроны: зажигаются по мере роста.
const LEAVES: [number, number][] = [
  [100, 42], [74, 52], [126, 52], [56, 78], [144, 78], [68, 104], [132, 104],
  [100, 66], [88, 92], [112, 92], [100, 110], [48, 96], [152, 96], [100, 86],
];

/**
 * Древо, которое растёт вместе с гильдией.
 *
 * Процент управляет размером: на старте из земли торчит росток, к 100%
 * дерево занимает весь кадр. Позади всегда виден призрак взрослого дерева —
 * чтобы было понятно, куда расти. Это читается без единой подписи.
 */
export function TreeArt({ percent, color, blinks = false, height = 210 }: {
  percent: number;
  color: string;
  blinks?: boolean;
  height?: number;
}) {
  const id = useId();
  const p = Math.max(0, Math.min(100, percent));
  const grow = 0.26 + 0.74 * (p / 100);
  // Растём из точки, где ствол входит в землю, — дерево поднимается, а не пухнет.
  const fromGround = `translate(100 206) scale(${grow.toFixed(3)}) translate(-100 -206)`;
  const litLeaves = Math.round(LEAVES.length * (p / 100));
  const alive = p >= 50;

  return (
    <svg viewBox="0 0 200 230" height={height} role="img"
         aria-label={`Древо гильдии: ${p}%`}
         className={blinks ? "guild-blink" : undefined}
         style={{ maxWidth: "100%", overflow: "visible" }}>
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="42%" r="52%">
          <stop offset="0%" stopColor={color} stopOpacity={alive ? 0.28 : 0.1} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-vol`} cx="32%" cy="24%" r="72%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="62%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* Конус проекции: снизу ярко, кверху растворяется */}
        <linearGradient id={`${id}-cone`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-emit`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="50%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="96" rx="98" ry="102" fill={`url(#${id}-halo)`} />

      {/* Конус и излучатель: дерево не стоит на земле, а проецируется */}
      <path d="M74 214 L18 40 L182 40 L126 214 Z" fill={`url(#${id}-cone)`} />
      <ellipse cx="100" cy="214" rx="62" ry="7" fill="none" stroke={color}
               strokeOpacity="0.35" strokeWidth="1" />
      <rect x="38" y="212" width="124" height="4" rx="2" fill={`url(#${id}-emit)`}
            style={{ filter: `drop-shadow(0 0 8px ${color})` }} />

      {/* Призрак взрослого дерева — цель, до которой гильдия ещё не доросла */}
      <g fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5"
         strokeDasharray="6 6" strokeLinejoin="round">
        <path d={CANOPY} />
        <path d={TRUNK} />
      </g>

      {/* Живое дерево: чем больше процент, тем оно крупнее */}
      <g transform={fromGround}
         style={{ transition: "transform 1s cubic-bezier(0.22,1,0.36,1)" }}>
        <g fill="none" stroke="#b08f55" strokeWidth="4" strokeLinecap="round">
          {ROOTS.map((d, i) => <path key={i} d={d} />)}
        </g>
        <path d={TRUNK} fill="#c6a76a" />
        <g fill="none" stroke="#c6a76a" strokeWidth="4.5" strokeLinecap="round">
          {LIMBS.map((d, i) => <path key={i} d={d} />)}
        </g>
        <path d={CANOPY} fill={color} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
        <path d={CANOPY} fill={`url(#${id}-vol)`} />
        <path d={CANOPY} fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1.5" />
        <g fill="#f3fff9">
          {LEAVES.slice(0, litLeaves).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.4" opacity="0.65"
                    className="guild-leaf" style={{ animationDelay: `${(i % 7) * 0.4}s` }} />
          ))}
        </g>
      </g>

      {/* Споры — только когда Древо по-настоящему ожило */}
      {p >= 70 && [0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={50 + i * 25} cy={160} r="2.6" fill={color}
                className="guild-spore" style={{ animationDelay: `${i * 1.1}s` }} />
      ))}
    </svg>
  );
}
