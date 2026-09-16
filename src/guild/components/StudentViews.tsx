import { useCallback, useEffect, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import {
  AVATARS, BRANCH_THEME, GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, NEON_CYAN,
  NEON_VIOLET, SHIELD_THEME, avatarOf, neon, rankOf, ring,
} from "../theme";
import type { AltarRow, FestivalForecast, HeroCardData, Sticker, TreeState } from "../types";
import { useCountUp } from "../useCountUp";
import { BranchSigil, HeroAvatar, HudCorners, Medal, RadialGauge, RankBadge, ShieldBadge } from "./art";
import { TreeMeter } from "./Common";
import ProgressBar from "./ProgressBar";

// ─── Алтарь ───────────────────────────────────────────────────────────────────
function PodiumCard({ row, place, mine }: { row: AltarRow; place: number; mine: boolean }) {
  const tone = BRANCH_THEME[row.branch];
  const rank = rankOf(row.level);
  // Первое место стоит выше остальных — подиум должен читаться силуэтом.
  const lift = place === 1 ? "sm:-translate-y-4" : "";

  return (
    <article
      className={`guild-panel hud-scan relative px-3 pt-7 pb-4 text-center guild-pop transition-transform ${lift}`}
      style={{
        ...ring(place === 1 ? GUILD_GOLD : tone.color, place === 1 ? tone.color : NEON_VIOLET),
        animationDelay: `${place * 90}ms`,
      }}
    >
      {place === 1 && <span className="guild-rail" aria-hidden />}
      <span className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Medal place={place} size={30} />
      </span>

      {/* Кольцо вокруг облика: видно вклад героя в свою ветку */}
      <div className="flex justify-center mb-2">
        <RadialGauge percent={row.branch_percent} color={tone.color}
                     size={place === 1 ? 84 : 72} thickness={4} ticks={18}>
          <HeroAvatar avatar={row.avatar} nickname={row.nickname} branch={row.branch}
                      size={place === 1 ? 56 : 48} />
        </RadialGauge>
      </div>

      <h3 className="font-orbitron text-sm font-bold truncate">{row.nickname}</h3>
      <p className="font-rajdhani text-[11px] truncate neon-label" style={neon(rank.color)}>
        {rank.title}
      </p>

      <div className="mt-2 flex items-center justify-center gap-2">
        <BranchSigil branch={row.branch} size={15} />
        <span className="font-orbitron text-lg neon-num" style={neon(GUILD_GREEN)}>
          {row.souls}
        </span>
        <span className="font-rajdhani text-[11px]" style={{ color: "#6d7fa3" }}>СЗ</span>
      </div>

      {mine && (
        <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded font-rajdhani"
              style={{ background: `${GUILD_GREEN}22`, color: GUILD_GREEN }}>
          ты
        </span>
      )}
    </article>
  );
}

export function Altar({ rows, tree, myHeroId }: {
  rows: AltarRow[];
  tree: TreeState | null;
  myHeroId: number | null;
}) {
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="space-y-4">
      {tree && <TreeMeter tree={tree} />}

      {podium.length === 3 && (
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4 sm:pt-4 items-end max-w-2xl mx-auto">
          {/* Порядок на экране: 2 — 1 — 3, как на настоящем пьедестале */}
          {[podium[1], podium[0], podium[2]].map((row, i) => (
            <PodiumCard key={row.hero_id} row={row} place={[2, 1, 3][i]}
                        mine={row.hero_id === myHeroId} />
          ))}
        </div>
      )}

      <div className="guild-panel overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between"
             style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="hud-title font-orbitron text-sm tracking-[0.16em] flex items-center gap-2">
            <Icon name="Flame" size={15} style={{ color: GUILD_GOLD }} />
            АЛТАРЬ
          </h2>
          <span className="hud-data text-[10px]" style={{ color: "#5d6f96" }}>
            UNITS {String(rows.length).padStart(2, "0")} · NO NAMES
          </span>
        </div>

        {/* Шапка таблицы только на широком экране: на телефоне строка
            складывается в три этажа, и подписи столбцов теряют смысл. */}
        <div className="guild-altar-head guild-altar-row px-4 py-2 font-orbitron text-[10px] tracking-[0.14em]"
             style={{ color: "#6d7fa3" }}>
          <span className="guild-altar-face" />
          <span className="guild-altar-name">КЛИЧКА</span>
          <span className="guild-altar-level">УР.</span>
          <span className="guild-altar-meta">ВЕТКА</span>
          <span className="guild-altar-bar">ВКЛАД В ВЕТКУ</span>
          <span className="guild-altar-shield text-right">ЩИТ</span>
        </div>

        <ul>
          {(podium.length === 3 ? rest : rows).map((row, index) => {
            const place = (podium.length === 3 ? 4 : 1) + index;
            const mine = row.hero_id === myHeroId;
            const tone = BRANCH_THEME[row.branch];
            const rank = rankOf(row.level);
            return (
              <li
                key={row.hero_id}
                className="guild-altar-item guild-altar-row px-4 py-2.5"
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  background: mine ? `${GUILD_GREEN}0d` : undefined,
                  borderLeft: row.shield === "bleeding"
                    ? `3px solid ${SHIELD_THEME.bleeding.color}`
                    : `3px solid ${mine ? GUILD_GREEN : "transparent"}`,
                }}
              >
                <span className="guild-altar-face flex items-center gap-2">
                  <span className="hud-data text-[10px] w-6 text-right shrink-0"
                        style={{ color: "#5d6f96" }}>
                    {String(place).padStart(2, "0")}
                  </span>
                  <HeroAvatar avatar={row.avatar} nickname={row.nickname} branch={row.branch}
                              size={34} dimmed={row.shield === "bleeding"} />
                </span>

                <span className="guild-altar-name font-rajdhani font-semibold flex items-center gap-2">
                  <span className="truncate">{row.nickname}</span>
                  {mine && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: `${GUILD_GREEN}22`, color: GUILD_GREEN }}>
                      ты
                    </span>
                  )}
                  {row.weakness && (
                    <Icon name="HeartCrack" size={12} style={{ color: GUILD_GOLD }} />
                  )}
                </span>

                <span className="guild-altar-level font-orbitron text-sm" style={{ color: rank.color }}>
                  {row.level}
                </span>

                <span className="guild-altar-meta font-rajdhani text-xs flex items-center gap-1.5">
                  <BranchSigil branch={row.branch} size={14} />
                  <span className="truncate" style={{ color: tone.color }}>{row.branch_title}</span>
                  <span className="md:hidden" style={{ color: "#6d7fa3" }}>
                    · {rank.title}
                  </span>
                </span>

                <span className="guild-altar-bar h-2 rounded-full overflow-hidden"
                      style={{ background: "rgba(143,163,200,0.14)" }}
                      title={`Вклад в ветку: ${row.branch_percent}%`}>
                  <span
                    className="block h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.max(3, row.branch_percent)}%`,
                             background: `linear-gradient(90deg, ${NEON_VIOLET}, ${tone.color})`,
                             boxShadow: `0 0 12px ${tone.color}` }}
                  />
                </span>

                <span className="guild-altar-shield">
                  <ShieldBadge shield={row.shield} armor={row.armor} size={24} />
                </span>
              </li>
            );
          })}
        </ul>

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center font-rajdhani text-sm" style={{ color: "#6d7fa3" }}>
            Гильдия пуста — Хранитель ещё не создал героев.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Карта героя ──────────────────────────────────────────────────────────────
const ACTION_META: Record<string, { title: string; icon: string }> = {
  kind_word: { title: "Доброе слово", icon: "Heart" },
  translate_mat: { title: "Перевод мата", icon: "Languages" },
  help_three: { title: "Помощь троим", icon: "HandHeart" },
  hand_raise: { title: "Поднятая рука", icon: "Hand" },
  cheat_code: { title: "Чит-код «было трудно»", icon: "Wand2" },
  quiet_mail: { title: "Тихая почта", icon: "Mail" },
};

const BAR_ICON: Record<string, string> = {
  level: "Star",
  tactics: "Swords",
  armor: "Shield",
  mana: "Sparkles",
};

function AvatarPicker({ current, onPick, onClose }: {
  current: string;
  onPick: (avatar: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[115] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
         style={{ background: "rgba(4,8,6,0.75)" }} onClick={onClose}>
      <div className="guild-panel w-full max-w-sm p-5 guild-rise"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-orbitron text-sm tracking-[0.16em]">ОБЛИК ГЕРОЯ</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="X" size={18} style={{ color: "#7f93b8" }} />
          </button>
        </div>
        <p className="font-rajdhani text-xs mb-4" style={{ color: "#7f93b8" }}>
          Кличка и ветка остаются навсегда. Облик — единственное, что ты меняешь сам.
        </p>
        <div className="grid grid-cols-6 gap-2">
          {AVATARS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="guild-btn aspect-square rounded-xl text-2xl flex items-center justify-center"
              style={{
                background: current === emoji ? `${GUILD_GREEN}20` : "rgba(255,255,255,0.04)",
                border: `1px solid ${current === emoji ? `${GUILD_GREEN}77` : "rgba(255,255,255,0.07)"}`,
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeroCard({ card, place, token, onReload }: {
  card: HeroCardData;
  place: number | null;
  token: string;
  onReload: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const tone = BRANCH_THEME[card.branch];
  const rank = rankOf(card.level);
  const souls = useCountUp(card.souls);
  const armorBar = card.bars.find((b) => b.id === "armor");
  const levelBar = card.bars.find((b) => b.id === "level")?.value ?? 0;
  const bleeding = (armorBar?.value ?? 1) <= 0;

  const pick = async (emoji: string) => {
    setPicking(false);
    try {
      await api.setAvatar(token, emoji);
      onReload();
    } catch {
      // Облик не сохранился — не повод ломать экран, попробует ещё раз.
    }
  };

  return (
    <div className="space-y-4">
      {picking && (
        <AvatarPicker current={avatarOf(card.avatar, card.nickname)}
                      onPick={(e) => void pick(e)} onClose={() => setPicking(false)} />
      )}

      {/* Знамя героя */}
      <section className="guild-panel hud-scan overflow-hidden guild-rise relative"
               style={bleeding
                 ? ring(SHIELD_THEME.bleeding.color, GUILD_EMBER)
                 : ring(tone.color, NEON_CYAN)}>
        <span className="guild-rail" aria-hidden />
        <HudCorners />
        <div className="relative px-5 py-5"
             style={{ background: `linear-gradient(135deg, ${tone.soft}, transparent 65%)` }}>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setPicking(true)}
                    className="guild-btn relative shrink-0" aria-label="Сменить облик">
              {/* Кольцо показывает опыт внутри текущего уровня */}
              <RadialGauge percent={levelBar} color={rank.color} size={92} thickness={5} ticks={20}>
                <HeroAvatar avatar={card.avatar} nickname={card.nickname} branch={card.branch}
                            size={64} />
              </RadialGauge>
              <span className="absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: "#0a0e22", border: `1px solid ${tone.color}88`,
                             boxShadow: `0 0 12px -2px ${tone.color}` }}>
                <Icon name="Pencil" size={11} style={{ color: tone.color }} />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <h2 className="font-orbitron text-2xl font-black truncate leading-tight">
                {card.nickname}
              </h2>
              <p className="font-rajdhani text-sm flex items-center gap-2 flex-wrap">
                <span style={{ color: rank.color }}>{rank.title}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                      style={{ background: tone.soft, color: tone.color }}>
                  <BranchSigil branch={card.branch} size={13} />
                  {card.branch_title}
                </span>
              </p>
              <p className="font-rajdhani text-xs italic mt-0.5" style={{ color: "#6d7fa3" }}>
                «{tone.motto}»
              </p>
            </div>

            <div className="shrink-0 flex flex-col items-center gap-1">
              <RankBadge level={card.level} size={46} />
              <ShieldBadge shield={card.shield} armor={armorBar?.value ?? 0} size={22} />
            </div>
          </div>

          {/* Три цифры, которые ребёнок проверяет первыми */}
          <div className="grid grid-cols-3 gap-2 mt-5">
            {[
              { label: "СЗ", value: souls, color: GUILD_GREEN },
              { label: "УРОВЕНЬ", value: card.level, color: rank.color },
              { label: "МЕСТО", value: place ? `#${place}` : "—", color: GUILD_GOLD },
            ].map((stat) => (
              <div key={stat.label} className="guild-panel-flat px-2 py-2 text-center"
                   style={{ borderColor: `${stat.color}44`, boxShadow: `0 0 20px -12px ${stat.color}` }}>
                <div className="font-orbitron text-xl font-bold tabular-nums neon-num"
                     style={neon(stat.color)}>
                  {stat.value}
                </div>
                <div className="font-orbitron text-[9px] tracking-[0.16em]"
                     style={{ color: "#6d7fa3" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 pb-5 space-y-2">
          {card.bars.map((bar) => (
            <ProgressBar
              key={bar.id}
              label={bar.label}
              value={bar.value}
              max={bar.max}
              color={bar.color}
              hint={bar.hint}
              icon={BAR_ICON[bar.id]}
              bleeding={bar.id === "armor" && bar.value <= 0}
              blink={bar.id !== "armor" && bar.value / bar.max >= 0.65 && bar.value / bar.max <= 0.75}
              bonusIcon={bar.id === "tactics" && bar.value >= 80 ? "Sparkles" : undefined}
              bonusTitle="Бонус ветки открыт при 80%"
            />
          ))}
        </div>

        {(card.debuffed || card.weakness) && (
          <div className="px-5 pb-4 space-y-1.5">
            {card.debuffed && (
              <p className="flex items-center gap-2 font-rajdhani text-xs" style={{ color: GUILD_EMBER }}>
                <Icon name="AlertTriangle" size={13} />
                Дебафф активен до {new Date(card.debuff_until ?? "").toLocaleString("ru-RU")}
              </p>
            )}
            {card.weakness && (
              <p className="flex items-center gap-2 font-rajdhani text-xs" style={{ color: GUILD_GOLD }}>
                <Icon name="HeartCrack" size={13} />
                «Слабость» — три дня без бонусов ветки
              </p>
            )}
          </div>
        )}
      </section>

      {card.bonuses.length > 0 && (
        <section className="guild-panel p-4 guild-rise">
          <h3 className="hud-title font-orbitron text-xs tracking-[0.16em] mb-3" style={{ color: "#8fa3c8" }}>
            ОТКРЫТЫЕ БОНУСЫ
          </h3>
          <ul className="space-y-2">
            {card.bonuses.map((bonus) => (
              <li key={bonus} className="flex items-center gap-2.5 font-rajdhani text-sm">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 guild-halo"
                      style={{ background: `${GUILD_GOLD}1a` }}>
                  <Icon name="Sparkles" size={14} style={{ color: GUILD_GOLD }} />
                </span>
                {bonus}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="guild-panel p-4 guild-rise">
        <div className="flex items-center justify-between mb-3">
          <h3 className="hud-title font-orbitron text-xs tracking-[0.16em]" style={{ color: "#8fa3c8" }}>
            ЛЕНТА СЗ
          </h3>
          <span className="font-rajdhani text-xs px-2 py-0.5 rounded-full"
                style={{ background: `${GUILD_GOLD}15`, color: GUILD_GOLD }}>
            чит-кодов: {card.cheat_codes_left}
          </span>
        </div>
        {card.history.length === 0 ? (
          <p className="font-rajdhani text-sm py-3 text-center" style={{ color: "#6d7fa3" }}>
            Пока пусто. Первое доброе слово — и здесь появится строчка.
          </p>
        ) : (
          <ul className="space-y-1">
            {card.history.map((item, i) => {
              const meta = ACTION_META[item.action] ?? { title: item.action, icon: "Circle" };
              return (
                <li key={`${item.at}-${i}`}
                    className="guild-slide-in flex items-center gap-3 py-1.5 px-2 rounded-lg"
                    style={{ animationDelay: `${i * 45}ms`,
                             background: i === 0 ? `${GUILD_GREEN}0c` : undefined }}>
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "rgba(143,163,200,0.1)" }}>
                    <Icon name={meta.icon} size={13} style={{ color: GUILD_GREEN }} />
                  </span>
                  <span className="flex-1 font-rajdhani text-sm truncate">{meta.title}</span>
                  <span className="font-rajdhani text-[11px]" style={{ color: "#6d7fa3" }}>
                    {new Date(item.at).toLocaleDateString("ru-RU")}
                  </span>
                  <span className="font-orbitron text-sm" style={{ color: GUILD_GREEN }}>
                    +{item.delta}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onReload}
        className="guild-btn w-full py-2.5 rounded-xl font-rajdhani text-sm flex items-center justify-center gap-2"
        style={{ background: "rgba(255,255,255,0.04)", color: "#93ab9f" }}
      >
        <Icon name="RefreshCw" size={13} /> Обновить карту
      </button>
    </div>
  );
}

// ─── Тихая почта ──────────────────────────────────────────────────────────────
const STICKERS: { id: Sticker; glyph: string; label: string; color: string }[] = [
  { id: "angry", glyph: "😤", label: "Бесит", color: GUILD_EMBER },
  { id: "scared", glyph: "😨", label: "Страшно", color: "#5cc8ff" },
  { id: "change", glyph: "🔁", label: "Хочу изменить", color: GUILD_GOLD },
];

export function QuietMail({ token, onSent }: { token: string; onSent: () => void }) {
  const [sent, setSent] = useState<Sticker | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (sticker: Sticker) => {
    setBusy(true);
    setError("");
    try {
      await api.quietMail(token, sticker);
      setSent(sticker);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Письмо не ушло");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guild-panel p-5 space-y-5 guild-rise">
      <div className="text-center">
        <div className="text-5xl mb-2">📬</div>
        <h2 className="font-orbitron text-sm tracking-[0.2em] mb-2">ТИХАЯ ПОЧТА</h2>
        <p className="font-rajdhani text-sm mx-auto max-w-sm" style={{ color: "#8fa3c8" }}>
          Один стикер — и Хранитель узнает, что в классе что-то не так.
          Ни имени, ни клички в письме нет. За письмо начисляется +2 СЗ.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {STICKERS.map((sticker) => {
          const chosen = sent === sticker.id;
          return (
            <button
              key={sticker.id}
              type="button"
              disabled={busy}
              onClick={() => void send(sticker.id)}
              className="guild-btn aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: chosen
                  ? `linear-gradient(160deg, ${sticker.color}28, transparent)`
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${chosen ? `${sticker.color}88` : "rgba(255,255,255,0.08)"}`,
                boxShadow: chosen ? `0 0 26px -8px ${sticker.color}` : "none",
              }}
            >
              <span className="text-4xl sm:text-5xl">{sticker.glyph}</span>
              <span className="font-rajdhani text-xs" style={{ color: chosen ? sticker.color : "#93ab9f" }}>
                {sticker.label}
              </span>
            </button>
          );
        })}
      </div>

      {sent && (
        <p className="font-rajdhani text-sm flex items-center justify-center gap-2 guild-pop"
           style={{ color: GUILD_GREEN }}>
          <Icon name="Check" size={14} /> Письмо доставлено. +2 СЗ.
        </p>
      )}
      {error && (
        <p className="font-rajdhani text-sm text-center" style={{ color: GUILD_EMBER }}>{error}</p>
      )}
    </div>
  );
}

// ─── Меню чаепития ────────────────────────────────────────────────────────────
const TEA_OPTIONS = [
  { title: "Чай с печеньем", glyph: "🍪" },
  { title: "Какао", glyph: "☕" },
  { title: "Лимонад", glyph: "🥤" },
  { title: "Пирог", glyph: "🥧" },
];

/** Блок «Чай (меню голосованием)» из программы Фестиваля. */
function TeaVote({ token, canVote }: { token: string; canVote: boolean }) {
  const [results, setResults] = useState<{ option: string; votes: number }[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.voteResults(token, "tea_menu");
      setResults(res.results);
      setMine(res.my_option);
    } catch (err) {
      // Учителю этот эндпоинт недоступен — просто не показываем свой голос.
      if (err instanceof ApiError && err.status !== 403) {
        setError(err.message);
      }
    }
  }, [token]);

  useEffect(() => { if (canVote) void load(); }, [canVote, load]);

  if (!canVote) return null;

  const total = results.reduce((sum, r) => sum + r.votes, 0);

  const vote = async (option: string) => {
    setError("");
    try {
      const res = await api.vote(token, "tea_menu", option);
      setResults(res.results);
      setMine(option);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Голос не засчитан");
    }
  };

  return (
    <div className="guild-panel p-5">
      <h3 className="font-orbitron text-xs tracking-[0.16em] mb-3" style={{ color: "#8fa3c8" }}>
        ☕ МЕНЮ ЧАЕПИТИЯ
      </h3>
      <div className="space-y-2">
        {TEA_OPTIONS.map((option) => {
          const votes = results.find((r) => r.option === option.title)?.votes ?? 0;
          const share = total > 0 ? Math.round((votes / total) * 100) : 0;
          const chosen = mine === option.title;
          return (
            <button
              key={option.title}
              type="button"
              onClick={() => void vote(option.title)}
              className="guild-btn w-full relative overflow-hidden rounded-xl px-3 py-2.5 text-left font-rajdhani text-sm"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${chosen ? `${GUILD_GREEN}66` : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span
                className="absolute inset-y-0 left-0 transition-all duration-700"
                style={{ width: `${share}%`,
                         background: `linear-gradient(90deg, ${GUILD_GREEN}2e, ${GUILD_GREEN}12)` }}
                aria-hidden
              />
              <span className="relative flex items-center gap-2">
                <span className="text-lg">{option.glyph}</span>
                <span className="flex-1">{chosen ? "✓ " : ""}{option.title}</span>
                <span style={{ color: "#6d7fa3" }}>{votes}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 font-rajdhani text-xs" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}

// ─── Прогноз Фестиваля ────────────────────────────────────────────────────────
const PROGRAM_ICON: Record<string, string> = {
  scroll: "ScrollText",
  games: "Dices",
  tea: "CupSoda",
  mic: "Mic",
  meme: "Laugh",
};

export function FestivalView({ token, canVote }: { token: string; canVote: boolean }) {
  const [data, setData] = useState<FestivalForecast | null>(null);
  const [error, setError] = useState("");
  const left = useCountUp(data?.souls_left ?? 0);

  useEffect(() => {
    let alive = true;
    api.forecast(token)
      .then((res) => { if (alive) setData(res); })
      .catch((err) => { if (alive) setError(err instanceof ApiError ? err.message : "Прогноз недоступен"); });
    return () => { alive = false; };
  }, [token]);

  if (error) return <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>;
  if (!data) return <p className="font-rajdhani text-sm" style={{ color: "#6d7fa3" }}>Считаем…</p>;

  return (
    <div className="space-y-4">
      <section className="guild-panel hud-scan p-6 text-center guild-rise relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ background: `radial-gradient(circle at 50% 0%, ${data.ready ? GUILD_GREEN : GUILD_GOLD}, transparent 60%)` }} />
        <div className="relative">
          <div className="text-5xl mb-2">{data.ready ? "🎪" : "🌱"}</div>
          <h2 className="font-orbitron text-sm tracking-[0.2em] mb-3">ПРОГНОЗ ФЕСТИВАЛЯ</h2>

          {data.ready ? (
            <p className="font-rajdhani text-lg" style={{ color: GUILD_GREEN }}>
              Древо на {data.tree_percent}% — Фестиваль открыт.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-center gap-2">
                <span className="font-orbitron text-6xl font-black tabular-nums"
                      style={{ color: GUILD_GOLD, textShadow: `0 0 30px ${GUILD_GOLD}44` }}>
                  {left}
                </span>
                <span className="font-orbitron text-2xl" style={{ color: `${GUILD_GOLD}99` }}>СЗ</span>
              </div>
              <p className="font-rajdhani text-sm mt-2 mx-auto max-w-sm" style={{ color: "#8fa3c8" }}>
                осталось гильдии до {data.threshold}%. Это примерно
                {" "}<b style={{ color: GUILD_GOLD }}>{data.souls_left_per_hero} СЗ</b> на каждого —
                и ни одного имени в этом расчёте.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="guild-panel p-5 guild-rise">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="hud-title font-orbitron text-xs tracking-[0.16em]" style={{ color: "#8fa3c8" }}>
            ПРОГРАММА
          </h3>
          <span className="font-rajdhani text-xs" style={{ color: "#6d7fa3" }}>
            {data.total_minutes} минут
          </span>
        </div>

        {/* Вертикальная лента: видно, что Фестиваль — это сценарий, а не список */}
        <ol className="relative space-y-3 pl-1">
          <span className="absolute left-[18px] top-3 bottom-3 w-px"
                style={{ background: "linear-gradient(180deg, rgba(240,198,97,0.5), transparent)" }}
                aria-hidden />
          {data.program.map((block) => (
            <li key={block.id} className="relative flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 z-10"
                    style={{ background: "#12201a", border: `1px solid ${GUILD_GOLD}44` }}>
                <Icon name={PROGRAM_ICON[block.id] ?? "Circle"} size={15}
                      style={{ color: GUILD_GOLD }} />
              </span>
              <span className="flex-1 font-rajdhani text-sm">{block.title}</span>
              <span className="font-orbitron text-[11px]" style={{ color: "#6d7fa3" }}>
                {block.minutes}′
              </span>
            </li>
          ))}
        </ol>
      </section>

      <TeaVote token={token} canVote={canVote} />
    </div>
  );
}
