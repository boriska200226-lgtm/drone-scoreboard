"""Точка входа: FastAPI + WebSocket + ночной пересчёт Брони."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import get_settings
from .jobs import armor_scheduler
from .routers import auth, public, student, teacher, ws

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("guild")


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    await db.connect()
    tasks: list[asyncio.Task[None]] = []
    if settings.run_scheduler:
        tasks.append(asyncio.create_task(armor_scheduler()))
    log.info(
        "Гильдия запущена: схема=%s, 2FA учителя=%s, планировщик=%s",
        settings.db_schema, settings.require_teacher_2fa, settings.run_scheduler,
    )
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await db.disconnect()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Гильдия",
        version="1.0.0",
        description="Закрытая RPG-платформа класса: Алтарь, Древо, Броня, Фестиваль.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Token", "X-Bootstrap-Token"],
    )
    for module in (auth, public, student, teacher, ws):
        application.include_router(module.router)

    @application.get("/health", tags=["service"])
    async def health() -> dict[str, object]:
        try:
            await db.fetchval("SELECT 1")
            database = "up"
        except Exception:  # noqa: BLE001 — health не должен падать вместе с БД
            database = "down"
        return {"status": "ok", "db": database}

    return application


app = create_app()
