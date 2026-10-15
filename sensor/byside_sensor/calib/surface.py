"""投影面：棋盘在相机画面里的位置（归一化四角），以及由此得到的格点反投影。

现在它只管一只相机、一个方框。一体机上会变成「相机 → 投影面」的单应 + 「棋盘在投影面上的位置」
两段，这个类就是那时候要扩的地方。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .homography import Backproject, grid_backproject

DEFAULT_QUAD = [[.25, .18], [.75, .18], [.75, .82], [.25, .82]]


@dataclass
class Surface:
    n: int
    quad: list[list[float]] = field(default_factory=lambda: [list(p) for p in DEFAULT_QUAD])

    def set_quad(self, quad: Sequence[Sequence[float]]) -> None:
        if len(quad) != 4:
            raise ValueError("quad 要四个点")
        self.quad = [[float(p[0]), float(p[1])] for p in quad]

    def backproject(self, shape: Sequence[int]) -> Backproject | None:
        """给某个分辨率的图，返回 (i, j) → 像素 的函数。"""
        h, w = shape[:2]
        px = [[q[0] * w, q[1] * h] for q in self.quad]
        return grid_backproject(px, self.n)

    def corners_px(self, shape: Sequence[int]) -> list[tuple[int, int]]:
        h, w = shape[:2]
        return [(int(q[0] * w), int(q[1] * h)) for q in self.quad]
