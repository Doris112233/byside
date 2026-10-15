"""经典识别 —— 从最早的网页版一比一移植，不做任何「顺手优化」。

三个关键思想：
  1. 免基准：内圆中位数 vs 外环中位数，不依赖空盘参考帧
  2. 充满度：挡掉反光高光那种「中位数够但面积不够」的小亮斑
  3. 每端只认自己那一色：少一半误报，白端不看变暗，手臂阴影就不会被当成棋子

移植时唯一需要小心的地方是中位数的定义，见 med_js()。
classify_abs_ref 是参考实现（慢、逐行对应原版），classify_abs 是向量化版本，tests 保证两者逐位一致。
"""
from __future__ import annotations

import math

import numpy as np

from byside_sensor.calib.homography import Backproject, cell_size
from byside_sensor.protocol import BLACK, EMPTY, WHITE

from .base import GridResult

STONE_TH = 24      # 黑子阈值：内圆比板面暗多少
STONE_TH_W = 14    # 白子阈值：内圆比板面亮多少
FILL_MIN = 0.55    # 内圆里越界像素的最低占比
INNER_R = 0.30     # 内圆半径（格），和 constants.json 的 detect_inner_cells 一致


def med_js(a) -> float:
    """JS 的 arr[arr.length>>1] 是「上中位数」，偶数长度时取靠后那个。
    np.median 对偶数长度取两个中间值的平均，跟原版不是一回事。"""
    if len(a) == 0:
        return 0.0
    a = np.asarray(a)
    k = len(a) // 2
    return float(np.partition(a, k)[k])


def _disc_offsets(r: float):
    R = int(math.ceil(r))
    ys, xs = np.mgrid[-R:R + 1, -R:R + 1]
    m = (xs * xs + ys * ys) <= r * r
    return xs[m].astype(np.int32), ys[m].astype(np.int32)


def _ring_offsets(r1: float, r2: float):
    pts = []
    for t in range(24):
        ang = t / 24.0 * math.pi * 2
        for rr in (r1, (r1 + r2) / 2.0, r2):
            pts.append((math.cos(ang) * rr, math.sin(ang) * rr))
    return pts


def to_gray(frame: np.ndarray) -> np.ndarray:
    if frame.ndim == 2:
        return frame
    import cv2
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def classify_abs_ref(gray, bp: Backproject, n: int, seat: str | None = None,
                     th=STONE_TH, th_w=STONE_TH_W, fill_min=FILL_MIN) -> GridResult:
    """参考实现：跟原版逐行对应，慢但绝对忠实。它是 classify_abs() 的 oracle。"""
    ph, pw = gray.shape[:2]
    cell = cell_size(bp)
    if not (cell > 4):
        return GridResult(None, None, cell)

    r_in = max(2.0, cell * INNER_R)
    r1, r2 = cell * 0.58, cell * 0.92
    dx_in, dy_in = _disc_offsets(r_in)
    ring_pts = _ring_offsets(r1, r2)

    seat_c = {"white": WHITE, "black": BLACK}.get(seat or "", 0)
    cls = np.zeros(n * n, np.int8)
    score = np.zeros(n * n, np.float32)

    for j in range(n):
        for i in range(n):
            cx, cy = bp(i, j)
            if not (math.isfinite(cx) and math.isfinite(cy)):
                continue
            # 内圆正套在交叉点上，里面必然含有十字格线（约占面积 1/4），
            # 均值会被压暗 30~40 灰阶，导致每个空点都「比周围暗」而被误判成黑子 —— 所以用中位数。
            px = np.rint(cx + dx_in).astype(np.int32)
            py = np.rint(cy + dy_in).astype(np.int32)
            ok = (px >= 0) & (py >= 0) & (px < pw) & (py < ph)
            if ok.sum() < 8:
                continue
            inn = gray[py[ok], px[ok]].astype(np.float32)
            inner = med_js(inn)
            rp, rq = [], []
            for ox, oy in ring_pts:
                x, y = int(round(cx + ox)), int(round(cy + oy))
                if 0 <= x < pw and 0 <= y < ph:
                    rp.append(x); rq.append(y)
            if len(rp) < 8:
                continue
            board = med_js(gray[np.array(rq), np.array(rp)].astype(np.float32))
            d = inner - board
            if seat_c == BLACK:
                c = BLACK if d < -th else EMPTY
            elif seat_c == WHITE:
                c = WHITE if d > th_w else EMPTY
            else:
                c = BLACK if d < -th else (WHITE if d > th_w else EMPTY)
            if c:
                lim = board - th if c == BLACK else board + th_w
                hit = (inn < lim).sum() if c == BLACK else (inn > lim).sum()
                fill = hit / len(inn)
                if fill < fill_min:
                    c = EMPTY
                else:
                    score[j * n + i] = abs(d) * fill
            cls[j * n + i] = c
    return GridResult(cls, score, cell)


def classify_abs(gray, bp: Backproject, n: int, seat: str | None = None,
                 th=STONE_TH, th_w=STONE_TH_W, fill_min=FILL_MIN) -> GridResult:
    """向量化版本 —— 与 classify_abs_ref 逐位一致，快一个数量级。
    变长中位数的处理：越界像素填 +inf，整行排序后取第 valid//2 个，结果与 med_js(有效像素) 完全相同。"""
    ph, pw = gray.shape[:2]
    cell = cell_size(bp)
    if not (cell > 4):
        return GridResult(None, None, cell)

    r_in = max(2.0, cell * INNER_R)
    r1, r2 = cell * 0.58, cell * 0.92
    dx_in, dy_in = _disc_offsets(r_in)
    ring = np.array(_ring_offsets(r1, r2), np.float64)

    ij = [(i, j) for j in range(n) for i in range(n)]
    ctr = np.array([bp(i, j) for i, j in ij], np.float64)
    finite = np.isfinite(ctr).all(1)
    ctr = np.where(finite[:, None], ctr, 0.0)
    cx, cy = ctr[:, 0:1], ctr[:, 1:2]
    g = gray.astype(np.float32)

    def gather(ox, oy):
        px = np.rint(cx + ox[None, :]).astype(np.int64)
        py = np.rint(cy + oy[None, :]).astype(np.int64)
        ok = (px >= 0) & (py >= 0) & (px < pw) & (py < ph) & finite[:, None]
        vals = g[np.clip(py, 0, ph - 1), np.clip(px, 0, pw - 1)]
        return vals, ok

    def med_rows(vals, ok):
        cnt = ok.sum(1)
        v = np.where(ok, vals, np.inf)
        v.sort(axis=1)
        idx = np.clip(cnt // 2, 0, v.shape[1] - 1)
        return v[np.arange(v.shape[0]), idx], cnt

    inn_v, inn_ok = gather(dx_in.astype(np.float64), dy_in.astype(np.float64))
    inner, inn_cnt = med_rows(inn_v, inn_ok)
    ring_v, ring_ok = gather(ring[:, 0], ring[:, 1])
    board, ring_cnt = med_rows(ring_v, ring_ok)

    valid = (inn_cnt >= 8) & (ring_cnt >= 8) & finite
    d = inner - board
    seat_c = {"white": WHITE, "black": BLACK}.get(seat or "", 0)
    is_b = (d < -th) if seat_c != WHITE else np.zeros_like(d, bool)
    is_w = (d > th_w) if seat_c != BLACK else np.zeros_like(d, bool)
    c = np.where(is_b, BLACK, np.where(is_w, WHITE, EMPTY)).astype(np.int8)
    c[~valid] = EMPTY

    lim = np.where(c == BLACK, board - th, board + th_w)[:, None]
    over = np.where(c[:, None] == BLACK, inn_v < lim, inn_v > lim) & inn_ok
    denom = np.maximum(inn_cnt, 1)
    fill = over.sum(1) / denom
    kill = (c != EMPTY) & (fill < fill_min)
    c[kill] = EMPTY
    score = np.where(c != EMPTY, np.abs(d) * fill, 0.0).astype(np.float32)
    return GridResult(c, score, cell)


class ClassicDetector:
    """Detector 接口的经典实现：转灰度后跑 classify_abs。"""
    name = "classic"

    def __init__(self, th: float = STONE_TH, th_w: float = STONE_TH_W, fill_min: float = FILL_MIN):
        self.th, self.th_w, self.fill_min = th, th_w, fill_min

    def classify(self, frame: np.ndarray, bp: Backproject, n: int, seat: str | None) -> GridResult:
        return classify_abs(to_gray(frame), bp, n, seat, self.th, self.th_w, self.fill_min)
