import { useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import { useInstallPrompt } from "../pwa";
import { unlockAudio } from "../sound";
import { GUILD_EMBER, GUILD_GOLD, GUILD_GREEN } from "../theme";
import type { GuildAuth, LinkStatus, TreeState } from "../types";

// ─── Значок связи ─────────────────────────────────────────────────────────────
const LINK_LABEL: Record<LinkStatus, { text: string; color: string; icon: string }> = {
  live: { text: "реальное время", color: GUILD_GREEN, icon: "Zap" },
  connecting: { text: "подключение…", color: GUILD_GOLD, icon: "Loader" },
  polling: { text: "резервный канал", color: GUILD_GOLD, icon: "RefreshCw" },
  offline: { text: "нет связи", color: GUILD_EMBER, icon: "WifiOff" },
};

export function ConnectionBadge({ status }: { status: LinkStatus }) {
  const meta = LINK_LABEL[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-rajdhani text-[11px]"
      style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}40`, color: meta.color }}
      title={
        status === "polling"
          ? "WebSocket недоступен — данные обновляются опросом раз в 5 секунд"
          : undefined
      }
    >
      <Icon name={meta.icon} size={11} className={status === "connecting" ? "animate-spin" : ""} />
      {meta.text}
    </span>
  );
}

// ─── Установка PWA ────────────────────────────────────────────────────────────
export function InstallBanner() {
  const { available, installed, manualIos, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  if (installed || dismissed || (!available && !manualIos)) return null;

  return (
    <div className="guild-panel guild-no-print px-4 py-3 flex items-center gap-3 guild-rise">
      <Icon name="Download" size={18} style={{ color: GUILD_GREEN }} />
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
          className="px-3 py-1.5 rounded-lg font-orbitron text-[11px]"
          style={{ background: GUILD_GREEN, color: "#0c120f" }}
        >
          УСТАНОВИТЬ
        </button>
      )}
      <button type="button" onClick={() => setDismissed(true)} aria-label="Скрыть">
        <Icon name="X" size={16} style={{ color: "#7f9488" }} />
      </button>
    </div>
  );
}

// ─── Свисток ──────────────────────────────────────────────────────────────────
export function WhistleOverlay({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 guild-flash" style={{ background: GUILD_EMBER }} />
      <div
        className="relative font-orbitron text-4xl md:text-6xl font-black guild-rise"
        style={{ color: "#fff", textShadow: "0 0 30px rgba(0,0,0,0.6)" }}
      >
        {title}
      </div>
    </div>
  );
}

// ─── Конфетти на 70% ──────────────────────────────────────────────────────────
export function Confetti({ onDone }: { onDone: () => void }) {
  const pieces = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 2.2 + Math.random() * 1.4,
      color: [GUILD_GREEN, GUILD_GOLD, "#8fd8ff", "#ffffff"][i % 4],
    })),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(onDone, 4200);
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
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Древо ────────────────────────────────────────────────────────────────────
const TREE_TONE: Record<TreeState["color"], string> = {
  gray: "#6b7a72",
  blue: "#5aa9e6",
  yellow: GUILD_GOLD,
  green: GUILD_GREEN,
};

export function TreeMeter({ tree, compact = false }: { tree: TreeState; compact?: boolean }) {
  const tone = TREE_TONE[tree.color];
  return (
    <div className={compact ? "" : "guild-panel p-4"}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-orbitron text-xs tracking-[0.18em]" style={{ color: "#9db3a6" }}>
          ДРЕВО ГИЛЬДИИ
        </span>
        <span className="font-orbitron text-xl font-bold" style={{ color: tone }}>
          {tree.percent}%
        </span>
      </div>

      <div
        className={`h-3 rounded-full overflow-hidden ${tree.blinks ? "guild-blink" : ""}`}
        style={{ background: "rgba(255,255,255,0.07)" }}
        role="progressbar"
        aria-valuenow={tree.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Древо гильдии"
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${tree.percent}%`, background: tone, boxShadow: `0 0 12px ${tone}80` }}
        />
      </div>

      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2">
          {[50, 70, 85, 100].map((mark) => {
            const reached = tree.percent >= mark;
            const title = tree.bonuses.find((b) => b.threshold === mark)?.title
              ?? { 50: "Плейлист класса", 70: "Фестиваль", 85: "Чит-код ×3", 100: "Отмена проверочной" }[mark];
            return (
              <span
                key={mark}
                className="px-2 py-1 rounded-lg font-rajdhani text-[11px]"
                style={{
                  background: reached ? `${GUILD_GREEN}18` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${reached ? `${GUILD_GREEN}44` : "rgba(255,255,255,0.07)"}`,
                  color: reached ? GUILD_GREEN : "#6b7a72",
                }}
              >
                {reached ? "✓" : "🔒"} {mark}% · {title}
              </span>
            );
          })}
        </div>
      )}

      {tree.color === "gray" && !compact && (
        <p className="mt-3 font-rajdhani text-xs" style={{ color: GUILD_EMBER }}>
          Древо ниже 50% — гильдия идёт в Рейд, печенья не будет.
        </p>
      )}
    </div>
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

  const field = "w-full rounded-xl px-4 py-3 font-rajdhani text-base outline-none";
  const fieldStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#e8f5ee",
  };

  return (
    <div className="guild-root flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 guild-rise">
        <div className="text-center">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
            style={{ background: "#2b4b3b", border: `1px solid ${GUILD_GREEN}44` }}
          >
            🌳
          </div>
          <h1 className="font-orbitron text-3xl font-black" style={{ letterSpacing: "0.12em" }}>
            ГИЛЬДИЯ
          </h1>
          <p className="font-rajdhani mt-2" style={{ color: "#9db3a6" }}>
            Здесь нет имён — только клички
          </p>
        </div>

        <div className="guild-panel p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-orbitron tracking-[0.18em] mb-2"
                   style={{ color: "#9db3a6" }}>
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
                   style={{ color: "#9db3a6" }}>
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
            <div>
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
            className="w-full py-3.5 rounded-xl font-orbitron text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: GUILD_GREEN, color: "#0c120f" }}
          >
            {busy ? <Icon name="Loader" size={16} className="animate-spin" /> : <Icon name="LogIn" size={16} />}
            ВОЙТИ В ГИЛЬДИЮ
          </button>
        </div>

        <p className="text-center font-rajdhani text-xs" style={{ color: "#6b7a72" }}>
          Логин и пароль выдаёт Хранитель Реестра на бумажной карточке
        </p>
      </div>
    </div>
  );
}
