"""Пул подключений к PostgreSQL и подстановка схемы в SQL."""
from __future__ import annotations

from typing import Any, Iterable

import asyncpg

from .config import get_settings

_pool: asyncpg.Pool | None = None


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        s = get_settings()
        _pool = await asyncpg.create_pool(
            s.database_url, min_size=1, max_size=10, command_timeout=10,
            server_settings={"search_path": f"{s.qualified},public"},
        )
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Пул не инициализирован — вызови connect()")
    return _pool


# Все запросы идут через $1, $2 … — конкатенации пользовательского ввода нет.
async def fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    async with pool().acquire() as conn:
        return list(await conn.fetch(sql, *args))


async def fetchrow(sql: str, *args: Any) -> asyncpg.Record | None:
    async with pool().acquire() as conn:
        return await conn.fetchrow(sql, *args)


async def fetchval(sql: str, *args: Any) -> Any:
    async with pool().acquire() as conn:
        return await conn.fetchval(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(sql, *args)


async def executemany(sql: str, rows: Iterable[tuple[Any, ...]]) -> None:
    async with pool().acquire() as conn:
        await conn.executemany(sql, list(rows))
