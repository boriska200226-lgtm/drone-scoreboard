export const BAS_API  = "https://functions.poehali.dev/bb5c48e3-b0c4-470f-be46-41fd993e489b";
export const AUTH_API = "https://functions.poehali.dev/1cad08a9-267a-4594-9dac-bb893ad136bd";

export const AVATARS = {
  boys: [
    { id: "boy_1", emoji: "🧑‍🚀", label: "Астронавт" },
    { id: "boy_2", emoji: "🧑‍💻", label: "Кодер" },
    { id: "boy_3", emoji: "⚔️",   label: "Воин" },
    { id: "boy_4", emoji: "🦊",   label: "Лис" },
    { id: "boy_5", emoji: "🐺",   label: "Волк" },
    { id: "boy_6", emoji: "🤖",   label: "Робот" },
  ],
  girls: [
    { id: "girl_1", emoji: "👩‍🚀", label: "Астронавтка" },
    { id: "girl_2", emoji: "👩‍💻", label: "Хакерша" },
    { id: "girl_3", emoji: "🧝‍♀️", label: "Эльфийка" },
    { id: "girl_4", emoji: "🦋",  label: "Бабочка" },
    { id: "girl_5", emoji: "🐱",  label: "Кошка" },
    { id: "girl_6", emoji: "🌙",  label: "Луна" },
  ],
};

export function getAvatarEmoji(id: string) {
  return [...AVATARS.boys, ...AVATARS.girls].find((a) => a.id === id)?.emoji ?? "🎮";
}

export const LEVELS = [
  { level: 1, title: "Новобранец", minXP: 0,    maxXP: 500,   color: "#888888" },
  { level: 2, title: "Боец",       minXP: 500,  maxXP: 1200,  color: "#00aaff" },
  { level: 3, title: "Ветеран",    minXP: 1200, maxXP: 2500,  color: "#00ffaa" },
  { level: 4, title: "Элита",      minXP: 2500, maxXP: 5000,  color: "#bf5fff" },
  { level: 5, title: "Легенда",    minXP: 5000, maxXP: 10000, color: "#ffd700" },
];

export const ACHIEVEMENTS_META: Record<string, { title: string; description: string; icon: string; color: string; xpReward: number; condition: string }> = {
  first_blood:   { title: "Первая кровь",   description: "Завершить первую сессию",               icon: "Zap",     color: "#00ffaa", xpReward: 50,  condition: "1 сессия" },
  sharp_shooter: { title: "Снайпер",        description: "Точность 90%+ в БАС",                   icon: "Target",  color: "#00aaff", xpReward: 150, condition: "Точность ≥ 90%" },
  speed_demon:   { title: "Демон скорости", description: "500+ очков за сессию",                  icon: "Flame",   color: "#ff8800", xpReward: 200, condition: "Очки ≥ 500" },
  consistency:   { title: "Железная воля", description: "7 дней подряд",                           icon: "Shield",  color: "#bf5fff", xpReward: 300, condition: "7-дневная серия" },
  highscore:     { title: "Рекордсмен",     description: "1000+ очков за сессию",                 icon: "Trophy",  color: "#ffd700", xpReward: 500, condition: "Очки ≥ 1000" },
  grind:         { title: "Гриндер",        description: "50 сессий суммарно",                    icon: "Swords",  color: "#ff4444", xpReward: 400, condition: "50 сессий" },
  perfect:       { title: "Перфекционист",  description: "Точность 100% в сессии",                icon: "Star",    color: "#ffd700", xpReward: 750, condition: "Точность = 100%" },
  marathon:      { title: "Марафонец",      description: "30+ минут в игре за день",              icon: "Timer",   color: "#00aaff", xpReward: 250, condition: "30 мин за день" },
  dark_king:     { title: "Король тьмы",    description: "10+ сессий без единого штрафа",         icon: "Crown",   color: "#6600cc", xpReward: 600, condition: "10 сессий без штрафов" },
  night_hunter:  { title: "Ночной охотник", description: "Точность ≥85% и счёт ≥700 в сессии",   icon: "Moon",    color: "#0066ff", xpReward: 450, condition: "Точность ≥ 85% и счёт ≥ 700" },
};

export const ALL_ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS_META);

export function getLevelInfo(xp: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) if (xp >= LEVELS[i].minXP) return LEVELS[i];
  return LEVELS[0];
}

export function getLevelProgress(xp: number) {
  const lvl = getLevelInfo(xp);
  return Math.min(100, Math.round(((xp - lvl.minXP) / (lvl.maxXP - lvl.minXP)) * 100));
}

export interface AuthUser { token: string; role: "teacher" | "student"; player_id: string | null; login: string }
export interface PlayerProfile { nickname: string; avatar_id: string; xp: number; achievements: { id: string; unlocked_at: string }[] }
export interface Session { id: number; date: string; score: number; duration: number; accuracy: number; level: string; xp_earned: number; penalty_xp: number }
export interface LeaderEntry { player_id: string; nickname: string; avatar_id: string; xp: number; rank: number; is_me: boolean }
export interface Student { login: string; player_id: string; nickname: string; avatar_id: string; xp: number; created_at: string }

export const STORAGE_KEY = "bas_arena_auth";

export function saveAuth(user: AuthUser) { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
export function loadAuth(): AuthUser | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}
export function clearAuth() { localStorage.removeItem(STORAGE_KEY); }

export function authHeaders(token: string) { return { "Content-Type": "application/json", "X-Token": token }; }

export const inputCls = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "0.5rem",
  color: "white",
  padding: "0.75rem 1rem",
  fontFamily: "Rajdhani, sans-serif",
  fontSize: "1rem",
  width: "100%",
  outline: "none",
} as React.CSSProperties;

export const STUDENT_NAV = [
  { id: "dashboard",    label: "ДАШБОРД",    icon: "LayoutDashboard" },
  { id: "achievements", label: "ДОСТИЖЕНИЯ", icon: "Trophy" },
  { id: "sessions",     label: "ИСТОРИЯ",    icon: "History" },
  { id: "leaderboard",  label: "РЕЙТИНГ",    icon: "Users" },
  { id: "profile",      label: "ПРОФИЛЬ",    icon: "User" },
];

export const TEACHER_NAV = [
  { id: "students",    label: "СТУДЕНТЫ",   icon: "Users" },
  { id: "add-session", label: "СЕССИЯ",     icon: "Plus" },
  { id: "penalty",     label: "ШТРАФ",      icon: "AlertTriangle" },
  { id: "leaderboard", label: "РЕЙТИНГ",    icon: "BarChart3" },
  { id: "new-student", label: "ДОБАВИТЬ",   icon: "UserPlus" },
];
