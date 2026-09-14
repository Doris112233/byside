"""
BySide 核心视觉 —— 从 index.html 一比一移植，不做任何"顺手优化"。

保留原版的三个关键思想：
  1. 免基准：内圆中位数 vs 外环中位数，不依赖空盘参考帧
  2. 充满度：挡掉反光高光那种"中位数够但面积不够"的小亮斑
  3. 遮挡保护：变化点数超标时看图样稳不稳 —— 手会动，棋子不会

移植时唯一需要小心的地方是中位数的定义，见 med_js()。
"""
import math
import numpy as np

# ---- 原版默认参数（index.html:692,728,1138）----
N_DEFAULT = 15
STONE_TH = 24      # 黑子阈值：内圆比板面暗多少
STONE_TH_W = 14    # 白子阈值：内圆比板面亮多少
STONE_STABLE = 6   # 连续多少帧一致才确认
CLEAN_MAX = 6      # 与已确认状态不符的点数上限，超了就认为有手
FILL_MIN = 0.55    # 内圆里越界像素的最低占比

BLACK, WHITE, EMPTY = 1, 2, 0


def med_js(a):
    """JS 的 arr[arr.length>>1] 是"上中位数"，偶数长度时取靠后那个。

    np.median 对偶数长度取两个中间值的平均，跟原版不是一回事。
    这里必须照抄 JS 的定义，否则阈值判断会有半个灰阶的系统偏差。
    """
    if len(a) == 0:
        return 0.0
    a = np.asarray(a)
    k = len(a) // 2
    return float(np.partition(a, k)[k])


# ============================================================
# 1) 单应变换（index.html:388）
# ============================================================
def homography(src, dst):
    """由 4 组对应点求单应矩阵，返回 [h0..h7]（h8 固定为 1）。"""
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    try:
        h = np.linalg.solve(np.array(A, float), np.array(b, float))
    except np.linalg.LinAlgError:
        return None
    return h.tolist()


def apply_h(h, x, y):
    w = h[6] * x + h[7] * y + 1.0
    if abs(w) < 1e-12:
        return (float("nan"), float("nan"))
    return ((h[0] * x + h[1] * y + h[2]) / w,
            (h[3] * x + h[4] * y + h[5]) / w)


def grid_backproject(quad, n=N_DEFAULT):
    """棋盘格点 (i,j) → 图像像素。

    quad 是棋盘四角在图像里的位置，顺序：左上、右上、右下、左下
    —— 跟原版 S.cal.pts 的约定一致（index.html:707）。
    """
    h = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad)
    if h is None:
        return None
    inv = 1.0 / (n - 1)
    return lambda i, j: apply_h(h, i * inv, j * inv)


# ============================================================
# 2) 免基准分类（index.html:1198 classifyAbs）
# ============================================================
def _disc_offsets(r):
    R = int(math.ceil(r))
    ys, xs = np.mgrid[-R:R + 1, -R:R + 1]
    m = (xs * xs + ys * ys) <= r * r
    return xs[m].astype(np.int32), ys[m].astype(np.int32)


def _ring_offsets(r1, r2):
    pts = []
    for t in range(24):
        ang = t / 24.0 * math.pi * 2
        for rr in (r1, (r1 + r2) / 2.0, r2):
            pts.append((math.cos(ang) * rr, math.sin(ang) * rr))
    return pts


def cell_size(bp):
    """格距：用 (0,0)->(1,0) 和 (0,0)->(0,1) 两条边长取平均。"""
    a, b, c = bp(0, 0), bp(1, 0), bp(0, 1)
    return (math.hypot(b[0] - a[0], b[1] - a[1]) +
            math.hypot(c[0] - a[0], c[1] - a[1])) / 2.0


def classify_abs_ref(gray, bp, n=N_DEFAULT, seat=None,
                     th=STONE_TH, th_w=STONE_TH_W, fill_min=FILL_MIN):
    """参考实现：跟 index.html 逐行对应，慢但绝对忠实。

    它是 classify_abs() 的 oracle —— 向量化版本必须跟它逐位一致，
    否则就不是"优化"而是"改算法"。返回 (cls, score, cell)。

    seat: 'black' 只认黑子，'white' 只认白子，None 两色都认。
    每端只认自己那一色是原版的设计 —— 除了少一半误报，
    白端不看变暗，手臂阴影就不会被当成棋子（index.html:1276）。
    """
    ph, pw = gray.shape[:2]
    cell = cell_size(bp)
    if not (cell > 4):
        return None, None, cell

    r_in = max(2.0, cell * 0.30)
    r1, r2 = cell * 0.58, cell * 0.92
    dx_in, dy_in = _disc_offsets(r_in)
    ring_pts = _ring_offsets(r1, r2)

    seat_c = {"white": WHITE, "black": BLACK}.get(seat, 0)
    cls = np.zeros(n * n, np.int8)
    score = np.zeros(n * n, np.float32)

    for j in range(n):
        for i in range(n):
            cx, cy = bp(i, j)
            if not (math.isfinite(cx) and math.isfinite(cy)):
                continue

            # --- 内圆：必须用中位数，不能用均值 ---
            # 内圆正套在交叉点上，里面必然含有十字格线（约占面积 1/4），
            # 均值会被压暗 30~40 灰阶，导致每个空点都"比周围暗"而被误判成黑子。
            px = np.rint(cx + dx_in).astype(np.int32)
            py = np.rint(cy + dy_in).astype(np.int32)
            ok = (px >= 0) & (py >= 0) & (px < pw) & (py < ph)
            if ok.sum() < 8:
                continue
            inn = gray[py[ok], px[ok]].astype(np.float32)
            inner = med_js(inn)

            # --- 外环：也用中位数，相邻棋子占掉一部分外环时不会被带偏 ---
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

            # --- 充满度：真棋子是"整片都亮/都暗"，高光小斑不是 ---
            if c:
                lim = board - th if c == BLACK else board + th_w
                hit = (inn < lim).sum() if c == BLACK else (inn > lim).sum()
                fill = hit / len(inn)
                if fill < fill_min:
                    c = EMPTY
                else:
                    score[j * n + i] = abs(d) * fill
            cls[j * n + i] = c

    return cls, score, cell


# ============================================================
# 3) 稳定与遮挡保护（index.html:1256 updateStones）
# ============================================================
class StoneTracker:
    """把逐帧的分类结果收敛成"已确认的桌面状态"。

    两级过滤：
      - 遮挡保护：与已确认状态不符的点数超过 CLEAN_MAX 时，
        只有当同一个图样连续稳定 stable*3 帧才放行（手会动，棋子不会）
      - 逐点稳定：每个点连续 stable 帧一致才改写确认状态
    """

    def __init__(self, n=N_DEFAULT, stable=STONE_STABLE, clean_max=CLEAN_MAX):
        self.n = n
        self.stable = stable
        self.clean_max = clean_max
        self.phys = np.zeros(n * n, np.int8)
        self.cand = np.full(n * n, -1, np.int8)
        self.cand_n = np.zeros(n * n, np.int32)
        self.last_cls = None
        self.bulk_n = 0
        self.occluded = False
        self.diff_n = 0

    def update(self, cls):
        """喂一帧分类结果，返回本帧确认的变化 [(i, j, now, was), ...]。"""
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
        changes = []
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
    def count(self):
        return int(np.count_nonzero(self.phys))


def classify_abs(gray, bp, n=N_DEFAULT, seat=None,
                 th=STONE_TH, th_w=STONE_TH_W, fill_min=FILL_MIN):
    """向量化版本 —— 与 classify_abs_ref 逐位一致，快一个数量级。

    原版每个格点各自调十来次 numpy，225 个点就是两千多次调用，
    全花在 Python 的函数开销上而不是算术上。这里把 225 个点一次算完。

    变长中位数的处理：越界像素填 +inf，整行排序后取第 valid//2 个，
    结果与 med_js(有效像素) 完全相同（+inf 一定排在最后）。
    """
    ph, pw = gray.shape[:2]
    cell = cell_size(bp)
    if not (cell > 4):
        return None, None, cell

    r_in = max(2.0, cell * 0.30)
    r1, r2 = cell * 0.58, cell * 0.92
    dx_in, dy_in = _disc_offsets(r_in)
    ring = np.array(_ring_offsets(r1, r2), np.float64)

    # 所有格点中心 (n*n, 2)
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
        """每行在有效元素上取 JS 的上中位数。"""
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

    seat_c = {"white": WHITE, "black": BLACK}.get(seat, 0)
    is_b = (d < -th) if seat_c != WHITE else np.zeros_like(d, bool)
    is_w = (d > th_w) if seat_c != BLACK else np.zeros_like(d, bool)
    c = np.where(is_b, BLACK, np.where(is_w, WHITE, EMPTY)).astype(np.int8)
    c[~valid] = EMPTY

    # 充满度：内圆里越界像素必须占多数
    lim = np.where(c == BLACK, board - th, board + th_w)[:, None]
    over = np.where(c[:, None] == BLACK, inn_v < lim, inn_v > lim) & inn_ok
    denom = np.maximum(inn_cnt, 1)
    fill = over.sum(1) / denom
    kill = (c != EMPTY) & (fill < fill_min)
    c[kill] = EMPTY

    score = np.where(c != EMPTY, np.abs(d) * fill, 0.0).astype(np.float32)
    return c, score, cell
