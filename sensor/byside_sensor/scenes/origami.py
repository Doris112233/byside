"""板端折纸：记当前第几步、对方指过来的光点。"""
from __future__ import annotations

import threading
import time

from byside_sensor.protocol import Message

# 和网页 scenes/origami 的 STEPS 文案一一对应；投影只显示文字，图在网页上
STEPS = [
    "把纸横过来，对折一次，折痕在上面",
    "两个上角向中间折下来，变成一个三角",
    "下面两条边，一前一后往上折",
    "从底下撑开，压平成一个方块",
    "捏住两个角往外一拉，小船就出来了",
]


class OrigamiScene:
    id = "origami"
    messages = ("step", "point")

    def __init__(self, lock: threading.Lock):
        self.lock = lock
        self.step = 0
        self.points: list[tuple[float, float, float]] = []   # (x, y, t)

    def on_room_change(self) -> None:
        with self.lock:
            self.step = 0
            self.points = []

    def on_message(self, m: Message) -> None:
        t = m.get("t")
        if t == "step":
            n = m.get("n")
            if isinstance(n, int):
                with self.lock:
                    self.step = max(0, min(len(STEPS) - 1, n))
        elif t == "point":
            x, y = m.get("x"), m.get("y")
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                with self.lock:
                    self.points.append((float(x), float(y), time.time()))
                    del self.points[:-12]

    def snapshot(self) -> dict:
        with self.lock:
            return {"step": self.step, "caption": STEPS[self.step], "points": list(self.points)}
