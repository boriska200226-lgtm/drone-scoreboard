"""Сессии и зависимости доступа."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Header, HTTPException, status

from . import db
from .config import get_settings
from .security import gen_token, verify_password, verify_totp
from .service import audit, now


@dataclass(frozen=True)
class Principal:
    user_id: int
    login: str
    role: str
    class_id: int
    hero_id: int | None


async def create_session(user_id: int, class_id: int, role: str) -> str:
    token = gen_token()
    expires = now() + timedelta(days=get_settings().session_days)
    await db.execute(
        "INSERT INTO sessions (token, user_id, class_id, role, expires_at)"
        " VALUES ($1, $2, $3, $4, $5)",
        token, user_id, class_id, role, expires,
    )
    return token


async def drop_session(token: str) -> None:
    await db.execute("DELETE FROM sessions WHERE token = $1", token)


async def authenticate(login: str, password: str, totp: str | None) -> tuple[Principal, str]:
    row = await db.fetchrow(
        "SELECT u.id, u.login, u.role, u.class_id, u.password_hash, u.totp_secret,"
        "       u.totp_confirmed, u.is_active, h.id AS hero_id"
        " FROM users u LEFT JOIN heroes h ON h.user_id = u.id"
        " WHERE u.login = $1",
        login.strip(),
    )
    # Проверяем пароль даже для несуществующего логина — иначе по времени
    # ответа можно перебрать, какие логины заведены.
    stored = row["password_hash"] if row else "$2b$12$" + "." * 53
    ok = verify_password(password, stored)
    if not row or not ok or not row["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")

    settings = get_settings()
    if row["role"] == "teacher" and settings.require_teacher_2fa:
        if not row["totp_secret"] or not row["totp_confirmed"]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Второй фактор не настроен. Зайди на /api/auth/2fa/setup с этим паролем.",
            )
        if not totp or not verify_totp(row["totp_secret"], totp):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный код 2FA")

    principal = Principal(
        user_id=row["id"], login=row["login"], role=row["role"],
        class_id=row["class_id"], hero_id=row["hero_id"],
    )
    token = await create_session(principal.user_id, principal.class_id, principal.role)
    await audit(principal.class_id, principal.user_id, principal.role, "login", {})
    return principal, token


async def principal_from_token(token: str) -> Principal | None:
    if not token:
        return None
    row = await db.fetchrow(
        "SELECT s.user_id, s.class_id, s.role, u.login, h.id AS hero_id"
        " FROM sessions s"
        " JOIN users u ON u.id = s.user_id"
        " LEFT JOIN heroes h ON h.user_id = u.id"
        " WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active",
        token,
    )
    if row is None:
        return None
    return Principal(
        user_id=row["user_id"], login=row["login"], role=row["role"],
        class_id=row["class_id"], hero_id=row["hero_id"],
    )


async def current_user(x_token: str = Header(default="")) -> Principal:
    principal = await principal_from_token(x_token)
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Не авторизован")
    return principal


async def current_teacher(user: Principal = Depends(current_user)) -> Principal:
    if user.role != "teacher":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только Хранитель Реестра")
    return user


async def current_student(user: Principal = Depends(current_user)) -> Principal:
    if user.role != "student" or user.hero_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только ученик")
    return user
