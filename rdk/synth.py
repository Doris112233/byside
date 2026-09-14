"""
合成桌面棋盘图 + ground truth。

摄像头还没到位，但算法移植对不对现在就该能验证。
合成图刻意放进了三个真实场景里最难的东西：
  - 格线穿过取样内圆（这正是内圆必须用中位数的原因）
  - 板面上的高光小斑（这正是充满度判据要挡掉的东西）
  - 不均匀的光照梯度（这正是免基准判据的价值所在）
如果这三样都过得去，移植就是忠实的。
"""
import math
import numpy as np

BLACK, WHITE, EMPTY = 1, 2, 0


def make_board(n=15, size=(960, 720), quad=None, stones=None,
               board_gray=172, line_gray=96, light_gradient=0.22,
               highlights=6, noise=3.0, seed=None):
    """画一张俯拍棋盘图，返回 (gray_image, truth, quad)。

    quad: 棋盘四角在图像里的位置（左上、右上、右下、左下），None 则自动摆一个带轻微透视的
    stones: n*n 的 int8，None 则随机布子
    """
    rng = np.random.default_rng(seed)
    w, h = size

    if quad is None:
        # 轻微透视：上边比下边略窄，模拟相机没有完全垂直
        cx, cy, r = w * 0.5, h * 0.52, min(w, h) * 0.40
        quad = [[cx - r * 0.92, cy - r], [cx + r * 0.92, cy - r],
                [cx + r, cy + r], [cx - r, cy + r]]

    if stones is None:
        stones = np.zeros(n * n, np.int8)
        for k in rng.choice(n * n, size=rng.integers(4, 40), replace=False):
            stones[k] = rng.choice([BLACK, WHITE])
    stones = np.asarray(stones, np.int8)

    img = np.full((h, w), float(board_gray))

    # 光照梯度：一侧比另一侧亮，免基准判据应该完全不受影响
    gx = np.linspace(-1, 1, w)[None, :]
    gy = np.linspace(-1, 1, h)[:, None]
    img *= 1.0 + light_gradient * (0.7 * gx + 0.3 * gy)

    from byside_cv import grid_backproject
    bp = grid_backproject(quad, n)
    pts = np.array([[bp(i, j) for i in range(n)] for j in range(n)])
    a, b = pts[0, 0], pts[0, 1]
    cell = math.hypot(b[0] - a[0], b[1] - a[1])

    yy, xx = np.mgrid[0:h, 0:w]

    def disc(cx, cy, r):
        return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r

    # --- 格线 ---
    lw = max(1.0, cell * 0.045)
    for j in range(n):
        for i in range(n - 1):
            _draw_line(img, pts[j, i], pts[j, i + 1], line_gray, lw)
    for i in range(n):
        for j in range(n - 1):
            _draw_line(img, pts[j, i], pts[j + 1, i], line_gray, lw)

    # --- 板面高光小斑：面积小但很亮，专门用来考充满度判据 ---
    for _ in range(highlights):
        hx = rng.uniform(w * 0.15, w * 0.85)
        hy = rng.uniform(h * 0.15, h * 0.85)
        hr = cell * rng.uniform(0.10, 0.22)
        m = disc(hx, hy, hr)
        img[m] = np.minimum(255, img[m] + rng.uniform(55, 85))

    # --- 棋子 ---
    sr = cell * 0.45
    for j in range(n):
        for i in range(n):
            c = stones[j * n + i]
            if not c:
                continue
            cx, cy = pts[j, i]
            m = disc(cx, cy, sr)
            base = 38.0 if c == BLACK else 228.0
            # 球面明暗：边缘略暗，中心略亮
            d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (sr * sr + 1e-9)
            shade = np.clip(1.0 - 0.35 * d2, 0.5, 1.0)
            img[m] = base * shade[m] + (12.0 if c == BLACK else -8.0)
            # 棋子上的镜面反光（黑子上尤其明显）
            hm = disc(cx - sr * 0.32, cy - sr * 0.32, sr * 0.20)
            img[hm] = np.minimum(255, img[hm] + (150 if c == BLACK else 22))

    img += rng.normal(0, noise, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8), stones, quad


def _draw_line(img, p0, p1, gray, width):
    h, w = img.shape
    x0, y0 = p0; x1, y1 = p1
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 2
    r = width / 2.0
    for t in np.linspace(0, 1, steps):
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        xa, xb = int(cx - r - 1), int(cx + r + 2)
        ya, yb = int(cy - r - 1), int(cy + r + 2)
        for y in range(max(0, ya), min(h, yb)):
            for x in range(max(0, xa), min(w, xb)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    img[y, x] = gray


def add_hand(img, quad, seed=None, coverage=0.30):
    """在棋盘上盖一只"手"（粗暴的椭圆 + 手指），用来测遮挡保护。"""
    rng = np.random.default_rng(seed)
    h, w = img.shape
    q = np.array(quad)
    cx, cy = q[:, 0].mean(), q[:, 1].mean()
    span = (q[:, 0].max() - q[:, 0].min())
    out = img.copy()
    yy, xx = np.mgrid[0:h, 0:w]
    hx = cx + rng.uniform(-0.2, 0.2) * span
    hy = cy + rng.uniform(-0.2, 0.2) * span
    rx, ry = span * coverage, span * coverage * 0.62
    m = ((xx - hx) / rx) ** 2 + ((yy - hy) / ry) ** 2 <= 1.0
    out[m] = 118 + rng.normal(0, 4, m.sum())
    return np.clip(out, 0, 255).astype(np.uint8)
