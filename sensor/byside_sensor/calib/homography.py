"""单应变换：棋盘格点 ↔ 相机像素。

「所见即所测」：棋盘画在投影画面上的哪个位置是我们定的，标定只需要知道
投出来的那个方框在相机画面里对应哪四个点。一套单应就够，不需要第二套投影仪内参。
"""
from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np

Point = tuple[float, float]
Backproject = Callable[[float, float], Point]


def homography(src: Sequence[Sequence[float]], dst: Sequence[Sequence[float]]) -> list[float] | None:
    """由 4 组对应点求单应矩阵，返回 [h0..h7]（h8 固定为 1）。退化时返回 None。"""
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.append(v)
    try:
        h = np.linalg.solve(np.array(A, float), np.array(b, float))
    except np.linalg.LinAlgError:
        return None
    return h.tolist()


def apply_h(h: Sequence[float], x: float, y: float) -> Point:
    w = h[6] * x + h[7] * y + 1.0
    if abs(w) < 1e-12:
        return (float("nan"), float("nan"))
    return ((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w)


def grid_backproject(quad: Sequence[Sequence[float]], n: int) -> Backproject | None:
    """棋盘格点 (i, j) → 图像像素。quad 是棋盘四角在图像里的位置：左上、右上、右下、左下。"""
    h = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad)
    if h is None:
        return None
    inv = 1.0 / (n - 1)
    return lambda i, j: apply_h(h, i * inv, j * inv)


def cell_size(bp: Backproject) -> float:
    """格距：用 (0,0)->(1,0) 和 (0,0)->(0,1) 两条边长取平均。"""
    a, b, c = bp(0, 0), bp(1, 0), bp(0, 1)
    return (math.hypot(b[0] - a[0], b[1] - a[1]) + math.hypot(c[0] - a[0], c[1] - a[1])) / 2.0
