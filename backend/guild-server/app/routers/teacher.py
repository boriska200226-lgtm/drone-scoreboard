"""Кабинет Хранителя Реестра."""
from __future__ import annotations

import csv
import io
from datetime import date

from fastapi import APIRouter, Body, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import db, service
from ..auth import Principal, current_teacher
from ..config import get_settings
from ..schemas import (
    AttendanceIn, AwardIn, CreateClassIn, GeneratedCredential,
    GenerateStudentsIn, MatIn, ResetPasswordIn, WhistleIn,
)
from ..security import RegistryCipher, verify_totp
from ..service import RuleError

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


def _rule_error(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ─── Первый запуск ────────────────────────────────────────────────────────────
@router.post("/class", status_code=status.HTTP_201_CREATED)
async def create_class(
    body: CreateClassIn, x_bootstrap_token: str = Header(default="")
) -> dict[str, object]:
    """Создание класса. Доступно только с BOOTSTRAP_TOKEN сервера."""
    expected = get_settings().bootstrap_token
    if not expected or x_bootstrap_token != expected:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужен X-Bootstrap-Token")
    try:
        return await service.create_class(
            body.school_code, body.class_name, body.teacher_password,
            body.nickname_style, body.class_target,
        )
    except RuleError as exc:
        raise _rule_error(exc) from exc


@router.post("/students/generate", response_model=list[GeneratedCredential])
async def generate_students(
    body: GenerateStudentsIn, user: Principal = Depends(current_teacher)
) -> list[dict[str, str]]:
    """Кнопка «Создать 25».

    Пароли возвращаются открытым текстом ровно один раз — дальше в базе
    только bcrypt-хэш, и восстановить их нельзя, можно лишь сбросить.
    """
    try:
        return await service.generate_students(
            user.class_id, body.count, body.real_names, user.user_id
        )
    except RuleError as exc:
        raise _rule_error(exc) from exc


@router.get("/students")
async def list_students(user: Principal = Depends(current_teacher)) -> dict[str, object]:
    rows = await db.fetch(
        "SELECT u.login, h.id AS hero_id, h.nickname, h.branch, h.souls, h.armor,"
        "       h.branch_points, h.debuff_until, u.created_at"
        " FROM users u JOIN heroes h ON h.user_id = u.id"
        " WHERE u.class_id = $1 AND u.role = 'student' AND u.is_active"
        " ORDER BY h.nickname",
        user.class_id,
    )
    return {"students": [dict(r) for r in rows]}


@router.post("/students/reset-password")
async def reset_password(
    body: ResetPasswordIn, user: Principal = Depends(current_teacher)
) -> dict[str, str]:
    try:
        new_password = await service.reset_password(user.class_id, body.login, user.user_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return {
        "login": body.login,
        "password": new_password,
        # Шаблон уведомления родителю: без клички и без чужих данных (§8).
        "parent_message": (
            "Здравствуйте! Доступ вашего ребёнка к классному порталу восстановлен. "
            f"Логин: {body.login}. Новый пароль выдан лично на бумажной карточке. "
            "Пароль никому не пересылайте."
        ),
    }


# ─── Игровые действия ─────────────────────────────────────────────────────────
@router.post("/award")
async def award(body: AwardIn, user: Principal = Depends(current_teacher)) -> dict[str, object]:
    try:
        return await service.award_souls(
            user.class_id, body.hero_id, body.action, body.note, user.user_id
        )
    except RuleError as exc:
        raise _rule_error(exc) from exc
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post("/attendance")
async def attendance(
    body: AttendanceIn, user: Principal = Depends(current_teacher)
) -> dict[str, object]:
    day = body.day or date.today()
    return await service.set_attendance(
        user.class_id, day, [i.model_dump() for i in body.items], user.user_id
    )


@router.post("/armor/run")
async def armor_run(
    user: Principal = Depends(current_teacher), day: date | None = Body(default=None, embed=True)
) -> dict[str, object]:
    """Ручной запуск ночного пересчёта — на случай, если сервер спал в 22:00."""
    return await service.run_armor_job(user.class_id, day)


@router.post("/mat")
async def mat(body: MatIn, user: Principal = Depends(current_teacher)) -> dict[str, object]:
    return await service.apply_mat(user.class_id, body.hero_id, body.note, user.user_id)


@router.post("/whistle")
async def whistle(
    body: WhistleIn, user: Principal = Depends(current_teacher)
) -> dict[str, object]:
    return await service.whistle(user.class_id, body.blasts, user.user_id)


@router.post("/festival/start")
async def festival_start(user: Principal = Depends(current_teacher)) -> dict[str, object]:
    return await service.start_festival(user.class_id, user.user_id)


# ─── Карта гильдии и почта ────────────────────────────────────────────────────
@router.get("/map")
async def guild_map(user: Principal = Depends(current_teacher)) -> dict[str, object]:
    return await service.guild_map(user.class_id)


@router.get("/quiet-mail")
async def quiet_mail(user: Principal = Depends(current_teacher)) -> dict[str, object]:
    """Тихая почта приходит обезличенной: виден стикер и день, но не автор."""
    rows = await db.fetch(
        "SELECT sticker, DATE(created_at) AS day, COUNT(*) AS n FROM quiet_mail"
        " WHERE class_id = $1 AND created_at > NOW() - INTERVAL '30 days'"
        " GROUP BY sticker, DATE(created_at) ORDER BY day DESC",
        user.class_id,
    )
    return {
        "letters": [
            {"sticker": r["sticker"], "day": r["day"].isoformat(), "count": int(r["n"])}
            for r in rows
        ]
    }


# ─── Реестр ───────────────────────────────────────────────────────────────────
class RegistryLookupIn(BaseModel):
    hero_id: int
    totp: str = Field(min_length=6, max_length=8)


@router.post("/registry/lookup")
async def registry_lookup(
    body: RegistryLookupIn, user: Principal = Depends(current_teacher)
) -> dict[str, object]:
    """Расшифровка «кличка → имя».

    Самая чувствительная операция в системе, поэтому она требует свежий код
    2FA на каждый запрос и пишется в журнал.
    """
    secret = await db.fetchval(
        "SELECT totp_secret FROM users WHERE id = $1 AND totp_confirmed", user.user_id
    )
    if not secret or not verify_totp(secret, body.totp):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен действующий код 2FA")

    row = await db.fetchrow(
        "SELECT r.real_name_enc, h.nickname FROM registry r"
        " JOIN heroes h ON h.id = r.hero_id"
        " WHERE r.hero_id = $1 AND r.class_id = $2",
        body.hero_id, user.class_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "В Реестре нет записи")
    try:
        real_name = RegistryCipher().decrypt(row["real_name_enc"])
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

    await service.audit(user.class_id, user.user_id, "teacher", "registry_lookup",
                        {"hero_id": body.hero_id})
    return {"hero_id": body.hero_id, "nickname": row["nickname"], "real_name": real_name}


# ─── Экспорт ──────────────────────────────────────────────────────────────────
@router.get("/export.csv")
async def export_csv(user: Principal = Depends(current_teacher)) -> StreamingResponse:
    """Выгрузка по кличкам. Настоящих имён в файле нет — их незачем носить на флешке."""
    rows = await db.fetch(
        "SELECT h.nickname, h.branch, h.souls, h.branch_points, h.armor, u.login"
        " FROM heroes h JOIN users u ON u.id = h.user_id"
        " WHERE h.class_id = $1 ORDER BY h.souls DESC",
        user.class_id,
    )
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Кличка", "Ветка", "СЗ", "Вклад в ветку", "Броня", "Логин"])
    for r in rows:
        writer.writerow([r["nickname"], r["branch"], r["souls"], r["branch_points"],
                         r["armor"], r["login"]])
    buf.seek(0)
    await service.audit(user.class_id, user.user_id, "teacher", "export_csv", {"rows": len(rows)})
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="guild.csv"'},
    )
