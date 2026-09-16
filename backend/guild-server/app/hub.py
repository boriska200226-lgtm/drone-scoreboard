"""Комнаты WebSocket: одна на класс, широковещание событий реального времени."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("guild.hub")

# События протокола (§7 ТЗ)
EVT_SOULS = "souls_updated"
EVT_ARMOR = "armor_changed"
EVT_DEBUFF = "debuff_applied"
EVT_FESTIVAL = "festival_ready"
EVT_STATE = "state"
EVT_PONG = "pong"


@dataclass
class Room:
    class_id: int
    clients: set[WebSocket] = field(default_factory=set)


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[int, Room] = {}
        self._lock = asyncio.Lock()

    async def join(self, class_id: int, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.setdefault(class_id, Room(class_id))
            room.clients.add(ws)
        log.info("ws join class=%s clients=%s", class_id, self.size(class_id))

    async def leave(self, class_id: int, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(class_id)
            if room:
                room.clients.discard(ws)
                if not room.clients:
                    self._rooms.pop(class_id, None)
        log.info("ws leave class=%s clients=%s", class_id, self.size(class_id))

    def size(self, class_id: int) -> int:
        room = self._rooms.get(class_id)
        return len(room.clients) if room else 0

    async def broadcast(self, class_id: int, event: str, payload: dict[str, Any]) -> int:
        """Рассылает событие всем в комнате. Возвращает число доставок.

        Свисток должен дойти за секунду, поэтому отправка идёт параллельно,
        а отвалившиеся сокеты просто выбрасываются из комнаты.
        """
        room = self._rooms.get(class_id)
        if not room:
            return 0
        message = json.dumps({"event": event, "payload": payload}, ensure_ascii=False)
        targets = list(room.clients)
        results = await asyncio.gather(
            *(self._send(ws, message) for ws in targets), return_exceptions=True
        )
        dead = [ws for ws, ok in zip(targets, results) if ok is not True]
        if dead:
            async with self._lock:
                for ws in dead:
                    room.clients.discard(ws)
        return len(targets) - len(dead)

    @staticmethod
    async def _send(ws: WebSocket, message: str) -> bool:
        with contextlib.suppress(Exception):
            await ws.send_text(message)
            return True
        return False


hub = Hub()
