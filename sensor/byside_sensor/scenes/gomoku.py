"""板端五子棋：记对方投过来的子（remote）、这局认什么色（role）、回答对账（req）。"""
from __future__ import annotations

import threading
from collections.abc import Callable

import numpy as np

from byside_sensor.protocol import Message

COLOR_NAME = {1: "black", 2: "white"}


class GomokuScene:
    id = "gomoku"
    messages = ("role", "move", "state", "reset", "req", "hello")

    def __init__(self, n: int, user: str | None, lock: threading.Lock,
                 on_seat: Callable[[str | None], None], publish: Callable[[], None]):
        self.n = n
        self.user = user
        self.lock = lock
        self.remote = np.zeros(n * n, np.int8)
        self.seat: str | None = None
        self._on_seat = on_seat
        self._publish = publish

    def on_room_change(self) -> None:
        # 进了新房间：上一局对方投过来的子清掉，也先别认子，等 role
        with self.lock:
            self.remote = np.zeros(self.n * self.n, np.int8)
        if self.user:
            self.seat = None
            self._on_seat(None)

    def on_message(self, m: Message) -> None:
        t = m.get("t")
        n = self.n
        if t == "role":
            # 主人这一局执什么色。只认自己主人的那条 —— 对方的 role 也会广播进房间
            if self.user and m.get("code") == self.user and m.get("color") in (1, 2):
                self.seat = COLOR_NAME[int(m["color"])]
                self._on_seat(self.seat)
                print(f"[局] 这一局认 {self.seat}", flush=True)
        elif t == "move":
            i, j, c = m.get("i"), m.get("j"), m.get("c", 0)
            if isinstance(i, int) and isinstance(j, int) and 0 <= i < n and 0 <= j < n:
                with self.lock:
                    self.remote[j * n + i] = int(c)
        elif t == "state":
            grid = np.zeros(n * n, np.int8)
            for mv in m.get("moves") or []:
                if len(mv) >= 3 and 0 <= mv[0] < n and 0 <= mv[1] < n:
                    grid[mv[1] * n + mv[0]] = int(mv[2])
            with self.lock:
                self.remote = grid
        elif t == "reset":
            with self.lock:
                self.remote = np.zeros(n * n, np.int8)
        elif t in ("req", "hello"):
            self._publish()

    def snapshot(self) -> dict:
        with self.lock:
            return {"remote": self.remote.copy(), "seat": self.seat}
