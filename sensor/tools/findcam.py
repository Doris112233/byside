#!/usr/bin/env python3
"""找手机 IP 摄像头 App 的视频地址，顺手写进板子的配置。

各家 App 的 MJPEG 路径都不一样（/live /video /videofeed ...），与其查文档不如挨个试。

    python tools/findcam.py 192.168.1.21:8081           试一台
    python tools/findcam.py --scan                      扫整个 /24 找 8081 端口
    python tools/findcam.py --scan --apply              找到就写进 /etc/byside.conf 并重启 byside 服务
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import re
import socket
import subprocess
import sys
import urllib.request

PATHS = ["/live", "/video", "/videofeed", "/stream", "/mjpeg", "/mjpegfeed",
         "/live.mjpg", "/video.mjpg", "/cam.mjpg", "/axis-cgi/mjpg/video.cgi",
         "/snapshot", "/shot.jpg", "/photo.jpg", "/"]
CONF = "/etc/byside.conf"


def probe(host: str, timeout: float = 2.0) -> str | None:
    base = host if host.startswith("http") else "http://" + host
    for p in PATHS:
        url = base + p
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                ct = r.headers.get("Content-Type", "")
                if "multipart" in ct or "image" in ct:
                    return url
        except Exception:
            continue
    return None


def lan_prefix() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("223.5.5.5", 53))
        ip = s.getsockname()[0]
    finally:
        s.close()
    return ip.rsplit(".", 1)[0]


def scan(port: int = 8081) -> list[str]:
    prefix = lan_prefix()
    hosts = [f"{prefix}.{i}" for i in range(1, 255)]

    def open_(h: str) -> str | None:
        try:
            with socket.create_connection((h, port), timeout=0.4):
                return f"{h}:{port}"
        except Exception:
            return None

    with concurrent.futures.ThreadPoolExecutor(64) as ex:
        return [h for h in ex.map(open_, hosts) if h]


def apply(url: str) -> None:
    if not os.path.exists(CONF):
        sys.exit(f"{CONF} 不存在，先跑 scripts/rdk-setup.sh")
    text = open(CONF, encoding="utf-8").read()
    text = re.sub(r"^BYSIDE_SOURCE=.*$", f"BYSIDE_SOURCE={url}", text, flags=re.M)
    open(CONF, "w", encoding="utf-8").write(text)
    subprocess.run(["sudo", "systemctl", "restart", "byside"], check=False)
    print(f"已写入 {CONF} 并重启 byside")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("host", nargs="?", help="IP:端口")
    ap.add_argument("--scan", action="store_true", help="扫描局域网")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--apply", action="store_true", help="写进板子配置并重启服务")
    a = ap.parse_args()
    cands = [a.host] if a.host else (scan(a.port) if a.scan else [])
    if not cands:
        print("没给地址也没 --scan，或者局域网里没找到开着端口的手机")
        return 1
    for h in cands:
        url = probe(h)
        if url:
            print("视频地址：", url)
            if a.apply:
                apply(url)
            return 0
        print(f"{h} 没有能用的视频路径")
    return 1


if __name__ == "__main__":
    sys.exit(main())
