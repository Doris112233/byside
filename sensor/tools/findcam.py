#!/usr/bin/env python3
"""
探测 IP 摄像头 App 的视频地址。

各家 App 的 MJPEG 路径都不一样（/live /video /videofeed ...），
与其查文档不如挨个试一遍，两秒钟的事。

    python3 findcam.py 192.168.1.21:8081
"""
import sys
import urllib.request

PATHS = ["/live", "/video", "/videofeed", "/stream", "/mjpeg", "/mjpegfeed",
         "/live.mjpg", "/video.mjpg", "/cam.mjpg", "/axis-cgi/mjpg/video.cgi",
         "/snapshot", "/shot.jpg", "/photo.jpg", "/"]


def probe(base, path, timeout=4):
    url = f"http://{base}{path}"
    try:
        r = urllib.request.urlopen(url, timeout=timeout)
        ct = (r.headers.get("Content-Type") or "").lower()
        head = r.read(2048)
        r.close()
    except Exception as e:
        return None, f"{type(e).__name__}"
    kind = None
    if "multipart" in ct:
        kind = "MJPEG 流"
    elif "image/jpeg" in ct or head[:2] == b"\xff\xd8":
        kind = "单帧 JPEG"
    elif "video" in ct:
        kind = "视频流"
    return kind, ct or "(无 content-type)"


def main():
    if len(sys.argv) < 2:
        print("用法: python3 findcam.py 192.168.1.21:8081")
        return 1
    base = sys.argv[1].replace("http://", "").rstrip("/")
    print(f"探测 http://{base} ...\n")
    best = None
    for p in PATHS:
        kind, info = probe(base, p)
        mark = "✓" if kind else " "
        print(f"  {mark} {p:28s} {kind or ''}  {info if not kind else ''}".rstrip())
        if kind == "MJPEG 流" and best is None:
            best = p
        elif kind and best is None:
            best = p
    print()
    if best:
        print(f"可用地址:  http://{base}{best}")
        print(f"\n切过去:\n  sudo sed -i 's|BYSIDE_SOURCE=.*|BYSIDE_SOURCE=http://{base}{best}|' /etc/byside.conf")
        print(f"  sudo systemctl restart byside")
        return 0
    print("没找到可用路径。检查：App 是否在前台运行、是否还开着密码、手机和板子是否同一个 Wi-Fi。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
