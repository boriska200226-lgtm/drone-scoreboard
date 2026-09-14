"""Накат миграций: по одному .sql-файлу из migrations/, в алфавитном порядке."""
from __future__ import annotations

import asyncio
import pathlib

import asyncpg

from .config import get_settings

MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "migrations"


async def migrate() -> list[str]:
    s = get_settings()
    schema = s.qualified
    conn = await asyncpg.connect(s.database_url)
    applied: list[str] = []
    try:
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        await conn.execute(f'SET search_path TO "{schema}", public')
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
        )
        done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute(
                    "INSERT INTO schema_migrations (name) VALUES ($1)", path.name
                )
            applied.append(path.name)
    finally:
        await conn.close()
    return applied


def main() -> None:
    applied = asyncio.run(migrate())
    if applied:
        print("Применены миграции: " + ", ".join(applied))
    else:
        print("Новых миграций нет")


if __name__ == "__main__":
    main()
