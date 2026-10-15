"""检测器接口。classic（中位数算法）和 onnx（YOLO）都长这样，pipeline 不关心是哪个。"""
from __future__ import annotations

from typing import NamedTuple, Protocol

import numpy as np

from byside_sensor.calib.homography import Backproject


class GridResult(NamedTuple):
    cls: np.ndarray | None      # n*n 的 int8：0 空 1 黑 2 白；None = 这帧没法判
    score: np.ndarray | None    # n*n 的置信度
    cell: float                 # 格距（像素）


class Detector(Protocol):
    name: str

    def classify(self, frame: np.ndarray, bp: Backproject, n: int, seat: str | None) -> GridResult:
        """frame 是 BGR 彩色图（classic 自己转灰度）。seat 为 'black' / 'white' 时只认那一色。"""
        ...
