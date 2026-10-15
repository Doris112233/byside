"""板端的场景：收网页来的消息、维护桌面要投的东西。加新场景在这个目录里实现这个接口。"""
from __future__ import annotations

from typing import Protocol

from byside_sensor.protocol import Message


class BoardScene(Protocol):
    id: str
    messages: tuple[str, ...]

    def on_message(self, m: Message) -> None: ...
    def on_room_change(self) -> None: ...
    def snapshot(self) -> dict: ...
