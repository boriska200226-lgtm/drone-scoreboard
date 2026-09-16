"""Конфигурация сервера «Гильдии» — всё из переменных окружения."""
from __future__ import annotations

import os
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    def __init__(self) -> None:
        self.database_url: str = os.environ.get(
            "DATABASE_URL", "postgresql://guild:guild@localhost:5432/guild"
        )
        self.db_schema: str = os.environ.get("DB_SCHEMA", "guild")
        # Ключ Fernet для реестра «кличка → имя». Обязателен в проде.
        self.registry_key: str = os.environ.get("REGISTRY_KEY", "")
        self.session_days: int = int(os.environ.get("SESSION_DAYS", "30"))
        # Часовой пояс и час ночного пересчёта Брони (по ТЗ — 22:00).
        self.armor_job_hour: int = int(os.environ.get("ARMOR_JOB_HOUR", "22"))
        self.timezone: str = os.environ.get("TZ_NAME", "Europe/Moscow")
        self.cors_origins: list[str] = [
            o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()
        ]
        # 2FA учителя: в школьной установке можно временно выключить.
        self.require_teacher_2fa: bool = _bool("REQUIRE_TEACHER_2FA", True)
        self.bcrypt_rounds: int = int(os.environ.get("BCRYPT_ROUNDS", "12"))
        self.run_scheduler: bool = _bool("RUN_SCHEDULER", True)
        # Разовый секрет для создания первого класса (первый запуск, §10).
        self.bootstrap_token: str = os.environ.get("BOOTSTRAP_TOKEN", "")

    @property
    def qualified(self) -> str:
        """Имя схемы, пригодное для подстановки в SQL (валидируется)."""
        name = self.db_schema
        if not name.replace("_", "").isalnum():
            raise ValueError(f"Недопустимое имя схемы: {name!r}")
        return name


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
