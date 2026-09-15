import { useEffect, useState } from "react";
import QRCode from "qrcode";

import Icon from "@/components/ui/icon";

import { api, ApiError } from "../api";
import type { Credential } from "../types";
import { BRANCH_THEME, GUILD_EMBER, GUILD_GOLD, GUILD_GREEN, NEON_CYAN, ring } from "../theme";
import { BranchSigil, HeroAvatar } from "./art";

/**
 * Карточки доступа.
 *
 * Пароли приходят с сервера один-единственный раз — дальше в базе только
 * bcrypt-хэш. Поэтому страницу нельзя «открыть заново»: карточки печатают
 * сразу, а несохранённые пароли восстановлению не подлежат, только сбросу.
 */
export function CardsSheet({ token, className }: { token: string; className: string }) {
  const [count, setCount] = useState(25);
  const [names, setNames] = useState("");
  const [cards, setCards] = useState<Credential[]>([]);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cards.length === 0) return;
    let alive = true;
    // QR ведёт на страницу входа с подставленным логином: ученику остаётся
    // ввести только пароль с карточки.
    Promise.all(cards.map(async (card) => {
      const url = `${window.location.origin}/guild?login=${encodeURIComponent(card.login)}`;
      return [card.login, await QRCode.toDataURL(url, {
        width: 320, margin: 0, color: { dark: "#10231a", light: "#ffffff" },
      })] as const;
    })).then((pairs) => {
      if (alive) setQr(Object.fromEntries(pairs));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [cards]);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const realNames = names.split("\n").map((n) => n.trim()).filter(Boolean);
      setCards(await api.generate(token, count, realNames));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать учётки");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="guild-panel p-5 space-y-4 guild-no-print" style={ring(NEON_CYAN, GUILD_GOLD)}>
        <div>
          <h2 className="font-orbitron text-sm tracking-[0.16em] mb-1">🎟️ КАРТОЧКИ ДОСТУПА</h2>
          <p className="font-rajdhani text-sm" style={{ color: "#a9bcdd" }}>
            Логины по шаблону s_{className}_NN, пароли по 12 символов, клички без повторов.
            Пароли показываются один раз — распечатай сразу.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="font-rajdhani text-sm">
            <span className="block text-[10px] font-orbitron tracking-[0.16em] mb-1"
                  style={{ color: "#a9bcdd" }}>СКОЛЬКО</span>
            <input
              type="number"
              min={1}
              max={40}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-24 rounded-lg px-3 py-2 outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6f0ff" }}
            />
          </label>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="guild-btn px-4 py-2.5 rounded-xl font-orbitron text-xs font-bold disabled:opacity-50 flex items-center gap-2"
            style={{ background: `linear-gradient(120deg, ${NEON_CYAN}, ${GUILD_GREEN})`,
                     color: "#05060f", boxShadow: `0 0 26px -10px ${GUILD_GREEN}` }}
          >
            {busy ? <Icon name="Loader" size={14} className="animate-spin" /> : <Icon name="UserPlus" size={14} />}
            СОЗДАТЬ {count}
          </button>

          {cards.length > 0 && (
            <button
              type="button"
              onClick={() => window.print()}
              className="guild-btn px-4 py-2.5 rounded-xl font-orbitron text-xs flex items-center gap-2"
              style={{ background: "rgba(255,255,255,0.06)", color: GUILD_GOLD }}
            >
              <Icon name="Printer" size={14} /> ПЕЧАТЬ / PDF
            </button>
          )}
        </div>

        <details>
          <summary className="font-rajdhani text-sm cursor-pointer" style={{ color: "#a9bcdd" }}>
            Заполнить Реестр (необязательно)
          </summary>
          <p className="font-rajdhani text-xs mt-2 mb-2" style={{ color: "#6d7fa3" }}>
            По одному имени в строке, в том же порядке, что и карточки. Имена уходят
            в зашифрованный Реестр и больше нигде не показываются. Оставь поле пустым —
            и связь «кличка → ученик» останется только у тебя в голове.
          </p>
          <textarea
            rows={4}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={"Иванов Пётр\nСидорова Аня"}
            className="w-full rounded-lg px-3 py-2 font-rajdhani text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e6f0ff" }}
          />
        </details>

        {error && (
          <p className="font-rajdhani text-sm flex items-center gap-2" style={{ color: GUILD_EMBER }}>
            <Icon name="AlertCircle" size={13} /> {error}
          </p>
        )}

        {cards.length > 0 && (
          <p className="font-rajdhani text-sm flex items-center gap-2" style={{ color: GUILD_GOLD }}>
            <Icon name="TriangleAlert" size={13} />
            Не закрывай страницу, пока не распечатал: пароли не хранятся открытыми.
          </p>
        )}
      </div>

      {cards.length > 0 && (
        <div className="guild-print-sheet grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <article
              key={card.login}
              className="guild-print-card relative rounded-2xl p-4 overflow-hidden"
              style={{
                border: `1.5px solid ${BRANCH_THEME[card.branch].color}66`,
                background: `linear-gradient(150deg, ${BRANCH_THEME[card.branch].soft}, rgba(12,18,15,0.6))`,
              }}
            >
              <header className="flex items-center justify-between mb-3">
                <span className="font-orbitron text-[10px] tracking-[0.18em]"
                      style={{ color: "#93ab9f" }}>
                  ГИЛЬДИЯ · {className}
                </span>
                <span style={{ color: BRANCH_THEME[card.branch].color }}>
                  <BranchSigil branch={card.branch} size={18} />
                </span>
              </header>

              <div className="flex gap-3 items-center">
                <HeroAvatar avatar="" nickname={card.nickname} branch={card.branch} size={46} />

                <div className="min-w-0 flex-1">
                  <p className="font-orbitron text-lg font-black truncate leading-tight">
                    {card.nickname}
                  </p>
                  <p className="font-rajdhani text-[11px]"
                     style={{ color: BRANCH_THEME[card.branch].color }}>
                    {BRANCH_THEME[card.branch].title} · «{BRANCH_THEME[card.branch].motto}»
                  </p>
                  <dl className="mt-2 space-y-0.5 font-rajdhani text-sm">
                    <div className="flex gap-2">
                      <dt style={{ color: "#7f93b8" }}>логин</dt>
                      <dd className="font-mono">{card.login}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt style={{ color: "#7f93b8" }}>пароль</dt>
                      <dd className="font-mono tracking-wider font-semibold">{card.password}</dd>
                    </div>
                  </dl>
                </div>

                {qr[card.login] && (
                  <img
                    src={qr[card.login]}
                    alt={`QR для входа ${card.login}`}
                    className="w-[74px] h-[74px] rounded-lg bg-white p-1 shrink-0"
                  />
                )}
              </div>

              <footer className="mt-3 pt-2 font-rajdhani text-[10px]"
                      style={{ borderTop: "1px dashed rgba(127,148,136,0.4)", color: "#7f93b8" }}>
                Карточка личная. Пароль никому не показывай — даже другу из гильдии.
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default CardsSheet;
