"""投影 ArUco 自动标定：按网页的画法合成一张桌面，透视扭一下，四个角要认回来。"""
import cv2
import numpy as np

from byside_sensor.calib.aruco import INSET, ProjectedMarkers, marker_image
from byside_sensor.protocol import constants

C = constants()


def render_like_web(cell=34.0, x0=302.0, y0=122.0, bg=120, lit=235):
    """和 web/src/calib/pattern.ts 同样的布局：标记内缩 inset 格，边长 marker_cells 格，亮底 quiet_cells 格。"""
    canvas = np.full((720, 1080), bg, np.uint8)
    m = C.n - 1
    corners = [(x0, y0), (x0 + m * cell, y0), (x0 + m * cell, y0 + m * cell), (x0, y0 + m * cell)]
    k = int(cell * C.marker_cells)
    for i, (bi, bj) in enumerate([(INSET, INSET), (m - INSET, INSET), (m - INSET, m - INSET), (INSET, m - INSET)]):
        x, y = int(x0 + bi * cell), int(y0 + bj * cell)
        b = int(cell * C.quiet_cells)
        cv2.rectangle(canvas, (x - b, y - b), (x + b, y + b), lit, -1)
        img = marker_image(i, k)
        canvas[y - k // 2:y - k // 2 + k, x - k // 2:x - k // 2 + k] = np.where(img > 0, lit, bg)
    return canvas, corners


def test_markers_recover_corners_under_perspective():
    canvas, corners = render_like_web()
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [1080, 0], [1080, 720], [0, 720]]),
                                    np.float32([[60, 40], [1000, 90], [1040, 700], [20, 650]]))
    warped = cv2.warpPerspective(canvas, M, (1080, 720), borderValue=120)
    pm = ProjectedMarkers()
    q = pm.quad(warped)
    assert q is not None, f"只认出 {sorted(pm.last)}"
    exp = cv2.perspectiveTransform(np.float32([corners]), M)[0]
    err = max(np.hypot(q[i][0] * 1080 - exp[i][0], q[i][1] * 720 - exp[i][1]) for i in range(4))
    assert err < 2.0


def test_three_markers_is_not_enough():
    canvas, _ = render_like_web()
    canvas[:, :360] = 120          # 盖掉左边两个标记
    pm = ProjectedMarkers()
    assert pm.quad(canvas) is None
    assert len(pm.last) <= 2


def test_patterns_are_the_shared_ones():
    from byside_sensor.calib.aruco import PATTERNS
    assert PATTERNS == [[list(r) for r in p] for p in C.patterns]
