"""识别流水线：采集 → （标定）→ 检测 → 跟踪 → 发坐标。

每一段都能换：Source 换成文件夹回放、Detector 换成 onnx、NetLink 换成 None（单机）。
共享状态（quad、mode、seat、最新帧、统计）全部在 self.lock 下改，采集线程、HTTP 线程、
网络线程都可能碰它们。
"""
from __future__ import annotations

import threading
import time

import cv2
import numpy as np

from byside_sensor.calib.surface import Surface
from byside_sensor.capture.source import FrameSource
from byside_sensor.config import Calibration, SensorConfig
from byside_sensor.detect import Detector, StoneTracker
from byside_sensor.net.link import NetLink
from byside_sensor.protocol import Message, constants
from byside_sensor.scenes import SCENE_IDS, GomokuScene, OrigamiScene

try:
    from byside_sensor.calib.aruco import ProjectedMarkers  # 要 cv2.aruco（opencv ≥ 4.7 自带）
except Exception as _e:                                         # 没有就只剩手动拖四个角
    ProjectedMarkers = None
    print(f"[标定] 自动标定不可用：{_e}", flush=True)

CALIB_OK_HITS = 5   # 连续认齐 4 个标记几帧算稳


class Pipeline:
    def __init__(self, cfg: SensorConfig, calib: Calibration, detector: Detector, link: NetLink | None = None):
        self.cfg = cfg
        self.calib = calib
        self.detector = detector
        self.link = link
        self.n = constants().n
        self.lock = threading.Lock()

        self.surface = Surface(self.n, calib.quad)
        self.tracker = StoneTracker(self.n)
        self.markers = ProjectedMarkers() if (cfg.auto_calib and ProjectedMarkers) else None

        self.mode = "play"                 # calib | play
        self.scene = calib.scene if calib.scene in SCENE_IDS else "gomoku"
        self.seat: str | None = None if cfg.user else cfg.seat
        self.user = cfg.user or None
        self.room = link.room if link else cfg.room

        self.gomoku = GomokuScene(self.n, self.user, self.lock, self._set_seat, self.publish_state)
        self.origami = OrigamiScene(self.lock)
        self.scenes = [self.gomoku, self.origami]

        self.src: FrameSource | None = None
        self.cam_status = "未连接"
        self.frame: np.ndarray | None = None
        self.cls = np.zeros(self.n * self.n, np.int8)
        self.fps = 0.0
        self.ms = 0.0
        self.cell = 0.0
        self.calib_found = 0
        self.calib_hits = 0
        self.running = True
        self._pv_cache: tuple[float, bytes | None] = (0.0, None)

        if link:
            link.on_msg = self.on_message

    # ---------- 来自网页 / 中继 ----------
    def on_message(self, m: Message) -> None:
        t = m.get("t")
        if t == "_room":
            with self.lock:
                self.room = str(m.get("room"))
            for s in self.scenes:
                s.on_room_change()
            return
        if t == "game":
            g = m.get("g")
            with self.lock:
                self.scene = g if g in SCENE_IDS else "gomoku"
                self.mode = "play"
            return
        for s in self.scenes:
            if t in s.messages:
                s.on_message(m)

    def _set_seat(self, seat: str | None) -> None:
        with self.lock:
            self.seat = seat
            self.tracker = StoneTracker(self.n)

    def publish_state(self) -> None:
        """把本端识别到的完整局面发出去 —— 对端拿它对账。"""
        if not self.link:
            return
        with self.lock:
            phys = self.tracker.phys.copy()
        moves = [[k % self.n, k // self.n, int(v)] for k, v in enumerate(phys) if v]
        self.link.send({"t": "state", "moves": moves, "N": self.n})

    # ---------- 来自控制页 ----------
    def apply_config(self, c: dict) -> None:
        with self.lock:
            if isinstance(c.get("quad"), list) and len(c["quad"]) == 4:
                self.surface.set_quad(c["quad"])
                self.calib.quad = self.surface.quad
            mode = c.get("mode")
            if mode in ("calib", "play"):
                if mode == "play" and self.mode == "calib" and self.calib_hits >= CALIB_OK_HITS:
                    self.calib.save()                  # 自动标定认齐了，开始游戏时顺手存下来
                    print("[标定] 自动标定结果已保存", flush=True)
                self.mode = mode
                if mode == "calib":
                    self.calib_hits = 0
                notify_calib = True
            else:
                notify_calib = False
            if c.get("scene") in SCENE_IDS:
                self.scene = self.calib.scene = c["scene"]
            if "margin" in c:
                self.calib.margin = max(0.02, min(0.42, float(c["margin"])))
            if isinstance(c.get("offset"), list) and len(c["offset"]) == 2:
                self.calib.offset = [max(-.45, min(.45, float(c["offset"][0]))), max(-.45, min(.45, float(c["offset"][1])))]
            if c.get("save"):
                self.calib.save()
        # 无头模式下投影是浏览器画的：把「显示标定图 / 开始游戏」转过去
        if notify_calib and self.link:
            self.link.send({"t": "calib", "on": self.mode == "calib", "code": self.user or ""})

    # ---------- 采集线程 ----------
    def open_source(self) -> None:
        """连相机，失败就退避重试。不会拖垮主进程。"""
        delay = 2
        while self.running and self.src is None:
            src = None
            try:
                self.cam_status = "连接中…"
                src = FrameSource.open(self.cfg.source, color=True)
                probe = src.read()
                if probe is None:
                    raise RuntimeError("连上了但拿不到帧")
                self.src = src
                if self.cfg.lock_exposure and hasattr(src, "lock_exposure"):
                    for line in src.lock_exposure():
                        print("  曝光:", line, flush=True)
                self.cam_status = f"已连接 {probe.shape[1]}x{probe.shape[0]}"
                print(f"[相机] {self.cam_status}  ({self.cfg.source})", flush=True)
            except Exception as e:
                self.cam_status = f"失败: {type(e).__name__} {e}"
                print(f"[相机] {self.cam_status}，{delay}s 后重试", flush=True)
                if src is not None:
                    try:
                        src.close()
                    except Exception:
                        pass
                time.sleep(delay)
                delay = min(delay * 2, 8)

    def run(self) -> None:
        """阻塞式主循环（采集线程）。"""
        self.open_source()
        last = time.perf_counter()
        ema = 0.0
        fail = 0
        while self.running:
            if self.src is None:
                time.sleep(0.3)
                continue
            f = self.src.read()
            if f is None:
                fail += 1
                if fail > 30:                 # 断流了，整个重连
                    print("[相机] 连续取不到帧，重连", flush=True)
                    try:
                        self.src.close()
                    except Exception:
                        pass
                    self.src = None
                    fail = 0
                    self.open_source()
                time.sleep(0.05)
                continue
            fail = 0
            now = time.perf_counter()
            dt = now - last
            last = now
            ema = dt if ema == 0 else ema * 0.85 + dt * 0.15
            for mv in self.step(f):
                print(f"[落子] ({mv[0]},{mv[1]}) {mv[3]}→{mv[2]}", flush=True)
                if self.link:
                    self.link.send({"t": "move", "i": mv[0], "j": mv[1], "c": mv[2]})
            with self.lock:
                self.fps = 1.0 / ema if ema > 0 else 0

    def step(self, f: np.ndarray) -> list[tuple[int, int, int, int]]:
        """处理一帧：返回这帧确认的落子变化。可以用合成帧单测。"""
        # 识别不需要 1080p：格距 59px 降到 29px 仍远高于算法下限（实测 8.5px 都行），但耗时能砍一半
        small = f
        pw = self.cfg.proc_width
        if pw and f.shape[1] > pw:
            k = pw / f.shape[1]
            small = cv2.resize(f, (pw, int(f.shape[0] * k)), interpolation=cv2.INTER_AREA)

        with self.lock:
            mode, seat, user = self.mode, self.seat, self.user

        # 标定模式：找网页投出来的 4 个 ArUco。认齐了直接写 quad，标定页上四个角会跟着跳过去。
        if mode == "calib" and self.markers is not None:
            gray = small if small.ndim == 2 else cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            q = self.markers.quad(gray)
            found = len(self.markers.last)
            with self.lock:
                self.calib_found = found
                if q:
                    self.surface.set_quad(q)
                    self.calib.quad = self.surface.quad
                    self.calib_hits += 1
                    if self.calib_hits == CALIB_OK_HITS:
                        print(f"[标定] 认齐 4 个标记，quad = {[[round(x, 3) for x in p] for p in q]}", flush=True)
                else:
                    self.calib_hits = 0

        bp = self.surface.backproject(small.shape)
        changes: list[tuple[int, int, int, int]] = []
        t0 = time.perf_counter()
        res = None
        if bp and (seat or not user):
            res = self.detector.classify(small, bp, self.n, seat)
        dt_ms = (time.perf_counter() - t0) * 1000

        with self.lock:
            self.frame = f
            self.ms = dt_ms
            if res is not None:
                self.cell = res.cell
                if res.cls is not None:
                    self.cls = res.cls
                    if mode == "play":
                        changes = self.tracker.update(res.cls)
        return changes

    def stop(self) -> None:
        self.running = False
        if self.src:
            self.src.close()
        if self.link:
            self.link.stop()

    # ---------- 给控制页用的 ----------
    def preview_jpeg(self) -> bytes | None:
        now = time.time()
        if now - self._pv_cache[0] < 0.25 and self._pv_cache[1]:
            return self._pv_cache[1]
        with self.lock:
            f = None if self.frame is None else self.frame.copy()
            cls = self.cls.copy()
        if f is None:
            return None
        img = cv2.resize(f, (640, int(640 * f.shape[0] / f.shape[1])))
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        bp = self.surface.backproject(img.shape)
        if bp:
            n = self.n
            pts = np.array([[bp(i, j) for i in (0, n - 1)] for j in (0, n - 1)], np.int32)
            quad = np.array([pts[0, 0], pts[0, 1], pts[1, 1], pts[1, 0]], np.int32)
            cv2.polylines(img, [quad], True, (62, 168, 235), 2)
            for j in range(n):
                for i in range(n):
                    c = cls[j * n + i]
                    x, y = bp(i, j)
                    if c:
                        col = (245, 245, 240) if c == 2 else (40, 40, 45)
                        cv2.circle(img, (int(x), int(y)), 7, col, -1)
                        cv2.circle(img, (int(x), int(y)), 7, (62, 168, 235), 1)
                    else:
                        cv2.circle(img, (int(x), int(y)), 1, (110, 110, 120), -1)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        out = buf.tobytes() if ok else None
        self._pv_cache = (now, out)
        return out

    def stream_jpeg(self) -> bytes | None:
        """推给对端看的桌面画面。压到 480 宽，别跟识别抢资源。"""
        with self.lock:
            f = self.frame
        if f is None:
            return None
        small = cv2.resize(f, (480, int(480 * f.shape[0] / f.shape[1])))
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 60])
        return buf.tobytes() if ok else None

    def state_dict(self) -> dict:
        temp = read_temp()
        with self.lock:
            return {
                "mode": self.mode, "scene": self.scene, "seat": self.seat,
                "quad": self.surface.quad, "fps": self.fps, "ms": self.ms,
                "auto": self.markers is not None, "calib_found": self.calib_found,
                "calib_ok": self.calib_hits >= CALIB_OK_HITS,
                "cell": self.cell, "stones": self.tracker.count,
                "occluded": bool(self.tracker.occluded),
                "temp": temp,
                "margin": self.calib.margin, "offset": self.calib.offset,
                "cam": self.cam_status,
                "room": self.room,
                "net": self.link.status if self.link else "未启用",
                "peers": self.link.peers if self.link else 0,
                "source": self.cfg.source.split("@")[-1],
                "detector": getattr(self.detector, "name", "?"),
            }


def read_temp() -> int:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read()) // 1000
    except Exception:
        return 0
