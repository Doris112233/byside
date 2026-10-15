"""
投影 ArUco 自动标定 —— 不用再拖四个角。

网页在标定模式下把 4 个 4x4 ArUco 投在棋盘里、离四个角各 inset 格的格点上
（id 0..3 = 左上、右上、右下、左下，和 quad 的顺序一致；不直接压在角上是因为
棋盘外边距不够放下标记）。朝下的摄像头认出 4 个中心，用单应外推回四个角就是 quad。

字典是网页 index.html 里那 4 个图案（PATTERNS，1 = 黑格），不是 OpenCV 预置的 —— 预置字典
几百个 id 互相靠汉明距离区分，4 个够了且这 4 个早就画在网页里。
注意位极性：网页 1 = 黑，OpenCV 的 Dictionary 1 = 白，所以这里取反。

    from byside_sensor.calib.aruco import ProjectedMarkers
    pm = ProjectedMarkers()
    quad = pm.quad(gray)          # 归一化到 [0,1] 的 [[x,y]×4]，找不齐 4 个返回 None
"""
import cv2
import numpy as np

from byside_sensor.protocol import constants as _constants

N = _constants().n            # 棋盘路数
INSET = _constants().inset    # 标记中心离角点的格数，和网页 calib/pattern.ts 一致

# 图案来自 protocol/constants.json，和网页画的一样。1 = 黑格。
PATTERNS = [[list(row) for row in p] for p in _constants().patterns]


def dictionary():
    bl = np.concatenate([cv2.aruco.Dictionary.getByteListFromBits(1 - np.array(p, np.uint8))
                         for p in PATTERNS])
    return cv2.aruco.Dictionary(bl, 4)


def marker_image(i, px=120):
    """给测试和打印用：第 i 个标记的位图（含 1 格黑边）。"""
    return cv2.aruco.generateImageMarker(dictionary(), i, px, borderBits=1)


class ProjectedMarkers:
    def __init__(self):
        p = cv2.aruco.DetectorParameters()
        # 投影出来的标记边缘发虚、而且桌面本身不是纯白，阈值窗口放宽一点
        p.adaptiveThreshWinSizeMin = 5
        p.adaptiveThreshWinSizeMax = 45
        p.adaptiveThreshWinSizeStep = 8
        p.minMarkerPerimeterRate = 0.02
        p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self.det = cv2.aruco.ArucoDetector(dictionary(), p)
        self.last = {}            # id → (x, y) 像素中心，最近一次看到的

    def find(self, gray):
        """返回 {id: (cx, cy)}，像素坐标。"""
        corners, ids, _ = self.det.detectMarkers(gray)
        out = {}
        if ids is not None:
            for c, i in zip(corners, ids.flatten(), strict=True):
                i = int(i)
                if 0 <= i < 4:
                    out[i] = tuple(c[0].mean(axis=0).tolist())
        self.last = out
        return out

    def quad(self, gray, n=N, inset=INSET):
        """四个都在才给答案。归一化到 [0,1]，顺序 左上 右上 右下 左下。

        4 个标记中心的棋盘坐标是已知的（内缩 inset 格），由此解棋盘→图像的单应，
        再把真正的四个角 (0,0)(n-1,0)(n-1,n-1)(0,n-1) 映射过去。"""
        found = self.find(gray)
        if len(found) < 4:
            return None
        m = n - 1
        src = np.float32([[inset, inset], [m - inset, inset], [m - inset, m - inset], [inset, m - inset]])
        dst = np.float32([found[i] for i in range(4)])
        H = cv2.getPerspectiveTransform(src, dst)
        corners = cv2.perspectiveTransform(np.float32([[[0, 0], [m, 0], [m, m], [0, m]]]), H)[0]
        h, w = gray.shape[:2]
        return [[float(x) / w, float(y) / h] for x, y in corners]


if __name__ == "__main__":
    # 自测：按网页的布局画一块棋盘（标记内缩 1.5 格）→ 透视扭一下 → 认回来，比对四个角
    canvas = np.full((720, 1080), 120, np.uint8)
    cell = 34.0
    x0, y0 = 302.0, 122.0                                   # 角点 (0,0) 的像素位置
    corners = [(x0, y0), (x0 + 14 * cell, y0), (x0 + 14 * cell, y0 + 14 * cell), (x0, y0 + 14 * cell)]
    k = int(cell * 2)
    for i, (bi, bj) in enumerate([(INSET, INSET), (14 - INSET, INSET), (14 - INSET, 14 - INSET), (INSET, 14 - INSET)]):
        x, y = int(x0 + bi * cell), int(y0 + bj * cell)
        b = int(cell * 1.25)
        cv2.rectangle(canvas, (x - b, y - b), (x + b, y + b), 235, -1)       # 投影的亮底
        m = marker_image(i, k)
        canvas[y - k // 2:y - k // 2 + k, x - k // 2:x - k // 2 + k] = np.where(m > 0, 235, 120)
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [1080, 0], [1080, 720], [0, 720]]),
                                    np.float32([[60, 40], [1000, 90], [1040, 700], [20, 650]]))
    warped = cv2.warpPerspective(canvas, M, (1080, 720), borderValue=120)
    pm = ProjectedMarkers()
    q = pm.quad(warped)
    exp = cv2.perspectiveTransform(np.float32([corners]), M)[0]
    print("found:", {kk: tuple(round(v, 1) for v in c) for kk, c in pm.last.items()})
    if q is None:
        raise SystemExit("FAIL: 没认齐 4 个")
    err = max(np.hypot(q[i][0] * 1080 - exp[i][0], q[i][1] * 720 - exp[i][1]) for i in range(4))
    print(f"max corner error {err:.2f}px")
    raise SystemExit(0 if err < 2.0 else "FAIL: 误差过大")
