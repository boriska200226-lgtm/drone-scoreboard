import { useCallback, useEffect, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import type { AltarRow, FestivalForecast, HeroCardData, Sticker, TreeState } from "../types";
import { TreeMeter } from "./Common";
import { BRANCH_GLYPH, GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, SHIELD_GLYPH } from "../theme";
import ProgressBar from "./ProgressBar";

// ─── Алтарь ───────────────────────────────────────────────────────────────────
export function Altar({ rows, tree, myHeroId }: {
  rows: AltarRow[];
  tree: TreeState | null;
  myHeroId: number | null;
}) {
  return (
    <div className="space-y-4">
      {tree && <TreeMeter tree={tree} />}

      <div className="guild-panel overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b"
             style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="font-orbitron text-sm tracking-[0.16em]">🎭 АЛТАРЬ</h2>
          <span className="font-rajdhani text-xs" style={{ color: "#6b7a72" }}>
            {rows.length} героев · без имён
          </span>
        </div>

        {/* Шапка таблицы только на широком экране: на телефоне строка складывается
            в три этажа, и подписи столбцов теряют смысл. */}
        <div className="guild-altar-head guild-altar-row px-4 py-2 font-orbitron text-[10px] tracking-[0.14em]"
             style={{ color: "#6b7a72" }}>
          <span className="guild-altar-name">КЛИЧКА</span>
          <span className="guild-altar-level">УР.</span>
          <span className="guild-altar-meta">ВЕТКА</span>
          <span className="guild-altar-bar">ВКЛАД В ДРЕВО</span>
          <span className="guild-altar-shield text-right">ЩИТ</span>
        </div>

        <ul>
          {rows.map((row, index) => {
            const mine = row.hero_id === myHeroId;
            return (
              <li
                key={row.hero_id}
                className="guild-altar-row px-4 py-3 border-t"
                style={{
                  borderColor: "rgba(255,255,255,0.05)",
                  background: mine ? `${GUILD_GREEN}0d` : undefined,
                  borderLeft: row.shield === "bleeding" ? `3px solid ${GUILD_EMBER}` : "3px solid transparent",
                }}
              >
                <span className="guild-altar-name font-rajdhani font-semibold flex items-center gap-2">
                  <span className="text-xs w-5 shrink-0" style={{ color: "#6b7a72" }}>{index + 1}</span>
                  <span className="truncate">
                    {row.avatar} {row.nickname}
                  </span>
                  {mine && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: `${GUILD_GREEN}22`, color: GUILD_GREEN }}>
                      ты
                    </span>
                  )}
                </span>

                <span className="guild-altar-level font-orbitron text-sm" style={{ color: GUILD_GOLD }}>
                  {row.level}
                </span>

                <span className="guild-altar-meta font-rajdhani text-xs flex items-center gap-1.5 md:pl-0 pl-7"
                      style={{ color: "#9db3a6" }}>
                  <span className="md:hidden font-orbitron text-[11px]" style={{ color: GUILD_GOLD }}>
                    ур. {row.level}
                  </span>
                  <span className="truncate">{BRANCH_GLYPH[row.branch]} {row.branch_title}</span>
                </span>

                <span className="guild-altar-bar h-2 rounded-full overflow-hidden md:ml-0 ml-7"
                      style={{ background: "rgba(255,255,255,0.07)" }}
                      title={`Вклад в ветку: ${row.branch_percent}%`}>
                  <span
                    className="block h-full rounded-full transition-all duration-700"
                    style={{ width: `${row.branch_percent}%`, background: GUILD_GREEN }}
                  />
                </span>

                <span className="guild-altar-shield text-right text-base"
                      title={`Броня ${row.armor}/10`}>
                  {SHIELD_GLYPH[row.shield]}
                </span>
              </li>
            );
          })}
        </ul>

        {rows.length === 0 && (
          <p className="px-4 py-8 text-center font-rajdhani text-sm" style={{ color: "#6b7a72" }}>
            Гильдия пуста — Хранитель ещё не создал героев.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Карта героя ──────────────────────────────────────────────────────────────
const ACTION_TITLES: Record<string, string> = {
  kind_word: "Доброе слово",
  translate_mat: "Перевод мата",
  help_three: "Помощь троим",
  hand_raise: "Поднятая рука",
  cheat_code: "Чит-код «было трудно»",
  quiet_mail: "Тихая почта",
};

export function HeroCard({ card, onReload }: { card: HeroCardData; onReload: () => void }) {
  const armorBar = card.bars.find((b) => b.id === "armor");
  const bleeding = (armorBar?.value ?? 1) <= 0;

  return (
    <div className="space-y-4">
      <div className="guild-panel p-5"
           style={bleeding ? { borderColor: GUILD_EMBER, boxShadow: `0 0 24px ${GUILD_EMBER}33` } : undefined}>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
               style={{ background: "#2b4b3b", border: `1px solid ${GUILD_GREEN}44` }}>
            {card.avatar || BRANCH_GLYPH[card.branch]}
          </div>
          <div className="min-w-0">
            <h2 className="font-orbitron text-xl font-bold truncate">{card.nickname}</h2>
            <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
              {BRANCH_GLYPH[card.branch]} {card.branch_title} · уровень {card.level} · {card.souls} СЗ
            </p>
          </div>
          <span className="ml-auto text-2xl" title="Щит">{SHIELD_GLYPH[card.shield]}</span>
        </div>

        <div className="space-y-2">
          {card.bars.map((bar) => (
            <ProgressBar
              key={bar.id}
              label={bar.label}
              value={bar.value}
              max={bar.max}
              color={bar.color}
              hint={bar.hint}
              bleeding={bar.id === "armor" && bar.value <= 0}
              blink={bar.id !== "armor" && bar.value / bar.max >= 0.65 && bar.value / bar.max <= 0.75}
              bonusIcon={bar.value >= bar.max * 0.8 ? "Sparkles" : undefined}
              bonusTitle="Бонус ветки открыт при 80%"
            />
          ))}
        </div>

        {card.debuffed && (
          <p className="mt-4 flex items-center gap-2 font-rajdhani text-xs" style={{ color: GUILD_EMBER }}>
            <Icon name="AlertTriangle" size={13} />
            Дебафф активен до {new Date(card.debuff_until ?? "").toLocaleString("ru-RU")}
          </p>
        )}
        {card.weakness && (
          <p className="mt-2 flex items-center gap-2 font-rajdhani text-xs" style={{ color: GUILD_GOLD }}>
            <Icon name="HeartCrack" size={13} />
            «Слабость» — три дня без бонусов ветки
          </p>
        )}
      </div>

      {card.bonuses.length > 0 && (
        <div className="guild-panel p-4">
          <h3 className="font-orbitron text-xs tracking-[0.16em] mb-3" style={{ color: "#9db3a6" }}>
            ОТКРЫТЫЕ БОНУСЫ
          </h3>
          <ul className="space-y-2">
            {card.bonuses.map((bonus) => (
              <li key={bonus} className="flex items-center gap-2 font-rajdhani text-sm">
                <Icon name="Sparkles" size={14} style={{ color: GUILD_GOLD }} />
                {bonus}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="guild-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-orbitron text-xs tracking-[0.16em]" style={{ color: "#9db3a6" }}>
            ПОСЛЕДНИЕ СЗ
          </h3>
          <span className="font-rajdhani text-xs" style={{ color: GUILD_GOLD }}>
            чит-кодов осталось: {card.cheat_codes_left}
          </span>
        </div>
        {card.history.length === 0 ? (
          <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>
            Пока пусто. Первое доброе слово — и здесь появится строчка.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {card.history.map((item, i) => (
              <li key={`${item.at}-${i}`} className="flex items-center justify-between font-rajdhani text-sm">
                <span>{ACTION_TITLES[item.action] ?? item.action}</span>
                <span className="flex items-center gap-3">
                  <span style={{ color: "#6b7a72" }} className="text-xs">
                    {new Date(item.at).toLocaleDateString("ru-RU")}
                  </span>
                  <span style={{ color: GUILD_GREEN }}>+{item.delta}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onReload}
        className="w-full py-2.5 rounded-xl font-rajdhani text-sm flex items-center justify-center gap-2"
        style={{ background: "rgba(255,255,255,0.04)", color: "#9db3a6" }}
      >
        <Icon name="RefreshCw" size={13} /> Обновить карту
      </button>
    </div>
  );
}

// ─── Тихая почта ──────────────────────────────────────────────────────────────
const STICKERS: { id: Sticker; glyph: string; label: string }[] = [
  { id: "angry", glyph: "😤", label: "Бесит" },
  { id: "scared", glyph: "😨", label: "Страшно" },
  { id: "change", glyph: "🔁", label: "Хочу изменить" },
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
    <div className="guild-panel p-5 space-y-4">
      <div>
        <h2 className="font-orbitron text-sm tracking-[0.16em] mb-1">📬 ТИХАЯ ПОЧТА</h2>
        <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          Один стикер — и Хранитель узнает, что в классе что-то не так.
          Ни имени, ни клички в письме нет. За письмо начисляется +2 СЗ.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            disabled={busy}
            onClick={() => void send(sticker.id)}
            className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
            style={{
              background: sent === sticker.id ? `${GUILD_GREEN}1a` : "rgba(255,255,255,0.04)",
              border: `1px solid ${sent === sticker.id ? `${GUILD_GREEN}66` : "rgba(255,255,255,0.08)"}`,
            }}
          >
            <span className="text-4xl">{sticker.glyph}</span>
            <span className="font-rajdhani text-xs" style={{ color: "#9db3a6" }}>
              {sticker.label}
            </span>
          </button>
        ))}
      </div>

      {sent && (
        <p className="font-rajdhani text-sm flex items-center gap-2" style={{ color: GUILD_GREEN }}>
          <Icon name="Check" size={14} /> Письмо доставлено. +2 СЗ.
        </p>
      )}
      {error && (
        <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>
      )}
    </div>
  );
}

// ─── Меню чаепития ────────────────────────────────────────────────────────────
const TEA_OPTIONS = ["Чай с печеньем", "Какао", "Лимонад", "Пирог"];

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
      <h3 className="font-orbitron text-xs tracking-[0.16em] mb-3" style={{ color: "#9db3a6" }}>
        ☕ МЕНЮ ЧАЕПИТИЯ
      </h3>
      <div className="space-y-2">
        {TEA_OPTIONS.map((option) => {
          const votes = results.find((r) => r.option === option)?.votes ?? 0;
          const share = total > 0 ? Math.round((votes / total) * 100) : 0;
          const chosen = mine === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => void vote(option)}
              className="w-full relative overflow-hidden rounded-xl px-3 py-2.5 text-left font-rajdhani text-sm"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${chosen ? `${GUILD_GREEN}66` : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span
                className="absolute inset-y-0 left-0 transition-all duration-500"
                style={{ width: `${share}%`, background: `${GUILD_GREEN}1f` }}
                aria-hidden
              />
              <span className="relative flex items-center justify-between">
                <span>{chosen ? "✓ " : ""}{option}</span>
                <span style={{ color: "#6b7a72" }}>{votes}</span>
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
export function FestivalView({ token, canVote }: { token: string; canVote: boolean }) {
  const [data, setData] = useState<FestivalForecast | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.forecast(token)
      .then((res) => { if (alive) setData(res); })
      .catch((err) => { if (alive) setError(err instanceof ApiError ? err.message : "Прогноз недоступен"); });
    return () => { alive = false; };
  }, [token]);

  if (error) return <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>;
  if (!data) return <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>Считаем…</p>;

  return (
    <div className="space-y-4">
      <div className="guild-panel p-5">
        <h2 className="font-orbitron text-sm tracking-[0.16em] mb-3">🎪 ПРОГНОЗ ФЕСТИВАЛЯ</h2>
        {data.ready ? (
          <p className="font-rajdhani text-lg" style={{ color: GUILD_GREEN }}>
            Древо на {data.tree_percent}% — Фестиваль открыт.
          </p>
        ) : (
          <>
            <p className="font-orbitron text-3xl font-black" style={{ color: GUILD_GOLD }}>
              {data.souls_left} СЗ
            </p>
            <p className="font-rajdhani text-sm mt-1" style={{ color: "#9db3a6" }}>
              осталось гильдии до {data.threshold}%. Это примерно
              {" "}{data.souls_left_per_hero} СЗ на каждого — и ни одного имени в этом расчёте.
            </p>
          </>
        )}
      </div>

      <div className="guild-panel p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-orbitron text-xs tracking-[0.16em]" style={{ color: "#9db3a6" }}>
            ПРОГРАММА
          </h3>
          <span className="font-rajdhani text-xs" style={{ color: "#6b7a72" }}>
            {data.total_minutes} минут
          </span>
        </div>
        <ol className="space-y-2">
          {data.program.map((block, i) => (
            <li key={block.id} className="flex items-center gap-3 font-rajdhani text-sm">
              <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0"
                    style={{ background: "rgba(255,255,255,0.05)", color: GUILD_GOLD }}>
                {i + 1}
              </span>
              <span className="flex-1">{block.title}</span>
              <span style={{ color: "#6b7a72" }}>{block.minutes} мин</span>
            </li>
          ))}
        </ol>
      </div>

      <TeaVote token={token} canVote={canVote} />
    </div>
  );
}
