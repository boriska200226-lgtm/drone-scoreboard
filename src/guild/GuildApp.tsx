import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, clearAuth, loadAuth, saveAuth } from "./api";
import {
  Confetti, ConnectionBadge, InstallBanner, LoginForm, WhistleOverlay,
} from "./components/Common";
import CardsSheet from "./components/Cards";
import { Altar, FestivalView, HeroCard, QuietMail } from "./components/StudentViews";
import {
  AttendancePanel, AwardPanel, ControlPanel, GuildMapView, RosterPanel,
} from "./components/TeacherViews";
import { alarm, unlockAudio } from "./sound";
import { GUILD_EMBER, GUILD_GOLD, GUILD_GREEN } from "./theme";
import type { GameRules, GuildAuth, GuildEvent, HeroCardData, StudentRow } from "./types";
import { useGuildLink } from "./ws";

interface Tab {
  id: string;
  label: string;
  icon: string;
}

const STUDENT_TABS: Tab[] = [
  { id: "altar", label: "АЛТАРЬ", icon: "Users" },
  { id: "hero", label: "ГЕРОЙ", icon: "Swords" },
  { id: "mail", label: "ПОЧТА", icon: "Mail" },
  { id: "festival", label: "ФЕСТИВАЛЬ", icon: "PartyPopper" },
];

const TEACHER_TABS: Tab[] = [
  { id: "altar", label: "АЛТАРЬ", icon: "Users" },
  { id: "award", label: "СЗ", icon: "Sparkles" },
  { id: "attendance", label: "БРОНЯ", icon: "Shield" },
  { id: "control", label: "СВИСТОК", icon: "Megaphone" },
  { id: "map", label: "КАРТА", icon: "Compass" },
  { id: "roster", label: "ГЕРОИ", icon: "ScrollText" },
  { id: "cards", label: "КАРТОЧКИ", icon: "IdCard" },
  { id: "festival", label: "ФЕСТИВАЛЬ", icon: "PartyPopper" },
];

interface Toast {
  id: number;
  text: string;
  tone: string;
}

export default function GuildApp() {
  const [auth, setAuth] = useState<GuildAuth | null>(() => loadAuth());
  const [tab, setTab] = useState("altar");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [whistle, setWhistle] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [card, setCard] = useState<HeroCardData | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rules, setRules] = useState<GameRules | null>(null);
  const celebrated = useRef(false);
  const toastId = useRef(0);

  const isTeacher = auth?.role === "teacher";

  const pushToast = useCallback((text: string, tone = GUILD_GREEN) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const onEvent = useCallback((event: GuildEvent) => {
    switch (event.event) {
      case "souls_updated": {
        const { nickname, delta, reason } = event.payload;
        pushToast(`${nickname ?? "Герой"}: +${delta} СЗ · ${reason}`);
        break;
      }
      case "armor_changed": {
        const hits = event.payload.changed.filter((c) => c.delta < 0).length;
        if (hits > 0) pushToast(`Броня просела у ${hits} героев`, GUILD_GOLD);
        break;
      }
      case "debuff_applied": {
        // Свисток обязан прозвучать на всех устройствах: звук + вибрация.
        alarm(event.payload.sound, event.payload.blasts ?? 1, event.payload.vibrate ?? [100]);
        if (event.payload.kind === "whistle") {
          setWhistle(event.payload.title ?? "СТОП-ИГРА");
        } else {
          pushToast(`Дебафф «мат»: ${event.payload.tree_delta}% Древа`, GUILD_EMBER);
        }
        break;
      }
      case "festival_ready": {
        pushToast(event.payload.message ?? "Фестиваль открыт", GUILD_GOLD);
        break;
      }
      default:
        break;
    }
  }, [pushToast]);

  const { state, tree, status } = useGuildLink({ token: auth?.token ?? null, onEvent });

  // Конфетти при переходе Древа через 70% — один раз за сессию.
  useEffect(() => {
    if (!tree) return;
    if (tree.percent >= 70 && !celebrated.current) {
      celebrated.current = true;
      setConfetti(true);
    }
    if (tree.percent < 70) celebrated.current = false;
  }, [tree]);

  const reloadCard = useCallback(async () => {
    if (!auth || auth.role !== "student") return;
    try {
      setCard(await api.heroCard(auth.token));
    } catch {
      // Карта подтянется на следующем событии — экран не ломаем.
    }
  }, [auth]);

  const reloadStudents = useCallback(async () => {
    if (!auth || auth.role !== "teacher") return;
    try {
      setStudents((await api.students(auth.token)).students);
    } catch {
      // См. выше: список обновится при следующем действии.
    }
  }, [auth]);

  useEffect(() => {
    if (!auth) return;
    void reloadCard();
    void reloadStudents();
    api.rules().then(setRules).catch(() => undefined);
  }, [auth, reloadCard, reloadStudents]);

  // Карта героя должна двигаться вместе с Алтарём.
  useEffect(() => { void reloadCard(); }, [state, reloadCard]);

  const login = (next: GuildAuth) => {
    saveAuth(next);
    setAuth(next);
    setTab("altar");
  };

  const logout = async () => {
    if (auth) await api.logout(auth.token).catch(() => undefined);
    clearAuth();
    setAuth(null);
    setCard(null);
    setStudents([]);
  };

  if (!auth) return <LoginForm onLogin={login} />;

  const tabs = isTeacher ? TEACHER_TABS : STUDENT_TABS;

  return (
    <div className="guild-root pb-24" onPointerDown={unlockAudio}>
      {whistle && <WhistleOverlay title={whistle} onDone={() => setWhistle(null)} />}
      {confetti && <Confetti onDone={() => setConfetti(false)} />}

      {/* Тосты */}
      <div className="fixed top-16 right-3 z-[110] space-y-2 guild-no-print">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="guild-rise px-3 py-2 rounded-xl font-rajdhani text-sm max-w-[16rem]"
            style={{ background: "rgba(12,18,15,0.94)", border: `1px solid ${toast.tone}55`, color: toast.tone }}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <header
        className="sticky top-0 z-[100] backdrop-blur-md guild-no-print"
        style={{ background: "rgba(12,18,15,0.92)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <span className="text-2xl">🌳</span>
          <div className="min-w-0">
            <div className="font-orbitron text-sm font-bold leading-tight">
              ГИЛЬДИЯ <span style={{ color: GUILD_GREEN }}>{auth.class_name}</span>
            </div>
            <div className="font-rajdhani text-[11px] truncate" style={{ color: "#7f9488" }}>
              {isTeacher ? "Хранитель Реестра" : auth.nickname}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ConnectionBadge status={status} />
            <button type="button" onClick={() => void logout()} aria-label="Выйти" className="p-2">
              <Icon name="LogOut" size={16} style={{ color: "#7f9488" }} />
            </button>
          </div>
        </div>

        <nav className="max-w-5xl mx-auto px-2 pb-2 flex gap-1 overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-orbitron text-[10px] shrink-0"
              style={{
                color: tab === item.id ? GUILD_GREEN : "#7f9488",
                background: tab === item.id ? `${GUILD_GREEN}15` : "transparent",
              }}
            >
              <Icon name={item.icon} size={12} />
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <InstallBanner />

        {tab === "altar" && (
          <Altar rows={state?.altar ?? []} tree={tree} myHeroId={auth.hero_id} />
        )}

        {tab === "hero" && (card
          ? <HeroCard card={card} onReload={() => void reloadCard()} />
          : <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>Разворачиваем карту героя…</p>)}

        {tab === "mail" && <QuietMail token={auth.token} onSent={() => void reloadCard()} />}

        {tab === "festival" && <FestivalView token={auth.token} canVote={!isTeacher} />}

        {isTeacher && tab === "award" && (
          <AwardPanel token={auth.token} students={students} rules={rules}
                      onDone={() => void reloadStudents()} />
        )}

        {isTeacher && tab === "attendance" && (
          <AttendancePanel token={auth.token} students={students}
                           onDone={() => void reloadStudents()} />
        )}

        {isTeacher && tab === "control" && (
          <ControlPanel token={auth.token} students={students}
                        festivalReady={tree?.festival_ready ?? false}
                        onDone={() => void reloadStudents()} />
        )}

        {isTeacher && tab === "map" && <GuildMapView token={auth.token} />}

        {isTeacher && tab === "roster" && (
          <RosterPanel token={auth.token} students={students}
                       onDone={() => void reloadStudents()} />
        )}

        {isTeacher && tab === "cards" && (
          <CardsSheet token={auth.token} className={auth.class_name} />
        )}
      </main>
    </div>
  );
}
