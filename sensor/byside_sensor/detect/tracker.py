"""把逐帧的分类结果收敛成「已确认的桌面状态」。

两级过滤：
  - 遮挡保护：与已确认状态不符的点数超过 clean_max 时，只有当同一个图样连续稳定 stable*3 帧才放行
    （手会动，棋子不会）
  - 逐点稳定：每个点连续 stable 帧一致才改写确认状态
"""
from __future__ import annotations

import numpy as np

STONE_STABLE = 6   # 连续多少帧一致才确认
CLEAN_MAX = 6      # 与已确认状态不符的点数上限，超了就认为有手

Change = tuple[int, int, int, int]  # (i, j, now, was)


class StoneTracker:
    def __init__(self, n: int, stable: int = STONE_STABLE, clean_max: int = CLEAN_MAX):
        self.n = n
        self.stable = stable
        self.clean_max = clean_max
        self.phys = np.zeros(n * n, np.int8)
        self.cand = np.full(n * n, -1, np.int8)
        self.cand_n = np.zeros(n * n, np.int32)
        self.last_cls: np.ndarray | None = None
        self.bulk_n = 0
        self.occluded = False
        self.diff_n = 0

    def update(self, cls: np.ndarray) -> list[Change]:
        """喂一帧分类结果，返回本帧确认的变化。"""
        n2 = self.n * self.n
        self.diff_n = int(np.count_nonzero(cls != self.phys))

        if self.diff_n > self.clean_max:
            same = self.last_cls is not None and np.array_equal(self.last_cls, cls)
            self.bulk_n = self.bulk_n + 1 if same else 0
            self.last_cls = cls.copy()
            if self.bulk_n < self.stable * 3:
                self.occluded = True
                # 冻结候选，避免手停久了被误确认
                self.cand.fill(-1)
                self.cand_n.fill(0)
                return []
            # 稳定够久 —— 一次摆好几颗子也是这样，认了
        else:
            self.bulk_n = 0
            self.last_cls = cls.copy()

        self.occluded = False
        changes: list[Change] = []
        for k in range(n2):
            if cls[k] == self.cand[k]:
                self.cand_n[k] += 1
            else:
                self.cand[k] = cls[k]
                self.cand_n[k] = 1
            if self.cand_n[k] >= self.stable and self.phys[k] != cls[k]:
                was = int(self.phys[k])
                self.phys[k] = cls[k]
                changes.append((k % self.n, k // self.n, int(cls[k]), was))
        return changes

    @property
    def count(self) -> int:
        return int(np.count_nonzero(self.phys))
