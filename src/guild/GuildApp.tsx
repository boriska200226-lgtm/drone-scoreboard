import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, clearAuth, loadAuth, saveAuth } from "./api";
import { HeroAvatar, TreeArt } from "./components/art";
import {
  Confetti, ConnectionBadge, InstallBanner, LevelUpBanner, LoginForm, WhistleOverlay,
} from "./components/Common";
import CardsSheet from "./components/Cards";
import { Altar, FestivalView, HeroCard, QuietMail } from "./components/StudentViews";
import {
  AttendancePanel, AwardPanel, ControlPanel, GuildMapView, RosterPanel,
} from "./components/TeacherViews";
import { alarm, unlockAudio } from "./sound";
import {
  GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, NEON_CYAN, NEON_VIOLET, neon,
} from "./theme";
import type { GameRules, GuildAuth, GuildEvent, HeroCardData, StudentRow } from "./types";
import { useGuildLink } from "./ws";

interface Tab {
  id: string;
  label: string;
  icon: string;
}

const STUDENT_TABS: Tab[] = [
  { id: "altar", label: "АЛТАРЬ", icon: "Flame" },
  { id: "hero", label: "ГЕРОЙ", icon: "Swords" },
  { id: "mail", label: "ПОЧТА", icon: "Mail" },
  { id: "festival", label: "ФЕСТИВАЛЬ", icon: "PartyPopper" },
];

const TEACHER_TABS: Tab[] = [
  { id: "altar", label: "АЛТАРЬ", icon: "Flame" },
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
  icon: string;
  amount?: number;
}

export default function GuildApp() {
  const [auth, setAuth] = useState<GuildAuth | null>(() => loadAuth());
  const [tab, setTab] = useState("altar");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [whistle, setWhistle] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const [shake, setShake] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [card, setCard] = useState<HeroCardData | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rules, setRules] = useState<GameRules | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const celebrated = useRef(false);
  const lastLevel = useRef<number | null>(null);
  const toastId = useRef(0);

  const isTeacher = auth?.role === "teacher";

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const onEvent = useCallback((event: GuildEvent) => {
    switch (event.event) {
      case "souls_updated": {
        const { nickname, delta, reason } = event.payload;
        pushToast({ text: `${nickname ?? "Герой"} · ${reason}`, tone: GUILD_GREEN,
                    icon: "Sparkles", amount: delta });
        break;
      }
      case "armor_changed": {
        const hits = event.payload.changed.filter((c) => c.delta < 0).length;
        if (hits > 0) {
          pushToast({ text: `Броня просела у ${hits} героев`, tone: GUILD_GOLD, icon: "ShieldAlert" });
        }
        break;
      }
      case "debuff_applied": {
        // Свисток обязан прозвучать на всех устройствах: звук + вибрация.
        alarm(event.payload.sound, event.payload.blasts ?? 1, event.payload.vibrate ?? [100]);
        if (event.payload.kind === "whistle") {
          setWhistle(event.payload.title ?? "СТОП-ИГРА");
          setGlitch(true);
          window.setTimeout(() => setGlitch(false), 700);
        } else {
          setShake(true);
          window.setTimeout(() => setShake(false), 600);
          pushToast({ text: `Дебафф «мат»: ${event.payload.tree_delta}% Древа`,
                      tone: GUILD_EMBER, icon: "ShieldOff" });
        }
        break;
      }
      case "festival_ready": {
        pushToast({ text: event.payload.message ?? "Фестиваль открыт", tone: GUILD_GOLD,
                    icon: "PartyPopper" });
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

  // Повышение уровня показываем один раз, и только когда он вырос:
  // при первой загрузке карты салют был бы фальшивым.
  useEffect(() => {
    if (!card) return;
    const previous = lastLevel.current;
    lastLevel.current = card.level;
    if (previous !== null && card.level > previous) {
      setLevelUp(card.level);
      setConfetti(true);
    }
  }, [card]);

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
    lastLevel.current = null;
  };

  if (!auth) return <LoginForm onLogin={login} />;

  const tabs = isTeacher ? TEACHER_TABS : STUDENT_TABS;
  // Четыре вкладки ученика живут внизу экрана, как в обычном приложении;
  // восемь вкладок учителя внизу не помещаются и остаются наверху.
  const bottomNav = tabs.length <= 5;
  const myRow = state?.altar.find((row) => row.hero_id === auth.hero_id) ?? null;
  const myPlace = state?.altar.findIndex((row) => row.hero_id === auth.hero_id) ?? -1;

  return (
    <div className={`guild-root ${bottomNav ? "pb-24" : "pb-10"} ${shake ? "guild-shake" : ""}`
           + `${glitch ? " hud-glitch" : ""}`}
         onPointerDown={unlockAudio}>
      <div className="hud-horizon guild-no-print" aria-hidden />
      {whistle && <WhistleOverlay title={whistle} onDone={() => setWhistle(null)} />}
      {levelUp !== null && <LevelUpBanner level={levelUp} onDone={() => setLevelUp(null)} />}
      {confetti && <Confetti onDone={() => setConfetti(false)} />}

      {/* Тосты */}
      <div className="fixed top-16 right-3 z-[110] space-y-2 guild-no-print">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="guild-slide-in flex items-center gap-2.5 px-3 py-2 rounded-xl max-w-[17rem]"
            style={{ background: "rgba(8,11,28,0.95)", border: `1px solid ${toast.tone}66`,
                     boxShadow: `0 0 26px -10px ${toast.tone}, 0 12px 30px -16px #000` }}
          >
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${toast.tone}1c` }}>
              <Icon name={toast.icon} size={14}
                    style={{ color: toast.tone, filter: `drop-shadow(0 0 6px ${toast.tone})` }} />
            </span>
            <span className="font-rajdhani text-sm flex-1 min-w-0 truncate"
                  style={{ color: "#e6f0ff" }}>
              {toast.text}
            </span>
            {toast.amount !== undefined && (
              <span className="font-orbitron text-base shrink-0 neon-num" style={neon(toast.tone)}>
                +{toast.amount}
              </span>
            )}
          </div>
        ))}
      </div>

      <header
        className="sticky top-0 z-[100] backdrop-blur-md guild-no-print"
        style={{ background: "rgba(5,7,20,0.88)",
                 borderBottom: "1px solid rgba(0,229,255,0.18)",
                 boxShadow: "0 12px 40px -30px #000, 0 1px 0 rgba(0,229,255,0.08)" }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <span className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl"
                style={{ background: "linear-gradient(160deg, #13224a, #070a1c)",
                         border: `1px solid ${NEON_CYAN}44`,
                         boxShadow: `0 0 18px -6px ${NEON_CYAN}` }}>
            <TreeArt percent={tree?.percent ?? 0} color={NEON_CYAN} height={30} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="font-orbitron text-sm font-bold leading-tight">
              ГИЛЬДИЯ{" "}
              <span className="neon-label" style={neon(NEON_CYAN)}>{auth.class_name}</span>
            </div>
            <div className="hud-data text-[10px] truncate" style={{ color: "#5d6f96" }}>
              {isTeacher ? (
                <>KEEPER · CLS {auth.class_name.toUpperCase()}</>
              ) : (
                <>
                  <span style={{ color: "#a9bcdd" }}>{auth.nickname}</span>
                  {myPlace >= 0 && (
                    <span style={{ color: GUILD_GOLD }}>
                      {" "}· RANK {String(myPlace + 1).padStart(2, "0")}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <ConnectionBadge status={status} />

          {!isTeacher && myRow && (
            <button type="button" onClick={() => setTab("hero")} className="guild-btn shrink-0"
                    aria-label="Моя карта героя">
              <HeroAvatar avatar={myRow.avatar} nickname={myRow.nickname} branch={myRow.branch}
                          size={34} />
            </button>
          )}

          <button type="button" onClick={() => void logout()} aria-label="Выйти" className="p-1.5 shrink-0">
            <Icon name="LogOut" size={16} style={{ color: "#7f93b8" }} />
          </button>
        </div>

        {!bottomNav && (
          <nav className="max-w-5xl mx-auto px-2 pb-2 flex gap-1 overflow-x-auto">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className="guild-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-orbitron text-[10px] shrink-0"
                style={tab === item.id
                  ? { color: "#05060f",
                      background: `linear-gradient(120deg, ${NEON_CYAN}, ${NEON_VIOLET})`,
                      boxShadow: `0 0 20px -6px ${NEON_CYAN}` }
                  : { color: "#7f93b8", background: "rgba(143,163,200,0.07)",
                      border: "1px solid rgba(143,163,200,0.14)" }}
              >
                <Icon name={item.icon} size={12} />
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <InstallBanner />

        {tab === "altar" && (
          <Altar rows={state?.altar ?? []} tree={tree} myHeroId={auth.hero_id} />
        )}

        {tab === "hero" && (card
          ? <HeroCard card={card} token={auth.token} place={myPlace >= 0 ? myPlace + 1 : null}
                      onReload={() => void reloadCard()} />
          : <p className="font-rajdhani text-sm" style={{ color: "#6d7fa3" }}>
              Разворачиваем карту героя…
            </p>)}

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

      {bottomNav && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-[100] guild-no-print backdrop-blur-md"
          style={{
            background: "rgba(5,7,20,0.95)",
            borderTop: `1px solid ${NEON_CYAN}2e`,
            boxShadow: `0 -14px 40px -30px ${NEON_CYAN}`,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="max-w-md mx-auto grid grid-cols-4">
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className="relative flex flex-col items-center gap-1 py-2.5"
                  style={{ color: active ? NEON_CYAN : "#6d7fa3" }}
                >
                  {active && (
                    <>
                      <span className="absolute top-0 w-10 h-[3px] rounded-b-full"
                            style={{ background: `linear-gradient(90deg, ${NEON_VIOLET}, ${NEON_CYAN})`,
                                     boxShadow: `0 0 16px ${NEON_CYAN}` }} />
                      <span className="absolute inset-x-3 inset-y-1 rounded-xl -z-10"
                            style={{ background: `radial-gradient(60% 70% at 50% 0%, ${NEON_CYAN}22, transparent)` }} />
                    </>
                  )}
                  <Icon name={item.icon} size={19}
                        style={active ? { filter: `drop-shadow(0 0 8px ${NEON_CYAN})` } : undefined} />
                  <span className="font-orbitron text-[9px] tracking-wider">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
