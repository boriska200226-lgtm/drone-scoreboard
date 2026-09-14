/** Палитра, ранги и гербы «Гильдии». Вынесено из компонентов, чтобы не ломать HMR. */
import type { BranchId, Shield } from "./types";

export const GUILD_GREEN = "#3ddc97";
export const GUILD_GOLD = "#f0c661";
export const GUILD_EMBER = "#ff6b45";
export const GUILD_MIST = "#93ab9f";
export const GUILD_NIGHT = "#070d0a";

/** Ветка — это не просто подпись, а свой цвет, герб и характер. */
export interface BranchTheme {
  id: BranchId;
  title: string;
  color: string;
  soft: string;
  motto: string;
}

export const BRANCH_THEME: Record<BranchId, BranchTheme> = {
  tactics: {
    id: "tactics",
    title: "Тактика",
    color: "#ff7a59",
    soft: "rgba(255,122,89,0.16)",
    motto: "Думай на ход вперёд",
  },
  diplomacy: {
    id: "diplomacy",
    title: "Дипломатия",
    color: "#5cc8ff",
    soft: "rgba(92,200,255,0.16)",
    motto: "Слово сильнее крика",
  },
  keeper: {
    id: "keeper",
    title: "Хранитель",
    color: "#a98bff",
    soft: "rgba(169,139,255,0.16)",
    motto: "Держи строй",
  },
};

/** Ранг по уровню: у каждого своё имя и свой металл. */
export interface Rank {
  from: number;
  title: string;
  color: string;
  metal: [string, string];
}

export const RANKS: Rank[] = [
  { from: 1, title: "Новобранец", color: "#9db3a6", metal: ["#9db3a6", "#5d6f65"] },
  { from: 2, title: "Оруженосец", color: "#5cc8ff", metal: ["#8fdcff", "#2c7fae"] },
  { from: 3, title: "Страж", color: "#3ddc97", metal: ["#7bf3bd", "#1d8f5f"] },
  { from: 4, title: "Витязь", color: "#f0c661", metal: ["#ffe29a", "#a37a1e"] },
  { from: 6, title: "Легенда", color: "#ff9d4d", metal: ["#ffd0a1", "#c2591a"] },
];

export function rankOf(level: number): Rank {
  let found = RANKS[0];
  for (const rank of RANKS) if (level >= rank.from) found = rank;
  return found;
}

/** Состояния щита на Алтаре. */
export const SHIELD_THEME: Record<Shield, { color: string; label: string }> = {
  green: { color: "#3ddc97", label: "Броня цела" },
  yellow: { color: "#f0c661", label: "Броня просела" },
  red: { color: "#ff6b45", label: "Дебафф активен" },
  bleeding: { color: "#ff3b30", label: "Броня на нуле" },
};

export const BAR_COLOR = {
  green: "#3ddc97",
  yellow: "#f0c661",
  red: "#ff6b45",
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
  1: { color: "#f0c661", metal: ["#ffe6a3", "#b8860b"] },
  2: { color: "#cfd9d3", metal: ["#eef4f0", "#8a9992"] },
  3: { color: "#d98f5a", metal: ["#f2bc8e", "#96551f"] },
};
