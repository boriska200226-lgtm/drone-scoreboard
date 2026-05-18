import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { AvatarPicker } from "./SharedComponents";
import {
  BAS_API, AUTH_API,
  getLevelInfo, getAvatarEmoji, authHeaders, inputCls,
  Student,
} from "./constants";

// ─── TeacherStudents ──────────────────────────────────────────────────────────
export function TeacherStudents({ token, onSelectPlayer }: { token: string; onSelectPlayer: (id: string) => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLogin, setConfirmLogin] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${AUTH_API}?action=students`, { headers: { "X-Token": token } })
      .then((r) => r.json()).then((d) => { setStudents(d.students || []); setLoading(false); });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (login: string) => {
    setDeleting(true);
    await fetch(`${AUTH_API}?action=delete_student`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ login }),
    });
    setDeleting(false);
    setConfirmLogin(null);
    load();
  };

  return (
    <div className="space-y-6">
      {confirmLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-2xl border p-6 w-full max-w-sm space-y-4 animate-scale-in"
            style={{ background: "hsl(var(--card))", borderColor: "#ff444444", boxShadow: "0 0 40px #ff444433" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#ff444420" }}>
                <Icon name="Trash2" size={18} style={{ color: "#ff4444" }} />
              </div>
              <div>
                <div className="font-orbitron text-sm font-bold text-white">Удалить студента?</div>
                <div className="text-xs text-muted-foreground font-rajdhani mt-0.5">@{confirmLogin} · это действие необратимо</div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmLogin(null)}
                className="flex-1 py-2.5 rounded-lg font-orbitron text-xs transition-all"
                style={{ background: "rgba(255,255,255,0.05)", color: "#888", border: "1px solid rgba(255,255,255,0.1)" }}>
                ОТМЕНА
              </button>
              <button onClick={() => handleDelete(confirmLogin)} disabled={deleting}
                className="flex-1 py-2.5 rounded-lg font-orbitron text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #ff4444, #bf2222)", color: "white", boxShadow: "0 0 16px rgba(255,68,68,0.4)" }}>
                {deleting ? <><Icon name="Loader" size={13} className="animate-spin" />...</> : <><Icon name="Trash2" size={13} />УДАЛИТЬ</>}
              </button>
            </div>
          </div>
        </div>
      )}

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
            const xp = s.xp ?? 0;
            const lvl = getLevelInfo(xp);
            return (
              <div key={s.login} className="flex items-center gap-3 rounded-xl border border-white/6 bg-card px-4 py-3 transition-all animate-fade-in-up hover:border-white/15"
                style={{ animationDelay: `${i * 40}ms` }}>
                <div className="text-2xl shrink-0">{getAvatarEmoji(s.avatar_id ?? "boy_1")}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-rajdhani font-semibold text-sm text-white truncate">{s.nickname ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">@{s.login} · {s.created_at}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-orbitron text-sm font-bold" style={{ color: lvl.color }}>{xp.toLocaleString()} XP</div>
                  <div className="text-xs text-muted-foreground">Ур. {lvl.level}</div>
                </div>
                <button onClick={() => setConfirmLogin(s.login)}
                  className="p-2 rounded-lg shrink-0 transition-all hover:scale-110 ml-1"
                  style={{ background: "#ff444415", color: "#ff4444", border: "1px solid #ff444430" }}
                  title="Удалить студента">
                  <Icon name="Trash2" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TeacherAddSession ────────────────────────────────────────────────────────
export function TeacherAddSession({ token, students, onSuccess }: { token: string; students: Student[]; onSuccess: (xp: number, achs: string[], pen: number) => void }) {
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

// ─── TeacherPenalty ───────────────────────────────────────────────────────────
export function TeacherPenalty({ token, students }: { token: string; students: Student[] }) {
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

// ─── TeacherNewStudent ────────────────────────────────────────────────────────
export function TeacherNewStudent({ token, onCreated }: { token: string; onCreated: () => void }) {
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
