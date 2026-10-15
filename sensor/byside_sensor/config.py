"""配置分两种：
  SensorConfig   启动参数：命令行 > 环境变量 BYSIDE_* > 默认值。只在启动时定。
  Calibration    标定结果：~/.byside/config.json，运行中可改、可存。
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass, field

from byside_sensor.protocol import constants

CFG_PATH = os.path.expanduser(os.environ.get("BYSIDE_CONFIG", "~/.byside/config.json"))


@dataclass
class SensorConfig:
    source: str = "0"
    server: str = ""              # ws://host:8778/ws；空 = 单机
    user: str = ""                # 主人的好友码；板子挂在主人名下
    room: str = "home"            # 没有 user 时的旧模式房间
    seat: str | None = "black"    # 旧模式固定颜色；有 user 时由 role 决定
    port: int = 0                 # 控制页端口，0 = constants 里的默认
    proc_width: int = 960
    stream_fps: int = 8
    lock_exposure: bool = False
    auto_calib: bool = True
    detector: str = "classic"
    model: str = ""
    headless: bool = True
    windowed: bool = False
    insecure_tls: bool = False

    def __post_init__(self):
        if not self.port:
            self.port = constants().sensor_control
        self.user = self.user.upper().strip()


def parse_args(argv: list[str] | None = None) -> SensorConfig:
    env = os.environ
    d = SensorConfig()
    ap = argparse.ArgumentParser(prog="byside-sensor", description="咫尺识别端：摄像头 → 棋子坐标 → 中继")
    ap.add_argument("-s", "--source", default=env.get("BYSIDE_SOURCE", d.source), help="0 | http://手机IP:8080/video | 文件夹 | synth")
    ap.add_argument("--server", default=env.get("BYSIDE_SERVER", d.server), help="中继地址，如 ws://1.2.3.4:8778/ws。留空则单机运行")
    ap.add_argument("--user", default=env.get("BYSIDE_USER", d.user), help="主人的好友码。板子挂在主人名下，跟着主人进会话")
    ap.add_argument("--room", default=d.room, help="房间号（旧模式；有 --user 时不用）")
    ap.add_argument("--seat", default="black", choices=["black", "white", "both"], help="旧模式固定认哪一色")
    ap.add_argument("--port", type=int, default=int(env.get("BYSIDE_PORT", 0) or 0), help="控制页端口")
    ap.add_argument("--proc-width", type=int, default=d.proc_width, help="识别用的处理宽度，0 = 用原图")
    ap.add_argument("--stream-fps", type=int, default=d.stream_fps)
    ap.add_argument("--lock-exposure", action="store_true", help="USB 摄像头：关掉自动曝光/白平衡（Linux）")
    ap.add_argument("--no-auto-calib", action="store_true", help="关掉 ArUco 自动标定，只手动拖四个角")
    ap.add_argument("--detector", default=env.get("BYSIDE_DETECTOR", d.detector), choices=["classic", "onnx"])
    ap.add_argument("--model", default=env.get("BYSIDE_MODEL", d.model), help="--detector onnx 时的 .onnx 路径")
    ap.add_argument("--projector", action="store_true", help="用 pygame 直接出投影画面（不用浏览器）")
    ap.add_argument("--windowed", action="store_true", help="--projector 时开窗口而不是全屏")
    ap.add_argument("--insecure-tls", action="store_true", help="wss 自签证书时跳过校验（局域网）")
    a = ap.parse_args(argv)
    return SensorConfig(
        source=a.source, server=a.server, user=a.user, room=a.room,
        seat=None if a.seat == "both" else a.seat, port=a.port, proc_width=a.proc_width,
        stream_fps=a.stream_fps, lock_exposure=a.lock_exposure, auto_calib=not a.no_auto_calib,
        detector=a.detector, model=a.model, headless=not a.projector, windowed=a.windowed,
        insecure_tls=a.insecure_tls,
    )


@dataclass
class Calibration:
    quad: list[list[float]] = field(default_factory=lambda: [[.25, .18], [.75, .18], [.75, .82], [.25, .82]])
    scene: str = "gomoku"
    # 投影方框在投影画面里的大小和位置（只对 pygame 投影有用）。投影仪镜头几乎都有偏移，所以必须能在线调。
    margin: float = 0.11
    offset: list[float] = field(default_factory=lambda: [0.0, 0.0])

    @classmethod
    def load(cls, path: str = CFG_PATH) -> Calibration:
        c = cls()
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            return c
        if isinstance(d.get("quad"), list) and len(d["quad"]) == 4:
            c.quad = [[float(p[0]), float(p[1])] for p in d["quad"]]
        if isinstance(d.get("scene"), str):
            c.scene = d["scene"]
        if "margin" in d:
            c.margin = float(d["margin"])
        if isinstance(d.get("offset"), list) and len(d["offset"]) == 2:
            c.offset = [float(d["offset"][0]), float(d["offset"][1])]
        print(f"读到标定配置 {path}", flush=True)
        return c

    def save(self, path: str = CFG_PATH) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False)
