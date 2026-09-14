"""Вход, выход и второй фактор Хранителя."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .. import db
from ..auth import Principal, authenticate, current_user, drop_session
from ..config import get_settings
from ..schemas import LoginIn, LoginOut
from ..security import gen_totp_secret, totp_uri, verify_password, verify_totp

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn) -> LoginOut:
    principal, token = await authenticate(body.login, body.password, body.totp)
    cls = await db.fetchrow(
        "SELECT class_name FROM classes WHERE id = $1", principal.class_id
    )
    nickname = None
    if principal.hero_id:
        nickname = await db.fetchval(
            "SELECT nickname FROM heroes WHERE id = $1", principal.hero_id
        )
    return LoginOut(
        token=token, role=principal.role, login=principal.login,
        class_id=principal.class_id, class_name=cls["class_name"] if cls else "",
        hero_id=principal.hero_id, nickname=nickname,
    )


@router.post("/logout")
async def logout(x_token: str = Header(default="")) -> dict[str, bool]:
    await drop_session(x_token)
    return {"ok": True}


@router.get("/me")
async def me(user: Principal = Depends(current_user)) -> dict[str, object]:
    return {
        "user_id": user.user_id, "login": user.login, "role": user.role,
        "class_id": user.class_id, "hero_id": user.hero_id,
    }


class TwoFaSetupIn(BaseModel):
    login: str
    password: str = Field(min_length=1)


class TwoFaConfirmIn(TwoFaSetupIn):
    code: str = Field(min_length=6, max_length=8)


async def _teacher_by_password(login: str, password: str):
    row = await db.fetchrow(
        "SELECT id, role, password_hash, totp_secret, totp_confirmed FROM users"
        " WHERE login = $1 AND role = 'teacher' AND is_active",
        login.strip(),
    )
    if row is None or not verify_password(password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    return row


@router.post("/2fa/setup")
async def twofa_setup(body: TwoFaSetupIn) -> dict[str, object]:
    """Выдаёт секрет для приложения-аутентификатора.

    Пока код не подтверждён, секрет можно перевыпустить; после подтверждения —
    только через сброс на сервере.
    """
    row = await _teacher_by_password(body.login, body.password)
    if row["totp_confirmed"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Второй фактор уже подключён")
    secret = gen_totp_secret()
    await db.execute(
        "UPDATE users SET totp_secret = $2, totp_confirmed = FALSE WHERE id = $1",
        row["id"], secret,
    )
    return {"secret": secret, "otpauth_url": totp_uri(secret, body.login)}


@router.post("/2fa/confirm")
async def twofa_confirm(body: TwoFaConfirmIn) -> dict[str, bool]:
    row = await _teacher_by_password(body.login, body.password)
    if not row["totp_secret"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сначала вызови /2fa/setup")
    if not verify_totp(row["totp_secret"], body.code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Код не совпал")
    await db.execute("UPDATE users SET totp_confirmed = TRUE WHERE id = $1", row["id"])
    return {"ok": True}


@router.get("/config")
async def auth_config() -> dict[str, bool]:
    return {"require_teacher_2fa": get_settings().require_teacher_2fa}
