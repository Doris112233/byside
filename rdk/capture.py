#!/usr/bin/env python3
"""
录帧到文件夹 —— D1 清单里"回报率最高的半天"。

    python capture.py -o frames/desk01 -n 60             # 本机摄像头
    python capture.py -o frames/desk01 -s http://手机IP:8080/video
    python capture.py -o frames/desk01 -s synth -n 30    # 没有硬件也能造一批

录完之后算法就能在 Mac 上反复迭代，不用每改一次都跑到板子前面摆棋子。
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from framesource import FrameSource


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-s", "--source", default="0", help="0 | http://... | synth | 文件夹")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("-n", "--count", type=int, default=60)
    ap.add_argument("--fps", type=float, default=10.0)
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    src = FrameSource.open(a.source, loop=False)
    print(f"来源 {src.kind}:{src.label}  →  {a.out}  ({a.count} 帧 @ {a.fps}fps)")

    import cv2
    dt = 1.0 / a.fps
    meta = {"source": f"{src.kind}:{src.label}", "fps": a.fps, "frames": []}
    t0 = time.perf_counter()
    for k in range(a.count):
        f = src.read()
        if f is None:
            print(f"来源结束，共 {k} 帧"); break
        name = f"{k:05d}.png"
        cv2.imwrite(os.path.join(a.out, name), f)
        meta["frames"].append({"file": name, "t": round(time.perf_counter() - t0, 4)})
        if getattr(src, "truth", None) is not None:
            meta["frames"][-1]["truth"] = src.truth.tolist()
            meta["frames"][-1]["quad"] = src.quad
        print(f"\r  {k+1}/{a.count}  {f.shape[1]}x{f.shape[0]}", end="", flush=True)
        time.sleep(max(0, t0 + (k + 1) * dt - time.perf_counter()))
    print()
    src.close()
    with open(os.path.join(a.out, "meta.json"), "w") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)
    print(f"完成：{a.out}/  （含 meta.json）")


if __name__ == "__main__":
    main()
