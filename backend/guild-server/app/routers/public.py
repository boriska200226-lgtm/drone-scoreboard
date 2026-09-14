"""Общее состояние гильдии — публично внутри класса.

GET /api/guild/state — тот самый REST-fallback, на который переключается
клиент, когда WebSocket оборвался (§7 ТЗ).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import service
from ..auth import Principal, current_user

router = APIRouter(prefix="/api/guild", tags=["guild"])


@router.get("/state")
async def state(user: Principal = Depends(current_user)) -> dict[str, object]:
    return await service.guild_state(user.class_id)


@router.get("/altar")
async def altar(user: Principal = Depends(current_user)) -> dict[str, object]:
    return {"altar": await service.altar(user.class_id)}


@router.get("/tree")
async def tree(user: Principal = Depends(current_user)) -> dict[str, object]:
    return await service.tree_state(user.class_id)


@router.get("/festival/forecast")
async def forecast(user: Principal = Depends(current_user)) -> dict[str, object]:
    """Прогноз Фестиваля: сколько СЗ осталось классу. Без имён."""
    return await service.festival_forecast(user.class_id)


@router.get("/rules")
async def game_rules() -> dict[str, object]:
    from .. import rules as R

    return {
        "soul_actions": [
            {"id": key, "title": title, "delta": delta, "weekly_limit": limit}
            for key, (delta, title, limit) in R.SOUL_ACTIONS.items()
        ],
        "branches": R.BRANCHES,
        "tree_bonuses": [
            {"threshold": t, "id": key, "title": title} for t, key, title in R.TREE_BONUSES
        ],
        "festival_threshold": R.FESTIVAL_THRESHOLD,
        "armor_max": R.ARMOR_MAX,
        "mana_max": R.MANA_MAX,
        "festival_program": service.FESTIVAL_PROGRAM,
    }
