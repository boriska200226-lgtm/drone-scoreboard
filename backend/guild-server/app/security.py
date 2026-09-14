"""Пароли, токены, шифрование Реестра и 2FA Хранителя."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import string
import struct
import time

import bcrypt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

# Пароль ученика — 12 символов по ТЗ. Похожие глифы (0/O, 1/l/I) исключены,
# чтобы 7-классник не спотыкался при вводе с бумажной карточки.
PASSWORD_ALPHABET = "".join(
    c for c in (string.ascii_letters + string.digits) if c not in "0O1lI"
)
PASSWORD_LENGTH = 12


def gen_password(length: int = PASSWORD_LENGTH) -> str:
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))


def gen_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    rounds = get_settings().bcrypt_rounds
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (ValueError, TypeError):
        return False


# ─── Реестр «кличка → имя» ────────────────────────────────────────────────────
class RegistryCipher:
    """Шифрует связку клички с настоящим именем.

    В БД лежит только шифротекст: даже дамп базы не выдаёт, кто есть кто.
    """

    def __init__(self, key: str | None = None) -> None:
        raw = key if key is not None else get_settings().registry_key
        if not raw:
            raise RuntimeError(
                "REGISTRY_KEY не задан — Реестр нельзя ни зашифровать, ни прочитать. "
                "Сгенерируй: python -c \"from cryptography.fernet import Fernet;"
                "print(Fernet.generate_key().decode())\""
            )
        self._fernet = Fernet(raw.encode() if isinstance(raw, str) else raw)

    def encrypt(self, plaintext: str) -> bytes:
        return self._fernet.encrypt(plaintext.encode())

    def decrypt(self, ciphertext: bytes) -> str:
        try:
            return self._fernet.decrypt(bytes(ciphertext)).decode()
        except InvalidToken as exc:  # ключ сменили или данные повреждены
            raise RuntimeError("Реестр не расшифровывается текущим REGISTRY_KEY") from exc


# ─── 2FA (TOTP, RFC 6238) ─────────────────────────────────────────────────────
# SMS-провайдер в школьной установке обычно недоступен, поэтому второй фактор —
# TOTP: любое приложение-аутентификатор или бот в Telegram, который его считает.
TOTP_STEP = 30
TOTP_DIGITS = 6


def gen_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret: str, timestamp: float | None = None, step: int = TOTP_STEP) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int((timestamp if timestamp is not None else time.time()) // step)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    code = (code or "").strip()
    if not code.isdigit():
        return False
    now = time.time()
    return any(
        hmac.compare_digest(totp_at(secret, now + drift * TOTP_STEP), code)
        for drift in range(-window, window + 1)
    )


def totp_uri(secret: str, login: str, issuer: str = "Гильдия") -> str:
    from urllib.parse import quote

    return (
        f"otpauth://totp/{quote(issuer)}:{quote(login)}"
        f"?secret={secret}&issuer={quote(issuer)}&digits={TOTP_DIGITS}&period={TOTP_STEP}"
    )
