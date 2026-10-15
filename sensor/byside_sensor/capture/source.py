"""帧来源 —— 上层算法不该关心图是从哪来的。

    FrameSource.open("0")                         本机摄像头
    FrameSource.open("http://手机IP:8080/video")   手机 IP 摄像头（MJPEG）
    FrameSource.open("frames/desk01")             文件夹回放
    FrameSource.open("synth")                     合成图（无硬件也能跑）

文件夹回放是这一层存在的主要理由：算法迭代不需要板子、不需要投影仪、不需要摆棋子。
每个来源有一个 camera_id；多相机的一体机用 rig.CameraRig 把几个来源合在一起。
"""
from __future__ import annotations

import glob
import os
import threading
import time
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Frame:
    image: np.ndarray      # BGR 彩色或灰度
    ts: float              # time.monotonic()
    camera_id: str


class FrameSource:
    def __init__(self, kind: str, label: str, camera_id: str = "cam0"):
        self.kind = kind
        self.label = label
        self.camera_id = camera_id

    @staticmethod
    def open(spec, loop=True, fps=None, width=960, color=False, camera_id: str = "cam0") -> FrameSource:
        """color=True 返回 BGR 彩色帧，否则返回灰度。"""
        s = str(spec)
        if s == "synth":
            return SynthSource(camera_id=camera_id)
        if s.isdigit() or s.startswith(("http://", "https://", "rtsp://", "/dev/video")):
            return CameraSource(int(s) if s.isdigit() else s, width=width, color=color, camera_id=camera_id)
        if os.path.isdir(s):
            return FolderSource(s, loop=loop, fps=fps, color=color, camera_id=camera_id)
        raise ValueError(f"认不出的帧来源: {spec}")

    def read(self) -> np.ndarray | None:
        """返回一帧图，没有下一帧时返回 None。"""
        raise NotImplementedError

    def read_frame(self) -> Frame | None:
        img = self.read()
        return None if img is None else Frame(img, time.monotonic(), self.camera_id)

    def close(self) -> None:
        pass

    def __iter__(self):
        while True:
            f = self.read()
            if f is None:
                return
            yield f


class CameraSource(FrameSource):
    """本机 USB 摄像头，或手机 IP 摄像头的 MJPEG 流 —— 同一套代码。
    后台线程一直读、只留最新一帧。不这样做的话 OpenCV 内部会攒一个队列，画面越跑越慢。"""

    def __init__(self, src, width=960, color=False, camera_id: str = "cam0"):
        super().__init__("camera", str(src), camera_id)
        import cv2
        self.cv2 = cv2
        self.color = color
        self.cap = cv2.VideoCapture(src)
        if isinstance(src, int):
            # USB2.0 下必须走 MJPG，否则 1080p 的 YUY2 带宽不够。顺序有讲究：先设 fourcc 再设分辨率。
            # macOS 的 AVFoundation 不认 fourcc，set 会返回 False，无妨。
            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(width * 9 / 16))
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not self.cap.isOpened():
            raise RuntimeError(f"打不开摄像头: {src}")
        self._latest = None
        self._stop = False
        self._lock = threading.Lock()
        self._t = threading.Thread(target=self._pump, daemon=True)
        self._t.start()

    def _pump(self):
        while not self._stop:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            with self._lock:
                self._latest = frame

    def read(self):
        for _ in range(100):            # 最多等 5 秒拿第一帧
            with self._lock:
                f = self._latest
            if f is not None:
                return f if self.color else self.cv2.cvtColor(f, self.cv2.COLOR_BGR2GRAY)
            time.sleep(0.05)
        return None

    def lock_exposure(self, exposure=None, gain=None) -> list[str]:
        """关掉自动曝光/白平衡/增益（Linux v4l2）。投影一亮自动曝光就压暗整幅画面，识别阈值全漂。"""
        import subprocess
        dev = self.label if self.label.startswith("/dev/") else f"/dev/video{self.label}"
        cmds = ["auto_exposure=1", "white_balance_automatic=0"]
        if exposure:
            cmds.append(f"exposure_time_absolute={exposure}")
        if gain:
            cmds.append(f"gain={gain}")
        out = []
        for c in cmds:
            r = subprocess.run(["v4l2-ctl", "-d", dev, "-c", c], capture_output=True, text=True)
            out.append(f"{c}: {'ok' if r.returncode == 0 else r.stderr.strip()}")
        return out

    def close(self):
        self._stop = True
        self.cap.release()


class FolderSource(FrameSource):
    """文件夹回放。文件名排序即时间顺序。"""

    def __init__(self, path, loop=True, fps=None, color=False, camera_id: str = "cam0"):
        super().__init__("folder", path, camera_id)
        self.color = color
        self.files = sorted(
            f for f in glob.glob(os.path.join(path, "*"))
            if f.lower().endswith((".png", ".jpg", ".jpeg", ".pgm", ".npy"))
        )
        if not self.files:
            raise RuntimeError(f"文件夹里没有帧: {path}")
        self.i = 0
        self.loop = loop
        self.dt = 1.0 / fps if fps else 0.0
        self._t = 0.0

    def __len__(self):
        return len(self.files)

    def read(self):
        if self.i >= len(self.files):
            if not self.loop:
                return None
            self.i = 0
        p = self.files[self.i]
        self.i += 1
        if self.dt:
            now = time.perf_counter()
            wait = self._t + self.dt - now
            if wait > 0:
                time.sleep(wait)
            self._t = max(now, self._t + self.dt)
        if p.endswith(".npy"):
            return np.load(p)
        import cv2
        return cv2.imread(p, cv2.IMREAD_COLOR if self.color else cv2.IMREAD_GRAYSCALE)


class SynthSource(FrameSource):
    """合成图 —— 一个硬件都没有的时候也能把整条链路跑通。"""

    def __init__(self, seed=0, camera_id: str = "synth"):
        super().__init__("synth", "synthetic", camera_id)
        self.seed = seed
        self.quad = None
        self.truth = None

    def read(self):
        from byside_sensor.capture import synth
        img, truth, quad = synth.make_board(seed=self.seed)
        self.seed += 1
        self.truth, self.quad = truth, quad
        return img
