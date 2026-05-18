import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { LoginPage, XPPopup } from "./arena/SharedComponents";
import { StudentDashboard, AchievementsPage, SessionsPage, LeaderboardPage, StudentProfile } from "./arena/StudentViews";
import { TeacherStudents, TeacherAddSession, TeacherPenalty, TeacherNewStudent } from "./arena/TeacherViews";
import {
  AUTH_API, BAS_API,
  STUDENT_NAV, TEACHER_NAV,
  getLevelInfo, getAvatarEmoji,
  saveAuth, loadAuth, clearAuth,
  AuthUser, PlayerProfile, Session, Student,
} from "./arena/constants";

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
