import { useState, useEffect, useCallback, useRef } from "react";
import Icon from "@/components/ui/icon";

const BAS_API  = "https://functions.poehali.dev/bb5c48e3-b0c4-470f-be46-41fd993e489b";
const AUTH_API = "https://functions.poehali.dev/1cad08a9-267a-4594-9dac-bb893ad136bd";

// ─── Avatars ──────────────────────────────────────────────────────────────────
const AVATARS = {
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

function getAvatarEmoji(id: string) {
  return [...AVATARS.boys, ...AVATARS.girls].find((a) => a.id === id)?.emoji ?? "🎮";
}

// ─── Levels ───────────────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1, title: "Новобранец", minXP: 0,    maxXP: 500,   color: "#888888" },
  { level: 2, title: "Боец",       minXP: 500,  maxXP: 1200,  color: "#00aaff" },
  { level: 3, title: "Ветеран",    minXP: 1200, maxXP: 2500,  color: "#00ffaa" },
  { level: 4, title: "Элита",      minXP: 2500, maxXP: 5000,  color: "#bf5fff" },
  { level: 5, title: "Легенда",    minXP: 5000, maxXP: 10000, color: "#ffd700" },
];

const ACHIEVEMENTS_META: Record<string, { title: string; description: string; icon: string; color: string; xpReward: number; condition: string }> = {
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

const ALL_ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS_META);

function getLevelInfo(xp: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) if (xp >= LEVELS[i].minXP) return LEVELS[i];
  return LEVELS[0];
}
function getLevelProgress(xp: number) {
  const lvl = getLevelInfo(xp);
  return Math.min(100, Math.round(((xp - lvl.minXP) / (lvl.maxXP - lvl.minXP)) * 100));
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuthUser { token: string; role: "teacher" | "student"; player_id: string | null; login: string }
interface PlayerProfile { nickname: string; avatar_id: string; xp: number; achievements: { id: string; unlocked_at: string }[] }
interface Session { id: number; date: string; score: number; duration: number; accuracy: number; level: string; xp_earned: number; penalty_xp: number }
interface LeaderEntry { player_id: string; nickname: string; avatar_id: string; xp: number; rank: number; is_me: boolean }
interface Student { login: string; player_id: string; nickname: string; avatar_id: string; xp: number; created_at: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "bas_arena_auth";

function saveAuth(user: AuthUser) { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
function loadAuth(): AuthUser | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}
function clearAuth() { localStorage.removeItem(STORAGE_KEY); }

function authHeaders(token: string) { return { "Content-Type": "application/json", "X-Token": token }; }

const inputCls = {
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

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, delay = 0 }: { label: string; value: string | number; icon: string; color: string; delay?: number }) {
  return (
    <div className="relative rounded-lg border bg-card p-4 overflow-hidden animate-fade-in-up"
      style={{ animationDelay: `${delay}ms`, borderColor: `${color}33` }}>
      <div className="absolute inset-0 opacity-5" style={{ background: `radial-gradient(circle at top right, ${color}, transparent 70%)` }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-rajdhani text-muted-foreground uppercase tracking-widest">{label}</span>
        <div className="p-1.5 rounded" style={{ background: `${color}22` }}>
          <Icon name={icon} size={14} style={{ color }} />
        </div>
      </div>
      <div className="font-orbitron text-2xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ─── XPRing ───────────────────────────────────────────────────────────────────
function XPRing({ xp, size = 110 }: { xp: number; size?: number }) {
  const lvl = getLevelInfo(xp);
  const progress = getLevelProgress(xp);
  const r = 44; const circ = 2 * Math.PI * r; const dash = (progress / 100) * circ;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute" style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={lvl.color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${lvl.color})`, transition: "stroke-dasharray 1.5s cubic-bezier(0.23,1,0.32,1)" }} />
      </svg>
      <div className="text-center z-10">
        <div className="font-orbitron text-xl font-bold" style={{ color: lvl.color }}>{lvl.level}</div>
        <div className="text-xs text-muted-foreground font-rajdhani">{progress}%</div>
      </div>
    </div>
  );
}

// ─── AvatarPicker ─────────────────────────────────────────────────────────────
function AvatarPicker({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<"boys" | "girls">("boys");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["boys", "girls"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 py-2 rounded-lg font-orbitron text-xs transition-all"
            style={{ background: tab === t ? "#00ffaa20" : "transparent", color: tab === t ? "#00ffaa" : "#666",
              border: `1px solid ${tab === t ? "#00ffaa44" : "rgba(255,255,255,0.06)"}` }}>
            {t === "boys" ? "👦 МАЛЬЧИКИ" : "👧 ДЕВОЧКИ"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {AVATARS[tab].map((av) => {
          const sel = current === av.id;
          return (
            <button key={av.id} onClick={() => onSelect(av.id)}
              className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all duration-200 hover:scale-105"
              style={{ background: sel ? "#00ffaa20" : "rgba(255,255,255,0.03)",
                border: `2px solid ${sel ? "#00ffaa" : "rgba(255,255,255,0.08)"}`,
                boxShadow: sel ? "0 0 20px #00ffaa33" : "none" }}>
              <span className="text-3xl">{av.emoji}</span>
              <span className="text-[10px] font-rajdhani" style={{ color: sel ? "#00ffaa" : "#888" }}>{av.label}</span>
              {sel && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#00ffaa" }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Achievement Card ─────────────────────────────────────────────────────────
function AchievementCard({ achId, unlockedAt, index }: { achId: string; unlockedAt?: string; index: number }) {
  const m = ACHIEVEMENTS_META[achId]; if (!m) return null;
  const unlocked = !!unlockedAt;
  return (
    <div className="relative rounded-xl border p-4 transition-all duration-300 hover:scale-[1.02]"
      style={{ borderColor: unlocked ? `${m.color}44` : "rgba(255,255,255,0.06)",
        background: unlocked ? `linear-gradient(135deg, hsl(var(--card)), ${m.color}0a)` : "hsl(var(--card))",
        boxShadow: unlocked ? `0 0 20px ${m.color}18` : "none", opacity: unlocked ? 1 : 0.45,
        animationDelay: `${index * 60}ms` }}>
      {unlocked && <div className="absolute top-2 right-2 text-xs font-orbitron px-2 py-0.5 rounded-full"
        style={{ background: `${m.color}22`, color: m.color }}>+{m.xpReward} XP</div>}
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: `${m.color}20`, border: `1px solid ${m.color}44` }}>
        <Icon name={m.icon} size={22} style={{ color: unlocked ? m.color : "#555" }} />
      </div>
      <div className="font-orbitron text-sm font-bold mb-1" style={{ color: unlocked ? m.color : "#555" }}>{m.title}</div>
      <div className="text-xs text-muted-foreground font-rajdhani mb-2">{m.description}</div>
      <div className="flex items-center gap-1.5">
        <Icon name={unlocked ? "CheckCircle2" : "Lock"} size={12} style={{ color: unlocked ? m.color : "#555" }} />
        <span className="text-xs font-rajdhani" style={{ color: unlocked ? m.color : "#555" }}>
          {unlocked ? `Разблокировано ${unlockedAt}` : m.condition}
        </span>
      </div>
    </div>
  );
}

// ─── XP Popup ─────────────────────────────────────────────────────────────────
function XPPopup({ xp, achs, penalty, onClose }: { xp: number; achs: string[]; penalty: number; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-20 right-4 z-[100] rounded-2xl border p-5 animate-scale-in max-w-xs w-72"
      style={{ background: "hsl(var(--card))", borderColor: "#00ffaa44", boxShadow: "0 0 30px #00ffaa33" }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#00ffaa20" }}>
          <Icon name="Zap" size={20} style={{ color: "#00ffaa" }} />
        </div>
        <div>
          <div className="font-orbitron text-sm font-bold" style={{ color: "#00ffaa" }}>+{xp} XP</div>
          <div className="text-xs text-muted-foreground font-rajdhani">Сессия сохранена!</div>
        </div>
      </div>
      {penalty > 0 && <div className="flex items-center gap-2 mb-2 text-xs font-rajdhani" style={{ color: "#ff4444" }}>
        <Icon name="AlertTriangle" size={12} /><span>Штраф: −{penalty} XP</span></div>}
      {achs.length > 0 && <div className="space-y-1">{achs.map((id) => {
        const m = ACHIEVEMENTS_META[id];
        return m ? <div key={id} className="flex items-center gap-2 text-xs font-rajdhani" style={{ color: m.color }}>
          <Icon name="Trophy" size={12} /><span>🔓 {m.title}</span></div> : null;
      })}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LOGIN PAGE
// ════════════════════════════════════════════════════════════════════
function LoginPage({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!login || !password) { setError("Введи логин и пароль"); return; }
    setLoading(true); setError("");
    const res = await fetch(`${AUTH_API}?action=login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) { onLogin(data); }
    else { setError(data.error || "Ошибка входа"); }
  };

  return (
    <div className="min-h-screen bg-background grid-bg scanlines flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center animate-pulse-glow"
            style={{ background: "#00ffaa20", border: "1px solid #00ffaa44" }}>
            <Icon name="Gamepad2" size={28} style={{ color: "#00ffaa" }} />
          </div>
          <h1 className="font-orbitron text-3xl font-black text-white animate-flicker" style={{ letterSpacing: "0.1em" }}>
            БАС<span style={{ color: "#00ffaa" }}>_</span>АРЕНА
          </h1>
          <p className="text-muted-foreground font-rajdhani mt-2">Боевая Авиационная Система · Рейтинг</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border p-6 space-y-4"
          style={{ borderColor: "#00ffaa33", background: "linear-gradient(135deg, hsl(var(--card)), #00ffaa05)" }}>
          <div>
            <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Логин</label>
            <input style={inputCls} placeholder="teacher или student01" value={login}
              onChange={(e) => setLogin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
          </div>
          <div>
            <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Пароль</label>
            <div className="relative">
              <input style={{ ...inputCls, paddingRight: "2.5rem" }}
                type={showPass ? "text" : "password"}
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                onClick={() => setShowPass(!showPass)}>
                <Icon name={showPass ? "EyeOff" : "Eye"} size={16} />
              </button>
            </div>
          </div>

          {error && <div className="flex items-center gap-2 text-xs font-rajdhani text-red-400">
            <Icon name="AlertCircle" size={12} />{error}</div>}

          <button onClick={handleLogin} disabled={loading}
            className="w-full py-3.5 rounded-xl font-orbitron text-sm font-bold transition-all duration-200 hover:scale-[1.01] disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: loading ? "rgba(0,255,170,0.1)" : "linear-gradient(135deg, #00ffaa, #00aaff)",
              color: "#0a0d14", boxShadow: loading ? "none" : "0 0 24px rgba(0,255,170,0.4)" }}>
            {loading ? <><Icon name="Loader" size={16} className="animate-spin" />ВХОД...</>
                     : <><Icon name="LogIn" size={16} />ВОЙТИ В АРЕНУ</>}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground font-rajdhani">
          Учётные данные предоставляет преподаватель
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STUDENT VIEWS
// ════════════════════════════════════════════════════════════════════
const STUDENT_NAV = [
  { id: "dashboard",    label: "ДАШБОРД",    icon: "LayoutDashboard" },
  { id: "achievements", label: "ДОСТИЖЕНИЯ", icon: "Trophy" },
  { id: "sessions",     label: "ИСТОРИЯ",    icon: "History" },
  { id: "leaderboard",  label: "РЕЙТИНГ",    icon: "Users" },
  { id: "profile",      label: "ПРОФИЛЬ",    icon: "User" },
];

function StudentDashboard({ profile, sessions, onTabChange }: { profile: PlayerProfile | null; sessions: Session[]; onTabChange: (t: string) => void }) {
  const xp = profile?.xp ?? 0;
  const lvl = getLevelInfo(xp);
  const progress = getLevelProgress(xp);
  const nextLvl = LEVELS.find((l) => l.level === lvl.level + 1);
  const bestScore = sessions.length ? Math.max(...sessions.map((s) => s.score)) : 0;

  return (
    <div className="space-y-6">
      <div className="relative rounded-2xl border overflow-hidden p-6 animate-fade-in-up"
        style={{ borderColor: `${lvl.color}44`, background: `linear-gradient(135deg, hsl(var(--card)) 60%, ${lvl.color}08)`, boxShadow: `0 0 40px ${lvl.color}18` }}>
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `repeating-linear-gradient(45deg, ${lvl.color}22 0, ${lvl.color}22 1px, transparent 0, transparent 50%)`,
          backgroundSize: "20px 20px" }} />
        <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="relative">
            <XPRing xp={xp} size={110} />
            <div className="absolute -bottom-1 -right-1 text-2xl">{getAvatarEmoji(profile?.avatar_id ?? "boy_1")}</div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="text-xs font-rajdhani tracking-[0.3em] uppercase mb-1" style={{ color: lvl.color }}>Уровень {lvl.level} · {lvl.title}</div>
            <div className="font-orbitron text-3xl font-black text-white mb-1">{profile?.nickname ?? "..."}</div>
            <div className="text-muted-foreground font-rajdhani text-sm mb-4">{xp.toLocaleString()} XP / {nextLvl ? nextLvl.minXP.toLocaleString() : "∞"} XP</div>
            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
              <div className="h-full rounded-full xp-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-muted-foreground font-rajdhani">{progress}% до следующего уровня</span>
              {nextLvl && <span className="text-xs font-rajdhani" style={{ color: lvl.color }}>{(nextLvl.minXP - xp).toLocaleString()} XP</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Всего XP" value={xp.toLocaleString()} icon="Zap" color="#00ffaa" delay={0} />
        <StatCard label="Сессий" value={sessions.length} icon="Gamepad2" color="#00aaff" delay={60} />
        <StatCard label="Достижений" value={`${profile?.achievements.length ?? 0}/${ALL_ACHIEVEMENT_IDS.length}`} icon="Trophy" color="#ffd700" delay={120} />
        <StatCard label="Лучший счёт" value={bestScore} icon="Flame" color="#ff8800" delay={180} />
      </div>

      {sessions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Icon name="History" size={16} style={{ color: "#00ffaa" }} />
            <span className="font-orbitron text-sm text-white">ПОСЛЕДНИЕ СЕССИИ</span>
          </div>
          <div className="space-y-2">
            {sessions.slice(0, 3).map((s, i) => (
              <div key={s.id} className="flex items-center gap-4 rounded-lg border border-white/5 bg-card px-4 py-3 animate-fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}>
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Icon name="Gamepad2" size={16} style={{ color: "#00ffaa" }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-rajdhani font-semibold text-white">{s.date} · {s.level}</div>
                  <div className="text-xs text-muted-foreground">{s.duration} мин · точность {s.accuracy}%</div>
                </div>
                <div className="text-right">
                  <div className="font-orbitron text-lg font-bold" style={{ color: "#ffd700" }}>{s.score}</div>
                  <div className="flex items-center gap-1 justify-end">
                    <span className="text-xs font-rajdhani" style={{ color: "#00ffaa" }}>+{s.xp_earned} XP</span>
                    {s.penalty_xp > 0 && <span className="text-xs font-rajdhani" style={{ color: "#ff4444" }}>−{s.penalty_xp}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-card p-4 flex items-center gap-3">
        <Icon name="Info" size={16} style={{ color: "#00aaff" }} />
        <p className="text-xs font-rajdhani text-muted-foreground">Сессии и XP начисляет преподаватель после занятий БАС</p>
      </div>
    </div>
  );
}

function StudentProfile({ profile, token, onProfileUpdate }: { profile: PlayerProfile | null; token: string; onProfileUpdate: () => void }) {
  const xp = profile?.xp ?? 0;
  const lvl = getLevelInfo(xp);
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [pendingAvatar, setPendingAvatar] = useState(profile?.avatar_id ?? "boy_1");
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

  useEffect(() => {
    if (profile?.nickname) setNickname(profile.nickname);
    if (profile?.avatar_id) setPendingAvatar(profile.avatar_id);
  }, [profile]);

  const saveName = async () => {
    if (!nickname.trim()) return;
    setSavingName(true); setNameMsg("");
    await fetch(`${AUTH_API}?action=rename`, { method: "PUT", headers: authHeaders(token), body: JSON.stringify({ nickname: nickname.trim() }) });
    setSavingName(false); setNameMsg("Сохранено!"); onProfileUpdate();
    setTimeout(() => setNameMsg(""), 2000);
  };

  const saveAvatar = async (id: string) => {
    setPendingAvatar(id); setSavingAvatar(true);
    await fetch(`${AUTH_API}?action=avatar`, { method: "PUT", headers: authHeaders(token), body: JSON.stringify({ avatar_id: id }) });
    setSavingAvatar(false); onProfileUpdate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-orbitron text-xl font-bold text-white">МОЙ ПРОФИЛЬ</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Ты можешь изменить имя и аватар</p>
      </div>

      <div className="relative rounded-2xl border overflow-hidden p-6"
        style={{ borderColor: `${lvl.color}44`, background: `linear-gradient(135deg, hsl(var(--card)) 50%, ${lvl.color}08)` }}>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl"
            style={{ background: `${lvl.color}20`, border: `2px solid ${lvl.color}66` }}>
            {getAvatarEmoji(pendingAvatar)}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="font-orbitron text-2xl font-black text-white mb-1">{profile?.nickname ?? "..."}</div>
            <div className="font-rajdhani text-sm" style={{ color: lvl.color }}>{lvl.title} · Ур.{lvl.level} · {xp.toLocaleString()} XP</div>
          </div>
          {savingAvatar && <span className="text-xs font-rajdhani" style={{ color: "#00ffaa" }}>Сохранение...</span>}
        </div>
      </div>

      {/* Изменить имя */}
      <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: "#00ffaa33" }}>
        <div className="flex items-center gap-2 mb-1">
          <Icon name="Pencil" size={14} style={{ color: "#00ffaa" }} />
          <span className="font-orbitron text-xs text-white uppercase tracking-widest">Изменить имя</span>
        </div>
        <input style={inputCls} placeholder="Новое имя" value={nickname} onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveName()} maxLength={30} />
        <div className="flex items-center gap-3">
          <button onClick={saveName} disabled={savingName}
            className="px-5 py-2 rounded-lg font-orbitron text-xs font-bold transition-all disabled:opacity-50"
            style={{ background: "#00ffaa20", color: "#00ffaa", border: "1px solid #00ffaa44" }}>
            {savingName ? "..." : "СОХРАНИТЬ"}
          </button>
          {nameMsg && <span className="text-xs font-rajdhani" style={{ color: "#00ffaa" }}>{nameMsg}</span>}
        </div>
      </div>

      {/* Аватар */}
      <div className="rounded-xl border p-5" style={{ borderColor: "#00aaff33" }}>
        <div className="flex items-center gap-2 mb-4">
          <Icon name="Smile" size={14} style={{ color: "#00aaff" }} />
          <span className="font-orbitron text-xs text-white uppercase tracking-widest">Выбор аватара</span>
        </div>
        <AvatarPicker current={pendingAvatar} onSelect={saveAvatar} />
      </div>

      {/* Достижения */}
      {(profile?.achievements.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Icon name="Medal" size={16} style={{ color: "#ffd700" }} />
            <span className="font-orbitron text-sm text-white">МОИ ДОСТИЖЕНИЯ</span>
          </div>
          <div className="flex gap-3 flex-wrap">
            {profile!.achievements.map((a) => {
              const m = ACHIEVEMENTS_META[a.id]; if (!m) return null;
              return (
                <div key={a.id} className="w-14 h-14 rounded-xl flex items-center justify-center"
                  style={{ background: `${m.color}18`, border: `1px solid ${m.color}44`, boxShadow: `0 0 14px ${m.color}30` }} title={m.title}>
                  <Icon name={m.icon} size={24} style={{ color: m.color }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LeaderboardPage({ myPlayerId }: { myPlayerId: string | null }) {
  const [board, setBoard] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const rankColors = ["#ffd700", "#c0c0c0", "#cd7f32"];
  const rankEmojis = ["🥇", "🥈", "🥉"];

  useEffect(() => {
    fetch(`${BAS_API}?action=leaderboard&player_id=${encodeURIComponent(myPlayerId ?? "")}`)
      .then((r) => r.json()).then((d) => { setBoard(d.leaderboard || []); setLoading(false); });
  }, [myPlayerId]);

  const me = board.find((e) => e.is_me);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-orbitron text-xl font-bold text-white">ТАБЛИЦА ЛИДЕРОВ</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Рейтинг всех студентов по XP</p>
      </div>
      {me && (
        <div className="rounded-lg border px-4 py-3 flex items-center gap-3"
          style={{ borderColor: "#00ffaa44", background: "linear-gradient(135deg, hsl(var(--card)), #00ffaa08)" }}>
          <span className="text-xl">{getAvatarEmoji(me.avatar_id)}</span>
          <span className="font-rajdhani text-sm text-white">Твоя позиция:</span>
          <span className="font-orbitron font-bold" style={{ color: "#00ffaa" }}>#{me.rank}</span>
          <span className="text-muted-foreground font-rajdhani text-sm ml-auto">{me.xp.toLocaleString()} XP</span>
        </div>
      )}
      {loading ? (
        <div className="text-center py-12"><Icon name="Loader" size={32} className="mx-auto mb-3 animate-spin opacity-40" /></div>
      ) : (
        <div className="space-y-2">
          {board.map((entry, i) => {
            const rc = rankColors[i] ?? "#555"; const lvl = getLevelInfo(entry.xp);
            return (
              <div key={entry.player_id} className="flex items-center gap-3 rounded-xl border px-4 py-3 animate-fade-in-up"
                style={{ borderColor: entry.is_me ? "#00ffaa44" : "rgba(255,255,255,0.06)",
                  background: entry.is_me ? "linear-gradient(135deg, hsl(var(--card)), #00ffaa08)" : "hsl(var(--card))",
                  boxShadow: i < 3 ? `0 0 14px ${rc}22` : "none", animationDelay: `${i * 50}ms` }}>
                <div className="w-8 text-center font-orbitron text-sm font-bold shrink-0" style={{ color: rc }}>
                  {i < 3 ? rankEmojis[i] : `#${entry.rank}`}
                </div>
                <div className="text-xl shrink-0">{getAvatarEmoji(entry.avatar_id)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-rajdhani font-semibold text-sm truncate" style={{ color: entry.is_me ? "#00ffaa" : "white" }}>
                    {entry.nickname}{entry.is_me && <span className="ml-2 text-xs opacity-70" style={{ color: "#00ffaa" }}>(ты)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">Ур. {lvl.level} · {lvl.title}</div>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1 w-32 shrink-0">
                  <div className="w-full bg-white/5 rounded-full h-1.5">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100,(entry.xp/10000)*100)}%`,
                      background: `linear-gradient(90deg, ${lvl.color}, ${lvl.color}88)` }} />
                  </div>
                  <div className="font-orbitron text-xs font-bold" style={{ color: rc }}>{entry.xp.toLocaleString()} XP</div>
                </div>
                <div className="sm:hidden font-orbitron text-sm font-bold shrink-0" style={{ color: rc }}>{entry.xp.toLocaleString()}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionsPage({ sessions }: { sessions: Session[] }) {
  const avgScore = sessions.length ? Math.round(sessions.reduce((s, g) => s + g.score, 0) / sessions.length) : 0;
  const avgAcc = sessions.length ? Math.round(sessions.reduce((s, g) => s + g.accuracy, 0) / sessions.length) : 0;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-orbitron text-xl font-bold text-white">ИСТОРИЯ СЕССИЙ</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Все сессии в БАС</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Средний счёт" value={avgScore} icon="BarChart3" color="#00ffaa" />
        <StatCard label="Ср. точность" value={`${avgAcc}%`} icon="Target" color="#00aaff" />
        <StatCard label="Всего сессий" value={sessions.length} icon="Hash" color="#bf5fff" />
        <StatCard label="Лучший счёт" value={sessions.length ? Math.max(...sessions.map((s) => s.score)) : 0} icon="Trophy" color="#ffd700" />
      </div>
      {sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground font-rajdhani">
          <Icon name="Gamepad2" size={48} className="mx-auto mb-4 opacity-20" />
          <p>Пока нет сессий.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 grid grid-cols-5 text-xs font-orbitron text-muted-foreground">
            <span>ДАТА</span><span className="text-center">СЧЁТ</span><span className="text-center">ВРЕМЯ</span>
            <span className="text-center">ТОЧНОСТЬ</span><span className="text-center">XP</span>
          </div>
          {sessions.map((s, i) => (
            <div key={s.id} className="px-4 py-3 border-b border-white/5 last:border-0 grid grid-cols-5 items-center animate-fade-in-up"
              style={{ animationDelay: `${i * 60}ms` }}>
              <span className="text-sm font-rajdhani text-white">{s.date}</span>
              <div className="text-center font-orbitron text-lg font-bold"
                style={{ color: s.score >= 700 ? "#00ffaa" : s.score >= 500 ? "#ffd700" : "#ff8800" }}>{s.score}</div>
              <div className="text-center text-sm font-rajdhani text-muted-foreground">{s.duration}м</div>
              <div className="text-center text-sm font-rajdhani font-semibold"
                style={{ color: s.accuracy >= 90 ? "#00ffaa" : s.accuracy >= 80 ? "#ffd700" : "#ff4444" }}>{s.accuracy}%</div>
              <div className="text-center">
                <span className="text-xs font-rajdhani" style={{ color: "#00ffaa" }}>+{s.xp_earned}</span>
                {s.penalty_xp > 0 && <span className="text-xs font-rajdhani ml-1" style={{ color: "#ff4444" }}>−{s.penalty_xp}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AchievementsPage({ achievements }: { achievements: { id: string; unlocked_at: string }[] }) {
  const unlockedIds = new Set(achievements.map((a) => a.id));
  const unlocked = ALL_ACHIEVEMENT_IDS.filter((id) => unlockedIds.has(id));
  const locked = ALL_ACHIEVEMENT_IDS.filter((id) => !unlockedIds.has(id));
  const getDate = (id: string) => achievements.find((a) => a.id === id)?.unlocked_at ?? "";
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-xl font-bold text-white">ДОСТИЖЕНИЯ</h2>
          <p className="text-sm text-muted-foreground font-rajdhani mt-1">{unlocked.length} из {ALL_ACHIEVEMENT_IDS.length}</p>
        </div>
        <div className="font-orbitron text-2xl font-black" style={{ color: "#ffd700" }}>{unlocked.length}/{ALL_ACHIEVEMENT_IDS.length}</div>
      </div>
      <div className="rounded-lg border border-white/10 bg-card p-4">
        <div className="w-full bg-white/5 rounded-full h-2">
          <div className="h-full rounded-full" style={{ width: `${(unlocked.length / ALL_ACHIEVEMENT_IDS.length) * 100}%`,
            background: "linear-gradient(90deg, #ffd700, #ff8800)", transition: "width 1s ease" }} />
        </div>
      </div>
      {unlocked.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#00ffaa" }} />
            <span className="font-orbitron text-xs tracking-widest" style={{ color: "#00ffaa" }}>ПОЛУЧЕНО</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {unlocked.map((id, i) => <AchievementCard key={id} achId={id} unlockedAt={getDate(id)} index={i} />)}
          </div>
        </div>
      )}
      {locked.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Icon name="Lock" size={12} className="text-muted-foreground" />
            <span className="font-orbitron text-xs text-muted-foreground tracking-widest">НЕ РАЗБЛОКИРОВАНО</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {locked.map((id, i) => <AchievementCard key={id} achId={id} unlockedAt="" index={i} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TEACHER VIEWS
// ════════════════════════════════════════════════════════════════════
const TEACHER_NAV = [
  { id: "students",    label: "СТУДЕНТЫ",   icon: "Users" },
  { id: "add-session", label: "СЕССИЯ",     icon: "Plus" },
  { id: "penalty",     label: "ШТРАФ",      icon: "AlertTriangle" },
  { id: "leaderboard", label: "РЕЙТИНГ",    icon: "BarChart3" },
  { id: "new-student", label: "ДОБАВИТЬ",   icon: "UserPlus" },
];

function TeacherStudents({ token, onSelectPlayer }: { token: string; onSelectPlayer: (id: string) => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`${AUTH_API}?action=students`, { headers: { "X-Token": token } })
      .then((r) => r.json()).then((d) => { setStudents(d.students || []); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-xl font-bold text-white">СТУДЕНТЫ</h2>
          <p className="text-sm text-muted-foreground font-rajdhani mt-1">{students.length} студентов в группе</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg transition-all hover:scale-110" style={{ background: "#00ffaa15", color: "#00ffaa", border: "1px solid #00ffaa33" }}>
          <Icon name="RefreshCw" size={15} />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Icon name="Loader" size={32} className="mx-auto animate-spin opacity-40" /></div>
      ) : (
        <div className="space-y-2">
          {students.map((s, i) => {
            const lvl = getLevelInfo(s.xp);
            return (
              <div key={s.login} className="flex items-center gap-3 rounded-xl border border-white/6 bg-card px-4 py-3 cursor-pointer hover:border-white/20 transition-all animate-fade-in-up"
                style={{ animationDelay: `${i * 40}ms` }} onClick={() => onSelectPlayer(s.player_id)}>
                <div className="text-2xl">{getAvatarEmoji(s.avatar_id)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-rajdhani font-semibold text-sm text-white truncate">{s.nickname}</div>
                  <div className="text-xs text-muted-foreground">@{s.login} · {s.created_at}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-orbitron text-sm font-bold" style={{ color: lvl.color }}>{s.xp.toLocaleString()} XP</div>
                  <div className="text-xs text-muted-foreground">Ур. {lvl.level}</div>
                </div>
                <Icon name="ChevronRight" size={14} className="text-muted-foreground shrink-0" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeacherAddSession({ token, students, onSuccess }: { token: string; students: Student[]; onSuccess: (xp: number, achs: string[], pen: number) => void }) {
  const [playerId, setPlayerId] = useState("");
  const [score, setScore] = useState(""); const [duration, setDuration] = useState("");
  const [accuracy, setAccuracy] = useState(""); const [level, setLevel] = useState("Средний");
  const [penaltyXp, setPenaltyXp] = useState(""); const [penaltyReason, setPenaltyReason] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!playerId || !score || !duration || !accuracy) { setError("Выбери студента и заполни все поля"); return; }
    const sc = parseInt(score), dur = parseInt(duration), acc = parseInt(accuracy), pen = parseInt(penaltyXp || "0") || 0;
    if (acc < 0 || acc > 100) { setError("Точность: 0–100"); return; }
    setLoading(true); setError("");
    const res = await fetch(BAS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": token },
      body: JSON.stringify({ player_id: playerId, score: sc, duration: dur, accuracy: acc, level, penalty_xp: pen, penalty_reason: penaltyReason || "Штраф" }),
    });
    const data = await res.json(); setLoading(false);
    if (res.ok) {
      setScore(""); setDuration(""); setAccuracy(""); setPenaltyXp(""); setPenaltyReason("");
      onSuccess(data.net_xp + (data.bonus_xp || 0), data.new_achievements || [], data.penalty_xp || 0);
    } else { setError(data.error || "Ошибка"); }
  };

  const preview = score && duration && accuracy
    ? Math.max(0, Math.round(parseInt(score)/5 + parseInt(duration)*2) - (parseInt(penaltyXp || "0") || 0)) : 0;

  return (
    <div className="space-y-6">
      <div><h2 className="font-orbitron text-xl font-bold text-white">ЗАПИСАТЬ СЕССИЮ</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Внеси результаты студента из БАС</p></div>

      <div className="rounded-2xl border p-6 space-y-5" style={{ borderColor: "#00ffaa33", background: "linear-gradient(135deg, hsl(var(--card)), #00ffaa05)" }}>
        {/* Выбор студента */}
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Студент</label>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}
            style={{ ...inputCls, cursor: "pointer" }}>
            <option value="">— выбери студента —</option>
            {students.map((s) => <option key={s.player_id} value={s.player_id}>{s.nickname} (@{s.login})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Счёт</label>
          <input type="number" placeholder="например: 750" value={score} onChange={(e) => setScore(e.target.value)} style={inputCls} min={0} />
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Длительность (мин)</label>
          <input type="number" placeholder="например: 20" value={duration} onChange={(e) => setDuration(e.target.value)} style={inputCls} min={1} />
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Точность (%)</label>
          <input type="number" placeholder="например: 87" value={accuracy} onChange={(e) => setAccuracy(e.target.value)} style={inputCls} min={0} max={100} />
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Сложность</label>
          <div className="grid grid-cols-3 gap-2">
            {["Лёгкий", "Средний", "Сложный"].map((l) => (
              <button key={l} onClick={() => setLevel(l)} className="py-2.5 rounded-lg font-rajdhani text-sm font-semibold transition-all"
                style={{ background: level === l ? (l === "Лёгкий" ? "#00ffaa20" : l === "Средний" ? "#00aaff20" : "#bf5fff20") : "rgba(255,255,255,0.03)",
                  border: `1px solid ${level === l ? (l === "Лёгкий" ? "#00ffaa" : l === "Средний" ? "#00aaff" : "#bf5fff") : "rgba(255,255,255,0.08)"}`,
                  color: level === l ? (l === "Лёгкий" ? "#00ffaa" : l === "Средний" ? "#00aaff" : "#bf5fff") : "#888" }}>{l}</button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "#ff444433", background: "#ff44440a" }}>
          <div className="flex items-center gap-2">
            <Icon name="AlertTriangle" size={14} style={{ color: "#ff4444" }} />
            <span className="text-xs font-orbitron uppercase tracking-widest" style={{ color: "#ff4444" }}>Штрафные XP</span>
          </div>
          <input type="number" placeholder="0 — штраф не применяется" value={penaltyXp} onChange={(e) => setPenaltyXp(e.target.value)}
            style={{ ...inputCls, border: "1px solid #ff444433" }} min={0} />
          <input type="text" placeholder="Причина штрафа" value={penaltyReason} onChange={(e) => setPenaltyReason(e.target.value)}
            style={{ ...inputCls, border: "1px solid #ff444433" }} />
        </div>

        {score && duration && accuracy && (
          <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "#00ffaa0a", border: "1px solid #00ffaa22" }}>
            <Icon name="Zap" size={16} style={{ color: "#00ffaa" }} />
            <span className="text-sm font-rajdhani text-muted-foreground">Получит:</span>
            <span className="font-orbitron text-sm font-bold" style={{ color: preview > 0 ? "#00ffaa" : "#ff4444" }}>~{preview} XP</span>
            {penaltyXp && parseInt(penaltyXp) > 0 && <span className="text-xs font-rajdhani ml-auto" style={{ color: "#ff4444" }}>−{penaltyXp} штраф</span>}
          </div>
        )}

        {error && <div className="text-xs font-rajdhani text-red-400 flex items-center gap-2"><Icon name="AlertCircle" size={12} />{error}</div>}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-4 rounded-xl font-orbitron text-sm font-bold transition-all duration-200 hover:scale-[1.01] disabled:opacity-50 flex items-center justify-center gap-3"
          style={{ background: loading ? "rgba(0,255,170,0.1)" : "linear-gradient(135deg, #00ffaa, #00aaff)", color: "#0a0d14",
            boxShadow: loading ? "none" : "0 0 30px rgba(0,255,170,0.4)" }}>
          {loading ? <><Icon name="Loader" size={16} className="animate-spin" />СОХРАНЕНИЕ...</>
                   : <><Icon name="Save" size={16} />СОХРАНИТЬ СЕССИЮ</>}
        </button>
      </div>
    </div>
  );
}

function TeacherPenalty({ token, students }: { token: string; students: Student[] }) {
  const [playerId, setPlayerId] = useState("");
  const [penXp, setPenXp] = useState(""); const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false); const [msg, setMsg] = useState("");

  const handleSubmit = async () => {
    if (!playerId || !penXp) { setMsg("❌ Выбери студента и введи XP"); return; }
    setLoading(true); setMsg("");
    const res = await fetch(`${BAS_API}?action=penalty`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": token },
      body: JSON.stringify({ player_id: playerId, penalty_xp: parseInt(penXp), reason: reason || "Штраф" }),
    });
    const data = await res.json(); setLoading(false);
    if (res.ok) { setMsg(`✅ Штраф −${penXp} XP применён`); setPenXp(""); setReason(""); }
    else { setMsg(`❌ ${data.error}`); }
  };

  return (
    <div className="space-y-6">
      <div><h2 className="font-orbitron text-xl font-bold text-white">ВЫДАТЬ ШТРАФ</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Снятие XP без привязки к сессии</p></div>

      <div className="rounded-2xl border p-6 space-y-5" style={{ borderColor: "#ff444433", background: "linear-gradient(135deg, hsl(var(--card)), #ff44440a)" }}>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Студент</label>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} style={{ ...inputCls, cursor: "pointer" }}>
            <option value="">— выбери студента —</option>
            {students.map((s) => <option key={s.player_id} value={s.player_id}>{s.nickname} (@{s.login}) — {s.xp} XP</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Штрафных XP</label>
          <input type="number" placeholder="например: 100" value={penXp} onChange={(e) => setPenXp(e.target.value)}
            style={{ ...inputCls, border: "1px solid #ff444433" }} min={1} />
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Причина</label>
          <input type="text" placeholder="Опиши причину штрафа" value={reason} onChange={(e) => setReason(e.target.value)} style={inputCls} />
        </div>

        {msg && <div className="text-sm font-rajdhani" style={{ color: msg.startsWith("✅") ? "#00ffaa" : "#ff4444" }}>{msg}</div>}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-4 rounded-xl font-orbitron text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-3"
          style={{ background: loading ? "rgba(255,68,68,0.1)" : "linear-gradient(135deg, #ff4444, #bf5fff)",
            color: "white", boxShadow: loading ? "none" : "0 0 24px rgba(255,68,68,0.3)" }}>
          {loading ? <><Icon name="Loader" size={16} className="animate-spin" />...</>
                   : <><Icon name="AlertTriangle" size={16} />ПРИМЕНИТЬ ШТРАФ</>}
        </button>
      </div>
    </div>
  );
}

function TeacherNewStudent({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState("boy_1");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ login: string; password: string } | null>(null);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!nickname.trim()) { setError("Введи имя студента"); return; }
    setLoading(true); setError(""); setResult(null);
    const res = await fetch(`${AUTH_API}?action=create_student`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ nickname: nickname.trim(), avatar_id: avatarId }),
    });
    const data = await res.json(); setLoading(false);
    if (res.ok) { setResult({ login: data.login, password: data.password }); setNickname(""); onCreated(); }
    else { setError(data.error || "Ошибка"); }
  };

  return (
    <div className="space-y-6">
      <div><h2 className="font-orbitron text-xl font-bold text-white">ДОБАВИТЬ СТУДЕНТА</h2>
        <p className="text-sm text-muted-foreground font-rajdhani mt-1">Логин и пароль генерируются автоматически</p></div>

      {result && (
        <div className="rounded-xl border p-5 space-y-3 animate-fade-in-up"
          style={{ borderColor: "#00ffaa44", background: "linear-gradient(135deg, hsl(var(--card)), #00ffaa08)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Icon name="CheckCircle2" size={18} style={{ color: "#00ffaa" }} />
            <span className="font-orbitron text-sm font-bold" style={{ color: "#00ffaa" }}>СТУДЕНТ СОЗДАН!</span>
          </div>
          <p className="text-xs font-rajdhani text-muted-foreground">Сохрани и передай студенту:</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="text-xs font-orbitron text-muted-foreground mb-1">ЛОГИН</div>
              <div className="font-orbitron text-lg font-bold text-white">{result.login}</div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="text-xs font-orbitron text-muted-foreground mb-1">ПАРОЛЬ</div>
              <div className="font-orbitron text-lg font-bold text-white">{result.password}</div>
            </div>
          </div>
          <button onClick={() => setResult(null)} className="text-xs font-rajdhani text-muted-foreground hover:text-white mt-1">
            Добавить ещё →
          </button>
        </div>
      )}

      <div className="rounded-2xl border p-6 space-y-5" style={{ borderColor: "#00aaff33", background: "linear-gradient(135deg, hsl(var(--card)), #00aaff05)" }}>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Имя студента</label>
          <input style={inputCls} placeholder="например: Иванов Иван" value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()} maxLength={30} />
        </div>
        <div>
          <label className="block text-xs font-orbitron text-muted-foreground uppercase tracking-widest mb-2">Аватар</label>
          <AvatarPicker current={avatarId} onSelect={setAvatarId} />
        </div>
        {error && <div className="text-xs font-rajdhani text-red-400 flex items-center gap-2"><Icon name="AlertCircle" size={12} />{error}</div>}
        <button onClick={handleCreate} disabled={loading}
          className="w-full py-4 rounded-xl font-orbitron text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-3"
          style={{ background: loading ? "rgba(0,170,255,0.1)" : "linear-gradient(135deg, #00aaff, #00ffaa)", color: "#0a0d14",
            boxShadow: loading ? "none" : "0 0 24px rgba(0,170,255,0.4)" }}>
          {loading ? <><Icon name="Loader" size={16} className="animate-spin" />СОЗДАНИЕ...</>
                   : <><Icon name="UserPlus" size={16} />СОЗДАТЬ СТУДЕНТА</>}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SHELL (Header + routing)
// ════════════════════════════════════════════════════════════════════
function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const isTeacher = user.role === "teacher";
  const navItems = isTeacher ? TEACHER_NAV : STUDENT_NAV;
  const [activeTab, setActiveTab] = useState(isTeacher ? "students" : "dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [xpPopup, setXpPopup] = useState<{ xp: number; achs: string[]; penalty: number } | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user.player_id) return;
    const res = await fetch(`${BAS_API}?action=profile&player_id=${encodeURIComponent(user.player_id)}`);
    if (res.ok) setProfile(await res.json());
  }, [user.player_id]);

  const loadSessions = useCallback(async () => {
    if (!user.player_id) return;
    const res = await fetch(`${BAS_API}?action=sessions&player_id=${encodeURIComponent(user.player_id)}`);
    if (res.ok) { const d = await res.json(); setSessions(d.sessions || []); }
  }, [user.player_id]);

  const loadStudents = useCallback(async () => {
    if (!isTeacher) return;
    const res = await fetch(`${AUTH_API}?action=students`, { headers: { "X-Token": user.token } });
    if (res.ok) { const d = await res.json(); setStudents(d.students || []); }
  }, [isTeacher, user.token]);

  useEffect(() => {
    loadProfile(); loadSessions(); loadStudents();
  }, [loadProfile, loadSessions, loadStudents]);

  const lvl = getLevelInfo(profile?.xp ?? 0);
  const accentColor = isTeacher ? "#bf5fff" : lvl.color;

  const handleSessionSuccess = (xp: number, achs: string[], penalty: number) => {
    setXpPopup({ xp, achs, penalty });
    loadStudents();
    if (activeTab !== "students") setActiveTab("students");
  };

  return (
    <div className="min-h-screen bg-background grid-bg scanlines">
      {xpPopup && <XPPopup xp={xpPopup.xp} achs={xpPopup.achs} penalty={xpPopup.penalty} onClose={() => setXpPopup(null)} />}

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 backdrop-blur-md" style={{ background: "rgba(10,13,22,0.92)" }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}44` }}>
              <Icon name={isTeacher ? "GraduationCap" : "Gamepad2"} size={16} style={{ color: accentColor }} />
            </div>
            <span className="font-orbitron text-sm font-bold text-white" style={{ letterSpacing: "0.1em" }}>
              БАС<span style={{ color: accentColor }}>_</span>АРЕНА
              {isTeacher && <span className="ml-2 text-xs opacity-60" style={{ color: accentColor }}>ПРЕПОДАВАТЕЛЬ</span>}
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <button key={item.id} onClick={() => setActiveTab(item.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-orbitron transition-all duration-200"
                style={{ color: activeTab === item.id ? accentColor : "#666",
                  background: activeTab === item.id ? `${accentColor}15` : "transparent",
                  borderBottom: activeTab === item.id ? `1px solid ${accentColor}` : "1px solid transparent" }}>
                <Icon name={item.icon} size={13} />{item.label}
              </button>
            ))}
          </nav>

          {/* Right pill */}
          <div className="hidden md:flex items-center gap-2">
            {!isTeacher && <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: `${lvl.color}15`, border: `1px solid ${lvl.color}33` }}>
              <span className="text-lg">{getAvatarEmoji(profile?.avatar_id ?? "boy_1")}</span>
              <span className="font-orbitron text-xs" style={{ color: lvl.color }}>LVL {lvl.level} · {(profile?.xp ?? 0).toLocaleString()} XP</span>
            </div>}
            {isTeacher && <div className="px-3 py-1.5 rounded-full font-orbitron text-xs"
              style={{ background: "#bf5fff20", border: "1px solid #bf5fff33", color: "#bf5fff" }}>👨‍🏫 {user.login}</div>}
            <button onClick={onLogout} className="p-2 rounded-lg text-muted-foreground hover:text-red-400 transition-colors" title="Выйти">
              <Icon name="LogOut" size={15} />
            </button>
          </div>

          <button className="md:hidden p-2 rounded-lg" style={{ background: `${accentColor}15`, color: accentColor }}
            onClick={() => setMobileOpen(!mobileOpen)}>
            <Icon name={mobileOpen ? "X" : "Menu"} size={18} />
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-white/5 px-4 py-3 space-y-1" style={{ background: "rgba(10,13,22,0.98)" }}>
            <div className="grid grid-cols-5 gap-1 mb-2">
              {navItems.map((item) => (
                <button key={item.id} onClick={() => { setActiveTab(item.id); setMobileOpen(false); }}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg font-orbitron transition-all"
                  style={{ color: activeTab === item.id ? accentColor : "#666", background: activeTab === item.id ? `${accentColor}15` : "transparent" }}>
                  <Icon name={item.icon} size={16} />
                  <span className="text-[9px]">{item.label}</span>
                </button>
              ))}
            </div>
            <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-rajdhani text-red-400 hover:bg-red-400/10 transition-colors">
              <Icon name="LogOut" size={14} />Выйти
            </button>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-20 pb-10">
        <div key={activeTab} className="animate-fade-in">
          {/* Student tabs */}
          {!isTeacher && activeTab === "dashboard"    && <StudentDashboard profile={profile} sessions={sessions} onTabChange={setActiveTab} />}
          {!isTeacher && activeTab === "achievements" && <AchievementsPage achievements={profile?.achievements ?? []} />}
          {!isTeacher && activeTab === "sessions"     && <SessionsPage sessions={sessions} />}
          {!isTeacher && activeTab === "leaderboard"  && <LeaderboardPage myPlayerId={user.player_id} />}
          {!isTeacher && activeTab === "profile"      && <StudentProfile profile={profile} token={user.token} onProfileUpdate={loadProfile} />}

          {/* Teacher tabs */}
          {isTeacher && activeTab === "students"    && <TeacherStudents token={user.token} onSelectPlayer={(id) => { setActiveTab("add-session"); }} />}
          {isTeacher && activeTab === "add-session" && <TeacherAddSession token={user.token} students={students} onSuccess={handleSessionSuccess} />}
          {isTeacher && activeTab === "penalty"     && <TeacherPenalty token={user.token} students={students} />}
          {isTeacher && activeTab === "leaderboard" && <LeaderboardPage myPlayerId={null} />}
          {isTeacher && activeTab === "new-student" && <TeacherNewStudent token={user.token} onCreated={loadStudents} />}
        </div>
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════════════
export default function Index() {
  const [user, setUser] = useState<AuthUser | null>(() => loadAuth());
  const [checking, setChecking] = useState(!!loadAuth());

  useEffect(() => {
    const saved = loadAuth();
    if (!saved) { setChecking(false); return; }
    fetch(`${AUTH_API}?action=me`, { headers: { "X-Token": saved.token } })
      .then((r) => { if (r.ok) { setUser(saved); } else { clearAuth(); setUser(null); } })
      .catch(() => { setUser(saved); })
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = (u: AuthUser) => { saveAuth(u); setUser(u); };
  const handleLogout = async () => {
    if (user) await fetch(`${AUTH_API}?action=logout`, { method: "POST", headers: { "X-Token": user.token } }).catch(() => {});
    clearAuth(); setUser(null);
  };

  if (checking) return (
    <div className="min-h-screen bg-background grid-bg scanlines flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center animate-pulse" style={{ background: "#00ffaa15", border: "1px solid #00ffaa33" }}>
          <Icon name="Gamepad2" size={24} style={{ color: "#00ffaa" }} />
        </div>
        <p className="font-orbitron text-sm text-muted-foreground">ЗАГРУЗКА...</p>
      </div>
    </div>
  );

  if (!user) return <LoginPage onLogin={handleLogin} />;
  return <Shell user={user} onLogout={handleLogout} />;
}
