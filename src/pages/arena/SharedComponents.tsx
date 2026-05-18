import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import {
  AVATARS, ACHIEVEMENTS_META, AUTH_API,
  getLevelInfo, getLevelProgress,
  getAvatarEmoji, authHeaders, inputCls,
  AuthUser,
} from "./constants";

// ─── StatCard ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon, color, delay = 0 }: { label: string; value: string | number; icon: string; color: string; delay?: number }) {
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
export function XPRing({ xp, size = 110 }: { xp: number; size?: number }) {
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
export function AvatarPicker({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
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
              style={{ background: sel ? "#00ffaa15" : "rgba(255,255,255,0.03)",
                border: `2px solid ${sel ? "#00ffaa" : "rgba(255,255,255,0.06)"}`,
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
export function AchievementCard({ achId, unlockedAt, index }: { achId: string; unlockedAt?: string; index: number }) {
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
export function XPPopup({ xp, achs, penalty, onClose }: { xp: number; achs: string[]; penalty: number; onClose: () => void }) {
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

// ─── LoginPage ────────────────────────────────────────────────────────────────
export function LoginPage({ onLogin }: { onLogin: (u: AuthUser) => void }) {
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
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center animate-pulse-glow"
            style={{ background: "#00ffaa20", border: "1px solid #00ffaa44" }}>
            <Icon name="Gamepad2" size={28} style={{ color: "#00ffaa" }} />
          </div>
          <h1 className="font-orbitron text-3xl font-black text-white animate-flicker" style={{ letterSpacing: "0.1em" }}>
            БАС<span style={{ color: "#00ffaa" }}>_</span>АРЕНА
          </h1>
          <p className="text-muted-foreground font-rajdhani mt-2">Беспилотная Авиационная Система · Рейтинг</p>
        </div>

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
