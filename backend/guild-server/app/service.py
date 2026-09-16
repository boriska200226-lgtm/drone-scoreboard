"""Доменные операции «Гильдии»: состояние класса, СЗ, Броня, Древо, Фестиваль."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from . import db, nicknames, rules
from .hub import EVT_ARMOR, EVT_DEBUFF, EVT_FESTIVAL, EVT_SOULS, hub
from .security import gen_password, hash_password

log = logging.getLogger("guild.service")

WEEK = timedelta(days=7)


def now() -> datetime:
    return datetime.now(timezone.utc)


# ─── Журнал ───────────────────────────────────────────────────────────────────
async def audit(class_id: int | None, actor_id: int | None, role: str,
                event: str, payload: dict[str, Any] | None = None) -> None:
    await db.execute(
        "INSERT INTO audit_log (class_id, actor_user_id, actor_role, event, payload)"
        " VALUES ($1, $2, $3, $4, $5::jsonb)",
        class_id, actor_id, role, event, json.dumps(payload or {}, ensure_ascii=False),
    )


# ─── Состояние класса ─────────────────────────────────────────────────────────
async def _class_row(class_id: int):
    row = await db.fetchrow("SELECT * FROM classes WHERE id = $1", class_id)
    if row is None:
        raise LookupError("Класс не найден")
    return row


async def tree_state(class_id: int) -> dict[str, Any]:
    cls = await _class_row(class_id)
    total = await db.fetchval(
        "SELECT COALESCE(SUM(souls), 0) FROM heroes WHERE class_id = $1", class_id
    ) or 0
    percent = rules.tree_percent(int(total), cls["tree_adjust"], cls["class_target"])
    return {
        "percent": percent,
        "color": rules.tree_color(percent),
        "blinks": rules.tree_blinks(percent),
        "total_souls": int(total),
        "class_target": cls["class_target"],
        "adjust": cls["tree_adjust"],
        "bonuses": rules.unlocked_tree_bonuses(percent),
        "festival_ready": rules.festival_ready(percent),
        # Прогноз Фестиваля — только число СЗ, без единого имени (§11.4).
        "souls_to_festival": rules.souls_to_festival(
            int(total), cls["tree_adjust"], cls["class_target"]
        ),
    }


async def altar(class_id: int) -> list[dict[str, Any]]:
    """Публичный Алтарь: клички, уровни, ветки, щиты. Имён здесь нет никогда."""
    rows = await db.fetch(
        "SELECT id, nickname, branch, souls, branch_points, armor, debuff_until,"
        "       weakness_until, avatar"
        " FROM heroes WHERE class_id = $1 ORDER BY souls DESC, nickname ASC",
        class_id,
    )
    ts = now()
    out = []
    for r in rows:
        debuffed = bool(r["debuff_until"] and r["debuff_until"] > ts)
        out.append({
            "hero_id": r["id"],
            "nickname": r["nickname"],
            "avatar": r["avatar"],
            "branch": r["branch"],
            "branch_title": rules.BRANCHES[r["branch"]]["title"],
            "level": rules.level_of(r["souls"]),
            "souls": r["souls"],
            "branch_points": r["branch_points"],
            "branch_percent": rules.clamp(r["branch_points"]),
            "armor": r["armor"],
            "shield": rules.shield_state(r["armor"], debuffed),
            "debuffed": debuffed,
            "weakness": bool(r["weakness_until"] and r["weakness_until"] > ts),
        })
    return out


async def guild_state(class_id: int) -> dict[str, Any]:
    """Полный снимок — то же тело отдаёт REST-fallback GET /api/guild/state."""
    cls = await _class_row(class_id)
    festival = await db.fetchrow(
        "SELECT id, status, tree_at_start, started_at FROM festivals"
        " WHERE class_id = $1 ORDER BY id DESC LIMIT 1",
        class_id,
    )
    return {
        "class": {
            "id": cls["id"],
            "school_code": cls["school_code"],
            "class_name": cls["class_name"],
            "nickname_style": cls["nickname_style"],
            "style_title": nicknames.STYLE_TITLES[cls["nickname_style"]],
        },
        "tree": await tree_state(class_id),
        "altar": await altar(class_id),
        "festival": dict(festival) if festival else None,
        "server_time": now().isoformat(),
    }


async def hero_card(hero_id: int) -> dict[str, Any]:
    """Карта героя — 4 шкалы. Отдаётся только владельцу."""
    r = await db.fetchrow("SELECT * FROM heroes WHERE id = $1", hero_id)
    if r is None:
        raise LookupError("Герой не найден")
    ts = now()
    mana = rules.mana_of(r["hand_raises"])
    cheat_used = await db.fetchval(
        "SELECT COUNT(*) FROM souls_log"
        " WHERE hero_id = $1 AND action = 'cheat_code' AND created_at > $2",
        hero_id, ts - WEEK,
    ) or 0
    recent = await db.fetch(
        "SELECT action, delta, note, created_at FROM souls_log"
        " WHERE hero_id = $1 ORDER BY created_at DESC LIMIT 10",
        hero_id,
    )
    level = rules.level_of(r["souls"])
    level_progress = rules.level_progress(r["souls"])
    debuffed = bool(r["debuff_until"] and r["debuff_until"] > ts)
    return {
        "hero_id": r["id"],
        "nickname": r["nickname"],
        "avatar": r["avatar"],
        "branch": r["branch"],
        "branch_title": rules.BRANCHES[r["branch"]]["title"],
        "bars": [
            {"id": "level", "label": "УРОВЕНЬ", "value": level_progress, "max": rules.LEVEL_SCALE,
             "color": rules.bar_color(level_progress, rules.LEVEL_SCALE),
             "hint": f"Уровень {level} · {r['souls']} СЗ всего"},
            {"id": "tactics", "label": rules.BRANCHES[r["branch"]]["title"].upper(),
             "value": rules.clamp(r["branch_points"]), "max": rules.BRANCH_MAX,
             "color": rules.bar_color(r["branch_points"], rules.BRANCH_MAX),
             "hint": "Вклад в ветку"},
            {"id": "armor", "label": "БРОНЯ", "value": r["armor"], "max": rules.ARMOR_MAX,
             "color": rules.bar_color(r["armor"], rules.ARMOR_MAX),
             "hint": "Дней без 3+ прогулов"},
            {"id": "mana", "label": "МАНА", "value": mana, "max": rules.MANA_MAX,
             "color": rules.bar_color(mana, rules.MANA_MAX),
             "hint": f"{r['hand_raises']} поднятий руки · 3 = 1 мана"},
        ],
        "level": level,
        "souls": r["souls"],
        "shield": rules.shield_state(r["armor"], debuffed),
        "debuffed": debuffed,
        "debuff_until": r["debuff_until"].isoformat() if r["debuff_until"] else None,
        "weakness": bool(r["weakness_until"] and r["weakness_until"] > ts),
        "bonuses": rules.branch_bonuses(r["branch"], r["branch_points"]),
        "cheat_codes_left": max(0, rules.SOUL_ACTIONS["cheat_code"][2] - int(cheat_used)),
        "history": [
            {"action": h["action"], "delta": h["delta"], "note": h["note"],
             "at": h["created_at"].isoformat()}
            for h in recent
        ],
    }


# ─── Начисление СЗ ────────────────────────────────────────────────────────────
class RuleError(Exception):
    """Нарушение игрового правила — отдаётся клиенту как 400."""


async def award_souls(class_id: int, hero_id: int, action: str, note: str = "",
                      actor_id: int | None = None, actor_role: str = "teacher") -> dict[str, Any]:
    if action not in rules.SOUL_ACTIONS:
        raise RuleError(f"Неизвестное действие: {action}")
    delta, title, weekly_limit = rules.SOUL_ACTIONS[action]

    hero = await db.fetchrow(
        "SELECT id, class_id, branch, souls, branch_points, hand_raises"
        " FROM heroes WHERE id = $1 AND class_id = $2",
        hero_id, class_id,
    )
    if hero is None:
        raise LookupError("Герой не найден в этом классе")

    if weekly_limit is not None:
        used = await db.fetchval(
            "SELECT COUNT(*) FROM souls_log"
            " WHERE hero_id = $1 AND action = $2 AND created_at > $3",
            hero_id, action, now() - WEEK,
        ) or 0
        if int(used) >= weekly_limit:
            raise RuleError(f"«{title}» уже использован {weekly_limit} раза на этой неделе")

    # Вклад в ветку растёт вместе с опытом, но своим потолком в 100.
    branch_gain = delta
    raise_gain = 1 if action == "hand_raise" else 0
    await db.execute(
        "UPDATE heroes SET souls = souls + $2,"
        " branch_points = LEAST($4, branch_points + $3), hand_raises = hand_raises + $5"
        " WHERE id = $1",
        hero_id, delta, branch_gain, rules.BRANCH_MAX, raise_gain,
    )
    await db.execute(
        "INSERT INTO souls_log (hero_id, class_id, action, delta, note)"
        " VALUES ($1, $2, $3, $4, $5)",
        hero_id, class_id, action, delta, note,
    )
    await audit(class_id, actor_id, actor_role, "souls_awarded",
                {"hero_id": hero_id, "action": action, "delta": delta})
    return await _publish_souls(class_id, hero_id, delta, title)


async def _publish_souls(class_id: int, hero_id: int, delta: int, title: str) -> dict[str, Any]:
    tree = await tree_state(class_id)
    hero = await db.fetchrow(
        "SELECT nickname, souls, branch_points, branch FROM heroes WHERE id = $1", hero_id
    )
    await hub.broadcast(class_id, EVT_SOULS, {
        "hero_id": hero_id,
        "nickname": hero["nickname"] if hero else None,
        "delta": delta,
        "reason": title,
        "souls": hero["souls"] if hero else None,
        "branch_points": hero["branch_points"] if hero else None,
        "tree": tree,
    })
    await _maybe_announce_festival(class_id, tree)
    return {"ok": True, "delta": delta, "tree": tree}


async def _maybe_announce_festival(class_id: int, tree: dict[str, Any]) -> None:
    if not tree["festival_ready"]:
        return
    await hub.broadcast(class_id, EVT_FESTIVAL, {
        "percent": tree["percent"],
        "threshold": rules.FESTIVAL_THRESHOLD,
        "message": "Древо доросло до Фестиваля",
    })


# ─── Дебафф «мат» и Свисток ───────────────────────────────────────────────────
async def apply_mat(class_id: int, hero_id: int | None, note: str,
                    actor_id: int | None, source: str = "manual") -> dict[str, Any]:
    expires = now() + timedelta(hours=rules.MAT_DEBUFF_HOURS)
    await db.execute(
        "INSERT INTO debuffs (class_id, hero_id, kind, tree_delta, expires_at, source)"
        " VALUES ($1, $2, 'mat', $3, $4, $5)",
        class_id, hero_id, rules.TREE_PENALTY_MAT, expires, source,
    )
    await db.execute(
        "UPDATE classes SET tree_adjust = tree_adjust + $2 WHERE id = $1",
        class_id, rules.TREE_PENALTY_MAT,
    )
    if hero_id is not None:
        await db.execute("UPDATE heroes SET debuff_until = $2 WHERE id = $1", hero_id, expires)
    await audit(class_id, actor_id, "teacher", "mat_debuff",
                {"hero_id": hero_id, "source": source, "note": note})

    tree = await tree_state(class_id)
    await hub.broadcast(class_id, EVT_DEBUFF, {
        "kind": "mat",
        "hero_id": hero_id,
        "tree_delta": rules.TREE_PENALTY_MAT,
        "expires_at": expires.isoformat(),
        "sound": "debuff",
        "vibrate": [100],
        "tree": tree,
    })
    return {"ok": True, "tree": tree, "expires_at": expires.isoformat()}


async def whistle(class_id: int, blasts: int, actor_id: int | None) -> dict[str, Any]:
    """Свисток Хранителя: 1 свист — стоп-игра, 2 — разбор.

    Ничего не считает и не штрафует: это сигнал, который должен прозвучать
    на всех устройствах класса за секунду.
    """
    await db.execute(
        "INSERT INTO debuffs (class_id, kind, tree_delta, source) VALUES ($1, 'whistle', 0, 'manual')",
        class_id,
    )
    await audit(class_id, actor_id, "teacher", "whistle", {"blasts": blasts})
    delivered = await hub.broadcast(class_id, EVT_DEBUFF, {
        "kind": "whistle",
        "blasts": blasts,
        "title": "СТОП-ИГРА" if blasts == 1 else "РАЗБОР",
        "sound": "whistle",
        "vibrate": [100] if blasts == 1 else [100, 80, 100],
        "at": now().isoformat(),
    })
    return {"ok": True, "delivered": delivered, "blasts": blasts}


# ─── Посещаемость и ночной пересчёт Брони ─────────────────────────────────────
async def set_attendance(class_id: int, day: date, items: list[dict[str, Any]],
                         actor_id: int | None) -> dict[str, Any]:
    for it in items:
        await db.execute(
            "INSERT INTO attendance (hero_id, class_id, day, lesson, status)"
            " VALUES ($1, $2, $3, $4, $5)"
            " ON CONFLICT (hero_id, day, lesson) DO UPDATE SET status = EXCLUDED.status",
            it["hero_id"], class_id, day, it["lesson"], it["status"],
        )
    await audit(class_id, actor_id, "teacher", "attendance_set",
                {"day": day.isoformat(), "count": len(items)})
    return {"ok": True, "saved": len(items)}


async def run_armor_job(class_id: int, day: date | None = None) -> dict[str, Any]:
    """Пересчёт Брони за день (по ТЗ — в 22:00).

    Повторный запуск за тот же день ничего не меняет: armor_log уникален
    по (hero_id, day).
    """
    day = day or now().date()
    heroes = await db.fetch("SELECT id, armor FROM heroes WHERE class_id = $1", class_id)
    if not heroes:
        return {"ok": True, "day": day.isoformat(), "processed": 0}

    absences_rows = await db.fetch(
        "SELECT hero_id, COUNT(*) AS n FROM attendance"
        " WHERE class_id = $1 AND day = $2 AND status = 'absent' GROUP BY hero_id",
        class_id, day,
    )
    absences = {r["hero_id"]: int(r["n"]) for r in absences_rows}
    already = {
        r["hero_id"] for r in await db.fetch(
            "SELECT hero_id FROM armor_log WHERE class_id = $1 AND day = $2", class_id, day
        )
    }

    tree_delta_total = 0
    changed: list[dict[str, Any]] = []
    for h in heroes:
        if h["id"] in already:
            continue
        n = absences.get(h["id"], 0)
        outcome = rules.armor_outcome(n)
        new_armor = rules.apply_armor(h["armor"], outcome.armor_delta)
        weak_until = now() + timedelta(days=rules.WEAKNESS_DAYS) if outcome.weakness else None

        await db.execute(
            "UPDATE heroes SET armor = $2,"
            " weakness_until = COALESCE($3, weakness_until) WHERE id = $1",
            h["id"], new_armor, weak_until,
        )
        await db.execute(
            "INSERT INTO armor_log (hero_id, class_id, day, absences, armor_delta,"
            " tree_delta, weakness) VALUES ($1, $2, $3, $4, $5, $6, $7)"
            " ON CONFLICT (hero_id, day) DO NOTHING",
            h["id"], class_id, day, n, outcome.armor_delta, outcome.tree_delta,
            outcome.weakness,
        )
        if outcome.tree_delta:
            tree_delta_total += outcome.tree_delta
            await db.execute(
                "INSERT INTO debuffs (class_id, hero_id, kind, tree_delta, source)"
                " VALUES ($1, $2, 'absence', $3, 'auto')",
                class_id, h["id"], outcome.tree_delta,
            )
        if outcome.armor_delta or outcome.weakness:
            changed.append({
                "hero_id": h["id"], "armor": new_armor,
                "delta": outcome.armor_delta, "absences": n,
                "weakness": outcome.weakness,
            })

    if tree_delta_total:
        await db.execute(
            "UPDATE classes SET tree_adjust = tree_adjust + $2 WHERE id = $1",
            class_id, tree_delta_total,
        )

    tree = await tree_state(class_id)
    if changed:
        await hub.broadcast(class_id, EVT_ARMOR, {
            "day": day.isoformat(), "changed": changed, "tree": tree,
        })
    await audit(class_id, None, "system", "armor_job",
                {"day": day.isoformat(), "changed": len(changed), "tree_delta": tree_delta_total})
    return {"ok": True, "day": day.isoformat(), "processed": len(changed), "tree": tree}


# ─── Фестиваль ────────────────────────────────────────────────────────────────
FESTIVAL_PROGRAM = [
    {"id": "scroll", "title": "Свиток", "minutes": 10},
    {"id": "games", "title": "3 игры: Тактики / Хранитель / Искатели", "minutes": 35},
    {"id": "tea", "title": "Чай (меню голосованием)", "minutes": 25},
    {"id": "mic", "title": "Микрофон — 30 секунд каждому", "minutes": 15},
    {"id": "meme", "title": "Анти-мат мем", "minutes": 5},
]


async def festival_forecast(class_id: int) -> dict[str, Any]:
    tree = await tree_state(class_id)
    heroes = await db.fetchval(
        "SELECT COUNT(*) FROM heroes WHERE class_id = $1", class_id
    ) or 0
    left = tree["souls_to_festival"]
    return {
        "tree_percent": tree["percent"],
        "threshold": rules.FESTIVAL_THRESHOLD,
        "ready": tree["festival_ready"],
        "souls_left": left,
        "heroes": int(heroes),
        # Сколько добрых дел на каждого — подсказка классу, а не рейтинг людей.
        "souls_left_per_hero": (left + int(heroes) - 1) // int(heroes) if heroes else left,
        "program": FESTIVAL_PROGRAM,
        "total_minutes": sum(b["minutes"] for b in FESTIVAL_PROGRAM),
    }


async def start_festival(class_id: int, actor_id: int | None) -> dict[str, Any]:
    tree = await tree_state(class_id)
    status = "running" if tree["festival_ready"] else "raid"
    row = await db.fetchrow(
        "INSERT INTO festivals (class_id, status, tree_at_start) VALUES ($1, $2, $3)"
        " RETURNING id, status, tree_at_start, started_at",
        class_id, status, tree["percent"],
    )
    await audit(class_id, actor_id, "teacher", "festival_started",
                {"status": status, "tree": tree["percent"]})
    await hub.broadcast(class_id, EVT_FESTIVAL, {
        "started": True, "status": status, "percent": tree["percent"],
        "program": FESTIVAL_PROGRAM,
        "message": "Фестиваль начался" if status == "running" else "Рейд — печенья не будет",
    })
    return {"ok": True, "festival": dict(row), "tree": tree, "program": FESTIVAL_PROGRAM}


# ─── Тихая почта ──────────────────────────────────────────────────────────────
async def quiet_mail(class_id: int, hero_id: int, sticker: str) -> dict[str, Any]:
    await db.execute(
        "INSERT INTO quiet_mail (hero_id, class_id, sticker) VALUES ($1, $2, $3)",
        hero_id, class_id, sticker,
    )
    # Стикер стоит 2 СЗ — по ТЗ письмо всегда вознаграждается.
    await db.execute("UPDATE heroes SET souls = souls + 2 WHERE id = $1", hero_id)
    await db.execute(
        "INSERT INTO souls_log (hero_id, class_id, action, delta, note)"
        " VALUES ($1, $2, 'quiet_mail', 2, '')",
        hero_id, class_id,
    )
    await audit(class_id, None, "student", "quiet_mail", {"sticker": sticker})
    await _publish_souls(class_id, hero_id, 2, "Тихая почта")
    return {"ok": True, "delta": 2}


# ─── Создание класса и учёток ─────────────────────────────────────────────────
async def create_class(school_code: str, class_name: str, teacher_password: str,
                       nickname_style: str, class_target: int) -> dict[str, Any]:
    existing = await db.fetchval(
        "SELECT id FROM classes WHERE school_code = $1 AND class_name = $2",
        school_code, class_name,
    )
    if existing:
        raise RuleError("Такой класс уже создан")

    class_id = await db.fetchval(
        "INSERT INTO classes (school_code, class_name, nickname_style, class_target)"
        " VALUES ($1, $2, $3, $4) RETURNING id",
        school_code, class_name, nickname_style, class_target,
    )
    login = f"t_{school_code}_{class_name}"
    user_id = await db.fetchval(
        "INSERT INTO users (class_id, login, password_hash, role)"
        " VALUES ($1, $2, $3, 'teacher') RETURNING id",
        class_id, login, hash_password(teacher_password),
    )
    await audit(class_id, user_id, "teacher", "class_created",
                {"school_code": school_code, "class_name": class_name})
    return {"class_id": class_id, "teacher_login": login, "user_id": user_id}


async def generate_students(class_id: int, count: int, real_names: list[str],
                            actor_id: int | None) -> list[dict[str, str]]:
    cls = await _class_row(class_id)
    taken = {
        r["nickname"] for r in await db.fetch(
            "SELECT nickname FROM heroes WHERE class_id = $1", class_id
        )
    }
    try:
        pairs = nicknames.allocate(cls["nickname_style"], count, taken)
    except ValueError as exc:
        raise RuleError(str(exc)) from exc

    start = await db.fetchval(
        "SELECT COUNT(*) FROM users WHERE class_id = $1 AND role = 'student'", class_id
    ) or 0

    cipher = None
    if real_names:
        from .security import RegistryCipher
        cipher = RegistryCipher()

    created: list[dict[str, str]] = []
    for i, (nickname, branch) in enumerate(pairs):
        number = int(start) + i + 1
        login = f"s_{cls['class_name']}_{number:02d}"
        password = gen_password()
        user_id = await db.fetchval(
            "INSERT INTO users (class_id, login, password_hash, role)"
            " VALUES ($1, $2, $3, 'student') RETURNING id",
            class_id, login, hash_password(password),
        )
        hero_id = await db.fetchval(
            "INSERT INTO heroes (user_id, class_id, nickname, branch) "
            " VALUES ($1, $2, $3, $4) RETURNING id",
            user_id, class_id, nickname, branch,
        )
        if cipher is not None and i < len(real_names) and real_names[i].strip():
            await db.execute(
                "INSERT INTO registry (hero_id, class_id, real_name_enc) VALUES ($1, $2, $3)"
                " ON CONFLICT (hero_id) DO UPDATE SET real_name_enc = EXCLUDED.real_name_enc",
                hero_id, class_id, cipher.encrypt(real_names[i].strip()),
            )
        created.append({
            "login": login, "password": password,
            "nickname": nickname, "branch": branch,
        })

    await audit(class_id, actor_id, "teacher", "students_generated", {"count": len(created)})
    return created


async def reset_password(class_id: int, login: str, actor_id: int | None) -> str:
    new_password = gen_password()
    updated = await db.fetchval(
        "UPDATE users SET password_hash = $3 WHERE class_id = $1 AND login = $2"
        " AND role = 'student' RETURNING id",
        class_id, login, hash_password(new_password),
    )
    if not updated:
        raise LookupError("Ученик не найден")
    await db.execute("DELETE FROM sessions WHERE user_id = $1", updated)
    await audit(class_id, actor_id, "teacher", "password_reset", {"login": login})
    return new_password


# ─── Карта гильдии для учителя ────────────────────────────────────────────────
async def guild_map(class_id: int) -> dict[str, Any]:
    """Сводка для учителя: динамика класса без персональных имён."""
    rows = await db.fetch(
        "SELECT branch, COUNT(*) AS n, COALESCE(SUM(souls), 0) AS souls,"
        "       COALESCE(AVG(armor), 0) AS armor"
        " FROM heroes WHERE class_id = $1 GROUP BY branch",
        class_id,
    )
    mail = await db.fetch(
        "SELECT sticker, COUNT(*) AS n FROM quiet_mail"
        " WHERE class_id = $1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY sticker",
        class_id,
    )
    low_armor = await db.fetchval(
        "SELECT COUNT(*) FROM heroes WHERE class_id = $1 AND armor <= 3", class_id
    ) or 0
    return {
        "branches": [
            {"branch": r["branch"], "title": rules.BRANCHES[r["branch"]]["title"],
             "heroes": int(r["n"]), "souls": int(r["souls"]),
             "avg_armor": round(float(r["armor"]), 1)}
            for r in rows
        ],
        "quiet_mail_week": {r["sticker"]: int(r["n"]) for r in mail},
        "heroes_low_armor": int(low_armor),
        "tree": await tree_state(class_id),
    }
