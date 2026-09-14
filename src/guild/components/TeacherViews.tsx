import { useCallback, useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import { BRANCH_THEME, GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, rankOf } from "../theme";
import type {
  AttendanceStatus, GameRules, GuildMapData, Sticker, StudentRow,
} from "../types";
import { BranchSigil, HeroAvatar, RankBadge, ShieldBadge } from "./art";
import { TreeMeter } from "./Common";

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

const ACTION_ICON: Record<string, string> = {
  kind_word: "Heart",
  translate_mat: "Languages",
  help_three: "HandHeart",
  hand_raise: "Hand",
  cheat_code: "Wand2",
  quiet_mail: "Mail",
};

/** Выбор героя аватарами: 25 кличек списком — это журнал, а не игра. */
function HeroPicker({ students, value, onChange }: {
  students: StudentRow[];
  value: number | null;
  onChange: (heroId: number) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {students.map((s) => {
        const active = s.hero_id === value;
        const tone = BRANCH_THEME[s.branch];
        return (
          <button
            key={s.hero_id}
            type="button"
            onClick={() => onChange(s.hero_id)}
            className="guild-btn shrink-0 w-[4.6rem] rounded-xl px-1 py-2 flex flex-col items-center gap-1"
            style={{
              background: active ? `${tone.color}1f` : "rgba(255,255,255,0.035)",
              border: `1px solid ${active ? `${tone.color}88` : "rgba(255,255,255,0.07)"}`,
              boxShadow: active ? `0 0 20px -8px ${tone.color}` : "none",
            }}
          >
            <HeroAvatar avatar="" nickname={s.nickname} branch={s.branch} size={34} dimmed={!active} />
            <span className="font-rajdhani text-[11px] truncate w-full text-center"
                  style={{ color: active ? "#e8f5ee" : "#93ab9f" }}>
              {s.nickname}
            </span>
            <span className="font-orbitron text-[9px]" style={{ color: GUILD_GREEN }}>
              {s.souls}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Начисление СЗ ────────────────────────────────────────────────────────────
export function AwardPanel({ token, students, rules, onDone }: {
  token: string;
  students: StudentRow[];
  rules: GameRules | null;
  onDone: () => void;
}) {
  const [heroId, setHeroId] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (heroId === null && students.length > 0) setHeroId(students[0].hero_id);
  }, [students, heroId]);

  const hero = students.find((s) => s.hero_id === heroId) ?? null;

  const award = async (action: string, title: string) => {
    if (heroId === null) return;
    setBusy(action);
    setError("");
    try {
      const res = await api.award(token, heroId, action);
      setFlash({ text: `${title} · +${res.delta} СЗ · Древо ${res.tree.percent}%`, key: Date.now() });
      onDone();
    } catch (err) {
      setError(errorText(err, "Не удалось начислить"));
      setFlash(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="guild-panel p-5 space-y-4 guild-rise">
      <div className="flex items-center gap-2">
        <Icon name="Sparkles" size={16} style={{ color: GUILD_GREEN }} />
        <h2 className="font-orbitron text-sm tracking-[0.16em]">НАЧИСЛИТЬ СЗ</h2>
      </div>

      <HeroPicker students={students} value={heroId} onChange={setHeroId} />

      {hero && (
        <div className="guild-panel-flat px-3 py-2 flex items-center gap-3">
          <HeroAvatar avatar="" nickname={hero.nickname} branch={hero.branch} size={36} />
          <div className="min-w-0 flex-1">
            <div className="font-rajdhani font-semibold truncate">{hero.nickname}</div>
            <div className="font-rajdhani text-xs flex items-center gap-1.5"
                 style={{ color: BRANCH_THEME[hero.branch].color }}>
              <BranchSigil branch={hero.branch} size={12} />
              {BRANCH_THEME[hero.branch].title}
              <span style={{ color: "#5d6f65" }}>· {rankOf(Math.floor(hero.souls / 100) + 1).title}</span>
            </div>
          </div>
          <ShieldBadge shield={hero.armor <= 0 ? "bleeding" : hero.armor >= 8 ? "green" : "yellow"}
                       armor={hero.armor} size={24} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(rules?.soul_actions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy !== null || heroId === null}
            onClick={() => void award(action.id, action.title)}
            className="guild-btn relative px-3 py-3 rounded-xl text-left disabled:opacity-50 overflow-hidden"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <span className="flex items-center gap-2 mb-1">
              <Icon name={ACTION_ICON[action.id] ?? "Circle"} size={14}
                    style={{ color: GUILD_GREEN }} />
              <span className="font-rajdhani text-sm leading-tight">{action.title}</span>
            </span>
            <span className="font-orbitron text-xs" style={{ color: GUILD_GREEN }}>
              +{action.delta} СЗ
              {action.weekly_limit ? (
                <span style={{ color: "#6b7a72" }}> · до {action.weekly_limit}/нед</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      {flash && (
        <p key={flash.key} className="guild-pop font-rajdhani text-sm flex items-center gap-2"
           style={{ color: GUILD_GREEN }}>
          <Icon name="CheckCircle2" size={14} /> {flash.text}
        </p>
      )}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </section>
  );
}

// ─── Свисток, мат, Фестиваль ──────────────────────────────────────────────────
export function ControlPanel({ token, students, festivalReady, onDone }: {
  token: string;
  students: StudentRow[];
  festivalReady: boolean;
  onDone: () => void;
}) {
  const [matHero, setMatHero] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<string>) => {
    setError("");
    try {
      setStatus(await fn());
      onDone();
    } catch (err) {
      setError(errorText(err, "Команда не прошла"));
    }
  };

  const selectStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#e8f5ee",
  };

  return (
    <div className="space-y-4">
      <section className="guild-panel p-5 space-y-4 guild-rise">
        <div className="flex items-center gap-2">
          <Icon name="Megaphone" size={16} style={{ color: GUILD_EMBER }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">СВИСТОК</h2>
        </div>
        <p className="font-rajdhani text-sm" style={{ color: "#93ab9f" }}>
          Один свист — стоп-игра, два — разбор. Звук и вибрация уходят на все
          устройства класса сразу.
        </p>

        {/* Главная кнопка урока: её должно быть видно с любой парты */}
        <div className="flex items-center justify-center gap-5 py-2">
          <button
            type="button"
            onClick={() => void run(async () => {
              const res = await api.whistle(token, 1);
              return `Свисток ушёл на ${res.delivered} устройств`;
            })}
            className="guild-btn relative w-32 h-32 rounded-full flex flex-col items-center justify-center gap-1"
            style={{
              background: `radial-gradient(circle at 35% 28%, #ff9a7a, ${GUILD_EMBER} 55%, #b8341a)`,
              boxShadow: `0 16px 40px -14px ${GUILD_EMBER}, inset 0 2px 0 rgba(255,255,255,0.35)`,
              color: "#fff",
            }}
          >
            <span className="text-3xl">🔔</span>
            <span className="font-orbitron text-[11px] font-bold tracking-wider">СТОП-ИГРА</span>
          </button>

          <button
            type="button"
            onClick={() => void run(async () => {
              const res = await api.whistle(token, 2);
              return `Два свистка ушли на ${res.delivered} устройств`;
            })}
            className="guild-btn w-24 h-24 rounded-full flex flex-col items-center justify-center gap-0.5"
            style={{
              background: "rgba(255,107,69,0.12)",
              border: `2px solid ${GUILD_EMBER}66`,
              color: GUILD_EMBER,
            }}
          >
            <span className="text-xl">🔔🔔</span>
            <span className="font-orbitron text-[10px] font-bold">РАЗБОР</span>
          </button>
        </div>
      </section>

      <section className="guild-panel p-5 space-y-3 guild-rise">
        <div className="flex items-center gap-2">
          <Icon name="ShieldOff" size={16} style={{ color: GUILD_EMBER }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">ДЕБАФФ «МАТ»</h2>
        </div>
        <p className="font-rajdhani text-sm" style={{ color: "#93ab9f" }}>
          −10% Древа и дебафф на 24 часа. Герой указывается по желанию: можно
          отметить только урон гильдии, не показывая класс на одного человека.
        </p>
        <select
          value={matHero ?? ""}
          onChange={(e) => setMatHero(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={selectStyle}
        >
          <option value="" style={{ background: "#0c120f" }}>Без указания героя</option>
          {students.map((s) => (
            <option key={s.hero_id} value={s.hero_id} style={{ background: "#0c120f" }}>
              {s.nickname}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Пометка для журнала (необязательно)"
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={selectStyle}
        />
        <button
          type="button"
          onClick={() => void run(async () => {
            const res = await api.mat(token, matHero, note);
            setNote("");
            return `Дебафф применён · Древо ${res.tree.percent}%`;
          })}
          className="guild-btn w-full py-3 rounded-xl font-orbitron text-xs font-bold"
          style={{ background: "rgba(255,107,69,0.18)", color: GUILD_EMBER,
                   border: `1px solid ${GUILD_EMBER}55` }}
        >
          ПРИМЕНИТЬ ДЕБАФФ
        </button>
      </section>

      <section className="guild-panel p-5 space-y-3 guild-rise">
        <div className="flex items-center gap-2">
          <Icon name="PartyPopper" size={16} style={{ color: GUILD_GOLD }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">ФЕСТИВАЛЬ</h2>
        </div>
        <p className="font-rajdhani text-sm" style={{ color: festivalReady ? GUILD_GREEN : GUILD_GOLD }}>
          {festivalReady
            ? "Древо доросло до 70% — можно запускать."
            : "Древо ниже 70%. Запуск сейчас начнёт Рейд: без печенья."}
        </p>
        <button
          type="button"
          onClick={() => void run(async () => {
            const res = await api.startFestival(token);
            return res.festival.status === "running" ? "Фестиваль начался" : "Начат Рейд";
          })}
          className="guild-btn w-full py-3.5 rounded-xl font-orbitron text-xs font-bold"
          style={festivalReady
            ? { background: `linear-gradient(135deg, ${GUILD_GOLD}, #c9922f)`, color: "#1a1204",
                boxShadow: `0 12px 30px -14px ${GUILD_GOLD}` }
            : { background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}
        >
          {festivalReady ? "ЗАПУСТИТЬ ФЕСТИВАЛЬ" : "ЗАПУСТИТЬ (БУДЕТ РЕЙД)"}
        </button>
      </section>

      {status && (
        <p className="guild-pop font-rajdhani text-sm flex items-center gap-2" style={{ color: GUILD_GREEN }}>
          <Icon name="CheckCircle2" size={14} /> {status}
        </p>
      )}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}

// ─── Посещаемость ─────────────────────────────────────────────────────────────
const STATUS_META: Record<AttendanceStatus, { label: string; color: string; icon: string }> = {
  present: { label: "был", color: GUILD_GREEN, icon: "Check" },
  absent: { label: "нет", color: GUILD_EMBER, icon: "X" },
  excused: { label: "ув.", color: GUILD_GOLD, icon: "FileText" },
};

export function AttendancePanel({ token, students, onDone }: {
  token: string;
  students: StudentRow[];
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [lesson, setLesson] = useState(1);
  const [marks, setMarks] = useState<Record<number, AttendanceStatus>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const setMark = (heroId: number, value: AttendanceStatus) =>
    setMarks((prev) => ({ ...prev, [heroId]: value }));

  const absent = students.filter((s) => (marks[s.hero_id] ?? "present") === "absent").length;

  const save = async () => {
    setError("");
    const items = students.map((s) => ({
      hero_id: s.hero_id,
      status: marks[s.hero_id] ?? ("present" as AttendanceStatus),
      lesson,
    }));
    try {
      await api.attendance(token, day, items);
      setStatus(`Урок ${lesson} за ${day} сохранён`);
      onDone();
    } catch (err) {
      setError(errorText(err, "Не удалось сохранить"));
    }
  };

  const runArmor = async () => {
    setError("");
    try {
      const res = await api.runArmor(token, day);
      setStatus(`Броня пересчитана: изменений ${res.processed}, Древо ${res.tree.percent}%`);
      onDone();
    } catch (err) {
      setError(errorText(err, "Пересчёт не прошёл"));
    }
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#e8f5ee",
  };

  return (
    <section className="guild-panel p-5 space-y-4 guild-rise">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon name="Shield" size={16} style={{ color: GUILD_GREEN }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">ПОСЕЩАЕМОСТЬ</h2>
        </div>
        <p className="font-rajdhani text-sm" style={{ color: "#93ab9f" }}>
          «Уважительная» не бьёт по Броне. Итог дня система считает сама в 22:00 —
          кнопка ниже нужна, только если сервер в это время спал.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-lg px-3 py-2 font-rajdhani outline-none"
          style={inputStyle}
        />
        <label className="flex items-center gap-2 font-rajdhani text-sm" style={{ color: "#93ab9f" }}>
          урок
          <input
            type="number"
            min={1}
            max={10}
            value={lesson}
            onChange={(e) => setLesson(Number(e.target.value))}
            className="w-16 rounded-lg px-2 py-2 outline-none"
            style={inputStyle}
          />
        </label>
        {absent > 0 && (
          <span className="font-rajdhani text-xs px-2.5 py-1 rounded-full"
                style={{ background: `${GUILD_EMBER}18`, color: GUILD_EMBER }}>
            отмечено отсутствий: {absent}
          </span>
        )}
      </div>

      <ul className="space-y-1 max-h-[24rem] overflow-y-auto pr-1">
        {students.map((s) => {
          const current = marks[s.hero_id] ?? "present";
          return (
            <li key={s.hero_id} className="flex items-center gap-2 py-0.5">
              <HeroAvatar avatar="" nickname={s.nickname} branch={s.branch} size={28} />
              <span className="flex-1 font-rajdhani text-sm truncate">{s.nickname}</span>
              {(Object.keys(STATUS_META) as AttendanceStatus[]).map((value) => {
                const active = current === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMark(s.hero_id, value)}
                    className="guild-btn px-2.5 py-1 rounded-lg font-rajdhani text-xs"
                    style={{
                      background: active ? `${STATUS_META[value].color}22` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? `${STATUS_META[value].color}66` : "transparent"}`,
                      color: active ? STATUS_META[value].color : "#7f9488",
                    }}
                  >
                    {STATUS_META[value].label}
                  </button>
                );
              })}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void save()}
          className="guild-btn px-4 py-2.5 rounded-xl font-orbitron text-xs font-bold"
          style={{ background: GUILD_GREEN, color: "#06120c" }}
        >
          СОХРАНИТЬ УРОК
        </button>
        <button
          type="button"
          onClick={() => void runArmor()}
          className="guild-btn px-4 py-2.5 rounded-xl font-orbitron text-xs"
          style={{ background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}
        >
          ПЕРЕСЧИТАТЬ БРОНЮ ЗА ДЕНЬ
        </button>
      </div>

      {status && <p className="font-rajdhani text-sm" style={{ color: GUILD_GREEN }}>{status}</p>}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </section>
  );
}

// ─── Карта гильдии ────────────────────────────────────────────────────────────
const STICKER_META: Record<Sticker, { glyph: string; label: string }> = {
  angry: { glyph: "😤", label: "бесит" },
  scared: { glyph: "😨", label: "страшно" },
  change: { glyph: "🔁", label: "хочу изменить" },
};

export function GuildMapView({ token }: { token: string }) {
  const [data, setData] = useState<GuildMapData | null>(null);
  const [letters, setLetters] = useState<{ sticker: Sticker; day: string; count: number }[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [map, mail] = await Promise.all([api.guildMap(token), api.quietMailFeed(token)]);
      setData(map);
      setLetters(mail.letters);
    } catch (err) {
      setError(errorText(err, "Карта недоступна"));
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>;
  if (!data) return <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>Загружаем…</p>;

  const maxSouls = Math.max(1, ...data.branches.map((b) => b.souls));

  return (
    <div className="space-y-4">
      <TreeMeter tree={data.tree} />

      <section className="guild-panel p-5 guild-rise">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="Compass" size={16} style={{ color: GUILD_GREEN }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">КАРТА ГИЛЬДИИ</h2>
        </div>
        <p className="font-rajdhani text-xs mb-4" style={{ color: "#6b7a72" }}>
          Только сводка по веткам: ни одной клички, ни одного имени.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {data.branches.map((branch) => {
            const tone = BRANCH_THEME[branch.branch];
            return (
              <div key={branch.branch} className="guild-panel-flat p-3.5 relative overflow-hidden"
                   style={{ borderColor: `${tone.color}33` }}>
                <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
                     style={{ background: `radial-gradient(circle at 80% 0%, ${tone.color}, transparent 60%)` }} />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-2" style={{ color: tone.color }}>
                    <BranchSigil branch={branch.branch} size={22} />
                    <span className="font-orbitron text-sm">{branch.title}</span>
                  </div>
                  <div className="font-orbitron text-2xl font-bold" style={{ color: tone.color }}>
                    {branch.souls}
                    <span className="font-rajdhani text-xs ml-1" style={{ color: "#6b7a72" }}>СЗ</span>
                  </div>
                  <div className="h-1.5 rounded-full mt-2 overflow-hidden"
                       style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full transition-all duration-700"
                         style={{ width: `${(branch.souls / maxSouls) * 100}%`, background: tone.color }} />
                  </div>
                  <div className="font-rajdhani text-xs mt-2" style={{ color: "#93ab9f" }}>
                    {branch.heroes} героев · броня ⌀{branch.avg_armor}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {data.heroes_low_armor > 0 && (
          <p className="mt-4 font-rajdhani text-sm flex items-center gap-2 px-3 py-2 rounded-xl"
             style={{ background: `${GUILD_GOLD}12`, color: GUILD_GOLD }}>
            <Icon name="ShieldAlert" size={15} />
            У {data.heroes_low_armor} героев Броня 3 и ниже — стоит поговорить с классом.
          </p>
        )}
      </section>

      <section className="guild-panel p-5 guild-rise">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="Mail" size={16} style={{ color: GUILD_GOLD }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">ТИХАЯ ПОЧТА</h2>
        </div>
        {letters.length === 0 ? (
          <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>Писем пока нет.</p>
        ) : (
          <ul className="space-y-1.5">
            {letters.map((letter, i) => (
              <li key={`${letter.day}-${letter.sticker}-${i}`}
                  className="flex items-center gap-3 font-rajdhani text-sm py-1.5 px-2 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                <span className="text-xl">{STICKER_META[letter.sticker].glyph}</span>
                <span className="flex-1">{STICKER_META[letter.sticker].label}</span>
                <span style={{ color: "#6b7a72" }}>
                  {new Date(letter.day).toLocaleDateString("ru-RU")}
                </span>
                <span className="font-orbitron text-xs px-2 py-0.5 rounded-full"
                      style={{ background: `${GUILD_GOLD}18`, color: GUILD_GOLD }}>
                  ×{letter.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Список героев, сброс пароля, Реестр ──────────────────────────────────────
export function RosterPanel({ token, students, onDone }: {
  token: string;
  students: StudentRow[];
  onDone: () => void;
}) {
  const [reset, setReset] = useState<{ login: string; password: string; parent_message: string } | null>(null);
  const [lookupHero, setLookupHero] = useState<number | null>(null);
  const [totp, setTotp] = useState("");
  const [realName, setRealName] = useState<string | null>(null);
  const [error, setError] = useState("");

  const sorted = useMemo(() => [...students].sort((a, b) => b.souls - a.souls), [students]);

  const doReset = async (login: string) => {
    setError("");
    try {
      setReset(await api.resetPassword(token, login));
      onDone();
    } catch (err) {
      setError(errorText(err, "Сброс не прошёл"));
    }
  };

  const doLookup = async () => {
    if (lookupHero === null) return;
    setError("");
    setRealName(null);
    try {
      const res = await api.registryLookup(token, lookupHero, totp.trim());
      setRealName(res.real_name);
      setTotp("");
    } catch (err) {
      setError(errorText(err, "Реестр не открылся"));
    }
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#e8f5ee",
  };

  return (
    <div className="space-y-4">
      <section className="guild-panel p-5 guild-rise">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon name="ScrollText" size={16} style={{ color: GUILD_GREEN }} />
            <h2 className="font-orbitron text-sm tracking-[0.16em]">ГЕРОИ</h2>
          </div>
          <a href={api.exportUrl()} className="font-rajdhani text-xs flex items-center gap-1.5"
             style={{ color: GUILD_GOLD }}>
            <Icon name="Download" size={12} /> экспорт CSV
          </a>
        </div>

        <ul className="space-y-1">
          {sorted.map((s, i) => {
            const level = Math.floor(s.souls / 100) + 1;
            return (
              <li key={s.hero_id}
                  className="guild-altar-item flex items-center gap-2.5 py-1.5 px-2 rounded-lg">
                <span className="font-orbitron text-[11px] w-5 text-right" style={{ color: "#5d6f65" }}>
                  {i + 1}
                </span>
                <HeroAvatar avatar="" nickname={s.nickname} branch={s.branch} size={30} />
                <span className="flex-1 min-w-0">
                  <span className="block font-rajdhani text-sm truncate">{s.nickname}</span>
                  <span className="block font-rajdhani text-[11px] truncate"
                        style={{ color: BRANCH_THEME[s.branch].color }}>
                    {BRANCH_THEME[s.branch].title} · {s.login}
                  </span>
                </span>
                <RankBadge level={level} size={26} />
                <span className="font-orbitron text-xs w-16 text-right" style={{ color: GUILD_GREEN }}>
                  {s.souls} СЗ
                </span>
                <button
                  type="button"
                  onClick={() => void doReset(s.login)}
                  className="guild-btn px-2 py-1 rounded-lg font-rajdhani text-[11px] shrink-0"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#93ab9f" }}
                >
                  сброс
                </button>
              </li>
            );
          })}
        </ul>

        {reset && (
          <div className="mt-4 rounded-xl p-3 space-y-2 guild-pop"
               style={{ background: `${GUILD_GOLD}14`, border: `1px solid ${GUILD_GOLD}44` }}>
            <p className="font-rajdhani text-sm">
              {reset.login} → <span className="font-mono text-base">{reset.password}</span>
            </p>
            <p className="font-rajdhani text-xs" style={{ color: "#93ab9f" }}>
              Шаблон для родителя: {reset.parent_message}
            </p>
            <button type="button" onClick={() => setReset(null)}
                    className="font-rajdhani text-xs underline" style={{ color: "#6b7a72" }}>
              скрыть
            </button>
          </div>
        )}
      </section>

      <section className="guild-panel p-5 space-y-3 guild-rise">
        <div className="flex items-center gap-2">
          <Icon name="KeyRound" size={16} style={{ color: GUILD_GOLD }} />
          <h2 className="font-orbitron text-sm tracking-[0.16em]">РЕЕСТР</h2>
        </div>
        <p className="font-rajdhani text-sm" style={{ color: "#93ab9f" }}>
          Единственное место, где кличка связана с учеником. Запись хранится
          зашифрованной, каждое открытие требует свежий код 2FA и попадает в журнал.
        </p>
        <select
          value={lookupHero ?? ""}
          onChange={(e) => setLookupHero(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={inputStyle}
        >
          <option value="" style={{ background: "#0c120f" }}>Выбери кличку</option>
          {sorted.map((s) => (
            <option key={s.hero_id} value={s.hero_id} style={{ background: "#0c120f" }}>
              {s.nickname}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            inputMode="numeric"
            placeholder="код 2FA"
            className="flex-1 rounded-xl px-3 py-2.5 font-rajdhani outline-none"
            style={inputStyle}
          />
          <button type="button" onClick={() => void doLookup()}
                  className="guild-btn px-4 rounded-xl font-orbitron text-xs"
                  style={{ background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}>
            ОТКРЫТЬ
          </button>
        </div>
        {realName && (
          <p className="font-rajdhani text-base guild-pop" style={{ color: GUILD_GREEN }}>{realName}</p>
        )}
      </section>

      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}
