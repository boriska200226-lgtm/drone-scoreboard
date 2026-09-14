/** Палитра и глифы «Гильдии». Вынесены из компонентов, чтобы не ломать HMR. */
export const GUILD_GREEN = "#3ddc97";
export const GUILD_GOLD = "#e8c56a";
export const GUILD_EMBER = "#e2603f";
export const GUILD_MIST = "#9db3a6";

/** Щит на Алтаре: 🟢 спокойно, 🟡 просело, 🔴 дебафф, 🩸 Броня на нуле. */
export const SHIELD_GLYPH: Record<string, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  bleeding: "🩸",
};

export const BRANCH_GLYPH: Record<string, string> = {
  tactics: "⚔️",
  diplomacy: "🕊️",
  keeper: "🛡️",
};
