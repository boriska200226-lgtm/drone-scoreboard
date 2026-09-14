"""Фоновая задача: пересчёт Брони в 22:00 по местному времени."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import db, service
from .config import get_settings

log = logging.getLogger("guild.jobs")


def _tz() -> ZoneInfo:
    try:
        return ZoneInfo(get_settings().timezone)
    except Exception:  # noqa: BLE001 — кривая TZ не должна ронять сервер
        log.warning("Неизвестная TZ %s, падаю в UTC", get_settings().timezone)
        return ZoneInfo("UTC")


def seconds_until_next_run(now: datetime, hour: int) -> float:
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_for_all_classes() -> int:
    rows = await db.fetch("SELECT id FROM classes")
    for row in rows:
        try:
            await service.run_armor_job(row["id"])
        except Exception:  # noqa: BLE001 — один класс не блокирует остальные
            log.exception("armor job failed class=%s", row["id"])
    return len(rows)


async def armor_scheduler() -> None:
    settings = get_settings()
    tz = _tz()
    while True:
        delay = seconds_until_next_run(datetime.now(tz), settings.armor_job_hour)
        log.info("Следующий пересчёт Брони через %.0f мин", delay / 60)
        await asyncio.sleep(delay)
        try:
            count = await run_for_all_classes()
            log.info("Броня пересчитана для %s классов", count)
        except Exception:  # noqa: BLE001
            log.exception("armor scheduler tick failed")
