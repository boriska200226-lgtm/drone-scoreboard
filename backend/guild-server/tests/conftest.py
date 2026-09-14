"""Интеграционные фикстуры. Нужен PostgreSQL: GUILD_TEST_DATABASE_URL."""
from __future__ import annotations

import asyncio
import os

import pytest
import pytest_asyncio

TEST_DB = os.environ.get("GUILD_TEST_DATABASE_URL")
TEST_SCHEMA = "guild_test"

requires_db = pytest.mark.skipif(
    not TEST_DB, reason="GUILD_TEST_DATABASE_URL не задан — интеграционные тесты пропущены"
)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def api():
    """Чистая схема + поднятое приложение на каждый тест."""
    if not TEST_DB:
        pytest.skip("нет тестовой БД")

    import asyncpg
    from cryptography.fernet import Fernet

    os.environ.update({
        "DATABASE_URL": TEST_DB,
        "DB_SCHEMA": TEST_SCHEMA,
        "REGISTRY_KEY": Fernet.generate_key().decode(),
        "BOOTSTRAP_TOKEN": "test-bootstrap",
        "REQUIRE_TEACHER_2FA": "false",
        "BCRYPT_ROUNDS": "4",
        "RUN_SCHEDULER": "false",
        "CORS_ORIGINS": "*",
    })

    from app import db
    from app.config import get_settings
    from app.migrate import migrate

    get_settings.cache_clear()

    conn = await asyncpg.connect(TEST_DB)
    await conn.execute(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE')
    await conn.close()

    await migrate()
    await db.connect()

    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://guild.test") as client:
        yield client

    await db.disconnect()
    get_settings.cache_clear()
