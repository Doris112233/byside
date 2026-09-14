#!/usr/bin/env python3
"""
BySide 设备端主程序 —— 一块板 + 一个摄像头 + 一台投影仪 = 一端。

    python3 app.py --source http://手机IP:8080/video --seat black
    python3 app.py --source 0 --seat black --lock-exposure

架构就三件事：
  采集线程   取帧 → 识别 → 更新共享状态
  主线程     pygame 渲染到 HDMI（pygame 的 display 必须在主线程）
  HTTP 线程  手机控制页 + MJPEG 推流
"""
import argparse
import json
import os
import sys
import threading
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import byside_cv as bcv
import web
from netlink import NetLink
from framesource import FrameSource

CFG_PATH = os.path.expanduser("~/.byside/config.json")
N = 15


class App:
    def __init__(self, source, seat="black", n=N, fullscreen=True, stream_fps=8, proc_width=960):
        self.n = n
        self.proc_width = proc_width
        self.seat = seat
        self.stream_fps = stream_fps
        self.mode = "calib"          # calib | play
        self.scene = "gomoku"
        self.quad = [[.25, .18], [.75, .18], [.75, .82], [.25, .82]]
        # 投影方框在投影画面里的大小和位置。投影仪镜头几乎都有偏移，
        # 画面不会正好落在灯正下方，所以这两个必须能在线调。
        self.margin = 0.11
        self.offset = [0.0, 0.0]
        self.load_cfg()

        # 摄像头延迟打开：VideoCapture 连不上 MJPEG 流时会阻塞很久，
        # 要是放在这里，摄像头一有问题整个控制台都进不去——而控制台
        # 恰恰是你诊断摄像头问题的唯一手段。所以先把服务起来，再连相机。
        self.source = source
        self.src = None
        self.cam_status = "未连接"
        self.tracker = bcv.StoneTracker(n)
        self.remote = np.zeros(n * n, np.int8)

        self.link = None             # 中继连接，由 connect() 建立
        self.room = "default"
        self.frame = None            # 最新彩色帧
        self.cls = np.zeros(n * n, np.int8)
        self.lock = threading.Lock()
        self.fps = 0.0
        self.ms = 0.0
        self.cell = 0.0
        self.running = True
        self._pv_cache = (0.0, None)

    # ---------- 配置 ----------
    def load_cfg(self):
        try:
            with open(CFG_PATH) as f:
                c = json.load(f)
            self.quad = c.get("quad", self.quad)
            self.scene = c.get("scene", self.scene)
            self.margin = c.get("margin", self.margin)
            self.offset = c.get("offset", self.offset)
            print(f"读到标定配置 {CFG_PATH}")
        except Exception:
            pass

    def save_cfg(self):
        os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
        with open(CFG_PATH, "w") as f:
            json.dump({"quad": self.quad, "scene": self.scene,
                       "margin": self.margin, "offset": self.offset}, f)

    def apply_config(self, c):
        if "quad" in c and len(c["quad"]) == 4:
            self.quad = [[float(p[0]), float(p[1])] for p in c["quad"]]
        if c.get("mode") in ("calib", "play"):
            self.mode = c["mode"]
        if c.get("scene") in ("gomoku", "draw"):
            self.scene = c["scene"]
        if "margin" in c:
            self.margin = max(0.02, min(0.42, float(c["margin"])))
        if "offset" in c and len(c["offset"]) == 2:
            self.offset = [max(-.45, min(.45, float(c["offset"][0]))),
                           max(-.45, min(.45, float(c["offset"][1])))]
        if c.get("save"):
            self.save_cfg()

    # ---------- 联网 ----------
    def connect(self, url, room):
        """接中继。传的是位置不是画面 —— 一次落子几十字节。"""
        self.room = room
        self.link = NetLink(url, room=room, seat=self.seat or "?",
                            on_msg=self.on_peer).start()
        return self.link

    def on_peer(self, m):
        """收对端的消息。只认位置，不认画面。"""
        t = m.get("t")
        n = self.n
        if t == "move":
            i, j, c = m.get("i"), m.get("j"), m.get("c", 0)
            if isinstance(i, int) and isinstance(j, int) and 0 <= i < n and 0 <= j < n:
                with self.lock:
                    self.remote[j * n + i] = c
        elif t == "state":
            # 全量快照：重连或新接入时用它对账，避免两边永久不一致
            grid = np.zeros(n * n, np.int8)
            for mv in (m.get("moves") or []):
                if len(mv) >= 3 and 0 <= mv[0] < n and 0 <= mv[1] < n:
                    grid[mv[1] * n + mv[0]] = mv[2]
            with self.lock:
                self.remote = grid
        elif t == "reset":
            with self.lock:
                self.remote = np.zeros(n * n, np.int8)
        elif t in ("hello", "req"):
            self.publish_state()

    def publish_state(self):
        """把本端识别到的完整局面发出去 —— 对端拿它对账。"""
        if not self.link:
            return
        with self.lock:
            phys = self.tracker.phys
        moves = [[k % self.n, k // self.n, int(v)] for k, v in enumerate(phys) if v]
        self.link.send({"t": "state", "moves": moves, "N": self.n})

    # ---------- 几何 ----------
    def bp(self, shape):
        """归一化四角 → 图像像素的格点反投影。"""
        h, w = shape[:2]
        px = [[q[0] * w, q[1] * h] for q in self.quad]
        return bcv.grid_backproject(px, self.n)

    # ---------- 采集线程 ----------
    def open_source(self):
        """连相机，失败就退避重试。不会拖垮主进程。"""
        delay = 2
        while self.running and self.src is None:
            try:
                self.cam_status = "连接中…"
                src = FrameSource.open(self.source, color=True)
                probe = src.read()
                if probe is None:
                    raise RuntimeError("连上了但拿不到帧")
                self.src = src
                if getattr(self, "want_lock_exposure", False) and hasattr(src, "lock_exposure"):
                    for line in src.lock_exposure():
                        print("  曝光:", line, flush=True)
                self.cam_status = f"已连接 {probe.shape[1]}x{probe.shape[0]}"
                print(f"[相机] {self.cam_status}  ({self.source})", flush=True)
            except Exception as e:
                self.cam_status = f"失败: {type(e).__name__} {e}"
                print(f"[相机] {self.cam_status}，{delay}s 后重试", flush=True)
                try:
                    src.close()
                except Exception:
                    pass
                time.sleep(delay)
                delay = min(delay * 2, 8)

    def capture_loop(self):
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
            gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if f.ndim == 3 else f
            # 识别不需要 1080p：格距 59px 降到 29px 仍远高于算法下限（实测 8.5px 都行），
            # 但耗时能砍一半。原网页版的 procW 也是 960，保持一致。
            if self.proc_width and gray.shape[1] > self.proc_width:
                k = self.proc_width / gray.shape[1]
                gray = cv2.resize(gray, (self.proc_width, int(gray.shape[0] * k)),
                                  interpolation=cv2.INTER_AREA)

            bp = self.bp(gray.shape)
            cls = None
            t0 = time.perf_counter()
            if bp:
                cls, _, cell = bcv.classify_abs(gray, bp, self.n, seat=self.seat)
                self.cell = cell
            dt_ms = (time.perf_counter() - t0) * 1000

            with self.lock:
                self.frame = f
                self.fps = 1.0 / ema if ema > 0 else 0
                self.ms = dt_ms
                if cls is not None:
                    self.cls = cls
                    if self.mode == "play":
                        for (i, j, now_, was) in self.tracker.update(cls):
                            print(f"[落子] ({i},{j}) {was}→{now_}", flush=True)
                            if self.link:
                                self.link.send({"t": "move", "i": i, "j": j, "c": now_})

    # ---------- 给网页用的图 ----------
    def preview_jpeg(self):
        now = time.time()
        if now - self._pv_cache[0] < 0.25 and self._pv_cache[1]:
            return self._pv_cache[1]
        with self.lock:
            f = None if self.frame is None else self.frame.copy()
            cls = self.cls.copy()
        if f is None:
            return None
        img = cv2.resize(f, (640, int(640 * f.shape[0] / f.shape[1])))
        bp = self.bp(img.shape)
        if bp:
            pts = np.array([[bp(i, j) for i in (0, self.n - 1)] for j in (0, self.n - 1)], np.int32)
            quad = np.array([pts[0, 0], pts[0, 1], pts[1, 1], pts[1, 0]], np.int32)
            cv2.polylines(img, [quad], True, (62, 168, 235), 2)
            for j in range(self.n):
                for i in range(self.n):
                    c = cls[j * self.n + i]
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

    def stream_jpeg(self):
        """推给对端看的桌面画面。压到 480 宽，别跟识别抢资源。"""
        with self.lock:
            f = None if self.frame is None else self.frame
            if f is None:
                return None
            small = cv2.resize(f, (480, int(480 * f.shape[0] / f.shape[1])))
        ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 60])
        return buf.tobytes() if ok else None

    def state_dict(self):
        with self.lock:
            return {
                "mode": self.mode, "scene": self.scene, "seat": self.seat,
                "quad": self.quad, "fps": self.fps, "ms": self.ms,
                "cell": self.cell, "stones": self.tracker.count,
                "occluded": bool(self.tracker.occluded),
                "temp": read_temp(),
                "margin": self.margin, "offset": self.offset,
                "cam": self.cam_status,
                "room": self.room,
                "net": self.link.status if self.link else "未启用",
                "peers": self.link.peers if self.link else 0,
                "source": self.source.split("@")[-1],
            }

    # ---------- 主循环 ----------
    def run(self, fullscreen=True):
        import pygame
        import render as rnd     # 只有真要出画面时才需要 pygame
        r = rnd.Renderer(self.n, fullscreen=fullscreen)
        print(f"投影分辨率 {r.w}x{r.h}")
        t = threading.Thread(target=self.capture_loop, daemon=True)
        t.start()
        clock = pygame.time.Clock()
        while self.running:
            for e in pygame.event.get():
                if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key in (pygame.K_ESCAPE, pygame.K_q)):
                    self.running = False
            r.margin, r.offset = self.margin, self.offset
            if self.src is None:
                r.calib_pattern(note=f"等待相机  {self.cam_status}")
            elif self.mode == "calib":
                r.calib_pattern()
            else:
                with self.lock:
                    phys = self.tracker.phys.copy()
                r.draw(phys, self.remote, show_hint=True)
            clock.tick(30)
        r.quit()
        if self.src:
            self.src.close()


def read_temp():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read()) // 1000
    except Exception:
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-s", "--source", default="0", help="0 | http://手机IP:8080/video | 文件夹 | synth")
    ap.add_argument("--seat", default="black", choices=["black", "white", "both"])
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--windowed", action="store_true")
    ap.add_argument("--lock-exposure", action="store_true", help="USB 摄像头：关掉自动曝光/白平衡")
    ap.add_argument("--proc-width", type=int, default=960, help="识别用的处理宽度，0 = 用原图")
    ap.add_argument("--server", default="", help="中继地址，如 ws://1.2.3.4:8778/ws。留空则单机运行")
    ap.add_argument("--room", default="home", help="房间号，两端必须一致")
    a = ap.parse_args()

    app = App(a.source, seat=None if a.seat == "both" else a.seat, proc_width=a.proc_width)
    app.want_lock_exposure = a.lock_exposure
    if a.server:
        app.connect(a.server, a.room)
        print(f"中继 {a.server}  房间「{a.room}」", flush=True)
    web.serve(app, a.port)
    import socket
    s_ = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s_.connect(("223.5.5.5", 53))       # 不真连，只为问系统「出网走哪个网卡」
        ip = s_.getsockname()[0]
    except Exception:
        ip = socket.gethostbyname(socket.gethostname())
    finally:
        s_.close()
    print(f"\n手机打开：http://{ip}:{a.port}/     （按 Q 或 Esc 退出）\n", flush=True)
    app.run(fullscreen=not a.windowed)


if __name__ == "__main__":
    main()
