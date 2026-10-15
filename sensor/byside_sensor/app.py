"""咫尺识别端入口：一块板（或一台电脑）+ 一只朝下的摄像头 = 一端。

    byside-sensor --source 1 --server ws://192.168.1.5:8778/ws --user K7M2QX
    byside-sensor --source synth                       # 没硬件也能跑通链路
    byside-sensor --source 0 --projector               # 不用浏览器，pygame 直接投

三件事：采集线程（取帧 → 识别 → 发坐标）、控制页 HTTP 线程、可选的 pygame 投影主线程。
"""
from __future__ import annotations

import socket
import sys

from byside_sensor.config import Calibration, SensorConfig, parse_args
from byside_sensor.control import web
from byside_sensor.detect import make_detector
from byside_sensor.net.link import NetLink
from byside_sensor.pipeline import Pipeline


def build(cfg: SensorConfig) -> Pipeline:
    calib = Calibration.load()
    try:
        detector = make_detector(cfg.detector, cfg.model)
    except ValueError as e:
        sys.exit(str(e))
    print(f"[识别] {detector.name}" + (f" 模型 {cfg.model}" if cfg.model else ""), flush=True)
    link = None
    if cfg.server:
        if cfg.user:
            link = NetLink(cfg.server, user=cfg.user, kind="board", insecure_tls=cfg.insecure_tls)
        else:
            link = NetLink(cfg.server, room=cfg.room, seat=cfg.seat or "?", insecure_tls=cfg.insecure_tls)
        print(f"中继 {cfg.server}  " + (f"主人 {cfg.user}" if cfg.user else f"房间「{cfg.room}」"), flush=True)
    p = Pipeline(cfg, calib, detector, link)
    if link:
        link.start()
    return p


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("223.5.5.5", 53))       # 不真连，只为问系统「出网走哪个网卡」
        return s.getsockname()[0]
    except Exception:
        return socket.gethostbyname(socket.gethostname())
    finally:
        s.close()


def main(argv: list[str] | None = None) -> None:
    cfg = parse_args(argv)
    p = build(cfg)
    web.serve(p, cfg.port)
    print(f"\n手机打开：http://{lan_ip()}:{cfg.port}/     （Ctrl+C 退出）\n", flush=True)
    try:
        if cfg.headless:
            p.run()                      # 投影由浏览器负责，这里只做传感器
        else:
            from byside_sensor.projector.loop import run_projector
            run_projector(p, fullscreen=not cfg.windowed)
    except KeyboardInterrupt:
        pass
    finally:
        p.stop()


if __name__ == "__main__":
    main()
