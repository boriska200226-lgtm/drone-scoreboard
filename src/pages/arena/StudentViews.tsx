import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { StatCard, XPRing, AvatarPicker, AchievementCard } from "./SharedComponents";
import {
  BAS_API, AUTH_API,
  LEVELS, ACHIEVEMENTS_META, ALL_ACHIEVEMENT_IDS,
  getLevelInfo, getLevelProgress,
  getAvatarEmoji, authHeaders, inputCls,
  PlayerProfile, Session, LeaderEntry,
} from "./constants";

// ─── StudentDashboard ─────────────────────────────────────────────────────────
export function StudentDashboard({ profile, sessions, onTabChange }: { profile: PlayerProfile | null; sessions: Session[]; onTabChange: (t: string) => void }) {
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

// ─── StudentProfile ────────────────────────────────────────────────────────────
export function StudentProfile({ profile, token, onProfileUpdate }: { profile: PlayerProfile | null; token: string; onProfileUpdate: () => void }) {
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

      <div className="rounded-xl border p-5" style={{ borderColor: "#00aaff33" }}>
        <div className="flex items-center gap-2 mb-4">
          <Icon name="Smile" size={14} style={{ color: "#00aaff" }} />
          <span className="font-orbitron text-xs text-white uppercase tracking-widest">Выбор аватара</span>
        </div>
        <AvatarPicker current={pendingAvatar} onSelect={saveAvatar} />
      </div>

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

// ─── LeaderboardPage ──────────────────────────────────────────────────────────
export function LeaderboardPage({ myPlayerId }: { myPlayerId: string | null }) {
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

// ─── SessionsPage ─────────────────────────────────────────────────────────────
export function SessionsPage({ sessions }: { sessions: Session[] }) {
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

// ─── AchievementsPage ─────────────────────────────────────────────────────────
export function AchievementsPage({ achievements }: { achievements: { id: string; unlocked_at: string }[] }) {
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
