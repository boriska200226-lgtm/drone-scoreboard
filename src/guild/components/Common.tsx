import { useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import { useInstallPrompt } from "../pwa";
import { unlockAudio } from "../sound";
import {
  GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, NEON_CYAN, NEON_MAGENTA, NEON_VIOLET,
  TREE_TONE, neon, rankOf, ring,
} from "../theme";
import type { GuildAuth, LinkStatus, TreeState } from "../types";
import { useCountUp } from "../useCountUp";
import { HudCorners, RadialGauge, TreeArt } from "./art";

// ─── Значок связи ─────────────────────────────────────────────────────────────
const LINK_LABEL: Record<LinkStatus, { text: string; color: string; icon: string }> = {
  live: { text: "реальное время", color: NEON_CYAN, icon: "Zap" },
  connecting: { text: "подключение…", color: GUILD_GOLD, icon: "Loader" },
  polling: { text: "резервный канал", color: GUILD_GOLD, icon: "RefreshCw" },
  offline: { text: "нет связи", color: GUILD_EMBER, icon: "WifiOff" },
};

export function ConnectionBadge({ status }: { status: LinkStatus }) {
  const meta = LINK_LABEL[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-rajdhani text-[11px]"
      style={{
        background: `${meta.color}14`,
        border: `1px solid ${meta.color}55`,
        color: meta.color,
        boxShadow: `0 0 14px -4px ${meta.color}`,
      }}
      data-link-status={status}
      aria-label={`Связь: ${meta.text}`}
      title={
        status === "polling"
          ? "WebSocket недоступен — данные обновляются опросом раз в 5 секунд"
          : meta.text
      }
    >
      <span className="relative flex w-1.5 h-1.5">
        {status === "live" && (
          <span className="absolute inline-flex w-full h-full rounded-full animate-ping"
                style={{ background: meta.color, opacity: 0.8 }} />
        )}
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full"
              style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
      </span>
      {/* Когда всё хорошо, подпись на телефоне только занимает место.
          Как только связь просела — текст виден всегда: это уже важно. */}
      <span className={status === "live" ? "hidden sm:inline" : "inline"}>{meta.text}</span>
      {status === "connecting" && <Icon name="Loader" size={11} className="animate-spin sm:hidden" />}
    </span>
  );
}

// ─── Установка PWA ────────────────────────────────────────────────────────────
export function InstallBanner() {
  const { available, installed, manualIos, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  if (installed || dismissed || (!available && !manualIos)) return null;

  return (
    <div className="guild-panel guild-no-print px-4 py-3 flex items-center gap-3 guild-rise"
         style={ring(NEON_VIOLET, NEON_CYAN)}>
      <span className="text-2xl shrink-0">📲</span>
      <div className="flex-1 font-rajdhani text-sm">
        {manualIos ? (
          <>Добавь Гильдию на экран: «Поделиться» → «На экран “Домой”».</>
        ) : (
          <>Поставь Гильдию на устройство — откроется как приложение, без адресной строки.</>
        )}
      </div>
      {available && (
        <button
          type="button"
          onClick={() => void install()}
          className="guild-btn px-3 py-1.5 rounded-lg font-orbitron text-[11px] shrink-0"
          style={{ background: `linear-gradient(135deg, ${NEON_CYAN}, ${NEON_VIOLET})`,
                   color: "#05060f", boxShadow: `0 0 20px -6px ${NEON_CYAN}` }}
        >
          УСТАНОВИТЬ
        </button>
      )}
      <button type="button" onClick={() => setDismissed(true)} aria-label="Скрыть">
        <Icon name="X" size={16} style={{ color: "#7f93b8" }} />
      </button>
    </div>
  );
}

// ─── Свисток ──────────────────────────────────────────────────────────────────
export function WhistleOverlay({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 1700);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none overflow-hidden">
      <div className="absolute inset-0 guild-flash"
           style={{ background: `radial-gradient(circle at 50% 45%, ${GUILD_EMBER}, #3d0418)` }} />
      {/* Ударная волна: сигнал должен читаться боковым зрением через весь класс */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute rounded-full guild-shock"
          style={{
            width: "40vmin",
            height: "40vmin",
            border: "3px solid rgba(255,255,255,0.7)",
            boxShadow: `0 0 40px ${GUILD_EMBER}`,
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
      <div className="relative text-center guild-pop">
        <div className="text-6xl md:text-8xl mb-2">🔔</div>
        <div className="font-orbitron text-4xl md:text-6xl font-black"
             style={{ color: "#fff", textShadow: "0 0 40px #fff, 0 6px 30px rgba(0,0,0,0.6)",
                      letterSpacing: "0.06em" }}>
          {title}
        </div>
      </div>
    </div>
  );
}

// ─── Повышение уровня ─────────────────────────────────────────────────────────
/**
 * Момент, ради которого всё и затевалось.
 *
 * Уровень растёт редко, поэтому он не должен проскочить незамеченным строкой
 * в ленте: экран на секунду принадлежит только этому событию.
 */
export function LevelUpBanner({ level, onDone }: { level: number; onDone: () => void }) {
  const rank = rankOf(level);

  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center pointer-events-none px-6">
      {/* Затемнение почти в глухое: секунду экран принадлежит только новому уровню */}
      <div className="absolute inset-0"
           style={{ background: `radial-gradient(circle at 50% 45%, ${rank.color}2e, rgba(3,4,12,0.96) 62%)` }} />
      <div className="relative guild-pop text-center">
        <RadialGauge percent={100} color={rank.color} size={190} thickness={7} ticks={36}>
          <span className="font-orbitron text-[10px] tracking-[0.3em] mb-1"
                style={{ color: "#8fa3c8" }}>
            НОВЫЙ УРОВЕНЬ
          </span>
          <span className="font-orbitron text-6xl font-black neon-num" style={neon(rank.color)}>
            {level}
          </span>
          <span className="font-orbitron text-sm mt-2 neon-label" style={neon(rank.color)}>
            {rank.title}
          </span>
        </RadialGauge>
      </div>
    </div>
  );
}

// ─── Конфетти на 70% ──────────────────────────────────────────────────────────
export function Confetti({ onDone }: { onDone: () => void }) {
  const pieces = useMemo(
    () => Array.from({ length: 80 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      duration: 2.4 + Math.random() * 1.6,
      color: [NEON_CYAN, GUILD_GOLD, NEON_MAGENTA, GUILD_GREEN, NEON_VIOLET][i % 5],
      width: 6 + Math.random() * 6,
    })),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(onDone, 4600);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="guild-confetto"
          style={{
            left: `${p.left}%`,
            width: p.width,
            background: p.color,
            boxShadow: `0 0 10px ${p.color}`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Древо ────────────────────────────────────────────────────────────────────
const MILESTONES: { at: number; title: string; icon: string }[] = [
  { at: 50, title: "Плейлист класса", icon: "Music" },
  { at: 70, title: "Фестиваль", icon: "PartyPopper" },
  { at: 85, title: "Чит-код ×3", icon: "Wand2" },
  { at: 100, title: "Отмена проверочной", icon: "ShieldCheck" },
];

export function TreeMeter({ tree, compact = false }: { tree: TreeState; compact?: boolean }) {
  const tone = TREE_TONE[tree.color];
  const percent = useCountUp(tree.percent, 900);

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <TreeArt percent={tree.percent} color={tone} blinks={tree.blinks} height={54} />
        <div className="flex-1 min-w-0">
          <div className="h-2 rounded-full overflow-hidden"
               style={{ background: "rgba(143,163,200,0.16)" }}>
            <div className="h-full rounded-full transition-all duration-700"
                 style={{ width: `${tree.percent}%`, background: tone,
                          boxShadow: `0 0 12px ${tone}` }} />
          </div>
        </div>
        <span className="font-orbitron text-sm neon-label" style={neon(tone)}>{percent}%</span>
      </div>
    );
  }

  return (
    <section className="guild-panel hud-scan overflow-hidden" style={ring(tone, NEON_VIOLET)}>
      <span className="guild-rail" aria-hidden />
      <HudCorners />

      <div className="relative px-4 sm:px-6 pt-5 pb-4 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        {/* Дерево показывает, сколько выросло; кольцо — насколько близка цель */}
        <div className="flex items-center justify-center gap-3 sm:gap-5 shrink-0">
          <span className="hud-holo sm:hidden">
            <TreeArt percent={tree.percent} color={tone} blinks={tree.blinks} height={118} />
          </span>
          <span className="hud-holo hidden sm:block">
            <TreeArt percent={tree.percent} color={tone} blinks={tree.blinks} height={168} />
          </span>

          <span className="sm:hidden">
            <RadialGauge percent={tree.percent} color={tone} size={112} thickness={8}>
              <span className="font-orbitron text-3xl font-black neon-num" style={neon(tone)}>
                {percent}
              </span>
              <span className="font-orbitron text-[10px]" style={{ color: "#8fa3c8" }}>%</span>
            </RadialGauge>
          </span>
          <span className="hidden sm:inline-flex">
            <RadialGauge percent={tree.percent} color={tone} size={140} thickness={9}>
              <span className="font-orbitron text-4xl font-black neon-num" style={neon(tone)}>
                {percent}
              </span>
              <span className="font-orbitron text-[10px]" style={{ color: "#8fa3c8" }}>%</span>
            </RadialGauge>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="hud-title font-orbitron text-[10px] tracking-[0.24em]"
               style={{ color: "#8fa3c8" }}>
            ДРЕВО ГИЛЬДИИ
          </div>
          {/* Служебная строка прибора: цель и накопленные дебаффы одним взглядом */}
          <div className="hud-data text-[10px] mt-1.5" style={{ color: "#5d6f96" }}>
            TARGET {tree.class_target} · ΔDEBUFF {tree.adjust} · NEXT {tree.souls_to_festival}
          </div>
          <p className="font-rajdhani text-sm mt-1" style={{ color: "#a9bcdd" }}>
            <b className="neon-label" style={neon(GUILD_GREEN)}>{tree.total_souls}</b> СЗ собрано гильдией
            {tree.adjust < 0 && (
              <span style={{ color: GUILD_EMBER }}> · дебаффы {tree.adjust} п.п.</span>
            )}
          </p>

          {/* Рейка вех: видно, что уже взято и сколько до следующей награды */}
          <div className="relative mt-3 h-2.5 rounded-full overflow-hidden"
               style={{ background: "rgba(143,163,200,0.14)" }}>
            <div className={`h-full transition-all duration-1000 ${tree.blinks ? "guild-blink" : ""}`}
                 style={{ width: `${tree.percent}%`,
                          background: `linear-gradient(90deg, ${NEON_VIOLET}, ${tone})`,
                          boxShadow: `0 0 16px ${tone}` }} />
            {MILESTONES.map((m) => (
              <span key={m.at} className="absolute top-0 w-0.5 h-full"
                    style={{ left: `${m.at}%`,
                             background: tree.percent >= m.at
                               ? "rgba(255,255,255,0.9)" : "rgba(143,163,200,0.5)" }} />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {MILESTONES.map((m) => {
              const reached = tree.percent >= m.at;
              return (
                <span
                  key={m.at}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-rajdhani text-[11px] ${
                    reached ? "guild-pop" : ""
                  }`}
                  style={{
                    background: reached ? `${GUILD_GOLD}1a` : "rgba(143,163,200,0.06)",
                    border: `1px solid ${reached ? `${GUILD_GOLD}66` : "rgba(143,163,200,0.16)"}`,
                    color: reached ? GUILD_GOLD : "#6d7fa3",
                    boxShadow: reached ? `0 0 16px -6px ${GUILD_GOLD}` : "none",
                  }}
                >
                  <Icon name={reached ? m.icon : "Lock"} size={11} />
                  {m.at}% · {m.title}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="relative px-4 sm:px-6 py-3 font-rajdhani text-sm"
              style={{ borderTop: "1px solid rgba(143,163,200,0.14)",
                       background: tree.festival_ready
                         ? `linear-gradient(90deg, ${GUILD_GREEN}14, transparent)`
                         : "rgba(255,255,255,0.02)" }}>
        {tree.festival_ready ? (
          <span style={{ color: GUILD_GREEN }}>
            🎪 Древо доросло до Фестиваля. Печенье заслужено.
          </span>
        ) : tree.color === "gray" ? (
          <span style={{ color: GUILD_EMBER }}>
            ⚔️ Древо ниже 50% — гильдия идёт в Рейд, печенья не будет.
          </span>
        ) : (
          <span style={{ color: "#a9bcdd" }}>
            До Фестиваля осталось{" "}
            <b className="neon-label" style={neon(GUILD_GOLD)}>{tree.souls_to_festival} СЗ</b>
            {" "}на всю гильдию
          </span>
        )}
      </footer>
    </section>
  );
}

// ─── Вход ─────────────────────────────────────────────────────────────────────
export function LoginForm({ onLogin }: { onLogin: (auth: GuildAuth) => void }) {
  // QR с карточки ведёт на /guild?login=s_7b_07 — логин подставляем сами,
  // ребёнку остаётся набрать только пароль.
  const [login, setLogin] = useState(
    () => new URLSearchParams(window.location.search).get("login") ?? "",
  );
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!login || !password) {
      setError("Введи логин и пароль с карточки");
      return;
    }
    setBusy(true);
    setError("");
    // Первое касание экрана — момент, когда браузер разрешает звук.
    unlockAudio();
    try {
      onLogin(await api.login(login.trim(), password, totp.trim() || undefined));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Не удалось войти";
      if (/2FA|фактор/i.test(message)) setNeedsTotp(true);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-xl px-4 py-3 font-rajdhani text-base outline-none transition-colors focus:border-cyan-400/60";
  const fieldStyle = {
    background: "rgba(143,163,200,0.07)",
    border: "1px solid rgba(143,163,200,0.22)",
    color: "#e6f0ff",
  };

  return (
    <div className="guild-root flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="hud-horizon" aria-hidden />

      {/* Древо на фоне: первый экран должен объяснять, куда ты попал */}
      <div className="absolute inset-0 flex items-end justify-center pointer-events-none"
           style={{ opacity: 0.16 }} aria-hidden>
        <TreeArt percent={100} color={NEON_CYAN} height={540} />
      </div>

      <div className="relative w-full max-w-sm space-y-6 guild-rise">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-4 guild-pop">
            <RadialGauge percent={100} color={NEON_CYAN} size={96} thickness={5} ticks={30}>
              <TreeArt percent={100} color={NEON_CYAN} height={48} />
            </RadialGauge>
          </div>
          <h1 className="font-orbitron text-4xl font-black neon-num" style={{
            ...neon(NEON_CYAN), letterSpacing: "0.14em",
          }}>
            ГИЛЬДИЯ
          </h1>
          <p className="hud-data hud-cursor text-[11px] mt-2" style={{ color: "#5d6f96" }}>
            SYS//GUILD · ЗДЕСЬ НЕТ ИМЁН, ТОЛЬКО КЛИЧКИ
          </p>
        </div>

        <div className="guild-panel hud-scan p-6 space-y-4 relative" style={ring(NEON_CYAN, NEON_MAGENTA)}>
          <span className="guild-rail" aria-hidden />
          <HudCorners />

          <div>
            <label className="block text-[10px] font-orbitron tracking-[0.18em] mb-2"
                   style={{ color: "#8fa3c8" }}>
              ЛОГИН
            </label>
            <input
              className={field}
              style={fieldStyle}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="s_7b_01"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>

          <div>
            <label className="block text-[10px] font-orbitron tracking-[0.18em] mb-2"
                   style={{ color: "#8fa3c8" }}>
              ПАРОЛЬ
            </label>
            <input
              className={field}
              style={fieldStyle}
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>

          {needsTotp && (
            <div className="guild-rise">
              <label className="block text-[10px] font-orbitron tracking-[0.18em] mb-2"
                     style={{ color: GUILD_GOLD }}>
                КОД ХРАНИТЕЛЯ (2FA)
              </label>
              <input
                className={field}
                style={fieldStyle}
                inputMode="numeric"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
            </div>
          )}

          {error && (
            <p className="flex items-center gap-2 font-rajdhani text-xs" style={{ color: GUILD_EMBER }}>
              <Icon name="AlertCircle" size={12} />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="guild-btn w-full py-3.5 rounded-xl font-orbitron text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: `linear-gradient(120deg, ${NEON_CYAN}, ${NEON_VIOLET} 60%, ${NEON_MAGENTA})`,
                     color: "#05060f", boxShadow: `0 12px 34px -12px ${NEON_CYAN}` }}
          >
            {busy ? <Icon name="Loader" size={16} className="animate-spin" /> : <Icon name="LogIn" size={16} />}
            ВОЙТИ В ГИЛЬДИЮ
          </button>
        </div>

        <p className="text-center font-rajdhani text-xs" style={{ color: "#6d7fa3" }}>
          Логин и пароль выдаёт Хранитель Реестра на бумажной карточке
        </p>
      </div>
    </div>
  );
}
