"""WebSocket реального времени: wss://<домен>/ws?token=…"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from .. import service
from ..auth import principal_from_token
from ..hub import EVT_PONG, EVT_STATE, hub

log = logging.getLogger("guild.ws")
router = APIRouter()

CLOSE_UNAUTHORIZED = 4401
# Клиент переподключается через 3 с, поэтому сервер может позволить себе
# закрывать «тихие» сокеты: молчание дольше двух пингов = мёртвое соединение.
IDLE_TIMEOUT = 70.0


@router.websocket("/ws")
async def guild_ws(websocket: WebSocket, token: str = Query(default="")) -> None:
    principal = await principal_from_token(token)
    if principal is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="Не авторизован")
        return

    await websocket.accept()
    class_id = principal.class_id
    await hub.join(class_id, websocket)
    try:
        snapshot = await service.guild_state(class_id)
        await websocket.send_text(json.dumps(
            {"event": EVT_STATE, "payload": snapshot}, ensure_ascii=False
        ))
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=IDLE_TIMEOUT)
            except asyncio.TimeoutError:
                break
            message = _parse(raw)
            kind = message.get("event")
            if kind == "ping":
                await websocket.send_text(json.dumps({"event": EVT_PONG, "payload": {}}))
            elif kind == "state":
                fresh = await service.guild_state(class_id)
                await websocket.send_text(json.dumps(
                    {"event": EVT_STATE, "payload": fresh}, ensure_ascii=False
                ))
            # Никаких игровых команд по сокету: всё, что меняет данные,
            # идёт обычным REST-запросом с проверкой роли.
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — один сбойный клиент не роняет комнату
        log.exception("ws error class=%s", class_id)
    finally:
        await hub.leave(class_id, websocket)
        with contextlib.suppress(Exception):
            await websocket.close()


def _parse(raw: str) -> dict[str, object]:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}
