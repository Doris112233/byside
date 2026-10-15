"""三端共用的常量，从仓库根的 protocol/constants.json 读。改那个文件就是改三边。

消息格式见 protocol/PROTOCOL.md。板子只收发其中一小部分：
    发  move / state / calib
    收  role / move / state / reset / req / game / step / point / _joined
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, TypedDict

BLACK, WHITE, EMPTY = 1, 2, 0


def _find_constants() -> str:
    env = os.environ.get("BYSIDE_CONSTANTS")
    if env:
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    for up in (2, 3):
        p = os.path.join(here, *([".."] * up), "protocol", "constants.json")
        if os.path.exists(p):
            return os.path.normpath(p)
    raise FileNotFoundError("找不到 protocol/constants.json；用 BYSIDE_CONSTANTS 指定路径")


@dataclass(frozen=True)
class Constants:
    n: int
    star_points: tuple[tuple[int, int], ...]
    inset: float
    marker_cells: float
    quiet_cells: float
    ring_inner_cells: float
    detect_inner_cells: float
    patterns: tuple[tuple[tuple[int, ...], ...], ...]
    fast: frozenset[str]
    code_alphabet: str
    code_length: int
    relay_http: int
    sensor_control: int
    raw: dict[str, Any]


@lru_cache(maxsize=1)
def constants() -> Constants:
    with open(_find_constants(), encoding="utf-8") as f:
        raw = json.load(f)
    b, c = raw["board"], raw["calib"]
    return Constants(
        n=int(b["n"]),
        star_points=tuple((int(x), int(y)) for x, y in b["star_points"]),
        inset=float(c["inset"]),
        marker_cells=float(c["marker_cells"]),
        quiet_cells=float(c["quiet_cells"]),
        ring_inner_cells=float(c["ring_inner_cells"]),
        detect_inner_cells=float(c["detect_inner_cells"]),
        patterns=tuple(tuple(tuple(int(v) for v in row) for row in p) for p in c["patterns"]),
        fast=frozenset(raw["fast"]),
        code_alphabet=str(raw["friend_code"]["alphabet"]),
        code_length=int(raw["friend_code"]["length"]),
        relay_http=int(raw["ports"]["relay_http"]),
        sensor_control=int(raw["ports"]["sensor_control"]),
        raw=raw,
    )


class MoveMsg(TypedDict):
    t: str
    i: int
    j: int
    c: int


class StateMsg(TypedDict):
    t: str
    moves: list[list[int]]
    N: int


Message = dict[str, Any]
