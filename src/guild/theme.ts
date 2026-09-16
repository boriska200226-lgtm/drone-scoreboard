/** Неоновая палитра, ранги и гербы «Гильдии». Вынесено из компонентов, чтобы не ломать HMR. */
import type { CSSProperties } from "react";

import type { BranchId, Shield } from "./types";

// Базовые неоны. Всё светится на почти чёрном сине-фиолетовом фоне.
export const NEON_CYAN = "#00e5ff";
export const NEON_MAGENTA = "#ff2bd6";
export const NEON_VIOLET = "#a855ff";
export const NEON_LIME = "#39ff88";
export const NEON_AMBER = "#ffc53d";
export const NEON_ROSE = "#ff3d6e";

export const GUILD_GREEN = NEON_LIME;   // «всё хорошо»
export const GUILD_GOLD = NEON_AMBER;   // «внимание, награда»
export const GUILD_EMBER = NEON_ROSE;   // «тревога»
export const GUILD_MIST = "#8fa3c8";
export const GUILD_NIGHT = "#05060f";

/** Ветка — это не просто подпись, а свой неон, герб и характер. */
export interface BranchTheme {
  id: BranchId;
  title: string;
  color: string;
  glow: string;
  soft: string;
  gradient: string;
  motto: string;
}

export const BRANCH_THEME: Record<BranchId, BranchTheme> = {
  tactics: {
    id: "tactics",
    title: "Тактика",
    color: NEON_MAGENTA,
    glow: "rgba(255,43,214,0.55)",
    soft: "rgba(255,43,214,0.14)",
    gradient: "linear-gradient(135deg, #ff2bd6, #ff7ae0)",
    motto: "Думай на ход вперёд",
  },
  diplomacy: {
    id: "diplomacy",
    title: "Дипломатия",
    color: NEON_CYAN,
    glow: "rgba(0,229,255,0.55)",
    soft: "rgba(0,229,255,0.14)",
    gradient: "linear-gradient(135deg, #00e5ff, #6df1ff)",
    motto: "Слово сильнее крика",
  },
  keeper: {
    id: "keeper",
    title: "Хранитель",
    color: NEON_VIOLET,
    glow: "rgba(168,85,255,0.55)",
    soft: "rgba(168,85,255,0.14)",
    gradient: "linear-gradient(135deg, #a855ff, #d2a6ff)",
    motto: "Держи строй",
  },
};

/** Ранг по уровню: у каждого своё имя и свой неон. */
export interface Rank {
  from: number;
  title: string;
  color: string;
  metal: [string, string];
}

export const RANKS: Rank[] = [
  { from: 1, title: "Новобранец", color: "#8fa3c8", metal: ["#bcd0f0", "#4b5c7d"] },
  { from: 2, title: "Оруженосец", color: NEON_CYAN, metal: ["#8df3ff", "#0088a8"] },
  { from: 3, title: "Страж", color: NEON_LIME, metal: ["#9dffc4", "#12b35c"] },
  { from: 4, title: "Витязь", color: NEON_AMBER, metal: ["#ffe28f", "#c98a08"] },
  { from: 6, title: "Легенда", color: NEON_MAGENTA, metal: ["#ff9ae8", "#c00d9c"] },
];

export function rankOf(level: number): Rank {
  let found = RANKS[0];
  for (const rank of RANKS) if (level >= rank.from) found = rank;
  return found;
}

/** Состояния щита на Алтаре. */
export const SHIELD_THEME: Record<Shield, { color: string; label: string }> = {
  green: { color: NEON_LIME, label: "Броня цела" },
  yellow: { color: NEON_AMBER, label: "Броня просела" },
  red: { color: NEON_ROSE, label: "Дебафф активен" },
  bleeding: { color: "#ff1744", label: "Броня на нуле" },
};

export const BAR_COLOR = {
  green: NEON_LIME,
  yellow: NEON_AMBER,
  red: NEON_ROSE,
} as const;

/** Второй цвет градиента шкалы: неон всегда переливается, а не заливает плоско. */
export const BAR_GRADIENT: Record<keyof typeof BAR_COLOR, [string, string]> = {
  green: ["#00e5ff", "#39ff88"],
  yellow: ["#ffc53d", "#ff8a3d"],
  red: ["#ff3d6e", "#ff2bd6"],
};

/** Цвет Древа по уровню роста. */
export const TREE_TONE = {
  gray: "#5c6b8f",
  blue: NEON_CYAN,
  yellow: NEON_AMBER,
  green: NEON_LIME,
} as const;

/**
 * Аватары. Кличка неизменна, а облик — единственное, что герой выбирает сам,
 * поэтому список намеренно большой и без «мальчик/девочка».
 */
export const AVATARS = [
  "🦊", "🐺", "🦉", "🐻", "🦅", "🦌",
  "🐉", "🦁", "🐯", "🦄", "🐙", "🦇",
  "🌿", "🔥", "❄️", "⚡", "🌊", "🪐",
] as const;

export function avatarOf(avatar: string, nickname: string): string {
  if (avatar) return avatar;
  // Пока герой не выбрал облик, даём устойчивый по кличке — чтобы Алтарь
  // не выглядел как список одинаковых пустых кружков.
  let hash = 0;
  for (let i = 0; i < nickname.length; i += 1) hash = (hash * 31 + nickname.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

/** Медали первой тройки Алтаря. */
export const MEDALS: Record<number, { color: string; metal: [string, string] }> = {
  1: { color: NEON_AMBER, metal: ["#ffe9a8", "#c98a08"] },
  2: { color: "#cfe2ff", metal: ["#eef4ff", "#7f93b8"] },
  3: { color: "#ff9d5c", metal: ["#ffc79a", "#b1571c"] },
};

/**
 * Цвет неоновой рамки панели.
 *
 * `.guild-panel` рисует рамку градиентом в один пиксель через маску —
 * обычный `border-color` там просто нечему красить, поэтому цвет передаётся
 * переменными, а не свойством.
 */
export function ring(color: string, second?: string): CSSProperties {
  return { "--ring": color, "--ring2": second ?? color } as CSSProperties;
}

/** Цвет свечения для `.neon-num` и `.neon-label`. */
export function neon(color: string): CSSProperties {
  return { "--neon": color } as CSSProperties;
}
