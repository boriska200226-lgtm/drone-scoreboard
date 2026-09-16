"""Кабинет ученика: своя Карта героя, Тихая почта, голосование."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, service
from ..auth import Principal, current_student
from ..schemas import AvatarIn, QuietMailIn, VoteIn

router = APIRouter(prefix="/api/hero", tags=["hero"])


@router.get("/me")
async def my_card(user: Principal = Depends(current_student)) -> dict[str, object]:
    assert user.hero_id is not None
    return await service.hero_card(user.hero_id)


@router.post("/quiet-mail")
async def send_quiet_mail(
    body: QuietMailIn, user: Principal = Depends(current_student)
) -> dict[str, object]:
    assert user.hero_id is not None
    return await service.quiet_mail(user.class_id, user.hero_id, body.sticker)


@router.post("/avatar")
async def set_avatar(
    body: AvatarIn, user: Principal = Depends(current_student)
) -> dict[str, object]:
    """Аватар менять можно. Кличку, логин и пароль — нет (§2 ТЗ)."""
    await db.execute("UPDATE heroes SET avatar = $2 WHERE id = $1", user.hero_id, body.avatar)
    return {"ok": True, "avatar": body.avatar}


@router.post("/vote")
async def vote(body: VoteIn, user: Principal = Depends(current_student)) -> dict[str, object]:
    await db.execute(
        "INSERT INTO votes (class_id, topic, hero_id, option) VALUES ($1, $2, $3, $4)"
        " ON CONFLICT (class_id, topic, hero_id) DO UPDATE SET option = EXCLUDED.option",
        user.class_id, body.topic, user.hero_id, body.option,
    )
    rows = await db.fetch(
        "SELECT option, COUNT(*) AS n FROM votes WHERE class_id = $1 AND topic = $2"
        " GROUP BY option ORDER BY n DESC",
        user.class_id, body.topic,
    )
    return {"ok": True, "results": [{"option": r["option"], "votes": int(r["n"])} for r in rows]}


@router.get("/vote/{topic}")
async def vote_results(topic: str, user: Principal = Depends(current_student)) -> dict[str, object]:
    if topic not in {"nickname_style", "tea_menu"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет такого голосования")
    rows = await db.fetch(
        "SELECT option, COUNT(*) AS n FROM votes WHERE class_id = $1 AND topic = $2"
        " GROUP BY option ORDER BY n DESC",
        user.class_id, topic,
    )
    mine = await db.fetchval(
        "SELECT option FROM votes WHERE class_id = $1 AND topic = $2 AND hero_id = $3",
        user.class_id, topic, user.hero_id,
    )
    return {
        "topic": topic, "my_option": mine,
        "results": [{"option": r["option"], "votes": int(r["n"])} for r in rows],
    }
