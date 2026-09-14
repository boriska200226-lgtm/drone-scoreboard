import { useCallback, useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import type {
  AttendanceStatus, GameRules, GuildMapData, Sticker, StudentRow,
} from "../types";
import { TreeMeter } from "./Common";
import { BRANCH_GLYPH, GUILD_EMBER, GUILD_GOLD, GUILD_GREEN } from "../theme";

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

// ─── Начисление СЗ ────────────────────────────────────────────────────────────
export function AwardPanel({ token, students, rules, onDone }: {
  token: string;
  students: StudentRow[];
  rules: GameRules | null;
  onDone: () => void;
}) {
  const [heroId, setHeroId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (heroId === null && students.length > 0) setHeroId(students[0].hero_id);
  }, [students, heroId]);

  const award = async (action: string, title: string) => {
    if (heroId === null) return;
    setBusy(action);
    setError("");
    try {
      const res = await api.award(token, heroId, action);
      setMessage(`${title}: +${res.delta} СЗ · Древо ${res.tree.percent}%`);
      onDone();
    } catch (err) {
      setError(errorText(err, "Не удалось начислить"));
      setMessage("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="guild-panel p-5 space-y-4">
      <h2 className="font-orbitron text-sm tracking-[0.16em]">✨ НАЧИСЛИТЬ СЗ</h2>

      <select
        value={heroId ?? ""}
        onChange={(e) => setHeroId(Number(e.target.value))}
        className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
      >
        {students.map((s) => (
          <option key={s.hero_id} value={s.hero_id} style={{ background: "#0c120f" }}>
            {s.nickname} · {s.souls} СЗ · броня {s.armor}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-2">
        {(rules?.soul_actions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy !== null || heroId === null}
            onClick={() => void award(action.id, action.title)}
            className="px-3 py-3 rounded-xl font-rajdhani text-sm text-left disabled:opacity-50 transition-transform active:scale-95"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <span className="block">{action.title}</span>
            <span className="font-orbitron text-xs" style={{ color: GUILD_GREEN }}>
              +{action.delta} СЗ
              {action.weekly_limit ? ` · до ${action.weekly_limit}/нед` : ""}
            </span>
          </button>
        ))}
      </div>

      {message && <p className="font-rajdhani text-sm" style={{ color: GUILD_GREEN }}>{message}</p>}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
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

  return (
    <div className="space-y-4">
      <div className="guild-panel p-5 space-y-3">
        <h2 className="font-orbitron text-sm tracking-[0.16em]">📣 СВИСТОК</h2>
        <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          Один свист — стоп-игра, два — разбор. Звук и вибрация уходят на все
          устройства класса сразу.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void run(async () => {
              const res = await api.whistle(token, 1);
              return `Свисток ушёл на ${res.delivered} устройств`;
            })}
            className="py-5 rounded-2xl font-orbitron text-sm font-bold transition-transform active:scale-95"
            style={{ background: GUILD_EMBER, color: "#fff" }}
          >
            🔔 СТОП-ИГРА
          </button>
          <button
            type="button"
            onClick={() => void run(async () => {
              const res = await api.whistle(token, 2);
              return `Два свистка ушли на ${res.delivered} устройств`;
            })}
            className="py-5 rounded-2xl font-orbitron text-sm font-bold transition-transform active:scale-95"
            style={{ background: "rgba(226,96,63,0.18)", color: GUILD_EMBER, border: `1px solid ${GUILD_EMBER}55` }}
          >
            🔔🔔 РАЗБОР
          </button>
        </div>
      </div>

      <div className="guild-panel p-5 space-y-3">
        <h2 className="font-orbitron text-sm tracking-[0.16em]">🤬 ДЕБАФФ «МАТ»</h2>
        <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          −10% Древа и дебафф на 24 часа. Герой указывается по желанию: можно
          отметить только урон гильдии, не показывая класс на одного человека.
        </p>
        <select
          value={matHero ?? ""}
          onChange={(e) => setMatHero(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
        >
          <option value="" style={{ background: "#0c120f" }}>Без указания героя</option>
          {students.map((s) => (
            <option key={s.hero_id} value={s.hero_id} style={{ background: "#0c120f" }}>{s.nickname}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Пометка для журнала (необязательно)"
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
        />
        <button
          type="button"
          onClick={() => void run(async () => {
            const res = await api.mat(token, matHero, note);
            setNote("");
            return `Дебафф применён · Древо ${res.tree.percent}%`;
          })}
          className="w-full py-3 rounded-xl font-orbitron text-xs font-bold"
          style={{ background: "rgba(226,96,63,0.2)", color: GUILD_EMBER, border: `1px solid ${GUILD_EMBER}55` }}
        >
          ПРИМЕНИТЬ ДЕБАФФ
        </button>
      </div>

      <div className="guild-panel p-5 space-y-3">
        <h2 className="font-orbitron text-sm tracking-[0.16em]">🎪 ФЕСТИВАЛЬ</h2>
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
          className="w-full py-3 rounded-xl font-orbitron text-xs font-bold"
          style={{
            background: festivalReady ? GUILD_GREEN : "rgba(255,255,255,0.06)",
            color: festivalReady ? "#0c120f" : GUILD_GOLD,
          }}
        >
          {festivalReady ? "ЗАПУСТИТЬ ФЕСТИВАЛЬ" : "ЗАПУСТИТЬ (БУДЕТ РЕЙД)"}
        </button>
      </div>

      {status && <p className="font-rajdhani text-sm" style={{ color: GUILD_GREEN }}>{status}</p>}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}

// ─── Посещаемость ─────────────────────────────────────────────────────────────
const STATUS_META: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: "был", color: GUILD_GREEN },
  absent: { label: "нет", color: GUILD_EMBER },
  excused: { label: "ув.", color: GUILD_GOLD },
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

  return (
    <div className="guild-panel p-5 space-y-4">
      <div>
        <h2 className="font-orbitron text-sm tracking-[0.16em] mb-1">🛡️ ПОСЕЩАЕМОСТЬ</h2>
        <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          «Уважительная» не бьёт по Броне. Итог дня система считает сама в 22:00 —
          кнопка ниже нужна, только если сервер в это время спал.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-lg px-3 py-2 font-rajdhani outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
        />
        <label className="flex items-center gap-2 font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          урок
          <input
            type="number"
            min={1}
            max={10}
            value={lesson}
            onChange={(e) => setLesson(Number(e.target.value))}
            className="w-16 rounded-lg px-2 py-2 outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
          />
        </label>
      </div>

      <ul className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-1">
        {students.map((s) => {
          const current = marks[s.hero_id] ?? "present";
          return (
            <li key={s.hero_id} className="flex items-center gap-2">
              <span className="flex-1 font-rajdhani text-sm truncate">{s.nickname}</span>
              {(Object.keys(STATUS_META) as AttendanceStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMark(s.hero_id, value)}
                  className="px-2.5 py-1 rounded-lg font-rajdhani text-xs"
                  style={{
                    background: current === value ? `${STATUS_META[value].color}22` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${current === value ? `${STATUS_META[value].color}66` : "transparent"}`,
                    color: current === value ? STATUS_META[value].color : "#7f9488",
                  }}
                >
                  {STATUS_META[value].label}
                </button>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void save()}
          className="px-4 py-2.5 rounded-xl font-orbitron text-xs font-bold"
          style={{ background: GUILD_GREEN, color: "#0c120f" }}
        >
          СОХРАНИТЬ УРОК
        </button>
        <button
          type="button"
          onClick={() => void runArmor()}
          className="px-4 py-2.5 rounded-xl font-orbitron text-xs"
          style={{ background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}
        >
          ПЕРЕСЧИТАТЬ БРОНЮ ЗА ДЕНЬ
        </button>
      </div>

      {status && <p className="font-rajdhani text-sm" style={{ color: GUILD_GREEN }}>{status}</p>}
      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}

// ─── Карта гильдии ────────────────────────────────────────────────────────────
const STICKER_LABEL: Record<Sticker, string> = {
  angry: "😤 бесит",
  scared: "😨 страшно",
  change: "🔁 хочу изменить",
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

  return (
    <div className="space-y-4">
      <TreeMeter tree={data.tree} />

      <div className="guild-panel p-5">
        <h2 className="font-orbitron text-sm tracking-[0.16em] mb-3">🧭 КАРТА ГИЛЬДИИ</h2>
        <p className="font-rajdhani text-xs mb-4" style={{ color: "#6b7a72" }}>
          Только сводка по веткам: ни одной клички, ни одного имени.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {data.branches.map((branch) => (
            <div key={branch.branch} className="rounded-xl p-3"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-2xl mb-1">{BRANCH_GLYPH[branch.branch]}</div>
              <div className="font-orbitron text-sm">{branch.title}</div>
              <div className="font-rajdhani text-xs mt-1" style={{ color: "#9db3a6" }}>
                {branch.heroes} героев · {branch.souls} СЗ · броня ⌀{branch.avg_armor}
              </div>
            </div>
          ))}
        </div>

        {data.heroes_low_armor > 0 && (
          <p className="mt-4 font-rajdhani text-sm flex items-center gap-2" style={{ color: GUILD_GOLD }}>
            <Icon name="ShieldAlert" size={14} />
            У {data.heroes_low_armor} героев Броня 3 и ниже — стоит поговорить с классом.
          </p>
        )}
      </div>

      <div className="guild-panel p-5">
        <h2 className="font-orbitron text-sm tracking-[0.16em] mb-3">📬 ТИХАЯ ПОЧТА</h2>
        {letters.length === 0 ? (
          <p className="font-rajdhani text-sm" style={{ color: "#6b7a72" }}>Писем пока нет.</p>
        ) : (
          <ul className="space-y-1.5">
            {letters.map((letter, i) => (
              <li key={`${letter.day}-${letter.sticker}-${i}`}
                  className="flex items-center justify-between font-rajdhani text-sm">
                <span>{STICKER_LABEL[letter.sticker]}</span>
                <span style={{ color: "#6b7a72" }}>
                  {new Date(letter.day).toLocaleDateString("ru-RU")} · ×{letter.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
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

  const sorted = useMemo(
    () => [...students].sort((a, b) => b.souls - a.souls),
    [students],
  );

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

  return (
    <div className="space-y-4">
      <div className="guild-panel p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-orbitron text-sm tracking-[0.16em]">👥 ГЕРОИ</h2>
          <a
            href={api.exportUrl()}
            className="font-rajdhani text-xs flex items-center gap-1.5"
            style={{ color: GUILD_GOLD }}
          >
            <Icon name="Download" size={12} /> экспорт CSV
          </a>
        </div>

        <ul className="space-y-1.5">
          {sorted.map((s) => (
            <li key={s.hero_id} className="flex items-center gap-2 py-1">
              <span className="flex-1 font-rajdhani text-sm truncate">
                {BRANCH_GLYPH[s.branch]} {s.nickname}
              </span>
              <span className="font-orbitron text-xs w-20 text-right" style={{ color: GUILD_GREEN }}>
                {s.souls} СЗ
              </span>
              <span className="font-mono text-[11px] w-24 text-right hidden sm:block"
                    style={{ color: "#6b7a72" }}>
                {s.login}
              </span>
              <button
                type="button"
                onClick={() => void doReset(s.login)}
                className="px-2 py-1 rounded-lg font-rajdhani text-[11px]"
                style={{ background: "rgba(255,255,255,0.05)", color: "#9db3a6" }}
              >
                сброс пароля
              </button>
            </li>
          ))}
        </ul>

        {reset && (
          <div className="mt-4 rounded-xl p-3 space-y-2"
               style={{ background: `${GUILD_GOLD}14`, border: `1px solid ${GUILD_GOLD}44` }}>
            <p className="font-rajdhani text-sm">
              {reset.login} → <span className="font-mono">{reset.password}</span>
            </p>
            <p className="font-rajdhani text-xs" style={{ color: "#9db3a6" }}>
              Шаблон для родителя: {reset.parent_message}
            </p>
            <button
              type="button"
              onClick={() => setReset(null)}
              className="font-rajdhani text-xs underline"
              style={{ color: "#6b7a72" }}
            >
              скрыть
            </button>
          </div>
        )}
      </div>

      <div className="guild-panel p-5 space-y-3">
        <h2 className="font-orbitron text-sm tracking-[0.16em]">🔐 РЕЕСТР</h2>
        <p className="font-rajdhani text-sm" style={{ color: "#9db3a6" }}>
          Единственное место, где кличка связана с учеником. Запись хранится
          зашифрованной, каждое открытие требует свежий код 2FA и попадает в журнал.
        </p>
        <select
          value={lookupHero ?? ""}
          onChange={(e) => setLookupHero(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-xl px-3 py-2.5 font-rajdhani outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
        >
          <option value="" style={{ background: "#0c120f" }}>Выбери кличку</option>
          {sorted.map((s) => (
            <option key={s.hero_id} value={s.hero_id} style={{ background: "#0c120f" }}>{s.nickname}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            inputMode="numeric"
            placeholder="код 2FA"
            className="flex-1 rounded-xl px-3 py-2.5 font-rajdhani outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8f5ee" }}
          />
          <button
            type="button"
            onClick={() => void doLookup()}
            className="px-4 rounded-xl font-orbitron text-xs"
            style={{ background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}
          >
            ОТКРЫТЬ
          </button>
        </div>
        {realName && (
          <p className="font-rajdhani text-sm" style={{ color: GUILD_GREEN }}>{realName}</p>
        )}
      </div>

      {error && <p className="font-rajdhani text-sm" style={{ color: GUILD_EMBER }}>{error}</p>}
    </div>
  );
}
